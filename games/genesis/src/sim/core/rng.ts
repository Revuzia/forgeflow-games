// GENESIS — deterministic randomness for the sim core.
//
// Two kinds:
//   * Rng: a seeded, serializable stream (sfc32). Every sim system owns its own stream (see Rng.fork), so adding a
//     draw in one system never shifts another system's sequence. State is 4 uint32 words: save() / load() round-trip.
//   * hash32 / hashFloat: STATELESS positional randomness (cell id, entity id, tick, salt) -> number. Use these for
//     anything that must be reproducible without consuming a stream (tree jitter, names, cosmetic variety).
//
// The sim must never call Math.random, Date, performance.now or crypto (see _harness/detban.ts).

export type RngState = [number, number, number, number];

/** FNV-1a 32-bit hash of a string. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Murmur3-style finalizer: good avalanche for integer hashing. */
export function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Stateless hash of up to four integers -> uint32. */
export function hash32(a: number, b = 0, c = 0, d = 0): number {
  let h = mix32((a | 0) ^ 0x9e3779b9);
  h = mix32(h ^ Math.imul(b | 0, 0x85ebca6b));
  h = mix32(h ^ Math.imul(c | 0, 0xc2b2ae35));
  h = mix32(h ^ Math.imul(d | 0, 0x27d4eb2f));
  return h;
}

/** Stateless hash -> float in [0, 1). */
export function hashFloat(a: number, b = 0, c = 0, d = 0): number {
  return hash32(a, b, c, d) / 4294967296;
}

export class Rng {
  a: number;
  b: number;
  c: number;
  d: number;

  constructor(seed: number | string = 1) {
    const s = typeof seed === 'string' ? hashStr(seed) : seed >>> 0;
    this.a = mix32(s ^ 0xa341316c);
    this.b = mix32(s ^ 0xc8013ea4);
    this.c = mix32(s ^ 0xad90777d);
    this.d = mix32(s ^ 0x7e95761e);
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  /** A new independent stream derived from this one's seed material and a name (does not advance this stream). */
  fork(name: string): Rng {
    const r = new Rng(0);
    const k = hashStr(name);
    r.a = mix32(this.a ^ k);
    r.b = mix32(this.b ^ mix32(k + 1));
    r.c = mix32(this.c ^ mix32(k + 2));
    r.d = mix32(this.d ^ mix32(k + 3));
    for (let i = 0; i < 12; i++) r.nextU32();
    return r;
  }

  nextU32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** float in [0, 1) */
  float(): number {
    return this.nextU32() / 4294967296;
  }

  /** float in [lo, hi) */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float();
  }

  /** integer in [lo, hiInclusive] */
  int(lo: number, hiInclusive: number): number {
    return lo + Math.floor(this.float() * (hiInclusive - lo + 1));
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.float() * arr.length)];
  }

  /** weighted pick; weights <= 0 are never chosen (falls back to the last item if all are zero) */
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    let x = this.float() * total;
    for (const it of items) {
      const w = Math.max(0, weight(it));
      if (w <= 0) continue;
      x -= w;
      if (x <= 0) return it;
    }
    return items[items.length - 1];
  }

  /** approx. standard normal (sum of uniforms; no transcendental functions) */
  gauss(): number {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.float();
    return (s - 3) * 1.41421356;
  }

  /** in-place Fisher-Yates */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  save(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  load(s: RngState): void {
    this.a = s[0] >>> 0;
    this.b = s[1] >>> 0;
    this.c = s[2] >>> 0;
    this.d = s[3] >>> 0;
  }
}
