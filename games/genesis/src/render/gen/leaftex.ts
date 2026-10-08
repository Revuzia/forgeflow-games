// GENESIS — the foliage atlas, painted procedurally on a 2D canvas (no image assets), deterministic (seeded).
//
// 2 × 2 tiles of 256 px, each one foliage "card" as a real plant part, attached at the bottom-centre of its tile and
// growing up, with transparent gaps so crowns built from them show sky through:
//   0  broadleaf spray   — a curved twig with side twigs and pointed, veined leaves (oak / beech / kapok / shrubs)
//   1  small-leaf spray  — a fine airy twig with many small round leaves (birch, acacia, rainforest canopy)
//   2  needle spray      — a pinnate conifer branchlet: side twigs densely set with short needles (pine / spruce)
//   3  palm frond        — a rachis with long drooping leaflets
// Tree meshes (render/gen/treegen.ts) map card corners into a tile with atlasUV(). The canvas is flipped on upload
// (three's default), which atlasUV accounts for. The alpha-tested cards are sharpened in the vegetation shader.

import { CanvasTexture, LinearMipmapLinearFilter, LinearFilter, SRGBColorSpace, type Texture } from 'three';
import { Rng } from '../../sim/core/rng.ts';

export const LEAF_TILE = { spray: 0, smallSpray: 1, needles: 2, frond: 3 } as const;
const TILE = 256;
const ATLAS = TILE * 2;
/** inset of the usable tile area (texels) so mip levels never bleed a neighbour tile in */
const PAD = 6;

/** atlas UV of a point (lu, lv) of a tile, lv = 0 at the attachment end (bottom) of the card */
export function atlasUV(tile: number, lu: number, lv: number): [number, number] {
  const col = tile & 1, row = tile >> 1;
  const k = (TILE - 2 * PAD) / TILE;
  const u = (col * TILE + PAD + lu * TILE * k) / ATLAS;
  // canvas rows grow downward and the texture is flipped on upload: row 0 sits in the top half of v
  const v = ((1 - row) * TILE + PAD + lv * TILE * k) / ATLAS;
  return [u, v];
}

let cached: Texture | null = null;

type Ctx = CanvasRenderingContext2D;

function rgb(r: number, g: number, b: number, a = 1): string {
  return `rgba(${Math.round(Math.max(0, Math.min(255, r)))},${Math.round(Math.max(0, Math.min(255, g)))},${Math.round(Math.max(0, Math.min(255, b)))},${a})`;
}

/** a pointed leaf with a midrib, base at (0,0) pointing along +x in the current transform */
function leaf(g: Ctx, len: number, wid: number, base: [number, number, number], rng: Rng, round = false): void {
  const grad = g.createLinearGradient(0, -wid, 0, wid);
  const k = 0.82 + rng.float() * 0.36;
  const [r, gg, b] = base;
  grad.addColorStop(0, rgb(r * k * 1.12, gg * k * 1.1, b * k));
  grad.addColorStop(0.5, rgb(r * k, gg * k, b * k));
  grad.addColorStop(1, rgb(r * k * 0.72, gg * k * 0.74, b * k * 0.8));
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, 0);
  if (round) {
    g.bezierCurveTo(len * 0.15, -wid * 1.15, len * 0.95, -wid * 0.9, len, 0);
    g.bezierCurveTo(len * 0.95, wid * 0.9, len * 0.15, wid * 1.15, 0, 0);
  } else {
    g.bezierCurveTo(len * 0.2, -wid, len * 0.7, -wid * 0.8, len, 0);
    g.bezierCurveTo(len * 0.7, wid * 0.8, len * 0.2, wid, 0, 0);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = rgb(r * 1.35, gg * 1.25, b * 1.1, 0.55);
  g.lineWidth = Math.max(0.8, wid * 0.12);
  g.beginPath();
  g.moveTo(len * 0.05, 0);
  g.lineTo(len * 0.88, 0);
  g.stroke();
}

function twig(g: Ctx, pts: [number, number][], w0: number, w1: number, col: string): void {
  g.strokeStyle = col;
  g.lineCap = 'round';
  for (let i = 0; i < pts.length - 1; i++) {
    g.lineWidth = w0 + (w1 - w0) * (i / Math.max(1, pts.length - 2));
    g.beginPath();
    g.moveTo(pts[i][0], pts[i][1]);
    g.lineTo(pts[i + 1][0], pts[i + 1][1]);
    g.stroke();
  }
}

