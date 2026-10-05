// DYEFIELD — ONLINE match session: one per online match on one device (CONTRACT_ONLINE §O4.5–§O7). THREE-free, DOM-free.
//
// The session holds this device's role — HOST (net/host.ts: the real sim) or CLIENT (net/client.ts: the container world +
// prediction) — routes the relay's frames to it, and switches roles on a host migration (§O6): a client named the new host
// rebuilds the match directly (new MatchWorld, the restore, a new BotDirector; never startSession / Game.restart, which wipe
// the court) and continues at lastTick + 1; an old host named away becomes a client and resyncs through a KEYFRAME. The
// Game drives it through the GameNet methods (tick / drain / frame / shift) and adopts a swapped world through the hook.

import type { PlayerIntent } from '../core/types.ts';
import { emptyIntent } from '../core/types.ts';
import { TICK } from '../core/config.ts';
import type { MapDef } from '../core/data.ts';
import type { MapGeometry } from '../core/mapgeo.ts';
import type { PhysicsWorld } from '../core/physics.ts';
import type { Painter } from '../core/paint/painter.ts';
import { MatchWorld, type MatchResult, type WorldNetState } from '../core/match/world.ts';
import { BotDirector } from '../core/bots/director.ts';
import type { NavGraph } from '../core/bots/nav.ts';
import type { BotSkill, RosterEntry } from '../core/match/roster.ts';
import type { SimEvent } from '../core/match/events.ts';
import type { RunnerNetState } from '../core/runner.ts';
import { NetHost, type Send } from './host.ts';
import { NetClient } from './client.ts';
import {
  KIND_HANDOFF, KIND_INTENTS, KIND_KEYFRAME, KIND_SNAP, LATE_JOIN_MIN_LEFT_S, atlasSig, type Bounds, type DecodedSnap,
  type RunnerSnap, type Scoreboard, type SeatTotals, type StateFrame, type TextMsg, type WireEndRunner, type WireMember,
  type WireSeat,
} from './proto.ts';
import { lateJoinRunner } from './roster.ts';

export interface SessionArena { def: MapDef; geo: MapGeometry; physics: PhysicsWorld; painter: Painter; nav: NavGraph }

export interface SessionSpec {
  matchNo: number; seed: number; mode: 'teams' | 'ffa'; rule: 'turf' | 'washout'; skill: BotSkill; map: string; preset: string;
  durationS: number; countdownS: number; roster: RosterEntry[]; seats: WireSeat[];
  mySlot: number; hostSlot: number; members: WireMember[];
  /** host changes so far this match (0 at the start) */
  migrations: number;
  /** seated before the match began (the clean court is the host's); false → a late join / reload: KEYFRAME first */
  fromStart: boolean;
  /** dev ?idlekick=<s> (the host's idle kick; default IDLE_KICK_S) */
  idleKickS?: number;
}

export interface EndInfo {
  status: 'complete' | 'void' | 'dropped';
  result: MatchResult | null;
  runners: WireEndRunner[];
  migrations: number;
  why?: string;
}

export interface SessionHooks {
  /** a migration swapped the world (the Game adopts it: views, juice, audio read the new runners) */
  adoptWorld?(w: MatchWorld): void;
  /** a KEYFRAME rewrote atlas.team: rebuild the paint texture and the minimap */
  courtReload?(): void;
  /** the match ended (end / Room void / my socket gone) */
  ended?(e: EndInfo): void;
  /** a seat changed (late join / reconnect / bot takeover): the runner's name and who drives it now */
  renamed?(runner: number, name: string, status: 'human' | 'bot' | 'away'): void;
  /** the host changed: `me` = this device now hosts */
  hostChanged?(me: boolean, reason: string, hostSlot: number): void;
  /** this device's seat was refused (its court differs from the host's) */
  badCourt?(): void;
}

export interface SessionStats {
  role: 'host' | 'client'; migrations: number; restoreHashMismatch: number; discardedCtorEvents: number;
  painterResetsDuringRestore: number;
}

/** GameNet: what the Game calls every tick / frame of an online session */
export interface GameNet {
  readonly localPid: number;
  readonly role: 'host' | 'client';
  readonly world: MatchWorld;
  tick(intents: PlayerIntent[], local: PlayerIntent, now: number): boolean;
  drain(out: SimEvent[]): void;
  frame(dt: number, now: number): void;
  shift(sign: 1 | -1): void;
}

const restoreSeed = (seed: number, migrations: number): number => (seed ^ Math.imul(0x9e37, migrations)) >>> 0;

