// VALE render — terrain shader chunks (lane TERRAIN). Injected into MeshStandardMaterial programs by
// render/terrain.ts (onBeforeCompile); NOISE_GLSL (glsl.ts) and INLAY_GLSL (terrain_inlay.ts) are prepended
// by the caller.
//
// Cost budget (1080p60 on High): one flag layout per ground pixel at most (Voronoi on the roads, closed-form
// rings / courses elsewhere; skipped deep in the Dialwood), ≤ 11 texture fetches, four value-noise calls plus
// one 4-octave fbm. No loops over polygons: every map shape arrives as a baked distance field (the camp-room
// lookup is a ≤ 16-point nearest search, only on room stone).

/** shared helpers: painted-texture means, anti-tiling, flag layouts, one-flag shading */
export const TERRAIN_HELPERS_GLSL = /* glsl */`
vec3 valeTexMean( sampler2D t ) { return max( textureLod( t, vec2( 0.5 ), 16.0 ).rgb, vec3( 0.02 ) ); }
// organic paintings: two rotated copies switched by a noise mask (hard-ish switch: no ghosted leaves)
vec4 valeTex2( sampler2D t, vec2 uv, float m ) {
  vec4 a = texture( t, uv );
  vec2 r = vec2( 0.8 * uv.x - 0.6 * uv.y, 0.6 * uv.x + 0.8 * uv.y ) * 0.93 + vec2( 0.37, 0.71 );
  vec4 b = texture( t, r );
  return mix( a, b, smoothstep( 0.44, 0.56, m ) );
}
// organic paintings (litter, moss): keep the painting's own hues, land its mean VALUE on the band, lean
// the hue toward the band by k (a ratio map would turn brown soil purple under a green mean)
vec3 valeOrganic( vec3 t, vec3 mean, vec3 band, float k ) {
  const vec3 LW = vec3( 0.2126, 0.7152, 0.0722 );
  float lm = max( dot( mean, LW ), 1e-3 );
  float lt = dot( t, LW ) / lm;
  return mix( t * ( dot( band, LW ) / lm ), band * lt, k );
}
// the site (centre) of a valePavers cell, in metres
vec2 valePaverSite( vec4 f, float size ) { return ( f.zw + valeHash22( f.zw ) * 0.76 + 0.12 ) * size; }
// flags laid in rings round a centre (plazas, camp rooms, the Seat, the Noonplate): x = flag hash, y = distance
// to the nearest joint (m), zw = (ring, segment); ring −7 is the centre disc
vec4 valeRingFlags( vec2 p, vec2 c, float r0, float ringW, float segLen ) {
  vec2 d = p - c;
  float r = length( d );
  float rr = max( r - r0, 0.0 );
  float ri = floor( rr / ringW );
  float rl = rr - ri * ringW;
  float rc = r0 + ( ri + 0.5 ) * ringW;
  float nseg = max( 6.0, floor( 6.2831853 * rc / segLen ) );
  float t = ( atan( d.y, d.x ) / 6.2831853 + 0.5 ) * nseg + floor( valeHash12( vec2( ri, 7.13 ) ) * 97.0 ) + valeHash12( vec2( ri, 3.7 ) );
  float si = mod( floor( t ), nseg );
  float sl = fract( t );
  float arc = 6.2831853 * max( r, 0.01 ) / nseg;
  float e = min( min( rl, ringW - rl ), min( sl, 1.0 - sl ) * arc );
  if ( r < r0 ) e = r0 - r;
  vec2 id = vec2( r < r0 ? -7.0 : ri, r < r0 ? 0.0 : si );
  return vec4( valeHash12( id * 1.37 + 0.5 ), e, id );
}
// long courses of stone along x (the deck, the shadow's slabs, the shaft's fragments): x = hash, y = joint
// distance, zw = id
vec4 valeCourses( vec2 p, float cw, float baseL ) {
  float row = floor( p.y / cw );
  float rl = p.y - row * cw;
  float L = baseL * ( 0.7 + 0.6 * valeHash12( vec2( row, 1.31 ) ) );
  float x = p.x / L + floor( valeHash12( vec2( row, 9.17 ) ) * 7.0 ) + 0.5 * valeHash12( vec2( row, 2.2 ) );
  float k = floor( x );
  float b0 = k + ( valeHash12( vec2( row, k ) ) - 0.5 ) * 0.5;
  float b1 = k + 1.0 + ( valeHash12( vec2( row, k + 1.0 ) ) - 0.5 ) * 0.5;
  float ci = k;
  if ( x < b0 ) { b1 = b0; ci = k - 1.0; b0 = k - 1.0 + ( valeHash12( vec2( row, k - 1.0 ) ) - 0.5 ) * 0.5; }
  else if ( x > b1 ) { b0 = b1; ci = k + 1.0; b1 = k + 2.0 + ( valeHash12( vec2( row, k + 2.0 ) ) - 0.5 ) * 0.5; }
  float e = min( min( rl, cw - rl ), min( x - b0, b1 - x ) * L );
  vec2 id = vec2( row, ci );
  return vec4( valeHash12( id * 1.37 + 3.1 ), e, id );
}
// the gorge's rim plateau (Needlespan, beyond the far walls): bare bedrock in great weathered slabs, grey with
// lichen, turf and moss in the cracks and hollows (never the Dialwood's leaf litter); hh = bump height (m)
vec3 valeRockPlateau( vec2 p, sampler2D tg, sampler2D tm, vec3 rock, vec3 moss, out float hh ) {
  vec2 w = p + vec2( valeNoise( p * 0.21 ) - 0.5, valeNoise( p * 0.21 + 5.0 ) - 0.5 ) * 2.4;
  vec4 f = valePavers( w, 5.6 );
  vec4 g = texture( tg, p / 4.0 );
  vec3 gN = mix( vec3( 1.0 ), g.rgb / valeTexMean( tg ), 0.85 );
  float big = valeFbm( p * 0.045 + 1.3 );
  // weathered bedrock: warm grey, broad tonal drifts, each slab a little different
  vec3 c = rock * vec3( 1.1, 1.04, 0.93 ) * ( 0.86 + 0.22 * f.x ) * ( 0.8 + 0.4 * big ) * gN;
  // only some joints are open cracks (bedrock, not paving); they wander and pinch out
  float open_ = smoothstep( 0.35, 0.6, valeNoise( w * 0.35 + f.zw * 0.7 ) );
  float e = f.y + ( g.a - 0.6 ) * 0.15 + ( valeNoise( p * 1.7 ) - 0.5 ) * 0.12;
  float crack = ( 1.0 - smoothstep( 0.03, 0.11, e ) ) * open_;
  c *= 1.0 - 0.35 * crack;
  c *= mix( 0.86, 1.0, smoothstep( 0.0, 0.45, e ) * open_ + ( 1.0 - open_ ) );
  vec4 m = texture( tm, p / 4.0 );
  vec3 mm = valeTexMean( tm );
  vec3 mc = valeOrganic( mix( mm, m.rgb, 0.7 ), mm, moss * 0.8, 0.5 );
  // moss and turf only in the hollows and along open cracks; lichen rosettes on the dry stone
  float hollow = smoothstep( 0.7, 0.86, valeNoise( p * 0.11 + 2.0 ) * 0.7 + ( 1.0 - big ) * 0.3 + ( m.a - 0.6 ) * 0.5 );
  float mossA = max( crack * smoothstep( 0.3, 0.6, valeNoise( p * 0.6 ) ) * 0.75, hollow * 0.8 );
  c = mix( c, mix( mc, c * vec3( 0.8, 0.9, 0.7 ), 0.3 ), mossA );
  float li = smoothstep( 0.74, 0.82, valeNoise( p * 2.3 + f.zw * 3.1 ) ) * ( 1.0 - mossA );
  c = mix( c, c * vec3( 1.16, 1.12, 0.9 ) + 0.012, li * 0.5 );
  hh = smoothstep( 0.0, 0.3, e ) * 0.05 * open_ + ( g.a - 0.6 ) * 0.06 + ( m.a - 0.6 ) * 0.03 * mossA;
  return c;
}
// one flag: per-flag value and a slight warm/cool drift, a worn (paler) face, painted edge darkening, joint
// fill; h = bevel height (m)
vec3 valeFlag( vec3 band, vec4 f, vec3 grainN, float chip, float jointW, vec3 jointC, float varK, out float h, out float jw ) {
  float e = f.y + chip;
  jw = 1.0 - smoothstep( jointW * 0.35, jointW, e );
  float hue = fract( f.x * 13.7 ) - 0.5;
  vec3 c = band * ( 1.0 + ( f.x - 0.5 ) * varK ) * vec3( 1.0 + 0.08 * hue, 1.0, 1.0 - 0.09 * hue ) * grainN;
  // a soft painted edge and a worn, paler face (r12 B5: low-contrast joints, so the walked stone stays one quiet band)
  c *= mix( 0.86, 1.0, smoothstep( 0.0, 0.16, e ) ) * ( 1.0 + 0.05 * smoothstep( 0.18, 0.5, e ) );
  c = mix( c, jointC, jw );
  h = smoothstep( 0.0, 0.085, e ) * 0.032 + ( f.x - 0.5 ) * 0.006;
  return c;
}
`;

/** r12 M14: the jungle quadrant tint (art.terrain.quadrantTint): four per-channel multipliers (each within ±4 % of 1,
 *  luminance kept) blended across the map's two axes (the Noonline and the Mid road) over ± blend m, so a player knows
 *  which quarter of the Dialwood they stand in. Identity (all 1) on a map without one. */
