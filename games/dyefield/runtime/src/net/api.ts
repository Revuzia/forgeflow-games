// DYEFIELD — the OnlineApi (CONTRACT_ONLINE §O11.1): QUICK MATCH / CREATE ROOM / JOIN ROOM against the dyefield-net Worker,
// the room's control flow (§O4) and the online match sessions (net/session.ts). Browser only; lazy-loaded (main.ts
// openOnline): the offline boot path imports none of net/**.
//
// Flow: quickMatch → /qm socket → `qm` → queue / solo / matched → /room/<code>?ticket= ; createRoom → /room/new ;
// joinRoom → /room/<code>. Every room socket says `hello` (profile, device, simMs, rttMs) and gets `welcome` (slot, token —
// kept in sessionStorage per code for reconnects) and `members`. `assign` starts a match: the named host builds the roster
// (net/roster.ts) and sends `roster`; every member loads the arena through the OnlineDriver (main.ts), starts its
// OnlineSession on the Game's world and says `loaded`. `end` (or the Room's void) → the driver's ended(); REMATCH / PLAY AGAIN
// → `rematch`. A dropped room socket reconnects with its token (0.5, 1, 2, 4 s), then "Connection lost".

import type { MatchWorld, MatchResult } from '../core/match/world.ts';
import type { RosterEntry, BotSkill } from '../core/match/roster.ts';
import { WsTransport } from './transport.ts';
import { OnlineSession, type EndInfo, type GameNet, type SessionArena, type SessionHooks, type SessionSpec } from './session.ts';
import { buildOnlineRoster } from './roster.ts';
import {
  CLOSE, DEFAULT_RELAY, PROTO, normCode, parseText, sanitizeName, type Device, type TextMsg, type WireMember, type WireRoom,
  type WireSeat,
} from './proto.ts';

// ───────────────────────────── the contract's API types (§O11.1) ─────────────────────────────
export type OnlineMode = 'teams' | 'ffa';
export type OnlineRule = 'turf' | 'washout';
export interface OnlineProfile { name: string; kit: string; crew: 0 | 1 | 2; ffaColor: number }
export interface RoomMember { slot: number; name: string; kit: string; crew: number; color: number;
  device: 'kbm' | 'touch'; conn: boolean; owner: boolean; host: boolean; rttMs: number | null }
export interface RoomView { code: string; quick: boolean; mode: OnlineMode; rule: OnlineRule;
  map: string /* id | 'random' */; preset: string; skill: 'breeze' | 'swell' | 'storm';
  phase: 'room' | 'loading' | 'live' | 'post'; matchNo: number; members: RoomMember[];
  mySlot: number; ownerSlot: number; hostSlot: number }
export type NetErrorCode = 'room_full' | 'not_found' | 'busy' | 'build' | 'proto' | 'quota' | 'rate' | 'origin'
  | 'bad' | 'network' | 'unsupported' | 'kicked';
export type NetStatus =
  | { kind: 'idle' } | { kind: 'connecting' }
  | { kind: 'queue'; waiting: number; waitedS: number } | { kind: 'solo' }
  | { kind: 'room'; room: RoomView }
  | { kind: 'error'; code: NetErrorCode; msg: string } | { kind: 'closed'; why: string };
export interface OnlineHudState { rttMs: number | null; quality: 'good' | 'ok' | 'bad'; host: boolean;
  hostName: string; migrating: boolean;
  players: Array<{ runner: number; name: string; human: boolean; conn: boolean; rttMs: number | null }> }
export type OnlineEvent =
  | { t: 'joined'; name: string } | { t: 'left'; name: string } | { t: 'botTakeover'; runner: number }
  | { t: 'migrating' } | { t: 'migrated'; hostName: string } | { t: 'kicked'; why: string }
  | { t: 'resynced' } | { t: 'voided'; why: string };
export interface OnlineApi {
  quickMatch(mode: OnlineMode, rule: OnlineRule, p: OnlineProfile): void;
  createRoom(mode: OnlineMode, rule: OnlineRule, p: OnlineProfile): void;
  joinRoom(code: string, p: OnlineProfile): void;
  setProfile(p: Partial<OnlineProfile>): void;
  configure(c: Partial<{ mode: OnlineMode; rule: OnlineRule; map: string; preset: string;
    skill: 'breeze' | 'swell' | 'storm' }>): void;          // owner only
  start(): void; kick(slot: number): void; rematch(): void;  // owner / post
  keepWaiting(): void; playBotsInstead(): void; leave(): void;
  status(): NetStatus; onStatus(cb: (s: NetStatus) => void): () => void;
  hud(): OnlineHudState | null; onEvent(cb: (e: OnlineEvent) => void): () => void;
  inviteUrl(): string | null;
}

