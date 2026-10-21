// VALE render — VFX shaders. Every VFX material outputs PREMULTIPLIED colour and blends with
// (ONE, ONE_MINUS_SRC_ALPHA): additive light writes alpha 0, ink/alpha/opaque chips write coverage,
// so light and ink share one sorted draw per element kind. Depth is tested MANUALLY against the
// composer's stable scene depth (the VFX pass runs after AO, whichever ping-pong buffer is current):
// `vfxSoft(m)` gives soft-particle fades (depth difference / m) and hides fragments behind the scene.

import { AddEquation, CustomBlending, OneFactor, OneMinusSrcAlphaFactor, type Texture, Vector2 } from 'three';

/** uniforms shared by reference by every VFX material (updated once per frame) */
export const vfxUniforms = {
  uDepth: { value: null as Texture | null },
  uHasDepth: { value: 0 },
  uRes: { value: new Vector2(1920, 1080) },
  uNear: { value: 1 },
  uFar: { value: 400 },
  uTime: { value: 0 },
  uAtlas: { value: null as Texture | null },
  uNoise: { value: null as Texture | null },
  uGrid: { value: 8 },
};

/** premultiplied "over" (additive when alpha is 0) */
export const PREMUL = {
  transparent: true, depthWrite: false, depthTest: false,
  blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
  blendEquationAlpha: AddEquation, blendSrcAlpha: OneFactor, blendDstAlpha: OneMinusSrcAlphaFactor,
} as const;

const DEPTH = /* glsl */`
uniform sampler2D uDepth;
uniform float uHasDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
float vfxLin( float d ) { float z = d * 2.0 - 1.0; return ( 2.0 * uNear * uFar ) / ( uFar + uNear - z * ( uFar - uNear ) ); }
// 0 behind the scene, fading to 1 over 'soft' metres in front of it
float vfxSoft( float soft ) {
  if ( uHasDepth < 0.5 ) return 1.0;
  float sd = vfxLin( texture2D( uDepth, gl_FragCoord.xy / uRes ).r );
  float fd = vfxLin( gl_FragCoord.z );
  float diff = sd - fd;
  return soft > 0.001 ? clamp( diff / soft, 0.0, 1.0 ) : step( -0.03, diff );
}
`;

// ── particles + sprites (one instanced draw) ───────────────────────────────────────────────────
export const PARTICLE_VERT = /* glsl */`
attribute vec4 aPos;   // xyz, size
attribute vec4 aCol;   // rgb (HDR), alpha
attribute vec4 aVel;   // velocity xyz, stretch (s)
attribute vec4 aTex;   // cell (+frame), frame blend, rotation, erode
attribute vec4 aPar;   // soft (m), rim amount, mode (0 add 1 alpha 2 ink 3 chip), align (0 camera 1 velocity 2 ground 3 axis)
attribute vec4 aRim;   // rim rgb, aspect (width / height)
uniform float uGrid;
varying vec2 vUvA; varying vec2 vUvB; varying float vBlend; varying vec4 vCol; varying vec4 vPar; varying vec3 vRim; varying float vErode;
vec2 cellUv( float c, vec2 local ) { vec2 cell = vec2( mod( c, uGrid ), floor( c / uGrid ) ); return ( cell + 0.006 + local * 0.988 ) / uGrid; }
void main() {
  vec2 corner = position.xy;
  float size = aPos.w;
  float rot = aTex.z;
  float align = aPar.w;
  vec4 mv;
  if ( align > 1.5 && align < 2.5 ) {
    float c = cos( rot ), s = sin( rot );
    vec2 q = vec2( c * corner.x - s * corner.y, s * corner.x + c * corner.y ) * size;
    q.x *= aRim.w;
    mv = viewMatrix * vec4( aPos.xyz + vec3( q.x, 0.0, -q.y ), 1.0 );
  } else if ( align > 2.5 ) {
    vec3 toCam = cameraPosition - aPos.xyz; toCam.y = 0.0;
    vec3 right = normalize( cross( vec3( 0.0, 1.0, 0.0 ), toCam ) + vec3( 1e-5, 0.0, 0.0 ) );
    mv = viewMatrix * vec4( aPos.xyz + right * corner.x * size * aRim.w + vec3( 0.0, corner.y * size, 0.0 ), 1.0 );
  } else {
    mv = viewMatrix * vec4( aPos.xyz, 1.0 );
    vec3 vv = ( viewMatrix * vec4( aVel.xyz, 0.0 ) ).xyz;
    float l = length( vv.xy );
    if ( aVel.w > 0.0 && l > 1e-3 ) {
      vec2 ax = vv.xy / l, ay = vec2( -ax.y, ax.x );
      float len = min( size + l * aVel.w, size * 9.0 );
      mv.xy += ax * corner.x * len + ay * corner.y * size * 0.42;
    } else {
      float c = cos( rot ), s = sin( rot );
      mv.xy += mat2( c, s, -s, c ) * ( corner * vec2( aRim.w, 1.0 ) ) * size;
    }
  }
  gl_Position = projectionMatrix * mv;
  vec2 local = corner + 0.5;
  float cell = floor( aTex.x + 0.001 );
  vUvA = cellUv( cell, local );
  vUvB = cellUv( cell + 1.0, local );
  vBlend = aTex.y;
  vCol = aCol; vPar = aPar; vRim = aRim.rgb; vErode = aTex.w;
}`;

