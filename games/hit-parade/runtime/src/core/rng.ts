// HIT PARADE — deterministic random + hashing (CONTRACT §0, §2 "Random"). THREE-free, DOM-free,
// Node-safe. Copied from dyefield core/rng.ts (mulberry32, hash32, hash01), plus the state-array
// stepper the sim uses: rollback restores the Int32Array, so the generator cursor MUST live there
// (NETCODE §4 rule 4) — never in a closure.
//
// All functions take numbers and coerce them with ToInt32 (`| 0`), so pass integers.

/** mulberry32 PRNG: a tiny, fast, well-distributed 32-bit generator. Returns floats in [0, 1).
 *  Closure form: for AI / harness / view use only, never inside the sim step. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One mulberry32 step on a cursor stored in `s[off]`: advances the cursor and returns a uint32. */
export function rngNextU32(s: Int32Array, off: number): number {
  const a = (s[off] + 0x6d2b79f5) | 0;
  s[off] = a;
  let t = a >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Integer in [0, n) from the state cursor (n > 0). Uses the high bits via a 32x32 multiply split. */
export function rngInt(s: Int32Array, off: number, n: number): number {
  const u = rngNextU32(s, off);
  // floor(u * n / 2^32) without floats: split u into 16-bit halves.
  const hi = u >>> 16;
  const lo = u & 0xffff;
  return Math.floor((hi * n + Math.floor((lo * n) / 65536)) / 65536);
}

const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;

function mixK(h: number, k: number): number {
  k = Math.imul(k, C1);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, C2);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

/**
 * Stable uint32 hash of up to three int32 words (MurmurHash3_x86_32 over the words, fixed seed,
 * full fmix32 avalanche). Identical on every JS engine: only Math.imul, shifts and xor.
 */
export function hash32(a: number, b: number = 0, c: number = 0): number {
  let h = 0x2f5a8e1d;
  h = mixK(h, a | 0);
  h = mixK(h, b | 0);
  h = mixK(h, c | 0);
  h ^= 12; // byte length of the three words
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** hash32 mapped to [0, 1). */
export function hash01(a: number, b: number = 0, c: number = 0): number {
  return hash32(a, b, c) / 4294967296;
}
