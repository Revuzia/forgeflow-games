// GENESIS — the ONE definition of "where is the ground" (CONTRACT.md §4.3).
//
// ground(p) = radius + S(p) + detailNoise(p) · Σ w_i · rough(c_i) + duneNoise(p) · Σ w_i · duneAmp(c_i)
//
// S(p) is the cell `surface` field interpolated over the sim triangle (c_a, c_b, c_c) that contains p, with planar
// barycentric weights w_i. A plain linear blend makes every 50 m sim triangle a flat facet (straight seams on every
// hillside), so S is CURVED, Phong-tessellation style: each cell also carries the tangent-plane gradient g_i of the
// surface (fitted to its neighbours), and
//
//   S(p) = (1 − α) · Σ w_i h_i  +  α · Σ w_i · (h_i + g_i · (p − p_i)·R)          α = CURVE_ALPHA
//        = Σ w_i h_i  +  α · Σ w_i · R · (g_i · p + gw_i)                           gw_i = −g_i · p̂_i
//
// The second form is what is stored and evaluated (g_i and gw_i packed per cell as 4 floats). Along a triangle edge
// only the edge's two cells have weight, so S is continuous across edges and identical from both sides: no cracks.
// At a cell centre S = h_i exactly. Gradient magnitudes are capped (MAX_GRAD) so cliffs do not overshoot.
//
// The sim (placing agents, buildings, impacts) and the renderer (terrain + water vertex shaders, CPU placement of
// trees, picking, the camera) all evaluate this same formula, so feet meet the drawn ground. The terrain shader
// mirrors `roughOf` and `curvedSurface` in GLSL (render/planet/terrainvert.glsl.ts) reading the same per-cell arrays
// from field textures; tests/ground.test.ts checks the two agree.

import type { IcoGrid, GridHit } from './icogrid.ts';
import { newHit } from './icogrid.ts';
import { detailNoise, duneNoise, type Noise3 } from './noise.ts';

export interface GroundSource {
  grid: IcoGrid;
  radius: number;
  noise: Noise3;
  surface: ArrayLike<number>;
  soil: ArrayLike<number>;
  sand: ArrayLike<number>;
  snow: ArrayLike<number>;
  /**
   * per-cell curvature data from surfaceGradients(): 4 floats per cell (gx, gy, gz, gw). When absent (or null) the
   * surface falls back to the linear blend.
   */
  grad?: ArrayLike<number> | null;
}

/** Roughness constants (mirrored in the terrain shader). */
export const ROUGH = { rock: 1.0, soilDepth: 1.5, soilK: 0.5, sandDepth: 0.6, sandK: 0.75, snowDepth: 0.4, snowK: 0.7, min: 0.12 } as const;

/** Dune amplitude constants (mirrored in render/planet/fieldtex.ts via duneAmpOf): sand deeper than `onset` metres
 * builds dunes `gain` metres tall per metre of extra sand, up to `max` (crest to trough). */
export const DUNE = { onset: 0.4, gain: 0.45, max: 1.8 } as const;

/** Dune height (m, crest to trough) a cell's sand can build: none on beaches and thin drifts, ~1.5 m in a sand sea. */
export function duneAmpOf(sand: number): number {
  const a = (sand - DUNE.onset) * DUNE.gain;
  return a <= 0 ? 0 : a > DUNE.max ? DUNE.max : a;
}

/** weight of the curved (tangent-plane) term; 0 = flat facets, 1 = full Phong-style quadratic patches */
export const CURVE_ALPHA = 0.75;
/** gradient magnitude cap (m per m, ≈ 50°): steeper faces stay closer to linear so cliff edges never overshoot */
export const MAX_GRAD = 1.2;

/** Detail-relief multiplier for a cell from what covers its rock (bare rock 1, deep sand 0.25, deep snow 0.3). */
export function roughOf(soil: number, sand: number, snow: number): number {
  let r = ROUGH.rock;
  r -= ROUGH.soilK * Math.min(1, soil / ROUGH.soilDepth);
  r -= ROUGH.sandK * Math.min(1, sand / ROUGH.sandDepth);
  r -= ROUGH.snowK * Math.min(1, snow / ROUGH.snowDepth);
  return r < ROUGH.min ? ROUGH.min : r;
}

/**
 * Per-cell tangent-plane gradient of `surface` (metres of height per metre along the ground), body frame, by least
 * squares over the cell's neighbours in its own tangent plane. Writes 4 floats per cell: g (tangent, |g| ≤ MAX_GRAD)
 * and gw = −g·p̂ (≈ 0, kept so the evaluated form is exact in float32 too). Recompute whenever `surface` changes.
 */