export const QUAD_TINT_GLSL = /* glsl */`
uniform vec3 uQuadNW, uQuadNE, uQuadSW, uQuadSE;
uniform vec3 uQuadC;
vec3 valeQuadTint( vec2 p ) {
  float e = smoothstep( -uQuadC.z, uQuadC.z, p.x - uQuadC.x );
  float s = smoothstep( -uQuadC.z, uQuadC.z, p.y - uQuadC.y );
  return mix( mix( uQuadNW, uQuadNE, e ), mix( uQuadSW, uQuadSE, e ), s );
}
`;
/** the same tint on an instanced, vertex-coloured mesh (trees, Needlegrass): after <color_vertex> */
export const QUAD_TINT_VERT = /* glsl */`
#if defined( USE_COLOR ) && defined( USE_INSTANCING )
vColor.rgb *= valeQuadTint( ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xz );
#elif defined( USE_COLOR_ALPHA ) && defined( USE_INSTANCING )
vColor.rgb *= valeQuadTint( ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xz );
#endif
`;

/** ground: uniform + varying declarations (fragment) */
export const GROUND_PARS_GLSL = /* glsl */`
varying vec3 vGroundW;
uniform sampler2D uSplat; uniform sampler2D uSplat2;
uniform vec2 uSplatScale; uniform vec2 uMapSize; uniform float uLaneHalf;
uniform sampler2D uTexLitter, uTexGrain, uTexMoss;
uniform vec3 uLane, uGrout, uVerge, uJungle, uMoss, uEarth, uClearing, uInscription, uThicketFloor, uShaftFloor, uSeatC, uMidInlay, uLitC;
uniform vec3 uPlazaA, uPlazaS, uInlayA, uInlayS, uSheenC, uRockC;
uniform vec4 uPlaza0, uPlaza1, uFount0, uFount1;
uniform vec3 uSeat; uniform vec3 uPlate;
uniform vec4 uRooms[ 16 ]; uniform int uRoomN;
uniform vec4 uShaftAx;
uniform vec3 uTempW, uTempE; uniform float uTempK; uniform float uWaterT;
uniform vec3 uSeatCol[ 10 ];
float gHeight; float gRough; vec3 gEmit; float gSheen;
`;

