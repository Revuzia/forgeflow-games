// BLOCKTOOTH - net/room.ts (lane B-NET). The Supabase Realtime room layer (project wugox): lobby, presence, quick
// match, room codes, WebRTC signalling, START and RESULT. NEVER the game stream (netcode.md 4: the free project cap is
// 100 events/s shared by every FFG game, and a 4-subscriber room bills 4+ events per send).
//
// Ported from HIT PARADE's runtime/src/net/netplay.ts (itself the FFG NetPlay lineage) and widened from 2 to 4:
//   * pinned supabase-js (esm.sh, lazy-loaded only when the player picks ONLINE: offline play never touches the net)
//   * protocol + build version ride in presence meta; quick match and rooms only group IDENTICAL versions
//     (a mismatched peer is ignored and told `version`)
//   * a hard client-side send budget (token bucket) on every Supabase send; the client `eventsPerSecond` param is a
//     no-op on the wire and is not used
//   * 4-player QUICK MATCH (ONLINE_PLAN.md 2 + D8): waiting players with the same version group into rooms of up to 4;
//     the lowest peer id in a room hosts; the host starts at 4 humans, or after QUICK_WAIT_MS (20 s), or on "start
//     now with bots"; empty seats become bots. Rooms advertise themselves in lobby presence ({room, n}); a seeker joins
//     the open room with the lowest leader id, else the lowest unroomed id opens one; two small rooms that see each
//     other merge into the lower leader's room before START. A RUNNING match that still has a bot seat before the
//     3:00 cutoff advertises {running, open} so a seeker can replay-join it.
//   * room codes: 4 letters (no I / O), `?room=CODE` deep links (cleanCode accepts the portal's invite param)
//   * the host's START is final: the roster = the first 4 present compatible ids (sorted); anyone else is told `full`.

import { NET_PROTO, SEATS, type StartInfo } from './proto.ts';

export const SUPABASE_URL = 'https://wugoxdewcdxzfppgzohy.supabase.co';
// ANON / publishable key: PUBLIC by design (Realtime Broadcast/Presence only). Same key as HIT PARADE / LAST CIRCLE.
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves';
/** Pinned to the version HIT PARADE's netcode lane measured live. */
export const SUPABASE_JS = 'https://esm.sh/@supabase/supabase-js@2.117.2';
export const GAME_ID = 'blocktooth';
/** D8: quick match waits this long for humans before the host fills with bots */
export const QUICK_WAIT_MS = 20000;
/** lobby presence lingers after START so late snapshots still show the room as taken */
export const LOBBY_LINGER_MS = 6000;

export interface PresenceMeta {
  id: string; proto?: number; build?: string; name?: string;
  /** quick match: the room this peer is waiting in (null = seeking) */
  room?: string | null;
  /** running match advert: open bot seats + wall-clock ms until the replay-join cutoff */
  running?: boolean; open?: number; cutoffAt?: number;
  [k: string]: unknown;
}

/** The slice of a supabase-js RealtimeChannel this file uses (a fake implements it in the Node probe). */
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

/** Token bucket: `capacity` burst, `perSec` sustained. Guards every Supabase send from this client. */
export class SendBudget {
  private tokens: number;
  private last: number;
  readonly capacity: number;
  readonly perSec: number;
  private clock: () => number;
  constructor(capacity: number, perSec: number, clock: () => number = nowMs) {
    this.capacity = capacity; this.perSec = perSec; this.clock = clock;
    this.tokens = capacity; this.last = clock();
  }
  take(): boolean {
    const t = this.clock();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.perSec);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

function nowMs(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

type CreateClient = (url: string, key: string, opts?: Record<string, unknown>) => unknown;
let sharedClient: Promise<RealtimeClient> | null = null;
/** ONE realtime client per page, own auth storage key, never signs in (HIT PARADE VO-D7). */
export function loadClient(): Promise<RealtimeClient> {
  if (sharedClient) return sharedClient;
  sharedClient = (async () => {
    const url = SUPABASE_JS;
    const mod = (await import(/* @vite-ignore */ url)) as { createClient?: CreateClient; default?: { createClient?: CreateClient } };
    const createClient = mod.createClient ?? mod.default?.createClient;
    if (!createClient) throw new Error('supabase-js: createClient missing');
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'blocktooth-netplay' },
    }) as unknown as RealtimeClient;
  })();
  sharedClient.catch(() => { sharedClient = null; });
  return sharedClient;
}

