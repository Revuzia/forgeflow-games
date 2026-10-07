// VALE sim — seeded randomness (CONTRACT §0 "Deterministic sim").
//
// xoshiro128** (32-bit state words, Math.imul only) seeded through splitmix32. Every random draw in
// src/sim comes from a named stream derived from MatchSetup.seed, so systems that draw at different
// rates never shift each other's sequences: adding an AI dice roll cannot change who crits.
// Same seed + same command stream ⇒ same draws ⇒ same digest.

/** 32-bit FNV-1a over a string; used to derive stream seeds from names. */
export function hashString(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** splitmix32 step: returns [next state, output]. Good avalanche for seeding xoshiro. */
function splitmix32(state: number): [number, number] {
  state = (state + 0x9e3779b9) | 0;
  let z = state;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = z ^ (z >>> 15);
  return [state, z >>> 0];
}

export class Rng {
  private s0 = 0; private s1 = 0; private s2 = 0; private s3 = 0;

  constructor(seed: number) { this.reseed(seed); }

  reseed(seed: number): void {
    let st = seed | 0;
    let o: number;
    [st, o] = splitmix32(st); this.s0 = o;
    [st, o] = splitmix32(st); this.s1 = o;
    [st, o] = splitmix32(st); this.s2 = o;
    [st, o] = splitmix32(st); this.s3 = o;
    // xoshiro must never have an all-zero state
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** uniform uint32 */
  nextU32(): number {
    const s1 = this.s1;
    const r = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return r;
  }

  /** uniform in [0, 1) */
  float(): number { return this.nextU32() / 4294967296; }
  /** uniform float in [lo, hi) */
  range(lo: number, hi: number): number { return lo + (hi - lo) * this.float(); }
  /** uniform integer in [lo, hi] (inclusive both ends) */
  int(lo: number, hi: number): number {
    if (hi <= lo) return lo;
    return lo + Math.floor(this.float() * (hi - lo + 1));
  }
  /** true with probability p (p ≤ 0 never draws false positives, p ≥ 1 always true; both still consume one draw so call counts stay stable) */
  chance(p: number): boolean { return this.float() < p; }
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('rng.pick on empty array');
    return arr[Math.floor(this.float() * arr.length)];
  }
  /** in-place Fisher–Yates */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  /** snapshot for digests / save-states */
  state(): [number, number, number, number] { return [this.s0 >>> 0, this.s1 >>> 0, this.s2 >>> 0, this.s3 >>> 0]; }
  setState(s: readonly [number, number, number, number]): void { this.s0 = s[0] | 0; this.s1 = s[1] | 0; this.s2 = s[2] | 0; this.s3 = s[3] | 0; }
}

function rotl(x: number, k: number): number { return (x << k) | (x >>> (32 - k)); }

/** seed for a named sub-stream of a match seed */
export function deriveSeed(seed: number, name: string): number {
  return hashString(name, (hashString('vale') ^ (seed >>> 0)) >>> 0);
}

/** an independent stream for (seed, name). Lanes add their own names (e.g. 'bots:3'). */
export function stream(seed: number, name: string): Rng { return new Rng(deriveSeed(seed, name)); }

/** The core streams. combat: crits, chance conditions · ai: unit/monster decisions · spawn: placement jitter. */
export interface RngStreams { readonly combat: Rng; readonly ai: Rng; readonly spawn: Rng }
export function createStreams(seed: number): RngStreams {
  return { combat: stream(seed, 'combat'), ai: stream(seed, 'ai'), spawn: stream(seed, 'spawn') };
}
