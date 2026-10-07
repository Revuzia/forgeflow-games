// VALE session — LocalMatchHost: the MatchClient over a local Sim (CONTRACT §7).
//
// CLOCK: a fixed 30 Hz step (TICK_DT) behind an accumulator fed by pump(dtSeconds) × timeScale. One
// pump runs at most MAX_CATCHUP_TICKS × max(1, timeScale) ticks — that is at most 8 ticks' worth of
// REAL time (≈ 267 ms) — and drops any older backlog, so a stalled tab resumes instead of spiralling.
// `alpha` = accumulator / TICK_DT is the render interpolation fraction. Nothing runs before start()
// (the session calls it from matchReady()).
// TIME SCALE: 0 (pause) … 16 in practice and custom games; matchmade queues stay at 1 (a server
// would not pause or fast-forward them) unless the session runs with the dev flag.
// COMMANDS: send() queues the human seat's command; the sim applies it next tick.
// EVENTS: every tick's non-empty SimEvent batch goes to each onEvents listener, in tick order.
// END: on the sim's 'end' the host stops stepping and calls onEnd(result) once.
// LEAVE: forfeit. The seat is handed to a bot controller (the same factory as the bot seats) and the
// host stops; the session books the match as an 'abandon' loss for you from the current state
// (forfeitResult). Locally nobody is left to play the rest; a remote host keeps the match running.
// AUTOPILOT (tests, attract mode): the human seat is driven by a bot controller from the start,
// thinking after each tick and commanding through the same queue as send() (applied next tick,
// exactly like an in-sim bot).

import type { CatalogT } from '../contracts/catalog.ts';
import type { MatchClient } from '../contracts/session.ts';
import type { Command, MatchResult, MatchSetup, PlayerId, PlayerResult, SeatSetup, SimEvent, WorldView } from '../contracts/sim.ts';
import { TICK_DT } from '../contracts/sim.ts';
import { stream } from '../sim/rng.ts';
import { createSim, type BotController, type BotHost, type Sim } from '../sim/sim.ts';

export const MAX_CATCHUP_TICKS = 8;
export const MAX_TIME_SCALE = 16;

export type BotFactory = (seat: SeatSetup, host: BotHost) => BotController | null | undefined;

export interface MatchHostOptions {
  /** controllers for bot seats (and a forfeited / autopiloted human seat) */
  bots?: BotFactory | null;
  /** pre-game countdown seconds (sim default when omitted) */
  pregameSeconds?: number;
  /** highest time scale allowed (1 for matchmade queues, 16 for practice/custom/dev) */
  maxTimeScale?: number;
  /** drive the human seat with a bot controller from the start */
  autopilot?: boolean;
  onEnd?(result: MatchResult): void;
  onForfeit?(): void;
}

export class LocalMatchHost implements MatchClient {
  readonly setup: MatchSetup;
  readonly you: PlayerId;
  readonly sim: Sim;
  private readonly catalog: CatalogT;
  private readonly opts: MatchHostOptions;
  private acc = 0;
  private scale = 1;
  private readonly maxScale: number;
  private listeners: ((events: SimEvent[]) => void)[] = [];
  private readonly drivers = new Map<PlayerId, BotController>();
  private _started = false;
  private _ended = false;
  private _left = false;
  /** controllers driven by the host that threw (disabled) */
  readonly faults: string[] = [];

  constructor(catalog: CatalogT, setup: MatchSetup, you: PlayerId, opts: MatchHostOptions = {}) {
    this.catalog = catalog;
    this.setup = setup;
    this.you = you;
    this.opts = opts;
    this.maxScale = Math.max(1, Math.min(MAX_TIME_SCALE, opts.maxTimeScale ?? 1));
    this.sim = createSim(catalog, setup, { bots: opts.bots ?? undefined, pregameSeconds: opts.pregameSeconds });
    if (opts.autopilot) this.drive(you);
  }

  get view(): WorldView { return this.sim.view; }
  get alpha(): number { return Math.max(0, Math.min(1, this.acc / TICK_DT)); }
  get timeScale(): number { return this.scale; }
  get started(): boolean { return this._started; }
  get ended(): boolean { return this._ended; }
  get left(): boolean { return this._left; }

  /** the loading screen is done: the clock may run */
  start(): void { this._started = true; }

  send(cmd: Command): void {
    if (this._ended || this._left) return;
    this.sim.command(this.you, cmd);
  }

