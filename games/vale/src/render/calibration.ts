// VALE — perf PERF-C1: the first-run calibration's verdict, pure (no GL), so _harness/probe_calibrate.ts can hold it.
//
// rAF intervals on a machine that holds 60 Hz land around 16.7 ms with a tail of vsync jitter: an idle strong machine read
// p95 17.4-18.2 ms at 1080p and the SAME 18.1-18.2 at 5760x3240, so the old single p95 <= 18 test flipped such a player
// between High and Medium and could not separate the two buffers anyway. Three rules replace it:
//   - a window holds 60 when p95 <= 18 ms, or when it is a narrow miss (p95 <= 20 ms) with the frames really there: mean
//     interval <= 17.2 ms and <= 1 % of the intervals over 25 ms (1.5 x a 60 Hz frame). Jitter does not drop frames.
//   - a window that does not hold 60 but whose median still sits at vsync (p50 <= 17.5 ms) was a passing hitch or a machine
//     on the edge: it samples again, at most 3 windows in all; the best window decides. A machine plainly under 60
//     (p50 > 17.5 ms) gets its verdict from the first window and does not wait.
//   - a buffer over CALIB_HIGH_MAX_PIXELS never starts at High whatever the timing says. The sample is 3 s of the quiet Home
//     vale: a machine that holds vsync there at 19 MP has no margin known for a fight, and the player can raise it.
//     3840x2160 (8.3 MP) stays under the cap and is judged by its timing.

export type CalibPreset = 'high' | 'medium' | 'low';

/** one window's frame intervals, summed up */
export interface CalibWindow { frames: number; meanMs: number; p50Ms: number; p95Ms: number; slowShare: number }

export const CALIB_HIGH_P95_MS = 18;
export const CALIB_NARROW_P95_MS = 20;
export const CALIB_MEDIUM_P95_MS = 26;
export const CALIB_HOLD_MEAN_MS = 17.2;
export const CALIB_SLOW_MS = 25;
export const CALIB_SLOW_SHARE = 0.01;
export const CALIB_VSYNC_P50_MS = 17.5;
export const CALIB_MAX_WINDOWS = 3;
export const CALIB_HIGH_MAX_PIXELS = 10_000_000;
/** below this many intervals there is nothing to judge: a hidden page, a caller that stopped drawing (keeps the default) */
export const CALIB_MIN_FRAMES = 30;

export function calibWindow(intervals: readonly number[]): CalibWindow {
  const s = intervals.slice().sort((a, b) => a - b);
  const at = (k: number): number => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * k))]! : 0);
  const sum = s.reduce((t, x) => t + x, 0);
  return {
    frames: s.length, meanMs: s.length ? sum / s.length : 0, p50Ms: at(0.5), p95Ms: at(0.95),
    slowShare: s.length ? s.filter((x) => x > CALIB_SLOW_MS).length / s.length : 0,
  };
}

export function holds60(w: CalibWindow): boolean {
  if (w.p95Ms <= CALIB_HIGH_P95_MS) return true;
  return w.p95Ms <= CALIB_NARROW_P95_MS && w.meanMs <= CALIB_HOLD_MEAN_MS && w.slowShare <= CALIB_SLOW_SHARE;
}

/** should the calibration sample again after these windows? */
export function calibAgain(windows: readonly CalibWindow[]): boolean {
  const w = windows[windows.length - 1];
  if (!w || windows.length >= CALIB_MAX_WINDOWS || w.frames < CALIB_MIN_FRAMES) return false;
  return !windows.some(holds60) && w.p50Ms <= CALIB_VSYNC_P50_MS;
}

/** the verdict over every window taken; `capped` says the buffer alone held it off High */
export function calibVerdict(windows: readonly CalibWindow[], pixels: number): { preset: CalibPreset; best: CalibWindow | null; capped: boolean } {
  const real = windows.filter((w) => w.frames >= CALIB_MIN_FRAMES);
  const capOff = pixels > CALIB_HIGH_MAX_PIXELS;
  if (!real.length) return { preset: capOff ? 'medium' : 'high', best: windows[0] ?? null, capped: capOff };
  const best = real.find(holds60) ?? real.reduce((a, b) => (b.p95Ms < a.p95Ms ? b : a));
  const timed: CalibPreset = holds60(best) ? 'high' : best.p95Ms <= CALIB_MEDIUM_P95_MS ? 'medium' : 'low';
  return timed === 'high' && capOff ? { preset: 'medium', best, capped: true } : { preset: timed, best, capped: false };
}
