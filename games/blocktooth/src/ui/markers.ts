// BLOCKTOOTH v2 — the DOM marker layer: on-screen pins and off-screen edge arrows for objectives,
// power-ups and the TILL (FEATURES_V2 §5.4). UI.
//
// ── L0 SKELETON STUB ── exact MarkersApi members; builds no DOM. Lane L8 fills it.

import type { MarkerFrame, MarkersApi } from '../v2types.ts';

export class ScreenMarkers implements MarkersApi {
  constructor(_root: HTMLElement) { /* L8 */ }
  show(_on: boolean): void { /* L8 */ }
  update(_f: MarkerFrame): void { /* L8 */ }
}
