// HIT PARADE — state checksum (CONTRACT §4.1 `checksum`, NETCODE §0.6 "mix32, 1 imul/word").
// Integer-only (Math.imul, xor, shifts): identical in Node and every browser.

/** uint32 hash over the first `n` words of `s` (default: all). */
export function hashInts(s: Int32Array, n: number = s.length): number {
  let h = 0x6a09e667 | 0;
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ s[i], 0x9e3779b1);
    h ^= h >>> 15;
  }
  h ^= n;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** uint32 hash of a string (UTF-16 code units). Boot-time only (data identity). */
export function hashString(str: string): number {
  let h = 0x3c6ef372 | 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x9e3779b1);
    h ^= h >>> 15;
  }
  h ^= str.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
