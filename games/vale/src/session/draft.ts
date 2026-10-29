// VALE session — the draft host (CONTRACT §7): one timer-driven DraftState for every pick protocol.
// Players and bots act through the same DraftActions; bots get the DraftState as THEIR seat sees it.
//
// PROTOCOLS (QueueDef.pick ?? ModeDef.pick; practice/custom choose theirs in local_session.ts)
//   draft         ban → pick → finalize. `bansPerTeam` ban slots per team, dealt round-robin to the
//                 team's seats; bans are simultaneous and hidden (allies see each other's), revealed
//                 together when every slot is filled or `banSeconds` runs out (an open slot bans its
//                 seat's hover if valid, else nothing). A fighter an ally is hovering cannot be banned.
//                 Picks snake 1-2-2-…-2-1 (team 0 first; with more teams, round-robin), one turn per
//                 group with `pickSeconds`. Hover any time before you lock (allies see it), lock on
//                 your turn. Timeout: lock the hover if still valid, else a random valid fighter.
//                 No duplicates in the match.
//   blind         everyone picks at once (`pickSeconds`); duplicates allowed across teams only; enemy
//                 picks are hidden until finalize.
//   role_preset   the human's fighter comes from QueueRequest.preset; bots fill instantly (a fighter
//                 of their role); straight to a short finalize. Duplicates across teams only.
//   random_bench  every seat gets a random fighter; each team gets a shared bench of `bench.size`
//                 more (no duplicates in the match while the pool lasts). During the bench window any
//                 seat may swap with a bench fighter (its old one takes that bench spot; at most
//                 `bench.swaps` times per seat when set) or reroll (`bench.rerolls` each: a new random
//                 fighter, the old one joins the bench; the bench keeps its newest `bench.size`, the
//                 oldest returns to the pool). With `bench.fade`, every `fade` s of the window the
//                 bench's FIRST fighter goes back to the pool (BRIDGE's Lot burns down; W4 re-key,
//                 originality F4). Then finalize.
//   ffa_pick      everyone picks at once, no duplicates (first lock wins); then finalize.
// FINALIZE: `finalizeSeconds` to change skin (owned skins only for the human) and loadout; trades
// between locked teammates (tradeRequest → the other seat's tradeAccept swaps fighters; bots accept
// at once). Lock in is a ready flag ({ a: 'ready' }, DraftSeat.ready; client F12): a seat with a brain
// shows ready once it has nothing left to do (or has used its acts); when every person (seat without a
// brain) is ready the timer drops to READY_GRACE s. 'done' ends the draft; final() is the line-up.
//
// Bot pacing: a seat with a brain first acts 0.4–2.5 s into a phase/turn, then every 0.3–0.9 s
// (1 s after a null), at most MAX_BOT_ACTS times per phase/turn. A bot's lock waits until its
// lockAfter (BOT_LOCK_MIN to BOT_LOCK_MAX − 0.9 s into the phase/turn, never later than 1 s before
// the timer runs out), so bots lock like people do: within 3–8 s, never at the buzzer (client F12). A blind or
// FFA pick phase ends the moment every seat has locked; a seat without a brain never holds bots up.

import type { DraftAction, DraftPhase, DraftSeat, DraftState } from '../contracts/session.ts';
import type { LoadoutChoice, PlayerId } from '../contracts/sim.ts';
import type { Rng } from '../sim/rng.ts';
import type { DraftBrain } from './draft_brain.ts';

export type PickProtocol = 'draft' | 'blind' | 'role_preset' | 'random_bench' | 'ffa_pick';
export const MAX_BOT_ACTS = 8;
/** client F12: bots lock 3–8 s into a pick phase/turn; finalize ends READY_GRACE s after everyone is ready */
export const BOT_LOCK_MIN = 3;
export const BOT_LOCK_MAX = 8;
export const READY_GRACE = 1.5;

