// VALE render — procedural VFX textures, generated ON THE GPU once at load (render-to-texture).
//
// ATLAS  2048² RGBA8, 8 × 8 cells of 256 px, mipmapped. Channels are DATA, not colour:
//          R  shading / brightness (painterly light from the upper left, facet value for shards)
//          G  rim / edge mask (the Shade family's light rim, a shard's catch-light edge, a crack's glow)
//          B  erosion field (cores persist, edges erode first: alpha erosion over life)
//          A  coverage
//        Flipbooks (8 frames, one coherent billow each): ink_puff · light_puff · dust_puff · splash.
//        Statics: spark · glow · shard ×4 · ring · streak · petal · ember · drop · rune (carved hour
//        ticks, never a glowing glyph) · crack ×2 · mote · flare · wisp ×2 · chip ×4 · glint · ring_thin ·
//        frost · caustic · scorch · splat.
// NOISE  256² RGBA8, tileable, mipmapped: R fbm · G cell edges · B streak noise (ribbons/beams) · A fine fbm.
//
// Bible: Lumen = additive light, dawnglass shards, motes, clean beams; Shade = ink puffs with a bright
// light rim, tendrils, splatter; impacts throw OPAQUE chips (shard/chip cells are hard-edged).

import {
  LinearFilter, LinearMipmapLinearFilter, Mesh, OrthographicCamera, PlaneGeometry, RepeatWrapping, Scene, ShaderMaterial,
  type Texture, WebGLRenderTarget, type WebGLRenderer,
} from 'three';

export const ATLAS_GRID = 8;
const ATLAS_PX = 2048;
const NOISE_PX = 256;

/** texture name → first cell, frame count, and whether frames are random variants (not a flipbook) */
export interface TexSpec { cell: number; frames: number; variants: boolean; stretch: boolean }
const T = (cell: number, frames = 1, variants = false, stretch = false): TexSpec => ({ cell, frames, variants, stretch });

export const VFX_TEX: Readonly<Record<string, TexSpec>> = {
  // flipbooks
  ink_puff: T(0, 8), light_puff: T(8, 8), dust_puff: T(16, 8), splash: T(24, 8),
  // statics
  spark: T(32, 1, false, true), glow: T(33), shard: T(34, 4, true), ring: T(38), streak: T(39, 1, false, true), petal: T(40),
  ember: T(41), drop: T(42), rune: T(43), crack: T(44, 2, true), mote: T(46), flare: T(47), wisp: T(48, 2, true),
  chip: T(50, 4, true), glint: T(54), ring_thin: T(55), frost: T(56), caustic: T(57), scorch: T(58), splat: T(59),
  // legacy names (CONTRACT §9.5 v1) → the new cells
  smoke: T(0, 8), dust: T(16, 8), shard_set: T(34, 4, true),
};
export const VFX_TEXTURE_NAMES = Object.keys(VFX_TEX);

export function texSpec(name: unknown): TexSpec {
  return (typeof name === 'string' && VFX_TEX[name]) || VFX_TEX.glow;
}

const GEN_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

