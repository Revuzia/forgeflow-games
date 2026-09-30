// HIT PARADE - core/net/loopback.ts (lane NET). In-process test double for two Transports joined by a
// simulated network whose one-way delays come from MEASURED traces (_research/netcode/rtt_probe_*.json
// `raw`), with optional loss / duplication and relay-style coalescing. THREE-free and clock-free: the
// caller owns the clock (`now`). Used by _harness/probe_netsim.ts; never shipped in the play path.

import type { Transport } from './rollback.ts';

export interface LinkOpts {
  now: () => number;
  /** one-way delay in ms for a packet sent at `sendTime` A -> B. */
  delayAB: (sendTime: number) => number;
  /** one-way delay in ms B -> A. */
  delayBA: (sendTime: number) => number;
  /** percent of INPUT packets dropped (ctl is reliable, never dropped). */
  lossPct?: number;
  /** percent of INPUT packets delivered twice (second copy +1..20 ms later). */
  dupPct?: number;
  seed?: number;
  /** relay-style coalescing: at most one input packet per this many ms per side (latest wins). */
  minIntervalMs?: number;
  kind?: 'loop' | 'relay';
}

interface Item { at: number; seq: number; b: Uint8Array; ctl: boolean }

export class LoopEndpoint implements Transport {
  readonly kind: 'rtc' | 'relay' | 'loop';
  inbox: Item[] = [];
  sentInput = 0;
  sentCtl = 0;
  coalesced = 0;
  private link: SimLink;
  private toB: boolean;
  private pending: Uint8Array | null = null;
  private lastFlush = -Infinity;
  lastCtlAt = -Infinity;

  constructor(link: SimLink, toB: boolean, kind: 'loop' | 'relay') {
    this.link = link;
    this.toB = toB;
    this.kind = kind;
  }

  sendInput(b: Uint8Array): void {
    const iv = this.link.minIntervalMs;
    const now = this.link.now();
    if (iv > 0 && now - this.lastFlush < iv) {
      if (this.pending) this.coalesced++;
      this.pending = b;                               // latest wins (it carries every un-acked input)
      return;
    }
    this.lastFlush = now;
    this.sentInput++;
    this.link.deliver(this.toB, b, false);
  }

  sendCtl(b: Uint8Array): void {
    this.sentCtl++;
    this.link.deliver(this.toB, b, true);
  }

  drain(cb: (b: Uint8Array, ctl: boolean, at?: number) => void): void {
    const now = this.link.now();
    const iv = this.link.minIntervalMs;
    if (this.pending && now - this.lastFlush >= iv) {
      const b = this.pending;
      this.pending = null;
      this.lastFlush = now;
      this.sentInput++;
      this.link.deliver(this.toB, b, false);
    }
    if (this.inbox.length === 0) return;
    const due: Item[] = [];
    const keep: Item[] = [];
    for (const it of this.inbox) (it.at <= now ? due : keep).push(it);
    if (due.length === 0) return;
    this.inbox = keep;
    due.sort((p, q) => p.at - q.at || p.seq - q.seq);
    for (const it of due) cb(it.b, it.ctl, it.at);
  }
}

export class SimLink {
  readonly a: LoopEndpoint;
  readonly b: LoopEndpoint;
  readonly now: () => number;
  readonly minIntervalMs: number;
  private o: LinkOpts;
  private rng: number;
  private seq = 0;
  dropped = 0;
  duplicated = 0;

  constructor(o: LinkOpts) {
    this.o = o;
    this.now = o.now;
    this.minIntervalMs = o.minIntervalMs ?? 0;
    this.rng = (o.seed ?? 12345) | 0;
    const kind = o.kind ?? 'loop';
    this.a = new LoopEndpoint(this, true, kind);
    this.b = new LoopEndpoint(this, false, kind);
  }

  private rand(): number {
    let a = (this.rng = (this.rng + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A->B when `toB`, else B->A. */
  deliver(toB: boolean, b: Uint8Array, ctl: boolean): void {
    const now = this.now();
    const dst = toB ? this.b : this.a;
    const src = toB ? this.a : this.b;
    let at = now + Math.max(0, toB ? this.o.delayAB(now) : this.o.delayBA(now));
    if (ctl) {
      // reliable + ordered: never before the previous ctl message on this direction
      if (at < src.lastCtlAt) at = src.lastCtlAt;
      src.lastCtlAt = at;
      dst.inbox.push({ at, seq: this.seq++, b, ctl });
      return;
    }
    if ((this.o.lossPct ?? 0) > 0 && this.rand() * 100 < (this.o.lossPct ?? 0)) { this.dropped++; return; }
    dst.inbox.push({ at, seq: this.seq++, b, ctl });
    if ((this.o.dupPct ?? 0) > 0 && this.rand() * 100 < (this.o.dupPct ?? 0)) {
      this.duplicated++;
      dst.inbox.push({ at: at + 1 + Math.floor(this.rand() * 20), seq: this.seq++, b, ctl });
    }
  }
}

/** Build a delay function from a one-way-delay trace (ms per 60 Hz sample), indexed by wall time. */
export function traceDelay(samples: ArrayLike<number>, frameMs = 1000 / 60): (t: number) => number {
  const n = samples.length;
  return (t: number) => samples[Math.floor(t / frameMs) % n];
}
