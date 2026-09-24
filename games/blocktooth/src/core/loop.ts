// BLOCKTOOTH — the frame loop (CONTRACT.md §14, doctrine §5).
//
// requestAnimationFrame drives rendering; the simulation advances in fixed SIM_DT ticks
// from an accumulator of (real dt × timeScale).
//
//   * dt is clamped to MAX_FRAME_DT (0.1 s) so a stalled tab never turns into a burst of ticks.
//   * At most MAX_STEPS_PER_FRAME ticks run per frame; anything still owed after that is
//     DROPPED (spiral-of-death guard) — the sim runs slow for that frame instead of freezing
//     the page trying to catch up.
//   * simEnabled = false (draft, pause, slate, run-end): the accumulator is discarded EVERY
//     frame, so resuming never fast-forwards the time spent frozen (doctrine §5: "discard the
//     accumulator during pause or resume fast-forwards the debt"). While frozen the view is
//     given alpha = 1, i.e. exactly the last simulated tick; on the resume frame the
//     accumulator is primed to just under one tick so the picture continues forward from that
//     pose (no half-tick pop backwards) — less than one tick, never the frozen time.
//   * timeScale scales SIM time only (hit-stop / slow-mo). Rendering always runs; at
//     timeScale 0 the accumulator stops growing and alpha holds still.
//   * If onStep turns simEnabled off (e.g. a level-up opens a draft inside the tick), no
//     further ticks run in that frame.
//   * stepSync(n) runs n ticks synchronously (test surface `step(n)` while frozen).
//
// Frame statistics: a 240-frame ring of real frame times (ms between rAF callbacks,
// unclamped) plus the measured per-frame sim cost (wall time spent inside onStep) and
// per-frame render cost (wall time inside onFrame). `frameStats()` feeds the F1 overlay and
// `__BT__.perf()`; `frameTimeHistory()` feeds the overlay sparkline.
//
// This file is app-side (it needs rAF + a wall clock); the SIM it drives stays deterministic
// because the sim only ever sees whole SIM_DT ticks.

import { MAX_STEPS_PER_FRAME, SIM_DT } from './config.ts';

/** Real frame dt handed to the loop is clamped to this (s). */
export const MAX_FRAME_DT = 0.1;
/** Frame-time ring length (frames). */
export const FRAME_RING = 240;
/** Gaps longer than this (ms) are treated as a suspension (hidden tab, debugger) and are not
 *  recorded as a frame time — they would otherwise dominate p99/max for minutes. */
const SUSPEND_GAP_MS = 1000;
/** On resume the accumulator starts at this fraction of a tick (alpha ≈ 1 = the frozen pose). */
const RESUME_PRIME = 0.999;
/** Float tolerance on "a tick is due": at an exact 60 Hz, 1/60 + 1/60 can land a hair under
 *  1/30 and slip a tick to the next frame (uneven 0-2-1 cadence). 0.1 µs is far below any real
 *  frame jitter. */
const ACC_EPS = 1e-7;
const TICK_DUE = SIM_DT - ACC_EPS;

// ─────────────────────────────── frame statistics ───────────────────────────────

export interface FrameStats {
  /** frames per second over the ring window (1000 / mean frame ms) */
  fps: number;
  /** median frame time (ms) */
  p50: number;
  /** 99th-percentile frame time (ms) — nearest-rank */
  p99: number;
  /** worst frame time in the window (ms) */
  max: number;
  /** mean wall time spent inside onStep per rendered frame (ms) */
  simMs: number;
  /** mean wall time per sim tick (ms) — compare against BUDGET.simTickMsMax */
  simTickMs: number;
  /** worst per-frame sim cost in the window (ms) */
  simMaxMs: number;
  /** mean wall time spent inside onFrame (render + views + UI) per frame (ms) */
  frameCpuMs: number;
  /** number of frames in the window (≤ FRAME_RING) */
  samples: number;
}

const ringFrameMs = new Float64Array(FRAME_RING);
const ringSimMs = new Float64Array(FRAME_RING);
const ringCpuMs = new Float64Array(FRAME_RING);
const ringTicks = new Float64Array(FRAME_RING);
const sortScratch = new Float64Array(FRAME_RING);
let ringHead = 0;     // next write slot
let ringCount = 0;    // valid samples (≤ FRAME_RING)

