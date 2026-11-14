// HIT PARADE - net/transport_relay.ts (lane NET). Tier-2 fallback when WebRTC cannot connect within 5 s:
// the SAME binary INPUT packets ride the Supabase room channel as binary broadcasts, but
//   * the session sends one packet per 6 frames (10 Hz; D = 4, W = 12 - NETCODE 0.7 / 3.1), and this
//     transport enforces the 10 packets/s ceiling with a TOKEN BUCKET (10/s, burst 2): a packet goes out the
//     moment it is handed over unless the bucket is empty; only then it waits (latest wins: every packet
//     carries all un-acked inputs, so dropping an older one loses nothing)
//   * ONE relayed HIT PARADE match at a time project-wide: the host claims a slot via presence on
//     `ffg-relay:hit-parade` (RelaySlot) before switching; a busy slot = "backup line busy"
// Budget: 2 peers x 10/s x (1 send + 1 delivery) = 40 events/s = 40% of the project's 100/s cap (0.3).
// NEVER 60 Hz over Supabase. Every relay packet is prefixed with the sender's u32 session token (from
// HELLO) so a third client on the public channel cannot inject inputs.
//
// CHANGED(NET) P2 - why a token bucket: the P1 pacing ("at most one packet per 100 ms since the last FLUSH")
// ran at exactly the session's own 10 Hz cadence. With real tick jitter the hold time h(k) = max(0, h(k-1) -
// (gap(k) - 100 ms)) is a zero-drift random walk: packets queued behind the previous flush for 0..100 ms
// (+ coalescing = "loss"). Measured live 2026-09-30 (online2 --lab --relay, trace in
// _harness/_reports/online2_lab_relay*.json): see progress_p2_net.md. `pacing: 'interval'` keeps the old
// behaviour for that A/B only.

import type { Transport } from '../core/net/rollback.ts';
import type { Channel, NetPlay } from './netplay.ts';

export const RELAY_CHANNEL = 'ffg-relay:hit-parade';
export const RELAY_MIN_INTERVAL_MS = 100;
/** token bucket: sustained packets per second and burst (the session itself sends 10/s) */
export const RELAY_RATE = 10;
export const RELAY_BURST = 2;

function frame(token: number, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length + 4);
  new DataView(out.buffer).setUint32(0, token >>> 0, true);
  out.set(b, 4);
  return out;
}

export interface RelayOpts {
  token: number;
  peerToken: number;
  /** 'bucket' (default, P2) | 'interval' (P1 pacing, A/B measurement only) */
  pacing?: 'bucket' | 'interval';
  minIntervalMs?: number;
  rate?: number;
  burst?: number;
  /** keep a flush log [t, seq, holdMs] of the last N input packets (diagnostics) */
  log?: number;
}

export class RelayTransport implements Transport {
  readonly kind = 'relay' as const;
  readonly pacing: 'bucket' | 'interval';
  private np: NetPlay;
  private token: number;
  private peerToken: number;
  private minIv: number;
  private rate: number;
  private burst: number;
  private tokens: number;
  private tokensAt = -1;
  private inbox: { b: Uint8Array; ctl: boolean; at: number }[] = [];
  private pending: Uint8Array | null = null;
  private pendingSince = 0;
  private lastFlush = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = true;
  private logCap: number;
  /** [t, seq, holdMs] per flushed input packet (only when opts.log > 0) */
  readonly flushLog: number[][] = [];
  sentInput = 0;
  sentCtl = 0;
  coalesced = 0;
  held = 0;
  holdMsSum = 0;
  holdMsMax = 0;
  recv = 0;
  foreign = 0;
  lastRecvAt = -1;

  constructor(np: NetPlay, o: RelayOpts) {
    this.np = np;
    this.token = o.token >>> 0;
    this.peerToken = o.peerToken >>> 0;
    this.pacing = o.pacing ?? 'bucket';
    this.minIv = o.minIntervalMs ?? RELAY_MIN_INTERVAL_MS;
    this.rate = o.rate ?? RELAY_RATE;
    this.burst = o.burst ?? RELAY_BURST;
    this.tokens = this.burst;
    this.logCap = Math.max(0, o.log ?? 0);
    np.onBinary('i', (buf) => this.onRecv(buf, false));
    np.onBinary('c', (buf) => this.onRecv(buf, true));
  }