/**
 * W4 gameplay G8 (r03 §1.6): bans per team for a roster of `roster` playable fighters, from a queue's draft.bansByRoster
 * steps (the highest step at or below the roster); without steps, draft.bansPerTeam. The steps follow r03's comfort
 * target R ≥ 2C (C = 2 × team size + all bans) from 28 fighters up, and hold one ban per team below that (the worst-case
 * gate C ≤ R still holds at 16: 12 ≤ 16). Content keeps draft.bansPerTeam equal to this for today's roster.
 */
export function bansForRoster(draft: { bansPerTeam: number; bansByRoster?: { roster: number; bans: number }[] } | undefined, roster: number): number {
  if (!draft) return 0;
  const steps = draft.bansByRoster;
  if (!steps || steps.length === 0) return draft.bansPerTeam;
  let bans = steps[0].bans;
  for (const s of steps) if (roster >= s.roster) bans = s.bans;
  return bans;
}

export interface DraftSeatInit {
  player: PlayerId; team: number; name: string; isBot: boolean; isYou: boolean;
  role?: string;
  /** a fighter fixed before the draft (role_preset, custom lobby presets) */
  preset?: string;
}
export interface DraftTimers { ban: number; pick: number; bench: number; finalize: number }
export interface DraftConfig {
  queue: string; mode: string; protocol: PickProtocol;
  seats: DraftSeatInit[];
  /** draftable fighter ids */
  pool: string[];
  bansPerTeam: number;
  timers: DraftTimers;
  bench: { size: number; rerolls: number; swaps?: number; fade?: number };
}
export interface DraftHooks {
  brain(seat: DraftSeatInit): DraftBrain | null;
  /** skins this seat may wear on a fighter; the first is the default */
  skins(seat: DraftSeatInit, fighter: string): string[];
  /** default loadout for a seat on a fighter */
  loadout(seat: DraftSeatInit, fighter: string): LoadoutChoice;
  /** a sanitized loadout, or null if unusable */
  validLoadout(seat: DraftSeatInit, fighter: string, l: LoadoutChoice): LoadoutChoice | null;
  fighterName(id: string): string;
  /** a fighter fitting a role (role_preset/timeout fills for bots); null = any */
  fits?(fighter: string, role: string | undefined): boolean;
  onChange?(): void;
  onDone?(): void;
}
export interface FinalSeat {
  player: PlayerId; team: number; name: string; isBot: boolean; isYou: boolean;
  role?: string; fighter: string; skin: string; loadout: LoadoutChoice;
}
export type ActResult = { ok: true } | { ok: false; reason: string };

interface Seat {
  init: DraftSeatInit;
  hover?: string; locked?: string; skin?: string; loadout?: LoadoutChoice;
  rerolls: number;
  /** bench swaps left (Infinity = no limit) */
  swaps: number;
  brain: DraftBrain | null;
  botNextAt: number; botActs: number;
  /** a bot's earliest lock in this phase/turn (s into it) */
  lockAfter: number;
  /** finalize: Lock in pressed (humans) / nothing left to do (bots) */
  ready: boolean;
}
interface BanSlot { team: number; player: PlayerId; fighter: string | null; done: boolean }

export class DraftHost {
  readonly cfg: DraftConfig;
  private readonly rng: Rng;
  private readonly hooks: DraftHooks;
  private readonly seats: Seat[];
  private readonly byPlayer = new Map<PlayerId, Seat>();
  private _phase: DraftPhase = 'pick';
  private timer = 0;
  private timerMax = 0;
  private phaseElapsed = 0;
  /** seconds of the bench window since the Lot last burned down (bench.fade) */
  private fadeAcc = 0;
  private serial = 0;
  private bans: BanSlot[] = [];
  private bansRevealed = false;
  private turns: PlayerId[][] = [];
  private turnIndex = -1;
  private readonly bench = new Map<number, string[]>();
  private free: string[] = [];
  private trades: { from: PlayerId; to: PlayerId }[] = [];
  private readonly log: string[] = [];
  private started = false;
  private _done = false;

