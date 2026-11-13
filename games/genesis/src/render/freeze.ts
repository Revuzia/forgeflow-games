// GENESIS — `?freeze=1` (ROADMAP-60FPS step 2; off by default): a diagnostic, not a mode to play in.
//
// Once the terrain's landing has converged (nothing landed, queued or pending for FREEZE_QUIET frames in a row; or the
// camera has rested FREEZE_STILL_S seconds) the
// world stops changing on the GPU: chunk landing stops, vegetation / ground cover keep their instances (no flushRanges,
// no near rebuilds), life's instance buffers (bodies, boats, camps, roads) skip uploadPrefix and every ring mark, the
// road ribbons, particles and field / direction / overlay textures do not rebuild or update, and the sim runs at speed
// 0 (app.ts: from the start, so a camera at rest is at rest in every body's frame). Uniforms (time, sway, sun) still move. With the camera at rest the frame then draws the same draws and
// triangles with NO uploads: its fps against the base run splits "frame structure" (uploads breaking Metal passes,
// ANGLE copies) from "GPU execution" (the passes' own cost). The perf report prints the state (freezeLine).

import { perfNum, perfSwitch, perfSwitchNote } from './perfswitch.ts';

/** frames in a row with no landing activity before the freeze takes hold (`?freezequiet=N`: local probes) */
export const FREEZE_QUIET = Math.max(1, perfNum('freezequiet', 90) ?? 90);

export const FREEZE = {
  /** `?freeze=1` was asked for */
  on: perfSwitch('freeze', false),
  /** the world is frozen now (landing converged) */
  active: false,
  /** frames in a row without landing activity */
  quiet: 0,
  /** performance.now() when it took hold */
  since: 0,
};
try { (globalThis as unknown as { __GENESIS_FREEZE__?: typeof FREEZE }).__GENESIS_FREEZE__ = FREEZE; } catch { /* none */ }

/** (`?freezestill=S`) the camera at rest this many seconds freezes the world even while landing still churns */
export const FREEZE_STILL_S = Math.max(1, perfNum('freezestill', 15) ?? 15);

const lodQuiet = new Map<number, number>();
const lodCam = new Map<number, [number, number, number]>();
let stillSince = 0;
let why = '';

/**
 * (chunks.ts select: every patch manager, every frame) is its landing still busy, and where is the camera (body frame).
 * The freeze takes hold when every manager has been quiet FREEZE_QUIET frames in a row (landing converged) or, failing
 * that, when the camera has been at rest FREEZE_STILL_S seconds (a landing that never settles at rest is itself a
 * finding: the report says which).
 */
export function freezeLandTick(id: number, busy: boolean, cx: number, cy: number, cz: number): void {
  if (!FREEZE.on || FREEZE.active) return;
  const now = performance.now();
  const q = busy ? 0 : (lodQuiet.get(id) ?? 0) + 1;
  lodQuiet.set(id, q);
  const c = lodCam.get(id);
  if (!c || Math.hypot(cx - c[0], cy - c[1], cz - c[2]) > 0.5) { lodCam.set(id, [cx, cy, cz]); stillSince = now; }
  let minQ = Infinity;
  for (const v of lodQuiet.values()) minQ = Math.min(minQ, v);
  FREEZE.quiet = minQ;
  const converged = minQ >= FREEZE_QUIET;
  const still = stillSince > 0 && now - stillSince >= FREEZE_STILL_S * 1000;
  if (converged || still) {
    FREEZE.active = true;
    FREEZE.since = now;
    why = converged ? 'landing converged' : `camera at rest ${FREEZE_STILL_S} s while landing was still busy (quiet ${minQ}/${FREEZE_QUIET} frames)`;
    perfSwitchNote('freeze', '1(active)');
    try { console.info(`[genesis] freeze: ${why}, world frozen`); } catch { /* none */ }
  }
}

/** (tests) forget the tick state */
export function freezeReset(): void { lodQuiet.clear(); lodCam.clear(); stillSince = 0; why = ''; FREEZE.active = false; FREEZE.quiet = 0; }

export function freezeLine(): string {
  return `freeze: ${FREEZE.active ? `ACTIVE for ${Math.round((performance.now() - FREEZE.since) / 1000)} s, by ${why} (landing, vegetation, life uploads, roads, particles, field textures stopped; sim speed 0)` : `waiting for landing to converge (quiet ${FREEZE.quiet}/${FREEZE_QUIET} frames) or the camera to rest ${FREEZE_STILL_S} s: NOT frozen yet`}`;
}
