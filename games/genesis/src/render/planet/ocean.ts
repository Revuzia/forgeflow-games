// GENESIS — water surface (CONTRACT.md §15.5) on the same chunk geometry as the terrain.
//
// Height = the water level from the field texture (wet cells: ground + depth; shore cells: the neighbours' level held
// just under their ground, so seas stay flat and the terrain's depth test draws the coastline).
//   * Waves: four Gerstner waves (vertex), amplitude by depth (shallows calm), the local sea state (the sim's surface
//     wind per cell, fieldtex.ts D.yzw: 1 at a 7 m/s breeze; the long waves run with the wind) and LOD spacing (a wave
//     a patch cannot represent fades instead of aliasing), plus fourteen analytic sine ripples (0.17–16 m, the longer
//     ones wind-aligned) in the fragment, flow-mapped along the sim's flow vectors on rivers (two-phase blend, so
//     ripples travel downstream without stretching).
//   * Optics: Fresnel (F0 = 0.02) against the planet's sky radiance LUT, GGX sun glint whose roughness grows with pixel
//     footprint (a broad specular from orbit, sharp sparkles up close), refraction of the opaque scene copy with
//     Beer–Lambert absorption along the in-water view path and in-scattered sun/sky colour (turquoise shallows, deep blue
//     seas), shadows from the cascades and the clouds.
//   * Reflection: screen-space against the opaque depth, reprojected into last frame's composited image, faded where
//     it cannot be found; elsewhere the sky radiance LUT with the CLOUDS reflected (the cloud deck's density along the
//     reflected ray, lit by the sun through the air) — a rough sea's mirror image is lifted toward the zenith and its
//     Fresnel lowered by the slope variance the pixel cannot draw (a dark sea under a bright horizon, not a mirror).
//   * Body colour: absorption plus a turbid in-scatter that grows toward the shore and in the shallows (silt,
//     plankton): coastal water is green-grey and the floor fades within a few metres; the open sea is deep blue.
//   * Foam: surf on the shores of the open sea (scaled by wind and fetch; ponds and oases stay clear), breaking crests
//     (Gerstner phase), whitecaps by wind speed (none under ~4 m/s, scattered at a breeze, a white-streaked sea in a gale,
//     streaks drawn out along the wind), white water only where water really runs (fast flow, cascades, falls).
//   * Ice: where the sim's ice field is thick, an opaque cracked ice sheet replaces open water; it thins out at the
//     waterline like the water does.
//   * Geometry: a thin sheet leaning on a slope is a shore triangle's interpolated level, not water: discarded. Between
//     two wet basins at different levels the level steps under the rim instead of tilting a pane between them.

import { shadeCut } from '../shaders/shadecut.ts';
/** PERF s19 bisection `?wshade=` (shaders/shadecut.ts): nonoise novor fbm1 noshadow all */
const WSHADE = shadeCut('wshade');
import { perfList, perfNum, perfNumEff, perfSwitch, perfSwitchNote } from '../perfswitch.ts';
import { NOISETEX_FN_GLSL, TNOISE_UNIFORMS, WNOISE } from './noisetex.ts';
/**
 * PERF s21 `?waterland=0` = the old behaviour. On (default): a water fragment whose ground stands above the sheet
 * (vDepth = level - ground at this very point of the same patch geometry), or that lies BEHIND the opaque scene by the
 * linear depth copy (this pixel and its four neighbours), is discarded FIRST, before any shading, and the shore blend
 * fades with vDepth too: nothing of a sheet can show over land even where the hardware depth test does not hide it
 * (it stays the exact, per-sample test). Before: only sheets more than 0.6 m under their ground were discarded; the rest relied on the
 * depth test, and where that let them through they drew at up to 70 % (the shore's noise bite) over low ground.
 */
const WATERLAND = perfSwitch('waterland');
/** PERF s21 `?wfast=1` (the default is `wfast=3`, oceanfast.ts; `wfast=0` = this file's reference water): the fragment's simplex noise from the noise volume, the ripples' per-wavelet
 *  constants precomputed, the ripples' shared noises taken once for both flow phases. Same formulas otherwise. */
const WFAST = WNOISE;
/**
 * PERF s21 `?wfast=2` (not the default): the sibling games' method (three's Water.js, pirates-cove): the fine ripples are
 * taps of ONE tiling normal map (made once here from wavelets of the ripples' own steepness law, mips + anisotropy),
 * two scales x two scroll directions, projected along the body axes (1-3 projections by the up vector). The Gerstner
 * and swell normals, depth colour, glint and foam stay; the foam's and the shore bite's noises (still arithmetic: the
 * waterline does not move) run only where their term can be non-zero; the SSR march is 8 steps (x1.9) + the sky.
 */
const WFAST2 = perfNumEff('wfast', 3) === 2;
/** PERF s21 Mac bisection, `?wshade=` (debug, the look changes): nossr nopcf noripple nofoam norefr (+ nonoise ...) */
const WCUT = perfList('wshade');
/** PERF s21 `?wclock=<s>`: the water's clock pinned (probes: pixel-comparable water) */
const WCLOCK = perfNum('wclock');
/** PERF s21 `?wwind=<x>` (probes): the sea-state factor pinned (1 = a breeze, 2.2 = a gale) */
const WWIND = perfNum('wwind');

let ripMap: DataTexture | null = null;
/** the ripple normal map: RG = the height gradient (+0.5) of 16 tiling wavelets, each of slope 0.03, 4-24 waves a tile */
function rippleMap(): DataTexture {
  if (ripMap) return ripMap;
  const N = 256, C = 16, data = new Uint8Array(N * N * 4);
  const cs: number[][] = [];
  for (let j = 0; j < C; j++) {
    const a = j * 2.399963, k = 4 * Math.pow(6, j / (C - 1));
    let m = Math.round(k * Math.cos(a)), n = Math.round(k * Math.sin(a));
    if (m === 0 && n === 0) m = 4;
    const l = Math.hypot(m, n);
    cs.push([m, n, j * 1.7, 0.03 * m / l, 0.03 * n / l]);
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let gx = 0, gy = 0;
    for (const c of cs) { const sn = Math.sin(6.2831853 * (c[0] * x + c[1] * y) / N + c[2]); gx -= c[3] * sn; gy -= c[4] * sn; }
    const o = (y * N + x) * 4;
    data[o] = Math.max(0, Math.min(255, Math.round((gx + 0.5) * 255)));
    data[o + 1] = Math.max(0, Math.min(255, Math.round((gy + 0.5) * 255)));
    data[o + 3] = 255;
  }
  const t = new DataTexture(data, N, N, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.name = 'water-ripples'; t.needsUpdate = true;
  return (ripMap = t);
}
/** PERF s21 debug `?wdebug=class,nodepth`: class = flat colour by vDepth class (red: ground above the sheet by more
 *  than 8 cm, yellow: by less, green: draped film, blue: water); nodepth = the water passes the depth test everywhere (it still writes depth): what a failing test would show */
const WDEBUG = perfList('wdebug');
/**
 * PERF s23 Mac isolation switches for the water pass (all default = the current picture and cost):
 * `?wfrag=0`  the fragment ends right after the land discards with a constant colour (depth write + discards kept);
 * `?wdepth=0` no gl_FragDepth write (log depth chunks left out) and no discard at all: the water is plain opaque
 *             geometry (its depth is then the rasterised one: the conservative-depth bound with zcons, so it tests a
 *             few cm nearer than the log depth; WITHOUT zcons the depth test is wrong — timing only);
 * `?wvert=0`  flat vertex stage: no Gerstner displacement and none of its 4 vertex simplex (the fragment's normals stay);
 * `?wcopy=0` / `?wsingle=1` (renderer.ts) imply NOSCENE here: the water reads neither the colour nor the depth copy
 *             (refraction = the `norefr` constant, no SSR, no waterland depth taps) — so compare them with
 *             `wshade=norefr,nossr`, not with the base.
 * `?wdebug=wet` (problem 3, the sheet over the hills): magenta = no wet sim cell under this sheet at all (the level
 *             is the dry cells' extrapolated construction: ghost water), orange = wet cells, but the sim's water there
 *             is a film under 10 cm (rain / damp ground), blue = real water.
 * `?wghost=1` drop ghost water (magenta of wdebug=wet): fragments whose sim triangle holds less than 1 % of a wet cell.
 */
const WFRAG = perfSwitch('wfrag');
const WDEPTH = perfSwitch('wdepth');
const WVERT = perfSwitch('wvert');
const NOSCENE = !perfSwitch('wcopy') || perfSwitch('wsingle', false);
const WGHOST = perfSwitch('wghost', false);
const NOREFR = WCUT.has('norefr') || NOSCENE;
const NOSSR = WCUT.has('nossr') || NOSCENE;
const WET_ON = WGHOST || WDEBUG.has('wet');

// the 14 ripple wavelets' constants (WFAST): what ripples() derives per fragment and per wavelet from its index
const f32 = Math.fround;
const sst = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const RP = Array.from({ length: 14 }, (_, i) => {
  const s = [Math.sin(f32(i * 12.9898)), Math.cos(f32(i * 78.233)), Math.sin(f32(i * 37.719 + 1.3))];
  const l = Math.hypot(s[0], s[1], s[2]);
  const L = 0.17 * Math.pow(1.42, i), k = 6.2831853 / L;
  const fr = (x: number): number => x - Math.floor(x);
  return {
    D: s.map((v) => v / l), L, k, w: Math.sqrt(9.8 * k), ph: i * 1.7, share: (0.6 + 0.4 * fr(i * 0.618)) * Math.min(1, k * 0.8),
    gc: Math.cos(i * 1.9), gs: Math.sin(i * 1.9), cap: sst(2.0, 0.3, L), feedK: sst(0.5, 6.0, L),
  };
});
const fl = (v: number): string => { const t = v.toPrecision(9); return /[.e]/.test(t) ? t : t + '.0'; };
const RIPPLE_CONSTS = /* glsl */ `
const vec4 RP_D[14] = vec4[14](${RP.map((r) => `vec4(${r.D.map(fl).join(', ')}, ${fl(r.L)})`).join(', ')});
const vec4 RP_K[14] = vec4[14](${RP.map((r) => `vec4(${fl(r.k)}, ${fl(r.w)}, ${fl(r.ph)}, ${fl(r.share)})`).join(', ')});
const vec4 RP_G[14] = vec4[14](${RP.map((r) => `vec4(${fl(r.gc)}, ${fl(r.gs)}, ${fl(r.cap)}, ${fl(r.feedK)})`).join(', ')});
`;
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, Matrix4, RGBAFormat, RepeatWrapping, ShaderMaterial, UnsignedByteType, Vector2, Vector4, type IUniform } from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { CLOUD_DENSITY_GLSL } from '../sky/clouds.ts';
import { SHADOW_GLSL } from './lights.ts';
import { TERRAIN_VERT_CORE, TERRAIN_VERT_PARS } from './terrainvert.glsl.ts';
import { VDIAG_CORE, WFAST3, WVDIAG, fastOceanShaders } from './oceanfast.ts'; // PERF s25 hook (wfast=3, wvdiag)

