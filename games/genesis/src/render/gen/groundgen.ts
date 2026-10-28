// GENESIS — procedural ground-cover meshes (CONTRACT.md §15.6 near-camera grass, plus stones): no assets, grown from
// code, deterministic per variant. Unit size; instances scale them.
//
//   grass tuft — nine to thirteen tapering, curving blades leaning out from a small clump; colour darkens toward the
//                base (the tuft's own occlusion); `aWind` rises with height so the tips sway, the base stays put
//   stone      — a jittered, flattened icosahedron with smooth normals: pebbles and fist-sized rocks
// The attribute layout matches the vegetation material (render/life/vegetation.ts): position, normal, color, aWind,
// aLeafUv (unused here), aCard (0.5 = solid foliage, 0 = bark, 0.1 = stone) and aCrown (crown depth: 1 = fully exposed).

import { BufferGeometry, Float32BufferAttribute } from 'three';
import { Rng } from '../../sim/core/rng.ts';

class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  wind: number[] = [];
  card: number[] = [];
  idx: number[] = [];
  /** c: grey level, or an RGB colour (bark / stems keep their hue: the instance tint only scales their brightness) */
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: number | readonly [number, number, number], w: number, card: number): number {
    this.pos.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    this.nrm.push(nx / l, ny / l, nz / l);
    if (typeof c === 'number') this.col.push(c, c, c);
    else this.col.push(c[0], c[1], c[2]);
    this.wind.push(w);
    this.card.push(card);
    return this.pos.length / 3 - 1;
  }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    const n = this.pos.length / 3;
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWind', new Float32BufferAttribute(this.wind, 1));
    g.setAttribute('aLeafUv', new Float32BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute('aCard', new Float32BufferAttribute(this.card, 1));
    g.setAttribute('aCrown', new Float32BufferAttribute(new Float32Array(n).fill(1), 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** a grass tuft, unit height (blades 0.55–1.0), ~0.35 wide */
export function grassTuft(variant: number): BufferGeometry {
  const rng = new Rng(7100 + variant * 37);
  const b = new Builder();
  const blades = 9 + Math.floor(rng.float() * 5);
  for (let k = 0; k < blades; k++) {
    const az = (k / blades) * Math.PI * 2 + rng.float() * 0.7;
    const r0 = 0.02 + rng.float() * 0.09;
    const bx = Math.cos(az) * r0, bz = Math.sin(az) * r0;
    const lean = 0.15 + rng.float() * 0.5; // radians from vertical
    const h = 0.55 + rng.float() * 0.45;
    const w = 0.022 + rng.float() * 0.016;
    // the blade's facing: across its lean direction, a little twisted
    const tw = az + Math.PI / 2 + (rng.float() - 0.5) * 0.8;
    const sx = Math.cos(tw), sz = Math.sin(tw);
    const ox = Math.cos(az), oz = Math.sin(az);
    const rows = 4;
    let prevL = -1, prevR = -1;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      // the blade curves outward more the higher it gets
      const bend = lean * (0.35 + 0.65 * t * t);
      const out = Math.sin(bend) * h * t;
      const y = Math.cos(bend * 0.6) * h * t;
      const cx = bx + ox * out, cz = bz + oz * out;
      const half = w * (1 - t * 0.92) * 0.5;
      // normals: mostly up (blades lit like the sward they stand in), a share of the blade's own facing
      const fx = ox * 0.35, fz = oz * 0.35;
      const shade = 0.42 + 0.58 * t;
      const windW = t * t;
      if (i < rows) {
        const L = b.vert(cx - sx * half, y, cz - sz * half, fx, 1, fz, shade, windW, 0.5);
        const R = b.vert(cx + sx * half, y, cz + sz * half, fx, 1, fz, shade, windW, 0.5);
        if (prevL >= 0) b.idx.push(prevL, prevR, R, prevL, R, L);
        prevL = L; prevR = R;
      } else {
        const T = b.vert(cx, y, cz, fx, 1, fz, shade, windW, 0.5);
        b.idx.push(prevL, prevR, T);
      }
    }
  }
  return b.build();
}

/** a stone, unit radius before scaling, flattened, with a lumpy outline */
export function stone(variant: number): BufferGeometry {
  const rng = new Rng(8300 + variant * 53);
  const t = (1 + Math.sqrt(5)) / 2;
  const base = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  // one subdivision so the stone is not a d20
  const verts: number[][] = base.map((v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; });
  const mid = new Map<string, number>();
  const midpoint = (a: number, c: number): number => {
    const key = a < c ? `${a}|${c}` : `${c}|${a}`;
    let i = mid.get(key);
    if (i === undefined) {
      const v = [(verts[a][0] + verts[c][0]) / 2, (verts[a][1] + verts[c][1]) / 2, (verts[a][2] + verts[c][2]) / 2];
      const l = Math.hypot(v[0], v[1], v[2]);
      verts.push([v[0] / l, v[1] / l, v[2] / l]);
      i = verts.length - 1;
      mid.set(key, i);
    }
    return i;
  };
  const tris: number[][] = [];
  for (const [a, c, d] of faces) {
    const ab = midpoint(a, c), bc = midpoint(c, d), ca = midpoint(d, a);
    tris.push([a, ab, ca], [c, bc, ab], [d, ca, bc], [ab, bc, ca]);
  }
  // rounded, a little taller than wide-flat (half of it sits in the ground: groundcover sinks it by a third)
  // (boulders and cobbles, not coins: seen from above a flat stone read as a pale disc on the grass)
  const flat = 0.78 + rng.float() * 0.35;
  const stretch = 0.85 + rng.float() * 0.4;
  const jit = verts.map(() => 0.88 + rng.float() * 0.24);
  const b = new Builder();
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    const r = jit[i];
    // flattened, stretched, sunk a little: the lower part sits in the ground
    const x = v[0] * r * stretch, y = v[1] * r * flat + 0.15 * flat, z = v[2] * r;
    // (aCard 0.1: a stone to the vegetation shader — not bark, whose furrows, clamp and desaturated tint made the
    // meadow stones black and navy salt-and-pepper lumps)
    b.vert(x, y, z, v[0] / stretch, v[1] / flat, v[2], 0.85 + 0.15 * v[1], 0, 0.1);
  }
  // (the icosahedron's faces wind counter-clockwise seen from outside, and the subdivision keeps that)
  for (const tri of tris) b.idx.push(tri[0], tri[1], tri[2]);
  return b.build();
}

// ───────────────────────────── crops, flowers, forest-floor pieces ─────────────────────────────

/** crop types (plants.json crops: wheat, rice, maize, flax, barley, sorghum, potato, lentil, cotton; the index is
 *  stored in groundcover's caches: append only) */
export const CROP_TYPES = ['wheat', 'rice', 'maize', 'flax', 'barley', 'sorghum', 'potato', 'lentil', 'cotton'] as const;
/** aCard that keeps a part's own hue against the crop's green → gold tint (treegen.ts FRUIT_CARD) */
const KEEP_HUE = 0.35;
export type CropType = (typeof CROP_TYPES)[number];

/**
 * A crop clump covering ~0.6 × 0.6 m of a field row, unit height (the instance scales it by the growth stage):
 *   wheat — a dozen stems with drooping ears; rice — a dense tuft of arching blades with panicles;
 *   maize — one tall stalk with long strap leaves, a tassel and a cob; flax — thin stems with small blue flowers;
 *   barley — shorter stems with nodding ears and long awns; sorghum — two stalks with strap leaves, each crowned by an
 *   upright compact seed head that ripens rust-red; potato — a low mound of broad compound leaves with white-lilac
 *   flowers; lentil — a low, fine, bushy tangle of thin stems, tiny leaflets and small pods; cotton — a knee-to-hip
 *   high bush of broad lobed leaves with bolls that are green while growing and burst white when ripe.
 * Foliage is solid (aCard 0.5) so the instance tint (green → gold through the season) colours it; vertex colours
 * shape the hue under that tint (sorghum heads, cotton leaves and bolls), and KEEP_HUE parts keep their own colour.
 */
export function cropClump(type: CropType, variant: number): BufferGeometry {
  const rng = new Rng(9100 + variant * 29 + type.length * 7);
  const b = new Builder();
  const blade = (x: number, z: number, h: number, lean: number, az: number, w: number, shade: number, rows = 3) => {
    const ox = Math.cos(az), oz = Math.sin(az), sx = -oz, sz = ox;
    let pl = -1, pr = -1;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const bend = lean * t * t;
      const cx = x + ox * Math.sin(bend) * h * t, cz = z + oz * Math.sin(bend) * h * t, y = Math.cos(bend * 0.7) * h * t;
      const half = w * (1 - 0.9 * t) * 0.5;
      const L = b.vert(cx - sx * half, y, cz - sz * half, ox * 0.3, 1, oz * 0.3, shade * (0.55 + 0.45 * t), t * t, 0.5);
      const R = b.vert(cx + sx * half, y, cz + sz * half, ox * 0.3, 1, oz * 0.3, shade * (0.55 + 0.45 * t), t * t, 0.5);
      if (pl >= 0) b.idx.push(pl, pr, R, pl, R, L);
      pl = L; pr = R;
    }
    return [x + ox * Math.sin(lean) * h, Math.cos(lean * 0.7) * h, z + oz * Math.sin(lean) * h] as [number, number, number];
  };
  const head = (p: [number, number, number], len: number, r: number, droop: number, shade: number, n = 5) => {
    // an ear / panicle: a small spindle hanging from the stem tip
    const ring: number[][] = [];
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      const cy = p[1] - Math.sin(droop) * len * t, cx = p[0] + Math.cos(droop) * len * t * 0.4;
      const rr = r * Math.sin(Math.PI * (0.15 + 0.7 * t));
      const row: number[] = [];
      for (let s = 0; s <= n; s++) {
        const a = (s / n) * Math.PI * 2;
        row.push(b.vert(cx + Math.cos(a) * rr, cy, p[2] + Math.sin(a) * rr, Math.cos(a), 0.3, Math.sin(a), shade, 1, 0.5));
      }
      ring.push(row);
    }
    for (let i = 0; i < 3; i++) for (let s = 0; s < n; s++) b.idx.push(ring[i][s], ring[i + 1][s], ring[i + 1][s + 1], ring[i][s], ring[i + 1][s + 1], ring[i][s + 1]);
  };
  /** multiply the colour of every vertex from n0 on (shapes the hue a part takes under the instance tint) */
  const mulCol = (n0: number, c: readonly [number, number, number]) => {
    for (let v = n0; v < b.col.length / 3; v++) { b.col[v * 3] *= c[0]; b.col[v * 3 + 1] *= c[1]; b.col[v * 3 + 2] *= c[2]; }
  };
  const nv = () => b.col.length / 3;
  /** a thin double-sided strip from p along d (awns, small stems) */
  const strip = (p: readonly number[], dx: number, dy: number, dz: number, len: number, w: number, shade: number, card = 0.5) => {
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const sx = -dz, sz = dx;
    const a = b.vert(p[0] - sx * w, p[1], p[2] - sz * w, 0, 1, 0, shade, 1, card);
    const c = b.vert(p[0] + sx * w, p[1], p[2] + sz * w, 0, 1, 0, shade, 1, card);
    const e = b.vert(p[0] + dx * len, p[1] + dy * len, p[2] + dz * len, 0, 1, 0, shade * 1.1, 1, card);
    b.idx.push(a, c, e, a, e, c);
  };
  /** a flat leaf: a fan of 5 points around its tip direction (cotton's lobed leaves, potato leaflets) */
  const leaf = (x: number, y: number, z: number, az: number, size: number, tilt: number, shade: number, lobes = 5) => {
    const ox = Math.cos(az), oz = Math.sin(az);
    const base = b.vert(x, y, z, 0, 1, 0, shade * 0.8, 0.6, 0.5);
    const ring: number[] = [];
    for (let i = 0; i < lobes; i++) {
      const a = az + ((i / (lobes - 1)) - 0.5) * 2.0;
      const r = size * (i % 2 ? 0.75 : 1);
      ring.push(b.vert(x + Math.cos(a) * r * 0.7 + ox * size * 0.35, y + tilt * size - (i % 2 ? 0 : 0.15 * size), z + Math.sin(a) * r * 0.7 + oz * size * 0.35, 0, 1, 0, shade, 1, 0.5));
    }
    for (let i = 0; i < lobes - 1; i++) b.idx.push(base, ring[i + 1], ring[i], base, ring[i], ring[i + 1]);
  };
  /** a small round boll / pod (8 verts) */
  const ball = (x: number, y: number, z: number, r: number, c: readonly [number, number, number], card = 0.5) => {
    const t = b.vert(x, y + r, z, 0, 1, 0, c, 1, card), d = b.vert(x, y - r, z, 0, -1, 0, [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7], 1, card);
    const ring: number[] = [];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ring.push(b.vert(x + Math.cos(a) * r, y, z + Math.sin(a) * r, Math.cos(a), 0, Math.sin(a), c, 1, card)); }
    for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; b.idx.push(t, ring[j], ring[i], d, ring[i], ring[j]); }
  };
  if (type === 'barley') {
    // shorter and denser than wheat, the ears nod over and bristle with long awns (the beard that reads at a glance)
    for (let k = 0; k < 6; k++) {
      const x = (rng.float() - 0.5) * 0.6, z = (rng.float() - 0.5) * 0.6;
      blade(x, z, 0.3 + rng.float() * 0.2, 0.9 + rng.float() * 0.5, rng.float() * 6.28, 0.028, 0.7, 2);
    }
    for (let k = 0; k < 22; k++) {
      const x = (rng.float() - 0.5) * 0.9, z = (rng.float() - 0.5) * 0.9, az = rng.float() * 6.28;
      const tip = blade(x, z, 0.78 + rng.float() * 0.2, 0.15 + rng.float() * 0.3, az, 0.013, 0.85, 2);
      const droop = 0.9 + rng.float() * 0.5;
      head(tip, 0.075, 0.012, droop, 1.12, 3);
      // awns fan forward and up from along the ear
      const ex = tip[0] + Math.cos(droop) * 0.075 * 0.4, ey = tip[1] - Math.sin(droop) * 0.075;
      for (let a = 0; a < 4; a++) {
        const t = a / 3;
        const p = [tip[0] + (ex - tip[0]) * t, tip[1] + (ey - tip[1]) * t, tip[2]];
        strip(p, Math.cos(az + a) * 0.35 + 0.4, 0.8, Math.sin(az + a) * 0.35, 0.09 + rng.float() * 0.03, 0.0025, 1.15);
      }
    }
  } else if (type === 'sorghum') {
    for (let s2 = 0; s2 < 2; s2++) {
      const x = (s2 - 0.5) * 0.28 + (rng.float() - 0.5) * 0.08, z = (rng.float() - 0.5) * 0.12;
      const h = 0.88 + rng.float() * 0.12;
      blade(x, z, h, 0.03, rng.float() * 6.28, 0.035, 0.85, 4);
      for (let k = 0; k < 6; k++) {
        const y0 = 0.12 + k * 0.11, az = k * 2.4 + rng.float() + s2;
        const ox = Math.cos(az), oz = Math.sin(az);
        let pl = -1, pr = -1;
        for (let i = 0; i <= 4; i++) {
          const t = i / 4;
          const cx = x + ox * t * 0.38, cz = z + oz * t * 0.38, y = y0 + 0.16 * t - 0.26 * t * t;
          const half = 0.032 * Math.sin(Math.PI * (0.1 + 0.8 * t));
          const L = b.vert(cx - oz * half, y, cz + ox * half, 0, 1, 0, 0.8, 0.3 + 0.7 * t, 0.5);
          const R = b.vert(cx + oz * half, y, cz - ox * half, 0, 1, 0, 0.8, 0.3 + 0.7 * t, 0.5);
          if (pl >= 0) b.idx.push(pl, pr, R, pl, R, L, pl, R, pr, pl, L, R);
          pl = L; pr = R;
        }
      }
      // the seed head: an upright, compact oval panicle, rust-red when ripe (olive green under the young tint)
      const n0 = nv();
      head([x, h - 0.02, z], 0.17, 0.05, -1.45, 1.05, 6);
      mulCol(n0, [1.75, 0.72, 0.5]);
    }
  } else if (type === 'potato') {
    // a low mound: compound leaves arching out of the ridge, leaflets along them, flowers on top
    // (the leaflets are big: a potato leaf is 20-30 cm on a half-metre plant, and the rows close into one mound)
    for (let k = 0; k < 10; k++) {
      const az = (k / 10) * 6.28 + rng.float() * 0.5, lean = 0.55 + rng.float() * 0.6, h = 0.62 + rng.float() * 0.3;
      const x0 = (rng.float() - 0.5) * 0.14, z0 = (rng.float() - 0.5) * 0.14;
      const tip = blade(x0, z0, h, lean, az, 0.03, 0.7, 3);
      for (let j = 0; j < 3; j++) {
        const t = 0.4 + j * 0.22;
        const px = x0 + (tip[0] - x0) * t, py = tip[1] * t + 0.02, pz = z0 + (tip[2] - z0) * t;
        leaf(px, py, pz, az + 1.1, 0.13 + 0.03 * j, 0.25, 0.78, 3);
        leaf(px, py, pz, az - 1.1, 0.13 + 0.03 * j, 0.25, 0.74, 3);
      }
      leaf(tip[0], tip[1], tip[2], az, 0.2, 0.15, 0.84, 5);
    }
    for (let k = 0; k < 4; k++) {
      const a = rng.float() * 6.28, r = rng.float() * 0.12;
      ball(Math.cos(a) * r, 0.92 + rng.float() * 0.12, Math.sin(a) * r, 0.022, k % 2 ? [6.5, 6.2, 7.5] : [6.8, 5.6, 8], KEEP_HUE);
    }
  } else if (type === 'lentil') {
    // a fine, low, bushy tangle: thin stems, tiny leaflets crowding them, small flat pods
    // (pinnate leaves: each stem carries five pairs of small oval leaflets, so the rows close into a soft green carpet)
    for (let k = 0; k < 34; k++) {
      const x = (rng.float() - 0.5) * 0.85, z = (rng.float() - 0.5) * 0.85, az = rng.float() * 6.28;
      const tip = blade(x, z, 0.65 + rng.float() * 0.35, 0.4 + rng.float() * 0.7, az, 0.01, 0.8, 2);
      for (let j = 0; j < 5; j++) {
        const t = 0.3 + j * 0.16;
        const p = [x + (tip[0] - x) * t, tip[1] * t, z + (tip[2] - z) * t];
        for (const sd of [1, -1]) strip(p, Math.cos(az + 1.3 * sd), 0.45, Math.sin(az + 1.3 * sd), 0.1, 0.028, 0.8 + 0.05 * j);
      }
      if (k % 3 === 0) head(tip, 0.04, 0.012, 1.1, 1.15, 3);
    }
  } else if (type === 'cotton') {
    // a bush: a reddish main stem and side branches, broad lobed leaves, bolls (green → burst white under the tint)
    const n0 = nv();
    const x0 = (rng.float() - 0.5) * 0.1, z0 = (rng.float() - 0.5) * 0.1;
    blade(x0, z0, 0.95, 0.05, rng.float() * 6.28, 0.024, 1.0, 3);
    mulCol(n0, [1.0, 0.72, 0.55]);
    const leafStart = nv();
    for (let k = 0; k < 7; k++) {
      const az = k * 2.4 + rng.float() * 0.5, y = 0.25 + k * 0.1, reach = 0.32 - k * 0.025;
      const ox = Math.cos(az), oz = Math.sin(az);
      strip([x0, y, z0], ox, 0.45, oz, reach, 0.006, 0.55);
      leaf(x0 + ox * reach * 0.35, y + 0.08 * reach, z0 + oz * reach * 0.35, az - 0.9, 0.11, 0.2, 0.78);
      leaf(x0 + ox * reach * 0.6, y + 0.12 * reach, z0 + oz * reach * 0.6, az + 0.6, 0.13, 0.2, 0.8);
      leaf(x0 + ox * reach * 0.95, y + 0.2 * reach, z0 + oz * reach * 0.95, az - 0.4, 0.13, 0.25, 0.85);
      // bolls on the outer ends (white = vertex 2.2-3.6 × the ripe tint; green under the young tint)
      ball(x0 + ox * reach * 1.05, y + 0.28 * reach, z0 + oz * reach * 1.05, 0.032, [2.3, 2.9, 3.5]);
      if (k % 2) ball(x0 + ox * reach * 0.7 + oz * 0.04, y + 0.2 * reach, z0 + oz * reach * 0.7 - ox * 0.04, 0.028, [2.3, 2.9, 3.5]);
    }
    for (let v = leafStart; v < nv(); v++) if (b.col[v * 3 + 2] < 2) { b.col[v * 3] *= 0.85; b.col[v * 3 + 1] *= 0.68; b.col[v * 3 + 2] *= 0.45; }
    leaf(x0, 0.97, z0, rng.float() * 6.28, 0.07, 0.3, 0.75);
  } else if (type === 'maize') {
    const x = (rng.float() - 0.5) * 0.15, z = (rng.float() - 0.5) * 0.15;
    blade(x, z, 1.0, 0.04, rng.float() * 6.28, 0.04, 0.9, 4);
    for (let k = 0; k < 7; k++) {
      const y0 = 0.15 + k * 0.11;
      const az = k * 2.4 + rng.float();
      const ox = Math.cos(az), oz = Math.sin(az);
      // a strap leaf arching out and down
      let pl = -1, pr = -1;
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        const cx = x + ox * t * 0.45, cz = z + oz * t * 0.45, y = y0 + 0.18 * t - 0.3 * t * t;
        const half = 0.035 * Math.sin(Math.PI * (0.1 + 0.8 * t));
        const L = b.vert(cx - oz * half, y, cz + ox * half, 0, 1, 0, 0.8, 0.3 + 0.7 * t, 0.5);
        const R = b.vert(cx + oz * half, y, cz - ox * half, 0, 1, 0, 0.8, 0.3 + 0.7 * t, 0.5);
        if (pl >= 0) b.idx.push(pl, pr, R, pl, R, L, pl, R, pr, pl, L, R);
        pl = L; pr = R;
      }
    }
    head([x, 1.0, z], 0.16, 0.02, 1.4, 1.3);
    head([x + 0.04, 0.55, z], 0.14, 0.035, 0.3, 1.25);
  } else if (type === 'rice') {
    for (let k = 0; k < 16; k++) {
      const a = rng.float() * 6.28, r = rng.float() * 0.08;
      const tip = blade(Math.cos(a) * r, Math.sin(a) * r, 0.75 + rng.float() * 0.25, 0.4 + rng.float() * 0.5, a, 0.018, 0.85);
      if (k % 3 === 0) head(tip, 0.12, 0.012, 1.0, 1.25);
    }
  } else {
    const flax = type === 'flax';
    // a dense stand (a dozen stems with fat pale ears read as sparse sticks over bare ground): two dozen stems spread
    // across the row so the rows close up, thin awned ears in the straw's own tone, and leaves low on the stems
    const nStem = flax ? 16 : 24;
    for (let k = 0; k < 5; k++) {
      const x = (rng.float() - 0.5) * 0.6, z = (rng.float() - 0.5) * 0.6;
      blade(x, z, 0.35 + rng.float() * 0.2, 0.9 + rng.float() * 0.5, rng.float() * 6.28, 0.03, 0.7, 2);
    }
    for (let k = 0; k < nStem; k++) {
      const x = (rng.float() - 0.5) * 0.9, z = (rng.float() - 0.5) * 0.9;
      const tip = blade(x, z, 0.8 + rng.float() * 0.2, 0.08 + rng.float() * 0.22, rng.float() * 6.28, flax ? 0.01 : 0.014, 0.85, 2);
      if (flax) {
        // small blue flowers (vertex colour; they keep their hue against the green tint)
        const fl = b.vert(tip[0], tip[1] + 0.02, tip[2], 0, 1, 0, 1, 1, 0.5);
        const pts = [0, 1, 2, 3, 4].map((i) => { const a = (i / 5) * Math.PI * 2; return b.vert(tip[0] + Math.cos(a) * 0.025, tip[1] + 0.01, tip[2] + Math.sin(a) * 0.025, 0, 1, 0, 1, 1, 0.5); });
        for (let i = 0; i < 5; i++) b.idx.push(fl, pts[(i + 1) % 5], pts[i]);
        const n0 = b.col.length / 3 - 6;
        for (let v = n0; v < n0 + 6; v++) { b.col[v * 3] = 0.25; b.col[v * 3 + 1] = 0.4; b.col[v * 3 + 2] = 1.6; }
      } else head(tip, 0.085, 0.011, 0.5 + rng.float() * 0.6, 1.05, 3);
    }
  }
  return b.build();
}

