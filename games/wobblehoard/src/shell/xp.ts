// Visible XP (_spec/FUN.md section 2, owner direction 2026-10-06): every touch that pays shows it, and a held squeeze or stretch shows what
// it will pay while it is held. The rules themselves are the meter's (src/core/meter.ts, the ECON lane); this file only READS them.
//
//   gainOf(before, after)      the squish points one fed touch added (the meter view before and after collection.feed); > 0 = it paid.
//                              A capsule earned on the way counts the rest of the old threshold plus the new fill. Nothing else is
//                              inferred: a touch the meter refused (valve, table full, done for today) paid nothing and shows nothing.
//   createPending(...)         the PENDING gain of the touch in progress, as a fraction of the ring (the lighter arc). Two sources:
//                                1. the collection's own pure preview of a touch in progress, when it offers one (ECON is adding it as
//                                   Collection.previewTouch over meter.ts previewInteraction; feature-detected by name, PREVIEW_NAMES, and
//                                   called with an Interaction-shaped query { kind, amount, heldS, tMs } (+ level): squeeze amount = the
//                                   hold, pull amount = the pull level and heldS = the hold; a number or { sp | spGained } comes back);
//                                2. until then, the published pay constants (meter.ts PAY): a squeeze pays squeezeBase + squeezePerSecond x
//                                   the hold (up to squeezeHoldCapSeconds) + the soft pop from softPopHoldSeconds, from minSqueezeHoldSeconds
//                                   on; a stretch pays pullBase + pullPerSecond x the hold up to pullHoldCapSeconds once it is stretched
//                                   (pullFullIntensity), pullFail flat under it (older meters without the per-second keys: the squeeze's).
//                                   Then the freshness of that kind (meter.ts FRESHNESS_TAU_SECONDS, from the last touch of that kind
//                                   that paid, as the shell saw it), x0.25 while resting, 0 when done for today or the table is full.
//                              Allocation-free per call on path 2 (the meter view is cached by the caller and refreshed on change).
import type { MeterView } from '../collection/types.ts';
import * as Meter from '../core/meter.ts';
import { DAILY_REDUCED_RATE, FRESHNESS_FLOOR, FRESHNESS_TAU_SECONDS, PAY } from '../core/meter.ts';

export type GainKind = 'poke' | 'squeeze' | 'pull';
/** A touch that paid: what kind, how many squish points, and where it was on the canvas (CSS px; null = off screen). */
export interface Gain { kind: GainKind; sp: number; x: number | null; y: number | null }

/** Squish points one fed touch added, from the meter view before and after it. */
export function gainOf(before: MeterView, after: MeterView): number {
  const dc = after.credits - before.credits;
  if (dc > 0) return Math.max(0, before.threshold - before.sp) + Math.max(0, after.sp) + Math.max(0, dc - 1) * after.threshold;
  return after.sp - before.sp;
}

/** The names the ECON lane's pure "pending gain of a touch in progress" may carry on the collection (first match wins). */
export const PREVIEW_NAMES = ['previewTouch', 'previewPending', 'pendingGain', 'previewHold'] as const;
export interface PendingQuery { kind: 'squeeze' | 'pull'; amount: number; heldS: number; level: number; tMs: number }
type PreviewFn = (q: PendingQuery) => unknown;

export function findPreview(c: unknown): PreviewFn | null {
  if (!c || typeof c !== 'object') return null;
  for (const n of PREVIEW_NAMES) {
    const f = (c as Record<string, unknown>)[n];
    if (typeof f === 'function') return (q) => (f as PreviewFn).call(c, q);
  }
  return null;
}
/** a preview's answer as squish points: a number, or an object with sp / spGained / pending; NaN when it is not one */
function spOf(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['sp', 'spGained', 'pending', 'gain']) if (typeof o[k] === 'number') return o[k] as number;
  }
  return NaN;
}

