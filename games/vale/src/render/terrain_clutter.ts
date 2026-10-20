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
