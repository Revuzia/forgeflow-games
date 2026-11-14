// DYEFIELD — stylized harbor sea (CONTRACT §5.0 / §5.1). LOOK lane.
//
// One 4 km × 4 km plane at `waterY` with a custom shader:
//   * body colour tinted by view angle: steep views look into the turquoise shallows
//     (preset.waterShallow), grazing views see the deep blue (preset.waterDeep);
//   * fresnel reflection of the same analytic sky the dome paints (SURFACE_ENV), so the sea
//     turns to the horizon colour toward the horizon;
//   * animated multi-octave normal ripples (value-noise gradients, rotated + scrolled per octave,
//     octaves smaller than ~2 px fade out so the far sea never aliases);
//   * a sun glint streak from sunDir plus sparse twinkling glitter;
//   * optional foam lace around a rectangle (e.g. the pier footprint), see WaterOptions;
//   * fog through three's fog chunks (FogExp2 from createSky). Opaque, not tone-mapped: the
//     preset hexes are the displayed colours, like the sky dome.
//   * shore depth (CONTRACT_P6_11 §19, Cinder Reef): when the map root in the scene carries
//     userData.dfShore (mapview.ts rasterised the ground under the water into a 0.5 m depth grid),
//     the water over sandbars, beaches and channel edges turns to the preset's shallow tint (sand
//     showing through in the last half metre), the channels stay deep, and a foam lace plus a
//     breathing second foam line hug every shoreline. Maps without one (Pier 18) are unchanged.
//   * interior presets (Lockwell Works): no ocean — the water plane is hidden.

import * as THREE from 'three';
import type { LightingPreset } from '../core/data.ts';
import { NOISE_GLSL, SKY_GLSL, SURFACE_ENV, presetKind, PALETTE } from './surfaces.ts';
import type { ShoreMap } from './mapview.ts';

export interface WaterRig { mesh: THREE.Mesh; update(t: number, camera: THREE.Camera): void }

/** Optional extras (the contract signature works without them). */
export interface WaterOptions {
  /** world XZ rectangle [minX, minZ, maxX, maxZ] whose edge gets a foam lace (the pier) */
  foamRect?: [number, number, number, number];
  /** plane edge length in metres (default 4000, never below 2000) */
  size?: number;
}

