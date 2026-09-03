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
uniform float uLandStrength;
uniform float uLandCount;
uniform float uLandHeight;
uniform vec3  uLandNear;
uniform vec3  uLandFar;
uniform vec3  uLandRim;

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
  float band = pow( max( 1.0 - abs( d.y ), 0.0 ), max( uGlowPower, 0.5 ) );
  /* ROUND 4 (critic, _shots/verdant-1/vista-se.png: "the horizon is a hard
   * three-band artefact ... a pale grey-white ribbon ~50 px tall running the
   * full frame width" sampled at x=700, y=258 [191,198,193] between two bands
   * of dark green land). Using abs( d.y ) makes this band SYMMETRIC about the
   * horizon, so the warm morning glow was painted just as strongly onto the
   * dome BELOW the horizon — where the ground is. Air you can see through is
   * above the skyline; below it you are looking at land, and the glow has to
   * be gone by the time you get there. */
  band *= smoothstep( -0.042, 0.006, d.y );
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
  /* ROUND 3 (critic: "no sun disc is visible in ANY of the 25 shots"). Two
   * reasons, both fixed here and in themes.js. The disc itself was a hard
   * smoothstep with no bright core and no bloomable overshoot, so even when it
   * WAS in frame it landed under the theme's bloom threshold and read as a
   * pale smudge on a pale sky; and the sky's sunDir did not agree with the
   * light rig's key direction, so the sun was not where the shadows said it
   * was. The disc now carries a hot core well above 1.0 (that is what makes a
   * sun a sun through a tonemapper) with a tight limb and a short forward
   * scatter skirt, and it stays gone within a few degrees — the wide halo that
   * blew out tens of degrees of dome is still not welcome. */
  /* ROUND 5 — THE DISC WAS 17 DEGREES WIDE.
   * 'uSunSize' is in units of (1 - cos theta), so round 4's 0.0110 is an
   * angular RADIUS of acos(1 - 0.011) = 8.5 deg: a 17-degree cap. Photographed
   * this session (_shots/_probe_sun_verdant-1_pre.png, camera pointed
   * straight down the theme's own sunDir) that renders as a 350 px featureless
   * white bank with a cumulus shadow lying across the middle of it — no limb,
   * no core, nothing a viewer would call a sun. Round 4 read "no disc is
   * resolvable" and made the disc BIGGER, which is what dissolved it into the
   * halo. The real sun subtends 0.53 deg; the themes now author ~1.0-1.6 deg
   * (a stylised sun, still a DISC), and the glare is rebuilt as a real
   * aureole — a hot near-limb lobe of a few degrees over a wide, weak,
   * atmospheric skirt — instead of one 14-degree pow(m,24) bank that swamped
   * the disc it was supposed to be announcing.
   *
   * The core deliberately leaves the display range far behind (x22 the
   * intensity): the dome now writes LINEAR HDR (see skyDitherL), so this is
   * what the bloom threshold and the ACES shoulder are FOR. Under the old
   * double tone map any value above ~1 was thrown away before bloom saw it. */
  float disc = smoothstep( 1.0 - sz, 1.0 - sz * 0.30, sd );
  float limb = smoothstep( 1.0 - sz * 3.2, 1.0 - sz * 0.92, sd );
  float m = max( sd, 0.0 );
  // aureole: tight forward-scatter lobe, then the wide weak atmospheric skirt
  float glare = pow( m, 5000.0 ) * 1.10          // ~1.0 deg  — the flare core
              + pow( m, 700.0 )  * 0.34          // ~2.7 deg
              + pow( m, 90.0 )   * uSunHalo * 0.24   // ~7.6 deg aureole
              + pow( m, 14.0 )   * uSunHalo * 0.07;  // ~19 deg sky brightening
  return uSunColor * ( disc * uSunIntensity * 22.0 + limb * uSunIntensity * 1.30
                     + glare * uSunIntensity );
}

