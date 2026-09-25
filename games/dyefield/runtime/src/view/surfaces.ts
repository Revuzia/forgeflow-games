// DYEFIELD — stylized surfaces + the dye layer (CONTRACT §5.0 / §5.1, DESIGN §4). LOOK lane.
//
// materialFor(name) swaps an exported `M_*` material for a MeshStandardMaterial whose look is
// procedural (UV0 metres and/or world position): tile grout + court lines, concrete speckle and
// joints, boardwalk planks, crate boards, chevron and hazard stripes, planter slats, soil, brushed
// metal and glowing spawn pads. applyDye() layers the paint on top.
//
// ── How surface + dye compose ─────────────────────────────────────────────────────────────────
// Both are `onBeforeCompile` shader patches. Each material owns an ordered patch list (kept in a
// WeakMap, so Material.clone()/JSON never sees functions or textures) and ONE onBeforeCompile that
// runs a shared BASE patch plus every registered patch, slot by slot:
//
//   slot        anchor (meshphysical template, three r186)     what goes there
//   pars        after  #include <common>                       varyings, uniforms, noise, sky, helpers
//   init        before #include <logdepthbuf_fragment>         reset the df* globals
//   albedo      after  #include <color_fragment>               surface: dfA / dfR / dfM / dfH / dfEmit
//   rough       after  #include <metalnessmap_fragment>        base: roughnessFactor / metalnessFactor
//   normal      after  #include <normal_fragment_maps>         dye: albedo, roughness, height, coat;
//                                                              base (last): bump from dfH
//   emissive    after  #include <emissivemap_fragment>         base: += dfEmit
//   lightsPars  after  #include <lights_physical_pars_fragment> base: RE_Direct wrapper (coat lobe)
//   postLights  after  #include <lights_fragment_end>          base (only when asked): analytic sky
//                                                              reflection, sparkle, dye wet streaks +
//                                                              rim, dye saturation protection
//
// The surface patch always runs before the dye patch, whatever order materialFor()/applyDye()
// were called in, so the dye reads the finished surface and overrides it where painted.
// customProgramCacheKey() is the patch-key list, so every (surface kind × dye) pair gets its
// own program and identical pairs share one (onBeforeCompile's default key would be the
// closure source, identical for all materials — a silent wrong-shader bug).
//
// ── Sky environment ───────────────────────────────────────────────────────────────────────────
// SURFACE_ENV is one set of shared uniforms (sky colours, sun direction/colour, clock) used by
// every patched material, the sky dome (sky.ts) and the water (water.ts). createSky() fills it
// from the LightingPreset; water.update(t) writes the clock. It feeds an analytic sky reflection
// (glossy dye, metal), because the scene has no environment map.

import * as THREE from 'three';
import type { LightingPreset, MapDef } from '../core/data.ts';
import { MAPS, mapById, teamById, TEAMS_RAW } from '../core/data.ts';
import type { PaintTexture } from './paintlayer.ts';

// ════════════════════════════════════════════════════════════════════════════════════════════
// Shared sky environment
// ════════════════════════════════════════════════════════════════════════════════════════════

export interface SurfaceEnv {
  [k: string]: THREE.IUniform;
  uDfTime: THREE.IUniform<number>;
  uDfSkyZenith: THREE.IUniform<THREE.Color>;
  uDfSkyHorizon: THREE.IUniform<THREE.Color>;
  uDfSkyWarm: THREE.IUniform<THREE.Color>;
  uDfSkyGround: THREE.IUniform<THREE.Color>;
  uDfSunDir: THREE.IUniform<THREE.Vector3>;
  uDfSunColor: THREE.IUniform<THREE.Color>;
  /** the preset's shallow-water colour (tidal film on M_shallows) */
  uDfWater: THREE.IUniform<THREE.Color>;
  /** interior practicals: fluorescent strip, skylight pane glow, sodium lamp (defaults outdoors) */
  uDfStrip: THREE.IUniform<THREE.Color>;
  uDfWindow: THREE.IUniform<THREE.Color>;
  uDfSodium: THREE.IUniform<THREE.Color>;
  /** 1 under an `interior` lighting preset, else 0 */
  uDfInterior: THREE.IUniform<number>;
}

/**
 * CONTRACT_ART_P6_8 §14.4 — the `interior` lighting preset kind. `LightingPreset` (core/data.ts)
 * lists the outdoor fields; interior presets carry these on top (the outdoor fields stay present
 * as fallbacks, e.g. sunElevation/Azimuth = the key direction).
 */
export interface InteriorPresetFields {
  kind?: 'outdoor' | 'interior';
  ambient?: string; ambientIntensity?: number;
  keyDir?: [number, number, number]; keyColor?: string; keyIntensity?: number;
  skyVisible?: boolean;
  windowGlow?: string; stripColor?: string; sodiumColor?: string;
}
export type AnyPreset = LightingPreset & InteriorPresetFields;

/** 'interior' when the preset says so (CONTRACT_ART_P6_8 §14.4), else 'outdoor' (the default). */
export function presetKind(p: LightingPreset): 'outdoor' | 'interior' {
  return (p as AnyPreset).kind === 'interior' ? 'interior' : 'outdoor';
}

/** map-level `mist` block (maps.json, CONTRACT_ART_P6_8 §14.4 / CONTRACT_P6_11 §19) */
export interface MistDef { hideRange: number; density: number; color: string }

/** The map a preset object belongs to (presets are shared by reference from data/maps.json). */
export function mapOfPreset(p: LightingPreset): MapDef | null {
  for (const m of MAPS) {
    const ps = m.lighting?.presets;
    if (ps && Object.values(ps).includes(p)) return m;
  }
  return null;
}

/** The `mist` block of the map that owns this preset (null when there is none). */
export function mistOf(p: LightingPreset): MistDef | null {
  const m = mapOfPreset(p) as (MapDef & { mist?: MistDef }) | null;
  const mist = m?.mist;
  return mist && typeof mist.density === 'number' && typeof mist.color === 'string' ? mist : null;
}

/**
 * Unit vector TOWARD the sun. Convention (documented once, used everywhere): elevation is degrees
 * above the horizon; azimuth is degrees clockwise seen from above starting at +Z, so
 * azimuth 0 = +Z, 90 = +X, 180 = −Z, 270 = −X.  dir = (sin az·cos el, sin el, cos az·cos el).
 */