/** the ground body (replaces <map_fragment>) */
export const GROUND_MAIN_GLSL = /* glsl */`
{
  vec2 p = vGroundW.xz;
  vec2 su = p * uSplatScale;
  vec4 s1 = texture( uSplat, su );
  vec4 s2 = texture( uSplat2, su );
  bool inMap = p.x >= 0.0 && p.y >= 0.0 && p.x <= uMapSize.x && p.y <= uMapSize.y;
  float laneD = s1.r * 16.0, clearD = s1.g * 24.0 - 8.0, wallD = s1.b * 8.0, thickD = s1.a * 8.0 - 4.0;
  float shaftSD = s2.g * 8.0 - 4.0;
#ifdef VALE_GORGE
  float chasmSD = s2.a * 8.0 - 4.0;
  if ( inMap && chasmSD > 0.0 ) discard;
  float edgeD = inMap ? -chasmSD : 4.0;
#endif
  vec4 inl = valeInlay( p );
  float aa = clamp( length( fwidth( p ) ) * 0.75, 0.004, 0.25 );
  float nBig = valeFbm( p * 0.045 + 3.7 );
  float nMid = valeNoise( p * 0.31 ) * 0.65 + valeNoise( p * 0.83 + 5.1 ) * 0.35;
  float n2 = valeNoise( p * 2.3 );
  float wob = ( nMid - 0.5 ) * 1.3 + ( n2 - 0.5 ) * 0.35;
  vec4 tG = texture( uTexGrain, p / 3.0 );
  vec3 grainN = mix( vec3( 1.0 ), tG.rgb / valeTexMean( uTexGrain ), 0.65 );
  float gh = tG.a - 0.6;
  vec4 tM = valeTex2( uTexMoss, p / 4.0, valeNoise( p * 0.13 + 2.0 ) );
  vec3 mossN = mix( vec3( 1.0 ), tM.rgb / valeTexMean( uTexMoss ), 0.75 );
  float chip = ( valeNoise( p * 9.0 ) - 0.5 ) * 0.045 + gh * 0.1;
  vec3 col = uJungle; float h = 0.0; float rough = 0.95; vec3 emit = vec3( 0.0 );
  gSheen = 0.0;
  float brush = 1.0 - smoothstep( -0.25, 0.2, thickD );
#ifdef VALE_STYLE_DIAL
  // ── the Dialwood floor: moss and fan-leaf litter over old dial-stone, broad hue and value drifts ──
  vec4 tL = valeTex2( uTexLitter, p / 6.0, valeNoise( p * 0.11 + 7.0 ) );
  vec3 fband = uJungle;
  fband = mix( fband, uMoss, smoothstep( 0.42, 0.68, nBig ) * 0.6 );
  fband = mix( fband, uEarth, smoothstep( 0.5, 0.75, valeNoise( p * 0.06 + 11.0 ) ) * 0.55 );
  fband *= 0.86 + 0.28 * nMid;
  vec3 meanL = valeTexMean( uTexLitter );
  col = valeOrganic( mix( meanL, tL.rgb, 0.78 ), meanL, fband, 0.5 );
  h = ( tL.a - 0.6 ) * 0.05;
  vec3 meanM = valeTexMean( uTexMoss );
  vec3 mossC = valeOrganic( mix( meanM, tM.rgb, 0.72 ), meanM, uMoss, 0.5 );
  // moss banks at the wall feet
  float foot = 1.0 - smoothstep( 0.1, 1.5, wallD + ( n2 - 0.5 ) * 0.7 + ( nMid - 0.5 ) * 0.7 );
  col = mix( col, mossC * 0.9, foot * 0.75 );
  h = mix( h, ( tM.a - 0.6 ) * 0.06, foot );
  col = mix( col, valeOrganic( tM.rgb, valeTexMean( uTexMoss ), uThicketFloor, 0.5 ), brush * 0.9 );
  // the hour-line groove along every Dialwood path (a chalky 0.3 m channel, ≤ 6 L*)
  float gr = 1.0 - smoothstep( -aa, aa, inl.g );
  float grCore = 1.0 - smoothstep( -aa, aa, inl.g + 0.1 );
  float grLip = ( 1.0 - smoothstep( -aa, aa, inl.g - 0.04 ) ) - gr;
  float grK = 1.0 - brush;
  col *= 1.0 - 0.2 * ( gr - grCore ) * grK;
  col = mix( col, col * 1.3 + uInscription * 0.012, grCore * grK );
  col *= 1.0 + 0.08 * grLip * grK;
  h -= gr * 0.008;
  // stone: roads, their broken verges, camp rooms
  if ( laneD < uLaneHalf + 2.4 || clearD < 2.4 ) {
    vec4 fl = valePavers( p, 1.3 );
    // whole flags are lost to the wood: decide per flag from the fields at its centre
    vec2 site = valePaverSite( fl, 1.3 );
    vec4 ss = texture( uSplat, site * uSplatScale );
    float sLane = ss.r * 16.0;
    float sv = valeNoise( site * 0.37 + 1.3 );
    float road = 1.0 - smoothstep( uLaneHalf - aa, uLaneHalf + aa, laneD );
    float vergeT = clamp( ( laneD - uLaneHalf ) / 1.6, 0.0, 1.0 );
    float keepV = ( 1.0 - clamp( ( sLane - uLaneHalf ) / 1.7, 0.0, 1.0 ) ) * 1.15 + ( fl.x - 0.5 ) * 0.7 + ( sv - 0.5 ) * 0.4 - 0.12;
    float vergeW = step( 0.5, keepV ) * ( 1.0 - road ) * step( uLaneHalf - 0.4, laneD );
    float fh, jw, fv, jv, fr, jr;
    // road: honed pale flags, polished toward the centre line, moss only in the outer joints
    vec3 roadBand = uLane * ( 1.0 + 0.05 * ( 1.0 - smoothstep( 0.0, uLaneHalf, laneD ) ) + 0.07 * ( nMid - 0.5 ) + 0.04 * ( nBig - 0.5 ) );
    // painted wear at the scale of a fight (r12 B5): broad drifts of pale dial-dust where few feet go, a polished
    // walked track down the middle, flags chipped and broken toward the verges. Value-neutral (the dust keeps the
    // stone's luminance, ±3 % at most), so the walked stone stays one quiet band (walkable p95 - p5 <= 45)
    float wearN = valeFbm( p * 0.07 + 17.3 );
    float dustP = smoothstep( 0.5, 0.72, wearN + ( nMid - 0.5 ) * 0.35 ) * smoothstep( 0.6, uLaneHalf - 0.4, laneD + ( n2 - 0.5 ) * 0.8 );
    float trackP = 1.0 - smoothstep( 0.4, 1.6, laneD + ( nMid - 0.5 ) * 0.9 );
    vec3 dustTone = mix( uLane, uClearing * ( dot( uLane, vec3( 0.2126, 0.7152, 0.0722 ) ) / max( dot( uClearing, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 ) ), 0.6 );
    roadBand = mix( roadBand, dustTone * ( 1.0 + 0.03 * ( n2 - 0.5 ) ), dustP * 0.75 );
    roadBand *= 1.0 + 0.025 * trackP;
    vec3 grainR = mix( grainN, vec3( 1.0 ), max( dustP * 0.55, trackP * 0.35 ) );
    float chipR = chip * ( 1.0 + 2.2 * smoothstep( uLaneHalf - 2.0, uLaneHalf - 0.3, laneD + wob * 0.5 ) );
    vec3 roadC = valeFlag( roadBand, fl, grainR, chipR, 0.04, uGrout, 0.12, fh, jw );
    // the dust drifts into the joints and softens the bevels: under a drift the flag pattern fades (painted, not stamped)
    float dustJ = smoothstep( 0.2, 0.8, dustP + ( valeNoise( p * 1.7 ) - 0.5 ) * 0.5 );
    roadC = mix( roadC, dustTone * 0.94 * mix( vec3( 1.0 ), grainN, 0.3 ), jw * dustJ * 0.85 );
    fh *= 1.0 - 0.75 * dustJ;
    float edgeMoss = smoothstep( uLaneHalf - 1.6, uLaneHalf - 0.3, laneD + wob * 0.6 );
    roadC = mix( roadC, mossC * 0.8, jw * edgeMoss * 0.85 );
    // the inscription band (0.3 m) on each outer edge, a carved strip with chalk hour-ticks
    float bandW = smoothstep( uLaneHalf - 0.3 - aa, uLaneHalf - 0.3 + aa, laneD );
    float bEdge = 1.0 - smoothstep( 0.0, 0.03 + aa, min( abs( laneD - ( uLaneHalf - 0.3 ) ), abs( laneD - uLaneHalf ) ) );
    vec3 bandC = uLane * 0.84 * grainN * ( 0.96 + 0.08 * n2 ) * ( 1.0 - 0.18 * bEdge );
    float tick = 1.0 - smoothstep( -aa, aa, inl.r );
    float tickC = ( 1.0 - smoothstep( -aa, aa, inl.r - 0.025 ) ) - tick;
    bandC *= 1.0 - 0.35 * tickC;
    bandC = mix( bandC, uInscription * 1.08, tick * 0.9 );
    // moss in the band's own pores (never shaped by the road's flags under it: that read as a ghosted film)
    bandC = mix( bandC, mossC * 0.85, smoothstep( 0.7, 0.86, gh * 2.0 + ( n2 - 0.5 ) * 0.7 + ( valeNoise( p * 0.9 + 3.3 ) - 0.5 ) * 0.6 + 0.3 ) * 0.6 * ( 1.0 - tick ) );
    roadC = mix( roadC, bandC, bandW );
    // (the cut edges' relief is broad and soft: a 3 cm step in the bump height breaks up into dots, since the
    // derivative bump sees it per 2×2 pixel quad)
    float bEdgeH = 1.0 - smoothstep( 0.0, 0.05 + 3.0 * aa, min( abs( laneD - ( uLaneHalf - 0.3 ) ), abs( laneD - uLaneHalf ) ) );
    fh = mix( fh, -0.004 - bEdgeH * 0.006 - tickC * 0.002, bandW );
    // verge: worn darker flags, moss in every joint and creeping over them toward the wood
    vec3 vergeC = valeFlag( uVerge * ( 0.93 + 0.14 * nMid ), fl, grainN, chip * 1.5, 0.075, mossC * 0.75, 0.2, fv, jv );
    float creep = smoothstep( 0.55, 0.8, vergeT * 0.8 + ( tM.a - 0.6 ) * 0.9 + ( n2 - 0.5 ) * 0.7 + ( nMid - 0.5 ) * 0.5 + ( 1.0 - fl.x ) * 0.25 );
    vergeC = mix( vergeC, mossC * 0.85, creep * 0.9 );
    fv = mix( fv, ( tM.a - 0.6 ) * 0.05, creep );
    // camp rooms: dusty pale stone laid in rings round the camp (never the roads' irregular flags), dust in the
    // joints, moss creeping in from the rim; whole rings of flags lost to the wood at the edge
    vec3 roomC = col; float roomW = 0.0; fr = h;
    if ( clearD < 2.4 && uRoomN > 0 ) {
      vec4 rc = uRooms[ 0 ]; float rb = 1e9;
      for ( int k = 0; k < 16; k ++ ) {
        if ( k >= uRoomN ) break;
        vec4 R = uRooms[ k ];
        float dd = length( p - R.xy ) - R.z;
        if ( dd < rb ) { rb = dd; rc = R; }
      }
      vec4 rf = valeRingFlags( p, rc.xy, 1.3, 1.15, 1.55 );
      float rr = rf.z < -1.0 ? 0.6 : 1.3 + ( rf.z + 0.5 ) * 1.15;
      float rsv = valeNoise( rf.zw * vec2( 0.9, 0.37 ) + rc.xy * 0.1 );
      float keepR = ( 1.0 - clamp( ( rr - rc.z + 0.7 ) / 2.2, 0.0, 1.0 ) ) * 1.15 + ( rf.x - 0.5 ) * 0.6 + ( rsv - 0.5 ) * 0.45 - 0.12;
      roomW = step( 0.5, keepR ) * ( 1.0 - road );
      float roomT = clamp( ( clearD + 0.8 ) / 2.4, 0.0, 1.0 );
      vec3 dust = uClearing * vec3( 1.03, 1.0, 0.95 );
      roomC = valeFlag( mix( uClearing, dust, smoothstep( 0.4, 0.7, nMid ) ) * ( 0.95 + 0.1 * nMid ), rf, grainN, chip * 1.3, 0.06, uClearing * vec3( 0.7, 0.67, 0.62 ), 0.16, fr, jr );
      // the room's centre disc: one worn hearth stone with a carved ring
      float cr = length( p - rc.xy );
      float ring = 1.0 - smoothstep( 0.0, 0.03 + aa, abs( cr - 1.0 ) - 0.03 );
      roomC *= 1.0 - 0.25 * ring;
      float creepR = smoothstep( 0.55, 0.8, roomT * 0.8 + ( tM.a - 0.6 ) * 0.9 + ( n2 - 0.5 ) * 0.7 + ( nMid - 0.5 ) * 0.5 + ( 1.0 - rf.x ) * 0.2 );
      roomC = mix( roomC, mossC * 0.85, max( jr * smoothstep( 0.2, 0.8, roomT ), creepR * 0.9 ) );
      fr = mix( fr - ring * 0.004, ( tM.a - 0.6 ) * 0.05, creepR );
    }
    col = mix( col, roomC, roomW ); h = mix( h, fr, roomW );
    col = mix( col, vergeC, vergeW ); h = mix( h, fv, vergeW );
    col = mix( col, roadC, road ); h = mix( h, fh, road );
    rough = mix( rough, 0.82, max( vergeW, roomW ) ); rough = mix( rough, 0.66, road );
  }
  // Fallen Shaft floor: pale cool fragments of the shaft lying along its fall, under the water film; a wet bank
  if ( shaftSD < 1.0 ) {
    float shw = 1.0 - smoothstep( -aa, aa, shaftSD );
    float hs, js;
    vec2 sa = p - uShaftAx.xy;
    vec2 sq = vec2( dot( sa, uShaftAx.zw ), dot( sa, vec2( -uShaftAx.w, uShaftAx.z ) ) );
    vec4 sf = valeCourses( sq + vec2( 31.0, 0.4 ), 1.05, 2.1 );
    vec3 sfc = valeFlag( uShaftFloor * ( 0.95 + 0.1 * nMid ), sf, grainN, chip, 0.06, uShaftFloor * 0.5, 0.18, hs, js );
    sfc *= mix( 0.78, 1.0, smoothstep( -0.9, -0.15, shaftSD ) );
    // light through the ripples: drifting caustic threads on the stone
    float ct = uWaterT;
    float ca = abs( valeNoise( p * 1.25 + vec2( ct * 0.21, ct * 0.13 ) ) * 2.0 - 1.0 );
    float cb = abs( valeNoise( p * 1.9 - vec2( ct * 0.17, -ct * 0.11 ) + 4.0 ) * 2.0 - 1.0 );
    float caust = pow( 1.0 - min( ca, cb ), 7.0 );
    sfc *= vec3( 0.8, 0.9, 0.96 );
    emit += uShaftFloor * caust * 0.09 * shw;
    sfc *= 1.0 + caust * 0.35;
    col = mix( col, sfc, shw ); h = mix( h, hs * 0.5, shw ); rough = mix( rough, 0.6, shw );
    col *= 1.0 - 0.3 * ( 1.0 - smoothstep( 0.0, 0.7, shaftSD ) ) * ( 1.0 - shw );
  }
#endif
#ifdef VALE_STYLE_SPAN
  // ── the fallen shaft's deck: honed needle stone in long courses along the shaft ──
  vec4 fl = valeCourses( p, 1.18, 2.9 );
  float fh, jw;
  col = valeFlag( uLane * ( 0.97 + 0.07 * nMid + 0.03 * ( nBig - 0.5 ) ), fl, grainN, chip, 0.035, uGrout, 0.1, fh, jw );
  // the walked course: the deck is honed palest along the road and weathers darker, stone by stone, toward the drop
  // (r12 B5: the road owns the top of the terrain's value range; the outer courses sit a band lower)
  col *= mix( 1.0, 0.35, smoothstep( uLaneHalf - 0.8, uLaneHalf + 1.8, laneD + ( fl.x - 0.5 ) * 0.9 ) );
  h = fh; rough = 0.7;
  float offLane = smoothstep( uLaneHalf + 1.2, uLaneHalf + 3.5, laneD );
  col = mix( col, uMoss * mossN * 0.8, jw * max( offLane, brush ) * 0.9 );
  float keepL = 0.85 - offLane * 0.45 + ( fl.x - 0.5 ) * 0.8 + gh * 0.6 + wob * 0.15;
  float mossF = ( 1.0 - smoothstep( 0.44, 0.5, keepL ) ) * offLane;
  col = mix( col, uMoss * mossN * 0.78, mossF ); h = mix( h, ( tM.a - 0.6 ) * 0.05, mossF );
  col = mix( col, uThicketFloor * mossN, brush * 0.9 );
  // the Snap: fine crazing (grooves) and the lit fracture
  float cz = 1.0 - smoothstep( -aa, aa, inl.g );
  float czL = ( 1.0 - smoothstep( -aa, aa, inl.g - 0.02 ) ) - cz;
  float lit = 1.0 - smoothstep( -aa, aa, inl.b );
  float litE = ( 1.0 - smoothstep( -aa, aa, inl.b - 0.03 ) ) - lit;
  float litGlow = 1.0 - smoothstep( -aa, 0.3, inl.b );
  // the drop: a pale chalk band of carved hour-script on every walkable edge (0.4 m); never under the brush
  float bandS = ( 1.0 - smoothstep( 0.4 - aa, 0.4 + aa, edgeD ) ) * ( 1.0 - brush );
  vec3 bandC = uInscription * grainN * ( 0.95 + 0.1 * n2 );
  bandC = mix( bandC, bandC * 0.62, cz );
  bandC *= 1.0 + 0.06 * czL;
  float bEdge = 1.0 - smoothstep( 0.0, 0.03 + aa, abs( edgeD - 0.4 ) );
  bandC *= 1.0 - 0.4 * bEdge;
  col = mix( col, col * 0.72, cz * ( 1.0 - bandS ) );
  col *= 1.0 + 0.05 * czL * ( 1.0 - bandS );
  col = mix( col, bandC, bandS ); h = mix( h, -cz * 0.006, bandS ); h -= cz * 0.006 * ( 1.0 - bandS );
  rough = mix( rough, 0.75, bandS );
  // the fracture: dark broken lips, a lit seam deep inside. Its core is capped at ~luma 160 (L* 65, r12 B5): the
  // fracture reads by contrast against its dark lips, never as a near-white line where telegraphs and skill shots draw
  col = mix( col, col * 0.45, litE );
  col = mix( col, uLitC * 0.24, lit );
  col = mix( col, col * 1.1, litGlow * ( 1.0 - lit - litE ) );
  emit = uLitC * ( lit * 0.13 + litGlow * 0.04 * ( 1.0 - litE ) );
  h -= lit * 0.012 + litE * 0.01;
#endif
#ifdef VALE_STYLE_PLATE
  // ── the Noonplate at the Shadowless Noon: honed dial-stone in rings of great slabs under the overhead sun
  //    (L* 34-40 in vision, r12 B5; fog of war still darkens it), faint grey veins, a satin sheen. The ten
  //    hour-lines and the numerals are inlaid DARK (basalt in the pale stone, like a sundial's cut lines), the
  //    shop ring a mid inlay, the hour-ring and half-hour ticks cut as grooves with a sunlit lip ──
  vec4 pf = valeRingFlags( p, uPlate.xy, 4.15, 3.3, 3.9 );
  float fh, jw;
  // honed, not cast: each slab one even tone of its own (no cloudy mottle across it), a fine grain, crisp joints
  vec3 basN = mix( vec3( 1.0 ), tG.rgb / valeTexMean( uTexGrain ), 0.22 );
  float sv = valeHash12( pf.zw + 7.7 );
  vec3 slabC = uLane * ( 0.94 + 0.1 * valeHash12( pf.zw + 1.9 ) + 0.025 * ( nMid - 0.5 ) ) * mix( vec3( 1.02, 1.0, 0.97 ), vec3( 0.98, 1.0, 1.025 ), sv );
  col = valeFlag( slabC, pf, basN, chip * 0.6, 0.03, uLane * 0.62, 0.1, fh, jw );
  // veins: thin grey mineral threads wandering across some slabs
  vec2 vq = p * 0.55 + pf.zw * 3.1;
  float vn = abs( valeNoise( vq ) + 0.5 * valeNoise( vq * 2.3 + 1.7 ) - 0.75 );
  float vein = ( 1.0 - smoothstep( 0.0, 0.03, vn ) ) * smoothstep( 0.5, 0.8, valeHash12( pf.zw + 4.0 ) );
  col = mix( col, uLane * 0.72, vein * 0.3 );
  h = fh * 0.7; rough = 0.52 + 0.08 * valeHash12( pf.zw + 9.0 );
  gSheen = 0.6 + 0.4 * valeHash12( pf.zw + 2.0 );
  // a worn, paler course of stone at the foot of the rim wall and round the hour-stones (where every walker turns),
  // so their contact shadow never sinks the walked stone below its band (r12 B5: walkable p95 - p5 <= 45 in every
  // seat's spawn view)
  col *= 1.0 + 0.14 * ( 1.0 - smoothstep( 0.05, 1.0, wallD ) );
  col = mix( col, uThicketFloor * mossN, brush * 0.9 );
  float ch = 1.0 - smoothstep( -aa, aa, inl.r );
  float md = 1.0 - smoothstep( -aa, aa, inl.a );
  // the inlays sit in a cut: a thin shadowed lip on the inlay's edge
  float chE = ( 1.0 - smoothstep( -aa, aa, min( inl.r, inl.a ) - 0.03 ) ) - max( ch, md );
  col *= 1.0 - 0.18 * chE;
  col = mix( col, uInscription * mix( vec3( 1.0 ), grainN, 0.5 ), ch );
  col = mix( col, uMidInlay * grainN, md );
  h -= ( ch + md ) * 0.003 + chE * 0.004;
  rough = mix( rough, 0.6, max( ch, md ) );
  gSheen *= 1.0 - max( ch, md );
  // carved grooves (the hour-ring, the half-hour ticks): a dark channel, its far wall catching the sun
  float cg = 1.0 - smoothstep( -aa, aa, inl.g );
  float cgL = ( 1.0 - smoothstep( -aa, aa, inl.g - 0.035 ) ) - cg;
  col = mix( col, col * 0.52, cg );
  col *= 1.0 + 0.1 * cgL;
  h -= cg * 0.012;
  gSheen *= 1.0 - cg;
  // each hour-mark's groove, lit in its seat colour (fixed per seat, identical for every viewer; below bloom)
  float sg = 1.0 - smoothstep( -aa, aa, inl.b );
  if ( sg > 0.0 ) {
    vec2 sd = p - uPlate.xy;
    float bear = mod( degrees( atan( sd.x, -sd.y ) ) + 360.0, 360.0 );
    int si = int( mod( floor( bear / 36.0 + 0.5 ), 10.0 ) );
    vec3 sc = uSeatCol[ 0 ];
    for ( int k = 1; k < 10; k ++ ) if ( k == si ) sc = uSeatCol[ k ];
    col = mix( col, sc * 0.35, sg );
    emit += sc * 0.32 * sg;
    h -= sg * 0.006;
  }
#endif
  // ── base plazas: Aubade chalk flags with dawnglass rings, Serenade ochre sandstone with lampresin; a kerbed
  //    border course rings each plaza, so the plaza and the road never read as stamped over each other ──
  for ( int k = 0; k < 2; k ++ ) {
    vec4 PZ = k == 0 ? uPlaza0 : uPlaza1;
    vec4 FT = k == 0 ? uFount0 : uFount1;
    if ( PZ.z <= 0.0 ) continue;
    float pd = length( p - PZ.xy );
    if ( pd > PZ.z + 0.5 ) continue;
    float pw = 1.0 - smoothstep( PZ.z - aa, PZ.z + aa, pd );
    vec4 pf = valeRingFlags( p, FT.xy, FT.z + 0.4, 1.35, 1.75 );
    vec3 pband = PZ.w < 0.5 ? uPlazaA : uPlazaS;
    vec3 ic = PZ.w < 0.5 ? uInlayA : uInlayS;
    float ph, pj;
    vec3 pc = valeFlag( pband * ( 0.96 + 0.08 * nMid ), pf, grainN, chip, 0.04, pband * 0.68, 0.1, ph, pj );
    pc = mix( pc, uMoss * mossN * 0.85, pj * smoothstep( PZ.z - 3.0, PZ.z - 0.6, pd + wob ) );
    float fr = length( p - FT.xy );
    // the fountain floor: one honed disc engraved with the twelve hours
    float ang = atan( p.y - FT.y, p.x - FT.x );
    float seg = 6.2831853 / 12.0;
    float al = abs( mod( ang + seg * 0.5, seg ) - seg * 0.5 ) * fr;
    float inner = 1.0 - smoothstep( FT.z + 0.4 - aa, FT.z + 0.4 + aa, fr );
    pc = mix( pc, pband * 1.03 * grainN, inner );
    float hourL = ( 1.0 - smoothstep( -aa, aa, al - 0.04 ) ) * step( 1.0, fr ) * inner;
    // inlay: the fountain's rim ring, an outer ring, ticks between them, each set in a carved channel
    float ringD = min( abs( fr - FT.z ) - 0.085, abs( fr - ( FT.z + 2.95 ) ) - 0.06 );
    float tickD = max( al - 0.05, max( FT.z + 0.55 - fr, fr - ( FT.z + 2.4 ) ) );
    float inD = min( ringD, tickD );
    float iw = 1.0 - smoothstep( -aa, aa, inD );
    float chn = ( 1.0 - smoothstep( -aa, aa, inD - 0.045 ) ) - iw;
    pc *= 1.0 - 0.32 * chn - 0.1 * hourL;
    vec3 icm = mix( vec3( dot( ic, vec3( 0.2126, 0.7152, 0.0722 ) ) ), ic, 0.7 );
    pc = mix( pc, mix( pband, icm, 0.7 ) * grainN * ( 0.96 + 0.08 * n2 ), iw );
    float pH = ph * ( 1.0 - inner ) - chn * 0.006 - hourL * 0.004;
    // the border course: long dressed kerb stones on the rim (0.6 m), a dark joint either side
    float kIn = PZ.z - 0.6;
    float kerb = smoothstep( kIn - aa, kIn + aa, pd );
    float kang = atan( p.y - PZ.y, p.x - PZ.x );
    float kn = floor( 6.2831853 * ( PZ.z - 0.3 ) / 1.6 );
    float kt = ( kang / 6.2831853 + 0.5 ) * kn;
    float kl = fract( kt );
    float ke = min( min( kl, 1.0 - kl ) * 1.6, min( pd - kIn, PZ.z - pd ) ) + chip * 0.4;
    float kr = valeHash12( vec2( floor( kt ), PZ.w + 3.0 ) );
    vec3 kc = pband * ( 0.86 + 0.1 * kr ) * grainN * ( 0.95 + 0.1 * n2 );
    kc *= mix( 0.62, 1.0, smoothstep( 0.0, 0.06, ke ) );
    kc = mix( kc, uMoss * mossN * 0.7, ( 1.0 - smoothstep( 0.0, 0.025, ke ) ) * smoothstep( 0.4, 0.7, nMid ) * 0.6 );
    pc = mix( pc, kc, kerb );
    pH = mix( pH, 0.012 + smoothstep( 0.0, 0.06, ke ) * 0.02, kerb );
    col = mix( col, pc, pw );
    h = mix( h, pH, pw );
    rough = mix( rough, mix( mix( 0.64, 0.5, iw ), 0.72, kerb ), pw );
  }
  // ── the Seat: the needle's base-stone, flush; rim step, socket scar, twelve hour-ticks ──
  if ( uSeat.z > 0.0 ) {
    float sd = length( p - uSeat.xy );
    if ( sd < uSeat.z + 0.5 ) {
      vec4 sf = valeRingFlags( p, uSeat.xy, 3.45, 1.52, 2.2 );
      float shh, sj;
      vec3 sc = valeFlag( uSeatC * ( 0.98 + 0.05 * nMid ), sf, grainN, chip * 0.5, 0.025, uSeatC * 0.8, 0.06, shh, sj );
      float sock = 1.0 - smoothstep( 0.0, 0.06 + aa, abs( sd - 3.05 ) - 0.38 );
      sc = mix( sc, uSeatC * 0.84 * grainN * ( 0.85 + 0.3 * valeNoise( p * 6.0 ) ), sock );
      float inner = 1.0 - smoothstep( 2.6 - aa, 2.6 + aa, sd );
      sc = mix( sc, uSeatC * 1.03 * grainN, inner );
      float ang = atan( p.y - uSeat.y, p.x - uSeat.x );
      float seg = 6.2831853 / 12.0;
      float al = abs( mod( ang + seg * 0.5, seg ) - seg * 0.5 ) * sd;
      float tk = 1.0 - smoothstep( -aa, aa, max( al - 0.055, abs( sd - 6.9 ) - 0.55 ) );
      sc *= 1.0 - 0.13 * tk;
      float rimD = sd - uSeat.z;
      float stepL = 1.0 - smoothstep( 0.0, 0.03 + aa, abs( rimD + 0.05 ) - 0.03 );
      float lip = 1.0 - smoothstep( 0.0, 0.03 + aa, abs( rimD + 0.15 ) - 0.05 );
      sc *= 1.0 - 0.4 * stepL; sc *= 1.0 + 0.1 * lip;
      float sw = 1.0 - smoothstep( uSeat.z - aa, uSeat.z + aa, sd );
      col = mix( col, sc, sw ); h = mix( h, shh * 0.6 - tk * 0.005 - stepL * 0.02 + lip * 0.006, sw ); rough = mix( rough, 0.55, sw );
    }
  }
  // wall-foot occlusion (never on the gorge's own edges: the splat's wall field skips chasms)
  col *= mix( 0.5, 1.0, smoothstep( 0.0, 1.9, wallD + ( n2 - 0.5 ) * 0.35 ) );
  // outside the map: rough plateau ground (gorge maps show it beyond the far walls): moss, litter, bare rock
  if ( !inMap ) {
#ifdef VALE_GORGE
    float hP;
    col = valeRockPlateau( p, uTexGrain, uTexMoss, uRockC * 1.55, uMoss, hP );
    h = hP; rough = 0.9; emit = vec3( 0.0 ); gSheen = 0.0;
#else
    vec4 tO = valeTex2( uTexLitter, p / 6.0, valeNoise( p * 0.11 ) );
    vec3 mO = valeTexMean( uTexLitter );
    vec3 og = valeOrganic( mix( mO, tO.rgb, 0.8 ), mO, mix( uMoss, uEarth, smoothstep( 0.4, 0.7, nBig ) ), 0.5 );
    og = mix( og, uEarth * 1.2 * grainN, smoothstep( 0.62, 0.7, valeNoise( p * 0.21 ) + gh ) );
    col = og; h = ( tO.a - 0.6 ) * 0.05; rough = 0.95; emit = vec3( 0.0 ); gSheen = 0.0;
#endif
  }
  // the temperature field: a cool cast west, a warm cast east (never a team hue)
  vec3 tmp = mix( uTempW, uTempE, smoothstep( 0.12, 0.88, p.x / uMapSize.x ) );
  col *= mix( vec3( 1.0 ), tmp, uTempK );
  // r12 M14: the quadrant tint, off the roads
  col *= mix( vec3( 1.0 ), valeQuadTint( p ), smoothstep( uLaneHalf, uLaneHalf + 3.0, laneD ) );
  diffuseColor.rgb *= col;
  gHeight = h; gRough = rough; gEmit = emit;
}
`;

