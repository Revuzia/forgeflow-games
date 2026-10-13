// VALE render — small shared GLSL helpers (noise, bump) for procedural world materials.

export const NOISE_GLSL = /* glsl */`
float valeHash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
vec2 valeHash22( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.xx + p3.yz ) * p3.zy );
}
float valeNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( valeHash12( i ), valeHash12( i + vec2( 1.0, 0.0 ) ), u.x ),
              mix( valeHash12( i + vec2( 0.0, 1.0 ) ), valeHash12( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float valeFbm( vec2 p ) {
  float a = 0.5, s = 0.0;
  for ( int i = 0; i < 4; i ++ ) { s += a * valeNoise( p ); p = mat2( 1.6, 1.2, -1.2, 1.6 ) * p; a *= 0.5; }
  return s;
}
// irregular honed pavers (Voronoi with exact border distance): x = cell hash, y = distance to the
// nearest joint in metres, zw = cell id
vec4 valePavers( vec2 p, float size ) {
  vec2 q = p / size;
  vec2 i = floor( q ), f = fract( q );
  float d1 = 8.0;
  vec2 mr = vec2( 0.0 ), mg = vec2( 0.0 );
  for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
    vec2 g = vec2( float( x ), float( y ) );
    vec2 r = g + valeHash22( i + g ) * 0.76 + 0.12 - f;
    float d = dot( r, r );
    if ( d < d1 ) { d1 = d; mr = r; mg = g; }
  }
  float md = 8.0;
  for ( int y = -2; y <= 2; y ++ ) for ( int x = -2; x <= 2; x ++ ) {
    vec2 g = mg + vec2( float( x ), float( y ) );
    vec2 r = g + valeHash22( i + g ) * 0.76 + 0.12 - f;
    vec2 dr = r - mr;
    if ( dot( dr, dr ) > 1e-5 ) md = min( md, dot( 0.5 * ( mr + r ), normalize( dr ) ) );
  }
  vec2 id = i + mg;
  return vec4( valeHash12( id * 1.37 + 0.5 ), md * size, id );
}
// Mikkelsen-style derivative bump: perturb a view-space normal by a scalar height field
vec3 valeBump( vec3 surfPos, vec3 surfNorm, float h, float scale ) {
  vec3 sx = dFdx( surfPos ), sy = dFdy( surfPos );
  vec3 r1 = cross( sy, surfNorm ), r2 = cross( surfNorm, sx );
  float det = dot( sx, r1 );
  vec2 dh = vec2( dFdx( h ), dFdy( h ) ) * scale;
  vec3 grad = sign( det ) * ( dh.x * r1 + dh.y * r2 );
  return normalize( abs( det ) * surfNorm - grad );
}
`;
