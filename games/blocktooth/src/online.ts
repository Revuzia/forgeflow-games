// BLOCKTOOTH — ONLINE VS controller (lane O-LOBBY). App-side only: it owns one OnlineSession (src/net/session.ts) and turns
// its events into what the screens need. DOM-free (the lobby / notices / HUD are separate modules fed by the hooks below).
//
//   lobby    quick match / create room / join with code / rematch room  ->  LobbyState (4 seats filling, names, titan picks,
//            the 20 s quick-match countdown, version mismatch, full, errors)
//   load     the START arrives -> the world is built HERE (vsWorldPort, cached so the session adopts the very object) and the
//            app mounts its views against it BEFORE any link is waited for / any sim tick runs (a slow loader never misses
//            the countdown; the signalling listeners are already up)
//   play     the sim is stepped by the session's Worker clock (never by the app's rAF loop); every stepped tick's events are
//            handed to the app; the frame loop only samples input, renders `world` with an interpolation alpha and a
//            COSMETIC prediction of the local titan (render-side only: the sim never sees it)
//   notices  seat flips are read from the world (a bot took a seat / a human took one back: canonical on every peer), the
//            clock hand-over, ping, lag and a lost connection from the net events
//
// The sim is the source of truth for everything shown here; nothing in this file feeds back into it except the input word.

import type { BiomeId, TitanId, TitanInput, World } from './core/types.ts';
import { TITAN_IDS } from './core/types.ts';
import { VS, titanSpeed } from './core/config.ts';
import { botName } from './data/strings_vs.ts';
import { NET_PROTO, SEATS, TICK_MS, type StartInfo } from './net/proto.ts';
import { OnlineSession, type SessionEvent } from './net/session.ts';
import { QUICK_WAIT_MS, type PresenceMeta, type RoomStatus, type StartResult } from './net/room.ts';
import { botLevelOf, vsStartInfo, vsWorldPort, type SimPort, type Standings } from './net/simport.ts';
import type { NetEvent } from './net/lockstep.ts';
import type { VsMatchInfo, VsSeatInfo } from './ui/vstypes.ts';

export type OnlineMode = 'quick' | 'create' | 'join' | 'rematch';

export interface LobbySeat {
  slot: number;
  /** nobody here yet (a bot fills it at START) */
  open: boolean;
  id: string | null;
  name: string;
  titan: TitanId | null;
  host: boolean;
  me: boolean;
}

export type LobbyPhase = 'connecting' | 'seeking' | 'waiting' | 'starting' | 'loading' | 'full' | 'version' | 'error' | 'noroom';

export interface LobbyState {
  mode: OnlineMode;
  phase: LobbyPhase;
  /** the room code to share (create / join / rematch); null for a quick match */
  code: string | null;
  inviteUrl: string | null;
  seats: LobbySeat[];
  filled: number;
  /** I am the room's host (lowest id): only the host can start the match */
  host: boolean;
  canStartNow: boolean;
  /** quick match: whole seconds until the bots fill (null: no countdown) */
  waitLeftS: number | null;
  /** players in the room on another version (they are ignored) */
  strangers: number;
  /** while the START is being loaded: how many humans have finished loading (null = not loading) */
  loading: { ready: number; total: number } | null;
  error: string | null;
}

export interface Notice {
  /** same key replaces the notice on screen (ping / lag) */
  key: string;
  text: string;
  tone: 'info' | 'good' | 'warn' | 'bad';
  ttlMs: number;
}

/** what the connection looks like right now (the app shows an overlay for 'lost' / 'desynced' / 'left') */
export type Connection = 'ok' | 'lagging' | 'lost' | 'desynced' | 'left' | 'catchup';

export interface OnlineOpts {
  mode: OnlineMode;
  code: string | null;
  titan: TitanId;
  biome: BiomeId;
  name: string;
  build: string;
  /** channel namespace (default 'blocktooth'); dev / test runs use their own */
  gameId?: string;
  /** rematch: the host also starts after this long */
  waitMs?: number;
  /** rematch: how many humans are expected (the host starts as soon as they are all here) */
  expectHumans?: number;
  /** quick match: how long to wait for humans before the bots fill (default 20 s) */
  quickWaitMs?: number;
  /** how long to wait for every link after START (slow loaders) */
  connectMs?: number;
  iceServers?: RTCIceServer[];
  log?: (m: string) => void;
}