export const PARTICLE_FRAG = /* glsl */`
uniform sampler2D uAtlas;
${DEPTH}
varying vec2 vUvA; varying vec2 vUvB; varying float vBlend; varying vec4 vCol; varying vec4 vPar; varying vec3 vRim; varying float vErode;
void main() {
  vec4 t = texture2D( uAtlas, vUvA );
  if ( vBlend > 0.001 ) t = mix( t, texture2D( uAtlas, vUvB ), vBlend );
  float mode = vPar.z;
  float cov = t.a;
  float er = vErode;
  float keep = er > 0.001 ? smoothstep( er, er + 0.14, t.b ) : 1.0;
  float soft = vfxSoft( vPar.x );
  if ( mode > 2.5 ) {
    // opaque chip: hard coverage, faceted value, catch-light edge
    float a = smoothstep( 0.4, 0.6, cov * keep ) * vCol.a * step( 0.001, soft );
    if ( a < 0.01 ) discard;
    vec3 rgb = vCol.rgb * ( 0.42 + 0.78 * t.r ) + vRim * t.g * vPar.y;
    gl_FragColor = vec4( rgb * a, a );
    return;
  }
  float a = cov * keep * vCol.a * soft;
  if ( a < 0.002 ) discard;
  if ( mode < 0.5 ) {
    gl_FragColor = vec4( vCol.rgb * ( 0.3 + 0.7 * t.r ) * a, 0.0 );
  } else if ( mode < 1.5 ) {
    gl_FragColor = vec4( vCol.rgb * ( 0.72 + 0.28 * t.r ) * a, a );
  } else {
    float rim = clamp( t.g * vPar.y * 1.6, 0.0, 1.0 );
    vec3 body = vCol.rgb * ( 0.5 + 0.5 * t.r );
    gl_FragColor = vec4( ( body * ( 1.0 - rim ) + vRim * rim ) * a, a * ( 1.0 - rim * 0.35 ) );
  }
}`;

// ── ribbons (CPU-built camera-facing strips, one draw) ─────────────────────────────────────────
export const RIBBON_VERT = /* glsl */`
attribute vec4 aCol;   // rgb (HDR), alpha
attribute vec4 aUv;    // u (0 tail → 1 head), v (0..1 across), distance along (m), seed
attribute vec4 aPrm;   // mode, noise, scroll (m/s), tile (1/m)
attribute vec4 aRimC;  // rim rgb, rim amount
varying vec4 vCol; varying vec4 vUv; varying vec4 vPrm; varying vec4 vRim;
void main() { vCol = aCol; vUv = aUv; vPrm = aPrm; vRim = aRimC; gl_Position = projectionMatrix * viewMatrix * vec4( position, 1.0 ); }`;