  constructor(cfg: DraftConfig, rng: Rng, hooks: DraftHooks) {
    if (cfg.pool.length === 0) throw new Error('draft: no draftable fighters');
    if (cfg.seats.length === 0) throw new Error('draft: no seats');
    this.cfg = cfg; this.rng = rng; this.hooks = hooks;
    this.seats = [...cfg.seats].sort((a, b) => a.player - b.player).map((init) => ({
      init, rerolls: cfg.protocol === 'random_bench' ? cfg.bench.rerolls : 0, swaps: cfg.bench.swaps ?? Infinity,
      brain: hooks.brain(init), botNextAt: 0, botActs: 0, lockAfter: 0, ready: false,
    }));
    for (const s of this.seats) this.byPlayer.set(s.init.player, s);
    for (const t of this.teams()) this.bench.set(t, []);
  }

  get phase(): DraftPhase { return this._phase; }
  get done(): boolean { return this._done; }

  start(): void {
    if (this.started) return;
    this.started = true;
    const p = this.cfg.protocol;
    // presets (custom lobby / role_preset) are locked before anything else
    for (const s of this.seats) {
      if (s.init.preset && this.cfg.pool.includes(s.init.preset) && (p === 'random_bench' || this.canTake(s, s.init.preset))) this.doLock(s, s.init.preset, false);
    }
    if (p === 'draft') {
      this.buildBans();
      if (this.bans.length) this.enter('ban', this.cfg.timers.ban);
      else this.startPicks();
    } else if (p === 'blind' || p === 'ffa_pick') {
      if (this.seats.every((s) => s.locked)) this.enterFinalize();
      else this.enter('pick', this.cfg.timers.pick);
    } else if (p === 'role_preset') {
      for (const s of this.seats) if (!s.locked) this.autoLock(s, true);
      this.enterFinalize();
    } else {
      this.assignBench();
      this.enter('bench', this.cfg.timers.bench);
    }
    this.changed();
  }

  /** advance the draft clock by dt seconds (timers, bots, timeouts) */
  advance(dt: number): void {
    if (!this.started || this._done) return;
    this.timer -= dt;
    this.phaseElapsed += dt;
    if (this._phase === 'bench') this.fadeBench(dt);
    this.runBots();
    if (!this._done && this.timer <= 1e-9) this.expire();
    this.changed();
  }

  /** a player's action; bots go through the same path */
  act(player: PlayerId, a: DraftAction): ActResult {
    const s = this.byPlayer.get(player);
    if (!s) return { ok: false, reason: 'no_seat' };
    if (!this.started || this._done) return { ok: false, reason: 'closed' };
    const r = this.apply(s, a);
    if (r.ok) this.changed();
    return r;
  }

  /** the line-up once done */
  final(): FinalSeat[] {
    return this.seats.map((s) => {
      const fighter = s.locked ?? this.cfg.pool[0];
      return {
        player: s.init.player, team: s.init.team, name: s.init.name, isBot: s.init.isBot, isYou: s.init.isYou, role: s.init.role,
        fighter, skin: s.skin ?? this.hooks.skins(s.init, fighter)[0], loadout: s.loadout ?? this.hooks.loadout(s.init, fighter),
      };
    });
  }

