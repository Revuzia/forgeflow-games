// HIT PARADE - core/net/rollback.ts (lane NET). GGPO-model rollback session over an abstract transport.
// THREE-free, DOM-free, clock-free: the ms clock is injected (opts.now). Runs identically under node.
//
// Binding design (_research/NETCODE.md 3.2-3.8, CONTRACT §10 / §19):
//   * input delay D (fixed per round; host-authoritative changes via proposeDelay at a round break)
//   * prediction = repeat the last received remote input; rollback window W (8 P2P, 12 relay): the sim
//     never runs more than W frames past the last confirmed remote input - it stalls instead
//   * every INPUT packet repeats every local input the peer has not acked (<= 32)
//   * save/load ring of W+2 slots through SimPort (core/sim/match.ts save/load/checksum via matchPort)
//   * time sync every 240 ticks (sync.ts TimeSync)
//   * checksum of every 15th confirmed frame rides on outgoing packets; a mismatch = DESYNC -> the host
//     sends a snapshot of its last confirmed frame; the guest loads it and re-simulates to the present;
//     more than 2 desyncs in a match = NO CONTEST
//   * a confirmed input that changes value is a protocol violation (never accepted)
//
// Frame bookkeeping: `frame` = the next frame to simulate; the sim holds state[frame]. Stepping frame f
// consumes the input words of frame f and produces state[f+1]. Local input for frame f is sampled D ticks
// earlier. Frames 0..D-1 are neutral (0) for both players by construction (both peers use START's D).

import {
  FLAG, MAX_INPUTS, NO_ECHO, PKT, ctlEpoch, decodeFrameMsg, decodeInput, decodeSnapshot, encodeFrameMsg, encodeInput,
  encodeSnapshot, flagsEpoch, newInputPacket,
} from './packet.ts';
import { CHECKSUM_EVERY, FRAME_MS, P2P_WINDOW, RttEstimator, TimeSync, hashInts } from './sync.ts';

/** What the session needs from the simulation (CONTRACT §19.1). `matchPort(m)` adapts a Match. */
export interface SimPort {
  readonly stateInts: number;
  step(in1: number, in2: number): void;
  save(slot: Int32Array): void;
  load(slot: Int32Array): void;
  checksum(): number;
}

/** Packet pipe (CONTRACT §19.2). `sendInput` is unreliable/unordered; `sendCtl` is reliable. */
export interface Transport {
  readonly kind: 'rtc' | 'relay' | 'loop';
  sendInput(b: Uint8Array): void;
  sendCtl(b: Uint8Array): void;
  /** Hand every packet received since the last call to `cb`, in arrival order. `at` = arrival time on the
   *  session's clock when the transport knows it (sharper RTT); omitted = the drain time. */
  drain(cb: (b: Uint8Array, ctl: boolean, at?: number) => void): void;
}

export interface SessionOpts {
  /** ms clock (performance.now in the browser, a simulated clock in probes). */
  now: () => number;
  /** input delay D in frames (START value; identical on both peers). */
  delay: number;
  /** rollback window W (default 8). */
  window?: number;
  /** send one INPUT packet every N ticks (1 = 60 Hz P2P, 6 = 10 Hz relay). */
  sendEvery?: number;
  /** snapshot authority on desync (default: local === 0; slot 0 is the host). */
  isHost?: boolean;
  /** clock time at which frame 0 may run (default: first tick). Infinity = wait for setStartAt(). */
  startAt?: number;
  checksumEvery?: number;
  maxDesyncs?: number;
  /** match epoch 0..15 (matchIndex & 15): packets of another epoch on the same transport are dropped. */
  epoch?: number;
  unstableMs?: number;
  silentMs?: number;
  onEvent?: (e: NetEvent) => void;
  /** P2 (NET): extra fields merged into stats() as `online` (the flow's phase / room / path; read by __HP__.net()). */
  info?: () => Record<string, unknown>;
  /** P2 (NET): record a diagnostic trace of the last `trace` ticks + packets (traceDump(); lab / harness only). */
  trace?: number;
}

/** P2 (NET) diagnostic trace (traceDump()). Times are on the session clock (opts.now). Rows:
 *  ticks [t, frame, rc, remoteMax, kind 0 advanced / 1 stalled / 2 skipped / 3 waiting, delay];
 *  sent  [t, seq, newestLocalFrame, count]; recv [arrivalT, seq, newestRemoteFrame, localFrameAtArrival]. */
export interface SessionTrace { ticks: number[][]; sent: number[][]; recv: number[][]; startedAt: number }

export type NetEvent =
  | { kind: 'desync'; frame: number; local: number; remote: number; count: number; at: number }
  | { kind: 'snapshot-sent'; frame: number }
  | { kind: 'recovered'; frame: number; from: number }
  | { kind: 'violation'; frame: number; had: number; got: number }
  | { kind: 'nocontest'; reason: string }
  | { kind: 'delay'; delay: number; atFrame: number };

