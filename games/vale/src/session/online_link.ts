// VALE session — OnlineLink: the client's one WebSocket to the game server (CONTRACT §7.2,
// src/contracts/net.ts). It says hello (protocol + catalog version), keeps the server's live counts
// (players online, tickets per queue), reconnects with back-off, and hands every ServerMsg to listeners.
// LocalSession sends matchmade queues through it while it is online; offline it plays them locally.
// Status as the player sees it: 'connecting' only for the first attempt, the first retry after a working link
// drops, and a retry the player asked for (retryNow: the bar's Try again, or the browser coming back online).
// Once an attempt has failed, the background retries keep reading 'offline' (queues play against bots), so an
// unreachable server never sits on 'Connecting…'. An attempt that opens but is never greeted is closed after
// HELLO_TIMEOUT_MS, so it fails too.

import { NET_PROTOCOL, type ClientMsg, type ServerMsg } from '../contracts/net.ts';

export type LinkStatus = 'connecting' | 'online' | 'offline' | 'refused';
export interface LinkInfo { status: LinkStatus; players: number; searching: Record<string, number>; reason?: string }

const BACKOFF_S = [1, 2, 4, 8, 15];
/** an open socket the server has not greeted by then is given up on (it counts as a failed attempt) */
const HELLO_TIMEOUT_MS = 10000;
/** the page-level event that asks the link to retry now (the client's Try again, until a Session method carries it) */
export const NET_RETRY_EVENT = 'vale:net-retry';

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
  private hello: ReturnType<typeof setTimeout> | null = null;
  /** attempts in a row that never reached a welcome (0 after a welcome) */
  private failures = 0;
  private disposed = false;
  private readonly onRetry = (): void => this.retryNow();
  private listeners: ((m: ServerMsg) => void)[] = [];
  private statusListeners: ((i: LinkInfo) => void)[] = [];

  constructor(url: string, catalogVersion: string, name: () => string) {
    this.url = url;
    this.catalogVersion = catalogVersion;
    this.name = name;
    if (typeof addEventListener === 'function') {
      addEventListener(NET_RETRY_EVENT, this.onRetry);
      addEventListener('online', this.onRetry);   // the browser's network came back
    }
    this.open(true);
  }

  /** try now (the player asked, or the network came back): reads 'connecting' until it lands or fails */
  retryNow(): void {
    if (this.disposed || this._status === 'online') return;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    this.tries = 0;
    if (this.ws && this.ws.readyState <= 1) { this.setStatus('connecting'); return; }   // one is already on its way
    this.open(true);
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

  /** tests: drop the socket as a network failure would (the link reconnects on its own) */
  dropForTest(): void { try { this.ws?.close(); } catch { /* closed */ } }

  dispose(): void {
    this.disposed = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.hello) clearTimeout(this.hello);
    if (typeof removeEventListener === 'function') { removeEventListener(NET_RETRY_EVENT, this.onRetry); removeEventListener('online', this.onRetry); }
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

  /** @param shown the player sees this attempt as 'connecting' (first try, a requested retry); background retries after a failure stay 'offline' */
  private open(shown = this.failures === 0): void {
    if (this.disposed) return;
    const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WS) { this.setStatus('offline', 'no WebSocket here'); return; }
    let ws: WebSocket;
    try { ws = new WS(this.url); } catch { this.failures++; this.setStatus('offline', 'bad server address'); this.schedule(); return; }
    this.ws = ws;
    this.welcomed = false;
    if (shown) this.setStatus('connecting');
    if (this.hello) clearTimeout(this.hello);
    this.hello = setTimeout(() => { this.hello = null; if (this.ws === ws && !this.welcomed) { try { ws.close(); } catch { /* closing */ } } }, HELLO_TIMEOUT_MS);
    ws.onopen = () => { this.send({ t: 'hello', v: NET_PROTOCOL, catalog: this.catalogVersion, name: this.name() }); };
    ws.onmessage = (ev: MessageEvent) => {
      let m: ServerMsg;
      try { m = JSON.parse(String(ev.data)) as ServerMsg; } catch { return; }
      if (m.t === 'welcome') { this.welcomed = true; this.tries = 0; this.failures = 0; this.players = m.online; this.setStatus('online'); }
      else if (m.t === 'stats') { this.players = m.online; this.searching = m.searching; this.setStatus(this._status); }
      else if (m.t === 'error' && !this.welcomed) { this.setStatus('refused', m.m); }
      for (const l of [...this.listeners]) { try { l(m); } catch { /* a listener never breaks the link */ } }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.hello) { clearTimeout(this.hello); this.hello = null; }
      // a link that was working dropped: its first retry is shown; an attempt that never got in counts as a failure
      if (!this.welcomed) this.failures++;
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