  // ── state views ─────────────────────────────────────────────────────────────────────────────
  /** the DraftState as `viewer` sees it (null = everything, for tools) */
  view(viewer: PlayerId | null): DraftState {
    const vs = viewer === null ? null : this.byPlayer.get(viewer) ?? null;
    const ally = (s: Seat): boolean => vs === null || s.init.team === vs.init.team;
    const blindHidden = this.cfg.protocol === 'blind' && (this._phase === 'pick');
    const seats: DraftSeat[] = this.seats.map((s) => {
      const lockVisible = ally(s) || !blindHidden;
      const d: DraftSeat = { player: s.init.player, team: s.init.team, name: s.init.name, isBot: s.init.isBot, isYou: s.init.isYou };
      if (s.init.role !== undefined && ally(s)) d.role = s.init.role;
      if (s.hover !== undefined && ally(s)) d.hover = s.hover;
      if (s.locked !== undefined && lockVisible) { d.locked = s.locked; if (s.skin !== undefined) d.skin = s.skin; }
      if (s.loadout !== undefined && ally(s)) d.loadout = { spells: [...s.loadout.spells], boons: [...s.loadout.boons] };
      if (this.cfg.protocol === 'random_bench' && ally(s)) { d.rerolls = s.rerolls; if (Number.isFinite(s.swaps)) d.swaps = s.swaps; }
      if (this._phase === 'finalize' || this._phase === 'trade' || this._phase === 'done') d.ready = s.ready || this._phase === 'done';
      return d;
    });
    const bans = this.bansRevealed || vs === null
      ? this.bans.filter((b) => b.done).map((b) => ({ team: b.team, fighter: b.fighter }))
      : this.bans.filter((b) => b.done && b.team === vs.init.team).map((b) => ({ team: b.team, fighter: b.fighter }));
    const bench: Record<number, string[]> = {};
    for (const [t, list] of this.bench) if (vs === null || t === vs.init.team) bench[t] = [...list];
    const st: DraftState = {
      queue: this.cfg.queue, mode: this.cfg.mode, phase: this._phase, turn: this.turnFor(),
      timer: Math.max(0, Math.round(this.timer * 10) / 10), timerMax: this.timerMax,
      seats, bans, bench, available: this.availableFor(vs), log: [...this.log],
    };
    const trades = this.trades.filter((t) => vs === null || t.from === vs.init.player || t.to === vs.init.player);
    if (trades.length) st.trades = trades.map((t) => ({ ...t }));
    return st;
  }

  private turnFor(): DraftState['turn'] {
    switch (this._phase) {
      case 'ban': return { players: this.seats.filter((s) => this.openBan(s)).map((s) => s.init.player), action: 'ban' };
      case 'pick':
        if (this.cfg.protocol === 'draft') return { players: [...(this.turns[this.turnIndex] ?? [])], action: 'pick' };
        return { players: this.seats.filter((s) => !s.locked).map((s) => s.init.player), action: 'pick' };
      case 'bench': case 'finalize': case 'trade': return { players: this.seats.map((s) => s.init.player), action: 'free' };
      default: return null;
    }
  }

  private availableFor(vs: Seat | null): string[] {
    if (this._phase === 'bench') return vs ? [...(this.bench.get(vs.init.team) ?? [])] : [];
    if (this._phase === 'ban') {
      const own = new Set(this.bans.filter((b) => b.done && b.fighter && (vs === null || b.team === vs.init.team)).map((b) => b.fighter as string));
      return this.cfg.pool.filter((f) => !own.has(f));
    }
    if (this._phase !== 'pick') return [];
    if (!vs) return this.cfg.pool.filter((f) => !this.banned(f) && !this.seats.some((s) => s.locked === f));
    return this.cfg.pool.filter((f) => this.canTake(vs, f));
  }

  // ── rules ──────────────────────────────────────────────────────────────────────────────────
  private teams(): number[] { return [...new Set(this.cfg.seats.map((s) => s.team))].sort((a, b) => a - b); }
  private matchUnique(): boolean { return this.cfg.protocol === 'draft' || this.cfg.protocol === 'ffa_pick'; }
  private banned(f: string): boolean { return this.bansRevealed && this.bans.some((b) => b.fighter === f); }
  /** may seat s lock fighter f now (bans, uniqueness) */
  private canTake(s: Seat, f: string): boolean {
    if (!this.cfg.pool.includes(f) || this.banned(f)) return false;
    for (const o of this.seats) {
      if (o === s || o.locked !== f) continue;
      if (this.matchUnique() || o.init.team === s.init.team) return false;
    }
    return true;
  }
  private openBan(s: Seat): boolean { return this.bans.some((b) => b.player === s.init.player && !b.done); }

