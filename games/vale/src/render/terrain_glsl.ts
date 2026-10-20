// VALE render — terrain shader chunks (lane TERRAIN). Injected into MeshStandardMaterial programs by
// render/terrain.ts (onBeforeCompile); NOISE_GLSL (glsl.ts) is prepended by the caller.
//
// Cost budget (1080p60 on High): one irregular-flag Voronoi per ground pixel at most (skipped deep in the
// Dialwood), ring / course flags are closed-form, ≤ 10 texture fetches, four value-noise calls plus one
// 4-octave fbm. No loops over polygons: every map shape arrives as a baked distance field.

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
// flags laid in rings round a centre (plazas, the Seat, the Noonplate): x = flag hash, y = distance to
// the nearest joint (m), zw = (ring, segment)
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
  vec2 id = vec2( ri + ( r < r0 ? -7.0 : 0.0 ), si );
  return vec4( valeHash12( id * 1.37 + 0.5 ), e, id );
}
// long courses of stone along x (the fallen shaft's deck): x = hash, y = joint distance, zw = id
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
// one flag: per-flag value and a slight warm/cool drift, painted edge darkening, joint fill; h = bevel height (m)
vec3 valeFlag( vec3 band, vec4 f, vec3 grainN, float chip, float jointW, vec3 jointC, float varK, out float h, out float jw ) {
  float e = f.y + chip;
  jw = 1.0 - smoothstep( jointW * 0.35, jointW, e );
  float hue = fract( f.x * 13.7 ) - 0.5;
  vec3 c = band * ( 1.0 + ( f.x - 0.5 ) * varK ) * vec3( 1.0 + 0.05 * hue, 1.0, 1.0 - 0.06 * hue ) * grainN;
  c *= mix( 0.8, 1.0, smoothstep( 0.0, 0.16, e ) );
  c = mix( c, jointC, jw );
  h = smoothstep( 0.0, 0.085, e ) * 0.032 + ( f.x - 0.5 ) * 0.006;
  return c;
}
`;

/** ground: uniform + varying declarations (fragment) */
export const GROUND_PARS_GLSL = /* glsl */`
varying vec3 vGroundW;
uniform sampler2D uSplat; uniform sampler2D uSplat2; uniform sampler2D uInlay;
uniform vec2 uSplatScale; uniform vec2 uInlayScale; uniform vec2 uMapSize; uniform float uLaneHalf;
uniform sampler2D uTexLitter, uTexGrain, uTexMoss;
uniform vec3 uLane, uGrout, uVerge, uJungle, uMoss, uEarth, uClearing, uInscription, uThicketFloor, uShaftFloor, uSeatC, uMidInlay, uLitC;
uniform vec3 uPlazaA, uPlazaS, uInlayA, uInlayS;
uniform vec4 uPlaza0, uPlaza1, uFount0, uFount1;
uniform vec3 uSeat; uniform vec3 uPlate;
uniform vec3 uTempW, uTempE; uniform float uTempK; uniform float uWaterT;
uniform vec3 uSeatCol[ 10 ];
float gHeight; float gRough; vec3 gEmit;
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
  vec4 inl = texture( uInlay, p * uInlayScale ) * 0.6 - 0.15;
  float aa = clamp( length( fwidth( p ) ) * 0.75, 0.004, 0.25 );
  float nBig = valeFbm( p * 0.045 + 3.7 );
  float nMid = valeNoise( p * 0.31 ) * 0.65 + valeNoise( p * 0.83 + 5.1 ) * 0.35;
  float n2 = valeNoise( p * 2.3 );
  float wob = ( nMid - 0.5 ) * 1.3 + ( n2 - 0.5 ) * 0.35;
  vec4 tG = texture( uTexGrain, p / 3.0 );
  vec3 grainN = mix( vec3( 1.0 ), tG.rgb / valeTexMean( uTexGrain ), 0.9 );
  float gh = tG.a - 0.6;
  vec4 tM = valeTex2( uTexMoss, p / 4.0, valeNoise( p * 0.13 + 2.0 ) );
  vec3 mossN = mix( vec3( 1.0 ), tM.rgb / valeTexMean( uTexMoss ), 0.9 );
  float chip = ( valeNoise( p * 9.0 ) - 0.5 ) * 0.045 + gh * 0.1;
  vec3 col = uJungle; float h = 0.0; float rough = 0.95; vec3 emit = vec3( 0.0 );
  float brush = 1.0 - smoothstep( -0.25, 0.2, thickD );
