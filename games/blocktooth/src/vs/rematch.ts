// BLOCKTOOTH VS — rematch rules (vs_design.md §11). Lane B-VS. Pure; the 15 s vote, the 10 s titan swap and the bot refill are
// the net / app layer's (VS.rematch.voteS / swapS). The REMATCH keeps the room and the seats with a NEW seed, and the biome
// rotates GRID-EAST -> WHITE STACKS -> LOCKWATER -> GRID-EAST.

import type { BiomeId } from '../core/types.ts';

const ROTATION: readonly BiomeId[] = ['grideast', 'whitestacks', 'lockwater'];

/** The biome of the next match: the rotation above (any other biome restarts it at GRID-EAST). */
export function rematchBiome(biome: BiomeId): BiomeId {
  const i = ROTATION.indexOf(biome);
  return ROTATION[(i + 1) % ROTATION.length];
}

/** A new seed derived from the old one and the rematch counter: the same on every peer, never equal to the old seed. */
export function rematchSeed(seed: number, n = 1): number {
  let h = (seed >>> 0) ^ Math.imul(n | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h === (seed >>> 0) ? (h + 1) >>> 0 : h;
}
