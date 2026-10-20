// GENESIS — the Touch's form (LIVING §0.1.7, §3.6, hook H7; CONTRACT §11.4, §15.6). The god's hand of the old design
// is gone: its presence in the world is light and weather, drawn by render/hand.ts. This module is the Touch's
// generator — everything about its SHAPE that is not a shader: the geometry its parts are drawn with, its palette by
// regard, the cradle it gathers round what it holds, the CPU twin of the vortex the vertex shaders place, and the
// jagged arcs of a feared god's crackling. Pure data and arithmetic (three.js geometry objects only): testable in Node.
//
//   the vortex     a whirl of wind round a vertical axis from the ground up past the grip: wide at the ground (the dust
//                  it draws up), narrow at the grip, flaring out above it into the light coming down
//   the mantle     tufts of cloud riding the vortex up (open), or GATHERED into a closed, turning cradle round whatever
//                  the Touch holds (grasp): three bands of cloud circling it — under it, round its middle, over it —
//                  with gaps between, so what it holds shows; the low tufts come in last, so it visibly gathers; the
//                  crown is left open where the light comes in. Nothing of it is a hand: no palm, no fingers, no limb.
//   the bands      ribbons of wind spiralling up the vortex; while it holds, six of them wrap round the cradle (wind
//                  bound round the held thing) and three stay below as the column's tether to the ground
//   regard         −1 feared … +1 trusted (HandView.regard): warm daylight and still air when trusted, a pale silver-
//                  gold when awed, storm-dark cloud with a cold light and crackling arcs when feared

import { BufferAttribute, BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry } from 'three';

// ───────────────────────────── palette by regard ─────────────────────────────