/** a curved path from the tile's attachment point upward, as polyline points (tile-local px, y down) */
function stemPath(rng: Rng, x0: number, y0: number, len: number, bend: number, n = 10): [number, number][] {
  const pts: [number, number][] = [];
  const a0 = -Math.PI / 2 + (rng.float() - 0.5) * 0.25;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a0 + bend * t * t;
    const prev = pts[i - 1] ?? [x0, y0];
    if (i === 0) { pts.push([x0, y0]); continue; }
    pts.push([prev[0] + Math.cos(a) * (len / n), prev[1] + Math.sin(a) * (len / n)]);
  }
  return pts;
}

function at(pts: [number, number][], t: number): [number, number, number] {
  const f = Math.min(pts.length - 1.001, t * (pts.length - 1));
  const i = Math.floor(f), u = f - i;
  const a = pts[i], b = pts[i + 1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, Math.atan2(b[1] - a[1], b[0] - a[0])];
}

function paintSpray(g: Ctx, rng: Rng, small: boolean): void {
  const base: [number, number, number] = small ? [96, 132, 52] : [74, 118, 44];
  const bark = 'rgb(58,44,30)';
  const main = stemPath(rng, TILE / 2, TILE - PAD - 2, TILE * 0.82, (rng.float() - 0.5) * 0.7);
  twig(g, main, small ? 2.6 : 3.4, 1.2, bark);
  // side twigs, alternating, angled toward the tip
  const sides = small ? 7 : 5;
  const twigs: [number, number][][] = [main];
  for (let i = 0; i < sides; i++) {
    const t = 0.18 + (i / sides) * 0.7 + rng.float() * 0.05;
    const [x, y, a] = at(main, t);
    const side = i % 2 === 0 ? 1 : -1;
    const ang = a + side * (0.55 + rng.float() * 0.35);
    const len = TILE * (small ? 0.22 : 0.26) * (1 - t * 0.45) * (0.8 + rng.float() * 0.4);
    const pts: [number, number][] = [[x, y]];
    for (let k = 1; k <= 5; k++) {
      const aa = ang - side * 0.06 * k;
      const p = pts[k - 1];
      pts.push([p[0] + Math.cos(aa) * len / 5, p[1] + Math.sin(aa) * len / 5]);
    }
    twig(g, pts, small ? 1.4 : 1.9, 0.8, bark);
    twigs.push(pts);
  }
  // leaves along every twig: alternate sides, older (inner) ones darker, a terminal leaf at each tip
  for (let w = 0; w < twigs.length; w++) {
    const pts = twigs[w];
    const count = small ? (w === 0 ? 16 : 7) : (w === 0 ? 9 : 5);
    for (let i = 0; i < count; i++) {
      const t = (w === 0 ? 0.25 : 0.12) + (i / count) * (w === 0 ? 0.75 : 0.88);
      const [x, y, a] = at(pts, Math.min(1, t));
      const side = i % 2 === 0 ? 1 : -1;
      const len = (small ? 15 + rng.float() * 9 : 30 + rng.float() * 16) * (w === 0 ? 1.05 : 0.95);
      const wid = len * (small ? 0.42 : 0.34) * (0.85 + rng.float() * 0.3);
      const shade = 0.78 + 0.32 * t;
      g.save();
      g.translate(x, y);
      g.rotate(a + side * (0.7 + rng.float() * 0.5));
      leaf(g, len, wid, [base[0] * shade, base[1] * shade, base[2] * shade], rng, small);
      g.restore();
    }
    const [x, y, a] = at(pts, 1);
    g.save();
    g.translate(x, y);
    g.rotate(a + (rng.float() - 0.5) * 0.3);
    const len = small ? 20 : 38;
    leaf(g, len, len * (small ? 0.45 : 0.34), base, rng, small);
    g.restore();
  }
}