export interface OnlineHooks {
  lobby(s: LobbyState): void;
  /** the START arrived: mount the views against `w` (a fresh tick-0 world); resolve when the page can show it */
  load(w: World, info: VsMatchInfo, seat: number, joined: boolean): Promise<void>;
  /** the links are up and the sim runs */
  started(info: VsMatchInfo, seat: number, joined: boolean): void;
  /** one stepped tick: `w.events` holds its events (copy them, they are cleared by the next tick) */
  tick(w: World): void;
  notice(n: Notice): void;
  connection(c: Connection): void;
  /** the seats' who-is-a-bot changed: the HUD re-reads names / chips */
  infoChanged(info: VsMatchInfo): void;
  /** the session rebuilt the world object (a stepped-down host): views must rebind */
  rebuilt(w: World): void;
  ended(st: Standings, agreed: boolean): void;
  failed(why: string, where: 'lobby' | 'match'): void;
}

const TICK_S = TICK_MS / 1000;
/** prediction: the local titan is drawn this far (s) ahead of the confirmed state, at most */
const PREDICT_MAX_S = 0.28;
const PREDICT_BLEND_PER_S = 11;
/** ping warning thresholds (ms) with hysteresis */
const PING_WARN_MS = 200;
const PING_CLEAR_MS = 150;
/** a sim that has not advanced for this long (tab visible) is a lost connection */
const STALL_MS = 2500;
/** the longest the load barrier waits for the other humans (a closed tab must not hold a match for ever) */
const BARRIER_MAX_MS = 60000;

const ROOM_ID_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 'GUEST-4F9K' (stable per browser) */
export function guestName(): string {
  const KEY = 'bt.guest';
  try {
    const old = localStorage.getItem(KEY);
    if (old && /^GUEST-[A-Z0-9]{4}$/.test(old)) return old;
  } catch { /* storage blocked */ }
  let s = 'GUEST-';
  try {
    const a = new Uint8Array(4);
    crypto.getRandomValues(a);
    for (let i = 0; i < 4; i++) s += ROOM_ID_LETTERS[a[i] % ROOM_ID_LETTERS.length];
  } catch {
    for (let i = 0; i < 4; i++) s += ROOM_ID_LETTERS[Math.floor(Math.random() * ROOM_ID_LETTERS.length)];
  }
  try { localStorage.setItem(KEY, s); } catch { /* storage blocked */ }
  return s;
}

/** a display name that is safe to show and short enough for a seat card */
export function cleanName(n: unknown): string {
  const s = String(n ?? '').toUpperCase().replace(/[^A-Z0-9 _.\-]/g, '').replace(/\s+/g, ' ').trim();
  return s.slice(0, 14);
}

export function asTitan(v: unknown): TitanId | null {
  return typeof v === 'string' && (TITAN_IDS as readonly string[]).includes(v) ? (v as TitanId) : null;
}

/** the link a friend opens to land in this room (the portal's page when framed: it forwards ?room= into the game) */
export function inviteUrl(code: string): string {
  try {
    if (window.parent !== window) return 'https://forgeflowgames.com/games/blocktooth?room=' + encodeURIComponent(code);
  } catch { return 'https://forgeflowgames.com/games/blocktooth?room=' + encodeURIComponent(code); }
  try { return location.origin + location.pathname + '?room=' + encodeURIComponent(code); } catch { return '?room=' + code; }
}

/** the room code of the rematch after `code` (R1, R2, ...): the same code every peer derives, so nobody has to be told */
export function rematchCode(code: string): string {
  const m = /^(.*?)R(\d{1,2})$/.exec(code);
  const base = m && m[1].length >= 4 ? m[1] : code;
  const n = m && m[1].length >= 4 ? Number(m[2]) + 1 : 1;
  return (base.slice(0, 9) + 'R' + String(Math.min(99, n))).slice(0, 12);
}

/** START -> the app-side description of the match (names, bots, colours); `seat` is the local human's seat */
export function buildInfo(start: StartInfo, seat: number): VsMatchInfo {
  const seats: VsSeatInfo[] = [];
  for (let slot = 0; slot < SEATS; slot++) {
    const s = start.seats[slot];
    const bot = !s || s.kind === 'bot';
    const nm = bot ? botName(slot, start.seed) : { unit: slot === seat ? 'YOU' : cleanName(s.name) || 'PLAYER', sign: '' };
    seats.push({
      slot, titan: asTitan(s ? s.titan : null) ?? 'molo', name: nm.unit, sign: nm.sign, bot,
      level: bot ? botLevelOf(s ? s.botLevel : undefined) : null, color: VS.seatColors[slot] ?? '#ffffff',
    });
  }
  return { seats, local: seat, biome: start.biome as BiomeId, seed: start.seed, palettes: [0, 0, 0, 0] };
}

