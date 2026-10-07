// VALE session — time sources (CONTRACT §7).
//
// Everything time-driven in the session (search timer, ready check, draft timers, re-queue
// lockouts, ledger timestamps, first-win-of-the-day, store date windows) reads a Clock, never the
// global timers directly. The browser gets RealClock; probes get ManualClock and advance it by hand,
// so a 10 s ready check or a 30 s pick turn costs nothing and runs the same way every time.
//
//   now()   monotonic milliseconds (only differences matter)
//   wall()  epoch milliseconds (ISO timestamps, UTC day boundaries, offer windows)
//   every(ms, fn) / after(ms, fn) → cancel()

export interface Clock {
  /** monotonic milliseconds */
  now(): number;
  /** wall-clock epoch milliseconds */
  wall(): number;
  /** call fn every `ms` (≥ 1) until cancelled */
  every(ms: number, fn: () => void): () => void;
  /** call fn once after `ms` unless cancelled first */
  after(ms: number, fn: () => void): () => void;
}

/** setTimeout/setInterval + performance.now (Date.now when performance is missing) */
export class RealClock implements Clock {
  now(): number {
    const p = (globalThis as { performance?: { now(): number } }).performance;
    return p ? p.now() : Date.now();
  }
  wall(): number { return Date.now(); }
  every(ms: number, fn: () => void): () => void {
    const h = setInterval(fn, Math.max(1, ms));
    return () => clearInterval(h);
  }
  after(ms: number, fn: () => void): () => void {
    const h = setTimeout(fn, Math.max(0, ms));
    return () => clearTimeout(h);
  }
}

interface Timer { id: number; at: number; every: number; fn: () => void; dead: boolean }

/**
 * A clock that only moves when told to. advance(ms) fires every due timer in time order (ties in
 * scheduling order), including timers scheduled or cancelled by callbacks during the advance, and
 * leaves now() at exactly the target time.
 */
export class ManualClock implements Clock {
  private t = 0;
  private readonly epoch: number;
  private seq = 0;
  private timers: Timer[] = [];

  /** @param epochMs wall time at now() = 0 (default 2026-10-07T12:00:00Z) */
  constructor(epochMs = Date.UTC(2026, 9, 7, 12, 0, 0)) { this.epoch = epochMs; }

  now(): number { return this.t; }
  wall(): number { return this.epoch + this.t; }

  every(ms: number, fn: () => void): () => void { return this.add(Math.max(1, ms), Math.max(1, ms), fn); }
  after(ms: number, fn: () => void): () => void { return this.add(Math.max(0, ms), 0, fn); }

  private add(delay: number, every: number, fn: () => void): () => void {
    const timer: Timer = { id: ++this.seq, at: this.t + delay, every, fn, dead: false };
    this.timers.push(timer);
    return () => { timer.dead = true; };
  }

  /** move time forward by `ms`, firing every timer that falls due on the way */
  advance(ms: number): void {
    const target = this.t + Math.max(0, ms);
    for (;;) {
      this.timers = this.timers.filter((x) => !x.dead);
      let next: Timer | null = null;
      for (const x of this.timers) if (x.at <= target && (!next || x.at < next.at || (x.at === next.at && x.id < next.id))) next = x;
      if (!next) break;
      this.t = Math.max(this.t, next.at);
      if (next.every > 0) { next.at += next.every; next.id = ++this.seq; } else next.dead = true;
      next.fn();
    }
    this.t = target;
  }

  /** advance in `step` ms slices until pred() holds or `limitMs` elapsed; returns whether pred held */
  advanceUntil(pred: () => boolean, limitMs: number, step = 100): boolean {
    let spent = 0;
    while (!pred()) {
      if (spent >= limitMs) return false;
      this.advance(step);
      spent += step;
    }
    return true;
  }

  /** live timers (tests: nothing should leak after a flow finishes) */
  pending(): number { return this.timers.filter((x) => !x.dead).length; }
}

/** ISO-8601 for a wall-clock epoch ms */
export function iso(ms: number): string { return new Date(ms).toISOString(); }
/** the UTC calendar day of a wall-clock time, 'YYYY-MM-DD' */
export function utcDay(ms: number): string { return iso(ms).slice(0, 10); }
