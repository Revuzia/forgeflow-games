// DYEFIELD — an in-memory relay for Node probes (CONTRACT_ONLINE §O12.2 loopback.ts). THREE-free, DOM-free.
//
// It speaks the Room's side of the wire protocol on a virtual clock: binary frames routed by byte 0 / byte 1 only
// (INTENTS client → host, SNAP host → all others, KEYFRAME host → one slot, HANDOFF host → all then a 'handoff' host
// change), the host's roster / seat / end texts relayed to everyone else with `from`, loaded / resync relayed to the host
// with `from`, host selection by the §O4.4 score, host loss on a closed socket or a HOST_STALL_MS silence while live
// (→ `host {hostSlot, reason, lastTick, migrations}`; the 4th loss → the Room's own `end {voided:true}`), peer / members
// broadcasts, and per-link one-way latency. It counts every incoming frame (the §O9.2 units estimate).

import { HOST_STALL_MS, MAX_MIGRATIONS, KIND_HANDOFF, KIND_INTENTS, KIND_KEYFRAME, KIND_SNAP, parseText, type TextMsg, type WireMember } from './proto.ts';

export type Data = ArrayBuffer | string;

export interface LoopPeer {
  slot: number;
  name: string;
  device: 'kbm' | 'touch';
  simMs: number;
  rttMs: number;
  /** one-way latency each direction (ms) */
  lagMs: number;
  /** extra random one-way delay 0..jitterMs (ms; FIFO per link is kept, as on a WebSocket) */
  jitterMs?: number;
  /** @internal the last scheduled arrival per direction (FIFO) */
  upAt?: number;
  downAt?: number;
  /** the endpoint's inbox */
  onData(d: Data, now: number): void;
  conn: boolean;
  owner: boolean;
}

interface Pending { at: number; seq: number; run: () => void }

export interface RelayCounts { framesIn: number; textIn: number; binIn: number; byKind: Record<number, number>; framesOut: number; perSlot: Map<number, number> }

export class LoopRelay {
  now = 0;
  hostSlot = -1;
  phase: 'loading' | 'live' | 'post' = 'loading';
  matchNo = 1;
  lastSnapTick = 0;
  hostLosses = 0;
  private hostLastFrameAt = 0;
  private readonly peers = new Map<number, LoopPeer>();
  private readonly avoid = new Set<number>();
  private readonly q: Pending[] = [];
  private seq = 0;
  endText: string | null = null;
  readonly counts: RelayCounts = { framesIn: 0, textIn: 0, binIn: 0, byKind: {}, framesOut: 0, perSlot: new Map() };
  readonly log: string[] = [];

  add(p: LoopPeer): void { this.peers.set(p.slot, p); }
  /** a seeded jitter stream (deterministic runs) */
  private jseed = 0x2545f491;
  private jit(p: LoopPeer): number {
    const j = p.jitterMs ?? 0;
    if (j <= 0) return 0;
    this.jseed = (Math.imul(this.jseed, 1103515245) + 12345) >>> 0;
    return (this.jseed / 4294967296) * j;
  }
  private wirePhase(): 'live' | 'post' { return (this.phase as string) === 'post' ? 'post' : 'live'; }
  peer(slot: number): LoopPeer | undefined { return this.peers.get(slot); }

  members(): WireMember[] {
    // the Room lists every member that has not LEFT (a dropped socket stays, conn: false, until it leaves for good)
    return [...this.peers.values()].map((p) => ({
      slot: p.slot, name: p.name, kit: 'mist-rasp', crew: 0, color: 1, device: p.device, conn: p.conn, owner: p.owner,
      host: p.slot === this.hostSlot, rttMs: p.rttMs,
    }));
  }

  /** §O4.4: (kbm ? 1000 : 0) − 10 × simMs − rttMs; ties → lowest slot; former stalled / handed-off hosts last */
  pickHost(exclude: number): number {
    const all = [...this.peers.values()].filter((p) => p.conn && p.slot !== exclude);
    const good = all.filter((p) => !this.avoid.has(p.slot));
    const pool = good.length ? good : all;
    let best = -1, bs = -Infinity;
    for (const p of pool) {
      const s = (p.device === 'kbm' ? 1000 : 0) - 10 * p.simMs - p.rttMs;
      if (s > bs || (s === bs && p.slot < best)) { bs = s; best = p.slot; }
    }
    return best;
  }

  start(): void {
    this.hostSlot = this.pickHost(-1);
    this.phase = 'loading';
    this.hostLastFrameAt = this.now;
  }

  private at(ms: number, run: () => void): void {
    this.q.push({ at: ms, seq: this.seq++, run });
  }

  /** an endpoint sends: it reaches the relay after its own lag */
  send(from: number, d: Data): void {
    const p = this.peers.get(from);
    if (!p || !p.conn) return;
    const t = Math.max(p.upAt ?? 0, this.now + p.lagMs + this.jit(p));
    p.upAt = t;
    this.at(t, () => this.receive(from, d));
  }

  private deliver(to: number, d: Data): void {
    const p = this.peers.get(to);
    if (!p || !p.conn) return;
    this.counts.framesOut++;
    const t = Math.max(p.downAt ?? 0, this.now + p.lagMs + this.jit(p));
    p.downAt = t;
    this.at(t, () => { if (p.conn) p.onData(d, this.now); });
  }

  private toAll(d: Data, except: number): void {
    for (const p of this.peers.values()) if (p.conn && p.slot !== except) this.deliver(p.slot, d);
  }

