// GENESIS — terrain vertex displacement (GLSL), shared by the terrain material, its shadow-depth material and the
// water surface (with WATER_SURFACE defined the height is the water level instead of the ground).
//
// ground(p) = radius + Σ w_i·surface[c_i] + detail(p)·Σ w_i·rough[c_i]      (== src/sim/grid/surface.ts groundHeight)
// where detail(p) is detailNoise baked per vertex (band-limited for coarse levels) and rough[c] = roughOf(...) computed
// per cell on the CPU with the sim's own function. Geomorph: see chunks.ts.

export const TERRAIN_VERT_PARS = /* glsl */ `
uniform highp sampler2D uFieldA;
uniform highp sampler2D uFieldN;
uniform float uRadius;
uniform vec3 uCamBody;
uniform vec4 uMorph;   // x = full-morph distance, y = morph start, z = skirt depth
attribute vec4 aCells;
attribute vec4 aMisc;
attribute vec3 aGrad;
attribute vec4 aN1;
attribute vec4 aN1m;
attribute vec3 aN1d;
attribute vec4 aN2;
attribute vec4 aN2m;
attribute vec3 aN2d;
attribute vec3 aGradM;
ivec2 tfUV(float c) { int i = int(c + 0.5); return ivec2(i & 255, i >> 8); }
vec4 tfInterp(highp sampler2D t, vec4 cells, float wC) {
  float wB = cells.w;
  float wA = 1.0 - wB - wC;
  return texelFetch(t, tfUV(cells.x), 0) * wA + texelFetch(t, tfUV(cells.y), 0) * wB + texelFetch(t, tfUV(cells.z), 0) * wC;
}
void tGround(vec4 cells, float wC, float detail, out vec4 A, out vec3 N, out float h) {
  A = tfInterp(uFieldA, cells, wC);
  N = tfInterp(uFieldN, cells, wC).xyz;
#ifdef WATER_SURFACE
  h = A.z;
#else
  h = A.x + detail * A.y;
#endif
}
`;

/** defines tPos (body frame, m), tNrm (body frame), tA (interpolated A texel), tH (height above datum), tMorph */
export const TERRAIN_VERT_CORE = /* glsl */ `
  vec4 tA; vec3 tN; float tH;
  tGround(aCells, aMisc.x, aMisc.y, tA, tN, tH);
  vec3 tPos = position * (uRadius + tH);
  vec3 tNrm = normalize(tN - aGrad * tA.y);
  float tMorph = 0.0;
  if (uMorph.x < 1e20) {
    tMorph = smoothstep(uMorph.y, uMorph.x, distance(tPos, uCamBody));
    if (tMorph > 0.0) {
      vec4 A1; vec4 A2; vec3 N1; vec3 N2; float h1; float h2;
      tGround(aN1, aN1m.x, aN1m.y, A1, N1, h1);
      tGround(aN2, aN2m.x, aN2m.y, A2, N2, h2);
      vec3 pT = 0.5 * (aN1d * (uRadius + h1) + aN2d * (uRadius + h2));
      vec3 nT = normalize(N1 + N2 - aGradM * (A1.y + A2.y));
      tPos = mix(tPos, pT, tMorph);
      tNrm = normalize(mix(tNrm, nT, tMorph));
      tH = mix(tH, 0.5 * (h1 + h2), tMorph);
    }
  }
  tPos -= position * (uMorph.z * aMisc.z);
`;
