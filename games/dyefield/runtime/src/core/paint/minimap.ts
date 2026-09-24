// DYEFIELD — exact live minimap raster over the paint atlas (CONTRACT §4.7, DESIGN §4).
// THREE-free, DOM-free (an RGBA byte buffer; the HUD blits it into a canvas).
//
// Every floor texel (atlas.floor = 1) maps to one minimap pixel. Each pixel is OWNED by exactly
// one texel: the top-most one (highest y; heights within HEIGHT_EPS count as the same level),
// and among same-level texels the one nearest the pixel centre (ties → lowest id). So a deck
// hides the court under it, and a flip repaints a pixel only when the flipped texel owns it:
// apply(id) is O(1) and the minimap is exact at zero per-frame cost.
//
// Orientation (§4.7, the SUNCREW view): pixel row 0 = max z, column 0 = max x, i.e. screen-up
// = +Z and screen-right = −X. worldToPixel returns CONTINUOUS pixel-space coordinates [col, row]:
// pixel (i, j) spans [i, i+1) × [j, j+1), so Math.floor gives the pixel index, and the value
// itself is right for sub-pixel markers and for the 180° GULF view (w − col, h − row). Points
// outside the rectangle map outside [0, w) × [0, h).
//
// Colours: pixels with no owner are transparent (alpha 0). Owned pixels are opaque: neutral
// texels show `base` shaded by height (0.72 at the lowest floor → 1.0 at the highest, so decks
// read lighter), team texels show the team colour with a milder height shade (0.86 → 1.0).

import type { PaintAtlas } from './atlas.ts';

export interface MinimapOptions {
  min: [number, number]; max: [number, number];   // world x,z rectangle (maps.json minimap)
  pxPerMeter: number;
  colors: { base: [number, number, number]; sun: [number, number, number]; gulf: [number, number, number] }; // 0..255
}

const HEIGHT_EPS = 0.02;

export class MinimapRaster {
  readonly w: number; readonly h: number; readonly rgba: Uint8ClampedArray; dirty: boolean;

  private readonly atlas: PaintAtlas;
  private readonly o: MinimapOptions;
  /** id → pixel index (row*w + col) or −1 (not a floor texel / outside the rectangle) */
  private readonly pixOf: Int32Array;
  /** pixel → owning texel id or −1 */
  private readonly owner: Int32Array;
  /** pixel → shade factor 0..1 derived from the owner's height (precomputed) */
  private readonly shade: Float32Array;

  constructor(atlas: PaintAtlas, o: MinimapOptions) {
    this.atlas = atlas;
    this.o = o;
    const ppm = o.pxPerMeter;
    if (!(ppm > 0)) throw new Error(`[minimap] bad pxPerMeter ${ppm}`);
    this.w = Math.max(1, Math.round((o.max[0] - o.min[0]) * ppm));
    this.h = Math.max(1, Math.round((o.max[1] - o.min[1]) * ppm));
    const npx = this.w * this.h;
    this.rgba = new Uint8ClampedArray(npx * 4);
    this.pixOf = new Int32Array(atlas.count).fill(-1);
    this.owner = new Int32Array(npx).fill(-1);
    this.shade = new Float32Array(npx);
    this.dirty = true;

    const height = new Float32Array(npx).fill(-Infinity);
    const d2best = new Float32Array(npx);
    const { px, py, pz, floor, count } = atlas;
    let yMin = Infinity, yMax = -Infinity;
    for (let id = 0; id < count; id++) {
      if (floor[id] !== 1) continue;
      const fc = (o.max[0] - px[id]) * ppm;
      const fr = (o.max[1] - pz[id]) * ppm;
      const col = Math.floor(fc), row = Math.floor(fr);
      if (col < 0 || col >= this.w || row < 0 || row >= this.h) continue;
      const p = row * this.w + col;
      this.pixOf[id] = p;
      const y = py[id];
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
      const dc = fc - (col + 0.5), dr = fr - (row + 0.5);
      const d2 = dc * dc + dr * dr;
      const hy = height[p];
      if (this.owner[p] < 0 || y > hy + HEIGHT_EPS || (y >= hy - HEIGHT_EPS && d2 < d2best[p])) {
        this.owner[p] = id;
        height[p] = y;
        d2best[p] = d2;
      }
    }
    const span = yMax > yMin ? yMax - yMin : 1;
    for (let p = 0; p < npx; p++) {
      const id = this.owner[p];
      this.shade[p] = id >= 0 ? Math.min(1, Math.max(0, (py[id] - yMin) / span)) : 0;
    }
    this.rebuild();
  }

  /** Repaint the pixel this floor texel owns (no-op when it owns none). */
  apply(id: number): void {
    if (id < 0 || id >= this.pixOf.length) return;
    const p = this.pixOf[id];
    if (p < 0 || this.owner[p] !== id) return;
    this.paintPixel(p, id);
    this.dirty = true;
  }

  rebuild(): void {
    const n = this.w * this.h;
    for (let p = 0; p < n; p++) {
      const id = this.owner[p];
      if (id >= 0) this.paintPixel(p, id);
      else { const q = p * 4; this.rgba[q] = 0; this.rgba[q + 1] = 0; this.rgba[q + 2] = 0; this.rgba[q + 3] = 0; }
    }
    this.dirty = true;
  }

  worldToPixel(x: number, z: number): [number, number] {
    const ppm = this.o.pxPerMeter;
    return [(this.o.max[0] - x) * ppm, (this.o.max[1] - z) * ppm];
  }

  /** Owning texel id of pixel (col, row), or −1. */
  ownerAt(col: number, row: number): number {
    if (col < 0 || col >= this.w || row < 0 || row >= this.h) return -1;
    return this.owner[row * this.w + col];
  }

  private paintPixel(p: number, id: number): void {
    const t = this.atlas.team[id];
    const s = this.shade[p];
    const c = t === 1 ? this.o.colors.sun : t === 2 ? this.o.colors.gulf : this.o.colors.base;
    const f = t === 0 ? 0.72 + 0.28 * s : 0.86 + 0.14 * s;
    const q = p * 4;
    this.rgba[q] = c[0] * f;
    this.rgba[q + 1] = c[1] * f;
    this.rgba[q + 2] = c[2] * f;
    this.rgba[q + 3] = 255;
  }
}
