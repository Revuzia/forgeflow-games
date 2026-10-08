// GENESIS — procedural ground-cover meshes (CONTRACT.md §15.6 near-camera grass, plus stones): no assets, grown from
// code, deterministic per variant. Unit size; instances scale them.
//
//   grass tuft — nine to thirteen tapering, curving blades leaning out from a small clump; colour darkens toward the
//                base (the tuft's own occlusion); `aWind` rises with height so the tips sway, the base stays put
//   stone      — a jittered, flattened icosahedron with smooth normals: pebbles and fist-sized rocks
// The attribute layout matches the vegetation material (render/life/vegetation.ts): position, normal, color, aWind,
// aLeafUv (unused here), aCard (0.5 = solid foliage, 0 = bark / stone) and aCrown (crown depth: 1 = fully exposed).

import { BufferGeometry, Float32BufferAttribute } from 'three';
import { Rng } from '../../sim/core/rng.ts';

class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  wind: number[] = [];
  card: number[] = [];
  idx: number[] = [];
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: number, w: number, card: number): number {
    this.pos.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    this.nrm.push(nx / l, ny / l, nz / l);
    this.col.push(c, c, c);
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
  const flat = 0.45 + rng.float() * 0.25;
  const stretch = 0.8 + rng.float() * 0.5;
  const jit = verts.map(() => 0.78 + rng.float() * 0.4);
  const b = new Builder();
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    const r = jit[i];
    // flattened, stretched, sunk a little: the lower part sits in the ground
    const x = v[0] * r * stretch, y = v[1] * r * flat + 0.15 * flat, z = v[2] * r;
    b.vert(x, y, z, v[0] / stretch, v[1] / flat, v[2], 0.85 + 0.15 * v[1], 0, 0);
  }
  // (the icosahedron's faces wind counter-clockwise seen from outside, and the subdivision keeps that)
  for (const tri of tris) b.idx.push(tri[0], tri[1], tri[2]);
  return b.build();
}
