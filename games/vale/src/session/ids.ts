// VALE session — seeds and unique ids.
//
// The session's randomness (search time, side, bot names, draft bots, match seeds) comes from one
// seeded Rng (the sim's xoshiro128**, a pure module), so a probe that fixes the seed replays a whole
// session flow exactly. Without a seed the browser draws one from crypto.

import { Rng } from '../sim/rng.ts';
import type { Clock } from './clock.ts';

/** a fresh 32-bit seed (crypto when present, else Math.random) */
export function randomSeed(): number {
  const c = (globalThis as { crypto?: { getRandomValues?<T extends ArrayBufferView>(a: T): T } }).crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0] >>> 0;
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

/** n base-36 characters from an rng */
export function randomToken(rng: Rng, n = 10): string {
  let s = '';
  while (s.length < n) s += rng.nextU32().toString(36);
  return s.slice(0, n);
}

/** ids that are unique within a profile: '<prefix>-<wall time base36>-<counter>-<random>' */
export class IdSource {
  private n = 0;
  private readonly rng: Rng;
  private readonly clock: Clock;
  constructor(rng: Rng, clock: Clock) { this.rng = rng; this.clock = clock; }
  next(prefix: string): string {
    this.n++;
    return `${prefix}-${Math.floor(this.clock.wall()).toString(36)}-${this.n.toString(36)}-${randomToken(this.rng, 6)}`;
  }
}
