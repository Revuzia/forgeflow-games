// BLOCKTOOTH - net/lockstep.ts (lane B-NET). Host-clocked deterministic lockstep (netcode.md 5 option C, 7.1).
//
// Every peer runs the full sim through a SimPort. The AUTHORITY (the lowest live human peer id; slot 0 at START) is
// the clock and the input authority: each tick it publishes one confirmed frame holding all 4 seats' input words.
//   * a guest stamps its input for tick `authEst + lead` and sends its last 6 stamped inputs at 30 Hz (loss cover);
//   * a guest input that has not arrived when the authority produces its tick is LATE: the seat's previous input is
//     repeated and becomes canonical (lateMask bit), so a lagging guest never stalls anyone;
//   * a guest silent for AFK_MS is AFK: botMask bit, the bot brain drives the seat on every peer until it speaks again;
//   * empty / left / desynced / still-joining seats are bot seats (botMask) - bots cost no bandwidth;
//   * every HASH_EVERY ticks each peer sends (world hash, frame-log hash) to every peer; a peer outside the majority
//     drops out ("connection problem") and its seat becomes a bot (v1: no resync);
//   * authority silent for HOST_TIMEOUT_MS -> the next-lowest live id takes the clock: MIGRATE -> every survivor
//     answers HAVE (+ the confirmed frames the new authority lacks) -> RESUME. State is already local on every peer;
//   * replay join: a newcomer asks the authority for a bot seat while tick < JOIN_CUTOFF_TICK, downloads the frame log,
//     fast-forwards from tick 0, says READY, and the seat flips from bot to human at a switch tick carried by the
//     canonical frames (botMask) - deterministic on every peer.
//
// Transport-, clock- and sim-agnostic: the owner calls `receive()` for every packet, `pump(now)` from a 30 Hz clock
// (clock.ts Worker in a browser, a virtual clock in _harness/net/probe_net4.ts), and `setLocalInput()` from the input
// layer. No DOM, no THREE, no timers inside.

import {
  AFK_MS, FNV_SEED, FRAME_BATCH, HASH_EVERY, HOST_TIMEOUT_MS, INPUT_BYTES, INPUT_REDUNDANCY, JOIN_CUTOFF_TICK, LEAD_MAX,
  LEAD_MIN, LEAD_START, LEFT_MS, LOG_CHUNK, MAX_CATCHUP, MIGRATE_WAIT_MS, PK, SEATS, TICK_MS,
  type Frame, type StartInfo,
  decodeCtl, decodeFramePkt, decodeHashPkt, decodeInputPkt, decodeLogPkt, encodeCtl, encodeFramePkt, encodeHashPkt,
  encodeInputPkt, encodeLogPkt, foldFrame, lowestId,
} from './proto.ts';
import type { SimPort, Standings } from './simport.ts';

/** The per-peer send side of a transport (rtcmesh.ts in a browser, the SimNet in the probe). */
export interface Mesh {
  send(to: string, b: Uint8Array, reliable: boolean): void;
}

export type NetEvent =
  | { type: 'authority'; id: string; epoch: number; tick: number }
  | { type: 'migrated'; epoch: number; tick: number; pauseMs: number; merged: number }
  | { type: 'desync'; tick: number; self: boolean; peers: string[] }
  | { type: 'late'; tick: number; count: number }
  | { type: 'afk'; seat: number; on: boolean; tick: number }
  | { type: 'roster'; seats: SeatView[] }
  | { type: 'joined'; seat: number; switchTick: number; replayed: number; replayMs: number }
  | { type: 'joinRejected'; why: string }
  | { type: 'left'; peer: string; why: string }
  | { type: 'result'; standings: Standings }
  /** the world was rebuilt from tick 0 (a stepped-down authority whose last frames were overwritten); views rebind */
  | { type: 'rebuilt'; fromTick: number };

export interface SeatView { slot: number; peer: string | null; left: boolean; joining: boolean; switchTick: number }

export interface LockstepOpts<W> {
  self: string;
  start: StartInfo;
  sim: SimPort<W>;
  mesh: Mesh;
  now: number;
  /** replay join: take bot seat `seat`; `authority` / `epoch` come from the room layer */
  joiner?: { seat: number; authority: string; epoch?: number };
  /** cap on sim steps per pump (a browser keeps frames responsive; the probe passes Infinity) */
  maxStepsPerPump?: number;
  /** wall-time budget for stepping inside one pump (ms); a joiner's replay or a catch-up never freezes the page */
  stepBudgetMs?: number;
  /** authority self-delays its own input by the median guest lead (fairness, netcode.md 7.1); default true */
  fairDelay?: boolean;
  onEvent?: (e: NetEvent) => void;
  log?: (m: string) => void;
}

interface SeatRt { slot: number; peer: string | null; left: boolean; joining: boolean; switchTick: number }

interface GuestRt {
  peer: string;
  seat: number;
  ack: number;                 // highest contiguous confirmed tick the guest reported
  lastRecvAt: number;
  inputs: Map<number, Uint8Array>;
  newest: number;              // newest stamp received
  lead: number;
  afk: boolean;
  lastResendAt: number;
  lastSendAt: number;
  ping: number; pingAt: number;
}

export interface LockstepStats {
  produced: number;            // frames produced while authority
  lateRepeats: number;         // late-input repeats produced (authority)
  lateSeen: number;            // frames that repeated MY input (guest)
  afkOn: number;
  resends: number;
  framePkts: number; inputPkts: number; hashPkts: number; ctlPkts: number; logPkts: number;
  bytesOut: number; bytesIn: number;
  checkpoints: number;         // checkpoints evaluated with >= 2 peers
  mismatches: number;
  maxAdvanceGapMs: number;     // longest wall gap between two confirmed-tick advances (guest smoothness)
  rttMs: number;
  migrations: number;
  stepMsTotal: number; steps: number;
}

const ZERO4 = new Uint8Array(INPUT_BYTES);

