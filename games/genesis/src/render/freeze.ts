// GENESIS — `?freeze=1` (ROADMAP-60FPS step 2; off by default): a diagnostic, not a mode to play in.
//
// Once the terrain's landing has converged (nothing landed, queued or pending for FREEZE_QUIET frames in a row) the
// world stops changing on the GPU: chunk landing stops, vegetation / ground cover keep their instances (no flushRanges,
// no near rebuilds), life's instance buffers (bodies, boats, camps, roads) skip uploadPrefix and every ring mark, the
// road ribbons, particles and field / direction / overlay textures do not rebuild or update, and the sim runs at speed
// 0 (app.ts). Uniforms (time, sway, sun) still move. With the camera at rest the frame then draws the same draws and
// triangles with NO uploads: its fps against the base run splits "frame structure" (uploads breaking Metal passes,
// ANGLE copies) from "GPU execution" (the passes' own cost). The perf report prints the state (freezeLine).

import { perfSwitch, perfSwitchNote } from './perfswitch.ts';

/** frames in a row with no landing activity before the freeze takes hold */
export const FREEZE_QUIET = 90;

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

/** (chunks.ts select, every patch manager every frame) whether landing is still busy; the freeze takes hold after FREEZE_QUIET quiet frames */
export function freezeLandTick(busy: boolean): void {
  if (!FREEZE.on || FREEZE.active) return;
  FREEZE.quiet = busy ? 0 : FREEZE.quiet + 1;
  if (FREEZE.quiet >= FREEZE_QUIET) {
    FREEZE.active = true;
    FREEZE.since = performance.now();
    perfSwitchNote('freeze', '1(active)');
    try { console.info('[genesis] freeze: landing converged, world frozen'); } catch { /* none */ }
  }
}

export function freezeLine(): string {
  return `freeze: ${FREEZE.active ? `ACTIVE for ${Math.round((performance.now() - FREEZE.since) / 1000)} s (landing, vegetation, life uploads, roads, particles, field textures stopped; sim speed 0)` : `waiting for landing to converge (quiet ${FREEZE.quiet}/${FREEZE_QUIET} frames): NOT frozen yet`}`;
}
