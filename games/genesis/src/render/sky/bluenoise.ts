// GENESIS — a 64×64 blue-noise rank texture (Ulichney's void-and-cluster, toroidal Gaussian energy σ = 1.9), built
// once on the main thread (~20 ms) and shared by the passes that jitter per pixel (cloud march start, cirrus). Unlike
// interleaved-gradient noise it has no diagonal structure, so a few jittered frames average to a flat result instead
// of hatching. Deterministic (fixed seed): identical on every run.

import { DataTexture, NearestFilter, RedFormat, RepeatWrapping, UnsignedByteType } from 'three';

const N = 64;
const R = 7;            // kernel radius (cells): exp(-49 / (2 · 1.9²)) ≈ 1e-3
const SIGMA2 = 2 * 1.9 * 1.9;

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ranks 0..N²-1 laid out row-major (void-and-cluster) */
export function blueNoiseRanks(seed = 1234567): Uint16Array {
  const n2 = N * N;
  const kern: number[] = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) kern.push(Math.exp(-(dx * dx + dy * dy) / SIGMA2));
  const energy = new Float64Array(n2);
  const bits = new Uint8Array(n2);
  const splat = (i: number, s: number) => {
    const x = i % N, y = (i / N) | 0;
    let k = 0;
    for (let dy = -R; dy <= R; dy++) {
      const yy = ((y + dy) % N + N) % N;
      for (let dx = -R; dx <= R; dx++) {
        const xx = ((x + dx) % N + N) % N;
        energy[yy * N + xx] += s * kern[k++];
      }
    }
  };
  // tightest cluster: the set bit with the highest energy; largest void: the empty cell with the lowest
  const tightest = () => { let b = -1, e = -Infinity; for (let i = 0; i < n2; i++) if (bits[i] && energy[i] > e) { e = energy[i]; b = i; } return b; };
  const largestVoid = () => { let b = -1, e = Infinity; for (let i = 0; i < n2; i++) if (!bits[i] && energy[i] < e) { e = energy[i]; b = i; } return b; };
  const rnd = mulberry(seed);
  const initial = Math.floor(n2 * 0.1);
  let placed = 0;
  while (placed < initial) { const i = Math.floor(rnd() * n2); if (!bits[i]) { bits[i] = 1; splat(i, 1); placed++; } }
  // relax the initial pattern: move the tightest cluster point into the largest void until it settles
  for (let it = 0; it < n2; it++) {
    const c = tightest();
    bits[c] = 0; splat(c, -1);
    const v = largestVoid();
    bits[v] = 1; splat(v, 1);
    if (v === c) break;
  }
  const rank = new Uint16Array(n2);
  const proto = bits.slice();
  const protoE = energy.slice();
  // phase 1: ranks below the initial count, removing the tightest clusters
  let ones = initial;
  while (ones > 0) { const c = tightest(); bits[c] = 0; splat(c, -1); ones--; rank[c] = ones; }
  // phase 2 / 3: ranks above, filling the largest voids
  bits.set(proto); energy.set(protoE);
  ones = initial;
  while (ones < n2) { const v = largestVoid(); bits[v] = 1; splat(v, 1); rank[v] = ones; ones++; }
  return rank;
}

let cached: DataTexture | null = null;
/** 64×64 R8 texture: blue-noise thresholds in [0, 1), nearest filtered, repeating */
export function blueNoiseTexture(): DataTexture {
  if (cached) return cached;
  const r = blueNoiseRanks();
  const data = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) data[i] = Math.floor((r[i] * 256) / (N * N));
  const t = new DataTexture(data, N, N, RedFormat, UnsignedByteType);
  t.magFilter = t.minFilter = NearestFilter;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  cached = t;
  return t;
}