const WAVES_GLSL = /* glsl */ `
// four Gerstner waves: (dir seed xyz, wavelength m), amplitude factor, steepness
const vec4 GW_D[4] = vec4[4](vec4(0.82, 0.11, 0.56, 21.0), vec4(-0.31, 0.27, 0.91, 13.0), vec4(0.55, -0.48, -0.68, 8.5), vec4(-0.77, 0.6, 0.2, 5.3));
const float GW_A[4] = float[4](0.27, 0.2, 0.14, 0.09);
// A wave over the sphere has a FIXED 3D direction D: its phase is k·(P·D) and its local direction of travel the
// tangent projection D_t = D − up (D·up) (|D_t| ≤ 1: near the two points where D is vertical the wave flattens out).
// (Each pixel projecting its own direction onto its own tangent plane made P·d ≡ 0 — no wave anywhere, only a uniform
// tilt rocking in time: the glassy gel.) The wind cannot turn a fixed direction, so it FEEDS the waves instead: those
// running with it carry more, those against it less (windT: the tangent wind direction scaled by how settled it is)
vec3 waveTan(vec3 D, vec3 up) { return D - up * dot(D, up); }
float windFeed(vec3 dT, vec3 windT, float k) {
  float ws = length(windT);
  if (ws < 1e-3) return 1.0;
  float al = dot(dT, windT / ws) / max(length(dT), 1e-4);
  return mix(1.0, 0.72 + 0.85 * max(al, 0.0) * max(al, 0.0), ws * k);
}
// The long waves' crests WANDER and come in GROUPS, in the geometry and the shading alike: four pure sinusoids kept
// dead-straight crests hundreds of metres long, each catching the sun or mirroring the sky as a parallel line — brushed
// metal at 40–300 m. A slow warp of every wave's phase (its own share) and an amplitude that swells and fades in
// patches, from two noises evaluated where the wave is (the vertex's rest position, the pixel's point: the same field)
// (WFAST: taps of the noise volume at FIXED sites, so the vertex and the fragment shader read the same field)
${WFAST ? '#define GW_N(p, s) snoiseT(p, s)' : '#define GW_N(p, s) snoise(p)'}
float gwWarpAt(vec3 P, float t) { return GW_N(P * 0.021 + vec3(0.0, t * 0.01, 0.0), 0) * 2.2 + GW_N(P * 0.067 + 3.0, 1) * 0.8; }
vec2 gwGroupAt(vec3 P, float t) { return vec2(GW_N(P * 0.035 + vec3(t * 0.02, 0.0, 0.0), 2), GW_N(P * 0.09 + 11.0, 3)); }
float gwGroup(vec2 g, int i) { return clamp(0.6 + 0.6 * (g.x * cos(float(i) * 2.3) + g.y * sin(float(i) * 2.3)), 0.15, 1.4); }
float gwPhase(float w, int i) { return w * (0.7 + 0.3 * fract(float(i) * 0.618)); }
// sea state from the local wind (m/s): 1 at a 7 m/s breeze, calm ~0.3, a gale ~2.2
float seaState(vec3 wind) { return clamp(length(wind) / 7.0, 0.3, 2.2); }
vec3 windTan(vec3 wind, vec3 up) {
  vec3 w = wind - up * dot(wind, up);
  float l = length(w);
  return l > 0.5 ? w / l * smoothstep(0.5, 3.0, l) : vec3(0.0);
}
`;