  private apply(s: Seat, a: DraftAction): ActResult {
    switch (a?.a) {
      case 'hover': {
        if (s.locked) return { ok: false, reason: 'locked' };
        if (this._phase !== 'ban' && this._phase !== 'pick') return { ok: false, reason: 'phase' };
        if (typeof a.fighter !== 'string' || !this.cfg.pool.includes(a.fighter)) return { ok: false, reason: 'unknown_fighter' };
        if (this._phase === 'pick' && !this.canTake(s, a.fighter)) return { ok: false, reason: 'unavailable' };
        if (this.bans.some((b) => b.done && b.team === s.init.team && b.fighter === a.fighter)) return { ok: false, reason: 'banned' };
        s.hover = a.fighter;
        return { ok: true };
      }
      case 'lock': {
        if (s.locked) return { ok: false, reason: 'locked' };
        if (this._phase !== 'pick') return { ok: false, reason: 'phase' };
        if (this.cfg.protocol === 'draft' && !(this.turns[this.turnIndex] ?? []).includes(s.init.player)) return { ok: false, reason: 'not_your_turn' };
        if (!s.hover) return { ok: false, reason: 'no_hover' };
        if (!this.canTake(s, s.hover)) { s.hover = undefined; return { ok: false, reason: 'unavailable' }; }
        this.doLock(s, s.hover, true);
        this.afterLock();
        return { ok: true };
      }
      case 'ban': {
        if (this._phase !== 'ban') return { ok: false, reason: 'phase' };
        const slot = this.bans.find((b) => b.player === s.init.player && !b.done);
        if (!slot) return { ok: false, reason: 'no_ban' };
        if (typeof a.fighter !== 'string' || !this.cfg.pool.includes(a.fighter)) return { ok: false, reason: 'unknown_fighter' };
        if (this.bans.some((b) => b.done && b.team === s.init.team && b.fighter === a.fighter)) return { ok: false, reason: 'banned' };
        if (this.seats.some((o) => o !== s && o.init.team === s.init.team && o.hover === a.fighter)) return { ok: false, reason: 'ally_hover' };
        slot.fighter = a.fighter; slot.done = true;
        if (s.hover === a.fighter) s.hover = undefined;
        if (this.bans.every((b) => b.done)) { this.revealBans(); this.startPicks(); }
        return { ok: true };
      }
      case 'skin': {
        if (!s.locked) return { ok: false, reason: 'not_locked' };
        if (!this.hooks.skins(s.init, s.locked).includes(a.skin)) return { ok: false, reason: 'skin' };
        s.skin = a.skin;
        return { ok: true };
      }
      case 'loadout': {
        if (!s.locked) return { ok: false, reason: 'not_locked' };
        const l = a.loadout && Array.isArray(a.loadout.spells) && Array.isArray(a.loadout.boons) ? this.hooks.validLoadout(s.init, s.locked, a.loadout) : null;
        if (!l) return { ok: false, reason: 'loadout' };
        s.loadout = l;
        return { ok: true };
      }
      case 'benchSwap': {
        if (this._phase !== 'bench' || !s.locked) return { ok: false, reason: 'phase' };
        const list = this.bench.get(s.init.team) ?? [];
        const i = list.indexOf(a.fighter);
        if (i < 0) return { ok: false, reason: 'not_on_bench' };
        if (s.swaps <= 0) return { ok: false, reason: 'no_swaps' };
        const old = s.locked;
        s.swaps--;
        list[i] = old;
        this.setFighter(s, a.fighter);
        this.log.push(`${s.init.name} swapped ${this.hooks.fighterName(old)} for ${this.hooks.fighterName(a.fighter)}`);
        return { ok: true };
      }
      case 'reroll': {
        if (this._phase !== 'bench' || !s.locked) return { ok: false, reason: 'phase' };
        if (s.rerolls <= 0) return { ok: false, reason: 'no_rerolls' };
        const f = this.drawFor(s.init.team, s.locked);
        if (!f) return { ok: false, reason: 'pool_empty' };
        const old = s.locked;
        s.rerolls--;
        this.setFighter(s, f);
        this.toBench(s.init.team, old);
        this.log.push(`${s.init.name} rerolled ${this.hooks.fighterName(old)}`);
        return { ok: true };
      }
      case 'tradeRequest': {
        if (this._phase !== 'finalize') return { ok: false, reason: 'phase' };
        const o = this.byPlayer.get(a.with);
        if (!o || o === s || o.init.team !== s.init.team || !o.locked || !s.locked) return { ok: false, reason: 'trade' };
        if (this.trades.some((t) => (t.from === s.init.player && t.to === o.init.player) || (t.from === o.init.player && t.to === s.init.player))) return { ok: false, reason: 'pending' };
        this.trades.push({ from: s.init.player, to: o.init.player });
        if (!o.init.isYou && o.init.isBot) this.swap(s, o);   // bots accept at once
        return { ok: true };
      }
      case 'tradeAccept': {
        if (this._phase !== 'finalize') return { ok: false, reason: 'phase' };
        const t = this.trades.find((x) => x.from === a.with && x.to === s.init.player);
        const o = this.byPlayer.get(a.with);
        if (!t || !o || !o.locked || !s.locked) return { ok: false, reason: 'no_trade' };
        this.swap(o, s);
        return { ok: true };
      }
      case 'ready': {
        if (this._phase !== 'finalize') return { ok: false, reason: 'phase' };
        if (!s.locked) return { ok: false, reason: 'not_locked' };
        s.ready = true;
        this.checkReady();
        return { ok: true };
      }
      default: return { ok: false, reason: 'unknown_action' };
    }
  }

