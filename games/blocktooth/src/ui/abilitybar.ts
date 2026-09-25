// BLOCKTOOTH v2 — the ability bar: owned-card slots + level badges, the UPROAR meter, the ACTIVE (hook)
// cooldown panel (FEATURES_V2 §4). UI.
//
// ── L0 SKELETON STUB ── exact AbilityBarApi members; builds no DOM. Lane L8 fills it (and imports
// ui/hud_v2.css) and puts the §13.3 `data-v2` hooks on its visible nodes.

import type { SimEvent, World } from '../core/types.ts';
import type { AbilityBarApi } from '../v2types.ts';

export class AbilityBar implements AbilityBarApi {
  constructor(_root: HTMLElement) { /* L8 */ }
  show(_on: boolean): void { /* L8 */ }
  update(_w: World, _dt: number): void { /* L8 */ }
  onEvents(_w: World, _ev: readonly SimEvent[]): void { /* L8 */ }
}