/** ground: polished-stone sheen (the Noonplate), added with the emissive once the bumped normal exists: the sky
 *  caught at grazing angles, so the plate brightens toward the far (upper) side of the screen like satin */
export const GROUND_SHEEN_GLSL = /* glsl */`
if ( gSheen > 0.0 ) {
  vec3 Vv = normalize( vViewPosition );
  float nv = clamp( dot( normal, Vv ), 0.0, 1.0 );
  totalEmissiveRadiance += uSheenC * gSheen * smoothstep( 0.97, 0.6, nv );
#if NUM_DIR_LIGHTS > 0
  // honed stone's satin: a broad, soft lobe of the overhead sun drifting across the plate as the camera moves,
  // a little stronger on some slabs than others (a mirror would be a hot spot; this is a sheen)
  vec3 Hs = normalize( directionalLights[ 0 ].direction + Vv );
  float satin = pow( clamp( dot( normal, Hs ), 0.0, 1.0 ), 6.0 );
  totalEmissiveRadiance += directionalLights[ 0 ].color * diffuseColor.rgb * satin * 0.14 * gSheen;
#endif
}
`;

/** walls: vertex (pars + main) */
export const WALL_VERT_PARS = /* glsl */`
attribute vec4 aWallA; attribute vec4 aWallB;
varying vec4 vWA; varying vec4 vWB; varying vec3 vCliffW; varying vec3 vCliffN;
`;
export const WALL_VERT_MAIN = /* glsl */`
vWA = aWallA; vWB = aWallB;
vCliffW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vCliffN = normalize( mat3( modelMatrix ) * objectNormal );
`;