export type NetStatus = 'waiting' | 'running' | 'unstable' | 'silent' | 'nocontest';

export interface NetStats {
  transport: 'rtc' | 'relay' | 'loop';
  status: NetStatus;
  frame: number;
  confirmed: number;          // every state <= this frame is final (all inputs before it are real)
  delay: number;
  window: number;
  rttMs: number;
  rttMedianMs: number;
  depth: number;              // frame - last confirmed remote input frame - 1 (frames running on prediction)
  remoteConfirmed: number;
  rollbacks: number;
  rollbackFrames: number;
  maxRollback: number;
  stallTicks: number;
  skipTicks: number;
  ticks: number;
  gameSpeed: number;          // frames advanced / ticks since start (1 = no stalls)
  /** P2: frames advanced / (60 x seconds since start): the speed a player sees, incl. ticks the local loop never ran */
  wallSpeed: number;
  sent: number;
  recv: number;
  bytesSent: number;
  bytesRecv: number;
  rejected: number;
  stale: number;              // packets of another match epoch (dropped)
  lossPct: number;
  reordered: number;
  silenceMs: number;
  desyncs: number;
  checksumsCompared: number;
  lastChecksumFrame: number;
  violations: number;
  peerAway: boolean;
  /** P2: SessionOpts.info() when given (online flow: phase, room, path, supabase counters) */
  online?: Record<string, unknown>;
}

const RING = 256;
const MASK = RING - 1;
const CS_RING = 64;
const INF = 0x7fffffff;

export class RollbackSession {
  readonly local: 0 | 1;
  readonly isHost: boolean;
  private sim: SimPort;
  private tr: Transport;
  private now: () => number;
  private onEvent: ((e: NetEvent) => void) | null;
  private info: (() => Record<string, unknown>) | null;
  private traceCap: number;
  private tr0: SessionTrace | null = null;
  private delay: number;
  private win: number;
  private sendEvery: number;
  private csEvery: number;
  private maxDesyncs: number;
  private unstableMs: number;
  private silentMs: number;
  private startAt: number;
  private epoch: number;
  private started = false;
  private startedAt = 0;

  private frame = 0;
  private localHead: number;
  private rc: number;                   // remote confirmed: last contiguous remote input frame
  private remoteMax: number;            // highest remote input frame received
  private peerAck: number;              // highest local input frame the peer holds contiguously
  private floorFrame = 0;               // frames below this are history (after a snapshot recovery)
  private inLocal = new Int32Array(RING);
  private inRemote = new Int32Array(RING);
  private remoteTag = new Int32Array(RING).fill(-1);
  private used = new Int32Array(RING);
  private usedTag = new Int32Array(RING).fill(-1);
  private ring: Int32Array[] = [];
  private ringTag: Int32Array = new Int32Array(0);
  private rollbackTo = INF;

  private csTent = new Int32Array(CS_RING);
  private csTentTag = new Int32Array(CS_RING).fill(-1);
  private csLocal = new Int32Array(CS_RING);
  private csLocalTag = new Int32Array(CS_RING).fill(-1);
  private csRemote = new Int32Array(CS_RING);
  private csRemoteTag = new Int32Array(CS_RING).fill(-1);
  private lastCsFinal = -1;
  private lastCompared = -1;
  private compareFloor = 0;             // checksum frames below this are not compared (desync recovery)
  // desync incident state: one incident = one count, one snapshot (resent every 2 s until RECOVERED)
  private wantSnapshot = false;         // host: send a snapshot after this tick's rollback + finalize
  private awaitingAck = false;          // host: snapshot sent, waiting for the guest's RECOVERED
  private snapshotSentAt = 0;
  private awaitingSnapshot = false;     // guest: desync seen, waiting for the host's snapshot
  private desyncReqAt = 0;

  private pendingDelay = -1;
  private pendingDelayAt = -1;

  private pkt = newInputPacket();
  private seq = 0;
  private rtt = new RttEstimator();
  private sync = new TimeSync();
  private remoteTs = -1;
  private remoteTsAt = 0;
  private lastRecvAt = -1;
  private away = false;
  private peerAway = false;
  private stalledNow = false;
  private seqFirst = -1;
  private seqMax = -1;
  private recvSeqCount = 0;
  private tmpState: Int32Array;

