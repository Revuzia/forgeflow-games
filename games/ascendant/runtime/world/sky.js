/**
 * ASCENDANT — runtime/world/sky.js
 *
 * Custom-shader skies, one per theme type. Not a gradient texture: every sky is
 * a live shader, so it dithers away banding, animates, and can be re-rendered
 * into a cube map for image-based lighting that actually matches the backdrop.
 *
 *   gradient  multi-stop vertical gradient + horizon glow + stars + dither
 *   grid      neon: the gradient, a procedural city silhouette baked into the
 *             dome (zero extra meshes), and an infinite perspective grid plane
 *             with distance fade and a scanline sweep
 *   ember     foundry: churning animated fBm smoke + a red horizon furnace glow
 *   aurora    spire: gradient + three animated aurora ribbons + a starfield
 *   cloudsea  temple: sun disc with a bloom-friendly halo + an animated cloud
 *             layer far below the stages
 *
 * Mesh budget: the dome is ONE mesh. `grid` and `cloudsea` add exactly one more
 * (their ground/cloud plane). Everything else lives in the dome's fragment.
 *
 * Geometry tricks worth knowing:
 *  - the dome is a unit sphere that re-centres on the camera and rescales to
 *    camera.far * 0.5 in onBeforeRender, so it can never be clipped by the near
 *    or far plane no matter what the engine sets them to;
 *  - the ground planes follow the camera in XZ but shade from true world XZ, so
 *    they read as infinite while staying inside the frustum;
 *  - no per-frame allocation anywhere: update(dt) writes numbers into uniforms.
 */

import * as THREE from 'three';

/* ========================================================================== *
 * shared GLSL                                                                *
 * ========================================================================== */

const VERT_DOME = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize( position );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const VERT_PLANE = /* glsl */`
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** noise + gradient + sun + stars — prepended to every dome fragment shader */
const FRAG_COMMON = /* glsl */`
varying vec3 vDir;

uniform float uTime;
uniform vec3  uTop;
uniform vec3  uMid;
uniform vec3  uHorizon;
uniform vec3  uBottom;
uniform vec3  uGlow;
uniform float uGlowPower;
uniform float uGlowStrength;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform float uSunSize;
uniform float uSunIntensity;
uniform float uSunHalo;
uniform float uStarDensity;
uniform float uStarBrightness;
uniform float uDither;

float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

vec2 hash22( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.xx + p3.yz ) * p3.zy );
}

float vnoise2( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = hash12( i );
  float b = hash12( i + vec2( 1.0, 0.0 ) );
  float c = hash12( i + vec2( 0.0, 1.0 ) );
  float d = hash12( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}

float fbm3( vec2 p ) {
  float s = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 3; i ++ ) { s += a * vnoise2( p ); p = p * 2.03 + 17.3; a *= 0.5; }
  return s / 0.875;
}

float fbm5( vec2 p ) {
  float s = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 5; i ++ ) { s += a * vnoise2( p ); p = p * 2.03 + 17.3; a *= 0.5; }
  return s / 0.96875;
}

/** seam-free dome parameterisation: continuous everywhere, no atan wrap */
vec2 domeUv( vec3 d ) {
  return d.xz / ( d.y * 0.8 + 1.15 );
}

vec3 skyGradient( float y ) {
  float ay = clamp( y, -1.0, 1.0 );
  vec3 c;
  if ( ay > 0.0 ) {
    float t = pow( ay, 0.55 );
    c = mix( uHorizon, uMid, smoothstep( 0.0, 0.44, t ) );
    c = mix( c, uTop, smoothstep( 0.36, 1.0, t ) );
  } else {
    float t = pow( -ay, 0.70 );
    c = mix( uHorizon, uBottom, smoothstep( 0.0, 0.78, t ) );
  }
  return c;
}

vec3 horizonGlow( vec3 d ) {
  float band = pow( 1.0 - abs( d.y ), max( uGlowPower, 0.5 ) );
  vec3 hxz = vec3( d.x, 0.0, d.z );
  float hl = max( length( hxz ), 1e-4 );
  vec3 sxz = vec3( uSunDir.x, 0.0, uSunDir.z );
  float sl = max( length( sxz ), 1e-4 );
  float az = max( 0.0, dot( hxz / hl, sxz / sl ) );
  return uGlow * band * uGlowStrength * ( 0.62 + 0.75 * pow( az, 3.0 ) );
}

