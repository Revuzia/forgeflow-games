// VALE render — the ink programs (r12 B4 "≤ 40 shader programs"): ONE raw shader source for every unlit pass that draws
// an actor's or a prop's own geometry, with the pass chosen by a uniform instead of a separate program each:
//
//   depth    position only: every shadow caster's depth (customDepthMaterial; inkShadows), the veil and the
//            structure-fade depth prepasses (colorWrite off), the hover mask (white into its R8 target)
//   outline  the rest ink: the hull pushed out by uPx screen px along the view normal (back faces), flat colour × alpha
//   flash    the victim flash (premultiplied; VICTIM_FLASH_GLSL); a zero flash writes a transparent pixel, not a discard
//   mask     the hover silhouette (white)
//   rim      the hover rim: pushed like the outline, drawn outside the mask, depth-tested by hand against the scene
//   glaze    the protected structure's glaze (its surface pushed out along smoothed normals)
//   foot     the protected structure's foot ring of hour-ticks
//   xray     the occluded silhouette (env F4): a fighter's body where cover stands between it and the camera, drawn
//            in the scene after the cover and before every unit with the depth test inverted (GREATER), so only
//            the parts a cliff, a Dialwood crown or a landmark hides take it: a relationship-coloured fill with a
//            lit edge about uPx screen px wide, the body pulled uBias metres toward the camera first (the ground
//            and the lip it stands against never trip it)
//
// A RawShaderMaterial's program key is its source, its defines and nothing else (three's side / opaque / skinning /
// instancing / light-count flags never enter it), so every material of one vertex path shares ONE program whatever
// its side, blending or pass: three programs in all — rigid (instanced or not, with the Dialwood / Needlegrass / cloth
// sway of their shadows chosen by uSway), skin (three's bone texture) and crowd (crowd.ts' baked rows). These replace
// the outline, flash, hover mask and rim, veil and fade depth, glaze, foot ring and every MeshDepthMaterial variant
// (side × map × skinning × instancing × instance colour × custom sway) the shadow pass used to compile.
// No branch discards (a discard anywhere in a program costs the depth-only passes their early depth test on a
// tile-based GPU): the passes that used to discard write a transparent pixel under blending that keeps the target.
// Every material carries every sampler the program declares (null binds three's empty texture), so a sampler a pass
// does not read never points at a texture unit holding the render target it draws into.

import {
  AddEquation, BackSide, Color, CustomBlending, DoubleSide, FrontSide, GLSL3, GreaterDepth, type InstancedMesh, Matrix4, type Mesh,
  NormalBlending, type Object3D, OneFactor, OneMinusSrcAlphaFactor, RawShaderMaterial, type Side, type SkinnedMesh, SrcAlphaFactor, type Texture,
  Vector2, Vector3, ZeroFactor,
} from 'three';
import { DEPTH_TEST_GLSL } from './overlay/depth.ts';
import { CLOTH_MAIN, CLOTH_PARS, GRASS_VERT_MAIN, GRASS_VERT_PARS, TREE_SWAY_MAIN, TREE_SWAY_PARS } from './terrain_brush.ts';

/** the pass a material draws (uniform uInkMode) */
export const INK = { depth: 0, outline: 1, flash: 2, mask: 3, rim: 4, glaze: 5, foot: 6, xray: 7 } as const;
export type InkMode = (typeof INK)[keyof typeof INK];
/** the vertex path: one program each */
export type InkPath = 'rigid' | 'skin' | 'crowd';
/** the motion a rigid caster's shadow runs (uniform uSway): the same code its own material runs */
export const INK_SWAY = { none: 0, tree: 1, grass: 2, cloth: 3 } as const;

/** CSS-pixel viewport the outline widths are measured in (the renderer keeps it current) */
export const outlineUniforms = { uOutlineRes: { value: new Vector2(1920, 1080) } };
/** metres a rim fragment may sit behind the scene surface and still draw (the ground at a unit's feet) */
export const RIM_FEET_BIAS_M = 0.45;