/** a clump of wildflowers: thin stems with coloured heads (variant = colour) */
export function flowerClump(variant: number): BufferGeometry {
  const rng = new Rng(9500 + variant * 41);
  const b = new Builder();
  const cols: [number, number, number][] = [[1.4, 1.3, 0.2], [1.5, 1.5, 1.45], [0.5, 0.45, 1.6], [1.6, 0.25, 0.2], [1.4, 0.55, 1.2]];
  const c = cols[variant % cols.length];
  const n = 7 + Math.floor(rng.float() * 5);
  for (let k = 0; k < n; k++) {
    const a = rng.float() * 6.28, r = rng.float() * 0.18;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.45 + rng.float() * 0.55;
    const s0 = b.vert(x - 0.006, 0, z, 0, 1, 0, 0.5, 0, 0.5), s1 = b.vert(x + 0.006, 0, z, 0, 1, 0, 0.5, 0, 0.5);
    const s2 = b.vert(x + 0.004, h, z, 0, 1, 0, 0.9, 1, 0.5), s3 = b.vert(x - 0.004, h, z, 0, 1, 0, 0.9, 1, 0.5);
    b.idx.push(s0, s1, s2, s0, s2, s3, s0, s2, s1, s0, s3, s2);
    // the head: a little star of petals (not foliage: aCard 0.2 keeps its colour against the green tint)
    const pc = b.vert(x, h + 0.01, z, 0, 1, 0, c[0] * 0.6, 1, 0.2);
    const petals = 6, rr = 0.03 + rng.float() * 0.02;
    const ring: number[] = [];
    for (let i = 0; i < petals; i++) {
      const pa = (i / petals) * Math.PI * 2 + k;
      ring.push(b.vert(x + Math.cos(pa) * rr, h, z + Math.sin(pa) * rr, Math.cos(pa) * 0.3, 1, Math.sin(pa) * 0.3, 1, 1, 0.2));
    }
    for (let i = 0; i < petals; i++) b.idx.push(pc, ring[(i + 1) % petals], ring[i], pc, ring[i], ring[(i + 1) % petals]);
    const base = b.col.length / 3 - petals - 1;
    for (let v = base; v < base + petals + 1; v++) { b.col[v * 3] = c[0] * 0.5; b.col[v * 3 + 1] = c[1] * 0.5; b.col[v * 3 + 2] = c[2] * 0.5; }
  }
  return b.build();
}