  private st = {
    rollbacks: 0, rollbackFrames: 0, maxRollback: 0, stallTicks: 0, skipTicks: 0, ticks: 0, advanced: 0,
    sent: 0, recv: 0, bytesSent: 0, bytesRecv: 0, rejected: 0, stale: 0, reordered: 0, desyncs: 0, checksumsCompared: 0,
    lastChecksumFrame: -1, violations: 0,
  };
  private status: NetStatus = 'waiting';
  /** depth histogram (frames on prediction when a frame was advanced), 0..32 (32 = 32+). */
  readonly depthHist = new Int32Array(33);
  /** rollback length histogram, 0..32. */
  readonly rollbackHist = new Int32Array(33);
  /** desync reports (frame, both checksums, recent inputs) for the dev report. */
  readonly desyncLog: { frame: number; local: number; remote: number; at: number; inputs: number[][] }[] = [];

  constructor(sim: SimPort, local: 0 | 1, transport: Transport, opts: SessionOpts) {
    this.sim = sim;
    this.local = local;
    this.tr = transport;
    this.now = opts.now;
    this.onEvent = opts.onEvent ?? null;
    this.info = opts.info ?? null;
    this.traceCap = Math.max(0, (opts.trace ?? 0) | 0);
    if (this.traceCap > 0) this.tr0 = { ticks: [], sent: [], recv: [], startedAt: -1 };
    this.delay = Math.max(0, opts.delay | 0);
    this.win = Math.max(1, (opts.window ?? P2P_WINDOW) | 0);
    this.sendEvery = Math.max(1, (opts.sendEvery ?? 1) | 0);
    this.isHost = opts.isHost ?? local === 0;
    this.startAt = opts.startAt ?? -Infinity;
    this.csEvery = opts.checksumEvery ?? CHECKSUM_EVERY;
    this.maxDesyncs = opts.maxDesyncs ?? 2;
    this.epoch = (opts.epoch ?? 0) & 15;
    this.unstableMs = opts.unstableMs ?? 750;
    this.silentMs = opts.silentMs ?? 5000;
    this.allocRing(this.win);
    this.tmpState = new Int32Array(sim.stateInts);
    // frames 0..D-1 are neutral for both players and confirmed by construction
    this.localHead = this.delay - 1;
    this.rc = this.delay - 1;
    this.remoteMax = this.delay - 1;
    this.peerAck = this.delay - 1;
    for (let f = 0; f < this.delay; f++) {
      this.inLocal[f & MASK] = 0;
      this.inRemote[f & MASK] = 0;
      this.remoteTag[f & MASK] = f;
    }
  }

  // ---- public API ---------------------------------------------------------------------------------------

  /** Called once per 60 Hz loop tick with the local player's input word. */
  tick(localInput: number): { advanced: number; stalled: boolean } {
    const now = this.now();
    this.receive(now);
    if (!this.started) {
      if (!(now >= this.startAt)) {
        this.finalizeChecksums();       // CHANGED(wf7 online): state[0] is final before the start too (see confirmedFrame)
        if (this.tr0) this.traceTick(now, 3);
        return { advanced: 0, stalled: false };
      }
      this.started = true;
      this.startedAt = now;
      if (this.tr0) this.tr0.startedAt = now;
      if (this.status === 'waiting') this.status = 'running';
    }
    if (this.rollbackTo < this.frame) this.rollback();
    this.finalizeChecksums();
    this.serviceDesync(now);
    if (this.pendingDelayAt >= 0 && this.frame >= this.pendingDelayAt) {
      this.delay = this.pendingDelay;
      this.pendingDelayAt = -1;
    }
    this.st.ticks++;
    let advanced = 0;
    let stalled = false;
    let skipped = false;
    if (this.status === 'nocontest') {
      stalled = true;
    } else if (this.sync.tick()) {
      this.st.skipTicks++;
      skipped = true;
    } else if (this.frame - this.rc > this.win) {
      stalled = true;
      this.st.stallTicks++;
    } else {
      this.addLocal(localInput);
      const depth = this.frame - this.rc - 1;
      this.depthHist[depth < 0 ? 0 : depth > 32 ? 32 : depth]++;
      this.simFrame(this.frame);
      this.frame++;
      this.st.advanced++;
      advanced = 1;
    }
    this.stalledNow = stalled;
    // CHANGED(wf7 online): finalize again after the advance, so between two ticks (where the online flow asks for its
    // RESULT) every checksum frame <= confirmedFrame() is final - the start-of-tick pass alone left state[frame-1] and
    // state[frame] without one for a tick (P1-WF6: MATCH_END on a checksum frame -> RESULT cs null -> "agreed false").
    this.finalizeChecksums();
    if (this.tr0) this.traceTick(now, advanced ? 0 : skipped ? 2 : 1);
    if (this.remoteMax >= this.delay) this.sync.addLocal(this.localAdvantage());
    if (this.st.ticks % this.sendEvery === 0) this.sendInputs(now);
    this.updateStatus(now);
    return { advanced, stalled };
  }

