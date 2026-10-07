// VALE render — the shared world shading chunk (STYLE_BIBLE "Look rules", tokens.json `grade`).
//
// Every WORLD material (terrain, cliffs, scatter, map-scene GLB materials, units) is patched once
// with onBeforeCompile so it reads the same uniforms:
//   * fog of war: the local team's vision grid (R8, smoothed over time by fog.ts) — outside vision
//     value ×0.55, saturation ×0.4 and a 15 % shift toward the fog tint #2A3140, with a crisp edge.
//     Identical on every quality tier (it is competitive information).
//   * map-edge haze: outside the playable bounds only (world space, NEVER camera distance — the
//     bible bans camera-distance fog), fading to the map's fog colour.
// FIGHTER materials additionally get their own key light (view-space azimuth 225°, elevation 45°,
// 0.9 × sun) and a shadow floor (the sun's shadow only removes 25 % of its light: ≥ 75 % brightness
// in shadow), plus a faint sun-side rim for separation from the ground.
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
  // fighter key light (view space) and sun-side rim
  valeKeyDir: { value: new Vector3(-0.5, 0.7071, 0.5).normalize() },
  valeKeyColor: { value: new Color(2.7, 2.6, 2.5) },
  valeSunDirView: { value: new Vector3(0, 1, 0) },
  valeRimColor: { value: new Color(0.25, 0.24, 0.22) },
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
vec3 valeApplyWorldFog( vec3 c, vec3 wp ) {
  float vis = valeVision( wp.xz );
  float lum = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 fogged = mix( vec3( lum ), c, 0.4 ) * 0.55;
  float tl = max( dot( valeFogTint, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
  fogged = mix( fogged, valeFogTint / tl * dot( fogged, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.15 );
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

const FIGHTER_PARS = /* glsl */`
uniform vec3 valeKeyDir;
uniform vec3 valeKeyColor;
uniform vec3 valeSunDirView;
uniform vec3 valeRimColor;
`;
/** the fighter's own key light, run through the material's own BRDF */
const FIGHTER_KEY = /* glsl */`
#if defined( RE_Direct )
{
  IncidentLight valeKey;
  valeKey.direction = normalize( valeKeyDir );
  valeKey.color = valeKeyColor;
  valeKey.visible = true;
  RE_Direct( valeKey, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float valeRim = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 3.0 ) * saturate( dot( geometryNormal, normalize( valeSunDirView ) ) * 0.6 + 0.4 );
  reflectedLight.directDiffuse += valeRimColor * valeRim;
}
#endif
`;

export interface WorldPatchOptions {
  /** fog of war + edge haze (default true) */
  fog?: boolean;
  /** fighter shading: own key light, shadow floor, rim */
  fighter?: boolean;
}

const PATCHED = Symbol('valePatched');

/** Patch a material in place (idempotent). Keeps any existing onBeforeCompile. */
export function patchWorldMaterial(material: Material, opts: WorldPatchOptions = {}): void {
  const m = material as Material & { [PATCHED]?: string };
  const fog = opts.fog !== false;
  const fighter = opts.fighter === true;
  const key = `${fog ? 'f' : ''}${fighter ? 'k' : ''}`;
  if (m[PATCHED] === key) return;
  m[PATCHED] = key;
  if (!fog && !fighter) return;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, worldUniforms);
    if (fog) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vValeWorld;\n${WORLD_FOG_PARS}`)
        .replace('#include <opaque_fragment>', `outgoingLight = valeApplyWorldFog( outgoingLight, vValeWorld );\n#include <opaque_fragment>`);
    }
    if (fighter) {
      const lights = ShaderChunk.lights_fragment_begin
        .split('directionalLightShadow.shadowIntensity').join('( directionalLightShadow.shadowIntensity * 0.25 )');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FIGHTER_PARS}`)
        .replace('#include <lights_fragment_begin>', `${lights}\n${FIGHTER_KEY}`);
    }
  };
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () => `${prevKey.call(material)}|vale:${key}`;
  material.needsUpdate = true;
}
