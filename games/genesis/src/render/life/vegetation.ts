// GENESIS — vegetation near the camera (CONTRACT.md §15.6): deterministic client-side scatter of real 3D trees and
// shrubs from the sim's `tree` / `shrub` / `burnt` fields, drawn as InstancedMeshes per (kind, variant, LOD).
//
//   * Placement: per sim cell, a fixed set of hashed candidates (cell id, index) inside the cell's footprint; a
//     candidate stands if a hash is below the INTERPOLATED cover at its point, so forest edges follow the field
//     smoothly. Height comes from groundHeight() — the sim's own (curved) ground function — so trunks meet the drawn
//     ground. Species from the sim's treeSpecies / shrubSpecies of one of the three cells around the point (weighted
//     by distance, so neighbouring stands mix at their borders) → form (plants.json: conifer, broadleaf, birch, palm,
//     acacia…) → mesh kind; height from the species' height range; foliage colour from its leaf colour, turning in
//     autumn for deciduous species; burnt → dead; climate is the fallback when a cell has no species. Every tree also
//     gets its own lean, girth and brightness. Cached per cell; the cache drops when the fields change.
//   * LOD: three meshes per kind by distance, CROSS-FADED: across a band at each LOD boundary a tree is drawn by both
//     LODs, the outgoing one losing metre-sized chunks of its crown (hashed in the tree's own space) while the incoming
//     one gains exactly the complementary chunks, trunks swapping at the middle — no pop, and no pixel dither (which
//     never resolves without TAA). Past the range the terrain's canopy shading takes over (the terrain material
//     receives the same range), and whole instances shrink into the ground across the hand-over band (and their
//     shadows with them).
//   * Shading: three's physical BRDF with this planet's sun (transmittance, cascaded + cloud shadows — the cloud
//     shadow per vertex, crowns overdraw too much for it per pixel), sky ambient, leaf translucency when the sun is
//     behind the crown, bark furrows in the normal, wind sway (gusting, per-tree phase, strength from the weather).
//     Per tree: snow on the branches, fire char (a past fire's scar or the fire burning there now), leaf fall of
//     deciduous species from late autumn to spring. Trees cast shadows.

import {
  Color, DoubleSide, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, ShaderMaterial, Vector3, Vector4,
  type IUniform,
} from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { hash32, hashFloat } from '../../sim/core/rng.ts';
import { SHRUB_KINDS, TREE_KINDS, treeGeometry, type TreeKind } from '../gen/treegen.ts';
import { BASE_PACK } from '../../data/index.ts';
import { leafClusterTexture } from '../gen/leaftex.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { CLOUD_DENSITY_GLSL } from '../sky/clouds.ts';
import { SHADOW_GLSL } from '../planet/lights.ts';
import { MOON_PARS, moonDirect } from '../shaders/moon.glsl.ts';

const KINDS: TreeKind[] = TREE_KINDS;
const K = (k: TreeKind): number => KINDS.indexOf(k);
const VARIANTS = 3;
const LODS = 3;
/** floats per cached plant: dir xyz, ground radius, yaw, height (m), kind, variant, species (-1 none), seed 0..1 */
const REC = 10;

/** plant species render data from the base content pack (indices match the sim's species fields) */
interface SpeciesLook { kind: number; layer: 'tree' | 'shrub' | 'sea'; hMin: number; hMax: number; tint: [number, number, number]; autumn: [number, number, number] | null; deciduous: boolean }
const srgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function hexLin(h: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!h || !/^#[0-9a-f]{6}$/i.test(h)) return fallback;
  const n = parseInt(h.slice(1), 16);
  return [srgbToLin(((n >> 16) & 255) / 255), srgbToLin(((n >> 8) & 255) / 255), srgbToLin((n & 255) / 255)];
}
/** linear colours of the atlas foliage each form's tint is relative to (leaftex.ts: sprays ~ #4a762c, needles ~ #325e36) */
const ATLAS_SPRAY = hexLin('#4a762c', [0.07, 0.18, 0.025]);
const ATLAS_NEEDLES = hexLin('#325e36', [0.03, 0.11, 0.037]);
const lumOf = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/**
 * Tint that turns the atlas foliage into a species' leaf colour: the ratio of CHROMATICITIES (hue / saturation),
 * clamped so a species can shift the green but never turn it cyan or magenta, times a clamped brightness ratio.
 */