// ───────────────────────────── the driver main.ts implements ─────────────────────────────
/** what main.ts needs to know to build the online match's Game (the same MatchWorld as every other member) */
export interface OnlineMatchLoad {
  map: string; preset: string; seed: number; mode: OnlineMode; rule: OnlineRule; skill: BotSkill; durationS: number;
  countdownS: number; roster: RosterEntry[]; localPid: number; kit: string; matchNo: number; matchId: string;
  role: 'host' | 'client';
}

/** the Game main.ts built for an online match */
export interface OnlineGameHandle {
  /** the Game's world (host: the real sim; client: the container world) */
  readonly world: MatchWorld;
  readonly arena: SessionArena;
  /** hand the Game its net session (GameNet) */
  attach(net: GameNet): void;
  /** a migration swapped the world */
  adopt(w: MatchWorld): void;
  /** a KEYFRAME rewrote the court: rebuild the paint texture + minimap */
  courtReload(): void;
  /** a seat changed: the runner's name and who drives it (human / bot / away) */
  renamed(runner: number, name: string, status: 'human' | 'bot' | 'away'): void;
}

export interface OnlineDriver {
  /** load the arena + start the online match's Game (the loading card shows meanwhile) */
  load(spec: OnlineMatchLoad): Promise<OnlineGameHandle>;
  /** the match is over (end / void / dropped): the slate, the stats hand-off */
  ended(e: EndInfo, spec: OnlineMatchLoad, me: number): void;
  /** back to the lobby menus (LEAVE / a fatal error mid-match) */
  toLobby(): void;
  /** PLAY VS BOTS: the normal offline match with the same mode / rule */
  playOffline(mode: OnlineMode, rule: OnlineRule): void;
  /** the lobby Game's measured mean sim ms per tick (host capacity) */
  simMs(): number;
  device(): Device;
  /** the host changed during my match (stats continuation: the same matchId) */
  migrated?(w: MatchWorld, spec: OnlineMatchLoad, role: 'host' | 'client'): void;
}

export interface ApiOptions {
  relay?: string;
  build: string;
  driver: OnlineDriver;
  /** dev params (honoured only with ?dev=1 by main.ts) */
  dev?: { netlag?: number; idlekick?: number; autopilot?: number | null; netdur?: number };
  /** the reconnect-token store (default: sessionStorage; the Node probes pass one per device) */
  tokens?: TokenStore;
}

type SockKind = 'lobby' | 'room';

const STATUS_IDLE: NetStatus = { kind: 'idle' };
const RECONNECT_MS = [500, 1000, 2000, 4000];

function tokenKey(code: string): string { return `dyefield.net.token.${code}`; }
/** where the reconnect token of a room lives: the page's sessionStorage (per tab, as the browser keeps it); a Node probe passes one per device */
export interface TokenStore { get(k: string): string | null; set(k: string, v: string): void; del(k: string): void }
const browserStore: TokenStore = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* blocked */ } },
  del: (k) => { try { sessionStorage.removeItem(k); } catch { /* blocked */ } },
};

const errOf = (code: string): NetErrorCode => {
  const known: NetErrorCode[] = ['room_full', 'not_found', 'busy', 'build', 'proto', 'quota', 'rate', 'origin', 'bad', 'network', 'unsupported', 'kicked'];
  return (known as string[]).includes(code) ? code as NetErrorCode : 'bad';
};

export class NetApi implements OnlineApi {
  private readonly relay: string;
  private readonly build: string;
  private readonly driver: OnlineDriver;
  private readonly dev: NonNullable<ApiOptions['dev']>;
  private readonly tokens: TokenStore;
  private st: NetStatus = STATUS_IDLE;
  private readonly statusCbs = new Set<(s: NetStatus) => void>();
  private readonly eventCbs = new Set<(e: OnlineEvent) => void>();
  private sock: WsTransport | null = null;
  private sockKind: SockKind | null = null;
  private profile: OnlineProfile = { name: '', kit: 'mist-rasp', crew: 0, ffaColor: 1 };
  private qm: { mode: OnlineMode; rule: OnlineRule } | null = null;
  // room
  private room: WireRoom | null = null;
  private members: WireMember[] = [];
  private mySlot = -1;
  private code = '';
  private ticket = '';
  private reconnects = 0;
  private reconnectTimer = 0;
  private leaving = false;
  // match
  private assign: Extract<TextMsg, { t: 'assign' }> | null = null;
  private load: OnlineMatchLoad | null = null;
  private handle: OnlineGameHandle | null = null;
  session: OnlineSession | null = null;
  private loading = false;
  private pendingFrames: Array<ArrayBuffer | string> = [];
  private migrating = false;
  private hostName = '';
  /** read-back: the last errors / closes */
  readonly log: string[] = [];

