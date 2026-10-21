// VALE render — ground clutter (lane TERRAIN): small SOLID instanced pieces that give the Dialwood floor
// life at the gameplay camera. No alpha cards: moss cushions are squashed domes, leaves are flat leaf
// polygons with a fold, pebbles are chiselled icosahedra, wall-foot tufts are short solid blades.
// All vertex-coloured (the instance colour varies hue and value), real size, origin at the ground.

import { BufferAttribute, BufferGeometry, Color, IcosahedronGeometry } from 'three';

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function colorize(g: BufferGeometry, f: (x: number, y: number, z: number) => [number, number, number]): void {
  const p = g.getAttribute('position') as BufferAttribute;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const v = f(p.getX(i), p.getY(i), p.getZ(i)); c[i * 3] = v[0]; c[i * 3 + 1] = v[1]; c[i * 3 + 2] = v[2]; }
  g.setAttribute('color', new BufferAttribute(c, 3));
}

/** normals bent toward up (ground clutter shades like the ground it sits on, never like faceted balls) */
function bendUp(g: BufferGeometry, k: number): void {
  const n = g.getAttribute('normal') as BufferAttribute;
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i) * (1 - k), y = n.getY(i) * (1 - k) + k, z = n.getZ(i) * (1 - k);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(i, x / l, y / l, z / l);
  }
}

/** a moss cushion: 3 low hexagonal domes (18 tris each), dark at the root, light olive on top; ~1 m across at scale 1 */
export function mossTuft(deep: Color, tip: Color): BufferGeometry {
  const rnd = mulberry(91);
  const pos: number[] = [];
  for (let k = 0; k < 3; k++) {
    const r = k === 0 ? 0.5 : 0.26 + rnd() * 0.14;
    const ox = k === 0 ? 0 : (rnd() - 0.5) * 0.75, oz = k === 0 ? 0 : (rnd() - 0.5) * 0.75;
    const hgt = r * (0.42 + rnd() * 0.12);
    const top = [ox, hgt, oz];
    const mid: number[][] = [], base: number[][] = [];
    const a0 = rnd() * 6.283;
    for (let i = 0; i < 6; i++) {
      const a = a0 + (i / 6) * Math.PI * 2;
      const j = 0.85 + rnd() * 0.3;
      mid.push([ox + Math.cos(a + 0.26) * r * 0.62 * j, hgt * (0.72 + rnd() * 0.12), oz + Math.sin(a + 0.26) * r * 0.62 * j]);
      base.push([ox + Math.cos(a) * r * j, -0.01, oz + Math.sin(a) * r * j]);
    }
    for (let i = 0; i < 6; i++) {
      const i1 = (i + 1) % 6;
      pos.push(...top, ...mid[i1], ...mid[i]);
      pos.push(...mid[i], ...mid[i1], ...base[i1], ...mid[i], ...base[i1], ...base[i]);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  bendUp(g, 0.4);
  colorize(g, (_x, y) => {
    const t = Math.min(1, Math.max(0, (y + 0.01) / 0.2));
    return [deep.r + (tip.r - deep.r) * t, deep.g + (tip.g - deep.g) * t, deep.b + (tip.b - deep.b) * t];
  });
  return g;
}

/** a fallen fan leaf: a flat wedge fan (7-vertex fan fold), ~1 m long at scale 1 (instances scale it to 9-15 cm) */
export function fanLeaf(col: Color): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const colr: number[] = [];
  const R = 0.5;
  const steps = 5;
  const half = 0.95;
  const base: [number, number, number] = [-0.42, 0.0, 0];
  for (let k = 0; k < steps; k++) {
    const a0 = -half + (2 * half * k) / steps, a1 = -half + (2 * half * (k + 1)) / steps;
    const notch = (a: number): number => 1 - 0.18 * Math.exp(-((a / 0.14) ** 2));
    const p0: [number, number, number] = [base[0] + Math.cos(a0) * R * 2 * notch(a0), 0.02 + 0.05 * Math.abs(Math.sin(a0 * 2)), Math.sin(a0) * R * 2 * notch(a0)];
    const p1: [number, number, number] = [base[0] + Math.cos(a1) * R * 2 * notch(a1), 0.02 + 0.05 * Math.abs(Math.sin(a1 * 2)), Math.sin(a1) * R * 2 * notch(a1)];
    for (const [v, shade] of [[base, 0.8], [p0, 1.0], [p1, 1.0]] as [[number, number, number], number][]) {
      pos.push(v[0], v[1], v[2]);
      nor.push(0, 1, 0);
      const s = shade * (0.94 + 0.06 * Math.cos(k * 1.7));
      colr.push(col.r * s, col.g * s, col.b * s);
    }
  }
  // the petiole: a thin sliver behind the fan
  pos.push(base[0], 0.01, -0.03, base[0] - 0.3, 0.01, 0, base[0], 0.01, 0.03);
  nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  for (let i = 0; i < 3; i++) colr.push(col.r * 0.6, col.g * 0.6, col.b * 0.6);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colr), 3));
  return g;
}