function tintFor(leaf: [number, number, number], ref: [number, number, number]): [number, number, number] {
  const ll = Math.max(1e-4, lumOf(leaf)), lr = Math.max(1e-4, lumOf(ref));
  const k = Math.min(1.3, Math.max(0.75, ll / lr));
  const ch = (i: number) => Math.min(1.35, Math.max(0.72, (leaf[i] / ll) / Math.max(1e-4, ref[i] / lr)));
  return [ch(0) * k, ch(1) * k, ch(2) * k];
}
const SPECIES: SpeciesLook[] = (BASE_PACK.plants ?? []).map((pl) => {
  const f = String(pl.form ?? '');
  const id = String(pl.id ?? '');
  // the plant's form (plants.json) picks its mesh: trees by crown form, shrubs by habit
  const kind = f === 'conifer' || f === 'spruce' ? K('conifer') : f === 'birch' ? K('birch') : f === 'palm' ? K('palm')
    : f === 'acacia' || id === 'kapok' ? K('tropical') : f === 'baobab' ? K('baobab') : f === 'mangrove' ? K('mangrove')
      : f === 'willow' ? K('willow') : f === 'kelp' ? K('kelp') : f === 'cactus' ? K('cactus')
        : pl.type === 'tree' ? K('broadleaf')
          : id === 'berry-bush' ? K('berrybush') : f === 'fern' ? K('fern') : f === 'creeper' ? K('heather') : id === 'sagebrush' ? K('sage')
            : f === 'reed' ? K('reed') : K('shrub');
  const layer: SpeciesLook['layer'] = f === 'kelp' ? 'sea' : pl.type === 'tree' ? 'tree' : 'shrub';
  const ref = kind === K('conifer') ? ATLAS_NEEDLES : ATLAS_SPRAY;
  const t = tintFor(hexLin(pl.colors?.leaf, ref), ref);
  // autumn: the turned colour itself (deciduous only), allowed to leave green far behind
  let aT: [number, number, number] | null = null;
  if (pl.deciduous) {
    const autumn = hexLin(pl.colors?.leafAutumn ?? '#b8651e', [0.48, 0.13, 0.013]);
    const k = Math.min(1.3, Math.max(0.6, lumOf(autumn) / lumOf(ref))) * 0.8;
    aT = [Math.min(4, (autumn[0] / lumOf(autumn)) / (ref[0] / lumOf(ref)) * k), Math.min(4, (autumn[1] / lumOf(autumn)) / (ref[1] / lumOf(ref)) * k), Math.min(4, (autumn[2] / lumOf(autumn)) / (ref[2] / lumOf(ref)) * k)];
  }
  const [h0, h1] = pl.height ?? [8, 20];
  return { kind, layer, hMin: Math.max(0.1, Math.min(30, h0)), hMax: Math.max(0.3, Math.min(34, h1)), tint: t, autumn: aT, deciduous: !!pl.deciduous };
});

const VEG_VERT_PARS = /* glsl */ `
attribute float aWind;
attribute vec2 aLeafUv;
attribute float aCard;
attribute float aCrown;
attribute vec4 iExtra;        // snow on the branches, char, leaf loss (winter), LOD role (1 plain, 2/3 fading out across
                              // LOD boundary 0/1, 4/5 fading in; a missing attribute reads 1)
uniform float uWindK;         // wind strength from the weather (calm 0.3 … gale 2.5)
uniform vec4 uLodBand;        // LOD cross-fade bands (m from the camera): boundary 0 (x..y), boundary 1 (z..w)
varying vec4 vExtra;
varying vec2 vLod;            // visibility 0..1 in the LOD cross-fade, +1 fading out / −1 fading in
varying vec3 vLocalP;
uniform float uTime;
uniform vec3 uWindDir;
uniform vec3 uCamBody;
uniform vec2 uFade;          // (start, end) of the hand-over band, metres from the camera
varying vec3 vBodyPos;
varying float vLeaf;
varying vec2 vLeafUv;
varying float vCard;
varying float vLocalY;
varying float vCrown;
`;
/**
 * Cloud shadow per VERTEX (main pass only): the clouds' shadow is metres-to-kilometres wide, and evaluating the cloud
 * density per foliage fragment (crowns overdraw many layers) was the single largest cost of a forest view
 */
const VEG_VERT_CLOUD = /* glsl */ `
${NOISE_GLSL}
${ATMO_PARS}
${CLOUD_DENSITY_GLSL}
uniform samplerCube uCloudCov;
uniform vec2 uCloudShell;
uniform float uCloudOn;
uniform vec3 uSunDirBody;
varying float vCloudSh;
float vegCloudShadowV(vec3 P, vec3 sunB) {
  if (uCloudOn < 0.5) return 1.0;
  float mid = 0.5 * (uCloudShell.x + uCloudShell.y);
  vec2 hit = raySphere(P, sunB, mid);
  if (hit.y < 0.0) return 1.0;
  vec3 q = P + sunB * hit.y;
  vec2 cs = textureLod(uCloudCov, normalize(q), 0.0).rg;
  cl_fp = 0.0;
  return max(exp(-cloudDensityAt(q, 0.35, cs.x, cs.y, false) * (uCloudShell.y - uCloudShell.x) * 0.4), 0.3);
}
`;

/** alpha test for leaf cards, with Golus-style alpha sharpening so edges stay crisp at any mip; deciduous trees lose
 *  their leaves patch by patch through late autumn (vExtra.z) */