  constructor(o: ApiOptions) {
    this.relay = (o.relay || DEFAULT_RELAY).replace(/\/+$/, '');
    this.build = o.build;
    this.driver = o.driver;
    this.dev = o.dev ?? {};
    this.tokens = o.tokens ?? browserStore;
  }

  // ───────────────────────────── status / events ─────────────────────────────
  status(): NetStatus { return this.st; }
  onStatus(cb: (s: NetStatus) => void): () => void { this.statusCbs.add(cb); return () => this.statusCbs.delete(cb); }
  onEvent(cb: (e: OnlineEvent) => void): () => void { this.eventCbs.add(cb); return () => this.eventCbs.delete(cb); }
  private set(s: NetStatus): void { this.st = s; for (const cb of this.statusCbs) { try { cb(s); } catch (e) { console.warn(e); } } }
  private emit(e: OnlineEvent): void { for (const cb of this.eventCbs) { try { cb(e); } catch (er) { console.warn(er); } } }
  private note(s: string): void { this.log.push(`${new Date().toISOString().slice(11, 19)} ${s}`); if (this.log.length > 100) this.log.shift(); }

  private roomView(): RoomView | null {
    const r = this.room;
    if (!r) return null;
    const phase = r.phase === 'closed' ? 'post' : r.phase;
    return {
      code: r.code, quick: r.quick, mode: r.mode, rule: r.rule, map: r.map, preset: r.preset, skill: r.skill, phase,
      matchNo: r.matchNo, mySlot: this.mySlot, ownerSlot: r.ownerSlot, hostSlot: r.hostSlot,
      members: this.members.map((m) => ({ slot: m.slot, name: m.name, kit: m.kit, crew: m.crew, color: m.color, device: m.device, conn: m.conn, owner: m.owner, host: m.host, rttMs: m.rttMs })),
    };
  }
  private pushRoom(): void { const v = this.roomView(); if (v) this.set({ kind: 'room', room: v }); }

  // ───────────────────────────── sockets ─────────────────────────────
  private open(kind: SockKind, path: string): void {
    this.closeSock();
    this.sockKind = kind;
    const url = `${this.relay}${path}`;
    this.note(`open ${kind} ${path}`);
    const t = new WsTransport(url, {
      open: () => this.onOpen(t),
      text: (s) => { if (this.sock === t) this.onText(s); },
      binary: (b) => { if (this.sock === t) this.onBinary(b); },
      close: (code, why) => { if (this.sock === t) this.onClose(code, why); },
    }, this.dev.netlag ?? 0);
    this.sock = t;
  }

  private closeSock(code = CLOSE.normal, why = 'leave'): void {
    const s = this.sock;
    this.sock = null;
    this.sockKind = null;
    s?.close(code, why);
  }

  private send(d: ArrayBuffer | string): void { this.sock?.send(d); }
  private sendText(m: TextMsg | Record<string, unknown>): void { this.send(JSON.stringify(m)); }

  /** the last hello / qm fields sent (read-back: the host-pick score inputs) */
  private lastHello: Record<string, unknown> | null = null;

  private hello(): Record<string, unknown> {
    const p = this.profile;
    return this.lastHello = {
      proto: PROTO, build: this.build, name: sanitizeName(p.name), kit: p.kit, crew: p.crew, color: p.ffaColor,
      device: this.driver.device(), simMs: Math.round(this.driver.simMs() * 100) / 100, rttMs: this.sock?.rtt() ?? 100,
    };
  }

  private onOpen(t: WsTransport): void {
    if (this.sock !== t) return;
    if (this.sockKind === 'lobby') { this.sendText({ t: 'qm', ...this.hello() }); return; }
    const token = this.code ? this.tokens.get(tokenKey(this.code)) : null;
    this.sendText({ t: 'hello', ...this.hello(), ...(token ? { token } : {}) });
  }

