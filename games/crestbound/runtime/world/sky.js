/**
 * CRESTBOUND — runtime/world/sky.js
 * CONTRACT §16.
 *
 * Custom-shader skies, one per theme type. Not a gradient texture: every sky
 * is a live shader, so it dithers away banding, animates, and can be
 * re-rendered into a cube map for image-based lighting that actually matches
 * the backdrop a player is standing under.
 *
 *   gradient  the base: multi-stop vertical gradient + horizon glow + stars
 *   day       VERDANT: the gradient plus a procedural CUMULUS deck scrolling
 *             across the dome, a compact sun disc and a tight halo
 *   sunset    the same sky an hour later: banded stratus, a huge low sun and
 *             a horizon glow that owns the lower third
 *   furnace   EMBER: churning animated fBm smoke overhead, a lava SEA on the
 *             below-horizon dome, a red furnace glow lighting the smoke from
 *             underneath, and rising spark pockets
 *   aurora    RIME: gradient + three animated aurora curtains + a starfield
 *   sanctum   THE KEEP + AZURE: bright, high-key, with a faint RAINBOW ARC
 *             around the anti-solar point, a ring of floating-island
 *             silhouettes on the horizon, a second higher ring of small
 *             floating islands, and a light cumulus deck
 *
 * Mesh budget: the dome is ONE mesh, and every type above lives entirely
 * inside its fragment shader — no cloud planes, no impostor cards, nothing to
 * pop. `makeGodRays()` adds one more mesh per shaft cluster, and that is the
 * only other geometry this module ever creates.
 *
 * Geometry tricks worth knowing:
 *  - the dome is a unit sphere that re-centres on the camera and rescales to
 *    `camera.far * 0.5` in `onBeforeRender`, so it can never be clipped by the
 *    near or far plane no matter what the engine sets them to;
 *  - it renders with `depthTest:false`, `depthWrite:false` and
 *    `renderOrder:-1000`, so it is always the first thing drawn and always
 *    behind everything;
 *  - `matrixAutoUpdate` is off and the dome writes its own `matrixWorld` —
 *    `onBeforeRender` runs up to SEVEN times per frame while the environment
 *    cube camera is baking, so nothing in that path may allocate.
 *
 * No per-frame allocation anywhere: `update(dt)` writes numbers into uniforms.
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

/** azimuth 0..count around the dome — the parameter every horizon band uses */
float domeAzimuth( vec3 d, float count ) {
  vec3 hxz = vec3( d.x, 0.0, d.z );
  float hl = max( length( hxz ), 1e-4 );
  float ang = atan( hxz.z / hl, hxz.x / hl );
  return ( ang / 6.2831853 + 0.5 ) * count;
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

/**
 * The sun. TIGHT glare on purpose: a wide halo over a pale sky crosses the
 * bloom threshold across tens of degrees of dome and renders as a giant
 * off-sun blowout. Everything here is gone within a few degrees of the disc.
 */
vec3 sunDisc( vec3 d ) {
  if ( uSunIntensity <= 0.0 ) return vec3( 0.0 );
  float sd = dot( d, uSunDir );
  float sz = max( uSunSize, 0.002 );
  float disc = smoothstep( 1.0 - sz, 1.0 - sz * 0.30, sd );
  float m = max( sd, 0.0 );
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
 *  Applied AFTER the tonemapping/colorspace includes (display-referred): in
 *  linear before ACES it is compressed below one display LSB exactly where
 *  banding shows most — the dark zenith. */
vec3 skyDither( vec2 c ) {
  return vec3( ( hash12( c ) - 0.5 ) * uDither * ( 1.6 / 255.0 ) );
}
`;

/** cumulus deck — shared by `day`, `sunset` and `sanctum` */
const FRAG_CLOUDS = /* glsl */`
uniform vec3  uCloudLit;
uniform vec3  uCloudShadow;
uniform float uCloudStrength;
uniform float uCloudScale;
uniform float uCloudSpeed;
uniform float uCloudCoverage;
uniform float uCloudSharp;

/**
 * A cumulus field evaluated straight on the dome. Two-pass domain warp so the
 * cells BILLOW instead of sliding, coverage/sharpness give the difference
 * between fair-weather puffs and an overcast lid, and the sun-facing side of
 * every cell picks up a rim.
 * Returns rgb = cloud colour, a = coverage 0..1.
 */
vec4 domeCumulus( vec3 d ) {
  if ( uCloudStrength <= 0.001 || d.y < 0.005 ) return vec4( 0.0 );
  vec2 p = domeUv( d ) * uCloudScale;
  float t = uTime * uCloudSpeed;

  vec2 q = vec2( fbm3( p + vec2( 0.0, t ) ), fbm3( p + vec2( 3.3, -t * 0.8 ) ) );
  float f = fbm5( p * 1.35 + q * 1.25 + vec2( t * 0.45, t * 0.17 ) );

  float edge = 1.0 - clamp( uCloudCoverage, 0.0, 0.98 );
  float cov = smoothstep( edge, edge + 0.24, f );
  cov = pow( clamp( cov, 0.0, 1.0 ), max( uCloudSharp, 0.1 ) );
  // fade in off the horizon and thin out toward the zenith (perspective)
  cov *= smoothstep( 0.01, 0.11, d.y ) * ( 1.0 - 0.45 * smoothstep( 0.45, 1.0, d.y ) );

  float lit = smoothstep( 0.32, 0.90, f );
  vec3 col = mix( uCloudShadow, uCloudLit, lit );
  float sd = max( dot( d, uSunDir ), 0.0 );
  col += uCloudLit * pow( sd, 10.0 ) * 0.55 * lit;

  return vec4( col, clamp( cov, 0.0, 1.0 ) * uCloudStrength );
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

/* ------------------------------------------------------------------ day -- */

const FRAG_DAY = FRAG_COMMON + FRAG_CLOUDS + /* glsl */`
void main() {
  vec3 d = normalize( vDir );
  vec3 col = skyGradient( d.y );
  col += horizonGlow( d );

  // the sun sits BEHIND the cloud deck, so it is composited first
  col += sunDisc( d );

  vec4 cl = domeCumulus( d );
  col = mix( col, cl.rgb, cl.a );

  // a thin high cirrus veil above the cumulus, barely there
  vec2 sp = domeUv( d ) * 3.1;
  float cir = fbm5( sp + vec2( uTime * 0.0035, uTime * 0.0014 ) );
  cir = smoothstep( 0.60, 0.95, cir ) * smoothstep( 0.10, 0.55, d.y );
  col = mix( col, mix( col, uCloudLit, 0.55 ), cir * 0.22 );

  gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += skyDither( gl_FragCoord.xy );
}
`;

/* --------------------------------------------------------------- sunset -- */

const FRAG_SUNSET = FRAG_COMMON + FRAG_CLOUDS + /* glsl */`
void main() {
  vec3 d = normalize( vDir );
  vec3 col = skyGradient( d.y );

  // banded stratus: cumulus noise squashed hard on the elevation axis, so the
  // cells stretch into the long horizontal bars a low sun lights from beneath
  vec2 sp = domeUv( d );
  float t = uTime * uCloudSpeed;
  float band = fbm5( vec2( sp.x * uCloudScale * 0.55 + t, sp.y * uCloudScale * 3.4 ) );
  float bandCov = smoothstep( 1.0 - uCloudCoverage, 1.0 - uCloudCoverage + 0.20, band );
  bandCov *= smoothstep( 0.0, 0.16, d.y ) * ( 1.0 - smoothstep( 0.35, 0.85, d.y ) );

  // underside glow: the sun is below/behind, so the bars are lit from beneath
  float sd = max( dot( d, uSunDir ), 0.0 );
  vec3 barCol = mix( uCloudShadow, uCloudLit, smoothstep( 0.35, 0.9, band ) );
  barCol += uSunColor * pow( sd, 4.0 ) * 0.85;
  col = mix( col, barCol, bandCov * uCloudStrength );

  col += horizonGlow( d );
  col += starField( d );
  col += sunDisc( d );

  gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += skyDither( gl_FragCoord.xy );
}
`;

/* -------------------------------------------------------------- furnace -- */

const FRAG_FURNACE = FRAG_COMMON + /* glsl */`
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
uniform float uSparkStrength;

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
  // glance shows molten ground instead of a featureless gradient.
  if ( uSeaStrength > 0.001 && d.y < -0.015 ) {
    float away = smoothstep( 0.03, 0.30, -d.y );
    vec2 sq = ( d.xz / max( -d.y * 0.9 + 0.08, 0.06 ) ) * uSeaScale * 0.12;
    float ts = uTime * uSeaSpeed;
    float crust = fbm5( sq + vec2( ts, -ts * 0.6 ) );
    float veins = 1.0 - abs( crust * 2.0 - 1.0 );
    veins = veins * veins * veins;
    float plates = fbm3( sq * 2.7 + 13.1 );
    // distance attenuation: near the horizon the projection compresses the
    // vein field to sub-pixel frequency whose AVERAGE is bright — un-attenuated
    // it renders as a solid glowing band that bloom then floods.
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

  // ---- rising sparks: a sparse point field drifting UP through the smoke --
  if ( uSparkStrength > 0.001 ) {
    vec2 g = domeUv( d ) * 34.0;
    g.y -= uTime * 0.55;                       // the drift
    vec2 id = floor( g );
    vec2 fr = fract( g ) - 0.5;
    vec2 j = hash22( id ) - 0.5;
    float on = step( 0.965, hash12( id + 5.13 ) );
    float dd = length( fr - j * 0.7 );
    float core = smoothstep( 0.12, 0.0, dd );
    float flick = 0.35 + 0.65 * hash12( id + floor( uTime * 6.0 ) );
    col += uEmberGlow * on * core * flick * uSparkStrength * smoothstep( -0.05, 0.35, d.y );
  }

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
      // a tight excursion keeps every curtain in the DARK upper sky: a fold
      // that reaches the pale horizon band sums into an HDR blob that bloom
      // then smears across a third of the frame.
      float centre = uAuroraHeight + fi * 0.115 + ( w - 0.5 ) * 0.22;
      float s = exp( -abs( d.y - centre ) * ( 15.0 - fi * 3.2 ) );
      float striae = 0.60 + 0.40 * sin( sp.x * ( 22.0 + fi * 9.0 ) + w * 14.0 + t * 3.1 );
      acc += s * striae * ( 1.0 - fi * 0.22 );
      striaeAcc += s;
    }
    acc = min( acc, 1.3 ) * smoothstep( 0.12, 0.30, d.y );
    vec3 ribbon = mix( uAuroraA, uAuroraB, clamp( d.y * 1.5, 0.0, 1.0 ) );
    col += ribbon * acc * uAuroraStrength;
    // a faint wash under the curtains, the way real aurora lights the whole sky
    col += ribbon * min( striaeAcc, 1.5 ) * uAuroraStrength * 0.06;
  }

  col += sunDisc( d );
  gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += skyDither( gl_FragCoord.xy );
}
`;

/* -------------------------------------------------------------- sanctum -- */

const FRAG_SANCTUM = FRAG_COMMON + FRAG_CLOUDS + /* glsl */`
uniform float uRainbowStrength;
uniform float uRainbowRadius;
uniform float uRainbowWidth;
uniform float uIslandStrength;
uniform float uIslandCount;
uniform float uIslandHeight;
uniform vec3  uIslandColor;
uniform vec3  uIslandGlow;
uniform float uIslandBand;
uniform float uRingStrength;
uniform vec3  uRingColor;

/**
 * A rounded island silhouette profile around the horizon. 'u' is the azimuth
 * in island units; the return is the silhouette HEIGHT (in dome-y units) at
 * that azimuth, which the caller then compares against d.y.
 */
float islandRow( float u, float seed, float hScale ) {
  float i = floor( u );
  float r = hash12( vec2( i, seed ) );
  float w = 0.28 + 0.56 * hash12( vec2( i, seed + 4.0 ) );
  float x = ( fract( u ) - 0.5 ) / max( w * 0.5, 1e-3 );
  float inside = step( abs( x ), 1.0 );
  // rounded, slightly flat-topped hump — a plateau island, not a cone
  float prof = pow( max( 0.0, 1.0 - x * x ), 0.55 );
  return inside * prof * ( 0.24 + 0.76 * r * r ) * hScale;
}

/**
 * The 42-degree bow around the ANTI-SOLAR point. uRainbowRadius is that
 * angular radius as a fraction of PI (0.233 is the physical value; the
 * sanctum uses a larger, more graphic arc). Only above the horizon, and
 * squared so the band has soft shoulders rather than a hard edge.
 */
vec3 rainbowArc( vec3 d ) {
  if ( uRainbowStrength <= 0.001 ) return vec3( 0.0 );
  vec3 anti = -normalize( uSunDir );
  float ct = dot( d, anti );
  float centre = cos( clamp( uRainbowRadius, 0.05, 0.95 ) * 3.1415926 );
  float w = max( uRainbowWidth, 0.004 );
  float x = ( ct - centre ) / w;
  float band = 1.0 - smoothstep( 0.0, 1.0, abs( x ) );
  float h = clamp( x * 0.5 + 0.5, 0.0, 1.0 );
  vec3 spec = vec3(
    0.55 + 0.45 * cos( 6.2831853 * ( h * 0.82 + 0.00 ) ),
    0.55 + 0.45 * cos( 6.2831853 * ( h * 0.82 + 0.33 ) ),
    0.55 + 0.45 * cos( 6.2831853 * ( h * 0.82 + 0.67 ) ) );
  float up = smoothstep( -0.02, 0.22, d.y );
  return spec * band * band * uRainbowStrength * up;
}

void main() {
  vec3 d = normalize( vDir );
  vec3 col = skyGradient( d.y );
  col += horizonGlow( d );
  col += rainbowArc( d );
  col += sunDisc( d );

  vec4 cl = domeCumulus( d );
  col = mix( col, cl.rgb, cl.a );

  // ---- the ring of floating islands -------------------------------------
  if ( uIslandStrength > 0.001 ) {
    float u = domeAzimuth( d, uIslandCount );

    // the far range, sitting ON the horizon line
    float H = islandRow( u, 7.0, uIslandHeight );
    float base = smoothstep( -uIslandBand - 0.05, -uIslandBand + 0.01, d.y );
    float mass = smoothstep( H + 0.0030, H - 0.0030, d.y ) * base;
    col = mix( col, uIslandColor, mass * uIslandStrength * 0.90 );
    // sun-catching rim along the ridge line
    float ridge = exp( -abs( d.y - H ) * 300.0 ) * base;
    col += uIslandGlow * ridge * uIslandStrength * 0.50;

    // the SECOND ring: small islands genuinely floating above the horizon,
    // rendered as soft lenses so they read as distant rock, not as sprites
    if ( uRingStrength > 0.001 ) {
      float u2 = u * 0.62 + 13.0;
      float y0 = uIslandHeight * 2.6 + 0.055;
      float h2 = islandRow( u2, 23.0, uIslandHeight * 0.55 );
      float dy = abs( d.y - y0 );
      float lens = step( 0.0002, h2 ) * ( 1.0 - smoothstep( 0.0, h2 + 1e-4, dy ) );
      col = mix( col, uIslandColor, lens * uRingStrength * 0.85 );
      col += uRingColor * pow( lens, 3.0 ) * uRingStrength * 0.35;
    }
  }

  col += starField( d );
  gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += skyDither( gl_FragCoord.xy );
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
/** first defined of two param names — `day` authors cumulus*, `sanctum` cloud* */
function P(p, a, b) {
  if (p[a] !== undefined) return p[a];
  return p[b];
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

function cloudUniforms(u, p) {
  u.uCloudLit = { value: C(P(p, 'cumulusLit', 'cloudLit'), 0xfffaf0) };
  u.uCloudShadow = { value: C(P(p, 'cumulusShadow', 'cloudShadow'), 0x7f96b4) };
  u.uCloudStrength = { value: N(P(p, 'cumulusStrength', 'cloudStrength'), 0.9) };
  u.uCloudScale = { value: N(P(p, 'cumulusScale', 'cloudScale'), 2.0) };
  u.uCloudSpeed = { value: N(P(p, 'cumulusSpeed', 'cloudSpeed'), 0.012) };
  u.uCloudCoverage = { value: N(P(p, 'cumulusCoverage', 'cloudCoverage'), 0.45) };
  u.uCloudSharp = { value: N(P(p, 'cumulusSharp', 'cloudSharp'), 2.4) };
  return u;
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

/** every sky type this module answers to */
export const SKY_TYPES = Object.freeze(['gradient', 'day', 'sunset', 'furnace', 'aurora', 'sanctum']);

/**
 * The sky for one theme. It IS an Object3D — add it straight to the scene and
 * call `update(dt)` once per frame.
 */
export class Sky extends THREE.Object3D {
  /** @param {object} themeDef a ThemeDef (themes.js) */
  constructor(themeDef) {
    super();

    const def = themeDef || {};
    const skyDef = def.sky || { type: 'gradient', params: {} };
    const p = skyDef.params || {};
    const type = SKY_TYPES.indexOf(skyDef.type) !== -1 ? skyDef.type : 'gradient';

    this.name = 'cb.sky.' + (def.id || type);
    this.skyType = type;
    this.frustumCulled = false;

    this._t = 0;
    this._timeUniforms = [];
    this._materials = [];
    this._geometries = [];

    /* ---------------- dome ------------------------------------------------ */
    let frag = FRAG_GRADIENT;
    const uniforms = commonUniforms(p);

    if (type === 'day') {
      frag = FRAG_DAY;
      cloudUniforms(uniforms, p);
    } else if (type === 'sunset') {
      frag = FRAG_SUNSET;
      cloudUniforms(uniforms, p);
    } else if (type === 'furnace') {
      frag = FRAG_FURNACE;
      uniforms.uSmokeColor = { value: C(p.smokeColor, 0x2e1c15) };
      uniforms.uSmokeDark = { value: C(p.smokeDark, 0x070403) };
      uniforms.uGlowColor = { value: C(p.glowColor, 0xff6a1a) };
      uniforms.uEmberGlow = { value: C(p.emberGlow, 0xffa04a) };
      uniforms.uSmokeScale = { value: N(p.smokeScale, 2.4) };
      uniforms.uSmokeSpeed = { value: N(p.smokeSpeed, 0.022) };
      uniforms.uSmokeWarp = { value: N(p.smokeWarp, 0.35) };
      uniforms.uSmokeContrast = { value: N(p.smokeContrast, 1.35) };
      uniforms.uGlowHeight = { value: N(p.glowHeight, 0.26) };
      uniforms.uFurnace = { value: N(p.furnace, 0.26) };
      uniforms.uSeaStrength = { value: N(p.seaStrength, 0.8) };
      uniforms.uSeaScale = { value: N(p.seaScale, 5.0) };
      uniforms.uSeaSpeed = { value: N(p.seaSpeed, 0.010) };
      uniforms.uSparkStrength = { value: N(p.sparkStrength, 0.5) };
    } else if (type === 'aurora') {
      frag = FRAG_AURORA;
      uniforms.uAuroraA = { value: C(p.auroraA, 0x4affc8) };
      uniforms.uAuroraB = { value: C(p.auroraB, 0x7f9cff) };
      uniforms.uAuroraSpeed = { value: N(p.auroraSpeed, 0.055) };
      uniforms.uAuroraHeight = { value: N(p.auroraHeight, 0.42) };
      uniforms.uAuroraStrength = { value: N(p.auroraStrength, 0.75) };
      uniforms.uAuroraBands = { value: N(p.auroraBands, 3.0) };
    } else if (type === 'sanctum') {
      frag = FRAG_SANCTUM;
      cloudUniforms(uniforms, p);
      uniforms.uRainbowStrength = { value: N(p.rainbowStrength, 0.45) };
      uniforms.uRainbowRadius = { value: N(p.rainbowRadius, 0.44) };
      uniforms.uRainbowWidth = { value: N(p.rainbowWidth, 0.065) };
      uniforms.uIslandStrength = { value: N(p.islandStrength, 0.9) };
      uniforms.uIslandCount = { value: N(p.islandCount, 24.0) };
      uniforms.uIslandHeight = { value: N(p.islandHeight, 0.065) };
      uniforms.uIslandColor = { value: C(p.islandColor, 0x24506a) };
      uniforms.uIslandGlow = { value: C(p.islandGlow, 0x9fe8ff) };
      uniforms.uIslandBand = { value: N(p.islandBand, 0.022) };
      uniforms.uRingStrength = { value: N(p.ringStrength, 0.35) };
      uniforms.uRingColor = { value: C(p.ringColor, 0xbfeaff) };
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
    dome.name = 'cb.sky.dome';
    dome.frustumCulled = false;
    dome.renderOrder = -1000;
    dome.matrixAutoUpdate = false;
    dome.onBeforeRender = domeBeforeRender;
    this.add(dome);

    this.dome = dome;
    this.uniforms = uniforms;
    this._timeUniforms.push(uniforms.uTime);
    this._materials.push(domeMat);
    this._geometries.push(domeGeo);
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

  /** re-point the sun without rebuilding (a course may want another hour) */
  setSunDir(x, y, z) {
    const u = this.uniforms && this.uniforms.uSunDir;
    if (!u) return this;
    u.value.set(x, y, z);
    if (u.value.lengthSq() < 1e-9) u.value.set(0, 1, 0);
    u.value.normalize();
    return this;
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
 * @returns {Sky} an Object3D — add it to the scene, call `.update(dt)` a frame.
 */
export function buildSky(themeDef) {
  return new Sky(themeDef);
}

/* ========================================================================== *
 * god rays — the Keep's window shafts                                        *
 * ========================================================================== */

const GODRAY_VERT = /* glsl */`
varying vec2 vUvR;
void main() {
  vUvR = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

/**
 * A shaft blade. `vUvR.y` runs 0 (at the window) to 1 (at the far end) and
 * `vUvR.x` runs across the blade. The alpha is a soft cosine across the width
 * times a length falloff, plus a very slow drifting noise so dust moving in
 * the beam makes it live — all additive, so overlapping blades read as a
 * thicker volume exactly the way real scattering does.
 */
const GODRAY_FRAG = /* glsl */`
varying vec2 vUvR;
uniform vec3  uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uSoft;
uniform float uSpeed;

float grHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
float grNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = grHash( i );
  float b = grHash( i + vec2( 1.0, 0.0 ) );
  float c = grHash( i + vec2( 0.0, 1.0 ) );
  float d = grHash( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}

void main() {
  float x = vUvR.x * 2.0 - 1.0;                    // -1..1 across the blade
  // cosine profile, softened: a hard-edged shaft reads as a card
  float across = pow( max( 0.0, cos( x * 1.5707963 ) ), max( uSoft, 0.05 ) );
  // length: bright at the window, gone before the far end
  float along = ( 1.0 - vUvR.y );
  along = along * along * smoothstep( 0.0, 0.10, vUvR.y );
  // motes drifting down the shaft
  float drift = grNoise( vec2( x * 2.2, vUvR.y * 5.5 - uTime * uSpeed ) );
  float a = across * along * ( 0.72 + 0.55 * drift ) * uIntensity;
  gl_FragColor = vec4( uColor * a, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _grZ = new THREE.Vector3(0, 0, 1);
const _grDir = new THREE.Vector3();

/**
 * A cluster of additive fading planes that reads as a volumetric light shaft —
 * the Keep's tall windows, and any other place a hard directional key needs to
 * be VISIBLE in the air rather than merely inferred from the floor.
 *
 * Geometry: `blades` quads, all spanning the same shaft axis, rotated evenly
 * about it. From any camera angle at least one blade is close to
 * face-on and the rest cross it, so the cluster has depth from every side
 * without ever needing to billboard — and it is ONE merged mesh, so it is one
 * draw call however many blades you ask for.
 *
 * The returned mesh is positioned at the light SOURCE (the window) and points
 * along `dir`, which is the direction the light TRAVELS (into the room). Move
 * it with `mesh.position`; it keeps its orientation.
 *
 * @param {THREE.Vector3|number[]} dir   direction the light travels
 * @param {number|THREE.Color} color     shaft colour (usually the theme key)
 * @param {object} [opts] {length=14, width=2.4, blades=5, intensity=0.55,
 *                         softness=1.6, speed=0.35}
 * @returns {THREE.Mesh} with `.update(dt)`, `.setIntensity(v)` and `.dispose()`
 */
export function makeGodRays(dir, color, opts) {
  const o = opts || {};
  const length = N(o.length, 14);
  const width = N(o.width, 2.4);
  const blades = Math.max(1, Math.min(12, (o.blades === undefined ? 5 : o.blades) | 0));
  const half = width * 0.5;

  const vCount = blades * 4;
  const pos = new Float32Array(vCount * 3);
  const uvs = new Float32Array(vCount * 2);
  const idx = new Uint16Array(blades * 6);

  for (let b = 0; b < blades; b++) {
    // blades are rotated about the shaft axis; PI (not 2PI) because a quad is
    // two-sided, so a half turn already covers every orientation
    const a = (b / blades) * Math.PI;
    const ax = Math.cos(a), ay = Math.sin(a);
    const v0 = b * 4;
    // (-half, 0) (+half, 0) (+half, length) (-half, length) in blade space
    const cx = [-half, half, half, -half];
    const cz = [0, 0, length, length];
    for (let k = 0; k < 4; k++) {
      const i3 = (v0 + k) * 3;
      pos[i3] = ax * cx[k];
      pos[i3 + 1] = ay * cx[k];
      pos[i3 + 2] = cz[k];
      const i2 = (v0 + k) * 2;
      uvs[i2] = (k === 1 || k === 2) ? 1 : 0;
      uvs[i2 + 1] = (k >= 2) ? 1 : 0;
    }
    const i6 = b * 6;
    idx[i6] = v0; idx[i6 + 1] = v0 + 1; idx[i6 + 2] = v0 + 2;
    idx[i6 + 3] = v0; idx[i6 + 4] = v0 + 2; idx[i6 + 5] = v0 + 3;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();

  const uniforms = {
    uColor: { value: (color instanceof THREE.Color) ? color.clone() : new THREE.Color(color === undefined ? 0xffd8a0 : color) },
    uIntensity: { value: N(o.intensity, 0.55) },
    uTime: { value: 0 },
    uSoft: { value: N(o.softness, 1.6) },
    uSpeed: { value: N(o.speed, 0.35) },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: GODRAY_VERT,
    fragmentShader: GODRAY_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: true,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'cb.godrays';
  mesh.frustumCulled = true;
  mesh.renderOrder = 900;          // after opaque, before the HUD-ish overlays
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  // orient local +Z along the travel direction
  if (Array.isArray(dir)) _grDir.set(dir[0] || 0, dir[1] || -1, dir[2] || 0);
  else if (dir && typeof dir.x === 'number') _grDir.set(dir.x, dir.y, dir.z);
  else _grDir.set(0, -1, 0);
  if (_grDir.lengthSq() < 1e-9) _grDir.set(0, -1, 0);
  _grDir.normalize();
  mesh.quaternion.setFromUnitVectors(_grZ, _grDir);

  mesh.userData.cbGodRays = true;
  mesh.uniforms = uniforms;

  /** advance the drifting motes. Allocation-free. */
  mesh.update = function (dt) {
    const d = (typeof dt === 'number' && isFinite(dt)) ? Math.min(Math.max(dt, 0), 0.25) : 0;
    uniforms.uTime.value += d;
    if (uniforms.uTime.value > 100000) uniforms.uTime.value -= 100000;
    return this;
  };

  /** fade the whole cluster (0 = off) — used when a door closes or on LOW */
  mesh.setIntensity = function (v) {
    uniforms.uIntensity.value = Math.max(0, v);
    this.visible = uniforms.uIntensity.value > 0.001;
    return this;
  };

  mesh.dispose = function () {
    geo.dispose();
    mat.dispose();
    if (this.parent) this.parent.remove(this);
  };

  return mesh;
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
 * The returned texture OWNS its render target: calling `.dispose()` on it
 * frees both.
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
  env.name = 'cb.env.' + ((themeDef && themeDef.id) || 'theme');
  // hand ownership of the render target to the texture so callers only need to
  // know about one object
  env.dispose = function () { target.dispose(); };
  return env;
}

export default Sky;