/* ---------------------------------------------------------------------------
 * DISTANT LAND — the world beyond the course.
 * ---------------------------------------------------------------------------
 * Critic, _shots/verdant-1/vista-sw.png: "the whole course is a floating slab
 * that simply ends, surrounded by flat white haze — no distant land, no sea, no
 * mountains". A diorama needs something behind it or the horizon is a wall, and
 * the fog cannot supply that, because in VERDANT the fog band is also the dark
 * ground the decks read against (see themes.js) — brightening it inverts the
 * readability pair. So the depth goes BEHIND the course, on the dome.
 *
 * cbRidge is one jittered, gappy silhouette row: cells around the azimuth,
 * each with its own centre offset, width, height and profile exponent, and a
 * fraction of cells left EMPTY. That is the fix for the sanctum's "row of
 * identical bread loaves on a razor line" as well — the old row put exactly one
 * flat-topped hump dead centre in every cell, at the same size, forever.
 */
float cbRidge( float u, float seed, float hScale ) {
  float i = floor( u );
  float f = fract( u );
  float r  = hash12( vec2( i, seed ) );
  float r2 = hash12( vec2( i, seed + 4.0 ) );
  float r3 = hash12( vec2( i, seed + 9.0 ) );
  float r4 = hash12( vec2( i, seed + 21.0 ) );
  // ~22 % of cells carry no land at all, so the row has gaps and groupings
  if ( r4 < 0.22 ) return 0.0;
  float w = 0.30 + 0.68 * r2;                 // width, in cell units
  float c = 0.5 + ( r3 - 0.5 ) * ( 1.0 - w ); // centre, jittered inside the cell
  float x = ( f - c ) / max( w * 0.5, 1e-3 );
  if ( abs( x ) >= 1.0 ) return 0.0;
  float sharp = 0.35 + 1.05 * r;              // cone .. plateau, per island
  float prof = pow( max( 0.0, 1.0 - x * x ), sharp );
  return prof * ( 0.20 + 0.80 * r * r ) * hScale;
}

/** Two offset rows summed — silhouettes overlap and merge into a real range. */
float cbRange( vec3 d, float count, float seed, float hScale ) {
  float u = domeAzimuth( d, count );
  float a = cbRidge( u, seed, hScale );
  float b = cbRidge( u * 0.53 + 7.31, seed + 51.0, hScale * 0.72 );
  return max( a, b * 0.92 );
}

/**
 * Two ranges of distant land sitting on the horizon: a FAR range washed almost
 * to the haze colour and a NEARER one a little darker and taller, with a warm
 * rim on the sun side. Returns rgb premultiplied by a in .a so the caller can
 * composite in one mix.
 */
