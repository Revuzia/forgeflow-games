// BLOCKTOOTH v2 — marker projection: objective / power-up / TILL anchors → CSS-px screen positions and
// off-screen edge arrows for the DOM marker layer (ui/markers.ts) (FEATURES_V2 §5.4). VIEW.
//
// ── L0 SKELETON STUB ── frame() always returns no items. Lane L6 fills it (≤ 12 items per frame).

import type { World } from '../core/types.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';
import type { MarkerFrame, MarkerViewApi } from '../v2types.ts';

export class MarkerView implements ViewModule, MarkerViewApi {
  private readonly empty: MarkerFrame = { items: [] };
  constructor(_ctx: ViewCtx) { /* L6 */ }
  mount(_w: World): void { /* L6 */ }
  update(_w: World, _f: FrameInfo): void { /* L6 */ }
  unmount(): void { /* L6 */ }
  /** STUB: no markers. */
  frame(): MarkerFrame { return this.empty; }
}
