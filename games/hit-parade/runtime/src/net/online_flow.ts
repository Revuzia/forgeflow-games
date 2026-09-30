// HIT PARADE - net/online_flow.ts (lane NET). The online match flow over a SimPort (NETCODE 3.6-3.9):
//   lobby / room -> HELLO (proto, build, dataHash, stateVersion, token) -> WebRTC (5 s) or relay fallback
//   -> sync (1 s settle + 10 pings; relay 5) -> D -> blind character select (commit-reveal, 30 s)
//   -> stage + seed (commit-reveal seed parts, host START) -> load -> READY/GO start sync -> match
//   (RollbackSession) -> RESULT agreement (+ ratings when both signed in) -> rematch (20 s) / BYE.
// Disconnects: presence gone for 5 s = win for the stayer (CONTRACT §10); BYE mid-match = forfeit;
// 'in' silent 5 s with presence present = switch to the relay; 20 s silent = NO CONTEST.
// net/online.ts wraps this with `attach(m: Match)`; the lab page drives it with the toy sim.
// All user-facing text leaves this file as `code` keys (NET_STRINGS = default EN copy for lane UI).

import { RollbackSession, type NetEvent, type NetStats, type SimPort, type Transport } from '../core/net/rollback.ts';
import { PKT, decodeSync, encodeSync } from '../core/net/packet.ts';
import { P2P_WINDOW, RELAY_DELAY, RELAY_SEND_EVERY, RELAY_WINDOW, hash32, hashString, inputDelayFor } from '../core/net/sync.ts';
import { NET_PROTO, NetPlay, TurnClock, type RealtimeClient } from './netplay.ts';
import { RtcTransport, type RtcSignal } from './transport_rtc.ts';
import { RelaySlot, RelayTransport } from './transport_relay.ts';
import { currentPlayer, reportResult } from './ratings.ts';

export type Scheme = 0 | 1;
export interface OnlinePlayerCfg { fighter: string; color: number; scheme: Scheme; cpu: number }
/** Structurally identical to core/sim/match.ts MatchCfg with mode 'online'. */
export interface OnlineMatchCfg { mode: 'online'; stage: string; seed: number; p: [OnlinePlayerCfg, OnlinePlayerCfg]; rounds?: number; timer?: number }
export interface OnlinePick { fighter: string; color: number; scheme: Scheme; stage?: string }

export type OnlinePhase = 'idle' | 'searching' | 'room' | 'connecting' | 'syncing' | 'select' | 'loading' | 'match' | 'result' | 'ended';

/** Status / error codes -> default English copy (lane UI owns the real strings in data/strings.json). */
export const NET_STRINGS: Record<string, string> = {
  'net.searching': 'SEARCHING FOR AN OPPONENT',
  'net.waiting_peer': 'WAITING FOR YOUR OPPONENT - ROOM {code}',
  'net.connecting': 'CONNECTING',
  'net.syncing': 'SYNCING',
  'net.direct': 'DIRECT LINE',
  'net.relay': 'DIRECT LINE FAILED - USING THE BACKUP LINE',
  'net.relay_busy': 'DIRECT CONNECTION FAILED AND THE BACKUP LINE IS BUSY - TRY ANOTHER MATCH',
  'net.version_mismatch': 'YOUR OPPONENT IS ON A DIFFERENT VERSION - REFRESH',
  'net.no_opponent': 'NO OPPONENT FOUND',
  'net.room_full': 'THAT ROOM IS FULL',
  'net.rtt_high': 'HIGH PING ({rtt} MS)',
  'net.rtt_bad': 'VERY HIGH PING ({rtt} MS) - FIND ANOTHER OPPONENT?',
  'net.select': 'PICK YOUR FIGHTER',
  'net.opponent_locked': 'OPPONENT LOCKED IN',
  'net.loading': 'LOADING THE SET',
  'net.unstable': 'CONNECTION UNSTABLE',
  'net.opponent_away': 'OPPONENT AWAY',
  'net.desync': 'RESYNCING',
  'net.disconnect_win': 'OPPONENT DISCONNECTED - YOU WIN',
  'net.forfeit_win': 'OPPONENT FORFEITED - YOU WIN',
  'net.nocontest': 'NO CONTEST',
  'net.result_mismatch': 'RESULTS DID NOT MATCH - UNRATED',
  'net.rematch_wait': 'WAITING FOR REMATCH',
  'net.opponent_left': 'YOUR OPPONENT LEFT',
  'net.error': 'NETWORK ERROR',
  'net.cheat': 'OPPONENT SENT AN INVALID PICK - NO CONTEST',
};

export interface OnlineFlowDeps {
  version: string;             // build id; must match exactly
  dataHash: number;            // hash of the gameplay data tables
  stateVersion: number;        // core/sim/layout.ts STATE_VERSION (hash of the state layout)
  fighters: string[];          // selectable ids
  stages: string[];            // stage ids
  name?: string;
  rounds?: number;             // first-to (default 2)
  timer?: number;              // seconds (default 99)
  forceRelay?: boolean;        // ?relay=1 (test only)
  client?: () => Promise<RealtimeClient>;
  log?: (m: string, d?: unknown) => void;
  /** report ratings when both signed in (default true) */
  ratings?: boolean;
  /** test only (lab ?lag=): wrap the match transport, e.g. with extra latency */
  wrapTransport?: (t: Transport) => Transport;
}

type Ev = 'status' | 'paired' | 'select' | 'opponentLocked' | 'reveal' | 'matchStart' | 'matchEnd' | 'rematch' | 'disconnect' | 'error' | 'end' | 'net';
type Cb = (...a: never[]) => void;