  /** P2 diagnostic trace (null unless opts.trace > 0): copies of the recorded rows. */
  traceDump(): SessionTrace | null {
    const t = this.tr0;
    return t ? { ticks: t.ticks.slice(), sent: t.sent.slice(), recv: t.recv.slice(), startedAt: t.startedAt } : null;
  }

  private traceTick(now: number, kind: number): void {
    const t = this.tr0 as SessionTrace;
    t.ticks.push([Math.round(now * 10) / 10, this.frame, this.rc, this.remoteMax, kind, this.delay]);
    if (t.ticks.length > this.traceCap) t.ticks.splice(0, t.ticks.length - this.traceCap);
  }

  private traceRow(list: number[][], row: number[]): void {
    list.push(row);
    const cap = this.traceCap >> 1;
    if (list.length > cap) list.splice(0, list.length - cap);
  }

  /** Set when frame 0 may run (clock of opts.now). Used by the online flow after the GO message. */
  setStartAt(t: number): void { this.startAt = t; }

  /** Host: change D for everyone at a round break. Applies on both peers at the same frame. */
  proposeDelay(delay: number, leadFrames = 30): void {
    if (!this.isHost) return;
    const at = this.frame + leadFrames;
    this.scheduleDelay(delay, at);
    this.tr.sendCtl(encodeFrameMsg(PKT.DELAY, at, delay, this.epoch));
  }

  /** Swap the transport mid-match (P2P -> relay fallback). Window/send rate follow the new tier. */
  setTransport(tr: Transport, opts: { window?: number; sendEvery?: number } = {}): void {
    this.tr = tr;
    if (opts.sendEvery) this.sendEvery = Math.max(1, opts.sendEvery | 0);
    if (opts.window && opts.window !== this.win) this.resizeWindow(opts.window | 0);
  }

  /** Tab hidden / shown: rides as flags.b2 so the peer can show OPPONENT AWAY. Sends a packet now. */
  setAway(away: boolean): void {
    if (this.away === away) return;
    this.away = away;
    this.sendInputs(this.now());
  }

  /** Final (confirmed) checksum of state[f] if f is a checksum frame still in the log, else null.
   *  CHANGED(wf7 online): between ticks it answers for EVERY checksum frame f <= confirmedFrame() that this peer simulated
   *  (the last 64 periods; frames a desync snapshot jumped over excepted) - core/net/result.ts relies on it. */
  checksumAt(f: number): number | null {
    const ti = Math.floor(f / this.csEvery) & (CS_RING - 1);
    return f % this.csEvery === 0 && this.csLocalTag[ti] === f ? this.csLocal[ti] : null;
  }

  /** Every state <= this frame is final on this peer (and, between ticks, so is every checksum up to it: checksumAt). */
  confirmedFrame(): number { return Math.min(this.rc + 1, this.frame); }

  currentFrame(): number { return this.frame; }

  /** Input words of frames [from, to] as [p1, p2] pairs (dev reports / replays). Unknown = -1. */
  inputLog(from: number, to: number): number[][] {
    const out: number[][] = [];
    for (let f = Math.max(0, from, this.frame - RING + 8); f <= to; f++) {
      const l = f <= this.localHead ? this.inLocal[f & MASK] : -1;
      const r = this.remoteTag[f & MASK] === f ? this.inRemote[f & MASK] : -1;
      out.push(this.local === 0 ? [f, l, r] : [f, r, l]);
    }
    return out;
  }

  stats(): NetStats {
    const now = this.now();
    const expected = this.seqMax >= this.seqFirst && this.seqFirst >= 0 ? this.seqMax - this.seqFirst + 1 : 0;
    const wallTicks = this.started ? (now - this.startedAt) / FRAME_MS : 0;
    let online: Record<string, unknown> | undefined;
    if (this.info) { try { online = this.info(); } catch { online = undefined; } }
    return {
      transport: this.tr.kind,
      status: this.status,
      frame: this.frame,
      confirmed: this.confirmedFrame(),
      delay: this.delay,
      window: this.win,
      rttMs: this.rtt.last,
      rttMedianMs: this.rtt.median(),
      depth: Math.max(0, this.frame - this.rc - 1),
      remoteConfirmed: this.rc,
      rollbacks: this.st.rollbacks,
      rollbackFrames: this.st.rollbackFrames,
      maxRollback: this.st.maxRollback,
      stallTicks: this.st.stallTicks,
      skipTicks: this.st.skipTicks,
      ticks: this.st.ticks,
      gameSpeed: this.st.ticks > 0 ? this.st.advanced / this.st.ticks : 1,
      wallSpeed: wallTicks >= 1 ? Math.min(1.5, this.st.advanced / wallTicks) : 1,
      sent: this.st.sent,
      recv: this.st.recv,
      bytesSent: this.st.bytesSent,
      bytesRecv: this.st.bytesRecv,
      rejected: this.st.rejected,
      stale: this.st.stale,
      lossPct: expected > 0 ? Math.max(0, 100 * (1 - this.recvSeqCount / expected)) : 0,
      reordered: this.st.reordered,
      silenceMs: this.lastRecvAt < 0 ? (this.started ? now - this.startedAt : 0) : now - this.lastRecvAt,
      desyncs: this.st.desyncs,
      checksumsCompared: this.st.checksumsCompared,
      lastChecksumFrame: this.st.lastChecksumFrame,
      violations: this.st.violations,
      peerAway: this.peerAway,
      ...(online ? { online } : {}),
    };
  }

