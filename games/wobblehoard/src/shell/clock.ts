// The shell's clocks.
//   * GestureClock: the millisecond clock the gesture machine and pointer timestamps run on. Real time while running; while the sim is
//     paused it is VIRTUAL (frozen, advanced only by DebugHook.step), so paused stepping is deterministic. Resuming re-bases it so a pause
//     never produces a jump.
//   * SimTimers: one-shot callbacks on SIM time (bubble pops after a release, ceremony helpers), so pause / step stay deterministic.
//     Allocation-free per frame: the list is compacted in place.

export interface GestureClock {
  /** ms on the gesture clock */
  now(): number;
  /** a pointer event timestamp (same base as `now`) mapped onto the gesture clock; a stale or missing one becomes `now()` */
  eventTime(t: number | undefined): number;
  readonly paused: boolean;
  pause(): void;
  resume(): void;
  /** advance the virtual clock (only while paused: DebugHook.step) */
  advance(ms: number): void;
}

export function createGestureClock(real: () => number): GestureClock {
  let virtualMs: number | null = null;
  let offset = 0;
  return {
    now: () => (virtualMs !== null ? virtualMs : real() + offset),
    eventTime(t) {
      if (virtualMs !== null) return virtualMs;
      const r = real();
      return (t !== undefined && Number.isFinite(t) && Math.abs(t - r) < 5000 ? t : r) + offset;
    },
    get paused() { return virtualMs !== null; },
    pause() { if (virtualMs === null) virtualMs = real() + offset; },
    resume() {
      if (virtualMs === null) return;
      offset = virtualMs - real();
      virtualMs = null;
    },
    advance(ms) { if (virtualMs !== null && Number.isFinite(ms) && ms > 0) virtualMs += ms; },
  };
}

export interface SimTimers {
  schedule(simAt: number, fn: () => void): void;
  /** run every timer due at `simTime` (errors are reported, never thrown) */
  run(simTime: number): void;
  clear(): void;
  readonly size: number;
}

export function createSimTimers(report: (e: unknown) => void): SimTimers {
  const at: number[] = [];
  const fns: Array<() => void> = [];
  return {
    schedule(t, fn) { at.push(t); fns.push(fn); },
    run(simTime) {
      if (!at.length) return;
      let w = 0;
      const n = at.length;
      for (let r = 0; r < n; r++) {
        if (at[r] <= simTime) {
          const fn = fns[r];
          try { fn(); } catch (e) { report(e); }
        } else { at[w] = at[r]; fns[w] = fns[r]; w++; }
      }
      // timers scheduled DURING the callbacks were appended after n: keep them
      for (let r = n; r < at.length; r++) { at[w] = at[r]; fns[w] = fns[r]; w++; }
      at.length = w; fns.length = w;
    },
    clear() { at.length = 0; fns.length = 0; },
    get size() { return at.length; },
  };
}