/** the local seat is a human whatever the START says: a replay joiner sits in a seat the START calls a bot */
function markLocalHuman(info: VsMatchInfo): VsMatchInfo {
  const s = info.seats[info.local];
  if (s) { s.name = 'YOU'; s.sign = ''; s.bot = false; s.level = null; }
  return info;
}

function rnd32(): number {
  try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] >>> 0; } catch { return Math.floor(Math.random() * 0x100000000) >>> 0; }
}

export class OnlineMatch {
  readonly opts: OnlineOpts;
  readonly hooks: OnlineHooks;
  session!: OnlineSession<World>;
  /** START (set by beforeStart) and the description derived from it */
  start: StartInfo | null = null;
  info: VsMatchInfo | null = null;
  seat = 0;
  /** the room code (rooms) once joined */
  roomCode: string | null = null;
  live = false;
  catchingUp = false;
  connection: Connection = 'ok';
  /** a human is still in the room after the match (rematch bookkeeping) */
  humansAtStart = 1;

  private cancelled = false;
  private stepsSeen = 0;
  private lastFrameAt = 0;
  private lastStatus: RoomStatus | null = null;
  private lobbyTimer = 0;
  private lobbyPhaseOverride: LobbyPhase | null = null;
  private lobbyError: string | null = null;
  private tAlone = 0;
  private pre: { matchId: string; w: World } | null = null;
  private inner!: SimPort<World>;
  private rematchPoll = 0;
  /** the load barrier: the room peers that said `ready` for this match */
  private readySet = new Set<string>();
  private loadTotal = 0;

  // frame plumbing
  private lastStepAt = 0;
  private tickEma = TICK_MS;
  private lastTick = -1;
  private lastTickAt = 0;
  private stallSince = 0;
  private seatBot: (boolean | undefined)[] = [undefined, undefined, undefined, undefined];
  private seatTook: number[] = [0, 0, 0, 0];
  private pingHigh = 0;
  private pingWarned = false;
  private pingPoll = 0;
  private lagAt = 0;
  private noticeNo = 0;

  // input
  private rawMx = 0;
  private rawMz = 0;

  // cosmetic prediction (render only)
  private predX = 0;
  private predZ = 0;

  constructor(opts: OnlineOpts, hooks: OnlineHooks) {
    this.opts = opts;
    this.hooks = hooks;
  }

  // ─────────────────────────────── start / stop ───────────────────────────────

  /** open the room flow. Resolves when the flow ended (match started, left, or failed): errors go to the hooks. */
  async begin(): Promise<void> {
    const o = this.opts;
    this.inner = vsWorldPort({ viewSeat: () => this.seat });
    const port: SimPort<World> = {
      ...this.inner,
      create: (start) => {
        const p = this.pre;
        if (p && p.matchId === start.matchId) { this.pre = null; return p.w; }
        return this.inner.create(start);
      },
      step: (w, f) => { this.inner.step(w, f); this.onStep(w); },
    };
    this.session = new OnlineSession<World>({
      build: o.build,
      name: o.name,
      gameId: o.gameId,
      info: { titan: o.titan },
      sim: port,
      makeStart: (humans) => this.makeStart(humans),
      onEvent: (e) => this.onSession(e),
      beforeStart: (r) => this.beforeStart(r),
      connectMs: o.connectMs ?? 25000,
      iceServers: o.iceServers,
      log: o.log,
    });
    this.pushLobby('connecting');
    this.lobbyTimer = window.setInterval(() => { if (!this.live) this.pushLobby(); }, 250);
    let ok = false;
    try {
      if (o.mode === 'quick') ok = await this.session.quickMatch(o.quickWaitMs ?? QUICK_WAIT_MS);
      else if (o.mode === 'create') ok = await this.session.hostCode(o.code ?? '');
      else if (o.mode === 'rematch') {
        const exp = Math.max(0, o.expectHumans ?? 0);
        if (exp > 1) this.rematchPoll = window.setInterval(() => { if (this.session.room.humans().length >= exp) this.session.startNow(); }, 300);
        ok = await this.session.hostCode(o.code ?? '', Math.max(1500, o.waitMs ?? 0));
      } else ok = await this.session.joinCode(o.code ?? '');
    } catch (e) {
      if (this.cancelled) return;
      this.stopTimers();
      this.lobbyError = String(e instanceof Error ? e.message : e);
      this.pushLobby('error');
      this.hooks.failed('matchmaker: ' + this.lobbyError, 'lobby');
      return;
    }
    window.clearInterval(this.rematchPoll);
    if (this.cancelled) return;
    if (!ok && !this.live) {
      this.stopTimers();
      const ph = this.lastStatus ? this.lastStatus.phase : null;
      this.pushLobby(ph === 'version' ? 'version' : ph === 'full' ? 'full' : this.lobbyError ? 'error' : 'full');
    }
  }