/** a SNAP runner block + its scoreboard line → a Runner.netLoad partial (a migration restore from a plain SNAP) */
function fromSnap(rs: RunnerSnap, sb: Scoreboard['runners'][number] | undefined): Partial<RunnerNetState> {
  const o: Partial<RunnerNetState> = {
    x: rs.x, y: rs.y, z: rs.z, px: rs.x, py: rs.y, pz: rs.z, vx: rs.vx, vy: rs.vy, vz: rs.vz, yaw: rs.yaw, pyaw: rs.yaw,
    aimYaw: rs.aimYaw, aimPitch: rs.aimPitch, state: rs.state, grounded: rs.grounded, slickForm: rs.slickForm, tall: rs.tall,
    hidden: rs.hidden, alive: rs.alive, hp: rs.hp, tank: rs.tank, special: rs.special, specialReady: rs.specialReady,
    respawnT: rs.respawnT, protectedT: rs.protectedT, surfacing: rs.surfacing, spawnSite: rs.spawnSite, subCooldown: rs.subCooldown,
    ballistic: rs.ballistic, courtFrozen: rs.courtFrozen, launches: rs.launches, lastSpring: rs.lastSpring, jumps: rs.jumps,
    landings: rs.landings, firing: false, charge: 0, charging: false, rolling: false, flicking: false,
  };
  if (sb) { o.washes = sb.washes; o.washedCount = sb.washedCount; o.painted = sb.painted; o.shots = sb.shots; }
  return o;
}

export class OnlineSession implements GameNet {
  role: 'host' | 'client';
  world: MatchWorld;
  director: BotDirector | null = null;
  host: NetHost | null = null;
  client: NetClient | null = null;
  readonly spec: SessionSpec;
  readonly arena: SessionArena;
  readonly localPid: number;
  readonly stats: SessionStats;
  /** seats as this device knows them (slot → runner), kept for a migration restore */
  readonly seats = new Map<number, number>();
  /** runner → human-driven (from `seat`) */
  readonly human = new Map<number, boolean>();
  migrations: number;
  ended: EndInfo | null = null;
  private readonly send: Send;
  private readonly hooks: SessionHooks;
  private readonly bounds: Bounds | null;
  private members: WireMember[];
  private disposed = false;
  idleKickS = 0;
  /** dev ?autopilot=<seed>: the local intents come from a BotDirector brain on this device's own world (real intents) */
  private auto: BotDirector | null = null;
  private autoSeed = -1;
  private autoNav: NavGraph | null = null;
  private readonly autoScratch: PlayerIntent[] = [];

  constructor(spec: SessionSpec, arena: SessionArena, world: MatchWorld, send: Send, hooks: SessionHooks, now: number) {
    this.spec = spec;
    this.arena = arena;
    this.world = world;
    this.send = send;
    this.hooks = hooks;
    this.members = spec.members.slice();
    this.migrations = spec.migrations;
    const b = arena.def.bounds;
    this.bounds = b ? { min: b.min, max: b.max } : null;
    for (const s of spec.seats) { this.seats.set(s.slot, s.runner); this.human.set(s.runner, true); }
    this.localPid = this.seats.get(spec.mySlot) ?? -1;
    this.role = spec.hostSlot === spec.mySlot ? 'host' : 'client';
    this.idleKickS = spec.idleKickS ?? 0;
    this.stats = { role: this.role, migrations: 0, restoreHashMismatch: 0, discardedCtorEvents: 0, painterResetsDuringRestore: 0 };
    if (this.role === 'host') this.startHost(now);
    else this.startClient(spec.fromStart);
  }

  private startHost(now: number): void {
    const s = this.spec;
    this.director = new BotDirector(this.world, this.arena.nav, restoreSeed(s.seed, this.migrations), s.skill);
    this.host = new NetHost({
      world: this.world, director: this.director, roster: s.roster, seats: s.seats, localPid: this.localPid,
      localSlot: s.mySlot, matchNo: s.matchNo, seed: s.seed, migrations: this.migrations, skill: s.skill, durationS: s.durationS,
      bounds: this.bounds, send: this.send, now, members: this.members, idleKickS: this.idleKickS || undefined,
    });
  }

  private startClient(fromStart: boolean): void {
    this.client = new NetClient({
      world: this.world, roster: this.spec.roster, localPid: this.localPid, slot: this.spec.mySlot, bounds: this.bounds,
      send: this.send, fromStart, onCourtReload: () => this.hooks.courtReload?.(),
    });
  }