  onEvents(cb: (events: SimEvent[]) => void): () => void {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter((x) => x !== cb); };
  }

  setTimeScale(s: number): void {
    if (!Number.isFinite(s)) return;
    this.scale = this.maxScale > 1 ? Math.max(0, Math.min(this.maxScale, s)) : 1;
  }

  pump(dtSeconds: number): number {
    if (!this._started || this._ended || this._left || !(dtSeconds > 0) || !Number.isFinite(dtSeconds)) return 0;
    const maxTicks = Math.ceil(MAX_CATCHUP_TICKS * Math.max(1, this.scale));
    this.acc += dtSeconds * this.scale;
    let n = 0;
    while (this.acc >= TICK_DT - 1e-9 && n < maxTicks && !this._ended) {
      this.acc -= TICK_DT;
      this.stepOnce();
      n++;
    }
    if (n >= maxTicks && this.acc >= TICK_DT) this.acc = this.acc % TICK_DT;   // drop the backlog
    if (this.acc < 0) this.acc = 0;
    return n;
  }

  /** forfeit: your seat becomes a bot, the host stops, the session books a loss */
  leave(): void {
    if (this._ended || this._left) return;
    this._left = true;
    this.drive(this.you);
    this.opts.onForfeit?.();
  }

  /** stop for good (session teardown) */
  dispose(): void { this._ended = true; this.listeners = []; this.drivers.clear(); }

  private drive(player: PlayerId): void {
    const seat = this.setup.seats.find((s) => s.player === player);
    if (!seat || !this.opts.bots) return;
    try {
      const ctrl = this.opts.bots({ ...seat, controller: 'bot', botDifficulty: seat.botDifficulty ?? 'adept' },
        { catalog: this.catalog, setup: this.setup, rng: stream(this.setup.seed, `bots:${player}`) });
      if (ctrl) this.drivers.set(player, ctrl);
    } catch (err) { this.faults.push(`driver ${player}: ${String(err)}`); }
  }

  private stepOnce(): void {
    for (const [p, ctrl] of this.drivers) {
      const pv = this.sim.view.players[p];
      if (!pv) continue;
      try {
        const cmds = ctrl.think(this.sim.view, pv);
        if (!Array.isArray(cmds)) throw new Error('think() did not return an array');
        for (const c of cmds) this.sim.command(p, c);
      } catch (err) { this.faults.push(`driver ${p} @${this.sim.view.tick}: ${String(err)}`); this.drivers.delete(p); }
    }
    const events = this.sim.step();
    if (events.length) for (const l of [...this.listeners]) { try { l(events); } catch { /* a listener never stops the match */ } }
    const end = events.find((e): e is Extract<SimEvent, { e: 'end' }> => e.e === 'end');
    if (end || this.sim.view.phase === 'ended') {
      this._ended = true;
      const result = end?.result ?? this.sim.view.result;
      if (result) this.opts.onEnd?.(result);
    }
  }
}

/**
 * The result of a match you left: reason 'abandon', you lose. Team modes: your team loses to the
 * other (first other) team. FFA: seats already placed keep their placement; the rest are ranked by
 * score, then damage to fighters, then seat, with you last among them.
 */
export function forfeitResult(setup: MatchSetup, view: WorldView, you: PlayerId): MatchResult {
  const teams = [...new Set(setup.seats.map((s) => s.team))].sort((a, b) => a - b);
  const me = setup.seats.find((s) => s.player === you);
  const ffa = teams.length > 2;
  const winningTeam = !ffa && me ? (teams.find((t) => t !== me.team) ?? -1) : -1;
  const placement = new Map<PlayerId, number>();
  if (ffa) {
    const placed = view.players.filter((p) => p.placement !== undefined);
    for (const p of placed) placement.set(p.player, p.placement as number);
    const rest = view.players.filter((p) => p.placement === undefined && p.player !== you)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.damageToFighters - a.damageToFighters || a.player - b.player);
    let next = 1;
    const taken = new Set(placement.values());
    for (const p of rest) { while (taken.has(next)) next++; placement.set(p.player, next); taken.add(next); }
    if (!placement.has(you)) { while (taken.has(next)) next++; placement.set(you, next); }
  }
  const players: PlayerResult[] = view.players.map((p) => {
    const place = ffa ? placement.get(p.player) ?? view.players.length : p.team === winningTeam ? 1 : 2;
    const r: PlayerResult = {
      player: p.player, team: p.team, name: p.name, fighter: p.fighter, skin: p.skin, controller: p.controller,
      kills: p.kills, deaths: p.deaths, assists: p.assists, cs: p.cs, gold: p.goldEarned, level: view.entity(p.entity)?.level ?? 1,
      damageToFighters: p.damageToFighters, damageTaken: p.damageTaken, healing: p.healing, structureDamage: 0,
      items: [...p.items], placement: place, won: p.player !== you && (ffa ? place === 1 : p.team === winningTeam),
    };
    if (p.role !== undefined) r.role = p.role;
    if (p.score !== undefined) r.score = p.score;
    return r;
  });
  return {
    matchId: setup.matchId, queue: setup.queue, mode: setup.mode, map: setup.map, seed: setup.seed, catalogVersion: setup.catalogVersion,
    duration: Math.max(0, view.time), winningTeam, reason: 'abandon', players, goldGraph: [], digest: 'abandon',
  };
}
