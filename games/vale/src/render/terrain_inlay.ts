// VALE render — flush floor marks (lane TERRAIN): engraved and inlaid strokes baked into a distance
// field the ground shader thresholds per pixel (crisp at any zoom, no geometry, no per-pixel loops).
//
//   R  chalk inlay (pale): road hour-ticks, the deck's hour-script, FRAY hour-lines and numerals
//   G  carved groove (dark): Dialwood hour-line grooves, the Snap's crazing, the shadow tip
//   B  lit fracture (emissive ≤ 0.8): the Snap's crack
//   A  mid inlay (a value between the floor and the dark inlays): FRAY's shop ring, Sunmote dishes
//
// Each texel stores the signed distance to the nearest capsule of its channel, (d + 0.15) / 0.6 → 0..1,
// so −0.15 m (deep inside a stroke) .. +0.45 m. A coarse field covers the map; every 2 m cell a thin stroke
// touches also gets a fine tile (1/32 m) in a sparse atlas, so 3-9 cm cracks, crazing and script stay
// continuous (a 0.125 m field turns them into dashes). All marks derive from the map JSON, deterministically.

import { DataTexture, LinearFilter, NearestFilter, RGBAFormat, UnsignedByteType } from 'three';

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

/** the baked marks: a coarse field over the whole map, and a sparse fine atlas (2 m cells at 1/32 m) over every
 *  cell a thin stroke touches, found through a per-cell index (the shader's valeInlay) */
export interface InlayBake {
  tex: DataTexture; scale: [number, number];
  fine: DataTexture; index: DataTexture;
  /** x: 1 / cell (m⁻¹), y: tile pitch in the atlas (px, with the 1 px border), z: tile interior (px), w: tiles */
  fineP: [number, number, number, number];
  atlas: [number, number];
}

const reach = RANGE_LO + RANGE;
/** min-distance raster of the strokes into a 4-channel float field (texel centres at x0 + i·t) */
function raster(list: readonly Stroke[], d: Float32Array, W: number, H: number, x0: number, y0: number, t: number): void {
  for (const s of list) {
    const r = s.w / 2;
    const i0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - r - reach - x0) / t));
    const i1 = Math.min(W - 1, Math.ceil((Math.max(s.ax, s.bx) + r + reach - x0) / t));
    const j0 = Math.max(0, Math.floor((Math.min(s.ay, s.by) - r - reach - y0) / t));
    const j1 = Math.min(H - 1, Math.ceil((Math.max(s.ay, s.by) + r + reach - y0) / t));
    if (i1 < i0 || j1 < j0) continue;
    const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy;
    for (let j = j0; j <= j1; j++) {
      const py = y0 + j * t;
      for (let i = i0; i <= i1; i++) {
        const px = x0 + i * t;
        let u = l2 > 0 ? ((px - s.ax) * dx + (py - s.ay) * dy) / l2 : 0;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const qx = s.ax + u * dx - px, qy = s.ay + u * dy - py;
        const v = Math.sqrt(qx * qx + qy * qy) - r;
        const o = (j * W + i) * 4 + s.ch;
        if (v < d[o]) d[o] = v;
      }
    }
  }
}
const toBytes = (d: Float32Array, out: Uint8Array, at = 0): void => {
  for (let k = 0; k < d.length; k++) out[at + k] = Math.max(0, Math.min(255, Math.round(((d[k] - RANGE_LO) / RANGE) * 255)));
};

/** bake the strokes over the map rect: coarse at `texel` m everywhere, fine (1/32 m) in the 2 m cells that any
 *  stroke thinner than `fineW` m comes near. Fine tiles carry every stroke near them (all channels, exact). */