/** the crowd's vertex prelude: per-instance affine, two baked rows and their blend, glow, style */
export const CROWD_VERT_PARS = /* glsl */`
uniform highp sampler2D uCrowdBake;
uniform mat4 uCrowdBind;
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec4 aCrowdM0;
attribute vec4 aCrowdM1;
attribute vec4 aCrowdM2;
attribute vec4 aCrowdAnim;   // rowA, rowB, weight of A, accent glow
attribute vec4 aCrowdStyle;  // outline px, flash k, flash ink, -
mat4 valeCrowdBone( float row, float bone ) {
  ivec2 c = ivec2( int( bone ) * 3, int( row ) );
  vec4 r0 = texelFetch( uCrowdBake, c, 0 );
  vec4 r1 = texelFetch( uCrowdBake, c + ivec2( 1, 0 ), 0 );
  vec4 r2 = texelFetch( uCrowdBake, c + ivec2( 2, 0 ), 0 );
  return transpose( mat4( r0, r1, r2, vec4( 0.0, 0.0, 0.0, 1.0 ) ) );
}
mat4 valeCrowdSkin( float row ) {
  return skinWeight.x * valeCrowdBone( row, skinIndex.x ) + skinWeight.y * valeCrowdBone( row, skinIndex.y )
       + skinWeight.z * valeCrowdBone( row, skinIndex.z ) + skinWeight.w * valeCrowdBone( row, skinIndex.w );
}
mat4 valeCrowdMatrix() {
  mat4 s = valeCrowdSkin( aCrowdAnim.x );
  if ( aCrowdAnim.z < 0.999 ) s = s * aCrowdAnim.z + valeCrowdSkin( aCrowdAnim.y ) * ( 1.0 - aCrowdAnim.z );
  mat4 inst = transpose( mat4( aCrowdM0, aCrowdM1, aCrowdM2, vec4( 0.0, 0.0, 0.0, 1.0 ) ) );
  return inst * s * uCrowdBind;
}
`;

/** the victim flash shading (per-actor hulls and the crowd) */
export const VICTIM_FLASH_GLSL = /* glsl */`
vec4 valeVictimFlash( vec3 n, vec3 v, vec3 color, vec3 rimColor, float k, float ink ) {
  float ndv = abs( dot( normalize( n ), normalize( v ) ) );
  float rim = pow( 1.0 - ndv, 2.0 );
  if ( ink < 0.5 ) {
    // light: added (premultiplied, alpha 0), rim-weighted so the silhouette lights first
    return vec4( color * k * ( 0.25 + 0.75 * rim ), 0.0 );
  }
  // Shade (true damage, value-inverted): the body drops to ink, the rim rings noonwhite
  float halo = smoothstep( 0.3, 0.75, rim );
  float a = clamp( k * mix( 1.6, 2.0, halo ), 0.0, mix( 0.85, 0.95, halo ) );
  return vec4( mix( color, rimColor, halo ) * a, a );
}
`;

/** the protected structure's foot ring height (m): the ring runs y 0 → FOOT_H on the plinth */
export const INK_FOOT_H = 0.5;