export const RIBBON_FRAG = /* glsl */`
uniform sampler2D uNoise;
uniform float uTime;
${DEPTH}
varying vec4 vCol; varying vec4 vUv; varying vec4 vPrm; varying vec4 vRim;
void main() {
  float v = vUv.y;
  float across = 1.0 - abs( v * 2.0 - 1.0 );
  float prof = smoothstep( 0.0, 0.6, across );
  float core = pow( max( across, 0.0 ), 5.0 );
  vec2 nuv = vec2( vUv.z * vPrm.w - uTime * vPrm.z, v * 0.55 + vUv.w );
  float n = texture2D( uNoise, nuv ).b * 0.65 + texture2D( uNoise, nuv * vec2( 0.5, 1.4 ) + 0.37 ).r * 0.55;
  float nm = mix( 1.0, smoothstep( 0.22, 0.78, n ), vPrm.y );
  float a = vCol.a * prof * nm * vfxSoft( 0.12 );
  if ( a < 0.002 ) discard;
  float mode = vPrm.x;
  if ( mode < 0.5 ) gl_FragColor = vec4( vCol.rgb * ( 0.75 + 1.4 * core ) * a, 0.0 );
  else if ( mode < 1.5 ) gl_FragColor = vec4( vCol.rgb * a, a );
  else {
    float rim = ( 1.0 - smoothstep( 0.0, 0.32, across ) ) * vRim.w * smoothstep( 0.0, 0.08, across );
    gl_FragColor = vec4( mix( vCol.rgb * ( 0.6 + 0.4 * n ), vRim.rgb, rim ) * a, a );
  }
}`;

// ── beams (instanced noise-displaced strips) ───────────────────────────────────────────────────
export const BEAM_VERT = /* glsl */`
attribute vec4 aA;   // start xyz, width
attribute vec4 aB;   // end xyz, noise amplitude (m)
attribute vec4 aC;   // rgb (HDR), alpha
attribute vec4 aD;   // scroll, freq (1/m), seed, mode
attribute vec4 aE;   // core boost, taper start, taper end, age01
uniform float uTime;
varying vec2 vUv; varying vec4 vC; varying vec4 vD; varying vec4 vE; varying float vS;
void main() {
  vec3 a = aA.xyz, b = aB.xyz;
  float s = position.x;
  vec3 mid = mix( a, b, s );
  float L = length( b - a );
  vec3 dir = ( b - a ) / max( L, 1e-4 );
  vec3 toCam = normalize( cameraPosition - mid );
  vec3 side = normalize( cross( dir, toCam ) + vec3( 0.0, 1e-5, 0.0 ) );
  vec3 up2 = normalize( cross( side, dir ) );
  float pin = sin( s * 3.14159 );
  float ph = s * L * aD.y + aD.z * 17.0;
  float disp = ( sin( ph * 2.1 + uTime * 6.0 ) * 0.55 + sin( ph * 4.7 - uTime * 9.0 + 1.3 ) * 0.3 + sin( ph * 9.3 + uTime * 4.0 ) * 0.15 ) * aB.w * pin;
  float disp2 = ( sin( ph * 1.7 - uTime * 5.0 + 2.0 ) * 0.6 + sin( ph * 5.1 + uTime * 8.0 ) * 0.4 ) * aB.w * pin;
  float w = aA.w * mix( aE.y, 1.0, smoothstep( 0.0, 0.12, s ) ) * mix( 1.0, aE.z, smoothstep( 0.88, 1.0, s ) );
  vec3 wp = mid + side * ( position.y * w + disp ) + up2 * disp2;
  vUv = vec2( s * L, position.y + 0.5 ); vS = s;
  vC = aC; vD = aD; vE = aE;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}`;

