// GENESIS — map overlays on the terrain (CONTRACT.md §16.8; the UI's O key): temperature, moisture, biome, belief,
// territory, era, ore, population, trade, pollution… The UI (src/ui/overlays.ts) decides what each cell's colour is;
// this module turns per-cell RGBA into an equirectangular texture the terrain material samples by body-frame direction
// (terrainmat.ts: uOverlay / uOverlayK), so the overlay hugs every slope at every LOD with no geometry of its own.
//
// Each texel of the map is the barycentric blend of the three sim cells around its direction (grid.locate), weighted
// by their alpha (premultiplied: a coloured cell next to an uncoloured one fades out instead of darkening). The texel →
// cells table is built once per grid, a band of rows per call, so a first overlay never stalls a frame.

import { DataTexture, LinearFilter, RGBAFormat, RepeatWrapping, ClampToEdgeWrapping, SRGBColorSpace, UnsignedByteType, type IUniform } from 'three';
import type { Vector3 } from 'three';
import { newHit, type IcoGrid } from '../../sim/grid/icogrid.ts';

/** texture size for a grid of frequency n: ~1.3 texels per cell spacing at the equator (the texels are interpolated
 * between cells, and the texture is filtered), 256..1024 wide */
function sizeFor(n: number): [number, number] {
  const w = Math.min(1024, Math.max(256, 2 ** Math.ceil(Math.log2(n * 6))));
  return [w, w / 2];
}

export class OverlayMap {
  readonly grid: IcoGrid;
  readonly w: number;
  readonly h: number;
  readonly tex: DataTexture;
  private readonly data: Uint8Array;
  /** per texel: three cells and two weights (the third is 1 − a − b) */
  private readonly cells: Int32Array;
  private readonly wts: Float32Array;
  private builtRows = 0;
  private readonly hit = newHit();

  constructor(grid: IcoGrid) {
    this.grid = grid;
    [this.w, this.h] = sizeFor(Math.round(Math.sqrt((grid.count - 2) / 10)));
    this.data = new Uint8Array(this.w * this.h * 4);
    this.cells = new Int32Array(this.w * this.h * 3);
    this.wts = new Float32Array(this.w * this.h * 2);
    this.tex = new DataTexture(this.data, this.w, this.h, RGBAFormat, UnsignedByteType);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.wrapS = RepeatWrapping;
    this.tex.wrapT = ClampToEdgeWrapping;
    this.tex.magFilter = LinearFilter;
    this.tex.minFilter = LinearFilter;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;
  }

  /** true once every texel knows its cells */
  get ready(): boolean { return this.builtRows >= this.h; }

  /** build up to `rows` more rows of the texel → cells table; returns true when complete */
  build(rows = 48): boolean {
    const { w, h, grid } = this;
    const end = Math.min(h, this.builtRows + rows);
    for (let y = this.builtRows; y < end; y++) {
      // texel centres; v = asin(y)/π + 0.5, u = atan2(x, z)/2π + 0.5 (terrainmat.ts uses the same mapping)
      const lat = ((y + 0.5) / h - 0.5) * Math.PI;
      const cl = Math.cos(lat), sl = Math.sin(lat);
      for (let x = 0; x < w; x++) {
        const lon = ((x + 0.5) / w - 0.5) * 2 * Math.PI;
        const hit = grid.locate(cl * Math.sin(lon), sl, cl * Math.cos(lon), this.hit);
        const i = y * w + x;
        this.cells[i * 3] = hit.a; this.cells[i * 3 + 1] = hit.b; this.cells[i * 3 + 2] = hit.c;
        this.wts[i * 2] = hit.wa; this.wts[i * 2 + 1] = hit.wb;
      }
    }
    this.builtRows = end;
    return this.ready;
  }

  /**
   * Fill the map from per-cell colours (RGBA bytes, 4 per cell, sRGB; alpha = how strongly the cell is coloured).
   * Rows not yet built stay transparent.
   */
  fill(rgba: Uint8Array): void {
    const { data, cells, wts } = this;
    const n = Math.min(this.builtRows * this.w, this.w * this.h);
    for (let i = 0; i < n; i++) {
      const a = cells[i * 3], b = cells[i * 3 + 1], c = cells[i * 3 + 2];
      const wa = wts[i * 2], wb = wts[i * 2 + 1], wc = 1 - wa - wb;
      const aa = rgba[a * 4 + 3] * wa, ab = rgba[b * 4 + 3] * wb, ac = rgba[c * 4 + 3] * wc;
      const s = aa + ab + ac;
      const o = i * 4;
      if (s < 0.5) { data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0; continue; }
      const k = 1 / s;
      data[o] = (rgba[a * 4] * aa + rgba[b * 4] * ab + rgba[c * 4] * ac) * k;
      data[o + 1] = (rgba[a * 4 + 1] * aa + rgba[b * 4 + 1] * ab + rgba[c * 4 + 1] * ac) * k;
      data[o + 2] = (rgba[a * 4 + 2] * aa + rgba[b * 4 + 2] * ab + rgba[c * 4 + 2] * ac) * k;
      data[o + 3] = Math.min(255, s);
    }
    for (let i = n; i < this.w * this.h; i++) data[i * 4 + 3] = 0;
    this.tex.needsUpdate = true;
  }

  dispose(): void { this.tex.dispose(); }
}

/**
 * Put an overlay on (or off) a planet's terrain: `uniforms` are the planet's shared shader uniforms
 * (PlanetVisual.uniforms); `mix` is how much of the albedo the map takes, `glow` how much it lights itself.
 */
export function applyOverlay(uniforms: Record<string, IUniform>, map: OverlayMap | null, mix = 0.82, glow = 0.32): void {
  const u = uniforms.uOverlay, k = uniforms.uOverlayK;
  if (!u || !k) return; // a terrain material without the hook
  u.value = map ? map.tex : null;
  (k.value as Vector3).set(map ? 1 : 0, mix, glow);
}