/** seen = I hold your HELLO; wait = I am still in my room phase and need a HELLO with seen=true from you. */
interface Hello { proto: number; build: string; dataHash: number; stateVersion: number; name: string; token: number; rated: string | null; seen: boolean; wait: boolean }
interface Reveal { fighter: string; color: number; scheme: Scheme; stage: string; seedPart: number; salt: string }

const now = (): number => performance.now();
const rand32 = (): number => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; };
const randHex = (n: number): string => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join(''); };

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}
function revealString(r: Reveal): string { return `${r.fighter}|${r.color}|${r.scheme}|${r.stage}|${r.seedPart >>> 0}|${r.salt}`; }

export class OnlineFlow {
  phase: OnlinePhase = 'idle';
  local: 0 | 1 = 0;
  session: RollbackSession | null = null;
  room = '';
  rttMs = -1;
  delay = 2;
  pathKind: 'rtc' | 'relay' | 'none' = 'none';
  matchIndex = 0;
  cfg: OnlineMatchCfg | null = null;
  peerName = '';
  pairInfo: unknown = null;
  readonly log: { t: number; m: string; d?: unknown }[] = [];

  private d: OnlineFlowDeps;
  private np: NetPlay;
  private handlers = new Map<Ev, Cb[]>();
  private token = rand32();
  /** bumped on every new quick/create/join: async steps of an older session check it and bail out */
  private gen = 0;
  private peerId = '';
  private peerHello: Hello | null = null;
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private helloTries = 0;
  private rtc: RtcTransport | null = null;
  private relay: RelayTransport | null = null;
  private slot: RelaySlot | null = null;
  private transport: Transport | null = null;
  private rtcQueue: RtcSignal[] = [];
  /** host's path decision ('path' / 'pathfail') and relay verdict ('relaygo' / 'relaybusy'), latched */
  private hostPath: 'rtc' | 'relay' | null = null;
  private guestPath: 'ok' | 'fail' | null = null;
  private finalPath: 'rtc' | 'relay' | 'busy' | null = null;
  private latchWaiters = new Set<() => boolean>();
  private pongWaiters = new Map<number, (t: number) => void>();
  private myRated: string | null = null;
  // select
  private clock = new TurnClock(30);
  private myReveal: Reveal | null = null;
  private myCommit = '';
  private peerCommit = '';
  private peerReveal: Reveal | null = null;
  /** commits / reveals can arrive before this side reaches 'select' (message vs. latch ordering): kept per matchIndex */
  private earlyCommit = new Map<number, string>();
  private earlyReveal = new Map<number, Reveal>();
  private revealSent = false;
  private lastWinner: -1 | 0 | 1 = -1;
  // loading / match
  private localReady = false;
  private peerReadyMi = -1;          // matchIndex the peer said READY for
  private goSent = false;
  private monitor: ReturnType<typeof setInterval> | null = null;
  private presenceGoneAt = -1;
  private unstableShown = false;
  private switchingRelay = false;
  private finishReq: { winner: -1 | 0 | 1; frame: number } | null = null;
  private myResult: { matchId: string; winner: number; frame: number; csFrame: number; cs: number | null } | null = null;
  private peerResult: { matchId: string; winner: number; frame: number; csFrame: number; cs: number | null } | null = null;
  private resultTimer: ReturnType<typeof setTimeout> | null = null;
  private rematchMine: boolean | null = null;
  private rematchPeerMi = -1;        // matchIndex the peer accepted a rematch after
  private rematchClock = new TurnClock(20);
  private visHandler: (() => void) | null = null;

  constructor(deps: OnlineFlowDeps) {
    this.d = deps;
    this.np = new NetPlay({ build: deps.version, name: deps.name ?? '', client: deps.client });
    this.np.on('msg', (m) => { if (m.from === this.peerId || !this.peerId) this.onMsg(m.t, m.d as Record<string, unknown>, 'sb', m.from); });
    this.np.on('peer', (p) => this.onPeer(p.present, p.ids));
    this.np.on('error', (p) => this.note('netplay error', p));
  }

  // ---- events -------------------------------------------------------------------------------------------
  on(ev: Ev, cb: Cb): this { const l = this.handlers.get(ev) ?? []; l.push(cb); this.handlers.set(ev, l); return this; }
  private emit(ev: Ev, ...a: unknown[]): void {
    for (const cb of this.handlers.get(ev) ?? []) { try { (cb as (...x: unknown[]) => void)(...a); } catch (e) { console.warn('[online]', ev, e); } }
  }
  private status(code: string, extra: Record<string, unknown> = {}): void {
    this.note('status ' + code, extra);
    this.emit('status', { phase: this.phase, code, rttMs: this.rttMs, transport: this.pathKind, ...extra });
  }
  private fail(code: string, extra: Record<string, unknown> = {}): void {
    this.note('error ' + code, extra);
    this.emit('error', { code, ...extra });
  }
  private note(m: string, d?: unknown): void {
    this.log.push({ t: Math.round(now()), m, d });
    if (this.log.length > 400) this.log.shift();
    if (this.d.log) this.d.log(m, d);
  }