export const BEAM_FRAG = /* glsl */`
uniform sampler2D uNoise;
uniform float uTime;
${DEPTH}
varying vec2 vUv; varying vec4 vC; varying vec4 vD; varying vec4 vE; varying float vS;
void main() {
  float across = 1.0 - abs( vUv.y * 2.0 - 1.0 );
  float prof = smoothstep( 0.0, 0.7, across );
  float core = pow( max( across, 0.0 ), 7.0 );
  vec2 nuv = vec2( vUv.x * 0.32 - uTime * vD.x, vUv.y * 0.45 + vD.z );
  float n = texture2D( uNoise, nuv ).b * 0.6 + texture2D( uNoise, nuv * vec2( 1.9, 0.7 ) + 0.5 ).r * 0.5;
  float ends = smoothstep( 0.0, 0.04, vS ) * ( 1.0 - smoothstep( 0.96, 1.0, vS ) );
  float a = vC.a * prof * mix( 0.45, 1.0, smoothstep( 0.2, 0.8, n ) ) * ends * vfxSoft( 0.1 );
  if ( a < 0.002 ) discard;
  vec3 rgb = vC.rgb * ( 0.55 + 0.6 * n ) + vC.rgb * core * vE.x;
  if ( vD.w < 0.5 ) gl_FragColor = vec4( rgb * a, 0.0 );
  else gl_FragColor = vec4( rgb * a, a );
}`;

// ── shockwave rings (ground or camera-facing) ──────────────────────────────────────────────────
export const RING_VERT = /* glsl */`
attribute vec4 aPos;   // centre xyz, radius
attribute vec4 aSty;   // width, alpha, sharpness, noise
attribute vec4 aCol;   // rgb (HDR), mode
attribute vec4 aMisc;  // vertical (0/1), seed, inner fill, age01
varying vec2 vL; varying vec4 vSty; varying vec4 vCol; varying vec4 vMisc; varying float vR;
void main() {
  float ext = aPos.w + aSty.x * 0.6 + 0.05;
  vec2 q = position.xy * 2.0 * ext;
  vec4 mv;
  if ( aMisc.x > 0.5 ) { mv = viewMatrix * vec4( aPos.xyz, 1.0 ); mv.xy += q; }
  else mv = viewMatrix * vec4( aPos.xyz + vec3( q.x, 0.0, -q.y ), 1.0 );
  vL = q; vSty = aSty; vCol = aCol; vMisc = aMisc; vR = aPos.w;
  gl_Position = projectionMatrix * mv;
}`;

export const RING_FRAG = /* glsl */`
uniform sampler2D uNoise;
${DEPTH}
varying vec2 vL; varying vec4 vSty; varying vec4 vCol; varying vec4 vMisc; varying float vR;
void main() {
  float d = length( vL );
  float W = max( vSty.x, 1e-3 );
  float x = ( d - ( vR - W ) ) / W;                       // 0 trailing edge → 1 leading edge
  float band = smoothstep( 0.0, 1.0, clamp( x, 0.0, 1.0 ) ) * ( 1.0 - smoothstep( 0.9, 1.06, x ) );
  float lead = pow( max( band, 0.0 ), max( 0.3, vSty.z ) );           // the danger (leading) edge is brightest
  float fill = vMisc.z * smoothstep( 0.0, 1.0, clamp( d / max( vR, 1e-3 ), 0.0, 1.0 ) ) * ( 1.0 - step( 1.0, x ) ) * 0.35;
  float ang = atan( vL.y, vL.x );
  float n = texture2D( uNoise, vec2( ang * 0.6366 + vMisc.y, d * 0.12 - vMisc.w * 0.6 ) ).r;
  float nm = mix( 1.0, smoothstep( 0.18, 0.72, n ) * 1.25, vSty.w );
  float a = ( lead + fill ) * nm * vSty.y * vfxSoft( 0.08 );
  if ( a < 0.002 ) discard;
  float mode = vCol.w;
  vec3 rgb = vCol.rgb * ( 0.7 + 0.5 * lead );
  if ( mode < 0.5 ) gl_FragColor = vec4( rgb * a, 0.0 );
  else gl_FragColor = vec4( rgb * a, a );
}`;

