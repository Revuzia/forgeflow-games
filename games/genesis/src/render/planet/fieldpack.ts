// GENESIS — the field-texture packing (fieldtex.ts), as plain data in, plain arrays out: the SAME code runs on the main
// thread (the first fill at boot, node tests, a browser without module workers) and in the helper worker
// (fieldpack.worker.ts), so the bytes are identical either way. Moved off the main thread by macfix r1: the refills ran
// on every field arrival — about a third of a core at 100x, per-snapshot spikes of 25-170 ms, a hitch every few seconds
// at 1x (verify-r1-perf dp-after.ts). The texture layouts are documented in fieldtex.ts.

import type { FieldName } from '../../sim/types.ts';
import { curveMargin, duneAmpOf, MAX_GRAD, roughOf } from '../../sim/grid/surface.ts';
import type { IcoGrid } from '../../sim/grid/icogrid.ts';

export const FIELD_ROW = 256;
const WET = 0.02;

export type TexName = 'A' | 'W' | 'N' | 'M0' | 'M1' | 'V' | 'C' | 'F' | 'S' | 'G' | 'D' | 'O';
export const SOURCES: Record<TexName, FieldName[]> = {
  A: ['surface', 'soil', 'sand', 'snow', 'water'],
  // (after A: built from A's water level)
  W: ['surface', 'water'],
  N: ['surface'],
  M0: ['snow', 'sand', 'soil', 'ash'],
  M1: ['lava', 'wetness', 'ice', 'burnt'],
  V: ['grass', 'shrub', 'tree', 'crop'],
  C: ['temperature', 'moisture', 'road', 'fire'],
  F: ['flowX', 'flowY', 'flowZ', 'salinity'],
  S: ['treeSpecies', 'cropSpecies', 'biome'],
  G: ['surface'],
  D: ['sand', 'windX', 'windY', 'windZ'],
  O: ['ore', 'oreType'],
};
export const TEX_NAMES = Object.keys(SOURCES) as TexName[];

/** the parts of the grid the packing reads (a structured-clone-able copy goes to the worker once) */
export type PackGrid = Pick<IcoGrid, 'count' | 'pos' | 'nbrStart' | 'nbr' | 'meanEdgeAngle'>;

/** the ore palette (linear rgb and showing per ore, oreType − 1 indexes them) */
export interface OrePalette { rgb: [number, number, number][]; vis: number[] }

function oreRgb(p: OrePalette, type: number): [number, number, number] {
  const i = Math.round(type) - 1;
  if (i >= 0 && i < p.rgb.length) return p.rgb[i];
  const k = ((i * 0.618034) % 1 + 1) % 1;
  return [0.18 + 0.12 * k, 0.2 + 0.06 * (1 - k), 0.16 + 0.1 * k];
}
function oreVis(p: OrePalette, type: number): number {
  const i = Math.round(type) - 1;
  return i >= 0 && i < p.vis.length ? p.vis[i] : 0.9;
}

/**
 * Packs fields into the RGBA32F texture arrays `out` (and the CPU water arrays). Inputs are set on it before `fill`:
 * `fields` (the planet's current arrays), `surfaceVersion` (normals are recomputed only when it changes), `light`,
 * `palette`, `grad` (pv.ground.grad).
 */
export class FieldPacker {
  readonly grid: PackGrid;
  readonly R: number;
  readonly out: Record<TexName, Float32Array>;
  readonly waterLevel: Float32Array;
  readonly waterDepth: Float32Array;
  fields = new Map<FieldName, Float32Array>();
  surfaceVersion = 0;
  light: Float32Array | null = null;
  palette: OrePalette = { rgb: [], vis: [] };
  grad: Float32Array | null = null;
  private normalsStamp = -1;

  constructor(grid: PackGrid, R: number, out?: Record<TexName, Float32Array>, waterLevel?: Float32Array, waterDepth?: Float32Array) {
    this.grid = grid;
    this.R = R;
    const len = FIELD_ROW * Math.ceil(grid.count / FIELD_ROW) * 4;
    this.out = out ?? (Object.fromEntries(TEX_NAMES.map((k) => [k, new Float32Array(len)])) as Record<TexName, Float32Array>);
    this.waterLevel = waterLevel ?? new Float32Array(grid.count);
    this.waterDepth = waterDepth ?? new Float32Array(grid.count);
  }