  /** `loaded` once this device's arena + session exist (the host's pre-start gate, a late join, a reconnect) */
  sendLoaded(): void {
    if (this.role === 'host') return;
    this.sendText({ t: 'loaded', matchNo: this.spec.matchNo, atlasSig: atlasSig(this.arena.painter.atlas) });
  }

  private sendText(m: TextMsg): void { this.send(JSON.stringify(m)); }

  // ───────────────────────────── relay → session ─────────────────────────────
  onBinary(buf: ArrayBuffer, now: number): void {
    if (this.disposed || buf.byteLength < 2) return;
    const k = new Uint8Array(buf)[0];
    if (k === KIND_INTENTS) { this.host?.onIntents(buf, now); return; }
    if (this.role !== 'client' || !this.client) return;
    if (k === KIND_SNAP || k === KIND_KEYFRAME) this.client.onBinary(buf, now);
    else if (k === KIND_HANDOFF) this.client.onHandoff(buf);
  }

  onText(m: TextMsg, now: number): void {
    if (this.disposed) return;
    const from = (m as { from?: number }).from;
    switch (m.t) {
      case 'loaded':
        if (this.host && m.matchNo === this.spec.matchNo && typeof from === 'number') this.host.onLoaded(from, m.atlasSig >>> 0, now);
        break;
      case 'resync':
        if (this.host && typeof from === 'number') this.host.onResync(from);
        break;
      case 'seat': {
        if (m.slot !== null) { this.seats.set(m.slot, m.runner); }
        if (m.runner >= 0 && m.runner < this.world.runners.length) {
          this.human.set(m.runner, m.human);
          const r = this.world.runners[m.runner];
          if (m.name && r.name !== m.name) (r as unknown as { name: string }).name = m.name;
          this.hooks.renamed?.(m.runner, r.name, m.human ? 'human' : m.slot === null ? 'bot' : 'away');
        }
        if (m.slot === null && m.runner === this.localPid && this.role === 'client') this.hooks.badCourt?.();
        break;
      }
      case 'roster':
        // a re-sent roster (a late joiner's): learn the current seats
        if (m.matchNo === this.spec.matchNo) for (const s of m.seats) this.seats.set(s.slot, s.runner);
        break;
      case 'peer': {
        const pm = m as { slot: number; conn: boolean; left?: boolean; rejoin?: boolean };
        if (this.host) {
          if (pm.left) {
            this.members = this.members.filter((x) => x.slot !== pm.slot);
            this.host.setMembers(this.members, now);
          } else {
            this.host.onPeer(pm.slot, pm.conn, now);
            if (pm.conn) this.reserveSeat(pm.slot, now);
          }
        }
        break;
      }
      case 'members':
        this.members = m.members.slice();
        if (this.host) this.host.setMembers(this.members, now);
        break;
      case 'host': {
        const hm = m as { hostSlot: number; reason: 'left' | 'stalled' | 'handoff'; lastTick: number; migrations?: number };
        this.onHost(hm.hostSlot, hm.reason, hm.lastTick, hm.migrations, now);
        break;
      }
      case 'end': {
        if (m.matchNo !== this.spec.matchNo) break;
        const voided = !!m.voided;
        const res = (m.result ?? null) as MatchResult | null;
        if (!voided && res && this.role === 'client') {
          this.world.result = res;
          this.world.endedBy = res.endedBy;
          if (this.world.phase !== 'ended') this.world.netRestore({ phase: 'ended' });
        }
        this.finish({ status: voided ? 'void' : 'complete', result: voided ? null : res, runners: m.runners ?? [], migrations: m.migrations ?? this.migrations, why: (m as { why?: string }).why });
        break;
      }
      default:
        break;
    }
  }

  /** the host's end (sent by NetHost) reaches the host's own session through this */
  hostEnded(): void {
    if (!this.host || this.ended) return;
    const w = this.world;
    const runners: WireEndRunner[] = w.runners.map((r) => ({
      id: r.id, name: r.name, team: r.team, slot: this.slotOf(r.id), washes: r.washes, washedCount: r.washedCount, painted: r.painted,
      shots: r.shots, seat: this.host!.seatTotals(r.id),
    }));
    this.finish({ status: 'complete', result: w.result, runners, migrations: this.migrations });
  }

  private slotOf(runner: number): number | null {
    for (const [slot, rr] of this.seats) if (rr === runner) return slot;
    return null;
  }

  private finish(e: EndInfo): void {
    if (this.ended) return;
    this.ended = e;
    this.hooks.ended?.(e);
  }

  /** my socket is gone for good at the horn (no reconnect): the stats `dropped` */
  dropped(): void { this.finish({ status: 'dropped', result: null, runners: [], migrations: this.migrations }); }