// ── ground decals (animated styles) ────────────────────────────────────────────────────────────
export const DECAL_VERT = /* glsl */`
attribute vec4 aPos;   // x, y, z, radius
attribute vec4 aRot;   // rotation, shape, style, alpha
attribute vec4 aCol;   // rgb, emissive
attribute vec4 aMisc;  // age01, seed, shape param (cone half-angle | width / length), cell
attribute vec4 aRimC;  // rim rgb, rx/ry aspect (rect, line)
varying vec2 vL; varying vec4 vRot; varying vec4 vCol; varying vec4 vMisc; varying vec4 vRim; varying vec2 vW;
void main() {
  float r = aPos.w;
  vec2 q = position.xy * 2.0;
  vec2 s = q * r;
  float c = cos( aRot.x ), sn = sin( aRot.x );
  vec2 w = vec2( c * s.x - sn * s.y, sn * s.x + c * s.y );
  vec3 wp = vec3( aPos.x + w.x, aPos.y, aPos.z + w.y );
  vL = q; vRot = aRot; vCol = aCol; vMisc = aMisc; vRim = aRimC; vW = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}`;

export const DECAL_FRAG = /* glsl */`
uniform sampler2D uAtlas;
uniform sampler2D uNoise;
uniform float uGrid;
uniform float uTime;
${DEPTH}
varying vec2 vL; varying vec4 vRot; varying vec4 vCol; varying vec4 vMisc; varying vec4 vRim; varying vec2 vW;
vec4 atlasAt( float cell, vec2 q ) {
  vec2 local = clamp( q * 0.5 + 0.5, 0.0, 1.0 );
  vec2 c = vec2( mod( cell, uGrid ), floor( cell / uGrid ) );
  return texture2D( uAtlas, ( c + 0.006 + local * 0.988 ) / uGrid );
}
void main() {
  float shape = vRot.y, style = vRot.z;
  vec2 l = vL;
  float d = length( l );
  float n = texture2D( uNoise, vW * 0.21 + vMisc.y ).r;
  float edgeN = ( n - 0.5 ) * 0.12;
  float m;
  if ( shape < 0.5 ) m = 1.0 - smoothstep( 0.82, 1.0, d + edgeN );
  else if ( shape < 1.5 ) m = ( 1.0 - smoothstep( 0.86, 1.0, d + edgeN ) ) * smoothstep( 0.52, 0.7, d + edgeN );
  else if ( shape < 2.5 ) { float an = abs( atan( l.y, l.x ) ); m = ( 1.0 - smoothstep( 0.85, 1.0, d + edgeN ) ) * ( 1.0 - smoothstep( vMisc.z - 0.06, vMisc.z, an ) ) * step( 0.0, l.x ); }
  else if ( shape < 3.5 ) m = ( 1.0 - smoothstep( 0.9, 1.0, abs( l.x ) + edgeN ) ) * ( 1.0 - smoothstep( vMisc.z - 0.08, vMisc.z, abs( l.y ) + edgeN * 0.5 ) );
  else m = ( 1.0 - smoothstep( 0.92, 1.0, abs( l.x ) + edgeN * 0.5 ) ) * ( 1.0 - smoothstep( vMisc.z * 0.6, vMisc.z, abs( l.y ) + edgeN * 0.3 ) );
  float age = vMisc.x;
  // texture coordinates: rect/line stretch the pattern along their length
  vec2 tq = shape > 2.5 ? vec2( l.x, l.y / max( vMisc.z, 0.05 ) ) : l;
  vec4 t = atlasAt( vMisc.w, tq * 0.98 );
  float alpha = vRot.w * m * vfxSoft( 0.0 );
  vec3 rgb; float a; float addOnly = 0.0;
  if ( style < 0.5 ) { // plain: tinted, textured
    a = alpha * mix( 0.35, 1.0, t.a );
    rgb = vCol.rgb * ( 1.0 + vCol.w );
  } else if ( style < 1.5 ) { // scorch: char + an ember edge that cools
    float keep = smoothstep( age * 0.9, age * 0.9 + 0.15, t.b );
    a = alpha * t.a * keep;
    float ember = t.g * pow( clamp( 1.0 - age, 0.0, 1.0 ), 2.0 ) * vCol.w;
    rgb = vCol.rgb * ( 0.5 + 0.5 * t.r ) + vRim.rgb * ember * 3.0;
  } else if ( style < 2.5 ) { // crack: dark fracture lines with light cooling in them
    float keep = smoothstep( age, age + 0.12, t.b );
    float line = t.g;
    a = alpha * clamp( line * 1.3 + t.a * 0.15, 0.0, 1.0 ) * keep;
    float glow = line * pow( clamp( 1.0 - age, 0.0, 1.0 ), 1.6 ) * vCol.w;
    rgb = vCol.rgb + vRim.rgb * glow;
  } else if ( style < 3.5 ) { // ink splat with a light rim
    float keep = smoothstep( age, age + 0.14, t.b );
    a = alpha * t.a * keep;
    float rim = t.g * vRim.w;
    rgb = mix( vCol.rgb * ( 0.6 + 0.4 * t.r ), vRim.rgb, clamp( rim, 0.0, 1.0 ) );
  } else if ( style < 4.5 ) { // frost: glassy facets with sparkles
    float keep = smoothstep( age * 0.9, age * 0.9 + 0.15, t.b );
    a = alpha * t.a * keep;
    float tw = 0.5 + 0.5 * sin( uTime * 2.4 + n * 40.0 );
    rgb = vCol.rgb * ( 0.65 + 0.35 * t.r ) + vRim.rgb * t.g * ( 0.6 + 0.6 * tw ) * max( vCol.w, 0.5 );
  } else { // light pool (additive caustics)
    a = alpha * t.a;
    rgb = vCol.rgb * ( 0.4 + 0.9 * t.r ) * max( vCol.w, 0.3 );
    addOnly = 1.0;
  }
  if ( a < 0.002 ) discard;
  gl_FragColor = vec4( rgb * a, addOnly > 0.5 ? 0.0 : a );
}`;

