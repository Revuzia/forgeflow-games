// HIT PARADE - core/net/sync.ts (lane NET). Time sync, RTT estimation, input-delay rule, hashing and the
// SyncTest harness. THREE-free, DOM-free, clock-free (every time value is passed in by the caller).
//
// Numbers are binding from _research/NETCODE.md:
//   * input delay (3.3): P2P D = clamp(ceil((RTT/2)/16.667) - DELAY_HIDE, 1, 4) (DELAY_HIDE settled at 2, P2); relay D = 4
//   * window (3.4): W = 8 on P2P (GGPO MAX_PREDICTION_FRAMES), W = 12 on relay
//   * time sync (3.4): every 240 frames (GGPO RECOMMENDATION_INTERVAL), if my mean frame advantage exceeds
//     the peer's by >= 2 frames I skip floor(diff/2) frames (cap 9, GGPO MAX_FRAME_ADVANTAGE), one skip
//     per 20 frames
//   * checksum every 15 confirmed frames (3.7)

import type { SimPort } from './rollback.ts';

export const FRAME_MS = 1000 / 60;
export const P2P_WINDOW = 8;
export const RELAY_WINDOW = 12;
export const RELAY_DELAY = 4;
export const RELAY_SEND_EVERY = 6;          // 60 / 6 = 10 Hz batched packets on the Supabase relay
export const SYNC_INTERVAL = 240;
export const SYNC_MIN_DIFF = 2;
export const SYNC_MAX_SKIP = 9;
export const SYNC_SKIP_GAP = 20;
export const CHECKSUM_EVERY = 15;
/**
 * Frames of one-way latency hidden by rollback instead of input delay (NETCODE 3.3 said "-3", to be re-tuned by the
 * netsim). CHANGED(NET) P2, settled at 2 by `node _harness/probe_netsim.ts --sweep` (8 measured traces x 4 start
 * phases, rAF tick jitter, real sim; _harness/_reports/probe_netsim_sweep.json, 2026-09-30):
 *   hide 1: min 96.85% mean 99.40%, 0/32 runs < 96%, mean D 3.75, 5.21 rollbacks/side/s, mean rollback 2.17 f
 *   hide 2: min 96.85% mean 99.28%, 0/32 runs < 96%, mean D 2.88, 7.51 rollbacks/side/s, mean rollback 2.48 f
 *   hide 3: min 95.89% mean 99.02%, 2/32 runs < 96%, mean D 1.88, 8.41 rollbacks/side/s, mean rollback 3.15 f
 *   hide 4: min 93.80% mean 98.52%, 8/32 runs < 96%, mean D 1.13
 * 3 misses the 96% speed gate on bursty traces; 2 never does (same floor as 1) and adds a frame only for RTT 101-200 ms
 * (RTT <= 100 ms: D = 1 either way). 1 would add another frame for no speed gain.
 */
export const DELAY_HIDE = 2;
export const DELAY_MIN = 1;
export const DELAY_MAX = 4;

/** Input delay for a measured RTT (ms). `relay` = the Supabase fallback tier (fixed D = 4). */
export function inputDelayFor(rttMs: number, relay = false): number {
  if (relay) return RELAY_DELAY;
  if (!(rttMs >= 0)) return DELAY_MAX;
  const oneWayFrames = Math.ceil((rttMs / 2) / FRAME_MS);
  const d = oneWayFrames - DELAY_HIDE;
  return d < DELAY_MIN ? DELAY_MIN : d > DELAY_MAX ? DELAY_MAX : d;
}

/** 32-bit mix hash over an Int32Array (1 imul per word; NETCODE 0.6 "mix32"). */
export function hashInts(s: Int32Array, n = s.length): number {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ s[i], 0x01000193);
    h ^= h >>> 15;
  }
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return (h ^ (h >>> 15)) | 0;
}

