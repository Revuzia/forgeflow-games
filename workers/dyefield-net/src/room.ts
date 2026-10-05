// Room DO (§O2.3): one instance per 4-character room code. A dumb, validating relay:
//  - binary frames are routed by byte 0 (kind) and byte 1 (slot) only (+ the u32 tick at bytes 2..5 of SNAP/HANDOFF);
//  - small JSON text frames carry the control protocol (§O3.3);
//  - it picks the host (§O4.4), detects host loss (§O6.2), voids a match on the 4th host loss, caches the last `end`
//    for reconnects during `post`, meters usage and admits matches against the daily cap (§O2.5).
//
// State, and where it lives:
//  - `st` (RoomState) in memory while awake; mirrored into every connected socket's attachment on every change (no
//    storage cost, survives hibernation while anyone is connected); written to storage ONLY on transitions (claim,
//    start, live, host change, post, close, owner change, late-fill reserve) — ≤ ~10 row writes per match (§O2.3,
//    gated by T8 at ≤ 20). The last `end` text is stored with the `post` write so a reconnect after a hibernation
//    still receives it.
//  - rate buckets, drop windows, usage accumulators, lastSnapTick, host liveness: memory only (rebuilt after a wake).
import { DurableObject } from 'cloudflare:workers';
import { isDev, num, timing, type Env } from './env';
import {
  ABUSE_DROPS,
  ABUSE_WINDOW_MS,
  CAP_END_CACHE,
  CAP_HANDOFF,
  CAP_INTENTS,
  CAP_KEYFRAME,
  CAP_SNAP,
  CAP_TEXT_CLIENT,
  CAP_TEXT_HOST,
  CLOSE_BUILD,
  CLOSE_CLOSED,
  CLOSE_FULL,
  CLOSE_KICKED,
  CLOSE_LEAVE,
  CLOSE_NOT_FOUND,
  CLOSE_QUOTA,
  CLOSE_RATE,
  K_HANDOFF,
  K_INTENTS,
  K_KEYFRAME,
  K_SNAP,
  KEYFRAME_MIN_GAP_MS,
  KIT_RE,
  MAPS,
  MAX_HUMANS,
  PRESET_RE,
  PROTO,
  RATE_CLIENT,
  RATE_HOST,
  TOKEN_RE,
  clampNum,
  estimateMatch,
  isMode,
  isRule,
  isSkill,
  sanitizeName,
  type ErrCode,
  type Mode,
  type Rule,
  type Skill,
  type Usage,
} from './proto';
import { DropWindow, TokenBucket, randomInt, randomToken, randomU32, refuseSocket, safeClose, safeSend } from './util';
import type { Release } from './meter';

export type Phase = 'room' | 'loading' | 'live' | 'post' | 'closed';

export interface Member {
  slot: number;
  /** Join number, unique per room: tells a reconnect (same jid) from a new player who got a freed slot number. */
  jid: number;
  token: string;
  ticket: string | null;
  name: string;
  kit: string;
  crew: number;
  color: number;
  device: 'kbm' | 'touch';
  simMs: number;
  rttMs: number | null;
  joinedAt: number;
  ip: string;
  helloed: boolean;
  conn: boolean;
  leftAt: number;
  /** Id of the member's current socket ('' while disconnected). A close event from an older socket is ignored. */
  sid: string;
}

export interface Reservation {
  day: string;
  units: number;
  raw: number;
}

export interface RoomState {
  v: 1;
  ver: number;
  code: string;
  quick: boolean;
  mode: Mode;
  rule: Rule;
  build: string;
  map: string; // 'random' | map id (the room setting)
  preset: string;
  skill: Skill;
  durationS: number | null; // DEV only (cfg.durationS / DEV_QUICK_DURATION_S)
  phase: Phase;
  prevPhase: Phase | null;
  ownerSlot: number;
  hostSlot: number;
  matchNo: number;
  createdAt: number;
  updatedAt: number;
  roomSince: number;
  closedAt: number;
  tickets: string[];
  ownerKey: string | null;
  lobby: string | null;
  nextJid: number;
  members: Member[];
  // the current / last match
  seed: number;
  mapResolved: string;
  humansAtStart: number;
  hostLosses: number;
  liveAt: number;
  resv: Reservation | null;
}

interface Attachment {
  sid: string;
  slot: number;
  st: RoomState;
}

interface Persisted {
  st: RoomState;
  endText: string | null;
}

export interface ClaimOpts {
  code: string;
  quick: boolean;
  mode: Mode;
  rule: Rule;
  build: string;
  tickets?: string[];
  lobby?: string | null;
}

interface SockEph {
  bucket: TokenBucket;
  drops: DropWindow;
  lastMsgAt: number;
  lastKeyframeAt: number;
}

const ROLE_TEXT_HOST = new Set(['roster', 'seat', 'end']);
/** LOAD_TIMEOUT_S (25) + margin: a host silent this long while `loading` is treated as stalled. */
const LOADING_STALL_MS = 30_000;
const ROLE_TEXT_TO_HOST = new Set(['loaded', 'resync']);

