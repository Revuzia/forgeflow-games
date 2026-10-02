// Friendly original names for squishies that are not the starter (?genome=... previews, later drops and blends).
import type { Genome } from '../core/genome.ts';
import { mulberry32 } from '../core/rng.ts';

const NAMES = [
  'Bloop', 'Wibble', 'Plum', 'Pudge', 'Tumble', 'Nubbin', 'Dumpling', 'Jelly Bean', 'Marlo', 'Squidge',
  'Pip', 'Mallow', 'Fudge', 'Biscuit', 'Wobbo', 'Tuffet', 'Gumdrop', 'Snoot', 'Pebble', 'Custard',
  'Dolly', 'Muffin', 'Boop', 'Truffle',
] as const;

/** Deterministic: the same genome always gets the same name. */
export function nameForGenome(g: Genome): string {
  const r = mulberry32(g.seed ^ 0x6e616d65);
  return NAMES[Math.floor(r() * NAMES.length)];
}
