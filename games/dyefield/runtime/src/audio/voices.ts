// DYEFIELD — the one-shot voice limit (CONTRACT_P6_11 §21 "a voice limit"). Pure bookkeeping on a clock the caller
// supplies (the AudioContext time in the browser, a simulated clock in _harness/probe_audio.ts), so the
// stealing policy is testable in node.
//
// A voice has a score (priority + estimated audible gain). When `limit` voices are sounding, a new voice
// steals the lowest-scoring one (the oldest on a tie) only if it scores higher; otherwise it is dropped.

export interface VoiceHandle {
  readonly id: number;
  readonly score: number;
  readonly start: number;
  end: number;
  /** stops the sound (called when stolen) */
  readonly stop: () => void;
}

export class VoicePool {
  readonly limit: number;
  private readonly active: VoiceHandle[] = [];
  private nextId = 1;
  peak = 0;
  stolen = 0;
  rejected = 0;
  admitted = 0;

  constructor(limit: number) {
    this.limit = Math.max(1, limit | 0);
  }

  get count(): number { return this.active.length; }

  /** drop voices whose end time has passed */
  prune(now: number): void {
    const a = this.active;
    for (let i = a.length - 1; i >= 0; i--) if (a[i].end <= now) a.splice(i, 1);
  }

  /** ask for a voice. Returns the handle, or null when the pool is full of higher-scoring voices. */
  acquire(now: number, score: number, end: number, stop: () => void): VoiceHandle | null {
    this.prune(now);
    const a = this.active;
    if (a.length >= this.limit) {
      let vi = 0;
      for (let i = 1; i < a.length; i++) {
        if (a[i].score < a[vi].score || (a[i].score === a[vi].score && a[i].start < a[vi].start)) vi = i;
      }
      if (!(score > a[vi].score)) { this.rejected++; return null; }
      const victim = a[vi];
      a.splice(vi, 1);
      this.stolen++;
      try { victim.stop(); } catch { /* already stopped */ }
    }
    const h: VoiceHandle = { id: this.nextId++, score, start: now, end, stop };
    a.push(h);
    this.admitted++;
    if (a.length > this.peak) this.peak = a.length;
    return h;
  }

  /** the sound ended on its own */
  release(h: VoiceHandle): void {
    const i = this.active.indexOf(h);
    if (i >= 0) this.active.splice(i, 1);
  }

  clear(): void {
    for (const h of this.active) { try { h.stop(); } catch { /* ignore */ } }
    this.active.length = 0;
  }
}
