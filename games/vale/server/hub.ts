// VALE server — the hub: WebSocket connections, the matchmaker and rooms (CONTRACT §7.2).
//
// MATCHMAKING. One ticket list per queue. Every half second a queue whose humans fill its seats — or
// whose oldest ticket has waited `waitSeconds` — opens a room with up to `seats` humans (oldest first);
// the room fills every other seat with bots. Co-op queues take up to one team of humans; FFA and versus
// queues take up to every seat. Practice and custom lobbies never reach the server (clients play them
// locally).

import { WebSocketServer, type WebSocket } from 'ws';
import type { CatalogT, QueueDefT } from '../src/contracts/catalog.ts';
import { NET_PROTOCOL, type ClientMsg, type ServerMsg } from '../src/contracts/net.ts';
import { findMode, isFfaMode, modeLayout } from '../src/session/setup.ts';
import { Room, type Peer, type Ticket } from './room.ts';

export interface HubOptions {
  catalog: CatalogT;
  port: number;
  host?: string;
  /** seconds the oldest ticket waits before a room opens short of humans (bots fill) */
  waitSeconds?: number;
  /** lockstep speed multiplier (tests) */
  speed?: number;
  readySeconds?: number;
  log?(msg: string): void;
}

const ONLINE_KINDS = new Set(['quick', 'standard', 'ranked', 'coop']);

class Conn implements Peer {
  readonly id: string;
  name = 'Player';
  room: Room | null = null;
  ticket: Ticket | null = null;
  hello = false;
  private readonly ws: WebSocket;
  constructor(id: string, ws: WebSocket) { this.id = id; this.ws = ws; }
  send(m: ServerMsg): void { if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(m)); }
  close(): void { try { this.ws.close(); } catch { /* gone */ } }
}

export class Hub {
  readonly wss: WebSocketServer;
  private readonly o: HubOptions;
  private readonly conns = new Map<string, Conn>();
  private readonly tickets = new Map<string, Ticket[]>();
  private readonly rooms = new Set<Room>();
  private seq = 0;
  private roomSeq = 0;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(o: HubOptions) {
    this.o = o;
    this.wss = new WebSocketServer({ port: o.port, host: o.host });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    this.timers.push(setInterval(() => this.matchmake(), 500));
    this.timers.push(setInterval(() => this.broadcastStats(), 2000));
  }

  get port(): number { const a = this.wss.address(); return typeof a === 'object' && a ? a.port : this.o.port; }
  private log(m: string): void { this.o.log?.(m); }

  close(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    for (const c of this.conns.values()) c.close();
    return new Promise((r) => this.wss.close(() => r()));
  }

  private onConnection(ws: WebSocket): void {
    const c = new Conn(`p${++this.seq}`, ws);
    this.conns.set(c.id, c);
    ws.on('message', (data) => {
      let m: ClientMsg;
      try { m = JSON.parse(String(data)) as ClientMsg; } catch { c.send({ t: 'error', m: 'bad message' }); return; }
      try { this.onMessage(c, m); } catch (err) { this.log(`message from ${c.id}: ${String(err)}`); c.send({ t: 'error', m: 'server error' }); }
    });
    ws.on('close', () => this.onClose(c));
    ws.on('error', () => this.onClose(c));
  }

  private onClose(c: Conn): void {
    if (!this.conns.has(c.id)) return;
    this.conns.delete(c.id);
    this.unqueue(c);
    c.room?.leave(c);
  }

  private onMessage(c: Conn, m: ClientMsg): void {
    if (m.t === 'hello') {
      if (m.v !== NET_PROTOCOL) { c.send({ t: 'error', m: `protocol ${m.v} is not ${NET_PROTOCOL}: reload the game` }); c.close(); return; }
      if (m.catalog !== this.o.catalog.version) { c.send({ t: 'error', m: `content ${m.catalog} is not the server's ${this.o.catalog.version}: reload the game` }); c.close(); return; }
      c.hello = true;
      c.name = String(m.name || 'Player').slice(0, 24);
      c.send({ t: 'welcome', id: c.id, online: this.conns.size });
      return;
    }
    if (!c.hello) { c.send({ t: 'error', m: 'say hello first' }); return; }
    switch (m.t) {
      case 'queue': this.enqueue(c, m); break;
      case 'cancel': if (this.unqueue(c)) c.send({ t: 'queue', e: { type: 'queue', state: 'idle', reason: 'cancelled' } }); else c.room?.leave(c); break;
      case 'accept': c.room?.accept(c); break;
      case 'decline': c.room?.decline(c); break;
      case 'draft': c.room?.draftAction(c, m.a); break;
      case 'ready': c.room?.ready(c); break;
      case 'cmd': c.room?.command(c, m.c); break;
      case 'digest': c.room?.digest(c, m.n, m.h); break;
      case 'leave': c.room?.leave(c); break;
      default: c.send({ t: 'error', m: 'unknown message' });
    }
  }

