// GENESIS — sim fields → GPU data textures (CONTRACT.md §15.4).
//
// RGBA32F textures, 256 cells per row, cell c at texel (c & 255, c >> 8). The terrain / water vertex shaders fetch the
// three cells of each render vertex and interpolate. Packing (one texture each):
//   A  surface, rough (= roughOf(soil, sand, snow) from src/sim/grid/surface.ts — the SAME function the CPU ground
//      uses), waterLevel (see below), waterDepth
//   N  per-cell normal (body frame, from neighbour heights) and concavity (neighbours' mean height − own height, m:
//      > 0 in hollows and valleys, < 0 on ridges and peaks); both recomputed only when `surface` changes
//   M0 snow, sand, soil, ash          M1 lava, wetness, ice, burnt
//   V  grass, shrub, tree, crop       C  temperature, moisture, road, fire
//   F  flow velocity (m/s, body frame), salinity
//   S  treeSpecies, cropSpecies, light (night lights, reserved), biome
//   G  curvature gradient of `surface` (gx, gy, gz, gw) from surface.ts surfaceGradients — computed once per surface
//      change by the WorldView (pv.ground.grad, the array the CPU ground function reads) and uploaded as is
//   D  dune amplitude (surface.ts duneAmpOf of the raw sand depth), the ground function's dune term; surface wind
//      (m/s, body-frame tangent vector: the sea state of the water, ocean.ts) in yzw — a synthetic trade-wind / westerly
//      pattern with gusty variation where the source has no wind field (lookdev)
// Each texture is rebuilt only when one of its source fields' versions changed (WorldView bumps them per arrival).
//
// waterLevel: wet cells carry their true water surface; dry cells next to water carry the wet neighbours' mean level
// clamped just under their own ground, so the water sheet stays FLAT up to the true shoreline (the terrain's depth
// test draws the coast) instead of sloping up the beach; dry inland cells sit well under the ground (no water).

import { DataTexture, FloatType, NearestFilter, RGBAFormat, ClampToEdgeWrapping } from 'three';
import type { FieldName } from '../../sim/types.ts';
import type { PlanetView } from '../../client/worldview.ts';
import { duneAmpOf, roughOf, surfaceGradients } from '../../sim/grid/surface.ts';

export const FIELD_ROW = 256;
const WET = 0.02;

type TexName = 'A' | 'N' | 'M0' | 'M1' | 'V' | 'C' | 'F' | 'S' | 'G' | 'D';
const SOURCES: Record<TexName, FieldName[]> = {
  A: ['surface', 'soil', 'sand', 'snow', 'water'],
  N: ['surface'],
  M0: ['snow', 'sand', 'soil', 'ash'],
  M1: ['lava', 'wetness', 'ice', 'burnt'],
  V: ['grass', 'shrub', 'tree', 'crop'],
  C: ['temperature', 'moisture', 'road', 'fire'],
  F: ['flowX', 'flowY', 'flowZ', 'salinity'],
  S: ['treeSpecies', 'cropSpecies', 'biome'],
  G: ['surface'],
  D: ['sand', 'windX', 'windY', 'windZ'],
};

export class FieldTextures {
  readonly rows: number;
  readonly tex: Record<TexName, DataTexture>;
  /** CPU copies used by the chunk system for bounds / water presence (same arrays as the textures) */
  readonly waterLevel: Float32Array;
  readonly waterDepth: Float32Array;
  private stamps: Record<TexName, string> = { A: '', N: '', M0: '', M1: '', V: '', C: '', F: '', S: '', G: '', D: '' };
  /** night light per cell, supplied by the life layer (lit buildings), packed into S.z; and its version */
  private light: Float32Array | null = null;
  private lightVersion = 0;
  /** bumped whenever A (heights / water) changes: the chunk system re-derives bounds */
  geomVersion = 0;
  private normalsStamp = -1;
  private pv: PlanetView;