  // ---- simulation ---------------------------------------------------------------------------------------

  private allocRing(win: number): void {
    const S = win + 2;
    this.ring = [];
    for (let i = 0; i < S; i++) this.ring.push(new Int32Array(this.sim.stateInts));
    this.ringTag = new Int32Array(S).fill(-1);
  }

  private resizeWindow(win: number): void {
    const oldRing = this.ring;
    const oldTag = this.ringTag;
    this.win = Math.max(1, win);
    this.allocRing(this.win);
    const S = this.ring.length;
    for (let i = 0; i < oldRing.length; i++) {
      const f = oldTag[i];
      if (f < 0) continue;
      const slot = f % S;
      if (this.ringTag[slot] < f) {
        this.ring[slot].set(oldRing[i]);
        this.ringTag[slot] = f;
      }
    }
  }

  private addLocal(input: number): void {
    const target = this.frame + this.delay;
    while (this.localHead < target - 1) {          // delay grew: repeat the previous word
      this.localHead++;
      this.inLocal[this.localHead & MASK] = this.localHead > 0 ? this.inLocal[(this.localHead - 1) & MASK] : 0;
    }
    if (this.localHead < target) {
      this.localHead++;
      this.inLocal[this.localHead & MASK] = input & 0xffff;
    }
    // else: delay shrank - this sample is dropped (its frame was already scheduled)
  }

  private remoteFor(f: number): number {
    const i = f & MASK;
    if (this.remoteTag[i] === f) return this.inRemote[i];
    // prediction: repeat the last received input (the newest frame below f we hold), else the last confirmed
    const m = this.remoteMax;
    if (m < f && this.remoteTag[m & MASK] === m) return this.inRemote[m & MASK];
    const c = this.rc;
    return c >= 0 && this.remoteTag[c & MASK] === c ? this.inRemote[c & MASK] : 0;
  }

  private simFrame(f: number): void {
    const S = this.ring.length;
    const slot = f % S;
    this.sim.save(this.ring[slot]);
    this.ringTag[slot] = f;
    if (f % this.csEvery === 0) {
      const ti = Math.floor(f / this.csEvery) & (CS_RING - 1);
      this.csTent[ti] = this.sim.checksum();
      this.csTentTag[ti] = f;
    }
    const li = this.inLocal[f & MASK];
    const ri = this.remoteFor(f);
    this.used[f & MASK] = ri;
    this.usedTag[f & MASK] = f;
    if (this.local === 0) this.sim.step(li, ri);
    else this.sim.step(ri, li);
  }

  private rollback(): void {
    const g = this.rollbackTo;
    this.rollbackTo = INF;
    const S = this.ring.length;
    if (g < this.floorFrame) return;
    if (this.ringTag[g % S] !== g) {
      // Cannot happen while the window invariant holds; treat as fatal rather than silently diverging.
      this.fail('rollback state ' + g + ' missing (frame ' + this.frame + ')');
      return;
    }
    this.sim.load(this.ring[g % S]);
    const depth = this.frame - g;
    this.st.rollbacks++;
    this.st.rollbackFrames += depth;
    if (depth > this.st.maxRollback) this.st.maxRollback = depth;
    this.rollbackHist[depth > 32 ? 32 : depth]++;
    for (let f = g; f < this.frame; f++) this.simFrame(f);
  }

  private fail(reason: string): void {
    if (this.status === 'nocontest') return;
    this.status = 'nocontest';
    this.emit({ kind: 'nocontest', reason });
  }

  private emit(e: NetEvent): void {
    if (this.onEvent) {
      try { this.onEvent(e); } catch { /* listener errors never break the session */ }
    }
  }

  // ---- receive ------------------------------------------------------------------------------------------

  private receive(now: number): void {
    this.tr.drain((b, ctl, at) => this.onPacket(b, ctl, at !== undefined && at <= now ? at : now));
  }