const LEAF_ALPHA = /* glsl */ `
  if (vLod.x < 0.999) {
    float lch = fract(sin(dot(floor(vLocalP * 5.0 + 0.37), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    if (vLod.y < 0.0) lch = 1.0 - lch;
    if (vCard > 0.25 ? lch > vLod.x : (vLod.y > 0.0 ? vLod.x < 0.5 : vLod.x <= 0.5)) discard;
  }
  if (vCard > 0.25 && vExtra.z > 0.0) {
    float lh = fract(sin(dot(floor(vLocalP * 9.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    if (lh < vExtra.z) discard;
  }
  if (vCard > 0.5) {
    vec4 lt = texture(uLeafTex, vLeafUv);
    // coarser mips average the sprays' alpha toward their coverage (< the test threshold): scale alpha up with the mip
    // level so distant crowns keep their foliage instead of dissolving into bare trunks
    vec2 ltx = vLeafUv * 512.0;
    vec2 ldx = dFdx(ltx), ldy = dFdy(ltx);
    float lmip = max(0.0, 0.5 * log2(max(dot(ldx, ldx), dot(ldy, ldy))));
    float lalpha = lt.a * (1.0 + lmip * 0.3);
    float la = (lalpha - 0.45) / max(fwidth(lalpha), 1e-4) + 0.5;
    if (la < 0.5) discard;
  }
`;
const VEG_WIND = /* glsl */ `
  vec3 transformed = vec3(position);
  {
    vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    // hand-over to the terrain's canopy shading: WHOLE trees sink and shrink into the ground across the band (a
    // per-pixel dither left clouds of loose leaf pixels and, without TAA, never resolved); the shadow pass uses the
    // same vertex code, so shadows fade with their trees
    float camD = distance(ip, uCamBody);
    float handover = smoothstep(uFade.x, uFade.y, camD);
    transformed *= 1.0 - handover;
    // LOD cross-fade: inside a band both LODs draw this tree, the outgoing one losing crown chunks as the incoming one
    // gains the complementary chunks (object-space, metres-sized: no pixel dither), trunks swap at the middle
    vLod = vec2(1.0, 1.0);
    if (iExtra.w > 1.5) {
      float role = iExtra.w;
      bool fadeIn = role > 3.5;
      float bnd = fadeIn ? role - 4.0 : role - 2.0;
      vec2 band = bnd < 0.5 ? uLodBand.xy : uLodBand.zw;
      float t = smoothstep(band.x, band.y, camD);
      vLod = vec2(fadeIn ? t : 1.0 - t, fadeIn ? -1.0 : 1.0);
      transformed *= step(0.002, vLod.x);
    }
    float ph = dot(ip, vec3(0.071, 0.113, 0.097));
    float gust = 0.55 + 0.45 * sin(uTime * 0.37 + ph * 0.2);
    float sway = (sin(uTime * 1.6 * (0.8 + 0.2 * uWindK) + ph) * 0.6 + sin(uTime * 2.9 + ph * 1.7) * 0.25) * gust;
    vec3 wl = vec3(dot(uWindDir, vec3(1.0, 0.0, 0.0)), 0.0, dot(uWindDir, vec3(0.0, 0.0, 1.0)));
    // the trees lean a little with the wind and sway more the stronger it blows (leaves flutter on top)
    transformed += (wl * (sway + 0.6 * (uWindK - 0.5)) * 0.035 * uWindK + vec3(sin(uTime * 4.1 + ph * 3.0 + position.y * 9.0), 0.0, cos(uTime * 3.7 + ph * 2.0)) * 0.006 * uWindK) * aWind * aWind;
    vExtra = iExtra;
    vLocalP = position;
  }
`;

const VEG_FRAG_PARS = /* glsl */ `
${NOISE_GLSL}
${ATMO_PARS}
${SKY_LOOKUP}
${CLOUD_DENSITY_GLSL}
${SHADOW_GLSL}
uniform mat3 uBodyToView;
uniform vec3 uSunDirBody;
uniform vec3 uSunDirView;
${MOON_PARS}uniform samplerCube uCloudCov;
uniform vec2 uCloudShell;
uniform float uCloudOn;
uniform vec3 uNightAmbient;
uniform sampler2D uLeafTex;
varying vec3 vBodyPos;
varying float vLeaf;
varying vec2 vLeafUv;
varying float vCard;
varying float vLocalY;
varying float vCrown;
varying vec4 vExtra;
varying vec2 vLod;
varying vec3 vLocalP;
varying float vCloudSh;
float vegCloudShadow(vec3 P, vec3 sunB) {
  if (uCloudOn < 0.5) return 1.0;
  float mid = 0.5 * (uCloudShell.x + uCloudShell.y);
  vec2 hit = raySphere(P, sunB, mid);
  if (hit.y < 0.0) return 1.0;
  vec3 q = P + sunB * hit.y;
  vec2 cs = texture(uCloudCov, normalize(q)).rg;
  return max(exp(-cloudDensityAt(q, 0.35, cs.x, cs.y, false) * (uCloudShell.y - uCloudShell.x) * 0.4), 0.3);
}
`;

const VEG_LIGHT = /* glsl */ `
  {
    float rP = length(vBodyPos);
    vec3 upB = vBodyPos / rP;
    float sh = sunShadow(-vViewPosition, normal);
    // the crown shades itself: interior foliage (and bark inside the crown) sees less sun than the outer shell
    float crownDirect = mix(0.55, 1.0, smoothstep(0.35, 0.95, vCrown));
    vec3 sunCol = uSunE * sunTransmittance(rP, dot(upB, uSunDirBody)) * sh * vCloudSh * crownDirect;
    IncidentLight sunL;
    sunL.direction = uSunDirView;
    sunL.color = sunCol;
    sunL.visible = true;
    RE_Direct(sunL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    ${moonDirect('vBodyPos', 'crownDirect')}
    // leaves let light through: a forward-scattering glow when the sun is behind the crown
    float back = pow(max(dot(-geometryViewDir, uSunDirView), 0.0), 3.0);
    float wrap = max(0.0, dot(-geometryNormal, uSunDirView) * 0.5 + 0.5);
    // (leaves pass on ~10–25 % of the light, warmed toward yellow-green; not a neon glow)
    reflectedLight.directDiffuse += sunCol * diffuseColor.rgb * vec3(0.95, 1.05, 0.55) * (back * 0.55 + wrap * 0.14) * vLeaf;
  }
`;
const VEG_AMBIENT = /* glsl */ `
  {
    vec3 upB = normalize(vBodyPos);
    vec3 nB = normalize(transpose(uBodyToView) * normal);
    vec3 e = skyIrradiance(upB, nB, uSunDirBody) + uNightAmbient;
    // under a closed canopy the trunks and the lower, inner crowns see little open sky, and what they see comes
    // through leaves (green); in the open the sky is all around (a forest's inside was lit like a meadow)
    float canopy = clamp(fract(vExtra.w) * 2.5, 0.0, 1.0);
    float under = vLeaf < 0.5 ? 1.0 : 1.0 - smoothstep(0.4, 0.9, vCrown);
    e *= mix(vec3(1.0), vec3(0.34, 0.42, 0.28), canopy * under);
    // crown AO (cheap volumetric occlusion from the baked crown depth); the sky enters once (see terrainmat FRAG_AMBIENT)
    iblIrradiance += e * mix(0.45, 1.0, smoothstep(0.3, 0.95, vCrown));
  }
`;