  /** Esc in the lobby / a LEAVE: stop everything (also valid mid-match: the seat becomes a bot for the others) */
  leave(): void {
    this.cancelled = true;
    this.stopTimers();
    this.live = false;
    try { this.session?.cancel(); } catch { /* not started */ }
    try { this.session?.leave(); } catch { /* gone */ }
  }

  /** the D8 "START NOW WITH BOTS" button (host only; the room layer ignores it for a guest) */
  startNow(): void { try { this.session.startNow(); } catch { /* not started */ } }

  private stopTimers(): void {
    window.clearInterval(this.lobbyTimer);
    window.clearInterval(this.rematchPoll);
    window.clearInterval(this.pingPoll);
    this.lobbyTimer = 0; this.rematchPoll = 0; this.pingPoll = 0;
  }

  // ─────────────────────────────── the START (host) ───────────────────────────────

  private makeStart(humans: string[]): StartInfo {
    const o = this.opts;
    const room = this.session.room;
    const pres = room.presence();
    const used = new Set<TitanId>();
    const seats: { kind: 'human' | 'bot'; peer: string | null; name: string; titan: string; botLevel?: number }[] = [];
    for (let i = 0; i < SEATS; i++) {
      const id = humans[i];
      if (id) {
        const m = pres[id] as PresenceMeta | undefined;
        const t = asTitan(m ? m.titan : null) ?? (id === room.id ? o.titan : 'molo');
        used.add(t);
        seats.push({ kind: 'human', peer: id, name: cleanName(m ? m.name : '') || 'PLAYER', titan: t });
      } else seats.push({ kind: 'bot', peer: null, name: '', titan: 'molo', botLevel: 1 });
    }
    // the bots play the titans no human picked (in TITAN_IDS order), then repeat
    const pool = TITAN_IDS.filter((t) => !used.has(t));
    let k = 0;
    for (const s of seats) if (s.kind === 'bot') { s.titan = pool.length ? pool[k % pool.length] : TITAN_IDS[k % TITAN_IDS.length]; k++; }
    const code = room.room ?? o.code ?? 'Q';
    return vsStartInfo({
      proto: NET_PROTO, build: o.build,
      matchId: (code + '-' + Date.now().toString(36) + '-' + rnd32().toString(36)).slice(0, 72),
      seed: rnd32(), biome: o.biome, lead: 4, seats,
    });
  }

  // ─────────────────────────────── the session's events ───────────────────────────────

  /** START / replay-join offer arrived: build the world, mount the views, only then go on to the links */
  private async beforeStart(r: StartResult): Promise<void> {
    if (this.cancelled) throw new Error('cancelled');
    const start = r.start;
    const room = this.session.room;
    const running = r.running as (StartResult['running'] & { seat?: number }) | undefined;
    this.start = start;
    this.roomCode = room.room;
    const mine = running ? (running.seat ?? -1) : start.seats.findIndex((s) => s.peer === room.id);
    this.seat = mine >= 0 && mine < SEATS ? mine : 0;
    this.humansAtStart = Math.max(1, start.seats.filter((s) => s.kind === 'human').length);
    this.catchingUp = !!running;
    this.info = markLocalHuman(buildInfo(start, this.seat));
    this.stopTimers();
    this.pushLobby('loading');
    // build the world now: the session adopts exactly this object (see the port's create)
    const w = this.inner.create(start);
    this.pre = { matchId: start.matchId, w };
    this.opts.log?.('ol: START ' + start.matchId + ' seat ' + this.seat + ' - loading');
    await this.hooks.load(w, this.info, this.seat, !!running);
    if (this.cancelled) throw new Error('cancelled');
    this.opts.log?.('ol: loaded @' + Math.round(performance.now()));
    // LOAD BARRIER: nobody's sim may start before every human has finished loading (a peer whose clock starts while another is still
    // building its city would time the clock holder out and elect itself: two worlds). Everyone says `ready` over the room channel
    // (re-sent every second until all are heard: a message sent before a peer registered its handler is lost) and waits for the rest.
    if (!running) await this.loadBarrier(start);
    this.opts.log?.('ol: barrier open - connecting @' + Math.round(performance.now()));
  }

