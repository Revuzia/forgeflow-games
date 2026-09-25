// BLOCKTOOTH v2 — map-objective view: OVERLOAD SITE dressing, RELIEF DEPOT crates, RECORDS ANNEX
// guard post + beacons (FEATURES_V2 §5.4). VIEW.
//
// ── L0 SKELETON STUB ── mounted by game.ts, draws nothing. Lane L6 fills it (reads w.map.objectives and
// objective* events).

import type { World } from '../core/types.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';

export class ObjectiveView implements ViewModule {
  constructor(_ctx: ViewCtx) { /* L6 */ }
  mount(_w: World): void { /* L6 */ }
  update(_w: World, _f: FrameInfo): void { /* L6 */ }
  unmount(): void { /* L6 */ }
}