function sameFrame(a: Frame, b: Frame): boolean {
  if (a.tick !== b.tick || a.lateMask !== b.lateMask || a.botMask !== b.botMask || a.inputs.length !== b.inputs.length) return false;
  for (let i = 0; i < a.inputs.length; i++) if (a.inputs[i] !== b.inputs[i]) return false;
  return true;
}

export class LockstepPeer<W> {
  readonly self: string;
  readonly start: StartInfo;
  readonly sim: SimPort<W>;
  /** the live world; replaced (never mutated across) when a stepped-down authority rebuilds - see 'rebuilt' */
  world: W;
  private mesh: Mesh;
  private emitFn: (e: NetEvent) => void;
  private logFn: (m: string) => void;
  private maxSteps: number;
  private stepBudget: number;
  private fairDelay: boolean;

  seats: SeatRt[] = [];
  epoch = 0;
  authority: string | null = null;
  state: 'play' | 'migrating' | 'joining' | 'desynced' | 'done' | 'left' = 'play';
  /** confirmed frame log: frames[i].tick === i + 1 */
  readonly frames: Frame[] = [];
  private pending = new Map<number, Frame>();
  private logHash = FNV_SEED;
  private logHashAt = new Map<number, number>();
  /** every checkpoint this peer simulated: tick -> [world hash, log hash] (probe + diagnostics) */
  readonly hashLog = new Map<number, [number, number]>();
  private peerHashes = new Map<number, Map<string, string>>();
  results = new Map<string, Standings>();
  standings: Standings | null = null;
  finished = false;
  readonly stats: LockstepStats = {
    produced: 0, lateRepeats: 0, lateSeen: 0, afkOn: 0, resends: 0, framePkts: 0, inputPkts: 0, hashPkts: 0, ctlPkts: 0,
    logPkts: 0, bytesOut: 0, bytesIn: 0, checkpoints: 0, mismatches: 0, maxAdvanceGapMs: 0, rttMs: -1, migrations: 0,
    stepMsTotal: 0, steps: 0,
  };

  // local input + stamping
  private localIn = new Uint8Array(INPUT_BYTES);
  private localT0: number;
  private localTicks = 0;
  private stamped: { stamp: number; b: Uint8Array }[] = [];
  private nextStamp = 0;
  lead = LEAD_START;
  private leadUpAt = -1e9;
  private slackWinMin = 1e9;
  private slackWinStart = 0;
  private lateInWin = false;
  private rttKnown = false;

  // guest view of the authority
  private lastAuthAt: number;                 // watchdog base (reset on elections, shifted by my own stalls)
  private heardAuthAt: number;                // the last packet really heard from the authority
  private prevAuthority: string | null = null; // the authority before an election that is not settled yet
  private prevEpoch = 0;
  private awaitingCand = false;
  private lastPumpAt = -1;
  private stalledAt = -1e9;                   // when this peer last came back from a long stall
  private holdUntil = -1;                     // authority: listen (no production) after a long stall
  private lastAuthTick = 0;
  private lastAdvanceAt: number;
  private lateEvAt = -1e9;
  private lateEvCount = 0;

  // authority state
  private guests = new Map<string, GuestRt>();
  private ownInputs = new Map<number, Uint8Array>();
  private lastIn: Uint8Array[] = [];
  private authBase = 0;
  private authT0 = 0;
  private migrateWait: Set<string> | null = null;
  private migrateAt = 0;
  private migrateLastFrameAt = 0;
  private migrateMerged = 0;
  private lastPeerPkt = new Map<string, number>();

  // joiner state
  private rejoining = false;
  private joinSeat = -1;
  private joinStartedAt = 0;
  private joinUpto = -1;
  private readySent = false;
  private switchTick = -1;

  constructor(o: LockstepOpts<W>) {
    this.self = o.self;
    this.start = o.start;
    this.sim = o.sim;
    this.mesh = o.mesh;
    this.emitFn = o.onEvent ?? (() => { /* none */ });
    this.logFn = o.log ?? (() => { /* quiet */ });
    this.maxSteps = o.maxStepsPerPump ?? 30;
    this.stepBudget = o.stepBudgetMs ?? Infinity;
    this.fairDelay = o.fairDelay ?? true;
    this.lead = Math.max(LEAD_MIN, Math.min(LEAD_MAX, o.start.lead || LEAD_START));
    this.world = o.sim.create(o.start);
    for (let s = 0; s < SEATS; s++) {
      const si = o.start.seats[s];
      this.seats.push({ slot: s, peer: si && si.kind === 'human' ? si.peer : null, left: false, joining: false, switchTick: 0 });
      this.lastIn.push(ZERO4);
    }
    this.localT0 = o.now;
    this.lastAuthAt = o.now;
    this.heardAuthAt = o.now;
    this.lastAdvanceAt = o.now;
    this.slackWinStart = o.now;
    if (o.joiner) {
      this.state = 'joining';
      this.joinSeat = o.joiner.seat;
      this.authority = o.joiner.authority;
      this.epoch = o.joiner.epoch ?? 0;
      this.joinStartedAt = o.now;
      this.send(this.authority, encodeCtl({ t: 'join', seat: o.joiner.seat }), true);
    } else {
      this.authority = lowestId(this.liveHumans());
      if (this.authority === this.self) {
        this.authBase = 0; this.authT0 = o.now;
        for (const s of this.seats) if (s.peer && s.peer !== this.self) this.guestRt(s.peer, s.slot, o.now);
      }
    }
  }

  // ─────────────────────────────── public ───────────────────────────────

  get confirmed(): number { return this.frames.length; }
  get simTick(): number { return this.sim.tick(this.world); }
  get isAuthority(): boolean { return this.authority === this.self && this.state !== 'joining'; }
  mySeat(): number { for (const s of this.seats) if (s.peer === this.self && !s.left) return s.slot; return -1; }
  roster(): SeatView[] { return this.seats.map((s) => ({ ...s })); }

  /** the input layer's latest sample (encoded word); stamped on the next local tick */
  setLocalInput(b: Uint8Array): void { this.localIn.set(b.subarray(0, INPUT_BYTES)); }

