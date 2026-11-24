// Room DO: one per 4-character code (idFromName(code)). A small validating relay with presence:
//   - the Worker claims a fresh code for "Start room" (claim()), then opens the creator's socket as the owner
//   - joiners are refused with 4004 when the code was never claimed or has expired, 4009 when MAX_SOCKETS are in
//   - every client text {t, d, to?} is re-sent to the others as {from, t, d}; with `to` only the addressee gets it
//   - presence {k:"presence", ids, owner} goes to everyone whenever someone joins or leaves
//   - "ping" -> "pong" is answered by the runtime without waking the object (keep-alive, not billed as a message)
// The game itself stays peer-run (the owner's browser simulates the opponents), exactly as before; this object
// never looks inside `d`. Hibernation API: an idle room costs nothing while its sockets stay open.
import { DurableObject } from 'cloudflare:workers';
import { CLOSE_BAD, CLOSE_FULL, CLOSE_NO_ROOM, PEER_RE, num, type Env } from './env';

interface Attachment {
  id: string;
  at: number; // join time: the host hand-over goes to the longest-present player
}

const MAX_TEXT = 16 * 1024; // the biggest real packet (host state + 24 opponent snapshots + events) is ~3 KB
const RATE_PER_S = 120; // per socket; the host's worst case is ~40/s, so this only stops a runaway client
const EMPTY_TTL_MS = 15 * 60e3; // an empty (or never-joined) room keeps its code this long, then forgets it
const OWNER_GRACE_MS = 20e3; // a host whose connection DROPPED keeps the room this long before it is handed over
const FLUSH_MSGS = 200; // meter batch size ...
const FLUSH_MS = 30e3; // ... or age

export class Room extends DurableObject<Env> {
  private pendingMsgs = 0;
  private pendingConns = 0;
  private lastFlush = Date.now();
  private rate = new Map<string, { t: number; n: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** Claim this code for a new room. false = already in use (the Worker tries another code). */
  async claim(code: string): Promise<boolean> {
    const cur = await this.ctx.storage.get<{ code: string; at: number }>('room');
    if (cur && this.ctx.getWebSockets().length > 0) return false;
    if (cur && Date.now() - cur.at < EMPTY_TTL_MS) return false;
    await this.ctx.storage.put('room', { code, at: Date.now(), owner: '' });
    await this.ctx.storage.setAlarm(Date.now() + EMPTY_TTL_MS);
    return true;
  }

  async debug(): Promise<unknown> {
    return {
      room: (await this.ctx.storage.get('room')) ?? null,
      ids: this.ids(),
      pendingMsgs: this.pendingMsgs,
      pendingConns: this.pendingConns,
    };
  }

  private ids(): string[] {
    const out: string[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && ws.readyState === WebSocket.OPEN) out.push(a.id);
    }
    return out;
  }