export function surfaceGradients(grid: IcoGrid, radius: number, surface: ArrayLike<number>, out?: Float32Array): Float32Array {
  const n = grid.count;
  const g = out && out.length === n * 4 ? out : new Float32Array(n * 4);
  const P = grid.pos;
  const ns = grid.nbrStart, nb = grid.nbr;
  for (let c = 0; c < n; c++) {
    const px = P[c * 3], py = P[c * 3 + 1], pz = P[c * 3 + 2];
    // tangent basis: east = Y × p, north = p × east (poles: +X)
    let ex = pz, ez = -px;
    let el = Math.sqrt(ex * ex + ez * ez);
    let ey = 0;
    if (el < 1e-9) { ex = 1; ey = 0; ez = 0; el = 1; }
    ex /= el; ez /= el;
    const nx = py * ez - pz * ey, ny = pz * ex - px * ez, nz = px * ey - py * ex;
    const h0 = surface[c];
    let suu = 0, suv = 0, svv = 0, sud = 0, svd = 0;
    for (let e = ns[c]; e < ns[c + 1]; e++) {
      const k = nb[e];
      const dx = (P[k * 3] - px) * radius, dy = (P[k * 3 + 1] - py) * radius, dz = (P[k * 3 + 2] - pz) * radius;
      const u = dx * ex + dy * ey + dz * ez;
      const v = dx * nx + dy * ny + dz * nz;
      const dh = surface[k] - h0;
      suu += u * u; suv += u * v; svv += v * v; sud += u * dh; svd += v * dh;
    }
    const det = suu * svv - suv * suv;
    let gu = 0, gv = 0;
    if (det > 1e-12) {
      gu = (sud * svv - svd * suv) / det;
      gv = (svd * suu - sud * suv) / det;
    }
    const m = Math.sqrt(gu * gu + gv * gv);
    if (m > MAX_GRAD) { gu *= MAX_GRAD / m; gv *= MAX_GRAD / m; }
    const gx = gu * ex + gv * nx, gy = gu * ey + gv * ny, gz = gu * ez + gv * nz;
    g[c * 4] = gx;
    g[c * 4 + 1] = gy;
    g[c * 4 + 2] = gz;
    g[c * 4 + 3] = -(gx * px + gy * py + gz * pz);
  }
  return g;
}

/** the curved surface S(p) (metres above datum) inside a located sim triangle */
export function curvedSurface(src: GroundSource, h: GridHit, px: number, py: number, pz: number): number {
  const s = src.surface;
  const lin = s[h.a] * h.wa + s[h.b] * h.wb + s[h.c] * h.wc;
  const G = src.grad;
  if (!G) return lin;
  const a4 = h.a * 4, b4 = h.b * 4, c4 = h.c * 4;
  const ta = G[a4] * px + G[a4 + 1] * py + G[a4 + 2] * pz + G[a4 + 3];
  const tb = G[b4] * px + G[b4 + 1] * py + G[b4 + 2] * pz + G[b4 + 3];
  const tc = G[c4] * px + G[c4 + 1] * py + G[c4 + 2] * pz + G[c4 + 3];
  return lin + CURVE_ALPHA * src.radius * (ta * h.wa + tb * h.wb + tc * h.wc);
}

const _h = newHit();

/** Height of the ground above the datum sphere (metres) at unit vector p. */
export function groundOffset(src: GroundSource, px: number, py: number, pz: number): number {
  const h = src.grid.locate(px, py, pz, _h);
  const s = curvedSurface(src, h, px, py, pz);
  const ra = roughOf(src.soil[h.a], src.sand[h.a], src.snow[h.a]);
  const rb = roughOf(src.soil[h.b], src.sand[h.b], src.snow[h.b]);
  const rc = roughOf(src.soil[h.c], src.sand[h.c], src.snow[h.c]);
  const r = ra * h.wa + rb * h.wb + rc * h.wc;
  let g = s + detailNoise(src.noise, px, py, pz, src.radius) * r;
  const dA = duneAmpOf(src.sand[h.a]) * h.wa + duneAmpOf(src.sand[h.b]) * h.wb + duneAmpOf(src.sand[h.c]) * h.wc;
  if (dA > 0) g += duneNoise(src.noise, px, py, pz, src.radius) * dA;
  return g;
}

/** Distance of the ground from the planet centre (metres) at unit vector p. */
export function groundHeight(src: GroundSource, px: number, py: number, pz: number): number {
  return src.radius + groundOffset(src, px, py, pz);
}

/**
 * Upper bound (metres) of how far the curved surface can leave the [min, max] of its triangle's cell heights, for
 * render bounds: α · R · max|g| · (max distance from a cell to a point of its triangles).
 */
export function curveMargin(grid: IcoGrid, radius: number, maxGrad: number): number {
  return CURVE_ALPHA * maxGrad * grid.meanEdgeAngle * radius * 0.75;
}
