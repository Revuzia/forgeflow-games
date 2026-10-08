// GENESIS — TimeWheel: the deterministic tick-bucketed scheduler for event-driven entities (CONTRACT.md §6.1, §6.3).
//
// Agents, animals and creatures do not think every tick: each schedules its next decision tick (end of a walk segment,
// end of a task). The wheel holds `size` buckets (one per tick, ring-indexed); anything further than `size` ticks away
// waits in an overflow list and migrates into the ring as time approaches. Rescheduling and cancelling are LAZY: the
// authoritative due tick of each id lives in `due`; stale bucket entries are skipped when drained.
//
// Determinism: drain() returns ids in ascending id order, so the order never depends on when (or in which order) the
// entities were scheduled. Serialization stores (id, tick) pairs sorted by (tick, id) and rebuilds the ring on load.

export interface TimeWheelState {
  size: number;
  now: number;
  /** [id, tick] pairs sorted by tick then id */
  entries: [number, number][];
}

export class TimeWheel {
  readonly size: number;
  private readonly mask: number;
  private buckets: number[][];
  private due = new Map<number, number>();
  /** ids waiting beyond the ring, at most once each (`inOverflow` guards the list: an entity that keeps re-planning
   * far ahead must not grow it by one stale copy per re-plan); an id's live due tick is always `due.get(id)` */
  private overflow: number[] = [];
  private inOverflow = new Set<number>();
  private overflowMin = Infinity;
  /** the next tick that has not been drained yet */
  now: number;

  constructor(size = 1024, now = 0) {
    let s = 1;
    while (s < size) s <<= 1;
    this.size = s;
    this.mask = s - 1;
    this.buckets = new Array(s);
    for (let i = 0; i < s; i++) this.buckets[i] = [];
    this.now = now;
  }

  /** number of scheduled ids */
  get count(): number {
    return this.due.size;
  }

  /** the tick an id is scheduled for, or -1 */
  dueOf(id: number): number {
    const t = this.due.get(id);
    return t === undefined ? -1 : t;
  }

  /** schedule (or reschedule) `id` for `tick`; ticks in the past run at the next drain */
  schedule(id: number, tick: number): void {
    tick = Math.floor(tick);
    if (tick < this.now) tick = this.now;
    this.due.set(id, tick);
    if (tick - this.now < this.size) this.buckets[tick & this.mask].push(id);
    else {
      if (!this.inOverflow.has(id)) {
        this.inOverflow.add(id);
        this.overflow.push(id);
      }
      if (tick < this.overflowMin) this.overflowMin = tick;
    }
  }

  /** ids currently parked beyond the ring (diagnostics / tests) */
  get overflowSize(): number {
    return this.overflow.length;
  }

  cancel(id: number): void {
    this.due.delete(id);
  }

  /**
   * Fire every id due at ticks now..tick (inclusive), in (tick, id) order, appending to `out`. Advances `now` to
   * tick + 1. Typical use: one call per sim tick.
   */
  drain(tick: number, out: number[] = []): number[] {
    const scratch = this._scratch;
    for (let t = this.now; t <= tick; t++) {
      if (this.overflow.length && this.overflowMin - t < this.size) this.migrate(t);
      const b = this.buckets[t & this.mask];
      if (b.length === 0) continue;
      scratch.length = 0;
      for (let i = 0; i < b.length; i++) {
        const id = b[i];
        if (this.due.get(id) === t) {
          scratch.push(id);
          this.due.delete(id); // also dedupes ids scheduled twice for the same tick
        }
      }
      b.length = 0;
      // stale entries for ids due at t + k*size stayed in `due`; their live entries are in the overflow list
      if (scratch.length > 1) scratch.sort((x, y) => x - y);
      for (let i = 0; i < scratch.length; i++) out.push(scratch[i]);
    }
    if (tick + 1 > this.now) this.now = tick + 1;
    return out;
  }

  private _scratch: number[] = [];

  /** move overflow entries that are now within the ring window into their buckets */
  private migrate(t: number): void {
    const keep: number[] = [];
    let min = Infinity;
    for (const id of this.overflow) {
      const due = this.due.get(id);
      if (due === undefined || due - t < this.size) {
        // cancelled or fired (dropped), or now within the ring: leaves the overflow list
        this.inOverflow.delete(id);
        if (due !== undefined && due >= t) this.buckets[due & this.mask].push(id);
      } else {
        keep.push(id);
        if (due < min) min = due;
      }
    }
    this.overflow = keep;
    this.overflowMin = min;
  }

  save(): TimeWheelState {
    const entries: [number, number][] = [];
    for (const [id, tick] of this.due) entries.push([id, tick]);
    entries.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    return { size: this.size, now: this.now, entries };
  }

  static load(s: TimeWheelState): TimeWheel {
    const w = new TimeWheel(s.size, s.now);
    for (const [id, tick] of s.entries) w.schedule(id, tick);
    return w;
  }
}
