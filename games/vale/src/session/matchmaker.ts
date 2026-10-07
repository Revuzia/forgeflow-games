// VALE session — simulated matchmaking + ready check (CONTRACT §7; research r01 §3.2, r08 §6).
//
//   idle ──start──▶ searching (elapsed / estimate, 4 Hz updates; the real wait is drawn 2–6 s from
//                   the session rng, the estimate is a separate whole-second draw in the same range)
//        ◀─cancel── searching                          (no penalty)
//   searching ──▶ found: a READY_CHECK_SECONDS ready check. The other seats (bots) accept at random
//                 times 0.5–3 s in. accept() → 'accepted'; once every seat accepted → onMatched().
//   found ──decline() / timeout──▶ 'declined' then idle with a re-queue LOCKOUT.
// LOCKOUT escalates with consecutive failures (declines, timeouts, draft dodges): LOCKOUT_BASE ×
// 2^(n−1) seconds, capped at LOCKOUT_MAX; accepting a ready check resets the count. (Research r01
// §3.3 describes tiered, decaying dodge penalties; this is the local, short-timescale version.)

import type { SessionEvent } from '../contracts/session.ts';
import type { Rng } from '../sim/rng.ts';
import type { Clock } from './clock.ts';

export const READY_CHECK_SECONDS = 10;
export const SEARCH_SECONDS: readonly [number, number] = [2, 6];
export const LOCKOUT_BASE = 5;
export const LOCKOUT_MAX = 60;
const UPDATE_MS = 250;

export type QueueEvent = Extract<SessionEvent, { type: 'queue' }>;
export type MatchmakerState = 'idle' | 'searching' | 'found' | 'accepted';

export interface MatchmakerHooks {
  emit(e: QueueEvent): void;
  /** every seat accepted: start the draft */
  matched(queue: string): void;
}

export class Matchmaker {
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly hooks: MatchmakerHooks;
  private readonly searchRange: readonly [number, number];
  private _state: MatchmakerState = 'idle';
  private queueId: string | null = null;
  private startedAt = 0;
  private estimate = 0;
  private cancels: (() => void)[] = [];
  private readyStartedAt = 0;
  private total = 0;
  private acceptedBy = new Set<number>();
  private youAccepted = false;
  private failures = 0;
  private lockedUntil = 0;

  constructor(clock: Clock, rng: Rng, hooks: MatchmakerHooks, searchRange: readonly [number, number] = SEARCH_SECONDS) {
    this.clock = clock; this.rng = rng; this.hooks = hooks; this.searchRange = searchRange;
  }

  get state(): MatchmakerState { return this._state; }
  /** seconds left on the re-queue lockout (0 = free to queue) */
  lockout(): number { return Math.max(0, (this.lockedUntil - this.clock.now()) / 1000); }
  /** consecutive ready-check / draft failures */
  get strikes(): number { return this.failures; }

  /** start searching for `queue`; `seats` = every seat of the match (you included) */
  start(queue: string, seats: number): boolean {
    if (this._state !== 'idle' || this.lockout() > 0) return false;
    this.clear();
    this.queueId = queue;
    this._state = 'searching';
    this.total = Math.max(1, seats);
    this.startedAt = this.clock.now();
    const [lo, hi] = this.searchRange;
    const wait = this.rng.range(lo, hi);
    this.estimate = Math.round(this.rng.range(lo, hi));
    this.searchingEvent();
    this.cancels.push(this.clock.every(UPDATE_MS, () => this.searchingEvent()));
    this.cancels.push(this.clock.after(wait * 1000, () => this.found()));
    return true;
  }

  accept(): boolean {
    if (this._state !== 'found' || this.youAccepted) return false;
    this.youAccepted = true;
    this.failures = 0;
    this._state = 'accepted';
    this.readyEvent('accepted');
    this.checkAllAccepted();
    return true;
  }

  decline(): boolean {
    if (this._state !== 'found' && this._state !== 'accepted') return false;
    this.fail('declined');
    return true;
  }

  cancel(): boolean {
    if (this._state === 'found' || this._state === 'accepted') return this.decline();
    if (this._state !== 'searching') return false;
    this.clear();
    this._state = 'idle';
    this.hooks.emit({ type: 'queue', state: 'idle', queue: this.queueId ?? undefined, reason: 'cancelled' });
    return true;
  }

  /** a dodge after the ready check (leaving the draft) counts as a failure */
  penalize(): number {
    this.failures++;
    this.lockedUntil = this.clock.now() + this.lockoutFor(this.failures) * 1000;
    return this.lockout();
  }

  /** stop every timer (the match was handed to the draft, or the session is torn down) */
  reset(): void { this.clear(); this._state = 'idle'; }

  private lockoutFor(n: number): number { return Math.min(LOCKOUT_MAX, LOCKOUT_BASE * 2 ** Math.max(0, n - 1)); }

  private clear(): void {
    for (const c of this.cancels) c();
    this.cancels = [];
    this.acceptedBy.clear();
    this.youAccepted = false;
  }

  private searchingEvent(): void {
    if (this._state !== 'searching') return;
    this.hooks.emit({ type: 'queue', state: 'searching', queue: this.queueId ?? undefined,
      elapsed: Math.round((this.clock.now() - this.startedAt) / 100) / 10, estimate: this.estimate });
  }

  private found(): void {
    if (this._state !== 'searching') return;
    this.clear();
    this._state = 'found';
    this.readyStartedAt = this.clock.now();
    // the other seats accept at random times inside the window
    for (let i = 1; i < this.total; i++) {
      const at = this.rng.range(0.5, 3);
      this.cancels.push(this.clock.after(at * 1000, () => {
        if (this._state !== 'found' && this._state !== 'accepted') return;
        this.acceptedBy.add(i);
        this.readyEvent(this._state);
        this.checkAllAccepted();
      }));
    }
    this.cancels.push(this.clock.every(UPDATE_MS, () => { if (this._state === 'found' || this._state === 'accepted') this.readyEvent(this._state); }));
    this.cancels.push(this.clock.after(READY_CHECK_SECONDS * 1000, () => {
      if (this._state === 'found') this.fail('timeout');
    }));
    this.readyEvent('found');
  }

  private readyEvent(state: 'found' | 'accepted'): void {
    const left = Math.max(0, READY_CHECK_SECONDS - (this.clock.now() - this.readyStartedAt) / 1000);
    this.hooks.emit({ type: 'queue', state, queue: this.queueId ?? undefined, readyTimer: Math.round(left * 10) / 10, readyMax: READY_CHECK_SECONDS,
      accepted: this.acceptedBy.size + (this.youAccepted ? 1 : 0), total: this.total });
  }

  private checkAllAccepted(): void {
    if (!this.youAccepted || this.acceptedBy.size + 1 < this.total) return;
    const q = this.queueId as string;
    this.clear();
    this._state = 'idle';
    this.hooks.matched(q);
  }

  private fail(reason: 'declined' | 'timeout'): void {
    this.clear();
    this._state = 'idle';
    const lockout = this.penalize();
    const queue = this.queueId ?? undefined;
    this.hooks.emit({ type: 'queue', state: 'declined', queue, reason, lockout });
    this.hooks.emit({ type: 'queue', state: 'idle', queue, reason, lockout });
  }
}