  private swap(a: Seat, b: Seat): void {
    const fa = a.locked as string, fb = b.locked as string;
    this.setFighter(a, fb);
    this.setFighter(b, fa);
    this.trades = this.trades.filter((t) => ![a.init.player, b.init.player].includes(t.from) && ![a.init.player, b.init.player].includes(t.to));
    this.log.push(`${a.init.name} and ${b.init.name} traded`);
  }

  /** a seat's fighter changes after locking (bench, reroll, trade): skin + loadout follow */
  private setFighter(s: Seat, f: string): void {
    s.locked = f;
    s.skin = this.hooks.skins(s.init, f)[0];
    s.loadout = this.hooks.loadout(s.init, f);
  }

  private doLock(s: Seat, f: string, log: boolean): void {
    s.hover = undefined;
    this.setFighter(s, f);
    for (const o of this.seats) if (o !== s && o.hover === f && !this.canTake(o, f)) o.hover = undefined;
    if (log && this.cfg.protocol !== 'blind') this.log.push(`${s.init.name} locked ${this.hooks.fighterName(f)}`);
  }

  private afterLock(): void {
    if (this._phase !== 'pick') return;
    if (this.cfg.protocol === 'draft') {
      const turn = this.turns[this.turnIndex] ?? [];
      if (turn.every((p) => this.byPlayer.get(p)?.locked)) this.nextTurn();
    } else if (this.seats.every((s) => s.locked)) this.enterFinalize();
  }

  /** lock the hover if still valid, else a random valid fighter (role-fitting first when `preferRole`) */
  private autoLock(s: Seat, preferRole = false): void {
    if (s.locked) return;
    let f: string | null = s.hover && this.canTake(s, s.hover) ? s.hover : null;
    if (!f) {
      let cands = this.cfg.pool.filter((x) => this.canTake(s, x));
      if (preferRole && this.hooks.fits && s.init.role) {
        const fit = cands.filter((x) => this.hooks.fits!(x, s.init.role));
        if (fit.length) cands = fit;
      }
      if (!cands.length) cands = this.cfg.pool.filter((x) => !this.seats.some((o) => o.init.team === s.init.team && o.locked === x));
      if (!cands.length) cands = [...this.cfg.pool];
      f = this.rng.pick(cands);
    }
    this.doLock(s, f, true);
  }

  // ── phases ─────────────────────────────────────────────────────────────────────────────────
  private enter(phase: DraftPhase, seconds: number): void {
    this._phase = phase;
    this.timer = Math.max(0, seconds);
    this.timerMax = Math.max(0, seconds);
    this.phaseElapsed = 0;
    this.fadeAcc = 0;
    this.serial++;
    for (const s of this.seats) {
      s.botActs = 0;
      s.botNextAt = this.rng.range(0.4, Math.max(0.5, Math.min(2.5, this.timerMax * 0.4)));
      s.lockAfter = 0;
      if (s.brain && phase === 'pick' && !s.locked) {
        // the last re-hover before a lock costs at most one act interval (0.9 s), so the lock itself lands by BOT_LOCK_MAX
        const hi = Math.max(0.5, Math.min(BOT_LOCK_MAX - 0.9, this.timerMax - 1));
        s.lockAfter = this.rng.range(Math.min(BOT_LOCK_MIN, hi), hi);
      }
    }
  }

