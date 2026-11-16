// GENESIS — reversed-Z float depth in place of the logarithmic depth buffer (ROADMAP-60FPS step 8, `?revz=1` on; default off).
//
// The logarithmic depth buffer makes EVERY fragment shader write gl_FragDepth. A shader that writes depth cannot be
// depth-tested before it runs (and on Apple GPUs it switches the tile renderer's hidden-surface removal off), so the
// 1900-line terrain shader ran under every tree, house and person. zcons.ts won part of that back with conservative
// depth; this removes the depth write altogether: with EXT_clip_control (clip z in 0..1) and the projection reversed
// (near -> 1, far -> 0) a 32-bit FLOAT depth buffer holds d = near·(far − w) / (w·(far − near)) ~ near / w, whose
// relative precision is float's own (~1e-7 of the distance) from 0.05 m to 2·10⁷ m: better than the log depth.
// three r186 does the projection, the clear value and the depth-function mapping (WebGLRenderer reversedDepthBuffer);
// what is ours:
//   - the choice BEFORE the renderer exists (three compiles either the log chunks or none): chooseDepthMode();
//   - every decoder of the scene depth texture: DEPTH_DECODE (viewZFromLogDepth / depthIsSky / GENESIS_NDC_NEAR),
//     keyed on three's own USE_REVERSED_DEPTH_BUFFER define, so one shader source serves both paths;
//   - the sun's shadow cascades stay as they were (orthographic, standard depth, sampler2DShadow LessEqual, the same
//     uShadowMat): standardDepth() switches the clip convention back for that pass, so the atlas is the same;
//   - CPU frusta: frustumFromProjection() passes the camera's reversedDepth on.
// Without EXT_clip_control, or without `?revz=1` (default off for now), nothing changes: log depth + zcons, as before.

import type { Camera, Frustum, Matrix4, WebGLRenderer } from 'three';
import { perfSwitch, perfSwitchNote } from '../perfswitch.ts';

/** the game camera's near / far planes (m), one pair for every view (renderer.ts builds the camera with them) */
export const CAM_NEAR = 0.05;
export const CAM_FAR = 2e7;

// DEFAULT OFF (PERF s18): the image pairs agree in six views, but decals and roads are not image-proven yet and two
// later pairs were dominated by world-state drift; `?revz=1` turns it on (the Mac's A/B), `?revz=0` / nothing = log depth.
const WANT = perfSwitch('revz', false);

/** what the renderer ended up with (the perf report prints it) */
export const REVZ = { on: false, clipControl: false, why: 'not decided', ext: '' };