  constructor(pv: PlanetView) {
    this.pv = pv;
    const count = pv.grid.count;
    this.rows = Math.ceil(count / FIELD_ROW);
    const mk = (): DataTexture => {
      const t = new DataTexture(new Float32Array(FIELD_ROW * this.rows * 4), FIELD_ROW, this.rows, RGBAFormat, FloatType);
      t.minFilter = NearestFilter;
      t.magFilter = NearestFilter;
      t.wrapS = t.wrapT = ClampToEdgeWrapping;
      t.generateMipmaps = false;
      t.flipY = false;
      t.needsUpdate = true;
      return t;
    };
    this.tex = { A: mk(), N: mk(), M0: mk(), M1: mk(), V: mk(), C: mk(), F: mk(), S: mk(), G: mk(), D: mk() };
    this.waterLevel = new Float32Array(count);
    this.waterDepth = new Float32Array(count);
  }

  private stamp(name: TexName): string {
    let s = '';
    for (const f of SOURCES[name]) s += (this.pv.fieldVersion.get(f) ?? 0) + ',';
    if (name === 'S') s += `L${this.lightVersion}`;
    return s;
  }

  /** the life layer's per-cell night light (render/life/buildings.ts lightField); uploaded with S when it changes */
  setLight(data: Float32Array | null, version: number): void {
    if (version === this.lightVersion && data === this.light) return;
    this.light = data;
    this.lightVersion = version;
  }

  private field(f: FieldName): Float32Array | null {
    return this.pv.fields.get(f) ?? null;
  }

  /** upload whatever changed since the last call; returns true if heights / water changed */
  update(): boolean {
    let geom = false;
    for (const name of Object.keys(SOURCES) as TexName[]) {
      const st = this.stamp(name);
      if (st === this.stamps[name]) continue;
      this.stamps[name] = st;
      this.fill(name);
      this.tex[name].needsUpdate = true;
      if (name === 'A') { geom = true; this.geomVersion++; }
    }
    return geom;
  }

  private smoothBuf: Float32Array | null = null;

  /**
   * One relaxation step over the cell graph (half own value, half the neighbours' mean). Cover fields interpolated
   * linearly across 50 m sim triangles crease along the triangle edges — long straight tonal seams on a hillside;
   * softening the cell-to-cell jumps first leaves the shader's noisy thresholds nothing straight to follow. Only
   * for COLOUR fields: heights, water and roads stay exact.
   */
  private smoothed(src: Float32Array, passes = 1): Float32Array {
    const g = this.pv.grid;
    const n = g.count;
    if (!this.smoothBuf || this.smoothBuf.length !== n) this.smoothBuf = new Float32Array(n);
    if (passes > 1 && (!this.smoothBuf2 || this.smoothBuf2.length !== n)) this.smoothBuf2 = new Float32Array(n);
    let from = src;
    let out = this.smoothBuf;
    for (let k = 0; k < passes; k++) {
      out = k % 2 === 0 ? this.smoothBuf : this.smoothBuf2!;
      for (let c = 0; c < n; c++) {
        const e0 = g.nbrStart[c], e1 = g.nbrStart[c + 1];
        let sum = 0;
        for (let e = e0; e < e1; e++) sum += from[g.nbr[e]];
        out[c] = 0.5 * from[c] + (0.5 * sum) / (e1 - e0);
      }
      from = out;
    }
    return out;
  }
  private smoothBuf2: Float32Array | null = null;

  private pack4(name: TexName, f: (FieldName | null)[], smooth: (boolean | number)[] = [false, false, false, false]): void {
    const d = this.tex[name].image.data as Float32Array;
    const n = this.pv.grid.count;
    for (let ch = 0; ch < 4; ch++) {
      const k = f[ch];
      let src = k ? this.field(k) : null;
      if (!src) { for (let c = 0; c < n; c++) d[c * 4 + ch] = ch === 0 && k === 'treeSpecies' ? -1 : 0; continue; }
      if (smooth[ch]) src = this.smoothed(src, typeof smooth[ch] === 'number' ? smooth[ch] as number : 1);
      for (let c = 0; c < n; c++) d[c * 4 + ch] = src[c];
    }
  }