export function sunDirection(elevationDeg: number, azimuthDeg: number, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

/** The warm horizon band colour: the sun's colour pulled toward a soft peach. */
const WARM_BAND = new THREE.Color('#FFC68A');

export const SURFACE_ENV: SurfaceEnv = {
  uDfTime: { value: 0 },
  uDfSkyZenith: { value: new THREE.Color('#2F86DC') },
  uDfSkyHorizon: { value: new THREE.Color('#CFEDFB') },
  uDfSkyWarm: { value: new THREE.Color('#FFF3DE').lerp(WARM_BAND, 0.7) },
  uDfSkyGround: { value: new THREE.Color('#C4E6F6') },
  uDfSunDir: { value: sunDirection(62, 140) },
  uDfSunColor: { value: new THREE.Color('#FFF3DE') },
  uDfWater: { value: new THREE.Color('#3BC3CB') },
  uDfStrip: { value: new THREE.Color('#E4F2FF') },
  uDfWindow: { value: new THREE.Color('#9DB6CF') },
  uDfSodium: { value: new THREE.Color('#FFB35C') },
  uDfInterior: { value: 0 },
};

/** Point the shared sky uniforms at a preset (called by createSky). */
export function setSurfaceEnvironment(preset: LightingPreset, sunDir: THREE.Vector3): void {
  const e = SURFACE_ENV;
  const ip = preset as AnyPreset;
  e.uDfSunDir.value.copy(sunDir).normalize();
  e.uDfWater.value.set(preset.waterShallow);
  if (presetKind(preset) === 'interior') {
    // indoors, glossy things reflect the skylight glow overhead, the strip-lit hall around them and
    // the dark floor below; the "sun" is the skylight key
    const win = new THREE.Color(ip.windowGlow ?? preset.skyZenith);
    const strip = new THREE.Color(ip.stripColor ?? '#E4F2FF');
    const sodium = new THREE.Color(ip.sodiumColor ?? '#FFB35C');
    e.uDfInterior.value = 1;
    e.uDfStrip.value.copy(strip);
    e.uDfWindow.value.copy(win);
    e.uDfSodium.value.copy(sodium);
    e.uDfSkyZenith.value.copy(win);
    e.uDfSkyHorizon.value.set(ip.ambient ?? preset.skyHorizon).lerp(strip, 0.45);
    e.uDfSkyWarm.value.copy(sodium).lerp(e.uDfSkyHorizon.value, 0.55);
    e.uDfSkyGround.value.set(preset.fogColor);
    e.uDfSunColor.value.set(ip.keyColor ?? preset.sunColor);
    return;
  }
  e.uDfInterior.value = 0;
  e.uDfSkyZenith.value.set(preset.skyZenith);
  e.uDfSkyHorizon.value.set(preset.skyHorizon);
  e.uDfSkyWarm.value.set(preset.sunColor).lerp(WARM_BAND, 0.7);
  // below the horizon the sky reads as the fogged sea
  e.uDfSkyGround.value.set(preset.fogColor).lerp(new THREE.Color(preset.waterShallow), 0.15);
  e.uDfSunColor.value.set(preset.sunColor);
  // outdoor defaults for the practicals (lamp lenses, spring glow tints)
  e.uDfStrip.value.set('#E4F2FF');
  e.uDfWindow.value.set(preset.skyHorizon);
  e.uDfSodium.value.set('#FFB35C');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// GLSL building blocks (exported for sky.ts / water.ts)
// ════════════════════════════════════════════════════════════════════════════════════════════

/** hash + value noise (no sin-hash: stable on every GPU). Requires nothing. */
export const NOISE_GLSL = /* glsl */ `
float dfHash12( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float dfHash13( vec3 p3 ) {
	p3 = fract( p3 * 0.1031 );
	p3 += dot( p3, p3.zyx + 31.32 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float dfNoise2( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	float a = dfHash12( i );
	float b = dfHash12( i + vec2( 1.0, 0.0 ) );
	float c = dfHash12( i + vec2( 0.0, 1.0 ) );
	float d = dfHash12( i + vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
float dfNoise3( vec3 p ) {
	vec3 i = floor( p );
	vec3 f = fract( p );
	vec3 u = f * f * ( 3.0 - 2.0 * f );
	float n000 = dfHash13( i );
	float n100 = dfHash13( i + vec3( 1.0, 0.0, 0.0 ) );
	float n010 = dfHash13( i + vec3( 0.0, 1.0, 0.0 ) );
	float n110 = dfHash13( i + vec3( 1.0, 1.0, 0.0 ) );
	float n001 = dfHash13( i + vec3( 0.0, 0.0, 1.0 ) );
	float n101 = dfHash13( i + vec3( 1.0, 0.0, 1.0 ) );
	float n011 = dfHash13( i + vec3( 0.0, 1.0, 1.0 ) );
	float n111 = dfHash13( i + vec3( 1.0, 1.0, 1.0 ) );
	return mix( mix( mix( n000, n100, u.x ), mix( n010, n110, u.x ), u.y ),
	            mix( mix( n001, n101, u.x ), mix( n011, n111, u.x ), u.y ), u.z );
}
float dfFbm3( vec3 p ) {
	return dfNoise3( p ) * 0.55 + dfNoise3( p * 2.03 + vec3( 17.1, 3.3, 9.2 ) ) * 0.3 + dfNoise3( p * 4.11 + vec3( 3.7, 11.9, 1.3 ) ) * 0.15;
}
// value noise that repeats every 'per' (a whole number) cells in x: seamless around a circle when
// x = turns * per (the dye's reflection streaks are keyed on the reflected ray's azimuth)
float dfNoise2Px( vec2 p, float per ) {
	vec2 i = floor( p );
	vec2 f = p - i;
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	float x0 = mod( i.x, per );
	float x1 = mod( i.x + 1.0, per );
	float a = dfHash12( vec2( x0, i.y ) );
	float b = dfHash12( vec2( x1, i.y ) );
	float c = dfHash12( vec2( x0, i.y + 1.0 ) );
	float d = dfHash12( vec2( x1, i.y + 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
`;

/** Sky uniforms (SURFACE_ENV) + the analytic sky. Requires <common> (saturate) and NOISE_GLSL. */
export const SKY_GLSL = /* glsl */ `
uniform float uDfTime;
uniform vec3 uDfSkyZenith;
uniform vec3 uDfSkyHorizon;
uniform vec3 uDfSkyWarm;
uniform vec3 uDfSkyGround;
uniform vec3 uDfSunDir;
uniform vec3 uDfSunColor;
uniform vec3 uDfWater;
uniform vec3 uDfStrip;
uniform vec3 uDfWindow;
uniform vec3 uDfSodium;
uniform float uDfInterior;
// gradient dome: horizon → zenith, a warm band hugging the horizon (strongest toward the sun),
// and the fogged sea below the horizon
vec3 dfSkyColor( vec3 d ) {
	float y = d.y;
	float t = sqrt( saturate( y ) );
	vec3 col = mix( uDfSkyHorizon, uDfSkyZenith, smoothstep( 0.0, 1.0, t ) );
	vec2 sh = normalize( uDfSunDir.xz + vec2( 1e-4, 0.0 ) );
	vec2 dh = normalize( d.xz + vec2( 1e-4, 0.0 ) );
	float toward = 0.5 + 0.5 * dot( sh, dh );
	float band = exp( - max( y, 0.0 ) * 14.0 ) * ( 0.55 + 0.45 * toward * toward );
	col = mix( col, uDfSkyWarm, saturate( band ) * 0.7 );
	col = mix( col, uDfSkyGround, 1.0 - smoothstep( -0.12, 0.0, y ) );
	return col;
}
// what glossy things reflect: the sky, a soft lobed cloud band where the dome's puffs sit
// (gives puddles moving structure — a flat gradient alone never reads as wet) and the sun glow
vec3 dfSkyRadiance( vec3 d ) {
	float s = saturate( dot( d, uDfSunDir ) );
	vec3 col = dfSkyColor( d );
	vec2 hd = normalize( d.xz + vec2( 1e-4, 0.0 ) );
	float lobes = smoothstep( 0.42, 0.78, dfNoise2( hd * 2.4 + vec2( 3.7, 1.3 ) ) );
	float band = smoothstep( 0.03, 0.12, d.y ) * ( 1.0 - smoothstep( 0.22, 0.42, d.y ) );
	col = mix( col, vec3( 0.97 ) + uDfSunColor * 0.03, band * lobes * 0.6 );
	return col + uDfSunColor * ( pow( s, 48.0 ) * 0.9 + pow( s, 6.0 ) * 0.08 );
}
`;

// ════════════════════════════════════════════════════════════════════════════════════════════
// Patch machinery
// ════════════════════════════════════════════════════════════════════════════════════════════

type Slot = 'pars' | 'init' | 'albedo' | 'rough' | 'normal' | 'emissive' | 'lightsPars' | 'postLights';

const FRAG_ANCHORS: ReadonlyArray<readonly [Slot, string, 'before' | 'after']> = [
  ['pars', '#include <common>', 'after'],
  ['init', '#include <logdepthbuf_fragment>', 'before'],
  ['albedo', '#include <color_fragment>', 'after'],
  ['rough', '#include <metalnessmap_fragment>', 'after'],
  ['normal', '#include <normal_fragment_maps>', 'after'],
  ['emissive', '#include <emissivemap_fragment>', 'after'],
  ['lightsPars', '#include <lights_physical_pars_fragment>', 'after'],
  ['postLights', '#include <lights_fragment_end>', 'after'],
];

interface Patch {
  /** program-cache identity: patches with equal keys emit identical GLSL */
  key: string;
  /** one patch per group per material (a new one replaces the old) */
  group: 'surface' | 'dye';
  /** surface (0) always runs before dye (10) */
  order: number;
  uniforms: Record<string, THREE.IUniform>;
  vertPars?: string;
  vertMain?: string;
  frag: Partial<Record<Slot, string>>;
}

interface ShaderSource {
  vertexShader: string;
  fragmentShader: string;
  uniforms: { [uniform: string]: THREE.IUniform };
}

const BASE_VERT_PARS = /* glsl */ `
varying vec3 vDfWorld;
varying vec3 vDfWorldN;
varying vec2 vDfUv0;
`;

// after <project_vertex>: `transformed` and `objectNormal` are final (skinning/morphs applied)
const BASE_VERT_MAIN = /* glsl */ `
{
	vec4 dfWp = vec4( transformed, 1.0 );
	vec3 dfWn = objectNormal;
	#ifdef USE_BATCHING
		dfWp = batchingMatrix * dfWp;
		dfWn = mat3( batchingMatrix ) * dfWn;
	#endif
	#ifdef USE_INSTANCING
		dfWp = instanceMatrix * dfWp;
		dfWn = mat3( instanceMatrix ) * dfWn;
	#endif
	dfWp = modelMatrix * dfWp;
	vDfWorld = dfWp.xyz;
	vDfWorldN = normalize( mat3( modelMatrix ) * dfWn );
	vDfUv0 = uv;
}
`;

const BASE_FRAG_PARS = /* glsl */ `
// ── DYEFIELD surface base ──
varying vec3 vDfWorld;
varying vec3 vDfWorldN;
varying vec2 vDfUv0;
${NOISE_GLSL}
${SKY_GLSL}
// per-fragment outputs of the surface / dye blocks (reset in main)
float dfEnvW;      // weight of the analytic sky reflection
float dfEnvF0;     // its fresnel floor
float dfEnvMax;    // its fresnel ceiling (dye keeps its crew colour at grazing angles)
vec3 dfEnvCol;     // its tint (white; the dye tints it toward its gloss colour so a wet sheen keeps the crew hue)
float dfEnvLum;    // 0..1: reflect the sky's LUMINANCE only (then dfEnvCol tints it) — dye never reflects a blue/white film
float dfCoat;      // extra clear-coat lobe weight (friendly dye)
float dfCoatRough; // its roughness
vec3 dfCoatTint;   // its tint
float dfH;         // bump height in metres (surface detail, then dye), applied once
vec3 dfEmit;       // extra emissive radiance (linear)
float dfSpark;     // sparkle-fleck strength (dye)
float dfSheen;     // wet-streak strength (friendly dye): reflected sky/sun streaks stretched along the view
vec3 dfSheenCol;   // streak + rim tint (the crew's gloss colour)
float dfRim;       // raised-rim highlight weight (friendly dye; a resolution-independent bead just inside the edge)
float dfSatLock;   // 0..1: saturation protection — where coloured light drained the albedo's chroma, restore its hue
// planar coordinates in metres: floors → world XZ, walls → (horizontal tangent, world Y)
vec2 dfPlanar( vec3 w, vec3 n ) {
	if ( abs( n.y ) > 0.6 ) return w.xz;
	vec3 t = normalize( vec3( n.z, 0.0, - n.x ) + vec3( 1e-5, 0.0, 0.0 ) );
	return vec2( dot( w, t ), w.y );
}
// equilateral triangle SDF (apex toward +y), r = inradius-ish size
float dfSdTri( vec2 p, float r ) {
	const float k = 1.7320508;
	p.x = abs( p.x ) - r;
	p.y = p.y + r / k;
	if ( p.x + k * p.y > 0.0 ) p = vec2( p.x - k * p.y, - k * p.x - p.y ) / 2.0;
	p.x -= clamp( p.x, - 2.0 * r, 0.0 );
	return - length( p ) * sign( p.y );
}
// bump from a height field in METRES (Mikkelsen 2010, unnormalised so slopes are real slopes)
vec3 dfPerturb( vec3 pos, vec3 n, float h, float fd ) {
	vec3 sx = dFdx( pos );
	vec3 sy = dFdy( pos );
	vec2 dh = vec2( dFdx( h ), dFdy( h ) );
	vec3 r1 = cross( sy, n );
	vec3 r2 = cross( n, sx );
	float det = dot( sx, r1 ) * fd;
	vec3 g = sign( det ) * ( dh.x * r1 + dh.y * r2 );
	// clamp the slope to ~50° so a steep rim seen at a grazing angle never flips the normal
	float gl = length( g );
	float lim = abs( det ) * 1.2;
	// division-safe clamp: recipes that never write dfH (metal, tint, leaf) make g ≡ 0, and the
	// old ( gl > lim ? lim / gl : 1.0 ) then constant-folded to a literal x/0 in ANGLE's HLSL
	// (warning X4008 on those 4 programs). Same result wherever gl > 0.
	g *= lim / max( gl, lim + 1e-30 );
	vec3 bent = abs( det ) * n - g;
	return ( abs( det ) > 1e-18 && dot( bent, bent ) > 0.0 ) ? normalize( bent ) : n;
}
`;

const BASE_FRAG_INIT = /* glsl */ `
	dfEnvW = 0.0; dfEnvF0 = 0.04; dfEnvMax = 0.7; dfEnvCol = vec3( 1.0 ); dfEnvLum = 0.0; dfCoat = 0.0; dfCoatRough = 0.1; dfCoatTint = vec3( 1.0 );
	dfH = 0.0; dfEmit = vec3( 0.0 ); dfSpark = 0.0; dfSheen = 0.0; dfSheenCol = vec3( 1.0 ); dfRim = 0.0; dfSatLock = 0.0;
`;

const BASE_FRAG_ALBEDO_PRE = /* glsl */ `
	vec3 dfN = normalize( vDfWorldN );
	vec3 dfA = vec3( 1.0 );
	float dfR = -1.0;
	float dfM = -1.0;
`;
const BASE_FRAG_ALBEDO_POST = /* glsl */ `
	diffuseColor.rgb *= dfA;
`;
const BASE_FRAG_ROUGH = /* glsl */ `
	if ( dfR >= 0.0 ) roughnessFactor = dfR;
	if ( dfM >= 0.0 ) metalnessFactor = dfM;
`;
const BASE_FRAG_NORMAL_POST = /* glsl */ `
	normal = dfPerturb( - vViewPosition, normal, dfH, faceDirection );
`;
const BASE_FRAG_EMISSIVE = /* glsl */ `
	totalEmissiveRadiance += dfEmit;
`;
// Extra clear-coat-like lobe on every direct light (MeshStandardMaterial has no clearcoat).
const BASE_FRAG_LIGHTS_PARS = /* glsl */ `
void RE_Direct_DF( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	if ( dfCoat > 0.001 ) {
		vec3 hv = normalize( directLight.direction + geometryViewDir );
		float nl = saturate( dot( geometryNormal, directLight.direction ) );
		float nv = saturate( dot( geometryNormal, geometryViewDir ) );
		float nh = saturate( dot( geometryNormal, hv ) );
		float vh = saturate( dot( geometryViewDir, hv ) );
		float a = pow2( dfCoatRough );
		float fr = F_Schlick( 0.04, 1.0, vh );
		float spec = fr * V_GGX_SmithCorrelated( a, nl, nv ) * D_GGX( a, nh );
		reflectedLight.directSpecular += directLight.color * ( nl * spec * dfCoat ) * dfCoatTint;
	}
}
#undef RE_Direct
#define RE_Direct RE_Direct_DF
`;
// Everything here is skipped unless a block asked for it (no derivatives inside: the branch is
// safe): plain surfaces (tile, wood, concrete…) and UNPAINTED dyed fragments pay nothing.
const BASE_FRAG_POST_LIGHTS = /* glsl */ `
if ( dfEnvW > 0.0 || dfSpark > 0.0 || dfSheen > 0.0 || dfRim > 0.0 || dfSatLock > 0.0 ) {
	const vec3 dfLuma = vec3( 0.2126, 0.7152, 0.0722 );
	vec3 dfNw = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec3 dfVw = normalize( cameraPosition - vDfWorld );
	float dfNdV = saturate( dot( dfNw, dfVw ) );
	vec3 dfRw = reflect( - dfVw, dfNw );
	float dfG = 1.0 - dfNdV;
	float dfG2 = dfG * dfG;
	float dfFr = dfEnvF0 + ( 1.0 - dfEnvF0 ) * dfG2 * dfG2;
	vec3 dfSky = dfSkyRadiance( dfRw );
	float dfSkyL = dot( dfSky, dfLuma );
	vec3 dfEnvTint = mix( vec3( 1.0 ), diffuseColor.rgb, metalnessFactor );
	vec3 dfRefl = mix( dfSky, vec3( dfSkyL ), dfEnvLum );
	reflectedLight.indirectSpecular += dfRefl * dfEnvTint * dfEnvCol * ( min( dfFr, dfEnvMax ) * dfEnvW );
	#if NUM_DIR_LIGHTS > 0
		vec3 dfSunL = directLight.color;      // last directional light = the sun, shadow applied
	#else
		vec3 dfSunL = uDfSunColor;
	#endif
	if ( dfSpark > 0.0 ) {
		float dfAl = pow( saturate( dot( dfRw, uDfSunDir ) ), 10.0 );
		reflectedLight.directSpecular += dfSunL * ( dfSpark * ( 0.035 + 1.1 * dfAl ) );
	}
	if ( dfSheen > 0.0 || dfRim > 0.0 ) {
		// Wet streaks. On a glossy film, bright sky features smear ALONG the view: the reflected
		// ray's elevation changes slowly across the floor at grazing angles, its azimuth fast. So the
		// streak field is keyed on the reflected direction, fine in azimuth (periodic, seamless) and
		// coarse in elevation: vertical, soft-edged smears of many widths that slide like real
		// reflections, bend with the film's ripples, and cannot alias with distance (their angular
		// size is fixed). Brightness = the sky's luminance there (sun glow included, capped), so a
		// dim sky dims them; the tint is the crew gloss, so they read as lighter DYE, never as tile.
		float dfAz = atan( dfRw.z, dfRw.x + 1e-6 ) * 0.15915494;
		float dfS1 = dfNoise2Px( vec2( dfAz * 80.0, dfRw.y * 4.5 ), 80.0 );
		float dfS2 = dfNoise2Px( vec2( dfAz * 208.0 + 0.5, dfRw.y * 12.0 + 7.3 ), 208.0 );
		float dfStreak = smoothstep( 0.5, 0.95, dfS1 )
			+ smoothstep( 0.56, 0.96, dfS2 ) * ( 0.2 + 0.8 * smoothstep( 0.3, 0.7, dfS1 ) ) * 0.6;
		float dfGraze = saturate( 0.1 + 1.6 * dfG2 * dfG );
		// what the film reflects: the sky there, but never darker than the preset's bright horizon
		// band (clouds / haze are what a wet floor mirrors at these angles), sun glow capped
		float dfLit = min( max( dfSkyL, 0.85 * dot( uDfSkyHorizon, dfLuma ) ), 1.3 );
		reflectedLight.indirectSpecular += dfSheenCol * ( dfLit * (
			dfSheen * dfGraze * ( 0.12 + 3.0 * dfStreak )         // fresnel sheen + streaks
			+ dfRim * ( 0.35 + 0.6 * dfG ) ) );                     // raised rim catching the sky
		// fresnel energy split: what the film reflects at grazing no longer enters it, so the
		// friendly body deepens there — the dark between the streaks that makes a film read WET
		float dfSplit = 1.0 - 0.35 * saturate( dfSheen ) * min( dfFr, dfEnvMax );
		reflectedLight.directDiffuse *= dfSplit;
		reflectedLight.indirectDiffuse *= dfSplit;
		// the sun's glint on friendly dye is crew-gold, not a white disc (dielectric F0 is white)
		float dfW = saturate( dfSheen + dfRim );
		vec3 dfGlintT = dfSheenCol / max( max( dfSheenCol.r, dfSheenCol.g ), max( dfSheenCol.b, 1e-3 ) );
		reflectedLight.directSpecular *= mix( vec3( 1.0 ), dfGlintT, dfW );
		// soft ceiling on the dye's total specular (knee at half the cap, asymptote = 1.3 tints):
		// SUNCREW orange has no red headroom, so a hotter core could only drift to peach / white
		// after tone mapping — highlights top out at a light crew colour instead
		vec3 dfSpec = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
		float dfSL = dot( dfSpec, dfLuma );
		float dfCapM = 1.3 * dot( dfSheenCol, dfLuma );
		float dfKnee = 0.5 * dfCapM;
		float dfSLc = dfSL <= dfKnee ? dfSL : dfKnee + ( dfSL - dfKnee ) / ( 1.0 + ( dfSL - dfKnee ) / ( dfCapM - dfKnee ) );
		float dfK = mix( 1.0, dfSLc / max( dfSL, 1e-5 ), dfW );
		reflectedLight.directSpecular *= dfK;
		reflectedLight.indirectSpecular *= dfK;
	}
	if ( dfSatLock > 0.0 ) {
		// saturation protection: where a coloured light has DRAINED the dye's chroma (GULF violet
		// under an orange sunset turns to mud), restore the albedo's hue at the same luminance. Where
		// the light ADDS chroma (orange sun on SUNCREW orange) it stays off: measured in golden, a
		// forced lock pulled the dye onto the orange-lit tile's hue (dye-vs-tile ΔE76 42.9 → 35.2).
		vec3 dfAlb = diffuseColor.rgb;
		vec3 dfDd = reflectedLight.directDiffuse;
		vec3 dfId = reflectedLight.indirectDiffuse;
		vec3 dfDs = dfDd + dfId;
		float dfMxA = max( max( dfAlb.r, dfAlb.g ), dfAlb.b );
		float dfMxL = max( max( dfDs.r, dfDs.g ), dfDs.b );
		float dfSatA = ( dfMxA - min( min( dfAlb.r, dfAlb.g ), dfAlb.b ) ) / max( dfMxA, 1e-4 );
		float dfSatL = ( dfMxL - min( min( dfDs.r, dfDs.g ), dfDs.b ) ) / max( dfMxL, 1e-4 );
		float dfLk = dfSatLock * smoothstep( 0.0, 0.08, dfSatA - dfSatL );
		float dfAL = max( dot( dfAlb, dfLuma ), 1e-3 );
		reflectedLight.directDiffuse = mix( dfDd, dfAlb * ( dot( dfDd, dfLuma ) / dfAL ), dfLk );
		reflectedLight.indirectDiffuse = mix( dfId, dfAlb * ( dot( dfId, dfLuma ) / dfAL ), dfLk );
	}
}
`;

const BASE_PRE: Partial<Record<Slot, string>> = {
  pars: BASE_FRAG_PARS,
  init: BASE_FRAG_INIT,
  albedo: BASE_FRAG_ALBEDO_PRE,
  rough: BASE_FRAG_ROUGH,
  emissive: BASE_FRAG_EMISSIVE,
  lightsPars: BASE_FRAG_LIGHTS_PARS,
  postLights: BASE_FRAG_POST_LIGHTS,
};
const BASE_POST: Partial<Record<Slot, string>> = {
  albedo: BASE_FRAG_ALBEDO_POST,
  normal: BASE_FRAG_NORMAL_POST,
};

const PATCHES = new WeakMap<THREE.Material, Patch[]>();

function inject(src: string, anchor: string, where: 'before' | 'after', code: string, what: string): string {
  const i = src.indexOf(anchor);
  if (i < 0) throw new Error(`surfaces: shader anchor '${anchor}' not found in the ${what} shader (three template changed?)`);
  return where === 'after'
    ? src.slice(0, i + anchor.length) + '\n' + code + '\n' + src.slice(i + anchor.length)
    : src.slice(0, i) + code + '\n' + src.slice(i);
}

/** Assemble the patched shader source (exported for offline shader checks). */
export function applyPatchesToSource(shader: ShaderSource, list: ReadonlyArray<Patch>): void {
  for (const k in SURFACE_ENV) shader.uniforms[k] = SURFACE_ENV[k];
  for (const p of list) for (const k in p.uniforms) shader.uniforms[k] = p.uniforms[k];

  let vs = shader.vertexShader;
  vs = inject(vs, '#include <common>', 'after', BASE_VERT_PARS + list.map((p) => p.vertPars ?? '').join('\n'), 'vertex');
  vs = inject(vs, '#include <project_vertex>', 'after', BASE_VERT_MAIN + list.map((p) => p.vertMain ?? '').join('\n'), 'vertex');

  let fs = shader.fragmentShader;
  for (const [slot, anchor, where] of FRAG_ANCHORS) {
    const code = (BASE_PRE[slot] ?? '') + list.map((p) => p.frag[slot] ?? '').join('\n') + (BASE_POST[slot] ?? '');
    if (code.trim().length === 0) continue;
    fs = inject(fs, anchor, where, `// [df:${slot}]\n${code}`, 'fragment');
  }
  // point-light near field: the practicals (light_ empties) hang 1–2 m above press roofs and
  // gantries; inverse-square there blows a white hot spot. Floor the attenuation distance at
  // POINT_LIGHT_NEAR m (a soft plateau under the lamp; unchanged beyond it). Map surfaces only.
  const LP = THREE.ShaderChunk.lights_pars_begin;
  if (fs.includes('#include <lights_pars_begin>') && LP.includes(ATTEN_SRC)) {
    fs = fs.replace('#include <lights_pars_begin>', LP.replace(ATTEN_SRC, ATTEN_DF));
  }
  shader.vertexShader = vs;
  shader.fragmentShader = fs;
}

/** attenuation distance floor (m) for point lights on map surfaces */
export const POINT_LIGHT_NEAR = 4.0;
const ATTEN_SRC = 'max( pow( lightDistance, decayExponent ), 0.01 )';
const ATTEN_DF = `max( pow( lightDistance, decayExponent ), pow( ${POINT_LIGHT_NEAR.toFixed(2)}, decayExponent ) )`;

/** hook closure → its patch list, so a clone that copied our hooks (mat.clone() + hook copy) inherits the patches */
const LIST_OF_HOOK = new WeakMap<object, Patch[]>();

function installPatch(mat: THREE.MeshStandardMaterial, patch: Patch): void {
  let list = PATCHES.get(mat);
  if (!list) {
    const inherited = LIST_OF_HOOK.get(mat.onBeforeCompile as unknown as object);
    const own: Patch[] = inherited ? inherited.slice() : [];
    list = own;
    PATCHES.set(mat, own);
    const hook = (shader: ShaderSource): void => applyPatchesToSource(shader, own);
    LIST_OF_HOOK.set(hook, own);
    mat.onBeforeCompile = hook;
    mat.customProgramCacheKey = () => 'df|' + own.map((p) => p.key).join('|');
  }
  const i = list.findIndex((p) => p.group === patch.group);
  if (i >= 0) list[i] = patch; else list.push(patch);
  list.sort((a, b) => a.order - b.order);
  mat.needsUpdate = true;
}

/** The patch keys installed on a material (debug / tests). */
export function patchKeysOf(mat: THREE.Material): string[] {
  return (PATCHES.get(mat) ?? []).map((p) => p.key);
}

/**
 * Live uniforms of a patched material (surface + dye; shared SURFACE_ENV excluded), e.g. to
 * re-centre a spawn pad (`uPadCenter`) or tweak a court line colour at runtime.
 */
export function surfaceUniformsOf(mat: THREE.Material): Record<string, THREE.IUniform> {
  const out: Record<string, THREE.IUniform> = {};
  for (const p of PATCHES.get(mat) ?? []) Object.assign(out, p.uniforms);
  return out;
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// Surfaces
// ════════════════════════════════════════════════════════════════════════════════════════════

export interface SurfaceOptions { mapId: string; courtLines?: MapDef['courtLines'] }

/**
 * Art-directed palette (sRGB hex). Harbor sports court: warm stone + teal paint + white +
 * hazard yellow, all low-to-mid saturation so SUNCREW orange and GULF violet stay the most
 * saturated things on screen. Roughness stays 0.55–0.95 so glossy dye contrasts.
 */
export const PALETTE = {
  tileA: '#DCD6CA', tileB: '#CFD3CC', grout: '#8E8B84',
  concrete: '#CFC8BA',
  woodA: '#C99A64', woodB: '#B07E4C', woodGap: '#3B2A1D',
  crateA: '#2F9E96', crateB: '#3AAEA5', crateWood: '#CDA774', crateGap: '#1D3937',
  chevBase: '#17A39A', chevStripe: '#F6F5EF',
  hazYellow: '#FFC21A', hazDark: '#26262B', hazWorn: '#BDB6A8',
  plantSlat: '#EBE4D7', plantRim: '#D9D1C3', plantGap: '#968F84',
  soil: '#5B412D', pebble: '#A09382',
  metal: '#B8C2CA',
  padBody: '#262D3E',
  // phase 7–8 (Lockwell Works: cool steel + machine green + cream offices + red brick;
  // Cinder Reef: warm sand + charcoal basalt + weathered planks + rusted teal wreck)
  steel: '#8FA6BD', press: '#3FAE72', dock: '#B4BEC6', office: '#EFE5CC', officeSkirt: '#5C6670',
  brickA: '#B4604A', brickB: '#C77D5C', mortar: '#CFC7BA',
  grate: '#8394A8',
  beltRubber: '#353C4A', beltCleat: '#56607A', beltRail: '#9AA6B4',
  wetsand: '#E8D8B6', shallows: '#C7B08C',
  basalt: '#5F5851', basaltEdge: '#8C8278',
  plankA: '#B98E5E', plankB: '#A27A4E', plankGrey: '#B7AE9F', plankGap: '#3A2C21',
  wreckLow: '#3F9486', wreckBand: '#EFE4CF', wreckHigh: '#A2553B', wreckRust: '#8E4A2E',
  wreckDeck: '#7D8C98',
  coral: '#E09383', driftwood: '#C9BBA2', seabed: '#6FAE9C',
  kelp: '#6E8A34', moss: '#6E9A3A',
  springGlow: '#3CF2D2', springBody: '#1E4E5A',
} as const;

const col = (hex: string): THREE.Color => new THREE.Color(hex);
const U = <T>(value: T): THREE.IUniform<T> => ({ value });

/** strip Blender duplicate suffixes: 'M_tile.001' → 'M_tile' */
function baseName(name: string): string {
  return name.replace(/\.\d{3,}$/, '');
}

function isStd(m: THREE.Material | null): m is THREE.MeshStandardMaterial {
  return !!m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
}

function fallbackColor(fallback: THREE.Material | null, def: string): THREE.Color {
  const c = fallback && (fallback as unknown as { color?: THREE.Color }).color;
  return c && (c as THREE.Color).isColor ? (c as THREE.Color).clone() : col(def);
}

/** A fresh MeshStandardMaterial carrying the fallback's structural flags (not its colours). */
function makeMaterial(name: string, fallback: THREE.Material | null, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness });
  m.name = name;
  if (fallback) {
    m.side = fallback.side;
    m.vertexColors = fallback.vertexColors;
    m.transparent = fallback.transparent;
    m.opacity = fallback.opacity;
    m.alphaTest = fallback.alphaTest;
    const map = (fallback as unknown as { map?: THREE.Texture | null }).map;
    if (map && map.isTexture) m.map = map;
  }
  m.userData.dfSurface = name;
  return m;
}

/** exported material, converted to MeshStandardMaterial if needed (unknown names, signage). */
function exported(name: string, fallback: THREE.Material | null): THREE.MeshStandardMaterial {
  if (isStd(fallback)) {
    const m = fallback.clone();
    m.userData.dfSurface = name;
    return m;
  }
  const m = makeMaterial(name, fallback, 0.7);
  m.color.copy(fallbackColor(fallback, '#CCCCCC'));
  return m;
}

function surfacePatch(kind: string, uniforms: Record<string, THREE.IUniform>, albedo: string): Patch {
  return { key: `s:${kind}`, group: 'surface', order: 0, uniforms, frag: { pars: uniformDecls(uniforms), albedo } };
}

function uniformDecls(u: Record<string, THREE.IUniform>): string {
  let s = '';
  for (const k of Object.keys(u)) {
    const v = u[k].value as unknown;
    let t = 'float';
    if (v instanceof THREE.Color || v instanceof THREE.Vector3) t = 'vec3';
    else if (v instanceof THREE.Vector2) t = 'vec2';
    else if (v instanceof THREE.Vector4) t = 'vec4';
    s += `uniform ${t} ${k};\n`;
  }
  return s;
}

// ── surface GLSL (albedo slot; dfN, dfA, dfR, dfM in scope; every block is self-contained) ────

const TILE_GLSL = /* glsl */ `
{
	vec2 p = dfPlanar( vDfWorld, dfN );
	float fw = fwidth( p.x ) + fwidth( p.y );
	float detail = 1.0 - smoothstep( 0.02, 0.09, fw );
	vec2 cell = floor( p );
	vec2 f = p - cell;
	vec2 e2 = min( f, 1.0 - f );
	float e = min( e2.x, e2.y );
	float aa = max( fw * 0.6, 1e-4 );
	float gw = 0.011;
	float grout = ( 1.0 - smoothstep( gw - aa, gw + aa, e ) ) * mix( 0.35, 1.0, detail );
	float h1 = dfHash12( cell );
	float h2 = dfHash12( cell + vec2( 37.0, 11.0 ) );
	vec3 c = mix( uTileA, uTileB, h1 ) * ( 0.95 + 0.08 * h2 );
	// the 23/m speckle is faded out by 'detail' on far tiles: skip its noise there
	float sp = 0.5;
	if ( detail > 0.0 ) sp = dfNoise2( p * 23.0 );
	float wash = dfNoise2( p * 0.21 + vec2( 5.3, 1.7 ) );
	c *= 0.96 + 0.07 * ( sp - 0.5 ) * detail + 0.08 * ( wash - 0.5 );
	float bevel = smoothstep( gw, gw + 0.05, e );
	dfH = -0.002 * ( 1.0 - bevel ) * detail;
	c = mix( c, uTileGrout, grout );
	dfR = mix( 0.66 + 0.1 * h2, 0.92, grout );
	// court lines: centre circle + mid line, world XZ, only on the up-facing court plate
	vec2 q = vDfWorld.xz - uCourtCenter;
	float dc = abs( length( q ) - uCourtRadius );
	float dm = abs( vDfWorld.z - uCourtMidZ );
	float dl = min( dc, dm );
	float lw = uCourtWidth * 0.5;
	float laa = max( fwidth( dl ) * 0.8, 1e-4 );
	float onPlate = uCourtOn * smoothstep( 0.8, 0.95, dfN.y ) * ( 1.0 - smoothstep( 0.2, 0.4, abs( vDfWorld.y - uCourtY ) ) );
	float line = ( 1.0 - smoothstep( lw - laa, lw + laa, dl ) ) * onPlate;
	float rim = max( ( 1.0 - smoothstep( lw + 0.02 - laa, lw + 0.02 + laa, dl ) ) * onPlate - line, 0.0 );
	c = mix( c, c * 0.8, rim );
	c = mix( c, uCourtColor * ( 0.97 + 0.05 * sp ), line );
	dfR = mix( dfR, 0.52, line );
	dfH = mix( dfH, 0.0, line );
	dfA = c;
}
`;

const CONCRETE_GLSL = /* glsl */ `
{
	vec2 p = dfPlanar( vDfWorld, dfN );
	float fw = fwidth( p.x ) + fwidth( p.y );
	float detail = 1.0 - smoothstep( 0.015, 0.07, fw );
	float big = dfNoise2( p * 0.33 + vec2( 11.0, 3.0 ) );
	float mid = dfNoise2( p * 2.1 + vec2( 3.0, 8.0 ) );
	// fine grain + specks only exist where 'detail' > 0: far concrete skips those 3 noises
	float fine = 0.5;
	float spD = 0.0;
	float spL = 0.0;
	if ( detail > 0.0 ) {
		fine = dfNoise2( p * 29.0 );
		spD = smoothstep( 0.8, 0.86, dfNoise2( p * 53.0 + vec2( 9.0, 2.0 ) ) ) * detail;
		spL = smoothstep( 0.84, 0.9, dfNoise2( p * 41.0 + vec2( 21.0, 5.0 ) ) ) * detail;
	}
	vec3 c = uConcBase * ( 0.93 + 0.1 * big + 0.05 * ( mid - 0.5 ) + 0.05 * ( fine - 0.5 ) * detail );
	c = mix( c, c * 0.7, spD * 0.55 );
	c = mix( c, min( c * 1.2, vec3( 1.0 ) ), spL * 0.45 );
	float wear = smoothstep( 0.55, 0.85, dfNoise2( p * 0.8 + vec2( 40.0, 7.0 ) ) );
	c *= 1.0 - 0.06 * wear;
	vec2 jq = abs( fract( p / 3.0 + 0.5 ) - 0.5 ) * 3.0;
	float jd = min( jq.x, jq.y );
	float jaa = max( fwidth( jd ) * 0.8, 1e-4 );
	float joint = ( 1.0 - smoothstep( 0.006 - jaa, 0.006 + jaa, jd ) ) * mix( 0.4, 1.0, detail );
	c = mix( c, c * 0.62, joint * 0.75 );
	dfH = ( -0.0018 * joint + 0.0004 * ( fine - 0.5 ) ) * detail;
	dfR = 0.84 - 0.07 * wear + 0.06 * ( mid - 0.5 );
	dfA = c;
}
`;

const BOARDWALK_GLSL = /* glsl */ `
{
	float isFloor = step( 0.6, abs( dfN.y ) );
	vec2 wp = dfPlanar( vDfWorld, dfN );
	vec2 fp = mix( vec2( vDfWorld.x, vDfWorld.z ), vec2( vDfWorld.z, vDfWorld.x ), uPlankAlongX );
	// (across, along): floors → planks run along the deck's long axis; walls → horizontal boards
	vec2 p = mix( vec2( wp.y, wp.x ), fp, isFloor );
	float fw = fwidth( p.x ) + fwidth( p.y );
	float detail = 1.0 - smoothstep( 0.012, 0.06, fw );
	float W = 0.24;
	float ac = p.x / W;
	float idx = floor( ac );
	float fa = ac - idx;
	float L = 2.4;
	float off = dfHash12( vec2( idx, 7.0 ) ) * L;
	float al = ( p.y + off ) / L;
	float seg = floor( al );
	float fl = al - seg;
	float id = dfHash12( vec2( idx, seg ) );
	float dA = min( fa, 1.0 - fa ) * W;
	float dL = min( fl, 1.0 - fl ) * L;
	float aa = max( fw * 0.6, 1e-4 );
	float gap = 1.0 - smoothstep( 0.007 - aa, 0.007 + aa, dA );
	float butt = 1.0 - smoothstep( 0.004 - aa, 0.004 + aa, dL );
	float g = max( gap, butt ) * mix( 0.5, 1.0, detail );
	float grain = dfNoise2( vec2( p.x * 55.0 + id * 13.0, p.y * 2.6 ) );
	// fine grain + figure are faded by 'detail': far planks skip those 2 noises
	float grain2 = 0.5;
	float figure = 0.5;
	if ( detail > 0.0 ) {
		grain2 = dfNoise2( vec2( p.x * 160.0 + id * 3.0, p.y * 8.0 ) );
		figure = sin( p.x * 80.0 + dfNoise2( vec2( p.x * 6.0, p.y * 0.9 ) + id * 5.0 ) * 7.0 ) * 0.5 + 0.5;
	}
	vec3 wood = mix( uWoodA, uWoodB, id );
	wood *= 0.9 + 0.14 * grain + ( 0.07 * ( grain2 - 0.5 ) + 0.05 * ( figure - 0.5 ) ) * detail;
	float edge = 1.0 - smoothstep( 0.0, 0.025, min( dA, dL ) );
	wood *= 1.0 - 0.1 * edge;
	dfA = mix( wood, uWoodGap, g );
	dfH = ( -0.003 * g - 0.001 * edge + 0.0004 * ( grain - 0.5 ) ) * detail;
	dfR = mix( 0.7 + 0.12 * grain, 0.95, g );
}
`;

const CRATE_GLSL = /* glsl */ `
{
	float isWall = 1.0 - step( 0.6, abs( dfN.y ) );
	vec2 wp = dfPlanar( vDfWorld, dfN );
	// walls: boards stacked in world Y (crates only yaw); lids: boards along UV0.x
	vec2 p = mix( vDfUv0.yx, vec2( vDfWorld.y, wp.x ), isWall );
	float fw = fwidth( p.x ) + fwidth( p.y );
	float detail = 1.0 - smoothstep( 0.012, 0.06, fw );
	float B = 0.2;
	float ac = p.x / B;
	float idx = floor( ac );
	float fa = ac - idx;
	vec2 crateId = floor( vDfWorld.xz * 0.9 );
	float id = dfHash12( vec2( idx, 3.0 ) + crateId * 7.31 );
	float dA = min( fa, 1.0 - fa ) * B;
	float aa = max( fw * 0.6, 1e-4 );
	float gap = ( 1.0 - smoothstep( 0.008 - aa, 0.008 + aa, dA ) ) * mix( 0.5, 1.0, detail );
	float grain = dfNoise2( vec2( p.x * 50.0 + id * 9.0, p.y * 3.0 ) );
	vec3 paintC = mix( uCrateA, uCrateB, id ) * ( 0.93 + 0.1 * grain );
	float chipN = dfNoise2( p * vec2( 14.0, 5.0 ) + id * 17.0 );
	float nearEdge = 1.0 - smoothstep( 0.012, 0.05, dA );
	// chips hug board edges only: big bare-wood patches on the teal read as SUNCREW dye at range
	float chip = smoothstep( 0.8, 0.86, chipN * 0.85 + nearEdge * 0.3 ) * detail;
	vec3 wood = uCrateWood * ( 0.85 + 0.2 * grain );
	vec3 c = mix( paintC, wood, chip );
	c *= 1.0 - 0.12 * nearEdge;
	dfA = mix( c, uCrateGap, gap );
	dfH = ( -0.003 * gap - 0.0012 * nearEdge - 0.0006 * chip ) * detail;
	dfR = mix( mix( 0.62, 0.8, chip ), 0.95, gap );
}
`;

const CHEVRON_GLSL = /* glsl */ `
{
	float isTop = step( 0.6, abs( dfN.y ) );
	float along = vDfUv0.x;
	float H = uChevH;
	float yy = abs( fract( vDfWorld.y / H ) - 0.5 ) * H * ( 1.0 - isTop );
	float s = ( along + yy * uChevSlope ) / uChevPeriod;
	float tri = abs( fract( s ) - 0.5 );
	float aa = fwidth( s ) * 0.75 + 1e-4;
	float stripe = 1.0 - smoothstep( 0.24 - aa, 0.24 + aa, tri );
	float n = dfNoise2( vec2( along, vDfWorld.y ) * 13.0 );
	dfA = mix( uChevBase, uChevStripe, stripe ) * ( 0.96 + 0.06 * n );
	dfR = mix( 0.6, 0.5, stripe );
	dfH = 0.0006 * stripe;
}
`;

const HAZARD_GLSL = /* glsl */ `
{
	vec2 p = dfPlanar( vDfWorld, dfN );
	float s = ( p.x + p.y ) / 0.45;
	float tri = abs( fract( s ) - 0.5 );
	float aa = fwidth( s ) * 0.75 + 1e-4;
	float yel = smoothstep( 0.25 - aa, 0.25 + aa, tri );
	vec3 c = mix( uHazDark, uHazYellow, yel );
	// light scuffs only: a clean toy court, not grime (the earlier 0.6..0.78 mask covered ~40 % of
	// some stretches and read as dark camouflage blotches on the yellow)
	float wear = smoothstep( 0.74, 0.86, dfNoise2( p * 4.0 + vec2( 2.0, 9.0 ) ) ) * smoothstep( 0.5, 0.8, dfNoise2( p * 23.0 ) );
	c = mix( c, mix( uHazWorn, c, 0.5 ), wear * 0.6 );
	dfA = c;
	dfR = mix( 0.52, 0.82, wear );
	dfH = 0.0005 * ( 1.0 - wear );
}
`;

const PLANTER_GLSL = /* glsl */ `
{
	float isTop = step( 0.6, dfN.y );
	vec2 p = dfPlanar( vDfWorld, dfN );
	float fw = fwidth( p.x ) + fwidth( p.y );
	float detail = 1.0 - smoothstep( 0.012, 0.06, fw );
	float W = 0.15;
	float s = p.x / W;
	float fs = fract( s );
	float id = dfHash12( vec2( floor( s ), 5.0 ) );
	float d = min( fs, 1.0 - fs ) * W;
	float aa = max( fw * 0.6, 1e-4 );
	float gap = ( 1.0 - smoothstep( 0.006 - aa, 0.006 + aa, d ) ) * ( 1.0 - isTop ) * mix( 0.5, 1.0, detail );
	float grain = dfNoise2( vec2( p.x * 50.0, p.y * 3.0 ) + id * 11.0 );
	vec3 slat = uPlantSlat * ( 0.93 + 0.07 * id + 0.06 * ( grain - 0.5 ) );
	vec3 rimC = uPlantRim * ( 0.95 + 0.06 * dfNoise2( p * 9.0 ) );
	vec3 c = mix( slat, rimC, isTop );
	dfA = mix( c, uPlantGap, gap );
	dfR = mix( mix( 0.72, 0.6, isTop ), 0.95, gap );
	dfH = -0.0025 * gap * detail;
}
`;

const SOIL_GLSL = /* glsl */ `
{
	vec2 p = dfPlanar( vDfWorld, dfN );
	float n1 = dfNoise2( p * 13.0 );
	float n2 = dfNoise2( p * 43.0 + vec2( 3.0, 1.0 ) );
	float cl = dfNoise2( p * 3.5 + vec2( 8.0, 4.0 ) );
	vec3 c = uSoil * ( 0.72 + 0.3 * n1 + 0.16 * cl );
	float peb = smoothstep( 0.76, 0.84, n2 );
	c = mix( c, uPebble * ( 0.85 + 0.3 * n1 ), peb * 0.75 );
	dfA = c;
	dfH = 0.004 * ( n1 - 0.5 ) + 0.002 * peb;
	dfR = 0.96 - 0.3 * peb;
}
`;

const METAL_GLSL = /* glsl */ `
{
	vec2 p = dfPlanar( vDfWorld, dfN );
	float br = dfNoise2( vec2( p.x * 3.0, p.y * 90.0 ) );
	float blot = dfNoise2( p * 1.3 + vec2( 4.0, 2.0 ) );
	dfA = uMetalBase * ( 0.9 + 0.12 * br + 0.06 * ( blot - 0.5 ) );
	dfM = uMetalM;
	dfR = 0.36 + 0.14 * br + 0.1 * blot;
	dfEnvW = uMetalEnv;
	dfEnvF0 = 0.35;
}
`;

const PAD_GLSL = /* glsl */ `
{
	vec2 q = vDfWorld.xz - uPadCenter.xz;
	float r = length( q );
	float R = uPadRadius;
	float isTop = step( 0.6, dfN.y );
	float aa = fwidth( r ) * 0.8 + 1e-4;
	float n = dfNoise2( q * 5.0 );
	vec3 body = uPadBody * ( 0.9 + 0.14 * n );
	float grooveD = abs( fract( r / 0.32 ) - 0.5 ) * 0.32;
	float groove = ( 1.0 - smoothstep( 0.01 - aa, 0.01 + aa, grooveD ) ) * ( 1.0 - step( R - 0.55, r ) );
	float ring = smoothstep( R - 0.46 - aa, R - 0.46 + aa, r ) * ( 1.0 - smoothstep( R - 0.2 - aa, R - 0.2 + aa, r ) );
	// team mark as a SHAPE (colour-blind safe): 1 = sun-disc (dot + ring), 2 = wave-peak (triangle)
	vec2 lq = vec2( dot( q, vec2( uPadFwd.y, - uPadFwd.x ) ), dot( q, uPadFwd ) );
	float dSun = min( r - 0.2 * R, abs( r - 0.5 * R ) - 0.055 * R );
	float dTri = dfSdTri( lq - vec2( 0.0, 0.04 * R ), 0.3 * R );
	float dMark = mix( dSun, dTri, step( 1.5, uPadMark ) );
	float mark = 1.0 - smoothstep( - aa, aa, dMark );
	float pulse = 0.82 + 0.18 * sin( uDfTime * 2.2 );
	float glow = max( ring, mark ) * isTop;
	vec3 c = mix( body, body * 0.7, groove );
	c = mix( c, uPadTeam * 0.55, glow );
	// the pad itself vs other team-colour parts using the same material (a dock canopy, door trims,
	// flags — Lockwell / Cinder): away from the pad they are plain team-colour paint, never a glow
	float padNear = ( 1.0 - smoothstep( R + 0.4, R + 0.7, r ) ) * ( 1.0 - smoothstep( 0.6, 1.0, abs( vDfWorld.y - uPadCenter.y ) ) );
	float sideBand = ( 1.0 - isTop ) * smoothstep( uPadCenter.y - 0.12, uPadCenter.y - 0.09, vDfWorld.y ) * padNear;
	dfEmit = uPadTeam * ( ( ring * 2.6 * pulse + mark * 1.6 ) * isTop + sideBand * 1.8 * pulse ) * padNear;
	vec3 accent = uPadTeam * ( 0.78 + 0.08 * n );
	dfA = mix( accent, c, padNear );
	dfR = mix( 0.55, mix( 0.42, 0.3, glow ), padNear );
	dfM = 0.15 * padNear;
	dfEnvW = 0.25;
	dfEnvF0 = 0.08;
	dfH = -0.0015 * groove * padNear;
}
`;

const TRUNK_GLSL = /* glsl */ `
{
	float y = vDfWorld.y;
	float rs = y / 0.17 + dfNoise2( vDfWorld.xz * 3.0 ) * 0.4;
	float tri = abs( fract( rs ) - 0.5 );
	float aa = fwidth( rs ) + 1e-4;
	float groove = 1.0 - smoothstep( 0.08 - aa, 0.08 + aa, tri );
	float fib = dfNoise2( vec2( atan( dfN.z, dfN.x + 1e-4 ) * 6.0, y * 30.0 ) );
	dfA = uBase * ( 0.9 + 0.16 * fib ) * ( 1.0 - 0.25 * groove );
	dfR = 0.85;
	dfH = -0.004 * groove;
}
`;

const LEAF_GLSL = /* glsl */ `
{
	vec2 p = dfPlanar( vDfWorld, dfN );
	float n = dfNoise2( p * 2.5 + vec2( 3.0, 7.0 ) );
	float n2 = dfNoise2( p * 11.0 );
	vec3 c = mix( uBase, uBase * vec3( 1.12, 1.1, 0.72 ), smoothstep( 0.45, 0.85, n ) * 0.6 );
	dfA = c * ( 0.9 + 0.14 * n2 );
	dfR = 0.62;
}
`;

const SAND_GLSL = /* glsl */ `
{
	vec2 p = dfPlanar( vDfWorld, dfN );
	float n = dfNoise2( p * 0.9 );
	float fine = dfNoise2( p * 37.0 );
	float rip = sin( dot( p, vec2( 0.8, 0.6 ) ) * 7.0 + dfNoise2( p * 0.7 ) * 5.0 ) * 0.5 + 0.5;
	dfA = uBase * ( 0.92 + 0.08 * n + 0.05 * ( fine - 0.5 ) );
	dfR = 0.95;
	dfH = 0.001 * ( fine - 0.5 ) + 0.002 * rip;
}
`;

const TINT_GLSL = /* glsl */ `
{
	float n = dfFbm3( vDfWorld * uTintScale );
	dfA = uBase * ( 1.0 + uTintAmt * ( n - 0.5 ) * 2.0 );
}
`;

// ── phase 7–8 surfaces (Lockwell Works, Cinder Reef) ──────────────────────────────────────────

// Metal plate (M_steel, M_press, M_wreck_deck): plates with dark seams and a lighter worn lip, tread
// lozenges on floors (uPanTread), rivet rows along plate edges (uPanRivet), rust blooms (uPanRust).
const PANEL_GLSL = /* glsl */ `
{
	float isFloor = step( 0.6, abs( dfN.y ) );
	vec2 p = dfPlanar( vDfWorld, dfN );
	float fw = fwidth( p.x ) + fwidth( p.y );
	float detail = 1.0 - smoothstep( 0.012, 0.05, fw );
	float aa = max( fw * 0.6, 1e-4 );
	vec2 sz = mix( uPanWall, uPanFloor, isFloor );
	vec2 pc = p / sz;
	vec2 pid = floor( pc );
	vec2 pf = ( pc - pid ) * sz;
	vec2 pe2 = min( pf, sz - pf );
	float pe = min( pe2.x, pe2.y );
	float seam = ( 1.0 - smoothstep( 0.008 - aa, 0.008 + aa, pe ) ) * mix( 0.45, 1.0, detail );
	float h1 = dfHash12( pid + vec2( 3.1, 7.7 ) );
	float big = dfNoise2( p * 0.35 + vec2( 5.0, 1.0 ) );
	float mid = dfNoise2( p * 2.3 + vec2( 1.0, 9.0 ) );
	vec3 c = uPanBase * ( 0.92 + 0.1 * h1 + 0.07 * ( big - 0.5 ) + 0.04 * ( mid - 0.5 ) );
	float h = 0.0;
	// worn, lighter lip just inside every seam
	float lip = ( 1.0 - smoothstep( 0.012, 0.05, pe ) ) * ( 1.0 - seam );
	c = mix( c, min( c * 1.28 + 0.02, vec3( 1.0 ) ), lip * 0.45 * detail );
	float tread = 0.0;
	if ( uPanTread > 0.5 && isFloor > 0.5 && detail > 0.0 ) {
		vec2 q = p / 0.13;
		vec2 ci = floor( q );
		vec2 cf = q - ci - 0.5;
		vec2 r = vec2( cf.x + cf.y, cf.x - cf.y ) * 0.7071;
		r = mod( ci.x + ci.y, 2.0 ) > 0.5 ? r.yx : r;
		float e = length( vec2( r.x / 0.36, r.y / 0.09 ) );
		float taa = fwidth( e ) + 1e-3;
		tread = ( 1.0 - smoothstep( 1.0 - taa, 1.0 + taa, e ) ) * detail;
		h += 0.0012 * tread;
		c *= 1.0 + 0.1 * tread;
	}
	float riv = 0.0;
	if ( uPanRivet > 0.5 && detail > 0.0 ) {
		vec2 r1 = vec2( pe2.x - 0.055, mod( pf.y, 0.24 ) - 0.12 );
		vec2 r2 = vec2( mod( pf.x, 0.24 ) - 0.12, pe2.y - 0.055 );
		float rd = min( length( r1 ), length( r2 ) );
		riv = ( 1.0 - smoothstep( 0.013 - aa, 0.013 + aa, rd ) ) * detail;
		c = mix( c, min( c * 1.3 + 0.03, vec3( 1.0 ) ), riv * 0.8 );
		h += 0.0015 * riv;
	}
	float rust = 0.0;
	if ( uPanRust > 0.0 ) {
		float rn = dfNoise2( p * vec2( 0.8, 0.5 ) + vec2( 11.0, 3.0 ) ) * 0.6 + mid * 0.25
			+ dfNoise2( vec2( p.x * 3.5, p.y * 0.4 ) ) * 0.25 * ( 1.0 - isFloor ) + ( 1.0 - smoothstep( 0.0, 0.12, pe ) ) * 0.2;
		rust = smoothstep( 0.62 - 0.3 * uPanRust, 0.7 - 0.3 * uPanRust, rn );
		c = mix( c, uPanRustCol * ( 0.8 + 0.35 * mid ), rust );
	}
	c = mix( c, c * 0.42, seam );
	dfA = c;
	dfH = ( h - 0.002 * seam + 0.0008 * rust * ( mid - 0.5 ) ) * detail;
	dfR = clamp( uPanRough + 0.12 * ( big - 0.5 ) - 0.12 * tread + 0.35 * rust + 0.2 * seam, 0.2, 0.95 );
	dfM = uPanMetal * ( 1.0 - rust ) * ( 1.0 - seam );
	dfEnvW = uPanEnv * ( 1.0 - rust ) * ( 1.0 - seam );
	dfEnvF0 = 0.2;
}
`;

// Office walls (M_office): warm plaster with faint panel seams and a dark skirting board at every
// storey (df_floors 0 / 4.5 / 9); floors get a soft linoleum checker.
const OFFICE_GLSL = /* glsl */ `
{
	float isFloor = step( 0.6, abs( dfN.y ) );
	vec2 p = dfPlanar( vDfWorld, dfN );
	float fw = fwidth( p.x ) + fwidth( p.y );
	float detail = 1.0 - smoothstep( 0.012, 0.05, fw );
	float aa = max( fw * 0.6, 1e-4 );
	float n1 = dfNoise2( p * 1.7 + vec2( 4.0, 2.0 ) );
	float n2 = 0.5;
	if ( detail > 0.0 ) n2 = dfNoise2( p * 31.0 );
	vec3 c = uOfficeBase * ( 0.95 + 0.06 * n1 + 0.04 * ( n2 - 0.5 ) * detail );
	// wall: vertical panel seams every 1.2 m, skirting 14 cm above each storey floor
	float sx = abs( fract( p.x / 1.2 ) - 0.5 ) * 1.2;
	float seam = ( 1.0 - smoothstep( 0.004 - aa, 0.004 + aa, 0.6 - sx ) ) * ( 1.0 - isFloor ) * mix( 0.3, 0.8, detail );
	float sy = mod( vDfWorld.y + 0.02, 4.5 );
	float skirt = ( 1.0 - smoothstep( 0.14 - aa, 0.14 + aa, sy ) ) * ( 1.0 - isFloor );
	// floor: 0.5 m linoleum checker, low contrast
	vec2 ck = floor( p / 0.5 );
	float chk = mod( ck.x + ck.y, 2.0 ) * isFloor;
	c = mix( c, c * 0.9, chk * 0.6 );
	c = mix( c, c * 0.7, seam );
	c = mix( c, uOfficeSkirt, skirt );
	dfA = c;
	dfH = ( -0.0012 * seam + 0.004 * skirt ) * detail;
	dfR = mix( mix( 0.82, 0.55, isFloor ), 0.5, skirt );
}
`;

// Brick shell (M_brick): running bond with light mortar, per-brick tone, a few burnt headers.
const BRICK_GLSL = /* glsl */ `
{
	vec2 p = dfPlanar( vDfWorld, dfN );
	float fw = fwidth( p.x ) + fwidth( p.y );
	float detail = 1.0 - smoothstep( 0.01, 0.045, fw );
	float aa = max( fw * 0.6, 1e-4 );
	float W = 0.44;
	float H = 0.15;
	float row = floor( p.y / H );
	float bx = p.x / W + 0.5 * mod( row, 2.0 );
	float col = floor( bx );
	vec2 f = vec2( ( bx - col ) * W, ( p.y / H - row ) * H );
	vec2 e2 = min( f, vec2( W, H ) - f );
	float e = min( e2.x, e2.y );
	float mw = 0.011;
	float mortar = ( 1.0 - smoothstep( mw - aa, mw + aa, e ) ) * mix( 0.35, 1.0, detail );
	float hb = dfHash12( vec2( col, row ) + vec2( 17.0, 3.0 ) );
	float hb2 = dfHash12( vec2( col, row ) + vec2( 5.0, 41.0 ) );
	vec3 c = mix( uBrickA, uBrickB, hb ) * ( 0.9 + 0.12 * hb2 );
	c = mix( c, uBrickA * 0.62, step( 0.93, hb2 ) * 0.7 );
	float n = dfNoise2( p * 9.0 + hb * 13.0 );
	c *= 0.94 + 0.1 * n * detail;
	// grime drifting down from the eaves, soft
	float grime = smoothstep( 0.55, 0.85, dfNoise2( vec2( p.x * 0.7, p.y * 0.12 ) + vec2( 3.0, 1.0 ) ) );
	c *= 1.0 - 0.12 * grime;
	vec3 m = uMortar * ( 0.93 + 0.08 * n );
	dfA = mix( c, m, mortar );
	dfH = ( -0.004 * mortar + 0.0008 * ( n - 0.5 ) ) * detail;
	dfR = mix( 0.88, 0.95, mortar );
}
`;

// Basalt (M_basalt): hexagonal column tops on up-facing faces, faceted column shafts on walls.
const BASALT_GLSL = /* glsl */ `
{
	float isTop = step( 0.55, dfN.y );
	vec2 p = dfPlanar( vDfWorld, dfN );
	float fw = fwidth( p.x ) + fwidth( p.y );
	float detail = 1.0 - smoothstep( 0.012, 0.06, fw );
	float aa = max( fw * 0.8, 1e-4 );
	float n1 = dfNoise2( p * 1.1 + vec2( 7.0, 2.0 ) );
	float n2 = 0.5;
	if ( detail > 0.0 ) n2 = dfNoise2( p * 17.0 + vec2( 1.0, 5.0 ) );
	vec3 c;
	float h = 0.0;
	float crack = 0.0;
	if ( isTop > 0.5 ) {
		// hex tiling (pointy-top), cell ~0.75 m across
		vec2 q = p / 0.44;
		const vec2 s = vec2( 1.0, 1.7320508 );
		vec4 hc = floor( vec4( q, q - vec2( 0.5, 1.0 ) ) / s.xyxy ) + 0.5;
		vec4 hh = vec4( q - hc.xy * s, q - ( hc.zw + 0.5 ) * s );
		vec4 hx = dot( hh.xy, hh.xy ) < dot( hh.zw, hh.zw ) ? vec4( hh.xy, hc.xy ) : vec4( hh.zw, hc.zw + 0.5 );
		vec2 ah = abs( hx.xy );
		float ed = 0.5 - max( dot( ah, vec2( 0.5, 0.8660254 ) ), ah.x );   // 0 on the hex edge
		float cid = dfHash12( hx.zw * 1.37 + vec2( 3.0, 9.0 ) );
		float eaa = fwidth( ed ) + 1e-4;
		crack = ( 1.0 - smoothstep( 0.03 - eaa, 0.03 + eaa, ed ) ) * mix( 0.4, 1.0, detail );
		float bevel = 1.0 - smoothstep( 0.03, 0.12, ed );
		c = uBasalt * ( 0.86 + 0.26 * cid + 0.08 * ( n1 - 0.5 ) );
		c = mix( c, uBasaltEdge, bevel * 0.35 * ( 1.0 - crack ) );
		h = ( 0.004 * cid - 0.004 * crack - 0.0015 * bevel ) * detail;
	} else {
		// column shafts: vertical facets 0.5 m wide with a fake cylindrical shade, horizontal breaks
		float fx = p.x / 0.5;
		float fid = floor( fx );
		float ff = fx - fid;
		float fh = dfHash12( vec2( fid, 11.0 ) );
		float shade = 0.82 + 0.3 * fh + 0.12 * sin( ff * 3.14159 );
		float by = ( p.y + fh * 3.0 ) / ( 0.9 + 0.8 * fh );
		float bf = abs( fract( by ) - 0.5 );
		float baa = fwidth( by ) + 1e-4;
		float brk = 1.0 - smoothstep( 0.47 - baa, 0.47 + baa, bf );
		float faa = fwidth( fx ) + 1e-4;
		float edge = 1.0 - smoothstep( 0.04 - faa, 0.04 + faa, min( ff, 1.0 - ff ) );
		crack = max( brk, edge ) * mix( 0.4, 1.0, detail );
		c = uBasalt * shade * ( 0.94 + 0.1 * n1 );
		h = -0.004 * crack * detail;
	}
	c *= 0.95 + 0.1 * ( n2 - 0.5 ) * detail;
	// pale salt / lichen specks, a few
	float speck = smoothstep( 0.8, 0.86, n2 ) * detail;
	c = mix( c, uBasaltEdge * 1.15, speck * 0.4 );
	dfA = mix( c, c * 0.45, crack );
	dfH = h;
	dfR = mix( 0.8, 0.95, crack ) - 0.06 * speck;
}
`;

// Wet sand (M_wetsand): warm sand, wind ripples, damp patches (darker + glossier), shell specks.
const WETSAND_GLSL = /* glsl */ `
{
	vec2 p = dfPlanar( vDfWorld, dfN );
	float fw = fwidth( p.x ) + fwidth( p.y );
	float detail = 1.0 - smoothstep( 0.01, 0.05, fw );
	float big = dfNoise2( p * 0.18 + vec2( 3.0, 8.0 ) );
	float mid = dfNoise2( p * 0.9 + vec2( 2.0, 1.0 ) );
	float fine = 0.5;
	float spk = 0.0;
	if ( detail > 0.0 ) {
		fine = dfNoise2( p * 37.0 );
		spk = smoothstep( 0.86, 0.9, dfNoise2( p * 23.0 + vec2( 5.0, 3.0 ) ) ) * detail;
	}
	float warp = dfNoise2( p * 0.35 ) * 4.0;
	float rip = sin( dot( p, vec2( 0.55, 0.83 ) ) * 6.5 + warp ) * 0.5 + 0.5;
	float ripFade = 1.0 - smoothstep( 0.03, 0.12, fw );
	float damp = smoothstep( 0.52, 0.72, big * 0.7 + mid * 0.3 ) * 0.8;
	// the lower the sand, the damper (the tidal band below is M_shallows)
	damp = max( damp, 1.0 - smoothstep( uTideY + 0.3, uTideY + 1.3, vDfWorld.y ) );
	vec3 c = uSand * ( 0.93 + 0.08 * mid + 0.05 * ( fine - 0.5 ) * detail + 0.04 * ( rip - 0.5 ) * ripFade );
	c = mix( c, c * vec3( 0.83, 0.81, 0.8 ), damp );
	c = mix( c, vec3( 0.97, 0.94, 0.88 ), spk * 0.55 );
	dfA = c;
	dfH = ( 0.0022 * ( rip - 0.5 ) * ripFade + 0.0006 * ( fine - 0.5 ) * detail );
	dfR = mix( 0.9, 0.55, damp ) - 0.1 * spk;
	dfEnvW = 0.25 * damp;
	dfEnvF0 = 0.03;
}
`;

// Tidal band + sandbars (M_shallows): wet, glossy sand under a thin film of shallow-water tint
// (SURFACE_ENV uDfWater) that thickens toward the waterline, with slow ripples and a foam lace.
const SHALLOWS_GLSL = /* glsl */ `
{
	vec2 p = dfPlanar( vDfWorld, dfN );
	float fw = fwidth( p.x ) + fwidth( p.y );
	float detail = 1.0 - smoothstep( 0.01, 0.05, fw );
	float t = uDfTime;
	float mid = dfNoise2( p * 0.9 + vec2( 2.0, 1.0 ) );
	float fine = 0.5;
	if ( detail > 0.0 ) fine = dfNoise2( p * 29.0 );
	float above = vDfWorld.y - uTideY;                                  // metres above the waterline
	float film = 1.0 - smoothstep( 0.0, uTideBand, above );             // 1 at the water, 0 at the band top
	float rip = dfNoise2( p * 1.6 + vec2( t * 0.25, - t * 0.19 ) ) + dfNoise2( p * 3.3 - vec2( t * 0.31, t * 0.23 ) ) * 0.5;
	vec3 c = uSand * ( 0.92 + 0.1 * mid + 0.05 * ( fine - 0.5 ) * detail );
	c = mix( c, c * 0.84, 0.5 );                                        // wet sand is darker
	c = mix( c, uDfWater * 0.85, film * 0.42 + 0.08 );
	// foam lace riding the waterline
	float lace = smoothstep( 0.55, 0.75, dfNoise2( p * 3.4 + vec2( - t * 0.33, t * 0.27 ) ) * 0.6 + ( 1.0 - smoothstep( 0.0, 0.1, above ) ) * 0.6 );
	c = mix( c, vec3( 0.96, 0.98, 0.97 ), lace * 0.7 * ( 1.0 - smoothstep( 0.0, 0.14, above ) ) );
	dfA = c;
	dfH = ( 0.0012 * ( rip - 0.75 ) * film + 0.0004 * ( fine - 0.5 ) ) * detail;
	dfR = mix( 0.42, 0.12, film );
	dfEnvW = 0.45 + 0.5 * film;
	dfEnvF0 = 0.04;
}
`;

// Planks (M_plank): weathered boards laid ACROSS each bridge's long axis (vDfAxis: 1 when that
// structure is longer in world X; mapview writes the per-vertex attribute), nail heads, gaps.
const PLANK_VERT_PARS = /* glsl */ `
attribute float dfAxis;
varying float vDfAxis;
`;
const PLANK_VERT_MAIN = /* glsl */ `
	vDfAxis = dfAxis;
`;
const PLANK_GLSL = /* glsl */ `
{
	float isFloor = step( 0.6, abs( dfN.y ) );
	vec2 wp = dfPlanar( vDfWorld, dfN );
	// floors: (across-board coordinate, along-board coordinate); boards run perpendicular to the long axis
	vec2 fp = mix( vec2( vDfWorld.z, vDfWorld.x ), vec2( vDfWorld.x, vDfWorld.z ), step( 0.5, vDfAxis ) );
	vec2 p = mix( vec2( wp.y, wp.x ), fp, isFloor );
	float fw = fwidth( p.x ) + fwidth( p.y );
	float detail = 1.0 - smoothstep( 0.012, 0.06, fw );
	float W = 0.3;
	float ac = p.x / W;
	float idx = floor( ac );
	float fa = ac - idx;
	float L = 2.7;
	float off = dfHash12( vec2( idx, 4.0 ) ) * L;
	float al = ( p.y + off ) / L;
	float seg = floor( al );
	float fl = al - seg;
	float id = dfHash12( vec2( idx, seg ) + 9.0 );
	float dA = min( fa, 1.0 - fa ) * W;
	float dL = min( fl, 1.0 - fl ) * L;
	float aa = max( fw * 0.6, 1e-4 );
	float gap = 1.0 - smoothstep( 0.012 - aa, 0.012 + aa, dA );
	float butt = 1.0 - smoothstep( 0.005 - aa, 0.005 + aa, dL );
	float g = max( gap, butt ) * mix( 0.5, 1.0, detail );
	float grain = dfNoise2( vec2( p.x * 40.0 + id * 13.0, p.y * 2.2 ) );
	float grain2 = 0.5;
	if ( detail > 0.0 ) grain2 = dfNoise2( vec2( p.x * 120.0 + id * 3.0, p.y * 7.0 ) );
	vec3 wood = mix( uPlankA, uPlankB, id ) * ( 0.88 + 0.16 * grain + 0.07 * ( grain2 - 0.5 ) * detail );
	// weathering: silvered board ends
	float wx = smoothstep( 0.55, 0.85, dfNoise2( p * vec2( 3.0, 0.8 ) + id * 7.0 ) );
	wood = mix( wood, uPlankGrey, wx * 0.35 );
	// two nail heads near each board end
	vec2 nq = vec2( abs( fa - 0.5 ) * W - 0.08, min( fl, 1.0 - fl ) * L - 0.06 );
	float nail = ( 1.0 - smoothstep( 0.011 - aa, 0.011 + aa, length( nq ) ) ) * isFloor * detail;
	wood = mix( wood, vec3( 0.28, 0.26, 0.25 ), nail * 0.8 );
	float edge = 1.0 - smoothstep( 0.0, 0.03, min( dA, dL ) );
	wood *= 1.0 - 0.12 * edge;
	dfA = mix( wood, uPlankGap, g );
	dfH = ( -0.003 * g - 0.001 * edge + 0.0005 * ( grain - 0.5 ) + 0.0006 * nail ) * detail;
	dfR = mix( 0.78 + 0.1 * grain, 0.95, g );
}
`;

// Wreck hull (M_wreck): riveted strakes; teal hull paint below a cream band, oxide-red topsides,
// flaked to rust with pale chipped rims and vertical rust runs.
const WRECK_GLSL = /* glsl */ `
{
	vec2 p = dfPlanar( vDfWorld, dfN );
	float fw = fwidth( p.x ) + fwidth( p.y );
	float detail = 1.0 - smoothstep( 0.012, 0.05, fw );
	float aa = max( fw * 0.6, 1e-4 );
	vec2 sz = vec2( 2.4, 1.05 );
	vec2 pc = p / sz;
	vec2 pid = floor( pc );
	vec2 pf = ( pc - pid ) * sz;
	vec2 pe2 = min( pf, sz - pf );
	float pe = min( pe2.x, pe2.y );
	float seam = ( 1.0 - smoothstep( 0.01 - aa, 0.01 + aa, pe ) ) * mix( 0.45, 1.0, detail );
	float y = vDfWorld.y;
	float band = step( uWreckBandY, y ) * step( y, uWreckBandY + 0.38 );
	vec3 paintC = mix( uWreckLow, uWreckHigh, step( uWreckBandY + 0.38, y ) );
	paintC = mix( paintC, uWreckBand, band );
	float n1 = dfNoise2( p * vec2( 0.8, 0.55 ) + vec2( 2.0, 7.0 ) );
	float n2 = dfNoise2( p * 3.1 + vec2( 9.0, 1.0 ) );
	float runs = dfNoise2( vec2( p.x * 3.2, p.y * 0.3 ) + vec2( 4.0, 0.0 ) );
	float flake = n1 * 0.62 + n2 * 0.22 + runs * 0.28 + ( 1.0 - smoothstep( 0.0, 0.15, pe ) ) * 0.12;
	float bare = smoothstep( 0.6, 0.62, flake );
	float rim = smoothstep( 0.57, 0.6, flake ) * ( 1.0 - bare );
	vec3 rustC = uWreckRust * ( 0.78 + 0.3 * n2 + 0.18 * runs );
	vec3 c = mix( paintC * ( 0.93 + 0.1 * n2 ), rustC, bare );
	c = mix( c, min( c * 1.35 + 0.05, vec3( 1.0 ) ), rim * 0.6 );
	// rust runs bleeding down from the seams over the paint
	float bleed = smoothstep( 0.6, 0.8, runs ) * ( 1.0 - bare ) * ( 1.0 - step( 0.6, abs( dfN.y ) ) );
	c = mix( c, rustC, bleed * 0.35 );
	vec2 r1 = vec2( pe2.x - 0.06, mod( pf.y, 0.2 ) - 0.1 );
	vec2 r2 = vec2( mod( pf.x, 0.2 ) - 0.1, pe2.y - 0.06 );
	float riv = ( 1.0 - smoothstep( 0.014 - aa, 0.014 + aa, min( length( r1 ), length( r2 ) ) ) ) * detail;
	c = mix( c, c * 1.25, riv * 0.6 );
	c = mix( c, c * 0.45, seam );
	dfA = c;
	dfH = ( -0.0025 * seam + 0.0012 * riv - 0.0008 * bare + 0.0004 * rim ) * detail;
	dfR = mix( 0.52, 0.9, bare );
	dfM = mix( 0.12, 0.3, bare * 0.3 );
}
`;

// Coral rock (M_coral_rock): porous pink rock with pits and pale bumps.
const CORAL_GLSL = /* glsl */ `
{
	vec3 w = vDfWorld;
	float n = dfFbm3( w * 1.3 );
	float pit = smoothstep( 0.62, 0.72, dfNoise3( w * 9.0 + vec3( 3.0, 1.0, 7.0 ) ) );
	float bump = smoothstep( 0.6, 0.75, dfNoise3( w * 4.0 + vec3( 9.0, 2.0, 5.0 ) ) );
	vec3 c = uBase * ( 0.9 + 0.2 * n );
	c = mix( c, c * 0.55, pit * 0.8 );
	c = mix( c, min( c * 1.25 + 0.04, vec3( 1.0 ) ), bump * 0.5 );
	dfA = c;
	dfH = -0.004 * pit + 0.003 * bump;
	dfR = 0.9;
}
`;

// Conveyor belt (M_belt): rubber belt with cleats and hazard chevrons that SCROLL along the belt at
// its df_conveyor speed (uBeltDir = unit world direction of travel, uBeltSpeed m/s); rails on the sides.
const BELT_GLSL = /* glsl */ `
{
	float isTop = step( 0.35, dfN.y );
	vec3 dir = uBeltDir;
	vec3 side = normalize( vec3( - dir.z, 0.0, dir.x ) + vec3( 1e-5, 0.0, 0.0 ) );
	vec3 rel = vDfWorld - uBeltCenter;
	float along = dot( rel, dir ) - uDfTime * uBeltSpeed;
	float across = dot( rel, side );
	float fw = fwidth( along ) + fwidth( across );
	float detail = 1.0 - smoothstep( 0.015, 0.06, fw );
	float aa = max( fw * 0.6, 1e-4 );
	// cleats every 0.42 m
	float cq = abs( fract( along / 0.42 ) - 0.5 ) * 0.42;
	float cleat = ( 1.0 - smoothstep( 0.035 - aa, 0.035 + aa, cq ) ) * isTop;
	// chevrons pointing downstream (tip on the centre line, ahead), every 2.1 m
	float bHalf = max( uBeltHalf, 0.2 );
	float ax = abs( across ) / bHalf;
	float cs = fract( ( along + ax * 0.9 ) / 2.1 );
	float chev = ( 1.0 - smoothstep( 0.16 - aa, 0.16 + aa, abs( cs - 0.2 ) * 2.1 ) ) * step( ax, 0.78 ) * isTop;
	// rail stripe along both edges
	float rail = smoothstep( bHalf - 0.2 - aa, bHalf - 0.2 + aa, abs( across ) ) * isTop;
	float n = dfNoise2( vec2( along * 3.0, across * 9.0 ) );
	vec3 c = uBeltRubber * ( 0.9 + 0.14 * n );
	c = mix( c, uBeltCleat, cleat );
	c = mix( c, uBeltChev, chev * 0.92 );
	c = mix( c, uBeltRail, rail );
	// sides of the belt: rubber skirt with a hazard band
	float sideBand = ( 1.0 - isTop ) * step( 0.5, fract( ( vDfWorld.x + vDfWorld.z + vDfWorld.y ) / 0.5 ) );
	c = mix( c, uBeltChev * 0.8, sideBand * 0.6 );
	dfA = c;
	dfH = ( 0.004 * cleat + 0.0006 * chev ) * detail;
	dfR = mix( 0.86, 0.6, max( chev, rail ) );
}
`;

// Grate (M_grate): an alpha-tested steel bar grid (cells uGrateCell, bars uGrateBar); dye and shots
// fall through the holes. Far away (cells under ~3 px) it turns into a solid, darker mesh plate so
// it never shimmers or vanishes. The shadow pass discards the same holes (grateDepthMaterial).
const GRATE_FN_GLSL = /* glsl */ `
// 1 on a bar, 0 in a hole (AA'd); p in metres on the grate plane
float dfGrateMask( vec2 p, float cell, float bar ) {
	vec2 q = abs( fract( p / cell ) - 0.5 ) * cell;          // distance from the cell centre
	vec2 w = fwidth( p ) * 0.7 + 1e-4;
	vec2 b = smoothstep( 0.5 * cell - 0.5 * bar - w, 0.5 * cell - 0.5 * bar + w, q );
	float m = max( b.x, b.y );
	// fade to solid once a cell is under ~3 px
	float far = smoothstep( 0.25, 0.45, max( w.x, w.y ) / cell );
	return mix( m, 1.0, far );
}
`;
const GRATE_GLSL = /* glsl */ `
{
	vec2 p = dfPlanar( vDfWorld, dfN );
	float m = dfGrateMask( p, uGrateCell, uGrateBar );
	float fwp = fwidth( p.x ) + fwidth( p.y );
	float far = smoothstep( 0.25, 0.45, fwp / uGrateCell );
	float n = dfNoise2( p * 3.0 );
	vec3 c = uGrateSteel * ( 0.9 + 0.14 * n );
	// bar tops catch light: slightly lighter centre line of each bar
	c = mix( c, uGrateSteel * 0.55, far * 0.5 );
	diffuseColor.a = m;
	dfA = c;
	dfR = 0.5;
	dfM = 0.45;
	dfEnvW = 0.35;
	dfEnvF0 = 0.2;
}
`;

// Tide-spring pad (M_spring): team-neutral aqua glow, rings pulsing outward from the pad centre,
// a bright core and a darker coral-rimmed body.
const SPRING_GLSL = /* glsl */ `
{
	vec2 q = vDfWorld.xz - uSpringCenter.xz;
	float r = length( q ) / max( uSpringR, 0.1 );
	float isTop = step( 0.5, dfN.y );
	float aa = fwidth( r ) * 0.8 + 1e-4;
	float t = uDfTime;
	float pulse = 0.5 + 0.5 * sin( t * 3.1 );
	// three rings travelling outward
	float wave = fract( r * 1.6 - t * 0.9 );
	float ring = ( 1.0 - smoothstep( 0.1 - aa * 1.6, 0.1 + aa * 1.6, abs( wave - 0.5 ) ) ) * ( 1.0 - smoothstep( 0.8, 1.0, r ) );
	float core = 1.0 - smoothstep( 0.18 - aa, 0.24 + aa, r );
	float lip = smoothstep( 0.82 - aa, 0.86 + aa, r ) * ( 1.0 - smoothstep( 0.95 - aa, 0.99 + aa, r ) );
	vec3 body = uSpringBody * ( 0.9 + 0.1 * dfNoise2( q * 6.0 ) );
	vec3 c = mix( body, uSpringGlow * 0.7, max( ring * 0.8, core ) * isTop );
	c = mix( c, uSpringGlow * 0.5, lip * isTop );
	dfA = c;
	dfEmit = uSpringGlow * ( ( core * ( 1.4 + 1.2 * pulse ) + ring * ( 1.1 + 0.6 * pulse ) + lip * 0.8 ) * isTop
		+ ( 1.0 - isTop ) * 0.35 * pulse );
	dfR = 0.3;
	dfEnvW = 0.3;
	dfEnvF0 = 0.06;
}
`;

// Fluorescent strip tube (M_strip): a hot emissive tube in the preset's strip colour (uDfStrip).
const STRIP_GLSL = /* glsl */ `
{
	dfA = vec3( 0.95 );
	dfEmit = uDfStrip * uStripGain;
	dfR = 0.3;
}
`;

// Skylight / clerestory panes (M_skylight): dim overcast glow (uDfWindow) with slow cloud drift, a
// brighter top, glazing-bar shadow lines.
const SKYLIGHT_GLSL = /* glsl */ `
{
	vec2 p = dfPlanar( vDfWorld, dfN );
	float t = uDfTime;
	float cl = dfNoise2( p * 0.12 + vec2( t * 0.012, t * 0.004 ) ) * 0.65 + dfNoise2( p * 0.37 - vec2( t * 0.02, 0.0 ) ) * 0.35;
	float streak = smoothstep( 0.6, 0.9, dfNoise2( vec2( p.x * 7.0, p.y * 0.25 + t * 0.05 ) ) );
	vec3 g = uDfWindow * ( 0.78 + 0.4 * cl ) * ( 1.0 - 0.18 * streak );
	dfA = g * 0.6;
	dfEmit = g * uWindowGain;
	dfR = 0.15;
}
`;

// ── recipes ──────────────────────────────────────────────────────────────────────────────────

function tileMaterial(name: string, fallback: THREE.Material | null, o: SurfaceOptions): THREE.MeshStandardMaterial {
  const m = makeMaterial(name, fallback, 0.7);
  const cl = o.courtLines;
  const u = {
    uTileA: U(col(PALETTE.tileA)), uTileB: U(col(PALETTE.tileB)), uTileGrout: U(col(PALETTE.grout)),
    uCourtOn: U(cl ? 1 : 0),
    uCourtCenter: U(new THREE.Vector2(0, 0)),
    uCourtRadius: U(cl ? cl.centerCircleRadius : 10),
    uCourtMidZ: U(cl ? cl.midLineZ : 0),
    uCourtWidth: U(cl ? cl.width : 0.14),
    uCourtY: U(0),
    uCourtColor: U(col(cl ? cl.color : '#F4F1E8')),
  };
  installPatch(m, surfacePatch('tile', u, TILE_GLSL));
  return m;
}

function simple(kind: string, glsl: string, name: string, fallback: THREE.Material | null, u: Record<string, THREE.IUniform>, roughness = 0.8, metalness = 0): THREE.MeshStandardMaterial {
  const m = makeMaterial(name, fallback, roughness, metalness);
  installPatch(m, surfacePatch(kind, u, glsl));
  return m;
}

interface PadInfo { center: THREE.Vector3; radius: number; fwd: THREE.Vector2 }

function padInfo(mapId: string, side: 'A' | 'B'): PadInfo {
  const out: PadInfo = { center: new THREE.Vector3(0, 1.2, side === 'A' ? -38.5 : 38.5), radius: 2.2, fwd: new THREE.Vector2(0, side === 'A' ? 1 : -1) };
  let def: MapDef | null = null;
  try { def = mapById(mapId); } catch { def = null; }
  const sp = def?.spawns?.[side];
  if (sp) {
    out.center.set(sp.pos[0], sp.pos[1], sp.pos[2]);
    const yaw = THREE.MathUtils.degToRad(sp.yaw);
    out.fwd.set(Math.sin(yaw), Math.cos(yaw));
  }
  const brushes = (def?.brushes ?? []) as Array<Record<string, unknown>>;
  const pad = brushes.find((b) => b.kind === 'spawnpad' && typeof b.radius === 'number');
  if (pad) out.radius = pad.radius as number;
  // layout-file maps (Lockwell, Cinder) carry the pad radius on the spawn itself
  const pr = (sp as { padRadius?: number } | undefined)?.padRadius;
  if (typeof pr === 'number' && pr > 0) out.radius = pr;
  return out;
}

// ── phase 7–8 recipes ────────────────────────────────────────────────────────────────────────

interface PanelLook {
  base: string | THREE.Color; wall: [number, number]; floor: [number, number];
  tread?: boolean; rivet?: boolean; rust?: number; rustCol?: string; metal: number; rough: number; env: number;
}

function panelMaterial(name: string, fallback: THREE.Material | null, l: PanelLook): THREE.MeshStandardMaterial {
  return simple('panel', PANEL_GLSL, name, fallback, {
    uPanBase: U(typeof l.base === 'string' ? col(l.base) : l.base),
    uPanWall: U(new THREE.Vector2(l.wall[0], l.wall[1])),
    uPanFloor: U(new THREE.Vector2(l.floor[0], l.floor[1])),
    uPanTread: U(l.tread ? 1 : 0),
    uPanRivet: U(l.rivet ? 1 : 0),
    uPanRust: U(l.rust ?? 0),
    uPanRustCol: U(col(l.rustCol ?? '#8C4A2F')),
    uPanMetal: U(l.metal), uPanRough: U(l.rough), uPanEnv: U(l.env),
  }, l.rough, l.metal);
}

/** the map's water level (tidal film / damp sand), from data/maps.json */
function waterYOf(mapId: string): number {
  try { return mapById(mapId).waterY ?? -1.4; } catch { return -1.4; }
}

function plankMaterial(name: string, fallback: THREE.Material | null): THREE.MeshStandardMaterial {
  const m = makeMaterial(name, fallback, 0.82);
  const u = {
    uPlankA: U(col(PALETTE.plankA)), uPlankB: U(col(PALETTE.plankB)),
    uPlankGrey: U(col(PALETTE.plankGrey)), uPlankGap: U(col(PALETTE.plankGap)),
  };
  installPatch(m, {
    key: 's:plank', group: 'surface', order: 0, uniforms: u,
    vertPars: PLANK_VERT_PARS, vertMain: PLANK_VERT_MAIN,
    frag: { pars: uniformDecls(u) + 'varying float vDfAxis;\n', albedo: PLANK_GLSL },
  });
  return m;
}

/** Grate cell / bar size (m) — the visible grid and the shadow-pass discard use the same numbers. */
export const GRATE = { cell: 0.2, bar: 0.045 } as const;

/** M_grate: alpha-tested steel bar grid (CONTRACT_P6_11 §19). Not paintable; never dyed. */
export function grateMaterial(name: string, fallback: THREE.Material | null): THREE.MeshStandardMaterial {
  const m = makeMaterial(name, fallback, 0.5, 0.45);
  m.side = THREE.DoubleSide;
  m.transparent = false;
  m.alphaTest = 0.5;
  m.alphaToCoverage = true;          // MSAA-smoothed bar edges on top of the test
  const u = { uGrateSteel: U(col(PALETTE.grate)), uGrateCell: U(GRATE.cell), uGrateBar: U(GRATE.bar) };
  installPatch(m, {
    key: 's:grate', group: 'surface', order: 0, uniforms: u,
    frag: { pars: uniformDecls(u) + GRATE_FN_GLSL, albedo: GRATE_GLSL },
  });
  return m;
}

/** Shadow-pass material for grate meshes (mesh.customDepthMaterial): discards the same holes. */
export function grateDepthMaterial(): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.name = 'df_grate_depth';
  m.side = THREE.DoubleSide;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrateCell = { value: GRATE.cell };
    sh.uniforms.uGrateBar = { value: GRATE.bar };
    sh.vertexShader = inject(sh.vertexShader, '#include <common>', 'after', 'varying vec3 vDfGw;\nvarying vec3 vDfGn;', 'grate depth vertex');
    sh.vertexShader = inject(sh.vertexShader, '#include <project_vertex>', 'after',
      'vDfGw = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvDfGn = normalize( mat3( modelMatrix ) * normal );', 'grate depth vertex');
    sh.fragmentShader = inject(sh.fragmentShader, '#include <common>', 'after',
      `varying vec3 vDfGw;\nvarying vec3 vDfGn;\nuniform float uGrateCell;\nuniform float uGrateBar;\n${GRATE_FN_GLSL}
vec2 dfGPlanar( vec3 w, vec3 n ) {
	if ( abs( n.y ) > 0.6 ) return w.xz;
	vec3 t = normalize( vec3( n.z, 0.0, - n.x ) + vec3( 1e-5, 0.0, 0.0 ) );
	return vec2( dot( w, t ), w.y );
}`, 'grate depth fragment');
    sh.fragmentShader = inject(sh.fragmentShader, '#include <clipping_planes_fragment>', 'after',
      'if ( dfGrateMask( dfGPlanar( vDfGw, normalize( vDfGn ) ), uGrateCell, uGrateBar ) < 0.5 ) discard;', 'grate depth fragment');
  };
  m.customProgramCacheKey = () => 'df|grate-depth';
  return m;
}

