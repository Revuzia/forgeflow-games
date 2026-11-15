// DYEFIELD — ONLINE client (CONTRACT_ONLINE §O5.2–§O5.6, §O7.1–§O7.2). THREE-free, DOM-free.
//
// The client builds the SAME MatchWorld as the host (the container world) and never steps it. Each client tick: the local
// intent is quantized (both sides step the same dequantized values), queued with seq++, the local runner is predicted
// with it (predict.ts), the cosmetic projectiles fly one tick; every 3 ticks one INTENTS frame carries the 3 newest
// intents (up to 6 after a hitch). Each SNAP: paint ops apply on arrival, in order (a 'splat' event is synthesized per
// sphere); PSPAWN feeds the cosmetic pool; events queue for the render tick; the painter hash is compared when present
// (a mismatch → resync → KEYFRAME); the local runner reconciles; the remote runners go to the interpolation buffer; the
// clock, phase and scores follow the header and the scoreboard.
//
// KEYFRAME (late join, reconnect, resync): atlas.team ← inflate(bytes), recount, the view rebuilds its paint textures;
// every runner from the snapshot + extended blocks; then the paint records of every SNAP after the keyframe tick that were
// already applied are re-applied on top (the client never stops applying SNAPs while it waits, so nothing freezes).

import type { PlayerIntent } from '../core/types.ts';
import { TICK } from '../core/config.ts';
import type { MatchWorld } from '../core/match/world.ts';
import type { RosterEntry } from '../core/match/roster.ts';
import type { SimEvent } from '../core/match/events.ts';
import type { Painter } from '../core/paint/painter.ts';
import { KIND_CLOUD, KIND_JELLY } from '../core/combat/projectiles.ts';
import { applyPaint } from './records.ts';
import { Interp, writeRunner } from './interp.ts';
import { CosmeticPool, LOCAL_EVENTS, LocalPredictor, PredictPainter, isKitKind, variantsOf } from './predict.ts';
import {
  INTENT_MAX_PER_FRAME, INTENT_QUEUE_TARGET, INTENT_TICKS_PER_FRAME, KIND_INTENTS, KIND_KEYFRAME, KIND_SNAP, Writer, decodeSnap, decodeStateFrame,
  emptyPacked, encodeIntents, hashU32, inflateRaw, packIntent, seqDiff, unpackIntent, type Bounds, type DecodedSnap,
  type EventRec, type PackedIntent, type PaintRec, type Scoreboard, type SeatTotals, type StateFrame, type TextMsg,
} from './proto.ts';
import type { Send } from './host.ts';

interface QEvent { tick: number; e: SimEvent }

export interface ClientOpts {
  world: MatchWorld;
  roster: RosterEntry[];
  localPid: number;
  slot: number;
  bounds: Bounds | null;
  send: Send;
  /** true for a client that was seated before the match began (its clean court is the host's); false → keyframe first */
  fromStart: boolean;
  /** the view rebuilds its paint texture / minimap after a KEYFRAME rewrote atlas.team */
  onCourtReload?: () => void;
}

export interface ClientStats {
  snaps: number; bytes: number; gaps: number; desyncs: number; flipMismatch: number; keyframes: number; resyncSent: number;
  intentFrames: number; hashChecks: number; hashOk: number; recordsApplied: number; reapplied: number;
}

const SNAP_LOG_TICKS = 600;