  /** leave the match on purpose (tab closed, quit): seat -> bot for everyone */
  leave(now: number): void {
    if (this.state === 'left') return;
    for (const p of this.otherHumans()) this.send(p, encodeCtl({ t: 'leave' }), true);
    this.state = 'left';
    void now;
  }

  /** the transport reports a peer's link closed */
  peerGone(id: string, now: number): void {
    if (id === this.authority && !this.isAuthority) this.authorityLost(now, 'link');
    else this.markLeft(id, 'link', now);
  }

  receive(from: string, b: Uint8Array, now: number): void {
    if (this.state === 'left' || this.state === 'desynced' || b.length === 0) return;
    this.stats.bytesIn += b.length;
    this.lastPeerPkt.set(from, now);
    switch (b[0]) {
      case PK.INPUT: this.onInput(from, b, now); break;
      case PK.FRAME: this.onFrame(from, b, now); break;
      case PK.HASH: this.onHash(from, b); break;
      case PK.LOG: this.onLog(b, now); break;
      case PK.CTL: this.onCtl(from, b, now); break;
      default: break;
    }
  }

  /** drive from a ~30 Hz (or faster) clock */
  pump(now: number): void {
    if (this.state === 'left' || this.state === 'desynced') return;
    // A long gap between pumps is THIS peer stalling (GC, busy page, throttled tab), not the network: it must not count
    // toward the authority watchdog, AFK or migration timers, and packets queued during the stall may be delivered
    // after this pump (event order across task sources is not guaranteed).
    if (this.lastPumpAt >= 0) {
      const gap = now - this.lastPumpAt;
      if (gap > 250) {
        const shift = gap - TICK_MS;
        this.lastAuthAt = Math.min(now, this.lastAuthAt + shift);
        for (const g of this.guests.values()) g.lastRecvAt = Math.min(now, g.lastRecvAt + shift);
        if (this.migrateWait) this.migrateAt = Math.min(now, this.migrateAt + shift);
        if (gap > HOST_TIMEOUT_MS / 2) {
          this.stalledAt = now;
          // authority back from a long stall: listen ~300 ms first (a MIGRATE may be queued), and never burst-produce
          // the stalled time (the clock is re-based when production resumes)
          if (this.isAuthority && this.state === 'play') this.holdUntil = now + 300;
        }
      }
    }
    this.lastPumpAt = now;
    this.stepPending(now);
    if (this.state === 'migrating') this.checkMigration(now);
    if (this.isAuthority) {
      if (this.state === 'play') this.authorityTick(now);
      else if (this.state === 'done') this.sendFrames(now);       // keep feeding guests that still lack the last frames
    } else if (this.state === 'play' || this.state === 'done') this.guestTick(now);
    else if (this.state === 'joining') this.joinerTick(now);
  }

  /** every human's RESULT seen so far agrees with mine */
  resultsAgree(): boolean {
    if (!this.standings) return false;
    for (const r of this.results.values()) if (r.hash !== this.standings.hash) return false;
    return true;
  }

  // ─────────────────────────────── roster helpers ───────────────────────────────

  private liveHumans(): string[] {
    const out: string[] = [];
    for (const s of this.seats) if (s.peer && !s.left) out.push(s.peer);
    return out;
  }
  private otherHumans(): string[] { return this.liveHumans().filter((p) => p !== this.self); }
  private seatOf(peer: string): SeatRt | null { for (const s of this.seats) if (s.peer === peer) return s; return null; }

  private send(to: string, b: Uint8Array, reliable: boolean): void {
    if (to === this.self) return;
    this.stats.bytesOut += b.length;
    switch (b[0]) {
      case PK.INPUT: this.stats.inputPkts++; break;
      case PK.FRAME: this.stats.framePkts++; break;
      case PK.HASH: this.stats.hashPkts++; break;
      case PK.LOG: this.stats.logPkts++; break;
      default: this.stats.ctlPkts++; break;
    }
    this.mesh.send(to, b, reliable);
  }

  private broadcastRoster(): void {
    const seats = this.roster();
    for (const p of this.otherHumans()) this.send(p, encodeCtl({ t: 'roster', epoch: this.epoch, seats }), true);
    // a joiner that is not in the roster yet still needs it
    this.emitFn({ type: 'roster', seats });
  }

  private markLeft(peer: string, why: string, now: number): void {
    const s = this.seatOf(peer);
    if (!s || s.left) return;
    s.left = true;
    this.guests.delete(peer);
    this.emitFn({ type: 'left', peer, why });
    this.logFn(`${this.self}: ${peer} left (${why})`);
    if (this.isAuthority) this.broadcastRoster();
    void now;
  }

  // ─────────────────────────────── frame log ───────────────────────────────

  private append(f: Frame, now: number): void {
    this.frames.push(f);
    this.logHash = foldFrame(this.logHash, f);
    if (f.tick % HASH_EVERY === 0) this.logHashAt.set(f.tick, this.logHash);
    const gap = now - this.lastAdvanceAt;
    if (gap > this.stats.maxAdvanceGapMs && this.frames.length > 30 && !this.isAuthority && this.state === 'play') this.stats.maxAdvanceGapMs = gap;
    this.lastAdvanceAt = now;
    const mine = this.mySeat();
    if (mine >= 0 && !this.isAuthority && ((f.lateMask >> mine) & 1) && !((f.botMask >> mine) & 1)) {
      this.stats.lateSeen++;
      this.lateInWin = true;
      this.lateEvCount++;
      if (now - this.lateEvAt > 1000) { this.emitFn({ type: 'late', tick: f.tick, count: this.lateEvCount }); this.lateEvAt = now; this.lateEvCount = 0; }
      if (now - this.leadUpAt > 400 && this.state === 'play') { this.lead = Math.min(LEAD_MAX, this.lead + 1); this.leadUpAt = now; }
    }
  }