const VERT = /* glsl */`
#define attribute in
#define varying out
precision highp float;
precision highp int;
precision highp sampler2D;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
uniform int uInkMode;
uniform float uPx;
uniform float uBias;
uniform vec2 uOutlineRes;
in vec3 position;
in vec3 normal;
out vec3 vN;
out vec3 vV;
out vec3 vW;
out vec3 vP;
#ifdef VALE_INK_SKIN
#define USE_SKINNING
in vec4 skinIndex;
in vec4 skinWeight;
#include <skinning_pars_vertex>
#endif
#ifdef VALE_INK_CROWD
${CROWD_VERT_PARS}
in vec3 aCrowdFlash;
in vec3 aCrowdFlashRim;
out vec3 vC;
out vec3 vR;
out vec2 vK;
#endif
#ifdef VALE_INK_RIGID
#define USE_INSTANCING
uniform float uInst;
uniform int uSway;
uniform float uInflate;
in mat4 instanceMatrix;
in vec3 aSmooth;
${TREE_SWAY_PARS}
${GRASS_VERT_PARS}
${CLOTH_PARS}
#endif
void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;
#ifdef VALE_INK_RIGID
  if ( uInkMode == 5 ) {
    // glaze: the tower's own surface pushed out along smoothed normals (no seams at hard edges)
    vec4 wp = modelMatrix * vec4( position, 1.0 );
    vec3 sn = normalize( mat3( modelMatrix ) * aSmooth );
    wp.xyz += sn * uInflate;
    vW = wp.xyz;
    vN = sn;
    vV = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    return;
  }
  if ( uInkMode == 6 ) {
    // the foot ring
    vec4 wp = modelMatrix * vec4( position, 1.0 );
    vP = position;
    vN = normalize( mat3( modelMatrix ) * normal );
    vV = normalize( cameraPosition - wp.xyz );
    gl_Position = projectionMatrix * viewMatrix * wp;
    return;
  }
  if ( uSway == 1 ) {
${TREE_SWAY_MAIN}
  } else if ( uSway == 2 ) {
${GRASS_VERT_MAIN}
  } else if ( uSway == 3 ) {
${CLOTH_MAIN}
  }
#endif
#ifdef VALE_INK_SKIN
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
#endif
#ifdef VALE_INK_CROWD
  if ( uInkMode == 1 && aCrowdStyle.x <= 0.0 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
  if ( uInkMode == 2 && aCrowdStyle.y <= 0.002 ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }
  mat4 valeK = valeCrowdMatrix();
  vec4 mv = viewMatrix * valeK * vec4( transformed, 1.0 );
  gl_Position = projectionMatrix * mv;
  vec3 vn = mat3( viewMatrix ) * mat3( valeK ) * objectNormal;
  float px = uInkMode == 1 ? aCrowdStyle.x : uPx;
  if ( uInkMode == 2 ) { vN = vn; vV = -mv.xyz; vC = aCrowdFlash; vR = aCrowdFlashRim; vK = aCrowdStyle.yz; }
#else
  vec4 mv = vec4( transformed, 1.0 );
  #ifdef VALE_INK_RIGID
  if ( uInst > 0.5 ) { mv = instanceMatrix * mv; objectNormal = mat3( instanceMatrix ) * objectNormal; }
  #endif
  mv = modelViewMatrix * mv;
  // xray (and a match flash drawn over the hull's LOD, perf PERF-m5): slid toward the camera along its own view ray (same
  // pixel, nearer depth), so a coarser shell than the body still wins the depth test wherever the body shows
  if ( uInkMode == 7 || uInkMode == 2 ) mv.xyz *= max( 0.0, 1.0 - uBias / max( length( mv.xyz ), 1e-3 ) );
  gl_Position = projectionMatrix * mv;
  vec3 vn = normalMatrix * objectNormal;
  float px = uPx;
  if ( uInkMode == 2 || uInkMode == 7 ) { vN = vn; vV = -mv.xyz; }
#endif
  if ( uInkMode == 1 || uInkMode == 4 ) {
    // screen-space push along the view normal (never flipped for the back faces drawn)
    vec2 dir = normalize( ( projectionMatrix * vec4( normalize( vn ), 0.0 ) ).xy + 1e-5 );
    gl_Position.xy += dir * px * 2.0 / uOutlineRes * gl_Position.w;
  }
}
`;