function recordFrame(frameMs: number, simMs: number, cpuMs: number, ticks: number): void {
  ringFrameMs[ringHead] = frameMs;
  ringSimMs[ringHead] = simMs;
  ringCpuMs[ringHead] = cpuMs;
  ringTicks[ringHead] = ticks;
  ringHead = (ringHead + 1) % FRAME_RING;
  if (ringCount < FRAME_RING) ringCount++;
}

/** Clear the frame-time ring (e.g. at the start of a perf measurement window). */
export function resetFrameStats(): void {
  ringHead = 0;
  ringCount = 0;
}

/** Nearest-rank percentile over the first n entries of an ascending-sorted array. */
function pct(sorted: Float64Array, n: number, p: number): number {
  if (n <= 0) return 0;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
  return sorted[idx];
}

/** Frame-time statistics over the last ≤ 240 recorded frames. Allocation: the result object only. */
export function frameStats(): FrameStats {
  const n = ringCount;
  if (n === 0) {
    return { fps: 0, p50: 0, p99: 0, max: 0, simMs: 0, simTickMs: 0, simMaxMs: 0, frameCpuMs: 0, samples: 0 };
  }
  let sumFrame = 0, sumSim = 0, sumCpu = 0, sumTicks = 0, simMax = 0;
  for (let i = 0; i < n; i++) {
    const f = ringFrameMs[i];
    sumFrame += f;
    sumSim += ringSimMs[i];
    sumCpu += ringCpuMs[i];
    sumTicks += ringTicks[i];
    if (ringSimMs[i] > simMax) simMax = ringSimMs[i];
    sortScratch[i] = f;
  }
  // unused tail sorts to the end so the first n entries are the sorted samples
  for (let i = n; i < FRAME_RING; i++) sortScratch[i] = Infinity;
  sortScratch.sort();
  const mean = sumFrame / n;
  return {
    fps: mean > 0 ? 1000 / mean : 0,
    p50: pct(sortScratch, n, 0.5),
    p99: pct(sortScratch, n, 0.99),
    max: sortScratch[n - 1],
    simMs: sumSim / n,
    simTickMs: sumTicks > 0 ? sumSim / sumTicks : 0,
    simMaxMs: simMax,
    frameCpuMs: sumCpu / n,
    samples: n,
  };
}

/**
 * Copy the most recent frame times (ms) into `out`, OLDEST first, newest last.
 * Copies min(out.length, samples) values into the START of `out`; returns that count.
 */
export function frameTimeHistory(out: { length: number; [i: number]: number }): number {
  const n = Math.min(out.length, ringCount);
  // newest sample sits at ringHead - 1
  let idx = (ringHead - n + FRAME_RING * 2) % FRAME_RING;
  for (let i = 0; i < n; i++) {
    out[i] = ringFrameMs[idx];
    idx = (idx + 1) % FRAME_RING;
  }
  return n;
}

// ─────────────────────────────── the loop ───────────────────────────────

type RafLike = (cb: (now: number) => void) => number;
type CancelLike = (id: number) => void;

function wallNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

export class GameLoop {
  /** false = sim frozen (draft / pause / slate / run end). The accumulator is discarded every frame. */
  simEnabled = true;
  /** sim-time multiplier (hit-stop / slow-mo). 0 freezes the sim smoothly; render always runs. */
  timeScale = 1;

  private readonly onStep: () => void;
  private readonly onFrame: (alpha: number, dt: number, time: number) => void;
  private acc = 0;
  private lastNow = -1;
  private rafId = 0;
  private running = false;
  private raf: RafLike | null = null;
  private cancel: CancelLike | null = null;
  private curAlpha = 1;
  private tickCount = 0;
  private droppedTicks = 0;
  private wasFrozen = false;

  constructor(onStep: () => void, onFrame: (alpha: number, dt: number, time: number) => void) {
    this.onStep = onStep;
    this.onFrame = onFrame;
  }