  /** accept frames that extend the contiguous log; stash the rest */
  private accept(list: readonly Frame[], now: number): number {
    let added = 0;
    for (const f of list) {
      if (f.tick <= this.frames.length) continue;
      if (f.tick === this.frames.length + 1) { this.append(f, now); added++; }
      else if (!this.pending.has(f.tick)) this.pending.set(f.tick, f);
    }
    for (;;) {
      const nx = this.pending.get(this.frames.length + 1);
      if (!nx) break;
      this.pending.delete(nx.tick);
      this.append(nx, now); added++;
    }
    if (this.pending.size > 0) for (const t of this.pending.keys()) if (t <= this.frames.length) this.pending.delete(t);
    return added;
  }

  /** drop frames >= tick (they were never canonical) and rebuild the world from tick 0 out of the kept log */
  private rewind(tick: number, now: number): void {
    this.logFn(`${this.self}: frames from ${tick} were overwritten by the new authority -> rebuilding the world from tick 0`);
    this.frames.length = tick - 1;
    this.pending.clear();
    this.logHash = FNV_SEED;
    this.logHashAt.clear();
    for (const f of this.frames) { this.logHash = foldFrame(this.logHash, f); if (f.tick % HASH_EVERY === 0) this.logHashAt.set(f.tick, this.logHash); }
    for (const k of [...this.hashLog.keys()]) if (k >= tick) this.hashLog.delete(k);
    this.world = this.sim.create(this.start);
    this.finished = false;
    this.emitFn({ type: 'rebuilt', fromTick: tick });
    void now;
  }

  private stepPending(now: number): void {
    let n = 0;
    const t0 = this.stepBudget < Infinity && typeof performance !== 'undefined' ? performance.now() : 0;
    while (!this.finished && this.simTick < this.frames.length && n < this.maxSteps) {
      this.stepOne(now);
      n++;
      if (t0 && performance.now() - t0 > this.stepBudget) break;
    }
  }

  private stepOne(now: number): void {
    const t = this.simTick;
    const f = this.frames[t];
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.sim.step(this.world, f);
    if (typeof performance !== 'undefined') { this.stats.stepMsTotal += performance.now() - t0; this.stats.steps++; }
    const tick = f.tick;
    if (tick % HASH_EVERY === 0) {
      const wh = this.sim.hash(this.world);
      const lh = this.logHashAt.get(tick) ?? 0;
      this.hashLog.set(tick, [wh, lh]);
      const caughtUp = this.state !== 'joining' || this.frames.length - tick < 2 * HASH_EVERY;
      if (caughtUp) {
        const pkt = encodeHashPkt({ seat: Math.max(0, this.mySeat()), tick, world: wh, log: lh });
        for (const p of this.otherHumans()) this.send(p, pkt, false);
        this.recordHash(tick, this.self, `${wh}:${lh}`);
      }
    }
    if (this.sim.ended(this.world) || tick >= this.start.endTick) this.finish(now);
  }

  private finish(now: number): void {
    if (this.finished) return;
    this.finished = true;
    const last = this.frames[this.simTick - 1] ?? null;
    this.standings = this.sim.standings(this.world, last);
    if (this.state === 'play' || this.state === 'migrating') this.state = 'done';
    for (const p of this.otherHumans()) this.send(p, encodeCtl({ t: 'result', standings: this.standings }), true);
    this.emitFn({ type: 'result', standings: this.standings });
    void now;
  }

  // ─────────────────────────────── hashes ───────────────────────────────

  private onHash(from: string, b: Uint8Array): void {
    const p = decodeHashPkt(b);
    if (!p) return;
    this.recordHash(p.tick, from, `${p.world}:${p.log}`);
  }

  private recordHash(tick: number, peer: string, v: string): void {
    let m = this.peerHashes.get(tick);
    if (!m) { m = new Map(); this.peerHashes.set(tick, m); }
    m.set(peer, v);
    this.evaluate(tick, false);
    // stale checkpoints (a peer far behind or gone): judge with what is there
    for (const k of [...this.peerHashes.keys()]) if (k < this.simTick - 3 * HASH_EVERY) this.evaluate(k, true);
  }

  private expectedAt(tick: number): string[] {
    const out: string[] = [];
    for (const s of this.seats) if (s.peer && !s.left && (!s.joining || (s.switchTick > 0 && s.switchTick <= tick))) out.push(s.peer);
    return out;
  }

  private evaluate(tick: number, stale: boolean): void {
    const m = this.peerHashes.get(tick);
    if (!m) return;
    if (!m.has(this.self)) { if (stale && tick < this.simTick - 6 * HASH_EVERY) this.peerHashes.delete(tick); return; }
    const exp = this.expectedAt(tick);
    const have = exp.filter((p) => m.has(p));
    if (!stale && have.length < exp.length) return;
    this.peerHashes.delete(tick);
    if (have.length < 2) return;
    this.stats.checkpoints++;
    const groups = new Map<string, string[]>();
    for (const p of have) { const v = m.get(p) as string; const g = groups.get(v) ?? []; g.push(p); groups.set(v, g); }
    if (groups.size === 1) return;
    this.stats.mismatches++;
    // majority; ties -> the group holding the authority; then the group holding the lowest id
    const ranked = [...groups.values()].sort((a, b) => b.length - a.length
      || (Number(b.includes(this.authority ?? '')) - Number(a.includes(this.authority ?? '')))
      || ((lowestId(a) ?? '') < (lowestId(b) ?? '') ? -1 : 1));
    const win = new Set(ranked[0]);
    const losers = have.filter((p) => !win.has(p));
    if (!win.has(this.self)) {
      this.logFn(`${this.self}: DESYNC at tick ${tick} (minority) -> dropping out`);
      this.emitFn({ type: 'desync', tick, self: true, peers: losers });
      for (const p of this.otherHumans()) this.send(p, encodeCtl({ t: 'leave', why: 'desync' }), true);
      this.state = 'desynced';
      return;
    }
    this.emitFn({ type: 'desync', tick, self: false, peers: losers });
    if (this.isAuthority) for (const p of losers) { this.send(p, encodeCtl({ t: 'desync', tick }), true); this.markLeft(p, 'desync', 0); }
  }

  // ─────────────────────────────── local input stamping ───────────────────────────────

  private localTicksDue(now: number): number {
    const due = Math.floor((now - this.localT0) / TICK_MS) - this.localTicks;
    if (due > 5) { this.localTicks += due - 1; return 1; }   // a stalled tab samples once, not a burst
    return Math.max(0, due);
  }