  // ---- entry points -------------------------------------------------------------------------------------
  // One OnlineFlow serves many sessions (game.ts keeps a single Online): every entry point starts from a
  // clean slate, and async continuations of an older session bail out on a `gen` mismatch.
  async quick(timeoutMs = 60000): Promise<void> {
    const g = this.fresh();
    this.setPhase('searching');
    this.status('net.searching');
    this.myRated = await this.ratedId();
    if (g !== this.gen) return;
    const res = await this.np.quickMatch(timeoutMs);
    if (g !== this.gen) return;
    if (!res) { this.fail('net.no_opponent'); this.end('no-opponent'); return; }
    this.room = res.room;
    this.emit('paired', { room: res.room, host: res.host });
    this.setPhase('room');
    this.onPeer(this.np.peerCount >= 2, this.np.players());
  }

  async create(): Promise<string> {
    const code = NetPlay.makeCode();
    await this.join(code);
    return code;
  }

  async join(code: string): Promise<void> {
    const g = this.fresh();
    this.room = NetPlay.cleanCode(code);
    this.setPhase('room');
    this.status('net.waiting_peer', { code: this.room });
    this.myRated = await this.ratedId();
    if (g !== this.gen) return;
    await this.np.joinRoom(this.room);
    if (g !== this.gen) return;
    this.onPeer(this.np.peerCount >= 2, this.np.players());
  }

  /** Reset every per-session field (a previous session may have ended, or be mid-flight). Returns the new gen. */
  private fresh(): number {
    this.gen++;
    if (this.phase !== 'idle') {
      try { this.rtc?.close(); } catch { /* closed */ }
      try { this.relay?.close(); } catch { /* closed */ }
      this.slot?.release();
      this.np.cancelSearch();
      this.np.leave();
    }
    this.np.clearBinary();
    this.np.host = null;
    this.np.room = null;
    this.clock.stop();
    this.rematchClock.stop();
    if (this.helloTimer) { clearInterval(this.helloTimer); this.helloTimer = null; }
    if (this.monitor) { clearInterval(this.monitor); this.monitor = null; }
    if (this.resultTimer) { clearTimeout(this.resultTimer); this.resultTimer = null; }
    this.phase = 'idle';
    this.local = 0; this.session = null; this.room = ''; this.rttMs = -1; this.delay = 2; this.pathKind = 'none'; this.matchIndex = 0;
    this.cfg = null; this.peerName = ''; this.pairInfo = null;
    this.token = rand32(); this.peerId = ''; this.peerHello = null; this.helloTries = 0;
    this.rtc = null; this.relay = null; this.slot = null; this.transport = null; this.rtcQueue = [];
    this.hostPath = null; this.guestPath = null; this.finalPath = null; this.synced = null;
    this.latchWaiters.clear(); this.pongWaiters.clear();
    this.myReveal = null; this.myCommit = ''; this.peerCommit = ''; this.peerReveal = null; this.revealSent = false;
    this.earlyCommit.clear(); this.earlyReveal.clear(); this.lastWinner = -1;
    this.localReady = false; this.peerReadyMi = -1; this.goSent = false;
    this.presenceGoneAt = -1; this.unstableShown = false; this.switchingRelay = false;
    this.finishReq = null; this.myResult = null; this.peerResult = null; this.rematchMine = null; this.rematchPeerMi = -1;
    return this.gen;
  }

  private async ratedId(): Promise<string | null> {
    if (this.d.ratings === false) return null;
    try { const p = await Promise.race([currentPlayer(), new Promise<null>((r) => setTimeout(() => r(null), 3000))]); return p ? p.id : null; } catch { return null; }
  }

  private setPhase(p: OnlinePhase): void { this.phase = p; this.note('phase ' + p); }

  // ---- presence + HELLO ---------------------------------------------------------------------------------
  private onPeer(present: boolean, ids: string[]): void {
    const players = ids.slice().sort().slice(0, 2);
    if (this.phase === 'room' || this.phase === 'searching') {
      if (!present) return;
      if (!players.includes(this.np.id)) { this.fail('net.room_full'); this.end('room-full'); return; }
      const peer = players[0] === this.np.id ? players[1] : players[0];
      if (!peer) return;
      this.peerId = peer;
      this.local = players[0] === this.np.id ? 0 : 1;
      this.startHello();
      return;
    }
    if (this.phase === 'ended' || !this.peerId) return;
    const here = ids.includes(this.peerId);
    if (!here && this.presenceGoneAt < 0) { this.presenceGoneAt = now(); this.note('peer presence gone'); }
    if (here && this.presenceGoneAt >= 0) { this.presenceGoneAt = -1; this.note('peer presence back'); }
    if (!here && (this.phase === 'select' || this.phase === 'loading' || this.phase === 'result' || this.phase === 'syncing' || this.phase === 'connecting')) {
      // not in a bout: give the same 5 s grace, then leave
      setTimeout(() => {
        if (this.presenceGoneAt >= 0 && now() - this.presenceGoneAt >= 4900 && this.phase !== 'match' && this.phase !== 'ended') {
          this.fail('net.opponent_left');
          this.end('peer-left');
        }
      }, 5100);
    }
  }

  private hello(seen: boolean): Hello {
    return { proto: NET_PROTO, build: this.d.version, dataHash: this.d.dataHash >>> 0, stateVersion: this.d.stateVersion, name: this.d.name ?? '', token: this.token,
      rated: this.myRated, seen, wait: this.phase === 'room' || this.phase === 'searching' };
  }

  private startHello(): void {
    if (this.helloTimer) return;
    const send = (): void => {
      if (this.phase !== 'room' && this.phase !== 'searching') { if (this.helloTimer) { clearInterval(this.helloTimer); this.helloTimer = null; } return; }
      if (++this.helloTries > 12) { if (this.helloTimer) clearInterval(this.helloTimer); this.helloTimer = null; this.fail('net.error', { why: 'hello timeout' }); this.end('hello-timeout'); return; }
      this.np.send('hello', this.hello(!!this.peerHello));
    };
    send();
    this.helloTimer = setInterval(send, 1000);
  }