const GEN_FRAG = /* glsl */`
precision highp float;
uniform float uMode;
uniform vec2 uSize;
varying vec2 vUv;
#define PI 3.14159265
#define TAU 6.2831853

float hash11( float p ) { p = fract( p * 0.1031 ); p *= p + 33.33; p *= p + p; return fract( p ); }
float hash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
vec2 hash22( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.xx + p3.yz ) * p3.zy ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash12( i ), hash12( i + vec2( 1, 0 ) ), u.x ), mix( hash12( i + vec2( 0, 1 ) ), hash12( i + vec2( 1, 1 ) ), u.x ), u.y );
}
float fbm( vec2 p ) { float a = 0.5, s = 0.0; for ( int i = 0; i < 5; i ++ ) { s += a * vnoise( p ); p = mat2( 1.6, 1.2, -1.2, 1.6 ) * p + 7.1; a *= 0.5; } return s / 0.96875; }
// periodic (tileable) value noise / fbm with period P
float pnoise( vec2 p, vec2 P ) {
  vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  float a = hash12( mod( i, P ) ), b = hash12( mod( i + vec2( 1, 0 ), P ) ), c = hash12( mod( i + vec2( 0, 1 ), P ) ), d = hash12( mod( i + vec2( 1, 1 ), P ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
float pfbm( vec2 p, vec2 P ) { float a = 0.5, s = 0.0; for ( int i = 0; i < 5; i ++ ) { s += a * pnoise( p, P ); p *= 2.0; P *= 2.0; a *= 0.5; } return s / 0.96875; }
vec2 voronoi( vec2 p, vec2 P, bool periodic ) {
  vec2 i = floor( p ), f = fract( p ); float d1 = 8.0, d2 = 8.0;
  for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
    vec2 g = vec2( float( x ), float( y ) );
    vec2 id = periodic ? mod( i + g, P ) : i + g;
    vec2 r = g + hash22( id ) * 0.85 + 0.075 - f;
    float d = dot( r, r );
    if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) d2 = d;
  }
  return vec2( sqrt( d1 ), sqrt( d2 ) );
}
vec3 vorCell( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); float d1 = 8.0; vec2 best = vec2( 0.0 );
  for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
    vec2 g = vec2( float( x ), float( y ) );
    vec2 r = g + hash22( i + g ) * 0.85 + 0.075 - f;
    float d = dot( r, r );
    if ( d < d1 ) { d1 = d; best = i + g; }
  }
  return vec3( sqrt( d1 ), hash12( best * 1.37 ), hash12( best * 3.11 + 0.5 ) );
}
float cellFade( vec2 q ) { return 1.0 - smoothstep( 0.86, 0.985, max( abs( q.x ), abs( q.y ) ) ); }

// ── billowing puff density (ink / dust): lobes + domain-warped fbm, evolving with p ─────────────
float puffDensity( vec2 q, float p, float seed ) {
  float d = -1.0;
  for ( int i = 0; i < 7; i ++ ) {
    float fi = float( i );
    float a = fi * 2.39996 + seed * TAU;
    float rr = i == 0 ? 0.0 : ( 0.2 + 0.2 * hash11( seed * 13.0 + fi ) ) * ( 0.8 + 0.6 * p );
    vec2 c = vec2( cos( a ), sin( a ) ) * rr;
    float rad = ( i == 0 ? 0.4 : 0.22 + 0.16 * hash11( seed * 7.0 + fi * 3.1 ) ) * ( 0.78 + 0.4 * p );
    float l = 1.0 - length( q - c ) / rad;
    // smooth union of the lobes
    float h = clamp( 0.5 + 0.5 * ( l - d ) / 0.25, 0.0, 1.0 );
    d = mix( d, l, h ) + 0.25 * h * ( 1.0 - h );
  }
  vec2 w = q * 1.7 + vec2( fbm( q * 2.3 + seed * 11.0 + p * 0.7 ), fbm( q * 2.3 + seed * 17.0 - p * 0.7 ) ) * ( 0.7 + 0.7 * p );
  float n = fbm( w * 2.0 + seed * 3.0 );
  d += ( n - 0.5 ) * ( 0.95 + 0.5 * p );
  d -= p * p * 0.45 * fbm( q * 4.5 + seed * 23.0 );
  return d;
}

vec4 inkPuff( vec2 q, float f ) {
  float p = f / 7.0, seed = 0.37;
  float d = puffDensity( q, p, seed );
  vec2 L = normalize( vec2( -0.55, 0.85 ) );
  float dl = puffDensity( q + L * 0.08, p, seed );
  float lit = smoothstep( 0.0, 1.0, 0.5 + ( d - dl ) * 2.8 );
  float streak = fbm( vec2( q.x * 1.6 + q.y * 3.2, q.y * 8.5 - q.x ) + seed * 5.0 );
  float shade = ( 0.42 + 0.58 * lit ) * ( 0.82 + 0.36 * streak );
  float cov = smoothstep( 0.0, 0.26, d );
  float edge = smoothstep( 0.0, 0.07, d ) * ( 1.0 - smoothstep( 0.07, 0.24, d ) );
  float rim = edge * ( 0.3 + 0.7 * smoothstep( -0.3, 0.7, dot( normalize( q + 1e-4 ), L ) ) ) + edge * lit * 0.4;
  float erode = clamp( 0.2 + 0.8 * smoothstep( 0.0, 0.85, d ) * ( 0.55 + 0.45 * fbm( q * 5.0 + 9.0 ) ), 0.0, 1.0 );
  return vec4( clamp( shade, 0.0, 1.0 ), clamp( rim, 0.0, 1.0 ), erode, cov * cellFade( q ) );
}

vec4 dustPuff( vec2 q, float f ) {
  float p = f / 7.0;
  float d = puffDensity( q * 1.08, p, 0.71 );
  float cov = smoothstep( -0.08, 0.5, d ) * 0.8;
  float grain = vnoise( q * 38.0 ) * 0.5 + fbm( q * 7.0 + 3.0 ) * 0.5;
  float shade = 0.72 + 0.28 * fbm( q * 5.0 + p );
  float erode = clamp( 0.2 + 0.8 * smoothstep( -0.05, 0.7, d ) * ( 0.5 + 0.5 * grain ), 0.0, 1.0 );
  return vec4( shade, 0.0, erode, cov * ( 0.75 + 0.25 * grain ) * cellFade( q ) );
}

vec4 lightPuff( vec2 q, float f ) {
  float p = f / 7.0;
  float r = length( q ), a = atan( q.y, q.x );
  float core = exp( -r * r * ( 10.0 - 6.0 * p ) );
  float s = vnoise( vec2( a * 2.8649 + 3.0, p * 0.5 ) ) * 0.6 + vnoise( vec2( a * 6.3662 + 11.0, p ) ) * 0.4;
  float rays = pow( s, 3.0 ) * exp( -r * ( 3.4 - 1.4 * p ) ) * 1.6;
  vec2 w = q * 2.4 + vec2( fbm( q * 3.0 + p ), fbm( q * 3.0 + 5.0 - p ) ) * 0.8;
  float wisp = fbm( w * 1.7 ) * exp( -r * r * ( 3.2 - 1.6 * p ) );
  float cov = clamp( core + rays * 0.8 + wisp * ( 0.35 + 0.6 * p ), 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.72, 0.97, r ) );
  float bright = clamp( core * 1.3 + rays * 0.7 + wisp * 0.45, 0.0, 1.0 );
  float r0 = 0.22 + 0.6 * p;
  float ring = exp( -pow( ( r - r0 ) / 0.045, 2.0 ) ) * ( 1.0 - p * 0.7 ) * ( 0.6 + 0.4 * vnoise( vec2( a * 4.0, 1.0 ) ) );
  float erode = clamp( 0.2 + 0.8 * clamp( core + wisp * 0.6 + rays * 0.3, 0.0, 1.0 ), 0.0, 1.0 );
  return vec4( bright, ring, erode, clamp( cov + ring * 0.5, 0.0, 1.0 ) * cellFade( q ) );
}

vec4 splash( vec2 q, float f ) {
  float p = clamp( f / 7.0, 0.0, 1.0 );
  float r = length( q ), a = atan( q.y, q.x );
  float N = 13.0;
  float sector = floor( ( a + PI ) / TAU * N );
  float h = hash11( sector * 7.13 + 1.3 );
  float centre = ( sector + 0.5 ) / N * TAU - PI;
  float da = clamp( abs( a - centre ) * N / TAU * 2.0, 0.0, 1.0 );
  float grow = smoothstep( 0.0, 0.55, p );
  float blobR = 0.16 + 0.2 * sqrt( p );
  float spike = ( 0.1 + 0.55 * h * h ) * grow;
  float allowed = blobR + spike * pow( 1.0 - da, 2.2 ) + ( fbm( q * 6.0 + 2.0 ) - 0.5 ) * 0.09;
  float sd = r - allowed;
  float m = 1.0 - smoothstep( -0.012, 0.012, sd );
  float rimBand = smoothstep( -0.06, -0.01, sd ) * m;
  for ( int i = 0; i < 14; i ++ ) {
    float fi = float( i );
    float an = hash11( fi * 3.7 + 0.2 ) * TAU;
    float dist = blobR + 0.12 + ( 0.2 + 0.45 * hash11( fi * 5.3 + 0.9 ) ) * grow;
    float rad = ( 0.018 + 0.045 * hash11( fi * 9.1 + 0.4 ) ) * ( 1.0 - 0.35 * p );
    float dd = length( q - vec2( cos( an ), sin( an ) ) * dist ) - rad;
    float dm = 1.0 - smoothstep( -0.01, 0.01, dd );
    m = max( m, dm );
    rimBand = max( rimBand, smoothstep( -0.03, -0.005, dd ) * dm );
  }
  float shade = 0.55 + 0.45 * ( 1.0 - clamp( r * 1.2, 0.0, 1.0 ) ) * ( 0.8 + 0.2 * fbm( q * 9.0 ) );
  float erode = clamp( 0.2 + 0.8 * ( 1.0 - clamp( r, 0.0, 1.0 ) ) * ( 0.6 + 0.4 * fbm( q * 5.0 + 4.0 ) ), 0.0, 1.0 );
  return vec4( shade, rimBand, erode, m * cellFade( q ) );
}

// faceted convex polygon (glass shards, stone chips): R facet value, G edges/ridges, A hard coverage
vec4 facetPoly( vec2 q, float seed, float sx, float sy, float rot ) {
  float c = cos( rot ), s = sin( rot );
  q = mat2( c, -s, s, c ) * q;
  const int K = 7;
  vec2 v[ 7 ];
  for ( int i = 0; i < K; i ++ ) {
    float fi = float( i );
    float th = ( fi + 0.15 + 0.55 * hash11( seed * 17.0 + fi ) ) / float( K ) * TAU;
    float rr = 0.72 + 0.28 * hash11( seed * 29.0 + fi * 1.7 );
    v[ i ] = vec2( cos( th ) * sx, sin( th ) * sy ) * rr;
  }
  float inside = 1.0, dmin = 8.0;
  for ( int i = 0; i < K; i ++ ) {
    vec2 a = v[ i ], b = v[ i == K - 1 ? 0 : i + 1 ];
    vec2 e = b - a;
    float cr = e.x * ( q.y - a.y ) - e.y * ( q.x - a.x );
    float dd = cr / length( e );
    dmin = min( dmin, dd );
  }
  float cov = smoothstep( -0.006, 0.006, dmin );
  vec2 ridge = vec2( ( hash11( seed * 3.0 ) - 0.5 ) * sx * 0.5, ( hash11( seed * 5.0 ) - 0.5 ) * sy * 0.4 );
  vec2 rq = q - ridge;
  float ang = atan( rq.y, rq.x );
  float facet = 0.0, ridgeLine = 8.0;
  for ( int i = 0; i < K; i ++ ) {
    vec2 rv = v[ i ] - ridge;
    float va = atan( rv.y, rv.x );
    float da = abs( mod( ang - va + PI, TAU ) - PI );
    ridgeLine = min( ridgeLine, da * length( rq ) );
  }
  float sector = floor( ( ang + PI ) / TAU * float( K ) + hash11( seed ) );
  facet = 0.45 + 0.55 * hash11( sector * 3.3 + seed * 11.0 );
  facet *= 0.85 + 0.15 * smoothstep( -0.6, 0.8, dot( normalize( rq + 1e-4 ), normalize( vec2( -0.5, 0.86 ) ) ) );
  float edges = max( 1.0 - smoothstep( 0.0, 0.045, dmin ), 1.0 - smoothstep( 0.0, 0.018, ridgeLine ) ) ;
  return vec4( facet, edges * cov, 1.0, cov );
}

vec4 crack( vec2 q, float seed ) {
  float r = length( q );
  vec2 vv = voronoi( q * 3.4 + seed * 7.0, vec2( 0.0 ), false );
  float web = 1.0 - smoothstep( 0.0, 0.06, vv.y - vv.x );
  float radial = 1.0 - smoothstep( 0.25, 0.92, r + ( fbm( q * 3.0 + seed ) - 0.5 ) * 0.3 );
  float br = 0.0;
  for ( int k = 0; k < 6; k ++ ) {
    float fk = float( k );
    float an = ( fk + hash11( seed * 9.0 + fk ) * 0.6 ) / 6.0 * TAU;
    vec2 dir = vec2( cos( an ), sin( an ) );
    float along = dot( q, dir );
    vec2 perp = vec2( -dir.y, dir.x );
    float wob = ( fbm( vec2( along * 4.0, fk * 3.0 + seed ) ) - 0.5 ) * 0.22 * along;
    float across = abs( dot( q, perp ) - wob );
    float len = 0.55 + 0.35 * hash11( seed * 4.0 + fk * 2.0 );
    float w = 0.022 * ( 1.0 - clamp( along / len, 0.0, 1.0 ) ) + 0.004;
    br = max( br, ( 1.0 - smoothstep( w * 0.4, w, across ) ) * step( 0.0, along ) * ( 1.0 - smoothstep( len * 0.85, len, along ) ) );
  }
  float a = clamp( max( web * radial * 0.85, br ), 0.0, 1.0 );
  float centre = exp( -r * r * 30.0 ) * 0.6;
  return vec4( 1.0, a, clamp( 1.0 - r, 0.2, 1.0 ), clamp( a + centre, 0.0, 1.0 ) * cellFade( q ) );
}

vec4 wisp( vec2 q, float seed ) {
  float x = q.x;
  float k = 1.4 + seed * 0.8;
  float y0 = 0.42 * sin( x * k + seed * 3.0 ) * ( 0.6 + 0.4 * x );
  float dy = 0.42 * k * cos( x * k + seed * 3.0 );
  float d = abs( q.y - y0 ) / sqrt( 1.0 + dy * dy );
  float t = clamp( ( x + 0.92 ) / 1.84, 0.0, 1.0 );
  float w = 0.13 * pow( sin( t * PI ), 0.7 ) * ( 0.55 + 0.45 * t );
  float n = fbm( vec2( x * 6.0, q.y * 6.0 ) + seed * 9.0 );
  float m = 1.0 - smoothstep( w * 0.55, w, d + ( n - 0.5 ) * 0.05 );
  float rim = smoothstep( w * 0.35, w * 0.8, d ) * m;
  return vec4( 0.75 + 0.25 * n, rim, 0.2 + 0.8 * t, m * step( abs( x ), 0.95 ) );
}

vec4 cellFn( float cell, vec2 q ) {
  float r = length( q ), a = atan( q.y, q.x );
  if ( cell < 8.0 ) return inkPuff( q, cell );
  if ( cell < 16.0 ) return lightPuff( q, cell - 8.0 );
  if ( cell < 24.0 ) return dustPuff( q, cell - 16.0 );
  if ( cell < 32.0 ) return splash( q, cell - 24.0 );
  if ( cell < 33.0 ) { // spark: a hot needle
    float ax = abs( q.x );
    float w = 0.09 * ( 1.0 - ax ) + 0.006;
    float m = exp( -q.y * q.y / ( w * w ) ) * ( 1.0 - smoothstep( 0.8, 0.97, ax ) );
    float core = exp( -( q.x * q.x * 6.0 + q.y * q.y * 260.0 ) );
    return vec4( clamp( 0.6 + core, 0.0, 1.0 ), 0.0, 0.2 + 0.8 * ( 1.0 - ax ), clamp( m + core, 0.0, 1.0 ) );
  }
  if ( cell < 34.0 ) { float g = exp( -r * r * 5.5 ) * ( 1.0 - smoothstep( 0.8, 0.98, r ) ); return vec4( 1.0, 0.0, 0.2 + 0.8 * g, g ); }
  if ( cell < 38.0 ) { float v = cell - 34.0; return facetPoly( q * 1.08, 0.31 + v * 0.17, 0.32 + 0.06 * v, 0.88, v * 0.4 - 0.3 ); }
  if ( cell < 39.0 ) {
    float band = exp( -pow( ( r - 0.76 ) / 0.075, 2.0 ) );
    float inner = exp( -pow( ( r - 0.7 ) / 0.22, 2.0 ) ) * 0.25;
    float n = 0.7 + 0.3 * fbm( vec2( a * 2.0, r * 6.0 ) + 3.0 );
    return vec4( 1.0, band, 0.2 + 0.8 * n, clamp( ( band + inner ) * n, 0.0, 1.0 ) * cellFade( q ) );
  }
  if ( cell < 40.0 ) { // streak: brighter toward +x (the head)
    float m = exp( -q.y * q.y * 70.0 ) * smoothstep( -0.98, -0.1, q.x ) * ( 1.0 - smoothstep( 0.72, 0.98, q.x ) );
    return vec4( 0.6 + 0.4 * smoothstep( -0.6, 0.8, q.x ), 0.0, 0.2 + 0.8 * smoothstep( -1.0, 0.8, q.x ), m );
  }
  if ( cell < 41.0 ) { // sun-petal
    float y = q.y;
    float halfW = 0.42 * pow( max( 0.0, 1.0 - y * y ), 0.9 ) * ( 1.0 - 0.25 * y );
    float m = 1.0 - smoothstep( halfW - 0.02, halfW + 0.01, abs( q.x ) );
    m *= 1.0 - smoothstep( 0.9, 0.95, abs( y ) );
    float vein = 1.0 - smoothstep( 0.0, 0.03, abs( q.x ) );
    return vec4( 0.75 + 0.25 * ( 1.0 - abs( q.x ) / max( halfW, 0.01 ) ) - vein * 0.2, smoothstep( halfW - 0.08, halfW, abs( q.x ) ) * m, 0.2 + 0.8 * ( 1.0 - abs( y ) ), m );
  }
  if ( cell < 42.0 ) { // ember: a hot ragged coal
    float rr = r + ( fbm( q * 5.0 + 2.0 ) - 0.5 ) * 0.35;
    float m = 1.0 - smoothstep( 0.32, 0.5, rr );
    float core = exp( -r * r * 14.0 );
    return vec4( clamp( 0.55 + core, 0.0, 1.0 ), 0.0, 0.2 + 0.8 * ( 1.0 - clamp( rr * 1.6, 0.0, 1.0 ) ), clamp( m * 0.9 + core * 0.4, 0.0, 1.0 ) );
  }
  if ( cell < 43.0 ) { // drop
    vec2 p = q - vec2( 0.0, -0.25 );
    float body = length( p ) - 0.45;
    float tip = max( abs( q.x ) - 0.45 * ( 1.0 - ( q.y + 0.25 ) / 1.17 ), q.y - 0.92 );
    float sd = min( body, q.y > -0.25 ? tip : 8.0 );
    float m = 1.0 - smoothstep( -0.01, 0.01, sd );
    return vec4( 0.65 + 0.35 * ( 1.0 - length( p - vec2( -0.15, 0.15 ) ) ), smoothstep( -0.06, -0.01, sd ) * m, 0.2 + 0.8 * ( 1.0 - r ), m );
  }
  if ( cell < 44.0 ) { // rune → carved hour ticks on a dial ring
    float ringM = 1.0 - smoothstep( 0.02, 0.035, abs( r - 0.86 ) );
    float sec = mod( a + TAU, TAU / 12.0 ) - TAU / 24.0;
    float idx = floor( ( a + PI ) / ( TAU / 12.0 ) );
    float big = mod( idx, 3.0 ) < 0.5 ? 1.0 : 0.0;
    float len = big > 0.5 ? 0.3 : 0.16;
    float tick = ( 1.0 - smoothstep( 0.012, 0.022 + big * 0.012, abs( sec ) * r ) ) * step( 0.84 - len, r ) * step( r, 0.86 );
    float m = max( ringM, tick );
    return vec4( 1.0, m, 0.6, m );
  }
  if ( cell < 46.0 ) return crack( q, 0.23 + ( cell - 44.0 ) * 0.41 );
  if ( cell < 47.0 ) { float core = exp( -r * r * 60.0 ), halo = exp( -r * r * 7.0 ) * 0.45; float m = clamp( core + halo, 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.85, 0.98, r ) ); return vec4( 1.0, 0.0, 0.2 + 0.8 * core, m ); }
  if ( cell < 48.0 ) { // flare: a dawnglass glint, 4 long points + a soft core
    float sx = exp( -abs( q.y ) * 28.0 ) * exp( -abs( q.x ) * 2.6 );
    float sy = exp( -abs( q.x ) * 28.0 ) * exp( -abs( q.y ) * 2.6 );
    vec2 d = mat2( 0.7071, -0.7071, 0.7071, 0.7071 ) * q;
    float sd = ( exp( -abs( d.y ) * 40.0 ) * exp( -abs( d.x ) * 5.0 ) + exp( -abs( d.x ) * 40.0 ) * exp( -abs( d.y ) * 5.0 ) ) * 0.4;
    float core = exp( -r * r * 22.0 );
    float m = clamp( sx + sy + sd + core, 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.86, 0.98, r ) );
    return vec4( 1.0, 0.0, 0.2 + 0.8 * clamp( core * 2.0, 0.0, 1.0 ), m );
  }
  if ( cell < 50.0 ) return wisp( q, 0.2 + ( cell - 48.0 ) * 0.55 );
  if ( cell < 54.0 ) { float v = cell - 50.0; vec4 c = facetPoly( q * 1.1, 0.77 + v * 0.13, 0.62, 0.7, v * 0.9 ); c.r = c.r * 0.8 + 0.1; return c; }
  if ( cell < 55.0 ) { // glint: small six-point star
    float st = pow( abs( cos( a * 3.0 ) ), 24.0 ) * exp( -r * 4.0 );
    float core = exp( -r * r * 40.0 );
    float m = clamp( st + core, 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.8, 0.95, r ) );
    return vec4( 1.0, 0.0, 0.2 + 0.8 * core, m );
  }
  if ( cell < 56.0 ) { float m = 1.0 - smoothstep( 0.012, 0.03, abs( r - 0.88 ) ); return vec4( 1.0, m, 0.6, m ); }
  if ( cell < 57.0 ) { // frost: glass crystal facets
    vec3 vc = vorCell( q * 4.2 + 1.7 );
    vec2 vv = voronoi( q * 4.2 + 1.7, vec2( 0.0 ), false );
    float edge = 1.0 - smoothstep( 0.0, 0.07, vv.y - vv.x );
    float rad = 1.0 - smoothstep( 0.45, 0.95, r + ( fbm( q * 4.0 ) - 0.5 ) * 0.25 );
    float sparkle = step( 0.93, vc.z ) * exp( -vc.x * vc.x * 30.0 );
    return vec4( 0.55 + 0.45 * vc.y, clamp( edge + sparkle, 0.0, 1.0 ), clamp( 1.0 - r, 0.2, 1.0 ), clamp( ( 0.28 + 0.72 * edge ) * rad, 0.0, 1.0 ) * cellFade( q ) );
  }
  if ( cell < 58.0 ) { // caustic light pool
    vec2 w = q * 3.0 + vec2( fbm( q * 2.0 ), fbm( q * 2.0 + 4.0 ) ) * 0.8;
    vec2 vv = voronoi( w, vec2( 0.0 ), false );
    float web = pow( 1.0 - clamp( vv.y - vv.x, 0.0, 1.0 ), 6.0 );
    float fall = exp( -r * r * 2.2 ) * ( 1.0 - smoothstep( 0.8, 0.98, r ) );
    return vec4( 0.45 + 0.55 * web, web, 0.2 + 0.8 * fall, fall * ( 0.55 + 0.45 * web ) );
  }
  if ( cell < 59.0 ) { // scorch: char with an ember edge
    float d = 1.0 - r + ( fbm( q * 4.0 + 6.0 ) - 0.5 ) * 0.45;
    float m = smoothstep( 0.15, 0.42, d );
    float char = 0.35 + 0.65 * fbm( vec2( a * 3.0, r * 9.0 ) + 1.0 );
    float edge = smoothstep( 0.12, 0.2, d ) * ( 1.0 - smoothstep( 0.24, 0.42, d ) );
    return vec4( char, edge, clamp( d, 0.2, 1.0 ), m * cellFade( q ) );
  }
  if ( cell < 60.0 ) return splash( q, 5.5 );
  return vec4( 0.0 );
}

void main() {
  if ( uMode < 0.5 ) {
    vec2 px = vUv * uSize;
    vec2 cxy = floor( px / ( uSize / 8.0 ) );
    float cell = cxy.x + cxy.y * 8.0;
    vec2 q = fract( px / ( uSize / 8.0 ) ) * 2.0 - 1.0;
    gl_FragColor = clamp( cellFn( cell, q ), 0.0, 1.0 );
  } else {
    vec2 uv = vUv;
    float r = pfbm( uv * 8.0, vec2( 8.0 ) );
    vec2 vv = voronoi( uv * 6.0, vec2( 6.0 ), true );
    float g = clamp( ( vv.y - vv.x ) * 1.6, 0.0, 1.0 );
    float b = pfbm( vec2( uv.x * 4.0, uv.y * 24.0 ), vec2( 4.0, 24.0 ) );
    float a = pfbm( uv * 16.0 + 17.0, vec2( 16.0 ) );
    gl_FragColor = vec4( r, g, b, a );
  }
}`;

