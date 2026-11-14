// HIT PARADE - the frame loop (CONTRACT §14, §16; blocktooth src/core/loop.ts GameLoop, adapted).
//
// requestAnimationFrame drives rendering; the simulation advances in fixed SIM_DT = 1/60 s ticks from an
// accumulator of real dt. The fighting sim is frame-based (60 Hz, CONTRACT §2), so one tick = one sim frame.
//
//   * dt is clamped to MAX_FRAME_DT (0.1 s) so a stalled tab never turns into a burst of ticks.
//   * At most MAX_STEPS_PER_FRAME ticks run per rendered frame; anything still owed after that is DROPPED
//     (spiral-of-death guard): the sim runs slow for that frame instead of freezing the page.
//   * simEnabled = false (pause, menus, results, the PRESS START card): the accumulator is discarded EVERY
//     frame, so resuming never fast-forwards the time spent frozen (doctrine §5: "gate the step function
//     itself, and discard the accumulator during pause"). While frozen the view is handed alpha = 1.
//   * timeScale scales SIM time only. HIT PARADE keeps it at 1.0: hit-stop, super freeze and KO slow-mo are
//     SIM frame counters (CONTRACT §16, NETCODE rule 6) - a loop timeScale would desync online play. It stays
//     for dev experiments only (never set by game.ts).
//   * frameCapMs (default 1000/60): on a 90 / 120 / 144 Hz screen the loop renders at most ~60 frames a
//     second (dyefield review A-A10: "the extra frames were heat and battery"). A leaky bucket: a frame runs
//     once frameCapMs (less a jitter slack) has passed since the last slot and the slot advances by exactly
//     one interval (120 Hz renders every other rAF, 90 Hz two of three), a stall resyncs. Skipped rAFs lose
//     nothing: the accumulator sees the full elapsed time at the next rendered frame. 0 = no cap.
//   * If onStep turns simEnabled off (a KO opens results inside the tick), no further ticks run that frame.
//   * stepSync(n) runs n ticks synchronously (test surface `dev.step(n)` while frozen).
//
// Frame statistics: a 240-frame ring of real frame times (ms between RENDERED frames, unclamped) plus the
// measured per-frame sim cost (wall time inside onStep) and render cost (wall time inside onFrame).
// `frameStats()` feeds `__HP__.perf()`.
//
// This file is app-side (it needs rAF + a wall clock); the sim it drives stays deterministic because the sim
// only ever sees whole ticks and never reads a clock.

/** one sim frame (s): CONTRACT §2 "Frame = 1/60 s" */
export const SIM_DT = 1 / 60;
/** ticks at most per rendered frame (blocktooth config MAX_STEPS_PER_FRAME) */
export const MAX_STEPS_PER_FRAME = 5;
/** Real frame dt handed to the loop is clamped to this (s). */
export const MAX_FRAME_DT = 0.1;
/** Frame-time ring length (frames). */
export const FRAME_RING = 240;
/** default render cap: ~60 fps on high-refresh screens */
export const FRAME_CAP_MS = 1000 / 60;
/** the cap's jitter slack (ms): a 60 Hz panel's rAF gaps of 15-18 ms all render */
const FRAME_CAP_SLACK_MS = 2.5;
/** Gaps longer than this (ms) are a suspension (hidden tab, debugger), never recorded as a frame time. */
const SUSPEND_GAP_MS = 1000;
/** On resume the accumulator starts at this fraction of a tick (alpha ~ 1 = the frozen pose). */
const RESUME_PRIME = 0.999;
/** Float tolerance on "a tick is due" (1/60 + 1/60 can land a hair under 1/30). */
const ACC_EPS = 1e-7;
const TICK_DUE = SIM_DT - ACC_EPS;

// ─────────────────────────────── frame statistics ───────────────────────────────

export interface FrameStats {
  /** rendered frames per second over the ring window (1000 / mean frame ms) */
  fps: number;
  /** median frame time (ms) */
  p50: number;
  /** 99th-percentile frame time (ms), nearest-rank */
  p99: number;
  /** worst frame time in the window (ms) */
  max: number;
  /** mean wall time inside onStep per rendered frame (ms) */
  simMs: number;
  /** mean wall time per sim tick (ms) */
  simTickMs: number;
  /** worst per-frame sim cost in the window (ms) */
  simMaxMs: number;
  /** mean wall time inside onFrame (views + UI + render) per frame (ms) */
  frameCpuMs: number;
  /** sim ticks per second over the window (60 while the sim runs) */
  tickRate: number;
  /** frames in the window (<= FRAME_RING) */
  samples: number;
}

export interface LoopCounters {
  /** ticks run (incl. stepSync) since construction */
  ticks: number;
  /** ticks owed but dropped by the MAX_STEPS_PER_FRAME guard */
  dropped: number;
  /** rAF callbacks skipped by the frame cap */
  capSkips: number;
  /** frames rendered (onFrame calls) */
  frames: number;
}

class FrameRing {
  private readonly frameMs = new Float64Array(FRAME_RING);
  private readonly simMs = new Float64Array(FRAME_RING);
  private readonly cpuMs = new Float64Array(FRAME_RING);
  private readonly ticks = new Float64Array(FRAME_RING);
  private readonly scratch = new Float64Array(FRAME_RING);
  private head = 0;
  private count = 0;

  record(frameMs: number, simMs: number, cpuMs: number, ticks: number): void {
    const h = this.head;
    this.frameMs[h] = frameMs;
    this.simMs[h] = simMs;
    this.cpuMs[h] = cpuMs;
    this.ticks[h] = ticks;
    this.head = (h + 1) % FRAME_RING;
    if (this.count < FRAME_RING) this.count++;
  }

