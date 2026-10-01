// HIT PARADE - net/netplay.ts (lane NET). Vendored FFG NetPlay (games/last-circle/runtime/net/ffg_netplay.js
// lineage) for HIT PARADE, with the fixes _research/NETCODE.md 3.1 lists:
//   * the 'peer' event fires on presence COUNT change, not only on the 1<->2 boundary (last-circle fix)
//   * quick-match lingers 6 s in the lobby after pairing (measured presence visibility 144-2,686 ms, 0.5)
//   * protocol + build version ride in presence meta; quick match pairs only identical versions
//   * NO `eventsPerSecond` client param: it is a no-op (NETCODE 0.3: the server reads only apikey/token and
//     log_level; the real limit is 100 events/s PER PROJECT, a 60 s rolling average shared by every FFG game)
//   * a hard client-side send budget (token bucket) so nothing on this socket can ever stream at 60 Hz
// Room channel `ffg:hit-parade:<CODE>`, lobby `ffg-lobby:hit-parade`. supabase-js is lazy-loaded from
// esm.sh only when a player picks ONLINE, so offline play never touches the network.

export const SUPABASE_URL = 'https://wugoxdewcdxzfppgzohy.supabase.co';
// ANON / publishable key: PUBLIC by design (Realtime Broadcast/Presence + the ratings RPC only).
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves';
/** Pinned to the version the netcode lane measured live (NETCODE 0.1). */
export const SUPABASE_JS = 'https://esm.sh/@supabase/supabase-js@2.117.2';
export const GAME_ID = 'hit-parade';
/** Wire protocol version (packets + flow messages). Bump on any incompatible change. */
export const NET_PROTO = 1;
export const LOBBY_LINGER_MS = 6000;

export interface PresenceMeta { id: string; proto?: number; build?: string; name?: string; [k: string]: unknown }

/** The slice of a supabase-js RealtimeChannel this file uses. */
export interface Channel {
  on(type: string, filter: Record<string, unknown>, cb: (payload: never) => void): Channel;
  subscribe(cb?: (status: string, err?: unknown) => void): Channel;
  track(meta: Record<string, unknown>): Promise<unknown>;
  untrack(): Promise<unknown>;
  send(msg: { type: 'broadcast'; event: string; payload: unknown }): Promise<unknown>;
  presenceState(): Record<string, PresenceMeta[]>;
}
export interface RealtimeClient {
  channel(name: string, opts?: Record<string, unknown>): Channel;
  removeChannel(ch: Channel): Promise<unknown>;
}

type Handler = (p: never) => void;

/** Token bucket: `capacity` burst, `perSec` sustained. Guards every Supabase send from this client. */
export class SendBudget {
  private tokens: number;
  private last: number;
  readonly capacity: number;
  readonly perSec: number;
  constructor(capacity: number, perSec: number) {
    this.capacity = capacity;
    this.perSec = perSec;
    this.tokens = capacity;
    this.last = nowMs();
  }
  take(): boolean {
    const t = nowMs();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.perSec);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

function nowMs(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

/**
 * CHANGED(wf6 fixer) VO-D7: ONE realtime client per page (memoised; every NetPlay - rematches, new lobbies - shares it and
 * removes only its own channels) under its OWN auth storage key. supabase-js numbers GoTrueClient instances per storage
 * key and warns "Multiple GoTrueClient instances detected in the same browser context" from the second one: this anon
 * client and net/ratings.ts' portal-session client both used the default `sb-<project>-auth-token` key (2 per page, +1 per
 * new NetPlay). The netplay client never signs in (persistSession / autoRefreshToken / detectSessionInUrl off), so its key
 * holds nothing; the ratings client keeps the default key = the portal's session.
 */
let sharedClient: Promise<RealtimeClient> | null = null;
function loadClient(): Promise<RealtimeClient> {
  if (sharedClient) return sharedClient;
  sharedClient = (async () => {
    const url = SUPABASE_JS;
    const mod = (await import(/* @vite-ignore */ url)) as { createClient?: CreateClient; default?: { createClient?: CreateClient } };
    const createClient = mod.createClient ?? mod.default?.createClient;
    if (!createClient) throw new Error('supabase-js: createClient missing');
    // NOTE: no realtime.params.eventsPerSecond - it is a no-op on the wire (NETCODE 0.3).
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'hit-parade-netplay' },
    }) as unknown as RealtimeClient;
  })();
  sharedClient.catch(() => { sharedClient = null; });      // a failed load (offline) may be retried by the next lobby
  return sharedClient;
}
type CreateClient = (url: string, key: string, opts?: Record<string, unknown>) => unknown;

