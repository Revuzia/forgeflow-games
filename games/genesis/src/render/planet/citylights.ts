// GENESIS — night lights seen from afar (CONTRACT.md §15.4 "night-side city lights from the `light` channel").
//
// A per-planet cube texture (body-frame direction, like dirtex.ts) SPLATTED from real geometry, rebuilt when the lit
// buildings or the roads change: every lit building of the snapshot's BuildingBlock (its light kind and level, the
// settlement's fire gate) and every road chain of render/life/roadnet.ts over the sim's `road` wear field. A town at
// night from orbit is then what it is — houses strung along its streets, lamp-lit streets in the lamp eras, dim
// arterial roads between towns — instead of a procedural noise net inside the settled patch (a maze, brain coral).
//   R  warm light (hearths, oil lamps, fires)     G  cool light (gas, electric)
//   B  lit streets (lamps along the chains)        A  a broad glow (σ ≈ 3 texels) of all of it: the aura a few
//                                                     hearths need to read from orbit, and what the far LOD averages
// Values are stored as sqrt(v / VMAX) in RGBA8 (a 100:1 range from a hamlet's hearths to a city core) with mipmaps;
// the terrain shows s itself, compressed (terrainmat.ts FRAG_EMISSIVE), so mip filtering averages what is displayed.

import { CubeTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, UnsignedByteType, ClampToEdgeWrapping, type WebGLRenderer } from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import { BuildingFlag } from '../../sim/types.ts';
import { extractRoads } from '../life/roadnet.ts';
import { buildingAt } from '../life/catalog.ts';

/** the encoding's top value (stored sqrt(v / CITY_VMAX)) */
export const CITY_VMAX = 6;
const ROAD_MIN = 0.3;
// (a growing town changes its lights every few seconds; from afar a few seconds' lag is invisible, a hitch is not)
const REBUILD_MS = 6000;
/** upload granularity of a rebuild (texels; PERF F2b) */
const TILE = 32;

/** the renderer (set by Renderer): a rebuild then uploads only the texels it re-encoded (perf 2026-11) */
let glRenderer: WebGLRenderer | null = null;
export function setCityLightsRenderer(r: WebGLRenderer | null): void { glRenderer = r; }

export class CityLights {
  readonly size: number;
  readonly texture: CubeTexture;
  private faces: DataTexture[] = [];
  /** per face: 4 floats per texel */
  private acc: Float32Array[] = [];
  /** per face, the texel rectangle holding anything (x0, y0, x1, y1; empty when x1 < x0): only it is cleared and
   *  re-encoded (with last build's), so a rebuild costs the settlements' area, not six whole faces */
  private box = new Int32Array(24);
  private tileMark = new Uint8Array(4096);
  private stamp = '';
  private builtAt = -1e9;
  private kindCell: Uint8Array | null = null;
  private kindTmp: Uint8Array | null = null;

  constructor(radius: number) {
    // ~6 m texels: a house a dot, a street a line one texel wide, the blocks between them dark from orbit (at 9 m the
    // houses of a street merged into one bright bar). WebGL2 mipmaps any size; a multiple of 64 keeps the chain tidy
    const want = (radius * Math.PI * 0.5) / 6;
    this.size = Math.max(128, Math.min(1024, Math.round(want / 64) * 64));
    const s = this.size;
    for (let f = 0; f < 6; f++) { this.box[f * 4] = s; this.box[f * 4 + 1] = s; this.box[f * 4 + 2] = -1; this.box[f * 4 + 3] = -1; }
    for (let f = 0; f < 6; f++) {
      const dt = new DataTexture(new Uint8Array(s * s * 4), s, s, RGBAFormat, UnsignedByteType);
      this.faces.push(dt);
      this.acc.push(new Float32Array(s * s * 4));
    }
    this.texture = new CubeTexture(this.faces as unknown as HTMLImageElement[]);
    this.texture.format = RGBAFormat;
    this.texture.type = UnsignedByteType;
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.generateMipmaps = true;
    this.texture.flipY = false;
    this.texture.needsUpdate = true;
  }

