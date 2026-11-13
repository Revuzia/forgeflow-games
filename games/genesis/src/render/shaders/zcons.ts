// GENESIS — early depth rejection with the logarithmic depth buffer (perf 2026-11, "smooth without lowering quality").
//
// three's logarithmic depth buffer writes gl_FragDepth in every fragment shader. A shader that writes depth cannot be
// depth-tested before it runs, so the GPU shaded every fragment of every triangle, hidden or not: the terrain shader ran
// in full under every tree, house and person. Nothing here changes the image: gl_FragDepth stays the same log depth,
// so the depth buffer, every depth decode and every pass after it are bit-for-bit what they were.
//
// What changes is the RASTERISED depth, which the shader used to throw away. EXT_conservative_depth lets a shader
// promise `layout(depth_greater)`: the depth it writes is never nearer than the rasterised one. The GPU may then reject
// a fragment before shading when its rasterised depth already fails the test. So the rasterised depth must be a lower
// bound of the log depth L(w) = K·log2(1 + w), K = logDepthBufFC / 2. Seen as a function of u = 1/w (the quantity the
// rasteriser interpolates linearly), L is convex, so its tangent at any reference distance w0 lies below it everywhere
// and touches it at w0. A tangent in u is an ordinary projective depth A − S/w:
//     S = K·w0² / (ln 2 · (w0 + 1)),   A = K·log2(1 + w0) + S/w0 − margin,   clip z = (2A − 1)·w − 2S.
// The tangent must be ONE line per triangle, so w0 may only depend on things constant over a triangle: the object's
// origin, an instance's origin, a per-draw value. The bound is tightest near w0 (a fragment at 2·w0 is still rejected
// by anything nearer than ~1.6·w0), so a material whose origin is far from its geometry defines GENESIS_ZREF itself.
// Close to the camera the tangent goes below zero, hence EXT_depth_clamp (depth clamps to 0, still a lower bound).
//
// The terrain is one object from horizon to feet, so no single tangent fits it. It defines GENESIS_ZEDGE instead, a
// bound e on the length of any edge at this vertex, and gets per vertex the clip z of its exact log depth lowered by
// the most an affine interpolation of the convex g(w) = w·(2L(w) − 1) can rise above g inside a triangle (see VERTEX;
// valid for vertices behind the eye too — review 2026-11-11: the first version's 'too close' branch, z = −5w, was
// positive behind the eye and broke the bound near the camera). With LOD-sized triangles the slack is centimetres.
// Without both extensions nothing is touched.

import { ShaderChunk, type WebGLRenderer } from 'three';
import { perfSwitch } from '../perfswitch.ts';

const DEPTH_CLAMP = 0x864f;
/** depth units the tangent is lowered by, so float rounding never puts the rasterised depth above the written one
 *  (at 100 m this is ~7 mm of depth, at 1 km ~7 cm: nothing that would have been rejected is kept) */
const MARGIN = '4.0e-6';

const PARS_VERTEX = /* glsl */ `
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
	uniform float logDepthBufFC;
#endif
`;

const VERTEX = /* glsl */ `
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
	if ( vIsPerspective != 0.0 ) {
		float zcK = logDepthBufFC * 0.5;
		#ifdef GENESIS_ZEDGE
			// a finely tessellated mesh that knows a bound e (m) on the edges at this vertex. Work in clip space, where
			// z and w interpolate affinely over the triangle (also after clipping): the clip z that yields the log depth
			// is g(w) = w·(2L(w) − 1), convex, continued by its tangent −w behind the eye (w < 0). The affine
			// interpolation of g exceeds g by at most sup(g'')·Δw²/8 with Δw ≤ e and g'' ≤ 2K'(I + I²),
			// I = 1/(1 + max(w − e, 0)) (K' = K/ln 2, g'' falls with w); half as much again for safety, plus the margin
			float zcE = GENESIS_ZEDGE;
			float zcW = gl_Position.w;
			float zcI = 1.0 / ( 1.0 + max( zcW - zcE, 0.0 ) );
			float zcG = 2.0 * zcK * 1.4426950 * ( zcI + zcI * zcI );
			float zcZ = zcW > 0.0 ? zcW * ( 2.0 * zcK * log2( 1.0 + zcW ) - 1.0 ) : - zcW;
			gl_Position.z = zcZ - 0.1875 * zcG * zcE * zcE - 2.0 * ${MARGIN} * abs( zcW );
		#else
			#ifdef GENESIS_ZREF
				float zcW0 = GENESIS_ZREF;
			#elif defined( USE_INSTANCING )
				float zcW0 = - ( modelViewMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 ) ).z;
			#else
				float zcW0 = - modelViewMatrix[ 3 ].z;
			#endif
			zcW0 = clamp( zcW0, 1.0, 1.0e7 );
			float zcS = zcK * zcW0 * zcW0 / ( 0.6931472 * ( zcW0 + 1.0 ) );
			float zcA = zcK * log2( 1.0 + zcW0 ) + zcS / zcW0 - ${MARGIN};
			gl_Position.z = ( 2.0 * zcA - 1.0 ) * gl_Position.w - 2.0 * zcS;
		#endif
	}
#endif
`;

const PARS_FRAGMENT = /* glsl */ `
#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	layout( depth_greater ) out highp float gl_FragDepth;
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif
`;

