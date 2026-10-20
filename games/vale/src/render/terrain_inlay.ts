// VALE render — flush floor marks (lane TERRAIN): engraved and inlaid strokes baked into a distance
// field the ground shader thresholds per pixel (crisp at any zoom, no geometry, no per-pixel loops).
//
//   R  chalk inlay (pale): road hour-ticks, the deck's hour-script, FRAY hour-lines and numerals
//   G  carved groove (dark): Dialwood hour-line grooves, the Snap's crazing, the shadow tip
//   B  lit fracture (emissive ≤ 0.8): the Snap's crack
//   A  mid inlay (L* 40): FRAY's shop ring, Sunmote dishes
//
// Each texel stores the signed distance to the nearest capsule of its channel, (d + 0.15) / 0.6 → 0..1,
// so −0.15 m (deep inside a stroke) .. +0.45 m. All marks derive from the map JSON, deterministically.

import { DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from 'three';

export type V2 = readonly [number, number];
export const INLAY = { chalk: 0, groove: 1, lit: 2, mid: 3 } as const;

export interface Stroke { ax: number; ay: number; bx: number; by: number; w: number; ch: number }

export class StrokeSet {
  list: Stroke[] = [];
  seg(a: V2, b: V2, w: number, ch: number): void { this.list.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], w, ch }); }
  poly(pts: readonly V2[], w: number, ch: number, closed = false): void {
    for (let i = 1; i < pts.length; i++) this.seg(pts[i - 1], pts[i], w, ch);
    if (closed && pts.length > 2) this.seg(pts[pts.length - 1], pts[0], w, ch);
  }
  circle(c: V2, r: number, w: number, ch: number, segLen = 0.35): void {
    const n = Math.max(12, Math.ceil((Math.PI * 2 * r) / segLen));
    const pts: V2[] = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
    this.poly(pts, w, ch, true);
  }
}

const RANGE_LO = -0.15, RANGE = 0.6;

/** bake the strokes over the map rect at `texel` m; returns the texture and its uv scale (1 / extent) */
export function bakeInlay(set: StrokeSet, size: V2, texel = 0.125): { tex: DataTexture; scale: [number, number]; w: number; h: number } {
  const W = Math.ceil(size[0] / texel) + 1, H = Math.ceil(size[1] / texel) + 1;
  const d = new Float32Array(W * H * 4).fill(RANGE_LO + RANGE);
  const reach = RANGE_LO + RANGE;
  for (const s of set.list) {
    const r = s.w / 2;
    const x0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - r - reach) / texel));
    const x1 = Math.min(W - 1, Math.ceil((Math.max(s.ax, s.bx) + r + reach) / texel));
    const y0 = Math.max(0, Math.floor((Math.min(s.ay, s.by) - r - reach) / texel));
    const y1 = Math.min(H - 1, Math.ceil((Math.max(s.ay, s.by) + r + reach) / texel));
    const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy;
    for (let j = y0; j <= y1; j++) {
      const py = j * texel;
      for (let i = x0; i <= x1; i++) {
        const px = i * texel;
        let t = l2 > 0 ? ((px - s.ax) * dx + (py - s.ay) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = s.ax + t * dx - px, qy = s.ay + t * dy - py;
        const v = Math.sqrt(qx * qx + qy * qy) - r;
        const o = (j * W + i) * 4 + s.ch;
        if (v < d[o]) d[o] = v;
      }
    }
  }
  const bytes = new Uint8Array(W * H * 4);
  for (let k = 0; k < bytes.length; k++) bytes[k] = Math.max(0, Math.min(255, Math.round(((d[k] - RANGE_LO) / RANGE) * 255)));
  const tex = new DataTexture(bytes, W, H, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter; tex.minFilter = LinearFilter; tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, scale: [1 / (W * texel), 1 / (H * texel)], w: W, h: H };
}

// ── mark generators ──────────────────────────────────────────────────────────────────────────────

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

/** points every `step` m along a polyline, with the unit tangent */
export function along(path: readonly V2[], step: number, start = 0): { p: V2; t: V2; s: number }[] {
  const out: { p: V2; t: V2; s: number }[] = [];
  let acc = 0;
  let next = start;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    if (l < 1e-6) continue;
    while (next <= acc + l) {
      const f = (next - acc) / l;
      out.push({ p: [a[0] + dx * f, a[1] + dy * f], t: [dx / l, dy / l], s: next });
      next += step;
    }
    acc += l;
  }
  return out;
}