  private field(f: FieldName): Float32Array | null {
    return this.fields.get(f) ?? null;
  }

  private smoothBuf: Float32Array | null = null;
  private smoothBuf2: Float32Array | null = null;

  /**
   * One relaxation step over the cell graph (half own value, half the neighbours' mean). Cover fields interpolated
   * linearly across 50 m sim triangles crease along the triangle edges — long straight tonal seams on a hillside;
   * softening the cell-to-cell jumps first leaves the shader's noisy thresholds nothing straight to follow. Only
   * for COLOUR fields: heights, water and roads stay exact.
   */
  private smoothed(src: Float32Array, passes = 1): Float32Array {
    const g = this.grid;
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

  private pack4(name: TexName, f: (FieldName | null)[], smooth: (boolean | number)[] = [false, false, false, false]): void {
    const d = this.out[name];
    const n = this.grid.count;
    for (let ch = 0; ch < 4; ch++) {
      const k = f[ch];
      let src = k ? this.field(k) : null;
      if (!src) { for (let c = 0; c < n; c++) d[c * 4 + ch] = ch === 0 && k === 'treeSpecies' ? -1 : 0; continue; }
      if (smooth[ch]) src = this.smoothed(src, typeof smooth[ch] === 'number' ? smooth[ch] as number : 1);
      for (let c = 0; c < n; c++) d[c * 4 + ch] = src[c];
    }
  }

  /** fill texture `name` from the current inputs (W reads the water level A left: fill A first) */
  fill(name: TexName): void {
    const g = this.grid;
    const n = g.count;
    switch (name) {
      case 'A': {
        const d = this.out.A;
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
        // water level with flat shore extrapolation (fieldtex.ts header). An inland cell (no wet neighbour) sits under
        // its ground by more than the curved surface can sag below its cells' chord (twice curveMargin at the steepest
        // gradient: the sag grows from zero at a cell as fast as the margin does): at the 4 m it had, a triangle from
        // a river's bank cell up a concave cliff (bank 26 m, inland cells 80-115 m) tilted the level's chord up the
        // cliff while the curved ground dipped 20-30 m under the cells' own heights — a glass pane of water standing
        // on the cliff with trees inside it (lookdev valley). Nothing else reads an inland cell's level.
        const inland = 4 + 2 * curveMargin(g as IcoGrid, this.R, MAX_GRAD);
        for (let c = 0; c < n; c++) {
          const sc = s ? s[c] : 0;
          if (wd[c] > WET) { wl[c] = sc + wd[c]; continue; }
          let sum = 0, k = 0;
          for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
            const o = g.nbr[e];
            if (wd[o] > WET) { sum += (s ? s[o] : 0) + wd[o]; k++; }
          }
          wl[c] = k > 0 ? Math.min(sum / k, sc - 0.05) : sc - inland;
        }
        for (let c = 0; c < n; c++) d[c * 4 + 2] = wl[c];
        break;
      }
      case 'W': this.fillSurge(); break;
      case 'N': {
        const d = this.out.N;
        const s = this.field('surface');
        const R = this.R;
        const P = g.pos;
        const sv = this.surfaceVersion;
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
      case 'C': {
        this.pack4('C', ['temperature', 'moisture', 'road', 'fire'], [true, 2, false, false]);
        // a LONE burning cell (no neighbour carrying the front level 0.25) is packed NEGATIVE: the terrain then draws
        // scattered coals and char round it instead of the front contour, which around a single peak of the field is
        // a perfect glowing circle about a black disc (a portal, not a fire). Only the terrain reads this channel.
        const fire = this.field('fire');
        if (fire) {
          const d = this.out.C;
          for (let c = 0; c < n; c++) {
            if (fire[c] < 0.25) continue;
            let lone = true;
            for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1] && lone; e++) if (fire[g.nbr[e]] >= 0.25) lone = false;
            if (lone) d[c * 4 + 3] = -1;
          }
        }
        break;
      }
      case 'F': {
        this.pack4('F', ['flowX', 'flowY', 'flowZ', 'salinity']);
        const d = this.out.F;
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
          const d = this.out.S;
          const sm = this.smoothed(L, 2);
          for (let c = 0; c < n; c++) { const x = sm[c]; d[c * 4 + 2] = x > 1e-4 ? Math.min(4, (2.2 * x) / (0.35 + x) + 0.25 * x) : 0; }
        }
        break;
      }
      case 'D': {
        // dune amplitude (m) from the RAW sand depth — part of the ground function, so never smoothed
        const d = this.out.D;
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
            // (the belts turn through calm — the horse latitudes — instead of flipping: a sign switch at the belts' edge
            // reversed the sea state's direction along a line, drawn across every ocean as a wavy seam in the glint)
            const speed = (1 + 10 * gust) * Math.min(1, Math.abs(band) * 2.5);
            // east unit vector (−z, 0, x)/|..| in this frame's longitude convention (lon = atan2(x, z))
            let ex = z, ez = -x;
            const el = Math.hypot(ex, ez) || 1;
            ex /= el; ez /= el;
            const k = -Math.sign(band); // trades blow toward the west
            d[c * 4 + 1] = ex * speed * k;
            d[c * 4 + 2] = 0;
            d[c * 4 + 3] = ez * speed * k;
          }
        }
        break;
      }
      case 'O': {
        const d = this.out.O;
        const ore = this.field('ore'), ty = this.field('oreType');
        const pal = this.palette;
        for (let c = 0; c < n; c++) {
          const a = ore && ty && ty[c] > 0 ? Math.max(0, Math.min(1, ore[c])) * oreVis(pal, ty[c]) : 0;
          const rgb = a > 0 ? oreRgb(pal, ty![c]) : pal.rgb[0] ?? [0, 0, 0];
          d[c * 4] = rgb[0] * a; d[c * 4 + 1] = rgb[1] * a; d[c * 4 + 2] = rgb[2] * a; d[c * 4 + 3] = a;
        }
        break;
      }
      case 'G': {
        const d = this.out.G;
        const gr = this.grad;
        if (gr && gr.length >= n * 4) d.set(gr.subarray(0, n * 4)); else d.fill(0);
        break;
      }
    }
  }

  /**
   * fillSurge's geometry, which depends only on the grid and the radius: each cell's tangent basis and each edge's
   * neighbour offset (u, v) in it. Float64 and the same expressions as before, so W is bit-identical.
   */
  private surgeGeo: { t: Float64Array; uv: Float64Array } | null = null;
  private surgeGeometry(): { t: Float64Array; uv: Float64Array } {
    if (this.surgeGeo) return this.surgeGeo;
    const g = this.grid;
    const R = this.R;
    const n = g.count;
    const P = g.pos;
    const t = new Float64Array(n * 6);
    const uv = new Float64Array(g.nbrStart[n] * 2);
    for (let c = 0; c < n; c++) {
      const px = P[c * 3], py = P[c * 3 + 1], pz = P[c * 3 + 2];
      // tangent basis at the cell
      let ax = 1, ay = 0, az = 0;
      if (Math.abs(px) > 0.8) { ax = 0; ay = 1; }
      let t1x = py * az - pz * ay, t1y = pz * ax - px * az, t1z = px * ay - py * ax;
      const l1 = Math.hypot(t1x, t1y, t1z);
      t1x /= l1; t1y /= l1; t1z /= l1;
      const t2x = py * t1z - pz * t1y, t2y = pz * t1x - px * t1z, t2z = px * t1y - py * t1x;
      t[c * 6] = t1x; t[c * 6 + 1] = t1y; t[c * 6 + 2] = t1z; t[c * 6 + 3] = t2x; t[c * 6 + 4] = t2y; t[c * 6 + 5] = t2z;
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
        const o = g.nbr[e];
        const dx0 = (P[o * 3] - px) * R, dy0 = (P[o * 3 + 1] - py) * R, dz0 = (P[o * 3 + 2] - pz) * R;
        uv[e * 2] = dx0 * t1x + dy0 * t1y + dz0 * t1z;
        uv[e * 2 + 1] = dx0 * t2x + dy0 * t2y + dz0 * t2z;
      }
    }
    this.surgeGeo = { t, uv };
    return this.surgeGeo;
  }

  /**
   * W: the water level's own slope per CELL — x = excess (|grad level| less the bed's slope along it, m/m: a surge face where
   * it is clearly positive), yzw = the level's gradient (body frame, m/m, tangent). Least-squares over the cell's wet
   * neighbours. The ocean once took this slope from screen derivatives of the level, which is linear over each 50 m sim
   * triangle: its slope jumped at every triangle edge and whole triangles of a wave's face switched to white (flat foam
   * polygons with straight edges). Interpolated from the cells' values it is continuous, so the foam follows contours.
   */
  private fillSurge(): void {
    const g = this.grid;
    const n = g.count;
    const d = this.out.W;
    const s = this.field('surface');
    const wl = this.waterLevel, wd = this.waterDepth;
    d.fill(0);
    if (!s) return;
    const { t, uv } = this.surgeGeometry();
    for (let c = 0; c < n; c++) {
      if (wd[c] <= WET) continue;
      let sxx = 0, sxy = 0, syy = 0, sxw = 0, syw = 0, sxb = 0, syb = 0, k = 0;
      const wc = wl[c], sc = s[c];
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
        const o = g.nbr[e];
        if (wd[o] <= WET) continue;
        const u = uv[e * 2], v = uv[e * 2 + 1];
        const dw = wl[o] - wc, db = s[o] - sc;
        sxx += u * u; sxy += u * v; syy += v * v;
        sxw += u * dw; syw += v * dw; sxb += u * db; syb += v * db;
        k++;
      }
      if (k < 3) continue;
      const det = sxx * syy - sxy * sxy;
      if (det <= 1e-9 * (sxx * syy + 1e-9)) continue;
      const gwu = (syy * sxw - sxy * syw) / det, gwv = (sxx * syw - sxy * sxw) / det;
      const gbu = (syy * sxb - sxy * syb) / det, gbv = (sxx * syb - sxy * sxb) / det;
      // (the bed's slope only excuses the part of the level's tilt that leans WITH it — a river running down its bed; a
      // still sea over a shelving bed is flat, and a wave's face over that shelf owes nothing to the bed)
      const gw = Math.hypot(gwu, gwv);
      d[c * 4] = gw > 1e-6 ? gw - Math.max(0, gwu * gbu + gwv * gbv) / gw : 0;
      d[c * 4 + 1] = gwu * t[c * 6] + gwv * t[c * 6 + 3];
      d[c * 4 + 2] = gwu * t[c * 6 + 1] + gwv * t[c * 6 + 4];
      d[c * 4 + 3] = gwu * t[c * 6 + 2] + gwv * t[c * 6 + 5];
    }
  }
}