/** 24 letters (no I / O) */
const ROOM_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface RoomOpts {
  build: string;
  proto?: number;
  name?: string;
  gameId?: string;
  /** inject a client (Node probe); default = supabase-js from esm.sh */
  client?: () => Promise<RealtimeClient>;
  /** inject a clock (Node probe) */
  clock?: () => number;
  /** inject an id (Node probe); default = time-sortable random id */
  id?: string;
  /** extra presence fields (e.g. the titan pick) shown to everyone in the room next to id / name */
  info?: Record<string, unknown>;
}

export type RoomMsg = { from: string; t: string; d: Record<string, unknown> };

export interface WaitOpts {
  /** host only: builds the START from the final human roster (sorted ids, length 1..4) */
  makeStart?: (humans: string[]) => StartInfo;
  /** host only: start after this long even if not full (bots fill); 0 = only on startNow() or 4 humans */
  waitMs?: number;
  /** quick match: give up on this room at once when a match is already running in it (seek elsewhere) */
  leaveIfRunning?: boolean;
  onStatus?: (s: RoomStatus) => void;
}
export interface RoomStatus { phase: 'seeking' | 'waiting' | 'starting' | 'started' | 'full' | 'version'; room: string | null; host: boolean; humans: string[]; waitLeftMs: number }
export interface StartResult { start: StartInfo; host: boolean; room: string; running?: { authority: string; epoch: number; tick: number } }

export class Room {
  readonly id: string;
  readonly gameId: string;
  readonly build: string;
  readonly proto: number;
  name: string;
  room: string | null = null;
  started: StartInfo | null = null;
  sentMsgs = 0;
  dropped = 0;
  /** 24 burst, 3/s sustained per client: lobby + signalling + START/RESULT fit; a stream never can.
   *  Worst case 4 clients x 3/s x (1 send + 4 receivers) = 60 billed events/s, under the 100/s project cap. */
  readonly budget: SendBudget;
  private clock: () => number;
  private sb: RealtimeClient | null = null;
  private clientFn: () => Promise<RealtimeClient>;
  private channel: Channel | null = null;
  private lobby: Channel | null = null;
  private msgHandlers: ((m: RoomMsg) => void)[] = [];
  private presenceHandlers: (() => void)[] = [];
  private runningAdvert: PresenceMeta | null = null;
  private startNowFlag = false;

  constructor(o: RoomOpts) {
    this.gameId = o.gameId ?? GAME_ID;
    this.build = o.build;
    this.proto = o.proto ?? NET_PROTO;
    this.name = (o.name ?? '').slice(0, 24);
    if (o.info) this.info = { ...o.info };
    this.clientFn = o.client ?? loadClient;
    this.clock = o.clock ?? nowMs;
    this.budget = new SendBudget(24, 3, this.clock);
    if (o.id) this.id = o.id;
    else {
      const rnd = new Uint32Array(1);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(rnd);
      else rnd[0] = Math.floor(Math.random() * 0xffffffff);
      this.id = Date.now().toString(36) + '_' + rnd[0].toString(36);
    }
  }