/** extensions the depth paths care about (the report lists which of them this browser has) */
const DEPTH_EXT = ['EXT_clip_control', 'EXT_conservative_depth', 'EXT_depth_clamp', 'EXT_polygon_offset_clamp', 'WEBGL_polygon_mode', 'EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'EXT_float_blend', 'WEBGL_lose_context', 'EXT_disjoint_timer_query_webgl2', 'WEBGL_multi_draw', 'WEBGL_provoking_vertex', 'WEBGL_clip_cull_distance'];

/**
 * Decide the depth path on the canvas's own context, before three's WebGLRenderer is built (pass `gl` on as its
 * `context`). Returns whether reversed-Z is to be used; `allow = false` forces the log path.
 */
export function chooseDepthMode(gl: WebGL2RenderingContext | null, allow = WANT): boolean {
  REVZ.on = false; REVZ.clipControl = false; REVZ.ext = '';
  if (!gl || typeof gl.getSupportedExtensions !== 'function') { REVZ.why = 'no WebGL2 context to ask'; perfSwitchNote('revz', '0(no-gl)'); return false; }
  let have: string[] = [];
  try { have = gl.getSupportedExtensions() ?? []; } catch { /* lost context */ }
  REVZ.clipControl = have.includes('EXT_clip_control');
  REVZ.ext = DEPTH_EXT.map((e) => `${have.includes(e) ? '+' : '-'}${e}`).join(' ');
  if (!allow) { REVZ.why = 'off (default; ?revz=1 turns it on)'; perfSwitchNote('revz', '0'); return false; }
  if (!REVZ.clipControl) { REVZ.why = 'EXT_clip_control missing: logarithmic depth'; perfSwitchNote('revz', '0(no-ext)'); return false; }
  REVZ.on = true;
  REVZ.why = 'EXT_clip_control: reversed-Z, 32-bit float depth, no gl_FragDepth';
  perfSwitchNote('revz', '1');
  return true;
}

/** two report lines: the depth path in use, and the depth-related extensions (+ present, - missing) */
export function revzReport(): string[] {
  return [
    `depth: ${REVZ.on ? 'REVERSED-Z float (no fragment depth writes)' : 'LOGARITHMIC (gl_FragDepth in every shader)'} | EXT_clip_control ${REVZ.clipControl ? 'YES' : 'NO'} | ${REVZ.why}`,
    `depth extensions: ${REVZ.ext || 'unknown'}`,
  ];
}

interface DepthState { setReversed(on: boolean): void; getReversed(): boolean }
const depthState = (r: WebGLRenderer): DepthState => (r.state.buffers.depth as unknown as DepthState);

/** after the renderer is built: is three really in reversed mode? (it falls back by itself without the extension) */
export function confirmDepthMode(r: WebGLRenderer): void {
  if (!REVZ.on) return;
  if (!depthState(r).getReversed()) { REVZ.on = false; REVZ.why = 'three did not switch to reversed depth'; perfSwitchNote('revz', '0(three)'); }
}

/**
 * Standard (not reversed) depth for a pass drawn with its own orthographic cameras — the sun's shadow cascades — and
 * back. three reverses a camera's projection the first time it draws with it in reversed mode, and compiles
 * USE_REVERSED_DEPTH_BUFFER into the programs it links then; inside standardDepth(r, true) … (r, false) neither
 * happens, so the shadow atlas, its compare and uShadowMat are what they were with the log depth buffer.
 */
export function standardDepth(r: WebGLRenderer, on: boolean): void {
  if (!REVZ.on) return;
  depthState(r).setReversed(!on);
}

/** a frustum from projection · view, right for a reversed projection too */
export function frustumFromProjection(out: Frustum, m: Matrix4, camera?: Camera | { reversedDepth?: boolean } | null): Frustum {
  const rev = !!(camera as { reversedDepth?: boolean } | null | undefined)?.reversedDepth;
  return rev ? out.setFromProjectionMatrix(m, 2000, true) : out.setFromProjectionMatrix(m);
}

/** view depth (m) a reversed-Z depth value stands for (JS mirror of DEPTH_DECODE; tests) */
export function viewZFromReversed(d: number, near = CAM_NEAR, far = CAM_FAR): number {
  return (near * far) / (d * (far - near) + near);
}
/** the reversed-Z depth value of view depth w (m) */
export function reversedFromViewZ(w: number, near = CAM_NEAR, far = CAM_FAR): number {
  return (near * (far - w)) / (w * (far - near));
}

/**
 * GLSL: decode the scene depth texture, whichever path wrote it.
 *   viewZFromLogDepth(d, far)  view-space distance along −Z (m)
 *   depthIsSky(d)              nothing was drawn at this pixel
 *   GENESIS_NDC_NEAR           the near plane's NDC z (for un-projecting a view ray: uInvProj · (ndc.xy, NEAR, 1))
 * three defines USE_REVERSED_DEPTH_BUFFER in every (non-raw) ShaderMaterial it links while reversed depth is on.
 */
export const DEPTH_DECODE = /* glsl */ `
#ifndef GENESIS_LOGDEPTH
#define GENESIS_LOGDEPTH
#ifdef USE_REVERSED_DEPTH_BUFFER
  #define GENESIS_NDC_NEAR 1.0
  bool depthIsSky(highp float d) { return d <= 0.0; }
  highp float viewZFromLogDepth(highp float d, highp float far) {
    const highp float n = ${CAM_NEAR.toFixed(4)};
    return n * far / (d * (far - n) + n);
  }
#else
  #define GENESIS_NDC_NEAR -1.0
  bool depthIsSky(highp float d) { return d >= 0.999999; }
  highp float viewZFromLogDepth(highp float d, highp float far) {
    return exp2(d * log2(far + 1.0)) - 1.0;
  }
#endif
#endif
`;