/**
 * ROADMAP-60FPS step 7 (`?orthodepth=0` off): the shadow casters' depth twins (terrain, vegetation, people / animals,
 * buildings / boats / camps, ships) are drawn ONLY by the sun's orthographic cascade cameras (SunShadows.render /
 * warm, between swap(true) and swap(false)). For an orthographic camera three's log-depth fragment chunk writes
 * gl_FragDepth = gl_FragCoord.z: the very depth the rasteriser produces, yet a shader that writes depth turns off the
 * GPU's early depth test / hidden-surface removal (Apple) for the whole depth-only pass. A twin defines
 * GENESIS_ORTHO_DEPTH and the chunk then writes nothing: same depth values (no polygon offset anywhere), early-Z back.
 */
export const ORTHO_DEPTH = perfSwitch('orthodepth', true);
/** mark a depth twin (never drawn with a perspective camera) */
export function orthoDepth<T extends { defines?: Record<string, unknown> }>(m: T): T {
  if (ORTHO_DEPTH) { m.defines ??= {}; m.defines.GENESIS_ORTHO_DEPTH = ''; }
  return m;
}
/** wrap the current log-depth fragment chunks so a GENESIS_ORTHO_DEPTH shader neither declares nor writes gl_FragDepth (call after enableConservativeDepth, before any compile) */
export function enableOrthoDepth(): void {
  if (!ORTHO_DEPTH || ShaderChunk.logdepthbuf_fragment.includes('GENESIS_ORTHO_DEPTH')) return;
  ShaderChunk.logdepthbuf_pars_fragment = `#ifndef GENESIS_ORTHO_DEPTH\n${ShaderChunk.logdepthbuf_pars_fragment}\n#endif\n`;
  ShaderChunk.logdepthbuf_fragment = `#ifndef GENESIS_ORTHO_DEPTH\n${ShaderChunk.logdepthbuf_fragment}\n#endif\n`;
}

/** what the renderer ended up with (the dev HUD and probes read it) */
export const ZCONS = { on: false, why: '' };

/**
 * Switch conservative log depth on for this renderer, before any material is compiled. Returns whether it is on.
 * `allow = false` (the ?zcons=0 switch) leaves three's chunks as they are.
 */
export function enableConservativeDepth(renderer: WebGLRenderer, allow = true): boolean {
  ZCONS.on = false;
  if (!allow) { ZCONS.why = 'switched off'; return false; }
  const gl = renderer.getContext() as WebGL2RenderingContext;
  if (typeof (gl as { drawBuffers?: unknown }).drawBuffers !== 'function') { ZCONS.why = 'not WebGL2'; return false; }
  const cons = gl.getExtension('EXT_conservative_depth');
  const clamp = gl.getExtension('EXT_depth_clamp');
  if (!cons || !clamp) { ZCONS.why = `missing ${!cons ? 'EXT_conservative_depth' : 'EXT_depth_clamp'}`; return false; }
  // the #extension line has to come before any other token, and three writes its own prefix first: add it as the
  // shader source goes to the driver
  const shaderSource = gl.shaderSource.bind(gl);
  gl.shaderSource = (shader: WebGLShader, source: string): void => {
    shaderSource(shader, source.includes('depth_greater') ? source.replace(/^(#version 300 es[^\n]*\n)/, '$1#extension GL_EXT_conservative_depth : require\n') : source);
  };
  ShaderChunk.logdepthbuf_pars_vertex = PARS_VERTEX;
  ShaderChunk.logdepthbuf_vertex = VERTEX;
  ShaderChunk.logdepthbuf_pars_fragment = PARS_FRAGMENT;
  gl.enable(DEPTH_CLAMP);
  ZCONS.on = true;
  ZCONS.why = 'EXT_conservative_depth + EXT_depth_clamp';
  return true;
}

/** depth clamping off / on around a pass that must clip at its near and far planes as before (the sun's shadow boxes) */
export function depthClamp(renderer: WebGLRenderer, on: boolean): void {
  if (!ZCONS.on) return;
  const gl = renderer.getContext();
  if (on) gl.enable(DEPTH_CLAMP); else gl.disable(DEPTH_CLAMP);
}

// ── JS mirrors of the two vertex bounds (tests/render-zcons.test.ts checks them against the log depth) ──
const MARGIN_N = Number(MARGIN);
/** clip z the tangent path gives a vertex at view depth w for reference depth w0 (K = logDepthBufFC / 2) */
export function tangentClipZ(w: number, w0: number, K: number): number {
  const r = Math.min(Math.max(w0, 1), 1e7);
  const S = (K * r * r) / (Math.LN2 * (r + 1));
  const A = K * Math.log2(1 + r) + S / r - MARGIN_N;
  return (2 * A - 1) * w - 2 * S;
}
/** clip z the edge path gives a vertex at view depth w whose edges are at most e long */
export function edgeClipZ(w: number, e: number, K: number): number {
  const I = 1 / (1 + Math.max(w - e, 0));
  const G = 2 * K * Math.LOG2E * (I + I * I);
  const g = w > 0 ? w * (2 * K * Math.log2(1 + w) - 1) : -w;
  return g - 0.1875 * G * e * e - 2 * MARGIN_N * Math.abs(w);
}