/** hour-ticks across a road's two inscription bands (every `every` m), short chalk bars */
export function roadTicks(set: StrokeSet, path: readonly V2[], half: number, band: number, every: number, keep: (x: number, y: number) => boolean): void {
  for (const { p, t } of along(path, every, every * 0.5)) {
    const nx = -t[1], ny = t[0];
    for (const side of [-1, 1]) {
      const c0: V2 = [p[0] + nx * side * (half - band + 0.04), p[1] + ny * side * (half - band + 0.04)];
      const c1: V2 = [p[0] + nx * side * (half - 0.04), p[1] + ny * side * (half - 0.04)];
      if (!keep((c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2)) continue;
      set.seg(c0, c1, 0.07, INLAY.chalk);
    }
  }
}

/** a band of carved hour-script along an edge path (glyph-like stroke groups), dark grooves in a chalk band */
export function hourScript(set: StrokeSet, path: readonly V2[], inward: (p: V2, t: V2) => V2, width: number, seed: number, keep: (x: number, y: number) => boolean): void {
  const rnd = mulberry(seed);
  const pitch = width * 0.95;
  for (const { p, t } of along(path, pitch, pitch * 0.5)) {
    if (!keep(p[0], p[1])) continue;
    const n = inward(p, t);
    const c: V2 = [p[0] + n[0] * width * 0.5, p[1] + n[1] * width * 0.5];
    const g = width * 0.32;
    const kind = Math.floor(rnd() * 6);
    const P = (u: number, v: number): V2 => [c[0] + t[0] * u * g + n[0] * v * g, c[1] + t[1] * u * g + n[1] * v * g];
    const w = 0.035;
    if (kind === 0) { set.seg(P(-0.5, -1), P(-0.5, 1), w, INLAY.groove); set.seg(P(0.5, -1), P(0.5, 1), w, INLAY.groove); }
    else if (kind === 1) { set.seg(P(-0.7, -1), P(0, 1), w, INLAY.groove); set.seg(P(0, 1), P(0.7, -1), w, INLAY.groove); }
    else if (kind === 2) { set.seg(P(-0.7, -1), P(0.7, 1), w, INLAY.groove); set.seg(P(-0.7, 1), P(0.7, -1), w, INLAY.groove); }
    else if (kind === 3) { set.seg(P(0, -1), P(0, 1), w, INLAY.groove); set.seg(P(-0.6, 0), P(0.6, 0), w, INLAY.groove); }
    else if (kind === 4) { set.seg(P(-0.6, -1), P(-0.6, 1), w, INLAY.groove); set.seg(P(-0.6, 0), P(0.6, 1), w, INLAY.groove); set.seg(P(-0.6, 0), P(0.6, -1), w, INLAY.groove); }
    else { set.seg(P(0, -1), P(0, 1), w, INLAY.groove); }
  }
}

/** roman numeral strokes (I, V, X), upright for the fixed camera (screen-up = −y), glyph height `h` */
export function numeral(set: StrokeSet, c: V2, n: number, h: number, w: number, ch: number): void {
  const glyphs: string[] = [];
  const table: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let v = n;
  for (const [k, s] of table) while (v >= k) { glyphs.push(...s.split('')); v -= k; }
  const gw = (g: string): number => (g === 'I' ? 0.22 : 0.62) * h;
  const gap = 0.12 * h;
  const total = glyphs.reduce((s, g) => s + gw(g), 0) + gap * (glyphs.length - 1);
  let x = c[0] - total / 2;
  const top = c[1] - h / 2, bot = c[1] + h / 2;
  for (const g of glyphs) {
    const W = gw(g);
    if (g === 'I') set.seg([x + W / 2, top], [x + W / 2, bot], w, ch);
    else if (g === 'V') { set.seg([x, top], [x + W / 2, bot], w, ch); set.seg([x + W / 2, bot], [x + W, top], w, ch); }
    else { set.seg([x, top], [x + W, bot], w, ch); set.seg([x + W, top], [x, bot], w, ch); }
    // serifs (dial-maker's cut)
    if (g === 'I') { set.seg([x - 0.04 * h, top], [x + W + 0.04 * h, top], w * 0.8, ch); set.seg([x - 0.04 * h, bot], [x + W + 0.04 * h, bot], w * 0.8, ch); }
    x += W + gap;
  }
}

/** a jagged fracture from a to b (midpoint displacement), returned as a polyline */
export function fracture(a: V2, b: V2, rough: number, depth: number, rnd: () => number): V2[] {
  let pts: V2[] = [a, b];
  let amp = rough;
  for (let k = 0; k < depth; k++) {
    const nx: V2[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
      const off = (rnd() - 0.5) * 2 * amp;
      nx.push([(p[0] + q[0]) / 2 - (dy / l) * off, (p[1] + q[1]) / 2 + (dx / l) * off], q);
    }
    pts = nx;
    amp *= 0.55;
  }
  return pts;
}

export { mulberry };