/**
 * A fallen branch or rotting log with a couple of broken stubs, half sunk in the litter (unit length): a round,
 * slightly irregular trunk (12 sides, bark ridges as a radius wobble), moss in patches on the upper side, and
 * square-cut end faces showing end grain (sapwood ring, growth rings, dark heart) with splintered rims.
 */
export function fallenLog(variant: number): BufferGeometry {
  const rng = new Rng(9700 + variant * 23);
  const b = new Builder();
  const r0 = 0.05 + rng.float() * 0.05;
  const sides = 12;
  const phase = rng.float() * 6.28;
  const BARK: [number, number, number] = [0.19, 0.14, 0.1], MOSS: [number, number, number] = [0.07, 0.1, 0.03];
  const tubeAt = (pts: [number, number, number][], radii: number[], shade: number, mossy: boolean): number[][] => {
    const rings: number[][] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const ring: number[] = [];
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const ny = Math.cos(a), nz = Math.sin(a);
        // bark ridges: a small wobble of the radius around and along the log
        const rr = radii[i] * (1 + 0.07 * Math.sin(a * 5 + phase + i * 0.7) + 0.04 * Math.sin(a * 11 + i * 2.1));
        // weathered grey-brown bark; moss in patches on the upper side (not a uniform green lid)
        const k = (shade / 0.55) * (0.78 + 0.22 * ny) * (0.92 + 0.16 * Math.sin(a * 7 + i * 1.3 + phase));
        const patch = 0.5 + 0.5 * Math.sin(i * 1.9 + a * 2.3 + phase * 2);
        const mossK = mossy ? Math.max(0, Math.min(1, (ny - 0.35) * 2.2)) * (0.35 + 0.65 * patch) : 0;
        const col: [number, number, number] = [(BARK[0] * (1 - mossK) + MOSS[0] * mossK) * k, (BARK[1] * (1 - mossK) + MOSS[1] * mossK) * k, (BARK[2] * (1 - mossK) + MOSS[2] * mossK) * k];
        ring.push(b.vert(p[0], p[1] + ny * rr, p[2] + nz * rr, 0, ny, nz, col, 0, 0));
      }
      rings.push(ring);
    }
    for (let i = 0; i < rings.length - 1; i++) for (let s = 0; s < sides; s++) b.idx.push(rings[i][s], rings[i + 1][s], rings[i + 1][s + 1], rings[i][s], rings[i + 1][s + 1], rings[i][s + 1]);
    return rings;
  };
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= 8; i++) pts.push([-0.5 + i * 0.125, r0 * 0.4 + Math.sin(i * 0.8) * 0.008, Math.sin(i * 0.55 + variant) * 0.035]);
  const radii = pts.map((_, i) => r0 * (1 - 0.4 * (i / 8) ** 1.5));
  tubeAt(pts, radii, 0.55, true);
  // both ends are cut across (sawn or snapped square, not sharpened): a flat face with end grain — a pale sapwood
  // ring, darker growth rings inside it, a dark heart — and a jagged rim of splinters. (The thin end was a cone that
  // ran out ahead of the log: a pencil point, seen from the walk eye)
  const endFace = (c: [number, number, number], rad: number, dir: number): void => {
    const nx = dir;
    const heart = b.vert(c[0] + dir * rad * 0.04, c[1], c[2], nx, 0, 0, [0.1, 0.065, 0.04], 0, 0);
    // rings: (fraction of the radius, colour) from the heart out to the bark
    const rings: [number, [number, number, number]][] = [[0.3, [0.2, 0.14, 0.09]], [0.55, [0.27, 0.2, 0.13]], [0.78, [0.22, 0.16, 0.1]], [0.97, [0.36, 0.29, 0.2]]];
    let prev: number[] | null = null;
    for (const [f, col] of rings) {
      const ring: number[] = [];
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        // the rim splinters (alternate verts stand proud); the inner rings lie flat
        const jag = f > 0.9 ? (s % 2 ? 0.05 : -0.025) * rad * dir : 0;
        const wob = 1 + 0.05 * Math.sin(a * 3 + phase + f * 5);
        ring.push(b.vert(c[0] + jag, c[1] + Math.cos(a) * rad * f * wob, c[2] + Math.sin(a) * rad * f * wob, nx, 0, 0, col, 0, 0));
      }
      if (!prev) { for (let s = 0; s < sides; s++) dir < 0 ? b.idx.push(heart, ring[s + 1], ring[s]) : b.idx.push(heart, ring[s], ring[s + 1]); }
      else for (let s = 0; s < sides; s++) dir < 0 ? b.idx.push(prev[s], prev[s + 1], ring[s + 1], prev[s], ring[s + 1], ring[s]) : b.idx.push(prev[s], ring[s + 1], prev[s + 1], prev[s], ring[s], ring[s + 1]);
      prev = ring;
    }
  };
  endFace(pts[0], radii[0], -1);
  endFace(pts[pts.length - 1], radii[radii.length - 1], 1);
  // broken branch stubs
  for (let k = 0; k < 2; k++) {
    const x = -0.2 + k * 0.35;
    tubeAt([[x, r0 * 0.8, 0], [x + 0.08, r0 + 0.12, 0.05 * (k ? 1 : -1)]], [r0 * 0.35, r0 * 0.18], 0.5, false);
  }
  return b.build();
}

