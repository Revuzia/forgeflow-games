// BLOCKTOOTH v2 — the objective tracker (top-right) (FEATURES_V2 §4.6). UI.
//
// ── L0 SKELETON STUB ── exact TrackerApi members; builds no DOM. Lane L8 fills it.

import type { SimEvent, World } from '../core/types.ts';
import type { TrackerApi } from '../v2types.ts';

export class ObjectiveTracker implements TrackerApi {
  constructor(_root: HTMLElement) { /* L8 */ }
  show(_on: boolean): void { /* L8 */ }
  update(_w: World, _dt: number): void { /* L8 */ }
  onEvents(_w: World, _ev: readonly SimEvent[]): void { /* L8 */ }
}