const OCEAN_VERT = /* glsl */ `
#define WATER_SURFACE
#include <common>
${TERRAIN_VERT_PARS}
uniform highp sampler2D uFieldM1;
uniform highp sampler2D uFieldC;
uniform highp sampler2D uFieldW;
uniform float uTime;
uniform float uWind;
uniform vec4 uTide;
${NOISE_GLSL}
${WFAST ? NOISETEX_FN_GLSL : ''}
${WAVES_GLSL}
varying vec3 vBodyPos;
varying vec3 vViewPos;
varying float vDepth;
varying vec3 vFlow;
varying float vIce;
varying float vTemp;
varying float vCrest;
varying float vSalt;
varying vec3 vWind;
varying vec4 vSurge;
varying float vBedCos;
varying float vSimD;
${WET_ON ? 'varying float vWet;\nvarying float vWetD;' : ''}
#include <logdepthbuf_pars_vertex>
void main() {
${TERRAIN_VERT_CORE}
  // the curved ground of surface.ts (tG), so the shoreline is where the water plane meets the same ground the
  // terrain draws: contours, never the straight edges of 50 m sim triangles
  // (the sheet's own thickness over the ground it is drawn on: the level the vertex core settled on — a cascade's film,
  // a basin's step — not the cells' linear level, which over a cliff stands metres above that film)
  float depth = tH - tG;
  // shallows the sim floods (0.15 m and more over its own ground, tS) where the ground's metre-scale detail relief stands
  // at or above the level: the sheet drapes over those bumps as a thin film (18 cm) instead of vanishing under them — a
  // harbour's 0.2-0.8 m margin drew as grass 25 m out from the pier the sim floods. Deep water and the dry cells' levels
  // (under their ground) are left alone
  vSimD = tH - tS;
  ${WET_ON ? '{' : '/*'}
    // (PERF s23 wdebug=wet / wghost) the barycentric say of WET cells (fieldpack WET = 0.02 m) in this vertex's sim
    // triangle: 0 on every edge between two dry cells and all over a triangle of three dry cells (continuous across
    // sim-triangle edges: a cell has no weight on the edge opposite it), and the sim's own water depth there
    float wB = aCells.w, wC = aMisc.x, wA = 1.0 - wB - wC;
    float da = texelFetch(uFieldA, tfUV(aCells.x), 0).w, db = texelFetch(uFieldA, tfUV(aCells.y), 0).w, dc = texelFetch(uFieldA, tfUV(aCells.z), 0).w;
    vWet = wA * step(0.02, da) + wB * step(0.02, db) + wC * step(0.02, dc);
    vWetD = wA * da + wB * db + wC * dc;
  ${WET_ON ? '}' : '*/'}
  {
    float drape = smoothstep(0.1, 0.25, vSimD) * (1.0 - smoothstep(1.5, 3.0, vSimD));
    float lift = max(0.0, tG + 0.18 - tH) * drape;
    tPos += normalize(position) * lift;
    depth += lift;
  }
  vec3 up = normalize(tPos);
  vec4 F = tfInterp(uFieldF, aCells, aMisc.x);
  vec4 M1 = tfInterp(uFieldM1, aCells, aMisc.x);
  vec4 C = tfInterp(uFieldC, aCells, aMisc.x);
  vFlow = F.xyz;
  vSalt = F.w;
  vIce = M1.z;
  vTemp = C.x;
  vWind = tfInterp(uFieldD, aCells, aMisc.x).yzw;
  // (a falling moon heaps the tides into the sea: rougher water as it nears — render/fx/worlds.ts uTide)
  float sea = uWind * seaState(vWind) * (1.0 + 0.12 * uTide.w);
  vec3 wT = windTan(vWind, up);
  // Gerstner displacement: calm in shallows, rivers and ice; faded where the LOD spacing cannot carry the wave
  float flowSpd = length(F.xyz);
  float calm = smoothstep(0.3, 4.0, depth) * (1.0 - smoothstep(0.4, 1.2, flowSpd)) * (1.0 - smoothstep(0.05, 0.4, M1.z));
  vec3 disp = vec3(0.0);
  float crest = 0.0;
  float gwW = ${WVERT ? 'gwWarpAt(tPos, uTime)' : '0.0'};
  vec2 gwG = ${WVERT ? 'gwGroupAt(tPos, uTime)' : 'vec2(0.0)'};
  for (int i = 0; i < ${WVERT ? 4 : 0}; i++) {
    float L = GW_D[i].w;
    // fade by camera distance (not by LOD level): both sides of a patch edge displace identically, no cracks
    float amp = GW_A[i] * sea * calm * (1.0 - smoothstep(L * 5.0, L * 11.0, distance(tPos, uCamBody)));
    if (amp <= 0.0) continue;
    vec3 D = normalize(GW_D[i].xyz);
    vec3 d = waveTan(D, up);
    amp *= windFeed(d, wT, i < 2 ? 1.0 : 0.5) * smoothstep(0.15, 0.45, length(d)) * gwGroup(gwG, i);
    float k = 6.2831853 / L;
    float c = sqrt(9.8 / k);
    float ph = k * dot(tPos, D) - c * k * uTime + gwPhase(gwW, i);
    float Q = 0.55;
    disp += d * (Q * amp * cos(ph)) + up * (amp * sin(ph));
    crest += amp * max(sin(ph), 0.0);
  }
  vCrest = crest / max(sea * 0.7, 0.05);
  // the water level's own slope per cell, before the waves ride on it (fieldtex.ts W: x = its excess over the bed's,
  // yzw = its gradient): the sim's moving volume — a surge, a tsunami. Interpolated from the cells, so it is
  // continuous across the 50 m sim triangles (the level itself is linear over each: its screen slope jumps per triangle)
  vSurge = tfInterp(uFieldW, aCells, aMisc.x);
  // the bed's own slope (cos to the vertical): a sheet leaning with its bed is a cascade, not a surge
  vBedCos = dot(normalize(tN), up);
  tPos += disp;
  // the tidal bulge under (and opposite) a near moon: the equilibrium tide's shape (3cos²θ − 1) / 2, held off the
  // shores so the water's edge stays on the ground (render/fx/worlds.ts sets uTide while a moon falls)
  if (uTide.w > 0.0) {
    float ct = dot(up, uTide.xyz);
    tPos += up * uTide.w * (1.5 * ct * ct - 0.5) * smoothstep(0.5, 8.0, depth);
  }
  vDepth = depth + disp.y * 0.0;
  vBodyPos = tPos;
  vec4 mv = modelViewMatrix * vec4(tPos, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;

const RIPPLES_REF = /* glsl */ `
vec3 ripples(vec3 P, vec3 up, float fw, vec3 offset, float t) {
  vec3 g = vec3(0.0);
  // the crests wander: a slow, broad warp of every wavelet's phase (each by its own share) — pure sinusoids summed into
  // long straight crest lines that crossed in a regular plaid, woven linen in the mirrored sky
  float warp = snoise(P * 0.045 + vec3(0.0, t * 0.02, 0.0)) * 2.4 + snoise(P * 0.13 + 7.0) * 0.9;
  // ... and come in groups: each wavelet's amplitude swells and fades in patches (gusts, cat's paws), its own mix of two
  // drifting noises — equal amplitude everywhere, the crossing families read as a regular woven plaid
  float gA = snoise(P * 0.09 + vec3(t * 0.05, 0.0, -t * 0.03)), gB = snoise(P * 0.23 + vec3(3.0, t * 0.07, 1.0));
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    vec3 seed = vec3(sin(fi * 12.9898), cos(fi * 78.233), sin(fi * 37.719 + 1.3));
    float L = 0.17 * pow(1.42, fi);           // 0.17 m .. ~16 m
    // the longer wavelets run with the wind, capillaries go every way
    vec3 D = normalize(seed);
    vec3 d = waveTan(D, up);
    float k = 6.2831853 / L;
    // capillaries depend most on the wind (a calm sea is glassy, a breeze roughens it at once)
    float grp = clamp(0.55 + 0.75 * (gA * cos(fi * 1.9) + gB * sin(fi * 1.9)), 0.08, 1.35);
    float amp = L * 0.012 * uWind * mix(gSea, gSea * gSea, smoothstep(2.0, 0.3, L)) * windFeed(d, gWindT, smoothstep(0.5, 6.0, L)) * grp;
    // (gone by ~3 pixels per wavelength: drawn down to 2 px, the crossing ripple families wove a linen moiré into the
    // mirrored sky and treeline)
    float aa = 1.0 - smoothstep(0.1, 0.33, fwWave(D, up) / L);
    gUnresolved += (amp * k) * (amp * k) * 0.5 * (1.0 - aa);
    gResolved += (amp * k) * (amp * k) * 0.5 * aa;
    if (aa <= 0.0) continue;
    float w = sqrt(9.8 * k);
    float ph = k * dot(P - offset, D) - w * t + fi * 1.7 + warp * (0.6 + 0.4 * fract(fi * 0.618)) * min(1.0, k * 0.8);
    g += d * (amp * k * cos(ph) * aa);
  }
  return g;
}
`;
const RIPPLES_FAST = /* glsl */ `
float gRW = 0.0, gRA = 0.0, gRB = 0.0;
// (WFAST) the three noises every ripples() call shares (they do not depend on the flow offset): taken once in main
void rippleNoise(vec3 P, float t) {
  gRW = snoise(P * 0.045 + vec3(0.0, t * 0.02, 0.0)) * 2.4 + snoise(P * 0.13 + 7.0) * 0.9;
  gRA = snoise(P * 0.09 + vec3(t * 0.05, 0.0, -t * 0.03));
  gRB = snoise(P * 0.23 + vec3(3.0, t * 0.07, 1.0));
}
// (WFAST) the same sum as the reference ripples() below in ocean.ts, its per-wavelet constants from RP_D / RP_K / RP_G
vec3 ripples(vec3 P, vec3 up, float fw, vec3 offset, float t) {
  vec3 g = vec3(0.0);
  float sea2 = gSea * gSea;
  for (int i = 0; i < 14; i++) {
    vec3 D = RP_D[i].xyz;
    float L = RP_D[i].w;
    vec3 d = waveTan(D, up);
    float k = RP_K[i].x;
    float grp = clamp(0.55 + 0.75 * (gRA * RP_G[i].x + gRB * RP_G[i].y), 0.08, 1.35);
    float amp = L * 0.012 * uWind * mix(gSea, sea2, RP_G[i].z) * windFeed(d, gWindT, RP_G[i].w) * grp;
    float aa = 1.0 - smoothstep(0.1, 0.33, fwWave(D, up) / L);
    float e = (amp * k) * (amp * k) * 0.5;
    gUnresolved += e * (1.0 - aa);
    gResolved += e * aa;
    if (aa <= 0.0) continue;
    float ph = k * dot(P - offset, D) - RP_K[i].y * t + RP_K[i].z + gRW * RP_K[i].w;
    g += d * (amp * k * cos(ph) * aa);
  }
  return g;
}
`;

const RIPPLES_MAP = /* glsl */ `
uniform sampler2D uRipMap;
vec2 gNG = vec2(0.0);
// one projection: tile A 5.3 m and 3.9 m (wavelets 0.16-1.3 m), tile B 37 m and 29 m (1.2-9 m); the second of each is
// turned a quarter and scrolls another way, so the sum never repeats in step
vec2 ripTap(vec2 q, vec2 dx, vec2 dy, float t, float kA, float kB) {
  vec2 g = (textureGrad(uRipMap, q / 5.3 + vec2(0.11, 0.07) * t, dx / 5.3, dy / 5.3).rg - 0.5) * kA;
  vec2 r = textureGrad(uRipMap, vec2(q.y, -q.x) / 3.9 + vec2(-0.09, 0.13) * t, vec2(dx.y, -dx.x) / 3.9, vec2(dy.y, -dy.x) / 3.9).rg - 0.5;
  g += vec2(-r.y, r.x) * kA;
  g += (textureGrad(uRipMap, q / 37.0 + vec2(-0.05, 0.04) * t, dx / 37.0, dy / 37.0).rg - 0.5) * kB;
  r = textureGrad(uRipMap, vec2(q.y, -q.x) / 29.0 + vec2(0.06, 0.03) * t, vec2(dx.y, -dx.x) / 29.0, vec2(dy.y, -dy.x) / 29.0).rg - 0.5;
  g += vec2(-r.y, r.x) * kB;
  return g;
}
vec3 ripples(vec3 P, vec3 up, float fw, vec3 offset, float t) {
  vec3 Q = P - offset;
  vec3 w = pow(abs(up), vec3(6.0));
  w /= w.x + w.y + w.z;
  // capillaries depend most on the wind; both swell and fade in patches with the long waves' group noise
  float kA = 1.15 * uWind * mix(gSea, gSea * gSea, 0.6) * clamp(0.6 + 0.5 * gNG.y, 0.2, 1.3);
  float kB = 1.15 * uWind * gSea * clamp(0.6 + 0.5 * gNG.x, 0.2, 1.3);
  // the slope variance the mips filtered away (the glint and the mirror widen by it), by the footprint the anisotropic
  // filter works with
  float lx = length(gdPx), ly = length(gdPy);
  float fwE = max(min(lx, ly), max(lx, ly) / 8.0);
  float fA = clamp(log2(max(fwE * 48.0, 1e-4)) / 4.0, 0.0, 1.0);
  float fB = clamp(log2(max(fwE * 6.9, 1e-4)) / 4.0, 0.0, 1.0);
  float vA = 0.0145 * kA * kA, vB = 0.0145 * kB * kB;
  gUnresolved += vA * fA + vB * fB;
  gResolved += vA * (1.0 - fA) + vB * (1.0 - fB);
  vec3 g = vec3(0.0);
  vec2 r;
  if (w.x > 0.02) { r = ripTap(Q.yz, gdPx.yz, gdPy.yz, t, kA, kB); g += w.x * vec3(0.0, r); }
  if (w.y > 0.02) { r = ripTap(Q.zx, gdPx.zx, gdPy.zx, t, kA, kB); g += w.y * vec3(r.y, 0.0, r.x); }
  if (w.z > 0.02) { r = ripTap(Q.xy, gdPx.xy, gdPy.xy, t, kA, kB); g += w.z * vec3(r, 0.0); }
  return g - up * dot(g, up);
}
`;
const RIPPLES_NONE = 'vec3 ripples(vec3 P, vec3 up, float fw, vec3 offset, float t) { return vec3(0.0); }';
const NOFOAM = WCUT.has('nofoam');
// where a foam / shore noise can matter at all (WFAST2: its term is exactly zero elsewhere); default: everywhere
const GATES = /* glsl */ `
#define W_SHORE_ON ${NOFOAM ? 'false' : WFAST2 ? '(waveE > 0.0 && level > 0.0 && fw < 2.0 && vertThick < 1.4)' : 'true'}
#define W_SURGE_ON ${NOFOAM ? 'false' : WFAST2 ? '(vSurge.x > 0.0)' : 'true'}
#define W_CAP_ON ${NOFOAM ? 'false' : WFAST2 ? '(cover > 0.001 && vSalt > 0.3 && vDepth > 2.0 && calm > 0.0)' : 'true'}
#define W_GALE_ON ${NOFOAM ? 'false' : WFAST2 ? '(windSpd * uWind > 9.0 && vSalt > 0.3 && calm > 0.0)' : 'true'}
#define W_EDGE_ON ${WFAST2 ? '(vertThick < 1.6 && vSimD < 0.25)' : 'true'}
${WCUT.has('nopcf') && !WSHADE.has('noshadow') ? '#define sunShadow(a, b) 1.0' : ''}
`;
const SSR_N = WFAST2 ? 8 : 28, SSR_G = WFAST2 ? '1.9' : '1.35', SSR_TH = WFAST2 ? '0.66' : '0.36';

const OCEAN_FRAG = /* glsl */ `
#include <common>
${NOISE_GLSL}
${ATMO_PARS}
${SKY_LOOKUP}
${CLOUD_DENSITY_GLSL}
${SHADOW_GLSL}
${WSHADE.glsl}
${WFAST ? NOISETEX_FN_GLSL : ''}
${WAVES_GLSL}
${WFAST && !WSHADE.has('nonoise') ? '#define snoise(p) snoiseT(p, __LINE__)' : ''}
${WFAST ? RIPPLE_CONSTS : ''}
${GATES}
${WDEPTH ? '#include <logdepthbuf_pars_fragment>' : ''}
uniform mat3 uBodyToView;
uniform vec3 uSunDirBody;
uniform vec3 uSunDirView;
uniform float uTime;
uniform float uWind;
uniform sampler2D tSceneColor;
uniform sampler2D tSceneDepth;
uniform sampler2D tPrevColor;
// (PERF s15 cut #5: the previous frame is sampled in its atmosphere target, not a sanitised copy: the copy's NaN / Inf
// guard, per tap)
vec3 prevTap(vec2 uv) { vec3 c = texture(tPrevColor, uv).rgb; return (any(isnan(c)) || any(isinf(c)) || !(dot(c, c) < 1e18)) ? vec3(0.0) : c; }
uniform float uPrevValid;
uniform mat4 uProj;
uniform vec2 uResolution;
uniform samplerCube uCloudCov;
uniform vec2 uCloudShell;
uniform float uCloudOn;
uniform float uKind;
uniform float uRadius;
uniform float uFrame;
uniform mat4 uViewToPrevClip;
uniform vec3 uMoonE;
uniform vec3 uMoonDirBody;
uniform vec3 uNightAmbient;  // the night floor (starlight, airglow; renderer.ts), the terrain's own
uniform sampler2D uOverlay;  // (UI lane, additive) the map overlay, shared with the terrain (planet uniforms)
uniform vec3 uOverlayK;
uniform vec4 uSilt[4];       // ARC §10: silt zones (body-frame centre m, radius m; w = 0 empty) — planet/silt.ts
uniform float uSiltK[4];
varying vec3 vBodyPos;
varying vec3 vViewPos;
varying float vDepth;
varying vec3 vFlow;
varying float vIce;
varying float vTemp;
varying float vCrest;
varying float vSalt;
varying vec3 vWind;
varying vec4 vSurge;
varying float vBedCos;
varying float vSimD;
${WET_ON ? 'varying float vWet;\nvarying float vWetD;' : ''}
float gSea = 1.0;
vec3 gWindT = vec3(0.0);
// the pixel's footprint ALONG a wave's direction d: at a grazing view the footprint is metres long toward the horizon
// but centimetres across it, so waves running across the line of sight stay drawn there (an isotropic footprint faded
// every wave near the horizon and left the sea beyond ~50 m a flat, glassy gel)
vec3 gdPx = vec3(0.0), gdPy = vec3(0.0);
float fwAlong(vec3 d) { return abs(dot(gdPx, d)) + abs(dot(gdPy, d)); }
// ... but never less than a third of the footprint ALONG ITS CRESTS: a wave kept while the pixel is smeared over metres
// of its crest (a grazing view across it) survives as long parallel streaks toward the horizon — brushed metal, a vinyl
// record, pinstripes over the night sea. The anisotropy is capped at 3:1, like a texture's anisotropic filter
float fwWave(vec3 D, vec3 up) {
  vec3 d = D - up * dot(D, up);
  float dl = length(d);
  float along = fwAlong(D);
  if (dl < 1e-4) return along;
  vec3 c = cross(up, d / dl);
  return max(along, (abs(dot(gdPx, c)) + abs(dot(gdPy, c))) / 3.0);
}