  private async loadBarrier(start: StartInfo): Promise<void> {
    const room = this.session.room;
    const humans = start.seats.filter((s) => s.kind === 'human' && s.peer).map((s) => s.peer as string);
    this.loadTotal = humans.length;
    this.readySet = new Set<string>([room.id]);
    if (humans.length <= 1) return;
    const mid = start.matchId;
    const off = room.onMsg((m) => {
      if (m.t === 'ready' && m.d.m === mid && humans.includes(m.from) && !this.readySet.has(m.from)) { this.readySet.add(m.from); this.pushLobby(); }
    });
    const t0 = performance.now();
    let lastSend = -1e9;
    try {
      while (!this.cancelled && performance.now() - t0 < BARRIER_MAX_MS) {
        if (humans.every((h) => this.readySet.has(h))) break;
        // a peer that left the room while loading will never be ready: stop waiting for it
        const here = new Set(room.humans());
        if (performance.now() - t0 > 4000 && humans.every((h) => this.readySet.has(h) || !here.has(h))) break;
        if (performance.now() - lastSend > 900) { lastSend = performance.now(); room.send('ready', { m: mid }); }
        await new Promise<void>((r) => setTimeout(r, 120));
      }
      // one last announcement so a slower peer that registered late still hears it
      room.send('ready', { m: mid });
    } finally { off(); }
    if (this.cancelled) throw new Error('cancelled');
  }

  private onSession(e: SessionEvent): void {
    switch (e.type) {
      case 'status':
        this.lastStatus = e.status;
        if (!this.live) this.pushLobby();
        break;
      case 'started': {
        this.live = true;
        this.opts.log?.('ol: started seat ' + e.seat + ' host ' + e.host + ' unreachable ' + e.unreachable.length + ' @' + Math.round(performance.now()));
        if (e.seat >= 0) this.seat = e.seat;
        // ONE info object for the whole match (the app's views + the HUD hold it): only the local seat may need correcting
        if (this.info && this.seat !== this.info.local) { this.info.local = this.seat; markLocalHuman(this.info); }
        this.lastStepAt = performance.now();
        this.lastTickAt = this.lastStepAt;
        this.seatBot = [undefined, undefined, undefined, undefined];
        this.pingPoll = window.setInterval(() => this.pollPing(), 1000);
        if (this.info) this.hooks.started(this.info, this.seat, e.joined);
        this.opts.log?.('ol: started hook done @' + Math.round(performance.now()));
        if (e.unreachable.length > 0) this.say('unreach', 'COULDN’T REACH ' + e.unreachable.length + ' PLAYER' + (e.unreachable.length > 1 ? 'S' : '') + ' DIRECTLY — A BOT PLAYS THEIR SEAT', 'warn', 6000);
        break;
      }
      case 'net': this.onNet(e.ev); break;
      case 'result': this.hooks.ended(e.standings, e.agreed); break;
      case 'error': this.hooks.failed(e.why, this.live ? 'match' : 'lobby'); if (!this.live) { this.lobbyError = e.why; this.stopTimers(); this.pushLobby('error'); } break;
      default: break;
    }
  }

  private onNet(ev: NetEvent): void {
    switch (ev.type) {
      case 'authority': {
        if (ev.epoch <= 0) break;
        const me = ev.id === this.session.room.id;
        if (me) this.say('auth', 'HOST LEFT — YOU ARE NOW RUNNING THE CLOCK', 'warn', 6500);
        else this.say('auth', 'HOST LEFT — ' + this.nameOfPeer(ev.id) + ' IS NOW RUNNING THE CLOCK', 'warn', 6500);
        break;
      }
      case 'late': {
        const now = performance.now();
        if (now - this.lagAt > 6000 && ev.count >= 8) { this.lagAt = now; this.hooks.connection('lagging'); window.setTimeout(() => { if (this.connection === 'ok') this.hooks.connection('ok'); }, 2500); }
        break;
      }
      case 'desync':
        if (ev.self) this.setConnection('desynced');
        break;
      case 'rebuilt': {
        const w = this.session.world;
        if (w) { this.seatBot = [undefined, undefined, undefined, undefined]; this.hooks.rebuilt(w); }
        break;
      }
      case 'joined':
        this.catchingUp = false;
        this.setConnection('ok');
        break;
      case 'joinRejected':
        this.hooks.failed('joinRejected: ' + ev.why, 'match');
        break;
      default: break;
    }
  }

  private setConnection(c: Connection): void {
    if (this.connection === c) return;
    this.connection = c;
    this.hooks.connection(c);
  }

  /** display name of a room peer (seat name from the START; falls back to a generic label) */
  private nameOfPeer(id: string): string {
    const st = this.start;
    if (st) {
      const s = st.seats.find((x) => x.peer === id);
      if (s) return cleanName(s.name) || 'PLAYER';
    }
    const m = this.session.room.presence()[id];
    return cleanName(m ? m.name : '') || 'PLAYER';
  }

