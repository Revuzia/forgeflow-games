// WOBBLEHOARD meter feed (_spec/COLLECTION.md 9.7, 7.5; _spec/DESIGN.md 5.4): SoftEvent -> touch, the play-batch builder, the preview meter.
//
//   mapSoftEvent(ev, out)        the DESIGN 5.4 mapping, allocation-free:
//                                  poke                          -> poke
//                                  release with heldFor >= 0.4 s -> squeeze, amount = heldFor (0..10 s)
//                                  snap                          -> pull, amount = intensity (0..1); under 0.35 the meter pays the
//                                                                   "never stretched" rate itself (pass the intensity as is)
//                                  press, land, grab, a short release, any non-finite number -> not a touch
//   createTouchBuffer(cap)       the in-memory play buffer of the (planned) sync engine: typed-array ring, allocation-free push,
//                                batches of at most 120 [kind, amount, dtMs] with dtMs relative to the batch's first touch and
//                                never decreasing. Touches are never written to storage (7.7).
//   foldMeter / createPreviewMeter   the preview ring: the same addInteraction as the server, folded over the touches it has not
//                                acknowledged yet (9.7: preview = fold(addInteraction, serverMeter, unacked)).
import type { SoftEvent } from '../contracts.ts';
import type { Interaction, MeterState, TouchKind } from '../core/meter.ts';
import { addInteraction, createMeter, meterFill, sanitizeMeter } from '../core/meter.ts';
import { MAX_EVENTS_PER_BATCH, MAX_PULL_INTENSITY, MAX_SQUEEZE_SECONDS, RELEASE_SQUEEZE_MIN_S, TOUCH_BUFFER_CAP } from './constants.ts';

export const KIND_POKE = 0;
export const KIND_SQUEEZE = 1;
export const KIND_PULL = 2;
/** Touch kinds by wire index (the play report's 0..2). */
export const TOUCH_KINDS_BY_INDEX: readonly TouchKind[] = ['poke', 'squeeze', 'pull'];

/** A reusable touch record (the caller owns one and passes it to every mapSoftEvent call). */
export interface MappedTouch { kind: TouchKind; kindIdx: number; amount: number }
export const createMappedTouch = (): MappedTouch => ({ kind: 'poke', kindIdx: KIND_POKE, amount: 0 });

/** Map one SoftEvent to a touch (DESIGN 5.4). Writes into `out` and returns true, or returns false (not a touch). Allocation-free. */
export function mapSoftEvent(ev: SoftEvent, out: MappedTouch): boolean {
  if (!ev) return false;
  switch (ev.kind) {
    case 'poke':
      out.kind = 'poke'; out.kindIdx = KIND_POKE; out.amount = 0;
      return true;
    case 'release': {
      const h = ev.heldFor;
      if (typeof h !== 'number' || !(h >= RELEASE_SQUEEZE_MIN_S) || h === Infinity) return false; // NaN and short holds fail the test
      out.kind = 'squeeze'; out.kindIdx = KIND_SQUEEZE; out.amount = h > MAX_SQUEEZE_SECONDS ? MAX_SQUEEZE_SECONDS : h;
      return true;
    }
    case 'snap': {
      const i = ev.intensity;
      if (typeof i !== 'number' || !Number.isFinite(i)) return false;
      out.kind = 'pull'; out.kindIdx = KIND_PULL; out.amount = i < 0 ? 0 : i > MAX_PULL_INTENSITY ? MAX_PULL_INTENSITY : i;
      return true;
    }
    default:
      return false;
  }
}

/* ───────────────────────────────────────────────── the play buffer and batch builder ───────────────────────────────────────────────── */

/** One reported touch: [kind 0..2, amount, dtMs] (COLLECTION 7.5). */
export type PlayEvent = [kind: 0 | 1 | 2, amount: number, dtMs: number];

export interface TouchBuffer {
  /** Touches held. */
  readonly size: number;
  /** Touches dropped because the buffer was full (the oldest go first). */
  readonly overflowed: number;
  /** Append one touch. tMs (epoch ms) is clamped so it never goes below the previous touch. Allocation-free. */
  push(kindIdx: number, amount: number, tMs: number): void;
  /** Drop every touch older than cutoffMs (outside the 5-minute bank they would not be paid). */
  dropBefore(cutoffMs: number): number;
  /**
   * The oldest touches as one batch (at most `max`, never more than 120): dtMs is relative to the first touch of the batch, rounded to
   * whole ms, never decreasing. Nothing is removed: call consume(batch.length) when the server acknowledged it. null when empty.
   */
  batch(max?: number): PlayEvent[] | null;
  /** Epoch time of the oldest held touch (NaN when empty). */
  oldestMs(): number;
  /** Remove the n oldest touches (an acknowledged batch). */
  consume(n: number): void;
  /** The held touches as meter interactions (for the preview fold), oldest first. */
  interactions(): Interaction[];
  clear(): void;
}