  static makeCode(): string {
    const b = new Uint8Array(4);
    crypto.getRandomValues(b);
    let s = '';
    for (let i = 0; i < 4; i++) s += ROOM_LETTERS[b[i] % ROOM_LETTERS.length];
    return s;
  }
  static cleanCode(code: string): string { return String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); }
  /** `?room=CODE` from the page URL (the portal forwards the invite param, platform.md 5) */
  static codeFromUrl(search: string): string | null {
    const m = /[?&]room=([^&#]+)/i.exec(search);
    const c = m ? Room.cleanCode(decodeURIComponent(m[1])) : '';
    return c.length >= 4 ? c : null;
  }

  onMsg(cb: (m: RoomMsg) => void): () => void {
    this.msgHandlers.push(cb);
    return () => { this.msgHandlers = this.msgHandlers.filter((x) => x !== cb); };
  }
  onPresence(cb: () => void): () => void {
    this.presenceHandlers.push(cb);
    return () => { this.presenceHandlers = this.presenceHandlers.filter((x) => x !== cb); };
  }

  async connect(): Promise<RealtimeClient> {
    if (!this.sb) this.sb = await this.clientFn();
    return this.sb;
  }

  /** extra presence fields: set BEFORE joining a room (the lobby's seat cards read the titan pick from them) */
  info: Record<string, unknown> = {};
  private meta(): PresenceMeta { return { ...this.info, id: this.id, proto: this.proto, build: this.build, name: this.name }; }
  private compatible(m: PresenceMeta | undefined): boolean { return !!m && m.proto === this.proto && m.build === this.build; }

  /** Join ROOM channel `ffg:<game>:<CODE>` (subscribed + tracked on resolve). Leaves any previous room first. */
  async joinRoom(code: string): Promise<string> {
    const sb = await this.connect();
    const room = Room.cleanCode(code);
    if (this.channel && this.room === room) return room;
    if (this.channel) { const old = this.channel; this.channel = null; try { void old.untrack(); void sb.removeChannel(old); } catch { /* gone */ } }
    this.room = room;
    this.roomExtra = {};
    const ch = sb.channel('ffg:' + this.gameId + ':' + room, { config: { broadcast: { self: false, ack: false }, presence: { key: this.id } } });
    this.channel = ch;
    ch.on('broadcast', { event: 'msg' }, ((m: { payload?: { from?: string; t?: string; d?: unknown } }) => {
      const p = m.payload;
      if (!p || p.from === this.id || typeof p.t !== 'string' || this.channel !== ch) return;
      const msg: RoomMsg = { from: String(p.from), t: p.t, d: (p.d && typeof p.d === 'object' ? p.d : {}) as Record<string, unknown> };
      for (const cb of this.msgHandlers.slice()) { try { cb(msg); } catch (e) { console.warn('[room] handler', e); } }
    }) as never);
    ch.on('presence', { event: 'sync' }, (() => { if (this.channel === ch) for (const cb of this.presenceHandlers.slice()) cb(); }) as never);
    await new Promise<void>((res) => {
      let done = false;
      ch.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          ch.track(this.meta() as Record<string, unknown>).then(() => { if (!done) { done = true; res(); } }, () => { if (!done) { done = true; res(); } });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { if (!done) { done = true; res(); } }
      });
    });
    return room;
  }

  /** compatible present ids in the room, sorted (the lowest = host) */
  humans(): string[] {
    if (!this.channel) return [];
    const st = this.channel.presenceState();
    return Object.keys(st).filter((k) => this.compatible(st[k] && st[k][0])).sort();
  }
  /** present ids with a different proto/build */
  strangers(): string[] {
    if (!this.channel) return [];
    const st = this.channel.presenceState();
    return Object.keys(st).filter((k) => !this.compatible(st[k] && st[k][0])).sort();
  }
  presence(): Record<string, PresenceMeta> {
    const out: Record<string, PresenceMeta> = {};
    if (!this.channel) return out;
    const st = this.channel.presenceState();
    for (const k of Object.keys(st).sort()) out[k] = (st[k] && st[k][0]) || { id: k };
    return out;
  }
  isHost(): boolean { const h = this.humans(); return h.length > 0 && h[0] === this.id && this.ownsVersion(); }
  /** the room's version belongs to the lowest id present (compatible or not): only that peer may say `version` */
  private lowestPresent(): string | null {
    if (!this.channel) return null;
    const ks = Object.keys(this.channel.presenceState()).sort();
    return ks.length ? ks[0] : null;
  }
  /** am I on the room's version (the lowest present id is compatible with me)? */
  ownsVersion(): boolean {
    const lo = this.lowestPresent();
    if (!lo || !this.channel) return true;
    const st = this.channel.presenceState();
    return this.compatible(st[lo] && st[lo][0]);
  }

  /** JSON control message to the room (low rate). False when the send budget refuses it. */
  send(t: string, d?: Record<string, unknown>): boolean {
    if (!this.channel) return false;
    if (!this.budget.take()) { this.dropped++; return false; }
    this.sentMsgs++;
    void this.channel.send({ type: 'broadcast', event: 'msg', payload: { from: this.id, t, d: d ?? {} } });
    return true;
  }

  /** extra fields on this peer's ROOM presence (O-POLISH: the quick-match host's `startAt` deadline, read by the guests' countdown); cleared with the room */
  private roomExtra: Record<string, unknown> = {};
  publish(extra: Record<string, unknown>): void {
    this.roomExtra = { ...this.roomExtra, ...extra };
    if (this.channel && !this.started) void this.channel.track({ ...this.meta(), ...this.roomExtra } as Record<string, unknown>);
  }

  /** "Start now with bots" (D8 button): the host starts on its next check */
  startNow(): void { this.startNowFlag = true; }

  /**
   * Wait in the current room until START. The host (lowest compatible id, and only while nobody present is already in
   * a running match) sends it at 4 humans, after `waitMs`, or on startNow(); a guest resolves when the host's START
   * names it, or when a running match's authority answers it with a replay-join offer (`running`). Resolves null when
   * this peer is not in the roster (`full`), the versions differ, or the room was left.
   */
  waitForStart(o: WaitOpts): Promise<StartResult | null> {
    const room = this.room as string;
    const t0 = this.clock();
    return new Promise((resolve) => {
      let done = false;
      let timer: ReturnType<typeof setInterval> | null = null;
      const finish = (r: StartResult | null): void => {
        if (done) return;
        done = true;
        if (timer) clearInterval(timer);
        offMsg(); offPres();
        resolve(r);
      };
      const status = (phase: RoomStatus['phase']): void => {
        o.onStatus?.({ phase, room, host: this.isHost(), humans: this.humans(), waitLeftMs: Math.max(0, (o.waitMs ?? 0) - (this.clock() - t0)) });
      };
      const check = (): void => {
        if (done) return;
        if (this.room !== room) { finish(null); return; }
        const hs = this.humans();
        if (o.leaveIfRunning && this.matchRunningHere()) { status('full'); finish(null); return; }
        if (hs[0] !== this.id || !o.makeStart || this.matchRunningHere() || !this.ownsVersion()) { status(this.ownsVersion() ? 'waiting' : 'version'); return; }
        const full = hs.length >= SEATS;
        const timeUp = (o.waitMs ?? 0) > 0 && this.clock() - t0 >= (o.waitMs as number);
        if (!full && !timeUp && !this.startNowFlag) { status('waiting'); return; }
        this.startNowFlag = false;
        const roster = hs.slice(0, SEATS);
        const start = o.makeStart(roster);
        status('starting');
        const payload = { start: start as unknown as Record<string, unknown> };
        // START is the one message that must land: retry once if the budget refused it
        if (!this.send('start', payload)) setTimeout(() => this.send('start', payload), 400);
        this.started = start;
        this.markStarted(start.matchId);
        for (const x of hs.slice(SEATS)) this.send('full', { to: x });
        status('started');
        finish({ start, host: true, room });
      };
      const offMsg = this.onMsg((m) => {
        if (m.t === 'start') {
          const s = m.d.start as unknown as StartInfo;
          if (!s || s.proto !== this.proto || s.build !== this.build) { status('version'); finish(null); return; }
          const running = m.d.running as StartResult['running'] | undefined;
          if (running) {
            if (m.d.to !== this.id) return;                        // a replay-join offer for someone else
            this.started = s;
            status('started');
            finish({ start: s, host: false, room, running });
            return;
          }
          if (!s.seats.some((x) => x.peer === this.id)) { status('full'); finish(null); return; }
          this.started = s;
          this.markStarted(s.matchId);
          status('started');
          finish({ start: s, host: false, room });
        } else if (m.t === 'full' && m.d.to === this.id) { status('full'); finish(null); }
        else if (m.t === 'version' && m.d.to === this.id && m.from === this.lowestPresent()) { status('version'); finish(null); }
      });
      const offPres = this.onPresence(() => {
        // tell a mismatched newcomer (once per id per room) so its UI can say "update the game"
        if (this.lowestPresent() === this.id) for (const x of this.strangers()) if (!this.toldVersion.has(x)) { this.toldVersion.add(x); this.send('version', { to: x }); }
        check();
      });
      timer = setInterval(check, 250);
      check();
    });
  }
  private toldVersion = new Set<string>();

  /** someone present in this room is already playing a started match (a newcomer must never host a 2nd START) */
  matchRunningHere(): boolean {
    const st = this.presence();
    for (const k in st) if (st[k].started && k !== this.id) return true;
    return false;
  }
  private markStarted(matchId: string): void {
    if (this.channel) void this.channel.track({ ...this.meta(), started: true, matchId } as Record<string, unknown>);
  }

  /** Host a room with a code (friends join with the code / ?room=CODE). Starts on startNow() or 4 humans. */
  async hostCode(code: string, o: WaitOpts): Promise<StartResult | null> {
    await this.joinRoom(code);
    return this.waitForStart({ ...o, waitMs: o.waitMs ?? 0 });
  }

  /** Join a room by code. Resolves at START (or with `running` when the match is already on: replay-join). */
  async joinCode(code: string, o: WaitOpts = {}): Promise<StartResult | null> {
    await this.joinRoom(code);
    // `makeStart` lets a guest that BECOMES the lowest id (the host left the lobby) start the match; waitMs stays 0, so a joiner never
    // starts anything on its own except through startNow() / a full room (the lobby offers START only once it has seen a host)
    return this.waitForStart({ onStatus: o.onStatus, makeStart: o.makeStart });
  }

  /**
   * QUICK MATCH for 4: seek in `ffg-lobby:<game>`, group with same-version seekers, wait in the room (lowest id
   * hosts), START at 4 humans / after waitMs / on startNow(). Resolves null on cancel() or timeout.
   */
  async quickMatch(o: WaitOpts & { timeoutMs?: number }): Promise<StartResult | null> {
    const sb = await this.connect();
    const lobby = sb.channel('ffg-lobby:' + this.gameId, { config: { presence: { key: this.id } } });
    this.lobby = lobby;
    let myRoom: string | null = null;
    let tracked: string | null | undefined;
    const avoid = new Set<string>();
    /** the room of the running match this seeker chose to replay-join (its seat is offered by that match's authority) */
    let runningRoom: string | null = null;
    const track = (): void => {
      if (tracked === myRoom) return;
      tracked = myRoom;
      void lobby.track({ ...this.meta(), room: myRoom });
    };
    const leader = (ids: string[]): string => ids.slice().sort()[0];
    /** where to be: an open running match, else the open waiting room with the lowest leader, else open one */
    const decide = (): string | null => {
      const st = lobby.presenceState();
      const all = Object.keys(st).map((k) => (st[k] && st[k][0]) as PresenceMeta).filter((m) => this.compatible(m));
      const rooms = new Map<string, string[]>();
      let running: string | null = null;
      for (const m of all) {
        if (m.running) { if ((m.open ?? 0) > 0 && (m.cutoffAt ?? 0) > Date.now() + 5000 && m.room && (!running || m.room < running)) running = m.room; continue; }
        if (m.started && m.room) { avoid.add(m.room); continue; }
        if (m.room && m.id !== this.id && !avoid.has(m.room)) { const l = rooms.get(m.room) ?? []; l.push(m.id); rooms.set(m.room, l); }
      }
      if (myRoom) {
        const here = [this.id, ...(rooms.get(myRoom) ?? [])];
        // a running match that still has a bot seat beats waiting alone: lobby presence syncs AFTER the first decision on a real
        // channel, so a seeker usually opened its own room a moment before the advert showed up (found against live Supabase)
        if (running && running !== myRoom && here.length === 1) { runningRoom = running; return running; }
        // merge: move to a room with a LOWER leader when everyone here fits there
        let best: string | null = null, bestLeader = leader(here);
        for (const [r, ids] of rooms) if (r !== myRoom && ids.length + here.length <= SEATS && leader(ids) < bestLeader) { best = r; bestLeader = leader(ids); }
        return best ?? myRoom;
      }
      if (running) { runningRoom = running; return running; }
      let best: string | null = null, bestLeader = '';
      for (const [r, ids] of rooms) if (ids.length < SEATS && (best === null || leader(ids) < bestLeader)) { best = r; bestLeader = leader(ids); }
      if (best) return best;
      const unroomed = all.filter((m) => !m.room && !m.running).map((m) => m.id);
      if (!unroomed.includes(this.id)) unroomed.push(this.id);
      return leader(unroomed) === this.id ? 'Q' + this.id.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase() : null;
    };
    return new Promise((resolve) => {
      let done = false;
      let busy = false;
      let poll: ReturnType<typeof setInterval> | null = null;
      let deadline: ReturnType<typeof setTimeout> | null = null;
      let waiting: string | null = null;
      const close = (r: StartResult | null): void => {
        if (done) return;
        done = true;
        this.cancelFn = null;
        if (poll) clearInterval(poll);
        if (deadline) clearTimeout(deadline);
        // a started room leaves the lobby view at once ({started}) so seekers never wait in it; presence lingers briefly
        if (r) void lobby.track({ ...this.meta(), room: r.room, started: true });
        setTimeout(() => { try { void lobby.untrack(); void sb.removeChannel(lobby); } catch { /* gone */ } if (this.lobby === lobby) this.lobby = null; }, r ? LOBBY_LINGER_MS : 0);
        if (!r) this.leaveRoomOnly();
        resolve(r);
      };
      this.cancelFn = () => close(null);
      const step = async (): Promise<void> => {
        if (done || busy) return;
        busy = true;
        try {
          const target = decide();
          if (target && target !== myRoom) { myRoom = target; await this.joinRoom(target); }
          track();
          if (done || !myRoom || waiting === myRoom) return;
          const room = myRoom;
          waiting = room;
          // a room with a match running in it is normally a room to leave (seek elsewhere), EXCEPT the running match this seeker came
          // for: that match's authority offers its bot seat (replay join), so wait in it
          void this.waitForStart({ makeStart: o.makeStart, waitMs: o.waitMs ?? QUICK_WAIT_MS, onStatus: o.onStatus, leaveIfRunning: room !== runningRoom }).then((r) => {
            if (waiting === room) waiting = null;
            if (r) { close(r); return; }
            if (done) return;
            // not in that START (full / raced a merge) or moved rooms: seek again, never back into that room
            if (this.room === room) { avoid.add(room); this.leaveRoomOnly(); myRoom = null; track(); }
          });
        } finally { busy = false; }
      };
      lobby.on('presence', { event: 'sync' }, (() => { void step(); }) as never);
      lobby.subscribe((status: string) => { if (status === 'SUBSCRIBED') { track(); void step(); } });
      poll = setInterval(() => { void step(); }, 500);
      if ((o.timeoutMs ?? 0) > 0) deadline = setTimeout(() => close(null), o.timeoutMs);
    });
  }
  private cancelFn: (() => void) | null = null;
  /** cancel a pending quick match */
  cancel(): void { if (this.cancelFn) this.cancelFn(); }

  private leaveRoomOnly(): void {
    const sb = this.sb, ch = this.channel;
    this.channel = null; this.room = null; this.roomExtra = {};
    if (ch && sb) { try { void ch.untrack(); void sb.removeChannel(ch); } catch { /* gone */ } }
  }

  /** a running match advertises its open bot seats in the lobby until the replay-join cutoff (authority only) */
  async advertiseRunning(open: number, cutoffAt: number): Promise<void> {
    if (!this.room) return;
    const sb = await this.connect();
    if (!this.lobby) {
      this.lobby = sb.channel('ffg-lobby:' + this.gameId, { config: { presence: { key: this.id } } });
      this.lobby.subscribe(() => { /* tracked below */ });
    }
    this.runningAdvert = { ...this.meta(), room: this.room, running: true, open, cutoffAt };
    void this.lobby.track(this.runningAdvert as Record<string, unknown>);
  }
  async stopAdvertising(): Promise<void> {
    this.runningAdvert = null;
    const l = this.lobby, sb = this.sb;
    this.lobby = null;
    if (l && sb) { try { void l.untrack(); void sb.removeChannel(l); } catch { /* gone */ } }
  }

  /** RESULT (reliable enough: one message per peer per match, through the budget) */
  sendResult(d: Record<string, unknown>): boolean { return this.send('result', d); }

  leave(): void {
    const sb = this.sb;
    try { if (this.channel && sb) { void this.channel.untrack(); void sb.removeChannel(this.channel); } } catch { /* gone */ }
    try { if (this.lobby && sb) { void this.lobby.untrack(); void sb.removeChannel(this.lobby); } } catch { /* gone */ }
    this.channel = this.lobby = null;
    this.room = null;
  }
}
