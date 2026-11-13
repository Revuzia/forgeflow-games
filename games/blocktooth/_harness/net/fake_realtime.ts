// BLOCKTOOTH - _harness/net/fake_realtime.ts (lane B-NET). In-memory stand-in for Supabase Realtime (Broadcast +
// Presence) so src/net/room.ts runs headless in Node (probe_room4.ts). Models what matters for quick match:
//   * every subscriber has its OWN, DELAYED view of a channel's presence (HIT PARADE measured presence visibility at
//     144-2,686 ms; default here 100-1,500 ms per receiver), so peers decide on inconsistent snapshots;
//   * broadcast with self:false, 30-150 ms delivery;
//   * billing as the free plan counts it: 1 event per send + 1 per receiving subscriber; per-second peaks recorded.

import type { Channel, PresenceMeta, RealtimeClient } from '../../src/net/room.ts';

interface Member { key: string; sub: FakeChannel }

export class FakeHub {
  channels = new Map<string, Map<FakeChannel, Member>>();
  presence = new Map<string, Map<string, PresenceMeta>>();
  billed = 0;
  sends = 0;
  perSecond = new Map<number, number>();
  presenceDelay: [number, number];
  msgDelay: [number, number];
  private seed: number;
  constructor(o: { seed?: number; presenceDelay?: [number, number]; msgDelay?: [number, number] } = {}) {
    this.seed = o.seed ?? 99;
    this.presenceDelay = o.presenceDelay ?? [100, 1500];
    this.msgDelay = o.msgDelay ?? [30, 150];
  }
  rand(): number {
    let a = (this.seed = (this.seed + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  bill(n: number): void {
    this.billed += n;
    const s = Math.floor(Date.now() / 1000);
    this.perSecond.set(s, (this.perSecond.get(s) ?? 0) + n);
  }
  peakPerSecond(): number { let m = 0; for (const v of this.perSecond.values()) m = Math.max(m, v); return m; }
  /** the free plan's cap is 100 events/s as a 60 s ROLLING AVERAGE (netcode.md 4): worst 60-s window / 60 */
  peakRolling60(): number {
    const ks = [...this.perSecond.keys()].sort((x, y) => x - y);
    let m = 0;
    for (const k of ks) { let s = 0; for (const j of ks) if (j >= k && j < k + 60) s += this.perSecond.get(j) as number; m = Math.max(m, s / 60); }
    return m;
  }
  client(): () => Promise<RealtimeClient> {
    const hub = this;
    const c: RealtimeClient = {
      channel(name: string, opts?: Record<string, unknown>): Channel {
        const cfg = (opts?.config ?? {}) as { presence?: { key?: string } };
        return new FakeChannel(hub, name, cfg.presence?.key ?? Math.random().toString(36).slice(2));
      },
      async removeChannel(ch: Channel): Promise<unknown> { (ch as FakeChannel).close(); return 'ok'; },
    };
    return async () => c;
  }
  /** push the hub's current presence of `name` to every subscriber after its own random delay */
  syncPresence(name: string): void {
    const subs = this.channels.get(name);
    if (!subs) return;
    const snap = new Map(this.presence.get(name) ?? []);
    for (const ch of subs.keys()) {
      ch.schedulePresence(snap, this.presenceDelay);
      this.bill(1);
    }
  }
}

export class FakeChannel implements Channel {
  private hub: FakeHub;
  readonly name: string;
  readonly key: string;
  private handlers: { type: string; event: string; cb: (p: never) => void }[] = [];
  private view = new Map<string, PresenceMeta>();
  private open = false;
  private closed = false;
  private viewVer = 0;
  constructor(hub: FakeHub, name: string, key: string) { this.hub = hub; this.name = name; this.key = key; }

  on(type: string, filter: Record<string, unknown>, cb: (payload: never) => void): Channel {
    this.handlers.push({ type, event: String(filter.event ?? ''), cb });
    return this;
  }
  subscribe(cb?: (status: string, err?: unknown) => void): Channel {
    setTimeout(() => {
      if (this.closed) return;
      let m = this.hub.channels.get(this.name);
      if (!m) { m = new Map(); this.hub.channels.set(this.name, m); }
      m.set(this, { key: this.key, sub: this });
      this.open = true;
      cb?.('SUBSCRIBED');
      // a new subscriber gets the current presence after the visibility delay
      this.schedulePresence(new Map(this.hub.presence.get(this.name) ?? []), this.hub.presenceDelay);
    }, 20 + this.hub.rand() * 60);
    return this;
  }
  async track(meta: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return 'closed';
    let p = this.hub.presence.get(this.name);
    if (!p) { p = new Map(); this.hub.presence.set(this.name, p); }
    p.set(this.key, meta as PresenceMeta);
    this.hub.syncPresence(this.name);
    return 'ok';
  }
  async untrack(): Promise<unknown> {
    const p = this.hub.presence.get(this.name);
    if (p && p.delete(this.key)) this.hub.syncPresence(this.name);
    return 'ok';
  }
  async send(msg: { type: 'broadcast'; event: string; payload: unknown }): Promise<unknown> {
    if (!this.open || this.closed) return 'closed';
    const subs = this.hub.channels.get(this.name);
    this.hub.sends++;
    let n = 1;
    if (subs) for (const ch of subs.keys()) {
      if (ch === this) continue;
      n++;
      const [a, b] = this.hub.msgDelay;
      const payload = JSON.parse(JSON.stringify(msg.payload));
      setTimeout(() => ch.deliver(msg.event, payload), a + this.hub.rand() * (b - a));
    }
    this.hub.bill(n);
    return 'ok';
  }
  presenceState(): Record<string, PresenceMeta[]> {
    const out: Record<string, PresenceMeta[]> = {};
    for (const [k, v] of this.view) out[k] = [v];
    return out;
  }
  /** presence syncs reach ONE subscriber in order (a later snapshot never lands before an earlier one) */
  private lastSyncAt = 0;
  schedulePresence(snap: Map<string, PresenceMeta>, [a, b]: [number, number]): void {
    const now = Date.now();
    const at = Math.max(this.lastSyncAt, now + a + this.hub.rand() * (b - a));
    this.lastSyncAt = at;
    setTimeout(() => this.applyPresence(snap), at - now);
  }
  applyPresence(snap: Map<string, PresenceMeta>): void {
    if (this.closed) return;
    this.view = new Map(snap);
    this.viewVer++;
    for (const h of this.handlers) if (h.type === 'presence' && (h.event === 'sync' || h.event === 'join')) (h.cb as (p: unknown) => void)({});
  }
  deliver(event: string, payload: unknown): void {
    if (this.closed) return;
    for (const h of this.handlers) if (h.type === 'broadcast' && h.event === event) (h.cb as (p: unknown) => void)({ payload });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const m = this.hub.channels.get(this.name);
    if (m) m.delete(this);
    const p = this.hub.presence.get(this.name);
    if (p && p.delete(this.key)) this.hub.syncPresence(this.name);
  }
}