/** the generated textures; they exist (empty) from construction and fill on the first `generate` */
export class VfxTextures {
  readonly atlasTarget: WebGLRenderTarget;
  readonly noiseTarget: WebGLRenderTarget;
  ready = false;

  constructor() {
    this.atlasTarget = new WebGLRenderTarget(ATLAS_PX, ATLAS_PX, { depthBuffer: false, stencilBuffer: false, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter });
    this.noiseTarget = new WebGLRenderTarget(NOISE_PX, NOISE_PX, { depthBuffer: false, stencilBuffer: false, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: RepeatWrapping });
    this.atlasTarget.texture.name = 'vale_vfx_atlas';
    this.noiseTarget.texture.name = 'vale_vfx_noise';
  }

  get atlas(): Texture { return this.atlasTarget.texture; }
  get noise(): Texture { return this.noiseTarget.texture; }

  /** render both textures once (call with the live renderer before the first VFX draw) */
  generate(renderer: WebGLRenderer): void {
    if (this.ready) return;
    this.ready = true;
    const mat = new ShaderMaterial({ vertexShader: GEN_VERT, fragmentShader: GEN_FRAG, uniforms: { uMode: { value: 0 }, uSize: { value: [ATLAS_PX, ATLAS_PX] } }, depthTest: false, depthWrite: false });
    const quad = new Mesh(new PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const scene = new Scene();
    scene.add(quad);
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(this.atlasTarget);
    renderer.render(scene, cam);
    mat.uniforms.uMode.value = 1;
    mat.uniforms.uSize.value = [NOISE_PX, NOISE_PX];
    renderer.setRenderTarget(this.noiseTarget);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevClear;
    mat.dispose();
    quad.geometry.dispose();
  }

  dispose(): void { this.atlasTarget.dispose(); this.noiseTarget.dispose(); }
}