  private enqueue(c: Conn, m: Extract<ClientMsg, { t: 'queue' }>): void {
    if (c.room) { c.send({ t: 'error', m: 'queue: already in a match' }); return; }
    const q = this.o.catalog.queues.find((x) => x.id === m.req?.queue);
    if (!q || !ONLINE_KINDS.has(q.kind)) { c.send({ t: 'error', m: `queue: '${m.req?.queue}' is not an online queue` }); return; }
    this.unqueue(c);
    c.name = String(m.profile?.name || c.name).slice(0, 24);
    const t: Ticket = { peer: c, req: m.req, profile: { name: c.name, skins: m.profile?.skins ?? {}, loadouts: m.profile?.loadouts ?? {}, rating: m.profile?.rating }, since: Date.now() };
    c.ticket = t;
    const list = this.tickets.get(q.id) ?? [];
    list.push(t);
    this.tickets.set(q.id, list);
    c.send({ t: 'queue', e: { type: 'queue', state: 'searching', queue: q.id, elapsed: 0, estimate: this.o.waitSeconds ?? 8 } });
  }

  private unqueue(c: Conn): boolean {
    const t = c.ticket;
    if (!t) return false;
    c.ticket = null;
    const list = this.tickets.get(t.req.queue);
    if (list) this.tickets.set(t.req.queue, list.filter((x) => x !== t));
    return true;
  }

  /** humans a room for this queue can seat */
  private seats(q: QueueDefT): number {
    const mode = findMode(this.o.catalog, q.mode);
    if (!mode) return 1;
    const lay = modeLayout(mode);
    if (q.bots.fill === 'opponents_only' && !isFfaMode(mode)) return lay.filter((s) => s.team === lay[0].team).length;
    return lay.length;
  }

  private matchmake(): void {
    const now = Date.now();
    for (const [qid, list] of this.tickets) {
      if (!list.length) continue;
      const q = this.o.catalog.queues.find((x) => x.id === qid);
      if (!q) continue;
      const n = this.seats(q);
      const oldest = (now - list[0].since) / 1000;
      for (const t of list) t.peer.send({ t: 'queue', e: { type: 'queue', state: 'searching', queue: qid, elapsed: Math.round((now - t.since) / 1000), estimate: this.o.waitSeconds ?? 8 } });
      if (list.length < n && oldest < (this.o.waitSeconds ?? 8)) continue;
      const take = list.splice(0, Math.min(n, list.length));
      for (const t of take) (t.peer as Conn).ticket = null;
      this.open(q, take);
    }
  }

  private open(q: QueueDefT, tickets: Ticket[]): void {
    const id = `${++this.roomSeq}`;
    try {
      const room = new Room(id, {
        catalog: this.o.catalog, queue: q, tickets, seed: (Date.now() ^ (this.roomSeq * 2654435761)) >>> 0, speed: this.o.speed,
        readySeconds: this.o.readySeconds,
        onClose: (r, requeue) => {
          this.rooms.delete(r);
          for (const t of requeue) {
            const c = t.peer as Conn;
            if (!this.conns.has(c.id)) continue;
            t.since = Date.now();
            c.ticket = t;
            const list = this.tickets.get(q.id) ?? [];
            list.unshift(t);
            this.tickets.set(q.id, list);
            c.send({ t: 'queue', e: { type: 'queue', state: 'searching', queue: q.id, elapsed: 0, estimate: this.o.waitSeconds ?? 8 } });
          }
        },
        log: this.o.log,
      });
      this.rooms.add(room);
      this.log(`room ${id} · ${q.id} · ${tickets.length} human(s)`);
    } catch (err) {
      this.log(`room ${id} failed: ${String(err)}`);
      for (const t of tickets) t.peer.send({ t: 'error', m: 'could not start a match' });
    }
  }

  private broadcastStats(): void {
    const searching: Record<string, number> = {};
    for (const [q, list] of this.tickets) if (list.length) searching[q] = list.length;
    const m: ServerMsg = { t: 'stats', online: this.conns.size, searching };
    for (const c of this.conns.values()) if (c.hello) c.send(m);
  }
}
