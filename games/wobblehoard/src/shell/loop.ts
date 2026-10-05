// The rAF loop and its fatal-frame path (audit finding 0).
// A frame that throws is survived (logged) up to `fatalAfter - 1` times in a row; the next one stops the loop and calls onFatal, which
// must never be skipped: onFatal runs inside its own try/catch BEFORE any cleanup the caller does, so a broken body or stage (the likely
// cause of the run of errors) can no longer leave a frozen canvas with no error card.

export interface Loop {
  readonly running: boolean;
  start(): void;
  stop(): void;
}

export interface LoopDeps {
  raf(cb: (ts: number) => void): number;
  caf(id: number): void;
  frame(ts: number): void;
  fatalAfter: number;
  report(e: unknown): void;
  /** called once, after the loop has stopped. Never throws out of the loop. */
  onFatal(e: unknown): void;
}

export function createLoop(d: LoopDeps): Loop {
  let running = false;
  let rafId = 0;
  let streak = 0;

  function stop(): void {
    running = false;
    if (rafId) { try { d.caf(rafId); } catch { /* ignore */ } rafId = 0; }
  }

  function tick(ts: number): void {
    if (!running) return;
    rafId = d.raf(tick);
    try { d.frame(ts); streak = 0; } catch (e) {
      streak++;
      try { d.report(e); } catch { /* a broken console must not matter */ }
      if (streak >= d.fatalAfter) {
        stop();
        try { d.onFatal(e); } catch { /* the caller's own guards report it */ }
      }
    }
  }

  return {
    get running() { return running; },
    start() { if (running) return; running = true; streak = 0; rafId = d.raf(tick); },
    stop,
  };
}