vec3 sunDisc( vec3 d ) {
  if ( uSunIntensity <= 0.0 ) return vec3( 0.0 );
  float sd = dot( d, uSunDir );
  float sz = max( uSunSize, 0.002 );
  float disc = smoothstep( 1.0 - sz, 1.0 - sz * 0.30, sd );
  float m = max( sd, 0.0 );
  // The old falloffs — pow(m,40)*0.35 and pow(m,6)*halo — spread the halo
  // across ~35 degrees of dome. Over a pale sky that whole region crossed the
  // bloom threshold and rendered as a giant off-sun blowout (spire-1_0's
  // left-edge blob, 2026-08-31 uniform probe: uSunIntensity 0 removed it).
  // Tight glare instead: gone within a few degrees of the disc.
  float halo = pow( m, 900.0 ) * 0.9 + pow( m, 300.0 ) * 0.30 + pow( m, 24.0 ) * uSunHalo * 0.45;
  return uSunColor * ( disc * uSunIntensity + halo * uSunIntensity * 0.45 );
}

vec3 starField( vec3 d ) {
  if ( uStarDensity <= 0.0 ) return vec3( 0.0 );
  vec3 a = abs( d );
  vec2 uv;
  if ( a.y >= a.x && a.y >= a.z )      uv = d.xz / max( a.y, 1e-3 );
  else if ( a.x >= a.z )               uv = d.zy / max( a.x, 1e-3 );
  else                                 uv = d.xy / max( a.z, 1e-3 );
  vec2 g = uv * 190.0;
  vec2 id = floor( g );
  vec2 f = fract( g ) - 0.5;
  vec2 j = hash22( id ) - 0.5;
  float bright = hash12( id + 17.77 );
  float on = step( 1.0 - uStarDensity * 0.075, bright );
  float dd = length( f - j * 0.72 );
  float core = smoothstep( 0.10, 0.0, dd );
  float tw = 0.55 + 0.45 * sin( uTime * ( 1.2 + bright * 3.4 ) + bright * 47.0 );
  float sky = smoothstep( -0.03, 0.30, d.y );
  vec3 tint = mix( vec3( 0.80, 0.88, 1.0 ), vec3( 1.0, 0.92, 0.80 ), hash12( id + 3.3 ) );
  return tint * ( on * core * tw * ( 0.35 + bright ) * uStarBrightness * sky );
}

/** ordered-ish dither: kills 8-bit banding across a big smooth gradient.
 *  Applied AFTER the tonemapping/colorspace includes (display-referred): added
 *  in linear before ACES it was compressed below one display LSB exactly where
 *  banding shows most — the dark zenith (2026-08-31 critic pass, neon-1_1).
 *  Under the composer those includes are no-ops (LinearSRGB HDR target) and
 *  the post chain's own output dither owns the final 8-bit boundary. */
vec3 skyDither( vec2 c ) {
  return vec3( ( hash12( c ) - 0.5 ) * uDither * ( 1.6 / 255.0 ) );
}
`;

/* ------------------------------------------------------------- gradient -- */

const FRAG_GRADIENT = FRAG_COMMON + /* glsl */`
void main() {
  vec3 d = normalize( vDir );
  vec3 col = skyGradient( d.y );
  col += horizonGlow( d );
  col += starField( d );
  col += sunDisc( d );
  gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += skyDither( gl_FragCoord.xy );
}
`;

/* ----------------------------------------------------------------- grid -- */
/* The city is procedural silhouette geometry evaluated in the fragment shader:
 * two overlapping ranges of blocks whose heights come from a hash of the block
 * index, plus a lit-window field and a rim glow along the roofline. No meshes,
 * no textures, no impostor cards to pop. */

const FRAG_GRID_DOME = FRAG_COMMON + /* glsl */`
uniform vec3  uCityColor;
uniform vec3  uCityGlow;
uniform float uCityHeight;
uniform float uCityDensity;
uniform float uCityBand;

float blockRow( float u, float seed, float hScale, out float lit ) {
  float i = floor( u );
  float r = hash12( vec2( i, seed ) );
  float w = 0.30 + 0.52 * hash12( vec2( i, seed + 4.0 ) );
  float inBlock = step( abs( fract( u ) - 0.5 ), w * 0.5 );
  lit = hash12( vec2( i, seed + 9.0 ) );
  return inBlock * ( 0.22 + 0.78 * r * r ) * hScale;
}

