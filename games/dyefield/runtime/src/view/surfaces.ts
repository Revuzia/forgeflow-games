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
//   postLights  after  #include <lights_fragment_end>          base: analytic sky reflection, sparkle
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
import { mapById, teamById, TEAMS_RAW } from '../core/data.ts';
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
};

/** Point the shared sky uniforms at a preset (called by createSky). */
export function setSurfaceEnvironment(preset: LightingPreset, sunDir: THREE.Vector3): void {
  const e = SURFACE_ENV;
  e.uDfSkyZenith.value.set(preset.skyZenith);
  e.uDfSkyHorizon.value.set(preset.skyHorizon);
  e.uDfSkyWarm.value.set(preset.sunColor).lerp(WARM_BAND, 0.7);
  // below the horizon the sky reads as the fogged sea
  e.uDfSkyGround.value.set(preset.fogColor).lerp(new THREE.Color(preset.waterShallow), 0.15);
  e.uDfSunDir.value.copy(sunDir).normalize();
  e.uDfSunColor.value.set(preset.sunColor);
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
float dfCoat;      // extra clear-coat lobe weight (friendly dye)
float dfCoatRough; // its roughness
vec3 dfCoatTint;   // its tint
float dfH;         // bump height in metres (surface detail, then dye), applied once
vec3 dfEmit;       // extra emissive radiance (linear)
float dfSpark;     // sparkle-fleck strength (dye)
float dfSheen;     // stylized wet-sheen strength (friendly dye): view-relative toon highlight
vec3 dfSheenCol;   // its tint
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
	dfEnvW = 0.0; dfEnvF0 = 0.04; dfEnvMax = 0.7; dfEnvCol = vec3( 1.0 ); dfCoat = 0.0; dfCoatRough = 0.1; dfCoatTint = vec3( 1.0 );
	dfH = 0.0; dfEmit = vec3( 0.0 ); dfSpark = 0.0; dfSheen = 0.0; dfSheenCol = vec3( 1.0 );
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
const BASE_FRAG_POST_LIGHTS = /* glsl */ `
{
	vec3 dfNw = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec3 dfVw = normalize( cameraPosition - vDfWorld );
	float dfNdV = saturate( dot( dfNw, dfVw ) );
	vec3 dfRw = reflect( - dfVw, dfNw );
	float dfFr = dfEnvF0 + ( 1.0 - dfEnvF0 ) * pow( 1.0 - dfNdV, 4.0 );
	vec3 dfEnvTint = mix( vec3( 1.0 ), diffuseColor.rgb, metalnessFactor );
	reflectedLight.indirectSpecular += dfSkyRadiance( dfRw ) * dfEnvTint * dfEnvCol * ( min( dfFr, dfEnvMax ) * dfEnvW );
	#if NUM_DIR_LIGHTS > 0
		vec3 dfSunL = directLight.color;      // last directional light = the sun, shadow applied
	#else
		vec3 dfSunL = uDfSunColor;
	#endif
	float dfAl = pow( saturate( dot( dfRw, uDfSunDir ) ), 10.0 );
	reflectedLight.directSpecular += dfSunL * ( dfSpark * ( 0.035 + 1.1 * dfAl ) );
	// wet sheen (stylized, sun-independent): a crisp lobe around a virtual light a few degrees
	// above the flat surface's mirror direction. A flat patch sits just outside the lobe; the
	// dye's undulation tilts some lobes toward the viewer into it -> blobby wet highlights from
	// any camera, any preset (the noon sun sits behind the default follow camera).
	vec3 dfNg = normalize( vDfWorldN ) * faceDirection;
	vec3 dfLs = normalize( reflect( - dfVw, dfNg ) + dfNg * 0.3 );
	float dfNh = dot( dfNw, normalize( dfLs + dfVw ) );
	float dfShW = fwidth( dfNh ) + 2e-4;
	float dfSh = smoothstep( 0.9962 - dfShW, 0.9992 + dfShW, dfNh );
	// it stands for reflected sky: lit by the preset's horizon colour, so a dim / interior sky
	// dims it instead of the sheen glowing on its own
	reflectedLight.indirectSpecular += dfSheenCol * mix( uDfSkyHorizon, vec3( 1.0 ), 0.4 ) * ( dfSh * dfSheen );
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
  shader.vertexShader = vs;
  shader.fragmentShader = fs;
}

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
	float sp = dfNoise2( p * 23.0 );
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
	float fine = dfNoise2( p * 29.0 );
	float spD = smoothstep( 0.8, 0.86, dfNoise2( p * 53.0 + vec2( 9.0, 2.0 ) ) ) * detail;
	float spL = smoothstep( 0.84, 0.9, dfNoise2( p * 41.0 + vec2( 21.0, 5.0 ) ) ) * detail;
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
	float grain2 = dfNoise2( vec2( p.x * 160.0 + id * 3.0, p.y * 8.0 ) );
	float figure = sin( p.x * 80.0 + dfNoise2( vec2( p.x * 6.0, p.y * 0.9 ) + id * 5.0 ) * 7.0 ) * 0.5 + 0.5;
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
	float sideBand = ( 1.0 - isTop ) * smoothstep( uPadCenter.y - 0.12, uPadCenter.y - 0.09, vDfWorld.y );
	dfEmit = uPadTeam * ( ( ring * 2.6 * pulse + mark * 1.6 ) * isTop + sideBand * 1.8 * pulse );
	dfA = c;
	dfR = mix( 0.42, 0.3, glow );
	dfM = 0.15;
	dfEnvW = 0.25;
	dfEnvF0 = 0.08;
	dfH = -0.0015 * groove;
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
  return out;
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
 * water.update(t) also writes). Extra tunables: uDyeBump, uDyeEnv, uDyeSparkle (default 1).
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

// normal slot: runs after the surface block, before the base bump. Every derivative is taken in
// uniform control flow (no branches in this block).
const DYE_FRAG_NORMAL = /* glsl */ `
{
	vec4 dyeT = dfDyeTexel( vDfUv1 );
	vec3 dyeW = vDfWorld;
	// atlas texels per pixel: fade sub-texel noise when the atlas is minified (no mipmaps)
	float dyeTpp = max( length( fwidth( vDfUv1 * uDyeSize.x ) ), 1e-5 );
	float dyeHfA = 1.0 - smoothstep( 0.35, 1.25, dyeTpp );
	float dyeHf = dfNoise3( dyeW * 9.0 + vec3( 2.0, 5.0, 11.0 ) ) * 0.45 + dfNoise3( dyeW * 23.0 ) * 0.35
		+ dfNoise3( dyeW * 61.0 + vec3( 7.0, 3.0, 1.0 ) ) * 0.2;
	float dyeValid = smoothstep( 0.3, 0.7, dyeT.a );
	// organic edge: B-spline amount + B-channel texel noise + texel-scale / high-frequency world noise
	float dyeAmt = ( dyeT.r + dyeT.g ) * dyeValid;
	float dyeEdgeZone = 1.0 - smoothstep( 0.82, 1.0, dyeAmt );
	float dyeJ = ( ( dyeT.b - 0.5 ) * 0.34 + ( dyeHf - 0.5 ) * 0.44 * dyeHfA ) * dyeEdgeZone;
	float dyeV = dyeAmt + dyeJ;
	float dyeAA = clamp( fwidth( dyeV ) * 0.85, 0.015, 0.5 );
	float dyeCover = smoothstep( 0.5 - dyeAA, 0.5 + dyeAA, dyeV ) * dyeValid;
	// which crew: GULF share of the paint present, with its own wiggle (no seam where crews meet)
	float dyeGf = dyeT.g / max( dyeT.r + dyeT.g, 1e-3 );
	float dyeGv = dyeGf + ( dyeHf - 0.5 ) * 0.44 * dyeHfA + ( dyeT.b - 0.5 ) * 0.16;
	float dyeAA2 = clamp( fwidth( dyeGv ) * 0.85, 0.015, 0.5 );
	float dyeGulf = smoothstep( 0.5 - dyeAA2, 0.5 + dyeAA2, dyeGv );
	float dyeViewGulf = step( 1.5, uViewerTeam );
	float dyeSpect = 1.0 - step( 0.5, uViewerTeam );
	float dyeFriendT = max( mix( 1.0 - dyeGulf, dyeGulf, dyeViewGulf ), dyeSpect );
	float dyeFriend = dyeCover * dyeFriendT;
	// palette (colour-blind mode swaps to the max-separation pair)
	float dyeCb = step( 0.5, uColorblind );
	vec3 dyeCol = mix( mix( uDyeSun, uDyeSunCB, dyeCb ), mix( uDyeGulf, uDyeGulfCB, dyeCb ), dyeGulf );
	vec3 dyeDeep = mix( mix( uDyeSunDeep, uDyeSunCBDeep, dyeCb ), mix( uDyeGulfDeep, uDyeGulfCBDeep, dyeCb ), dyeGulf );
	vec3 dyeGloss = mix( mix( uDyeSunGloss, uDyeSunCBGloss, dyeCb ), mix( uDyeGulfGloss, uDyeGulfCBGloss, dyeCb ), dyeGulf );
	// friendly: saturated, a little deeper where thick, mottled so big pools are not flat
	float dyeMott = dfNoise3( dyeW * 1.6 + vec3( 3.0, 1.0, 9.0 ) );
	float dyeThick = smoothstep( 0.55, 1.0, dyeV );
	vec3 dyeFriendCol = mix( dyeCol, dyeDeep, 0.1 + 0.22 * dyeThick * dyeMott );
	dyeFriendCol = mix( dyeFriendCol, dyeGloss, 0.12 * ( 1.0 - dyeThick ) );
	// enemy: deeper and darker, matte, with stringy / tacky streaks
	vec2 dyeP = dfPlanar( dyeW, dfN );
	float dyeStr = dfNoise2( vec2( dyeP.x * 1.4 + dyeP.y * 0.5, dyeP.y * 12.0 - dyeP.x * 3.0 ) );
	float dyeStr2 = dfNoise2( vec2( dyeP.x * 8.0 - dyeP.y * 2.5, dyeP.y * 1.3 + dyeP.x * 0.6 ) * 2.2 );
	float dyeTack = dyeStr * 0.6 + dyeStr2 * 0.4;
	vec3 dyeEnemyCol = mix( dyeDeep, dyeCol, 0.3 ) * ( 0.6 + 0.26 * dyeTack );
	vec3 dyeAlb = mix( dyeEnemyCol, dyeFriendCol, dyeFriendT );
	// colour-blind hatch on GULF CREW dye (diagonal, ~7 stripes per metre)
	float dyeHs = ( dyeP.x + dyeP.y ) * 7.0;
	float dyeHaa = fwidth( dyeHs ) * 0.75 + 1e-4;
	float dyeHatch = ( 1.0 - smoothstep( 0.17 - dyeHaa, 0.17 + dyeHaa, abs( fract( dyeHs ) - 0.5 ) ) ) * dyeCb * dyeGulf;
	dyeAlb = mix( dyeAlb, dyeAlb * 0.5, dyeHatch );
	diffuseColor.rgb = mix( diffuseColor.rgb, dyeAlb, dyeCover );
	roughnessFactor = mix( roughnessFactor, mix( 0.72 + 0.1 * dyeTack, 0.15, dyeFriendT ), dyeCover );
	metalnessFactor = mix( metalnessFactor, 0.0, dyeCover );
	// soft height: raised puddle with an ease-out rim (friendly), low and tacky (enemy)
	float dyeRise = smoothstep( 0.5, 0.95, dyeV );
	float dyeProfile = dyeRise * ( 2.0 - dyeRise );
	// friendly pools undulate in broad, slowly drifting lobes (a "virtual" 2.2 cm, i.e. a few
	// degrees of normal tilt): at the follow camera's grazing angle the fresnel reflection then
	// breaks into wet highlights instead of one flat film. Ramped by the rim profile, so the
	// undulation never adds a height step at the paint edge.
	float dyeUnd = dfNoise3( dyeW * 1.9 + vec3( 0.0, uTime * 0.07, 0.0 ) ) * 0.42
		+ dfNoise3( dyeW * 4.6 + vec3( 5.0, 1.0 - uTime * 0.05, 3.0 ) ) * 0.58;
	float dyeHeight = dyeProfile * mix( 0.0035, 0.009 + 0.03 * dyeUnd, dyeFriendT )
		+ dyeCover * 0.0012 * dyeTack * ( 1.0 - dyeFriendT );
	dfH = mix( dfH, dyeHeight * uDyeBump, dyeCover );
	// clear-coat lobe + sky reflection + sparkle flecks (applied by the base lighting hooks).
	// The sky reflection is tinted toward the crew's gloss colour: an untinted near-white sky
	// sheen at grazing angles washed SUNCREW orange out to salmon (integrator measurement).
	dfCoat = dyeFriend;
	dfCoatRough = 0.09;
	dfCoatTint = mix( vec3( 1.0 ), dyeGloss, 0.35 );
	dfEnvW = mix( dfEnvW, mix( 0.25, 0.75, dyeFriendT ) * uDyeEnv, dyeCover );
	dfEnvF0 = mix( dfEnvF0, mix( 0.03, 0.06, dyeFriendT ), dyeCover );
	dfEnvMax = mix( dfEnvMax, 0.5, dyeCover );
	dfEnvCol = mix( dfEnvCol, mix( vec3( 1.0 ), dyeGloss, 0.7 ), dyeCover );
	float dyeSh = dfHash13( floor( dyeW * 64.0 ) );
	float dyeFleck = step( 0.992, dyeSh ) * ( 0.45 + 0.55 * sin( uTime * 2.7 + dyeSh * 60.0 ) );
	float dyeNear = 1.0 - smoothstep( 3.5, 12.0, length( cameraPosition - dyeW ) );
	dfSpark = max( dyeFleck, 0.0 ) * dyeNear * dyeFriend * dyeRise * uDyeSparkle;
	// wet sheen on friendly pools; fades out by ~30 m where the lobes would shrink below a pixel
	float dyeFar = 1.0 - smoothstep( 14.0, 30.0, length( cameraPosition - dyeW ) );
	dfSheen = dyeFriend * dyeRise * dyeFar * 0.8 * uDyeEnv;
	dfSheenCol = mix( vec3( 1.0 ), dyeGloss, 0.2 );
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