export const WALL_PARS_GLSL = /* glsl */`
varying vec4 vWA; varying vec4 vWB; varying vec3 vCliffW; varying vec3 vCliffN;
uniform vec3 uFace, uLip, uEdgeLight, uTop, uMossC, uFlank, uRock, uEarthC, uCanopy;
uniform sampler2D uTexGrain, uTexMoss, uTexLitter;
uniform sampler2D uSplat2; uniform vec2 uSplatScale;
uniform vec3 uTempW, uTempE; uniform float uTempK; uniform vec2 uMapSize;
uniform float uStoneTop;   // 1: a clean stone stage (no moss, pale glare tops); 2: the gorge's bare rim plateau
uniform vec3 uPlateW;      // the Noonplate's centre (x, z) and radius: the fair's court beyond its rim
uniform vec3 uGlareNear;   // the court's stone by the rim wall (the plate's own value); it hazes out to uTop
float cH; float cRough;
`;

/** walls body (replaces <map_fragment>). Kinds: see terrain_walls.ts WK */
export const WALL_MAIN_GLSL = /* glsl */`
{
  float u = vWA.x, vl = vWA.y, course = vWA.z;
  int kind = int( vWA.w + 0.5 );
  float sh = vWB.x, seed = vWB.y, wallH = vWB.w;
  vec3 P = vCliffW;
  // texture space: world xz on flat-ish strips (lip tops, chamfers, caps), arc length × height on the faces.
  // (u, height) on a flat strip would read one row of every painting: streaks like brushed metal.
  bool flatS = abs( vCliffN.y ) > 0.6;
  vec2 fuv = flatS ? P.xz : vec2( u, P.y );
  vec4 tG = texture( uTexGrain, fuv / 3.0 );
  vec3 grainN = mix( vec3( 1.0 ), tG.rgb / valeTexMean( uTexGrain ), 0.7 );
  float gh = tG.a - 0.6;
  float n2 = valeNoise( fuv * 2.1 + seed );
  float nm = valeNoise( vec2( fuv.x * 0.23, fuv.y * 0.5 ) + seed * 3.0 );
  float chip = ( valeNoise( fuv * 8.0 + seed ) - 0.5 ) * 0.05 + gh * 0.12;
  vec3 c = uFace; float h = 0.0; float rough = 0.86;
  float stoneK = step( 0.5, uStoneTop ) * ( 1.0 - step( 1.5, uStoneTop ) );   // the Noonplate's clean stone
  if ( kind <= 1 ) {
    // cut-stone courses: rock-faced blocks, per-course length, tint and set-back; chunky chisel facets
    float L = 1.15 + 1.25 * valeHash12( vec2( course, seed ) );
    float bu = u / L + floor( valeHash12( vec2( course + 3.1, seed ) ) * 9.0 ) + 0.5 * valeHash12( vec2( course, seed + 1.0 ) );
    float bi = floor( bu ), bl = fract( bu );
    float ew = min( bl, 1.0 - bl ) * L;
    float eh = kind == 0 ? min( vl, 1.0 - vl ) * sh : 0.3;
    float e = min( ew, eh ) + chip;
    float jt = 1.0 - smoothstep( 0.008, 0.032, e );
    vec2 bid = vec2( bi, course + seed * 17.0 );
    float r1 = valeHash12( bid ), r2 = valeHash12( bid * 1.71 + 4.2 ), r3 = valeHash12( bid * 2.3 + 9.1 );
    vec2 lc = vec2( bl - 0.5, vl - 0.5 ) * vec2( L, sh );
    float facet = dot( lc, vec2( r2 - 0.5, r3 - 0.5 ) ) * 0.16 + ( 0.2 - dot( lc, lc ) * 0.35 ) * 0.07 * r1;
    // knapped faces: a few broad chisel scallops per block
    float sc = valeNoise( vec2( u * 2.2, P.y * 2.6 ) + bid * 3.1 );
    h = smoothstep( 0.0, 0.12, e ) * ( 0.05 + facet + ( sc - 0.5 ) * 0.035 ) + gh * 0.03 + ( n2 - 0.5 ) * 0.01;
    float ct = valeHash12( vec2( course, seed * 2.0 + 1.0 ) );
    c = uFace * ( 0.76 + 0.4 * r1 ) * ( 0.86 + 0.28 * ct ) * grainN * ( 0.92 + 0.16 * sc );
    c *= vec3( 1.0 + 0.08 * ( r2 - 0.5 ), 1.0, 1.0 - 0.09 * ( r2 - 0.5 ) );
    c *= mix( 0.66, 1.0, smoothstep( 0.0, 0.16, e ) );
    c = mix( c, uFace * 0.32, jt );
    // broad weathering along the wall, damp foot, moss from the ground and in the joints, streaks under the lip
    c *= 0.84 + 0.3 * valeNoise( vec2( u * 0.09, P.y * 0.2 ) + seed * 7.0 );
    c *= mix( 0.6, 1.0, smoothstep( -0.1, 1.3, P.y ) );
    vec3 mM = valeTexMean( uTexMoss );
    vec3 mossC = valeOrganic( mix( mM, texture( uTexMoss, fuv / 4.0 ).rgb, 0.7 ), mM, uMossC, 0.5 );
    float foot = 1.0 - smoothstep( 0.0, 0.8, P.y + ( nm - 0.5 ) * 0.7 );
    float mossAmt = max( foot * smoothstep( 0.3, 0.6, nm ), jt * smoothstep( 0.5, 0.75, nm ) ) * 0.85 * ( 1.0 - stoneK );
    float streak = smoothstep( 0.6, 0.85, valeNoise( vec2( u * 1.9, P.y * 0.12 ) + seed ) ) * smoothstep( wallH - 1.8, wallH - 0.4, P.y ) * ( 1.0 - stoneK );
    c = mix( c, mossC * 0.8, max( mossAmt, streak * 0.55 ) );
    rough = 0.88;
  } else if ( kind <= 5 ) {
    // the carved lip: dressed cap stones with joints, a painted edge light on the chamfer; clean stone, so the
    // edge of every block reads crisp (moss only in the inner bevel, where the top's moss meets it)
    float L = 1.15 + 0.5 * valeHash12( vec2( seed, 5.0 ) );
    float bu = u / L;
    float bi = floor( bu ), bl = fract( bu );
    float e = min( bl, 1.0 - bl ) * L + chip;
    float jt = 1.0 - smoothstep( 0.008, 0.03, e );
    float r1 = valeHash12( vec2( bi, seed ) );
    c = uLip * ( 0.9 + 0.16 * r1 ) * grainN * ( 0.95 + 0.1 * n2 );
    c *= mix( 0.78, 1.0, smoothstep( 0.0, 0.12, e ) );
    c = mix( c, uLip * 0.45, jt );
    h = smoothstep( 0.0, 0.08, e ) * 0.02 + gh * 0.02;
    if ( kind == 2 ) c *= mix( 0.8, 1.0, vl );
    // the painted edge light: uEdgeLight is capped (terrain.ts) at L* 48 on screen; no block lifts above it
    if ( kind == 3 ) c = mix( c, uEdgeLight * ( 0.9 + 0.1 * r1 ), 0.7 * ( 1.0 - jt ) * smoothstep( 0.15, 0.6, vl ) );
    if ( kind == 4 ) c *= 1.0 - 0.1 * smoothstep( 0.55, 1.0, vl );
    if ( kind == 5 ) {
      // the inner bevel: the wood's dark floor creeping over the cap's inner edge in a ragged line — opaque moss
      // (no joint runs through it), never a tinted film over the stone
      vec4 tM5 = texture( uTexMoss, P.xz / 3.0 );
      vec3 mM5 = valeTexMean( uTexMoss );
      vec3 mossF = valeOrganic( mix( mM5, tM5.rgb, 0.6 ), mM5, mix( uCanopy, uEarthC, 0.45 ) * 0.3, 0.6 );
      float cover = smoothstep( 0.4, 0.6, vl + ( valeNoise( vec2( u * 1.7, seed ) ) - 0.5 ) * 0.8 + ( tM5.a - 0.6 ) * 0.6 ) * ( 1.0 - stoneK ) * ( 1.0 - step( 1.5, uStoneTop ) );
      c = mix( c * 0.78, mossF, cover );
    }
    rough = 0.8;
  } else if ( kind == 6 && uStoneTop > 1.5 ) {
    // Needlespan's terrace-end blocks: the same bare rim plateau as beyond the far walls
    float hP;
    c = valeRockPlateau( vec2( u, vl ), uTexGrain, uTexMoss, uRock * 1.55, uMossC, hP );
    h = hP; rough = 0.9;
  } else if ( kind == 6 && uStoneTop > 0.5 ) {
    // a carved block's top (the Noonplate's hour-stones): the cap stone itself
    vec2 q = vec2( u, vl );
    vec4 tq = texture( uTexGrain, q / 3.0 );
    if ( wallH < 2.0 ) {
      // a low carved block (an hour-stone): basalt cap, chalk-lit by the lip around it
      c = uLip * 0.62 * mix( vec3( 1.0 ), tq.rgb / valeTexMean( uTexGrain ), 0.6 );
      h = ( tq.a - 0.6 ) * 0.03;
      rough = 0.7;
    } else {
      // beyond the rim: the fair's court at the Shadowless Noon (r12 B5). Worn chalk-stone setts (cobbled, never the
      // plate's honed rings) start at the plate's own value by the rim wall (uGlareNear) and dissolve outward into the
      // noon haze (uTop, a hazier mid-tone, L* <= 52 on screen): still the bright boundary the plate sits in, never
      // the top of the value range (tokens grade.maps.fray.fog.rimGlare)
      vec2 pq = P.xz;
      float dr = length( pq - uPlateW.xy ) - uPlateW.z;
      float hz = smoothstep( 0.8, 9.0, dr + ( valeNoise( pq * 0.07 ) - 0.5 ) * 3.0 );
      vec4 rf = valePavers( pq + vec2( valeNoise( pq * 0.3 ), valeNoise( pq * 0.3 + 5.0 ) ) * 0.5, 1.7 );
      vec3 gN = mix( vec3( 1.0 ), tq.rgb / valeTexMean( uTexGrain ), 0.45 );
      float fh, fj;
      vec3 court = valeFlag( uGlareNear * ( 0.92 + 0.14 * valeNoise( pq * 0.11 + 3.0 ) ), rf, gN, chip * 0.6, 0.04, mix( uGlareNear * 0.76, uTop * 0.85, hz ), 0.14, fh, fj );
      // chalk dust drifted over the joints and the worn slabs, thicker further out
      float dust = smoothstep( 0.45, 0.8, valeNoise( pq * 0.21 + 7.0 ) * 0.75 + hz * 0.45 );
      court = mix( court, uTop * 0.82 * gN, dust * 0.45 );
      c = mix( court, uTop * ( 0.95 + 0.1 * valeNoise( pq * 0.05 ) ) * mix( vec3( 1.0 ), gN, 0.25 ), hz );
      h = fh * ( 1.0 - hz ) * 0.8;
      rough = 0.86;
    }
  } else if ( kind == 6 ) {
    // the block's top: the Dialwood's own floor in the shade of its canopy — dark moss and drifts of fallen fan
    // leaves, a step DARKER than the walkable Dialwood floor below (dark wall, light floor: the value law), so a
    // gap between the crowns reads as depth in the wood, never as an inviting lawn (never lime, never paved)
    vec2 q = vec2( u, vl );
    bool inM = q.x >= 0.0 && q.y >= 0.0 && q.x <= uMapSize.x && q.y <= uMapSize.y;
    float wi = inM ? texture( uSplat2, q * uSplatScale ).b * 4.0 : 4.0;
    vec4 tM = valeTex2( uTexMoss, q / 5.0, valeNoise( q * 0.13 ) );
    vec4 tL = valeTex2( uTexLitter, q / 7.0, valeNoise( q * 0.11 + 3.0 ) );
    vec3 mM = valeTexMean( uTexMoss ), mL = valeTexMean( uTexLitter );
    float big = valeFbm( q * 0.06 + seed );
    float med = valeNoise( q * 0.27 + 4.0 );
    vec3 under = mix( uCanopy, uEarthC, 0.45 ) * 0.28 * ( 0.82 + 0.34 * big );
    under = mix( vec3( dot( under, vec3( 0.2126, 0.7152, 0.0722 ) ) ), under, 0.75 );
    vec3 a = valeOrganic( mix( mM, tM.rgb, 0.6 ), mM, under * vec3( 0.94, 1.03, 0.9 ), 0.6 );
    vec3 b = valeOrganic( mix( mL, tL.rgb, 0.7 ), mL, under * vec3( 1.14, 0.95, 0.72 ), 0.5 );
    float m = smoothstep( 0.4, 0.62, med * 0.55 + big * 0.5 + ( tM.a - 0.6 ) * 0.5 );
    c = mix( b, a, m );
    // just inside the lip a little more light reaches the floor (still darker than the walkable floor)
    float rimZ = 1.0 - smoothstep( 0.05, 1.4, wi + ( n2 - 0.5 ) * 0.4 );
    c *= 1.0 + 0.15 * rimZ;
    h = mix( tL.a, tM.a, m ) * 0.05;
    rough = 0.9;
  } else if ( kind == 7 ) {
    // the shaft's flank: needle stone in long courses
    float cw = 1.05;
    float row = floor( P.y / cw );
    float rl = P.y - row * cw;
    float L = 2.6 + 1.6 * valeHash12( vec2( row, seed ) );
    float bu = u / L + valeHash12( vec2( row, 4.4 ) ) * 5.0;
    float e = min( min( fract( bu ), 1.0 - fract( bu ) ) * L, min( rl, cw - rl ) ) + chip;
    float jt = 1.0 - smoothstep( 0.01, 0.04, e );
    float r1 = valeHash12( vec2( floor( bu ), row + seed ) );
    c = uFlank * ( 0.86 + 0.24 * r1 ) * grainN;
    c = mix( c, uFlank * 0.4, jt );
    // lichen and damp streaks lower down
    c = mix( c, uMossC * 0.7, smoothstep( 0.55, 0.8, valeNoise( vec2( u * 0.7, P.y * 0.25 ) + seed ) ) * smoothstep( -0.6, -3.5, P.y ) * 0.6 );
    h = smoothstep( 0.0, 0.08, e ) * 0.03 + gh * 0.03;
    rough = 0.82;
  } else if ( kind == 9 ) {
    // a carved hour-band: a ring of paler needle stone round the shaft, standing proud of the deck edge and
    // rolling over it into the gorge. u runs across the ring (0..wallH = its width): rounded shoulders at both
    // ends, two grooves following the ring round, a chalk hour-tick on the crown
    float W = max( wallH, 0.5 );
    float eu = min( u, W - u );
    c = uLip * 0.9 * grainN * ( 0.93 + 0.12 * nm );
    c *= mix( 0.62, 1.0, smoothstep( 0.0, 0.42, eu ) );
    float gd = abs( eu - 0.36 ) - 0.035;
    float groove = 1.0 - smoothstep( 0.0, 0.02, gd );
    float gl = 1.0 - smoothstep( 0.0, 0.02, abs( eu - 0.43 ) - 0.012 );
    c = mix( c, c * 0.42, groove );
    c *= 1.0 + 0.12 * gl;
    // the crown's hour-tick: one chalk bar across the ring between the grooves, on its highest course
    float tk = ( 1.0 - smoothstep( 0.0, 0.02, abs( u - W * 0.5 ) - 0.05 ) ) * step( 0.46, eu ) * smoothstep( wallH * 0.0 + 0.55, 0.85, P.y );
    c = mix( c, uEdgeLight * 0.95, tk * 0.9 );
    // darker and damper as it rolls down into the gorge
    c *= mix( 0.5, 1.0, smoothstep( -4.5, 0.4, P.y ) );
    c = mix( c, uMossC * 0.6, smoothstep( 0.6, 0.85, valeNoise( fuv * 0.8 + seed ) ) * smoothstep( -0.8, -3.5, P.y ) * 0.5 );
    h = -groove * 0.012 + gh * 0.02 + smoothstep( 0.0, 0.2, eu ) * 0.01;
    rough = 0.8;
  } else {
    // raw rock in strata (the gorge's walls below the needle stone): fine warped laminations, sparse leaning
    // joints that split the beds into great blocks, damp streaks running down from every ledge; the lip
    // and the ledges catch the sun and the sky, and the stone cools and darkens with depth so the drop reads
    // deep before the mist takes it
    // strata follow the profile's own height (vWB.z), so they dip and rise with the terraces along the wall
    float yy = vWB.z + ( valeNoise( vec2( u * 0.045, seed * 1.3 ) ) - 0.5 ) * 3.0 + ( valeNoise( vec2( u * 0.31, seed ) ) - 0.5 ) * 0.5;
    float bigB = floor( yy / 4.6 );
    float colW = 2.2 + 3.6 * valeHash12( vec2( bigB, seed + 7.0 ) );
    float lean = ( valeHash12( vec2( bigB, seed + 3.3 ) ) - 0.5 ) * 0.7;
    float uu = ( u + yy * lean ) / colW + valeHash12( vec2( bigB, seed + 1.0 ) ) * 10.0;
    float ci = floor( uu ), cl = fract( uu );
    // faulted: each joint block's beds stepped against its neighbour's; beds of uneven thickness (0.6-1.8 m)
    float yb = yy + ( valeHash12( vec2( ci, bigB + seed * 3.0 ) ) - 0.5 ) * 0.9;
    float bw = yb / 1.15 + 0.3 * sin( yb * 0.83 + seed ) + 0.25 * valeNoise( vec2( u * 0.08, yb * 0.3 ) );
    float bed = 1.15;
    float bi = floor( bw ), bl = fract( bw );
    float wob2 = ( valeNoise( fuv * vec2( 1.4, 2.6 ) + seed ) - 0.5 ) * 0.16;
    float eU = min( cl, 1.0 - cl ) * colW + wob2;
    float eV = min( bl, 1.0 - bl ) * bed + wob2 * 0.5;
    // anti-aliased: each line is at least ~1.5 px wide and fades out before it would shimmer
    float fU = fwidth( uu ) * colW, fV = fwidth( bw ) * bed;
    // joints: only some open (a closed joint is a faint seam), each its own width; laminations come and go
    float open_ = step( 0.35, valeHash12( vec2( ci, bigB + seed ) ) );
    float jtU = ( 1.0 - smoothstep( 0.02, 0.05 + 0.09 * valeHash12( vec2( ci + 3.0, bigB ) ) + fU * 1.5, eU ) ) * mix( 0.35, 1.0, open_ ) * ( 1.0 - smoothstep( 0.12, 0.35, fU ) );
    float jtV = ( 1.0 - smoothstep( 0.015, 0.06 + fV * 1.5, eV ) ) * smoothstep( 0.45, 0.7, valeNoise( vec2( u * 0.21, bi * 0.7 ) ) ) * ( 1.0 - smoothstep( 0.08, 0.25, fV ) );
    vec2 bid = vec2( ci, bigB + seed * 11.0 );
    float r1 = valeHash12( bid ), r2 = valeHash12( bid * 1.7 + 3.0 ), r3 = valeHash12( vec2( bi, seed + 2.0 ) );
    vec4 tq = texture( uTexGrain, fuv / 5.0 );
    // broad patches across the whole face (iron-stained, pale, damp) so no two blocks repeat
    float patchN = valeFbm( vec2( u * 0.045, P.y * 0.07 ) + seed );
    c = uRock * ( 0.78 + 0.3 * r1 ) * ( 0.92 + 0.16 * r3 ) * mix( vec3( 1.0 ), tq.rgb / valeTexMean( uTexGrain ), 0.8 ) * ( 0.86 + 0.28 * nm );
    c *= mix( vec3( 1.08, 1.0, 0.9 ), vec3( 0.86, 0.94, 1.06 ), smoothstep( 0.3, 0.7, patchN ) ) * ( 0.85 + 0.3 * patchN );
    c *= vec3( 1.0 + 0.07 * ( r2 - 0.5 ), 1.0, 1.0 - 0.06 * ( r2 - 0.5 ) );
    c = mix( c, uRock * 0.22, jtU );
    c *= 1.0 - 0.35 * jtV;
    // damp streaks run down the faces (stretched noise), lichen on the drier stone
    float streak = smoothstep( 0.62, 0.9, valeNoise( vec2( u * 1.6, P.y * 0.09 ) + seed * 2.0 ) );
    c *= 1.0 - 0.32 * streak * ( 1.0 - smoothstep( 0.5, 0.9, vCliffN.y ) );
    c = mix( c, uMossC * 0.55, smoothstep( 0.66, 0.86, valeNoise( fuv * vec2( 0.25, 0.6 ) + seed ) ) * 0.35 * ( 1.0 - jtU ) );
    // benches and ledges: real ledges of scree and moss, textured in plan (the face's joints never run across
    // them), occluded where they meet the face above, so each reads as a step in the rock, not a pale film
    float up = smoothstep( 0.35, 0.8, vCliffN.y );
    if ( up > 0.0 ) {
      vec4 tMb = texture( uTexMoss, P.xz / 3.5 );
      vec3 mMb = valeTexMean( uTexMoss );
      vec3 benchC = valeOrganic( mix( mMb, tMb.rgb, 0.7 ), mMb, uMossC * 0.6, 0.55 );
      float scree = smoothstep( 0.42, 0.68, valeNoise( P.xz * 0.55 + seed ) + ( tq.a - 0.6 ) * 0.8 + ( tMb.a - 0.6 ) * 0.4 );
      benchC = mix( benchC, uRock * 1.05 * mix( vec3( 1.0 ), tq.rgb / valeTexMean( uTexGrain ), 0.85 ), scree * 0.7 );
      benchC *= mix( 0.5, 1.0, smoothstep( 0.0, 0.55, vl ) ) * ( 0.85 + 0.3 * valeNoise( P.xz * 0.21 + seed ) );
      c = mix( c, benchC, up );
    }
    // the far lip: a pale sunlit edge rolling over from the plateau (the gorge's lit outline)
    float lip = smoothstep( -1.2, -0.1, P.y ) * smoothstep( -0.2, 0.5, vCliffN.y );
    c = mix( c, uEdgeLight * 0.62 * grainN, lip * 0.75 );
    // depth: the light falls off down the drop (warm lit rim → cool shadowed depths)
    float dep = smoothstep( -1.0, -22.0, P.y );
    c *= mix( vec3( 1.12, 1.08, 1.0 ), vec3( 0.5, 0.56, 0.7 ), dep );
    h = smoothstep( 0.0, 0.25 + max( fU, fV ) * 2.0, min( eU, eV + 0.1 ) ) * 0.1 * ( 1.0 - smoothstep( 0.1, 0.3, max( fU, fV ) ) ) + ( tq.a - 0.6 ) * 0.05 - streak * 0.01;
    rough = 0.92;
  }
  vec3 tmp = mix( uTempW, uTempE, smoothstep( 0.12, 0.88, P.x / uMapSize.x ) );
  c *= mix( vec3( 1.0 ), tmp, uTempK );
  diffuseColor.rgb *= c;
  cH = h; cRough = rough;
}
`;