/** the vegetation material (also used by the near-camera ground cover, render/life/groundcover.ts, with its own band) */
export function makeVegMaterial(shared: Record<string, IUniform>, fade: IUniform<{ x: number; y: number }>, leafTex: IUniform): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: DoubleSide });
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(shared)) shader.uniforms[k] = shared[k];
    shader.uniforms.uFade = fade;
    shader.uniforms.uLeafTex = leafTex;
    shader.uniforms.uWindK = WIND_K;
    shader.uniforms.uLodBand = LOD_BAND;
    shader.vertexShader = shader.vertexShader
      .replace('#include <clipping_planes_pars_vertex>', `#include <clipping_planes_pars_vertex>\n${VEG_VERT_PARS}\n${VEG_VERT_CLOUD}`)
      .replace('#include <begin_vertex>', VEG_WIND)
      .replace('#include <color_vertex>', `
  // aCard: 0 bark, 0.5 solid foliage (conifer core), 1 alpha-tested spray. The instance colour is the FOLIAGE tint
  // (species, season, per-tree shift): bark only takes its brightness, so autumn never paints the trunks orange.
  vColor = vec4(1.0);
  vColor.xyz *= color.xyz;
#ifdef USE_INSTANCING_COLOR
  float leafy = step(0.25, aCard);
  vColor.xyz *= mix(vec3(dot(instanceColor.xyz, vec3(0.3, 0.55, 0.15))), instanceColor.xyz, leafy);
#endif`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n  vBodyPos = (instanceMatrix * vec4(transformed, 1.0)).xyz;\n  vCloudSh = vegCloudShadowV(vBodyPos, uSunDirBody);\n  vLeaf = step(0.25, aCard);\n  vLeafUv = aLeafUv;\n  vCard = aCard;\n  vLocalY = position.y;\n  vCrown = aCrown;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${VEG_FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${LEAF_ALPHA}
  if (vCard > 0.5) diffuseColor.rgb *= texture(uLeafTex, vLeafUv).rgb * 1.7;
  // leaf clusters: cellular light / dark speckle on foliage (fading with distance), bark furrows on trunks
  float vegFw = length(fwidth(vBodyPos));
  float leafAA = 1.0 - smoothstep(0.08, 0.35, vegFw * 2.2);
  // (the cellular speckle only where it is resolved, and not on the textured spray cards)
  vec3 lv = vLeaf > 0.5 && vCard < 0.75 && leafAA > 0.001 ? voronoi3(vBodyPos * 2.2) : vec3(0.5, 0.7, 0.5);
  float leafTex = mix(0.92, 0.62 + 0.62 * (1.0 - lv.x) * (0.7 + 0.6 * lv.z), leafAA);
  // bark: furrows running along the stem (mesh-local: the trunk is the local Y axis), in colour and in the normal
  float barkAA = 1.0 - smoothstep(0.02, 0.12, vegFw);
  float barkH = abs(snoise(vec3(vLocalP.x * 55.0, vLocalP.y * 5.0, vLocalP.z * 55.0)));
  float barkTex = mix(0.92, 0.7 + 0.42 * barkH, barkAA);
  diffuseColor.rgb *= vCard > 0.5 ? 1.0 : mix(barkTex, leafTex, vLeaf);
  // no bark is paler than weathered grey wood (bright trunks read as white posts in the sun)
  if (vLeaf < 0.5) diffuseColor.rgb = min(diffuseColor.rgb, vec3(0.24, 0.22, 0.2));
  // trunk bases sink into the ground: soil, moss and shade creep up the lowest metre instead of a clean cut
  if (vLeaf < 0.5) {
    float baseW = 1.0 - smoothstep(-0.01, 0.045, vLocalY);
    vec3 soilC = mix(vec3(0.055, 0.045, 0.032), vec3(0.04, 0.055, 0.025), smoothstep(0.3, 0.7, snoise(vBodyPos * 1.7) * 0.5 + 0.5));
    diffuseColor.rgb = mix(diffuseColor.rgb, soilC, baseW * 0.8);
  }
  float vegBump = mix(barkH * 0.035 * barkAA, (1.0 - lv.x) * 0.25 * leafAA, vLeaf);
  // charred bark (fire scars), snow lying on the upward faces of branches and foliage
  if (vLeaf < 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.018, 0.016), vExtra.y);
  if (vExtra.x > 0.0) {
    vec3 upS = normalize(vBodyPos);
    vec3 nS = normalize(transpose(uBodyToView) * normalize(vNormal));
    float lie = smoothstep(0.05, 0.55, abs(dot(nS, upS))) * (0.7 + 0.3 * snoise(vBodyPos * 3.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.8, 0.85), clamp(vExtra.x * lie, 0.0, 0.9));
  }`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
  // foliage normals are bent outward from the crown on BOTH faces: never flip them for back faces (dark crowns)
  if (vLeaf > 0.5) { normal = normalize(vNormal); nonPerturbedNormal = normal; }`)
      .replace('#include <normal_fragment_maps>', `{
    vec3 sx = dFdx(-vViewPosition); vec3 sy = dFdy(-vViewPosition);
    vec2 dh = vec2(dFdx(vegBump), dFdy(vegBump));
    vec3 r1 = cross(sy, normal); vec3 r2 = cross(normal, sx);
    float det = dot(sx, r1);
    vec3 bn = abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2);
    float bl = length(bn);
    if (bl > 1e-20 && !isnan(bl)) normal = bn / bl;
  }`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${VEG_LIGHT}`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${VEG_AMBIENT}`);
  };
  mat.customProgramCacheKey = () => 'genesis-veg-v7';
  return mat;
}