export interface BeltInfo { dir: THREE.Vector3; speed: number; center: THREE.Vector3; halfWidth: number }

/** M_belt on one conveyor_ mesh: its own uniforms (direction, speed, centre), scrolling along df_conveyor. */
export function beltMaterial(name: string, fallback: THREE.Material | null, b: BeltInfo): THREE.MeshStandardMaterial {
  return simple('belt', BELT_GLSL, name, fallback, {
    uBeltDir: U(b.dir.clone().normalize()), uBeltSpeed: U(b.speed), uBeltCenter: U(b.center.clone()), uBeltHalf: U(b.halfWidth),
    uBeltRubber: U(col(PALETTE.beltRubber)), uBeltCleat: U(col(PALETTE.beltCleat)),
    uBeltChev: U(col(PALETTE.hazYellow)), uBeltRail: U(col(PALETTE.beltRail)),
  }, 0.86);
}

export interface SpringInfo { center: THREE.Vector3; radius: number }

/** M_spring on one spring_ pad: pulsing team-neutral glow centred on that pad. */
export function springMaterial(name: string, fallback: THREE.Material | null, s: SpringInfo): THREE.MeshStandardMaterial {
  return simple('spring', SPRING_GLSL, name, fallback, {
    uSpringCenter: U(s.center.clone()), uSpringR: U(s.radius),
    uSpringGlow: U(col(PALETTE.springGlow)), uSpringBody: U(col(PALETTE.springBody)),
  }, 0.3);
}