const WATER_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
varying vec3 vDfWorld;
void main() {
	vec4 wp = modelMatrix * vec4( position, 1.0 );
	vDfWorld = wp.xyz;
	vec4 mvPosition = viewMatrix * wp;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <fog_vertex>
}
`;

const WATER_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
${SKY_GLSL}
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform float uRipple;
uniform vec4 uFoamRect;      // minX, minZ, maxX, maxZ (disabled when minX >= maxX)
uniform sampler2D uShore;    // depth below the water: r * uShoreK.x - uShoreK.y metres
uniform vec4 uShoreRect;     // world XZ rect the shore map covers
uniform vec2 uShoreK;
uniform float uShoreOn;
uniform vec3 uSandTint;
varying vec3 vDfWorld;
// value noise with analytic derivatives (iq): returns ( value, d/dx, d/dy )
vec3 dfNoised( vec2 x ) {
	vec2 i = floor( x );
	vec2 f = fract( x );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	vec2 du = 6.0 * f * ( 1.0 - f );
	float a = dfHash12( i );
	float b = dfHash12( i + vec2( 1.0, 0.0 ) );
	float c = dfHash12( i + vec2( 0.0, 1.0 ) );
	float d = dfHash12( i + vec2( 1.0, 1.0 ) );
	float k = a - b - c + d;
	return vec3( a + ( b - a ) * u.x + ( c - a ) * u.y + k * u.x * u.y,
	             du * ( vec2( b - a, c - a ) + k * u.yx ) );
}
void main() {
	#include <logdepthbuf_fragment>
	vec3 toCam = cameraPosition - vDfWorld;
	float dist = max( length( toCam ), 1e-3 );
	vec3 V = toCam / dist;
	vec2 p = vDfWorld.xz;
	float t = uDfTime;
	float pxw = fwidth( p.x ) + fwidth( p.y );            // metres per pixel
	// ── ripples: sum of rotated, scrolled noise gradients ──
	vec2 g = vec2( 0.0 );
	vec2 gHi = vec2( 0.0 );
	float amp = 1.0;
	float freq = 0.22;
	vec2 q = p;
	const mat2 rot = mat2( 0.8, 0.6, -0.6, 0.8 );
	for ( int i = 0; i < 6; i ++ ) {
		float fi = float( i );
		float fade = 1.0 - smoothstep( 0.2, 0.9, pxw * freq * 1.6 );
		vec2 dir = vec2( cos( fi * 1.7 + 0.4 ), sin( fi * 1.7 + 0.4 ) );
		vec3 n = dfNoised( q * freq + dir * t * ( 0.3 + 0.13 * fi ) );
		vec2 gi = n.yz * ( amp * freq * fade );
		g += gi;
		if ( i >= 3 ) gHi += gi;
		amp *= 0.6;
		freq *= 2.07;
		q = rot * q;
	}
	vec3 N = normalize( vec3( - g.x * uRipple, 1.0, - g.y * uRipple ) );
	float NdV = saturate( dot( N, V ) );
	// ── body: shallows when looking down, deep blue toward the horizon ──
	float depthT = pow( 1.0 - saturate( V.y ), 2.2 );
	vec3 body = mix( uShallow, uDeep, depthT );
	body *= 0.92 + 0.16 * saturate( 0.5 + 2.5 * dot( g, vec2( 0.6, 0.8 ) ) ); // crest / trough shading
	// ── shore depth: turquoise over sand, deep in the channels ──
	float dep = 9.0;
	float shal = 0.0;
	if ( uShoreOn > 0.5 ) {
		vec2 suv = ( p - uShoreRect.xy ) / ( uShoreRect.zw - uShoreRect.xy );
		if ( suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0 ) dep = texture2D( uShore, suv ).r * uShoreK.x - uShoreK.y;
		float fnS = dfNoise2( p * 0.6 + vec2( t * 0.07, - t * 0.05 ) );
		shal = 1.0 - smoothstep( 0.0, 2.6, dep + ( fnS - 0.5 ) * 0.6 );
		vec3 sh = uShallow * 1.04 * ( 0.94 + 0.12 * saturate( 0.5 + 2.5 * dot( g, vec2( 0.6, 0.8 ) ) ) );
		body = mix( body, sh, shal * 0.85 );
		// the channels (≈ 2 m) and the open sea read deep whatever the view angle: a danger colour
		float deepK = smoothstep( 0.6, 1.8, dep );
		body = mix( body, mix( uDeep, uShallow, 0.12 ), deepK * 0.8 );
		body = mix( body, uSandTint, ( 1.0 - smoothstep( 0.0, 0.7, dep ) ) * 0.38 );
	}
	// ── fresnel sky reflection (a little bluer than the sky and never fully mirror-like, so the
	//    far sea keeps its deep colour instead of washing out to the pale horizon) ──
	vec3 R = reflect( - V, N );
	R.y = abs( R.y );
	float F = ( 0.02 + 0.98 * pow( 1.0 - NdV, 5.0 ) ) * ( 1.0 - 0.45 * shal );
	vec3 refl = mix( dfSkyColor( R ), uDfSkyZenith, 0.25 );
	vec3 col = mix( body, refl, F * 0.6 );
	// ── sun glint streak ──
	float sd = saturate( dot( R, uDfSunDir ) );
	col += uDfSunColor * ( pow( sd, 240.0 ) * 4.0 + pow( sd, 36.0 ) * 0.35 );
	// ── glitter: extra-sharp lobe on the high-frequency ripples, twinkling per cell ──
	vec3 Ng = normalize( vec3( - ( g.x + gHi.x * 2.5 ) * uRipple, 1.0, - ( g.y + gHi.y * 2.5 ) * uRipple ) );
	vec3 Rg = reflect( - V, Ng );
	float cell = dfHash12( floor( p * 2.3 ) + floor( t * 3.0 ) * 0.37 );
	float glit = pow( saturate( dot( Rg, uDfSunDir ) ), 900.0 ) * step( 0.55, cell );
	col += uDfSunColor * glit * 7.0 * ( 1.0 - smoothstep( 40.0, 160.0, dist ) );
	// ── foam lace around the pier footprint ──
	if ( uFoamRect.x < uFoamRect.z ) {
		vec2 c = ( uFoamRect.xy + uFoamRect.zw ) * 0.5;
		vec2 hs = ( uFoamRect.zw - uFoamRect.xy ) * 0.5;
		vec2 dq = abs( p - c ) - hs;
		float sdr = length( max( dq, 0.0 ) ) + min( max( dq.x, dq.y ), 0.0 );
		float fn = dfNoise2( p * 0.9 + vec2( t * 0.21, - t * 0.17 ) );
		float band = 1.0 - smoothstep( 0.0, 1.1 + 1.4 * fn, sdr );
		float lace = smoothstep( 0.42, 0.6, dfNoise2( p * 3.1 + vec2( - t * 0.33, t * 0.27 ) ) * 0.65 + band * 0.55 );
		col = mix( col, uFoam, saturate( band * lace ) * 0.9 );
	}
	// ── shoreline foam (shore map): a lace on the waterline + a breathing line a little offshore ──
	if ( uShoreOn > 0.5 && dep < 1.4 ) {
		float fn2 = dfNoise2( p * 1.1 + vec2( t * 0.23, - t * 0.19 ) );
		float band = 1.0 - smoothstep( 0.0, 0.22 + 0.3 * fn2, dep );
		float surge = 0.5 + 0.5 * sin( t * 0.8 + fn2 * 5.0 );
		float band2 = ( 1.0 - smoothstep( 0.0, 0.1, abs( dep - ( 0.4 + 0.3 * surge ) ) ) ) * 0.55;
		float fb = max( band, band2 );
		float lace = smoothstep( 0.42, 0.62, dfNoise2( p * 3.1 + vec2( - t * 0.33, t * 0.27 ) ) * 0.65 + fb * 0.55 );
		col = mix( col, uFoam, saturate( fb * lace ) * 0.85 );
	}
	gl_FragColor = vec4( col, 1.0 );
	#include <colorspace_fragment>
	#include <fog_fragment>
}
`;