  /** finalize: when every person is ready, the rest of the timer shrinks to READY_GRACE. Bots never hold it up: a bot
   *  that has not sent its skin or loadout yet gets the same defaults its brain would choose (hooks.skins / loadout) */
  private checkReady(): void {
    if (this._phase !== 'finalize' || !this.seats.every((s) => s.ready || s.brain)) return;
    if (this.timer > READY_GRACE) this.timer = READY_GRACE;
  }

  private buildBans(): void {
    const n = Math.max(0, Math.floor(this.cfg.bansPerTeam));
    for (const t of this.teams()) {
      const mine = this.seats.filter((s) => s.init.team === t);
      if (!mine.length) continue;
      for (let i = 0; i < n; i++) this.bans.push({ team: t, player: mine[i % mine.length].init.player, fighter: null, done: false });
    }
  }

  private revealBans(): void {
    if (this.bansRevealed) return;
    for (const b of this.bans) {
      if (b.done) continue;
      const s = this.byPlayer.get(b.player)!;
      const h = s.hover;
      const ok = h && !this.bans.some((x) => x.done && x.team === b.team && x.fighter === h)
        && !this.seats.some((o) => o !== s && o.init.team === b.team && o.hover === h);
      b.fighter = ok ? (h as string) : null;
      b.done = true;
      if (ok) s.hover = undefined;
    }
    this.bansRevealed = true;
    const names = this.bans.filter((b) => b.fighter).map((b) => this.hooks.fighterName(b.fighter as string));
    this.log.push(`Bans revealed: ${names.length ? names.join(', ') : 'none'}`);
    for (const s of this.seats) if (s.hover && this.banned(s.hover)) s.hover = undefined;
  }

  private startPicks(): void {
    // snake: first group 1, then 2s, alternating teams (round-robin for > 2 teams); locked seats skip
    const queues = this.teams().map((t) => this.seats.filter((s) => s.init.team === t && !s.locked).map((s) => s.init.player));
    this.turns = [];
    let ti = 0, first = true;
    while (queues.some((q) => q.length)) {
      let guard = 0;
      while (!queues[ti].length && guard++ < queues.length) ti = (ti + 1) % queues.length;
      this.turns.push(queues[ti].splice(0, first ? 1 : 2));
      first = false;
      ti = (ti + 1) % queues.length;
    }
    this.turnIndex = -1;
    this._phase = 'pick';
    this.nextTurn();
  }

  private nextTurn(): void {
    this.turnIndex++;
    while (this.turnIndex < this.turns.length && this.turns[this.turnIndex].every((p) => this.byPlayer.get(p)?.locked)) this.turnIndex++;
    if (this.turnIndex >= this.turns.length) { this.enterFinalize(); return; }
    this.enter('pick', this.cfg.timers.pick);
  }

  private enterFinalize(): void {
    if (this.cfg.protocol === 'blind') this.log.push('Picks revealed');
    this.turnIndex = this.turns.length;
    this.enter('finalize', this.cfg.timers.finalize);
  }

  private finish(): void {
    for (const s of this.seats) if (!s.locked) this.autoLock(s);
    this._phase = 'done';
    this.timer = 0;
    this.serial++;
    this._done = true;
    this.log.push('Draft complete');
    this.hooks.onChange?.();
    this.hooks.onDone?.();
  }

  private expire(): void {
    switch (this._phase) {
      case 'ban': this.revealBans(); this.startPicks(); break;
      case 'pick':
        if (this.cfg.protocol === 'draft') {
          for (const p of this.turns[this.turnIndex] ?? []) this.autoLock(this.byPlayer.get(p)!);
          this.nextTurn();
        } else {
          for (const s of this.seats) this.autoLock(s);
          this.enterFinalize();
        }
        break;
      case 'bench': this.enterFinalize(); break;
      case 'finalize': this.finish(); break;
      default: break;
    }
  }