export function createTouchBuffer(cap: number = TOUCH_BUFFER_CAP): TouchBuffer {
  const n = Math.max(1, Math.floor(cap));
  const kinds = new Uint8Array(n);
  const amounts = new Float64Array(n);
  const times = new Float64Array(n);
  let head = 0; // index of the oldest
  let size = 0;
  let overflowed = 0;
  let lastT = -Infinity;
  const at = (i: number): number => (head + i) % n;
  return {
    get size() { return size; },
    get overflowed() { return overflowed; },
    push(kindIdx, amount, tMs) {
      if (kindIdx !== 0 && kindIdx !== 1 && kindIdx !== 2) return;
      let t = typeof tMs === 'number' && Number.isFinite(tMs) ? tMs : lastT;
      if (!Number.isFinite(t)) return;
      if (t < lastT) t = lastT;
      lastT = t;
      if (size === n) { head = (head + 1) % n; size--; overflowed++; }
      const i = at(size);
      kinds[i] = kindIdx;
      amounts[i] = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
      times[i] = t;
      size++;
    },
    dropBefore(cutoffMs) {
      let k = 0;
      while (size > 0 && times[head] < cutoffMs) { head = (head + 1) % n; size--; k++; }
      return k;
    },
    batch(max = MAX_EVENTS_PER_BATCH) {
      if (size === 0) return null;
      const m = Math.min(size, Math.max(1, Math.floor(max)), MAX_EVENTS_PER_BATCH);
      const t0 = times[head];
      const out: PlayEvent[] = [];
      let prev = 0;
      for (let k = 0; k < m; k++) {
        const i = at(k);
        let dt = Math.round(times[i] - t0);
        if (dt < prev) dt = prev;
        prev = dt;
        out.push([kinds[i] as 0 | 1 | 2, amounts[i], dt]);
      }
      return out;
    },
    oldestMs() { return size ? times[head] : NaN; },
    consume(k) {
      const c = Math.min(size, Math.max(0, Math.floor(k)));
      head = (head + c) % n;
      size -= c;
    },
    interactions() {
      const out: Interaction[] = [];
      for (let k = 0; k < size; k++) { const i = at(k); out.push({ kind: TOUCH_KINDS_BY_INDEX[kinds[i]], amount: amounts[i], tMs: times[i] }); }
      return out;
    },
    clear() { head = 0; size = 0; },
  };
}

/* ───────────────────────────────────────────────── the preview meter ───────────────────────────────────────────────── */

/** fold(addInteraction, start, touches): the meter after these touches. Pure (the start state is not mutated). */
export function foldMeter(start: MeterState, touches: readonly Interaction[]): MeterState {
  let s = start;
  for (const t of touches) s = addInteraction(s, t).state;
  return s;
}

export interface PreviewMeter {
  /** The previewed meter (the server's last state plus the touches it has not acknowledged). */
  readonly state: MeterState;
  /** Capsules the preview has earned since the last reconcile (the optimistic drop cue, COLLECTION 7.4). */
  readonly optimisticCapsules: number;
  /** One local touch. Returns the capsules it earned in the preview. */
  touch(it: Interaction): number;
  /** A server reply: its meter, and the touches still unacknowledged (oldest first). */
  reconcile(serverMeter: unknown, unacked: readonly Interaction[]): void;
  fill(): number;
}

export function createPreviewMeter(initial?: unknown, nowMs?: number): PreviewMeter {
  let state = initial === undefined ? createMeter() : sanitizeMeter(initial, nowMs);
  let optimistic = 0;
  return {
    get state() { return state; },
    get optimisticCapsules() { return optimistic; },
    touch(it) {
      const r = addInteraction(state, it);
      state = r.state;
      optimistic += r.capsulesEarned;
      return r.capsulesEarned;
    },
    reconcile(serverMeter, unacked) {
      state = foldMeter(sanitizeMeter(serverMeter), unacked);
      optimistic = 0;
    },
    fill() { return meterFill(state); },
  };
}
