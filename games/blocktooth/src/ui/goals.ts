// BLOCKTOOTH v2 — GOALS & RECORDS screen + the NEXT PERMIT PENDING slip (FEATURES_V2 §8.4). UI.
//
// ── L0 SKELETON STUB ── exact GoalsScreenApi / NextUnlockPanelApi members. The title and select stubs
// never resolve 'goals', so open() is not reached in play; if called it resolves at once. Lane L9
// fills it (and imports ui/screens_v2.css).

import type { BiomeId, Profile, TitanId } from '../core/types.ts';
import type { Input } from '../core/input.ts';
import type { GoalsScreenApi, NextUnlockPanelApi } from '../v2types.ts';

export class GoalsScreen implements GoalsScreenApi {
  constructor(_root: HTMLElement, _input: Input) { /* L9 */ }
  open(_p: Profile, _bests: Record<string, number>): Promise<void> { return Promise.resolve(); }
}

export class NextUnlockPanel implements NextUnlockPanelApi {
  constructor(_host: HTMLElement) { /* L9 */ }
  set(_p: Profile, _titan: TitanId, _biome: BiomeId | null): void { /* L9 */ }
}
