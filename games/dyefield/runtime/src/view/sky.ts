// DYEFIELD — sky dome, sun, hemisphere fill, fog and exposure (CONTRACT §5.0 / §5.1). LOOK lane.
//
// createSky(scene, renderer, preset) applies one LightingPreset from data/maps.json:
//   * sunDir from elevation/azimuth. Convention: azimuth 0 = +Z, 90 = +X (clockwise seen from
//     above), elevation above the horizon; sunDir is the unit vector TOWARD the sun
//     (surfaces.ts sunDirection()). Noon at Pier 18 = el 62°, az 140° → (0.30, 0.88, −0.36).
//   * sun = DirectionalLight (castShadow, 1024² map (FFG doctrine §3; 2048² cost ~7 fps at
//     1600×900 on an Intel UHD, integrator measurement), PCF with a soft radius — r186 removed
//     PCFSoftShadowMap, so PCFShadowMap + shadow.radius is "PCF soft" now). Its ~48 m
//     orthographic shadow box follows `focus` (pushed ahead along the camera's view) and is
//     snapped to whole shadow texels in light space so nothing shimmers while the runner moves.
//     Bias is tuned for the bevelled Blender geometry: a small depth bias plus a world-space
//     normal bias of ~1.3 shadow texels.
//   * HemisphereLight (hemiSky / hemiGround / hemiIntensity).
//   * scene.fog = FogExp2(fogColor, fogDensity); renderer.toneMappingExposure = exposure.
//   * a gradient dome (on the far plane, drawn after the opaque scene with a LessEqual depth test
//     so only visible sky pixels are shaded; follows the camera by construction):
//     zenith → horizon, a warm band on the horizon (strongest toward the sun), a soft sun disc
//     with halo and a few stylized cloud puffs. It is not tone-mapped, so the preset hexes are
//     exactly what the player sees, and fogged geometry melts into it (three applies fog after
//     tone mapping in the output colour space, so fogColor also lands exactly).
//   * it also points the shared SURFACE_ENV uniforms (surfaces.ts) at the preset, so glossy dye,
//     metal and water reflect this sky.

import * as THREE from 'three';
import type { LightingPreset } from '../core/data.ts';
import { NOISE_GLSL, SKY_GLSL, SURFACE_ENV, setSurfaceEnvironment, sunDirection } from './surfaces.ts';

export interface SkyRig {
  sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; sunDir: THREE.Vector3;   // sunDir = unit vector TOWARD the sun
  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3): void;              // shadow camera box follows focus
  dispose(): void;
}

/** Shadow tuning (exported for the bench / debug panel). */
export const SUN_SHADOW = {
  mapSize: 1024,
  /** half-size of the orthographic shadow box (m): 48 m across */
  half: 24,
  /** how far the box centre is pushed ahead of the focus along the camera's ground heading (m) */
  ahead: 11,
  /** distance from the box centre back toward the sun (m) — must clear the tallest caster */
  back: 60,
  /** PCF kernel radius in shadow texels (vogel-disk PCF in r186): ~7.5 cm at 48 m / 1024 */
  radius: 1.6,
  /** depth bias (normalised depth units) */
  bias: -0.00025,
  /** normal bias (world metres) ≈ 1 texel at 48 m / 1024 */
  normalBias: 0.045,
  /** toy-bright soft shadows: the sun keeps (1 − intensity) of its light inside a shadow */
  intensity: 0.72,
} as const;

const CLOUD_COUNT = 9;

