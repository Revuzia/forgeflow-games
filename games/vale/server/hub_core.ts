// VALE server — the hub's logic (transport-free; server/hub.ts runs it on Node, workers/vale-net on Cloudflare): WebSocket connections, the matchmaker and rooms (CONTRACT §7.2).
//
// MATCHMAKING. One ticket list per queue. Every half second a queue whose humans fill its seats — or
// whose oldest ticket has waited `waitSeconds` — opens a room with up to `seats` humans (oldest first);
// the room fills every other seat with bots. Co-op queues take up to one team of humans; FFA and versus
// queues take up to every seat. Practice and custom lobbies never reach the server (clients play them
// locally).
//
// FRIEND ROOMS (net.ts). A private room by code: members gather, the host picks the queue and the side, and a
// start opens an ordinary Room with every member seated (no ready check). The friend room stays after the match.

import type { CatalogT, QueueDefT } from '../src/contracts/catalog.ts';
import {
  FRIEND_CODE_ALPHABET, FRIEND_CODE_LEN, FRIEND_ROOM_KINDS, NET_PROTOCOL, type ClientMsg, type FriendRoomError, type FriendRoomState, type ServerMsg,
} from '../src/contracts/net.ts';
import { joinTimes, SEARCH_SECONDS } from '../src/session/matchmaker.ts';
import { findMode, isFfaMode, modeLayout } from '../src/session/setup.ts';
import { Room, type Peer, type Ticket } from './room.ts';

/** a connected socket, whatever carries it (Node's ws server, a Cloudflare Durable Object) */
export interface HubSocket {
  send(text: string): void;
  close(): void;
  readonly open: boolean;
}
/** what the transport calls for one connection */
export interface HubConnection { message(text: string): void; closed(): void }

export interface HubOptions {
  catalog: CatalogT;
  /** seconds a friend-room start waits for every member's ticket */
  friendTicketSeconds?: number;
  /** seconds the oldest ticket waits before a room opens short of humans (bots fill) */
  /** seconds the oldest ticket waits before its room opens short of humans: a fixed number (tests), or a range a wait is
   *  drawn from per search (default 8–15 s, like the offline search: the match fills up one player at a time) */
  waitSeconds?: number | readonly [number, number];
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
  friends: FriendRoom | null = null;
  private readonly ws: HubSocket;
  constructor(id: string, ws: HubSocket) { this.id = id; this.ws = ws; }
  send(m: ServerMsg): void { if (this.ws.open) { try { this.ws.send(JSON.stringify(m)); } catch { /* gone */ } } }
  close(): void { try { this.ws.close(); } catch { /* gone */ } }
}

/** a private room of friends (by code); it outlives its matches */
interface FriendRoom {
  code: string;
  queue: string;
  together: boolean;
  /** members in join order; [0] is the host */
  members: Conn[];
  /** conn id → the side (0/1) each member plays on when friends are against each other */
  sides: Map<string, number>;
  /** a start in progress: tickets so far, and the timer that gives up on the rest */
  start: { tickets: Map<string, Ticket>; timer: ReturnType<typeof setTimeout> } | null;
}

/** the hub's logic over any transport: connect() each socket, feed it messages, tell it when the socket closes */
export class HubCore {
  readonly o: HubOptions;
  private readonly conns = new Map<string, Conn>();
  private readonly tickets = new Map<string, Ticket[]>();
  private readonly rooms = new Set<Room>();
  private readonly friendRooms = new Map<string, FriendRoom>();
  /** per queue: the search its oldest ticket is in (how long it waits, when the other seats appear to join) */
  private readonly fills = new Map<string, { head: Ticket; wait: number; joinAt: number[] }>();
  private seq = 0;
  private roomSeq = 0;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(o: HubOptions) { this.o = o; }

  private log(m: string): void { this.o.log?.(m); }

  /** connections, matches and friend rooms right now (a Durable Object sleeps when all three are 0) */
  get load(): { conns: number; rooms: number; friendRooms: number } { return { conns: this.conns.size, rooms: this.rooms.size, friendRooms: this.friendRooms.size }; }