  private onRecv(buf: ArrayBuffer, ctl: boolean): void {
    if (!this.active || buf.byteLength < 5) return;
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== this.peerToken) { this.foreign++; return; }
    this.recv++;
    this.lastRecvAt = performance.now();
    this.inbox.push({ b: new Uint8Array(buf, 4), ctl, at: this.lastRecvAt });
  }

  /** ms until a packet may go out (0 = now). */
  private waitMs(now: number): number {
    if (this.pacing === 'interval') return Math.max(0, this.lastFlush + this.minIv - now);
    if (this.tokensAt >= 0) this.tokens = Math.min(this.burst, this.tokens + ((now - this.tokensAt) / 1000) * this.rate);
    this.tokensAt = now;
    return this.tokens >= 1 ? 0 : ((1 - this.tokens) * 1000) / this.rate;
  }

  sendInput(b: Uint8Array): void {
    if (!this.active) return;
    const now = performance.now();
    const w = this.waitMs(now);
    if (w <= 0 && !this.pending) { this.flush(b, now, now); return; }
    if (this.pending) this.coalesced++;
    else this.pendingSince = now;
    this.pending = b;
    if (!this.timer) this.arm(w);
  }

  private arm(w: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      const p = this.pending;
      if (!p || !this.active) return;
      const t = performance.now();
      const again = this.waitMs(t);
      if (again > 0.5) { this.arm(again); return; }
      this.pending = null;
      this.flush(p, t, this.pendingSince);
    }, Math.max(0, Math.ceil(w)));
  }

  private flush(b: Uint8Array, now: number, handedAt: number): void {
    this.lastFlush = now;
    if (this.pacing === 'bucket') this.tokens = Math.max(0, this.tokens - 1);
    const hold = now - handedAt;
    if (hold > 0.5) { this.held++; this.holdMsSum += hold; if (hold > this.holdMsMax) this.holdMsMax = hold; }
    if (this.logCap > 0) {
      this.flushLog.push([Math.round(now * 10) / 10, b.length > 3 ? b[2] | (b[3] << 8) : -1, Math.round(hold * 10) / 10]);
      if (this.flushLog.length > this.logCap) this.flushLog.splice(0, this.flushLog.length - this.logCap);
    }
    if (this.np.sendBinary('i', frame(this.token, b))) this.sentInput++;
  }

  sendCtl(b: Uint8Array): void {
    if (!this.active) return;
    if (this.np.sendBinary('c', frame(this.token, b))) this.sentCtl++;
  }

  drain(cb: (b: Uint8Array, ctl: boolean, at?: number) => void): void {
    if (this.inbox.length === 0) return;
    const list = this.inbox.splice(0);
    for (const it of list) cb(it.b, it.ctl, it.at);
  }

  stats(): { pacing: string; sentInput: number; sentCtl: number; coalesced: number; held: number; holdMsAvg: number; holdMsMax: number; recv: number; foreign: number } {
    return { pacing: this.pacing, sentInput: this.sentInput, sentCtl: this.sentCtl, coalesced: this.coalesced, held: this.held,
      holdMsAvg: this.sentInput > 0 ? Math.round((this.holdMsSum / this.sentInput) * 10) / 10 : 0, holdMsMax: Math.round(this.holdMsMax * 10) / 10,
      recv: this.recv, foreign: this.foreign };
  }

  close(): void {
    this.active = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.pending = null;
  }
}

/**
 * One relayed match at a time, project-wide. The HOST of a pair claims the slot: presence key = room
 * code on `ffg-relay:hit-parade`, meta {state:'claim'} -> wait `settleMs` (presence visibility measured
 * up to 2.7 s) -> busy if any other room is 'live', or is 'claim' with a lexically lower code; else
 * re-track as 'live' and hold it until release().
 */
export class RelaySlot {
  private np: NetPlay;
  private room: string;
  private ch: Channel | null = null;
  state: 'idle' | 'claim' | 'live' | 'busy' | 'error' = 'idle';

  constructor(np: NetPlay, room: string) {
    this.np = np;
    this.room = room;
  }

  async acquire(settleMs = 3000): Promise<'ok' | 'busy' | 'error'> {
    try {
      const sb = await this.np.connect();
      const ch = sb.channel(RELAY_CHANNEL, { config: { presence: { key: this.room } } });
      this.ch = ch;
      const ok = await new Promise<boolean>((res) => {
        let done = false;
        const t = setTimeout(() => { if (!done) { done = true; res(false); } }, 8000);
        ch.subscribe((status: string) => {
          if (status === 'SUBSCRIBED' && !done) { done = true; clearTimeout(t); res(true); }
          else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !done) { done = true; clearTimeout(t); res(false); }
        });
      });
      if (!ok) { this.state = 'error'; this.release(); return 'error'; }
      this.state = 'claim';
      await ch.track({ room: this.room, state: 'claim' });
      await new Promise((r) => setTimeout(r, settleMs));
      const st = ch.presenceState();
      for (const key of Object.keys(st)) {
        if (key === this.room) continue;
        const metas = st[key] || [];
        const live = metas.some((m) => m.state === 'live');
        const claim = metas.some((m) => m.state === 'claim');
        if (live || (claim && key < this.room)) { this.state = 'busy'; this.release(); return 'busy'; }
      }
      await ch.track({ room: this.room, state: 'live' });
      this.state = 'live';
      return 'ok';
    } catch {
      this.state = 'error';
      this.release();
      return 'error';
    }
  }

  release(): void {
    const ch = this.ch;
    this.ch = null;
    if (!ch) return;
    void this.np.connect().then((sb) => { try { void ch.untrack(); void sb.removeChannel(ch); } catch { /* gone */ } });
    if (this.state === 'live' || this.state === 'claim') this.state = 'idle';
  }
}
