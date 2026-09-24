// BLOCKTOOTH — VIEW contract (CONTRACT.md §6). Views read sim state + events; they
// NEVER write gameplay state (doctrine §4: "the view reads events, never writes gameplay").
import type * as THREE from 'three';
import type { SimEvent, World } from '../core/types.ts';

export interface Quality {
  /** device-pixel-ratio cap actually applied (≤ BUDGET.dprMax) */
  dpr: number;
  shadows: boolean;
  /** 0 = low, 1 = medium, 2 = high — views scale particle counts / debris pool by it */
  level: 0 | 1 | 2;
  reduceFlashing: boolean;
  screenShake: boolean;
}

export interface ViewCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  quality: Quality;
}

export interface FrameInfo {
  /** interpolation factor between the previous and current sim tick (0..1) */
  alpha: number;
  /** real seconds since the previous rendered frame (clamped to 0.1) */
  dt: number;
  /** real seconds since page load (for cosmetic animation) */
  time: number;
  /** every sim event emitted since the previous rendered frame, in emission order */
  events: readonly SimEvent[];
  /** current camera distance to its look target (m) — LOD / particle-size scaling */
  camDist: number;
  /** true while the sim is frozen (draft, pause, slate); views keep idling cosmetics */
  frozen: boolean;
}

/**
 * Every run-scoped view implements this. Construction happens once per page
 * (`new XView(ctx)`); mount/unmount once per run; update once per rendered frame.
 */
export interface ViewModule {
  mount(world: World): void | Promise<void>;
  update(world: World, f: FrameInfo): void;
  unmount(): void;
}

/** Interpolate a sim pose for rendering. */
export function lerpPose(prev: number, cur: number, alpha: number): number { return prev + (cur - prev) * alpha; }