  private onHello(h: Hello, from: string): void {
    if (from !== this.peerId) return;
    if (h.proto !== NET_PROTO || h.build !== this.d.version || (h.dataHash >>> 0) !== (this.d.dataHash >>> 0) || h.stateVersion !== this.d.stateVersion) {
      this.note('version mismatch', { mine: this.hello(true), theirs: h });
      this.np.send('bye', { why: 'version' });
      this.fail('net.version_mismatch');
      this.end('version');
      return;
    }
    const first = !this.peerHello;
    this.peerHello = h;
    this.peerName = String(h.name ?? '').slice(0, 24);
    // Answer the first HELLO, and any HELLO whose sender is still waiting in its room phase (those come from the
    // sender's 1 s timer, <= 12 per room). Never answer an answer (wait=false): that was a ping-pong loop.
    if (first || h.wait) this.np.send('hello', this.hello(true));
    if (h.seen && this.phase === 'room') {
      if (this.helloTimer) { clearInterval(this.helloTimer); this.helloTimer = null; }
      void this.connectPath();
    }
  }

  // ---- transport: RTC (5 s) else relay ------------------------------------------------------------------
  // Host is the single authority: 'path' (its own RTC result) -> guest answers 'pathok' / 'pathfail' ->
  // host sends 'final' {kind: 'rtc' | 'relay' | 'busy'} (relay only after claiming the one relay slot).
  private async connectPath(): Promise<void> {
    this.setPhase('connecting');
    this.status('net.connecting');
    const host = this.local === 0;
    let myOk = false;
    if (!this.d.forceRelay && RtcTransport.supported()) {
      this.rtc = new RtcTransport({
        offerer: host,
        signal: (s) => { this.np.send('rtc', s); },
        onText: (s) => this.onCtlText(s),
        log: (m) => this.note('rtc ' + m),
      });
      void this.rtc.start();
      for (const q of this.rtcQueue.splice(0)) void this.rtc.handleSignal(q);
      myOk = await this.rtc.waitOpen(5000);
      this.note('rtc open=' + myOk, { signals: this.rtc.signalsSent });
    }
    let kind: 'rtc' | 'relay' | 'busy';
    if (host) {
      this.np.send('path', { kind: myOk ? 'rtc' : 'relay', tok: this.token });
      let rtcOk = myOk;
      if (myOk) rtcOk = (await this.latch(() => this.guestPath, 4500)) === 'ok';
      kind = rtcOk ? 'rtc' : 'relay';
      if (kind === 'relay') {
        this.slot = new RelaySlot(this.np, this.room);
        const r = await this.slot.acquire();
        this.note('relay slot ' + r);
        if (r !== 'ok') kind = 'busy';
      }
      this.np.send('final', { kind, tok: this.token });
    } else {
      const hp = await this.latch(() => this.hostPath, 15000);
      if (hp === 'rtc') {
        let ok = myOk;
        if (!ok && this.rtc) ok = await this.rtc.waitOpen(3000);
        this.np.send(ok ? 'pathok' : 'pathfail', { tok: this.token });
      }
      kind = (await this.latch(() => this.finalPath, 20000)) ?? 'busy';
    }
    if (kind === 'busy') { this.fail('net.relay_busy'); this.end('relay-busy'); return; }
    if (kind === 'rtc' && this.rtc) {
      this.transport = this.rtc;
      this.pathKind = 'rtc';
      this.status('net.direct');
      void this.rtc.pairInfo().then((p) => { this.pairInfo = p; this.note('pair', p); });
    } else {
      if (this.rtc) { this.rtc.close(); this.rtc = null; }
      this.relay = new RelayTransport(this.np, { token: this.token, peerToken: this.peerHello ? this.peerHello.token : 0 });
      this.transport = this.relay;
      this.pathKind = 'relay';
      this.status('net.relay');
    }
    await this.syncPhase();
  }

  /** Resolve with get() once it is non-null (re-checked on every kickLatches), or null after timeoutMs. */
  private latch<T>(get: () => T | null, timeoutMs: number): Promise<T | null> {
    return new Promise((resolve) => {
      const v0 = get();
      if (v0 !== null) { resolve(v0); return; }
      let done = false;
      const check = (): boolean => {
        if (done) return true;
        const v = get();
        if (v === null) return false;
        done = true;
        resolve(v);
        return true;
      };
      this.latchWaiters.add(check);
      setTimeout(() => { if (!done) { done = true; this.latchWaiters.delete(check); resolve(null); } }, timeoutMs);
    });
  }

  private kickLatches(): void {
    for (const cb of Array.from(this.latchWaiters)) if (cb()) this.latchWaiters.delete(cb);
  }