  private guestTick(now: number): void {
    const mine = this.mySeat();
    // the authority went quiet -> elect
    if (!this.finished && now - this.lastAuthAt > HOST_TIMEOUT_MS) { this.authorityLost(now, 'timeout'); return; }
    if (mine < 0) return;
    const due = this.localTicksDue(now);
    for (let k = 0; k < due; k++) {
      this.localTicks++;
      const authEst = this.lastAuthTick + Math.min((now - this.lastAuthAt) / TICK_MS, 10);
      const desired = Math.floor(authEst) + this.lead;
      const s = this.seats[mine];
      const floor = s.joining ? s.switchTick : 1;
      if (this.nextStamp === 0) this.nextStamp = Math.max(desired, floor);
      if (this.nextStamp > desired + 2) continue;                       // ahead (lead fell / clock drift): skip a sample
      if (this.nextStamp < desired - 2) this.nextStamp = desired;       // behind: jump (the gap is repeated canonically)
      if (this.nextStamp < floor) this.nextStamp = floor;
      this.stamped.push({ stamp: this.nextStamp, b: this.localIn.slice() });
      this.nextStamp++;
      if (this.stamped.length > 32) this.stamped.splice(0, this.stamped.length - 32);
    }
    if (due > 0) this.sendInputs(now, mine);
    this.adaptLead(now);
  }

  private sendInputs(now: number, seat: number): void {
    if (!this.authority) return;
    // trailing contiguous run of <= INPUT_REDUNDANCY stamped inputs
    let i = this.stamped.length - 1;
    const run: { stamp: number; b: Uint8Array }[] = [];
    while (i >= 0 && run.length < INPUT_REDUNDANCY) {
      const it = this.stamped[i];
      if (run.length && it.stamp !== run[0].stamp - 1) break;
      if (it.stamp <= this.confirmed) break;
      run.unshift(it); i--;
    }
    const buf = new Uint8Array(run.length * INPUT_BYTES);
    run.forEach((it, j) => buf.set(it.b, j * INPUT_BYTES));
    this.send(this.authority, encodeInputPkt({ epoch: this.epoch, seat, lead: this.lead, ping: Math.floor(now) & 0xffff,
      ack: this.confirmed, first: run.length ? run[0].stamp : 0, inputs: buf }), false);
  }

  private adaptLead(now: number): void {
    if (now - this.slackWinStart < 4000) return;
    if (!this.lateInWin && this.slackWinMin !== 1e9 && this.slackWinMin >= 3) this.lead = Math.max(LEAD_MIN, this.lead - 1);
    this.slackWinStart = now; this.slackWinMin = 1e9; this.lateInWin = false;
  }

  // ─────────────────────────────── guest receive ───────────────────────────────

  private onFrame(from: string, b: Uint8Array, now: number): void {
    const p = decodeFramePkt(b);
    if (!p) return;
    if (from !== this.authority) {
      // the authority I gave up on is alive after all (my election is not settled): go back to it
      if (from === this.prevAuthority && p.epoch === (this.prevEpoch & 0xff) && (this.awaitingCand || this.state === 'migrating')) this.revertElection(now, 'old authority alive');
      else return;
    }
    if (p.epoch !== (this.epoch & 0xff)) return;
    this.lastAuthAt = now;
    this.heardAuthAt = now;
    if (p.authTick >= this.lastAuthTick) this.lastAuthTick = p.authTick;
    const mine = this.mySeat();
    if (mine >= 0) {
      this.slackWinMin = Math.min(this.slackWinMin, p.slack[mine]);
      if (p.echo || p.hold) {
        const rtt = ((Math.floor(now) - p.echo) & 0xffff) - p.hold;
        if (rtt >= 0 && rtt < 5000) {
          this.stats.rttMs = this.stats.rttMs < 0 ? rtt : this.stats.rttMs * 0.9 + rtt * 0.1;
          if (!this.rttKnown) { this.rttKnown = true; this.lead = Math.max(LEAD_MIN, Math.min(LEAD_MAX, Math.ceil(rtt / TICK_MS) + 1)); }
        }
      }
    }
    this.accept(p.frames, now);
  }

  private onLog(b: Uint8Array, now: number): void {
    const p = decodeLogPkt(b);
    if (!p) return;
    if (this.rejoining) {
      for (const f of p.frames) {
        if (f.tick > this.frames.length) break;
        if (!sameFrame(this.frames[f.tick - 1], f)) { this.rewind(f.tick, now); break; }
      }
    }
    this.accept(p.frames, now);
    if (this.state === 'migrating' && this.isAuthority) this.migrateMerged = Math.max(this.migrateMerged, this.frames.length);
  }

  // ─────────────────────────────── authority ───────────────────────────────

  private guestRt(peer: string, seat: number, now: number): GuestRt {
    let g = this.guests.get(peer);
    if (!g) {
      g = { peer, seat, ack: 0, lastRecvAt: now, inputs: new Map(), newest: 0, lead: LEAD_START, afk: false, lastResendAt: -1e9,
        lastSendAt: -1e9, ping: 0, pingAt: -1 };
      this.guests.set(peer, g);
    }
    return g;
  }

  private onInput(from: string, b: Uint8Array, now: number): void {
    if (!this.isAuthority) return;
    const p = decodeInputPkt(b);
    if (!p) return;
    const s = this.seatOf(from);
    if (!s || s.left || s.slot !== p.seat) return;
    const g = this.guestRt(from, s.slot, now);
    g.lastRecvAt = now;
    g.lead = p.lead;
    g.ping = p.ping; g.pingAt = now;
    if (p.ack > g.ack) g.ack = Math.min(p.ack, this.frames.length);
    const n = p.inputs.length / INPUT_BYTES;
    for (let i = 0; i < n; i++) {
      const st = p.first + i;
      if (st <= this.frames.length || g.inputs.has(st)) continue;
      g.inputs.set(st, p.inputs.slice(i * INPUT_BYTES, (i + 1) * INPUT_BYTES));
      if (st > g.newest) g.newest = st;
    }
    if (g.afk && g.newest > this.frames.length) {
      g.afk = false;
      this.emitFn({ type: 'afk', seat: s.slot, on: false, tick: this.frames.length });
    }
  }

