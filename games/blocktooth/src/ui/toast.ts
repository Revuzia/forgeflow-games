// BLOCKTOOTH v2 — the v2 toast stack (GOAL MET, RESTRUCTURED, revive) below the broadcast toast slot
// (FEATURES_V2 §8.4). UI.
//
// ── L0 SKELETON STUB ── exact ToastsApi members; shows nothing. Lane L8 fills it.

import type { ToastSpec, ToastsApi } from '../v2types.ts';

export class Toasts implements ToastsApi {
  constructor(_root: HTMLElement) { /* L8 */ }
  push(_t: ToastSpec): void { /* L8 */ }
  clear(): void { /* L8 */ }
}