  private onPacket(b: Uint8Array, _ctl: boolean, now: number): void {
    const type = b.length > 0 ? b[0] : -1;
    if (type === PKT.INPUT) {
      if (b.length > 1 && flagsEpoch(b[1]) !== this.epoch) { this.st.stale++; return; }
      this.onInput(b, now);
      return;
    }
    if ((type === PKT.SNAPSHOT || type === PKT.DESYNC || type === PKT.DELAY || type === PKT.RECOVERED) && ctlEpoch(b) !== this.epoch) { this.st.stale++; return; }
    if (type === PKT.SNAPSHOT) { this.onSnapshot(b); return; }
    if (type === PKT.DESYNC || type === PKT.DELAY || type === PKT.RECOVERED) {
      const m = decodeFrameMsg(b);
      if (!m) { this.st.rejected++; return; }
      if (m.type === PKT.DESYNC) {
        // guest saw a mismatch: open an incident if we have none (the guest counted it already)
        if (this.isHost && !this.awaitingAck && m.frame >= this.compareFloor) this.wantSnapshot = true;
      } else if (m.type === PKT.RECOVERED) {
        if (this.isHost && this.awaitingAck) {
          this.awaitingAck = false;
          // guest checksums of frames it finalized before loading the snapshot are stale: skip them
          if (m.frame > this.compareFloor) this.compareFloor = m.frame;
        }
      } else if (!this.isHost) this.scheduleDelay(m.arg, m.frame);
      return;
    }
    // sync pings and anything else belong to the online flow, not the session
  }

  private onInput(b: Uint8Array, now: number): void {
    const p = this.pkt;
    if (!decodeInput(b, p)) { this.st.rejected++; return; }
    const last = p.startFrame + p.count - 1;
    if (last > this.frame + this.delay + this.win + MAX_INPUTS + 8) { this.st.rejected++; return; }
    this.st.recv++;
    this.st.bytesRecv += b.length;
    this.lastRecvAt = now;
    // seq stats (u16, unwrapped against the max seen)
    let s = p.seq;
    if (this.seqMax >= 0) {
      const base = this.seqMax & ~0xffff;
      s = base | p.seq;
      if (s < this.seqMax - 0x8000) s += 0x10000;
      else if (s > this.seqMax + 0x8000) s -= 0x10000;
    }
    if (this.seqFirst < 0) { this.seqFirst = s; this.seqMax = s; }
    else if (s > this.seqMax) this.seqMax = s;
    else this.st.reordered++;
    this.recvSeqCount++;
    this.peerAway = (p.flags & FLAG.AWAY) !== 0;
    if (p.ackFrame > this.peerAck && p.ackFrame <= this.localHead) this.peerAck = p.ackFrame;
    // continuous RTT: rtt = now - echoTs - echoHold (16-bit ms arithmetic)
    this.remoteTs = p.tsLow;
    this.remoteTsAt = now;
    if (p.echoHold !== NO_ECHO) {
      const rtt = ((Math.floor(now) & 0xffff) - p.echoTs - p.echoHold) & 0xffff;
      if (rtt < 10000) this.rtt.add(rtt);
    }
    this.sync.addRemote(p.advantage);
    if (this.tr0) this.traceRow(this.tr0.recv, [Math.round(now * 10) / 10, p.seq, last, this.frame]);
    for (let k = 0; k < p.count; k++) this.addRemote(p.startFrame + k, p.inputs[k]);
    if (p.csFrame >= 0) this.onRemoteChecksum(p.csFrame, p.checksum);
  }

  private addRemote(g: number, v: number): void {
    if (g < this.floorFrame) return;                              // history before a snapshot
    if (g < this.frame - RING + 16) return;                       // far too old for the ring
    const i = g & MASK;
    if (this.remoteTag[i] === g) {
      if (this.inRemote[i] !== v) {
        // a frame we already hold changed value: cheating or broken peer. Never accepted.
        this.st.violations++;
        this.emit({ kind: 'violation', frame: g, had: this.inRemote[i], got: v });
      }
      return;
    }
    if (g <= this.rc) return;                                     // (only after ring wrap) ignore
    this.remoteTag[i] = g;
    this.inRemote[i] = v;
    if (g > this.remoteMax) this.remoteMax = g;
    if (g < this.frame && this.usedTag[i] === g && this.used[i] !== v && g < this.rollbackTo) this.rollbackTo = g;
    while (this.remoteTag[(this.rc + 1) & MASK] === this.rc + 1) this.rc++;
  }

  // ---- checksums / desync -------------------------------------------------------------------------------

