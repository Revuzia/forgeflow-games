// VALE session — LockstepMatchHost: the MatchClient for an online match (CONTRACT §7.2).
//
// The client runs its own copy of the deterministic sim (bots included, same factory as the server) and
// steps it only on the server's ticks: each 'tick' carries the human commands the server applied before
// stepping that tick. Commands you issue go to the server, never straight into the local sim, so every
// client and the server stay bit-identical; a digest every DIGEST_EVERY ticks lets the server flag drift.
//
// CLOCK: ticks queue up as they arrive; pump() steps one per TICK_DT of real time and catches up (up to
// 8 a frame) when more than CATCHUP_AT are waiting, so jitter is absorbed and a lagging tab recovers.
// `alpha` interpolates between ticks. The time scale is the server's (setTimeScale is a no-op).
// END: the local sim's 'end' (or the server's result if it arrives first) finishes the match once.
// LEAVE: tells the server (a bot takes your seat for your team) and books the forfeit locally.

import type { CatalogT } from '../contracts/catalog.ts';
import { DIGEST_EVERY, type ServerMsg } from '../contracts/net.ts';
import type { MatchClient } from '../contracts/session.ts';
import { TICK_DT, type Command, type MatchResult, type MatchSetup, type PlayerId, type SimEvent, type WorldView } from '../contracts/sim.ts';
import { stateDigest } from '../sim/core.ts';
import { stream } from '../sim/rng.ts';
import { createSim, worldOf, type BotController, type Sim } from '../sim/sim.ts';
import type { BotFactory } from './match_host.ts';
import type { OnlineLink } from './online_link.ts';

const CATCHUP_AT = 3;
const MAX_STEPS_PER_PUMP = 8;
/** no server tick for this long in a live match: the connection is gone */
export const STALL_SECONDS = 12;

export interface LockstepOptions {
  bots?: BotFactory | null;
  /** autopilot for your seat: a SEPARATE factory instance — a bot factory shares one team plan across the
   *  controllers it makes, so a pilot from the sim's factory would steer this client's bots differently
   *  from the server's and the sims would drift */
  pilot?: BotFactory | null;
  autopilot?: boolean;
  onEnd?(result: MatchResult): void;
  onForfeit?(): void;
  onStall?(): void;
}

export class LockstepMatchHost implements MatchClient {
  readonly setup: MatchSetup;
  readonly you: PlayerId;
  readonly sim: Sim;
  private readonly catalog: CatalogT;
  private readonly link: OnlineLink;
  private readonly opts: LockstepOptions;
  private readonly ticks: { n: number; c?: [PlayerId, Command][] }[] = [];
  private acc = 0;
  /** wall-clock ms of the last server message (stall detection runs on real time, not on pump dt) */
  private lastHeard = Date.now();
  private listeners: ((events: SimEvent[]) => void)[] = [];
  private driver: BotController | null = null;
  private _started = false;
  private _live = false;
  private _ended = false;
  private _left = false;
  private serverResult: MatchResult | null = null;
  /** ticks whose number did not match the local sim (should stay 0) */
  mismatches = 0;
  /** the newest server tick received (resume asks for the ones after it) */
  lastTick = -1;

  constructor(catalog: CatalogT, setup: MatchSetup, you: PlayerId, link: OnlineLink, opts: LockstepOptions = {}) {
    this.catalog = catalog;
    this.setup = setup;
    this.you = you;
    this.link = link;
    this.opts = opts;
    this.sim = createSim(catalog, setup, { bots: opts.bots ?? undefined });
    if (opts.autopilot && opts.pilot) {
      const seat = setup.seats.find((s) => s.player === you);
      if (seat) {
        try {
          this.driver = (opts.pilot({ ...seat, controller: 'bot', botDifficulty: seat.botDifficulty ?? 'adept' },
            { catalog, setup, rng: stream(setup.seed, `pilot:${you}`) }) ?? null) as BotController | null;
        } catch { this.driver = null; }
      }
    }
  }

  get view(): WorldView { return this.sim.view; }
  get alpha(): number { return Math.max(0, Math.min(1, this.acc / TICK_DT)); }
  get timeScale(): number { return 1; }
  get ended(): boolean { return this._ended; }
  /** ticks received and not yet simulated (network health readout) */
  get backlog(): number { return this.ticks.length; }