export interface TouchLook {
  /** the Touch's own light (linear RGB): warm gold trusted … pale silver-gold awed … a cold blue-white when feared */
  light: [number, number, number];
  /** a feared god's cold light: the flicker inside its storm, the arcs */
  rim: [number, number, number];
  /** 0 light … 1 storm-dark */
  dark: number;
  /** 0..1 how trusted / how feared (smooth bands round regard ±0.08 … ±0.75) */
  trusted: number;
  feared: number;
  /** the albedo of its cloud: sunlit white when trusted, slate when feared */
  cloud: number;
  /** how often its storm crackles (arcs per second) */
  crackle: number;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** the Touch's look for a regard in −1 (feared) … +1 (trusted) */
export function touchLook(regard: number): TouchLook {
  const r = Math.max(-1, Math.min(1, Number.isFinite(regard) ? regard : 0));
  const trusted = smooth(0.08, 0.75, r), feared = smooth(0.08, 0.75, -r);
  // pale silver-gold (awed) → warm daylight gold (trusted); feared keeps a cold light in its core. (Saturated: the tone
  // curve and the sunlit sky round it pale the gold, and a paler one read on screen as a white dust devil.)
  let lr = 1.0, lg = 0.93 - 0.37 * trusted, lb = 0.82 - 0.65 * trusted;
  lr += (0.62 - lr) * feared; lg += (0.74 - lg) * feared; lb += (1.0 - lb) * feared;
  return {
    light: [lr, lg, lb], rim: [0.5, 0.68, 1.0], dark: 0.92 * feared, trusted, feared,
    cloud: 0.86 - 0.74 * feared + 0.06 * trusted,
    // (arcs a second or so apart: a storm that crackles now and then, dark between — lit half the time it read pale)
    crackle: feared > 0.3 ? 0.4 + 1.2 * (feared - 0.3) / 0.7 : 0,
  };
}

// ───────────────────────────── the vortex and the cradle (CPU twin of the shaders) ─────────────────────────────

/** the frame the vortex is placed in (body frame, metres) */
export interface VortexFrame {
  /** the vortex's foot on the ground, its axis (unit) and a tangent pair */
  base: [number, number, number];
  ax: [number, number, number];
  e1: [number, number, number];
  e2: [number, number, number];
  /** the grip's height over the foot; the Touch's size; radius at the ground and at the grip */
  hg: number;
  L: number;
  rg: number;
  rk: number;
  /** spin phase (rad) and the flow's phase (rising) */
  spin: number;
  flow: number;
  /** 0 open … 1 holding: how far the mantle has gathered into the cradle */
  grasp: number;
  /** the cradle: its centre (body m), horizontal and vertical radii */
  c: [number, number, number];
  cr: number;
  ch: number;
}

/** the vortex's radius at height h over its foot (j: a per-strand jitter 0..1) — VORTEX_GLSL vortexR */
export function vortexR(f: VortexFrame, h: number, j: number): number {
  const h0 = f.hg + f.L * 0.75;
  const tg = Math.min(1, Math.max(0, h / Math.max(f.hg, 1e-3)));
  const s = smooth(0, 1, Math.pow(tg, 0.7));
  const r = (f.rg + (f.rk - f.rg) * s) * (0.8 + 0.4 * j);
  return r * (1 + 0.55 * smooth(f.hg, h0, h));
}

function at(f: VortexFrame, h: number, r: number, th: number, out: number[]): void {
  const c = Math.cos(th), s = Math.sin(th);
  for (let i = 0; i < 3; i++) out[i] = f.base[i] + f.ax[i] * h + (f.e1[i] * c + f.e2[i] * s) * r;
}

/** how far a tuft (seed b: low 0 … high 1) has gathered into the cradle at grasp g — the low ones come in last */
export function gathered(g: number, b: number): number {
  return smooth(0.42 * (1 - b), 0.42 * (1 - b) + 0.58, g);
}

/**
 * One cloud tuft of the mantle (seeds a, b, c, d in 0..1): its body-frame position into `out` and its opacity
 * envelope (0..1). Open, it rides the vortex up and fades at both ends of its climb; gathered, it turns on the cradle's
 * shell, leaving the crown open. The vertex shader TUFT_VERT places the same point.
 */
export function mantlePoint(f: VortexFrame, a: number, b: number, c: number, d: number, out: number[]): number {
  // open: up the vortex
  const life = 5 + 4 * d;
  const ph = ((f.flow * 0.3) / life + a) % 1;
  const phase = ph < 0 ? ph + 1 : ph;
  const h = phase * (f.hg + 0.9 * f.L);
  const r = vortexR(f, h, c) * (0.75 + 0.5 * c);
  const th = a * Math.PI * 2 + f.spin * (0.55 + 0.3 * b) + phase * 2.4;
  const po = [0, 0, 0];
  at(f, h, r, th, po);
  const fadeOpen = Math.sin(Math.PI * phase);
  // gathered: on the cradle's shell, in three tilted bands of wind circling what it holds (below it, round its middle,
  // over it — gaps between them, so what it holds shows through; the crown left open)
  const th2 = a * Math.PI * 2 + f.spin * (1.1 + 0.5 * c);
  const sl = cradleLat(b, th2, f.spin);
  const cl = Math.sqrt(Math.max(0, 1 - sl * sl));
  const rr = 0.82 + 0.36 * c;
  const pg = [0, 0, 0];
  const cs = Math.cos(th2), sn = Math.sin(th2);
  for (let i = 0; i < 3; i++) pg[i] = f.c[i] + f.ax[i] * sl * f.ch * rr + (f.e1[i] * cs + f.e2[i] * sn) * cl * f.cr * rr;
  const g = gathered(f.grasp, b);
  for (let i = 0; i < 3; i++) out[i] = po[i] + (pg[i] - po[i]) * g;
  return fadeOpen + (CRADLE_ALPHA - fadeOpen) * g;
}

/** how dense a gathered tuft is drawn (the cradle is lighter than the whirl's billows: what it holds shows through) */
export const CRADLE_ALPHA = 0.62;

/**
 * The sine of latitude on the cradle of a gathered tuft with seed b at azimuth th: one of three bands of wind (below
 * what it holds, round its middle, over it), each a ring tilted its own way and slowly precessing with the spin, so
 * the bands cross and weave a loose basket of wind rather than stacking as plates; a little spread within each.
 */
export function cradleLat(b: number, th: number, spin: number): number {
  const band = Math.min(2, Math.floor(b * 3));
  const tilt = band === 1 ? 0.3 : 0.18;
  return [-0.6, 0.0, 0.45][band] + tilt * Math.sin(th + band * 2.094 - spin * 0.21) + ((b * 3 - band) - 0.5) * 0.16;
}

/**
 * The cradle the mantle gathers into round what the Touch holds: its horizontal and vertical radii (m) and how far
 * its centre hangs below the grip (m). `drawn` is the held thing's drawn size (m: a person's height, a boulder's
 * width, a tree's height, a hut's width); L the Touch's size.
 */
export function cradleOf(kind: string, drawn: number, L: number): { r: number; h: number; drop: number } {
  switch (kind) {
    // a person hangs from the grip (their body below it): the cradle round their middle
    case 'agent': return { r: 0.9 + 0.12 * L, h: 1.25 + 0.08 * L, drop: 0.85 };
    case 'tree': return { r: 0.42 * drawn + 0.1 * L, h: 0.62 * drawn, drop: 0 };
    case 'building': return { r: 0.78 * drawn, h: 0.62 * drawn + 0.1 * L, drop: 0 };
    case 'animal': return { r: 0.7 * drawn + 0.1 * L, h: 0.6 * drawn + 0.08 * L, drop: 0.3 * drawn };
    default: return { r: 0.72 * drawn + 0.1 * L, h: 0.72 * drawn + 0.1 * L, drop: 0 };
  }
}

// ───────────────────────────── crackling (feared) ─────────────────────────────

/**
 * A jagged arc from p to q (body m) by midpoint displacement: 2^depth + 1 points, displacement `amp` (m) halving with
 * each level, with `rnd` a source of uniform numbers in 0..1. Returned as a flat xyz array.
 */
export function crackleArc(p: ArrayLike<number>, q: ArrayLike<number>, amp: number, depth: number, rnd: () => number): Float32Array {
  let pts: number[][] = [[p[0], p[1], p[2]], [q[0], q[1], q[2]]];
  let s = amp;
  for (let k = 0; k < depth; k++) {
    const next: number[][] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const dl2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
      const r = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
      const rd = (r[0] * d[0] + r[1] * d[1] + r[2] * d[2]) / dl2;
      for (let j = 0; j < 3; j++) r[j] -= d[j] * rd;
      const rl = Math.hypot(r[0], r[1], r[2]) || 1;
      const m = (rnd() * 2 - 1) * s;
      next.push([(a[0] + b[0]) / 2 + (r[0] / rl) * m, (a[1] + b[1]) / 2 + (r[1] / rl) * m, (a[2] + b[2]) / 2 + (r[2] / rl) * m], b);
    }
    pts = next;
    s *= 0.55;
  }
  return new Float32Array(pts.flat());
}

