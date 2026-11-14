// DYEFIELD — deterministic random + hashing (CONTRACT §4.2). THREE-free, DOM-free, Node-safe.
//
// Core code never calls Math.random(). Every system that needs randomness owns its own
// mulberry32 stream seeded from the match seed, and every "noise" that must be stable across
// runs and machines (paint edge noise, texel detail noise) is a pure hash of integer inputs.
//
// All functions take numbers and coerce them with ToInt32 (`| 0`), so pass integers (texel
// coordinates, ids, seeds). Float inputs are truncated, never rounded.

/** mulberry32 PRNG: a tiny, fast, well-distributed 32-bit generator. Returns floats in [0, 1). */
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