  private say(key: string, text: string, tone: Notice['tone'], ttlMs: number): void {
    this.hooks.notice({ key: key + ':' + (this.noticeNo++ % 1000), text, tone, ttlMs });
  }
  private sayKeyed(key: string, text: string, tone: Notice['tone'], ttlMs: number): void {
    this.hooks.notice({ key, text, tone, ttlMs });
  }

  // ─────────────────────────────── the lobby ───────────────────────────────

  private pushLobby(force?: LobbyPhase): void {
    if (force) this.lobbyPhaseOverride = force;
    const o = this.opts;
    const room = this.session ? this.session.room : null;
    const st = this.lastStatus;
    const pres = room ? room.presence() : {};
    const humans = st ? st.humans : room ? room.humans() : [];
    const seats: LobbySeat[] = [];
    for (let i = 0; i < SEATS; i++) {
      const id = humans[i] ?? null;
      if (id) {
        const m = pres[id] as PresenceMeta | undefined;
        seats.push({ slot: i, open: false, id, name: cleanName(m ? m.name : '') || (room && id === room.id ? cleanName(o.name) : 'PLAYER'),
          titan: asTitan(m ? m.titan : null) ?? (room && id === room.id ? o.titan : null), host: i === 0, me: !!room && id === room.id });
      } else seats.push({ slot: i, open: true, id: null, name: '', titan: null, host: false, me: false });
    }
    const filled = seats.filter((s) => !s.open).length;
    const host = !!st && st.host;
    let phase: LobbyPhase = this.lobbyPhaseOverride ?? 'connecting';
    if (!this.lobbyPhaseOverride || this.lobbyPhaseOverride === 'connecting') {
      if (!st) phase = 'connecting';
      else if (st.phase === 'version') phase = 'version';
      else if (st.phase === 'full') phase = 'full';
      else if (st.phase === 'starting' || st.phase === 'started') phase = 'starting';
      else phase = o.mode === 'quick' ? 'seeking' : 'waiting';
    }
    // a joiner alone in the room: nobody has opened it (yet)
    if (phase === 'waiting' && o.mode === 'join' && filled <= 1) {
      this.tAlone = this.tAlone || performance.now();
      if (performance.now() - this.tAlone > 8000) phase = 'noroom';
    } else this.tAlone = 0;
    // a room I cannot play in (another version / full / the matchmaker is down): I am nobody's host there
    if (phase === 'version' || phase === 'full' || phase === 'error') for (const x of seats) x.host = false;
    const strangers = room ? room.strangers().length : 0;
    const code = o.mode === 'quick' ? null : (room && room.room) || o.code;
    const waitLeftS = o.mode === 'quick' && st && (st.phase === 'waiting') ? Math.ceil(st.waitLeftMs / 1000) : null;
    this.hooks.lobby({
      mode: o.mode, phase, code, inviteUrl: code ? inviteUrl(code) : null, seats, filled, host,
      canStartNow: host && (phase === 'seeking' || phase === 'waiting'), waitLeftS, strangers, error: this.lobbyError,
      loading: phase === 'loading' && this.loadTotal > 1 ? { ready: this.readySet.size, total: this.loadTotal } : null,
    });
  }

  // ─────────────────────────────── per tick / per frame ───────────────────────────────

  private onStep(w: World): void {
    const now = performance.now();
    if (this.stepsSeen++ === 0) this.opts.log?.('ol: first step tick ' + w.tick + ' @' + Math.round(now));
    if (this.lastStepAt > 0) {
      const gap = now - this.lastStepAt;
      if (gap > 4 && gap < 120) this.tickEma += (gap - this.tickEma) * 0.08;
    }
    this.lastStepAt = now;
    const p = this.session.peer;
    // a long catch-up (a replay join, a tab that was hidden) streams thousands of ticks: their events are history
    const behind = p ? p.confirmed - p.simTick : 0;
    if (behind < 45) this.hooks.tick(w);
  }

