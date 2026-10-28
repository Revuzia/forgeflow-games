// VALE render — the shared world shading chunk (STYLE_BIBLE "Look rules", tokens.json `grade`).
//
// Every WORLD material (terrain, cliffs, scatter, map-scene GLB materials, units) is patched once
// with onBeforeCompile so it reads the same uniforms:
//   * fog of war: the local team's vision grid (R8, smoothed over time by fog.ts) — outside vision
//     value ×0.55, saturation ×0.4 and a 15 % shift toward the fog tint #2A3140, with a crisp edge.
//     Identical on every quality tier (it is competitive information).
//   * map-edge haze: outside the playable bounds only (world space, NEVER camera distance — the
//     bible bans camera-distance fog), fading to the map's fog colour.
// FIGHTER materials replace the sun's direction with their own key (view-space azimuth 225°, elevation
// 45°, `valeCharKey` × the sun's colour and intensity), so every fighter reads the same on every map, and
// take a shadow floor (the sun's shadow removes at most 25 % of the key: ≥ 75 % brightness in shadow, bible
// `shadow = mix(1.0, s, 0.25)`).
//
// THE CHARACTER LIGHT (r12 B5 round 2, tokens `grade.fighterLight.rig`; lighting.ts sets it per map): the
// environment was rebased down, so characters carry their own light instead of the world getting brighter.
// It is a shading term, not a three.js light: no extra light in any program's key, no shadow map, a few ALU
// on character fragments only, the world's pixels untouched. Both parts follow the camera (view space):
//   * the noon crown: a Fresnel rim on the silhouette weighted to its top and back (the side above and away
//     from the camera), so a character's upper outline lifts off the ground under it. Its albedo carries a
//     value floor (hue kept), so a dark kit's edge reads as well as a pale one's;
//   * the eye fill: a soft fill from the camera that lifts the mid-tones the key leaves in its shadow side.
// Fighters take all of it; wicks and monsters (`unit`) take a smaller share and keep the sun as their key.
//
// Overlay materials (bars, rings, telegraphs) and VFX are NOT patched: they draw after the grade.

import {
  Color, type DataTexture, type Material, ShaderChunk, Texture, Vector2, Vector3, Vector4,
  type WebGLProgramParametersWithUniforms,
} from 'three';

/** uniforms shared (by reference) by every patched material */
export const worldUniforms = {
  valeFogTex: { value: new Texture() as Texture | DataTexture },
  valeFogScale: { value: new Vector2(0.01, 0.01) },   // 1 / grid extent in metres
  valeFogTexel: { value: new Vector2(0.02, 0.02) },   // one grid cell in uv
  valeFogOn: { value: 0 },
  valeFogTint: { value: new Color().setStyle('#2A3140') },
  valeBounds: { value: new Vector4(0, 0, 100, 100) }, // minX, minZ, maxX, maxZ (playable)
  valeEdgeColor: { value: new Color().setStyle('#8E9AA6') },
  valeEdgeRange: { value: new Vector2(4, 18) },       // haze starts / is full this far outside the bounds
  valeEdgeOn: { value: 1 },
  valeTime: { value: 0 },
  // the fighter key (view space) and its share of the sun
  valeKeyDir: { value: new Vector3(-0.5, 0.7071, 0.5).normalize() },
  valeCharKey: { value: 0.9 },
  // the character light (lighting.ts CHAR_LIGHT): crown direction (view space), crown radiance (rgb, linear) and
  // Fresnel power (a), eye-fill radiance, and x = the crown's albedo value floor, y = the wick/monster share
  valeCharRimDir: { value: new Vector3(0, 0.8, -0.6).normalize() },
  valeCharRim: { value: new Vector4(0, 0, 0, 3) },
  valeCharFill: { value: new Color(0, 0, 0) },
  valeCharShape: { value: new Vector4(0.2, 0.3, 50, 51) },
};

/** GLSL: the fog-of-war + edge haze functions (shared with custom ShaderMaterials) */
export const WORLD_FOG_PARS = /* glsl */`
uniform sampler2D valeFogTex;
uniform vec2 valeFogScale;
uniform vec2 valeFogTexel;
uniform float valeFogOn;
uniform vec3 valeFogTint;
uniform vec4 valeBounds;
uniform vec3 valeEdgeColor;
uniform vec2 valeEdgeRange;
uniform float valeEdgeOn;
float valeVision( vec2 xz ) {
  if ( valeFogOn < 0.5 ) return 1.0;
  vec2 uv = xz * valeFogScale;
  vec2 o = valeFogTexel * 0.45;
  float v = texture( valeFogTex, uv ).r * 0.36
    + ( texture( valeFogTex, uv + vec2( o.x, o.y ) ).r + texture( valeFogTex, uv + vec2( -o.x, o.y ) ).r
      + texture( valeFogTex, uv + vec2( o.x, -o.y ) ).r + texture( valeFogTex, uv + vec2( -o.x, -o.y ) ).r ) * 0.16;
  // crisp, but not blocky: the grid is 2 m; the edge resolves over ~0.6 m
  return smoothstep( 0.38, 0.62, v );
}
// value x0.55 is a DISPLAY-space figure: 0.55^2.2 = 0.268 in the linear working space
vec3 valeApplyWorldFog( vec3 c, vec3 wp ) {
  float vis = valeVision( wp.xz );
  float lum = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  #ifdef VALE_KEEP_COLOR
  vec3 fogged = c * 0.268;
  #else
  vec3 fogged = mix( vec3( lum ), c, 0.4 ) * 0.268;
  #endif
  float tl = max( dot( valeFogTint, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
  #ifndef VALE_KEEP_COLOR
  // 15 % toward the fog tint (absolute, so the darkest stone keeps a readable floor)
  fogged = mix( fogged, valeFogTint, 0.15 );
  #endif
  c = mix( fogged, c, vis );
  if ( valeEdgeOn > 0.5 ) {
    vec2 d2 = max( valeBounds.xy - wp.xz, wp.xz - valeBounds.zw );
    float d = max( max( d2.x, d2.y ), 0.0 );
    float f = smoothstep( valeEdgeRange.x, valeEdgeRange.y, d );
    c = mix( c, valeEdgeColor, f );
  }
  return c;
}
`;