/** a few mushrooms (autumn forest floor) */
export function mushrooms(variant: number): BufferGeometry {
  const rng = new Rng(9900 + variant * 31);
  const b = new Builder();
  // brown boletes, pale field mushrooms, red fly agarics
  const capCol: [number, number, number] = variant === 0 ? [0.3, 0.17, 0.08] : variant === 1 ? [0.62, 0.56, 0.46] : [0.5, 0.05, 0.02];
  const stemCol: [number, number, number] = [0.62, 0.58, 0.5];
  for (let k = 0; k < 4; k++) {
    const x = (rng.float() - 0.5) * 0.3, z = (rng.float() - 0.5) * 0.3, h = 0.05 + rng.float() * 0.07, r = 0.03 + rng.float() * 0.03;
    const stem = [b.vert(x - 0.008, 0, z, 0, 1, 0, stemCol, 0, 0), b.vert(x + 0.008, 0, z, 0, 1, 0, stemCol, 0, 0), b.vert(x + 0.008, h, z, 0, 1, 0, stemCol, 0, 0), b.vert(x - 0.008, h, z, 0, 1, 0, stemCol, 0, 0)];
    b.idx.push(stem[0], stem[1], stem[2], stem[0], stem[2], stem[3], stem[0], stem[2], stem[1], stem[0], stem[3], stem[2]);
    const top = b.vert(x, h + r * 0.6, z, 0, 1, 0, capCol, 0, 0);
    const ring: number[] = [];
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; ring.push(b.vert(x + Math.cos(a) * r, h, z + Math.sin(a) * r, Math.cos(a), 0.4, Math.sin(a), [capCol[0] * 0.8, capCol[1] * 0.8, capCol[2] * 0.8], 0, 0)); }
    for (let i = 0; i < 7; i++) b.idx.push(top, ring[(i + 1) % 7], ring[i]);
  }
  return b.build();
}