  // ── bench (random_bench) ────────────────────────────────────────────────────────────────────
  private assignBench(): void {
    const used = new Set(this.seats.filter((s) => s.locked).map((s) => s.locked as string));
    this.free = this.rng.shuffle(this.cfg.pool.filter((f) => !used.has(f)));
    for (const s of this.seats) {
      if (s.locked) continue;
      const f = this.drawFor(s.init.team, null);
      if (f) this.doLock(s, f, false);
    }
    for (const t of this.teams()) {
      const list = this.bench.get(t)!;
      while (list.length < this.cfg.bench.size && this.free.length) list.push(this.free.shift() as string);
    }
    this.log.push('Fighters assigned');
  }

  /** a random fighter for a team: unused anywhere while the pool lasts, else unused by that team */
  private drawFor(team: number, not: string | null): string | null {
    const i = this.free.findIndex((f) => f !== not);
    if (i >= 0) return this.free.splice(i, 1)[0];
    const teamUsed = new Set<string>([...(this.bench.get(team) ?? [])]);
    for (const s of this.seats) if (s.init.team === team && s.locked) teamUsed.add(s.locked);
    const c = this.cfg.pool.filter((f) => !teamUsed.has(f) && f !== not);
    return c.length ? this.rng.pick(c) : null;
  }

  /** bench.fade: every `fade` s of the window each team's Lot lets its first fighter go back to the pool */
  private fadeBench(dt: number): void {
    const fade = this.cfg.bench.fade;
    if (!fade || fade <= 0) return;
    this.fadeAcc += dt;
    while (this.fadeAcc + 1e-9 >= fade) {
      this.fadeAcc -= fade;
      for (const t of this.teams()) {
        const list = this.bench.get(t);
        const f = list && list.length ? list.shift() as string : null;
        if (f) { this.free.push(f); this.log.push(`The Lot let ${this.hooks.fighterName(f)} go`); }
      }
    }
  }

  private toBench(team: number, f: string): void {
    const list = this.bench.get(team)!;
    list.push(f);
    while (list.length > this.cfg.bench.size) this.free.push(list.shift() as string);
  }

  // ── bots ───────────────────────────────────────────────────────────────────────────────────
  private runBots(): void {
    const serial = this.serial;
    for (const s of this.seats) {
      if (this._done || this.serial !== serial) return;
      // a seat without a brain (a person) never stops the bots after it from acting (client F12: with the human
      // in seat 0, bots used to sit idle until every timer ran out)
      if (!s.brain) continue;
      if (this._phase === 'finalize' && !s.ready && s.botActs >= MAX_BOT_ACTS) { s.ready = true; this.checkReady(); continue; }
      if (this.phaseElapsed < s.botNextAt || s.botActs >= MAX_BOT_ACTS) continue;
      let a: DraftAction | null = null;
      try { a = s.brain.act(this.view(s.init.player), s.init.player); } catch { s.brain = null; s.ready = true; this.checkReady(); continue; }
      if (!a) {
        s.botNextAt = this.phaseElapsed + 1;
        if (this._phase === 'finalize' && !s.ready) { s.ready = true; this.checkReady(); }
        continue;
      }
      // people take a few seconds to commit: a bot's lock waits for its lockAfter
      if (a.a === 'lock' && this.phaseElapsed < s.lockAfter) { s.botNextAt = s.lockAfter; continue; }
      s.botActs++;
      // past its lockAfter a bot that had to re-hover (its pick was taken) commits quickly
      const late = this._phase === 'pick' && s.lockAfter > 0 && this.phaseElapsed >= s.lockAfter && a.a === 'hover';
      s.botNextAt = this.phaseElapsed + (late ? this.rng.range(0.1, 0.3) : this.rng.range(0.3, 0.9));
      this.apply(s, a);
    }
  }

  private changed(): void { if (!this._done) this.hooks.onChange?.(); }
}