export function bakeInlay(set: StrokeSet, size: V2, texel = 0.125, fineW = 0.24): InlayBake {
  const W = Math.ceil(size[0] / texel) + 1, H = Math.ceil(size[1] / texel) + 1;
  const d = new Float32Array(W * H * 4).fill(reach);
  raster(set.list, d, W, H, 0, 0, texel);
  const bytes = new Uint8Array(W * H * 4);
  toBytes(d, bytes);
  const tex = new DataTexture(bytes, W, H, RGBAFormat, UnsignedByteType);
  tex.magFilter = LinearFilter; tex.minFilter = LinearFilter; tex.generateMipmaps = false;
  tex.needsUpdate = true;
  // ── fine atlas ──
  const CELL = 2, IN = 64, PITCH = IN + 2, ft = CELL / IN;
  const CW = Math.ceil(size[0] / CELL), CH = Math.ceil(size[1] / CELL);
  const bucket = new Map<number, Stroke[]>();
  const fineCells = new Set<number>();
  const pad = reach + 0.05;
  for (const s of set.list) {
    const r = s.w / 2 + pad;
    const c0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - r) / CELL)), c1 = Math.min(CW - 1, Math.floor((Math.max(s.ax, s.bx) + r) / CELL));
    const r0 = Math.max(0, Math.floor((Math.min(s.ay, s.by) - r) / CELL)), r1 = Math.min(CH - 1, Math.floor((Math.max(s.ay, s.by) + r) / CELL));
    const thin = s.w < fineW;
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const k = cy * CW + cx;
      let b = bucket.get(k);
      if (!b) { b = []; bucket.set(k, b); }
      b.push(s);
      if (thin) {
        // only cells the thin stroke's own core comes near (not its full reach)
        const cxm = (cx + 0.5) * CELL, cym = (cy + 0.5) * CELL;
        const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy;
        let u = l2 > 0 ? ((cxm - s.ax) * dx + (cym - s.ay) * dy) / l2 : 0;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        if (Math.hypot(s.ax + u * dx - cxm, s.ay + u * dy - cym) < CELL * 0.7072 + s.w + 0.12) fineCells.add(k);
      }
    }
  }
  const cells = [...fineCells].sort((a, b) => a - b);
  const perRow = Math.max(1, Math.min(62, cells.length));
  const rows = Math.max(1, Math.ceil(cells.length / perRow));
  const AW = perRow * PITCH, AH = rows * PITCH;
  const atlas = new Uint8Array(AW * AH * 4);
  const idx = new Uint8Array(CW * CH * 4);
  const tile = new Float32Array(PITCH * PITCH * 4);
  const tb = new Uint8Array(PITCH * PITCH * 4);
  cells.forEach((k, n) => {
    const cx = k % CW, cy = Math.floor(k / CW);
    const tx = n % perRow, ty = Math.floor(n / perRow);
    tile.fill(reach);
    // texel k centre at cell origin + (k − 1 + ½)·ft
    raster(bucket.get(k) ?? [], tile, PITCH, PITCH, cx * CELL - 0.5 * ft, cy * CELL - 0.5 * ft, ft);
    toBytes(tile, tb);
    for (let j = 0; j < PITCH; j++) atlas.set(tb.subarray(j * PITCH * 4, (j + 1) * PITCH * 4), ((ty * PITCH + j) * AW + tx * PITCH) * 4);
    const o = k * 4;
    idx[o] = tx; idx[o + 1] = ty; idx[o + 2] = 255; idx[o + 3] = 255;
  });
  const fine = new DataTexture(atlas, AW, AH, RGBAFormat, UnsignedByteType);
  fine.magFilter = LinearFilter; fine.minFilter = LinearFilter; fine.generateMipmaps = false; fine.needsUpdate = true;
  const index = new DataTexture(idx, CW, CH, RGBAFormat, UnsignedByteType);
  index.magFilter = NearestFilter; index.minFilter = NearestFilter; index.generateMipmaps = false; index.needsUpdate = true;
  return { tex, scale: [1 / (W * texel), 1 / (H * texel)], fine, index, fineP: [1 / CELL, PITCH, IN, cells.length], atlas: [AW, AH] };
}

/** GLSL: the marks at a map point (x chalk · y groove · z lit · w mid), signed distance in metres; fine where baked */
export const INLAY_GLSL = /* glsl */`
uniform sampler2D uInlay; uniform sampler2D uInlayFine; uniform sampler2D uInlayIdx;
uniform vec2 uInlayScale; uniform vec4 uInlayFineP; uniform vec2 uInlayAtlas;
vec4 valeInlay( vec2 p ) {
  vec2 cp = p * uInlayFineP.x;
  ivec2 ci = ivec2( floor( cp ) );
  ivec2 isz = textureSize( uInlayIdx, 0 );
  vec4 raw;
  bool ok = uInlayFineP.w > 0.5 && ci.x >= 0 && ci.y >= 0 && ci.x < isz.x && ci.y < isz.y;
  vec4 ix = ok ? texelFetch( uInlayIdx, ci, 0 ) : vec4( 0.0 );
  if ( ix.b > 0.5 ) {
    vec2 tl = floor( ix.rg * 255.0 + 0.5 );
    raw = textureLod( uInlayFine, ( tl * uInlayFineP.y + 1.0 + fract( cp ) * uInlayFineP.z ) / uInlayAtlas, 0.0 );
  } else {
    raw = textureLod( uInlay, p * uInlayScale, 0.0 );
  }
  return raw * 0.6 - 0.15;
}
`;

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
    const w = 0.045;
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

