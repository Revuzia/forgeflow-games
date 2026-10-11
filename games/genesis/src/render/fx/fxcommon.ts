// GENESIS — shared pieces of the god-layer FX (CONTRACT.md §15.7): the FX clock, GLSL for soft depth tests against
// the scene's linear depth (FX are drawn over the composited image, after the atmosphere, like render/fx/particles.ts),
// display-referred emission (the adapted exposure), and small vector helpers in a planet's body frame.

import type { IUniform } from 'three';
import { FX_EXPOSURE } from './particles.ts';

/** render layer of the god-layer FX drawn over the composited image (fx/godfx.ts renders it after the atmosphere) */
export const FX_LAYER = 4;

/** uniforms every FX material shares (set once per frame by GodFx) */
export interface FxShared {
  uFxTime: IUniform<number>;
  tSceneDepth: IUniform<unknown>;
  uResolution: IUniform<{ x: number; y: number; set(x: number, y: number): unknown }>;
  tExposure: IUniform<unknown>;
  uHasExposure: IUniform<number>;
}

export { FX_EXPOSURE };

/**
 * GLSL: the scene's view depth at this pixel, a soft visibility of a fragment at view depth `z` against it (0 behind
 * the opaque scene, ramping to 1 over `soft` metres in front), and the display-referred scale for emission (radiance
 * that lands at the same brightness on screen by day and by night).
 */
export const FX_DEPTH_GLSL = /* glsl */ `
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
uniform sampler2D tExposure;
uniform float uHasExposure;
uniform float uFxTime;
float fxSceneZ() { return texture(tSceneDepth, gl_FragCoord.xy / uResolution).r; }
float fxSoft(float z, float soft) {
  float sz = fxSceneZ();
  return clamp((sz - z) / max(soft, 1e-3), 0.0, 1.0);
}
float fxExposure() { return uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 1e-4) : 1.0; }
// emission that reads the same on screen at any exposure, blended with physical radiance by k (0 physical, 1 display)
float fxDisplay(float k) { return mix(1.0, 1.0 / fxExposure(), k); }
float fxHash(float a, float b) { return fract(sin(a * 127.1 + b * 311.7) * 43758.5453); }
`;

export type V3 = [number, number, number];

/** an east / north / up frame at a unit vector on a planet (body frame); east is undefined at the poles: any tangent */
export function enu(u: ArrayLike<number>, e: V3, n: V3): void {
  let ex = u[2], ey = 0, ez = -u[0];
  let el = Math.sqrt(ex * ex + ez * ez);
  if (el < 1e-6) { ex = 1; ey = 0; ez = 0; el = 1; }
  ex /= el; ez /= el;
  e[0] = ex; e[1] = ey; e[2] = ez;
  n[0] = u[1] * ez - u[2] * ey; n[1] = u[2] * ex - u[0] * ez; n[2] = u[0] * ey - u[1] * ex;
}

export function normalize3(v: V3): V3 {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  v[0] /= l; v[1] /= l; v[2] /= l;
  return v;
}

/** deterministic hash → [0, 1) for render-side variation (never the sim's) */
export function fxHash(a: number, b = 0, c = 0): number {
  let h = Math.imul((a * 73856093) ^ (b * 19349663) ^ (c * 83492791), 0x9e3779b1) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
  return h / 4294967296;
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a: number, b: number, x: number): number => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