  // ---- sync: settle + pings -> RTT -> D -----------------------------------------------------------------
  private async syncPhase(): Promise<void> {
    this.setPhase('syncing');
    this.status('net.syncing');
    const host = this.local === 0;
    const pumping = this.pathKind === 'rtc';
    const pump = pumping ? setInterval(() => this.pumpSync(), 4) : null;
    if (host) {
      if (this.pathKind === 'rtc') await new Promise((r) => setTimeout(r, 1000));     // NETCODE 0.5: first second after open is not representative
      const n = this.pathKind === 'rtc' ? 10 : 5;
      const rtts: number[] = [];
      for (let k = 0; k < n; k++) {
        const t0 = now();
        const got = await new Promise<number>((res) => {
          this.pongWaiters.set(k, res);
          if (this.pathKind === 'rtc' && this.rtc) this.rtc.sendInput(encodeSync(PKT.SYNC_PING, k, t0));
          else this.np.send('ping', { k, tok: this.token });
          setTimeout(() => res(-1), 2000);
        });
        this.pongWaiters.delete(k);
        if (got >= 0) rtts.push(got - t0);
        if (this.pathKind !== 'rtc') await new Promise((r) => setTimeout(r, 250));
      }
      rtts.sort((a, b) => a - b);
      this.rttMs = rtts.length ? rtts[(rtts.length - 1) >> 1] : 250;
      this.delay = inputDelayFor(this.rttMs, this.pathKind === 'relay');
      this.note('sync', { rtts: rtts.map((x) => Math.round(x * 10) / 10), rtt: this.rttMs, D: this.delay });
      this.ctl('synced', { rtt: this.rttMs, D: this.delay });
      this.afterSync();
    } else {
      const ok = await this.latch(() => this.synced, 30000);
      if (!ok) { this.fail('net.error', { why: 'sync timeout' }); this.end('sync-timeout'); }
      else this.afterSync();
    }
    if (pump) setTimeout(() => clearInterval(pump), 2500);
  }
  private synced: true | null = null;

  /** Pre-session: answer / collect SYNC pings on the RTC 'in' channel. */
  private pumpSync(): void {
    if (!this.rtc || this.session) return;
    this.rtc.drain((b) => {
      const s = decodeSync(b);
      if (!s) return;
      if (s.type === PKT.SYNC_PING) this.rtc?.sendInput(encodeSync(PKT.SYNC_PONG, s.seq, s.t));
      else { const w = this.pongWaiters.get(s.seq); if (w) w(now()); }
    });
  }

  private afterSync(): void {
    if (this.phase !== 'syncing') return;
    if (this.rttMs > 300) this.status('net.rtt_bad', { rtt: Math.round(this.rttMs) });
    else if (this.rttMs > 200) this.status('net.rtt_high', { rtt: Math.round(this.rttMs) });
    this.startSelect();
  }

  // ---- blind select (commit-reveal) ---------------------------------------------------------------------
  private startSelect(): void {
    this.setPhase('select');
    this.myReveal = null; this.myCommit = ''; this.peerCommit = ''; this.peerReveal = null; this.revealSent = false;
    const ec = this.earlyCommit.get(this.matchIndex);
    const er = this.earlyReveal.get(this.matchIndex);
    this.earlyCommit.clear();
    this.earlyReveal.clear();
    this.emit('select', { seconds: 30, opponent: this.peerName, fighters: this.d.fighters.slice(), stages: this.d.stages.slice(), local: this.local,
      stagePick: this.matchIndex > 0 && this.lastWinner !== -1 && this.lastWinner !== this.local });
    this.status('net.select');
    this.clock.start(undefined, () => {
      // expiry: the UI should have called pick() with the cursor fighter; fall back to a random one
      setTimeout(() => { if (!this.myReveal && this.phase === 'select') this.pick({ fighter: this.d.fighters[rand32() % this.d.fighters.length], color: 0, scheme: 0 }); }, 1500);
    });
    if (ec) this.onCommit(ec);
    if (er) void this.onReveal(er);
  }

  /** Lock in (blind): sends SHA-256(fighter|color|scheme|stage|seedPart|salt). */
  pick(p: OnlinePick): void {
    if (this.phase !== 'select' || this.myReveal) return;
    const fighter = this.d.fighters.includes(p.fighter) ? p.fighter : this.d.fighters[0];
    const r: Reveal = { fighter, color: Math.max(0, Math.min(7, p.color | 0)), scheme: p.scheme === 1 ? 1 : 0,
      stage: p.stage && this.d.stages.includes(p.stage) ? p.stage : '', seedPart: rand32(), salt: randHex(16) };
    this.myReveal = r;
    void sha256Hex(revealString(r)).then((h) => {
      this.myCommit = h;
      this.ctl('commit', { h, mi: this.matchIndex });
      this.maybeReveal();
    });
  }

  private maybeReveal(): void {
    if (this.revealSent || !this.myCommit || !this.peerCommit || !this.myReveal) return;
    this.revealSent = true;
    this.ctl('reveal', { ...this.myReveal, mi: this.matchIndex });
    this.maybeStart();
  }

  private onCommit(h: string): void {
    if (this.peerCommit) return;
    this.peerCommit = h;
    this.emit('opponentLocked');
    this.status('net.opponent_locked');
    this.maybeReveal();
  }

  private async onReveal(r: Reveal): Promise<void> {
    if (!this.peerCommit || this.peerReveal) return;
    const h = await sha256Hex(revealString(r));
    const valid = h === this.peerCommit && this.d.fighters.includes(r.fighter) && (r.scheme === 0 || r.scheme === 1) &&
      Number.isInteger(r.color) && r.color >= 0 && r.color <= 7 && (r.stage === '' || this.d.stages.includes(r.stage));
    if (!valid) { this.note('bad reveal', r); this.ctl('bye', { why: 'cheat' }); this.fail('net.cheat'); this.end('cheat'); return; }
    this.peerReveal = r;
    this.maybeStart();
  }

