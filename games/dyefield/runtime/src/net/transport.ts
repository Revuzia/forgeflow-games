// DYEFIELD — ONLINE WebSocket transport (CONTRACT_ONLINE §O5.2 RTT read-outs, §O10 dev params). Browser only.
//
// One socket to the dyefield-net Worker (a Lobby or a Room). Binary frames are ArrayBuffers. The free auto-response ping
// "p" → "P" measures the RTT to the Durable Object without waking it: every PING_LIVE_S (2 s) while a match is live,
// every PING_IDLE_S (10 s) otherwise. `?netlag=<ms>` (dev) delays every outgoing and incoming frame by that much (a one-way
// delay each way), so a localhost test plays like a real connection.

import { PING_IDLE_S, PING_LIVE_S } from './proto.ts';

export interface TransportHandlers {
  open?(): void;
  text?(s: string): void;
  binary?(b: ArrayBuffer): void;
  close?(code: number, reason: string): void;
}

export class WsTransport {
  /** Node probes only: make the socket (undici's WebSocket takes {headers} — the relay's Origin check needs one) */
  static factory: ((url: string) => WebSocket) | null = null;
  readonly url: string;
  private ws: WebSocket | null = null;
  private readonly h: TransportHandlers;
  private readonly lagMs: number;
  private pingTimer = 0;
  private pingSentAt = -1;
  private live = false;
  private closed = false;
  private readonly rtts: number[] = [];
  /** frames sent / received (read-back) */
  readonly counts = { sent: 0, recv: 0, sentBytes: 0, recvBytes: 0, pings: 0 };

  constructor(url: string, h: TransportHandlers, lagMs = 0) {
    this.url = url;
    this.h = h;
    this.lagMs = Math.max(0, lagMs | 0);
    let ws: WebSocket;
    try { ws = WsTransport.factory ? WsTransport.factory(url) : new WebSocket(url); } catch (e) {
      setTimeout(() => this.h.close?.(1006, (e as Error).message || 'connect failed'), 0);
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = (): void => { this.schedulePing(); this.h.open?.(); };
    ws.onmessage = (ev: MessageEvent): void => {
      const d = ev.data as unknown;
      this.counts.recv++;
      if (typeof d === 'string') {
        this.counts.recvBytes += d.length;
        if (d === 'P') { this.pong(); return; }
        this.later(() => this.h.text?.(d));
      } else if (d instanceof ArrayBuffer) {
        this.counts.recvBytes += d.byteLength;
        this.later(() => this.h.binary?.(d));
      }
    };
    ws.onclose = (ev: CloseEvent): void => {
      this.stopPing();
      if (this.closed) return;
      this.closed = true;
      this.h.close?.(ev.code, ev.reason);
    };
    ws.onerror = (): void => { /* onclose follows */ };
  }

  private later(f: () => void): void {
    if (this.lagMs > 0) setTimeout(f, this.lagMs); else f();
  }

  get open(): boolean { return !!this.ws && this.ws.readyState === 1; }

  send(d: ArrayBuffer | string): void {
    const ws = this.ws;
    if (!ws) return;
    const go = (): void => {
      if (ws.readyState !== 1) return;
      try {
        ws.send(d);
        this.counts.sent++;
        this.counts.sentBytes += typeof d === 'string' ? d.length : d.byteLength;
      } catch { /* closing */ }
    };
    if (this.lagMs > 0) setTimeout(go, this.lagMs); else go();
  }

  /** while a match is live the RTT badge pings every 2 s; else every 10 s */
  setLive(on: boolean): void {
    if (on === this.live) return;
    this.live = on;
    this.schedulePing();
  }

  private schedulePing(): void {
    this.stopPing();
    if (this.closed || !this.ws) return;
    const every = (this.live ? PING_LIVE_S : PING_IDLE_S) * 1000;
    this.pingTimer = setInterval(() => {
      if (!this.open) return;
      this.pingSentAt = performance.now();
      this.counts.pings++;
      this.send('p');
    }, every) as unknown as number;
  }

  private stopPing(): void { if (this.pingTimer) clearInterval(this.pingTimer); this.pingTimer = 0; }

  private pong(): void {
    if (this.pingSentAt < 0) return;
    const rtt = performance.now() - this.pingSentAt;
    this.pingSentAt = -1;
    this.rtts.push(rtt);
    if (this.rtts.length > 15) this.rtts.shift();
  }

  /** the median ping RTT to the relay (ms), null before the first pong */
  rtt(): number | null {
    if (!this.rtts.length) return null;
    const s = this.rtts.slice().sort((a, b) => a - b);
    return Math.round(s[Math.floor(s.length / 2)]);
  }

  close(code = 4000, reason = 'leave'): void {
    this.stopPing();
    this.closed = true;
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(code, reason); } catch { /* already closed */ }
  }

  /** drop the socket as a network failure would (dev: __NET__.dropSocket) — the close handler fires like a real drop */
  drop(): void {
    const ws = this.ws;
    if (!ws) return;
    this.stopPing();
    try { ws.close(4999, 'dev drop'); } catch { /* ignore */ }
    if (!this.closed) { this.closed = true; this.h.close?.(1006, 'dropped'); }
  }
}