  private fill(name: TexName): void {
    const g = this.pv.grid;
    const n = g.count;
    switch (name) {
      case 'A': {
        const d = this.tex.A.image.data as Float32Array;
        const s = this.field('surface'), soil = this.field('soil'), sand = this.field('sand'), snow = this.field('snow');
        const w = this.field('water');
        const wl = this.waterLevel, wd = this.waterDepth;
        for (let c = 0; c < n; c++) {
          const sc = s ? s[c] : 0;
          const wc = w ? w[c] : 0;
          d[c * 4] = sc;
          d[c * 4 + 1] = roughOf(soil ? soil[c] : 0, sand ? sand[c] : 0, snow ? snow[c] : 0);
          wd[c] = wc;
          d[c * 4 + 3] = wc;
        }
        // water level with flat shore extrapolation (see header)
        for (let c = 0; c < n; c++) {
          const sc = s ? s[c] : 0;
          if (wd[c] > WET) { wl[c] = sc + wd[c]; continue; }
          let sum = 0, k = 0;
          for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
            const o = g.nbr[e];
            if (wd[o] > WET) { sum += (s ? s[o] : 0) + wd[o]; k++; }
          }
          wl[c] = k > 0 ? Math.min(sum / k, sc - 0.05) : sc - 4;
        }
        for (let c = 0; c < n; c++) d[c * 4 + 2] = wl[c];
        break;
      }
      case 'N': {
        const d = this.tex.N.image.data as Float32Array;
        const s = this.field('surface');
        const R = this.pv.params.radius;
        const P = g.pos;
        const sv = this.pv.fieldVersion.get('surface') ?? 0;
        if (sv !== this.normalsStamp) {
          this.normalsStamp = sv;
          for (let c = 0; c < n; c++) {
            // concavity: snow drifts into hollows, rock breaks through on ridges (the shader reads it)
            let ms = 0;
            for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) ms += s ? s[g.nbr[e]] : 0;
            d[c * 4 + 3] = ms / (g.nbrStart[c + 1] - g.nbrStart[c]) - (s ? s[c] : 0);
            const rc = R + (s ? s[c] : 0);
            const cx = P[c * 3] * rc, cy = P[c * 3 + 1] * rc, cz = P[c * 3 + 2] * rc;
            let nx = 0, ny = 0, nz = 0;
            const e0 = g.nbrStart[c], e1 = g.nbrStart[c + 1];
            const deg = e1 - e0;
            for (let k = 0; k < deg; k++) {
              const a = g.nbr[e0 + k], b = g.nbr[e0 + ((k + 1) % deg)];
              const ra = R + (s ? s[a] : 0), rb = R + (s ? s[b] : 0);
              const ax = P[a * 3] * ra - cx, ay = P[a * 3 + 1] * ra - cy, az = P[a * 3 + 2] * ra - cz;
              const bx = P[b * 3] * rb - cx, by = P[b * 3 + 1] * rb - cy, bz = P[b * 3 + 2] * rb - cz;
              nx += ay * bz - az * by;
              ny += az * bx - ax * bz;
              nz += ax * by - ay * bx;
            }
            const l = Math.hypot(nx, ny, nz) || 1;
            // CCW neighbours around the outward normal give an outward cross product
            const sign = nx * P[c * 3] + ny * P[c * 3 + 1] + nz * P[c * 3 + 2] < 0 ? -1 : 1;
            d[c * 4] = (sign * nx) / l;
            d[c * 4 + 1] = (sign * ny) / l;
            d[c * 4 + 2] = (sign * nz) / l;
          }
        }
        break;
      }
      case 'M0': this.pack4('M0', ['snow', 'sand', 'soil', 'ash'], [true, true, true, true]); break;
      case 'M1': this.pack4('M1', ['lava', 'wetness', 'ice', 'burnt']); break;
      // vegetation and moisture vary cell to cell (a wood here, dry sward there): two passes, or the canopy / meadow
      // contrast reads as a 50 m camouflage pattern on every hill
      case 'V': this.pack4('V', ['grass', 'shrub', 'tree', 'crop'], [2, 2, 2, false]); break;
      case 'C': this.pack4('C', ['temperature', 'moisture', 'road', 'fire'], [true, 2, false, false]); break;
      case 'F': {
        this.pack4('F', ['flowX', 'flowY', 'flowZ', 'salinity']);
        const d = this.tex.F.image.data as Float32Array;
        for (let c = 0; c < n; c++) { d[c * 4] /= 60; d[c * 4 + 1] /= 60; d[c * 4 + 2] /= 60; }
        break;
      }
      case 'S': {
        this.pack4('S', ['treeSpecies', 'cropSpecies', null, 'biome']);
        // night lights: two relaxation passes so a town's glow is a soft pool, not a facet of the sim triangles; the
        // level compressed so a lit village still shows from orbit (a hamlet's few hearths vanished entirely) while a
        // city stays the brightest
        const L = this.light;
        if (L && L.length === n) {
          const d = this.tex.S.image.data as Float32Array;
          const sm = this.smoothed(L, 2);
          for (let c = 0; c < n; c++) { const x = sm[c]; d[c * 4 + 2] = x > 1e-4 ? Math.min(4, (2.2 * x) / (0.35 + x) + 0.25 * x) : 0; }
        }
        break;
      }
      case 'D': {
        // dune amplitude (m) from the RAW sand depth — part of the ground function, so never smoothed
        const d = this.tex.D.image.data as Float32Array;
        const sand = this.field('sand');
        for (let c = 0; c < n; c++) d[c * 4] = sand ? duneAmpOf(sand[c]) : 0;
        // surface wind (sea state): the sim's, relaxed once (gust fronts stay, cell facets go)
        const wx = this.field('windX'), wy = this.field('windY'), wz = this.field('windZ');
        const P = g.pos;
        if (wx && wy && wz) {
          for (const [ch, f] of [[1, wx], [2, wy], [3, wz]] as const) {
            const sm = this.smoothed(f, 1);
            for (let c = 0; c < n; c++) d[c * 4 + ch] = sm[c];
          }
        } else {
          // no wind field: easterly trades in the tropics, westerlies at mid latitudes, 3–11 m/s with broad gusty
          // swells (a few hundred metres) so the sea is not one uniform state
          for (let c = 0; c < n; c++) {
            const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
            const lat = Math.asin(Math.max(-1, Math.min(1, y)));
            const band = Math.cos(lat * 3);   // +1 trades (equator), −1 westerlies (~60°), +1 polar easterlies
            const gust = 0.5 + 0.5 * Math.sin(x * 9.1 + Math.sin(z * 7.3) * 2) * Math.sin(z * 8.3 + Math.sin(y * 6.1) * 2);
            const speed = 3 + 8 * gust * (0.6 + 0.4 * Math.abs(band));
            // east unit vector (−z, 0, x)/|..| in this frame's longitude convention (lon = atan2(x, z))
            let ex = z, ez = -x;
            const el = Math.hypot(ex, ez) || 1;
            ex /= el; ez /= el;
            const k = band >= 0 ? -1 : 1; // trades blow toward the west
            d[c * 4 + 1] = ex * speed * k;
            d[c * 4 + 2] = 0;
            d[c * 4 + 3] = ez * speed * k;
          }
        }
        break;
      }
      case 'G': {
        const d = this.tex.G.image.data as Float32Array;
        const s = this.field('surface');
        // the WorldView keeps pv.ground.grad in step with `surface`; derive it here only if a source never set it
        let g = this.pv.ground.grad as Float32Array | null | undefined;
        if (!g || g.length !== n * 4) g = s ? surfaceGradients(this.pv.grid, this.pv.params.radius, s) : null;
        if (g) d.set(g.subarray(0, n * 4)); else d.fill(0);
        break;
      }
    }
  }

  dispose(): void {
    for (const t of Object.values(this.tex)) t.dispose();
  }
}
