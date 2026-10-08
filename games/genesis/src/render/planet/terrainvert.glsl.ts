// GENESIS — terrain vertex displacement (GLSL), shared by the terrain material, its shadow-depth material and the
// water surface (with WATER_SURFACE defined the height is the water level instead of the ground).
//
// ground(p) = radius + S(p) + detail(p)·Σ w_i·rough[c_i] + dune(p)·Σ w_i·duneAmp[c_i]   (== surface.ts groundHeight)
// S(p)      = Σ w_i·surface[c_i] + α·R·Σ w_i·(g_i·p + gw_i)        (== surface.ts curvedSurface, α = CURVE_ALPHA)
// where detail(p) is detailNoise baked per vertex (band-limited for coarse levels), rough[c] = roughOf(...) computed
// per cell on the CPU with the sim's own function (field texture A.y) and (g, gw) the per-cell curvature gradients
// computed on the CPU with the sim's surfaceGradients() (field texture G). Geomorph: see chunks.ts.

import { CURVE_ALPHA } from '../../sim/grid/surface.ts';

export const TERRAIN_VERT_PARS = /* glsl */ `
uniform highp sampler2D uFieldA;
uniform highp sampler2D uFieldN;
uniform highp sampler2D uFieldG;
uniform highp sampler2D uFieldD;
uniform float uRadius;
uniform vec3 uCamBody;
uniform vec4 uMorph;   // x = full-morph distance, y = morph start, z = skirt depth, w = silhouette split boost (ChunkLOD.silK)
#ifdef WATER_SURFACE
uniform highp sampler2D uFieldF;
#endif
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
attribute vec3 aGradD;
attribute vec3 aGradDM;
const float CURVE_ALPHA = ${CURVE_ALPHA.toFixed(6)};
ivec2 tfUV(float c) { int i = int(c + 0.5); return ivec2(i & 255, i >> 8); }
vec4 tfInterp(highp sampler2D t, vec4 cells, float wC) {
  float wB = cells.w;
  float wA = 1.0 - wB - wC;
  return texelFetch(t, tfUV(cells.x), 0) * wA + texelFetch(t, tfUV(cells.y), 0) * wB + texelFetch(t, tfUV(cells.z), 0) * wC;
}
// ground at unit direction dir inside the sim triangle (cells, wB, wC): A = interpolated texel A, N = interpolated
// cell normal, surf = the curved surface S, dA = interpolated dune amplitude, g = the ground (S + detail + dunes),
// h = displaced height (the ground, or the water level for WATER_SURFACE)
void tGround(vec4 cells, float wC, vec3 dir, float detail, float dune, out vec4 A, out vec3 N, out float surf, out float dA, out float g, out float h) {
  float wB = cells.w;
  float wA = 1.0 - wB - wC;
  ivec2 ua = tfUV(cells.x), ub = tfUV(cells.y), uc = tfUV(cells.z);
  vec4 Aa = texelFetch(uFieldA, ua, 0), Ab = texelFetch(uFieldA, ub, 0), Ac = texelFetch(uFieldA, uc, 0);
  A = Aa * wA + Ab * wB + Ac * wC;
  N = (texelFetch(uFieldN, ua, 0) * wA + texelFetch(uFieldN, ub, 0) * wB + texelFetch(uFieldN, uc, 0) * wC).xyz;
  vec4 Ga = texelFetch(uFieldG, ua, 0), Gb = texelFetch(uFieldG, ub, 0), Gc = texelFetch(uFieldG, uc, 0);
  float bend = (dot(Ga.xyz, dir) + Ga.w) * wA + (dot(Gb.xyz, dir) + Gb.w) * wB + (dot(Gc.xyz, dir) + Gc.w) * wC;
  surf = A.x + CURVE_ALPHA * uRadius * bend;
  dA = texelFetch(uFieldD, ua, 0).x * wA + texelFetch(uFieldD, ub, 0).x * wB + texelFetch(uFieldD, uc, 0).x * wC;
  g = surf + detail * A.y + dune * dA;
#ifdef WATER_SURFACE
  h = A.z;
  // Two wet basins at different levels in one sim triangle (a pond above a lake, a lake above the sea): linear
  // interpolation tilts a pane of water from one level to the other, and any per-cell choice of level (nearest cell,
  // lowest flooding cell) stands a wall or a flat polygon of water on the sim triangle's straight edges. Where the water
  // is still, the lower basin instead keeps its own flat level wherever the ground lies below it, and the upper basin's
  // sheet may stand at most 1.5 × (ground − lower level) above the ground: it thins to nothing exactly where the
  // ground meets the lower level, so the two surfaces join at the lower shoreline with no wall and no hanging pane.
  //   h = max(lo, min(linear, g + 1.5 (g − lo)))
  // Every input to the switch is continuous across sim-triangle edges: a cell's say fades with its barycentric weight
  // (it has none on the edge opposite it) and with its depth, the "lowest level" is a soft minimum over those says, and
  // flowing water (cascades) fades the rule out. Shore triangles (one wet cell, dry cells' levels only a construction)
  // never switch it on.
  {
    float pa = smoothstep(0.02, 0.08, Aa.w) * smoothstep(0.0, 0.2, wA);
    float pb = smoothstep(0.02, 0.08, Ab.w) * smoothstep(0.0, 0.2, wB);
    float pc = smoothstep(0.02, 0.08, Ac.w) * smoothstep(0.0, 0.2, wC);
    float pair = max(pa * pb * smoothstep(0.3, 0.7, abs(Aa.z - Ab.z)),
                 max(pb * pc * smoothstep(0.3, 0.7, abs(Ab.z - Ac.z)), pc * pa * smoothstep(0.3, 0.7, abs(Ac.z - Aa.z))));
    if (pair > 0.0) {
      float fa = length(texelFetch(uFieldF, ua, 0).xyz), fb = length(texelFetch(uFieldF, ub, 0).xyz), fc = length(texelFetch(uFieldF, uc, 0).xyz);
      float act = pair * (1.0 - smoothstep(0.2, 0.4, max(fa * pa, max(fb * pb, fc * pc))));
      float lo = h;
      lo = mix(lo, min(lo, Aa.z), pa);
      lo = mix(lo, min(lo, Ab.z), pb);
      lo = mix(lo, min(lo, Ac.z), pc);
      float stepped = max(lo, min(h, g + 1.5 * (g - lo)));
      h = mix(h, stepped, act);
    }
  }
#else
  h = g;
#endif
}
`;