/** small deterministic hash (sky layout must not depend on Math.random) */
function hash01(i: number, salt: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDfDir;
void main() {
	vDfDir = position;
	// rotation-only view transform: the dome is centred on the camera wherever it is
	vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
	gl_Position = p.xyww;   // on the far plane: LessEqual passes only where nothing else was drawn
}
`;

const SKY_FRAG = /* glsl */ `
#include <common>
${NOISE_GLSL}
${SKY_GLSL}
#define DF_CLOUDS ${CLOUD_COUNT}
uniform vec4 uClouds[ DF_CLOUDS ];     // xyz = centre direction, w = angular half-width (rad)
uniform float uCloudSeed[ DF_CLOUDS ];
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uSunCos;                 // cos( sun disc angular radius )
varying vec3 vDfDir;
float dfSmin( float a, float b, float k ) {
	float h = clamp( 0.5 + 0.5 * ( b - a ) / k, 0.0, 1.0 );
	return mix( b, a, h ) - k * h * ( 1.0 - h );
}
void main() {
	vec3 d = normalize( vDfDir );
	float px = fwidth( d.x ) + fwidth( d.y ) + fwidth( d.z );   // ≈ angular size of a pixel
	vec3 col = dfSkyColor( d );
	// sun: soft halo + disc
	float s = dot( d, uDfSunDir );
	float sp = max( s, 0.0 );
	col += uDfSunColor * ( pow( sp, 900.0 ) * 1.2 + pow( sp, 64.0 ) * 0.3 + pow( sp, 8.0 ) * 0.08 );
	float disc = smoothstep( uSunCos - px * 0.7, uSunCos + px * 0.7, s );
	col = mix( col, uDfSunColor * 2.2 + vec3( 0.4 ), disc );
	// stylized cumulus puffs: smooth union of five circles over a flat base, lit top / shaded belly
	for ( int i = 0; i < DF_CLOUDS; i ++ ) {
		vec4 cl = uClouds[ i ];
		if ( dot( d, cl.xyz ) < 0.9 ) continue;
		vec3 right = normalize( cross( cl.xyz, vec3( 0.0, 1.0, 0.0 ) ) );
		vec3 upv = cross( right, cl.xyz );
		vec2 p = vec2( dot( d, right ), dot( d, upv ) ) / cl.w;
		float seed = uCloudSeed[ i ];
		float dd = 1e3;
		for ( int k = 0; k < 5; k ++ ) {
			float fk = float( k );
			float ox = ( fk - 2.0 ) * 0.42 + ( dfHash12( vec2( seed, fk ) ) - 0.5 ) * 0.22;
			float rr = ( 0.3 + 0.24 * ( 1.0 - abs( fk - 2.0 ) * 0.5 ) ) * ( 0.8 + 0.4 * dfHash12( vec2( fk, seed + 3.0 ) ) );
			float oy = rr * 0.35 - 0.06;
			dd = dfSmin( dd, length( p - vec2( ox, oy ) ) - rr, 0.12 );
		}
		dd = max( dd, - ( p.y + 0.1 ) );
		float edge = px / cl.w + 0.01;
		float a = 1.0 - smoothstep( - edge, edge, dd );
		float lit = smoothstep( -0.08, 0.5, p.y + 0.12 * dfNoise2( p * 3.0 + seed ) );
		vec3 cc = mix( uCloudShade, uCloudLit, lit );
		cc += uDfSunColor * 0.1 * smoothstep( 0.0, 0.9, dot( d, uDfSunDir ) ) * smoothstep( -0.15, 0.0, dd );
		col = mix( col, cc, a );
	}
	gl_FragColor = vec4( col, 1.0 );
	#include <colorspace_fragment>
}
`;

export function createSky(scene: THREE.Scene, renderer: THREE.WebGLRenderer, preset: LightingPreset): SkyRig {
  const sunDir = sunDirection(preset.sunElevationDeg, preset.sunAzimuthDeg);
  setSurfaceEnvironment(preset, sunDir);

  // ── sun ──
  const sun = new THREE.DirectionalLight(new THREE.Color(preset.sunColor), preset.sunIntensity);
  sun.name = 'df_sun';
  sun.castShadow = true;
  sun.shadow.mapSize.set(SUN_SHADOW.mapSize, SUN_SHADOW.mapSize);
  sun.shadow.radius = SUN_SHADOW.radius;
  sun.shadow.bias = SUN_SHADOW.bias;
  sun.shadow.normalBias = SUN_SHADOW.normalBias;
  sun.shadow.intensity = SUN_SHADOW.intensity;
  const sc = sun.shadow.camera;
  sc.left = -SUN_SHADOW.half; sc.right = SUN_SHADOW.half;
  sc.top = SUN_SHADOW.half; sc.bottom = -SUN_SHADOW.half;
  sc.near = 0.5; sc.far = SUN_SHADOW.back + 60;
  sc.updateProjectionMatrix();
  sun.position.copy(sunDir).multiplyScalar(SUN_SHADOW.back);
  sun.target.position.set(0, 0, 0);
  scene.add(sun);
  scene.add(sun.target);

  // ── fill ──
  const hemi = new THREE.HemisphereLight(new THREE.Color(preset.hemiSky), new THREE.Color(preset.hemiGround), preset.hemiIntensity);
  hemi.name = 'df_hemi';
  hemi.position.set(0, 1, 0);
  scene.add(hemi);

  // ── atmosphere + exposure ──
  const fog = new THREE.FogExp2(new THREE.Color(preset.fogColor), preset.fogDensity);
  scene.fog = fog;
  scene.background = new THREE.Color(preset.fogColor);
  renderer.toneMappingExposure = preset.exposure;
  renderer.shadowMap.enabled = true;
  // r186 warns and falls back when PCFSoftShadowMap is requested; ask for the kernel directly
  if (renderer.shadowMap.type === THREE.PCFSoftShadowMap) renderer.shadowMap.type = THREE.PCFShadowMap;

  // ── dome ──
  const clouds: THREE.Vector4[] = [];
  const cloudAz: number[] = [];
  const cloudEl: number[] = [];
  const seeds: number[] = [];
  for (let i = 0; i < CLOUD_COUNT; i++) {
    cloudAz.push(((i / CLOUD_COUNT) * 360 + (hash01(i, 1) - 0.5) * 28) * THREE.MathUtils.DEG2RAD);
    cloudEl.push((5 + hash01(i, 2) * 14) * THREE.MathUtils.DEG2RAD);
    const w = 0.09 + hash01(i, 3) * 0.1;
    clouds.push(new THREE.Vector4(0, 0, 1, w));
    seeds.push(Math.floor(hash01(i, 4) * 97) + 1);
  }
  const placeClouds = (drift: number): void => {
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const az = cloudAz[i] + drift * (0.6 + 0.4 * hash01(i, 5));
      const el = cloudEl[i];
      clouds[i].set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el), clouds[i].w);
    }
  };
  placeClouds(0);

  const horizon = new THREE.Color(preset.skyHorizon);
  const zenith = new THREE.Color(preset.skyZenith);
  const sunCol = new THREE.Color(preset.sunColor);
  const cloudLit = new THREE.Color(1, 1, 1).lerp(sunCol, 0.3);
  const cloudShade = horizon.clone().lerp(zenith, 0.35).lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(0.9);

  const domeMat = new THREE.ShaderMaterial({
    name: 'df_sky',
    uniforms: {
      ...SURFACE_ENV,
      uClouds: { value: clouds },
      uCloudSeed: { value: seeds },
      uCloudLit: { value: cloudLit },
      uCloudShade: { value: cloudShade },
      uSunCos: { value: Math.cos(THREE.MathUtils.degToRad(1.7)) },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    // drawn LAST among opaques with a LessEqual test against its far-plane depth: the cloud/sun
    // shader then runs only on visible sky pixels (drawn first without a depth test it shaded the
    // whole screen and was overdrawn by the pier) — integrator perf fix, same image
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    fog: false,
    toneMapped: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), domeMat);
  dome.name = 'df_sky_dome';
  dome.frustumCulled = false;
  dome.renderOrder = 1e6;
  dome.matrixAutoUpdate = false;
  dome.castShadow = false;
  dome.receiveShadow = false;
  scene.add(dome);

  // ── shadow-box follow with texel snapping ──
  const lz = sunDir.clone().normalize();
  const lx = new THREE.Vector3(0, 1, 0).cross(lz);
  if (lx.lengthSq() < 1e-8) lx.set(1, 0, 0);
  lx.normalize();
  const ly = lz.clone().cross(lx).normalize();
  const texel = (2 * SUN_SHADOW.half) / SUN_SHADOW.mapSize;
  const fwd = new THREE.Vector3();
  const centre = new THREE.Vector3();
  let drift = 0;

  const rig: SkyRig = {
    sun,
    hemi,
    sunDir,
    update(dt: number, camera: THREE.Camera, focus: THREE.Vector3): void {
      if (dt > 0 && dt < 1) {
        drift += dt * 0.0035;
        placeClouds(drift);
      }
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() > 1e-6) fwd.normalize(); else fwd.set(0, 0, 0);
      centre.copy(focus).addScaledVector(fwd, SUN_SHADOW.ahead);
      let u = centre.dot(lx);
      let v = centre.dot(ly);
      const d = centre.dot(lz);
      u = Math.round(u / texel) * texel;
      v = Math.round(v / texel) * texel;
      centre.set(0, 0, 0).addScaledVector(lx, u).addScaledVector(ly, v).addScaledVector(lz, d);
      sun.target.position.copy(centre);
      sun.position.copy(centre).addScaledVector(lz, SUN_SHADOW.back);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
    },
    dispose(): void {
      scene.remove(sun, sun.target, hemi, dome);
      dome.geometry.dispose();
      domeMat.dispose();
      sun.shadow.map?.dispose();
      sun.dispose();
      hemi.dispose();
      if (scene.fog === fog) scene.fog = null;
    },
  };
  return rig;
}
