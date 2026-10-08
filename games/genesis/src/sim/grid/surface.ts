// GENESIS — the ONE definition of "where is the ground" (CONTRACT.md §4.3).
//
// ground(p) = radius + Σ w_i · surface[c_i] + detailNoise(p) · Σ w_i · rough(c_i)
//
// The sim (placing agents, buildings, impacts) and the renderer (terrain vertex shader + CPU placement of trees,
// buildings, crowds) both call these functions, so feet meet the drawn ground. The terrain shader re-implements
// `roughOf` in GLSL with the same constants (render/planet/terrainmat.ts) and reads the baked detailNoise per vertex.

import type { IcoGrid } from './icogrid.ts';
import { newHit } from './icogrid.ts';
import { detailNoise, type Noise3 } from './noise.ts';

export interface GroundSource {
  grid: IcoGrid;
  radius: number;
  noise: Noise3;
  surface: ArrayLike<number>;
  soil: ArrayLike<number>;
  sand: ArrayLike<number>;
  snow: ArrayLike<number>;
}

/** Roughness constants (mirrored in the terrain shader). */
export const ROUGH = { rock: 1.0, soilDepth: 1.5, soilK: 0.5, sandDepth: 0.6, sandK: 0.75, snowDepth: 0.4, snowK: 0.7, min: 0.12 } as const;

/** Detail-relief multiplier for a cell from what covers its rock (bare rock 1, deep sand 0.25, deep snow 0.3). */
export function roughOf(soil: number, sand: number, snow: number): number {
  let r = ROUGH.rock;
  r -= ROUGH.soilK * Math.min(1, soil / ROUGH.soilDepth);
  r -= ROUGH.sandK * Math.min(1, sand / ROUGH.sandDepth);
  r -= ROUGH.snowK * Math.min(1, snow / ROUGH.snowDepth);
  return r < ROUGH.min ? ROUGH.min : r;
}

const _h = newHit();

/** Height of the ground above the datum sphere (metres) at unit vector p. */
export function groundOffset(src: GroundSource, px: number, py: number, pz: number): number {
  const h = src.grid.locate(px, py, pz, _h);
  const s = src.surface[h.a] * h.wa + src.surface[h.b] * h.wb + src.surface[h.c] * h.wc;
  const ra = roughOf(src.soil[h.a], src.sand[h.a], src.snow[h.a]);
  const rb = roughOf(src.soil[h.b], src.sand[h.b], src.snow[h.b]);
  const rc = roughOf(src.soil[h.c], src.sand[h.c], src.snow[h.c]);
  const r = ra * h.wa + rb * h.wb + rc * h.wc;
  return s + detailNoise(src.noise, px, py, pz, src.radius) * r;
}

/** Distance of the ground from the planet centre (metres) at unit vector p. */
export function groundHeight(src: GroundSource, px: number, py: number, pz: number): number {
  return src.radius + groundOffset(src, px, py, pz);
}
