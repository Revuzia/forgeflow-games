// VALE render — the overlay pass' shared scene-depth uniforms and manual depth test (overlay/context.ts re-exports them).
// A leaf module (three only), so the overlay layers and the ink programs can build their GLSL at load without an
// import cycle through the overlay context.

import { type Texture, Vector2 } from 'three';

export const overlayUniforms = {
  uSceneDepth: { value: null as Texture | null },
  uHasDepth: { value: 0 },
  uResolution: { value: new Vector2(1920, 1080) },
  uPxRatio: { value: 1 },          // buffer px per CSS px
  uBarScale: { value: 1 },         // overhead bar scale (720p floor 0.8 × hud scale)
  uNear: { value: 1 },
  uFar: { value: 400 },
  uTime: { value: 0 },
};

/** GLSL: manual scene-depth test (perspective depth), in metres */
export const DEPTH_TEST_GLSL = /* glsl */`
uniform sampler2D uSceneDepth;
uniform float uHasDepth;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
float valeLinDepth( float d ) {
  float z = d * 2.0 - 1.0;
  return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) );
}
// 1 when this fragment is in front of the scene (or within bias metres behind it)
float valeVisible( float biasM ) {
  if ( uHasDepth < 0.5 ) return 1.0;
  float sd = texture( uSceneDepth, gl_FragCoord.xy / uResolution ).r;
  float s = valeLinDepth( sd ), f = valeLinDepth( gl_FragCoord.z );
  return 1.0 - smoothstep( biasM, biasM + 0.12, f - s );
}
`;
