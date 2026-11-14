// DYEFIELD — ONLINE host authority loop (CONTRACT_ONLINE §O4.5 steps 2–6, §O5.1, §O6.2–§O6.3, §O7). THREE-free, DOM-free.
//
// The host runs the real MatchWorld + BotDirector for all runners. Each tick: every remote human runner's intent is popped
// from its queue (target depth 2, ADAPTIVE up to 6: +1 per underflow, −1 per 15 s calm; over target + 4 → drop the oldest
// down to the target; empty → repeat the last; 250 ms silent → a neutral
// intent keeping the aim; 3 s silent → the bot takes over until frames resume), the host's own runner takes its local
// intent, the director thinks for every runner whose brain is active, the world steps. The RecordTap captures the paint
// ops and projectile spawns of the tick; the tick's events follow. Every SNAP_EVERY ticks one SNAP goes to everyone (runner
// states + ackSeq per human, the painter hash every HASH_EVERY ticks, the scoreboard with the seat totals every
// SCOREBOARD_EVERY ticks, the records of those ticks). KEYFRAMEs (late join, reconnect, resync) are written right after a
// SNAP. A graceful handoff flushes the SNAP of the current tick, then a HANDOFF, and never steps again.

import type { PlayerIntent } from '../core/types.ts';
import { emptyIntent } from '../core/types.ts';
import { TICK } from '../core/config.ts';
import type { MatchWorld, MatchResult } from '../core/match/world.ts';
import type { BotDirector } from '../core/bots/director.ts';
import type { RosterEntry, BotSkill } from '../core/match/roster.ts';
import type { SimEvent } from '../core/match/events.ts';
import type { RunnerNetState } from '../core/runner.ts';
import { RecordTap } from './records.ts';
import {
  HASH_EVERY, IDLE_KICK_S, INTENT_QUEUE_MAX, INTENT_QUEUE_TARGET, INTENT_SILENT_BOT_S, INTENT_SILENT_NEUTRAL_MS,
  KEYFRAME_MIN_INTERVAL_S, KIND_HANDOFF, KIND_KEYFRAME, KIND_SNAP, LATE_JOIN_MIN_LEFT_S, LOAD_TIMEOUT_S, SCOREBOARD_EVERY,
  SLOT_ALL, SNAP_EVERY, Writer, assembleStateFrame, atlasSig, clampAim, decodeIntents, sanitizeName, deflateRaw, emptyPacked, encodeStateBody, hashU32,
  seqDiff, unpackIntent, writeSnapBody, type Bounds, type PackedIntent, type Scoreboard, type SeatTotals, type SnapHeader,
  type TextMsg, type WireEndRunner, type WireMember, type WireSeat,
} from './proto.ts';
import { lateJoinRunner } from './roster.ts';

export type Send = (data: ArrayBuffer | string) => void;

/** the adaptive jitter buffer's ceiling (ticks: 6 = 100 ms) and the calm stretch (ticks: 15 s) before it shrinks by one */
export const JITTER_TARGET_MAX = 6;
export const JITTER_CALM_TICKS = 900;

interface Totals { painted: number; washes: number; washedCount: number }

export interface HostSeat {
  runner: number;
  /** Room slot holding the runner (−1: none) */
  slot: number;
  name: string;
  /** the host's own seat */
  local: boolean;
  /** the slot's socket is connected */
  conn: boolean;
  /** a human drives the runner now (BotDirector.setHuman on) */
  driven: boolean;
  /** loaded this match (pre-start gate; reconnects re-send it) */
  loaded: boolean;
  /** the atlas signature differed: the runner stays a bot */
  badCourt: boolean;
  queue: Array<{ seq: number; p: PackedIntent }>;
  /** the adaptive jitter-buffer depth (INTENT_QUEUE_TARGET .. JITTER_TARGET_MAX): +1 on every underflow, −1 after JITTER_CALM_TICKS without one */
  target: number;
  calm: number;
  lastEnq: number;
  consumed: number;
  started: boolean;
  last: PlayerIntent;
  lastFrameAt: number;
  focusLost: boolean;
  lastMeaningfulAt: number;
  yawRef: number;
  keyframeAt: number;
  keyframeWanted: boolean;
  /** the wanted keyframe is a join / reconnect one (≥ 1.1 s gap, the relay's floor) — else a resync (≥ 10 s) */
  keyframeJoin: boolean;
  // seat totals (§O7.5)
  acc: Totals;
  base: Totals;
  liveTicks: number;
  /** INTENTS frames received (rate read-back) */
  frames: number;
  framesAt: number[];
  /** read-back: metres the runner walked while a human drove it (a respawn / teleport jump is not counted) */
  movedM: number;
  lastX: number;
  lastZ: number;
}