#ifdef VALE_STYLE_DIAL
  // ── the Dialwood floor: moss and fan-leaf litter over old dial-stone, broad hue and value drifts ──
  vec4 tL = valeTex2( uTexLitter, p / 6.0, valeNoise( p * 0.11 + 7.0 ) );
  vec3 fband = uJungle;
  fband = mix( fband, uMoss, smoothstep( 0.42, 0.68, nBig ) * 0.6 );
  fband = mix( fband, uEarth, smoothstep( 0.5, 0.75, valeNoise( p * 0.06 + 11.0 ) ) * 0.55 );
  fband *= 0.86 + 0.28 * nMid;
  vec3 meanL = valeTexMean( uTexLitter );
  col = valeOrganic( mix( meanL, tL.rgb, 0.8 ), meanL, fband, 0.55 );
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
    float sLane = ss.r * 16.0, sRoom = ss.g * 24.0 - 8.0;
    float sv = valeNoise( site * 0.37 + 1.3 );
    float road = 1.0 - smoothstep( uLaneHalf - aa, uLaneHalf + aa, laneD );
    float vergeT = clamp( ( laneD - uLaneHalf ) / 1.6, 0.0, 1.0 );
    float keepV = ( 1.0 - clamp( ( sLane - uLaneHalf ) / 1.7, 0.0, 1.0 ) ) * 1.15 + ( fl.x - 0.5 ) * 0.7 + ( sv - 0.5 ) * 0.4 - 0.12;
    float vergeW = step( 0.5, keepV ) * ( 1.0 - road ) * step( uLaneHalf - 0.4, laneD );
    float roomT = clamp( ( clearD + 0.8 ) / 2.4, 0.0, 1.0 );
    float keepR = ( 1.0 - clamp( ( sRoom + 0.6 ) / 2.2, 0.0, 1.0 ) ) * 1.15 + ( fl.x - 0.5 ) * 0.6 + ( sv - 0.5 ) * 0.45 - 0.12;
    float roomW = step( 0.5, keepR ) * ( 1.0 - road );
    float fh, jw, fv, jv, fr, jr;
    // road: honed pale flags, polished toward the centre line, moss only in the outer joints
    vec3 roadBand = uLane * ( 1.0 + 0.05 * ( 1.0 - smoothstep( 0.0, uLaneHalf, laneD ) ) + 0.07 * ( nMid - 0.5 ) + 0.04 * ( nBig - 0.5 ) );
    vec3 roadC = valeFlag( roadBand, fl, grainN, chip, 0.04, uGrout, 0.12, fh, jw );
    float edgeMoss = smoothstep( uLaneHalf - 1.6, uLaneHalf - 0.3, laneD + wob * 0.6 );
    roadC = mix( roadC, mossC * 0.8, jw * edgeMoss * 0.85 );
    // the inscription band (0.3 m) on each outer edge, a carved strip with chalk hour-ticks
    float bandW = smoothstep( uLaneHalf - 0.3 - aa, uLaneHalf - 0.3 + aa, laneD );
    float bEdge = 1.0 - smoothstep( 0.0, 0.03 + aa, min( abs( laneD - ( uLaneHalf - 0.3 ) ), abs( laneD - uLaneHalf ) ) );
    vec3 bandC = uLane * 0.86 * grainN * ( 0.96 + 0.08 * n2 ) * ( 1.0 - 0.3 * bEdge );
    float tick = 1.0 - smoothstep( -aa, aa, inl.r );
    bandC = mix( bandC, uInscription, tick * 0.85 );
    bandC = mix( bandC, mossC * 0.85, smoothstep( 0.62, 0.8, ( 1.0 - fl.x ) * 0.6 + gh * 2.0 + ( n2 - 0.5 ) * 0.6 ) * 0.7 );
    roadC = mix( roadC, bandC, bandW );
    fh = mix( fh, -0.004 - bEdge * 0.012 + tick * 0.002, bandW );
    // verge: worn darker flags, moss in every joint and creeping over them toward the wood
    vec3 vergeC = valeFlag( uVerge * ( 0.93 + 0.14 * nMid ), fl, grainN, chip * 1.5, 0.075, mossC * 0.75, 0.2, fv, jv );
    float creep = smoothstep( 0.55, 0.8, vergeT * 0.8 + ( tM.a - 0.6 ) * 0.9 + ( n2 - 0.5 ) * 0.7 + ( nMid - 0.5 ) * 0.5 + ( 1.0 - fl.x ) * 0.25 );
    vergeC = mix( vergeC, mossC * 0.85, creep * 0.9 );
    fv = mix( fv, ( tM.a - 0.6 ) * 0.05, creep );
    // camp rooms: dusty pale stone, dust in the joints, moss creeping in from the rim
    vec3 roomC = valeFlag( uClearing * ( 0.95 + 0.1 * nMid ), fl, grainN, chip * 1.3, 0.06, uClearing * vec3( 0.74, 0.71, 0.66 ), 0.14, fr, jr );
    float creepR = smoothstep( 0.55, 0.8, roomT * 0.8 + ( tM.a - 0.6 ) * 0.9 + ( n2 - 0.5 ) * 0.7 + ( nMid - 0.5 ) * 0.5 + ( 1.0 - fl.x ) * 0.2 );
    roomC = mix( roomC, mossC * 0.85, max( jr * smoothstep( 0.2, 0.8, roomT ), creepR * 0.9 ) );
    fr = mix( fr, ( tM.a - 0.6 ) * 0.05, creepR );
    col = mix( col, roomC, roomW ); h = mix( h, fr, roomW );
    col = mix( col, vergeC, vergeW ); h = mix( h, fv, vergeW );
    col = mix( col, roadC, road ); h = mix( h, fh, road );
    rough = mix( rough, 0.82, max( vergeW, roomW ) ); rough = mix( rough, 0.66, road );
  }
  // Fallen Shaft floor: pale cool flags under the water film, a wet dark bank round it
  if ( shaftSD < 1.0 ) {
    float shw = 1.0 - smoothstep( -aa, aa, shaftSD );
    float hs, js;
    vec4 sf = valePavers( p + 31.0, 1.1 );
    vec3 sfc = valeFlag( uShaftFloor * ( 0.95 + 0.1 * nMid ), sf, grainN, chip, 0.045, uShaftFloor * 0.55, 0.16, hs, js );
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
  h = fh; rough = 0.7;
  float offLane = smoothstep( uLaneHalf + 1.2, uLaneHalf + 3.5, laneD );
  col = mix( col, uMoss * mossN * 0.8, jw * max( offLane, brush ) * 0.9 );
  float keepL = 0.85 - offLane * 0.45 + ( fl.x - 0.5 ) * 0.8 + gh * 0.6 + wob * 0.15;
  float mossF = ( 1.0 - smoothstep( 0.44, 0.5, keepL ) ) * offLane;
  col = mix( col, uMoss * mossN * 0.78, mossF ); h = mix( h, ( tM.a - 0.6 ) * 0.05, mossF );
  col = mix( col, uThicketFloor * mossN, brush * 0.9 );
  // the Snap: fine crazing (grooves) and the lit fracture
  float cz = 1.0 - smoothstep( -aa, aa, inl.g );
  float lit = 1.0 - smoothstep( -aa, aa, inl.b );
  float litGlow = 1.0 - smoothstep( -aa, 0.28, inl.b );
  // the drop: a pale chalk band of carved hour-script on every walkable edge (0.4 m)
  float bandS = 1.0 - smoothstep( 0.4 - aa, 0.4 + aa, edgeD );
  vec3 bandC = uInscription * grainN * ( 0.95 + 0.1 * n2 );
  bandC = mix( bandC, bandC * 0.6, cz );
  float bEdge = 1.0 - smoothstep( 0.0, 0.03 + aa, abs( edgeD - 0.4 ) );
  bandC *= 1.0 - 0.4 * bEdge;
  col = mix( col, col * 0.7, cz * ( 1.0 - bandS ) );
  col = mix( col, bandC, bandS ); h = mix( h, -cz * 0.006, bandS ); h -= cz * 0.006 * ( 1.0 - bandS );
  rough = mix( rough, 0.75, bandS );
  col = mix( col, uLitC * 0.55, lit );
  col = mix( col, col * 1.12, litGlow * ( 1.0 - lit ) );
  emit = uLitC * ( lit * 0.75 + litGlow * 0.06 );
  h -= lit * 0.012;
#endif
#ifdef VALE_STYLE_PLATE
  // ── the Noonplate: polished basalt in rings of great slabs, chalk hour-lines, the shop ring ──
  vec4 pf = valeRingFlags( p, uPlate.xy, 4.15, 3.3, 3.9 );
  float fh, jw;
  col = valeFlag( uLane * ( 0.95 + 0.1 * nMid + 0.04 * ( nBig - 0.5 ) ), pf, grainN, chip * 0.5, 0.025, uLane * 0.5, 0.12, fh, jw );
  h = fh * 0.7; rough = 0.52;
  col = mix( col, uThicketFloor * mossN, brush * 0.9 );
  float ch = 1.0 - smoothstep( -aa, aa, inl.r );
  float md = 1.0 - smoothstep( -aa, aa, inl.a );
  float chE = ( 1.0 - smoothstep( -aa, aa, min( inl.r, inl.a ) - 0.03 ) ) - max( ch, md );
  col *= 1.0 - 0.35 * chE;
  col = mix( col, uInscription * grainN, ch * 0.95 );
  col = mix( col, uMidInlay * grainN, md );
  h -= ( ch + md ) * 0.003 + chE * 0.004;
  rough = mix( rough, 0.62, max( ch, md ) );
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
  // ── base plazas: Aubade chalk flags with dawnglass rings, Serenade ochre sandstone with lampresin ──
  for ( int k = 0; k < 2; k ++ ) {
    vec4 PZ = k == 0 ? uPlaza0 : uPlaza1;
    vec4 FT = k == 0 ? uFount0 : uFount1;
    if ( PZ.z <= 0.0 ) continue;
    float pd = length( p - PZ.xy );
    if ( pd > PZ.z + 1.5 ) continue;
    vec4 pf = valeRingFlags( p, FT.xy, FT.z + 0.4, 1.35, 1.75 );
    // whole flags drop at the rim: the plaza distance at the flag's own centre
    float rcen = FT.z + 0.4 + ( pf.z + 0.5 ) * 1.35;
    vec2 dv = normalize( p - FT.xy + 1e-4 );
    float pdc = length( FT.xy + dv * rcen - PZ.xy );
    float keepP = ( PZ.z - max( pd, pdc ) ) / 1.4 + 0.5 + ( pf.x - 0.5 ) * 0.6;
    float pw = step( 0.5, keepP ) * step( pd, PZ.z + 1.2 );
    vec3 pband = PZ.w < 0.5 ? uPlazaA : uPlazaS;
    vec3 ic = PZ.w < 0.5 ? uInlayA : uInlayS;
    float ph, pj;
    vec3 pc = valeFlag( pband * ( 0.96 + 0.08 * nMid ), pf, grainN, chip, 0.04, pband * 0.68, 0.1, ph, pj );
    pc = mix( pc, uMoss * mossN * 0.85, pj * smoothstep( PZ.z - 2.5, PZ.z, pd + wob ) );
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
    col = mix( col, pc, pw );
    h = mix( h, ph * ( 1.0 - inner ) - chn * 0.006 - hourL * 0.004, pw );
    rough = mix( rough, mix( 0.64, 0.5, iw ), pw );
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
    vec4 tO = valeTex2( uTexLitter, p / 6.0, valeNoise( p * 0.11 ) );
    vec3 mO = valeTexMean( uTexLitter );
    vec3 og = valeOrganic( mix( mO, tO.rgb, 0.8 ), mO, mix( uMoss, uEarth, smoothstep( 0.4, 0.7, nBig ) ), 0.5 );
    og = mix( og, uEarth * 1.2 * grainN, smoothstep( 0.62, 0.7, valeNoise( p * 0.21 ) + gh ) );
    col = og; h = ( tO.a - 0.6 ) * 0.05; rough = 0.95; emit = vec3( 0.0 );
  }
  // the temperature field: a cool cast west, a warm cast east (never a team hue)
  vec3 tmp = mix( uTempW, uTempE, smoothstep( 0.12, 0.88, p.x / uMapSize.x ) );
  col *= mix( vec3( 1.0 ), tmp, uTempK );
  diffuseColor.rgb *= col;
  gHeight = h; gRough = rough; gEmit = emit;
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
uniform vec3 uFace, uLip, uEdgeLight, uTop, uMossC, uFlank, uRock, uMist, uEarthC;
uniform sampler2D uTexGrain, uTexMoss, uTexLitter;
uniform vec3 uTempW, uTempE; uniform float uTempK; uniform vec2 uMapSize;
uniform float uMistK; uniform float uStoneTop;   // 1: a clean stone stage (no moss, pale glare tops)
float cH; float cRough;
`;

/** walls body (replaces <map_fragment>). Kinds: see terrain_walls.ts WK */
export const WALL_MAIN_GLSL = /* glsl */`
{
  float u = vWA.x, vl = vWA.y, course = vWA.z;
  int kind = int( vWA.w + 0.5 );
  float sh = vWB.x, seed = vWB.y, wallH = vWB.w;
  vec3 P = vCliffW;
  vec2 fuv = vec2( u, P.y );
  vec4 tG = texture( uTexGrain, fuv / 3.0 );
  vec3 grainN = mix( vec3( 1.0 ), tG.rgb / valeTexMean( uTexGrain ), 0.9 );
  float gh = tG.a - 0.6;
  float n2 = valeNoise( fuv * 2.1 + seed );
  float nm = valeNoise( vec2( u * 0.23, P.y * 0.5 ) + seed * 3.0 );
  float chip = ( valeNoise( fuv * 8.0 + seed ) - 0.5 ) * 0.05 + gh * 0.12;
  vec3 c = uFace; float h = 0.0; float rough = 0.86;
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
    float mossAmt = max( foot * smoothstep( 0.3, 0.6, nm ), jt * smoothstep( 0.5, 0.75, nm ) ) * 0.85 * ( 1.0 - uStoneTop );
    float streak = smoothstep( 0.6, 0.85, valeNoise( vec2( u * 1.9, P.y * 0.12 ) + seed ) ) * smoothstep( wallH - 1.8, wallH - 0.4, P.y ) * ( 1.0 - uStoneTop );
    c = mix( c, mossC * 0.8, max( mossAmt, streak * 0.55 ) );
    rough = 0.88;
  } else if ( kind <= 5 ) {
    // the carved lip: cap stones with joints, a painted edge light on the chamfer, moss creeping over the top
    float L = 1.15 + 0.5 * valeHash12( vec2( seed, 5.0 ) );
    float bu = u / L;
    float bi = floor( bu ), bl = fract( bu );
    float e = min( bl, 1.0 - bl ) * L + chip;
    float jt = 1.0 - smoothstep( 0.008, 0.03, e );
    float r1 = valeHash12( vec2( bi, seed ) );
    c = uLip * ( 0.9 + 0.16 * r1 ) * grainN;
    c *= mix( 0.78, 1.0, smoothstep( 0.0, 0.12, e ) );
    c = mix( c, uLip * 0.45, jt );
    h = smoothstep( 0.0, 0.08, e ) * 0.02 + gh * 0.02;
    if ( kind == 2 ) c *= mix( 0.82, 1.0, vl );
    if ( kind == 3 ) c = mix( c, uEdgeLight * ( 0.92 + 0.12 * r1 ), 0.7 * ( 1.0 - jt ) * smoothstep( 0.15, 0.6, vl ) );
    if ( kind == 4 ) {
      float creep = smoothstep( 0.3, 0.8, vl + ( nm - 0.5 ) * 1.1 + ( n2 - 0.5 ) * 0.35 + ( r1 - 0.5 ) * 0.4 );
      vec3 mM = valeTexMean( uTexMoss );
      vec3 mossC = valeOrganic( mix( mM, texture( uTexMoss, P.xz / 4.0 ).rgb, 0.7 ), mM, uMossC, 0.5 );
      c = mix( c, mossC, creep * 0.85 * ( 1.0 - uStoneTop ) );
    }
    if ( kind == 5 ) c = mix( c * 0.7, uMossC * 0.7, 0.6 * ( 1.0 - uStoneTop ) );
    rough = 0.8;
  } else if ( kind == 6 && uStoneTop > 0.5 ) {
    // a carved block's top (the Noonplate's hour-stones): the cap stone itself
    vec2 q = vec2( u, vl );
    vec4 tq = texture( uTexGrain, q / 3.0 );
    if ( wallH < 2.0 ) {
      // a low carved block (an hour-stone): basalt cap, chalk-lit by the lip around it
      c = uLip * 0.62 * mix( vec3( 1.0 ), tq.rgb / valeTexMean( uTexGrain ), 0.9 );
      h = ( tq.a - 0.6 ) * 0.03;
    } else {
      // beyond the rim: the noon glare, pale and nearly featureless
      c = uTop * mix( vec3( 1.0 ), tq.rgb / valeTexMean( uTexGrain ), 0.12 ) * ( 0.985 + 0.03 * valeNoise( q * 0.25 ) );
      h = 0.0;
    }
    rough = 0.7;
  } else if ( kind == 6 ) {
    // the block's top: the Dialwood's own floor (moss cushions, leaf drifts) with weathered stone outcrops;
    // never paved, so a wall top can never be mistaken for walkable stone
    vec2 q = vec2( u, vl );
    vec4 tM = valeTex2( uTexMoss, q / 4.0, valeNoise( q * 0.13 ) );
    vec4 tL = valeTex2( uTexLitter, q / 6.0, valeNoise( q * 0.11 + 3.0 ) );
    vec4 tq = texture( uTexGrain, q / 3.0 );
    vec3 mM = valeTexMean( uTexMoss ), mL = valeTexMean( uTexLitter );
    vec3 a = valeOrganic( mix( mM, tM.rgb, 0.75 ), mM, uMossC * 1.12, 0.4 );
    vec3 b = valeOrganic( mix( mL, tL.rgb, 0.8 ), mL, uMossC * vec3( 1.15, 1.0, 0.85 ), 0.5 );
    float m = smoothstep( 0.4, 0.6, valeFbm( q * 0.12 + seed ) );
    c = mix( b, a, m ) * ( 0.88 + 0.24 * valeNoise( q * 0.35 ) );
    float rock = smoothstep( 0.8, 0.84, valeNoise( q * 0.55 + seed * 3.0 + 7.0 ) * 0.8 + valeNoise( q * 1.7 ) * 0.2 + ( tq.a - 0.6 ) * 0.6 );
    c = mix( c, uTop * 0.62 * mix( vec3( 1.0 ), tq.rgb / valeTexMean( uTexGrain ), 0.9 ), rock * 0.85 );
    h = mix( mix( tL.a, tM.a, m ) * 0.05, 0.03 + ( tq.a - 0.6 ) * 0.05, rock );
    rough = 0.95;
  } else if ( kind == 7 || kind == 9 ) {
    // the shaft's flank: needle stone in long courses, carved hour-bands stand proud
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
    if ( kind == 9 ) {
      // the carved hour-band: a raised ring of paler needle stone; two grooves follow the ring round the
      // shaft, its top carries three chalk hour-ticks
      bool isFlat = abs( vCliffN.y ) > 0.7;
      vec2 bq = isFlat ? vec2( u, vl ) : fuv;
      vec4 tb = texture( uTexGrain, bq / 3.0 );
      c = uLip * 0.85 * mix( vec3( 1.0 ), tb.rgb / valeTexMean( uTexGrain ), 0.9 ) * ( 0.92 + 0.12 * nm );
      c *= isFlat ? 1.0 : mix( 0.55, 1.0, smoothstep( -4.0, 0.6, P.y ) );
      float gU = abs( fract( u / 1.2 + 0.25 ) - 0.5 );
      float cut = isFlat ? 0.0 : 1.0 - smoothstep( 0.02, 0.045, gU );
      c = mix( c, c * 0.4, cut );

    }
    // lichen and damp streaks lower down
    c = mix( c, uMossC * 0.7, smoothstep( 0.55, 0.8, valeNoise( vec2( u * 0.7, P.y * 0.25 ) + seed ) ) * smoothstep( -0.6, -3.5, P.y ) * 0.6 );
    h = smoothstep( 0.0, 0.08, e ) * 0.03 + gh * 0.03;
    rough = 0.82;
  } else {
    // raw rock: irregular cleft facets stretched along the bedding, dark open joints, lichen, broad drifts
    vec2 rq = vec2( u + ( valeNoise( vec2( P.y * 0.08, seed ) ) - 0.5 ) * 2.0, P.y * 0.3 );
    vec4 rc = valePavers( rq + seed * 13.0, 1.35 );
    float e = rc.y + ( valeNoise( fuv * 2.2 + seed ) - 0.5 ) * 0.12;
    float jt = 1.0 - smoothstep( 0.02, 0.1, e );
    float r1 = rc.x;
    vec4 tq = texture( uTexGrain, fuv / 5.0 );
    vec2 lc = ( rq - valePaverSite( rc, 1.35 ) + seed * 13.0 );
    float tilt = dot( lc, vec2( valeHash12( rc.zw ) - 0.5, valeHash12( rc.zw + 3.1 ) - 0.5 ) ) * 0.25;
    c = uRock * ( 0.7 + 0.55 * r1 ) * mix( vec3( 1.0 ), tq.rgb / valeTexMean( uTexGrain ), 0.95 ) * ( 0.84 + 0.32 * nm );
    c = mix( c, uRock * 0.28, jt );
    // benches and ledges catch the sky: up-facing rock is paler and mossy
    float up = smoothstep( 0.35, 0.8, vCliffN.y );
    c = mix( c, mix( uRock * 1.2, uMossC * 0.7, 0.4 ), up * 0.35 );
    c = mix( c, uMossC * 0.55, smoothstep( 0.62, 0.85, valeNoise( fuv * 0.35 + seed ) ) * 0.45 * ( 1.0 - jt ) );
    h = smoothstep( 0.0, 0.22, e ) * ( 0.1 + tilt ) + ( tq.a - 0.6 ) * 0.04;
    rough = 0.92;
  }
  vec3 tmp = mix( uTempW, uTempE, smoothstep( 0.12, 0.88, P.x / uMapSize.x ) );
  c *= mix( vec3( 1.0 ), tmp, uTempK );
  diffuseColor.rgb *= c;
  cH = h; cRough = rough;
}
`;

/** gorge mist: the deeper, the more the stone dissolves into the gorge colour (height, never camera distance) */
export const WALL_MIST_GLSL = /* glsl */`
{
  float dm = max( 0.0, -vCliffW.y - 2.0 );
  float m = 1.0 - exp( -uMistK * dm * ( 1.0 + dm * 0.045 ) );
  // the mist thickens, then the abyss darkens under it
  outgoingLight = mix( outgoingLight, uMist * mix( 1.0, 0.45, smoothstep( 8.0, 30.0, dm ) ), m );
}
`;

/** the Standing Shadow: violet-cool stone, hard engraved edge (its own mesh, keepColor under fog) */
export const SHADOW_PARS_GLSL = /* glsl */`
varying vec3 vShW;
uniform sampler2D uSplat; uniform sampler2D uSplat2; uniform sampler2D uInlay; uniform vec2 uSplatScale; uniform vec2 uInlayScale;
uniform sampler2D uTexGrain; uniform vec3 uShadowC; uniform vec3 uShadowLine;
float sHeight;
`;
export const SHADOW_MAIN_GLSL = /* glsl */`
{
  vec2 p = vShW.xz;
  vec4 s1 = texture( uSplat, p * uSplatScale );
  vec4 s2 = texture( uSplat2, p * uSplatScale );
  float sd = s2.r * 8.0 - 4.0;                     // < 0 inside
  float wallD = s1.b * 8.0;
  vec4 inl = texture( uInlay, p * uInlayScale ) * 0.6 - 0.15;
  float aa = clamp( length( fwidth( p ) ) * 0.75, 0.004, 0.25 );
  vec4 tG = texture( uTexGrain, p / 3.0 );
  vec3 grainN = mix( vec3( 1.0 ), tG.rgb / valeTexMean( uTexGrain ), 0.9 );
  float gh = tG.a - 0.6;
  float chip = ( valeNoise( p * 9.0 ) - 0.5 ) * 0.04 + gh * 0.1;
  vec4 fl = valePavers( p + 17.0, 1.25 );
  float fh, jw;
  vec3 sc0 = mix( vec3( dot( uShadowC, vec3( 0.2126, 0.7152, 0.0722 ) ) ), uShadowC, 0.8 );
  vec3 c = valeFlag( sc0 * ( 0.96 + 0.08 * valeNoise( p * 0.3 ) ), fl, grainN, chip, 0.04, sc0 * 0.55, 0.14, fh, jw );
  // the engraved hard edge: a groove 0.1 m inside the outline, a lit arris beyond it
  float groove = 1.0 - smoothstep( 0.0, 0.025 + aa, abs( sd + 0.16 ) - 0.05 );
  float arris = 1.0 - smoothstep( 0.0, 0.02 + aa, abs( sd + 0.27 ) - 0.025 );
  float rim = 1.0 - smoothstep( -0.32, -0.05, sd );
  c = mix( c, uShadowC * 0.82 * grainN, rim * 0.6 );
  c = mix( c, uShadowC * 0.35, groove );
  c = mix( c, uShadowLine, arris * 0.8 );
  // the tip mark (engraved)
  float tip = 1.0 - smoothstep( -aa, aa, inl.b );
  c = mix( c, uShadowC * 0.4, tip );
  c *= mix( 0.55, 1.0, smoothstep( 0.0, 1.9, wallD ) );
  diffuseColor.rgb *= c;
  sHeight = fh - groove * 0.02 + arris * 0.004 - tip * 0.01;
}
`;