  /** assets loaded: tell the server; the match runs when every player is ready */
  start(): void {
    if (this._started) return;
    this._started = true;
    this.link.send({ t: 'ready' });
  }

  receive(m: ServerMsg): void {
    if (this._ended) return;
    this.lastHeard = Date.now();
    if (m.t === 'start') this._live = true;
    else if (m.t === 'tick') { this._live = true; this.push({ n: m.n, ...(m.c ? { c: m.c } : {}) }); }
    else if (m.t === 'replay') { this._live = true; for (const t of m.ticks) this.push(t); }
    else if (m.t === 'end') {
      this.serverResult = m.result;
      // the local sim reaches the same end within its backlog; if it has nothing left to step, finish now
      if (!this.ticks.length) this.finish(m.result);
    }
  }

  /** queue a server tick once (a replay can overlap what already arrived) */
  private push(t: { n: number; c?: [PlayerId, Command][] }): void {
    if (t.n <= this.lastTick) return;
    this.lastTick = t.n;
    this.ticks.push(t);
  }

  send(cmd: Command): void {
    if (this._ended || this._left || this.driver) return;
    this.link.send({ t: 'cmd', c: cmd });
  }

  onEvents(cb: (events: SimEvent[]) => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter((x) => x !== cb); };
  }

  setTimeScale(_s: number): void { /* the server keeps time */ }

  pump(dtSeconds: number): number {
    if (!this._started || this._ended || !(dtSeconds > 0) || !Number.isFinite(dtSeconds)) return 0;
    if (this._live && !this.ticks.length && Date.now() - this.lastHeard > STALL_SECONDS * 1000) { this.lastHeard = Date.now(); this.opts.onStall?.(); }
    this.acc += dtSeconds;
    let n = 0;
    while (this.ticks.length && n < MAX_STEPS_PER_PUMP && (this.acc >= TICK_DT - 1e-9 || this.ticks.length > CATCHUP_AT)) {
      if (this.acc >= TICK_DT) this.acc -= TICK_DT;
      this.stepOnce(this.ticks.shift()!);
      n++;
      if (this._ended) break;
    }
    if (!this.ticks.length) this.acc = Math.min(this.acc, TICK_DT);   // starved: never bank debt
    if (this.serverResult && !this.ticks.length && !this._ended) this.finish(this.serverResult);
    return n;
  }

  leave(): void {
    if (this._ended || this._left) return;
    this._left = true;
    this.link.send({ t: 'leave' });
    this.opts.onForfeit?.();
  }

  damageLog(): ReturnType<Sim['damageLog']> {
    try { return this.sim.damageLog(this.you); } catch { return []; }
  }

  dispose(): void { this._ended = true; this.listeners = []; this.ticks.length = 0; }

  private stepOnce(t: { n: number; c?: [PlayerId, Command][] }): void {
    if (t.n !== this.sim.view.tick) this.mismatches++;
    if (this.driver) {
      const pv = this.sim.view.players[this.you];
      if (pv) {
        try { for (const c of this.driver.think(this.sim.view, pv)) this.link.send({ t: 'cmd', c }); } catch { this.driver = null; }
      }
    }
    if (t.c) for (const [p, c] of t.c) this.sim.command(p, c);
    const events = this.sim.step();
    if (events.length) for (const l of [...this.listeners]) { try { l(events); } catch { /* a listener never stops the match */ } }
    const tick = this.sim.view.tick;
    if (tick % DIGEST_EVERY === 0) {
      try { this.link.send({ t: 'digest', n: tick, h: stateDigest(worldOf(this.sim)) }); } catch { /* best effort */ }
    }
    const end = events.find((e): e is Extract<SimEvent, { e: 'end' }> => e.e === 'end');
    if (end || this.sim.view.phase === 'ended') this.finish(end?.result ?? this.sim.view.result ?? this.serverResult);
  }

  private finish(result: MatchResult | null | undefined): void {
    if (this._ended) return;
    this._ended = true;
    if (result) this.opts.onEnd?.(result);
  }
}