export interface HostOpts {
  world: MatchWorld;
  director: BotDirector;
  roster: RosterEntry[];
  seats: WireSeat[];
  localPid: number;
  localSlot: number;
  matchNo: number;
  seed: number;
  migrations: number;
  skill: BotSkill;
  durationS: number;
  bounds: Bounds | null;
  send: Send;
  now: number;
  /** names / devices of the room's members (slot → member) */
  members: readonly WireMember[];
  /** a migration: the world is already running (no load gate), the first SNAP is sent at once (fresh) */
  restored?: { lastTick: number; seats?: Array<{ slot: number; runner: number; human: boolean; liveTicks: number; painted: number; washes: number; washedCount: number }> };
  /** dev: ?idlekick=<s> */
  idleKickS?: number;
}

export interface HostStats {
  snaps: number; snapBytes: number; keyframes: number; keyframeBytes: number; handoffs: number; queueDrops: number;
  underflows: number; neutralTicks: number; takeovers: number; kicks: number; ticks: number; tickMs: number[];
  intentFrames: number; hashChecks: number;
  /** wall clock (ms) of the last 121 host ticks: the sim's real tick rate (__NET__ hostTps) */
  tickAt: number[];
  /** the longest wall-clock gap (ms) between two host ticks so far (a page stall) and how many were > 1 s */
  maxGapMs: number; stalls1s: number;
  /** [host tick, gap ms] of the first 24 gaps over 400 ms */
  bigGaps: Array<[number, number]>;
  /** live ticks spent with n human-driven seats (index n, 0..8): "8 humans seated at once for ≥ 60 s" (§O13.3 B) */
  humanTicks: number[];
}

const neutralFrom = (src: PlayerIntent, out: PlayerIntent): PlayerIntent => {
  out.moveX = 0; out.moveZ = 0; out.jump = false; out.fire = false; out.slick = false; out.sub = false; out.special = false;
  out.yaw = src.yaw; out.pitch = src.pitch; out.hasAim = src.hasAim; out.aimX = src.aimX; out.aimY = src.aimY; out.aimZ = src.aimZ;
  return out;
};