// ---- the worker protocol (fieldpack.worker.ts runs handlePackMessage; tests run it in-process) ----

export type PackRequest =
  | { k: 'init'; id: number; grid: PackGrid; R: number }
  | { k: 'job'; id: number; seq: number; names: TexName[]; fields: [FieldName, Float32Array][]; surfaceVersion: number; light: Float32Array | null; palette: OrePalette | null }
  | { k: 'drop'; id: number };
export interface PackReply { id: number; seq: number; out: [TexName, Float32Array][]; waterLevel: Float32Array | null; waterDepth: Float32Array | null }

/** one worker's packers (one per planet), keyed by id */
export type PackState = Map<number, FieldPacker>;

/** handle one request; a job's reply (copies, whose buffers can be transferred) is returned, with its transfer list */
export function handlePackMessage(state: PackState, m: PackRequest): { reply: PackReply; transfer: ArrayBuffer[] } | null {
  if (m.k === 'init') { state.set(m.id, new FieldPacker(m.grid, m.R)); return null; }
  if (m.k === 'drop') { state.delete(m.id); return null; }
  const p = state.get(m.id);
  if (!p) return null;
  for (const [f, a] of m.fields) p.fields.set(f, a);
  p.surfaceVersion = m.surfaceVersion;
  if (m.light) p.light = m.light;
  if (m.palette) p.palette = m.palette;
  const out: [TexName, Float32Array][] = [];
  const transfer: ArrayBuffer[] = [];
  for (const name of m.names) {
    p.fill(name);
    const copy = p.out[name].slice();
    out.push([name, copy]);
    transfer.push(copy.buffer);
  }
  let waterLevel: Float32Array | null = null, waterDepth: Float32Array | null = null;
  if (m.names.includes('A')) {
    waterLevel = p.waterLevel.slice(); waterDepth = p.waterDepth.slice();
    transfer.push(waterLevel.buffer, waterDepth.buffer);
  }
  return { reply: { id: m.id, seq: m.seq, out, waterLevel, waterDepth }, transfer };
}