/** a pebble: chiselled, flat-bottomed, lighter on top; 1 m at scale 1 */
export function pebble(col: Color): BufferGeometry {
  const g = new IcosahedronGeometry(0.5, 0);
  const p = g.getAttribute('position') as BufferAttribute;
  const rnd = mulberry(17);
  for (let i = 0; i < p.count; i++) {
    const k = 0.8 + rnd() * 0.35;
    p.setXYZ(i, p.getX(i) * k * 1.15, Math.max(-0.05, p.getY(i) * k * 0.6), p.getZ(i) * k);
  }
  const n = g.toNonIndexed();
  g.dispose();
  n.deleteAttribute('uv');
  n.computeVertexNormals();
  bendUp(n, 0.2);
  colorize(n, (_x, y) => { const s = 0.72 + 0.5 * Math.min(1, Math.max(0, (y + 0.05) / 0.35)); return [col.r * s, col.g * s, col.b * s]; });
  return n;
}

/** a short tuft of solid blades (wall feet, verges), ~1 m tall at scale 1 */
export function bladeTuft(root: Color, tip: Color): BufferGeometry {
  const rnd = mulberry(29);
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  for (let b = 0; b < 6; b++) {
    const a = (b / 6) * Math.PI * 2 + rnd() * 0.8;
    const r0 = 0.04 + rnd() * 0.14;
    const bx = Math.cos(a) * r0, bz = Math.sin(a) * r0;
    const h = 0.6 + rnd() * 0.4;
    const lean = 0.25 + rnd() * 0.35;
    const w = 0.07 + rnd() * 0.03;
    const dx = Math.cos(a), dz = Math.sin(a);
    const px = -dz, pz = dx;
    const tipP = [bx + dx * lean * h, h, bz + dz * lean * h];
    const midP = [bx + dx * lean * h * 0.35, h * 0.55, bz + dz * lean * h * 0.35];
    const L = [bx - px * w, 0, bz - pz * w], R = [bx + px * w, 0, bz + pz * w];
    const ML = [midP[0] - px * w * 0.6, midP[1], midP[2] - pz * w * 0.6], MR = [midP[0] + px * w * 0.6, midP[1], midP[2] + pz * w * 0.6];
    const tris = [L, R, MR, L, MR, ML, ML, MR, tipP];
    const ts = [0, 0, 0.55, 0, 0.55, 0.55, 0.55, 0.55, 1];
    for (let k = 0; k < tris.length; k++) {
      pos.push(tris[k][0], tris[k][1], tris[k][2]);
      const t = Math.pow(ts[k], 0.8);
      col.push(root.r + (tip.r - root.r) * t, root.g + (tip.g - root.g) * t, root.b + (tip.b - root.b) * t);
      const nx = dx * 0.4, ny = 0.85, nz = dz * 0.4;
      const l = Math.hypot(nx, ny, nz);
      nor.push(nx / l, ny / l, nz / l);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  return g;
}

/** a gorge spire: a tall chiselled rock pillar (prism with a broken top), 1 m wide, 1 m tall at scale 1 */
/** a rock stack standing in the gorge, in world metres, appended to (pos, idx): bedded drums of rock (1.2-2.6 m
 *  beds near the top, coarser with depth), each bed its own irregular 11-gon, a notch or a ledge between beds,
 *  the stack flaring toward its foot, a domed cap. Smooth round the circumference, crisp at every bed joint
 *  (each strip owns its vertices), so it reads as a weathered column, never a faceted prism. */
export function rockStack(pos: number[], idx: number[], cx: number, cz: number, top: number, bottom: number, w: number, seed: number): void {
  const rnd = mulberry(seed);
  const S = 11;
  const ring = (y: number, r: number, prof: number[], rot: number, dx: number, dz: number): number => {
    const base = pos.length / 3;
    for (let s = 0; s < S; s++) {
      const a = rot + (s / S) * Math.PI * 2;
      pos.push(cx + dx + Math.cos(a) * r * prof[s], y, cz + dz + Math.sin(a) * r * prof[s]);
    }
    return base;
  };
  const strip = (r0: number, r1: number): void => {
    for (let s = 0; s < S; s++) {
      const a = r0 + s, b = r0 + ((s + 1) % S), c = r1 + ((s + 1) % S), d = r1 + s;
      idx.push(a, b, c, a, c, d);
    }
  };
  const profile = (): number[] => {
    const p: number[] = [];
    for (let s = 0; s < S; s++) p.push(0.78 + rnd() * 0.42);
    // smooth the outline a little (a boulder's round, not a star)
    return p.map((v, s) => (v * 2 + p[(s + 1) % S] + p[(s + S - 1) % S]) / 4);
  };
  let y = top;
  let prev = -1;
  let rot = rnd() * 6.283;
  let dx = 0, dz = 0;
  let k = 0;
  while (y > bottom) {
    const depthT = Math.min(1, (top - y) / 22);
    const bed = (1.2 + rnd() * 1.4) * (1 + depthT * 1.6);
    const r = w * 0.5 * (1 + depthT * 0.35) * (0.88 + rnd() * 0.24);
    const prof = profile();
    rot += (rnd() - 0.5) * 0.5;
    dx += (rnd() - 0.5) * 0.18 * w; dz += (rnd() - 0.5) * 0.18 * w;
    const taper = 0.9 + rnd() * 0.12;                // a bed narrows a touch toward its top
    const t0 = ring(y, r * taper, prof, rot, dx, dz);
    const t1 = ring(y - bed, r, prof, rot, dx, dz);
    if (prev < 0) {
      // the cap: a low dome over the top bed
      const c = pos.length / 3;
      pos.push(cx + dx + (rnd() - 0.5) * 0.3 * w, y + 0.05 * w + rnd() * 0.06 * w, cz + dz + (rnd() - 0.5) * 0.3 * w);
      const cr = ring(y + 0.04 * w, r * taper * 0.72, prof, rot, dx, dz);
      for (let s = 0; s < S; s++) idx.push(c, cr + ((s + 1) % S), cr + s);
      // the cap's rim rolls over onto the bed's face (its own strip: a crisp edge)
      const rr = ring(y + 0.04 * w, r * taper * 0.72, prof, rot, dx, dz);
      const rt = ring(y, r * taper, prof, rot, dx, dz);
      strip(rr, rt);
    } else {
      // the joint between beds: a ledge (this bed wider) or a notch (narrower), its own strip
      const j = ring(y, r * taper, prof, rot, dx, dz);
      strip(prev, j);
    }
    strip(t0, t1);
    // the bed's foot ring again as the start of the next joint strip (own vertices: a crisp joint)
    prev = ring(y - bed, r, prof, rot, dx, dz);
    y -= bed;
    k++;
    if (k > 60) break;
  }
}

export function spire(seed: number): BufferGeometry {
  const rnd = mulberry(seed);
  const sides = 6;
  const rings = 5;
  const pos: number[] = [];
  const ring: number[][][] = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const rad = 0.5 * (1 - t * 0.45) * (0.85 + rnd() * 0.3);
    const ox = (rnd() - 0.5) * 0.12, oz = (rnd() - 0.5) * 0.12;
    const row: number[][] = [];
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2 + rnd() * 0.25;
      const top = r === rings ? (rnd() - 0.5) * 0.12 : 0;
      row.push([ox + Math.cos(a) * rad, t + top, oz + Math.sin(a) * rad]);
    }
    ring.push(row);
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < sides; s++) {
    const a = ring[r][s], b = ring[r][(s + 1) % sides], c = ring[r + 1][(s + 1) % sides], d = ring[r + 1][s];
    pos.push(...a, ...c, ...b, ...a, ...d, ...c);
  }
  const top = ring[rings];
  const cx = top.reduce((s, v) => s + v[0], 0) / sides, cz = top.reduce((s, v) => s + v[2], 0) / sides, cy = top.reduce((s, v) => s + v[1], 0) / sides + 0.04;
  for (let s = 0; s < sides; s++) pos.push(...top[s], cx, cy, cz, ...top[(s + 1) % sides]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}