  /**
   * Moves every checksum of a state that is now final (f <= confirmedFrame() = min(rc + 1, frame)) into the final log and
   * compares it with the peer's. CHANGED(wf7 online): the limit was min(rc + 1, frame - 1) - state[frame], the LIVE state,
   * only got its checksum when simFrame(frame) ran a tick later, so a checksum frame could be "confirmed" without a final
   * checksum. Now the live state's checksum is taken here when it is final (rc + 1 >= frame: no rollback can reach it; the
   * sim holds state[frame] at both call sites - start of tick after the rollback, end of tick after the advance), and
   * simFrame(frame) later recomputes the same value. Called at the start AND the end of every tick.
   */
  private finalizeChecksums(): void {
    const limit = Math.min(this.rc + 1, this.frame);
    const ce = this.csEvery;
    let f = this.lastCsFinal < 0 ? Math.ceil(this.floorFrame / ce) * ce : this.lastCsFinal + ce;
    for (; f <= limit; f += ce) {
      const ti = Math.floor(f / ce) & (CS_RING - 1);
      if (f === this.frame && this.csTentTag[ti] !== f) {
        this.csTent[ti] = this.sim.checksum();
        this.csTentTag[ti] = f;
      }
      this.lastCsFinal = f;
      if (this.csTentTag[ti] !== f) continue;               // never simulated here (snapshot jump)
      this.csLocal[ti] = this.csTent[ti];
      this.csLocalTag[ti] = f;
      if (this.csRemoteTag[ti] === f) this.compare(f, this.csLocal[ti], this.csRemote[ti]);
    }
  }

  private onRemoteChecksum(f: number, cs: number): void {
    if (f < this.compareFloor || f % this.csEvery !== 0) return;
    const ti = Math.floor(f / this.csEvery) & (CS_RING - 1);
    if (f <= this.lastCsFinal) {
      if (this.csLocalTag[ti] === f) this.compare(f, this.csLocal[ti], cs);
      return;
    }
    this.csRemote[ti] = cs;
    this.csRemoteTag[ti] = f;
  }

  private compare(f: number, l: number, r: number): void {
    if (f <= this.lastCompared || f < this.compareFloor) return;
    this.lastCompared = f;
    if (this.awaitingAck || this.awaitingSnapshot) return;       // an incident is already open
    this.st.checksumsCompared++;
    this.st.lastChecksumFrame = f;
    if (l !== r) this.onDesync(f, l, r);
  }

  private onDesync(f: number, l: number, r: number): void {
    this.st.desyncs++;
    const at = this.frame;
    this.desyncLog.push({ frame: f, local: l, remote: r, at, inputs: this.inputLog(Math.max(0, f - 60), Math.min(at, this.localHead)) });
    if (this.desyncLog.length > 8) this.desyncLog.shift();
    this.emit({ kind: 'desync', frame: f, local: l, remote: r, count: this.st.desyncs, at });
    if (this.st.desyncs > this.maxDesyncs) { this.fail('desync x' + this.st.desyncs); return; }
    if (this.isHost) this.wantSnapshot = true;
    else {
      this.awaitingSnapshot = true;
      this.desyncReqAt = this.now();
      this.tr.sendCtl(encodeFrameMsg(PKT.DESYNC, f, 0, this.epoch));
    }
  }

  /** Runs after rollback + finalize each tick: snapshots are only ever taken from FINAL states. */
  private serviceDesync(now: number): void {
    if (this.isHost) {
      if (this.wantSnapshot || (this.awaitingAck && now - this.snapshotSentAt > 2000)) {
        this.wantSnapshot = false;
        this.sendSnapshot(now);
      }
    } else if (this.awaitingSnapshot && now - this.desyncReqAt > 2000) {
      this.desyncReqAt = now;
      this.tr.sendCtl(encodeFrameMsg(PKT.DESYNC, Math.max(0, this.lastCompared), 0, this.epoch));
    }
  }

  /** Host: send the state of the last confirmed frame. The guest re-simulates from it. */
  private sendSnapshot(now: number): void {
    const F = Math.min(this.rc + 1, this.frame - 1);
    if (F < 0) return;
    const S = this.ring.length;
    if (this.ringTag[F % S] !== F) return;
    const state = this.ring[F % S];
    this.tr.sendCtl(encodeSnapshot(F, hashInts(state), state, this.epoch));
    this.awaitingAck = true;
    this.snapshotSentAt = now;
    this.emit({ kind: 'snapshot-sent', frame: F });
  }