export class NetHost {
  readonly world: MatchWorld;
  readonly director: BotDirector;
  readonly roster: RosterEntry[];
  readonly localPid: number;
  readonly localSlot: number;
  readonly matchNo: number;
  readonly seed: number;
  readonly migrations: number;
  readonly skill: BotSkill;
  readonly durationS: number;
  readonly tap = new RecordTap();
  /** seat per runner (null: a bot from the start / nobody holds it) */
  readonly seats: Array<HostSeat | null>;
  readonly stats: HostStats = { snaps: 0, snapBytes: 0, keyframes: 0, keyframeBytes: 0, handoffs: 0, queueDrops: 0, underflows: 0, neutralTicks: 0, takeovers: 0, kicks: 0, ticks: 0, tickMs: [], intentFrames: 0, hashChecks: 0, tickAt: [], maxGapMs: 0, stalls1s: 0, bigGaps: [], humanTicks: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
  /** the countdown runs (every seated human loaded, or LOAD_TIMEOUT_S passed) */
  running: boolean;
  /** handed off / replaced: never steps again */
  stopped = false;
  ended = false;
  private endSentAt = -1;
  private readonly send: Send;
  private readonly bounds: Bounds | null;
  private readonly w = new Writer(65536);
  private lastSnapTick: number;
  private readonly rosterAt: number;
  private readonly idleKickMs: number;
  private readonly events: SimEvent[] = [];
  private readonly tickEv: SimEvent[] = [];
  private readonly view: SimEvent[] = [];
  private readonly packed = emptyPacked();
  private readonly mySig: number;
  private freshNext = false;
  private names = new Map<number, string>();
  /** host-side per-tick log of the seat runners' counters (probe_net checks the seat totals against it) */
  readonly seatLog: Array<{ tick: number; runner: number; driven: boolean; painted: number; washes: number; washedCount: number }> | null = null;

  constructor(o: HostOpts) {
    this.world = o.world;
    this.director = o.director;
    this.roster = o.roster;
    this.localPid = o.localPid;
    this.localSlot = o.localSlot;
    this.matchNo = o.matchNo;
    this.seed = o.seed;
    this.migrations = o.migrations;
    this.skill = o.skill;
    this.durationS = o.durationS;
    this.bounds = o.bounds;
    this.send = o.send;
    this.rosterAt = o.now;
    this.idleKickMs = (o.idleKickS && o.idleKickS > 0 ? o.idleKickS : IDLE_KICK_S) * 1000;
    this.mySig = atlasSig(o.world.painter.atlas);
    for (const m of o.members) this.names.set(m.slot, m.name);
    this.seats = o.roster.map(() => null);
    for (const s of o.seats) {
      const local = s.slot === o.localSlot;
      const m = o.members.find((x) => x.slot === s.slot);
      this.seats[s.runner] = this.mkSeat(s.runner, s.slot, o.roster[s.runner]?.name ?? '', local, local || !!m?.conn || !o.restored, o.now);
    }
    this.lastSnapTick = o.restored ? o.restored.lastTick : o.world.tick;
    this.running = !!o.restored;
    // every seated human is human-driven from the start (a remote one goes bot after 3 s of silence)
    for (const s of this.seats) if (s) this.setDriven(s, s.conn, false);
    if (o.restored) {
      for (const s of this.seats) if (s) s.loaded = true;            // every seat was in the match already
      for (const rs of o.restored.seats ?? []) {
        const s = this.seats[rs.runner];
        if (!s || s.slot !== rs.slot) continue;
        // the scoreboard / HANDOFF totals include the human-driven time up to that state: accumulate from here
        s.acc = { painted: rs.painted, washes: rs.washes, washedCount: rs.washedCount };
        const r = this.world.runners[rs.runner];
        s.base = { painted: r.painted, washes: r.washes, washedCount: r.washedCount };
        s.liveTicks = rs.liveTicks;
      }
      this.freshNext = true;
    }
    this.tap.install(this.world.painter, this.world.projectiles);
    if ((globalThis as { __DF_NET_SEATLOG__?: boolean }).__DF_NET_SEATLOG__) (this as { seatLog: unknown }).seatLog = [];
  }

  private mkSeat(runner: number, slot: number, name: string, local: boolean, conn: boolean, now: number): HostSeat {
    return {
      runner, slot, name, local, conn, driven: false, loaded: local, badCourt: false, queue: [], target: INTENT_QUEUE_TARGET, calm: 0, lastEnq: -1, consumed: 0,
      started: false, last: emptyIntent(), lastFrameAt: now, focusLost: false, lastMeaningfulAt: now, yawRef: 0,
      keyframeAt: -1e12, keyframeWanted: false, keyframeJoin: false, acc: { painted: 0, washes: 0, washedCount: 0 }, base: { painted: 0, washes: 0, washedCount: 0 },
      liveTicks: 0, frames: 0, framesAt: [], movedM: 0, lastX: NaN, lastZ: NaN,
    };
  }

  dispose(): void {
    this.tap.uninstall();
    this.stopped = true;
  }

  // ───────────────────────────── seats ─────────────────────────────
  seatOfSlot(slot: number): HostSeat | null {
    for (const s of this.seats) if (s && s.slot === slot) return s;
    return null;
  }

  humanRunners(): Set<number> {
    const out = new Set<number>();
    for (const s of this.seats) if (s && s.slot >= 0) out.add(s.runner);
    return out;
  }

  private totals(s: HostSeat): Totals {
    const r = this.world.runners[s.runner];
    if (!s.driven) return { ...s.acc };
    return { painted: s.acc.painted + (r.painted - s.base.painted), washes: s.acc.washes + (r.washes - s.base.washes), washedCount: s.acc.washedCount + (r.washedCount - s.base.washedCount) };
  }

  seatTotals(runner: number): SeatTotals | null {
    const s = this.seats[runner];
    if (!s || s.slot < 0) return null;
    const t = this.totals(s);
    return { slot: s.slot, human: s.driven && s.conn, liveTicks: s.liveTicks, painted: t.painted, washes: t.washes, washedCount: t.washedCount };
  }

  /** human ⇄ bot for a seat's runner (BotDirector.setHuman + the seat-total accumulators); broadcasts `seat` */
  private setDriven(s: HostSeat, on: boolean, broadcast = true): void {
    if (s.badCourt) on = false;
    if (on === s.driven) return;
    const r = this.world.runners[s.runner];
    if (on) {
      s.base = { painted: r.painted, washes: r.washes, washedCount: r.washedCount };
      this.director.setHuman(s.runner, true);
      s.started = false;
      s.queue.length = 0;
    } else {
      s.acc.painted += r.painted - s.base.painted;
      s.acc.washes += r.washes - s.base.washes;
      s.acc.washedCount += r.washedCount - s.base.washedCount;
      this.director.setHuman(s.runner, false);
      this.stats.takeovers++;
    }
    s.driven = on;
    if (broadcast) this.sendText({ t: 'seat', runner: s.runner, slot: s.slot >= 0 ? s.slot : null, name: r.name, human: on });
  }

  private sendText(m: TextMsg): void { this.send(JSON.stringify(m)); }

  /** the Room's member list changed (names, connections, leavers) */
  setMembers(members: readonly WireMember[], now: number): void {
    for (const m of members) this.names.set(m.slot, m.name);
    for (const s of this.seats) {
      if (!s || s.local || s.slot < 0) continue;
      const m = members.find((x) => x.slot === s.slot);
      if (!m) { this.leave(s); continue; }
      if (s.conn !== m.conn) this.onPeer(s.slot, m.conn, now);
    }
  }

  /** a seat's player LEFT the room: the runner is a bot from now on and no seat holds it (end.runners[].seat = null) */
  private leave(s: HostSeat): void {
    this.setDriven(s, false);
    s.conn = false;
    this.seats[s.runner] = null;
  }

  onPeer(slot: number, conn: boolean, now: number): void {
    const s = this.seatOfSlot(slot);
    if (!s || s.local) return;
    s.conn = conn;
    if (!conn) { this.setDriven(s, false); s.queue.length = 0; }
    else s.lastFrameAt = now;
  }

  // ───────────────────────────── incoming ─────────────────────────────
  onIntents(buf: ArrayBuffer, now: number): void {
    const f = decodeIntents(buf);
    if (!f) return;
    const s = this.seatOfSlot(f.slot);
    if (!s || s.local) return;
    this.stats.intentFrames++;
    s.frames++;
    s.framesAt.push(now);
    if (s.framesAt.length > 120) s.framesAt.shift();
    s.lastFrameAt = now;
    s.focusLost = (f.flags & 1) !== 0;
    if (!s.conn) s.conn = true;
    if (!s.driven && s.loaded && !s.badCourt) this.setDriven(s, true);
    // unwrap the 16-bit seqs against the last enqueued one
    const ref = s.lastEnq >= 0 ? s.lastEnq : s.consumed;
    for (let i = 0; i < f.list.length; i++) {
      const seq16 = (f.firstSeq + i) & 0xffff;
      const seq = ref + seqDiff(seq16, ref & 0xffff);
      if (seq <= s.consumed || seq <= s.lastEnq) continue;   // a resend after a migration, or a duplicate
      s.queue.push({ seq, p: { ...f.list[i] } });
      s.lastEnq = seq;
    }
  }

  /** `loaded {matchNo, atlasSig}` from a slot: the pre-start gate, a late join, a reconnect or a returning old host */
  onLoaded(slot: number, sig: number, now: number): void {
    let s = this.seatOfSlot(slot);
    if (sig !== this.mySig) {
      if (s) { s.badCourt = true; this.setDriven(s, false); }
      this.sendText({ t: 'seat', runner: s ? s.runner : -1, slot: null, name: this.names.get(slot) ?? '', human: false });
      return;
    }
    if (!s && this.running) {
      // late join (code rooms; quick rooms via late fill): take over a bot runner while ≥ 45 s are left
      const left = this.world.phase === 'countdown' ? Infinity : this.world.timeLeft;
      if (this.world.phase === 'ended' || left < LATE_JOIN_MIN_LEFT_S) return;
      const id = lateJoinRunner(this.roster, this.humanRunners(), this.world.mode);
      if (id < 0) return;
      s = this.mkSeat(id, slot, this.names.get(slot) ?? '', false, true, now);
      this.seats[id] = s;
      const r = this.world.runners[id];
      (r as unknown as { name: string }).name = sanitizeName(this.names.get(slot) ?? '', slot);
    }
    if (!s) return;
    s.loaded = true;
    s.conn = true;
    s.lastFrameAt = now;
    if (this.running) {
      this.setDriven(s, true, false);
      // the seat message renames the runner everywhere (late join) and re-seats a reconnect
      this.sendText({ t: 'seat', runner: s.runner, slot: s.slot, name: this.world.runners[s.runner].name, human: true });
      s.keyframeWanted = true;
      s.keyframeJoin = true;                                 // a join / reconnect keyframe: only the relay's 1 s floor
    }
  }

  /** a late joiner's runner, reserved when its socket joins (driven + KEYFRAME on its `loaded`) */
  reserve(runner: number, slot: number, name: string, now: number): void {
    if (this.seats[runner]) return;
    const nm = sanitizeName(name || this.names.get(slot) || '', slot);
    const s = this.mkSeat(runner, slot, nm, false, true, now);
    this.seats[runner] = s;
    (this.world.runners[runner] as unknown as { name: string }).name = nm;
    this.sendText({ t: 'seat', runner, slot, name: this.world.runners[runner].name, human: false });
  }

  /** a client's painter hash differed: a KEYFRAME, at most one per KEYFRAME_MIN_INTERVAL_S per client */
  onResync(slot: number): void {
    const s = this.seatOfSlot(slot);
    if (s && !s.local) s.keyframeWanted = true;
  }

  /** the pre-start gate: every seated human loaded, or LOAD_TIMEOUT_S after the roster */
  private checkStart(now: number): void {
    if (this.running) return;
    let all = true;
    for (const s of this.seats) if (s && s.conn && !s.loaded) all = false;
    if (all || now - this.rosterAt >= LOAD_TIMEOUT_S * 1000) {
      this.running = true;
      for (const s of this.seats) if (s && !s.loaded) this.setDriven(s, false);   // a late loader joins as a late joiner
    }
  }

  // ───────────────────────────── the tick ─────────────────────────────
  /** pop runner s's intent for this tick into `out` (§O5.1) */
  private pop(s: HostSeat, out: PlayerIntent, now: number): void {
    const silent = now - s.lastFrameAt;
    if (silent > INTENT_SILENT_BOT_S * 1000) { this.setDriven(s, false); return; }
    if (silent > INTENT_SILENT_NEUTRAL_MS) { neutralFrom(s.last, out); this.stats.neutralTicks++; return; }
    const q = s.queue;
    // §O5.1 target depth 2, over 6 → drop to 2 — ADAPTIVE (CHANGED(ONLINE), measured: a 40 ms arrival jitter gave 0.14 m p95
    // prediction error with the fixed 2 / 6): every underflow deepens this seat's buffer by one tick (the cushion after a
    // refill), up to JITTER_TARGET_MAX; the over-limit follows (target + 4); a long calm stretch lets it shrink again
    const tgt = s.target;
    if (q.length > tgt + (INTENT_QUEUE_MAX - INTENT_QUEUE_TARGET)) {
      const drop = q.length - tgt;
      s.consumed = q[drop - 1].seq;
      unpackIntent(q[drop - 1].p, s.last);
      q.splice(0, drop);
      this.stats.queueDrops += drop;
      s.calm = 0;
    }
    if (!s.started) {
      if (q.length >= tgt) s.started = true;
      else { Object.assign(out, s.last); return; }
    }
    if (!q.length) {
      s.started = false;
      this.stats.underflows++;
      if (s.target < JITTER_TARGET_MAX) s.target++;
      s.calm = 0;
      Object.assign(out, s.last);
      return;
    }
    if (++s.calm >= JITTER_CALM_TICKS && s.target > INTENT_QUEUE_TARGET) { s.target--; s.calm = 0; }
    const it = q.shift()!;
    s.consumed = it.seq;
    unpackIntent(it.p, s.last);
    clampAim(s.last, this.bounds);                            // §O8: the host re-applies the client's clamps
    Object.assign(out, s.last);
    // idle: a movement axis, a button, or a yaw change > 0.05 rad is meaningful
    const p = it.p;
    if (p.mx !== 0 || p.mz !== 0 || (p.buttons & 31) !== 0 || Math.abs(((s.last.yaw - s.yawRef + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > 0.05) {
      s.lastMeaningfulAt = now;
      s.yawRef = s.last.yaw;
    }
  }

  /** one host tick (false: the countdown has not begun yet, or the host stopped) */
  tick(intents: PlayerIntent[], local: PlayerIntent, now: number): boolean {
    if (this.stopped) return false;
    this.checkStart(now);
    if (!this.running) return false;
    const w = this.world;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    for (const s of this.seats) {
      if (!s || s.local || !s.driven) continue;
      if (this.ended) { neutralFrom(s.last, intents[s.runner]); continue; }   // after the horn: no intents flow (post)
      this.pop(s, intents[s.runner], now);
      if (w.phase === 'live' && now - s.lastMeaningfulAt > this.idleKickMs && s.slot >= 0) {
        this.sendText({ t: 'kick', slot: s.slot, why: 'idle' });
        this.stats.kicks++;
        s.lastMeaningfulAt = now;                           // one kick; the Room closes the socket (peer → bot takeover)
      }
    }
    const me = this.seats[this.localPid];
    if (me && me.driven) Object.assign(intents[this.localPid], local);
    const liveBefore = w.phase === 'live';
    this.tap.offset = Math.max(1, Math.min(255, w.tick + 1 - this.lastSnapTick));
    this.director.think(intents);
    w.step(intents);
    this.tickEv.length = 0;
    w.drainEvents(this.tickEv);
    this.tap.addEvents(this.tickEv);
    for (const e of this.tickEv) this.view.push(e);
    if (liveBefore) {
      let n = 0;
      for (const s of this.seats) {
        if (!s) continue;
        const r = w.runners[s.runner];
        if (s.driven) {
          s.liveTicks++;
          n++;
          // read-back only (never feeds the sim): the human-driven path length; a respawn / teleport jump (> 3 m a tick) is not walking
          if (!Number.isNaN(s.lastX)) { const d = Math.hypot(r.x - s.lastX, r.z - s.lastZ); if (d < 3) s.movedM += d; }
        }
        s.lastX = r.x; s.lastZ = r.z;
      }
      this.stats.humanTicks[Math.min(9, n)]++;
    }
    if (this.seatLog) {
      for (const s of this.seats) {
        if (!s || s.local) continue;
        const r = w.runners[s.runner];
        this.seatLog.push({ tick: w.tick, runner: s.runner, driven: s.driven && liveBefore, painted: r.painted, washes: r.washes, washedCount: r.washedCount });
      }
    }
    this.stats.ticks++;
    const justEnded = w.phase === 'ended' && !this.ended;
    if (justEnded) this.ended = true;
    const tailOver = this.ended && this.endSentAt >= 0 && now - this.endSentAt > 2000;
    if (!tailOver && (w.tick % SNAP_EVERY === 0 || justEnded || this.freshNext)) this.snap(now);
    if (justEnded) { this.sendEnd(); this.endSentAt = now; }
    if (typeof performance !== 'undefined') { this.stats.tickMs.push(performance.now() - t0); if (this.stats.tickMs.length > 600) this.stats.tickMs.shift(); }
    const prevAt = this.stats.tickAt.length ? this.stats.tickAt[this.stats.tickAt.length - 1] : now;
    const gap = now - prevAt;
    if (gap > this.stats.maxGapMs) this.stats.maxGapMs = gap;
    if (gap > 1000) this.stats.stalls1s++;
    if (gap > 400 && this.stats.bigGaps.length < 24) this.stats.bigGaps.push([this.stats.ticks, Math.round(gap)]);
    this.stats.tickAt.push(now);
    if (this.stats.tickAt.length > 121) this.stats.tickAt.shift();
    return true;
  }

  /** read-back: the host's real sim tick rate over its last 120 ticks (ticks per wall second) */
  tps(): number {
    const a = this.stats.tickAt;
    return a.length > 20 && a[a.length - 1] > a[0] ? Math.round(((a.length - 1) * 1000) / (a[a.length - 1] - a[0]) * 10) / 10 : 0;
  }

  /** read-back: every seated runner (human-driven now, metres walked, painted, washes) for the browser scenarios */
  seatReport(): Array<{ runner: number; slot: number; human: boolean; movedM: number; painted: number; washes: number; liveTicks: number }> {
    const out: Array<{ runner: number; slot: number; human: boolean; movedM: number; painted: number; washes: number; liveTicks: number }> = [];
    for (const s of this.seats) {
      if (!s) continue;
      const r = this.world.runners[s.runner];
      out.push({ runner: s.runner, slot: s.slot, human: s.driven, movedM: Math.round(s.movedM * 10) / 10, painted: Math.round(r.painted * 10) / 10, washes: r.washes, liveTicks: s.liveTicks });
    }
    return out;
  }

  /** this tick's events for the host's own view */
  drain(out: SimEvent[]): void {
    for (const e of this.view) out.push(e);
    this.view.length = 0;
  }

  // ───────────────────────────── outgoing ─────────────────────────────
  private header(fresh: boolean): SnapHeader {
    const w = this.world;
    const hash = w.tick % HASH_EVERY === 0 || fresh ? hashU32(w.painter.hash()) : null;
    if (hash !== null) this.stats.hashChecks++;
    return {
      tick: w.tick, prevTick: this.lastSnapTick, phase: w.phase, ticksLeft: Math.round(w.timeLeft / TICK),
      countdownTicks: Math.round(w.countdown / TICK), hash, fresh,
    };
  }

  private ackList(): number[] {
    // a remote seat's last consumed seq (kept while a bot holds it: the client's next baseline), 0 for bots / the host
    return this.seats.map((s) => (s && !s.local ? s.consumed & 0xffff : 0));
  }

  scoreboard(): Scoreboard {
    const w = this.world;
    return {
      scores: w.scores().slice(),
      runners: w.runners.map((r) => ({ washes: r.washes, washedCount: r.washedCount, painted: r.painted, shots: r.shots, seat: this.seatTotals(r.id) })),
    };
  }

  /** encode + send one SNAP of the current tick */
  snap(_now: number): void {
    const w = this.world;
    const fresh = this.freshNext;
    this.freshNext = false;
    const h = this.header(fresh);
    const sb = w.tick % SCOREBOARD_EVERY === 0 || fresh || w.phase === 'ended' ? this.scoreboard() : null;
    const out = this.w.reset();
    out.u8(KIND_SNAP); out.u8(SLOT_ALL); out.u32(w.tick);
    writeSnapBody(out, h, w.runners, this.ackList(), sb);
    const recs = this.tap.take();
    out.u16(recs.n);
    out.bytes(recs.bytes);
    const buf = out.take();
    this.send(buf);
    this.stats.snaps++;
    this.stats.snapBytes += buf.byteLength;
    this.lastSnapTick = w.tick;
    // keyframes are written right after a SNAP: no record falls between them
    for (const s of this.seats) {
      if (!s || !s.keyframeWanted || s.local || s.slot < 0) continue;
      if (_now - s.keyframeAt < (s.keyframeJoin ? 1100 : KEYFRAME_MIN_INTERVAL_S * 1000)) continue;
      s.keyframeWanted = false;
      s.keyframeJoin = false;
      s.keyframeAt = _now;
      this.keyframe(s.slot);
    }
  }

  /** a KEYFRAME for `slot`: the state is captured now (synchronously); the paint bytes are deflated, then sent */
  private keyframe(slot: number): void {
    const w = this.world;
    const team = w.painter.atlas.team.slice();
    const hash = hashU32(w.painter.hash());
    const h: SnapHeader = { ...this.header(false), prevTick: w.tick, hash: null };
    const body = encodeStateBody(h, w.runners, this.ackList(), this.scoreboard(), w.runners.map((r) => r.netState()));
    const tick = w.tick;
    void deflateRaw(team).then((d) => {
      const buf = assembleStateFrame(KIND_KEYFRAME, slot, tick, hash, d, body, null);
      this.send(buf);
      this.stats.keyframes++;
      this.stats.keyframeBytes += buf.byteLength;
    }, (e: unknown) => { console.warn('[dyefield/net] keyframe deflate failed', e); });
  }

  /** the HANDOFF JSON tail */
  private handoffJson(): Record<string, unknown> {
    return {
      roster: this.roster, matchNo: this.matchNo, seed: this.seed, migrations: this.migrations, botSkill: this.skill,
      durationS: this.durationS, world: this.world.netState(),
      seats: this.seats.filter((s): s is HostSeat => !!s).map((s) => ({ slot: s.slot, runner: s.runner, human: s.driven, ...this.totals(s), liveTicks: s.liveTicks })),
    };
  }

  /**
   * Graceful handoff (§O6.2, §O3.2): the SNAP of the current tick first (its records, even if fewer than 3 ticks are
   * pending), then the HANDOFF of the same tick (encoded synchronously: no paint bytes), then `handoff`. Never steps again.
   */
  handoff(): void {
    if (this.stopped) return;
    const w = this.world;
    if (w.tick !== this.lastSnapTick || this.tap.count > 0) this.snap(0);
    const hash = hashU32(w.painter.hash());
    const h: SnapHeader = { ...this.header(false), prevTick: w.tick, hash: null };
    const ext: RunnerNetState[] = w.runners.map((r) => r.netState());
    const body = encodeStateBody(h, w.runners, this.ackList(), this.scoreboard(), ext);
    const buf = assembleStateFrame(KIND_HANDOFF, SLOT_ALL, w.tick, hash, null, body, this.handoffJson());
    this.send(buf);
    this.sendText({ t: 'handoff' });
    this.stats.handoffs++;
    this.stopped = true;
  }

  /** the `end` message (§O3.3) with the seat totals of every runner */
  private sendEnd(): void {
    const w = this.world;
    const runners: WireEndRunner[] = w.runners.map((r) => {
      const s = this.seats[r.id];
      return {
        id: r.id, name: r.name, team: r.team, slot: s && s.slot >= 0 ? s.slot : null, washes: r.washes, washedCount: r.washedCount,
        painted: r.painted, shots: r.shots, seat: this.seatTotals(r.id),
      };
    });
    this.sendText({ t: 'end', matchNo: this.matchNo, result: w.result as MatchResult, runners, migrations: this.migrations, voided: false });
  }

  /** read-back: per remote human the median INTENTS rate (Hz) over its last frames */
  intentRates(): Array<{ runner: number; slot: number; hz: number; driven: boolean; frames: number; target: number }> {
    const out: Array<{ runner: number; slot: number; hz: number; driven: boolean; frames: number; target: number }> = [];
    for (const s of this.seats) {
      if (!s || s.local) continue;
      const a = s.framesAt;
      const gaps: number[] = [];
      for (let i = 1; i < a.length; i++) gaps.push(a[i] - a[i - 1]);
      gaps.sort((x, y) => x - y);
      const med = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
      out.push({ runner: s.runner, slot: s.slot, hz: med > 0 ? 1000 / med : 0, driven: s.driven, frames: s.frames, target: s.target });
    }
    return out;
  }
}
