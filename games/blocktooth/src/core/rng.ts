// Deterministic RNG (mulberry32) — one independent stream per system (doctrine §4).
import type { RngStreams } from './types.ts';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (FNV-1a) — for per-stream seeds and cosmetic variety. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function makeStreams(seed: number): RngStreams {
  const s = (name: string) => mulberry32((seed ^ hashStr(name)) >>> 0);
  return { city: s('city'), spawn: s('spawn'), ai: s('ai'), combat: s('combat'), loot: s('loot'), boss: s('boss'), meta: s('meta') };
}

// Helpers over any () => number stream
export const rRange = (r: () => number, a: number, b: number) => a + (b - a) * r();
export const rInt = (r: () => number, a: number, bInclusive: number) => a + Math.floor(r() * (bInclusive - a + 1));
export const rPick = <T>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
export function rWeighted<T>(r: () => number, items: readonly T[], weight: (t: T) => number): T {
  let total = 0;
  for (const it of items) total += Math.max(0, weight(it));
  let x = r() * total;
  for (const it of items) { x -= Math.max(0, weight(it)); if (x <= 0) return it; }
  return items[items.length - 1];
}
