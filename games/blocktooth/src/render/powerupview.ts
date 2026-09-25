// BLOCKTOOTH v2 — map power-up tokens + their active looks (FEATURES_V2 §6.3). VIEW.
//
// ── L0 SKELETON STUB ── mounted by game.ts, draws nothing. Lane L6 fills it (reads w.map.powerups,
// w.map.redLightT / rushHourT and powerup* events).

import type { World } from '../core/types.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';

export class PowerupView implements ViewModule {
  constructor(_ctx: ViewCtx) { /* L6 */ }
  mount(_w: World): void { /* L6 */ }
  update(_w: World, _f: FrameInfo): void { /* L6 */ }
  unmount(): void { /* L6 */ }
}