  private refuse(code: number, why: string): Response {
    const pair = new WebSocketPair();
    const server = pair[1];
    server.accept();
    server.send(JSON.stringify({ k: 'err', code, why }));
    server.close(code, why);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async fetch(req: Request): Promise<Response> {
    const u = new URL(req.url);
    const id = u.searchParams.get('id') ?? '';
    const code = u.searchParams.get('code') ?? '';
    const asOwner = u.searchParams.get('owner') === '1';
    if (!PEER_RE.test(id)) return this.refuse(CLOSE_BAD, 'bad id');

    const room = await this.ctx.storage.get<{ code: string; at: number; owner: string }>('room');
    if (!room) return this.refuse(CLOSE_NO_ROOM, 'no such room');

    // same peer reconnecting: drop the old socket first
    for (const ws of this.ctx.getWebSockets(id)) {
      try {
        ws.close(4001, 'replaced');
      } catch {
        /* already gone */
      }
    }
    if (this.ids().filter((x) => x !== id).length >= num(this.env, 'MAX_SOCKETS', 8)) return this.refuse(CLOSE_FULL, 'room full');

    if (asOwner && !room.owner) {
      room.owner = id;
      await this.ctx.storage.put('room', room);
    }
    // the only alarm on an occupied room is a host's grace period: keep it unless the room was empty (expiry)
    const wasEmpty = this.others().length === 0;
    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [id]);
    server.serializeAttachment({ id, at: Date.now() } satisfies Attachment);
    this.pendingConns++;
    if (wasEmpty) await this.ctx.storage.deleteAlarm();

    const ids = this.ids();
    server.send(JSON.stringify({ k: 'welcome', room: room.code || code, id, owner: room.owner, ids }));
    this.broadcastPresence(room.owner, server);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private broadcastPresence(owner: string, skip?: WebSocket): void {
    const msg = JSON.stringify({ k: 'presence', ids: this.ids(), owner });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === skip) continue;
      try {
        ws.send(msg);
      } catch {
        /* closing */
      }
    }
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): Promise<void> {
    this.pendingMsgs++;
    this.maybeFlush(false);
    if (typeof msg !== 'string' || msg.length > MAX_TEXT) return;
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a) return;
    const now = Date.now();
    const r = this.rate.get(a.id);
    if (!r || now - r.t >= 1000) this.rate.set(a.id, { t: now, n: 1 });
    else if (++r.n > RATE_PER_S) return;

    let m: { t?: unknown; d?: unknown; to?: unknown };
    try {
      m = JSON.parse(msg);
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string' || m.t.length > 16) return;
    const out = JSON.stringify({ from: a.id, t: m.t, d: m.d ?? {} });
    const targets = typeof m.to === 'string' && PEER_RE.test(m.to) ? this.ctx.getWebSockets(m.to) : this.ctx.getWebSockets();
    for (const peer of targets) {
      if (peer === ws) continue;
      try {
        peer.send(out);
      } catch {
        /* closing */
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string, _clean: boolean): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye');
    } catch {
      /* already closed */
    }
    // 1000 = the player pressed LEAVE ROOM / MAIN MENU; anything else is a drop that may come back
    await this.left(ws, code === 1000);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.left(ws, false);
  }

  /** Open sockets other than `skip`, oldest first. */
  private others(skip?: WebSocket): { ws: WebSocket; a: Attachment }[] {
    const out: { ws: WebSocket; a: Attachment }[] = [];
    for (const s of this.ctx.getWebSockets()) {
      if (s === skip || s.readyState !== WebSocket.OPEN) continue;
      const a = s.deserializeAttachment() as Attachment | null;
      if (a) out.push({ ws: s, a });
    }
    return out.sort((x, y) => x.a.at - y.a.at);
  }

  /** Hand the room to the longest-present player when its host is gone (party-leader hand-over). */
  private async handOver(room: { code: string; at: number; owner: string }, skip?: WebSocket): Promise<void> {
    const ids = this.others(skip).map((o) => o.a.id);
    if (!room.owner || ids.includes(room.owner) || !ids.length) return;
    room.owner = ids[0];
    await this.ctx.storage.put('room', room);
  }

  private async left(ws: WebSocket, clean: boolean): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (a) this.rate.delete(a.id);
    const room = await this.ctx.storage.get<{ code: string; at: number; owner: string }>('room');
    const stillHere = a ? this.others(ws).some((o) => o.a.id === a.id) : false; // replaced by a rejoin
    if (room && a && a.id === room.owner && !stillHere) {
      if (clean) await this.handOver(room, ws);
      else await this.ctx.storage.setAlarm(Date.now() + OWNER_GRACE_MS);
    }
    this.broadcastPresence(room?.owner ?? '', ws);
    if (!this.others(ws).length) {
      this.maybeFlush(true);
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_TTL_MS);
    }
  }

  private maybeFlush(force: boolean): void {
    const n = this.pendingMsgs;
    const c = this.pendingConns;
    if (!n && !c) return;
    if (!force && n < FLUSH_MSGS && Date.now() - this.lastFlush < FLUSH_MS) return;
    this.pendingMsgs = 0;
    this.pendingConns = 0;
    this.lastFlush = Date.now();
    const meter = this.env.METER.get(this.env.METER.idFromName('meter'));
    this.ctx.waitUntil(meter.add(n, c).catch(() => undefined));
  }

  async alarm(): Promise<void> {
    if (this.others().length) {
      // someone is here: this was the host's grace period. Hand over if the host did not come back.
      const room = await this.ctx.storage.get<{ code: string; at: number; owner: string }>('room');
      if (room) {
        const before = room.owner;
        await this.handOver(room);
        if (room.owner !== before) this.broadcastPresence(room.owner);
      }
      return;
    }
    this.maybeFlush(true);
    await this.ctx.storage.deleteAll();
  }
}