export function createWater(scene: THREE.Scene, preset: LightingPreset, waterY: number, sunDir: THREE.Vector3, opts: WaterOptions = {}): WaterRig {
  // the sun direction lives in the shared env (createSky writes it too; keep them identical)
  SURFACE_ENV.uDfSunDir.value.copy(sunDir).normalize();

  const size = Math.max(2000, opts.size ?? 4000);
  const fr = opts.foamRect;
  // the map root (added to the scene before the water) may carry a shore depth map
  let shore: ShoreMap | null = null;
  for (const c of scene.children) {
    const sm = c.userData?.dfShore as ShoreMap | undefined;
    if (sm && sm.tex) { shore = sm; break; }
  }
  const uniforms: Record<string, THREE.IUniform> = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    ...SURFACE_ENV,
    uDeep: { value: new THREE.Color(preset.waterDeep) },
    uShallow: { value: new THREE.Color(preset.waterShallow) },
    uFoam: { value: new THREE.Color('#F4FBFB') },
    uRipple: { value: 0.3 },
    // with a shore map the shorelines carry the foam, so the bounds rectangle lace is dropped
    uFoamRect: { value: fr && !shore ? new THREE.Vector4(fr[0], fr[1], fr[2], fr[3]) : new THREE.Vector4(1, 1, -1, -1) },
    uShore: { value: shore ? shore.tex : null },
    uShoreRect: { value: shore ? new THREE.Vector4(...shore.rect) : new THREE.Vector4(0, 0, 1, 1) },
    uShoreK: { value: new THREE.Vector2(shore ? shore.range : 1, shore ? shore.land : 0) },
    uShoreOn: { value: shore ? 1 : 0 },
    uSandTint: { value: new THREE.Color(PALETTE.shallows) },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'df_water',
    uniforms,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    fog: true,
    lights: false,
    toneMapped: false,
  });
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'df_water';
  mesh.position.set(0, waterY, 0);
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  // opaque + depth-tested: draw it AFTER the opaque map so early-Z rejects the sea under the pier.
  // At renderOrder -10 it drew first and ran this 6-octave shader under every pier pixel before
  // being overdrawn (hiding it gained ~7 fps at 1600×900 on an Intel UHD — integrator measurement).
  mesh.renderOrder = 10;
  // an interior preset has no ocean (CONTRACT_ART_P6_8 §15: no horizon)
  if (presetKind(preset) === 'interior') mesh.visible = false;
  scene.add(mesh);

  return {
    mesh,
    update(t: number, camera: THREE.Camera): void {
      // shared clock for the dye sparkle, pad pulse and the sea
      SURFACE_ENV.uDfTime.value = t;
      void camera;
    },
  };
}