  private text(m: Record<string, unknown>, to: number | 'all', except = -1): void {
    const s = JSON.stringify(m);
    if (to === 'all') this.toAll(s, except); else this.deliver(to, s);
  }

  private receive(from: number, d: Data): void {
    const p = this.peers.get(from);
    if (!p || !p.conn) return;
    this.counts.framesIn++;
    this.counts.perSlot.set(from, (this.counts.perSlot.get(from) ?? 0) + 1);
    const isHost = from === this.hostSlot;
    if (isHost) this.hostLastFrameAt = this.now;
    if (typeof d === 'string') {
      this.counts.textIn++;
      const m = parseText(d) as (TextMsg & Record<string, unknown>) | null;
      if (!m) return;
      if (m.t === 'roster' || m.t === 'seat' || m.t === 'end') {
        if (!isHost) return;
        m.from = from;
        this.toAll(JSON.stringify(m), from);
        if (m.t === 'end') { this.phase = 'post'; this.endText = JSON.stringify(m); }
        return;
      }
      if (m.t === 'loaded' || m.t === 'resync') {
        if (isHost || this.hostSlot < 0) return;
        m.from = from;
        this.deliver(this.hostSlot, JSON.stringify(m));
        return;
      }
      if (m.t === 'kick' && isHost) {
        const slot = (m as { slot: number }).slot;
        this.log.push(`${this.now.toFixed(0)} kick ${slot}`);
        this.drop(slot, true);
        return;
      }
      return;                                                     // handoff / others: nothing to route here
    }
    this.counts.binIn++;
    const b = new Uint8Array(d);
    const kind = b[0], slot = b[1];
    this.counts.byKind[kind] = (this.counts.byKind[kind] ?? 0) + 1;
    if (kind === KIND_INTENTS) {
      if (isHost || slot !== from || this.hostSlot < 0) return;
      this.deliver(this.hostSlot, d);
    } else if (kind === KIND_SNAP) {
      if (!isHost) return;
      this.lastSnapTick = new DataView(d).getUint32(2, true);
      if (this.phase === 'loading') this.phase = 'live';
      this.toAll(d, from);
    } else if (kind === KIND_KEYFRAME) {
      if (!isHost) return;
      this.deliver(slot, d);
    } else if (kind === KIND_HANDOFF) {
      if (!isHost || this.phase !== 'live') return;
      const tick = new DataView(d).getUint32(2, true);
      this.toAll(d, from);
      this.hostLoss('handoff', tick);
    }
  }

  /** §O6.2: promote the next host; the 4th loss (or nobody left) voids the match */
  hostLoss(reason: 'left' | 'stalled' | 'handoff', lastTick: number): void {
    if (this.phase === 'post') return;
    const old = this.hostSlot;
    this.hostLosses++;
    if (reason !== 'left') this.avoid.add(old);
    this.log.push(`${this.now.toFixed(0)} host loss ${reason} (${old}) #${this.hostLosses}`);
    if (this.hostLosses > MAX_MIGRATIONS) { this.void('host_lost'); return; }
    const next = this.pickHost(old);
    if (next < 0) { this.void('no_host'); return; }
    this.hostSlot = next;
    this.hostLastFrameAt = this.now + 1500;
    this.text({ t: 'host', hostSlot: next, reason, lastTick, matchNo: this.matchNo, migrations: this.hostLosses, from: -1 }, 'all');
    this.text({ t: 'members', members: this.members(), phase: this.wirePhase() }, 'all');
  }

  private void(why: string): void {
    const s = JSON.stringify({ t: 'end', matchNo: this.matchNo, voided: true, why, from: -1 });
    this.toAll(s, -1);
    this.phase = 'post';
    this.endText = s;
  }

  /** a socket closes (left: will not come back) */
  drop(slot: number, left: boolean): void {
    const p = this.peers.get(slot);
    if (!p || !p.conn) return;
    p.conn = false;
    const wasHost = slot === this.hostSlot;
    this.text({ t: 'peer', slot, conn: false, left, from: -1 }, 'all');
    if (left) this.peers.delete(slot);
    if (wasHost && this.phase !== 'post') this.hostLoss('left', this.lastSnapTick);
    this.text({ t: 'members', members: this.members(), phase: this.wirePhase() }, 'all');
  }

  /** a peer (re)connects mid-match (late join / reconnect) */
  join(p: LoopPeer, rejoin: boolean): void {
    p.conn = true;
    this.peers.set(p.slot, p);
    this.text({ t: 'peer', slot: p.slot, conn: true, rejoin, from: -1 }, 'all', p.slot);
    this.text({ t: 'members', members: this.members(), phase: this.wirePhase() }, 'all');
  }

  /** run every delivery due by `until` (virtual ms), then the host-stall rule */
  pump(until: number): void {
    for (;;) {
      let bi = -1;
      for (let i = 0; i < this.q.length; i++) {
        const e = this.q[i];
        if (e.at > until) continue;
        if (bi < 0 || e.at < this.q[bi].at || (e.at === this.q[bi].at && e.seq < this.q[bi].seq)) bi = i;
      }
      if (bi < 0) break;
      const e = this.q.splice(bi, 1)[0];
      this.now = Math.max(this.now, e.at);
      e.run();
    }
    this.now = until;
    if (this.phase === 'live' && this.hostSlot >= 0 && this.now - this.hostLastFrameAt > HOST_STALL_MS) {
      this.hostLoss('stalled', this.lastSnapTick);
    }
  }
}