  /** render interpolation factor between the previous and the current sim tick (0..1) */
  get alpha(): number {
    const e = Math.max(8, Math.min(60, this.tickEma));
    const a = (performance.now() - this.lastStepAt) / e;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  get world(): World | null { return this.session ? this.session.world : null; }

  /** the input layer's sample for this render frame (the raw titan input + the rail byte). A hook / dash / UPROAR press and a card pick
   *  are ONE-frame edges here; the lockstep peer latches each until a stamped sample carries it, so every press reaches exactly one tick. */
  setInput(raw: TitanInput, card: number): void {
    if (!this.live) return;
    this.rawMx = raw.mx; this.rawMz = raw.mz;
    this.session.setInput({ mx: raw.mx, mz: raw.mz, abilityHeld: raw.abilityHeld, ability: raw.ability, dash: raw.dash, ultimate: !!raw.ultimate }, card);
  }

  /** no input at all (a hidden tab, a menu in front): the titan stands still */
  idleInput(): void {
    this.rawMx = this.rawMz = 0;
    if (this.live) this.session.setInput({ mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false }, 0);
  }

  /** per rendered frame: seat flips -> notices, stalls */
  frame(dt: number): void {
    const nowF = performance.now();
    if (this.lastFrameAt > 0 && nowF - this.lastFrameAt > 700) this.opts.log?.('ol: LONG FRAME ' + Math.round(nowF - this.lastFrameAt) + ' ms @' + Math.round(nowF));
    this.lastFrameAt = nowF;
    const s = this.session;
    const w = s ? s.world : null;
    const p = s ? s.peer : null;
    if (!w || !p || !this.live) return;
    const now = performance.now();
    // catching up (a replay join / a tab that was hidden): no notices from history
    const behind = p.confirmed - p.simTick;
    const catching = behind > 45 || this.catchingUp;
    if (!catching) {
      for (let i = 0; i < w.players.length && i < SEATS; i++) {
        const P = w.players[i];
        const bot = P.bot !== null;
        const took = P.vs.data.tookOver === 1 ? 1 : 0;
        const prev = this.seatBot[i];
        if (prev !== undefined && prev !== bot) this.onSeatFlip(w, i, bot, took > this.seatTook[i]);
        this.seatBot[i] = bot;
        this.seatTook[i] = took;
      }
    }
    // stalls: the sim did not advance for STALL_MS while this tab is visible and the match is not over
    if (p.simTick === 0) this.lastTickAt = now;        // a slow first tick (the match is still loading its first frames) is not a lost connection
    if (p.simTick !== this.lastTick) { this.lastTick = p.simTick; this.lastTickAt = now; if (this.connection === 'lost') { this.setConnection('ok'); this.say('rec', 'RECONNECTED', 'good', 2500); } }
    else if (!p.finished && !w.run.result && p.state !== 'desynced' && p.state !== 'left' && !document.hidden && now - this.lastTickAt > STALL_MS) {
      if (this.connection === 'ok' || this.connection === 'lagging') { this.setConnection('lost'); this.sayKeyed('rec', 'CONNECTION LOST — TRYING TO RECONNECT…', 'bad', 6000); }
    }
    if (catching && this.connection === 'ok' && behind > 45) this.setConnection('catchup');
    else if (!catching && this.connection === 'catchup') this.setConnection('ok');
  }

  private onSeatFlip(w: World, i: number, bot: boolean, tookOver: boolean): void {
    const info = this.info;
    const p = this.session.peer;
    const me = i === this.seat;
    const seatInfo = info ? info.seats[i] : null;
    const titan = seatInfo ? (seatInfo.titan === 'voltkite' ? 'VOLT-KITE' : seatInfo.titan.toUpperCase()) : 'A TITAN';
    if (bot) {
      if (me) this.say('mine', 'A BOT TOOK YOUR SEAT', 'bad', 7000);
      else this.say('flip' + i, (seatInfo && !seatInfo.bot ? seatInfo.name : 'A PLAYER') + ' DROPPED OUT — A BOT IS DRIVING', 'warn', 5000);
    } else if (me) {
      if (tookOver) this.say('mine', 'YOU TOOK OVER A BOT — ' + titan, 'good', 6000);
      else this.say('mine', 'YOU ARE BACK IN CONTROL', 'good', 4000);
    } else {
      // name of whoever sits there now (the roster maps seat -> room peer -> presence name)
      let name = 'A PLAYER';
      if (p) { const r = p.roster()[i]; if (r && r.peer) name = this.nameOfPeer(r.peer); }
      this.say('flip' + i, tookOver ? name + ' TOOK OVER ' + titan : name + ' IS BACK IN CONTROL', 'info', 5000);
    }
    // the HUD's seat cards: a human now / a bot now
    if (seatInfo && info) {
      if (!bot && !me) {
        let name = 'PLAYER';
        if (p) { const r = p.roster()[i]; if (r && r.peer) name = this.nameOfPeer(r.peer); }
        seatInfo.name = name; seatInfo.sign = ''; seatInfo.bot = false; seatInfo.level = null;
      } else if (!bot && me) {
        seatInfo.name = 'YOU'; seatInfo.sign = ''; seatInfo.bot = false; seatInfo.level = null;
      } else if (bot && me) {
        seatInfo.bot = true;
      } else if (bot) {
        const nm = botName(i, this.start ? this.start.seed : 0);
        seatInfo.name = nm.unit; seatInfo.sign = nm.sign; seatInfo.bot = true; seatInfo.level = 'regular';
      } else seatInfo.bot = false;
      this.hooks.infoChanged(info);
    }
    void w;
  }

  private pollPing(): void {
    const p = this.session.peer;
    if (!p) return;
    const rtt = p.stats.rttMs;
    if (rtt < 0) return;
    if (rtt > PING_WARN_MS) {
      this.pingHigh++;
      if (this.pingHigh >= 3 && !this.pingWarned) { this.pingWarned = true; this.sayKeyed('ping', 'HIGH PING ' + Math.round(rtt) + ' MS — YOUR MOVES MAY ARRIVE LATE', 'warn', 8000); }
      else if (this.pingWarned) this.sayKeyed('ping', 'HIGH PING ' + Math.round(rtt) + ' MS — YOUR MOVES MAY ARRIVE LATE', 'warn', 4000);
    } else {
      this.pingHigh = 0;
      if (this.pingWarned && rtt < PING_CLEAR_MS) { this.pingWarned = false; this.sayKeyed('ping', 'PING IS BACK TO NORMAL', 'good', 2500); }
    }
  }

  /** the round trip to the clock holder (ms; -1 = I hold the clock / unknown) */
  get rttMs(): number { const p = this.session ? this.session.peer : null; return p ? Math.round(p.stats.rttMs) : -1; }

  // ─────────────────────────────── cosmetic prediction (render only) ───────────────────────────────

  /**
   * Shift the local titan to where its own input will have taken it by the time the confirmed frames catch up (the input
   * reaches the sim `lead` ticks + a trip later). Called right before the views draw; `endPredict` puts the sim's numbers
   * back right after the render, so the sim (and the hash) never see it.
   */
  beginPredict(w: World, dt: number, enabled: boolean): { T: World['titan']; x: number; z: number; px: number; pz: number } | null {
    const P = w.players[this.seat];
    const p = this.session ? this.session.peer : null;
    let tx = 0, tz = 0;
    if (enabled && P && p && this.live && P.titan.alive && P.bot === null && !P.vs.eliminated && !w.run.result && !this.catchingUp) {
      const T = P.titan;
      const ahead = Math.min(PREDICT_MAX_S, (p.lead + 0.5) * TICK_S + Math.max(0, p.stats.rttMs) / 2000);
      const sp = titanSpeed(T.height);
      const m = Math.hypot(this.rawMx, this.rawMz);
      const k = m > 1 ? 1 / m : 1;
      tx = this.rawMx * k * sp * ahead;
      tz = this.rawMz * k * sp * ahead;
    }
    const b = Math.min(1, Math.max(0, dt) * PREDICT_BLEND_PER_S);
    this.predX += (tx - this.predX) * b;
    this.predZ += (tz - this.predZ) * b;
    if (!P || Math.abs(this.predX) + Math.abs(this.predZ) < 0.02) return null;
    const T = P.titan;
    const saved = { T, x: T.x, z: T.z, px: T.px, pz: T.pz };
    T.x += this.predX; T.z += this.predZ; T.px += this.predX; T.pz += this.predZ;
    return saved;
  }

  endPredict(s: { T: World['titan']; x: number; z: number; px: number; pz: number }): void {
    s.T.x = s.x; s.T.z = s.z; s.T.px = s.px; s.T.pz = s.pz;
  }

  // ─────────────────────────────── diagnostics (window.__BTONLINE__) ───────────────────────────────

  debug(): Record<string, unknown> {
    const p = this.session ? this.session.peer : null;
    const w = p ? p.world : null;
    return {
      mode: this.opts.mode, live: this.live, seat: this.seat, room: this.roomCode, connection: this.connection, catchingUp: this.catchingUp,
      tick: p ? p.simTick : -1, confirmed: p ? p.confirmed : -1, state: p ? p.state : null, authority: p ? p.authority : null, epoch: p ? p.epoch : -1,
      self: this.session ? this.session.room.id : null, isAuthority: p ? p.isAuthority : false, lead: p ? p.lead : -1,
      rtt: p ? p.stats.rttMs : -1, mismatches: p ? p.stats.mismatches : -1, checkpoints: p ? p.stats.checkpoints : -1,
      lateSeen: p ? p.stats.lateSeen : -1, finished: p ? p.finished : false, agreed: p ? p.resultsAgree() : false,
      roster: p ? p.roster() : [], bots: w ? w.players.map((x) => x.bot !== null) : [],
      hash: p && w ? p.sim.hash(w) : 0, matchId: this.start ? this.start.matchId : null,
      sentMsgs: this.session ? this.session.room.sentMsgs : -1, dropped: this.session ? this.session.room.dropped : -1,
    };
  }
}