/** the gorge's own height mist (Needlespan): below the deck the stone dissolves into the drop's mist — a pale,
 *  sunlit haze just under the rim, a deep cool blue further down, near-solid by −25 m (brief: 0.06/m below
 *  −2 m). Height only, never camera distance. Applied AFTER the world fog of war (append after
 *  <opaque_fragment>, on gl_FragColor): fog of war only dims the mist a little, so the drop keeps its depth
 *  in unseen ground instead of going to a black void (nothing stands in it, so it hides nothing). Needs the
 *  world fog chunk (valeVision) and `vec3 wp` = world position. */
export const GORGE_MIST_PARS = /* glsl */`
uniform vec3 uMistHi, uMistLo; uniform float uMistK;
vec3 valeGorgeMist( vec3 c, vec3 wp ) {
  float dm = max( 0.0, -wp.y - 1.2 );
  float m = 1.0 - exp( -uMistK * dm * ( 1.0 + dm * 0.04 ) );
  vec3 mc = mix( uMistHi, uMistLo, smoothstep( 2.0, 22.0, dm ) );
  mc *= mix( 0.75, 1.0, valeVision( wp.xz ) );
  return mix( c, mc, m );
}
`;
/** before the world fog (insert ahead of <opaque_fragment>): stone below the deck is lifted where it is unseen,
 *  so the fog of war's value ×0.55 lands at ≈ ×0.75 on the drop — it stays a drop, never a black void */