/** wind strength shared by every vegetation material (set from the weather at the camera each frame) */
export const WIND_K: IUniform<number> = { value: 0.8 };
/** LOD cross-fade bands (set per frame from the vegetation range) */
export const LOD_BAND: IUniform<Vector4> = { value: new Vector4(51, 69, 140, 179) };

const VEG_DEPTH_VERT = /* glsl */ `
#include <common>
${VEG_VERT_PARS}
#include <logdepthbuf_pars_vertex>
void main() {
${VEG_WIND}
#include <project_vertex>
  vLeafUv = aLeafUv;
  vCard = aCard;
#include <logdepthbuf_vertex>
}
`;
const VEG_DEPTH_FRAG = /* glsl */ `
uniform sampler2D uLeafTex;
varying vec2 vLeafUv;
varying float vCard;
varying vec4 vExtra;
varying vec2 vLod;
varying vec3 vLocalP;
#include <logdepthbuf_pars_fragment>
void main() {
#include <logdepthbuf_fragment>
${LEAF_ALPHA}
  gl_FragColor = vec4(1.0);
}
`;

interface Bucket { mesh: InstancedMesh; depth: ShaderMaterial; count: number; kind: number; variant: number; lod: number; extra: InstancedBufferAttribute }

const SHRUB = KINDS.indexOf('shrub');
const IS_SHRUB = KINDS.map((k) => SHRUB_KINDS.includes(k));
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _m = new Matrix4();
const _c = new Color();
const _v = new Vector3();

export class Vegetation {
  readonly group = new Group();
  private buckets: Bucket[] = [];
  private cache = new Map<number, Float32Array>();
  private stamp = '';
  private lastCam = new Vector3(1e9, 0, 0);
  private lastFrame = -1e9;
  private material: MeshStandardMaterial;
  readonly fade: IUniform<{ x: number; y: number }> = { value: { x: 300, y: 400 } };
  /** metres: full-detail range (the terrain canopy shading takes over beyond) */
  range = 380;
  density = 1;
  /** calendar year fraction (seasonal foliage colour) — set by the planet visual each frame */
  yearFrac = 0;
  private seasonStep = -1;
  enabled = true;
  castShadows = false;
  stats = { instances: 0, cells: 0 };
  private shared: Record<string, IUniform>;

  constructor(shared: Record<string, IUniform>) {
    this.shared = shared;
    this.group.name = 'vegetation';
    this.group.matrixAutoUpdate = false;
    const leafTex: IUniform = { value: leafClusterTexture() };
    this.material = makeVegMaterial(shared, this.fade, leafTex);
    const depthUniforms = { uTime: shared.uTime, uWindDir: shared.uWindDir, uLeafTex: leafTex, uCamBody: shared.uCamBody, uFade: this.fade, uWindK: WIND_K, uLodBand: LOD_BAND };
    for (let k = 0; k < KINDS.length; k++) {
      for (let v = 0; v < VARIANTS; v++) {
        for (let l = 0; l < LODS; l++) {
          const geo = treeGeometry(KINDS[k], l, v);
          const shrubby = SHRUB_KINDS.includes(KINDS[k]);
          const cap = (l === 0 ? 1200 : l === 1 ? 3000 : 6000) * (shrubby ? 1 : 1);
          const extra = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
          extra.setUsage(DynamicDrawUsage);
          geo.setAttribute('iExtra', extra);
          const mesh = new InstancedMesh(geo, this.material, cap);
          mesh.instanceMatrix.setUsage(DynamicDrawUsage);
          mesh.count = 0;
          mesh.frustumCulled = false;
          mesh.matrixAutoUpdate = false;
          const depth = new ShaderMaterial({ vertexShader: VEG_DEPTH_VERT, fragmentShader: VEG_DEPTH_FRAG, uniforms: depthUniforms, colorWrite: false, side: DoubleSide });
          this.buckets.push({ mesh, depth, count: 0, kind: k, variant: v, lod: l, extra });
          this.group.add(mesh);
        }
      }
    }
  }

  setShadowCasting(on: boolean): void {
    if (on === this.castShadows) return;
    this.castShadows = on;
    for (const b of this.buckets) { if (on) b.mesh.layers.enable(1); else b.mesh.layers.disable(1); }
  }

  swapDepth(depth: boolean): void {
    for (const b of this.buckets) b.mesh.material = depth ? b.depth : this.material;
  }