function padMaterial(name: string, fallback: THREE.Material | null, o: SurfaceOptions, side: 'A' | 'B'): THREE.MeshStandardMaterial {
  const team = teamById(side === 'A' ? 1 : 2);
  const info = padInfo(o.mapId, side);
  const u = {
    uPadCenter: U(info.center), uPadRadius: U(info.radius), uPadFwd: U(info.fwd),
    uPadBody: U(col(PALETTE.padBody)), uPadTeam: U(col(team.dye)), uPadMark: U(side === 'A' ? 1 : 2),
  };
  return simple('pad', PAD_GLSL, name, fallback, u, 0.42, 0.15);
}

/**
 * Stylized replacement for an exported M_* material. `fallback` is the GLTFLoader material: its
 * base colour drives the exported-colour recipes, and unknown names return a copy of it.
 * Returns a NEW material per call (cache per name — and per dyed/undyed — in the caller).
 */
export function materialFor(name: string, fallback: THREE.Material | null, o: SurfaceOptions): THREE.MeshStandardMaterial {
  const key = baseName(name);
  const exp = (def: string) => ({ uBase: U(fallbackColor(fallback, def)) });
  switch (key) {
    case 'M_tile':
      return tileMaterial(key, fallback, o);
    case 'M_concrete':
      return simple('concrete', CONCRETE_GLSL, key, fallback, { uConcBase: U(col(PALETTE.concrete)) });
    case 'M_boardwalk':
      return simple('boardwalk', BOARDWALK_GLSL, key, fallback, {
        uWoodA: U(col(PALETTE.woodA)), uWoodB: U(col(PALETTE.woodB)), uWoodGap: U(col(PALETTE.woodGap)),
        uPlankAlongX: U(0), // Pier 18 decks run along Z
      });
    case 'M_crate':
      return simple('crate', CRATE_GLSL, key, fallback, {
        uCrateA: U(col(PALETTE.crateA)), uCrateB: U(col(PALETTE.crateB)),
        uCrateWood: U(col(PALETTE.crateWood)), uCrateGap: U(col(PALETTE.crateGap)),
      });
    case 'M_chevron':
      return simple('chevron', CHEVRON_GLSL, key, fallback, {
        uChevBase: U(col(PALETTE.chevBase)), uChevStripe: U(col(PALETTE.chevStripe)),
        uChevH: U(1.1), uChevSlope: U(0.9), uChevPeriod: U(0.62),
      }, 0.6);
    case 'M_hazard':
      return simple('hazard', HAZARD_GLSL, key, fallback, {
        uHazYellow: U(col(PALETTE.hazYellow)), uHazDark: U(col(PALETTE.hazDark)), uHazWorn: U(col(PALETTE.hazWorn)),
      }, 0.55);
    case 'M_planter':
      return simple('planter', PLANTER_GLSL, key, fallback, {
        uPlantSlat: U(col(PALETTE.plantSlat)), uPlantRim: U(col(PALETTE.plantRim)), uPlantGap: U(col(PALETTE.plantGap)),
      });
    case 'M_soil':
      return simple('soil', SOIL_GLSL, key, fallback, { uSoil: U(col(PALETTE.soil)), uPebble: U(col(PALETTE.pebble)) }, 0.95);
    case 'M_metal':
      // posts, bollards, rails, grates: the exported (painted) colour with a brushed sheen
      return simple('metal', METAL_GLSL, key, fallback, { uMetalBase: U(fallbackColor(fallback, PALETTE.metal)), uMetalM: U(0.3), uMetalEnv: U(0.7) }, 0.4, 0.3);
    case 'M_pad_A':
      return padMaterial(key, fallback, o, 'A');
    case 'M_pad_B':
      return padMaterial(key, fallback, o, 'B');
    case 'M_palm_trunk':
      return simple('trunk', TRUNK_GLSL, key, fallback, exp('#9A7650'), 0.85);
    case 'M_palm_leaf':
    case 'M_foliage':
      return simple('leaf', LEAF_GLSL, key, fallback, exp('#3E9E4A'), 0.62);
    case 'M_sand':
      return simple('sand', SAND_GLSL, key, fallback, exp('#E8D5A8'), 0.95);
    case 'M_rock':
    case 'M_island':
      return simple('tint', TINT_GLSL, key, fallback, { ...exp('#8C8A84'), uTintScale: U(1.4), uTintAmt: U(0.16) }, 0.9);
    case 'M_crane':
    case 'M_hull':
    case 'M_rope':
    case 'M_paint_trim':
      return simple('tint', TINT_GLSL, key, fallback, { ...exp('#B0B0B0'), uTintScale: U(0.8), uTintAmt: U(0.06) },
        isStd(fallback) ? Math.max(0.55, fallback.roughness) : 0.7, isStd(fallback) ? fallback.metalness : 0);
    // ── Lockwell Works ──
    case 'M_steel':
      // steel plate: tread lozenges on floors, riveted 1.25 × 2.25 m wall panels
      return panelMaterial(key, fallback, { base: PALETTE.steel, wall: [1.25, 2.25], floor: [1.5, 1.5], tread: true, rivet: true, metal: 0.35, rough: 0.42, env: 0.45 });
    case 'M_press':
      // painted machine housings: big bolted panels, a satin finish
      return panelMaterial(key, fallback, { base: PALETTE.press, wall: [1.1, 1.1], floor: [1.1, 1.1], rivet: true, metal: 0.08, rough: 0.46, env: 0.3 });
    case 'M_dock':
      // loading-dock slab: cool, smooth concrete
      return simple('concrete', CONCRETE_GLSL, key, fallback, { uConcBase: U(col(PALETTE.dock)) });
    case 'M_office':
      return simple('office', OFFICE_GLSL, key, fallback, { uOfficeBase: U(col(PALETTE.office)), uOfficeSkirt: U(col(PALETTE.officeSkirt)) }, 0.8);
    case 'M_brick':
      return simple('brick', BRICK_GLSL, key, fallback, {
        uBrickA: U(col(PALETTE.brickA)), uBrickB: U(col(PALETTE.brickB)), uMortar: U(col(PALETTE.mortar)),
      }, 0.9);
    case 'M_belt':
      // a conveyor_ mesh normally gets beltMaterial() with its own direction; this is the static look
      return beltMaterial(key, fallback, { dir: new THREE.Vector3(0, 0, 1), speed: 0, center: new THREE.Vector3(), halfWidth: 1.5 });
    case 'M_grate':
      return grateMaterial(key, fallback);
    case 'M_strip': {
      const m = simple('strip', STRIP_GLSL, key, fallback, { uStripGain: U(3.2) }, 0.3);
      m.emissive.set(0x000000);
      m.emissiveMap = null;
      return m;
    }
    case 'M_skylight': {
      const m = simple('skylight', SKYLIGHT_GLSL, key, fallback, { uWindowGain: U(1.35) }, 0.15);
      m.emissive.set(0x000000);
      return m;
    }
    // ── Cinder Reef ──
    case 'M_wetsand':
      return simple('wetsand', WETSAND_GLSL, key, fallback, { uSand: U(col(PALETTE.wetsand)), uTideY: U(waterYOf(o.mapId)) }, 0.88);
    case 'M_shallows':
      return simple('shallows', SHALLOWS_GLSL, key, fallback, {
        uSand: U(col(PALETTE.shallows)), uTideY: U(waterYOf(o.mapId)), uTideBand: U(0.38),
      }, 0.35);
    case 'M_basalt':
    case 'M_cliff':
      return simple('basalt', BASALT_GLSL, key, fallback, { uBasalt: U(col(PALETTE.basalt)), uBasaltEdge: U(col(PALETTE.basaltEdge)) }, 0.85);
    case 'M_plank':
      return plankMaterial(key, fallback);
    case 'M_wreck':
      return simple('wreck', WRECK_GLSL, key, fallback, {
        uWreckLow: U(col(PALETTE.wreckLow)), uWreckBand: U(col(PALETTE.wreckBand)), uWreckHigh: U(col(PALETTE.wreckHigh)),
        uWreckRust: U(col(PALETTE.wreckRust)), uWreckBandY: U(3.1),
      }, 0.6, 0.12);
    case 'M_wreck_deck':
      return panelMaterial(key, fallback, { base: PALETTE.wreckDeck, wall: [1.2, 1.2], floor: [1.2, 2.4], tread: true, rivet: true, rust: 0.45, rustCol: PALETTE.wreckRust, metal: 0.3, rough: 0.5, env: 0.35 });
    case 'M_coral_rock':
      return simple('coral', CORAL_GLSL, key, fallback, { uBase: U(col(PALETTE.coral)) }, 0.9);
    case 'M_driftwood':
      return simple('trunk', TRUNK_GLSL, key, fallback, { uBase: U(col(PALETTE.driftwood)) }, 0.88);
    case 'M_seabed':
      return simple('sand', SAND_GLSL, key, fallback, { uBase: U(col(PALETTE.seabed)) }, 0.95);
    case 'M_kelp':
      return simple('leaf', LEAF_GLSL, key, fallback, { uBase: U(col(PALETTE.kelp)) }, 0.62);
    case 'M_moss':
      return simple('leaf', LEAF_GLSL, key, fallback, { uBase: U(col(PALETTE.moss)) }, 0.85);
    case 'M_spring':
      // a spring_ mesh normally gets springMaterial() centred on its pad; this is the static look
      return springMaterial(key, fallback, { center: new THREE.Vector3(), radius: 1.0 });
    // billboards, sign text, the (emissive) lamp lens, glass, lighthouse and water keep their
    // exported base colours / emission
    case 'M_billboard':
    case 'M_sign_text':
    case 'M_lamp':
    case 'M_glass':
    case 'M_lighthouse':
    case 'M_water':
    default:
      return exported(key, fallback);
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// Dye
// ════════════════════════════════════════════════════════════════════════════════════════════

export interface DyeUniforms {
  [k: string]: THREE.IUniform;
  uDyeTex: THREE.IUniform;
  uViewerTeam: THREE.IUniform;
  uTime: THREE.IUniform;
  uColorblind: THREE.IUniform;
}

interface ColorblindDef { sun: { dye: string }; gulf: { dye: string } }

/** linear-space deep / gloss variants for a colour-blind dye (teams.json only lists `dye`) */
function deepOf(c: THREE.Color): THREE.Color { return c.clone().multiplyScalar(0.5); }
function glossOf(c: THREE.Color): THREE.Color { return c.clone().lerp(new THREE.Color(1, 1, 1), 0.55); }

/**
 * One shared uniform set per map. Team colours come from data/teams.json. APP sets
 * `uViewerTeam.value` (1 | 2; 0 = spectator, both crews look friendly), `uColorblind.value`
 * (0 | 1) and `uTime.value` (seconds; it is the same object as SURFACE_ENV.uDfTime, which
 * water.update(t) also writes). Extra tunables: uDyeBump, uDyeEnv, uDyeSparkle, uDyeGlow (default 1:
 * scales the dye's self-illumination floor) and uDyeHueLock (default 0.8: saturation-protection
 * strength — where a coloured preset light drained the dye's chroma, its diffuse light gets the
 * albedo's hue back at the same luminance; it never engages where the light adds chroma).
 */
export function createDyeUniforms(paint: PaintTexture): DyeUniforms {
  const sun = teamById(1);
  const gulf = teamById(2);
  const cb = (TEAMS_RAW.colorblind ?? { sun: { dye: '#FFB000' }, gulf: { dye: '#1F6BFF' } }) as ColorblindDef;
  const sunCB = col(cb.sun.dye);
  const gulfCB = col(cb.gulf.dye);
  return {
    uDyeTex: U(paint.texture),
    uDyeSize: U(new THREE.Vector2(paint.size, 1 / paint.size)),
    uViewerTeam: U(1),
    uTime: SURFACE_ENV.uDfTime,
    uColorblind: U(0),
    uDyeSun: U(col(sun.dye)), uDyeSunDeep: U(col(sun.dyeDeep)), uDyeSunGloss: U(col(sun.dyeGloss)),
    uDyeGulf: U(col(gulf.dye)), uDyeGulfDeep: U(col(gulf.dyeDeep)), uDyeGulfGloss: U(col(gulf.dyeGloss)),
    uDyeSunCB: U(sunCB), uDyeSunCBDeep: U(deepOf(sunCB)), uDyeSunCBGloss: U(glossOf(sunCB)),
    uDyeGulfCB: U(gulfCB), uDyeGulfCBDeep: U(deepOf(gulfCB)), uDyeGulfCBGloss: U(glossOf(gulfCB)),
    uDyeBump: U(1),
    uDyeEnv: U(1),
    uDyeSparkle: U(1),
    uDyeHueLock: U(0.8),
    uDyeGlow: U(1),
  };
}

const DYE_VERT_PARS = /* glsl */ `
#ifndef USE_UV1
	attribute vec2 uv1;
#endif
varying vec2 vDfUv1;
`;
const DYE_VERT_MAIN = /* glsl */ `
	vDfUv1 = uv1;
`;

const DYE_FRAG_PARS = /* glsl */ `
// ── DYEFIELD dye layer ──
uniform sampler2D uDyeTex;
uniform vec2 uDyeSize;
uniform float uViewerTeam;
uniform float uTime;
uniform float uColorblind;
uniform vec3 uDyeSun;
uniform vec3 uDyeSunDeep;
uniform vec3 uDyeSunGloss;
uniform vec3 uDyeGulf;
uniform vec3 uDyeGulfDeep;
uniform vec3 uDyeGulfGloss;
uniform vec3 uDyeSunCB;
uniform vec3 uDyeSunCBDeep;
uniform vec3 uDyeSunCBGloss;
uniform vec3 uDyeGulfCB;
uniform vec3 uDyeGulfCBDeep;
uniform vec3 uDyeGulfCBGloss;
uniform float uDyeBump;
uniform float uDyeEnv;
uniform float uDyeSparkle;
uniform float uDyeHueLock;
uniform float uDyeGlow;
varying vec2 vDfUv1;
// cubic B-spline reconstruction of the atlas from 4 bilinear taps: smooth, round iso-contours
// (bilinear alone leaves rounded-rectangle texel steps). Reach is ±2 texels: the atlas gutter.
vec4 dfDyeTexel( vec2 uv ) {
	vec2 st = uv * uDyeSize.x - 0.5;
	vec2 i = floor( st );
	vec2 f = st - i;
	vec2 f2 = f * f;
	vec2 f3 = f2 * f;
	vec2 w0 = ( 1.0 - 3.0 * f + 3.0 * f2 - f3 ) / 6.0;
	vec2 w1 = ( 4.0 - 6.0 * f2 + 3.0 * f3 ) / 6.0;
	vec2 w2 = ( 1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3 ) / 6.0;
	vec2 w3 = f3 / 6.0;
	vec2 g0 = w0 + w1;
	vec2 g1 = w2 + w3;
	vec2 h0 = ( i - 0.5 + w1 / g0 ) * uDyeSize.y;
	vec2 h1 = ( i + 1.5 + w3 / g1 ) * uDyeSize.y;
	vec4 t00 = texture2D( uDyeTex, h0 );
	vec4 t10 = texture2D( uDyeTex, vec2( h1.x, h0.y ) );
	vec4 t01 = texture2D( uDyeTex, vec2( h0.x, h1.y ) );
	vec4 t11 = texture2D( uDyeTex, h1 );
	return g0.y * ( g0.x * t00 + g1.x * t10 ) + g1.y * ( g0.x * t01 + g1.x * t11 );
}
`;

// normal slot: runs after the surface block, before the base bump.
// Every derivative is taken in UNIFORM control flow at the top of the block; the branches below
// only skip noise (a fragment whose 4x4-texel footprint holds no paint does no noise at all).
//
// Cost per dyed fragment (hash evals: dfNoise2 = 4, dfNoise3 = 8; see the LOOK-FIX report):
//   before: 4 taps + 6 dfNoise3 + 2 dfNoise2 + 1 dfHash13 (+ 1 dfNoise2 in the base sky, every
//           fragment) = 9 noise calls / 61 hash evals on EVERY dyed fragment, painted or not
//   now:    4 taps; unpainted 0 noise calls; painted friendly ≤ 5 dfNoise2 + 2 dfNoise2Px
//           + 1 dfHash12 (≤ 29 hash evals, fewer with distance); painted enemy ≤ 5 dfNoise2
const DYE_FRAG_NORMAL = /* glsl */ `
{
	// ── the paint field, B-spline filtered BEFORE any threshold (4 bilinear taps) ──
	vec4 dyeT = dfDyeTexel( vDfUv1 );
	vec3 dyeW = vDfWorld;
	vec2 dyeP = dfPlanar( dyeW, dfN );                    // surface metres (floors: xz, walls: tangent, y)
	vec2 dyeDp = fwidth( dyeP );
	float dyeMpp = max( max( dyeDp.x, dyeDp.y ), 1e-5 ); // metres per pixel (the long footprint axis)
	float dyeValid = smoothstep( 0.3, 0.7, dyeT.a );
	float dyeAmt = ( dyeT.r + dyeT.g ) * dyeValid;
	// edge noise: each octave fades out before its period drops to ~3 px, so a far edge never
	// aliases into texel-like stair steps (the old 61/m and 23/m octaves stayed on at 6-8 m, where
	// a pixel is ~9 x 27 mm of floor)
	float dyeF1 = 1.0 - smoothstep( 0.022, 0.045, dyeMpp );   // 9/m octave (11 cm)
	float dyeF2 = 1.0 - smoothstep( 0.007, 0.014, dyeMpp );   // 27/m octave (3.7 cm)
	float dyeN1 = 0.5;
	float dyeN2 = 0.5;
	if ( dyeAmt > 0.003 ) {
		if ( dyeF1 > 0.0 ) dyeN1 = dfNoise2( dyeP * 9.0 + vec2( 2.0, 5.0 ) );
		if ( dyeF2 > 0.0 ) dyeN2 = dfNoise2( dyeP * 27.0 + vec2( 7.0, 3.0 ) );
	}
	float dyeHf = ( dyeN1 - 0.5 ) * dyeF1 * 0.62 + ( dyeN2 - 0.5 ) * dyeF2 * 0.38;
	// organic edge: amount + B-channel texel noise + the faded world octaves, thresholded with a
	// width from the field's own screen-space derivative (≈ 1 px at any distance / resolution)
	float dyeEdgeZone = 1.0 - smoothstep( 0.8, 1.0, dyeAmt );
	float dyeV = dyeAmt + ( ( dyeT.b - 0.5 ) * 0.32 + dyeHf * 0.5 ) * dyeEdgeZone;
	float dyeFw = fwidth( dyeV );
	float dyeAA = clamp( dyeFw * 0.75, 0.01, 0.5 );
	float dyeCover = smoothstep( 0.5 - dyeAA, 0.5 + dyeAA, dyeV ) * dyeValid;
	// raised rim: a bead just inside the edge, never thinner than ~2 px (no quad-sized steps)
	float dyeRimW = max( 0.16, dyeFw * 2.5 );
	float dyeRimB = dyeCover * ( 1.0 - smoothstep( 0.5 + dyeRimW * 0.35, 0.5 + dyeRimW, dyeV ) );
	// which crew: GULF share of the paint present, with its own wiggle (no seam where crews meet)
	float dyeGf = dyeT.g / max( dyeT.r + dyeT.g, 1e-3 );
	float dyeGv = dyeGf + dyeHf * 0.5 + ( dyeT.b - 0.5 ) * 0.16;
	float dyeAA2 = clamp( fwidth( dyeGv ) * 0.75, 0.01, 0.5 );
	float dyeGulf = smoothstep( 0.5 - dyeAA2, 0.5 + dyeAA2, dyeGv );
	float dyeViewGulf = step( 1.5, uViewerTeam );
	float dyeSpect = 1.0 - step( 0.5, uViewerTeam );
	float dyeFriendT = max( mix( 1.0 - dyeGulf, dyeGulf, dyeViewGulf ), dyeSpect );
	float dyeFriend = dyeCover * dyeFriendT;
	float dyeEnemy = dyeCover * ( 1.0 - dyeFriendT );
	// palette (colour-blind mode swaps to the max-separation pair)
	float dyeCb = step( 0.5, uColorblind );
	vec3 dyeCol = mix( mix( uDyeSun, uDyeSunCB, dyeCb ), mix( uDyeGulf, uDyeGulfCB, dyeCb ), dyeGulf );
	vec3 dyeDeep = mix( mix( uDyeSunDeep, uDyeSunCBDeep, dyeCb ), mix( uDyeGulfDeep, uDyeGulfCBDeep, dyeCb ), dyeGulf );
	vec3 dyeGloss = mix( mix( uDyeSunGloss, uDyeSunCBGloss, dyeCb ), mix( uDyeGulfGloss, uDyeGulfCBGloss, dyeCb ), dyeGulf );
	// colour-blind hatch on GULF CREW dye (diagonal, ~7 stripes per metre); its AA width comes from
	// dyeDp (fwidth of a sum ≤ sum of fwidths), so no extra derivative
	float dyeHs = ( dyeP.x + dyeP.y ) * 7.0;
	float dyeHaa = ( dyeDp.x + dyeDp.y ) * 5.25 + 1e-4;
	float dyeHatch = ( 1.0 - smoothstep( 0.17 - dyeHaa, 0.17 + dyeHaa, abs( fract( dyeHs ) - 0.5 ) ) ) * dyeCb * dyeGulf;
	// ── body: only where paint shows (no derivatives below this line) ──
	float dyeRise = smoothstep( 0.5, 0.9, dyeV );            // 0 at the edge → 1 a few cm inside
	float dyeBody = smoothstep( 0.55, 1.0, dyeAmt );         // the unjittered B-spline: ~15 cm ramp
	vec3 dyeAlb = dyeCol;
	float dyeHeight = 0.0;
	float dyeTack = 0.5;
	if ( dyeCover > 0.0 ) {
		vec3 dyeFriendCol = dyeCol;
		float dyeFriendH = 0.0;
		if ( dyeFriend > 0.0 ) {
			// friendly: saturated crew colour; the thick interior sits a touch deeper ("depth"),
			// broad slow lobes keep big pools from reading flat, the rim bead is lighter
			float dyeMott = dfNoise2( dyeP * 1.35 + vec2( 3.0, 9.0 ) );
			dyeFriendCol = mix( dyeCol, dyeDeep, dyeBody * ( 0.12 + 0.2 * dyeMott ) );
			dyeFriendCol = mix( dyeFriendCol, dyeGloss, 0.3 * dyeRimB );
			// height: a 2.5 mm raised film with a soft rim, a gentle undulation (≤ ~2° of tilt)
			// that bends the reflected streaks, and a faint ripple that fades with distance
			dyeFriendH = 0.0025 * dyeRise + dyeBody * 0.012 * ( dyeMott - 0.5 ) + 0.0004 * dyeHf;
		}
		vec3 dyeEnemyCol = dyeFriendCol;
		float dyeEnemyH = dyeFriendH;
		if ( dyeEnemy > 0.0 ) {
			// enemy: deeper and darker, matte, with stringy / tacky streaks
			float dyeStr = dfNoise2( vec2( dyeP.x * 1.4 + dyeP.y * 0.5, dyeP.y * 12.0 - dyeP.x * 3.0 ) );
			dyeTack = dyeStr * 0.65 + dyeN1 * 0.35;
			dyeEnemyCol = mix( dyeDeep, dyeCol, 0.3 ) * ( 0.6 + 0.26 * dyeTack );
			dyeEnemyH = dyeRise * ( 2.0 - dyeRise ) * 0.0035 + 0.0012 * dyeTack;
		}
		dyeAlb = mix( dyeEnemyCol, dyeFriendCol, dyeFriendT );
		dyeHeight = mix( dyeEnemyH, dyeFriendH, dyeFriendT );
	}
	dyeAlb = mix( dyeAlb, dyeAlb * 0.5, dyeHatch );
	diffuseColor.rgb = mix( diffuseColor.rgb, dyeAlb, dyeCover );
	// friendly base lobe stays broad and dim (0.35): the sharp, crew-tinted clear coat carries the
	// sun glint, so a sun in view never paints a big pale blob on the dye
	roughnessFactor = mix( roughnessFactor, mix( 0.72 + 0.1 * dyeTack, 0.35, dyeFriendT ), dyeCover );
	metalnessFactor = mix( metalnessFactor, 0.0, dyeCover );
	dfH = mix( dfH, dyeHeight * uDyeBump, dyeCover );
	// readable in every preset: a small constant self-illumination floor of the dye colour, and
	// saturation protection (base post-lights) wherever a coloured light drains the dye's chroma
	dfEmit = mix( dfEmit, dyeAlb * ( mix( 0.06, 0.1, dyeFriendT ) * uDyeGlow ), dyeCover );
	dfSatLock = uDyeHueLock * dyeCover;
	// clear-coat lobe (sun glint) + sky reflection. The reflection is the sky's LUMINANCE tinted to
	// the crew sheen colour: fresnel-strong at grazing angles yet never a pale blue/white film
	// (an untinted sky sheen washed SUNCREW orange out to salmon — integrator measurement).
	vec3 dyeSheenC = mix( dyeCol, dyeGloss, 0.45 );
	dfCoat = dyeFriend * 0.7;
	dfCoatRough = 0.1;
	dfCoatTint = mix( vec3( 1.0 ), dyeGloss, 0.8 );
	dfEnvW = mix( dfEnvW, mix( 0.25, 1.0, dyeFriendT ) * uDyeEnv, dyeCover );
	dfEnvF0 = mix( dfEnvF0, mix( 0.03, 0.045, dyeFriendT ), dyeCover );
	dfEnvMax = mix( dfEnvMax, mix( 0.35, 0.45, dyeFriendT ), dyeCover );
	dfEnvLum = mix( dfEnvLum, 1.0, dyeCover );
	dfEnvCol = mix( dfEnvCol, mix( dyeDeep, dyeSheenC, dyeFriendT ), dyeCover );
	// wet streaks + raised-rim highlight (friendly only; the enemy stays matte)
	dfSheen = dyeFriend * uDyeEnv;
	dfSheenCol = dyeSheenC;
	dfRim = dyeRimB * dyeFriendT * uDyeEnv;
	// droplet glints: round, sparse, near the camera only, twinkling toward the sun
	float dyeFleckA = dyeFriend * dyeRise * ( 1.0 - smoothstep( 0.004, 0.008, dyeMpp ) ) * uDyeSparkle;
	if ( dyeFleckA > 0.0 ) {
		vec2 dyeFc = dyeP * 42.0;
		vec2 dyeFi = floor( dyeFc );
		float dyeFh = dfHash12( dyeFi + vec2( 13.0, 71.0 ) );
		float dyeFd = length( dyeFc - dyeFi - 0.5 );
		dfSpark = step( 0.986, dyeFh ) * ( 1.0 - smoothstep( 0.12, 0.3, dyeFd ) )
			* ( 0.55 + 0.45 * sin( uTime * 2.7 + dyeFh * 60.0 ) ) * dyeFleckA;
	}
}
`;

/**
 * Inject the dye layer (onBeforeCompile). Mesh geometry must carry the 'uv1' attribute
 * (GLTFLoader maps TEXCOORD_1 → uv1). Chains after any surface patch from materialFor(); calling
 * it again with another uniform set replaces the previous dye patch.
 */
export function applyDye(mat: THREE.MeshStandardMaterial, dye: DyeUniforms): void {
  installPatch(mat, {
    key: 'dye',
    group: 'dye',
    order: 10,
    uniforms: dye,
    vertPars: DYE_VERT_PARS,
    vertMain: DYE_VERT_MAIN,
    frag: { pars: DYE_FRAG_PARS, normal: DYE_FRAG_NORMAL },
  });
}
