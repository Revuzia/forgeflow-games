// GENESIS — sim fields → GPU data textures (CONTRACT.md §15.4).
//
// RGBA32F textures, 256 cells per row, cell c at texel (c & 255, c >> 8). The terrain / water vertex shaders fetch the
// three cells of each render vertex and interpolate. Packing (one texture each):
//   A  surface, rough (= roughOf(soil, sand, snow) from src/sim/grid/surface.ts — the SAME function the CPU ground
//      uses), waterLevel (see below), waterDepth
//   N  per-cell normal (body frame, from neighbour heights, recomputed only when `surface` changes), flow speed m/s
//   M0 snow, sand, soil, ash          M1 lava, wetness, ice, burnt
//   V  grass, shrub, tree, crop       C  temperature, moisture, road, fire
//   F  flow velocity (m/s, body frame), salinity
//   S  treeSpecies, cropSpecies, light (night lights, reserved), biome
// Each texture is rebuilt only when one of its source fields' versions changed (WorldView bumps them per arrival).
//
// waterLevel: wet cells carry their true water surface; dry cells next to water carry the wet neighbours' mean level
// clamped just under their own ground, so the water sheet stays FLAT up to the true shoreline (the terrain's depth
// test draws the coast) instead of sloping up the beach; dry inland cells sit well under the ground (no water).

import { DataTexture, FloatType, NearestFilter, RGBAFormat, ClampToEdgeWrapping } from 'three';
import type { FieldName } from '../../sim/types.ts';
import type { PlanetView } from '../../client/worldview.ts';
import { roughOf } from '../../sim/grid/surface.ts';

export const FIELD_ROW = 256;
const WET = 0.02;

type TexName = 'A' | 'N' | 'M0' | 'M1' | 'V' | 'C' | 'F' | 'S';
const SOURCES: Record<TexName, FieldName[]> = {
  A: ['surface', 'soil', 'sand', 'snow', 'water'],
  N: ['surface', 'flowX', 'flowY', 'flowZ'],
  M0: ['snow', 'sand', 'soil', 'ash'],
  M1: ['lava', 'wetness', 'ice', 'burnt'],
  V: ['grass', 'shrub', 'tree', 'crop'],
  C: ['temperature', 'moisture', 'road', 'fire'],
  F: ['flowX', 'flowY', 'flowZ', 'salinity'],
  S: ['treeSpecies', 'cropSpecies', 'biome'],
};

export class FieldTextures {
  readonly rows: number;
  readonly tex: Record<TexName, DataTexture>;
  /** CPU copies used by the chunk system for bounds / water presence (same arrays as the textures) */
  readonly waterLevel: Float32Array;
  readonly waterDepth: Float32Array;
  private stamps: Record<TexName, string> = { A: '', N: '', M0: '', M1: '', V: '', C: '', F: '', S: '' };
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
    this.tex = { A: mk(), N: mk(), M0: mk(), M1: mk(), V: mk(), C: mk(), F: mk(), S: mk() };
    this.waterLevel = new Float32Array(count);
    this.waterDepth = new Float32Array(count);
  }

  private stamp(name: TexName): string {
    let s = '';
    for (const f of SOURCES[name]) s += (this.pv.fieldVersion.get(f) ?? 0) + ',';
    return s;
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

  private pack4(name: TexName, f: (FieldName | null)[]): void {
    const d = this.tex[name].image.data as Float32Array;
    const n = this.pv.grid.count;
    for (let ch = 0; ch < 4; ch++) {
      const k = f[ch];
      const src = k ? this.field(k) : null;
      if (!src) { for (let c = 0; c < n; c++) d[c * 4 + ch] = ch === 0 && k === 'treeSpecies' ? -1 : 0; continue; }
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
        const fx = this.field('flowX'), fy = this.field('flowY'), fz = this.field('flowZ');
        for (let c = 0; c < n; c++) {
          // flow arrives in m/tick (1 tick = 1 game minute); shaders want m/s of the river surface
          d[c * 4 + 3] = fx && fy && fz ? Math.hypot(fx[c], fy[c], fz[c]) / 60 : 0;
        }
        break;
      }
      case 'M0': this.pack4('M0', ['snow', 'sand', 'soil', 'ash']); break;
      case 'M1': this.pack4('M1', ['lava', 'wetness', 'ice', 'burnt']); break;
      case 'V': this.pack4('V', ['grass', 'shrub', 'tree', 'crop']); break;
      case 'C': this.pack4('C', ['temperature', 'moisture', 'road', 'fire']); break;
      case 'F': {
        this.pack4('F', ['flowX', 'flowY', 'flowZ', 'salinity']);
        const d = this.tex.F.image.data as Float32Array;
        for (let c = 0; c < n; c++) { d[c * 4] /= 60; d[c * 4 + 1] /= 60; d[c * 4 + 2] /= 60; }
        break;
      }
      case 'S': this.pack4('S', ['treeSpecies', 'cropSpecies', null, 'biome']); break;
    }
  }

  dispose(): void {
    for (const t of Object.values(this.tex)) t.dispose();
  }
}