  private maybeStart(): void {
    if (!this.revealSent || !this.peerReveal || !this.myReveal || this.phase !== 'select') return;
    this.clock.stop();
    const hostR = this.local === 0 ? this.myReveal : this.peerReveal;
    const guestR = this.local === 0 ? this.peerReveal : this.myReveal;
    const seed = hash32(hostR.seedPart, guestR.seedPart);
    let stage = this.d.stages[seed % this.d.stages.length];
    if (this.matchIndex > 0 && this.lastWinner !== -1) {
      const loserR = this.lastWinner === 0 ? guestR : hostR;           // the loser picks the stage (SF convention)
      if (loserR.stage) stage = loserR.stage;
    }
    const cfg: OnlineMatchCfg = {
      mode: 'online', stage, seed,
      p: [{ fighter: hostR.fighter, color: hostR.color, scheme: hostR.scheme, cpu: -1 }, { fighter: guestR.fighter, color: guestR.color, scheme: guestR.scheme, cpu: -1 }],
      rounds: this.d.rounds ?? 2, timer: this.d.timer ?? 99,
    };
    if (cfg.p[0].fighter === cfg.p[1].fighter && cfg.p[0].color === cfg.p[1].color) cfg.p[1].color = (cfg.p[1].color + 1) % 2;
    this.cfg = cfg;
    this.emit('reveal', { picks: [cfg.p[0], cfg.p[1]], stage, seed });
    this.setPhase('loading');
    this.status('net.loading');
    this.localReady = false; this.goSent = false;
    this.finishReq = null; this.myResult = null; this.peerResult = null;
    this.emit('matchStart', cfg, this.local);
  }

  // ---- session ------------------------------------------------------------------------------------------
  /** Bind the sim for the match that 'matchStart' announced. Frame 0 waits for the host's GO. */
  attachPort(sim: SimPort): RollbackSession {
    if (!this.transport || !this.cfg) throw new Error('online: attach before matchStart');
    if (this.session) this.session = null;
    const relay = this.pathKind === 'relay';
    const tr = this.d.wrapTransport ? this.d.wrapTransport(this.transport) : this.transport;
    const s = new RollbackSession(sim, this.local, tr, {
      now, delay: relay ? RELAY_DELAY : this.delay, window: relay ? RELAY_WINDOW : P2P_WINDOW, sendEvery: relay ? RELAY_SEND_EVERY : 1,
      isHost: this.local === 0, startAt: Infinity, epoch: this.matchIndex & 15, onEvent: (e) => this.onNetEvent(e),
    });
    this.session = s;
    this.localReady = true;
    this.ctl('ready', { mi: this.matchIndex });
    this.maybeGo();
    this.startMonitor();
    this.installVisibility();
    return s;
  }

  private maybeGo(): void {
    if (this.local !== 0 || this.goSent || !this.localReady || this.peerReadyMi !== this.matchIndex || !this.session) return;
    this.goSent = true;
    const inMs = 800;
    this.ctl('go', { inMs, rtt: this.rttMs, mi: this.matchIndex });
    this.session.setStartAt(now() + inMs);
    this.setPhase('match');
  }

  private onGo(inMs: number): void {
    if (!this.session || this.local === 0) return;
    const half = this.rttMs > 0 ? this.rttMs / 2 : 0;
    this.session.setStartAt(now() + Math.max(0, inMs - half));
    this.setPhase('match');
  }

  private onNetEvent(e: NetEvent): void {
    this.note('net ' + e.kind, e);
    this.emit('net', e);
    if (e.kind === 'desync') this.status('net.desync', { frame: e.frame });
    if (e.kind === 'nocontest') this.matchOver({ agreed: false, winner: -1, reason: 'nocontest' }, 'net.nocontest');
  }

  private startMonitor(): void {
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = setInterval(() => this.watch(), 250);
  }

  private watch(): void {
    const s = this.session;
    if (!s || this.phase !== 'match') return;
    const st = s.stats();
    const t = now();
    if (this.presenceGoneAt >= 0 && t - this.presenceGoneAt >= 5000) {
      this.emit('disconnect', { winner: this.local });
      this.matchOver({ agreed: false, winner: this.local, reason: 'disconnect' }, 'net.disconnect_win');
      return;
    }
    if (st.status === 'unstable' && !this.unstableShown) { this.unstableShown = true; this.status('net.unstable'); }
    if (st.status === 'running') this.unstableShown = false;
    if (st.peerAway) this.status('net.opponent_away');
    if (st.status === 'silent' && this.presenceGoneAt < 0) {
      if (this.pathKind === 'rtc' && !this.switchingRelay && this.local === 0) void this.midMatchRelay();
      if (st.silenceMs >= 20000) this.matchOver({ agreed: false, winner: -1, reason: 'nocontest' }, 'net.nocontest');
    }
    if (this.finishReq && !this.myResult && s.confirmedFrame() >= this.finishReq.frame) this.sendResult();
  }

  /** Host: P2P went silent for 5 s mid-match while presence stays -> move both to the relay tier. */
  private async midMatchRelay(): Promise<void> {
    this.switchingRelay = true;
    this.slot = new RelaySlot(this.np, this.room);
    const r = await this.slot.acquire();
    this.note('mid-match relay slot ' + r);
    if (r !== 'ok') return;                       // stays silent -> NO CONTEST at 20 s
    this.np.send('relaynow', { tok: this.token });
    this.switchToRelay();
  }