  /** plants of one cell (cached) */
  private cellPlants(pv: PlanetView, c: number): Float32Array {
    let rec = this.cache.get(c);
    if (rec) return rec;
    const g = pv.grid;
    const R = pv.params.radius;
    const tree = pv.fields.get('tree'), shrub = pv.fields.get('shrub'), burnt = pv.fields.get('burnt');
    const water = pv.fields.get('water'), temp = pv.fields.get('temperature'), moist = pv.fields.get('moisture');
    const snow = pv.fields.get('snow'), crop = pv.fields.get('crop'), road = pv.fields.get('road'), sand = pv.fields.get('sand');
    const treeSp = pv.fields.get('treeSpecies'), shrubSp = pv.fields.get('shrubSpecies');
    const tc = tree ? tree[c] : 0, sc = shrub ? shrub[c] : 0;
    const out: number[] = [];
    // kelp forests on the sea floor (the cell's dominant "tree" species is kelp, under a few metres of water)
    if (water && water[c] > 2.5 && treeSp && treeSp[c] >= 0) {
      const lk = SPECIES[Math.round(treeSp[c])];
      if (lk && lk.layer === 'sea') {
        const area = g.area[c] * R * R;
        const n = Math.ceil((area / 140) * this.density * Math.min(1, tc + 0.3));
        const P = g.pos;
        for (let i = 0; i < n; i++) {
          let dx = P[c * 3], dy = P[c * 3 + 1], dz = P[c * 3 + 2];
          const a = hashFloat(c, i, 501) * Math.PI * 2, rr = Math.sqrt(hashFloat(c, i, 502)) * Math.sqrt(area) * 0.6 / R;
          let ex = dz, ez = -dx;
          const el = Math.hypot(ex, ez) || 1; ex /= el; ez /= el;
          const nx = dy * ez, ny = dz * ex - dx * ez, nz = -dy * ex;
          dx += (ex * Math.cos(a) + nx * Math.sin(a)) * rr; dy += ny * Math.sin(a) * rr; dz += (ez * Math.cos(a) + nz * Math.sin(a)) * rr;
          const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
          const depth = g.sample(water, dx, dy, dz);
          if (depth < 2) continue;
          const h = Math.min(lk.hMax, depth * (0.6 + 0.35 * hashFloat(c, i, 503)));
          out.push(dx, dy, dz, groundHeight(pv.ground, dx, dy, dz), hashFloat(c, i, 504) * 6.28, h, K('kelp'), hash32(c, i, 505) % VARIANTS, Math.round(treeSp[c]), hashFloat(c, i, 506));
        }
      }
    }
    if ((tc > 0.02 || sc > 0.02) && !(water && water[c] > 1)) {
      const area = g.area[c] * R * R;
      const spacing = Math.sqrt(area);
      const P = g.pos;
      const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
      // tangent frame of the cell
      let ex = cz, ez = -cx;
      const el = Math.hypot(ex, ez) || 1;
      ex /= el; ez /= el;
      const nx = cy * ez, ny = cz * ex - cx * ez, nz = -cy * ex;
      const nTree = Math.ceil((area / 55) * this.density * Math.min(1, tc * 1.3 + 0.05));
      const nShrub = Math.ceil((area / 70) * this.density * Math.min(1, sc * 1.4 + 0.05));
      // understory: shrubs (and ferny scrub) under a closed canopy, so a forest is not a fence of trunks on bare floor
      const nUnder = tc > 0.45 ? Math.ceil((area / 95) * this.density * Math.min(1, (tc - 0.45) * 2)) : 0;
      const R0 = R;
      const place = (i: number, salt: number, isShrub: boolean, under = false): void => {
        const h1 = hashFloat(c, i, salt), h2 = hashFloat(c, i, salt + 1), h3 = hashFloat(c, i, salt + 2);
        const a = h1 * Math.PI * 2;
        const rr = Math.sqrt(h2) * spacing * 0.62;
        const ox = (Math.cos(a) * ex + Math.sin(a) * nx) * rr / R;
        const oy = (Math.sin(a) * ny) * rr / R;
        const oz = (Math.cos(a) * ez + Math.sin(a) * nz) * rr / R;
        let dx = cx + ox, dy = cy + oy, dz = cz + oz;
        const l = Math.hypot(dx, dy, dz);
        dx /= l; dy /= l; dz /= l;
        const hit = g.locate(dx, dy, dz);
        const at = (f: Float32Array | undefined) => (f ? f[hit.a] * hit.wa + f[hit.b] * hit.wb + f[hit.c] * hit.wc : 0);
        // groves and clearings: a ~45 m clumping noise modulates the acceptance (mean ≈ 1), so stands cluster
        // instead of filling the field's area evenly
        const fq = R0 / 45;
        const clump = Math.min(1.6, Math.max(0.15, 1 + 1.1 * pv.noise.noise(dx * fq + 3.3, dy * fq, dz * fq - 1.7)));
        const cover = (under ? at(tree) * 0.7 : isShrub ? at(shrub) : at(tree)) * (under ? 1 : clump);
        if (h3 > cover) return;
        if (at(water) > 0.05 || at(road) > 0.45 || at(crop) > 0.4 || at(snow) > 1.2 || at(sand) > 0.5) return;
        const t = at(temp), m = at(moist), b = at(burnt);
        // species: one of the three cells around the point, chosen by its weight (stands mix along their borders)
        const hs4 = hashFloat(c, i, salt + 6);
        const pick = hs4 < hit.wa ? hit.a : hs4 < hit.wa + hit.wb ? hit.b : hit.c;
        const spf = isShrub ? shrubSp : treeSp;
        let sp = spf ? Math.round(spf[pick]) : -1;
        if (sp < 0 && spf) sp = Math.round(spf[c]);
        let look = sp >= 0 && sp < SPECIES.length ? SPECIES[sp] : null;
        if (look && look.layer === 'sea') return; // kelp grows under the sea, placed above
        // a species of the wrong functional type for this layer (a mod, a stale index) is ignored, not obeyed
        if (look && (look.layer === 'shrub') !== isShrub) look = null;
        let kind: number;
        if (isShrub) kind = b > 0.6 ? K('burnt') : look ? look.kind : K('shrub');
        else if (b > 0.5) kind = K('burnt');
        else if (look) kind = look.kind;
        else if (t < 3 + hashFloat(c, i, 9) * 6) kind = K('conifer');
        else if (t > 23 && m > 0.7) kind = K('tropical');
        else kind = K('broadleaf');
        const hs = hashFloat(c, i, salt + 3);
        let height: number;
        if (look) height = look.hMin + (look.hMax - look.hMin) * Math.pow(hs, 1.4);
        else height = kind === K('conifer') ? 8 + hs * hs * 16 : kind === K('tropical') ? 14 + hs * 12 : kind === K('dead') || kind === K('burnt') ? 6 + hs * 8 : IS_SHRUB[kind] ? 1.1 + hs * 1.8 : 7 + hs * hs * 12;
        // burnt shrubs are stumps of what they were
        if (isShrub && kind === K('burnt')) height = Math.min(height, 2.5);
        // young trees at a forest's edge: the thinner the cover, the smaller the trees; ±20 % from tree to tree
        if (!isShrub) height *= (0.7 + 0.3 * Math.min(1, cover * 1.4)) * (0.8 + 0.4 * hashFloat(c, i, salt + 8));
        else if (under) height *= 0.6 + 0.5 * hashFloat(c, i, salt + 8);
        const gr = groundHeight(pv.ground, dx, dy, dz);
        out.push(dx, dy, dz, gr, hashFloat(c, i, salt + 4) * Math.PI * 2, height, kind, hash32(c, i, salt + 5) % VARIANTS, look ? sp : -1, hashFloat(c, i, salt + 7));
      };
      for (let i = 0; i < nTree; i++) place(i, 11, false);
      for (let i = 0; i < nShrub; i++) place(i, 71, true);
      for (let i = 0; i < nUnder; i++) place(i, 131, true, true);
    }
    rec = Float32Array.from(out);
    this.cache.set(c, rec);
    return rec;
  }