  /** host: a connected slot without a seat during the match → reserve a bot runner and re-send the roster (§O7.1) */
  private reserveSeat(slot: number, now: number): void {
    const h = this.host!;
    const w = this.world;
    if (h.seatOfSlot(slot) || w.phase === 'ended') { this.resendRoster(); return; }
    if (w.phase === 'live' && w.timeLeft < LATE_JOIN_MIN_LEFT_S) return;
    const id = lateJoinRunner(this.spec.roster, h.humanRunners(), this.spec.mode);
    if (id < 0) return;
    const name = this.members.find((x) => x.slot === slot)?.name;
    h.reserve(id, slot, name ?? '', now);
    this.seats.set(slot, id);
    this.resendRoster();
  }

  private resendRoster(): void {
    const seats: WireSeat[] = [];
    for (const s of this.host!.seats) if (s && s.slot >= 0) seats.push({ slot: s.slot, runner: s.runner });
    this.sendText({ t: 'roster', matchNo: this.spec.matchNo, seats, roster: this.spec.roster, durationS: this.spec.durationS, countdownS: this.spec.countdownS });
  }

  // ───────────────────────────── migration (§O6) ─────────────────────────────
  private onHost(hostSlot: number, reason: string, lastTick: number, migrations: number | undefined, now: number): void {
    this.migrations = typeof migrations === 'number' ? migrations : this.migrations + 1;
    this.stats.migrations++;
    const me = hostSlot === this.spec.mySlot;
    if (me && this.role === 'client') this.becomeHost(lastTick, now);
    else if (!me && this.role === 'host') this.becomeClient();
    else if (this.client) { this.client.onHostChange(); this.client.resendUnacked(); }
    this.hooks.hostChanged?.(me, reason, hostSlot);
  }

  /** an old host named away: stop, drop the tap, mirror as a client from a KEYFRAME */
  private becomeClient(): void {
    this.host?.dispose();
    this.host = null;
    this.director = null;
    this.role = 'client';
    this.stats.role = 'client';
    this.startClient(false);
    this.sendLoaded();
  }