const FRAG = /* glsl */`
precision highp float;
precision highp int;
precision highp sampler2D;
uniform int uInkMode;
uniform float uPx;
uniform vec3 uColor;
uniform float uAlpha;
uniform vec3 uFlashColor;
uniform vec3 uFlashRim;
uniform float uFlashK;
uniform float uFlashInk;
uniform sampler2D uMask;
${DEPTH_TEST_GLSL}
uniform float uK;
uniform float uFlash;
uniform float uTime;
uniform vec3 uCenter;
uniform float uH;
uniform float uSfY0;
uniform float uSfY1;
uniform float uSfA;
in vec3 vN;
in vec3 vV;
in vec3 vW;
in vec3 vP;
#ifdef VALE_INK_CROWD
in vec3 vC;
in vec3 vR;
in vec2 vK;
#endif
layout( location = 0 ) out highp vec4 pc_fragColor;
${VICTIM_FLASH_GLSL}
vec4 valeGlaze() {
  float f = 1.0 - abs( dot( normalize( vN ), normalize( vV ) ) );
  float rim = pow( f, 2.2 );
  vec3 q = vW - uCenter;
  float ang = atan( q.z, q.x );
  // the shield's 45-degree hatch, wrapped round the tower's axis (arc length + height)
  float hatch = smoothstep( 0.84, 0.96, fract( ( ang * max( length( q.xz ), 0.35 ) + q.y ) * 2.4 ) );
  // a band of light rising slowly up the tower
  float band = exp( -pow( ( fract( q.y / uH * 0.5 - uTime * 0.12 ) - 0.5 ) * 9.0, 2.0 ) );
  float a = 0.045 + 0.34 * rim + 0.1 * hatch * ( 0.5 + rim ) + 0.09 * band * ( 0.4 + rim );
  a = a * uK + uFlash * ( 0.2 + 0.4 * rim );
  // the occlusion fade thins the glaze with the tower
  a *= mix( 1.0, uSfA, smoothstep( uSfY0, uSfY1, vW.y ) );
  return vec4( uColor * ( 0.8 + 0.4 * rim + uFlash ), clamp( a, 0.0, 0.6 ) );
}
vec4 valeFoot() {
  float f = 1.0 - abs( dot( normalize( vN ), normalize( vV ) ) );
  float rim = pow( f, 2.0 );
  float ang = atan( vP.z, vP.x );
  float k = fract( ang / 6.2831853 * 12.0 + 0.5 );
  float q = step( 0.5, fract( ( ang / 6.2831853 * 12.0 + 0.5 ) / 3.0 + 0.17 ) );
  float tick = ( 1.0 - smoothstep( 0.035, 0.06, abs( k - 0.5 ) ) ) * ( 1.0 - smoothstep( mix( 0.26, 0.4, q ), mix( 0.34, 0.48, q ), vP.y ) );
  float foot = 1.0 - smoothstep( 0.0, 0.06, vP.y );
  float top = 1.0 - smoothstep( 0.0, 0.18, ${INK_FOOT_H.toFixed(2)} - vP.y );
  float pulse = 0.85 + 0.15 * sin( uTime * 2.1 - ang * 2.0 );
  float a = ( 0.05 + 0.18 * rim ) * ( 1.0 - 0.8 * top ) + 0.5 * tick * pulse + 0.42 * foot;
  a = clamp( a * uK + uFlash * ( 0.2 + 0.4 * rim ), 0.0, 0.7 );
  return vec4( uColor * ( 0.8 + 0.3 * rim + 0.4 * tick + uFlash ), a );
}
void main() {
  vec4 c = vec4( 1.0 );
  if ( uInkMode == 1 ) c = vec4( uColor, uAlpha );
  else if ( uInkMode == 2 ) {
#ifdef VALE_INK_CROWD
    c = valeVictimFlash( vN, vV, vC, vR, vK.x, vK.y );
#else
    c = uFlashK <= 0.002 ? vec4( 0.0 ) : valeVictimFlash( vN, vV, uFlashColor, uFlashRim, uFlashK, uFlashInk );
#endif
  } else if ( uInkMode == 4 ) {
    // outside the body's mask only, a unit or wall in front hides it (the feet keep their rim on the ground)
    float a = texture( uMask, gl_FragCoord.xy / uResolution ).r > 0.5 ? 0.0 : uAlpha * valeVisible( ${RIM_FEET_BIAS_M.toFixed(2)} );
    c = a <= 0.003 ? vec4( 0.0 ) : vec4( uColor, a );
  } else if ( uInkMode == 5 ) c = valeGlaze();
  else if ( uInkMode == 6 ) c = valeFoot();
  else if ( uInkMode == 7 ) {
    // the occluded silhouette: fill at uAlpha, and an edge ~uPx screen px wide where the surface turns away
    // (n.v reaches 0 on the silhouette: its screen-space distance is n.v over its own derivative)
    float ndv = abs( dot( normalize( vN ), normalize( vV ) ) );
    float edgePx = ndv / max( fwidth( ndv ), 1e-4 );
    float edge = max( 1.0 - smoothstep( uPx * 0.5, uPx + 0.75, edgePx ), 0.55 * ( 1.0 - smoothstep( 0.05, 0.32, ndv ) ) );
    c = vec4( uColor * ( 1.0 + 0.45 * edge ), mix( uAlpha, 0.92, edge ) );
  }
  pc_fragColor = c;
}
`;