vec4 distantLand( vec3 d, vec3 skyCol ) {
  if ( uLandStrength <= 0.001 ) return vec4( 0.0 );
  float far = cbRange( d, uLandCount, 3.0, uLandHeight * 0.62 );
  float near = cbRange( d, uLandCount * 0.47, 61.0, uLandHeight );
  // a soft, hazy edge — a hard step here is the "razor line" the critic named
  float aFar = smoothstep( far + 0.0075, far - 0.0075, d.y );
  float aNear = smoothstep( near + 0.0090, near - 0.0090, d.y );
  /* Above the horizon the two ridges are silhouettes; BELOW it the land is
   * continuous, because that is where the ground you are standing on stops and
   * the rest of the world has to keep going. Without this the dome under the
   * horizon stayed the pale haze colour and the course read as a slab floating
   * in milk (critic, _shots/verdant-1/vista-sw.png). */
  float above = smoothstep( -0.060, 0.005, d.y );
  /* ROUND 4 — THE HOLE IN THE HORIZON.
   * The below term used to ramp 0.005 -> -0.060 while above was ALREADY falling
   * over the same interval, so between roughly d.y = -0.005 and -0.030
   * neither term reached 1, the land was part-transparent, and the pale sky
   * plus the (then mirrored) horizon glow showed straight through it. That
   * gap IS the pale ribbon the critic measured between two green bands. The
   * ground begins AT the skyline, so this now reaches full opacity within
   * about half a degree of it. */
  float below = smoothstep( 0.006, -0.004, d.y );
  /* ROUND 4b — BOTH RANGES LIVE IN THE HAZE.
   * The first pass at this fixed the pale RIBBON but left the three-band
   * structure, because the nearer range was painted at full uLandNear while
   * the ground under the skyline was painted at uLandFar: a dark green ridge
   * over a pale band over dark green again, measured down column x=700 of
   * _shots/verdant-1/vista-se.png as [58,102,80] -> [134,163,169] ->
   * [53,99,77]. Both of those ranges are kilometres away, so BOTH are mostly
   * air; the only thing that separates them is how much. Then the ground below
   * the skyline starts at exactly the nearer range's value and loses its haze
   * as it comes toward you — which is what makes the join continuous instead
   * of a seam. */
  vec3 farC  = mix( uLandFar, uLandNear, 0.20 );
  vec3 nearC = mix( uLandFar, uLandNear, 0.56 );
  vec3 col = mix( farC, nearC, clamp( aNear, 0.0, 1.0 ) );
  /* AERIAL PERSPECTIVE ON THE GROUND PLANE.
   * Below the horizon you are looking at ground receding away from you, and
   * uLandNear * 0.62 painted every bit of it - from the skyline to your own
   * feet — one flat slab of saturated green, which is the other half of why
   * the frame read as a broken skybox. Depth now runs haze -> local colour ->
   * falling light: at the skyline the ground is as washed as the far ridge
   * behind it, a few degrees down it recovers its own colour, and further down
   * still it darkens the way a valley floor does. */
  /* ROUND 5 — THE HORIZON TERMINATOR.
   * Critic: "every wide frame is bisected by a dead-straight horizon
   * TERMINATOR, below which the lower ~70 % of the frame is one flat teal slab
   * ... a ~100-level drop across 15 px followed by a dead-flat field", measured
   * down column x=1200 of _shots/verdant-1/vista-sw.png. Two separate
   * mistakes made that edge, and both are fixed here.
   *
   * 1. THE GROUND STARTED AT ITS OWN COLOUR, not at the sky's. 'below' reaches
   *    full opacity within half a degree of the skyline (correct — that is
   *    what closed round 4's pale ribbon), but the colour it composited was
   *    'nearC', a value chosen for a ridge KILOMETRES away and nothing to do
   *    with the pale, glowing band immediately above the seam. So the first
   *    pixel of ground was a hard step off the last pixel of sky. Aerial
   *    perspective says the opposite: at zero degrees of depression you are
   *    looking through an infinite column of air, so the ground IS the sky
   *    colour there and only earns its own colour as it comes toward you. The
   *    ramp therefore now starts from skyCol — the caller's fully composited
   *    sky, glow and all — which makes the seam continuous BY CONSTRUCTION at
   *    any theme, any time of day, without a matching constant to maintain.
   *
   * 2. THE FIELD HAD NO STRUCTURE. Below the ramp it was one flat wash. Real
   *    distant ground carries relief and cloud shadow, so a low-frequency
   *    two-octave field modulates value and warmth across it; it is small
   *    (±7 %) because this is haze, but it is the difference between air and
   *    a sheet of glass. */
  float dn = max( -d.y, 0.0 );
  vec3 ground = mix( nearC, uLandNear, smoothstep( 0.030, 0.260, dn ) );
  ground = mix( ground, uLandNear * 0.66, smoothstep( 0.240, 0.700, dn ) );
  // relief + cloud shadow on the ground plane, at ~2 and ~7 cells per turn
  vec2 gp = d.xz / max( dn + 0.05, 0.02 );
  float relief = fbm3( gp * 0.55 + vec2( 11.3, 4.7 ) ) - 0.5;
  ground *= 1.0 + relief * 0.14 * smoothstep( 0.010, 0.120, dn );
  ground = mix( ground, ground * vec3( 1.06, 1.0, 0.94 ), clamp( relief + 0.5, 0.0, 1.0 ) * 0.35 );
  // the aerial ramp: sky colour AT the skyline -> haze -> local ground colour
  /* The value the ground must MATCH at the seam is the sky ONE PIXEL ABOVE the
   * skyline, not the sky in this (below-horizon) direction: horizonGlow()
   * deliberately stops at d.y = 0.006, so sampling here would hand the ground a
   * value already ~40 counts under the sky it has to join, which is most of
   * what was left of the terminator after the first pass. Re-evaluating the
   * gradient and the glow along the same AZIMUTH at the skyline costs one
   * normalize and makes the join exact at any theme and any time of day. */
  vec3 dH = normalize( vec3( d.x, 0.010, d.z ) );
  vec3 seamSky = skyGradient( dH.y ) + horizonGlow( dH );
  vec3 nearGround = mix( seamSky, ground, smoothstep( 0.0, 0.080, dn ) );
  /* ...and the ramp has to REPLACE the ridge colour immediately, not over the
   * next three degrees. Round 5a left col (which is the far/near RIDGE mix,
   * a value for land kilometres away) showing through for the first 0.05 of
   * d.y, which measured as a dark trough between the bright sky and the bright
   * hazy ridge behind it: column x=1200 of vista-se read 213 at y=214, 110 at
   * y=232 and back up to 170 at y=262. */
  col = mix( col, nearGround, smoothstep( 0.006, -0.003, d.y ) );
  /* THE SKYLINE ITSELF. Re-measured after the ramp above went in, column x=1200
   * of vista-se still read 206 at y=215, 115 at y=227 and 222 at y=239: a
   * 12-pixel DARK NOTCH exactly on the seam. It is the blend window — for the
   * half-degree either side of d.y = 0 the composite is still carrying the
   * RIDGE colour (farC/nearC, values chosen for land 20 km away), which is
   * darker than the sky above it AND darker than the hazy ground below it.
   * Physically nothing on the skyline can be darker than the air in front of
   * it: at zero degrees the sight-line is infinite, so everything there is the
   * sky. This paints the last degree either side with exactly that. */
  float seam = 1.0 - smoothstep( 0.0, 0.018, abs( d.y ) );
  col = mix( col, seamSky, seam * 0.88 );
  float a = max( max( aFar * 0.72, aNear ) * above, below ) * uLandStrength;
  // sun-side rim along the nearer ridge
  vec3 sxz = normalize( vec3( uSunDir.x, 0.0, uSunDir.z ) + 1e-5 );
  vec3 hxz = normalize( vec3( d.x, 0.0, d.z ) + 1e-5 );
  float az = max( 0.0, dot( hxz, sxz ) );
  col += uLandRim * exp( -abs( d.y - near ) * 260.0 ) * above * ( 0.30 + 0.70 * az );
  return vec4( col, clamp( a, 0.0, 1.0 ) );
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

/* ROUND 5 — THE DOME WAS TONE MAPPED TWICE.
 *
 * Every dome shader used to end with '#include <tonemapping_fragment>' +
 * '#include <colorspace_fragment>' and 'toneMapped: true'. Measured this
 * session ('_harness/_vfxprobe.py'): the engine renders through an
 * EffectComposer whose targets report 'texture.colorSpace = ''' (NoColorSpace)
 * and 'type = 1016' (HalfFloat) — SCENE-REFERRED LINEAR HDR — and the chain is
 * RenderPass -> ScaledBloomPass -> FinishPass -> FXAAPass, with FinishPass
 * doing grade -> ACES -> sRGB exactly once for the whole frame (post.js).
 *
 * So the dome applied ACES into a buffer FinishPass then ACES'd again, and
 * ACES CLAMPS TO 1.0. Three consequences, all of them measured by the critic:
 *   - the sun could not exist. The disc term reaches ~13 in linear; the dome's
 *     own ACES squashed it to 0.99, so it reached the bloom pass BELOW
 *     verdant's 1.12 threshold and keep's 1.52. "Zero pixels above 235 in any
 *     wide frame" is the arithmetic of a double tone map;
 *   - the dome was double-compressed, which is what flattens a gradient into a
 *     slab: two ACES curves in series have almost no slope left in the upper
 *     mid-tones, so the horizon band and the air under it converge;
 *   - the sky could not light the world correctly, because buildEnvCubemap()
 *     renders THIS material into a HalfFloat cube for the PMREM, so it was
 *     baking a display-referred image and calling it radiance.
 *
 * The dome now writes LINEAR HDR and FinishPass owns the transform. The same
 * change is made in world/water.js and world/materials.js (the water surface).
 */

/** dither: kills banding across a big smooth gradient. Applied in LINEAR now,
 *  so it is RELATIVE — a fixed 1.6/255 offset in scene-referred linear is a
 *  visible speckle in the dark zenith and invisible at the bright horizon. */
vec3 skyDitherL( vec3 col, vec2 c ) {
  return col * ( 1.0 + ( hash12( c ) - 0.5 ) * uDither * 0.008 );
}
`;

/** cumulus deck — shared by day, sunset and sanctum */
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
/**
 * Cloud-deck projection. domeUv divides by d.y * 0.8 + 1.15, a denominator
 * that never drops below 1.15 — so the whole horizon maps onto a circle of
 * radius ~0.87 in uv, and at cloudScale 1.75 that is barely ONE noise cell
 * around the entire 360 degrees. Near the horizon the field was therefore
 * mathematically almost constant, which is why round 1's fade-in fix (bringing
 * the deck down to 0.005 elevation) still produced a flat blue wall in every
 * verdant station: there were no clouds down there to fade in.
 *
 * A cloud deck is a PLANE at altitude, so the correct projection is d.xz / d.y,
 * clamped so the horizon stretches to a finite (large) value instead of
 * infinity. That converges the cells at the horizon the way real cumulus does.
 */
vec2 cloudUv( vec3 d ) {
  return d.xz / max( d.y + 0.055, 0.075 );
}

vec4 domeCumulus( vec3 d ) {
  if ( uCloudStrength <= 0.001 || d.y < 0.005 ) return vec4( 0.0 );
  vec2 p = cloudUv( d ) * uCloudScale;
  float t = uTime * uCloudSpeed;

  vec2 q = vec2( fbm3( p + vec2( 0.0, t ) ), fbm3( p + vec2( 3.3, -t * 0.8 ) ) );
  float f = fbm5( p * 1.35 + q * 1.25 + vec2( t * 0.45, t * 0.17 ) );

  float edge = 1.0 - clamp( uCloudCoverage, 0.0, 0.98 );
  float cov = smoothstep( edge, edge + 0.24, f );
  cov = pow( clamp( cov, 0.0, 1.0 ), max( uCloudSharp, 0.1 ) );
  /* Fade in off the horizon and thin out toward the zenith (perspective).
   *
   * ROUND 1 VISUAL FIX: the fade-in ran 0.01 -> 0.11 in d.y, which put the
   * cloud deck entirely above ~6 degrees of elevation. A third-person
   * platformer camera sits just above the hero and looks slightly DOWN, so the
   * only sky in frame is the band under that — and every verdant station shot
   * (_shots/verdant-1/spawn.png, cp1, cp4) came back with a flat gradient
   * sky and no clouds at all. Real cumulus CONVERGES at the horizon; bringing
   * the fade down to 0.005 -> 0.045 is both more correct and the difference
   * between "a sky" and "a blue wall". */
  cov *= smoothstep( 0.005, 0.045, d.y ) * ( 1.0 - 0.45 * smoothstep( 0.45, 1.0, d.y ) );

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
  gl_FragColor.rgb = skyDitherL( gl_FragColor.rgb, gl_FragCoord.xy );
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

  /* ROUND 4 — COMPOSITE ORDER. The deck used to be drawn AFTER the land, so
   * white cumulus puffs rendered ON TOP of the dark green land band (critic,
   * _shots/verdant-1/vista-se.png). Clouds are in the SKY; distant land stands
   * in FRONT of the sky. Sky first, then the deck, then the veil, then land. */
  vec4 cl = domeCumulus( d );
  col = mix( col, cl.rgb, cl.a );

  // a thin high cirrus veil above the cumulus, barely there
  vec2 sp = domeUv( d ) * 3.1;
  float cir = fbm5( sp + vec2( uTime * 0.0035, uTime * 0.0014 ) );
  cir = smoothstep( 0.60, 0.95, cir ) * smoothstep( 0.10, 0.55, d.y );
  col = mix( col, mix( col, uCloudLit, 0.55 ), cir * 0.22 );

  vec4 land = distantLand( d, col );
  col = mix( col, land.rgb, land.a );

  gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
  gl_FragColor.rgb = skyDitherL( gl_FragColor.rgb, gl_FragCoord.xy );
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
  gl_FragColor.rgb = skyDitherL( gl_FragColor.rgb, gl_FragCoord.xy );
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
  gl_FragColor.rgb = skyDitherL( gl_FragColor.rgb, gl_FragCoord.xy );
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
  gl_FragColor.rgb = skyDitherL( gl_FragColor.rgb, gl_FragCoord.xy );
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

  // ROUND 4: deck before land, for the reason given in FRAG_DAY.
  vec4 cl = domeCumulus( d );
  col = mix( col, cl.rgb, cl.a );

  vec4 land = distantLand( d, col );
  col = mix( col, land.rgb, land.a );

  // ---- the ring of floating islands -------------------------------------
  if ( uIslandStrength > 0.001 ) {
    float u = domeAzimuth( d, uIslandCount );

    /* ROUND 3 (critic: "a row of identical bread loaves on a razor line —
     * evenly spaced identical flattened domes, each with the same orange rim,
     * on a perfectly straight hard horizon edge"). islandRow put exactly one
     * flat-topped hump dead centre in every azimuth cell, every cell filled,
     * one profile exponent for all of them, and cut them against the sky with a
     * 0.006-wide step. cbRange jitters the centre, the width, the height and
     * the profile, leaves ~22 % of cells empty and sums two offset rows so the
     * silhouettes overlap; the cut is three times softer and the rim now varies
     * with azimuth instead of ringing every island equally. */
    float H = cbRange( d, uIslandCount, 7.0, uIslandHeight );
    float base = smoothstep( -uIslandBand - 0.05, -uIslandBand + 0.01, d.y );
    float mass = smoothstep( H + 0.0095, H - 0.0095, d.y ) * base;
    col = mix( col, uIslandColor, mass * uIslandStrength * 0.90 );
    // sun-catching rim along the ridge line, strongest on the sun side
    vec3 sxz2 = normalize( vec3( uSunDir.x, 0.0, uSunDir.z ) + 1e-5 );
    vec3 hxz2 = normalize( vec3( d.x, 0.0, d.z ) + 1e-5 );
    float az2 = max( 0.0, dot( hxz2, sxz2 ) );
    float ridge = exp( -abs( d.y - H ) * 240.0 ) * base;
    col += uIslandGlow * ridge * uIslandStrength * 0.50 * ( 0.25 + 0.85 * az2 );

    // the SECOND ring: small islands genuinely floating above the horizon,
    // rendered as soft lenses so they read as distant rock, not as sprites
    if ( uRingStrength > 0.001 ) {
      float u2 = u * 0.62 + 13.0;
      float y0 = uIslandHeight * 2.6 + 0.055;
      float h2 = cbRidge( u2, 23.0, uIslandHeight * 0.55 );
      float dy = abs( d.y - y0 );
      float lens = step( 0.0002, h2 ) * ( 1.0 - smoothstep( 0.0, h2 + 1e-4, dy ) );
      col = mix( col, uIslandColor, lens * uRingStrength * 0.85 );
      col += uRingColor * pow( lens, 3.0 ) * uRingStrength * 0.35;
    }
  }

  col += starField( d );
  gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
  gl_FragColor.rgb = skyDitherL( gl_FragColor.rgb, gl_FragCoord.xy );
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
/** first defined of two param names — day authors cumulus*, sanctum cloud* */
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
    /* DISTANT LAND. landStrength 0 (the default) is the old behaviour
     * exactly, so a theme opts in. landNear/landFar are the two depth
     * planes: the far range should sit close to the horizon colour, because
     * that IS aerial perspective, and the near one a little darker and cooler.
     * landCount is ranges per full turn — low numbers give long ridges. */
    uLandStrength: { value: N(p.landStrength, 0.0) },
    uLandCount: { value: N(p.landCount, 9.0) },
    uLandHeight: { value: N(p.landHeight, 0.055) },
    uLandNear: { value: C(p.landNear, 0x6d8a86) },
    uLandFar: { value: C(p.landFar, 0x9fb4bc) },
    uLandRim: { value: C(p.landRim, 0xffd8a0) },
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
      // LINEAR HDR out — post.js FinishPass owns grade -> ACES -> sRGB.
      toneMapped: false,
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
  gl_FragColor = vec4( uColor * a, a );   // linear HDR — FinishPass tone maps
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
    toneMapped: false,             // linear HDR — see the skyDitherL note
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