const VERT_PARS = /* glsl */`
varying vec3 vValeWorld;
`;
const VERT_MAIN = /* glsl */`
{
  vec4 valeWP = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    valeWP = batchingMatrix * valeWP;
  #endif
  #ifdef USE_INSTANCING
    valeWP = instanceMatrix * valeWP;
  #endif
  valeWP = modelMatrix * valeWP;
  vValeWorld = valeWP.xyz;
}
`;

const CHAR_PARS = /* glsl */`
uniform vec3 valeKeyDir;
uniform float valeCharKey;
uniform vec3 valeCharRimDir;
uniform vec4 valeCharRim;
uniform vec3 valeCharFill;
uniform vec4 valeCharShape;
`;
/** after the material's lights (direct and sky): the character light (noon crown + eye fill), see the header */
const CHAR_LIGHT = /* glsl */`
#if defined( RE_Direct )
{
  float valeNdV = saturate( dot( geometryNormal, geometryViewDir ) );
  float valeUp = saturate( dot( geometryNormal, valeCharRimDir ) * 0.5 + 0.5 );
  float valeRim = pow( 1.0 - valeNdV, valeCharRim.a ) * valeUp * valeUp;
  float valeLa = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 valeAlb = min( diffuseColor.rgb * ( max( valeLa, valeCharShape.x ) / max( valeLa, 0.02 ) ), vec3( 1.0 ) );
  #ifdef VALE_CHAR_UNIT
  // wicks and monsters keep the sun as their key: a share of the crown, on their darker cloth only (a pale hood takes none)
  vec3 valeAdd = valeCharShape.y * ( 1.0 - smoothstep( 0.12, 0.3, valeLa ) ) * valeCharRim.rgb * valeRim * valeAlb;
  #else
  vec3 valeAdd = valeCharRim.rgb * valeRim * valeAlb + valeCharFill * ( 0.4 + 0.6 * valeNdV ) * material.diffuseColor;
  #endif
  // the knee: the character light fades where the world's light (key, sky, specular) already lights the surface
  // brightly, so a pale kit never blows out and the lift goes to the mid-tones and the shadow side
  float valeLit = dot( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3( 0.2126, 0.7152, 0.0722 ) );
  reflectedLight.directDiffuse += valeAdd * ( 1.0 - smoothstep( valeCharShape.z, valeCharShape.w, valeLit ) );
}
#endif
`;

export interface WorldPatchOptions {
  /** fog of war + edge haze (default true) */
  fog?: boolean;
  /** fighter shading: own key light, shadow floor, the character light */
  fighter?: boolean;
  /** wick / monster shading: the sun stays the key; a share of the character light (`valeCharShape.y`) */
  unit?: boolean;
  /** fog of war darkens but does not desaturate (the Standing Shadow keeps its colour) */
  keepColor?: boolean;
}

const PATCHED = Symbol('valePatched');

/** Patch a material in place (idempotent). Keeps any existing onBeforeCompile. */
export function patchWorldMaterial(material: Material, opts: WorldPatchOptions = {}): void {
  const m = material as Material & { [PATCHED]?: string };
  const fog = opts.fog !== false;
  const fighter = opts.fighter === true;
  const unit = !fighter && opts.unit === true;
  const keep = opts.keepColor === true;
  const key = `${fog ? 'f' : ''}${fighter ? 'k' : ''}${unit ? 'u' : ''}${keep ? 'c' : ''}`;
  if (m[PATCHED] === key) return;
  m[PATCHED] = key;
  if (!fog && !fighter && !unit) return;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, worldUniforms);
    if (fog) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${keep ? '#define VALE_KEEP_COLOR\n' : ''}varying vec3 vValeWorld;\n${WORLD_FOG_PARS}`)
        .replace('#include <opaque_fragment>', `outgoingLight = valeApplyWorldFog( outgoingLight, vValeWorld );\n#include <opaque_fragment>`);
    }
    if (fighter) {
      // the one directional light (the sun) becomes the fighter's view-space key at 0.9 × its colour;
      // its shadow keeps ≥ 75 % of the key
      const lights = ShaderChunk.lights_fragment_begin
        .split('getDirectionalLightInfo( directionalLight, directLight );')
        .join('getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.direction = normalize( valeKeyDir );\n\t\tdirectLight.color *= valeCharKey;')
        .split('directionalLightShadow.shadowIntensity').join('( directionalLightShadow.shadowIntensity * 0.25 )');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${CHAR_PARS}`)
        .replace('#include <lights_fragment_begin>', lights)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${CHAR_LIGHT}`);
    } else if (unit) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n#define VALE_CHAR_UNIT\n${CHAR_PARS}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${CHAR_LIGHT}`);
    }
  };
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${prevKey.call(material)}|vale:${key}`;
  material.needsUpdate = true;
}