// read through a loose view: the ECON lane is moving the pull to per-second pay (pullBase, pullPerSecond, pullHoldCapSeconds) and per-kind
// freshness floors (FRESHNESS_FLOORS); this file compiles and estimates with either version of meter.ts
const P = PAY as unknown as Record<string, number | undefined>;
const FLOORS = (Meter as unknown as { FRESHNESS_FLOORS?: readonly number[] }).FRESHNESS_FLOORS;
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** The published-constants estimate of what a held touch would pay if it were let go now (before freshness and the daily rate). */
export function heldPay(kind: 'squeeze' | 'pull', heldS: number, level: number): number {
  if (!(heldS >= 0)) return 0;
  if (kind === 'squeeze') {
    if (heldS < PAY.minSqueezeHoldSeconds) return 0;
    return PAY.squeezeBase + PAY.squeezePerSecond * clamp(heldS, 0, PAY.squeezeHoldCapSeconds) + (heldS >= PAY.softPopHoldSeconds ? PAY.softPop : 0);
  }
  if (!(level > 0.05)) return 0;   // a pull under 0.05 of its reach is no snap at all (contracts.ts PULL INTENSITY)
  if (level < PAY.pullFullIntensity) return PAY.pullFail;   // never stretched: flat
  const base = P.pullBase ?? P.pull ?? PAY.squeezeBase;
  const perS = P.pullPerSecond ?? PAY.squeezePerSecond;
  const cap = P.pullHoldCapSeconds ?? PAY.squeezeHoldCapSeconds;
  return base + perS * clamp(heldS, 0, cap);
}

export interface Pending {
  /** the touches in progress now: call once per sim step; returns the pending gain as a fraction of the ring (0 = nothing pending) */
  fill(meter: MeterView | null, nowMs: number): number;
  /** a touch of this kind paid at nowMs (its freshness restarts) */
  paid(kind: GainKind, nowMs: number): void;
  /** where the pending figure comes from: the collection's preview or the published constants */
  readonly source: 'collection' | 'constants';
}

export interface PendingDeps {
  collection: unknown;
  /** per finger 0 / 1: a squeeze held for this many seconds (0 = no finger down) */
  heldFor(slot: number): number;
  /** per finger 0 / 1: a stretch held for this many seconds (0 = no grab) */
  pullFor(slot: number): number;
  /** per finger 0 / 1: the live pull level 0..1 */
  pullLevel(slot: number): number;
}

const KIND_IDX: Record<GainKind, number> = { poke: 0, squeeze: 1, pull: 2 };

export function createPending(d: PendingDeps): Pending {
  const preview = findPreview(d.collection);
  const last = [-1e15, -1e15, -1e15];
  const q: PendingQuery = { kind: 'squeeze', amount: 0, heldS: 0, level: 0, tMs: 0 };   // reused: no allocation per call
  const fresh = (k: number, nowMs: number): number => {
    const s = (nowMs - last[k]) / 1000 / FRESHNESS_TAU_SECONDS[k];
    return clamp(s * s, FLOORS?.[k] ?? FRESHNESS_FLOOR, 1);
  };
  const one = (kind: 'squeeze' | 'pull', heldS: number, level: number, nowMs: number): number => {
    if (preview) {
      q.kind = kind; q.heldS = heldS; q.level = level; q.tMs = nowMs; q.amount = kind === 'squeeze' ? heldS : level;
      let v = NaN;
      try { v = spOf(preview(q)); } catch { v = NaN; }
      if (Number.isFinite(v)) return Math.max(0, v);
    }
    const base = heldPay(kind, heldS, level);
    return base > 0 ? base * fresh(KIND_IDX[kind], nowMs) : 0;
  };
  return {
    get source() { return preview ? 'collection' : 'constants'; },
    paid(kind, nowMs) { last[KIND_IDX[kind]] = nowMs; },
    fill(m, nowMs) {
      if (!m || m.doneToday || m.tableFull || !(m.threshold > 0)) return 0;
      let sp = 0;
      for (let f = 0; f < 2; f++) {
        const h = d.heldFor(f);
        if (h > 0) sp += one('squeeze', h, 0, nowMs);
        const ph = d.pullFor(f);
        if (ph > 0) sp += one('pull', ph, d.pullLevel(f), nowMs);
      }
      if (!(sp > 0)) return 0;
      if (!preview && m.resting) sp *= DAILY_REDUCED_RATE;
      return clamp(sp / m.threshold, 0, 1);
    },
  };
}