  /**
   * The restore (§O6.3): a fresh MatchWorld built directly (never startSession / Game.restart: they reset the painter),
   * the container world's capsules released first, the constructor's events (phase live, horn start, FFA spawns) drained
   * and DISCARDED, then MatchWorld.netRestore from the HANDOFF (exact) or the last SNAP + scoreboard, a new BotDirector
   * with the connected humans set, and the seat totals restored. The painter is already the court.
   */
  private becomeHost(lastTick: number, now: number): void {
    const c = this.client!;
    const s = this.spec;
    const A = this.arena;
    const old = this.world;
    const hf: StateFrame | null = c.handoff && c.handoff.tick === lastTick ? c.handoff : (c.handoff && !c.last ? c.handoff : null);
    const snap: DecodedSnap | null = hf ? hf.snap : c.last;
    const board: Scoreboard | null = (hf ? hf.snap.scoreboard : null) ?? c.board;
    const flipsBefore = A.painter.flips;
    for (const r of old.runners) {
      const b = r.body as unknown as { dispose?: (world: unknown) => void };
      try { b.dispose?.(A.physics.world); } catch { /* already gone */ }
    }
    const w = new MatchWorld({
      def: A.def, geo: A.geo, physics: A.physics, painter: A.painter, roster: s.roster, seed: restoreSeed(s.seed, this.migrations),
      durationS: s.durationS, countdownS: 0, mode: s.mode, ...(s.rule === 'washout' ? { rule: 'washout' as const } : {}),
    });
    const scratch: SimEvent[] = [];
    this.stats.discardedCtorEvents += w.drainEvents(scratch);
    const dur = w.netDurTicks;
    let ws: Partial<WorldNetState> & { runners?: Array<Partial<RunnerNetState> | null>; resetCombat?: boolean } = { resetCombat: true };
    const hj = hf?.json as { world?: WorldNetState; seats?: Array<{ slot: number; runner: number; human: boolean; liveTicks: number; painted: number; washes: number; washedCount: number }> } | null | undefined;
    if (hf && hj?.world) {
      ws = { ...hj.world, resetCombat: true, runners: hf.ext.map((e) => ({ ...e })) };
    } else if (snap) {
      const runners = snap.runners.map((rs, i) => fromSnap(rs, board?.runners[i]));
      const ffa = s.mode === 'ffa';
      ws = {
        tick: snap.tick, liveTicks: snap.phase === 'countdown' ? 0 : Math.max(0, dur - snap.ticksLeft), countTicks: snap.countdownTicks,
        phase: snap.phase, scores: board ? board.scores : undefined,
        respawnTicks: snap.runners.map((rs) => (rs.alive ? 0 : Math.max(1, Math.round(rs.respawnT / TICK)))),
        protectTicks: snap.runners.map((rs) => Math.round(rs.protectedT / TICK)),
        ...(ffa ? { slots: snap.runners.map((rs, i) => { const site = w.spawnSites[rs.spawnSite]; return site ? { ...site } : w.spawnFor(w.runners[i]); }) } : {}),
        runners, resetCombat: true,
      };
    }
    ws.tick = lastTick > 0 ? Math.max(lastTick, snap?.tick ?? 0) : (snap?.tick ?? 0);
    w.netRestore(ws);
    this.stats.discardedCtorEvents += w.drainEvents(scratch);
    if (A.painter.flips !== flipsBefore) this.stats.painterResetsDuringRestore++;
    // the painter is the court: continue even if its hash differs from the last one seen (clients resync from it)
    const want = hf ? hf.hash : snap?.hash ?? null;
    if (want !== null && want !== undefined && (parseInt(A.painter.hash(), 16) >>> 0) !== want) this.stats.restoreHashMismatch++;
    // seats: what the clients knew (roster + seat messages) and the totals from the scoreboard / HANDOFF
    const seats: WireSeat[] = [];
    for (const [slot, runner] of this.seats) seats.push({ slot, runner });
    const restoredSeats = hj?.seats ?? seats.map((x) => {
      const st: SeatTotals | null = board?.runners[x.runner]?.seat ?? null;
      return { slot: x.slot, runner: x.runner, human: st ? st.human : true, liveTicks: st ? st.liveTicks : 0, painted: st ? st.painted : 0, washes: st ? st.washes : 0, washedCount: st ? st.washedCount : 0 };
    });
    c.dispose();
    this.client = null;
    this.world = w;
    this.director = new BotDirector(w, A.nav, restoreSeed(s.seed, this.migrations), s.skill);
    this.host = new NetHost({
      world: w, director: this.director, roster: s.roster, seats, localPid: this.localPid, localSlot: s.mySlot, matchNo: s.matchNo,
      seed: s.seed, migrations: this.migrations, skill: s.skill, durationS: s.durationS, bounds: this.bounds, send: this.send, now,
      members: this.members, restored: { lastTick: w.tick, seats: restoredSeats }, idleKickS: this.idleKickS || undefined,
    });
    this.role = 'host';
    this.stats.role = 'host';
    if (this.autoSeed >= 0) this.buildAuto();
    this.hooks.adoptWorld?.(w);
  }

  /** dev ?autopilot=<seed>: drive the local runner with a seeded bot brain (walks, fires, slicks, throws, rolls) */
  autopilot(nav: NavGraph, seed: number): void {
    this.autoNav = nav;
    this.autoSeed = seed >>> 0;
    this.buildAuto();
  }

  private buildAuto(): void {
    if (this.autoSeed < 0 || !this.autoNav || this.localPid < 0) { this.auto = null; return; }
    const d = new BotDirector(this.world, this.autoNav, this.autoSeed, 'swell');
    for (let i = 0; i < this.world.runners.length; i++) if (i !== this.localPid) d.setHuman(i, true);
    this.auto = d;
    this.autoScratch.length = 0;
    for (let i = 0; i < this.world.runners.length; i++) this.autoScratch.push(emptyIntent());
  }

  // ───────────────────────────── GameNet ─────────────────────────────
  tick(intents: PlayerIntent[], local: PlayerIntent, now: number): boolean {
    if (this.disposed) return false;
    if (this.auto && this.localPid >= 0) {
      this.auto.think(this.autoScratch);
      local = this.autoScratch[this.localPid];
    }
    if (this.host) {
      const ran = this.host.tick(intents, local, now);
      if (ran && this.host.ended && !this.ended) this.hostEnded();
      return ran;
    }
    if (this.client) { this.client.tick(local, now); return true; }
    return false;
  }

  drain(out: SimEvent[]): void {
    if (this.host) this.host.drain(out);
    else if (this.client) this.client.drain(out);
  }

  frame(dt: number, now: number): void { this.client?.frame(now, dt); }
  shift(sign: 1 | -1): void { this.client?.shift(sign); }

  /** graceful: this host page is going away (hidden / leave): SNAP + HANDOFF + `handoff` (§O6.2) */
  handoff(): void { this.host?.handoff(); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.host?.dispose();
    this.client?.dispose();
  }
}