function paintNeedles(g: Ctx, rng: Rng): void {
  const main = stemPath(rng, TILE / 2, TILE - PAD - 2, TILE * 0.86, (rng.float() - 0.5) * 0.35, 12);
  const twigCol = 'rgb(62,48,32)';
  const needle = (x: number, y: number, a: number, len: number, shade: number) => {
    g.strokeStyle = rgb(50 * shade, 94 * shade, 54 * shade);
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  };
  const branchlet = (pts: [number, number][], scale: number) => {
    // needles densely along both sides, swept toward the tip, shorter toward the tip
    const n = Math.round(46 * scale);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const [x, y, a] = at(pts, t);
      const len = (11 + rng.float() * 5) * (1 - t * 0.45) * (0.75 + scale * 0.35);
      const shade = 0.75 + 0.45 * rng.float();
      needle(x, y, a - 0.85 - rng.float() * 0.25, len, shade);
      needle(x, y, a + 0.85 + rng.float() * 0.25, len, shade);
      if (i % 2 === 0) needle(x, y, a + (rng.float() - 0.5) * 0.6, len * 0.7, shade * 1.1);
    }
  };
  // the outline of a fir spray: side branchlets long at the base, short toward the tip
  const sides = 8;
  for (let i = 0; i < sides; i++) {
    const t = 0.08 + (i / sides) * 0.8;
    const [x, y, a] = at(main, t);
    const side = i % 2 === 0 ? 1 : -1;
    const len = TILE * 0.3 * (1 - t * 0.75) * (0.85 + rng.float() * 0.3);
    const ang = a + side * (0.75 + rng.float() * 0.2);
    const pts: [number, number][] = [[x, y]];
    for (let k = 1; k <= 6; k++) {
      const p = pts[k - 1];
      const aa = ang - side * 0.05 * k;
      pts.push([p[0] + Math.cos(aa) * len / 6, p[1] + Math.sin(aa) * len / 6]);
    }
    twig(g, pts, 1.6, 0.8, twigCol);
    branchlet(pts, 0.55 * (1 - t * 0.4));
  }
  twig(g, main, 3.0, 1.0, twigCol);
  branchlet(main, 1.0);
}

function paintFrond(g: Ctx, rng: Rng): void {
  const main = stemPath(rng, TILE / 2, TILE - PAD - 2, TILE * 0.9, (rng.float() - 0.5) * 0.3, 12);
  const n = 22;
  for (let i = 0; i < n; i++) {
    const t = 0.06 + (i / n) * 0.92;
    const [x, y, a] = at(main, t);
    for (const side of [1, -1]) {
      const len = TILE * 0.36 * Math.sin(Math.PI * (0.2 + t * 0.75)) * (0.85 + rng.float() * 0.25);
      const ang = a + side * (0.9 - t * 0.35 + rng.float() * 0.12);
      const shade = 0.8 + rng.float() * 0.35;
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      // long, narrow leaflet that droops a little at its end
      g.fillStyle = rgb(88 * shade, 128 * shade, 48 * shade);
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(len * 0.5, -len * 0.05, len, len * 0.08 * side);
      g.quadraticCurveTo(len * 0.5, len * 0.05, 0, 0);
      g.fill();
      g.restore();
    }
  }
  twig(g, main, 3.6, 1.2, 'rgb(120,104,62)');
}

/** the 512² foliage atlas (cached; null outside a DOM) */
export function leafClusterTexture(): Texture | null {
  if (cached) return cached;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = ATLAS; c.height = ATLAS;
  const g = c.getContext('2d');
  if (!g) return null;
  g.clearRect(0, 0, ATLAS, ATLAS);
  const tile = (index: number, paint: (g: Ctx, rng: Rng) => void, seed: number) => {
    g.save();
    g.translate((index & 1) * TILE, (index >> 1) * TILE);
    g.beginPath();
    g.rect(PAD, PAD, TILE - 2 * PAD, TILE - 2 * PAD);
    g.clip();
    paint(g, new Rng(seed));
    g.restore();
  };
  tile(LEAF_TILE.spray, (gg, r) => paintSpray(gg, r, false), 4242);
  tile(LEAF_TILE.smallSpray, (gg, r) => paintSpray(gg, r, true), 777);
  tile(LEAF_TILE.needles, paintNeedles, 1313);
  tile(LEAF_TILE.frond, paintFrond, 9090);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  cached = t;
  return t;
}
