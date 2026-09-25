// BLOCKTOOTH v2 — the cinematic opening's DOM overlay: camcorder viewfinder, lower third, skip hint
// (FEATURES_V2 §11). UI.
//
// ── L0 SKELETON STUB ── exact CineOverlayApi members. game.ts never calls play() while CineCam.plan()
// returns null; if it is called, it resolves 'done' at once (no DOM). Lane L10 fills it.

import type { Input } from '../core/input.ts';
import type { CineInfo, CineOverlayApi, CinePlan, CineShot } from '../v2types.ts';

export class CineOverlay implements CineOverlayApi {
  constructor(_root: HTMLElement, _input: Input) { /* L10 */ }
  play(_plan: CinePlan, _info: CineInfo): Promise<'done' | 'skipped' | 'aborted'> { return Promise.resolve('done'); }
  setShot(_s: CineShot | null): void { /* L10 */ }
  skip(): void { /* L10 */ }
  clear(): void { /* L10 */ }
}