  private switchToRelay(): void {
    if (!this.session || this.pathKind === 'relay') return;
    this.relay = new RelayTransport(this.np, { token: this.token, peerToken: this.peerHello ? this.peerHello.token : 0 });
    this.transport = this.relay;
    this.pathKind = 'relay';
    this.session.setTransport(this.relay, { window: RELAY_WINDOW, sendEvery: RELAY_SEND_EVERY });
    if (this.local === 0) this.session.proposeDelay(RELAY_DELAY);
    this.status('net.relay');
  }

  private installVisibility(): void {
    if (this.visHandler || typeof document === 'undefined') return;
    this.visHandler = () => { if (this.session) this.session.setAway(document.hidden); };
    document.addEventListener('visibilitychange', this.visHandler);
  }

  /** TEST ONLY (lab ?killrtc=): close the direct DataChannels while Supabase presence stays up, to exercise the
   *  mid-match relay fallback (5 s silence -> host claims the relay slot -> both switch). */
  devKillDirect(): void {
    if (this.rtc) { this.note('dev: killing the direct path'); this.rtc.close(); }
  }

  /** Host: re-derive D between rounds (optional; D otherwise stays fixed for the match). */
  roundBreak(): void {
    const s = this.session;
    if (!s || this.local !== 0 || this.pathKind !== 'rtc') return;
    const st = s.stats();
    if (st.rttMedianMs > 0) {
      const D = inputDelayFor(st.rttMedianMs);
      if (D !== st.delay) s.proposeDelay(D);
    }
  }

  // ---- result + rematch ---------------------------------------------------------------------------------
  /** Call when the sim's MATCH_END fires (keep ticking the session until 'matchEnd'). */
  finish(r: { winner: -1 | 0 | 1; frame: number; checksum?: number }): void {
    if (this.phase !== 'match' || this.finishReq) return;
    this.finishReq = { winner: r.winner, frame: r.frame };
    this.watch();
  }

  private matchId(): string {
    const c = this.cfg;
    return (hashString(this.room + ':' + this.matchIndex + ':' + (c ? c.seed : 0)) >>> 0).toString(16).padStart(8, '0') + '-' + this.matchIndex;
  }

  private sendResult(): void {
    const s = this.session;
    if (!s || !this.finishReq) return;
    const csFrame = Math.floor(this.finishReq.frame / 15) * 15;
    this.myResult = { matchId: this.matchId(), winner: this.finishReq.winner, frame: this.finishReq.frame, csFrame, cs: s.checksumAt(csFrame) };
    this.ctl('result', { ...this.myResult });
    this.resultTimer = setTimeout(() => {
      if (this.phase === 'match') this.matchOver({ agreed: false, winner: this.finishReq ? this.finishReq.winner : -1, reason: 'noresult' }, 'net.result_mismatch');
    }, 10000);
    this.checkResults();
  }

  private checkResults(): void {
    const a = this.myResult, b = this.peerResult;
    if (!a || !b || this.phase !== 'match') return;
    const agreed = a.matchId === b.matchId && a.winner === b.winner && a.frame === b.frame && a.csFrame === b.csFrame && a.cs !== null && a.cs === b.cs;
    this.matchOver({ agreed, winner: a.winner as -1 | 0 | 1, reason: 'ko' }, agreed ? '' : 'net.result_mismatch');
    if (agreed && this.myRated && this.peerHello && this.peerHello.rated) {
      const ids = this.local === 0 ? [this.myRated, this.peerHello.rated] : [this.peerHello.rated, this.myRated];
      void reportResult(ids[0], ids[1], a.winner as -1 | 0 | 1, a.matchId).then((d) => this.note('ratings', d));
    }
  }

  private matchOver(r: { agreed: boolean; winner: -1 | 0 | 1; reason: string }, code: string): void {
    if (this.phase !== 'match' && this.phase !== 'loading') return;
    if (this.resultTimer) { clearTimeout(this.resultTimer); this.resultTimer = null; }
    this.lastWinner = r.winner;
    this.setPhase('result');
    if (code) this.status(code);
    const st = this.session ? this.session.stats() : null;
    // reset rematch state and arm the 20 s clock BEFORE emitting: a listener may call rematch() synchronously
    this.rematchMine = null;
    const canRematch = r.reason !== 'disconnect' && r.reason !== 'forfeit';
    if (canRematch) {
      this.rematchClock.start(undefined, () => { if (this.phase === 'result') { this.ctl('bye', { why: 'rematch-timeout' }); this.end('rematch-timeout'); } });
    }
    this.emit('matchEnd', { ...r, stats: st, matchId: this.matchId() });
  }

  rematch(yes: boolean): void {
    if (this.phase !== 'result') return;
    this.rematchMine = yes;
    this.ctl('rematch', { yes, mi: this.matchIndex });
    if (!yes) { this.ctl('bye', { why: 'no-rematch' }); this.end('no-rematch'); return; }
    this.status('net.rematch_wait');
    this.maybeRematch();
  }

  private maybeRematch(): void {
    if (this.rematchMine && this.rematchPeerMi === this.matchIndex && this.phase === 'result') {
      this.rematchClock.stop();
      this.matchIndex++;
      this.session = null;
      this.startSelect();
    }
  }

  // ---- control messages ---------------------------------------------------------------------------------
  /** Flow control message: DataChannel ctl (text) when direct, else the room channel (budgeted). */
  private ctl(t: string, d: Record<string, unknown>): void {
    const msg = { ...d, tok: this.token };
    if (this.pathKind === 'rtc' && this.rtc && this.rtc.isOpen() && this.rtc.sendText(JSON.stringify({ t, d: msg }))) return;
    this.np.send(t, msg);
  }