  /**
   * Refresh instances around the camera. `camBody` is the camera in the body frame (m); returns quickly when the
   * camera has not moved much (instances stay valid: they live in the body frame).
   */
  update(pv: PlanetView, camBody: Vector3, frame: number): void {
    // wind strength at the camera from the sim's wind field (lookdev has none: a light breeze)
    {
      const wx = pv.fields.get('windX'), wy = pv.fields.get('windY'), wz = pv.fields.get('windZ');
      const cl = camBody.length() || 1;
      let speed = 3;
      if (wx && wy && wz) {
        const ux = camBody.x / cl, uy = camBody.y / cl, uz = camBody.z / cl;
        speed = Math.hypot(pv.grid.sample(wx, ux, uy, uz), pv.grid.sample(wy, ux, uy, uz), pv.grid.sample(wz, ux, uy, uz));
      }
      const want = Math.min(2.5, Math.max(0.3, 0.35 + speed / 7));
      WIND_K.value += (want - WIND_K.value) * 0.02;
    }
    const stamp = `${pv.fieldVersion.get('tree') ?? 0}|${pv.fieldVersion.get('shrub') ?? 0}|${pv.fieldVersion.get('surface') ?? 0}|${pv.fieldVersion.get('burnt') ?? 0}|${pv.fieldVersion.get('treeSpecies') ?? 0}|${this.density}`;
    // a season step re-tints the instances (autumn colour) without re-scattering them
    const season = Math.floor(this.yearFrac * 48);
    if (season !== this.seasonStep) { this.seasonStep = season; this.lastFrame = -1e9; }
    if (stamp !== this.stamp) { this.stamp = stamp; this.cache.clear(); this.lastFrame = -1e9; }
    const R = pv.params.radius;
    const rc = camBody.length();
    const alt = rc - R - Math.max(0, pv.maxSurface * 0.5);
    const range = this.range;
    this.fade.value.x = range * 0.72;
    this.fade.value.y = range;
    const visible = this.enabled && alt < range * 1.2;
    this.group.visible = visible;
    if (!visible) { this.stats.instances = 0; return; }
    const moved = camBody.distanceTo(this.lastCam);
    if (moved < range * 0.04 && frame - this.lastFrame < 240) return;
    this.lastCam.copy(camBody);
    this.lastFrame = frame;
    // gather from the cells around the point under the camera
    const dx = camBody.x / rc, dy = camBody.y / rc, dz = camBody.z / rc;
    const cells = pv.grid.cellsWithin(dx, dy, dz, (range + 60) / R);
    for (const b of this.buckets) b.count = 0;
    const lod0 = range * 0.16, lod1 = range * 0.42;
    const b0a = lod0 * 0.85, b0b = lod0 * 1.15, b1a = lod1 * 0.88, b1b = lod1 * 1.12;
    LOD_BAND.value.set(b0a, b0b, b1a, b1b);
    // the camera moves up to range * 0.04 before the next rebuild: trees that may enter a band by then draw in both LODs
    const M = range * 0.04 + 2;
    // autumn at the camera's latitude (northern autumn at year fraction 0.5–0.75, southern half a year later)
    const yfH = dy >= 0 ? this.yearFrac : (this.yearFrac + 0.5) % 1;
    const autumn = smooth(0.5, 0.6, yfH) * (1 - smooth(0.74, 0.8, yfH));
    // leaf fall: from the end of autumn through winter, leafing out again early in spring
    const winterK = yfH >= 0.5 ? smooth(0.72, 0.8, yfH) : 1 - smooth(0.06, 0.14, yfH);
    const snowF = pv.fields.get('snow'), burntF = pv.fields.get('burnt'), fireF = pv.fields.get('fire'), treeF = pv.fields.get('tree');
    let total = 0;
    for (const c of cells) {
      const rec = this.cellPlants(pv, c);
      for (let i = 0; i < rec.length; i += REC) {
        const gr = rec[i + 3];
        _v.set(rec[i] * gr, rec[i + 1] * gr, rec[i + 2] * gr);
        const d = _v.distanceTo(camBody);
        const kind = rec[i + 6];
        const maxD = IS_SHRUB[kind] ? range * 0.45 : range;
        if (d > maxD) continue;
        // LOD (and role in a cross-fade band): [lod, role, lod, role] — role 1 plain, 2/3 out, 4/5 in
        const base = (kind * VARIANTS + rec[i + 7]) * LODS;
        let la = 0, ra = 1, lb = -1, rb = 1;
        if (d < b0a - M) { la = 0; }
        else if (d <= b0b + M) { la = 0; ra = 2; lb = 1; rb = 4; }
        else if (d < b1a - M) { la = 1; }
        else if (d <= b1b + M) { la = 1; ra = 3; lb = 2; rb = 5; }
        else { la = 2; }
        const bA = this.buckets[base + la];
        const bB = lb >= 0 ? this.buckets[base + lb] : null;
        if (bA.count >= bA.mesh.instanceMatrix.count || (bB && bB.count >= bB.mesh.instanceMatrix.count)) continue;
        const seed = rec[i + 9];
        // basis: up = the radial direction tilted by this tree's own lean (≤ ~5°), yaw about it, scale = height
        let ux = rec[i], uy = rec[i + 1], uz = rec[i + 2];
        let ex = uz, ez = -ux;
        const el = Math.hypot(ex, ez) || 1;
        ex /= el; ez /= el;
        let nx = uy * ez, ny = uz * ex - ux * ez, nz = -uy * ex;
        {
          const la = seed * 40.0, lt = Math.tan(0.09 * ((seed * 7.31) % 1));
          ux += (ex * Math.cos(la) + nx * Math.sin(la)) * lt;
          uy += (ny * Math.sin(la)) * lt;
          uz += (ez * Math.cos(la) + nz * Math.sin(la)) * lt;
          const ul = Math.hypot(ux, uy, uz);
          ux /= ul; uy /= ul; uz /= ul;
          // re-orthogonalise the tangent frame around the leaning up
          const ed = ex * ux + ez * uz;
          let fx = ex - ux * ed, fy = -uy * ed, fz = ez - uz * ed;
          const fl = Math.hypot(fx, fy, fz) || 1;
          fx /= fl; fy /= fl; fz /= fl;
          ex = fx; ez = fz;
          nx = uy * fz - uz * fy; ny = uz * fx - ux * fz; nz = ux * fy - uy * fx;
          const ey0 = fy;
          const cy = Math.cos(rec[i + 4]), sy = Math.sin(rec[i + 4]);
          const ax = ex * cy + nx * sy, ay = ey0 * cy + ny * sy, az = ez * cy + nz * sy;
          // right-handed: Z = X × Y (a mirrored basis would flip the winding and cull every tree)
          const bx = ay * uz - az * uy, by = az * ux - ax * uz, bz = ax * uy - ay * ux;
          const s = rec[i + 5];
          // girth varies independently of height: some trees stocky, some slender
          const sx = s * (0.82 + 0.36 * ((seed * 13.7) % 1));
          _m.set(
            ax * sx, ux * s, bx * sx, _v.x - rec[i] * 0.25,
            ay * sx, uy * s, by * sx, _v.y - rec[i + 1] * 0.25,
            az * sx, uz * s, bz * sx, _v.z - rec[i + 2] * 0.25,
            0, 0, 0, 1,
          );
        }
        // foliage tint (the shader applies it to leaves only): species colour, autumn for deciduous species, and a
        // per-tree brightness and yellow-green ↔ blue-green shift so a forest is never one colour
        const sp = rec[i + 8];
        const look = sp >= 0 ? SPECIES[sp] : null;
        let tr = 1, tg = 1, tbl = 1;
        if (look) { tr = look.tint[0]; tg = look.tint[1]; tbl = look.tint[2]; }
        if (look?.autumn && !IS_SHRUB[kind]) {
          const turn = Math.min(1, autumn * (0.55 + 0.9 * ((seed * 3.3) % 1)));
          tr += (look.autumn[0] - tr) * turn; tg += (look.autumn[1] - tg) * turn; tbl += (look.autumn[2] - tbl) * turn;
        }
        // per tree: value ±20 %, a yellow-green ↔ blue-green hue shift of ±6 %
        const th = (seed * 17.9) % 1;
        const tb = 0.8 + 0.4 * ((seed * 5.77) % 1);
        _c.setRGB(tr * tb * (0.94 + 0.12 * th), tg * tb, tbl * tb * (1.06 - 0.12 * th));
        // per tree: snow on the branches (the ground's snow cover), fire char near burnt ground, leaf fall of
        // deciduous species through late autumn into winter (bare in winter, leafing again in spring)
        const ux0 = rec[i], uy0 = rec[i + 1], uz0 = rec[i + 2];
        const snowA = snowF ? Math.min(1, pv.grid.sample(snowF, ux0, uy0, uz0) / 0.25) : 0;
        // char from the scar of a past fire, or the fire burning here now
        const charA = Math.min(0.9, Math.max(burntF ? (pv.grid.sample(burntF, ux0, uy0, uz0) - 0.15) * 1.6 : 0, fireF ? pv.grid.sample(fireF, ux0, uy0, uz0) * 0.85 : 0, 0));
        const leafless = look?.deciduous && !IS_SHRUB[kind] ? Math.min(1, winterK * (0.7 + 0.6 * ((seed * 9.1) % 1))) : 0;
        // the canopy around it (0..1, carried in the role's fraction: the role is an integer 1..5): under a closed
        // canopy the trunks and lower crown see little sky
        const canopy = treeF ? Math.min(1, Math.max(0, (pv.grid.sample(treeF, ux0, uy0, uz0) - 0.3) / 0.5)) : 0;
        for (const [b, role] of bB ? [[bA, ra], [bB, rb]] as const : [[bA, ra]] as const) {
          b.extra.setXYZW(b.count, snowA, kind === K('burnt') ? 0 : charA, leafless, role + canopy * 0.4);
          b.mesh.setColorAt(b.count, _c);
          b.mesh.setMatrixAt(b.count++, _m);
        }
        total++;
      }
    }
    for (const b of this.buckets) {
      b.mesh.count = b.count;
      b.mesh.visible = b.count > 0;
      if (b.count) {
        b.mesh.instanceMatrix.needsUpdate = true;
        if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
        b.extra.needsUpdate = true;
      }
    }
    this.stats.instances = total;
    this.stats.cells = cells.length;
  }

  dispose(): void {
    for (const b of this.buckets) { b.mesh.dispose(); b.depth.dispose(); }
    this.material.dispose();
  }
}