// ───────────────────────────── geometry ─────────────────────────────

/** samples down the shaft, wind bands and samples along each, motes, cloud tufts, glyph / trail samples, arc samples */
export const TOUCH_N = { column: 72, ribs: 9, rib: 44, motes: 420, tufts: 84, glyph: 96, trail: 64, arcs: 3, arc: 33 } as const;

/**
 * `strips` camera-facing strips of `n` samples each: attributes aT (0..1 along), aSide (±1 across) and a placeholder
 * position (the vertex shader or the CPU places them).
 */
export function stripGeometry(n: number, strips = 1): BufferGeometry {
  const g = new BufferGeometry();
  const t = new Float32Array(n * 2 * strips), side = new Float32Array(n * 2 * strips), strip = new Float32Array(n * 2 * strips);
  const idx: number[] = [];
  for (let s = 0; s < strips; s++) for (let i = 0; i < n; i++) {
    const k = (s * n + i) * 2;
    t[k] = t[k + 1] = i / (n - 1); side[k] = 1; side[k + 1] = -1; strip[k] = strip[k + 1] = s;
    if (i < n - 1) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  g.setAttribute('position', new BufferAttribute(new Float32Array(n * 2 * strips * 3), 3));
  g.setAttribute('aT', new BufferAttribute(t, 1));
  g.setAttribute('aSide', new BufferAttribute(side, 1));
  g.setAttribute('aStrip', new BufferAttribute(strip, 1));
  g.setIndex(idx);
  return g;
}

/** the wind bands: `ribs` ribbons of `n` samples (aRib, aS along 0..1, aSide ±1); positions from the frame uniforms */
export function bandGeometry(ribs: number = TOUCH_N.ribs, n: number = TOUCH_N.rib): BufferGeometry {
  const g = new BufferGeometry();
  const m = ribs * n * 2;
  const rib = new Float32Array(m), s = new Float32Array(m), side = new Float32Array(m);
  const idx: number[] = [];
  for (let r = 0; r < ribs; r++) for (let i = 0; i < n; i++) {
    const k = (r * n + i) * 2;
    rib[k] = rib[k + 1] = r; s[k] = s[k + 1] = i / (n - 1); side[k] = 1; side[k + 1] = -1;
    if (i < n - 1) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  // (positions come from the frame uniforms: the attribute is a placeholder three needs for the draw count)
  g.setAttribute('position', new BufferAttribute(new Float32Array(m * 3), 3));
  g.setAttribute('aRib', new BufferAttribute(rib, 1));
  g.setAttribute('aS', new BufferAttribute(s, 1));
  g.setAttribute('aSide', new BufferAttribute(side, 1));
  g.setIndex(idx);
  return g;
}

/** a unit disc in the xz plane (rings × segments), for the whorl in the cloud deck */
export function discGeometry(rings: number, segs: number): BufferGeometry {
  const pos: number[] = [0, 0, 0], idx: number[] = [];
  for (let r = 1; r <= rings; r++) for (let s = 0; s < segs; s++) {
    const a = (s / segs) * Math.PI * 2, rr = r / rings;
    pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr);
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + s, 1 + ((s + 1) % segs));
  for (let r = 1; r < rings; r++) for (let s = 0; s < segs; s++) {
    const a = 1 + (r - 1) * segs + s, b = 1 + (r - 1) * segs + ((s + 1) % segs);
    idx.push(a, a + segs, b, b, a + segs, b + segs);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}

/** one camera-facing quad (attribute corner ±1) */
export function quadGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('corner', new Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
  g.setAttribute('position', new Float32BufferAttribute(new Float32Array(12), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** a small deterministic generator (render-side variation only) */
export function touchRng(seed: number): () => number {
  let h = seed >>> 0 || 0x2545f491;
  return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
}

/**
 * Instanced quads with a seed per instance (iSeed: a, b, c, kind/size). `kinds(i)` gives the 4th seed component; the
 * others are uniform in 0..1 from a fixed generator, so the Touch looks the same every time it appears.
 */
export function seededQuads(n: number, seed: number, kinds: (i: number, rnd: () => number) => number): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute('corner', new Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const rnd = touchRng(seed);
  const s = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { s[i * 4] = rnd(); s[i * 4 + 1] = rnd(); s[i * 4 + 2] = rnd(); s[i * 4 + 3] = kinds(i, rnd); }
  g.setAttribute('iSeed', new InstancedBufferAttribute(s, 4));
  g.instanceCount = n;
  return g;
}

/** the motes drawn up into the vortex: a third points of light (kind 0), half dust (1), the rest leaves (2) */
export function moteGeometry(n: number = TOUCH_N.motes): InstancedBufferGeometry {
  return seededQuads(n, 0x2545f491, (i) => (i % 6 < 2 ? 0 : i % 6 < 5 ? 1 : 2));
}

/** the mantle's cloud tufts (4th seed: d, a size / life variation) */
export function tuftGeometry(n: number = TOUCH_N.tufts): InstancedBufferGeometry {
  return seededQuads(n, 0x51ed270b, (_i, rnd) => rnd());
}