float cloudShadowW(vec3 P, vec3 sunB) {
  if (uCloudOn < 0.5) return 1.0;
  float mid = 0.5 * (uCloudShell.x + uCloudShell.y);
  vec2 hit = raySphere(P, sunB, mid);
  if (hit.y < 0.0) return 1.0;
  vec3 q = P + sunB * hit.y;
  vec2 cs = texture(uCloudCov, normalize(q)).rg;
  float dens = cloudDensityAt(q, 0.35, cs.x, cs.y, false);
  return max(exp(-dens * (uCloudShell.y - uCloudShell.x) * 0.4), 0.3);
}

// twelve analytic ripples: returns the surface gradient (tangent, body frame) for a given phase offset along the flow
// the slope variance of the wave octaves too small for this pixel to draw (they are not lost: the sun glitter
// widens by them, see the GGX roughness below)
float gUnresolved = 0.0;
// ... and of the ripple octaves it does draw (LEAN: folded into the roughness wherever the reflection looks up the
// long waves' normal only)
float gResolved = 0.0;
${WCUT.has('noripple') ? RIPPLES_NONE : WFAST2 ? RIPPLES_MAP : WFAST ? RIPPLES_FAST : RIPPLES_REF}
// Screen-space reflection against the opaque depth, coloured from the previous frame's composited image (sky, clouds
// and aerial perspective included) REPROJECTED to where that frame saw the hit point (uViewToPrevClip: this frame's
// view space → the planet's body frame → last frame's clip space), so reflections neither lag nor swim while the
// camera moves. The march starts at a per-pixel jittered distance (no stair-step banding), its thickness grows with
// the step, and a miss returns no confidence: the caller's sky radiance is then the one and only sky source.
// Returns rgb + confidence.
vec4 ssr(vec3 posV, vec3 rV, vec3 nV) {
  if (uPrevValid < 0.5${NOSSR ? ' || true' : ''}) return vec4(0.0);
  // rays turning back toward the camera cannot be found on screen: fade them out (no hard cut line on the sea)
  float facing = 1.0 - smoothstep(0.05, 0.3, rV.z);
  if (facing <= 0.0) return vec4(0.0);
  // (a SPATIALLY SMOOTH offset of the march start, a metre-scale noise on the water: with no temporal accumulation a
  // per-pixel jitter made every ray that grazes a thin object hit in one pixel and miss in the next — a stipple of
  // specks, ponds as TV static — while none at all stair-steps the reflections into bands)
  float t = (2.0 + 0.01 * length(posV)) * (1.0 + 0.12 * ${WFAST2 ? '0.5 * (sin(vBodyPos.x * 0.9 + vBodyPos.y * 0.4) + sin(vBodyPos.z * 0.8 + vBodyPos.y * 0.7))' : 'snoise(vBodyPos * 0.7)'});
  float prz = -posV.z;
  for (int i = 0; i < ${SSR_N}; i++) {
    vec3 q = posV + rV * t;
    vec4 c = uProj * vec4(q, 1.0);
    if (c.w <= 0.0) break;
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float sz = texture(tSceneDepth, uv).r;
    float rz = -q.z;
    // a hit is a CROSSING: the surface's depth lies between this sample's and the previous one's (with a thickness
    // that grows with the step). A ray that merely passes far behind a thin object (a tree) is not a hit — accepting
    // those smeared every treeline down the water in vertical streaks
    if (sz < 1e8 && rz > sz && sz > prz - (0.5 + 0.02 * sz) && rz < sz + max(1.0, t * ${SSR_TH})) {
      // refine between the last two samples
      float t0 = t / ${SSR_G}, t1 = t;
      vec3 qh = q;
      for (int k = 0; k < 8; k++) {
        float tm = 0.5 * (t0 + t1);
        vec3 qm = posV + rV * tm;
        vec4 cm = uProj * vec4(qm, 1.0);
        vec2 um = cm.xy / cm.w * 0.5 + 0.5;
        if (-qm.z > texture(tSceneDepth, um).r) { t1 = tm; qh = qm; } else t0 = tm;
      }
      // where the previous frame saw this point
      vec4 pc = uViewToPrevClip * vec4(qh, 1.0);
      if (pc.w <= 0.0) return vec4(0.0);
      vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
      vec2 e = smoothstep(vec2(0.0), vec2(0.08), puv) * smoothstep(vec2(1.0), vec2(0.92), puv);
      // ripples and roughness blur what the water reflects: three taps across the surface's own tilt
      vec2 px = 1.0 / uResolution;
      vec2 sp = nV.xy * px * 6.0;
      vec3 rc = (prevTap(puv) * 2.0 + prevTap(puv + sp) + prevTap(puv - sp)) * 0.25;
      float far = 1.0 - smoothstep(0.3, 0.8, t1 / 400.0);
      return vec4(rc, e.x * e.y * facing * far);
    }
    prz = rz;
    t *= ${SSR_G};
  }
  return vec4(0.0);
}