  private onCtlText(s: string): void {
    let m: { t?: string; d?: Record<string, unknown> };
    try { m = JSON.parse(s); } catch { return; }
    if (typeof m.t === 'string' && m.d && typeof m.d === 'object') this.onMsg(m.t, m.d, 'rtc', this.peerId);
  }

  private onMsg(t: string, d: Record<string, unknown>, via: 'sb' | 'rtc', from: string): void {
    if (!d || typeof d !== 'object') return;
    if (t === 'hello') { this.onHello(d as unknown as Hello, from); return; }
    if (!this.peerHello || from !== this.peerId) return;
    if (t === 'rtc') { if (this.rtc) void this.rtc.handleSignal(d as unknown as RtcSignal); else this.rtcQueue.push(d as unknown as RtcSignal); return; }
    if ((d.tok as number) !== this.peerHello.token) { this.note('bad token on ' + t); return; }
    switch (t) {
      case 'path': this.hostPath = d.kind === 'rtc' ? 'rtc' : 'relay'; this.kickLatches(); break;
      case 'pathok': this.guestPath = 'ok'; this.kickLatches(); break;
      case 'pathfail': this.guestPath = 'fail'; this.kickLatches(); break;
      case 'final': this.finalPath = d.kind === 'rtc' ? 'rtc' : d.kind === 'relay' ? 'relay' : 'busy'; this.kickLatches(); break;
      case 'relaynow': if (this.local === 1) this.switchToRelay(); break;
      case 'ping': this.np.send('pong', { k: d.k, tok: this.token }); break;
      case 'pong': { const w = this.pongWaiters.get(d.k as number); if (w) w(now()); break; }
      case 'synced':
        this.rttMs = Number(d.rtt) || this.rttMs;
        this.delay = Number(d.D) || this.delay;
        this.synced = true;
        this.kickLatches();
        break;
      case 'commit': {
        const mi = Number(d.mi) | 0;
        if (typeof d.h !== 'string') break;
        if (this.phase === 'select' && mi === this.matchIndex) this.onCommit(d.h);
        else if (mi >= this.matchIndex) this.earlyCommit.set(mi, d.h);
        break;
      }
      case 'reveal': {
        const mi = Number(d.mi) | 0;
        const r: Reveal = { fighter: String(d.fighter), color: Number(d.color), scheme: Number(d.scheme) === 1 ? 1 : 0, stage: String(d.stage ?? ''),
          seedPart: Number(d.seedPart) >>> 0, salt: String(d.salt) };
        if (this.phase === 'select' && mi === this.matchIndex) void this.onReveal(r);
        else if (mi >= this.matchIndex) this.earlyReveal.set(mi, r);
        break;
      }
      case 'ready': this.peerReadyMi = Number(d.mi) | 0; this.maybeGo(); break;
      case 'go': if ((Number(d.mi) | 0) === this.matchIndex) this.onGo(Number(d.inMs) || 800); break;
      case 'result':
        this.peerResult = { matchId: String(d.matchId), winner: Number(d.winner), frame: Number(d.frame), csFrame: Number(d.csFrame), cs: d.cs == null ? null : Number(d.cs) };
        this.checkResults();
        break;
      case 'rematch':
        if (d.yes) this.rematchPeerMi = Number(d.mi) | 0;
        this.emit('rematch', { peerWants: !!d.yes });
        this.maybeRematch();
        break;
      case 'bye':
        if (this.phase === 'match' || this.phase === 'loading') {
          this.emit('disconnect', { winner: this.local });
          this.matchOver({ agreed: false, winner: this.local, reason: 'forfeit' }, 'net.forfeit_win');
        } else if (this.phase !== 'ended') {
          this.fail('net.opponent_left');
          this.end('peer-bye');
        }
        break;
      default: break;
    }
    void via;
  }

  // ---- teardown -----------------------------------------------------------------------------------------
  leave(): void {
    if (this.phase === 'ended') return;
    if (this.peerHello) this.ctl('bye', { why: 'leave' });
    this.end('leave');
  }

  private end(reason: string): void {
    if (this.phase === 'ended') return;
    this.setPhase('ended');
    this.clock.stop();
    this.rematchClock.stop();
    if (this.helloTimer) { clearInterval(this.helloTimer); this.helloTimer = null; }
    if (this.monitor) { clearInterval(this.monitor); this.monitor = null; }
    if (this.resultTimer) { clearTimeout(this.resultTimer); this.resultTimer = null; }
    if (this.visHandler && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visHandler);
    this.visHandler = null;
    const rtc = this.rtc, relay = this.relay, slot = this.slot, np = this.np, g = this.gen;
    // let a final BYE / RESULT flush before tearing the sockets down (never the channels of a NEWER session)
    setTimeout(() => {
      try { rtc?.close(); } catch { /* */ }
      try { relay?.close(); } catch { /* */ }
      slot?.release();
      if (g === this.gen) { np.cancelSearch(); np.leave(); }
    }, 400);
    this.emit('end', { reason });
  }

  stats(): { phase: OnlinePhase; room: string; local: number; transport: string; rttMs: number; delay: number; peer: string; pair: unknown;
    supabase: { msgs: number; binary: number; dropped: number }; session: NetStats | null } {
    return { phase: this.phase, room: this.room, local: this.local, transport: this.pathKind, rttMs: this.rttMs, delay: this.delay, peer: this.peerName,
      pair: this.pairInfo, supabase: { msgs: this.np.sentMsgs, binary: this.np.sentBinary, dropped: this.np.dropped }, session: this.session ? this.session.stats() : null };
  }
}
