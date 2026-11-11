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
// bound e on the length of any edge at this vertex: the vertex gets its exact log depth minus the most a straight
// interpolation can exceed the convex curve inside a triangle, K·(e / (w − e))² / (8 ln 2) (chord error ≤ Δu²·L''/8
// with Δu ≤ e / (w_min·w_max), L'' ≤ K·w_max² / ln 2 and w_min ≥ w − e; 0.2705 = 1.5 / (8 ln 2), half as much again
// for safety). With LOD-sized triangles that slack is centimetres, so the ground is rejected under anything on it.
// Without both extensions nothing is touched.

import { ShaderChunk, type WebGLRenderer } from 'three';

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
			// a finely tessellated mesh that knows its longest edge (m): the exact log depth at each vertex, lowered by
			// the most the rasteriser's straight interpolation can rise above the curve within a triangle
			float zcE = GENESIS_ZEDGE;
			float zcW = gl_Position.w;
			if ( zcW > 2.0 * zcE ) {
				float zcR = zcE / ( zcW - zcE );
				float zcD = zcK * log2( 1.0 + zcW ) - zcK * zcR * zcR * 0.2705 - ${MARGIN};
				gl_Position.z = ( 2.0 * zcD - 1.0 ) * zcW;
			} else {
				// too close for the bound: far below the curve (never rejected early; the depth clamps to 0)
				gl_Position.z = - 5.0 * zcW;
			}
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
