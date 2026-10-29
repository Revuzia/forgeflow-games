// VALE render — public entry (CONTRACT §9). Everything other lanes may import from the renderer.
export { createRenderer } from './renderer.ts';
export type { AimSpec, CameraControl, Renderer, RendererOptions, RenderStats, ViewState } from './renderer.ts';
export type { EventVfxKey, EventVfxMap, StatusVfxMap } from './director.ts';
export type { CameraMode } from './camera.ts';
export { CAMERA } from './camera.ts';
export { presetVideo, resolveQuality, type Tier } from './quality.ts';