const DEFINES: Record<InkPath, Record<string, string>> = {
  rigid: { VALE_INK_RIGID: '' },
  skin: { VALE_INK_SKIN: '' },
  crowd: { VALE_INK_CROWD: '' },
};

type U = Record<string, { value: unknown }>;

/** the uniforms every ink material carries (the mode selectors and every sampler), plus its path's */
function baseUniforms(path: InkPath, mode: InkMode): U {
  const u: U = {
    uInkMode: { value: mode },
    uPx: { value: 0 },
    uOutlineRes: outlineUniforms.uOutlineRes,
    uColor: { value: new Color(0, 0, 0) },
    uAlpha: { value: 1 },
    uMask: { value: null },
    uSceneDepth: { value: null },
    uHasDepth: { value: 0 },
  };
  if (path === 'rigid') { u.uInst = { value: 0 }; u.uSway = { value: INK_SWAY.none }; }
  if (path === 'crowd') { u.uCrowdBake = { value: null }; u.uCrowdBind = { value: new Matrix4() }; }
  return u;
}

export interface InkOptions {
  side?: Side;
  /** blending: 'none' (opaque writes), 'normal' (straight alpha over), 'premul' (premultiplied over) */
  blend?: 'none' | 'normal' | 'premul';
  depthTest?: boolean;
  depthWrite?: boolean;
  colorWrite?: boolean;
  /** polygon offset [factor, units] */
  offset?: [number, number];
  /** extra or shared uniforms (by reference) */
  uniforms?: U;
  name?: string;
}

/** one ink material: `path` picks the program, `mode` the pass, the rest is render state and uniforms */
export function inkMaterial(path: InkPath, mode: InkMode, o: InkOptions = {}): RawShaderMaterial {
  const blend = o.blend ?? 'none';
  const m = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERT, fragmentShader: FRAG,
    defines: { ...DEFINES[path] },
    uniforms: { ...baseUniforms(path, mode), ...(o.uniforms ?? {}) },
    side: o.side ?? FrontSide,
    transparent: blend !== 'none',
    depthTest: o.depthTest ?? true,
    depthWrite: o.depthWrite ?? blend === 'none',
    colorWrite: o.colorWrite ?? true,
  });
  if (blend === 'normal') m.blending = NormalBlending;
  else if (blend === 'premul') {
    m.blending = CustomBlending;
    m.blendSrc = OneFactor; m.blendDst = OneMinusSrcAlphaFactor; m.blendSrcAlpha = OneFactor; m.blendDstAlpha = OneMinusSrcAlphaFactor;
  }
  if (o.offset) { m.polygonOffset = true; m.polygonOffsetFactor = o.offset[0]; m.polygonOffsetUnits = o.offset[1]; }
  m.name = o.name ?? `vale_ink_${path}`;
  return m;
}

/** the vertex path of a mesh (a crowd part is a plain Mesh drawing the crowd's own ink materials, never asked here) */
export const inkPathOf = (m: Object3D): InkPath => ((m as SkinnedMesh).isSkinnedMesh ? 'skin' : 'rigid');