export class Room extends DurableObject<Env> {
  private st: RoomState | null = null;
  private endText: string | null = null;
  private socks = new Map<string, WebSocket>(); // sid -> socket
  private reconnectSids = new Set<string>(); // sockets that came back with a token (they get the cached `end`)
  /** Hot-path cache: socket → its identity, so a relayed frame never deserializes the (≈ 3 KB) attachment. */
  private ids = new WeakMap<WebSocket, { sid: string; slot: number }>();
  private eph = new Map<string, SockEph>(); // sid -> rate state
  private instanceId = randomToken().slice(0, 8);
  private loadedFrom: 'fresh' | 'storage' | 'attachments' = 'fresh';
  // usage accumulators (§O2.3): raw counts every frame 1:1, units counts frames at 1/20
  private accRaw = 0;
  private accUnits = 0;
  private lastFlushAt = Date.now();
  private lastPingAcctAt = Date.now();
  private flushing = false;
  // host liveness / migration
  private lastSnapTick = 0;
  private hostLastFrameAt = 0;
  private hostLeaving = false;
  private avoidHosts = new Set<number>(); // slots whose host stint this match ended in a stall or handoff
  private starting = false;
  private autostartTimer: ReturnType<typeof setTimeout> | null = null;
  private rematchTimer: ReturnType<typeof setTimeout> | null = null;
  private rematchVotes = new Set<number>();
  // test read-backs
  private putCount = 0;
  private putsByMatch: Record<string, number> = {};
  private stats = {
    framesIn: 0,
    framesOut: 0,
    textIn: 0,
    binIn: 0,
    dropped: 0,
    abuse: 0,
    byKind: {} as Record<string, number>,
    snapsRelayed: 0,
    intentsRelayed: 0,
    keyframesRelayed: 0,
    migrations: 0,
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('p', 'P'));
    ctx.blockConcurrencyWhile(async () => {
      await this.load();
    });
  }

  // ======================================================================================
  // state load / mirror / persist
  // ======================================================================================

  private async load(): Promise<void> {
    const p = await this.ctx.storage.get<Persisted>('r');
    let st: RoomState | null = p?.st ?? null;
    this.endText = p?.endText ?? null;
    this.loadedFrom = st ? 'storage' : 'fresh';
    const live: Attachment[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      let a: Attachment | null = null;
      try {
        a = ws.deserializeAttachment() as Attachment | null;
      } catch {
        a = null;
      }
      if (!a || typeof a.sid !== 'string') continue;
      live.push(a);
      this.socks.set(a.sid, ws);
      this.ids.set(ws, { sid: a.sid, slot: a.slot });
      if (a.st && (!st || (a.st.code === st.code && a.st.ver > st.ver) || a.st.createdAt > st.createdAt)) {
        st = a.st;
        this.loadedFrom = 'attachments';
      }
    }
    if (st) {
      // connected sockets are the truth for "who is connected"
      const liveSids = new Set(live.map((a) => a.sid));
      for (const m of st.members) {
        if (m.conn && !liveSids.has(m.sid)) {
          m.conn = false;
          m.sid = '';
          m.leftAt = Date.now();
        }
      }
      for (const a of live) {
        const m = st.members.find((x) => x.slot === a.slot);
        if (m && m.sid !== a.sid) {
          // a socket whose member record moved on (replaced) — close it
          const ws = this.socks.get(a.sid);
          this.socks.delete(a.sid);
          if (ws) safeClose(ws, CLOSE_LEAVE, 'replaced');
        }
      }
    }
    this.st = st;
    if (st && (st.phase === 'live' || st.phase === 'loading')) this.hostLastFrameAt = Date.now();
    // the connected sockets kept pinging (auto-responses) while the object slept: estimate from the last change on
    if (st && st.phase !== 'closed' && live.length) this.lastPingAcctAt = Math.min(Date.now(), st.updatedAt);
  }

  /** A state change: bump the version and mirror the state into every connected socket's attachment (free). */
  private touch(): void {
    const st = this.st;
    if (!st) return;
    st.ver++;
    st.updatedAt = Date.now();
    for (const m of st.members) {
      if (!m.conn || !m.sid) continue;
      const ws = this.socks.get(m.sid);
      if (!ws) continue;
      try {
        ws.serializeAttachment({ sid: m.sid, slot: m.slot, st } satisfies Attachment);
      } catch {
        /* > 16 KB cannot happen with ≤ 8 members; ignore */
      }
    }
  }

  /** A transition: touch + one storage row write. */
  private persist(): void {
    const st = this.st;
    if (!st) return;
    this.touch();
    const body: Persisted = { st, endText: st.phase === 'post' || st.phase === 'closed' ? this.endText : null };
    void this.ctx.storage.put('r', body);
    this.putCount++;
    const k = String(st.matchNo);
    this.putsByMatch[k] = (this.putsByMatch[k] ?? 0) + 1;
  }

  // ======================================================================================
  // RPC (Worker / Lobby)
  // ======================================================================================

  /** §O2.3 claim: succeeds when unclaimed, closed, or idle (no sockets) for ROOM_RECLAIM_MIN. */
  claim(o: ClaimOpts): { ok: boolean; why?: string; ownerKey?: string } {
    this.accOther(1);
    const now = Date.now();
    const st = this.st;
    if (st && st.phase !== 'closed') {
      const anyConn = st.members.some((m) => m.conn);
      const idle = now - st.updatedAt > timing(this.env, 'ROOM_RECLAIM_MIN') * 60_000;
      if (anyConn || !idle) return { ok: false, why: 'busy' };
    }
    // reset: close any stragglers
    for (const ws of this.ctx.getWebSockets()) safeClose(ws, CLOSE_CLOSED, 'reclaimed');
    this.socks.clear();
    this.eph.clear();
    this.clearTimers();
    this.endText = null;
    const quickDur = isDev(this.env) ? num(this.env, 'DEV_QUICK_DURATION_S', 0) : 0;
    const ownerKey = o.quick ? null : randomToken();
    this.st = {
      v: 1,
      ver: (st?.ver ?? 0) + 1,
      code: o.code,
      quick: !!o.quick,
      mode: o.mode,
      rule: o.rule,
      build: o.build,
      map: 'random',
      preset: 'noon',
      skill: 'swell',
      durationS: o.quick && quickDur > 0 ? quickDur : null,
      phase: 'room',
      prevPhase: null,
      ownerSlot: -1,
      hostSlot: -1,
      matchNo: 0,
      createdAt: now,
      updatedAt: now,
      roomSince: now,
      closedAt: 0,
      tickets: Array.isArray(o.tickets) ? o.tickets.filter((t) => TOKEN_RE.test(t)).slice(0, MAX_HUMANS) : [],
      ownerKey,
      lobby: o.lobby ?? null,
      nextJid: 1,
      members: [],
      seed: 0,
      mapResolved: '',
      humansAtStart: 0,
      hostLosses: 0,
      liveAt: 0,
      resv: null,
    };
    this.putsByMatch = {};
    this.putCount = 0;
    this.persist();
    return ownerKey ? { ok: true, ownerKey } : { ok: true };
  }

  /** §O2.4 late fill: the Lobby reserves an open seat of a live quick room for one more player. */
  async reserve(ticket: string): Promise<{ ok: boolean; why?: string }> {
    this.accOther(1);
    const st = this.st;
    const now = Date.now();
    if (!st || !st.quick || st.phase !== 'live' || !TOKEN_RE.test(ticket)) return { ok: false, why: 'phase' };
    const occupied = st.members.length + st.tickets.filter((t) => !st.members.some((m) => m.ticket === t)).length;
    if (occupied >= MAX_HUMANS) return { ok: false, why: 'full' };
    if (this.endsAt() - now < timing(this.env, 'LATE_JOIN_MIN_LEFT_S') * 1000) return { ok: false, why: 'late' };
    const n = Math.max(1, st.humansAtStart);
    const a = estimateMatch(n + 1, st.durationS ?? undefined);
    const b = estimateMatch(n, st.durationS ?? undefined);
    const diff: Usage = { units: a.units - b.units, raw: a.raw - b.raw };
    const r = await this.meterAdmit(diff);
    if (!r.ok || !this.st || this.st.phase !== 'live') return { ok: false, why: 'quota' };
    st.tickets.push(ticket);
    st.humansAtStart = n + 1;
    if (st.resv && st.resv.day === r.day) {
      st.resv.units += diff.units;
      st.resv.raw += diff.raw;
    } else st.resv = { day: r.day, ...diff };
    this.persist();
    this.reportOpen();
    return { ok: true };
  }

  /** DEV read-back for the tests (state, write counts, counters, instance id). */
  debug(): unknown {
    if (!isDev(this.env)) throw new Error('dev only');
    return {
      instanceId: this.instanceId,
      loadedFrom: this.loadedFrom,
      st: this.st,
      endCached: this.endText ? this.endText.length : 0,
      sockets: this.ctx.getWebSockets().length,
      putCount: this.putCount,
      putsByMatch: this.putsByMatch,
      stats: this.stats,
      lastSnapTick: this.lastSnapTick,
      hostLeaving: this.hostLeaving,
      acc: { raw: this.accRaw, units: this.accUnits },
    };
  }

  // ======================================================================================
  // WebSocket accept
  // ======================================================================================

  async fetch(req: Request): Promise<Response> {
    this.accOther(1); // the connection request
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
    const u = new URL(req.url);
    const code = u.searchParams.get('code') ?? '';
    const build = u.searchParams.get('build') ?? '';
    const tokenQ = u.searchParams.get('token');
    const ticketQ = u.searchParams.get('ticket');
    const ownerKey = u.searchParams.get('ownerKey');
    const token = tokenQ && TOKEN_RE.test(tokenQ) ? tokenQ : null;
    const ticket = ticketQ && TOKEN_RE.test(ticketQ) ? ticketQ : null;
    const ip = req.headers.get('x-df-ip') ?? '';
    const now = Date.now();
    this.housekeep(now);
    let st = this.st;

    if (!st || st.code !== code) return refuseSocket(CLOSE_NOT_FOUND, 'not_found', 'No room with that code');
    if (st.phase === 'closed') {
      // revive: a token reconnect shortly after the last socket dropped (a relay restart drops every socket at once)
      const m = token ? st.members.find((x) => x.token === token) : undefined;
      const grace = timing(this.env, 'RECONNECT_GRACE_S') * 1000;
      if (m && st.prevPhase && now - st.closedAt <= grace) {
        st.phase = st.prevPhase;
        st.prevPhase = null;
        if (st.phase === 'live' || st.phase === 'loading') this.hostLastFrameAt = now + timing(this.env, 'HOST_STALL_MS');
        this.persist();
      } else return refuseSocket(CLOSE_NOT_FOUND, 'not_found', 'This room has closed');
    }
    st = this.st!;
    if (build !== st.build)
      return refuseSocket(CLOSE_BUILD, 'build', 'Update DYEFIELD: reload the page (your version differs from the room)');

    let m: Member | undefined = token ? st.members.find((x) => x.token === token) : undefined;
    if (!m && ticket && st.quick) m = st.members.find((x) => x.ticket === ticket);
    let reconnect = !!m;
    if (!m) {
      if (st.quick) {
        if (!ticket || !st.tickets.includes(ticket))
          return refuseSocket(CLOSE_NOT_FOUND, 'bad', 'Quick-match rooms need a ticket from the lobby');
      } else if (ownerKey && ownerKey !== st.ownerKey) return refuseSocket(CLOSE_NOT_FOUND, 'bad', 'bad owner key');
      const perIp = num(this.env, 'PER_IP_ROOM', 8);
      if (perIp > 0 && ip && st.members.filter((x) => x.conn && x.ip === ip).length >= perIp)
        return refuseSocket(CLOSE_RATE, 'rate', 'Too many connections from your network');
      if (st.members.length >= MAX_HUMANS) {
        // outside a match, the oldest disconnected member gives up its seat
        const evictable =
          st.phase === 'room' || st.phase === 'post'
            ? st.members.filter((x) => !x.conn).sort((a, b) => a.leftAt - b.leftAt)[0]
            : undefined;
        if (!evictable) return refuseSocket(CLOSE_FULL, 'room_full', 'This room is full (8 players)');
        this.removeMember(evictable);
      }
      let slot = 0;
      while (st.members.some((x) => x.slot === slot)) slot++;
      m = {
        slot,
        jid: st.nextJid++,
        token: randomToken(),
        ticket: st.quick ? ticket : null,
        name: sanitizeName(''),
        kit: 'mist-rasp',
        crew: 0,
        color: 0,
        device: 'kbm',
        simMs: 5,
        rttMs: null,
        joinedAt: now,
        ip,
        helloed: false,
        conn: true,
        leftAt: 0,
        sid: '',
      };
      st.members.push(m);
      st.members.sort((a, b) => a.slot - b.slot);
      if (!st.quick && ownerKey && ownerKey === st.ownerKey) {
        st.ownerSlot = slot;
        st.ownerKey = null;
      } else if (!st.quick && st.ownerSlot < 0) st.ownerSlot = slot;
      reconnect = false;
    } else {
      const old = m.sid ? this.socks.get(m.sid) : undefined;
      if (old) {
        this.socks.delete(m.sid);
        this.eph.delete(m.sid);
        safeClose(old, CLOSE_LEAVE, 'replaced');
      }
      m.conn = true;
      m.ip = ip;
      m.leftAt = 0;
      if (!st.quick && st.ownerSlot < 0) st.ownerSlot = m.slot; // the room had nobody connected (revive)
    }
    const pair = new WebSocketPair();
    const server = pair[1];
    m.sid = randomToken().slice(0, 12);
    this.ctx.acceptWebSocket(server, ['s' + m.slot]);
    this.socks.set(m.sid, server);
    this.ids.set(server, { sid: m.sid, slot: m.slot });
    this.eph.set(m.sid, this.newEph(now));
    if (reconnect) this.reconnectSids.add(m.sid);
    this.touch();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ======================================================================================
  // WebSocket events
  // ======================================================================================

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): Promise<void> {
    const now = Date.now();
    this.accRaw += 1;
    this.accUnits += 1 / 20;
    this.stats.framesIn++;
    const st = this.st;
    const a = this.ident(ws);
    if (!st || !a) {
      safeClose(ws, CLOSE_CLOSED, 'gone');
      return;
    }
    const m = st.members.find((x) => x.slot === a.slot);
    if (!m || m.sid !== a.sid) {
      safeClose(ws, CLOSE_LEAVE, 'replaced');
      return;
    }
    if (!this.socks.has(a.sid)) this.socks.set(a.sid, ws);
    let e = this.eph.get(a.sid);
    if (!e) {
      e = this.newEph(now);
      this.eph.set(a.sid, e);
    }
    e.lastMsgAt = now;
    const isHost = m.slot === st.hostSlot && (st.phase === 'loading' || st.phase === 'live');
    // any frame from the host refreshes its liveness (and ends a fresh host's promotion grace)
    if (isHost) this.hostLastFrameAt = now;

    // rate cap (§O8): token bucket per socket
    const rate = isHost ? RATE_HOST : RATE_CLIENT;
    e.bucket.rate = rate;
    e.bucket.burst = rate;
    if (!e.bucket.take(now)) {
      this.abuse(ws, e, now, 'rate');
      return;
    }

    if (typeof msg === 'string') {
      this.stats.textIn++;
      const cap = isHost ? CAP_TEXT_HOST : CAP_TEXT_CLIENT;
      if (msg.length > cap) {
        this.abuse(ws, e, now, 'text-size');
        return;
      }
      let o: Record<string, unknown> | null = null;
      try {
        const v = JSON.parse(msg);
        o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
      } catch {
        o = null;
      }
      if (!o || typeof o.t !== 'string') {
        this.abuse(ws, e, now, 'text-parse');
        return;
      }
      await this.onText(ws, e, m, isHost, o, now);
    } else {
      this.stats.binIn++;
      this.onBinary(ws, e, m, isHost, msg, now);
    }
    this.afterEvent(now);
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.onSocketGone(ws, code);
    safeClose(ws, 1000, 'bye');
  }

  async webSocketError(ws: WebSocket, _err: unknown): Promise<void> {
    this.onSocketGone(ws, 1006);
  }

  private onSocketGone(ws: WebSocket, code: number): void {
    const st = this.st;
    const a = this.ident(ws);
    if (!st || !a) return;
    this.socks.delete(a.sid);
    this.eph.delete(a.sid);
    const m = st.members.find((x) => x.slot === a.slot);
    if (!m || m.sid !== a.sid) return; // stale socket (replaced or already handled)
    this.memberGone(m, code === CLOSE_LEAVE, Date.now());
  }

  // ======================================================================================
  // binary routing (§O3.2)
  // ======================================================================================

  private onBinary(ws: WebSocket, e: SockEph, m: Member, isHost: boolean, buf: ArrayBuffer, now: number): void {
    const st = this.st!;
    const len = buf.byteLength;
    if (len < 2) return this.abuse(ws, e, now, 'bin-short');
    const b = new Uint8Array(buf, 0, 2);
    const kind = b[0];
    const slotByte = b[1];
    this.stats.byKind[kind] = (this.stats.byKind[kind] ?? 0) + 1;
    if (!m.helloed) return this.quietDrop();
    const inMatch = st.phase === 'loading' || st.phase === 'live';
    switch (kind) {
      case K_INTENTS: {
        if (len > CAP_INTENTS) return this.abuse(ws, e, now, 'intents-size');
        if (isHost) return this.abuse(ws, e, now, 'intents-from-host');
        if (slotByte !== m.slot) return this.abuse(ws, e, now, 'intents-spoof');
        if (!inMatch) return this.quietDrop();
        const h = this.hostSocket();
        if (!h) return this.quietDrop();
        if (safeSend(h, buf)) {
          this.stats.framesOut++;
          this.stats.intentsRelayed++;
        }
        return;
      }
      case K_SNAP: {
        if (len > CAP_SNAP) return this.abuse(ws, e, now, 'snap-size');
        if (!isHost) {
          // an old host that has not seen `host` yet, or a forger
          return this.abuse(ws, e, now, 'snap-not-host');
        }
        if (len >= 6) this.lastSnapTick = new DataView(buf).getUint32(2, true);
        if (st.phase === 'loading') {
          st.phase = 'live';
          st.liveAt = now;
          this.lastFlushAt = now;
          this.persist();
          this.reportOpen();
        }
        this.stats.snapsRelayed++;
        this.fanout(buf, m.slot);
        return;
      }
      case K_KEYFRAME: {
        if (len > CAP_KEYFRAME) return this.abuse(ws, e, now, 'keyframe-size');
        if (!isHost) return this.abuse(ws, e, now, 'keyframe-not-host');
        const t = st.members.find((x) => x.slot === slotByte && x.conn);
        const tw = t ? this.socks.get(t.sid) : undefined;
        if (!t || !tw || t.slot === m.slot) return this.quietDrop();
        const te = this.eph.get(t.sid);
        if (te && now - te.lastKeyframeAt < KEYFRAME_MIN_GAP_MS) return this.abuse(ws, e, now, 'keyframe-rate');
        if (te) te.lastKeyframeAt = now;
        if (safeSend(tw, buf)) {
          this.stats.framesOut++;
          this.stats.keyframesRelayed++;
        }
        return;
      }
      case K_HANDOFF: {
        if (len > CAP_HANDOFF) return this.abuse(ws, e, now, 'handoff-size');
        if (!isHost || st.phase !== 'live') return this.abuse(ws, e, now, 'handoff-not-host');
        const tick = len >= 6 ? new DataView(buf).getUint32(2, true) : this.lastSnapTick;
        this.fanout(buf, m.slot);
        this.hostLoss('handoff', tick, now);
        return;
      }
      default:
        return this.abuse(ws, e, now, 'bin-kind');
    }
  }

  // ======================================================================================
  // text control (§O3.3)
  // ======================================================================================

  private async onText(
    ws: WebSocket,
    e: SockEph,
    m: Member,
    isHost: boolean,
    o: Record<string, unknown>,
    now: number,
  ): Promise<void> {
    const st = this.st!;
    const t = o.t as string;
    const inMatch = st.phase === 'loading' || st.phase === 'live';
    if (!m.helloed && t !== 'hello' && t !== 'leave') return this.quietDrop();

    if (ROLE_TEXT_HOST.has(t)) {
      if (!isHost) return this.abuse(ws, e, now, 'host-text-not-host');
      o.from = m.slot;
      const s = JSON.stringify(o);
      if (t === 'end') {
        if (typeof o.matchNo === 'number' && o.matchNo !== st.matchNo) return this.quietDrop();
        this.toAll(s, m.slot);
        await this.enterPost(s.length <= CAP_END_CACHE ? s : null, now);
        return;
      }
      this.toAll(s, m.slot);
      return;
    }
    if (ROLE_TEXT_TO_HOST.has(t)) {
      if (!inMatch || isHost) return this.quietDrop();
      const h = this.hostSocket();
      if (!h) return this.quietDrop();
      o.from = m.slot;
      if (safeSend(h, JSON.stringify(o))) this.stats.framesOut++;
      return;
    }

    switch (t) {
      case 'hello':
        return this.onHello(ws, m, o, now);
      case 'set':
        return this.onSet(m, o);
      case 'cfg':
        return this.onCfg(ws, m, o);
      case 'start':
        if (st.quick || m.slot !== st.ownerSlot || (st.phase !== 'room' && st.phase !== 'post')) return this.quietDrop();
        if (this.connectedHumans().length < 2) {
          this.sendErr(ws, 'bad', 'Need at least 2 players to start');
          return;
        }
        await this.startMatch(now);
        return;
      case 'kick':
        return this.onKick(ws, m, isHost, o, now);
      case 'handoff':
        if (isHost) this.hostLeaving = true;
        return;
      case 'rematch':
        return this.onRematch(m, now);
      case 'leave':
        this.memberGone(m, true, now);
        safeClose(ws, CLOSE_LEAVE, 'leave');
        return;
      case 'dbg':
        if (isDev(this.env)) safeSend(ws, JSON.stringify({ t: 'dbg', ...(this.debug() as object) }));
        return;
      default:
        return this.abuse(ws, e, now, 'text-unknown');
    }
  }

  private onHello(ws: WebSocket, m: Member, o: Record<string, unknown>, now: number): void {
    const st = this.st!;
    if (o.proto !== num(this.env, 'PROTO', PROTO)) {
      this.sendErr(ws, 'proto', 'Update DYEFIELD: reload the page (protocol differs)');
      this.memberGone(m, true, now);
      safeClose(ws, CLOSE_BUILD, 'proto');
      return;
    }
    if (typeof o.build === 'string' && o.build !== st.build) {
      this.sendErr(ws, 'build', 'Update DYEFIELD: reload the page (your version differs from the room)');
      this.memberGone(m, true, now);
      safeClose(ws, CLOSE_BUILD, 'build');
      return;
    }
    this.applyProfile(m, o, true);
    const wasHelloed = m.helloed;
    const re = this.reconnectSids.has(m.sid);
    m.helloed = true;
    safeSend(ws, JSON.stringify({ t: 'welcome', slot: m.slot, jid: m.jid, token: m.token, room: this.roomView() }));
    if (st.phase === 'loading' || st.phase === 'live') safeSend(ws, JSON.stringify(this.assignMsg()));
    if (st.phase === 'post' && this.endText && (re || wasHelloed)) safeSend(ws, this.endText);
    this.touch();
    if (st.phase === 'loading' || st.phase === 'live')
      this.toAll(JSON.stringify({ t: 'peer', slot: m.slot, jid: m.jid, conn: true, rejoin: re || wasHelloed }), m.slot);
    this.broadcastMembers();
    if (st.quick && st.phase === 'room') this.quickMaybeStart(now);
  }

  private onSet(m: Member, o: Record<string, unknown>): void {
    const st = this.st!;
    const pre = st.phase === 'room' || st.phase === 'post';
    this.applyProfile(m, o, pre);
    this.touch();
    if (pre && m.helloed) this.broadcastMembers();
  }

  private applyProfile(m: Member, o: Record<string, unknown>, full: boolean): void {
    if (full) {
      if ('name' in o) m.name = sanitizeName(o.name);
      if (typeof o.kit === 'string' && KIT_RE.test(o.kit)) m.kit = o.kit;
      if ('crew' in o) m.crew = Math.round(clampNum(o.crew, 0, 2, m.crew));
      if ('color' in o) m.color = Math.round(clampNum(o.color, 0, 15, m.color));
      if (o.device === 'kbm' || o.device === 'touch') m.device = o.device;
    }
    if ('simMs' in o) m.simMs = clampNum(o.simMs, 0, 100, m.simMs);
    if ('rttMs' in o) m.rttMs = o.rttMs === null ? null : clampNum(o.rttMs, 0, 10_000, m.rttMs ?? 100);
  }

  private onCfg(ws: WebSocket, m: Member, o: Record<string, unknown>): void {
    const st = this.st!;
    if (st.quick || m.slot !== st.ownerSlot || st.phase !== 'room') return this.quietDrop();
    let changed = false;
    if (isMode(o.mode) && o.mode !== st.mode) ((st.mode = o.mode), (changed = true));
    if (isRule(o.rule) && o.rule !== st.rule) ((st.rule = o.rule), (changed = true));
    if (typeof o.map === 'string' && (o.map === 'random' || (MAPS as readonly string[]).includes(o.map)) && o.map !== st.map)
      ((st.map = o.map), (changed = true));
    if (typeof o.preset === 'string' && PRESET_RE.test(o.preset) && o.preset !== st.preset)
      ((st.preset = o.preset), (changed = true));
    if (isSkill(o.skill) && o.skill !== st.skill) ((st.skill = o.skill), (changed = true));
    if ('durationS' in o && isDev(this.env)) {
      const d = o.durationS === null ? null : Math.round(clampNum(o.durationS, 10, 180, 180));
      if (d !== st.durationS) ((st.durationS = d), (changed = true));
    }
    if (!changed) return;
    this.touch(); // mirrored into attachments; stored with the next transition
    this.broadcastMembers();
    void ws;
  }

  private onKick(ws: WebSocket, m: Member, isHost: boolean, o: Record<string, unknown>, now: number): void {
    const st = this.st!;
    const slot = typeof o.slot === 'number' ? o.slot : -1;
    const why = o.why === 'idle' ? 'idle' : 'owner';
    const target = st.members.find((x) => x.slot === slot);
    if (!target || target.slot === m.slot) return this.quietDrop();
    const byHost = why === 'idle' && isHost;
    const byOwner = why === 'owner' && !st.quick && m.slot === st.ownerSlot;
    if (!byHost && !byOwner) return this.quietDrop();
    const tw = target.sid ? this.socks.get(target.sid) : undefined;
    if (tw) {
      safeSend(tw, JSON.stringify({ t: 'kicked', why }));
      safeClose(tw, CLOSE_KICKED, why);
    }
    this.memberGone(target, true, now);
    void ws;
  }

  private onRematch(m: Member, now: number): void {
    const st = this.st!;
    if (st.phase !== 'post') return this.quietDrop();
    if (!st.quick) {
      // code room: the owner's PLAY AGAIN goes back to the room screen (same members, host re-picked at start)
      if (m.slot !== st.ownerSlot) return this.quietDrop();
      this.pruneDisconnected(now, true);
      st.phase = 'room';
      st.roomSince = now;
      st.hostSlot = -1;
      this.endText = null;
      this.persist();
      this.broadcastMembers();
      return;
    }
    this.rematchVotes.add(m.slot);
    this.toAll(JSON.stringify({ t: 'rematch', votes: [...this.rematchVotes] }), -1);
    const conn = this.connectedHumans();
    if (this.rematchVotes.size >= 2 && conn.every((x) => this.rematchVotes.has(x.slot))) {
      void this.quickRematchNow(now);
      return;
    }
    if (!this.rematchTimer) {
      this.rematchTimer = setTimeout(() => {
        this.rematchTimer = null;
        void this.quickRematchWindowEnd();
      }, timing(this.env, 'REMATCH_WINDOW_S') * 1000);
    }
  }

  private async quickRematchNow(now: number): Promise<void> {
    if (this.rematchTimer) clearTimeout(this.rematchTimer);
    this.rematchTimer = null;
    await this.quickRematchWindowEnd(now);
  }

  private async quickRematchWindowEnd(now: number = Date.now()): Promise<void> {
    const st = this.st;
    if (!st || st.phase !== 'post') return;
    const voters = this.connectedHumans().filter((x) => this.rematchVotes.has(x.slot));
    this.rematchVotes.clear();
    if (voters.length >= 2) {
      // non-voters leave the room (their slate shows LEAVE); voters play again
      for (const x of this.connectedHumans()) {
        if (voters.includes(x)) continue;
        const w = this.socks.get(x.sid);
        if (w) {
          safeSend(w, JSON.stringify({ t: 'requeue' }));
          safeClose(w, CLOSE_LEAVE, 'rematch without you');
        }
        this.memberGone(x, true, now);
      }
      await this.startMatch(now);
      return;
    }
    for (const x of voters) {
      const w = this.socks.get(x.sid);
      if (w) {
        safeSend(w, JSON.stringify({ t: 'requeue' }));
        safeClose(w, CLOSE_LEAVE, 'requeue');
      }
      this.memberGone(x, true, now);
    }
  }

  // ======================================================================================
  // match lifecycle
  // ======================================================================================

  private quickMaybeStart(now: number): void {
    const st = this.st!;
    if (this.starting || st.phase !== 'room') return;
    const helloed = this.connectedHumans();
    const expected = Math.max(2, st.tickets.length);
    if (helloed.length >= expected) {
      void this.startMatch(now);
      return;
    }
    if (!this.autostartTimer) {
      this.autostartTimer = setTimeout(() => {
        this.autostartTimer = null;
        void this.quickAutostart();
      }, timing(this.env, 'QM_AUTOSTART_S') * 1000);
    }
  }

  private async quickAutostart(): Promise<void> {
    const st = this.st;
    const now = Date.now();
    if (!st || st.phase !== 'room' || this.starting) return;
    const conn = this.connectedHumans();
    if (conn.length >= 2) {
      await this.startMatch(now);
      return;
    }
    // the others never arrived: tell the lone player (the UI offers KEEP WAITING → re-queue / PLAY VS BOTS)
    for (const x of conn) {
      const w = this.socks.get(x.sid);
      if (w) {
        safeSend(w, JSON.stringify({ t: 'solo' }));
        safeClose(w, CLOSE_LEAVE, 'requeue');
      }
      this.memberGone(x, true, now);
    }
  }

  private async startMatch(now: number): Promise<void> {
    const st = this.st!;
    if (this.starting) return;
    this.starting = true;
    try {
      this.clearTimers();
      this.pruneDisconnected(now, true);
      const humans = this.connectedHumans();
      if (humans.length < 2) return;
      const est = estimateMatch(humans.length, st.durationS ?? undefined);
      const r = await this.meterAdmit(est);
      if (this.st !== st || (st.phase !== 'room' && st.phase !== 'post')) {
        if (r.ok) await this.meterSettle({ day: r.day, ...est });
        return;
      }
      if (!r.ok) {
        const s = JSON.stringify({ t: 'err', code: 'quota', msg: 'Online is full for today — play vs bots' });
        for (const x of st.members) {
          const w = x.sid ? this.socks.get(x.sid) : undefined;
          if (w) {
            safeSend(w, s);
            safeClose(w, CLOSE_QUOTA, 'quota');
          }
        }
        this.closeRoom(now, false);
        return;
      }
      const nowHumans = this.connectedHumans();
      st.mapResolved = st.map === 'random' ? MAPS[randomInt(MAPS.length)] : st.map;
      st.seed = randomU32();
      st.matchNo++;
      st.phase = 'loading';
      st.hostLosses = 0;
      st.liveAt = 0;
      st.humansAtStart = nowHumans.length;
      st.resv = { day: r.day, units: est.units, raw: est.raw };
      this.avoidHosts.clear();
      st.hostSlot = this.pickHost(-1);
      this.endText = null;
      this.lastSnapTick = 0;
      this.hostLeaving = false;
      this.hostLastFrameAt = now;
      this.lastFlushAt = now;
      this.persist();
      this.toAll(JSON.stringify(this.assignMsg()), -1);
      this.broadcastMembers();
    } finally {
      this.starting = false;
    }
  }

  private assignMsg(): Record<string, unknown> {
    const st = this.st!;
    return {
      t: 'assign',
      matchNo: st.matchNo,
      hostSlot: st.hostSlot,
      seed: st.seed,
      map: st.mapResolved,
      preset: st.preset,
      mode: st.mode,
      rule: st.rule,
      skill: st.skill,
      durationS: st.durationS,
      humans: this.connectedHumans().map((x) => x.slot),
    };
  }

  private async enterPost(endText: string | null, now: number): Promise<void> {
    const st = this.st!;
    if (st.phase !== 'live' && st.phase !== 'loading') return;
    st.phase = 'post';
    st.roomSince = now;
    this.endText = endText;
    this.rematchVotes.clear();
    const rel = st.resv;
    st.resv = null;
    this.persist();
    this.reportOpen();
    await this.meterSettle(rel);
  }

  /** §O2.3: the Room voids the match itself (4th host loss, or no one left who can host). */
  private voidMatch(now: number, why: string): void {
    const st = this.st!;
    const s = JSON.stringify({ t: 'end', matchNo: st.matchNo, voided: true, why, from: -1 });
    this.toAll(s, -1);
    void this.enterPost(s, now);
  }

  /**
   * §O4.4: score = (kbm ? 1000 : 0) − 10 × simMs − rttMs; ties → lowest slot.
   * During a match (migration) a candidate must also look alive: sent a frame in the last HOST_STALL_MS × 2 and not be
   * a former host of this match that stalled or handed off (its tab is likely hidden). If nobody qualifies, anyone
   * connected is taken (a slow host beats a void).
   */
  private pickHost(exclude: number): number {
    const st = this.st!;
    const all = this.connectedHumans().filter((x) => x.slot !== exclude);
    let pool = all;
    if (st.phase === 'live' || st.phase === 'loading') {
      const now = Date.now();
      const fresh = timing(this.env, 'HOST_STALL_MS') * 2;
      const good = all.filter((x) => {
        if (this.avoidHosts.has(x.slot)) return false;
        const e = this.eph.get(x.sid);
        return !!e && now - e.lastMsgAt <= fresh;
      });
      if (good.length) pool = good;
    }
    let best = -1;
    let bestScore = -Infinity;
    for (const x of pool) {
      const score = (x.device === 'kbm' ? 1000 : 0) - 10 * x.simMs - (x.rttMs ?? 100);
      if (score > bestScore || (score === bestScore && x.slot < best)) {
        best = x.slot;
        bestScore = score;
      }
    }
    return best;
  }

  /** §O6.2 host loss: promote the next host, or void on the 4th loss / no candidate. */
  private hostLoss(reason: 'left' | 'stalled' | 'handoff', lastTick: number, now: number): void {
    const st = this.st!;
    if (st.phase !== 'live' && st.phase !== 'loading') return;
    const old = st.hostSlot;
    st.hostLosses++;
    this.hostLeaving = false;
    if (reason !== 'left') this.avoidHosts.add(old);
    if (st.hostLosses > timing(this.env, 'MAX_MIGRATIONS')) {
      this.voidMatch(now, 'host_lost');
      return;
    }
    const next = this.pickHost(old);
    if (next < 0) {
      this.voidMatch(now, 'no_host');
      return;
    }
    st.hostSlot = next;
    this.stats.migrations++;
    this.hostLastFrameAt = now + timing(this.env, 'HOST_PROMOTE_GRACE_MS');
    this.persist();
    this.toAll(
      JSON.stringify({ t: 'host', hostSlot: next, reason, lastTick, matchNo: st.matchNo, migrations: st.hostLosses, from: -1 }),
      -1,
    );
    this.broadcastMembers();
  }

  /** A member's socket is gone (left = it will not come back: `leave`, close 4000, kick, refused hello). */
  private memberGone(m: Member, left: boolean, now: number): void {
    const st = this.st!;
    const wasConn = m.conn;
    if (m.sid) {
      this.socks.delete(m.sid);
      this.eph.delete(m.sid);
    }
    m.conn = false;
    m.sid = '';
    m.leftAt = now;
    const wasHost = st.hostSlot === m.slot && (st.phase === 'live' || st.phase === 'loading');
    if (left) this.removeMember(m);
    this.rematchVotes.delete(m.slot);
    if (st.ownerSlot === m.slot && !st.quick) {
      const nxt = this.connectedHumans()[0] ?? st.members.find((x) => x.conn);
      st.ownerSlot = nxt ? nxt.slot : -1;
    }
    const anyConn = st.members.some((x) => x.conn);
    if (!anyConn) {
      this.closeRoom(now, true);
      return;
    }
    if (wasConn || left) {
      if (m.helloed)
        this.toAll(JSON.stringify({ t: 'peer', slot: m.slot, jid: m.jid, conn: false, left, from: -1 }), -1);
    }
    // an ownership change is soft state: mirrored into the attachments (survives hibernation while anyone is
    // connected); it reaches storage with the next transition. A mass leave at the horn would otherwise cost one
    // storage row per leaver.
    if (wasHost) this.hostLoss('left', this.lastSnapTick, now);
    else this.touch();
    this.broadcastMembers();
    if (left && st.quick && st.phase === 'live') this.reportOpen();
  }

  private removeMember(m: Member): void {
    const st = this.st!;
    st.members = st.members.filter((x) => x !== m);
    if (m.ticket) st.tickets = st.tickets.filter((t) => t !== m.ticket);
  }

  /** Last socket gone (or quota refusal): phase closed. A token reconnect within RECONNECT_GRACE_S revives it. */
  private closeRoom(now: number, revivable: boolean): void {
    const st = this.st!;
    if (st.phase === 'closed') return;
    st.prevPhase = revivable ? st.phase : null;
    st.phase = 'closed';
    st.closedAt = now;
    this.clearTimers();
    const rel = st.resv;
    st.resv = null;
    this.persist();
    this.reportOpen();
    void this.meterSettle(rel);
  }

  // ======================================================================================
  // housekeeping (no alarms: everything runs on the next event)
  // ======================================================================================

  private afterEvent(now: number): void {
    const st = this.st;
    if (!st) return;
    // host stall (§O6.2): checked on every incoming message while live. While loading (roster sent, arenas loading,
    // no SNAP yet) the host may legitimately be silent for seconds, so only a long silence counts there.
    const stallMs =
      st.phase === 'live' ? timing(this.env, 'HOST_STALL_MS') : Math.max(timing(this.env, 'HOST_STALL_MS'), LOADING_STALL_MS);
    if ((st.phase === 'live' || st.phase === 'loading') && st.hostSlot >= 0 && now - this.hostLastFrameAt > stallMs) {
      this.hostLoss('stalled', this.lastSnapTick, now);
    }
    if (st.phase === 'live' && now - this.lastFlushAt >= timing(this.env, 'LIVE_FLUSH_MS')) void this.flushLive();
    this.housekeep(now);
  }

  private housekeep(now: number): void {
    const st = this.st;
    if (!st || st.phase === 'closed') return;
    if (st.phase === 'room' && !st.quick && now - st.roomSince > timing(this.env, 'ROOM_IDLE_CLOSE_MIN') * 60_000) {
      for (const x of st.members) {
        const w = x.sid ? this.socks.get(x.sid) : undefined;
        if (w) {
          safeSend(w, JSON.stringify({ t: 'err', code: 'bad', msg: 'Room closed after 15 minutes without a start' }));
          safeClose(w, CLOSE_CLOSED, 'idle');
        }
        x.conn = false;
        x.sid = '';
      }
      this.socks.clear();
      this.closeRoom(now, false);
      return;
    }
    if (st.phase === 'room' || st.phase === 'post') {
      // §O7.4 pre-match: a socket with no ping (auto-response) and no message for PREMATCH_PING_IDLE_S is a dead phone
      const lim = timing(this.env, 'PREMATCH_PING_IDLE_S') * 1000;
      for (const x of [...st.members]) {
        if (!x.conn || !x.sid) continue;
        const w = this.socks.get(x.sid);
        if (!w) continue;
        let last = x.joinedAt;
        const ar = this.ctx.getWebSocketAutoResponseTimestamp(w);
        if (ar) last = Math.max(last, ar.getTime());
        const e = this.eph.get(x.sid);
        if (e) last = Math.max(last, e.lastMsgAt);
        if (now - last > lim) {
          safeSend(w, JSON.stringify({ t: 'kicked', why: 'idle' }));
          safeClose(w, CLOSE_KICKED, 'idle');
          this.memberGone(x, false, now);
          if (!this.st || this.st.phase === 'closed') return;
        }
      }
      this.pruneDisconnected(now, false);
    }
  }

  /** Outside a match, a disconnected member keeps its seat for RECONNECT_GRACE_S (or none at all when `all`). */
  private pruneDisconnected(now: number, all: boolean): void {
    const st = this.st!;
    const grace = timing(this.env, 'RECONNECT_GRACE_S') * 1000;
    const gone = st.members.filter((x) => !x.conn && (all || now - x.leftAt > grace));
    if (!gone.length) return;
    for (const x of gone) this.removeMember(x);
    this.touch();
  }

  private clearTimers(): void {
    if (this.autostartTimer) clearTimeout(this.autostartTimer);
    if (this.rematchTimer) clearTimeout(this.rematchTimer);
    this.autostartTimer = null;
    this.rematchTimer = null;
  }

  // ======================================================================================
  // meter (§O2.5)
  // ======================================================================================

  private meter() {
    return this.env.METER.get(this.env.METER.idFromName('meter'));
  }

  private accOther(n: number): void {
    this.accRaw += n;
    this.accUnits += n;
  }

  /** §O5.2: pings are auto-responded (the Room never sees them) — estimate them at each flush. */
  private accPings(now: number): void {
    const st = this.st;
    const dt = Math.max(0, now - this.lastPingAcctAt) / 1000;
    this.lastPingAcctAt = now;
    if (!st) return;
    const n = st.members.filter((x) => x.conn).length;
    const rate = st.phase === 'live' ? 0.5 : 0.1;
    const p = rate * n * dt;
    this.accRaw += p;
    this.accUnits += p / 20;
  }

  /** Takes the integer part of the accumulators (final = round units up). */
  private takePending(final: boolean): Usage {
    this.accPings(Date.now());
    const raw = Math.floor(this.accRaw);
    const units = final ? Math.ceil(this.accUnits - 1e-9) : Math.floor(this.accUnits);
    this.accRaw -= raw;
    this.accUnits = Math.max(0, this.accUnits - units);
    return { raw, units };
  }

  private giveBack(u: Usage): void {
    this.accRaw += u.raw;
    this.accUnits += u.units;
  }

  // Usage is counted once, by the DO that RECEIVES a request (its billing owner): the Room counts its own connection
  // fetches, frames and the RPCs it serves; the Meter counts the RPCs it serves; the Lobby likewise.
  private async meterAdmit(est: Usage): Promise<{ ok: boolean; day: string }> {
    const add = this.takePending(false);
    try {
      const r = await this.meter().admit(est, add);
      return { ok: r.ok, day: r.day };
    } catch {
      this.giveBack(add);
      return { ok: false, day: '' };
    }
  }

  private async meterSettle(rel: Reservation | null): Promise<void> {
    const add = this.takePending(true);
    try {
      await this.meter().settle(rel ? ({ day: rel.day, units: rel.units, raw: rel.raw } satisfies Release) : null, add);
    } catch {
      this.giveBack(add);
    }
  }

  /** Every LIVE_FLUSH_MS while live (piggy-backed on traffic): record usage and release that much reservation. */
  private async flushLive(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    this.lastFlushAt = Date.now();
    const add = this.takePending(false);
    const st = this.st;
    let release: Release | null = null;
    if (st?.resv) {
      const ru = Math.min(add.units, st.resv.units);
      const rr = Math.min(add.raw, st.resv.raw);
      st.resv.units -= ru;
      st.resv.raw -= rr;
      release = { day: st.resv.day, units: ru, raw: rr };
    }
    try {
      await this.meter().add(add, release);
    } catch {
      this.giveBack(add);
      if (st?.resv && release) {
        st.resv.units += release.units;
        st.resv.raw += release.raw;
      }
    } finally {
      this.flushing = false;
    }
  }

  // ======================================================================================
  // Lobby late-fill report (quick rooms)
  // ======================================================================================

  private endsAt(): number {
    const st = this.st!;
    if (!st.liveAt) return 0;
    return st.liveAt + (timing(this.env, 'COUNTDOWN_S') + (st.durationS ?? timing(this.env, 'MATCH_S'))) * 1000;
  }

  private reportOpen(): void {
    const st = this.st;
    if (!st || !st.quick || !st.lobby) return;
    const live = st.phase === 'live';
    const pendingTickets = st.tickets.filter((t) => !st.members.some((m) => m.ticket === t)).length;
    const open = live ? Math.max(0, MAX_HUMANS - st.members.length - pendingTickets) : 0;
    const endsAt = live ? this.endsAt() : 0;
    const stub = this.env.LOBBY.get(this.env.LOBBY.idFromName(st.lobby));
    void stub.roomOpen(st.code, open, endsAt).catch(() => {});
  }

  // ======================================================================================
  // helpers
  // ======================================================================================

  private ident(ws: WebSocket): { sid: string; slot: number } | null {
    const c = this.ids.get(ws);
    if (c) return c;
    let a: Attachment | null = null;
    try {
      a = ws.deserializeAttachment() as Attachment | null;
    } catch {
      a = null;
    }
    if (!a || typeof a.sid !== 'string') return null;
    const id = { sid: a.sid, slot: a.slot };
    this.ids.set(ws, id);
    return id;
  }

  private newEph(now: number): SockEph {
    return {
      bucket: new TokenBucket(RATE_CLIENT, RATE_CLIENT, now),
      drops: new DropWindow(),
      lastMsgAt: now,
      lastKeyframeAt: 0,
    };
  }

  private connectedHumans(): Member[] {
    return (this.st?.members ?? []).filter((x) => x.conn && x.helloed && x.sid).sort((a, b) => a.slot - b.slot);
  }

  private hostSocket(): WebSocket | undefined {
    const st = this.st!;
    const h = st.members.find((x) => x.slot === st.hostSlot && x.conn);
    return h ? this.socks.get(h.sid) : undefined;
  }

  /** host → all: every other connected, helloed member. */
  private fanout(buf: ArrayBuffer, except: number): void {
    for (const x of this.st!.members) {
      if (x.slot === except || !x.conn || !x.helloed) continue;
      const w = this.socks.get(x.sid);
      if (w && safeSend(w, buf)) this.stats.framesOut++;
    }
  }

  private toAll(s: string, except: number): void {
    for (const x of this.st!.members) {
      if (x.slot === except || !x.conn || !x.helloed) continue;
      const w = this.socks.get(x.sid);
      if (w && safeSend(w, s)) this.stats.framesOut++;
    }
  }

  private roomView(): Record<string, unknown> {
    const st = this.st!;
    return {
      code: st.code,
      quick: st.quick,
      mode: st.mode,
      rule: st.rule,
      map: st.map,
      preset: st.preset,
      skill: st.skill,
      phase: st.phase,
      ownerSlot: st.ownerSlot,
      hostSlot: st.phase === 'loading' || st.phase === 'live' ? st.hostSlot : -1,
      matchNo: st.matchNo,
      durationS: st.durationS,
    };
  }

  private broadcastMembers(): void {
    const st = this.st;
    if (!st) return;
    const inMatch = st.phase === 'loading' || st.phase === 'live';
    const members = st.members
      .filter((x) => x.helloed)
      .map((x) => ({
        slot: x.slot,
        jid: x.jid,
        name: x.name,
        kit: x.kit,
        crew: x.crew,
        color: x.color,
        device: x.device,
        conn: x.conn,
        owner: x.slot === st.ownerSlot,
        host: inMatch && x.slot === st.hostSlot,
        rttMs: x.rttMs,
      }));
    this.toAll(JSON.stringify({ t: 'members', members, phase: st.phase, room: this.roomView() }), -1);
  }

  private sendErr(ws: WebSocket, code: ErrCode, msg: string): void {
    safeSend(ws, JSON.stringify({ t: 'err', code, msg }));
  }

  private quietDrop(): void {
    this.stats.dropped++;
  }

  /** A counted drop (§O8): more than ABUSE_DROPS in ABUSE_WINDOW_MS closes the socket with 4029. */
  private abuse(ws: WebSocket, e: SockEph, now: number, why: string): void {
    this.stats.dropped++;
    this.stats.abuse++;
    const n = e.drops.hit(now, ABUSE_WINDOW_MS);
    if (n > ABUSE_DROPS) {
      this.sendErr(ws, 'rate', 'Too many invalid or excess messages (' + why + ')');
      safeClose(ws, CLOSE_RATE, 'rate');
      const st = this.st;
      const a = this.ident(ws);
      const m = st && a ? st.members.find((x) => x.slot === a.slot && x.sid === a.sid) : undefined;
      if (m) this.memberGone(m, false, now);
    }
  }
}
