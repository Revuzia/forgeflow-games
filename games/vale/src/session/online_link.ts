// VALE session — OnlineLink: the client's one WebSocket to the game server (CONTRACT §7.2,
// src/contracts/net.ts). It says hello (protocol + catalog version), keeps the server's live counts
// (players online, tickets per queue), reconnects with back-off, and hands every ServerMsg to listeners.
// LocalSession sends matchmade queues through it while it is online; offline it plays them locally.

import { NET_PROTOCOL, type ClientMsg, type ServerMsg } from '../contracts/net.ts';

export type LinkStatus = 'connecting' | 'online' | 'offline' | 'refused';
export interface LinkInfo { status: LinkStatus; players: number; searching: Record<string, number>; reason?: string }

const BACKOFF_S = [1, 2, 4, 8, 15];

export class OnlineLink {
  readonly url: string;
  private readonly catalogVersion: string;
  private readonly name: () => string;
  private ws: WebSocket | null = null;
  private _status: LinkStatus = 'connecting';
  private welcomed = false;
  private players = 0;
  private searching: Record<string, number> = {};
  private reason: string | undefined;
  private tries = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private listeners: ((m: ServerMsg) => void)[] = [];
  private statusListeners: ((i: LinkInfo) => void)[] = [];

  constructor(url: string, catalogVersion: string, name: () => string) {
    this.url = url;
    this.catalogVersion = catalogVersion;
    this.name = name;
    this.open();
  }

  /** online and greeted: matchmade queues go to the server */
  get connected(): boolean { return this._status === 'online' && this.welcomed; }
  info(): LinkInfo { return { status: this._status, players: this.players, searching: { ...this.searching }, ...(this.reason ? { reason: this.reason } : {}) }; }

  on(cb: (m: ServerMsg) => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter((x) => x !== cb); };
  }
  onStatus(cb: (i: LinkInfo) => void): () => void {
    this.statusListeners.push(cb);
    return () => { this.statusListeners = this.statusListeners.filter((x) => x !== cb); };
  }

  send(m: ClientMsg): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(m)); return true; } catch { return false; }
  }

  dispose(): void {
    this.disposed = true;
    if (this.retry) clearTimeout(this.retry);
    try { this.ws?.close(); } catch { /* closed */ }
    this.listeners = [];
    this.statusListeners = [];
  }

  private setStatus(s: LinkStatus, reason?: string): void {
    this._status = s;
    this.reason = reason;
    const i = this.info();
    for (const l of [...this.statusListeners]) { try { l(i); } catch { /* a listener never breaks the link */ } }
  }

  private open(): void {
    if (this.disposed) return;
    const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WS) { this.setStatus('offline', 'no WebSocket here'); return; }
    let ws: WebSocket;
    try { ws = new WS(this.url); } catch { this.setStatus('offline', 'bad server address'); this.schedule(); return; }
    this.ws = ws;
    this.welcomed = false;
    this.setStatus('connecting');
    ws.onopen = () => { this.send({ t: 'hello', v: NET_PROTOCOL, catalog: this.catalogVersion, name: this.name() }); };
    ws.onmessage = (ev: MessageEvent) => {
      let m: ServerMsg;
      try { m = JSON.parse(String(ev.data)) as ServerMsg; } catch { return; }
      if (m.t === 'welcome') { this.welcomed = true; this.tries = 0; this.players = m.online; this.setStatus('online'); }
      else if (m.t === 'stats') { this.players = m.online; this.searching = m.searching; this.setStatus(this._status); }
      else if (m.t === 'error' && !this.welcomed) { this.setStatus('refused', m.m); }
      for (const l of [...this.listeners]) { try { l(m); } catch { /* a listener never breaks the link */ } }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.welcomed = false;
      if (this._status !== 'refused') this.setStatus('offline');
      this.schedule();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private schedule(): void {
    if (this.disposed || this._status === 'refused' || this.retry) return;
    const s = BACKOFF_S[Math.min(this.tries++, BACKOFF_S.length - 1)];
    this.retry = setTimeout(() => { this.retry = null; this.open(); }, s * 1000);
  }
}