  private onClose(code: number, why: string): void {
    this.note(`close ${code} ${why}`);
    const kind = this.sockKind;
    this.sock = null;
    this.sockKind = null;
    if (this.leaving) return;
    if (code === CLOSE.kicked) {
      this.emit({ t: 'kicked', why: why || 'owner' });
      this.endMatch('dropped');
      this.set({ kind: 'error', code: 'kicked', msg: why === 'idle' ? 'Removed for inactivity' : 'Removed from the room' });
      return;
    }
    if (code === CLOSE.full) { this.set({ kind: 'error', code: 'room_full', msg: 'That room is full' }); return; }
    if (code === CLOSE.notFound) { this.set({ kind: 'error', code: 'not_found', msg: 'No room with that code' }); return; }
    if (code === CLOSE.build) { if (this.st.kind !== 'error') this.set({ kind: 'error', code: 'build', msg: 'Update DYEFIELD: reload the page' }); return; }
    if (code === CLOSE.quota) { if (this.st.kind !== 'error') this.set({ kind: 'error', code: 'quota', msg: 'Online is full for today — play vs bots' }); return; }
    if (code === CLOSE.rate) { this.set({ kind: 'error', code: 'rate', msg: 'Too many messages' }); return; }
    if (code === CLOSE.closed) { this.endMatch('dropped'); this.set({ kind: 'closed', why: 'The room closed' }); return; }
    if (code === CLOSE.normal) {
      // the Room's requeue (a quick rematch without enough votes / the others never arrived)
      // (not after a `solo`: the player picks KEEP WAITING / PLAY VS BOTS)
      if (kind === 'room' && this.room?.quick && this.qm && !this.session && this.st.kind !== 'solo') { this.quickMatch(this.qm.mode, this.qm.rule, this.profile); return; }
      if (this.st.kind !== 'solo' && this.st.kind !== 'error') this.set({ kind: 'closed', why: why || 'closed' });
      return;
    }
    if (kind === 'room' && this.code) { this.reconnect(); return; }
    this.set({ kind: 'error', code: 'network', msg: 'Connection lost' });
  }