  /** the hub's clocks run only while someone is connected (so an idle Durable Object can sleep) */
  private wake(): void {
    if (this.timers.length) return;
    this.timers.push(setInterval(() => this.matchmake(), 500));
    this.timers.push(setInterval(() => this.broadcastStats(), 2000));
  }
  private sleepIfIdle(): void {
    if (this.conns.size) return;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  close(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const c of this.conns.values()) c.close();
  }

  connect(ws: HubSocket): HubConnection {
    const c = new Conn(`p${++this.seq}`, ws);
    this.conns.set(c.id, c);
    this.wake();
    return {
      message: (text) => {
        let m: ClientMsg;
        try { m = JSON.parse(text) as ClientMsg; } catch { c.send({ t: 'error', m: 'bad message' }); return; }
        try { this.onMessage(c, m); } catch (err) { this.log(`message from ${c.id}: ${String(err)}`); c.send({ t: 'error', m: 'server error' }); }
      },
      closed: () => this.onClose(c),
    };
  }

  private onClose(c: Conn): void {
    if (!this.conns.has(c.id)) return;
    this.conns.delete(c.id);
    this.unqueue(c);
    this.friendLeave(c);
    c.room?.leave(c, true);
    this.sleepIfIdle();
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
      case 'froom_create': this.friendCreate(c, m.queue, m.together); break;
      case 'froom_join': this.friendJoin(c, m.code); break;
      case 'froom_set': this.friendSet(c, m); break;
      case 'froom_start': this.friendStart(c); break;
      case 'froom_side': this.friendSide(c, m.side); break;
      case 'froom_ticket': this.friendTicket(c, m); break;
      case 'froom_leave': this.friendLeave(c); c.send({ t: 'froom', room: null }); break;
      case 'resume': {
        const room = [...this.rooms].find((r) => r.id === m.room);
        if (!room || !room.resume(c, m.token, m.from)) c.send({ t: 'error', m: 'resume: that match is over' });
        break;
      }
      default: c.send({ t: 'error', m: 'unknown message' });
    }
  }

  private enqueue(c: Conn, m: Extract<ClientMsg, { t: 'queue' }>): void {
    if (c.room) { c.send({ t: 'error', m: 'queue: already in a match' }); return; }
    if (c.friends?.start) { c.send({ t: 'error', m: 'queue: your friend room is starting' }); return; }
    const q = this.o.catalog.queues.find((x) => x.id === m.req?.queue);
    if (!q || !ONLINE_KINDS.has(q.kind)) { c.send({ t: 'error', m: `queue: '${m.req?.queue}' is not an online queue` }); return; }
    this.unqueue(c);
    c.name = String(m.profile?.name || c.name).slice(0, 24);
    const t: Ticket = { peer: c, req: m.req, profile: { name: c.name, skins: m.profile?.skins ?? {}, loadouts: m.profile?.loadouts ?? {}, rating: m.profile?.rating }, since: Date.now() };
    c.ticket = t;
    const list = this.tickets.get(q.id) ?? [];
    list.push(t);
    this.tickets.set(q.id, list);
    c.send({ t: 'queue', e: { type: 'queue', state: 'searching', queue: q.id, elapsed: 0, estimate: this.estimate() } });
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

  /** every seat of a queue's match */
  private matchSeats(q: QueueDefT): number {
    const mode = findMode(this.o.catalog, q.mode);
    return mode ? modeLayout(mode).length : 1;
  }

  private estimate(): number { const w = this.o.waitSeconds ?? SEARCH_SECONDS; return Math.round(typeof w === 'number' ? w : w[1]); }

  /** the search a queue's oldest ticket is in (a new oldest ticket starts a new one) */
  private fillFor(q: QueueDefT, head: Ticket): { head: Ticket; wait: number; joinAt: number[] } {
    const cur = this.fills.get(q.id);
    if (cur && cur.head === head) return cur;
    const w = this.o.waitSeconds ?? SEARCH_SECONDS;
    const wait = typeof w === 'number' ? w : w[0] + (w[1] - w[0]) * Math.random();
    const fill = { head, wait, joinAt: joinTimes(this.matchSeats(q) - 1, wait, { float: Math.random }) };
    this.fills.set(q.id, fill);
    return fill;
  }

  private matchmake(): void {
    const now = Date.now();
    for (const [qid, list] of this.tickets) {
      if (!list.length) continue;
      const q = this.o.catalog.queues.find((x) => x.id === qid);
      if (!q) continue;
      const n = this.seats(q);
      const oldest = (now - list[0].since) / 1000;
      const fill = this.fillFor(q, list[0]);
      const total = this.matchSeats(q);
      // the match fills one player at a time: the humans here, plus the other seats as they 'join' along the curve
      const joined = Math.min(total - 1, Math.max(list.length, 1 + fill.joinAt.filter((x) => x <= oldest).length));
      for (const t of list) t.peer.send({ t: 'queue', e: { type: 'queue', state: 'searching', queue: qid, elapsed: Math.round((now - t.since) / 1000), estimate: this.estimate(), joined, total } });
      if (list.length < n && oldest < fill.wait) continue;
      this.fills.delete(qid);
      const take = list.splice(0, Math.min(n, list.length));
      for (const t of take) (t.peer as Conn).ticket = null;
      this.open(q, take);
    }
  }

  private open(q: QueueDefT, tickets: Ticket[], friends?: { together: boolean; sides?: Map<string, number> }): boolean {
    const id = `${++this.roomSeq}`;
    try {
      const room = new Room(id, {
        catalog: this.o.catalog, queue: q, tickets, seed: (Date.now() ^ (this.roomSeq * 2654435761)) >>> 0, speed: this.o.speed,
        readySeconds: this.o.readySeconds, friends,
        onClose: (r, requeue) => {
          this.rooms.delete(r);
          for (const fr of this.friendRooms.values()) if (fr.members.some((x) => tickets.some((t) => t.peer === x))) this.friendBroadcast(fr);
          // a friend match that never got going sends its members back to their room, not to the matchmaker
          if (friends) { for (const t of requeue) t.peer.send({ t: 'queue', e: { type: 'queue', state: 'idle', queue: q.id, reason: 'cancelled' } }); return; }
          for (const t of requeue) {
            const c = t.peer as Conn;
            if (!this.conns.has(c.id)) continue;
            t.since = Date.now();
            c.ticket = t;
            const list = this.tickets.get(q.id) ?? [];
            list.unshift(t);
            this.tickets.set(q.id, list);
            c.send({ t: 'queue', e: { type: 'queue', state: 'searching', queue: q.id, elapsed: 0, estimate: this.estimate() } });
          }
        },
        log: this.o.log,
      });
      this.rooms.add(room);
      this.log(`room ${id} · ${q.id} · ${tickets.length} human(s)${friends ? ' · friends' : ''}`);
      return true;
    } catch (err) {
      this.log(`room ${id} failed: ${String(err)}`);
      for (const t of tickets) t.peer.send({ t: 'error', m: 'could not start a match' });
      return false;
    }
  }

  // ── friend rooms ────────────────────────────────────────────────────────────────────────────────
  private friendQueue(id: string): QueueDefT | undefined {
    const q = this.o.catalog.queues.find((x) => x.id === id);
    return q && (FRIEND_ROOM_KINDS as readonly string[]).includes(q.kind) && ONLINE_KINDS.has(q.kind) ? q : undefined;
  }

  /** humans a friend room can seat: one team together (or a co-op queue), else every seat */
  private friendMax(q: QueueDefT, together: boolean): number {
    const mode = findMode(this.o.catalog, q.mode);
    if (!mode) return 1;
    const lay = modeLayout(mode);
    if (isFfaMode(mode)) return lay.length;
    if (together || q.bots.fill === 'opponents_only') return lay.filter((s) => s.team === lay[0].team).length;
    return lay.length;
  }

  /** friends one side can seat when they are against each other */
  private friendPerSide(q: QueueDefT): number {
    const mode = findMode(this.o.catalog, q.mode);
    if (!mode) return 1;
    const lay = modeLayout(mode);
    return isFfaMode(mode) ? lay.length : lay.filter((s) => s.team === lay[0].team).length;
  }

  /** keep every side within its seats (a queue change can shrink them) */
  private friendBalance(fr: FriendRoom): void {
    const q = this.friendQueue(fr.queue);
    if (!q) return;
    const per = this.friendPerSide(q);
    for (const s of [0, 1]) {
      const on = fr.members.filter((m) => (fr.sides.get(m.id) ?? 0) === s);
      for (const m of on.slice(per)) fr.sides.set(m.id, 1 - s);
    }
  }

  /** a member picks their own side (friends against each other); a full side is refused */
  private friendSide(c: Conn, side: number): void {
    const fr = c.friends;
    if (!fr) { this.friendError(c, 'no_room'); return; }
    if (fr.start || fr.members.some((m) => m.room)) { this.friendError(c, 'busy'); return; }
    const s = side === 1 ? 1 : 0;
    const q = this.friendQueue(fr.queue);
    if (!q) return;
    if ((fr.sides.get(c.id) ?? 0) !== s && fr.members.filter((m) => fr.sides.get(m.id) === s).length >= this.friendPerSide(q)) { this.friendError(c, 'side_full'); return; }
    fr.sides.set(c.id, s);
    this.friendBroadcast(fr);
  }

  private friendError(c: Conn, reason: FriendRoomError): void { c.send({ t: 'froom_error', reason }); }

  private newCode(): string {
    for (let n = 0; n < 1000; n++) {
      let code = '';
      for (let i = 0; i < FRIEND_CODE_LEN; i++) code += FRIEND_CODE_ALPHABET[Math.floor(Math.random() * FRIEND_CODE_ALPHABET.length)];
      if (!this.friendRooms.has(code)) return code;
    }
    throw new Error('no free room code');
  }

  private friendView(fr: FriendRoom, you: Conn): FriendRoomState {
    const q = this.friendQueue(fr.queue)!;
    return {
      code: fr.code, queue: fr.queue, together: fr.together, max: this.friendMax(q, fr.together), you: you.id, host: fr.members[0].id,
      members: fr.members.map((m) => ({ id: m.id, name: m.name, busy: !!m.room, side: fr.sides.get(m.id) ?? 0 })), starting: !!fr.start,
      perSide: this.friendPerSide(q),
    };
  }

  private friendBroadcast(fr: FriendRoom): void { for (const m of fr.members) m.send({ t: 'froom', room: this.friendView(fr, m) }); }

  private friendCreate(c: Conn, queue: string, together: boolean): void {
    if (c.room || c.ticket) { this.friendError(c, 'busy'); return; }
    const q = this.friendQueue(queue);
    if (!q) { this.friendError(c, 'bad_queue'); return; }
    this.friendLeave(c);
    const fr: FriendRoom = { code: this.newCode(), queue: q.id, together: !!together, members: [c], sides: new Map([[c.id, 0]]), start: null };
    this.friendRooms.set(fr.code, fr);
    c.friends = fr;
    this.log(`friends ${fr.code} · made by ${c.name}`);
    this.friendBroadcast(fr);
  }

  private friendJoin(c: Conn, raw: string): void {
    const code = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const fr = this.friendRooms.get(code);
    if (!fr) { this.friendError(c, 'no_room'); return; }
    if (c.friends === fr) { this.friendBroadcast(fr); return; }
    if (c.room || c.ticket) { this.friendError(c, 'busy'); return; }
    if (fr.start || fr.members.some((m) => m.room)) { this.friendError(c, 'busy'); return; }
    if (fr.members.length >= this.friendMax(this.friendQueue(fr.queue)!, fr.together)) { this.friendError(c, 'full'); return; }
    this.friendLeave(c);
    fr.members.push(c);
    // a newcomer takes the side with fewer friends on it (they can switch)
    const on1 = fr.members.filter((m) => fr.sides.get(m.id) === 1).length;
    fr.sides.set(c.id, on1 < fr.members.length - 1 - on1 ? 1 : 0);
    c.friends = fr;
    this.friendBroadcast(fr);
  }

  private friendSet(c: Conn, m: Extract<ClientMsg, { t: 'froom_set' }>): void {
    const fr = c.friends;
    if (!fr) { this.friendError(c, 'no_room'); return; }
    if (fr.members[0] !== c) { this.friendError(c, 'not_host'); return; }
    if (fr.start) { this.friendError(c, 'busy'); return; }
    const queue = m.queue !== undefined ? this.friendQueue(m.queue) : this.friendQueue(fr.queue);
    if (!queue) { this.friendError(c, 'bad_queue'); return; }
    const together = m.together !== undefined ? !!m.together : fr.together;
    // a change that would leave members without a seat is refused
    if (fr.members.length > this.friendMax(queue, together)) { this.friendError(c, 'full'); return; }
    fr.queue = queue.id;
    fr.together = together;
    this.friendBalance(fr);
    this.friendBroadcast(fr);
  }

  private friendStart(c: Conn): void {
    const fr = c.friends;
    if (!fr) { this.friendError(c, 'no_room'); return; }
    if (fr.members[0] !== c) { this.friendError(c, 'not_host'); return; }
    if (fr.start || fr.members.some((m) => m.room)) { this.friendError(c, 'busy'); return; }
    for (const m of fr.members) this.unqueue(m);
    this.friendBalance(fr);
    const timer = setTimeout(() => this.friendLaunch(fr), (this.o.friendTicketSeconds ?? 6) * 1000);
    fr.start = { tickets: new Map(), timer };
    this.friendBroadcast(fr);
    for (const m of fr.members) m.send({ t: 'froom_go', queue: fr.queue });
  }

  private friendTicket(c: Conn, m: Extract<ClientMsg, { t: 'froom_ticket' }>): void {
    const fr = c.friends;
    if (!fr?.start || m.req?.queue !== fr.queue) return;
    c.name = String(m.profile?.name || c.name).slice(0, 24);
    fr.start.tickets.set(c.id, {
      peer: c, req: { ...m.req, queue: fr.queue },
      profile: { name: c.name, skins: m.profile?.skins ?? {}, loadouts: m.profile?.loadouts ?? {}, rating: m.profile?.rating }, since: Date.now(),
    });
    if (fr.members.every((x) => fr.start!.tickets.has(x.id))) this.friendLaunch(fr);
  }

  /** every ticket is in (or the wait ran out): open the match with the members who answered */
  private friendLaunch(fr: FriendRoom): void {
    const st = fr.start;
    if (!st) return;
    clearTimeout(st.timer);
    fr.start = null;
    const q = this.friendQueue(fr.queue);
    const tickets = fr.members.map((m) => st.tickets.get(m.id)).filter((t): t is Ticket => !!t);
    if (q && tickets.length && this.open(q, tickets, { together: fr.together, sides: new Map(fr.sides) })) { this.friendBroadcast(fr); return; }
    for (const t of tickets) t.peer.send({ t: 'queue', e: { type: 'queue', state: 'idle', queue: fr.queue, reason: 'cancelled' } });
    this.friendBroadcast(fr);
  }

  /** leave your friend room (the next member hosts; an empty room is gone) */
  private friendLeave(c: Conn): void {
    const fr = c.friends;
    if (!fr) return;
    c.friends = null;
    fr.members = fr.members.filter((m) => m !== c);
    fr.sides.delete(c.id);
    fr.start?.tickets.delete(c.id);
    if (!fr.members.length) { if (fr.start) clearTimeout(fr.start.timer); this.friendRooms.delete(fr.code); this.log(`friends ${fr.code} · closed`); return; }
    if (fr.start && fr.members.every((x) => fr.start!.tickets.has(x.id))) this.friendLaunch(fr);
    this.friendBroadcast(fr);
  }

  private broadcastStats(): void {
    const searching: Record<string, number> = {};
    for (const [q, list] of this.tickets) if (list.length) searching[q] = list.length;
    const m: ServerMsg = { t: 'stats', online: this.conns.size, searching };
    for (const c of this.conns.values()) if (c.hello) c.send(m);
  }
}
