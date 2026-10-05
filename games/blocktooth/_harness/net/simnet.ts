// BLOCKTOOTH - _harness/net/simnet.ts (lane B-NET). An N-peer simulated network for probe_net4.ts.
// The 4-peer widening of HIT PARADE's core/net/loopback.ts SimLink: every DIRECTED pair has its own link model
// (one-way delay as a function of send time, loss %, duplicate %, blackout windows). Two channels per pair, like
// rtcmesh.ts: UNRELIABLE (loss + duplicates + reordering by delay) and RELIABLE (never lost, ordered per pair; a
// packet sent into a blackout is held until it ends, as SCTP retransmission would). A killed peer sends and receives
// nothing. Clock-free: the probe owns virtual time and calls deliver(now).

import type { Mesh } from '../../src/net/lockstep.ts';

export interface LinkModel {
  /** one-way delay in ms for a packet sent at virtual time t */
  delay: (t: number) => number;
  lossPct?: number;
  dupPct?: number;
  /** [t0, t1) windows where this direction delivers nothing unreliable (reliable is held to t1) */
  blackouts?: [number, number][];
}

interface Item { at: number; seq: number; from: string; to: string; b: Uint8Array; rel: boolean }

class Heap {
  a: Item[] = [];
  private lt(x: Item, y: Item): boolean { return x.at < y.at || (x.at === y.at && x.seq < y.seq); }
  push(it: Item): void {
    const a = this.a; a.push(it);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (!this.lt(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; }
  }
  peek(): Item | undefined { return this.a[0]; }
  pop(): Item | undefined {
    const a = this.a; if (!a.length) return undefined;
    const top = a[0]; const last = a.pop() as Item;
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && this.lt(a[l], a[m])) m = l;
        if (r < a.length && this.lt(a[r], a[m])) m = r;
        if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
  get size(): number { return this.a.length; }
}

export class SimNet {
  private q = new Heap();
  private seq = 0;
  private rng: number;
  private links = new Map<string, LinkModel>();
  private relLast = new Map<string, number>();
  private dead = new Set<string>();
  /** per-peer filter: drop OUTGOING unreliable INPUT packets (AFK scenario: the player stops pressing anything) */
  muteInputs = new Set<string>();
  readonly now: () => number;
  defaultModel: LinkModel;
  sent = 0; dropped = 0; duplicated = 0; delivered = 0; bytes = 0;

  constructor(o: { seed: number; now: () => number; model: LinkModel }) {
    this.rng = o.seed | 0;
    this.now = o.now;
    this.defaultModel = o.model;
  }

  rand(): number {
    let a = (this.rng = (this.rng + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  setLink(from: string, to: string, m: LinkModel): void { this.links.set(from + '>' + to, m); }
  link(from: string, to: string): LinkModel { return this.links.get(from + '>' + to) ?? this.defaultModel; }
  kill(peer: string): void { this.dead.add(peer); }
  isDead(peer: string): boolean { return this.dead.has(peer); }

  mesh(self: string): Mesh {
    return { send: (to: string, b: Uint8Array, reliable: boolean) => this.send(self, to, b, reliable) };
  }

  private send(from: string, to: string, b: Uint8Array, rel: boolean): void {
    if (this.dead.has(from) || this.dead.has(to)) return;
    if (!rel && b[0] === 1 && this.muteInputs.has(from)) return;
    this.sent++; this.bytes += b.length;
    const now = this.now();
    const m = this.link(from, to);
    let at = now + Math.max(0, m.delay(now));
    const bo = m.blackouts?.find(([t0, t1]) => now >= t0 && now < t1);
    if (rel) {
      if (bo) at = Math.max(at, bo[1] + m.delay(bo[1]));
      const key = from + '>' + to;
      const last = this.relLast.get(key) ?? -Infinity;
      if (at < last) at = last;
      this.relLast.set(key, at);
      this.q.push({ at, seq: this.seq++, from, to, b, rel });
      return;
    }
    if (bo) { this.dropped++; return; }
    if ((m.lossPct ?? 0) > 0 && this.rand() * 100 < (m.lossPct ?? 0)) { this.dropped++; return; }
    this.q.push({ at, seq: this.seq++, from, to, b, rel });
    if ((m.dupPct ?? 0) > 0 && this.rand() * 100 < (m.dupPct ?? 0)) {
      this.duplicated++;
      this.q.push({ at: at + 1 + Math.floor(this.rand() * 20), seq: this.seq++, from, to, b, rel });
    }
  }

  /** deliver every packet due at or before `now` (time order) */
  deliver(now: number, cb: (to: string, from: string, b: Uint8Array) => void): void {
    for (;;) {
      const top = this.q.peek();
      if (!top || top.at > now) return;
      this.q.pop();
      if (this.dead.has(top.to) || this.dead.has(top.from)) continue;
      this.delivered++;
      cb(top.to, top.from, top.b);
    }
  }

  get inFlight(): number { return this.q.size; }
}

// ─────────────────────────────── delay profiles ───────────────────────────────

/** uniform jitter around a base, with rare spikes */
export function jitterDelay(net: SimNet, base: number, jitter: number, spikePct = 0, spikeMs = 0): (t: number) => number {
  return () => base + net.rand() * jitter + (spikePct > 0 && net.rand() * 100 < spikePct ? net.rand() * spikeMs : 0);
}

/** replay a MEASURED one-way trace (ms per sample, 60 samples/s), from a phase offset */
export function traceDelay(samples: readonly number[], offset: number): (t: number) => number {
  const n = samples.length;
  return (t: number) => samples[(Math.floor(t / (1000 / 60)) + offset) % n];
}