// ── FX meshes (one material: fresnel rim, two scrolling noises, dissolve with a glowing edge,
//    masks, vertex wobble/twist, HDR) ────────────────────────────────────────────────────────────
export const MESH_VERT = /* glsl */`
attribute vec4 aColor;  // rgb (HDR), alpha
attribute vec4 aRimC;   // rim rgb (HDR), fresnel power
attribute vec4 aEdge;   // dissolve-edge rgb (HDR), edge width
attribute vec4 aNoise;  // scale, scroll u, scroll v, noise amount
attribute vec4 aDiss;   // dissolve, mask kind, mask param, mode
attribute vec4 aMisc;   // wobble (m), twist (rad/m), fan half-angle, seed
uniform float uTime;
uniform float uShapeKind;
varying vec3 vN; varying vec3 vV; varying vec2 vUv;
varying vec4 vColor; varying vec4 vRim; varying vec4 vEdge; varying vec4 vNoise; varying vec4 vDiss; varying float vSeed;
void main() {
  vec3 p = position;
  vec3 n = normal;
  if ( uShapeKind > 0.5 && uShapeKind < 1.5 ) {
    float ang = ( uv.x - 0.5 ) * 2.0 * aMisc.z;
    float rr = uv.y * 0.5;
    p = vec3( sin( ang ) * rr, 0.0, cos( ang ) * rr );
    n = vec3( 0.0, 1.0, 0.0 );
  }
  if ( abs( aMisc.y ) > 1e-4 ) {
    float a = aMisc.y * p.y + uTime * sign( aMisc.y ) * 2.0;
    float c = cos( a ), s = sin( a );
    p.xz = mat2( c, -s, s, c ) * p.xz;
    n.xz = mat2( c, -s, s, c ) * n.xz;
  }
  if ( aMisc.x > 0.0 ) {
    float w = sin( uTime * 4.4 + p.y * 7.0 + aMisc.w * 10.0 ) * 0.6 + sin( uTime * 3.1 + p.x * 9.0 + p.z * 6.0 ) * 0.4;
    p += n * w * aMisc.x;
  }
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4( p, 1.0 );
  vec4 mv = viewMatrix * wp;
  vN = normalize( mat3( viewMatrix ) * mat3( m ) * n );
  vV = normalize( -mv.xyz );
  vUv = uv;
  vColor = aColor; vRim = aRimC; vEdge = aEdge; vNoise = aNoise; vDiss = aDiss; vSeed = aMisc.w;
  gl_Position = projectionMatrix * mv;
}`;