void main() {
  vec3 d = normalize( vDir );

  vec3 col = skyGradient( d.y );
  col += horizonGlow( d );
  col += starField( d );

  // ---- city silhouette ---------------------------------------------------
  vec3 hxz = vec3( d.x, 0.0, d.z );
  float hl = max( length( hxz ), 1e-4 );
  float ang = atan( hxz.z / hl, hxz.x / hl );
  float u = ( ang / 6.2831853 + 0.5 ) * uCityDensity;

  float litA, litB;
  float hA = blockRow( u, 3.0, uCityHeight, litA );
  float hB = blockRow( u * 0.61 + 11.0, 21.0, uCityHeight * 0.68, litB );
  float H = max( hA, hB );
  float lit = ( hA >= hB ) ? litA : litB;

  float base = smoothstep( -uCityBand - 0.05, -uCityBand + 0.02, d.y );
  float mass = smoothstep( H + 0.0035, H - 0.0035, d.y ) * base;

  // lit windows, denser on the taller face
  vec2 wg = vec2( u * 7.0, ( d.y / max( H, 0.02 ) ) * 26.0 );
  vec2 wid = floor( wg );
  float wOn = step( 0.63, hash12( wid + lit * 31.0 ) );
  float wCell = step( abs( fract( wg.x ) - 0.5 ), 0.26 ) * step( abs( fract( wg.y ) - 0.5 ), 0.30 );
  float windows = wOn * wCell * mass * step( 0.0, d.y ) * ( 0.35 + 0.65 * lit );

  float roof = exp( -abs( d.y - H ) * 340.0 ) * base * ( 0.35 + 0.65 * lit );

  col = mix( col, uCityColor, mass * 0.94 );
  col += uCityGlow * ( roof * 0.85 + windows * 0.55 );
  col += uCityGlow * mass * 0.06;

  col += sunDisc( d );
  gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += skyDither( gl_FragCoord.xy );
}
`;

const FRAG_GRID_PLANE = /* glsl */`
varying vec3 vW;
uniform float uTime;
uniform vec3  uGridColor;
uniform vec3  uScanColor;
uniform float uSpacing;
uniform float uLineW;
uniform float uFade;
uniform float uGlow;
uniform float uScanSpeed;
uniform float uScanWidth;

float gridLine( vec2 g, float w ) {
  vec2 fw = fwidth( g );
  vec2 a = abs( fract( g - 0.5 ) - 0.5 ) / max( fw * w, vec2( 1e-5 ) );
  return 1.0 - min( min( a.x, a.y ), 1.0 );
}