/** 24 letters (no I / O: they read as 1 / 0); 256 % 24 = 16 -> a negligible bias toward the first 16 letters */
const ROOM_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface NetPlayOpts {
  build: string;
  proto?: number;
  name?: string;
  gameId?: string;
  /** inject a client (Node smoke tests); default = supabase-js from esm.sh */
  client?: () => Promise<RealtimeClient>;
}

export class NetPlay {
  readonly id: string;
  readonly gameId: string;
  readonly build: string;
  readonly proto: number;
  name: string;
  host: boolean | null = null;
  room: string | null = null;
  peerCount = 0;
  sentMsgs = 0;
  sentBinary = 0;
  dropped = 0;
  binaryMode: 'raw' | 'b64' = 'raw';
  private sb: RealtimeClient | null = null;
  private clientFn: () => Promise<RealtimeClient>;
  private channel: Channel | null = null;
  private lobby: Channel | null = null;
  private handlers = new Map<string, Handler[]>();
  private binHandlers = new Map<string, ((b: ArrayBuffer) => void)[]>();
  /** 20 burst, 12/s sustained: the relay (10 Hz) + rare control messages fit; 60 Hz never can. */
  readonly budget = new SendBudget(20, 12);

  constructor(o: NetPlayOpts) {
    this.gameId = o.gameId ?? GAME_ID;
    this.build = o.build;
    this.proto = o.proto ?? NET_PROTO;
    this.name = (o.name ?? '').slice(0, 24);
    this.clientFn = o.client ?? loadClient;
    // sortable unique peer id; the lexically lowest id in a room is the host (slot 0)
    const rnd = new Uint32Array(1);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(rnd);
    else rnd[0] = Math.floor(Math.random() * 0xffffffff);
    this.id = Date.now().toString(36) + '_' + rnd[0].toString(36);
  }

  on(ev: 'open', cb: (p: { room: string; host: boolean | null }) => void): this;
  on(ev: 'peer', cb: (p: { present: boolean; count: number; ids: string[]; metas: Record<string, PresenceMeta> }) => void): this;
  on(ev: 'msg', cb: (p: { from: string; t: string; d: unknown }) => void): this;
  on(ev: 'matched', cb: (p: { room: string; host: boolean }) => void): this;
  on(ev: 'timeout' | 'closed', cb: (p: Record<string, never>) => void): this;
  on(ev: 'error', cb: (p: { status: string; err?: unknown }) => void): this;
  on(ev: string, cb: (p: never) => void): this {
    const list = this.handlers.get(ev) ?? [];
    list.push(cb as Handler);
    this.handlers.set(ev, list);
    return this;
  }

  private emit(ev: string, p: unknown): void {
    for (const cb of this.handlers.get(ev) ?? []) {
      try { (cb as (x: unknown) => void)(p); } catch (e) { console.warn('[netplay] handler', ev, e); }
    }
  }

  async connect(): Promise<RealtimeClient> {
    if (!this.sb) this.sb = await this.clientFn();
    return this.sb;
  }

  /**
   * CHANGED(NET) P2: CREATE ROOM codes are 4 LETTERS (no I / O), the format lane UI's JOIN field and copy take
   * (`/^[A-Z]{4}$/`, "Type a friend's four-letter code"); P1 made 8 chars with digits, which that field can never
   * accept. 24^4 = 331,776 codes: fine for a room shared by voice; a stranger guessing a live code can at worst
   * take the empty second slot (the first two presence ids play, HELLO tokens guard every later message).
   * Quick-match rooms keep their 8-char ids (never typed). join() accepts any cleanCode() (deep links).
   */
  static makeCode(): string {
    const b = new Uint8Array(4);
    crypto.getRandomValues(b);
    let s = '';
    for (let i = 0; i < 4; i++) s += ROOM_LETTERS[b[i] % ROOM_LETTERS.length];
    return s;
  }

  static cleanCode(code: string): string {
    return String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }

  private presenceMeta(): PresenceMeta {
    return { id: this.id, proto: this.proto, build: this.build, name: this.name };
  }

