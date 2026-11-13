// BLOCKTOOTH — the multi-titan core contract helpers (lane B-CORE; _spec/online/CORE_CONTRACT.md is the spec).
// THREE-FREE, deterministic, depends on TYPES ONLY (so any sim module can import it without an import cycle).
//
//   bindPlayer(w, slot)     point the World's cursor fields (titan, titanId, upgrades, ult, tally, meta, input,
//                           director) + w.cur / w.pl at that player; existing `w.titan`-style code then runs per player
//   unbindPlayer(w)         VS world-scoped phase: w.cur = -1 (events get p = -1); cursor falls back to slot 0
//   withPlayer(w, slot, fn) run fn bound to `slot`, restore the previous binding after (owner-attributed resolution)
//   EventSink               the World.events array: push() stamps ev.p = w.cur
//   creditTonnage/creditBlock  world totals + the bound player's PlayerRun
//
// Solo never unbinds: cur is always 0, so every event is p = 0 and every solo system behaves exactly as before.

import type { PlayerState, SimEvent, TitanInput, World } from './types.ts';

// ─────────────────────────────── event sink ───────────────────────────────
/** What the sink reads the owner from: the World itself (its `cur` field). */
interface CurHost { cur: number }

/**
 * World.events. A real Array (length = 0 reset, indexing, for-of, slice all work), except push() stamps
 * `ev.p = host.cur` on every event that does not already carry a `p` (an explicit p wins, incl. -1).
 * Derived arrays (slice / filter / map) are plain Arrays (species).
 */
export class EventSink extends Array<SimEvent> {
  host!: CurHost;
  static get [Symbol.species](): ArrayConstructor { return Array; }
  push(...items: SimEvent[]): number {
    const p = this.host.cur;
    if (items.length === 1) {
      const e = items[0];
      if (e.p === undefined) e.p = p;
      return super.push(e);
    }
    for (let i = 0; i < items.length; i++) { const e = items[i]; if (e.p === undefined) e.p = p; }
    return super.push(...items);
  }
}

/** A fresh, empty sink bound to `host` (createWorld passes the World being built). */
export function createEventSink(host: CurHost): EventSink {
  const s = new EventSink();
  s.host = host;
  return s;
}

// ─────────────────────────────── the cursor ───────────────────────────────
/** Dev-build assert switch (harness probes turn it on): assertBound throws when no player is bound. */
let ASSERT_BOUND = false;
export function setBindAsserts(on: boolean): void { ASSERT_BOUND = on; }

/** Bind player `slot`: the cursor fields now alias that player's containers. Returns the PlayerState. O(1). */
export function bindPlayer(w: World, slot: number): PlayerState {
  const p = w.players[slot];
  w.cur = slot;
  w.pl = p;
  w.titanId = p.titanId;
  w.titan = p.titan;
  w.upgrades = p.upgrades;
  w.ult = p.ult;
  w.tally = p.tally;
  w.meta = p.meta;
  w.input = p.input;
  w.director = p.director;
  return p;
}

/**
 * Enter a VS world-scoped phase: no owner is bound. Events pushed now are stamped p = -1; the cursor fields fall back
 * to slot 0 (deterministic, identical on every peer) so code that has not been converted yet does not read a stale
 * player — but it is WRONG for 3 of 4 seats: world-scoped code must pick its target explicitly. No-op in solo.
 */
export function unbindPlayer(w: World): void {
  if (w.mode === 'solo') return;
  bindPlayer(w, 0);
  w.cur = -1;
}

/** Run `fn` with `slot` bound (events pushed inside are p = slot), then restore whatever was bound before. */
export function withPlayer<T>(w: World, slot: number, fn: () => T): T {
  const prev = w.cur;
  bindPlayer(w, slot);
  try { return fn(); } finally { if (prev >= 0) bindPlayer(w, prev); else unbindPlayer(w); }
}

/** Dev assert for titan-scoped steps: "a player must be bound here". Free when ASSERT_BOUND is off. */
export function assertBound(w: World, where: string): void {
  if (ASSERT_BOUND && w.cur < 0) throw new Error(`[core] ${where} needs a bound player (w.cur = -1)`);
}

/** Push an event on behalf of `slot` regardless of what is bound (explicit p; -1 = ownerless). */
export function emitAs(w: World, slot: number, ev: SimEvent): void {
  ev.p = slot;
  w.events.push(ev);
}

/** true when `e` belongs to the bound player (titan-scoped consumers skip the rest). Fake test worlds with no
 *  cursor (cur undefined, p undefined) compare equal, so they keep working. */
export function isOwnEvent(w: World, e: SimEvent): boolean { return e.p === w.cur; }

// ─────────────────────────────── seat helpers ───────────────────────────────
/** A seat still in the match (solo: always true). Eliminated seats skip every per-player step. */
export function seatActive(w: World, p: PlayerState): boolean { return w.mode === 'solo' || !p.vs.eliminated; }

/** The input a seat is stepped with when the caller gave none: its previous input (a late guest's input repeats). */
export function seatInput(p: PlayerState): TitanInput { return p.input; }

// ─────────────────────────────── per-player credit ───────────────────────────────
/** Add flattened tonnage to the WORLD total and to the bound player (no-op for the player when none is bound). */
export function creditTonnage(w: World, tons: number): void {
  w.run.tonnage += tons;
  const p = w.cur >= 0 && w.players !== undefined ? w.players[w.cur] : undefined;   // fake test worlds have no players
  if (p !== undefined) p.run.tonnage += tons;
}

/** A block was fully leveled: WORLD total + the bound player. */
export function creditBlock(w: World): void {
  w.run.blocksLeveled++;
  const p = w.cur >= 0 && w.players !== undefined ? w.players[w.cur] : undefined;
  if (p !== undefined) p.run.blocksLeveled++;
}