void main() {
  vec2 g  = vW.xz / max( uSpacing, 0.01 );
  vec2 g2 = vW.xz / max( uSpacing * 8.0, 0.08 );

  float minor = gridLine( g,  1.0 + uLineW * 8.0 );
  float major = gridLine( g2, 1.0 + uLineW * 10.0 );

  float dist = length( vW.xz - cameraPosition.xz );
  float fade = 1.0 - smoothstep( uFade * 0.12, uFade, dist );
  fade *= fade;

  float sweep = fract( dist / max( uFade, 1.0 ) - uTime * uScanSpeed );
  float scan = smoothstep( uScanWidth, 0.0, sweep );

  vec3 col = uGridColor * ( minor * 0.5 + major * 1.15 ) * uGlow;
  col += uScanColor * scan * ( minor * 0.55 + major * 0.9 + 0.10 );

  float a = clamp( minor * 0.55 + major * 0.95 + scan * 0.22, 0.0, 1.0 ) * fade;
  gl_FragColor = vec4( col * fade, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ---------------------------------------------------------------- ember -- */

const FRAG_EMBER = FRAG_COMMON + /* glsl */`
uniform vec3  uSmokeColor;
uniform vec3  uSmokeDark;
uniform vec3  uGlowColor;
uniform vec3  uEmberGlow;
uniform float uSmokeScale;
uniform float uSmokeSpeed;
uniform float uSmokeWarp;
uniform float uSmokeContrast;
uniform float uGlowHeight;
uniform float uFurnace;
uniform float uSeaStrength;
uniform float uSeaScale;
uniform float uSeaSpeed;

void main() {
  vec3 d = normalize( vDir );
  vec2 sp = domeUv( d ) * uSmokeScale;
  float t = uTime * uSmokeSpeed;

  // two-pass domain warp -> the smoke churns instead of sliding
  vec2 q = vec2(
    fbm3( sp + vec2( 0.0, t * 1.7 ) ),
    fbm3( sp + vec2( 5.2, 1.3 ) - vec2( t * 1.1, 0.0 ) )
  );
  vec2 r = vec2(
    fbm3( sp + q * uSmokeWarp * 4.0 + vec2( 1.7, 9.2 ) + vec2( t * 0.6, -t * 0.4 ) ),
    fbm3( sp + q * uSmokeWarp * 4.0 + vec2( 8.3, 2.8 ) + vec2( -t * 0.35, t * 0.5 ) )
  );
  float f = fbm5( sp + r * uSmokeWarp * 3.2 + vec2( t * 0.30, -t * 0.18 ) );
  f = clamp( f, 0.0, 1.0 );
  f = pow( f, uSmokeContrast );

  vec3 col = skyGradient( d.y );
  vec3 smoke = mix( uSmokeDark, uSmokeColor, f );
  // smoke thickens toward the zenith where the extraction hoods are
  float lid = smoothstep( -0.10, 0.85, d.y );
  col = mix( col, smoke, lid * 0.88 );

  // ---- the lava SEA on the below-horizon dome ---------------------------
  // Dark basalt plates threaded by glowing channels, so a downward or level
  // glance shows molten ground instead of a featureless gradient. Faded out
  // right at the horizon line (the divisor blows up there) and strongest
  // looking down.
  if ( uSeaStrength > 0.001 && d.y < -0.015 ) {
    float away = smoothstep( 0.03, 0.30, -d.y );
    vec2 sq = ( d.xz / max( -d.y * 0.9 + 0.08, 0.06 ) ) * uSeaScale * 0.12;
    float ts = uTime * uSeaSpeed;
    float crust = fbm5( sq + vec2( ts, -ts * 0.6 ) );
    float veins = 1.0 - abs( crust * 2.0 - 1.0 );
    veins = veins * veins * veins;
    float plates = fbm3( sq * 2.7 + 13.1 );
    // distance attenuation: near the horizon the projection compresses the
    // vein field to sub-pixel frequency whose AVERAGE is bright — unattenuated
    // it rendered as a solid glowing band that bloom then flooded.
    float att = 1.0 / ( 1.0 + dot( sq, sq ) * 0.0045 );
    vec3 crustCol = mix( uSmokeDark, uSmokeColor, plates * 0.55 );
    col = mix( col, crustCol, uSeaStrength * away * 0.85 );
    col += uGlowColor * smoothstep( 0.42, 0.92, veins + plates * 0.18 )
         * uSeaStrength * away * att * 0.60;
    col += uEmberGlow * pow( veins, 6.0 ) * uSeaStrength * away * att * 0.65;
  }

  // furnace glow lighting the underside of the smoke from below the horizon
  float low = pow( clamp( 1.0 - ( d.y + 0.06 ) / max( uGlowHeight, 0.02 ), 0.0, 1.0 ), 2.0 );
  col += uGlowColor * low * uFurnace * ( 0.45 + 0.85 * f );
  col += horizonGlow( d );

  // hot pockets churning inside the smoke ceiling
  float pocket = smoothstep( 0.62, 0.96, f ) * smoothstep( 0.0, 0.55, d.y );
  col += uEmberGlow * pocket * 0.22;

  col += sunDisc( d );
  gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += skyDither( gl_FragCoord.xy );
}
`;

/* --------------------------------------------------------------- aurora -- */

const FRAG_AURORA = FRAG_COMMON + /* glsl */`
uniform vec3  uAuroraA;
uniform vec3  uAuroraB;
uniform float uAuroraSpeed;
uniform float uAuroraHeight;
uniform float uAuroraStrength;
uniform float uAuroraBands;

void main() {
  vec3 d = normalize( vDir );
  vec3 col = skyGradient( d.y );
  col += horizonGlow( d );
  col += starField( d );

  if ( d.y > 0.10 ) {
    vec2 sp = domeUv( d );
    float t = uTime * uAuroraSpeed;
    float acc = 0.0;
    float striaeAcc = 0.0;
    for ( int i = 0; i < 3; i ++ ) {
      float fi = float( i );
      if ( fi >= uAuroraBands ) break;
      float w = fbm3( sp * ( 1.15 + fi * 0.55 ) + vec2( t * ( 1.0 + fi * 0.42 ), fi * 3.7 ) );
      // excursion was 0.36: a constructive fold could drop a ribbon to ~10 deg
      // elevation, where it summed over the pale horizon band into an HDR blob
      // that bloomed into the unexplained left-edge blowout (spire-1_0/1_1,
      // 2026-08-31 critic pass + toggle probe). Tighter excursion, ribbons
      // clamped to the darker upper sky where they actually read as aurora.
      float centre = uAuroraHeight + fi * 0.115 + ( w - 0.5 ) * 0.22;
      float s = exp( -abs( d.y - centre ) * ( 15.0 - fi * 3.2 ) );
      float striae = 0.60 + 0.40 * sin( sp.x * ( 22.0 + fi * 9.0 ) + w * 14.0 + t * 3.1 );
      acc += s * striae * ( 1.0 - fi * 0.22 );
      striaeAcc += s;
    }
    acc = min( acc, 1.3 ) * smoothstep( 0.12, 0.30, d.y );
    vec3 ribbon = mix( uAuroraA, uAuroraB, clamp( d.y * 1.5, 0.0, 1.0 ) );
    col += ribbon * acc * uAuroraStrength;
    // a faint wash under the ribbons, the way real aurora lights the whole sky
    col += ribbon * min( striaeAcc, 1.5 ) * uAuroraStrength * 0.06;
  }

  col += sunDisc( d );
  gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += skyDither( gl_FragCoord.xy );
}
`;

/* ------------------------------------------------------------- cloudsea -- */

const FRAG_CLOUDSEA_DOME = FRAG_COMMON + /* glsl */`
void main() {
  vec3 d = normalize( vDir );
  vec3 col = skyGradient( d.y );
  col += horizonGlow( d );

  // high cirrus, barely there, gives the sun something to sit behind
  vec2 sp = domeUv( d ) * 1.6;
  float cir = fbm5( sp * 1.8 + vec2( uTime * 0.004, uTime * 0.0016 ) );
  cir = smoothstep( 0.55, 0.92, cir ) * smoothstep( 0.02, 0.42, d.y );
  col = mix( col, mix( col, uSunColor, 0.45 ), cir * 0.30 );

  col += starField( d );
  col += sunDisc( d );
  gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += skyDither( gl_FragCoord.xy );
}
`;

const FRAG_CLOUD_PLANE = /* glsl */`
varying vec3 vW;
uniform float uTime;
uniform vec3  uLit;
uniform vec3  uShadow;
uniform vec3  uSunDir;
uniform float uScale;
uniform float uSpeed;
uniform float uCoverage;
uniform float uSharp;
uniform float uFade;

float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

float vnoise2( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = hash12( i );
  float b = hash12( i + vec2( 1.0, 0.0 ) );
  float c = hash12( i + vec2( 0.0, 1.0 ) );
  float dd = hash12( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, dd, f.x ), f.y );
}

float fbm3( vec2 p ) {
  float s = 0.0; float a = 0.5;
  for ( int i = 0; i < 3; i ++ ) { s += a * vnoise2( p ); p = p * 2.03 + 17.3; a *= 0.5; }
  return s / 0.875;
}

float fbm5( vec2 p ) {
  float s = 0.0; float a = 0.5;
  for ( int i = 0; i < 5; i ++ ) { s += a * vnoise2( p ); p = p * 2.03 + 17.3; a *= 0.5; }
  return s / 0.96875;
}

void main() {
  vec2 p = vW.xz * uScale;
  float t = uTime * uSpeed;

  vec2 q = vec2( fbm3( p + vec2( 0.0, t ) ), fbm3( p + vec2( 3.3, -t * 0.8 ) ) );
  float f = fbm5( p * 1.35 + q * 1.25 + vec2( t * 0.45, t * 0.17 ) );

  float edge = 1.0 - uCoverage;
  float cov = smoothstep( edge, edge + 0.26, f );
  cov = pow( clamp( cov, 0.0, 1.0 ), max( uSharp, 0.1 ) );

  float lit = smoothstep( 0.34, 0.90, f );
  vec3 col = mix( uShadow, uLit, lit );

  // sun-side rim: the cloud tops facing the sun blow out into the bloom
  vec2 sxz = normalize( vec2( uSunDir.x, uSunDir.z ) + vec2( 1e-4, 1e-4 ) );
  float grad = fbm3( p * 1.35 + sxz * 0.55 + q * 1.25 ) - f;
  col += uLit * clamp( grad * 3.0, 0.0, 1.0 ) * 0.45 * lit;

  float dist = length( vW.xz - cameraPosition.xz );
  float fade = 1.0 - smoothstep( uFade * 0.30, uFade, dist );

  gl_FragColor = vec4( col, clamp( cov, 0.0, 1.0 ) * fade );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ========================================================================== *
 * uniform plumbing                                                           *
 * ========================================================================== */

function C(hex, fallback) {
  return new THREE.Color(hex === undefined || hex === null ? (fallback || 0x000000) : hex);
}
function N(v, fallback) {
  return (typeof v === 'number' && isFinite(v)) ? v : fallback;
}
function V3(arr, x, y, z) {
  const v = new THREE.Vector3(
    (arr && isFinite(arr[0])) ? arr[0] : x,
    (arr && isFinite(arr[1])) ? arr[1] : y,
    (arr && isFinite(arr[2])) ? arr[2] : z);
  if (v.lengthSq() < 1e-9) v.set(0, 1, 0);
  return v.normalize();
}

function commonUniforms(p) {
  return {
    uTime: { value: 0 },
    uTop: { value: C(p.top, 0x0a1020) },
    uMid: { value: C(p.mid, 0x152036) },
    uHorizon: { value: C(p.horizon, 0x24304c) },
    uBottom: { value: C(p.bottom, 0x05070c) },
    uGlow: { value: C(p.horizonGlow, 0x4060a0) },
    uGlowPower: { value: N(p.glowPower, 5.0) },
    uGlowStrength: { value: N(p.glowStrength, 0.6) },
    uSunDir: { value: V3(p.sunDir, 0, 0.4, 1) },
    uSunColor: { value: C(p.sunColor, 0xffffff) },
    uSunSize: { value: N(p.sunSize, 0.0) },
    uSunIntensity: { value: N(p.sunIntensity, 0.0) },
    uSunHalo: { value: N(p.sunHalo, 0.35) },
    uStarDensity: { value: N(p.starDensity, 0.0) },
    uStarBrightness: { value: N(p.starBrightness, 0.3) },
    uDither: { value: N(p.dither, 1.0) },
  };
}

/* ========================================================================== *
 * Sky                                                                        *
 * ========================================================================== */

/* hoisted — onBeforeRender runs up to 7x per frame (main + 6 cube faces) */
const _camPos = new THREE.Vector3();

function domeBeforeRender(renderer, scene, camera) {
  _camPos.setFromMatrixPosition(camera.matrixWorld);
  this.position.copy(_camPos);
  if (this.parent) this.parent.worldToLocal(this.position);
  const far = (typeof camera.far === 'number' && camera.far > 1) ? camera.far : 1000;
  this.scale.setScalar(far * 0.5);
  this.updateMatrix();
  if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
  else this.matrixWorld.copy(this.matrix);
  this.matrixWorldNeedsUpdate = false;
}

function planeBeforeRender(renderer, scene, camera) {
  _camPos.setFromMatrixPosition(camera.matrixWorld);
  this.position.set(_camPos.x, this.userData.planeY, _camPos.z);
  if (this.parent) this.parent.worldToLocal(this.position);
  const far = (typeof camera.far === 'number' && camera.far > 1) ? camera.far : 1000;
  const s = Math.max(60, far * 0.85);
  this.scale.set(s, s, 1);
  this.updateMatrix();
  if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
  else this.matrixWorld.copy(this.matrix);
  this.matrixWorldNeedsUpdate = false;
}

/**
 * The sky for one theme. It IS an Object3D — add it straight to the scene.
 * Call `update(dt)` once per frame.
 */
export class Sky extends THREE.Object3D {
  constructor(themeDef) {
    super();

    const def = themeDef || {};
    const skyDef = def.sky || { type: 'gradient', params: {} };
    const p = skyDef.params || {};
    const type = skyDef.type || 'gradient';

    this.name = 'asc.sky.' + (def.id || type);
    this.type = 'AscendantSky';
    this.skyType = type;
    this.frustumCulled = false;
    // the root keeps automatic matrix updates: only the two camera-locked
    // meshes below drive their own matrices, from onBeforeRender.

    this._t = 0;
    this._timeUniforms = [];
    this._materials = [];
    this._geometries = [];

    /* ---------------- dome ------------------------------------------------ */
    let frag = FRAG_GRADIENT;
    let uniforms = commonUniforms(p);

    if (type === 'grid') {
      frag = FRAG_GRID_DOME;
      uniforms.uCityColor = { value: C(p.cityColor, 0x0e0824) };
      uniforms.uCityGlow = { value: C(p.cityGlow, 0xff3fa8) };
      uniforms.uCityHeight = { value: N(p.cityHeight, 0.26) };
      uniforms.uCityDensity = { value: N(p.cityDensity, 34) };
      uniforms.uCityBand = { value: N(p.cityBand, 0.09) };
    } else if (type === 'ember') {
      frag = FRAG_EMBER;
      uniforms.uSmokeColor = { value: C(p.smokeColor, 0x2e1c15) };
      uniforms.uSmokeDark = { value: C(p.smokeDark, 0x070403) };
      uniforms.uGlowColor = { value: C(p.glowColor, 0xff6a1a) };
      uniforms.uEmberGlow = { value: C(p.emberGlow, 0xffa04a) };
      uniforms.uSmokeScale = { value: N(p.smokeScale, 2.4) };
      uniforms.uSmokeSpeed = { value: N(p.smokeSpeed, 0.022) };
      uniforms.uSmokeWarp = { value: N(p.smokeWarp, 0.35) };
      uniforms.uSmokeContrast = { value: N(p.smokeContrast, 1.35) };
      uniforms.uGlowHeight = { value: N(p.glowHeight, 0.26) };
      uniforms.uFurnace = { value: N(p.furnace, 0.6) };
      uniforms.uSeaStrength = { value: N(p.seaStrength, 1.0) };
      uniforms.uSeaScale = { value: N(p.seaScale, 5.0) };
      uniforms.uSeaSpeed = { value: N(p.seaSpeed, 0.010) };
    } else if (type === 'aurora') {
      frag = FRAG_AURORA;
      uniforms.uAuroraA = { value: C(p.auroraA, 0x4affc8) };
      uniforms.uAuroraB = { value: C(p.auroraB, 0x7f9cff) };
      uniforms.uAuroraSpeed = { value: N(p.auroraSpeed, 0.055) };
      uniforms.uAuroraHeight = { value: N(p.auroraHeight, 0.34) };
      uniforms.uAuroraStrength = { value: N(p.auroraStrength, 0.55) };
      uniforms.uAuroraBands = { value: N(p.auroraBands, 3.0) };
    } else if (type === 'cloudsea') {
      frag = FRAG_CLOUDSEA_DOME;
    }

    const domeGeo = new THREE.SphereGeometry(1, 40, 24);
    const domeMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT_DOME,
      fragmentShader: frag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      transparent: false,
      fog: false,
      toneMapped: true,
    });

    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.name = 'asc.sky.dome';
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    dome.matrixAutoUpdate = false;
    dome.onBeforeRender = domeBeforeRender;
    this.add(dome);
    this.dome = dome;
    this._timeUniforms.push(uniforms.uTime);
    this._materials.push(domeMat);
    this._geometries.push(domeGeo);

    /* ---------------- ground plane (grid / cloudsea only) ----------------- */
    this.plane = null;

    if (type === 'grid') {
      const gu = {
        uTime: { value: 0 },
        uGridColor: { value: C(p.gridColor, 0x22d3ee) },
        uScanColor: { value: C(p.scanColor, 0x9ffcff) },
        uSpacing: { value: N(p.gridSpacing, 4.0) },
        uLineW: { value: N(p.gridLine, 0.030) },
        uFade: { value: N(p.gridFade, 520) },
        uGlow: { value: N(p.gridGlow, 0.60) },
        uScanSpeed: { value: N(p.scanSpeed, 0.085) },
        uScanWidth: { value: N(p.scanWidth, 0.028) },
      };
      const geo = new THREE.PlaneGeometry(2, 2, 1, 1);
      const mat = new THREE.ShaderMaterial({
        uniforms: gu,
        vertexShader: VERT_PLANE,
        fragmentShader: FRAG_GRID_PLANE,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: true,
      });
      const plane = new THREE.Mesh(geo, mat);
      plane.name = 'asc.sky.grid';
      plane.rotation.x = -Math.PI / 2;
      plane.userData.planeY = N(p.gridY, -26);
      plane.frustumCulled = false;
      plane.renderOrder = -900;
      plane.matrixAutoUpdate = false;
      plane.onBeforeRender = planeBeforeRender;
      this.add(plane);
      this.plane = plane;
      this._timeUniforms.push(gu.uTime);
      this._materials.push(mat);
      this._geometries.push(geo);
    } else if (type === 'cloudsea') {
      const cu = {
        uTime: { value: 0 },
        uLit: { value: C(p.cloudLit, 0xfff2dc) },
        uShadow: { value: C(p.cloudShadow, 0x8fa4c4) },
        uSunDir: { value: V3(p.sunDir, -0.56, 0.19, 0.60) },
        uScale: { value: N(p.cloudScale, 0.018) },
        uSpeed: { value: N(p.cloudSpeed, 0.010) },
        uCoverage: { value: N(p.cloudCoverage, 0.52) },
        uSharp: { value: N(p.cloudSharp, 2.2) },
        uFade: { value: N(p.cloudFade, 700) },
      };
      const geo = new THREE.PlaneGeometry(2, 2, 1, 1);
      const mat = new THREE.ShaderMaterial({
        uniforms: cu,
        vertexShader: VERT_PLANE,
        fragmentShader: FRAG_CLOUD_PLANE,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: true,
      });
      const plane = new THREE.Mesh(geo, mat);
      plane.name = 'asc.sky.cloudsea';
      plane.rotation.x = -Math.PI / 2;
      plane.userData.planeY = N(p.cloudY, -62);
      plane.frustumCulled = false;
      plane.renderOrder = -900;
      plane.matrixAutoUpdate = false;
      plane.onBeforeRender = planeBeforeRender;
      this.add(plane);
      this.plane = plane;
      this._timeUniforms.push(cu.uTime);
      this._materials.push(mat);
      this._geometries.push(geo);
    }
  }

  /** advance every animated uniform. Allocation-free. */
  update(dt) {
    const d = (typeof dt === 'number' && isFinite(dt)) ? Math.min(Math.max(dt, 0), 0.25) : 0;
    this._t += d;
    // wrap so 32-bit float precision never degrades the noise after a long run
    if (this._t > 100000) this._t -= 100000;
    const t = this._t;
    for (let i = 0; i < this._timeUniforms.length; i++) this._timeUniforms[i].value = t;
  }

  /** current sky clock, in seconds */
  get elapsed() { return this._t; }

  dispose() {
    for (let i = 0; i < this._materials.length; i++) this._materials[i].dispose();
    for (let i = 0; i < this._geometries.length; i++) this._geometries[i].dispose();
    this._materials.length = 0;
    this._geometries.length = 0;
    this._timeUniforms.length = 0;
    this.clear();
    if (this.parent) this.parent.remove(this);
  }
}

/**
 * Build the sky for a ThemeDef.
 * @param {object} themeDef
 * @returns {THREE.Object3D} a Sky (which is an Object3D) — add it to the scene
 *                           and call `.update(dt)` each frame.
 */
export function buildSky(themeDef) {
  return new Sky(themeDef);
}

/* ========================================================================== *
 * environment cube map                                                       *
 * ========================================================================== */

/**
 * Render this theme's sky into a small cube target and pre-filter it with
 * PMREMGenerator, so PBR reflections and the ambient IBL come from the actual
 * backdrop rather than from a neutral studio probe. 128 px is plenty — PMREM
 * blurs it by roughness anyway and the sky has no high-frequency content that
 * survives the first mip.
 *
 * The returned texture owns its render target: calling `.dispose()` on it frees
 * both.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} themeDef
 * @param {number} [size=128]
 * @returns {THREE.Texture|null}
 */
export function buildEnvCubemap(renderer, themeDef, size) {
  if (!renderer) return null;
  const res = (typeof size === 'number' && size >= 16) ? size : 128;

  const scene = new THREE.Scene();
  const sky = new Sky(themeDef);
  sky.update(0);
  scene.add(sky);

  let cubeRT = null;
  let pmrem = null;
  let target = null;

  try {
    cubeRT = new THREE.WebGLCubeRenderTarget(res, {
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
    });
    const cam = new THREE.CubeCamera(0.5, 4000, cubeRT);
    cam.update(renderer, scene);

    pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileCubemapShader();
    target = pmrem.fromCubemap(cubeRT.texture);
  } catch (e) {
    console.warn('[sky] buildEnvCubemap failed', e);
    if (target) { target.dispose(); target = null; }
  } finally {
    if (pmrem) pmrem.dispose();
    if (cubeRT) cubeRT.dispose();
    scene.remove(sky);
    sky.dispose();
  }

  if (!target) return null;

  const env = target.texture;
  env.name = 'asc.env.' + ((themeDef && themeDef.id) || 'theme');
  // hand ownership of the render target to the texture so callers only need
  // to know about one object
  env.dispose = function () { target.dispose(); };
  return env;
}

export default Sky;