  private onSnapshot(b: Uint8Array): void {
    if (this.isHost) return;
    const snap = decodeSnapshot(b, this.sim.stateInts);
    if (!snap) { this.st.rejected++; return; }
    if (snap.frame < this.floorFrame || hashInts(snap.state) !== snap.checksum) { this.st.rejected++; return; }
    if (!this.awaitingSnapshot && snap.frame <= this.compareFloor) {        // duplicate resend: re-ack
      this.tr.sendCtl(encodeFrameMsg(PKT.RECOVERED, this.frame, 0, this.epoch));
      return;
    }
    const F = snap.frame;
    const from = this.frame;
    this.sim.load(snap.state);
    if (F >= this.frame) {
      // we were behind the host's confirmed frame: jump forward
      this.frame = F;
      while (this.localHead < F + this.delay - 1) {
        this.localHead++;
        this.inLocal[this.localHead & MASK] = this.localHead > 0 ? this.inLocal[(this.localHead - 1) & MASK] : 0;
      }
    } else {
      for (let f = F; f < this.frame; f++) this.simFrame(f);
    }
    this.floorFrame = F;
    this.rollbackTo = INF;
    if (this.rc < F - 1) {
      this.rc = F - 1;
      this.remoteTag[this.rc & MASK] = this.rc;
      this.inRemote[this.rc & MASK] = this.remoteMax >= 0 && this.remoteTag[this.remoteMax & MASK] === this.remoteMax ? this.inRemote[this.remoteMax & MASK] : 0;
      if (this.remoteMax < this.rc) this.remoteMax = this.rc;
      while (this.remoteTag[(this.rc + 1) & MASK] === this.rc + 1) this.rc++;
    }
    const ce = this.csEvery;
    this.lastCsFinal = F % ce === 0 ? F - ce : Math.floor(F / ce) * ce;
    this.lastCompared = F - 1;
    if (F > this.compareFloor) this.compareFloor = F;
    if (F === this.frame) {
      // state[F] is the live state; record its checksum so frame F can still be compared
      if (F % ce === 0) {
        const ti = Math.floor(F / ce) & (CS_RING - 1);
        this.csTent[ti] = this.sim.checksum();
        this.csTentTag[ti] = F;
      }
    }
    this.awaitingSnapshot = false;
    this.tr.sendCtl(encodeFrameMsg(PKT.RECOVERED, this.frame, 0, this.epoch));
    this.emit({ kind: 'recovered', frame: F, from });
  }

  private scheduleDelay(delay: number, atFrame: number): void {
    this.pendingDelay = Math.max(0, Math.min(8, delay | 0));
    this.pendingDelayAt = atFrame;
    this.emit({ kind: 'delay', delay: this.pendingDelay, atFrame });
  }

  // ---- send ---------------------------------------------------------------------------------------------

  private localAdvantage(): number {
    // remote's current frame ~= (its newest input frame - D + 1) + one-way transit in frames
    const rtt = this.rtt.median();
    const oneWay = rtt > 0 ? Math.round(rtt / 2 / FRAME_MS) : 0;
    const remoteNow = this.remoteMax - this.delay + 1 + oneWay;
    return this.frame - remoteNow;
  }

  private sendInputs(now: number): void {
    if (this.localHead < 0) return;
    let start = this.peerAck + 1;
    let n = this.localHead - this.peerAck;
    if (n <= 0) { start = this.localHead; n = 1; }          // keepalive: resend the newest word
    if (n > MAX_INPUTS) n = MAX_INPUTS;
    let flags = this.epoch << FLAG.EPOCH_SHIFT;
    if (this.tr.kind === 'relay') flags |= FLAG.RELAY;
    if (this.away) flags |= FLAG.AWAY;
    if (this.stalledNow) flags |= FLAG.STALLED;
    let csFrame = -1;
    let checksum = 0;
    if (this.lastCsFinal >= 0) {
      // newest final checksum still in the log
      for (let f = this.lastCsFinal; f >= 0 && f > this.lastCsFinal - this.csEvery * 4; f -= this.csEvery) {
        const ti = Math.floor(f / this.csEvery) & (CS_RING - 1);
        if (this.csLocalTag[ti] === f) { csFrame = f; checksum = this.csLocal[ti]; break; }
      }
      if (csFrame >= 0) flags |= FLAG.CHECKSUM;
    }
    const nowMs = Math.floor(now);
    const hold = this.remoteTs >= 0 ? Math.min(0xfffe, Math.max(0, Math.floor(now - this.remoteTsAt))) : NO_ECHO;
    const b = encodeInput({
      flags, seq: this.seq, startFrame: start, ackFrame: this.rc, advantage: this.remoteMax >= this.delay ? this.localAdvantage() : 0,
      tsLow: nowMs & 0xffff, echoTs: this.remoteTs >= 0 ? this.remoteTs : 0, echoHold: hold, csFrame, checksum,
    }, this.inLocal, start, n, MASK);
    if (this.tr0) this.traceRow(this.tr0.sent, [Math.round(now * 10) / 10, this.seq, start + n - 1, n]);
    this.seq = (this.seq + 1) & 0xffff;
    this.tr.sendInput(b);
    this.st.sent++;
    this.st.bytesSent += b.length;
  }

  private updateStatus(now: number): void {
    if (this.status === 'nocontest' || !this.started) return;
    const silence = this.lastRecvAt < 0 ? now - this.startedAt : now - this.lastRecvAt;
    this.status = silence >= this.silentMs ? 'silent' : silence >= this.unstableMs ? 'unstable' : 'running';
  }
}
