// Visible XP (_spec/FUN.md section 2, owner direction 2026-10-06): every touch that PAYS shows it, and a held squeeze or stretch shows what
// it will pay while it is held. The rules themselves are the meter's (src/core/meter.ts, the ECON lane); this file only READS them.
// OWNER DECISION 2026-10-06 (final, given in chat): "short taps pay nothing". A tap (a 'poke' SoftEvent, or a squeeze released under 0.4 s)
// pays 0 SP, so it has NO gain (the game emits a 'gain' event, and the HUD its sparks and ring glow, only when gainOf is above 1e-6 SP),
// NO pending arc (nothing in this file previews a tap: only a squeeze held 0.4 s or more and a stretch ever pend) and NO ring move. The
// 'poke' GainKind below is kept only because game.ts maps the SoftEvent kinds through it; a poke can never reach a positive gain.
//
//   gainOf(before, after)      the squish points one fed touch added (the meter view before and after collection.feed); > 0 = it paid.
//                              A capsule earned on the way counts the rest of the old threshold plus the new fill. Nothing else is
//                              inferred: a touch the meter refused (valve, table full, done for today) and a tap (pays 0) paid nothing
//                              and show nothing.
//   createPending(...)         the PENDING gain of the touch in progress, as a fraction of the ring (the lighter arc). Two sources:
//                                1. the collection's own pure preview, Collection.previewTouch(kind, heldS, level) (ECON, checkpoint 41:
//                                   freshness, a completed medley, the daily rate and the valve's room; 0 for a full table, a tap (a poke, a
//                                   squeeze under 0.4 s: they pay nothing), a pull at level 0.05 or less), called POSITIONALLY with a level that only changes when the pull
//                                   level moves by LEVEL_STEP (a fresh double per frame would box);
//                                2. a collection without it: the published pay constants (meter.ts PAY: squeezeBase + squeezePerSecond x
//                                   the hold up to squeezeHoldCapSeconds + the soft pop; a stretched pull pullBase + pullPerSecond x the
//                                   hold up to pullHoldCapSeconds, pullFail flat under pullFullIntensity) x the freshness of that kind
//                                   (FRESHNESS_TAU_SECONDS / FRESHNESS_FLOORS, from the last touch of that kind that paid, as the shell saw
//                                   it), x0.25 while resting, 0 when done for today or the table is full.
//                              The preview can show pay a release never banks (a squeeze's release only counts above compression 0.08):
//                              the HUD banks the arc only when a gain actually arrives (hudBinding.ts), else lets it collapse.
//                              Allocation-free per call (the meter view is cached by the caller and refreshed on change).
import type { TouchKind } from '../core/meter.ts';
import type { MeterView } from '../collection/types.ts';
import { DAILY_REDUCED_RATE, FRESHNESS_FLOORS, FRESHNESS_TAU_SECONDS, PAY } from '../core/meter.ts';

export type GainKind = 'poke' | 'squeeze' | 'pull';
/** A touch that paid: what kind, how many squish points, and where it was on the canvas (CSS px; null = off screen). Never a 0 SP touch:
 *  a tap pays nothing, so a 'poke' gain does not occur. */
export interface Gain { kind: GainKind; sp: number; x: number | null; y: number | null }

/** A gain at or under this many squish points is no gain (game.ts emits 'gain' only above it): the smallest real pay is a freshness-floor
 *  squeeze held 0.4 s, 0.03 x 0.94 = 0.028 SP, far above it. A tap pays exactly 0. */
export const GAIN_EPS = 1e-6;

/** Squish points one fed touch added, from the meter view before and after it. 0 for a touch that paid nothing (a tap, a refused touch). */
export function gainOf(before: MeterView, after: MeterView): number {
  const dc = after.credits - before.credits;
  const g = dc > 0 ? Math.max(0, before.threshold - before.sp) + Math.max(0, after.sp) + Math.max(0, dc - 1) * after.threshold : after.sp - before.sp;
  return g > GAIN_EPS ? g : 0;
}

