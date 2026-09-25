// BLOCKTOOTH v2 — the WARD-7 STREET CAM opening: camera planner + driver (FEATURES_V2 §11). VIEW.
//
// ── L0 SKELETON STUB ── exact CineCamApi members; plan() returns null, so game.ts plays the legacy
// freeze-frame slate unchanged. Lane L10 fills it.

import type { PerspectiveCamera } from 'three';
import type { World } from '../core/types.ts';
import type { CameraRig } from './camera.ts';
import type { CineCamApi, CineChannels, CinePlan, CineShot, CineVariant, FaceAnchor } from '../v2types.ts';

export class CineCam implements CineCamApi {
  constructor(_camera: PerspectiveCamera) { /* L10 */ }
  get active(): boolean { return false; }
  get shot(): CineShot | null { return null; }
  /** STUB: null → legacy slate. */
  plan(_w: World, _rig: CameraRig, _face: FaceAnchor, _variant: CineVariant): CinePlan | null { return null; }
  start(_plan: CinePlan): void { /* L10 */ }
  /** STUB: never active → false (handed back). */
  update(_dt: number): boolean { return false; }
  skip(): void { /* L10 */ }
  stop(): void { /* L10 */ }
  channels(): CineChannels | null { return null; }
}