/** the painted lane decals along one road (lane polish): hairline cracks across the flags and, sparser, the chalk a
 *  walker leaves on a sundial's road (a sketched noon-mark, an hour tally, a dusk crescent, an hour
 *  numeral, a ringed spot). Deterministic from the path and the seed. `crack` / `chalk` name the inlay channels the
 *  surface reads them from (each ground style keeps its own free channels; chalk null = cracks only); `half` is the
 *  lateral range either side of the path (m); keep() vets every point a mark touches (walls, plazas, the Seat, the
 *  drop, the brush). Strokes are thin, so every mark lands in the fine atlas (crisp at 3 cm). */
export interface LaneDecalOpts {
  half: number; every: readonly [number, number]; seed: number;
  crack: number; chalk: number | null; pCrack: number; pChalk: number;
  keep: (x: number, y: number) => boolean;
}
export function laneDecals(set: StrokeSet, path: readonly V2[], o: LaneDecalOpts): void {
  const rnd = mulberry(o.seed);
  const pts = along(path, 0.5, 0);
  if (pts.length < 2) return;
  const okAll = (q: readonly V2[]): boolean => q.every((p) => o.keep(p[0], p[1]));
  const line = (q: V2[], w0: number, w1: number, ch: number): void => {
    for (let i = 1; i < q.length; i++) { const t = (i - 0.5) / (q.length - 1); set.seg(q[i - 1], q[i], w0 + (w1 - w0) * t, ch); }
  };
  // a hand-drawn chalk stroke: a little wobble, never ruled
  const chalkLine = (a: V2, b: V2, w: number, ch: number): void => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 0.18) { set.seg(a, b, w, ch); return; }
    line(fracture(a, b, l * 0.035, 2, rnd), w, w * 0.8, ch);
  };
  let s = o.every[0] * (0.3 + rnd());
  const total = pts[pts.length - 1].s;
  while (s < total) {
    const k = Math.min(pts.length - 1, Math.round(s / 0.5));
    const { p, t } = pts[k];
    s += o.every[0] + rnd() * (o.every[1] - o.every[0]);
    const n: V2 = [-t[1], t[0]];
    const v = (rnd() * 2 - 1) * o.half;
    const c: V2 = [p[0] + n[0] * v, p[1] + n[1] * v];
    const roll = rnd();
    if (roll < o.pCrack) {
      // a hairline crack across one or two flags, pinching out at both ends; often a short branch
      const ang = rnd() * Math.PI, len = 0.7 + rnd() * 1.6;
      const d: V2 = [Math.cos(ang), Math.sin(ang)];
      const a: V2 = [c[0] - d[0] * len * 0.5, c[1] - d[1] * len * 0.5], b: V2 = [c[0] + d[0] * len * 0.5, c[1] + d[1] * len * 0.5];
      const main = fracture(a, b, len * 0.11, 4, rnd);
      if (!okAll(main)) continue;
      for (let i = 1; i < main.length; i++) {
        const tt = (i - 0.5) / (main.length - 1);
        set.seg(main[i - 1], main[i], 0.018 + 0.026 * Math.pow(Math.sin(Math.PI * tt), 0.8), o.crack);
      }
      if (rnd() < 0.55) {
        const m = main[1 + Math.floor(rnd() * (main.length - 2))];
        const a2 = ang + (rnd() < 0.5 ? -1 : 1) * (0.45 + rnd() * 0.6), l2 = len * (0.25 + rnd() * 0.25);
        const br = fracture(m, [m[0] + Math.cos(a2) * l2, m[1] + Math.sin(a2) * l2], l2 * 0.12, 3, rnd);
        if (okAll(br)) line(br, 0.026, 0.014, o.crack);
      }
    } else if (roll < o.pCrack + o.pChalk && o.chalk !== null) {
      const ch = o.chalk, w = 0.04 + rnd() * 0.012;
      if (!okAll([c, [c[0] - 0.55, c[1]], [c[0] + 0.55, c[1]], [c[0], c[1] - 0.55], [c[0], c[1] + 0.55]])) continue;
      const kind = Math.floor(rnd() * 5);
      if (kind === 0) {
        // a sketched noon-mark: a wobbly dial, its gnomon line cast toward an hour, hour dashes round it
        const r = 0.17 + rnd() * 0.09, n0 = 13, gap = 1 + Math.floor(rnd() * 2);
        const ring: V2[] = [];
        const a0 = rnd() * Math.PI * 2;
        for (let i = 0; i <= n0 - gap; i++) { const a = a0 + (i / n0) * Math.PI * 2, rr = r * (1 + (rnd() - 0.5) * 0.1); ring.push([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr]); }
        line(ring, w, w * 0.85, ch);
        const g = rnd() * Math.PI * 2;
        chalkLine(c, [c[0] + Math.cos(g) * r * 2.1, c[1] + Math.sin(g) * r * 2.1], w, ch);
        for (let h = -2; h <= 2; h++) {
          const a = g + h * (Math.PI / 6);
          set.seg([c[0] + Math.cos(a) * r * 1.3, c[1] + Math.sin(a) * r * 1.3], [c[0] + Math.cos(a) * r * 1.55, c[1] + Math.sin(a) * r * 1.55], w * 0.85, ch);
        }
      } else if (kind === 1) {
        // an hour tally: four or five strokes and the strike across them (upright for the fixed camera, screen-up −y)
        const m = 3 + Math.floor(rnd() * 2), sp = 0.075, hh = 0.15, tilt = (rnd() - 0.5) * 0.25;
        const x0 = c[0] - (sp * (m - 1)) / 2;
        for (let i = 0; i < m; i++) { const x = x0 + i * sp + (rnd() - 0.5) * 0.015; chalkLine([x + tilt * hh, c[1] - hh], [x - tilt * hh, c[1] + hh], w, ch); }
        chalkLine([x0 - 0.07, c[1] + hh * 0.55], [x0 + sp * (m - 1) + 0.07, c[1] - hh * 0.6], w, ch);
      } else if (kind === 2) {
        // a dusk crescent: the hour the walker left (never an arrow: a pale arrow on the road reads as an aim or a
        // direction cue). Outer circle (c, r), inner (c + u·s, r2), each arc drawn on the side away from u
        const r = 0.19 + rnd() * 0.05, r2 = r * 0.86, s2 = r * 0.5, g = rnd() * Math.PI * 2, u: V2 = [Math.cos(g), Math.sin(g)];
        const xi = (r * r - r2 * r2 + s2 * s2) / (2 * s2), yi = Math.sqrt(Math.max(0, r * r - xi * xi));
        const arc = (o: V2, rr: number, th: number): V2[] => {
          const q: V2[] = [], m = 9;
          for (let i = 0; i <= m; i++) {
            const a = g + th + (i / m) * (Math.PI * 2 - 2 * th), k = rr * (1 + (rnd() - 0.5) * 0.06);
            q.push([o[0] + Math.cos(a) * k, o[1] + Math.sin(a) * k]);
          }
          return q;
        };
        line(arc(c, r, Math.atan2(yi, xi)), w, w * 0.85, ch);
        line(arc([c[0] + u[0] * s2, c[1] + u[1] * s2], r2, Math.atan2(yi, xi - s2)), w * 0.85, w * 0.8, ch);
      } else if (kind === 3) {
        // an hour numeral, chalked where someone waited for it
        numeral(set, c, 1 + Math.floor(rnd() * 12), 0.26 + rnd() * 0.06, w, ch);
      } else {
        // a ringed spot: a cross in an open ring (a meeting mark)
        const r = 0.24 + rnd() * 0.08, n0 = 14, a0 = rnd() * Math.PI * 2;
        const ring: V2[] = [];
        for (let i = 0; i <= n0 - 2; i++) { const a = a0 + (i / n0) * Math.PI * 2, rr = r * (1 + (rnd() - 0.5) * 0.12); ring.push([c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr]); }
        line(ring, w, w * 0.8, ch);
        const q = r * 0.5;
        chalkLine([c[0] - q, c[1] - q], [c[0] + q, c[1] + q], w, ch);
        chalkLine([c[0] - q, c[1] + q], [c[0] + q, c[1] - q], w, ch);
      }
    }
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