  private selfDelay(): number {
    if (!this.fairDelay) return 0;
    const leads: number[] = [];
    for (const g of this.guests.values()) if (!g.afk) leads.push(g.lead);
    if (!leads.length) return 0;
    leads.sort((a, b) => a - b);
    return Math.min(6, leads[(leads.length - 1) >> 1]);
  }

  private authorityTick(now: number): void {
    // guests: AFK / left by silence
    for (const g of [...this.guests.values()]) {
      const s = this.seats[g.seat];
      if (s.joining && s.switchTick <= 0) continue;           // still downloading the log
      const quiet = now - g.lastRecvAt;
      if (quiet > LEFT_MS) { this.markLeft(g.peer, 'silent', now); continue; }
      if (!g.afk && quiet > AFK_MS) { g.afk = true; this.stats.afkOn++; this.emitFn({ type: 'afk', seat: g.seat, on: true, tick: this.frames.length }); }
    }
    if (this.simTick < this.frames.length) { this.sendFrames(now); return; }   // still catching up (after a migration)
    if (this.holdUntil > 0) {
      if (now < this.holdUntil) { this.sendFrames(now); return; }
      this.holdUntil = -1;
      this.authBase = this.frames.length; this.authT0 = now;     // the stalled time is lost, not replayed in a burst
    }
    const target = this.authBase + Math.floor((now - this.authT0) / TICK_MS);
    let made = 0;
    while (!this.finished && this.frames.length < target && made < MAX_CATCHUP && this.frames.length < this.start.endTick) {
      this.produce(now);
      made++;
      this.stepPending(now);
    }
    if (made === MAX_CATCHUP && this.frames.length < target - 2 * MAX_CATCHUP) {
      // a long stall (hidden tab without the Worker clock): do not try to replay seconds at once - re-base the clock
      this.authBase = this.frames.length; this.authT0 = now;
    }
    this.sendFrames(now);
  }

  private produce(now: number): void {
    const T = this.frames.length + 1;
    const mine = this.mySeat();
    // own input, stamped T + selfDelay (fairness)
    if (mine >= 0) {
      const st = T + this.selfDelay();
      if (!this.ownInputs.has(st)) this.ownInputs.set(st, this.localIn.slice());
    }
    const f: Frame = { tick: T, lateMask: 0, botMask: 0, inputs: new Uint8Array(SEATS * INPUT_BYTES) };
    for (const s of this.seats) {
      const bit = 1 << s.slot;
      const human = s.peer && !s.left && (!s.joining || (s.switchTick > 0 && T >= s.switchTick));
      if (!human) { f.botMask |= bit; this.lastIn[s.slot] = ZERO4; continue; }
      if (s.joining && T >= s.switchTick) s.joining = false;
      let b: Uint8Array | undefined;
      if (s.peer === this.self) {
        b = this.ownInputs.get(T);
        this.ownInputs.delete(T);
      } else {
        const g = this.guests.get(s.peer as string);
        if (!g || g.afk) { f.botMask |= bit; continue; }
        b = g.inputs.get(T);
        if (b) g.inputs.delete(T);
        for (const k of g.inputs.keys()) if (k < T) g.inputs.delete(k);
      }
      if (!b) { b = this.lastIn[s.slot]; f.lateMask |= bit; this.stats.lateRepeats += s.peer === this.self ? 0 : 1; }
      f.inputs.set(b, s.slot * INPUT_BYTES);
      this.lastIn[s.slot] = b;
    }
    for (const k of this.ownInputs.keys()) if (k < T) this.ownInputs.delete(k);
    this.append(f, now);
    this.stats.produced++;
  }

  private sendFrames(now: number): void {
    const C = this.frames.length;
    for (const g of this.guests.values()) {
      const s = this.seats[g.seat];
      if (s.left) continue;
      const from = g.ack + 1;
      const hasNew = from <= C;
      if (!hasNew && now - g.lastSendAt < 100) continue;       // heartbeat every 100 ms when idle
      let first = Math.max(from, C - FRAME_BATCH + 1);
      if (first < 1) first = 1;
      if (from < first) {
        const iv = Math.max(300, (g.lead + 2) * TICK_MS * 2);
        if (now - g.lastResendAt > iv) {
          g.lastResendAt = now;
          this.stats.resends++;
          for (let a = from; a < first; a += LOG_CHUNK) this.send(g.peer, encodeLogPkt(this.epoch, this.frames.slice(a - 1, Math.min(first - 1, a - 1 + LOG_CHUNK))), true);
        }
      }
      const frames = hasNew ? this.frames.slice(first - 1, C) : [];
      const slack: number[] = [];
      for (let k = 0; k < SEATS; k++) {
        const gg = this.seats[k].peer ? this.guests.get(this.seats[k].peer as string) : undefined;
        slack.push(gg ? gg.newest - C : 0);
      }
      this.send(g.peer, encodeFramePkt({ epoch: this.epoch, echo: g.ping, hold: g.pingAt >= 0 ? now - g.pingAt : 0, authTick: C, slack, frames }), false);
      g.lastSendAt = now;
    }
  }

  // ─────────────────────────────── migration ───────────────────────────────

  private authorityLost(now: number, why: string): void {
    const old = this.authority;
    if (old) {
      const s = this.seatOf(old);
      if (s && !s.left) { s.left = true; if (this.prevAuthority !== null) this.electionLeft.add(old); this.emitFn({ type: 'left', peer: old, why: 'authority ' + why }); }
    }
    const cand = lowestId(this.liveHumans());
    this.logFn(`${this.self}: authority ${old} lost (${why}) at confirmed ${this.confirmed}; candidate ${cand}`);
    if (this.prevAuthority === null) { this.prevAuthority = old; this.prevEpoch = this.epoch; this.migrateLastFrameAt = this.heardAuthAt; }
    if (cand === this.self) { this.awaitingCand = false; this.beginMigration(now); }
    else { this.authority = cand; this.lastAuthAt = now; this.awaitingCand = true; }   // wait for its MIGRATE (or time it out too)
  }