/** Combine two u32 values into one (murmur3 finalizer style). Used for seed = hash32(seedHost, seedGuest). */
export function hash32(a: number, b: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (b | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Hash a string to u32 (FNV-1a over UTF-16 code units). */
export function hashString(s: string): number {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Rolling RTT window (last 32 samples) with median + last value. */
export class RttEstimator {
  private buf = new Float64Array(32);
  private n = 0;
  private head = 0;
  last = -1;
  add(ms: number): void {
    this.buf[this.head] = ms;
    this.head = (this.head + 1) & 31;
    if (this.n < 32) this.n++;
    this.last = ms;
  }
  count(): number { return this.n; }
  median(): number {
    if (this.n === 0) return -1;
    const a = Array.from(this.buf.subarray(0, this.n)).sort((x, y) => x - y);
    return a[(a.length - 1) >> 1];
  }
}

/**
 * GGPO-style time sync. Feed it my frame advantage every running tick (`addLocal`) and every advantage
 * the peer reports (`addRemote`). Every SYNC_INTERVAL ticks it compares the means; the side that is
 * ahead by >= SYNC_MIN_DIFF frames schedules floor(diff/2) skip ticks (cap SYNC_MAX_SKIP), spread one
 * per SYNC_SKIP_GAP ticks. `tick()` returns true when THIS tick must be skipped.
 */
export class TimeSync {
  private localSum = 0;
  private localN = 0;
  private remoteSum = 0;
  private remoteN = 0;
  private ticks = 0;
  private skipLeft = 0;
  private gap = 0;
  interval = SYNC_INTERVAL;
  lastDiff = 0;
  lastLocalMean = 0;
  lastRemoteMean = 0;
  totalScheduled = 0;

  addLocal(adv: number): void { this.localSum += adv; this.localN++; }
  addRemote(adv: number): void { this.remoteSum += adv; this.remoteN++; }

  tick(): boolean {
    this.ticks++;
    if (this.ticks % this.interval === 0) {
      if (this.localN > 0 && this.remoteN > 0) {
        const l = this.localSum / this.localN;
        const r = this.remoteSum / this.remoteN;
        this.lastLocalMean = l;
        this.lastRemoteMean = r;
        const diff = l - r;
        this.lastDiff = diff;
        if (diff >= SYNC_MIN_DIFF) {
          const skip = Math.min(SYNC_MAX_SKIP, Math.floor(diff / 2));
          this.skipLeft = Math.min(SYNC_MAX_SKIP, this.skipLeft + skip);
          this.totalScheduled += skip;
        }
      }
      this.localSum = this.localN = this.remoteSum = this.remoteN = 0;
    }
    if (this.skipLeft > 0) {
      if (this.gap <= 0) {
        this.skipLeft--;
        this.gap = SYNC_SKIP_GAP;
        return true;
      }
      this.gap--;
    }
    return false;
  }

  pending(): number { return this.skipLeft; }
}

// ---- SyncTest (GGPO SyncTest extended to depth 1..W) ---------------------------------------------------

export interface SyncTestResult {
  frames: number;
  checks: number;
  mismatches: number;
  steps: number;
  first: null | { frame: number; depth: number; where: string; expected: number; got: number; words: number[] };
}

/**
 * Run `frames` frames of `sim`; after EVERY frame roll back k = 1 + (f % maxDepth) frames (capped at f+1),
 * re-simulate with the same inputs and compare the checksum of every re-simulated state with the one
 * recorded on the first pass. `inputs(f, out)` writes the two input words for frame f into out[0], out[1].
 * A deterministic sim whose whole state lives in its Int32Array gives 0 mismatches; any hidden state
 * (closures, JS fields, Maps, clocks) shows up as a mismatch at the first rollback that crosses it.
 */
export function runSyncTest(sim: SimPort, frames: number, inputs: (f: number, out: Int32Array) => void, maxDepth = P2P_WINDOW): SyncTestResult {
  const S = maxDepth + 2;
  const n = sim.stateInts;
  const ring: Int32Array[] = [];
  for (let i = 0; i < S; i++) ring.push(new Int32Array(n));
  const cs = new Int32Array(frames + 1);
  const inA = new Int32Array(frames);
  const inB = new Int32Array(frames);
  const pair = new Int32Array(2);
  const orig = new Int32Array(n);
  const tmp = new Int32Array(n);
  const res: SyncTestResult = { frames, checks: 0, mismatches: 0, steps: 0, first: null };
  const fail = (frame: number, depth: number, where: string, expected: number, got: number, words: number[]): void => {
    res.mismatches++;
    if (!res.first) res.first = { frame, depth, where, expected, got, words };
  };
  for (let f = 0; f < frames; f++) {
    inputs(f, pair);
    inA[f] = pair[0];
    inB[f] = pair[1];
    sim.save(ring[f % S]);
    cs[f] = sim.checksum();
    sim.step(inA[f], inB[f]);
    res.steps++;
    cs[f + 1] = sim.checksum();
    sim.save(orig);
    const k = Math.min(1 + (f % maxDepth), f + 1);
    const g = f + 1 - k;
    sim.load(ring[g % S]);
    res.checks++;
    const c0 = sim.checksum() | 0;
    if (c0 !== cs[g]) fail(g, k, 'load', cs[g], c0, []);
    for (let h = g; h <= f; h++) {
      if (h > g) {
        res.checks++;
        const c = sim.checksum() | 0;
        if (c !== cs[h]) fail(h, k, 'resim', cs[h], c, []);
      }
      sim.step(inA[h], inB[h]);
      res.steps++;
    }
    res.checks++;
    const cEnd = sim.checksum() | 0;
    if (cEnd !== cs[f + 1]) {
      sim.save(tmp);
      const words: number[] = [];
      for (let i = 0; i < n && words.length < 16; i++) if (tmp[i] !== orig[i]) words.push(i);
      fail(f + 1, k, 'end', cs[f + 1], cEnd, words);
    }
  }
  return res;
}