  /** Join ROOM channel `ffg:<game>:<CODE>`. Resolves once subscribed + tracked. */
  async joinRoom(code: string, asHost?: boolean): Promise<string> {
    const sb = await this.connect();
    const room = NetPlay.cleanCode(code);
    this.room = room;
    if (asHost != null) this.host = asHost;
    const ch = sb.channel('ffg:' + this.gameId + ':' + room, {
      config: { broadcast: { self: false, ack: false }, presence: { key: this.id } },
    });
    this.channel = ch;
    ch.on('broadcast', { event: 'msg' }, ((m: { payload?: { from?: string; t?: string; d?: unknown } }) => {
      const p = m.payload;
      if (!p || p.from === this.id || typeof p.t !== 'string') return;
      this.emit('msg', { from: String(p.from), t: p.t, d: p.d });
    }) as never);
    ch.on('broadcast', { event: 'bin' }, ((m: { payload?: unknown }) => this.onBinaryPayload(m.payload)) as never);
    ch.on('presence', { event: 'sync' }, (() => this.onPresence()) as never);
    await new Promise<void>((res) => {
      let done = false;
      ch.subscribe((status: string, err?: unknown) => {
        if (status === 'SUBSCRIBED') {
          ch.track(this.presenceMeta() as Record<string, unknown>).then(() => {
            if (!done) { done = true; this.emit('open', { room, host: this.host }); res(); }
          }, (e: unknown) => { if (!done) { done = true; this.emit('error', { status: 'TRACK_FAILED', err: e }); res(); } });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.emit(status === 'CLOSED' ? 'closed' : 'error', { status, err });
          if (!done) { done = true; res(); }
        }
      });
    });
    return room;
  }

  private onPresence(): void {
    const ch = this.channel;
    if (!ch) return;
    const state = ch.presenceState();
    const ids = Object.keys(state).sort();
    const metas: Record<string, PresenceMeta> = {};
    for (const k of ids) metas[k] = (state[k] && state[k][0]) || { id: k };
    const players = ids.slice(0, 2);
    const present = players.length >= 2 && players.includes(this.id);
    if (present && this.host == null) this.host = this.id === players[0];
    if (ids.length !== this.peerCount || present !== (this.peerCount >= 2)) {
      this.peerCount = ids.length;
      this.emit('peer', { present, count: ids.length, ids, metas });
    }
  }

  /** The two lowest presence ids = the players; anyone else in the room is ignored (NETCODE 3.6). */
  players(): string[] {
    if (!this.channel) return [];
    return Object.keys(this.channel.presenceState()).sort().slice(0, 2);
  }

  presence(): Record<string, PresenceMeta> {
    const out: Record<string, PresenceMeta> = {};
    if (!this.channel) return out;
    const st = this.channel.presenceState();
    for (const k of Object.keys(st).sort()) out[k] = (st[k] && st[k][0]) || { id: k };
    return out;
  }