  /** an unsettled election is called off: back to the previous authority (candidates tell whoever followed them) */
  private revertElection(now: number, why: string): void {
    const back = this.prevAuthority;
    if (!back) return;
    const wasCand = this.state === 'migrating';
    const abortedEpoch = this.epoch;
    this.logFn(`${this.self}: election called off (${why}); back to ${back}`);
    if (wasCand) {
      for (const p of this.otherHumans()) this.send(p, encodeCtl({ t: 'abort', epoch: abortedEpoch, back, backEpoch: this.prevEpoch }), true);
      this.migrateWait = null;
      this.state = this.finished ? 'done' : 'play';
    }
    for (const s of this.seats) if (s.peer && s.left && (s.peer === back || this.electionLeft.has(s.peer))) s.left = false;
    this.electionLeft.clear();
    this.epoch = this.prevEpoch;
    this.authority = back;
    this.prevAuthority = null;
    this.awaitingCand = false;
    this.lastAuthAt = now;
    this.heardAuthAt = now;
    this.guests.clear();
    this.emitFn({ type: 'roster', seats: this.roster() });
  }
  /** peers marked left only because an election timed them out (restored if the election is called off) */
  private electionLeft = new Set<string>();

  private beginMigration(now: number): void {
    this.epoch++;
    this.authority = this.self;
    this.state = 'migrating';
    this.migrateAt = now;
    this.migrateMerged = this.frames.length;
    this.migrateWait = new Set(this.otherHumans());
    this.guests.clear();
    const msg = encodeCtl({ t: 'migrate', epoch: this.epoch, confirmed: this.frames.length });
    for (const p of this.migrateWait) this.send(p, msg, true);
    // not waited for, but told: the old authority (it may only have stalled) and peers the election timed out
    for (const p of new Set([this.prevAuthority, ...this.electionLeft])) if (p && p !== this.self && !this.migrateWait.has(p)) this.send(p, msg, true);
    this.emitFn({ type: 'authority', id: this.self, epoch: this.epoch, tick: this.frames.length });
    this.checkMigration(now);
  }

  private checkMigration(now: number): void {
    if (!this.migrateWait) return;
    if (this.migrateWait.size > 0 && now - this.migrateAt < MIGRATE_WAIT_MS) return;
    for (const p of this.migrateWait) this.markLeft(p, 'no HAVE', now);
    this.migrateWait = null;
    this.prevAuthority = null;           // settled
    this.electionLeft.clear();
    // resume the clock after the merged log; the sim catches up in authorityTick before producing
    this.state = this.finished ? 'done' : 'play';
    this.authBase = this.frames.length;
    this.authT0 = now;
    this.stats.migrations++;
    for (const s of this.seats) { this.lastIn[s.slot] = this.frames.length ? this.frames[this.frames.length - 1].inputs.slice(s.slot * INPUT_BYTES, (s.slot + 1) * INPUT_BYTES) : ZERO4; }
    for (const p of this.otherHumans()) this.send(p, encodeCtl({ t: 'resume', epoch: this.epoch, tick: this.frames.length }), true);
    this.broadcastRoster();
    this.emitFn({ type: 'migrated', epoch: this.epoch, tick: this.frames.length, pauseMs: now - this.migrateLastFrameAt, merged: this.migrateMerged });
  }

  // ─────────────────────────────── joiner ───────────────────────────────

  private joinerTick(now: number): void {
    if (this.joinUpto < 0) {
      if (now - this.joinStartedAt > 5000) { this.emitFn({ type: 'joinRejected', why: 'no answer' }); this.state = 'left'; }
      return;
    }
    // ack the live frames so the authority keeps the stream small; no inputs until the switch tick
    if (this.localTicksDue(now) > 0) {
      this.localTicks = Math.floor((now - this.localT0) / TICK_MS);
      if (this.authority) this.send(this.authority, encodeInputPkt({ epoch: this.epoch, seat: this.joinSeat, lead: this.lead,
        ping: Math.floor(now) & 0xffff, ack: this.confirmed, first: 0, inputs: new Uint8Array(0) }), false);
    }
    if (!this.readySent && this.confirmed >= this.joinUpto && this.confirmed - this.simTick <= 2) {
      this.readySent = true;
      this.send(this.authority as string, encodeCtl({ t: 'ready', seat: this.joinSeat, tick: this.simTick }), true);
    }
    if (this.switchTick > 0) {
      this.state = 'play';
      this.rejoining = false;
      this.lastAuthAt = now;
      this.emitFn({ type: 'joined', seat: this.joinSeat, switchTick: this.switchTick, replayed: this.joinUpto, replayMs: now - this.joinStartedAt });
    }
  }

  // ─────────────────────────────── control messages ───────────────────────────────

