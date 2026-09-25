// BLOCKTOOTH v2 — UPROAR view: roar shockwave, per-titan blast looks (FEATURES_V2 §3.7). VIEW.
//
// ── L0 SKELETON STUB ── mounted by game.ts, draws nothing. Lane L6 fills it (reads ultFire / ultPulse /
// ultEnd events and w.ult; never writes gameplay state).

import type { World } from '../core/types.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';

export class UltView implements ViewModule {
  constructor(_ctx: ViewCtx) { /* L6 */ }
  mount(_w: World): void { /* L6 */ }
  update(_w: World, _f: FrameInfo): void { /* L6 */ }
  unmount(): void { /* L6 */ }
}