void main() {
  ${WDEPTH ? '#include <logdepthbuf_fragment>' : ''}
  ${WGHOST && WDEPTH ? 'if (vWet < 0.01) { discard; return; }' : ''}
  ${!WDEPTH ? '' : WATERLAND ? `// the ground stands above the sheet here (by more than 8 cm and the depth's change over the pixel, so a
  // shoreline pixel keeps every sample the depth test gives it): not water, nothing to shade
  float landCut = max(-0.6, -0.08 - 1.5 * fwidth(vDepth));
  if (vDepth < landCut) { discard; return; }
  // ... and the opaque scene stands in front of the sheet here (the linear depth copy the refraction reads anyway; a
  // margin of 5 cm + 0.4 %): hidden water, nothing to shade. Only where the four neighbouring pixels agree, so the
  // one-pixel rim round an occluder is still left to the per-sample depth test (its anti-aliased edge)
  ${NOSCENE ? '/*' : '{'}
    vec2 wuv = gl_FragCoord.xy / uResolution, wpx = 1.0 / uResolution;
    float wz = -vViewPos.z * 0.996 - 0.05;
    if (texture(tSceneDepth, wuv).r < wz) {
      float zn = max(max(texture(tSceneDepth, wuv + vec2(wpx.x, 0.0)).r, texture(tSceneDepth, wuv - vec2(wpx.x, 0.0)).r),
                     max(texture(tSceneDepth, wuv + vec2(0.0, wpx.y)).r, texture(tSceneDepth, wuv - vec2(0.0, wpx.y)).r));
      if (zn < wz) { discard; return; }
    }
  ${NOSCENE ? '*/' : '}'}` : 'if (vDepth < -0.6) discard;'}
  ${!WFRAG ? 'gl_FragColor = vec4(0.02, 0.05, 0.07, 1.0); return;' : ''}
  ${WDEBUG.has('hb') ? `{
    // (PERF s23 probe) the ground under the sheet in bands: red < -10 m, orange -10..-2, yellow -2..0, green 0..5, cyan 5..20,
    // blue > 20 m above the datum; full brightness where the sheet is at sea level (|level| < 1.5 m), 40 % elsewhere
    float lev = length(vBodyPos) - uRadius, gr = lev - vDepth;
    vec3 dc = gr < -10.0 ? vec3(1.0, 0.0, 0.0) : gr < -2.0 ? vec3(1.0, 0.5, 0.0) : gr < 0.0 ? vec3(1.0, 1.0, 0.0) : gr < 5.0 ? vec3(0.0, 1.0, 0.0) : gr < 20.0 ? vec3(0.0, 1.0, 1.0) : vec3(0.0, 0.0, 1.0);
    gl_FragColor = vec4(dc * (abs(lev) < 1.5 ? 1.0 : 0.4), 1.0); return;
  }` : ''}
  ${WDEBUG.has('hgt') ? `{
    // (PERF s23 probe) R = sheet height above the datum / 250 m, G = vDepth / 25 m (+0.5), B = vSimD / 25 m (+0.5)
    gl_FragColor = vec4(clamp(vec3((length(vBodyPos) - uRadius) / 250.0, 0.5 + vDepth / 25.0, 0.5 + vSimD / 25.0), 0.0, 1.0), 1.0); return;
  }` : ''}
  ${WDEBUG.has('wet') ? `{
    vec3 dc = vWet < 0.01 ? vec3(1.0, 0.0, 1.0) : vWetD < 0.1 ? vec3(1.0, 0.5, 0.0) : vec3(0.0, 0.0, 1.0);
    if (vDepth < 0.0) dc *= 0.35;
    gl_FragColor = vec4(dc * 0.6, 1.0); return;
  }` : ''}
  ${WDEBUG.has('zdiff') ? `{
    float zs = texture(tSceneDepth, gl_FragCoord.xy / uResolution).r, zf = -vViewPos.z;
    float rel = (zs - zf) / zf;
    vec3 dc = rel < -0.004 ? vec3(0.0, 1.0, 0.0) : rel < 0.0 ? vec3(1.0, 0.0, 1.0) : vec3(0.0, 0.0, 1.0);
    if (vDepth < 0.0) dc *= 0.35;
    gl_FragColor = vec4(dc * 0.6, 1.0); return;
  }` : ''}
  ${WDEBUG.has('class') ? `{
    vec3 dc = vDepth < -0.08 ? vec3(1.0, 0.0, 0.0) : vDepth < 0.0 ? vec3(1.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
    if (vSimD > 0.1 && vSimD < 3.0 && vDepth < 0.185 && vDepth > 0.1) dc = vec3(0.0, 1.0, 0.0);
    gl_FragColor = vec4(dc * 0.6, 1.0); return;
  }` : ''}
  vec3 P = vBodyPos;
  vec3 up = normalize(P);
  float fw = length(fwidth(P));
  gdPx = dFdx(P);
  gdPy = dFdy(P);
  // ── surface normal: Gerstner (analytic) + ripples (flow-mapped on rivers) ──
  vec3 grad = vec3(0.0);
  float calm = smoothstep(0.3, 4.0, vDepth) * (1.0 - smoothstep(0.05, 0.4, vIce));
  float windSpd = length(vWind);
  // fetch: ponds, oases and small lakes (fresh, still) are sheltered — the same wind barely roughens them, so they keep
  // the mirror of their banks and sky (at the open sea's state a sunset pond went a dark, rough grey); rivers keep theirs
  gSea = seaState(vWind) * mix(0.4, 1.0, max(smoothstep(0.3, 0.8, vSalt), smoothstep(0.15, 0.6, length(vFlow))));
  gWindT = windTan(vWind, up);
  float sea = uWind * gSea;
  gUnresolved = 0.0;
  gResolved = 0.0;
  // (crests wandering and grouped as the geometry's: WAVES_GLSL gwWarpAt / gwGroupAt)
  float gwW = gwWarpAt(P, uTime);
  vec2 gwG = gwGroupAt(P, uTime);
  for (int i = 0; i < 4; i++) {
    float L = GW_D[i].w;
    // (the NORMAL fades only by footprint: the vertex shader fades the displacement by distance because a patch
    // cannot carry it, but faded here too it left the sea beyond ~60–200 m a flat glassy gel)
    vec3 D = normalize(GW_D[i].xyz);
    vec3 d = waveTan(D, up);
    float feed = windFeed(d, gWindT, i < 2 ? 1.0 : 0.5) * smoothstep(0.15, 0.45, length(d));
    // (kept while at least ~8 pixels hold a wavelength: at 3 the long waves drew bands across a whole ocean from orbit,
    // at 5 stripes over the lakes from a few kilometres up)
    float fade = 1.0 - smoothstep(0.04, 0.13, fwWave(D, up) / L);
    float grpW = gwGroup(gwG, i);
    float amp = GW_A[i] * sea * calm * fade * feed * grpW;
    gUnresolved += pow(GW_A[i] * sea * calm * feed * 6.2831853 / L, 2.0) * 0.5 * (1.0 - fade);
    float k = 6.2831853 / L;
    float ph = k * dot(P, D) - sqrt(9.8 * k) * uTime + gwPhase(gwW, i);
    grad += d * (amp * k * cos(ph));
  }
  // the long swell (34–90 m, normal only — the geometry cannot carry it everywhere): broad undulations in the reflection
  // that give the far sea its texture, running with the wind
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float L = 34.0 * pow(1.6, fi);
    vec3 D = normalize(vec3(cos(fi * 2.4 + 0.7), sin(fi * 1.7), sin(fi * 2.4 + 0.7)));
    vec3 d = waveTan(D, up);
    float k = 6.2831853 / L;
    // (a shelf a few metres deep still carries the swell: only the shallows calm it)
    // (drawn while ~14 pixels or more hold a wavelength, its slopes folded into the glint's roughness below that: kept
    // down to 5 px, three pure swells mirrored the sky's horizon gradient as parallel stripes — corrugated tin over
    // every lake and sea from a few kilometres up)
    float fadeS = 1.0 - smoothstep(0.025, 0.07, fwWave(D, up) / L);
    float ampS = L * 0.011 * sea * calm * smoothstep(1.5, 8.0, vDepth) * windFeed(d, gWindT, 1.0) * smoothstep(0.15, 0.45, length(d));
    gUnresolved += pow(ampS * k, 2.0) * 0.5 * (1.0 - fadeS);
    float amp = ampS * fadeS;
    grad += d * (amp * k * cos(k * dot(P, D) - sqrt(9.8 * k) * uTime + fi * 2.1));
  }
  // the long waves only: the mirrored cloud deck is looked up along this (a ripple's tilt, carried out kilometres to the
  // cloud layer, jumps the lookup by tens of metres from pixel to pixel — an aliased weave of stripes in the reflection)
  vec3 gradLong = grad;
  float flowSpd = length(vFlow);
  vec3 g1, g2;
  float mixF = 0.0;
  ${WCUT.has('noripple') ? '' : WFAST2 ? 'gNG = gwG;' : WFAST ? 'rippleNoise(P, uTime);' : ''}
  if (flowSpd > 0.05) {
    // two-phase flow map: ripples advected along the flow, phases offset by half a cycle and cross-faded
    float cyc = 2.5;
    float t1 = fract(uTime / cyc);
    float t2 = fract(uTime / cyc + 0.5);
    g1 = ripples(P, up, fw, vFlow * t1 * cyc, uTime);
    g2 = ripples(P, up, fw, vFlow * t2 * cyc, uTime);
    mixF = abs(t1 * 2.0 - 1.0);
    grad += mix(g1, g2, mixF) * (1.0 + min(flowSpd, 3.0) * 0.4);
  } else {
    grad += ripples(P, up, fw, vec3(0.0), uTime);
  }
  vec3 nB = normalize(up - grad);
  // specular AA: the normal's own change across this pixel (its screen derivatives) widens the lobes, so a ripple drawn
  // at a few pixels per wavelength gives a soft sheen instead of single-pixel white specks (ponds as TV static)
  vec3 dnx = dFdx(nB), dny = dFdy(nB);
  float nVar = min(0.5 * (dot(dnx, dnx) + dot(dny, dny)), 0.12);
  mat3 viewToBody = transpose(uBodyToView);
  vec3 nV = normalize(uBodyToView * nB);
  vec3 vV = normalize(-vViewPos);
  vec3 vB = normalize(viewToBody * vV);
  float NdV = max(dot(nB, vB), 1e-3);

  // ── light at this point ──
  float rP = length(P);
  float muS = dot(up, uSunDirBody);
  float sh = sunShadow(vViewPos, nV);
  float csh = cloudShadowW(P, uSunDirBody);
  vec3 sunCol = uSunE * sunTransmittance(rP, muS) * sh * csh;
  vec3 skyE = skyIrradiance(up, up, uSunDirBody) + uNightAmbient;

  // ── refraction + absorption ──
  vec2 suv = gl_FragCoord.xy / uResolution;
  float fragZ = -vViewPos.z;
  float sceneZ0 = ${NOREFR ? 'fragZ + 5.0' : 'texture(tSceneDepth, suv).r'};
  float thick0 = max(sceneZ0 - fragZ, 0.0);
  // (gentle: with the waves really drawn, a 3.5 % screen offset shattered the shallow floor into a blocky mosaic)
  vec2 ruv = suv + nV.xy * 0.016 * clamp(thick0 * 0.25, 0.0, 1.0) / max(fragZ * 0.02, 1.0);
  float sceneZ = ${NOREFR ? 'sceneZ0' : 'texture(tSceneDepth, ruv).r'};
  if (sceneZ < fragZ) { ruv = suv; sceneZ = sceneZ0; }
  float cosV = max(abs(normalize(vViewPos).z), 0.05);
  float pathLen = max(sceneZ - fragZ, 0.0) / cosV;
  pathLen = min(pathLen, 400.0);
  vec3 refr = ${NOREFR ? 'vec3(0.02, 0.05, 0.07)' : 'texture(tSceneColor, ruv).rgb'};
  // cold seas a little greener, warm shallows turquoise
  // (coastal and lake water carries plankton and silt: the floor fades within a few metres — a quay's foot 9 m down
  // stayed in plain view and every pool read as a swimming pool)
  vec3 sigmaA = vec3(0.45, 0.15, 0.11) + vec3(0.0, 0.02, 0.0) * smoothstep(15.0, 0.0, vTemp);
  // rivers carry silt: browner, murkier water
  float riverK = smoothstep(0.15, 0.6, length(vFlow));
  sigmaA += vec3(0.08, 0.16, 0.3) * riverK;
  vec3 sigmaS = vec3(0.018, 0.045, 0.05);
  // ARC §10: before a flood the river runs high and brown — the rain upstream washes the soil down (planet/silt.ts).
  // Heavy tan scattering and blue absorption: an opaque, muddy brown within a metre; the sea at a river mouth takes less.
  float silt = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 sz = uSilt[i];
    if (sz.w > 0.0) silt = max(silt, uSiltK[i] * (1.0 - smoothstep(sz.w * 0.55, sz.w, distance(vBodyPos, sz.xyz))));
  }
  silt *= 1.0 - 0.6 * smoothstep(0.3, 0.8, vSalt);
  sigmaS += vec3(0.7, 0.46, 0.22) * silt;
  sigmaA += vec3(0.04, 0.2, 0.62) * silt;
  // turbidity: shallow and coastal water carries silt and plankton (the swell stirs the bottom up): more scattering,
  // greener, so the floor fades within a few metres and a quay's foot sinks into murk instead of showing 9 m down.
  // The open, deep sea stays clear and blue.
  float coastal = 1.0 - smoothstep(4.0, 30.0, vDepth);
  sigmaS += vec3(0.05, 0.075, 0.055) * coastal * mix(0.6, 1.0, smoothstep(0.3, 0.8, vSalt)) + vec3(0.03, 0.04, 0.025) * riverK;
  sigmaA += vec3(0.04, 0.03, 0.06) * coastal;
  vec3 Tw = exp(-(sigmaA + sigmaS) * pathLen * 1.25);
  // the light the water body sends back up: single-scattering albedo × the backscattered share (~0.1; most scattering in
  // water goes forward, down and away) — a few percent of the light, not a fifth: brighter in-scatter turned every
  // sea a glowing swimming-pool turquoise
  vec3 inscat = sigmaS / (sigmaA + sigmaS) * (1.0 - Tw) * (sunCol * max(muS, 0.0) * 0.09 + skyE * 0.1) / 3.14159;
  // (still fresh water is dark and clear, not milky — at the sea's back-scatter ponds read as turquoise milk; rivers
  // keep their silt)
  // (… but a DEEP lake is a body of water like the sea: halved, its in-scatter left an inland lake seen from a few
  // hundred metres up a black disc, a hole in the land beside a blue sea)
  inscat *= mix(0.5, 1.0, max(max(max(smoothstep(0.3, 0.8, vSalt), riverK), smoothstep(2.0, 8.0, vDepth)), silt));
  // (muddy water sends back far more of the light than clear water: its silt, not the water, is what one sees)
  inscat *= 1.0 + 6.0 * silt;
  vec3 under = refr * Tw + inscat;

  // ── reflection ──
  // a rough sea (slopes this pixel cannot draw, gUnresolved) does not mirror the horizon: its facets tilt toward the
  // viewer, so on average it reflects higher sky with less Fresnel — the far sea is a darker band under a bright
  // horizon, not a sheet of sky. The mirror direction is lifted toward the zenith by that slope variance.
  // Beyond ~30 m — and under a dark sky, where a mirrored star of detail is only stripes — the sky and the clouds are
  // looked up along the LONG waves' normal (the four wind waves and the swell, their crests wandering out there), with
  // the slope variance of the ripples folded into the roughness (LEAN): a sheen, not lines. (With each pixel's own
  // ripple normal, a grazing view mirrored the horizon's bright band through every crest: brushed metal at 40–300 m,
  // horizontal pinstripes over the night sea; with the swell's alone, a flat mirror of crisp clouds — the glassy gel.)
  float viewD = length(vViewPos);
  float skyDay = smoothstep(-0.1, 0.06, muS);
  float meanK = max(smoothstep(20.0, 45.0, viewD), 1.0 - skyDay);
  vec3 nR = normalize(mix(nB, normalize(up - gradLong), meanK));
  float sig2 = gUnresolved + meanK * gResolved + nVar * 0.5;
  vec3 rB = reflect(-vB, nR);
  rB = normalize(rB + up * (max(0.0, -dot(rB, up)) * 1.02 + sqrt(sig2) * 0.8));
  // (+ the starlit night sky's own radiance, E/π: a moonless sea mirrors it, dark from above, brighter toward its limb)
  vec3 skyR = skyRadiance(up, rB, uSunDirBody) + uNightAmbient * 0.3;
  // the clouds overhead, mirrored: the deck's density where the reflected ray crosses the mid-shell (the same density
  // the cloud shadows use), lit by the sun through the air at the cloud and by the sky; thin far out (it is the
  // reflected sky the SSR cannot see: off-screen above the frame)
  if (uCloudOn > 0.5) {
    float mid = 0.5 * (uCloudShell.x + uCloudShell.y);
    vec2 hit = raySphere(P, rB, mid);
    if (hit.y > 0.0) {
      // the mirror point of the long waves (gradLong above): they break the mirrored deck into broad rippled shards.
      // (An extra tilt × distance — a stand-in from when the wave phases were broken and the sea was a flat mirror —
      // threw the sample hundreds of metres between neighbouring pixels: a blocky mosaic of cloud shards.)
      vec3 nL = normalize(up - gradLong);
      vec3 rL = reflect(-vB, nL);
      rL = normalize(rL + up * max(0.0, -dot(rL, up)) * 1.02);
      vec2 hitL = raySphere(P, rL, mid);
      vec3 q = P + rL * max(hitL.y, 0.0);
      vec2 cs = texture(uCloudCov, normalize(q)).rg;
      float dens = cloudDensityAt(q, 0.5, cs.x, cs.y, false);
      float alpha = 1.0 - exp(-dens * (uCloudShell.y - uCloudShell.x) * 0.5);
      vec3 qn = normalize(q);
      float muC = dot(qn, uSunDirBody);
      vec3 cloudL = (uSunE * sunTransmittance(length(q), muC) * (0.25 + 0.2 * max(muC, 0.0)) * (1.0 - 0.5 * cs.y) + skyIrradiance(qn, -rB, uSunDirBody) * 0.6) / 3.14159;
      skyR = mix(skyR, cloudL, alpha * 0.75);
    }
  }
  {
    vec3 rV = normalize(uBodyToView * rB);
    vec4 sr = ssr(vViewPos, rV, nV);
    skyR = mix(skyR, sr.rgb, clamp(sr.a, 0.0, 1.0));
  }
  float NdVr = sqrt(pow(max(dot(nR, vB), 1e-3), 2.0) + sig2 * 2.0);
  float F = 0.02 + 0.98 * pow(1.0 - clamp(NdVr, 0.0, 1.0), 5.0);
  // sun glint (GGX), roughness from the slope variance of the waves this pixel cannot draw (not a fixed blur): near,
  // a sharp sun in every facet; far, a broad road of glitter — sparkling where single facets catch the sun
  // Beyond ~30 m the glint too is the mean normal's lobe widened by every wave's slope variance (LEAN): the crests of
  // a few drawn waves each catching the sun drew long parallel white streaks — brushed metal — where a real sea shows
  // a broad road of glitter (the flashing facets below break it up)
  // (half-way only: all the way to the mean normal the near sea went a smooth milky sheet of glare, a gel)
  vec3 nG = normalize(mix(nB, nR, 0.5 * meanK));
  float a0 = mix(0.035, 0.07, meanK);
  float a = clamp(sqrt(a0 * a0 + 2.0 * (gUnresolved + 0.5 * meanK * gResolved) + nVar * (1.0 - 0.5 * meanK)) + (1.0 - calm) * 0.02, 0.035, 0.45);
  float NdVg = max(dot(nG, vB), 1e-3);
  vec3 hB = normalize(uSunDirBody + vB);
  float NdH = max(dot(nG, hB), 0.0);
  float NdL = max(dot(nG, uSunDirBody), 0.0);
  float a2 = a * a;
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * dd * dd);
  float k = a * 0.5;
  float Vis = 0.25 / ((NdL * (1.0 - k) + k) * (NdVg * (1.0 - k) + k));
  float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(hB, vB), 0.0), 5.0);
  vec3 glint = sunCol * D * Vis * Fs * NdL;
  // glitter: sub-pixel facets flash in and out where the glint is broad (a soft blob read as a gel). The flashing cells
  // are about two pixels across (a power-of-two size from the footprint): fixed 0.6 m cells drew a field of lit squares
  // over the near water, where the waves are drawn anyway and there is nothing sub-pixel to stand in for
  // (each cell's facet is a round point at a jittered place in it, lit for a moment: square cells lit whole tiled the
  // sea with a mosaic of bright squares)
  float cellM = exp2(floor(log2(max(fw * 2.0, 0.05))));
  vec3 gc = floor(P / cellM);
  float tk = floor(uTime * 6.0 + gn_hash13(gc) * 6.0);
  float spark = gn_hash13(gc + tk * 0.37);
  vec3 gp = (gc + 0.25 + 0.5 * gn_hash33(gc + tk)) * cellM;
  vec3 gd = P - gp;
  gd -= up * dot(gd, up);
  float dotK = exp(-dot(gd, gd) / (cellM * cellM * 0.06));
  // (the open sea only: a sheltered pond's few ripples give a soft sheen, not a sparkling field of white specks)
  // (and only while a facet is a few pixels' worth of sea: from orbit, a pixel holding metres of glitter is its mean —
  // single flashing cells there drew rows of white dots over the oceans)
  float sparkK = mix(1.0, 0.3 + 8.0 * step(0.9, spark) * dotK, smoothstep(0.06, 0.2, a) * smoothstep(0.02, 0.09, fw) * (1.0 - smoothstep(0.8, 3.0, fw)) * smoothstep(0.3, 0.8, vSalt));

  // moonlight (renderer.ts: the brightest moon, art-directed): the moonlit sky in the reflection and a glitter path
  // of moon glints on the swell — the night sea's one bright thing
  if (dot(uMoonE, uMoonE) > 0.0) {
    float mUp = smoothstep(-0.03, 0.06, dot(up, uMoonDirBody));
    float kM = uMoonE.g / max(uSunE.g, 1e-6);
    skyR += skyRadiance(up, rB, uMoonDirBody) * kM * mUp;
    vec3 hM = normalize(uMoonDirBody + vB);
    float NdHm = max(dot(nG, hM), 0.0), NdLm = max(dot(nG, uMoonDirBody), 0.0);
    float ddm = NdHm * NdHm * (a2 - 1.0) + 1.0;
    float Dm = a2 / (3.14159 * ddm * ddm);
    float Vism = 0.25 / ((NdLm * (1.0 - k) + k) * (NdVg * (1.0 - k) + k));
    float Fm = 0.02 + 0.98 * pow(1.0 - max(dot(hM, vB), 0.0), 5.0);
    glint += uMoonE * mUp * cloudShadowW(P, uMoonDirBody) * Dm * Vism * Fm * NdLm;
  }
  glint *= sparkK;
  // the water body's own glow never outshines what it mirrors: in-scattered light is capped at half the reflected sky's
  // luminance (at dusk the shallows otherwise glowed a saturated green-teal over the dark sea, an emissive look)
  {
    vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
    float li = dot(inscat, LUM);
    // (muddy water's body is what one sees: the silt lifts the cap, ARC §10)
    float cap = 0.5 * dot(skyR, LUM) * (1.0 + 2.0 * silt);
    if (li > cap) under -= inscat * (1.0 - cap / li);
  }
  // ARC §10: a silted river is a swollen BROWN RIVER, still water: its body turns mud-brown (~70 %) with streaks of
  // silt drawn out along the current, while the ripples' Fresnel sky, the specular glints and the foam stay on top.
  // (The earlier pass recoloured the final colour, glints and sky included, to an opaque matte tan: it read as a dry
  // sandy bed, lower, not a river in spate.)
  if (silt > 0.0) {
    vec3 LUMs = vec3(0.2126, 0.7152, 0.0722);
    float lu = dot(under, LUMs);
    // streaks along the flow, drifting downstream (a slack water lake gets slow blotches)
    vec3 fl = vFlow * uTime * 0.6;
    float fs = length(vFlow);
    vec3 fd = fs > 0.05 ? vFlow / fs : vec3(0.0);
    vec3 sp = P - fl;
    float along = dot(sp, fd);
    vec3 across = sp - fd * along;
    float streak = snoise(across * 0.11 + fd * along * 0.012) * 0.6 + snoise(sp * 0.035 + 7.0) * 0.4;
    // (silt-laden water is BRIGHT: the suspended mud sends back the daylight as a ~0.3 albedo would — a deep lake's
    // dark body browned at its own luminance stayed a dark hole under an overcast)
    float ls = dot(skyR, LUMs);
    // (r1 looked at: (1.45, 0.98, 0.5) at 72 % under a grey rain sky read as pale grey-green, then (1.75, 0.88, 0.32)
    // at 85 % as pale khaki under the rain veil, then (2.0, 0.8, 0.2) at a 0.26 floor as an opaque orange sand: the
    // mud is a darker ochre brown with streaks, and the sky's mirror stays on it so it still reads as water)
    vec3 mud = max(lu, 0.17 * ls) * vec3(1.9, 0.84, 0.3) * (0.66 + 0.34 * streak);
    under = mix(under, mud, 0.9 * silt);
    // the mirrored sky through a skin of muddy water: a little warmer, a little less of it
    skyR = mix(skyR, ls * vec3(1.15, 1.0, 0.8), 0.45 * silt) * (1.0 - 0.12 * silt);
  }
  vec3 col = mix(under, skyR, F) + glint;

  // ── foam: surf, crests, white water ──
  float vertThick = max(sceneZ0 - fragZ, 0.0) * cosV;
  // how far the water sheet itself leans (a river running down a valley, not a lake): leaning sheets get no surf
  vec3 cg = cross(dFdx(P), dFdy(P));
  float cgl = length(cg);
  vec3 nGeo = cgl > 1e-20 ? cg / cgl : up;
  float lean = 1.0 - abs(dot(nGeo, up));
  float level = 1.0 - smoothstep(0.004, 0.03, lean);
  // a thin, still sheet lying on a slope is not water anyone poured: it is the interpolated level of a shore triangle
  // standing up out of the curved ground ('paper' wedges). It fades into the ground behind it (smoothly in the
  // per-vertex depth; never a per-triangle discard, whose straight edges would cut pools into polygons)
  float paper = smoothstep(0.03, 0.12, lean) * (1.0 - smoothstep(0.15, 0.6, vDepth)) * (1.0 - smoothstep(0.3, 0.8, flowSpd));
  // surf needs waves and fetch: the open sea (salt) under wind breaks on its shore; ponds, oases and still lakes do
  // not wear a white outline
  float waveE = smoothstep(0.1, 0.5, uWind) * mix(0.12, 1.0, smoothstep(0.3, 0.8, vSalt));
  // a 1–4 m band that pulses with the swell washing in and out, broken into patches
  float shore = 0.0;
  if (W_SHORE_ON) {
  float pulse = 0.5 + 0.5 * sin(uTime * 0.9 - vertThick * 2.4 + snoise(P * 0.05) * 3.0);
  float tN = vertThick + snoise(P * 0.35 + uTime * 0.05) * 0.25;
  float band = mix(0.35, 1.1, pulse);
  shore = smoothstep(0.02, 0.15, tN) * (1.0 - smoothstep(band * 0.5, band, tN)) * level * waveE;
  // the band is a metre or so wide: once a pixel covers more than that it would only draw a white outline
  shore *= 1.0 - smoothstep(0.35, 2.0, fw);
  // streaks advected up and down the beach
  float surf = smoothstep(-0.2, 0.6, snoise(vec3(P.x * 0.18, P.y * 0.18 - uTime * 0.25, P.z * 0.18)));
  shore *= mix(0.15, 1.0, surf);
  }
  float crest = smoothstep(0.75, 1.15, vCrest) * calm;
  // white water only where water really runs: a torrent (over ~4 m/s), or a leaning sheet that is moving (a cascade:
  // its film lies on the rock, a few decimetres to a metre or two thick); a still sheet on a slope is never painted as rapids, nor the shallow fringe of a river (the cell's speed
  // is interpolated right up to its banks). (From 1.3 m/s a broad river 3 m deep — smooth and boiling, not white — was
  // one sheet of foam lace: from 100 m, TV static where the town's lake should be)
  float rapids = max(smoothstep(3.5, 5.0, flowSpd) * smoothstep(0.4, 1.2, vDepth), smoothstep(0.06, 0.25, lean) * smoothstep(0.15, 0.8, vDepth) * smoothstep(0.3, 1.0, flowSpd));
  // a SURGE: the sim moves a tsunami's (or a flood's) volume as a steep bulge of the water level over deep water — the
  // level's own slope (vSurge, before the wind waves ride on it), not the waves'. Its face is a wall of turbulent white
  // water streaked down the slope, foam boiling at its foot; a calm sea's level is flat, a river's barely tilts (the
  // tsunami's flow field stays at rest in the sim, so this cannot wait for a speed)
  // (only where the level is steeper than its bed — a cascade down a slope leans with the ground under it; the cells'
  // least-squares slopes, fieldtex.ts W — and over a bed no steeper than a shelf)
  float bedC = clamp(vBedCos, 1e-3, 1.0);
  float bedSlope = sqrt(max(1.0 - bedC * bedC, 0.0)) / bedC;
  // (fast water spares only a gentle excess slope — a river's surface tilting over its bed — never a wall: where a
  // surge runs with its flow, as the bore of a wave does, a gate on the speed alone took the white off the whole face
  // and left a smooth grey slope that mirrored the sky like polished metal)
  // (the foam's margin is an iso-line of the excess: interpolated over sim triangles it runs in straight segments, so
  // it is broken by noise at ~15 m and ~5 m into a ragged, curving edge of churned water)
  float excess = vSurge.x;
  if (W_SURGE_ON) excess += (snoise(P * 0.067 + 5.0) * 0.65 + snoise(P * 0.19 + 9.0) * 0.35 * (1.0 - smoothstep(1.5, 5.0, fw))) * 0.045 * smoothstep(0.0, 0.06, vSurge.x);
  float surge = smoothstep(0.045, 0.16, excess) * (1.0 - smoothstep(0.12, 0.3, bedSlope)) * smoothstep(1.0, 3.0, vDepth)
    * (1.0 - smoothstep(0.5, 1.5, riverK + max(flowSpd - 2.0, 0.0)) * (1.0 - smoothstep(0.1, 0.2, excess)));
  // (down the face: against the level's gradient, in the tangent plane)
  vec3 surgeDown = -(vSurge.yzw - up * dot(vSurge.yzw, up));
  surgeDown = length(surgeDown) > 1e-5 ? normalize(surgeDown) : vec3(0.0);
  // the bore breaks on its FRONT face (the level falling away the way the water runs); behind the crest the slope
  // trails a thinner wash of the foam it left (both slopes foamed alike drew a white band twice the face's depth)
  {
    float fsp = length(vFlow);
    float front = fsp > 0.3 ? smoothstep(-0.25, 0.35, dot(surgeDown, vFlow / fsp)) : 1.0;
    surge *= mix(0.4, 1.0, front);
  }
  // rivers are shallow everywhere: their banks get a thin lip of foam, not a foamy bed
  shore *= mix(1.0, 0.25, riverK);
  // whitecaps: the open sea breaks into scattered white patches that drift and die away — a few, not a speckle
  // (uWind is the sea state the waves are built for: 1 is a moderate breeze, more under a gale)
  // Coverage by wind speed (Monahan's U^3.4, art-directed up so a breeze reads): none under ~4 m/s, a few percent at a
  // fresh breeze (8 m/s), ~10 % at 12 m/s; patches born on the crests (Gerstner phase), drawn out along the wind into
  // streaks, drifting
  // (measured along the pixel's own tangent wind, P·wA ≡ 0: the whitecap noise was one value over the whole sea, so the
  // sea was either all white or not at all.) Body-frame noise instead, drawn out east–west (the zonal winds: trades and
  // westerlies) by an anisotropic scale, drifting and re-forming
  vec3 Pw = vec3(P.x * 0.38, P.y, P.z * 0.38);
  float cover = clamp(0.0012 * pow(max(windSpd * uWind - 3.5, 0.0), 2.2), 0.0, 0.35);
  float wcN = 0.0;
  if (W_CAP_ON) wcN = snoise(Pw * 0.16 + vec3(-uTime * 0.03, 0.0, uTime * 0.02)) * 0.55 + snoise(Pw * 0.9 + vec3(uTime * 0.09, uTime * 0.05, -uTime * 0.07)) * 0.3 + (vCrest - 0.6) * 0.35;
  float whitecap = smoothstep(1.0 - cover * 4.0, 1.0 - cover * 2.0 + 0.02, wcN * 0.5 + 0.5) * step(0.001, cover) * smoothstep(0.3, 0.8, vSalt) * calm * smoothstep(2.0, 8.0, vDepth);
  // the streaks of foam a gale leaves behind (thin, long, along the wind)
  if (W_GALE_ON) whitecap = max(whitecap, smoothstep(0.75, 0.95, snoise(vec3(P.x * 0.03, P.y * 1.4, P.z * 0.03) + 3.1) * 0.5 + 0.5) * smoothstep(9.0, 16.0, windSpd * uWind) * 0.5 * calm * smoothstep(0.3, 0.8, vSalt));
  float foamAmt = ${NOFOAM ? '0.0 * ' : ''}clamp(max(max(max(max(shore, crest * 0.8), rapids * 0.85), whitecap * 0.7), surge * 0.95), 0.0, 1.0);
  if (foamAmt > 0.01) {
    // foam is LACE: a web of bright bubble filaments round dark holes (ridged noise at two scales, drifting with the
    // flow and slowly re-forming), thinning out in larger patches — the cells of a Voronoi read as white fish scales
    // dotted along every shore
    vec3 fp = P * 0.8 - vFlow * uTime * 0.8;
    float l1 = 1.0 - abs(snoise(fp + vec3(0.0, uTime * 0.07, 0.0)));
    float l2 = 1.0 - abs(snoise(fp * 2.6 + vec3(7.1, -uTime * 0.11, 2.3)));
    float kL = 1.0 - smoothstep(0.15, 0.9, fw * 2.6);
    // the filaments are ~0.2 m wide: past a few centimetres a pixel they would only alias into a white speckle, so they
    // hand over to the same lace drawn at 4× the scale (rafts and streaks of foam), and that to its mean
    float l0 = 1.0 - abs(snoise(fp * 0.25 + vec3(3.3, uTime * 0.03, 0.0)));
    float fineK = 1.0 - smoothstep(0.03, 0.1, fw);
    float lace = mix(l0 * l0 * l0 * 0.9, l1 * l1 * l1 * 0.75 + l2 * l2 * l2 * l2 * 0.45 * kL, fineK);
    float thinP = smoothstep(0.25, 0.75, snoise(P * 0.33 + 3.3) * 0.5 + 0.5);
    float pat = mix(0.6, clamp(lace * (0.55 + 0.6 * thinP), 0.0, 1.0), 1.0 - smoothstep(0.15, 1.2, fw));
    // falls: white water with faint streaks running down the slope with it
    if (lean > 0.06 && flowSpd > 1.0) {
      vec3 fd = normalize(vFlow + 1e-5);
      vec3 side = normalize(cross(fd, up) + 1e-5);
      float streak = smoothstep(0.1, 0.7, snoise(P * 1.2 - vFlow * uTime * 0.9) * 0.5 + 0.5);
      pat = mix(pat, 0.75 + 0.25 * streak, smoothstep(0.06, 0.2, lean));
    }
    // a surge's face: churned white water with darker water showing through, at three scales — boils of ~2 m and
    // ~10 m and billows of ~50 m that hold out to a grazing view a kilometre off (a pixel there spans ~100 m along the
    // line of sight). Isotropic noise on the body position, as the lace above: streaks along the fall line projected the
    // body position on a per-pixel direction at right angles to it — dot(P, side) is ~0 everywhere on a sphere — so the
    // face averaged to one flat white strip, a snowbank on the sea rather than a wall of water
    // (a bore of fast water over DEEP water — a wave's breaking crest running with its flow, a tidal race — is churned
    // the same way: the rapids' even white, made for a river's riffles over a bed, drew a wave's whole crest as one
    // flat sheet across the sea)
    float churn = max(surge, rapids * smoothstep(3.0, 8.0, vDepth));
    float surgeStreak = 0.5;
    if (churn > 0.02) {
      float stF = snoise(P * 0.45 + vec3(0.0, -uTime * 0.6, 0.3)) * (1.0 - smoothstep(0.4, 1.5, fw));
      float stC = snoise(P * 0.09 + vec3(1.7, uTime * 0.12, 0.0)) * (1.0 - smoothstep(3.0, 12.0, fw));
      float stB = snoise(P * 0.018 + vec3(8.3, 0.0, uTime * 0.02)) * (1.0 - smoothstep(60.0, 220.0, fw));
      surgeStreak = clamp(0.5 + 0.5 * (stF * 0.45 + stC * 0.6 + stB * 0.7), 0.0, 1.0);
      pat = mix(pat, 0.42 + 0.58 * smoothstep(0.25, 0.7, surgeStreak), churn * 0.85);
    }
    // soft coverage, never saturated white (… except a surge's face, a wall of churned white water)
    float foam = smoothstep(0.05, 0.9, foamAmt * (0.55 + 0.75 * pat)) * mix(0.8, 0.95, surge);
    // (a surge's coverage follows its streaks: through the saturating ramp above the whole face came out one even
    // white — a snowbank on the sea — with no dark water between the streaks of churn)
    foam = mix(foam, 0.95 * mix(0.3, 1.0, smoothstep(0.3, 0.72, surgeStreak)), smoothstep(0.3, 0.9, churn));
    vec3 foamC = vec3(0.85) * (sunCol * max(muS, 0.0) + skyE) / 3.14159;
    // (the churn shades itself: the troughs between a surge's streaks lie in the face's own shadow)
    foamC *= mix(1.0, 0.7 + 0.3 * smoothstep(0.2, 0.8, surgeStreak), churn);
    col = mix(col, foamC, foam);
  }

  // ── sea ice ── (before the shore blend, so ice too thins out at the waterline instead of keeping polygon edges)
  // floe edges: noise breaks the per-cell field so the pack ice never follows the grid's triangles
  float iceW = vIce > 0.01 ? smoothstep(0.08, 0.5, vIce + (snoise(P * 0.012) * 0.3 + snoise(P * 0.06) * 0.12) * min(1.0, vIce * 6.0)) : 0.0;
  if (iceW > 0.0) {
    vec3 iv = voronoi3(P * 0.09);
    // crack lines are thinner than a pixel from a distance: widen with the footprint, then fade them out entirely
    // (unfiltered they became single-pixel blue speckle), and the per-floe brightness with them
    float aa = 1.0 - smoothstep(0.1, 0.45, fw * 0.09 / 0.04);
    float cr = (1.0 - smoothstep(0.0, 0.04 + fw * 0.09, iv.y - iv.x)) * aa;
    vec3 alb = mix(vec3(0.62, 0.72, 0.8), vec3(0.85, 0.89, 0.93), smoothstep(0.3, 1.5, vIce)) * (0.9 + 0.12 * mix(0.5, iv.z, aa));
    alb = mix(alb, vec3(0.2, 0.32, 0.4), cr * 0.6);
    vec3 iceC = alb * (sunCol * max(dot(up, uSunDirBody), 0.0) + skyE) / 3.14159 + skyR * 0.04;
    col = mix(col, iceC, iceW);
  }

  // ── shore blend: the sheet thins to nothing where it meets the ground, so the waterline is the ground's own contour
  // (read from the depth behind the water), softened and broken by noise — never a hard polygon edge. A film a few
  // centimetres thick reads as wet ground (darker, a little glossy), not as a pale sheet of sky reflection.
  {
    // on flat ground the sim's wet / dry cells meet along straight 50 m triangle edges with no contour to follow:
    // a 10–20 m noise on the thickness bites the waterline into an irregular, natural shore (it only ever takes
    // water away near the edge, never adds any)
    float edgeN = 0.0;
    if (W_EDGE_ON) edgeN = snoise(P * 0.07) * 0.3 + snoise(P * 0.45) * 0.08 + snoise(P * 1.9) * 0.03;
    // (over the first ~0.18 m of depth: fading out over 0.4 m spread every gently shelving lake into a 10–20 m halo of
    // milky haze from 60 m up, a fog patch rather than water)
    // (from afar the depth buffer cannot tell a coarse patch's sheet from the coarse bed under it — the two meshes
    // nearly meet, and the whole lake read as its own shore film: its dark wet bed, a black disc in the land from a few
    // kilometres up while the sea beside it mirrored the sky. Out there the field's own depth stands in)
    float thickE = mix(vertThick, max(vertThick, vDepth), smoothstep(0.25, 1.5, fw));
    // (the bite only where the sim's own water is a film: where it floods 0.2 m and more the shore it draws is the sim's)
    float edge = smoothstep(0.012, 0.18, thickE + min(edgeN, 0.12) * smoothstep(1.6, 0.2, thickE) * (1.0 - smoothstep(0.1, 0.25, vSimD)));
    // at zero thickness exactly the ground behind: a sheet within depth precision of the ground (dry shore cells hold
    // their level a few cm under it) can never z-fight into speckles
    // (a film a few centimetres thick is the wet ground the terrain already darkens along its waterline band: darkened
    // again here it drew a dotted line of tiny pools wherever the 3 m detail relief dips under the level)
    float film = smoothstep(0.03, 0.3, thickE);
    vec3 wetGround = mix(refr, refr * 0.8 + skyR * F * 0.3, film);
    ${WATERLAND && WDEPTH ? 'edge *= smoothstep(landCut, min(landCut + 0.06, 0.0), vDepth);' : ''}
    col = mix(wetGround, col, edge * (1.0 - paper));
  }
  // (UI lane, additive) a map overlay (the UI's O key, overlaytex.ts) tints the sea with its colour too, at the
  // water's own brightness, so the map reads across the water instead of stopping at the shore
  if (uOverlayK.x > 0.5) {
    vec3 od = normalize(vBodyPos);
    vec4 ov = textureLod(uOverlay, vec2(atan(od.x, od.z) * 0.15915494 + 0.5, asin(clamp(od.y, -1.0, 1.0)) * 0.31830989 + 0.5), 0.0);
    float lum = max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
    col = mix(col, ov.rgb * (lum * 2.2 + uOverlayK.z * 0.6), ov.a * 0.8);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

/** water material for one LOD level; shares the planet uniforms and the terrain level's morph uniform */
export function makeOceanMaterial(shared: Record<string, IUniform>, morph: IUniform<Vector4>, scene: Record<string, IUniform>): ShaderMaterial {
  const uniforms: Record<string, IUniform> = {};
  for (const k of Object.keys(shared)) uniforms[k] = shared[k];
  for (const k of Object.keys(scene)) uniforms[k] = scene[k];
  if (WFAST) for (const k of Object.keys(TNOISE_UNIFORMS)) uniforms[k] = TNOISE_UNIFORMS[k];
  if (WFAST2) uniforms.uRipMap = { value: rippleMap() };
  if (WCLOCK != null) uniforms.uTime = { value: WCLOCK };
  if (WWIND != null) uniforms.uWind = { value: WWIND };
  uniforms.uMorph = morph;
  // ── PERF s25 hook (water agent): `wfast=3` (THE DEFAULT) = oceanfast.ts's restructured shaders built from these;
  // `?wfast=0` (or its anchors not found: fastOceanShaders returns null) = the reference shaders as they are ──
  const f3 = WFAST3 ? fastOceanShaders(OCEAN_VERT, OCEAN_FRAG, rippleMap, morph) : null;
  if (f3) Object.assign(uniforms, f3.uniforms);
  else if (WFAST3) perfSwitchNote('wfast', '0(fallback: anchors)'); // (the header prints what runs: the reference water)
  // ── end PERF s25 hook ──
  const m = new ShaderMaterial({
    vertexShader: WVDIAG ? (f3 ? f3.vert : OCEAN_VERT).replace(TERRAIN_VERT_CORE, VDIAG_CORE) : f3 ? f3.vert : OCEAN_VERT, // (s25c hook: wvdiag)
    fragmentShader: f3 ? f3.frag : OCEAN_FRAG,
    uniforms,
    depthWrite: true,
    depthTest: !WDEBUG.has('nodepth'),
    transparent: false,
  });
  m.extensions = { clipCullDistance: false, multiDraw: false } as ShaderMaterial['extensions'];
  return m;
}

export function makeWaterSceneUniforms(): Record<string, IUniform> {
  return {
    tSceneColor: { value: null }, tSceneDepth: { value: null }, uResolution: { value: new Vector2(1, 1) }, uWind: { value: 1 },
    tPrevColor: { value: null }, uPrevValid: { value: 0 }, uProj: { value: new Matrix4() }, uFrame: { value: 0 },
  };
}