export const MESH_FRAG = /* glsl */`
uniform sampler2D uNoise;
uniform float uTime;
${DEPTH}
varying vec3 vN; varying vec3 vV; varying vec2 vUv;
varying vec4 vColor; varying vec4 vRim; varying vec4 vEdge; varying vec4 vNoise; varying vec4 vDiss; varying float vSeed;
void main() {
  vec3 N = normalize( vN );
  float ndv = abs( dot( N, normalize( vV ) ) );
  // GLSL pow is undefined below 0: ndv can round past 1 where a face looks straight at the camera, and one NaN
  // fragment, spread by the bloom, blacks out the whole frame (r12 wave A fix)
  float fres = pow( clamp( 1.0 - ndv, 0.0, 1.0 ), max( 0.5, vRim.w ) );
  vec2 sc = vec2( vNoise.y, vNoise.z ) * uTime;
  vec2 uv = vUv * vec2( 1.0, 1.0 ) * vNoise.x;
  float n1 = texture2D( uNoise, uv + sc + vSeed ).r;
  float n2 = texture2D( uNoise, uv * 2.3 - sc * 1.37 + 0.31 + vSeed ).a;
  float nz = clamp( n1 * 0.7 + n2 * 0.5 - 0.1, 0.0, 1.0 );
  float kind = vDiss.y, mp = vDiss.z;
  float mask = 1.0, boost = 0.0;
  if ( kind > 0.5 && kind < 1.5 ) mask = smoothstep( 0.0, mp, vUv.y ) * ( 1.0 - smoothstep( 1.0 - mp, 1.0, vUv.y ) );
  else if ( kind > 1.5 && kind < 2.5 ) mask = smoothstep( 0.0, 0.08, vUv.y ) * ( 1.0 - smoothstep( 1.0 - mp, 1.0, vUv.y ) );
  else if ( kind > 2.5 && kind < 3.5 ) {
    // sweep: a bright head travels u 0 → 1 with a fading tail ("danger edge brightest")
    float head = mp;
    mask = smoothstep( head - 0.55, head - 0.02, vUv.x ) * ( 1.0 - smoothstep( head, head + 0.03, vUv.x ) );
    boost = smoothstep( head - 0.12, head, vUv.x ) * ( 1.0 - smoothstep( head, head + 0.03, vUv.x ) );
  }
  else if ( kind > 3.5 && kind < 4.5 ) mask = smoothstep( 0.0, mp, vUv.y ) * ( 1.0 - smoothstep( 1.0 - mp, 1.0, vUv.y ) ) * 1.0;
  else if ( kind > 4.5 ) { mask = smoothstep( mp - 0.25, mp, vUv.y ) * ( 1.0 - smoothstep( mp, mp + 0.04, vUv.y ) ); boost = mask; }
  float diss = vDiss.x;
  float keep = nz + 0.02 - diss;
  if ( keep < 0.0 ) discard;
  float edge = diss > 0.002 ? 1.0 - smoothstep( 0.0, max( vEdge.w, 0.005 ), keep ) : 0.0;
  float body = mix( 1.0, smoothstep( 0.1, 0.9, nz ), vNoise.w );
  float a = vColor.a * mask * vfxSoft( 0.18 );
  if ( a < 0.002 ) discard;
  float mode = vDiss.w;
  vec3 rgb;
  if ( mode < 0.5 ) {
    rgb = vColor.rgb * body * ( 1.0 + boost * 1.5 ) + vRim.rgb * fres + vEdge.rgb * edge;
    gl_FragColor = vec4( rgb * a, 0.0 );
  } else if ( mode < 1.5 ) {
    float aa = a * mix( 1.0, body, 0.4 );
    rgb = vColor.rgb * ( 0.7 + 0.3 * body ) + vRim.rgb * fres + vEdge.rgb * edge;
    gl_FragColor = vec4( rgb * aa, aa );
  } else {
    float aa = a * clamp( body * 1.25, 0.0, 1.0 );
    float rim = clamp( fres * 1.3, 0.0, 1.0 );
    rgb = vColor.rgb * ( 0.65 + 0.35 * nz ) * ( 1.0 - rim ) + vRim.rgb * rim + vEdge.rgb * edge;
    gl_FragColor = vec4( rgb * aa, aa * ( 1.0 - rim * 0.3 ) );
  }
}`;