/**
 * defines tPos (body frame, m), tNrm (body frame), tA (interpolated A texel), tS (curved surface S), tH (height above
 * datum: ground, or the water level for WATER_SURFACE), tG (ground height incl. detail and dunes), tDA (dune
 * amplitude), tMorph
 */
export const TERRAIN_VERT_CORE = /* glsl */ `
  vec4 tA; vec3 tN; float tS; float tH; float tDA; float tG;
  tGround(aCells, aMisc.x, position, aMisc.y, aMisc.w, tA, tN, tS, tDA, tG, tH);
  vec3 tPos = position * (uRadius + tH);
  vec3 tNrm = normalize(tN - aGrad * tA.y - aGradD * tDA);
  float tMorph = 0.0;
  if (uMorph.x < 1e20) {
    // the same silhouette-aware distance as the CPU patch selection (chunks.ts SILHOUETTE_SPLIT, silK): edge-on ground
    // keeps its detail further out
    vec3 tv = tPos - uCamBody;
    float tdd = length(tv);
    float tgr = 1.0 - abs(dot(position, tv / max(tdd, 1e-3)));
    float tsil = 1.0 + uMorph.w * tgr * tgr * tgr;
    tMorph = smoothstep(uMorph.y, uMorph.x, tdd / tsil);
    if (tMorph > 0.0) {
      vec4 A1; vec4 A2; vec3 N1; vec3 N2; float s1; float s2; float h1; float h2; float d1; float d2; float g1; float g2;
      tGround(aN1, aN1m.x, aN1d, aN1m.y, aN1m.z, A1, N1, s1, d1, g1, h1);
      tGround(aN2, aN2m.x, aN2d, aN2m.y, aN2m.z, A2, N2, s2, d2, g2, h2);
      vec3 pT = 0.5 * (aN1d * (uRadius + h1) + aN2d * (uRadius + h2));
      vec3 nT = normalize(N1 + N2 - aGradM * (A1.y + A2.y) - aGradDM * (d1 + d2));
      tPos = mix(tPos, pT, tMorph);
      tNrm = normalize(mix(tNrm, nT, tMorph));
      tH = mix(tH, 0.5 * (h1 + h2), tMorph);
      tG = mix(tG, 0.5 * (g1 + g2), tMorph);
    }
  }
#ifndef WATER_SURFACE
  // skirts hang below the ground to hide transient LOD cracks; the water sheet must not get them (they would be
  // vertical curtains of water — straight 'channel walls' — wherever a patch border crosses a river or a lake)
  tPos -= position * (uMorph.z * aMisc.z);
#endif
`;