export const gorgeFogLift = (wp: string): string => /* glsl */`
if ( uMistK > 0.0 ) outgoingLight *= 1.0 + 2.0 * smoothstep( -0.2, -2.5, ${wp}.y ) * ( 1.0 - valeVision( ${wp}.xz ) );
`;
export const gorgeMistApply = (wp: string): string => /* glsl */`
if ( uMistK > 0.0 ) gl_FragColor.rgb = valeGorgeMist( gl_FragColor.rgb, ${wp} );
`;

/** gorge mist banks: translucent sheets of mist lying in the drop at a few depths, drifting slowly (noise, no
 *  textures). Each fades out over the last ~3.5 m before any rock it meets — a baked distance field to the outline
 *  where the sheet's plane cuts the gorge's surfaces (flank, terraced far walls, stacks) — so no sheet ever shows
 *  a seam line across a face. The deepest carries the river far below: a faint winding glint through the mist. */
export const MIST_SHEET_PARS = /* glsl */`
uniform sampler2D uMistSD; uniform vec4 uMistBox; uniform vec3 uSheetSel; uniform float uWaterT;
uniform vec4 uSheet;   // x = opacity, y = drift speed, z = river glint (0/1), w = noise scale
uniform vec3 uSheetC; uniform vec2 uRiverY;
`;
export const MIST_SHEET_MAIN = /* glsl */`
{
  vec2 p = vValeWorld.xz;
  float rd = dot( texture( uMistSD, ( p - uMistBox.xy ) / uMistBox.zw ).rgb, uSheetSel ) * 4.0;
  // a soft, uneven fade (the mist thins in wisps toward the stone, never along a line)
  float edge = smoothstep( 0.25, 3.6, rd + ( valeNoise( p * 0.45 ) - 0.5 ) * 0.9 );
  edge *= edge;
  float t = uWaterT * uSheet.y;
  vec2 q = p * uSheet.w;
  float n = valeNoise( q + vec2( t, t * 0.37 ) ) * 0.6 + valeNoise( q * 2.3 - vec2( t * 1.3, -t * 0.5 ) + 7.1 ) * 0.4;
  float wisps = smoothstep( 0.36, 0.8, n );
  float a = uSheet.x * edge * ( 0.12 + 0.88 * wisps );
  vec3 col = uSheetC * ( 0.7 + 0.6 * n );
  if ( uSheet.z > 0.5 ) {
    // the river below: a soft winding band of light with sparkles drifting along it (cool, below bloom)
    float ry = abs( p.y - uRiverY.x ) < abs( p.y - uRiverY.y ) ? uRiverY.x : uRiverY.y;
    float wind = ry + sin( p.x * 0.09 + ry ) * 2.2 + sin( p.x * 0.23 + 1.3 ) * 0.7;
    float d = abs( p.y - wind );
    float band = exp( -d * d * 0.3 );
    float sp = valeNoise( vec2( p.x * 1.6 - uWaterT * 0.9, p.y * 3.0 ) );
    float spark = smoothstep( 0.78, 0.95, sp ) * exp( -d * d * 2.5 );
    col += vec3( 0.55, 0.66, 0.78 ) * ( band * 0.16 + spark * 0.5 ) * edge;
    a = max( a, ( band * 0.25 + spark * 0.5 ) * edge * uSheet.x );
  }
  diffuseColor = vec4( col, a );
}
`;