  /**
   * QUICK MATCH: announce in `ffg-lobby:<game>`; the two lowest COMPATIBLE peer ids (same proto + build)
   * pair into room (a.slice(-4) + b.slice(-4)).toUpperCase(). Join the room first, then linger 6 s in
   * the lobby so both peers see the same two-peer snapshot.
   */
  async quickMatch(timeoutMs = 60000): Promise<{ room: string; host: boolean } | null> {
    const sb = await this.connect();
    const lobby = sb.channel('ffg-lobby:' + this.gameId, { config: { presence: { key: this.id } } });
    this.lobby = lobby;
    return new Promise((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const tryPair = async (): Promise<void> => {
        if (done) return;
        const st = lobby.presenceState();
        const ids = Object.keys(st).filter((k) => {
          const m = st[k] && st[k][0];
          return m && m.proto === this.proto && m.build === this.build;
        }).sort();
        if (ids.length < 2) return;
        const a = ids[0], b = ids[1];
        if (this.id !== a && this.id !== b) return;
        done = true;
        if (timer) clearTimeout(timer);
        const code = (a.slice(-4) + b.slice(-4)).toUpperCase();
        const host = this.id === a;
        await this.joinRoom(code, host);
        this.emit('matched', { room: code, host });
        resolve({ room: code, host });
        setTimeout(() => {
          try { void lobby.untrack(); void sb.removeChannel(lobby); } catch { /* gone */ }
          if (this.lobby === lobby) this.lobby = null;
        }, LOBBY_LINGER_MS);
      };
      lobby.on('presence', { event: 'sync' }, (() => { void tryPair(); }) as never);
      lobby.on('presence', { event: 'join' }, (() => { void tryPair(); }) as never);
      lobby.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          lobby.track({ id: this.id, proto: this.proto, build: this.build }).then(() => { void tryPair(); }, () => { /* retry on next sync */ });
        }
      });
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (done) return;
          done = true;
          try { void lobby.untrack(); void sb.removeChannel(lobby); } catch { /* gone */ }
          if (this.lobby === lobby) this.lobby = null;
          this.emit('timeout', {});
          resolve(null);
        }, timeoutMs);
      }
    });
  }

  /** Cancel a pending quick-match search. */
  cancelSearch(): void {
    const l = this.lobby;
    if (!l || !this.sb) return;
    try { void l.untrack(); void this.sb.removeChannel(l); } catch { /* gone */ }
    this.lobby = null;
  }

  /** JSON control message to the room (low rate). Returns false when the send budget refuses it. */
  send(t: string, d?: unknown): boolean {
    if (!this.channel) return false;
    if (!this.budget.take()) { this.dropped++; return false; }
    this.sentMsgs++;
    void this.channel.send({ type: 'broadcast', event: 'msg', payload: { from: this.id, t, d: d ?? {} } });
    return true;
  }

  /** Binary broadcast (relay tier). Same send budget as `send`. */
  sendBinary(event: string, buf: Uint8Array): boolean {
    if (!this.channel) return false;
    if (!this.budget.take()) { this.dropped++; return false; }
    this.sentBinary++;
    // prefix a 1-byte event tag so one broadcast event name carries every binary stream
    const tag = event.charCodeAt(0) & 0xff;
    const out = new Uint8Array(buf.length + 1);
    out[0] = tag;
    out.set(buf, 1);
    const payload = this.binaryMode === 'raw' ? out.buffer : { b64: toB64(out) };
    void this.channel.send({ type: 'broadcast', event: 'bin', payload });
    return true;
  }

  /** Drop every binary handler (a new online session re-registers its relay transport). */
  clearBinary(): void { this.binHandlers.clear(); }

  onBinary(event: string, cb: (b: ArrayBuffer) => void): void {
    const k = String(event.charCodeAt(0) & 0xff);
    const list = this.binHandlers.get(k) ?? [];
    list.push(cb);
    this.binHandlers.set(k, list);
  }

  private onBinaryPayload(payload: unknown): void {
    let bytes: Uint8Array | null = null;
    if (payload instanceof ArrayBuffer) bytes = new Uint8Array(payload);
    else if (ArrayBuffer.isView(payload)) bytes = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    else if (payload && typeof payload === 'object' && typeof (payload as { b64?: unknown }).b64 === 'string') bytes = fromB64((payload as { b64: string }).b64);
    if (!bytes || bytes.length < 1) return;
    const list = this.binHandlers.get(String(bytes[0]));
    if (!list) return;
    const body = bytes.slice(1).buffer;
    for (const cb of list) { try { cb(body); } catch (e) { console.warn('[netplay] binary handler', e); } }
  }

  isHost(): boolean { return !!this.host; }

  leave(): void {
    const sb = this.sb;
    try { if (this.channel && sb) { void this.channel.untrack(); void sb.removeChannel(this.channel); } } catch { /* gone */ }
    try { if (this.lobby && sb) void sb.removeChannel(this.lobby); } catch { /* gone */ }
    this.channel = this.lobby = null;
    this.peerCount = 0;
  }
}

function toB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * TurnClock - a per-phase countdown so online play can't stall (character select 30 s, rematch 20 s).
 * onTick(secondsLeft) updates the UI; onExpire() fires once at 0.
 */
export class TurnClock {
  total: number;
  left: number;
  private iv: ReturnType<typeof setInterval> | null = null;
  private onTick: ((s: number) => void) | null = null;
  private onExpire: (() => void) | null = null;
  constructor(seconds = 30) { this.total = seconds; this.left = seconds; }
  start(onTick?: (s: number) => void, onExpire?: () => void): this {
    this.stop();
    this.left = this.total;
    this.onTick = onTick ?? null;
    this.onExpire = onExpire ?? null;
    if (this.onTick) this.onTick(this.left);
    this.iv = setInterval(() => this.step(), 1000);
    return this;
  }
  step(): void {
    this.left -= 1;
    if (this.onTick) this.onTick(Math.max(0, this.left));
    if (this.left <= 0) { this.stop(); if (this.onExpire) this.onExpire(); }
  }
  running(): boolean { return this.iv !== null; }
  stop(): void { if (this.iv) { clearInterval(this.iv); this.iv = null; } }
}