/** The collection's preview of a touch in progress (Collection.previewTouch), positional. */
export type PreviewTouch = (kind: TouchKind, heldS: number, level: number) => number;

/** The pull level passed to the preview moves in steps of this much (a stable number between steps). */
export const LEVEL_STEP = 0.01;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** The published-constants estimate of what a held touch would pay if it were let go now (before freshness and the daily rate). A squeeze
 *  held under PAY.minSqueezeHoldSeconds (0.4 s) is a tap: 0, like Collection.previewTouch, so the two paths agree. */
export function heldPay(kind: 'squeeze' | 'pull', heldS: number, level: number): number {
  if (!(heldS >= 0)) return 0;
  if (kind === 'squeeze') {
    if (heldS < PAY.minSqueezeHoldSeconds) return 0;   // a tap pays nothing
    return PAY.squeezeBase + PAY.squeezePerSecond * clamp(heldS, 0, PAY.squeezeHoldCapSeconds) + (heldS >= PAY.softPopHoldSeconds ? PAY.softPop : 0);
  }
  if (!(level > 0.05)) return 0;   // a pull at 0.05 of its reach or less fires no snap at all (contracts.ts PULL INTENSITY)
  if (level < PAY.pullFullIntensity) return PAY.pullFail;   // never stretched: flat
  return PAY.pullBase + PAY.pullPerSecond * clamp(heldS, 0, PAY.pullHoldCapSeconds);
}

export interface Pending {
  /** the touches in progress now: call once per sim step; returns the pending gain as a fraction of the ring (0 = nothing pending) */
  fill(meter: MeterView | null, nowMs: number): number;
  /** a touch of this kind paid at nowMs (the constants path restarts its freshness) */
  paid(kind: GainKind, nowMs: number): void;
  /** where the pending figure comes from: the collection's preview or the published constants */
  readonly source: 'collection' | 'constants';
}

export interface PendingDeps {
  /** Collection.previewTouch, bound; null = the collection has none (the constants path) */
  preview: PreviewTouch | null;
  /** per finger 0 / 1: a squeeze held for this many seconds (0 = no finger down) */
  heldFor(slot: number): number;
  /** per finger 0 / 1: a stretch held for this many seconds (0 = no grab) */
  pullFor(slot: number): number;
  /** per finger 0 / 1: the live pull level 0..1 */
  pullLevel(slot: number): number;
}

const KIND_IDX: Record<GainKind, number> = { poke: 0, squeeze: 1, pull: 2 };

export function createPending(d: PendingDeps): Pending {
  const preview = d.preview;
  const last = [-1e15, -1e15, -1e15];
  // the level handed to the preview per finger: kept as the same number until the live level moves by LEVEL_STEP
  let level0 = 0, level1 = 0;
  const stableLevel = (f: number, live: number): number => {
    if (f === 0) { if (Math.abs(live - level0) >= LEVEL_STEP) level0 = Math.round(live / LEVEL_STEP) * LEVEL_STEP; return level0; }
    if (Math.abs(live - level1) >= LEVEL_STEP) level1 = Math.round(live / LEVEL_STEP) * LEVEL_STEP;
    return level1;
  };
  const fresh = (k: number, nowMs: number): number => {
    const s = (nowMs - last[k]) / 1000 / FRESHNESS_TAU_SECONDS[k];
    return clamp(s * s, FRESHNESS_FLOORS[k], 1);
  };
  const one = (kind: 'squeeze' | 'pull', heldS: number, level: number, nowMs: number): number => {
    if (preview) {
      let v = 0;
      try { v = preview(kind, heldS, level); } catch { v = 0; }
      return v > 0 && Number.isFinite(v) ? v : 0;
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
        if (ph > 0) sp += one('pull', ph, stableLevel(f, d.pullLevel(f)), nowMs);
      }
      if (!(sp > 0)) return 0;
      if (!preview && m.resting) sp *= DAILY_REDUCED_RATE;
      return clamp(sp / m.threshold, 0, 1);
    },
  };
}