export class NetClient {
  readonly world: MatchWorld;
  readonly localPid: number;
  readonly slot: number;
  readonly painter: Painter;
  readonly pred: LocalPredictor;
  readonly cosmetic: CosmeticPool;
  readonly interp = new Interp();
  readonly stats: ClientStats = { snaps: 0, bytes: 0, gaps: 0, desyncs: 0, flipMismatch: 0, keyframes: 0, resyncSent: 0, intentFrames: 0, hashChecks: 0, hashOk: 0, recordsApplied: 0, reapplied: 0 };
  /** the paint mirror equals the host's (false until a KEYFRAME after a gap / late join / hash mismatch) */
  synced: boolean;
  /** the last applied SNAP's tick */
  lastTick = 0;
  /** the latest SNAP (for a migration restore) */
  last: DecodedSnap | null = null;
  /** the latest scoreboard */
  board: Scoreboard | null = null;
  /** seat totals per runner from the latest scoreboard */
  readonly seatTotals: Array<SeatTotals | null>;
  /** highest SNAP tick seen */
  seq = 0;
  private readonly send: Send;
  private readonly bounds: Bounds | null;
  private readonly w = new Writer(512);
  private readonly packed: PackedIntent[] = [];
  private lastSent = 0;
  private sinceSend = 0;
  private readonly queue: QEvent[] = [];
  private readonly out: SimEvent[] = [];
  private readonly log: DecodedSnap[] = [];
  private waitingKeyframe = false;
  private resyncAt = -1e12;
  private readonly onCourtReload: (() => void) | null;
  /** focus lost (hidden / blurred): flags b0 */
  focusLost = false;
  private readonly it: PlayerIntent = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, fire: false, slick: false, sub: false, special: false, hasAim: false, aimX: 0, aimY: 0, aimZ: 0 };
  /** the render tick of the last frame */
  renderTick = 0;
  /** §O5.2: client ↔ host RTT (ms, EWMA): intent seq sent → the first SNAP acknowledging it, less the host's queue delay */
  hostRttMs: number | null = null;
  private readonly sentAt: Array<{ seq: number; at: number }> = [];

  constructor(o: ClientOpts) {
    this.world = o.world;
    this.localPid = o.localPid;
    this.slot = o.slot;
    this.painter = o.world.painter;
    this.send = o.send;
    this.bounds = o.bounds;
    this.onCourtReload = o.onCourtReload ?? null;
    this.synced = o.fromStart;
    const v = variantsOf(o.roster);
    const pp = new PredictPainter(this.painter);
    this.cosmetic = new CosmeticPool(o.world, v, pp);
    this.cosmetic.localPid = o.localPid;
    this.pred = new LocalPredictor(o.world, o.localPid, o.roster, v, o.world.projectiles, pp);
    this.seatTotals = o.roster.map(() => null);
    if (!o.fromStart) this.requestResync(0);
  }

  // ───────────────────────────── outgoing ─────────────────────────────
  /** one client tick: quantize + queue + predict the local intent, fly the cosmetic projectiles, send every 3 ticks */
  tick(local: PlayerIntent, _now: number): void {
    this.seq++;
    const p = emptyPacked();
    packIntent(local, p, this.bounds);
    unpackIntent(p, this.it);
    this.packed.push(p);
    if (this.packed.length > 240) this.packed.shift();
    if (this.pred.active && this.world.phase !== 'ended') {
      const ht = this.pred.hostTickOf(this.seq);
      if (Number.isFinite(ht)) this.world.tick = Math.max(this.world.tick, ht);
    }
    // before the host's first SNAP nothing is predicted or queued (the host consumes nothing yet: a load-time backlog of
    // intents would be re-stepped at once on the first baseline)
    if (this.stats.snaps > 0) this.pred.tick(this.seq, this.it, this.world.projectiles);
    this.cosmetic.step(this.seq);
    // intents flow once the host runs (its first SNAP) and stop at the horn — none are wasted on the load / roster wait
    // or after the match (the relay drops them in `post`, but every incoming frame is counted)
    if (this.stats.snaps > 0 && this.world.phase !== 'ended' && ++this.sinceSend >= INTENT_TICKS_PER_FRAME) this.flush();
  }

  /** the (exact, dequantized) intent of the last tick — what the host will step */
  get lastIntent(): PlayerIntent { return this.it; }

  /** send every unsent intent (≤ 6 per frame; the newest win) */
  flush(): void {
    this.sinceSend = 0;
    const unsent = this.seq - this.lastSent;
    if (unsent <= 0) return;
    const n = Math.min(INTENT_MAX_PER_FRAME, unsent, this.packed.length);
    const list = this.packed.slice(this.packed.length - n);
    const first = this.seq - n + 1;
    this.send(encodeIntents(this.w, this.slot, first & 0xffff, list, this.focusLost ? 1 : 0));
    this.lastSent = this.seq;
    this.stats.intentFrames++;
    this.sentAt.push({ seq: this.seq, at: typeof performance !== 'undefined' ? performance.now() : 0 });
    if (this.sentAt.length > 64) this.sentAt.shift();
  }

  /** a keep-alive while hidden / blurred (§O5.2): one neutral intent with a fresh seq, flags b0 */
  keepAlive(local: PlayerIntent): void {
    if (this.world.phase === 'ended' || this.stats.snaps === 0) return;
    const n = { ...local, moveX: 0, moveZ: 0, jump: false, fire: false, slick: false, sub: false, special: false };
    this.seq++;
    const p = emptyPacked();
    packIntent(n, p, this.bounds);
    this.packed.push(p);
    if (this.packed.length > 240) this.packed.shift();
    unpackIntent(p, this.it);
    this.pred.tick(this.seq, this.it, this.world.projectiles);
    this.send(encodeIntents(this.w, this.slot, this.seq & 0xffff, [p], 1));
    this.lastSent = this.seq;
    this.stats.intentFrames++;
  }

  /** after a host change: every unacknowledged intent again, to the new host (it drops the ones it consumed) */
  resendUnacked(): void {
    const ack = this.pred.ack;
    const unacked = Math.min(this.packed.length, Math.max(0, this.seq - Math.max(0, ack)));
    let first = this.seq - unacked + 1;
    while (first <= this.seq) {
      const n = Math.min(INTENT_MAX_PER_FRAME, this.seq - first + 1);
      const off = this.packed.length - (this.seq - first + 1);
      this.send(encodeIntents(this.w, this.slot, first & 0xffff, this.packed.slice(off, off + n), this.focusLost ? 1 : 0));
      first += n;
    }
    this.lastSent = this.seq;
  }

  private requestResync(now: number): void {
    this.synced = false;
    if (this.waitingKeyframe && now - this.resyncAt < 3000) return;
    this.waitingKeyframe = true;
    this.resyncAt = now;
    this.stats.resyncSent++;
    const m: TextMsg = { t: 'resync', tick: this.lastTick, myHash: hashU32(this.painter.hash()) };
    this.send(JSON.stringify(m));
  }

  // ───────────────────────────── incoming ─────────────────────────────
  onBinary(buf: ArrayBuffer, now: number): void {
    const k = buf.byteLength ? new Uint8Array(buf)[0] : 0;
    if (k === KIND_SNAP) this.onSnap(buf, now);
    else if (k === KIND_KEYFRAME) void this.onKeyframe(decodeStateFrame(buf), now);
    else if (k === KIND_INTENTS) { /* not for clients */ }
  }

  private onSnap(buf: ArrayBuffer, now: number): void {
    let s: DecodedSnap;
    try { s = decodeSnap(buf); } catch (e) { console.warn('[dyefield/net] bad SNAP', e); return; }
    this.stats.snaps++;
    this.stats.bytes += buf.byteLength;
    if (s.tick <= this.lastTick && this.stats.snaps > 1 && !s.fresh) return;          // stale / duplicate
    if (s.prevTick !== this.lastTick) {
      this.stats.gaps++;
      this.requestResync(now);
    }
    this.apply(s, now);
    this.log.push(s);
    while (this.log.length && this.log[0].tick < s.tick - SNAP_LOG_TICKS) this.log.shift();
  }

  private apply(s: DecodedSnap, now: number): void {
    const w = this.world;
    const local = this.localPid;
    // 1. records: paint now (in order); spawns now; events at their render tick
    for (const rec of s.records) {
      if (rec.type === 1 || rec.type === 2) {
        const res = applyPaint(this.painter, rec as PaintRec);
        this.stats.recordsApplied++;
        if (!res.ok && this.synced) { this.stats.flipMismatch++; }
        if (res.e) this.queue.push({ tick: rec.tick, e: res.e });
      } else if (rec.type === 3) {
        if (rec.owner === local && isKitKind(rec.kind)) continue;             // S2: the local kit's own shots are predicted
        w.projectiles.spawn(rec.kind, rec.owner, rec.team, rec.x, rec.y, rec.z, rec.vx, rec.vy, rec.vz, rec.seed, rec.dripEvery, rec.variant);
      } else {
        const e = (rec as EventRec).e as SimEvent & { pid?: number };
        if (e.pid === local && LOCAL_EVENTS.has(e.t)) continue;               // the local runner's own predicted events
        this.queue.push({ tick: rec.tick, e });
      }
    }
    // 2. the painter hash (computed after the tick's paint on the host)
    if (s.hash !== null) {
      this.stats.hashChecks++;
      const mine = hashU32(this.painter.hash());
      if (mine === s.hash) { if (this.synced) this.stats.hashOk++; }
      else if (this.synced || !this.waitingKeyframe) { this.stats.desyncs++; this.requestResync(now); }
    }
    // 3. clock / phase / scores
    const dur = w.netDurTicks;
    w.netRestore({
      phase: s.phase, liveTicks: s.phase === 'countdown' ? 0 : Math.max(0, dur - s.ticksLeft), countTicks: s.countdownTicks,
      ...(s.scoreboard ? { scores: s.scoreboard.scores } : {}),
    });
    if (s.scoreboard) this.applyBoard(s.scoreboard);
    // 4. the local runner (reconcile) and the remote ones (interpolation)
    const hs = s.runners[local];
    if (hs) {
      const ack = hs.ackSeq === 0 && this.pred.ack < 0 ? -1 : this.seq + seqDiff(hs.ackSeq, this.seq & 0xffff);
      this.pred.reconcile(hs, s.tick, ack, s.phase, s.ticksLeft, s.countdownTicks);
      // §O5.2 RTT: the newest sent frame this SNAP acknowledges
      let hit: { seq: number; at: number } | null = null;
      while (this.sentAt.length && this.sentAt[0].seq <= ack) hit = this.sentAt.shift()!;
      if (hit && ack >= 0) {
        const sample = Math.max(0, now - hit.at - INTENT_QUEUE_TARGET * TICK * 1000);
        this.hostRttMs = this.hostRttMs === null ? sample : this.hostRttMs + (sample - this.hostRttMs) * 0.2;
      }
    }
    this.interp.push(s.tick, now, s.runners);
    this.lastTick = s.tick;
    this.last = s;
  }

  private applyBoard(sb: Scoreboard): void {
    this.board = sb;
    const rs = this.world.runners;
    for (let i = 0; i < rs.length && i < sb.runners.length; i++) {
      const b = sb.runners[i];
      rs[i].washes = b.washes; rs[i].washedCount = b.washedCount; rs[i].painted = b.painted;
      if (i !== this.localPid) rs[i].shots = b.shots;
      this.seatTotals[i] = b.seat;
    }
  }

  /** a KEYFRAME for me: the court and every runner at its tick, then the SNAPs after it re-applied */
  private async onKeyframe(f: StateFrame, now: number): Promise<void> {
    if (f.slot !== this.slot) return;
    if (!f.team) return;
    let team: Uint8Array;
    try { team = await inflateRaw(f.team); } catch (e) { console.warn('[dyefield/net] keyframe inflate failed', e); return; }
    const A = this.painter.atlas;
    if (team.length !== A.team.length) { console.warn('[dyefield/net] keyframe size mismatch'); return; }
    A.team.set(team);
    this.painter.recount();
    // every SNAP after the keyframe that was already applied: its paint again, in order
    for (const s of this.log) {
      if (s.tick <= f.tick) continue;
      for (const rec of s.records) if (rec.type === 1 || rec.type === 2) { applyPaint(this.painter, rec as PaintRec); this.stats.reapplied++; }
    }
    this.painter.takeDirty(() => undefined);
    this.onCourtReload?.();
    const w = this.world;
    // runners: the remote ones from the frame (the interpolation buffer takes it), the local one exactly (ext)
    const newest = this.log.length ? this.log[this.log.length - 1] : null;
    if (!newest || newest.tick <= f.tick) {
      for (let i = 0; i < w.runners.length && i < f.snap.runners.length; i++) if (i !== this.localPid) writeRunner(w.runners[i], f.snap.runners[i], null, 0, 0);
      w.netRestore({ phase: f.snap.phase, liveTicks: f.snap.phase === 'countdown' ? 0 : Math.max(0, w.netDurTicks - f.snap.ticksLeft), countTicks: f.snap.countdownTicks });
      this.lastTick = f.tick;
    }
    const ext = f.ext[this.localPid];
    if (ext) w.runners[this.localPid].netLoad(ext);
    if (f.snap.scoreboard) this.applyBoard(f.snap.scoreboard);
    this.pred.reset();
    this.synced = true;
    this.waitingKeyframe = false;
    this.stats.keyframes++;
    void now;
  }

  // ───────────────────────────── per frame ─────────────────────────────
  /** interpolate the remote runners and release the events whose tick the render reached */
  frame(now: number, dt: number): void {
    const rt = this.interp.apply(now, this.world.runners, this.localPid);
    this.renderTick = rt;
    if (this.interp.clock.ready) {
      // events: in tick order, up to the render tick (a backlog over 1 s is released at once)
      const newest = this.interp.newest?.tick ?? rt;
      let k = 0;
      while (k < this.queue.length && (this.queue[k].tick <= rt || this.queue[k].tick < newest - 60)) k++;
      for (let i = 0; i < k; i++) this.release(this.queue[i].e);
      if (k) this.queue.splice(0, k);
    }
    this.pred.decay(dt);
  }

  private release(e: SimEvent): void {
    if (e.t === 'sub' && e.phase === 'pop') this.cosmetic.dropResting(e.pid, KIND_JELLY, e.x, e.y, e.z);
    else if (e.t === 'special' && e.phase === 'end' && e.id === 'cloudburst') this.cosmetic.dropResting(e.pid, KIND_CLOUD, e.x, e.y, e.z);
    else if (e.t === 'washed' && e.victim !== this.localPid) { /* remote: the snapshot carries alive */ }
    // a remote runner's jump / land counters follow its snapshots; nothing else to mirror here
    this.out.push(e);
  }

  /** this frame's events for the view: the local prediction's own, then the released host events */
  drain(out: SimEvent[]): void {
    for (const e of this.pred.out) out.push(e);
    this.pred.out.length = 0;
    for (const e of this.out) out.push(e);
    this.out.length = 0;
  }

  /** shift the local runner by the visual error offset for the view (undo with unshift) */
  shift(sign: 1 | -1): void {
    const r = this.world.runners[this.localPid];
    const v = this.pred.vis;
    if (!v.x && !v.y && !v.z) return;
    r.x += v.x * sign; r.y += v.y * sign; r.z += v.z * sign;
    r.px += v.x * sign; r.py += v.y * sign; r.pz += v.z * sign;
  }

  /** a host change (§O6.3 step 4): reset the interpolation buffer, clear in-flight cosmetic drops, keep the paint */
  onHostChange(): void {
    this.interp.reset();
    this.cosmetic.clear();
    this.queue.length = 0;
    this.pred.reset();
  }

  /** the HANDOFF of a host that is going away (for a migration restore) */
  handoff: StateFrame | null = null;
  onHandoff(buf: ArrayBuffer): void {
    try { this.handoff = decodeStateFrame(buf); } catch (e) { console.warn('[dyefield/net] bad HANDOFF', e); }
  }

  dispose(): void {
    this.queue.length = 0;
    this.out.length = 0;
    this.log.length = 0;
  }

  /** prediction error percentiles (m) */
  predErr(): { p50: number; p95: number; max: number; n: number; corrections: number } {
    let max = 0;
    for (const e of this.pred.stats.errs) if (e > max) max = e;
    return { p50: this.pred.pct(0.5), p95: this.pred.pct(0.95), max, n: this.pred.stats.errs.length, corrections: this.pred.stats.corrections };
  }

  /** the TICK the client steps (re-exported for the session) */
  static readonly TICK = TICK;
}