/** the Standing Shadow: violet-cool stone in long slabs along the shadow, its own sharp point (a darker core
 *  wedge from the Seat's needle to the tip), a hard engraved edge (its own mesh, keepColor under fog) */
export const SHADOW_PARS_GLSL = /* glsl */`
varying vec3 vShW;
uniform sampler2D uSplat; uniform sampler2D uSplat2; uniform vec2 uSplatScale;
uniform sampler2D uTexGrain; uniform vec3 uShadowC; uniform vec3 uShadowLine;
uniform vec4 uShAx; uniform vec2 uShWedge;
float sHeight;
`;
export const SHADOW_MAIN_GLSL = /* glsl */`
{
  vec2 p = vShW.xz;
  vec4 s1 = texture( uSplat, p * uSplatScale );
  vec4 s2 = texture( uSplat2, p * uSplatScale );
  float sd = s2.r * 8.0 - 4.0;                     // < 0 inside
  float wallD = s1.b * 8.0;
  float aa = clamp( length( fwidth( p ) ) * 0.75, 0.004, 0.25 );
  vec4 tG = texture( uTexGrain, p / 3.0 );
  vec3 grainN = mix( vec3( 1.0 ), tG.rgb / valeTexMean( uTexGrain ), 0.8 );
  float gh = tG.a - 0.6;
  float chip = ( valeNoise( p * 9.0 ) - 0.5 ) * 0.05 + gh * 0.12;
  // the shadow's frame: along = from the tip toward the needle, across
  vec2 sa = p - uShAx.xy;
  float al = dot( sa, uShAx.zw ), ac = dot( sa, vec2( -uShAx.w, uShAx.z ) );
  // courses of uneven width (0.7-1.6 m: the across coordinate warped) and length, so the floor never reads as
  // a tiled grid from the camera
  float acW = ac + 0.42 * sin( ac * 0.61 + 1.3 ) + 0.25 * sin( ac * 1.37 );
  vec4 fl = valeCourses( vec2( al, acW ) + vec2( 17.0, 0.55 ), 1.1, 3.1 );
  float fh, jw;
  // violet-cool STONE, not a painted sheet: the tint's hue at a stone's chroma (C* ~10-13 on screen, so
  // it still reads violet under fog of war, which keeps its colour), each slab its own: some greyer slate,
  // some cooler, some a warmer plum; value mottled by damp and dust
  const vec3 LW = vec3( 0.2126, 0.7152, 0.0722 );
  float lum = dot( uShadowC, LW );
  float r1 = valeHash12( fl.zw + 5.3 ), r2 = valeHash12( fl.zw * 1.7 + 2.1 ), r3 = valeHash12( fl.zw * 0.37 + 8.8 );
  // (the sky's blue ambient adds chroma of its own: the albedo leans a touch warmer, toward violet)
  vec3 slab = mix( vec3( lum ), uShadowC * vec3( 1.05, 0.99, 0.93 ), 0.2 + 0.16 * r1 );
  slab *= mix( vec3( 0.97, 1.0, 1.04 ), vec3( 1.05, 0.98, 0.98 ), r2 );
  float mott = valeFbm( p * 0.35 + 3.0 );
  slab *= ( 0.9 + 0.2 * mott + 0.06 * ( valeNoise( p * 1.7 ) - 0.5 ) ) * ( 0.9 + 0.2 * r3 );
  vec3 sc0 = mix( vec3( lum ), uShadowC * vec3( 1.05, 0.99, 0.93 ), 0.3 );
  vec3 c = valeFlag( slab, fl, grainN, chip, 0.04, sc0 * 0.58, 0.16, fh, jw );
  // worn arrises: each slab's edge rubbed paler just inside its joint, chipped by the grain
  float wear = smoothstep( 0.04, 0.07, fl.y + chip ) * ( 1.0 - smoothstep( 0.07, 0.16, fl.y + chip * 1.5 ) );
  c *= 1.0 + 0.16 * wear * smoothstep( 0.3, 0.7, valeNoise( p * 3.1 + fl.zw ) );
  // pale dust settled in the joints toward the pit's rim, dark damp along the cliff feet
  c = mix( c, mix( c, sc0 * 1.25, 0.5 ), jw * smoothstep( 0.55, 0.8, mott ) );
  // the shadow's own point: a darker core wedge, the needle's shadow, narrowing to the tip; its edge engraved
  float hw = uShWedge.y * clamp( al / max( uShWedge.x, 1e-3 ), 0.0, 1.0 );
  float wd = al < 0.0 ? length( sa ) : ( abs( ac ) - hw ) * 0.995;
  float core = 1.0 - smoothstep( -aa, aa, wd );
  float coreE = 1.0 - smoothstep( 0.0, 0.02 + aa, abs( wd ) - 0.035 );
  c = mix( c, c * 0.8, core * step( 0.001, uShWedge.x ) );
  c = mix( c, sc0 * 0.38, coreE * step( 0.001, uShWedge.x ) );
  // the engraved hard edge: a groove 0.1 m inside the outline, a lit arris beyond it
  float groove = 1.0 - smoothstep( 0.0, 0.025 + aa, abs( sd + 0.16 ) - 0.05 );
  float arris = 1.0 - smoothstep( 0.0, 0.02 + aa, abs( sd + 0.27 ) - 0.025 );
  float rim = 1.0 - smoothstep( -0.32, -0.05, sd );
  c = mix( c, sc0 * 0.82 * grainN, rim * 0.6 );
  c = mix( c, sc0 * 0.35, groove );
  c = mix( c, mix( vec3( dot( uShadowLine, LW ) ), uShadowLine, 0.6 ), arris * 0.8 );
  c *= mix( 0.55, 1.0, smoothstep( 0.0, 1.9, wallD ) );
  diffuseColor.rgb *= c;
  sHeight = fh - groove * 0.02 + arris * 0.004 - coreE * 0.008;
}
`;