  /** Begin the rAF loop (idempotent). The first frame has dt = 0. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastNow = -1;
    this.acc = 0;
    const g = globalThis as unknown as { requestAnimationFrame?: RafLike; cancelAnimationFrame?: CancelLike };
    if (typeof g.requestAnimationFrame === 'function') {
      const r = g.requestAnimationFrame, c = g.cancelAnimationFrame;
      this.raf = (cb) => r.call(globalThis, cb);
      this.cancel = typeof c === 'function' ? (id) => c.call(globalThis, id) : (id) => clearTimeout(id);
    } else {
      // no rAF (worker / non-browser host): ~60 Hz timer fallback
      this.raf = (cb) => setTimeout(() => cb(wallNow()), 16) as unknown as number;
      this.cancel = (id) => clearTimeout(id);
    }
    this.rafId = this.raf(this.frame);
  }

  /** Stop the rAF loop (idempotent). */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.cancel) this.cancel(this.rafId);
    this.rafId = 0;
  }

  /** Run n sim ticks synchronously, right now (test surface / harness). Does not touch the accumulator. */
  stepSync(n: number): void {
    const k = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    for (let i = 0; i < k; i++) {
      this.onStep();
      this.tickCount++;
    }
  }

  /** true while the rAF loop is scheduled */
  get isRunning(): boolean { return this.running; }
  /** interpolation factor handed to the last onFrame */
  get alpha(): number { return this.curAlpha; }
  /** ticks run by the loop (incl. stepSync) since construction */
  get ticks(): number { return this.tickCount; }
  /** ticks owed but dropped by the MAX_STEPS_PER_FRAME guard since construction */
  get dropped(): number { return this.droppedTicks; }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    // schedule first: a throw in a callback must not silently kill the loop
    this.rafId = (this.raf as RafLike)(this.frame);

    const rawMs = this.lastNow < 0 ? 0 : Math.max(0, now - this.lastNow);
    this.lastNow = now;
    const dt = Math.min(rawMs / 1000, MAX_FRAME_DT);

    let ticks = 0;
    let simMs = 0;
    if (this.simEnabled && this.wasFrozen) {
      // resume: the frozen view showed alpha = 1 (the last tick). Continue from exactly that
      // display state instead of restarting at alpha 0 (a visible half-tick pop backwards):
      // prime the accumulator to just under one tick. This is NOT paused debt — it is < 1 tick.
      this.wasFrozen = false;
      this.acc = SIM_DT * RESUME_PRIME;
    }
    if (this.simEnabled) {
      const ts = Number.isFinite(this.timeScale) && this.timeScale > 0 ? this.timeScale : 0;
      this.acc += dt * ts;
      if (this.acc >= TICK_DUE) {
        const t0 = wallNow();
        try {
          while (this.acc >= TICK_DUE && ticks < MAX_STEPS_PER_FRAME) {
            this.acc = Math.max(0, this.acc - SIM_DT);
            ticks++;
            this.tickCount++;
            this.onStep();
            if (!this.simEnabled) break;   // the tick froze the sim (draft/run end) — stop now
          }
        } finally {
          simMs = wallNow() - t0;
        }
        // spiral-of-death guard: whatever is still owed after the cap is dropped
        if (this.simEnabled && this.acc >= TICK_DUE) {
          this.droppedTicks += Math.floor((this.acc + ACC_EPS) / SIM_DT);
          this.acc = 0;
        }
      }
    }
    if (!this.simEnabled) {
      // frozen: discard the accumulator EVERY frame so resume never fast-forwards
      this.acc = 0;
      this.curAlpha = 1;
      this.wasFrozen = true;
    } else {
      const a = this.acc / SIM_DT;
      this.curAlpha = a < 0 ? 0 : a > 1 ? 1 : a;
    }

    const c0 = wallNow();
    try {
      this.onFrame(this.curAlpha, dt, now / 1000);
    } finally {
      const cpuMs = wallNow() - c0;
      if (rawMs > 0 && rawMs < SUSPEND_GAP_MS) recordFrame(rawMs, simMs, cpuMs, ticks);
    }
  };
}