  /** rebuild from the planet's buildings and roads when they changed (throttled); `cellLight` = the life layer's per-cell light */
  update(pv: PlanetView, cellLight: Float32Array | null, lightVersion: number): boolean {
    const st = `${lightVersion}|${pv.fieldVersion.get('road') ?? 0}|${pv.buildings ? pv.buildings.count : 0}|${pv.settlements.length}`;
    if (st === this.stamp) return false;
    const now = performance.now();
    if (this.stamp !== '' && now - this.builtAt < REBUILD_MS) return false;
    this.stamp = st;
    this.builtAt = now;
    this.rebuild(pv, cellLight);
    return true;
  }

  private rebuild(pv: PlanetView, cellLight: Float32Array | null): void {
    const s = this.size;
    const was = this.box.slice();
    for (let f = 0; f < 6; f++) {
      const x0 = was[f * 4], y0 = was[f * 4 + 1], x1 = was[f * 4 + 2], y1 = was[f * 4 + 3];
      if (x1 >= x0) for (let y = y0; y <= y1; y++) this.acc[f].fill(0, (y * s + x0) * 4, (y * s + x1 + 1) * 4);
      this.box[f * 4] = s; this.box[f * 4 + 1] = s; this.box[f * 4 + 2] = -1; this.box[f * 4 + 3] = -1;
    }
    const g = pv.grid;
    const n = g.count;
    const R = pv.params.radius;
    if (!this.kindCell || this.kindCell.length !== n) { this.kindCell = new Uint8Array(n); this.kindTmp = new Uint8Array(n); }
    const kc = this.kindCell, kt = this.kindTmp!;
    kc.fill(0);
    // ── lit buildings ──
    const B = pv.buildings;
    if (B) {
      const nl = new Map<number, number>();
      for (const v of pv.settlements) nl.set(v.id, v.nightLight);
      for (let i = 0; i < B.count; i++) {
        const flags = B.flags[i];
        if (flags & BuildingFlag.ruined) continue;
        const x = B.pos[i * 3], y = B.pos[i * 3 + 1], z = B.pos[i * 3 + 2];
        const l = Math.hypot(x, y, z) || 1;
        const ux = x / l, uy = y / l, uz = z / l;
        if (flags & BuildingFlag.burning) {
          this.splat(ux, uy, uz, 0, 2.2, 0.9);
          this.splat(ux, uy, uz, 3, 1.6, 3.0);
          continue;
        }
        if (B.progress[i] < 0.999) continue;
        // walls, gates, pens and docks show no window light (render/life/buildings.ts): lit, a walled town's ramparts
        // drew its outline as a bright frame from orbit
        const bk = buildingAt(B.type[i]).kind;
        if (bk === 'wall' || bk === 'gate' || bk === 'pen' || bk === 'dock' || bk === 'tower') continue;
        const light = B.light[i];
        const kind = Math.floor(light / 256), level = (light % 256) / 255;
        // (render/life/buildings.ts effectiveLight: a hearth-age people keeping no fire shows none)
        const gate = (nl.get(B.settlement[i]) ?? 1) > 0 || (flags & BuildingFlag.lit) !== 0 || kind > 1;
        const lit = gate && ((flags & BuildingFlag.lit) !== 0 || level > 0.01);
        if (!lit) continue;
        const sc = B.scale[i] || 1;
        const p = Math.max(level, 0.35) * (kind >= 4 ? 1.6 : kind === 3 ? 1.2 : kind === 2 ? 0.9 : 0.6) * Math.min(2.2, 0.6 + 0.6 * sc * sc);
        this.splat(ux, uy, uz, kind >= 3 ? 1 : 0, p, 0.6);
        this.splat(ux, uy, uz, 3, p * 0.6, 3.0);
        const c = g.nearestCell(ux, uy, uz);
        if (kind > kc[c]) kc[c] = kind;
      }
    }
    // the light era near each cell (three rings): streets get lamps, roads out of town a dim line
    for (let pass = 0; pass < 3; pass++) {
      kt.set(kc);
      for (let c = 0; c < n; c++) {
        let m = kt[c];
        for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) if (kt[g.nbr[e]] > m) m = kt[g.nbr[e]];
        kc[c] = m;
      }
    }
    // ── streets and roads ──
    const road = pv.fields.get('road');
    if (road) {
      const cells: number[] = [];
      for (let c = 0; c < n; c++) if (road[c] >= ROAD_MIN) cells.push(c);
      if (cells.length > 1) {
        const texM = (R * Math.PI * 0.5) / s;
        const step = Math.max(2, texM * 0.6);
        const chains = extractRoads(g, road, cells, R, ROAD_MIN, step);
        for (const ch of chains) {
          const m = ch.wear.length;
          for (let k = 0; k < m; k++) {
            const ux = ch.pts[k * 3], uy = ch.pts[k * 3 + 1], uz = ch.pts[k * 3 + 2];
            const c = g.nearestCell(ux, uy, uz);
            const kind = kc[c];
            if (kind < 1) continue;
            const w = Math.min(1, Math.max(0, (ch.wear[k] - ROAD_MIN) / 0.5) + 0.2);
            // inside a town (its own light is high) a street is lit by its lamps (from the oil-lamp era) or by the
            // houses along it; out of town only the lamp eras leave a dim line along the way
            const town = cellLight ? Math.min(1, cellLight[c] / 1.2) : 0.5;
            const lamp = kind >= 2 ? (kind >= 4 ? 1.0 : kind === 3 ? 0.7 : 0.45) : 0.12;
            const p = w * lamp * (0.06 + 0.5 * town) * (step / 8);
            if (p > 0.002) this.splat(ux, uy, uz, 2, p, 0.5);
          }
        }
      }
    }
    // ── encode ──
    const dirty: number[] = [];
    for (let f = 0; f < 6; f++) {
      const b = this.box;
      const x0 = Math.min(b[f * 4], was[f * 4]), y0 = Math.min(b[f * 4 + 1], was[f * 4 + 1]);
      const x1 = Math.max(b[f * 4 + 2], was[f * 4 + 2]), y1 = Math.max(b[f * 4 + 3], was[f * 4 + 3]);
      if (x1 < x0) continue;
      const a = this.acc[f];
      const d = this.faces[f].image.data as Uint8Array;
      // PERF F2b: only the TILE x TILE tiles whose bytes really changed are uploaded (the union box of a face's
      // lights spans most of the face once a world has towns all over it: two whole faces, 4.6 MB, per rebuild)
      const nt = Math.ceil(s / TILE);
      const tiles = this.tileMark;
      tiles.fill(0, 0, nt * nt);
      for (let y = y0; y <= y1; y++) {
        const trow = ((y / TILE) | 0) * nt;
        for (let x = x0; x <= x1; x++) {
          const i = (y * s + x) * 4;
          let ch = false;
          for (let k = 0; k < 4; k++) {
            const v = a[i + k];
            const q = v <= 0 ? 0 : v >= CITY_VMAX ? 255 : Math.round(Math.sqrt(v / CITY_VMAX) * 255);
            if (d[i + k] !== q) { d[i + k] = q; ch = true; }
          }
          if (ch) tiles[trow + ((x / TILE) | 0)] = 1;
        }
      }
      // runs of changed tiles along each tile row, one upload rectangle each
      for (let ty = 0; ty < nt; ty++) {
        for (let tx = 0; tx < nt; tx++) {
          if (!tiles[ty * nt + tx]) continue;
          let te = tx;
          while (te + 1 < nt && tiles[ty * nt + te + 1]) te++;
          dirty.push(f, tx * TILE, ty * TILE, Math.min(s - 1, te * TILE + TILE - 1), Math.min(s - 1, ty * TILE + TILE - 1));
          tx = te;
        }
      }
    }
    if (!this.uploadDirty(dirty)) this.texture.needsUpdate = true;
  }

  /**
   * Upload only the re-encoded boxes of the cube (union of last build's lights and this one's) and rebuild its mips:
   * a whole re-upload was 6 × size² × 4 bytes (14 MB on a 3 km world, every ≤ 6 s while the lights change) plus
   * three's full-cube mip pass. The texels outside the boxes are what the GPU already holds, so the texture is the
   * same. False (the caller falls back to needsUpdate) before three's first upload or without the renderer.
   */
  private uploadDirty(dirty: number[]): boolean {
    const r = glRenderer;
    if (!r) return false;
    const props = r.properties.get(this.texture) as { __webglTexture?: WebGLTexture; __version?: number };
    if (!props.__webglTexture || props.__version !== this.texture.version) return false;
    const gl = r.getContext() as WebGL2RenderingContext;
    const s = this.size;
    r.state.bindTexture(gl.TEXTURE_CUBE_MAP, props.__webglTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, s);
    for (let i = 0; i < dirty.length; i += 5) {
      const f = dirty[i], x0 = dirty[i + 1], y0 = dirty[i + 2], x1 = dirty[i + 3], y1 = dirty[i + 4];
      const d = this.faces[f].image.data as Uint8Array;
      gl.texSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1, gl.RGBA, gl.UNSIGNED_BYTE, d, (y0 * s + x0) * 4);
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    if (dirty.length) gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    return true;
  }

  /** add a Gaussian (σ in texels, amplitude so the splat's integral is `power` texel²-units / 2πσ² at its peak) */
  private splat(ux: number, uy: number, uz: number, ch: number, power: number, sigma: number): void {
    const s = this.size;
    const r = Math.ceil(sigma * 2.2);
    const margin = (2 * (r + 1)) / s;
    const amp = power / (2 * Math.PI * sigma * sigma);
    const inv = 1 / (2 * sigma * sigma);
    const ax = Math.abs(ux), ay = Math.abs(uy), az = Math.abs(uz);
    const mx = Math.max(ax, ay, az);
    for (let f = 0; f < 6; f++) {
      // project on every face the point lies in front of and near (a splat straddling an edge lands on both faces)
      let ma: number, sc: number, tc: number;
      switch (f) {
        case 0: ma = ux; sc = -uz; tc = -uy; break;
        case 1: ma = -ux; sc = uz; tc = -uy; break;
        case 2: ma = uy; sc = ux; tc = uz; break;
        case 3: ma = -uy; sc = ux; tc = -uz; break;
        case 4: ma = uz; sc = ux; tc = -uy; break;
        default: ma = -uz; sc = -ux; tc = -uy; break;
      }
      if (ma <= 0.5 * mx) continue;
      sc /= ma; tc /= ma;
      if (sc < -1 - margin || sc > 1 + margin || tc < -1 - margin || tc > 1 + margin) continue;
      const fx = ((sc + 1) * 0.5) * s - 0.5, fy = ((tc + 1) * 0.5) * s - 0.5;
      const x0 = Math.max(0, Math.ceil(fx - r)), x1 = Math.min(s - 1, Math.floor(fx + r));
      const y0 = Math.max(0, Math.ceil(fy - r)), y1 = Math.min(s - 1, Math.floor(fy + r));
      if (x0 > x1 || y0 > y1) continue;
      const a = this.acc[f];
      for (let y = y0; y <= y1; y++) {
        const dy = y - fy;
        for (let x = x0; x <= x1; x++) {
          const dx = x - fx;
          const w = Math.exp(-(dx * dx + dy * dy) * inv);
          if (w < 0.01) continue;
          a[(y * s + x) * 4 + ch] += amp * w;
        }
      }
      const bx = this.box;
      if (x0 < bx[f * 4]) bx[f * 4] = x0;
      if (y0 < bx[f * 4 + 1]) bx[f * 4 + 1] = y0;
      if (x1 > bx[f * 4 + 2]) bx[f * 4 + 2] = x1;
      if (y1 > bx[f * 4 + 3]) bx[f * 4 + 3] = y1;
    }
  }

  dispose(): void {
    this.texture.dispose();
  }
}