// ── per-actor ink sets (outline, flash, hover, depth prepass) ─────────────────────────────────────────────────────
/** the outline's uniforms an actor drives (shared by its rigid and skinned hull parts) */
export interface OutlineU { uPx: { value: number }; uColor: { value: Color }; uAlpha: { value: number } }
export const outlineU = (): OutlineU => ({ uPx: { value: 1 }, uColor: { value: new Color(0, 0, 0) }, uAlpha: { value: 0.6 } });
/** the rest ink: back faces, straight alpha, behind the body by a polygon offset */
export function outlineMaterial(path: InkPath, u: OutlineU): RawShaderMaterial {
  return inkMaterial(path, INK.outline, { side: BackSide, blend: 'normal', depthWrite: false, offset: [1, 2], uniforms: { ...u } });
}
/** the victim flash's uniforms an actor drives */
export interface FlashU { uFlashColor: { value: Color }; uFlashRim: { value: Color }; uFlashK: { value: number }; uFlashInk: { value: number }; uBias: { value: number } }
/** `uBias` (m): how far the flash slides toward the camera (0 = on the body's own surface; a match flash drawn over the
 *  hull's LOD takes FLASH_LOD_BIAS_M, actors.ts) */
export const flashU = (): FlashU => ({ uFlashColor: { value: new Color() }, uFlashRim: { value: new Color() }, uFlashK: { value: 0 }, uFlashInk: { value: 0 }, uBias: { value: 0 } });
/** the flash: front faces, premultiplied over, in front of the body by a polygon offset */
export function flashMaterial(path: InkPath, u: FlashU): RawShaderMaterial {
  return inkMaterial(path, INK.flash, { side: FrontSide, blend: 'premul', depthWrite: false, offset: [-1, -2], uniforms: { ...u } });
}
/** the occluded silhouette's uniforms an actor drives (tokens.json `hud.unitOutline.occluded`) */
export interface XrayU { uColor: { value: Color }; uAlpha: { value: number }; uPx: { value: number }; uBias: { value: number } }
export const xrayU = (): XrayU => ({ uColor: { value: new Color() }, uAlpha: { value: 0.42 }, uPx: { value: 1.5 }, uBias: { value: 0.3 } });
/** draw order of the occluded silhouette in the opaque list: after the cover (OCCLUDER_ORDER: cliffs, rock stacks,
 *  Dialwood, boulders, landmarks) and before every unit (0), so its GREATER test meets only the cover's depth and a
 *  unit standing in front still draws over it */
export const XRAY_ORDER = -2;
export const OCCLUDER_ORDER = -3;
/** the occluded silhouette (env F4): front faces, depth test GREATER (only where cover is nearer), no depth write;
 *  opaque-listed (transparent false) so it draws at XRAY_ORDER among the opaque, blended over the cover by its own
 *  alpha with the target's alpha kept */
export function xrayMaterial(path: InkPath, u: XrayU): RawShaderMaterial {
  const m = inkMaterial(path, INK.xray, { side: FrontSide, depthWrite: false, uniforms: { ...u }, name: `vale_ink_xray_${path}` });
  m.depthFunc = GreaterDepth;
  m.blending = CustomBlending;
  m.blendEquation = AddEquation; m.blendSrc = SrcAlphaFactor; m.blendDst = OneMinusSrcAlphaFactor;
  m.blendEquationAlpha = AddEquation; m.blendSrcAlpha = ZeroFactor; m.blendDstAlpha = OneFactor;
  return m;
}
/** a depth-only prepass copy (veils, the structure fade): drawn last among the opaque so the see-through body shows
 *  only its nearest surface */
export function prepassMaterial(path: InkPath): RawShaderMaterial {
  return inkMaterial(path, INK.depth, { colorWrite: false, offset: [1, 1], name: `vale_ink_prepass_${path}` });
}

/** the hover rim's uniforms (uPx, uColor, uAlpha, uMask + the overlay's scene-depth test, all by reference) */
export interface RimU { uPx: { value: number }; uMask: { value: Texture | null }; uColor: { value: Color }; uAlpha: { value: number } }