// ── distortion sprites (into the half-res distortion buffer, additive offsets in UV units) ───────
export const DISTORT_VERT = /* glsl */`
attribute vec4 aPos;   // centre xyz, radius
attribute vec4 aPar;   // mode, strength, age01, seed
attribute vec4 aAx;    // ground (0/1)
varying vec2 vL; varying vec4 vPar; varying vec2 vCentre;
void main() {
  vec2 q = position.xy * 2.0;
  vec4 mv;
  if ( aAx.x > 0.5 ) mv = viewMatrix * vec4( aPos.xyz + vec3( q.x, 0.0, -q.y ) * aPos.w, 1.0 );
  else { mv = viewMatrix * vec4( aPos.xyz, 1.0 ); mv.xy += q * aPos.w; }
  vec4 cc = projectionMatrix * viewMatrix * vec4( aPos.xyz, 1.0 );
  vCentre = cc.xy / cc.w * 0.5 + 0.5;
  vL = q; vPar = aPar;
  gl_Position = projectionMatrix * mv;
}`;

export const DISTORT_FRAG = /* glsl */`
uniform sampler2D uNoise;
uniform float uTime;
${DEPTH}
varying vec2 vL; varying vec4 vPar; varying vec2 vCentre;
void main() {
  float d = length( vL );
  if ( d > 1.0 ) discard;
  vec2 sp = gl_FragCoord.xy / uRes;
  vec2 dir = sp - vCentre;
  float dl = length( dir );
  dir = dl > 1e-5 ? dir / dl : vec2( 0.0 );
  float mode = vPar.x, k = vPar.y;
  vec2 off;
  if ( mode < 0.5 ) {
    float bq = ( d - 0.82 ) / 0.11;
    float band = exp( -bq * bq );
    off = dir * band * k;
  } else if ( mode < 1.5 ) {
    vec2 nuv = vL * 0.6 + vec2( vPar.w, vPar.w * 1.7 ) + vec2( 0.0, -uTime * 0.35 );
    vec2 g = vec2( texture2D( uNoise, nuv ).r - 0.5, texture2D( uNoise, nuv + 0.43 ).a - 0.5 );
    off = g * 2.0 * k * ( 1.0 - smoothstep( 0.4, 1.0, d ) );
  } else {
    off = -dir * sin( d * 3.14159 ) * ( 1.0 - d ) * k * 2.0;
  }
  off *= vfxSoft( 0.0 );
  gl_FragColor = vec4( off, 0.0, 0.0 );
}`;

/** refraction: the scene colour read through the distortion buffer (+ a hair of dispersion) */
export const REFRACT_FRAG = /* glsl */`
uniform sampler2D inputBuffer;
uniform sampler2D tDist;
varying vec2 vUv;
void main() {
  vec2 off = texture2D( tDist, vUv ).xy;
  float m = length( off );
  vec2 o2 = off * ( 1.0 + clamp( m * 8.0, 0.0, 0.25 ) );
  vec4 c = texture2D( inputBuffer, vUv + off );
  c.r = texture2D( inputBuffer, vUv + o2 ).r;
  gl_FragColor = c;
}`;
export const FULLSCREEN_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4( position.xy, 1.0, 1.0 ); }`;
