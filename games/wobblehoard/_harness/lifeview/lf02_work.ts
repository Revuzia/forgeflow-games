// LF-02 in a real browser tab (PG_LIFE round 4): the same measurement as probe_life.ts' LF-02 row, on Chromium's V8 (Ignition, Sparkplug,
// Maglev, TurboFan) instead of node 22's. A live crowd (16 characters in the cabin, high tier, life_host.ts' crowd(31)) is recorded for
// WARM + N ticks; the same snapshots are replayed into fresh worlds built the same way (identical decisions), `passes` times over the whole
// run to warm the JIT, then into one more fresh world: WARM ticks, then N ticks measured in windows of 1000. The runner
// (_harness/probe_life_browser.mjs) reads the heap through CDP around each window (performance.memory is bucketed in headless Chromium).
import type { LifeSnapshot } from '../../src/contracts.ts';
import { lifeStep } from '../../src/life/step.ts';
import type { LifeWorld } from '../../src/life/step.ts';
import { crowd, cloneSnap, mkIntents, mkEvents } from '../life_host.ts';

/** Build the crowd, record WARM + N snapshots, replay them `passes` times into fresh worlds, then WARM ticks into the measured world. The
 *  runner then calls lf02Window(k) for each 1000-tick window and reads the heap through CDP (Runtime.getHeapUsage after
 *  HeapProfiler.collectGarbage) around each call, and an empty call as the baseline (performance.memory is bucketed in headless Chromium). */
let snaps: LifeSnapshot[] = [];
let rep: LifeWorld | null = null;
let WARM = 1000;
const out = mkIntents(), ev = mkEvents();
const replay = (w: LifeWorld, a: number, b: number): void => { for (let f = a; f < b; f++) lifeStep(w, snaps[f], out, ev); };
export function lf02Prepare(passes: number, warm: number, n: number): number {
  WARM = warm; snaps = [];
  const rec = crowd(31); rec.keepLog = false;
  for (let f = 0; f < warm + n; f++) { rec.frame++; rec.t = rec.frame / rec.fps; rec.fill(); snaps.push(cloneSnap(rec.s)); lifeStep(rec.w, rec.s, rec.out, rec.ev); rec.apply(1 / rec.fps); }
  for (let p = 0; p < passes; p++) replay(crowd(31).w, 0, warm + n);
  rep = crowd(31).w;
  replay(rep, 0, warm);
  return snaps.length;
}
/** Replay window k (1000 ticks) into the measured world; returns the ms it took. */
export function lf02Window(k: number): number {
  const t0 = performance.now();
  if (rep) replay(rep, WARM + k * 1000, WARM + (k + 1) * 1000);
  return performance.now() - t0;
}
export function lf02Noop(): number { return 0; }