/** the hover pass materials of one vertex path (overlay/hover.ts): the silhouette mask and the rim */
export function hoverMaterials(path: InkPath, rim: RimU, depth: U, extra: U = {}): { mask: RawShaderMaterial; rim: RawShaderMaterial } {
  return {
    mask: inkMaterial(path, INK.mask, { side: DoubleSide, depthTest: false, depthWrite: false, uniforms: { ...extra } }),
    rim: inkMaterial(path, INK.rim, { side: BackSide, blend: 'normal', depthTest: false, depthWrite: false, uniforms: { ...depth, ...rim, ...extra } }),
  };
}

// ── shadow casters ─────────────────────────────────────────────────────────────────────────────────────────────
let rigidDepth: RawShaderMaterial | null = null;
let instDepth: RawShaderMaterial | null = null;
let skinDepth: RawShaderMaterial | null = null;
/** the shared shadow depth material of a vertex path (rigid, rigid instanced, skinned) */
export function shadowDepth(path: 'rigid' | 'skin', instanced = false): RawShaderMaterial {
  if (path === 'skin') return (skinDepth ??= inkMaterial('skin', INK.depth, { name: 'vale_ink_shadow_skin' }));
  if (!instanced) return (rigidDepth ??= inkMaterial('rigid', INK.depth, { name: 'vale_ink_shadow' }));
  return (instDepth ??= inkMaterial('rigid', INK.depth, { name: 'vale_ink_shadow_inst', uniforms: { uInst: { value: 1 } } }));
}
/** an instanced caster's shadow running its own vertex motion (sway uniforms by reference) */
export function swayDepth(sway: (typeof INK_SWAY)[keyof typeof INK_SWAY], uniforms: U, name: string): RawShaderMaterial {
  return inkMaterial('rigid', INK.depth, { name, uniforms: { ...uniforms, uInst: { value: 1 }, uSway: { value: sway } } });
}
/** a crowd part's shadow (its bake and bind) */
export function crowdDepth(bake: Texture, bind: Matrix4): RawShaderMaterial {
  return inkMaterial('crowd', INK.depth, { name: 'vale_ink_shadow_crowd', uniforms: { uCrowdBake: { value: bake }, uCrowdBind: { value: bind } } });
}

/** every shadow caster under `root` that has no depth material of its own gets the ink one of its vertex path, so the
 *  shadow pass never compiles three's MeshDepthMaterial variants. Idempotent and cheap (one property test a node). */
export function inkShadows(root: Object3D): void {
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !m.castShadow || m.customDepthMaterial) return;
    m.customDepthMaterial = (m as SkinnedMesh).isSkinnedMesh ? shadowDepth('skin') : shadowDepth('rigid', (m as InstancedMesh).isInstancedMesh === true);
  });
}

// ── structures: the protected shell ───────────────────────────────────────────────────────────────────────────
/** the glaze's uniforms (the fade's by reference) */
export function glazeMaterial(u: U): RawShaderMaterial {
  return inkMaterial('rigid', INK.glaze, { blend: 'normal', depthWrite: false, name: 'vale_struct_skin', uniforms: u });
}
export function footMaterial(u: U): RawShaderMaterial {
  return inkMaterial('rigid', INK.foot, { side: DoubleSide, blend: 'normal', depthWrite: false, name: 'vale_struct_shell', uniforms: u });
}

/** the extra uniforms a glaze / foot material reads (fresh objects; the fade's three may be passed by reference) */
export function shellUniforms(o: { center?: boolean; h?: number; inflate?: number; fade?: U } = {}): U {
  const u: U = { uColor: { value: new Color() }, uK: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 } };
  if (o.center) { u.uCenter = { value: new Vector3() }; u.uH = { value: o.h ?? 1 }; u.uInflate = { value: o.inflate ?? 0 }; }
  if (o.fade) Object.assign(u, o.fade);
  return u;
}