  reset(): void { this.head = 0; this.count = 0; }

  stats(): FrameStats {
    const n = this.count;
    if (n === 0) return { fps: 0, p50: 0, p99: 0, max: 0, simMs: 0, simTickMs: 0, simMaxMs: 0, frameCpuMs: 0, tickRate: 0, samples: 0 };
    let sumF = 0, sumS = 0, sumC = 0, sumT = 0, simMax = 0;
    for (let i = 0; i < n; i++) {
      sumF += this.frameMs[i];
      sumS += this.simMs[i];
      sumC += this.cpuMs[i];
      sumT += this.ticks[i];
      if (this.simMs[i] > simMax) simMax = this.simMs[i];
      this.scratch[i] = this.frameMs[i];
    }
    for (let i = n; i < FRAME_RING; i++) this.scratch[i] = Infinity;
    this.scratch.sort();
    const pct = (p: number): number => this.scratch[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
    const mean = sumF / n;
    return {
      fps: mean > 0 ? 1000 / mean : 0,
      p50: pct(0.5), p99: pct(0.99), max: this.scratch[n - 1],
      simMs: sumS / n, simTickMs: sumT > 0 ? sumS / sumT : 0, simMaxMs: simMax,
      frameCpuMs: sumC / n,
      tickRate: sumF > 0 ? (sumT * 1000) / sumF : 0,
      samples: n,
    };
  }
}

// ─────────────────────────────── the loop ───────────────────────────────

type RafLike = (cb: (now: number) => void) => number;
type CancelLike = (id: number) => void;

function wallNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

export class GameLoop {
  /** false = sim frozen (pause / menus / results / PRESS START). The accumulator is discarded every frame. */
  simEnabled = true;
  /** sim-time multiplier: dev experiments only (see the header; game.ts never changes it) */
  timeScale = 1;
  /** render cap interval in ms (0 = every rAF renders) */
  frameCapMs = FRAME_CAP_MS;

  private readonly onStep: () => void;
  private readonly onFrame: (alpha: number, dt: number, time: number) => void;
  private readonly ring = new FrameRing();
  private acc = 0;
  private lastNow = -1;
  private rafId = 0;
  private running = false;
  private raf: RafLike | null = null;
  private cancel: CancelLike | null = null;
  private curAlpha = 1;
  private wasFrozen = false;
  private capSlot = -1;
  readonly counters: LoopCounters = { ticks: 0, dropped: 0, capSkips: 0, frames: 0 };
  /** the current frame's rAF gap (ms), sim ticks and sim wall ms */
  lastRawMs = 0;
  lastTicks = 0;
  lastSimMs = 0;
  /** a throw inside onStep / onFrame (the loop keeps running; the app decides) */
  onError: ((e: unknown) => void) | null = null;

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
    this.capSlot = -1;
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
  stepSync(n: number): number {
    const k = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    for (let i = 0; i < k; i++) {
      this.onStep();
      this.counters.ticks++;
    }
    return k;
  }

  get isRunning(): boolean { return this.running; }
  get alpha(): number { return this.curAlpha; }
  get ticks(): number { return this.counters.ticks; }
  get dropped(): number { return this.counters.dropped; }

  stats(): FrameStats { return this.ring.stats(); }
  resetStats(): void { this.ring.reset(); }

  /** leaky-bucket render cap: true = skip this rAF */
  private capped(now: number): boolean {
    const cap = this.frameCapMs;
    if (!(cap > 0)) { this.capSlot = -1; return false; }
    if (this.capSlot < 0 || now - this.capSlot > cap * 4) { this.capSlot = now; return false; }
    if (now - this.capSlot < cap - FRAME_CAP_SLACK_MS) { this.counters.capSkips++; return true; }
    this.capSlot += cap;
    if (now - this.capSlot > cap) this.capSlot = now;
    return false;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    // schedule first: a throw in a callback must not silently kill the loop
    this.rafId = (this.raf as RafLike)(this.frame);
    if (this.capped(now)) return;

    const rawMs = this.lastNow < 0 ? 0 : Math.max(0, now - this.lastNow);
    this.lastNow = now;
    const dt = Math.min(rawMs / 1000, MAX_FRAME_DT);

    let ticks = 0;
    let simMs = 0;
    if (this.simEnabled && this.wasFrozen) {
      // resume: continue from the frozen display state (< 1 tick primed, never the frozen time)
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
            this.counters.ticks++;
            this.onStep();
            if (!this.simEnabled) break;
          }
        } catch (e) {
          if (this.onError) this.onError(e); else throw e;
        } finally {
          simMs = wallNow() - t0;
        }
        if (this.simEnabled && this.acc >= TICK_DUE) {
          this.counters.dropped += Math.floor((this.acc + ACC_EPS) / SIM_DT);
          this.acc = 0;
        }
      }
    }
    if (!this.simEnabled) {
      this.acc = 0;
      this.curAlpha = 1;
      this.wasFrozen = true;
    } else {
      const a = this.acc / SIM_DT;
      this.curAlpha = a < 0 ? 0 : a > 1 ? 1 : a;
    }

    this.lastRawMs = rawMs; this.lastTicks = ticks; this.lastSimMs = simMs;
    const c0 = wallNow();
    try {
      this.counters.frames++;
      this.onFrame(this.curAlpha, dt, now / 1000);
    } catch (e) {
      if (this.onError) this.onError(e); else throw e;
    } finally {
      const cpuMs = wallNow() - c0;
      if (rawMs > 0 && rawMs < SUSPEND_GAP_MS) this.ring.record(rawMs, simMs, cpuMs, ticks);
    }
  };
}