  /** §O7.2: 0.5, 1, 2, 4 s, then "Connection lost — RETRY / LEAVE" */
  private reconnect(): void {
    if (this.reconnects >= RECONNECT_MS.length) {
      this.reconnects = 0;
      this.endMatch('dropped');
      this.set({ kind: 'error', code: 'network', msg: 'Connection lost' });
      return;
    }
    const ms = RECONNECT_MS[this.reconnects++];
    this.note(`reconnect in ${ms} ms`);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.leaving || !this.code) return;
      const token = this.tokens.get(tokenKey(this.code));
      this.open('room', `/room/${this.code}?build=${encodeURIComponent(this.build)}${token ? `&token=${token}` : ''}`);
    }, ms) as unknown as number;
  }

  // ───────────────────────────── public API ─────────────────────────────
  setProfile(p: Partial<OnlineProfile>): void {
    this.profile = { ...this.profile, ...p };
    if (this.sockKind === 'room' && this.room && (this.room.phase === 'room' || this.room.phase === 'post')) {
      this.sendText({ t: 'set', kit: this.profile.kit, crew: this.profile.crew, color: this.profile.ffaColor });
    }
  }

  quickMatch(mode: OnlineMode, rule: OnlineRule, p: OnlineProfile): void {
    this.reset();
    this.profile = { ...p };
    this.qm = { mode, rule };
    this.set({ kind: 'connecting' });
    this.open('lobby', `/qm?mode=${mode}&rule=${rule}&build=${encodeURIComponent(this.build)}`);
  }

  createRoom(mode: OnlineMode, rule: OnlineRule, p: OnlineProfile): void {
    this.reset();
    this.profile = { ...p };
    this.set({ kind: 'connecting' });
    this.open('room', `/room/new?mode=${mode}&rule=${rule}&build=${encodeURIComponent(this.build)}`);
  }

  joinRoom(code: string, p: OnlineProfile): void {
    const c = normCode(code);
    this.reset();
    this.profile = { ...p };
    if (!c) { this.set({ kind: 'error', code: 'not_found', msg: 'Room codes are 4 characters' }); return; }
    this.code = c;
    this.set({ kind: 'connecting' });
    const token = this.tokens.get(tokenKey(c));
    this.open('room', `/room/${c}?build=${encodeURIComponent(this.build)}${token ? `&token=${token}` : ''}`);
  }

  configure(c: Partial<{ mode: OnlineMode; rule: OnlineRule; map: string; preset: string; skill: 'breeze' | 'swell' | 'storm' }>): void {
    const m: Record<string, unknown> = { t: 'cfg', ...c };
    if (this.dev.netdur) m.durationS = this.dev.netdur;
    this.sendText(m);
  }

  start(): void {
    if (this.dev.netdur) this.sendText({ t: 'cfg', durationS: this.dev.netdur });
    this.sendText({ t: 'start' });
  }
  kick(slot: number): void { this.sendText({ t: 'kick', slot, why: 'owner' }); }
  rematch(): void { this.sendText({ t: 'rematch' }); }
  keepWaiting(): void {
    if (this.qm && this.sockKind !== 'lobby') this.quickMatch(this.qm.mode, this.qm.rule, this.profile);
    else if (this.st.kind === 'solo') this.set({ kind: 'queue', waiting: 1, waitedS: 0 });
  }
  playBotsInstead(): void {
    const q = this.qm ?? { mode: (this.room?.mode ?? 'teams') as OnlineMode, rule: (this.room?.rule ?? 'turf') as OnlineRule };
    this.leave(false);
    this.driver.playOffline(q.mode, q.rule);
  }

  leave(toLobby = true): void {
    const inMatch = !!this.session;
    this.leaving = true;
    if (this.sock) this.sendText({ t: 'leave' });
    this.closeSock(CLOSE.normal, 'leave');
    if (this.code) this.tokens.del(tokenKey(this.code));
    this.disposeSession();
    this.reset();
    this.set(STATUS_IDLE);
    if (toLobby && inMatch) this.driver.toLobby();
  }

  private reset(): void {
    clearTimeout(this.reconnectTimer);
    this.closeSock();
    this.room = null; this.members = []; this.mySlot = -1; this.code = ''; this.ticket = ''; this.reconnects = 0;
    this.assign = null; this.load = null; this.leaving = false; this.pendingFrames = [];
  }

  inviteUrl(): string | null {
    if (!this.room || this.room.quick) return null;
    const code = this.room.code;
    try {
      const inFrame = window.self !== window.top;
      if (inFrame) {
        // §O10: inside the portal → a portal link (GamePlayer forwards ?room= into the iframe), allowlisted origins only
        const anc = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
        let origin = anc && anc.length ? anc[0] : '';
        if (!origin && document.referrer) { try { origin = new URL(document.referrer).origin; } catch { origin = ''; } }
        const ok = ['https://forgeflowgames.com', 'https://www.forgeflowgames.com', 'https://forgeflow-games.pages.dev'];
        if (ok.includes(origin)) return `${origin}/games/dyefield?room=${code}`;
        return null;
      }
      const u = new URL(location.href);
      for (const k of [...u.searchParams.keys()]) if (k !== 'room') u.searchParams.delete(k);
      u.searchParams.set('room', code);
      return u.toString();
    } catch { return null; }
  }

  hud(): OnlineHudState | null {
    const s = this.session;
    if (!s) return null;
    // the ping badge: the client ↔ host RTT (§O5.2) on a client, the relay ping on the host
    const hr = s.client?.hostRttMs ?? null;
    const rtt = hr !== null ? Math.round(hr) : (this.sock?.rtt() ?? null);
    const w = s.world;
    const slotOf = new Map<number, number>();
    for (const [slot, runner] of s.seats) slotOf.set(runner, slot);
    const players = w.runners.map((r) => {
      const slot = slotOf.get(r.id);
      const m = slot !== undefined ? this.members.find((x) => x.slot === slot) : undefined;
      return { runner: r.id, name: r.name, human: !!m && (s.human.get(r.id) ?? true), conn: !!m && m.conn, rttMs: m?.rttMs ?? null };
    });
    return {
      rttMs: rtt, quality: rtt === null ? 'ok' : rtt <= 120 ? 'good' : rtt <= 200 ? 'ok' : 'bad', host: s.role === 'host',
      hostName: this.hostName, migrating: this.migrating, players,
    };
  }

  // ───────────────────────────── incoming ─────────────────────────────
  private onBinary(b: ArrayBuffer): void {
    if (this.session && !this.loading) this.session.onBinary(b, performance.now());
    else if (this.loading) { this.pendingFrames.push(b); if (this.pendingFrames.length > 2000) this.pendingFrames.shift(); }
  }

  /** CHANGED(INTEGRATION): forward a room message to the match session. While the arena is still LOADING there is no session yet
   *  (the host's, or a client's after a late roster) — the message is kept and replayed once the session exists (onRoster's
   *  replay loop already handled strings; nothing queued them). Without this a client's `loaded`, sent while a slower HOST was
   *  still loading its arena, was dropped: the host never marked that seat loaded, so its INTENTS were ignored for the whole
   *  match and its runner stayed a bot at the host (found by _harness/online.py A when the HOST was the slower page). */
  private toSession(m: TextMsg, raw: string, now: number): void {
    if (this.session) this.session.onText(m, now);
    else if (this.loading) { this.pendingFrames.push(raw); if (this.pendingFrames.length > 2000) this.pendingFrames.shift(); }
  }

  private onText(s: string): void {
    if (s === 'P') return;
    const m = parseText(s);
    if (!m) return;
    const now = performance.now();
    switch (m.t) {
      case 'queue': this.set({ kind: 'queue', waiting: m.waiting, waitedS: m.waitedS }); return;
      case 'solo': this.set({ kind: 'solo' }); return;
      case 'matched':
        this.ticket = m.ticket;
        this.code = normCode(m.code);
        this.closeSock(CLOSE.normal, 'matched');
        this.open('room', `/room/${this.code}?build=${encodeURIComponent(this.build)}&ticket=${encodeURIComponent(m.ticket)}`);
        return;
      case 'err': {
        const code = errOf(m.code);
        this.note(`err ${m.code} ${m.msg}`);
        if (code === 'bad' && this.room) { this.emit({ t: 'resynced' }); return; }   // a refused room action (e.g. start with 1 human)
        this.set({ kind: 'error', code, msg: m.msg });
        return;
      }
      case 'welcome': {
        this.mySlot = m.slot;
        this.room = m.room;
        this.code = m.room.code;
        this.reconnects = 0;
        this.tokens.set(tokenKey(this.code), m.token);
        this.pushRoom();
        // a reconnect mid-match: the session resyncs through a KEYFRAME (seat + keyframe on `loaded`)
        if (this.session && this.session.role === 'client') { this.session.client?.onHostChange(); this.session.sendLoaded(); }
        else if (this.session && this.session.role === 'host' && m.room.hostSlot >= 0 && m.room.hostSlot !== m.slot) {
          // THE HOST's socket dropped and the Room promoted someone while it was away: the `host` message went to nobody, so
          // `welcome.room.hostSlot` is how it learns (§O6.2 "a stalled old host that comes back sees `host` naming someone
          // else"): it discards its world's authority and re-enters as a client through the keyframe path (§O7.2)
          this.hostName = '';
          this.session.onText({ t: 'host', hostSlot: m.room.hostSlot, reason: 'left', lastTick: this.session.world.tick, matchNo: this.session.spec.matchNo, from: -1 } as unknown as TextMsg, now);
        }
        return;
      }
      case 'members':
        this.members = m.members;
        // CHANGED(INTEGRATION): the relay carries the room's current settings on every `members` broadcast (workers/dyefield-net
        // README: `members {members, phase, room}`) — it has no separate cfg echo. Without this merge the owner's MODE / RULE /
        // ARENA / TIME OF DAY / BOTS picks were applied by the relay but never shown, and every guest saw the room as created
        // (found by _harness/online.py: the owner's LOCKWELL pick left the room on RANDOM)
        if (m.room && this.room) this.room = { ...this.room, ...m.room };
        if (this.room) this.room.phase = m.phase;
        for (const x of m.members) if (x.host && this.room) this.room.hostSlot = x.slot;
        this.hostName = this.members.find((x) => x.host)?.name ?? this.hostName;
        this.session?.onText(m, now);
        this.pushRoom();
        return;
      case 'peer': {
        const pm = m as { slot: number; conn: boolean; left?: boolean; rejoin?: boolean };
        const nm = this.members.find((x) => x.slot === pm.slot)?.name ?? `P${pm.slot}`;
        if (this.session) this.emit(pm.conn ? { t: 'joined', name: nm } : { t: 'left', name: nm });
        this.toSession(m, s, now);
        return;
      }
      case 'assign':
        this.onAssign(m);
        return;
      case 'roster':
        void this.onRoster(m);
        return;
      case 'host': {
        const hm = m as { hostSlot: number; reason: string };
        this.migrating = true;
        this.emit({ t: 'migrating' });
        if (this.room) this.room.hostSlot = hm.hostSlot;
        this.hostName = this.members.find((x) => x.slot === hm.hostSlot)?.name ?? '';
        this.toSession(m, s, now);
        setTimeout(() => { this.migrating = false; this.emit({ t: 'migrated', hostName: this.hostName }); }, 600);
        return;
      }
      case 'seat':
        if (!m.human && m.slot !== null) this.emit({ t: 'botTakeover', runner: m.runner });
        this.toSession(m, s, now);
        return;
      case 'end':
        if (m.voided) this.emit({ t: 'voided', why: (m as { why?: string }).why ?? 'host_lost' });
        if (this.session) this.session.onText(m, now);
        if (this.room) this.room.phase = 'post';
        this.pushRoom();
        return;
      case 'rematch':
        return;
      default:
        if ((m as { t: string }).t === 'requeue') { this.disposeSession(); return; }
        this.toSession(m, s, now);
    }
  }

  // ───────────────────────────── a match ─────────────────────────────
  private onAssign(m: Extract<TextMsg, { t: 'assign' }>): void {
    if (this.assign && this.assign.matchNo === m.matchNo) return;          // a reconnect's repeat
    this.disposeSession();
    this.assign = m;
    // a late joiner's room is already live (its welcome said so): keep that, so its session knows it missed the start
    if (this.room) { if (this.room.phase !== 'live') this.room.phase = 'loading'; this.room.hostSlot = m.hostSlot; this.room.matchNo = m.matchNo; }
    this.pushRoom();
    if (m.hostSlot === this.mySlot) {
      // the host builds the roster for the members the Room assigned (connected humans)
      const humans = (m as { humans?: number[] }).humans;
      const mem = this.members.filter((x) => x.conn && (!humans || humans.includes(x.slot)));
      const { roster, seats } = buildOnlineRoster(mem, m.mode, m.seed, m.skill);
      const durationS = m.durationS && m.durationS > 0 ? m.durationS : 180;
      const msg: TextMsg = { t: 'roster', matchNo: m.matchNo, seats, roster: roster.map((e) => ({ id: e.id, name: e.name, team: e.team, kit: e.kit, bot: e.bot, skill: e.skill })), durationS, countdownS: 3 };
      this.sendText(msg);
      void this.onRoster(msg);
    }
  }

  private async onRoster(m: Extract<TextMsg, { t: 'roster' }>): Promise<void> {
    const a = this.assign;
    if (!a || m.matchNo !== a.matchNo) return;
    if (this.session && this.session.spec.matchNo === m.matchNo) { this.session.onText(m, performance.now()); return; }
    if (this.loading) return;
    const mine = m.seats.find((s) => s.slot === this.mySlot);
    if (!mine) { this.note('roster without my seat (match in progress)'); return; }
    const fromStart = this.room?.phase === 'loading' && !this.lateJoin(m);
    const roster: RosterEntry[] = m.roster.map((e) => ({ id: e.id, name: e.name, team: e.team, kit: e.kit, bot: true, skill: e.skill }));
    const role: 'host' | 'client' = a.hostSlot === this.mySlot ? 'host' : 'client';
    const load: OnlineMatchLoad = {
      map: a.map, preset: a.preset, seed: a.seed, mode: a.mode, rule: a.rule, skill: a.skill, durationS: m.durationS, countdownS: m.countdownS,
      roster, localPid: mine.runner, kit: roster[mine.runner]?.kit ?? this.profile.kit, matchNo: a.matchNo, matchId: `${this.code}:${a.matchNo}:${a.seed >>> 0}`,
      role,
    };
    this.load = load;
    this.loading = true;
    let handle: OnlineGameHandle;
    try { handle = await this.driver.load(load); } catch (e) {
      this.loading = false;
      this.note(`load failed: ${(e as Error).message}`);
      this.set({ kind: 'error', code: 'bad', msg: 'The match could not load' });
      return;
    }
    this.loading = false;
    if (this.assign !== a) return;                                            // a newer match started meanwhile
    this.handle = handle;
    const spec: SessionSpec = {
      matchNo: a.matchNo, seed: a.seed, mode: a.mode, rule: a.rule, skill: a.skill, map: a.map, preset: a.preset, durationS: m.durationS,
      countdownS: m.countdownS, roster, seats: m.seats as WireSeat[], mySlot: this.mySlot, hostSlot: this.room?.hostSlot ?? a.hostSlot,
      members: this.members, migrations: 0, fromStart,
    };
    const hooks: SessionHooks = {
      adoptWorld: (w) => { handle.adopt(w); this.driver.migrated?.(w, load, this.session?.role ?? 'client'); },
      courtReload: () => { handle.courtReload(); this.emit({ t: 'resynced' }); },
      ended: (e) => this.driver.ended(e, load, this.session?.localPid ?? load.localPid),
      renamed: (r, n, st) => handle.renamed(r, n, st),
      hostChanged: () => { /* events emitted by the api */ },
      badCourt: () => this.set({ kind: 'error', code: 'bad', msg: 'This device built a different court — reload' }),
    };
    if (this.dev.idlekick) spec.idleKickS = this.dev.idlekick;
    const s = new OnlineSession(spec, handle.arena, handle.world, (d) => this.send(d), hooks, performance.now());
    if (this.dev.autopilot !== undefined && this.dev.autopilot !== null) s.autopilot(handle.arena.nav, this.dev.autopilot);
    this.session = s;
    handle.attach(s);
    this.sock?.setLive(true);
    s.sendLoaded();
    for (const f of this.pendingFrames) {
      if (typeof f === 'string') { const pm = parseText(f); if (pm) s.onText(pm, performance.now()); }
      else s.onBinary(f, performance.now());
    }
    this.pendingFrames = [];
  }

  /** a roster re-sent for a late joiner (the match runs): my seat was not in the first one */
  private lateJoin(m: Extract<TextMsg, { t: 'roster' }>): boolean {
    return this.room?.phase === 'live' || !!m.from && m.seats.length > 0 && !!this.session;
  }

  private endMatch(status: 'dropped'): void {
    const s = this.session;
    if (s && !s.ended && status === 'dropped') s.dropped();
  }

  private disposeSession(): void {
    this.session?.dispose();
    this.session = null;
    this.handle = null;
    this.sock?.setLive(false);
  }

  // ───────────────────────────── dev read-backs (__NET__) ─────────────────────────────
  /** __NET__.dropSocket(): drop the room socket as a network failure would (reconnect test) */
  dropSocket(): void { this.sock?.drop(); }
  /** __NET__.forceHandoff(): the host hands off as if its page went hidden */
  forceHandoff(): void { this.session?.handoff(); }
  /** __NET__.markSteady(): start a measurement window — the prediction error samples and the correction count restart (the
   *  harness calls it after the match's warm-up hitches: shader compiles, asset decodes; read-back only, never the sim) */
  markSteady(): void {
    const c = this.session?.client;
    if (!c) return;
    c.pred.stats.errs.length = 0;
    c.pred.stats.corrections = 0;
    c.pred.stats.big.length = 0;
  }

  stats(): Record<string, unknown> {
    const s = this.session;
    const c = s?.client ?? null;
    const h = s?.host ?? null;
    const pe = c ? c.predErr() : null;
    return {
      status: this.st.kind, code: this.code, slot: this.mySlot, hello: this.lastHello ? { simMs: this.lastHello.simMs, rttMs: this.lastHello.rttMs, device: this.lastHello.device } : null, role: s?.role ?? null, matchNo: s?.spec.matchNo ?? null,
      localPid: s?.localPid ?? null, migrations: s?.migrations ?? 0, ended: s?.ended ? s.ended.status : null,
      rttMs: this.sock?.rtt() ?? null, transport: this.sock ? { ...this.sock.counts } : null,
      client: c ? {
        ...c.stats, synced: c.synced, lastTick: c.lastTick, renderTick: Math.round(c.renderTick), delayMs: Math.round(c.interp.clock.delayMs),
        predErr: pe, pending: c.pred.pending.length, predicting: c.pred.active, shapes: c.pred.pp.live,
        hostRttMs: c.hostRttMs === null ? null : Math.round(c.hostRttMs),
      } : null,
      host: h ? {
        snaps: h.stats.snaps, snapBytes: h.stats.snapBytes, keyframes: h.stats.keyframes, handoffs: h.stats.handoffs, ticks: h.stats.ticks,
        queueDrops: h.stats.queueDrops, underflows: h.stats.underflows, takeovers: h.stats.takeovers, kicks: h.stats.kicks,
        humans: h.seats.filter((x) => !!x && x.driven).length, intentRates: h.intentRates(),
        runners: h.world.runners.length, hostTps: h.tps(), maxGapMs: Math.round(h.stats.maxGapMs), stalls1s: h.stats.stalls1s, bigGaps: h.stats.bigGaps, humanTicks: h.stats.humanTicks.slice(), seatReport: h.seatReport(), intentFrames: h.stats.intentFrames,
        tickMsP50: [...h.stats.tickMs].sort((a, b) => a - b)[Math.floor(h.stats.tickMs.length / 2)] ?? 0,
        world: { tick: h.world.tick, phase: h.world.phase },
      } : null,
      session: s ? { ...s.stats } : null,
      painterHash: s ? s.world.painter.hash() : null,
      result: s?.ended?.result ? { winner: (s.ended.result as MatchResult).winner, shares: (s.ended.result as MatchResult).shares } : null,
      log: this.log.slice(-20),
    };
  }
}

export function createOnlineApi(o: ApiOptions): NetApi { return new NetApi(o); }