  private onCtl(from: string, b: Uint8Array, now: number): void {
    const m = decodeCtl(b);
    if (!m) return;
    switch (m.t) {
      case 'leave': {
        if (from === this.authority && !this.isAuthority) this.authorityLost(now, 'leave');
        else this.markLeft(from, String(m.why ?? 'leave'), now);
        break;
      }
      case 'desync': if (from === this.authority) { this.state = 'desynced'; this.emitFn({ type: 'desync', tick: Number(m.tick), self: true, peers: [this.self] }); } break;
      case 'result': this.results.set(from, m.standings as Standings); break;
      case 'roster': {
        if (from !== this.authority || Number(m.epoch) !== this.epoch) break;
        const seats = m.seats as SeatView[];
        for (const sv of seats) {
          const s = this.seats[sv.slot];
          if (!s) continue;
          s.peer = sv.peer; s.left = sv.left; s.joining = sv.joining; s.switchTick = sv.switchTick;
          if (sv.peer === this.self && sv.joining && sv.switchTick > 0 && this.state === 'joining') this.switchTick = sv.switchTick;
        }
        this.emitFn({ type: 'roster', seats: this.roster() });
        break;
      }
      case 'migrate': {
        const e = Number(m.epoch);
        const better = e > this.epoch || (e === this.epoch && this.authority !== null && from < this.authority);
        if (!better) break;
        // only follow a new authority when the current one looks gone to ME too: a peer that merely stalled must not
        // hijack the clock. The authority itself steps down only when it just came back from a long stall.
        const iAmAuth = this.authority === this.self && this.state === 'play';
        const silent = now - this.heardAuthAt > HOST_TIMEOUT_MS / 2;
        const ok = iAmAuth ? now - this.stalledAt < 3000 : (from === this.authority || this.awaitingCand || silent || this.state === 'migrating');
        if (!ok) { this.send(from, encodeCtl({ t: 'nomigrate', epoch: e }), true); break; }
        const prev = this.authority;
        const lostSeat = iAmAuth ? this.mySeat() : -1;
        if (prev && prev !== from) {
          const s = this.seatOf(prev);
          if (s && !s.left) { s.left = true; this.emitFn({ type: 'left', peer: prev, why: 'superseded' }); }
        }
        if (this.state === 'migrating') { this.migrateWait = null; this.state = this.finished ? 'done' : 'play'; }
        this.epoch = e;
        this.authority = from;
        this.lastAuthAt = now;
        const theirs = Number(m.confirmed) | 0;
        for (let a = theirs + 1; a <= this.frames.length; a += LOG_CHUNK) {
          this.send(from, encodeLogPkt(this.epoch, this.frames.slice(a - 1, Math.min(this.frames.length, a - 1 + LOG_CHUNK))), true);
        }
        this.send(from, encodeCtl({ t: 'have', epoch: e, confirmed: this.frames.length }), true);
        this.awaitingCand = false;
        this.heardAuthAt = now;
        this.guests.clear();
        this.emitFn({ type: 'authority', id: from, epoch: e, tick: this.frames.length });
        // a stepped-down authority lost its seat on the others (they timed it out): ask for it back, no replay needed
        if (lostSeat >= 0) {
          this.state = 'joining'; this.rejoining = true; this.joinSeat = lostSeat; this.joinStartedAt = now; this.joinUpto = -1; this.readySent = false; this.switchTick = -1;
          this.send(from, encodeCtl({ t: 'join', seat: lostSeat, have: Math.max(1, theirs), rejoin: true }), true);
        }
        break;
      }
      case 'nomigrate': {
        if (this.state === 'migrating' && Number(m.epoch) === this.epoch) this.revertElection(now, `${from} still hears the authority`);
        break;
      }
      case 'abort': {
        if (from === this.authority && Number(m.epoch) === this.epoch) {
          this.prevAuthority = String(m.back); this.prevEpoch = Number(m.backEpoch) | 0;
          this.revertElection(now, `${from} called its election off`);
        }
        break;
      }
      case 'have': {
        if (!this.isAuthority || Number(m.epoch) !== this.epoch) break;
        const s = this.seatOf(from);
        if (s) { const g = this.guestRt(from, s.slot, now); g.ack = Math.min(Number(m.confirmed) | 0, this.frames.length); g.lastRecvAt = now; }
        if (this.migrateWait) { this.migrateWait.delete(from); this.checkMigration(now); }
        break;
      }
      case 'resume': if (from === this.authority) this.lastAuthAt = now; break;
      case 'join': this.onJoinReq(from, Number(m.seat) | 0, now, m.rejoin === true ? Number(m.have) | 0 : 0); break;
      case 'joinok': {
        if (this.state !== 'joining') break;
        this.joinUpto = Number(m.upto) | 0;
        this.epoch = Number(m.epoch) | 0;
        this.authority = from;
        this.lastAuthAt = now;
        const seats = m.seats as SeatView[];
        for (const sv of seats) { const s = this.seats[sv.slot]; if (s) { s.peer = sv.peer; s.left = sv.left; s.joining = sv.joining; s.switchTick = sv.switchTick; } }
        break;
      }
      case 'joinno': if (this.state === 'joining') { this.emitFn({ type: 'joinRejected', why: String(m.why) }); this.state = 'left'; } break;
      case 'ready': {
        if (!this.isAuthority) break;
        const s = this.seatOf(from);
        if (!s || !s.joining) break;
        const g = this.guestRt(from, s.slot, now);
        g.lastRecvAt = now;
        s.switchTick = this.frames.length + Math.max(4, g.lead + 3);
        this.broadcastRoster();
        this.send(from, encodeCtl({ t: 'roster', epoch: this.epoch, seats: this.roster() }), true);
        break;
      }
      default: break;
    }
  }

  private onJoinReq(from: string, seat: number, now: number, have = 0): void {
    if (!this.isAuthority) { this.send(from, encodeCtl({ t: 'joinno', why: 'not authority' }), true); return; }
    const s = this.seats[seat];
    const rejoin = have > 0 && !!s && s.peer === from;      // a peer taking back its own seat already holds the log
    if (!rejoin && this.frames.length >= JOIN_CUTOFF_TICK) { this.send(from, encodeCtl({ t: 'joinno', why: 'late' }), true); return; }
    if (!s || (s.peer && !s.left)) { this.send(from, encodeCtl({ t: 'joinno', why: 'taken' }), true); return; }
    s.peer = from; s.left = false; s.joining = true; s.switchTick = 0;
    this.lastIn[seat] = ZERO4;
    const g = this.guestRt(from, seat, now);
    const upto = this.frames.length;
    g.ack = upto; g.lastRecvAt = now;
    this.send(from, encodeCtl({ t: 'joinok', seat, epoch: this.epoch, upto, seats: this.roster() }), true);
    for (let a = Math.max(1, rejoin ? have + 1 : 1); a <= upto; a += LOG_CHUNK) this.send(from, encodeLogPkt(this.epoch, this.frames.slice(a - 1, Math.min(upto, a - 1 + LOG_CHUNK))), true);
    this.broadcastRoster();
    this.logFn(`${this.self}: join ${from} -> seat ${seat}, log ${upto} frames`);
  }
}
