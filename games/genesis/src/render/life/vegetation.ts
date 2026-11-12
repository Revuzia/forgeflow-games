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

import { uploadPrefix } from '../upload.ts';
import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, ShaderMaterial, Vector3, Vector4,
  type IUniform, type Texture,
} from 'three';
import { FAR_HULL_TEXELS, farHullTable } from './farcrown.ts';
import type { PlanetView } from '../../client/worldview.ts';
import type { BuildingBlock } from '../../sim/types.ts';
import { buildingAt } from './catalog.ts';
import { towerClearings } from './tower.ts';
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
import { GOD_WIND } from '../camera/avatar.ts';
import { perfSwitch } from '../perfswitch.ts';

const KINDS: TreeKind[] = TREE_KINDS;
const K = (k: TreeKind): number => KINDS.indexOf(k);
const VARIANTS = 3;
const LODS = 3;
/** floats per cached plant: dir xyz, ground radius, yaw, height (m), kind, variant, species (-1 none), seed 0..1 */
const REC = 10;

/** plant species render data from the base content pack (indices match the sim's species fields) */
interface SpeciesLook {
  kind: number; layer: 'tree' | 'shrub' | 'sea'; hMin: number; hMax: number; tint: [number, number, number]; autumn: [number, number, number] | null; deciduous: boolean;
  /** when its fruit hangs (plants.json fruit.season, fractions of the local year; the fruit is shown from a little
   *  before it ripens), or null: no fruit drawn */
  fruit: [number, number] | null;
  /** standing water (m) a tree of this species stands in (plants.json water[1] for shore / water trees: mangroves); 0 = dry land only */
  wetMax: number;
}
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
type PlantDef = NonNullable<typeof BASE_PACK.plants>[number];
function speciesLook(pl: PlantDef): SpeciesLook {
  const f = String(pl.form ?? '');
  const id = String(pl.id ?? '');
  // the plant's form (plants.json) picks its mesh: trees by crown form, shrubs by habit; the fruit trees by species
  const kind = id === 'apple' ? K('apple') : id === 'olive' ? K('olive') : id === 'fig' ? K('fig') : id === 'date-palm' ? K('datepalm')
    : f === 'conifer' || f === 'spruce' ? K('conifer') : f === 'birch' ? K('birch') : f === 'palm' ? K('palm')
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
  const fs = (pl as { fruit?: { season?: [number, number] } }).fruit?.season;
  const fruit: [number, number] | null = Array.isArray(fs) && fs.length === 2 ? [Number(fs[0]) - 0.08, Number(fs[1]) + 0.03] : null;
  // (PERF s13: a mangrove stand in the sea shallows was never scattered — every point in water was refused — so the
  // sim's tree cover there showed only as dark shapes under the sheet; shore / water trees now stand in their water)
  const pw = (pl as { water?: [number, number]; habitat?: string }).water, hab = (pl as { habitat?: string }).habitat;
  const wetMax = layer === 'tree' && (hab === 'shore' || hab === 'water') && Array.isArray(pw) ? Math.max(0, Number(pw[1]) || 0) : 0;
  return { kind, layer, hMin: Math.max(0.1, Math.min(30, h0)), hMax: Math.max(0.3, Math.min(34, h1)), tint: t, autumn: aT, deciduous: !!pl.deciduous, fruit, wetMax };
}
const BASE_PLANTS = BASE_PACK.plants ?? [];
const SPECIES: SpeciesLook[] = BASE_PLANTS.map(speciesLook);
/** listeners told the live plant list (base + added) after setPlantRegistry: ground cover rebuilds its crop table */
/** the look drawn for plants.json index `i` (base or added; null past the list) */
export function plantLookOf(i: number): Readonly<SpeciesLook> | null { return SPECIES[i] ?? null; }
export const PLANT_REGISTRY_LISTENERS: ((plants: readonly PlantDef[]) => void)[] = [];
let registrySig = '';

/**
 * H12: the plants the sim knows beyond the base pack (mods, and plants invented in play) — the 'content' query's
 * `plants` ({ index, ...def }, in the sim's own index order). An invented tree or crop then draws with its own form,
 * colours, height and fruit instead of a stand-in (the climate's default tree, or wheat), and the vegetation and
 * ground-cover caches rebuild. Call it again whenever the content changes; an unchanged list is a no-op.
 */
export function setPlantRegistry(added: readonly unknown[] | null | undefined): void {
  const list = BASE_PLANTS.slice() as PlantDef[];
  for (const e of added ?? []) {
    const d = e as PlantDef & { index?: unknown };
    if (!d || typeof d !== 'object' || typeof d.id !== 'string') continue;
    const i = Number(d.index);
    if (!Number.isInteger(i) || i < BASE_PLANTS.length || i > 4096) continue;
    list[i] = d;
  }
  for (let i = 0; i < list.length; i++) list[i] ??= BASE_PLANTS[0];
  const sig = list.slice(BASE_PLANTS.length).map((p) => JSON.stringify(p)).join('\n');
  if (sig === registrySig) return;
  registrySig = sig;
  SPECIES.length = 0;
  for (const pl of list) SPECIES.push(speciesLook(pl));
  for (const fn of PLANT_REGISTRY_LISTENERS) fn(list);
  PLANT_PROBE.version++;
}

/**
 * Dev / shot probe (window.__GENESIS_LIFE__.plants; empty in play): remap tree and crop species indices at draw time,
 * so a scripted shot can show the fruit trees or the newer crops on the lookdev world (whose fields name only a few
 * species), and pin the year for the fruit season. Bump `version` after a change: the caches rebuild.
 */
export const PLANT_PROBE = { tree: new Map<number, number>(), crop: new Map<number, number>(), version: 0, yearFrac: -1 };
if (typeof window !== 'undefined') {
  const w = window as unknown as { __GENESIS_LIFE__?: { all: unknown[]; plants?: typeof PLANT_PROBE; plantIds?: string[] } };
  w.__GENESIS_LIFE__ ??= { all: [] };
  w.__GENESIS_LIFE__.plants = PLANT_PROBE;
  w.__GENESIS_LIFE__.plantIds = (BASE_PACK.plants ?? []).map((p) => String(p.id ?? ''));
}

const VEG_VERT_PARS = /* glsl */ `
attribute float aWind;
attribute vec2 aLeafUv;
attribute float aCard;
attribute float aCrown;
attribute vec4 iExtra;        // snow on the branches, char, leaf loss (winter), LOD role (1 plain, 2/3 fading out across
                              // LOD boundary 0/1, 4/5 fading in; a missing attribute reads 1)
uniform float uWindK;         // wind strength from the weather (calm 0.3 … gale 2.5)
uniform vec4 uLodBand;        // LOD cross-fade bands (m from the camera): boundary 0 (x..y), boundary 1 (z..w)
uniform mat3 uBodyToView;     // body → view rotation (planetview.ts): the camera's line of sight in the body frame
varying vec4 vExtra;
varying vec2 vLod;            // the interval [x, y) of the object-space chunk hash this mesh draws (0..1 = all):
                              // a fading-out LOD keeps [0, t), the incoming one [t, 1), so every chunk shows once
varying vec3 vLocalP;
varying float vCrownIn;       // 1 when the camera is inside this tree's crown (its foliage fades away)
varying vec2 vNearFade;       // foliage nearer the camera than x is gone, fading out to y (m): further up in the trees
varying float vOccK;          // 0..1: this crown stands between a god's-eye camera and what it frames (crown fades)
uniform float uTime;
uniform vec3 uWindDir;
uniform vec4 uGodWind;        // (additive, ships/cameras lane) the walking god's feet (body frame) and its wind's strength
uniform vec3 uCamBody;
uniform vec2 uFade;          // (start, end) of the hand-over band, metres from the camera
uniform float uFarOn;        // PERF P2: a far-tree layer takes the trees over past the band (dissolve, not shrink)
uniform vec4 uFarBand;       // far layer: px of tree height where hull lod 0 -> 1 (x..y), far fade-out px (z..w)
uniform float uPxPerRad;     // render pixels per radian (vertical): a tree's height on screen = height * this / distance
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
  if (vLod.x > 0.0 || vLod.y < 1.0) {
    float lch = fract(sin(dot(floor(vLocalP * 5.0 + 0.37), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    // (bark — trunks — swap whole at the middle of a band: drawn by the mesh whose interval holds 0.5)
    float lq = vCard > 0.25 ? lch : 0.5;
    if (lq < vLod.x || lq >= vLod.y) discard;
  }
  // vExtra.z: leaf loss 0..1, plus 2 when the tree's fruit is out of season (fruit: aCard 0.35, treegen FRUIT_CARD)
  float leafLoss = vExtra.z > 1.5 ? vExtra.z - 2.0 : vExtra.z;
  if (vExtra.z > 1.5 && vCard > 0.3 && vCard < 0.4) discard;
  if (vCard > 0.25 && leafLoss > 0.0) {
    float lh = fract(sin(dot(floor(vLocalP * 9.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    if (lh < leafLoss) discard;
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
  bool vegCull = false;
  {
    vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    // hand-over to the terrain's canopy shading: WHOLE trees sink and shrink into the ground across the band (a
    // per-pixel dither left clouds of loose leaf pixels and, without TAA, never resolved); the shadow pass uses the
    // same vertex code, so shadows fade with their trees
    float camD = distance(ip, uCamBody);
    float handover = smoothstep(uFade.x, uFade.y, camD);
    vLod = vec2(0.0, 1.0);
#ifdef VEG_FAR
    // PERF P2 — the far layer: the same tree as a hull. It takes over the chunks the near tree gives up across the
    // hand-over band ([1 - s, 1) of the hash), and gives them up itself — to the terrain's canopy shading — where the
    // tree shrinks under a few pixels on screen. Hull lod 0 and 1 split its share across their own band (in px).
    {
      float th0 = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));
      float px = th0 * uPxPerRad / max(camD, 1.0);
      float s = handover * smoothstep(uFarBand.z, uFarBand.w, px);
      float a = smoothstep(uFarBand.x, uFarBand.y, px);
      float lo = 1.0 - s, mid = 1.0 - s + s * a;
      vLod = iExtra.w < 6.5 ? vec2(lo, mid) : vec2(mid, 1.0);
      // trees wholly off screen (the far layer surrounds the camera) cost a degenerate vertex, no cloud lookup
      vec4 cp = projectionMatrix * (modelViewMatrix * vec4(ip, 1.0));
      float mg = 1.15 + 1.5 * th0 * max(projectionMatrix[0][0], projectionMatrix[1][1]) / max(abs(cp.w), 1e-3);
      if (cp.w < -th0 * 2.0 || abs(cp.x) > mg * abs(cp.w) || abs(cp.y) > mg * abs(cp.w)) vLod = vec2(1.0, 1.0);
    }
#else
    // without a far layer whole trees sink into the terrain's canopy shading across the band; with one they give
    // their chunks over to the far hull instead (the complementary half of the hash)
    if (uFarOn < 0.5) transformed *= 1.0 - handover;
    // LOD cross-fade: inside a band both LODs draw this tree, the outgoing one losing crown chunks as the incoming one
    // gains the complementary chunks (object-space, metres-sized: no pixel dither), trunks swap at the middle
    if (iExtra.w > 1.5) {
      float role = iExtra.w;
      bool fadeIn = role > 3.5;
      float bnd = fadeIn ? role - 4.0 : role - 2.0;
      vec2 band = bnd < 0.5 ? uLodBand.xy : uLodBand.zw;
      float t = smoothstep(band.x, band.y, camD);
      vLod = fadeIn ? vec2(1.0 - t, 1.0) : vec2(0.0, 1.0 - t);
    }
    if (uFarOn > 0.5) vLod.y = min(vLod.y, 1.0 - handover);
#endif
    vegCull = vLod.y - vLod.x < 0.002;
    transformed *= vegCull ? 0.0 : 1.0;
    float ph = dot(ip, vec3(0.071, 0.113, 0.097));
    float gust = 0.55 + 0.45 * sin(uTime * 0.37 + ph * 0.2);
    float sway = (sin(uTime * 1.6 * (0.8 + 0.2 * uWindK) + ph) * 0.6 + sin(uTime * 2.9 + ph * 1.7) * 0.25) * gust;
    vec3 wl = vec3(dot(uWindDir, vec3(1.0, 0.0, 0.0)), 0.0, dot(uWindDir, vec3(0.0, 0.0, 1.0)));
    // the trees lean a little with the wind and sway more the stronger it blows (leaves flutter on top)
    transformed += (wl * (sway + 0.6 * (uWindK - 0.5)) * 0.035 * uWindK + vec3(sin(uTime * 4.1 + ph * 3.0 + position.y * 9.0), 0.0, cos(uTime * 3.7 + ph * 2.0)) * 0.006 * uWindK) * aWind * aWind;
    // the god's wind round its body (camera/avatar.ts GOD_WIND): grass and low growth bow away from its feet in a slow
    // ripple running outward (the push turned into the instance's own frame: its basis is a rotation times a scale)
    if (uGodWind.w > 0.0) {
      vec3 gd = ip - uGodWind.xyz;
      vec3 gup = normalize(ip);
      gd -= gup * dot(gd, gup);
      float gl = length(gd);
      if (gl < 7.0 && gl > 1e-3) {
        float gk = uGodWind.w * (1.0 - gl / 7.0) * (1.0 - gl / 7.0) * (0.65 + 0.35 * sin(uTime * 5.0 - gl * 1.6 + ph));
        mat3 ib = mat3(instanceMatrix);
        float sc2 = max(dot(ib[1], ib[1]), 1e-6);
        transformed += (transpose(ib) * (gd / gl)) / sc2 * gk * 0.22 * aWind * aWind;
      }
    }
    vExtra = iExtra;
    vLocalP = position;
    // the camera inside (or brushing) a tree's crown: its foliage fades out, rather than filling half the frame with
    // giant leaf cards (trees only: ground cover shares this material)
    float th = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));
    vec3 cc = ip + normalize(ip) * th * 0.62;
    vCrownIn = th > 3.5 ? 1.0 - smoothstep(th * 0.42, th * 0.62, distance(uCamBody, cc)) : -1.0;
    // a camera up among the crowns (an orbit view over a wooded village) is never looking at the leaves beside it:
    // the near fade reaches further the higher the camera stands above this tree's foot (street level: 2.5–6.5 m)
    float hCam = clamp(dot(uCamBody - ip, normalize(ip)) - 2.0, 0.0, 40.0);
    vNearFade = vec2(2.5 + hCam * 0.3, 6.5 + hCam * 0.45);
    // GOD-VIEW OCCLUDERS: a camera some metres up, looking down at what it frames (a village, a shrine, the Touch's
    // catch), never wants a crown in front of its subject — the crown by the lens covered 40 % of a 60 m village view
    // and hid a framed shrine outright. A tree fades (the same object-space chunks as above: the crown first, then its
    // trunk — a trunk left standing without its crown read as a burnt forest of bare poles) when it stands well in the
    // FOREGROUND (nearer than ~40-55 % of the distance to the
    // framed ground: it would look twice the size of the subject's own trees) or ON THE LINE OF SIGHT to the subject (within
    // its radius + a few metres of the view ray, widening with the distance down it, short of the subject: crowns in
    // the middle distance hid a framed town). The framed point is the view ray's hit on the
    // ground sphere through this tree's foot. Off at street level (walk / follow views: the trees are the scene) and
    // when the view runs to the horizon; shadows keep every tree.
    vOccK = 0.0;
    if (th > 3.5) {
      vec3 fwd = -vec3(uBodyToView[0][2], uBodyToView[1][2], uBodyToView[2][2]);
      float rG = length(ip);
      float rCam = length(uCamBody);
      float hAbove = rCam - rG;
      float bq = dot(uCamBody, fwd);
      float disc = bq * bq - (rCam * rCam - rG * rG);
      if (hAbove > 6.0 && bq < 0.0 && disc > 0.0) {
        float tT = -bq - sqrt(disc);
        vec3 rel = cc - uCamBody;
        float tA = dot(rel, fwd);
        float dPerp = length(rel - fwd * tA);
        float rC = th * 0.3;
        float fore = 1.0 - smoothstep(0.38 * tT, 0.56 * tT, length(rel));
        float onRay = (1.0 - smoothstep(rC + 2.0 + 0.05 * tA, rC + 6.0 + 0.09 * tA, dPerp)) * smoothstep(0.0, 3.0, tA) * (1.0 - smoothstep(0.8, 0.94, (tA + rC) / tT));
        vOccK = max(fore, onRay) * smoothstep(6.0, 12.0, hAbove) * (1.0 - smoothstep(600.0, 900.0, tT));
      }
    }
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
// the crown depth the lighting uses (= vCrown; a far hull's own clumps and gaps on it, see VEG_FAR below)
float vegCrownV;
varying vec4 vExtra;
varying vec2 vLod;
varying vec3 vLocalP;
varying float vCloudSh;
varying float vCrownIn;
varying vec2 vNearFade;
varying float vOccK;
uniform vec3 uCamBody;
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
    float crownDirect = mix(0.55, 1.0, smoothstep(0.35, 0.95, vegCrownV));
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
    float under = vLeaf < 0.5 ? 1.0 : 1.0 - smoothstep(0.4, 0.9, vegCrownV);
    e *= mix(vec3(1.0), vec3(0.34, 0.42, 0.28), canopy * under);
    // crown AO (cheap volumetric occlusion from the baked crown depth); the sky enters once (see terrainmat FRAG_AMBIENT)
    iblIrradiance += e * mix(0.45, 1.0, smoothstep(0.3, 0.95, vegCrownV));
  }
`;

/**
 * PERF item 3 (session 10): the far layer draws every kind and variant of a hull lod from ONE instanced mesh. Each
 * instance carries its hull's row in the table texture (iHull = (kind x variants + variant) x 2 + lod, farcrown.ts
 * farHullTable); the shared canonical index list makes gl_VertexID the hull's vertex slot. The vertex's attributes are
 * fetched first thing in main() and stand in for the attributes of the same names (macros: the rest of the shader —
 * three's chunks and the vegetation code — reads them unchanged), so a far tree is lit, tinted, swayed and shadowed
 * exactly as with its own geometry. Placed after every declaration (the macros must not rename them).
 */
const FAR_FETCH = /* glsl */ `
#ifdef VEG_FAR
attribute float iHull;
uniform highp sampler2D uFarHulls;
vec3 fPos; vec3 fNrm; vec3 fCol; float fWind; float fCard; float fCrown;
void farFetch() {
  ivec2 b = ivec2(gl_VertexID * ${FAR_HULL_TEXELS}, int(iHull + 0.5));
  vec4 t0 = texelFetch(uFarHulls, b, 0), t1 = texelFetch(uFarHulls, b + ivec2(1, 0), 0), t2 = texelFetch(uFarHulls, b + ivec2(2, 0), 0);
  fPos = t0.xyz; fNrm = vec3(t0.w, t1.xy); fCol = vec3(t1.zw, t2.x); fWind = t2.y; fCard = t2.z; fCrown = t2.w;
  // PERF s12: a crown whose foliage covers only part of its hull (farcrown.ts fill: a palm's star of fronds) shows
  // that share of its footprint: where its clumps are too small to open as gaps (the fragment shader does that when
  // they are resolved), the crown is drawn narrower by sqrt(fill) instead, so a far forest covers the ground as much
  // as the near trees do (shadows too: the depth pass runs the same fetch)
  if (fCard > 0.25 && fCrown > 1.5) {
    float fFill = clamp(fCrown - 2.0, 0.2, 1.0);
    vec3 ipF = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    float thF = length(vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]));
    float pxF = thF * uPxPerRad / max(distance(ipF, uCamBody), 1.0);
    fPos.xz *= mix(sqrt(fFill), 1.0, smoothstep(14.0, 40.0, pxF));
  }
}
#define position fPos
#define normal fNrm
#define color fCol
#define aWind fWind
#define aCard fCard
#define aCrown fCrown
#define aLeafUv vec2(0.0)
#endif
`;
const FAR_MAIN = 'void main() {\n#ifdef VEG_FAR\n  farFetch();\n#endif\n';
/** the far hull table (made once, with the first Vegetation: it needs the leaf atlas' tile colours) */
const FAR_HULLS: IUniform<Texture | null> = { value: null };
let farTable: ReturnType<typeof farHullTable> | null = null;

/** the vegetation material (also used by the near-camera ground cover, render/life/groundcover.ts, with its own band) */
export function makeVegMaterial(shared: Record<string, IUniform>, fade: IUniform<{ x: number; y: number }>, leafTex: IUniform, far?: { on: IUniform<number>; layer: boolean }): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: DoubleSide });
  if (far?.layer) mat.defines = { VEG_FAR: '' };
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(shared)) shader.uniforms[k] = shared[k];
    shader.uniforms.uFade = fade;
    shader.uniforms.uFarOn = far?.on ?? { value: 0 };
    shader.uniforms.uFarBand = FAR_BAND;
    shader.uniforms.uPxPerRad = PX_PER_RAD;
    shader.uniforms.uLeafTex = leafTex;
    shader.uniforms.uWindK = WIND_K;
    shader.uniforms.uLodBand = LOD_BAND;
    shader.uniforms.uGodWind = GOD_WIND;
    shader.uniforms.uFarHulls = FAR_HULLS;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${FAR_FETCH}\n${FAR_MAIN}`)
      .replace('#include <clipping_planes_pars_vertex>', `#include <clipping_planes_pars_vertex>\n${VEG_VERT_PARS}\n${VEG_VERT_CLOUD}`)
      .replace('#include <begin_vertex>', VEG_WIND)
      .replace('#include <color_vertex>', `
  // aCard: 0 bark, 0.1 field stone (ground cover), 0.5 solid foliage (conifer core), 1 alpha-tested spray. The
  // instance colour is the FOLIAGE tint (species, season, per-tree shift): bark only takes its brightness, so autumn
  // never paints the trunks orange; a stone keeps its own warm or lichened tint
  vColor = vec4(1.0);
  vColor.xyz *= color.xyz;
#ifdef USE_INSTANCING_COLOR
  // (fruit, aCard 0.35, keeps its own hue like bark: red apples, white cotton bolls)
  float leafy = max(step(0.25, aCard), step(0.05, aCard) * step(aCard, 0.2)) * (1.0 - step(0.3, aCard) * step(aCard, 0.4));
  vColor.xyz *= mix(vec3(dot(instanceColor.xyz, vec3(0.3, 0.55, 0.15))), instanceColor.xyz, leafy);
#endif`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n  vBodyPos = (instanceMatrix * vec4(transformed, 1.0)).xyz;\n  vCloudSh = vegCull ? 1.0 : vegCloudShadowV(vBodyPos, uSunDirBody);\n  vLeaf = step(0.25, aCard);\n  vLeafUv = aLeafUv;\n  vCard = aCard;\n  vLocalY = position.y;\n  vCrown = aCrown;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${VEG_FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  vegCrownV = vCrown;
${LEAF_ALPHA}
#ifdef VEG_FAR
  // PERF s12 (owner: far trees must read like the near trees — not lime, not pentagons, not flat discs): a far hull is
  // shaded as a crown, not a solid: clumps of foliage (cells in the tree's own unit-height frame) lit as the crown's
  // outer leaves, the gaps between them as its shaded interior (the same crown-depth lighting the near leaves get),
  // and where the clumps are resolved the gaps on the outline are open, so the silhouette is ragged like the near
  // crown's sprays. Unresolved (a few px), the mean of the pattern. Same draws.
  if (vLeaf > 0.5) {
    vec3 cq = vLocalP * 7.0;
    float cAA = 1.0 - smoothstep(0.3, 0.8, length(fwidth(cq)));
    vec3 cv = voronoi3(cq);
    float gap = 1.0 - smoothstep(0.04, 0.3, cv.y - cv.x);
    float heart = 1.0 - smoothstep(0.0, 0.55, cv.x);
    float cl = clamp(0.55 + 0.45 * heart - 0.6 * gap, 0.0, 1.0);
    vegCrownV = mix(0.6, mix(0.25, 0.98, cl), cAA);
    diffuseColor.rgb *= mix(0.9, mix(0.78, 1.04, cl) * (0.92 + 0.16 * cv.z), cAA);
    // the share of the hull the crown's foliage covers (farcrown.ts: 2 + fill): the rest opens as whole clumps where
    // they are resolved (the ground and the crown's inside show through, as between a palm's fronds); unresolved, the
    // hull's value drops toward what the open share would show (shade and floor)
    float fill = vCrown > 1.5 ? clamp(vCrown - 2.0, 0.2, 1.0) : 1.0;
    float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
    if (cAA > 0.5 && (cv.z > fill + 0.05 || (gap > 0.5 && rim > 0.45))) discard;
    diffuseColor.rgb *= mix(1.0, mix(0.85, 1.0, fill), 1.0 - cAA);
  }
#endif
  // foliage right by the camera (within ~5 m), and all of a tree's foliage when the camera is inside its crown, fades
  // out in object-space chunks (~25 cm: whole sprays, no pixel dither); bark stays
  // (trees only: vCrownIn < 0 marks ground cover and small shrubs, whose tufts at the camera's feet stay)
  // (a camera up among the crowns — vNearFade.x > 4: some 5 m above this tree's foot — loses the bare branches beside
  // it too, which crossed an orbit view as sticks once their leaves were gone)
  // (a tree between a god's-eye camera and its subject, vOccK, loses its foliage and the branches up in it, and once
  // they are mostly gone its trunk too: bare trunks left standing read as a burnt forest of poles)
  if (vCrownIn > -0.5) {
    float nearK = (vLeaf > 0.5 || vNearFade.x > 4.0) ? max(vCrownIn, 1.0 - smoothstep(vNearFade.x, vNearFade.y, distance(vBodyPos, uCamBody))) : 0.0;
    nearK = max(nearK, vLeaf > 0.5 || vLocalY > 0.55 ? vOccK : smoothstep(0.4, 0.95, vOccK));
    if (nearK > 0.0 && fract(sin(dot(floor(vLocalP * 4.0 + 0.21), vec3(12.9898, 78.233, 37.719))) * 43758.5453) < nearK) discard;
  }
  if (vCard > 0.5) diffuseColor.rgb *= texture(uLeafTex, vLeafUv).rgb * 1.7;
  // leaf clusters: cellular light / dark speckle on foliage (fading with distance), bark furrows on trunks
  float vegFw = length(fwidth(vBodyPos));
  float leafAA = 1.0 - smoothstep(0.08, 0.35, vegFw * 2.2);
  // (the cellular speckle only where it is resolved, and not on the textured spray cards)
  vec3 lv = vLeaf > 0.5 && vCard < 0.75 && leafAA > 0.001 ? voronoi3(vBodyPos * 2.2) : vec3(0.5, 0.7, 0.5);
  float leafTex = mix(0.92, 0.62 + 0.62 * (1.0 - lv.x) * (0.7 + 0.6 * lv.z), leafAA);
  // bark: furrows running along the stem (mesh-local: the trunk is the local Y axis), in colour and in the normal
  float barkAA = 1.0 - smoothstep(0.02, 0.12, vegFw);
  // (deep fissures between raised plates, broken by a finer octave: the furrows at ±15 % read at 4 m as a smooth
  // grey cylinder beside the villager)
  float barkH = abs(snoise(vec3(vLocalP.x * 55.0, vLocalP.y * 5.0, vLocalP.z * 55.0)));
  float barkF = barkAA > 0.001 && vLeaf < 0.5 ? snoise(vec3(vLocalP.x * 160.0, vLocalP.y * 22.0, vLocalP.z * 160.0)) : 0.0;
  barkH = smoothstep(0.0, 0.5, barkH) * (0.8 + 0.2 * barkF);
  float barkTex = mix(0.92, 0.5 + 0.68 * barkH, barkAA);
  // ground-cover stones (aCard 0.1) are not bark: no furrows, no bark clamp, no trunk-base soil
  bool isStone = vCard > 0.05 && vCard < 0.2;
  diffuseColor.rgb *= vCard > 0.5 || isStone ? 1.0 : mix(barkTex, leafTex, vLeaf);
  // (bark keeps its species' hue under the blue sky fill: a palm's grey-brown at the generator's chroma read as a
  // neutral grey cylinder in every shade — its chroma is lifted, not its value)
  if (vLeaf < 0.5 && !isStone) {
    float barkL = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
    diffuseColor.rgb = max(vec3(0.0), vec3(barkL) + (diffuseColor.rgb - barkL) * 1.6);
  }
  // no bark is paler than weathered grey wood (bright trunks read as white posts in the sun)
  if (vLeaf < 0.5 && !isStone) diffuseColor.rgb = min(diffuseColor.rgb, vec3(0.24, 0.22, 0.2));
  // trunk bases sink into the ground: soil, moss and shade creep up the lowest metre instead of a clean cut
  if (vLeaf < 0.5 && !isStone) {
    float baseW = 1.0 - smoothstep(-0.01, 0.045, vLocalY);
    vec3 soilC = mix(vec3(0.055, 0.045, 0.032), vec3(0.04, 0.055, 0.025), smoothstep(0.3, 0.7, snoise(vBodyPos * 1.7) * 0.5 + 0.5));
    diffuseColor.rgb = mix(diffuseColor.rgb, soilC, baseW * 0.8);
  }
  float vegBump = mix(barkH * 0.05 * barkAA, (1.0 - lv.x) * 0.25 * leafAA, vLeaf);
  if (isStone) {
    // field stone: soft blotches of lichen (2–3 cm, low contrast) and moss, a darker damp band where it sits in the
    // soil (the instance sinks it by a third: the soil line is at ~0.35 of its unit height)
    float sAA = 1.0 - smoothstep(0.01, 0.04, vegFw);
    float lich = smoothstep(0.56, 0.8, vnoise(vBodyPos * 36.0)) * sAA;
    float moss = smoothstep(0.58, 0.85, vnoise(vBodyPos * 12.0 + 5.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.2, 0.14), lich * 0.3);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.055, 0.075, 0.03), moss * 0.35);
    diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.26, 0.5, vLocalY));
    vegBump = (vnoise(vBodyPos * 28.0) - 0.5) * 0.03 * sAA;
  }
  // charred bark (fire scars), snow lying on the upward faces of branches and foliage
  if (vLeaf < 0.5 && !isStone) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.018, 0.016), vExtra.y);
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
  mat.customProgramCacheKey = () => (far?.layer ? 'genesis-veg-v13-far' : 'genesis-veg-v12');
  return mat;
}

/** wind strength shared by every vegetation material (set from the weather at the camera each frame) */
export const WIND_K: IUniform<number> = { value: 0.8 };
/** LOD cross-fade bands (set per frame from the vegetation range) */
export const LOD_BAND: IUniform<Vector4> = { value: new Vector4(51, 69, 140, 179) };
/** PERF P2 far layer: px of a tree's height on screen where hull lod 0 hands over to lod 1 (x..y) and where the far
 *  tree gives way to the terrain's canopy shading (z..w) */
export const FAR_PX = { lod: [12, 18], out: [3, 6] } as const;
export const FAR_BAND: IUniform<Vector4> = { value: new Vector4(FAR_PX.lod[0], FAR_PX.lod[1], FAR_PX.out[0], FAR_PX.out[1]) };
/** render pixels per radian of the view (vertical; set each frame) */
export const PX_PER_RAD: IUniform<number> = { value: 536 };

const VEG_DEPTH_VERT = /* glsl */ `
#include <common>
${VEG_VERT_PARS}
#include <logdepthbuf_pars_vertex>
${FAR_FETCH}
${FAR_MAIN}
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

/**
 * PERF F6 / F22: how far (m) the shadow of a caster `e` tall / wide about its base, within `d` of the camera, can run:
 * the least x with e (1 + cot el(x)) + 4 <= x, el(x) = el0 − (d + x) / R (the sun's elevation at the camera less the
 * slope allowance, less the planet's curvature out to the farthest shadow point); Infinity for a sun too low to bound.
 */
export function treeShadowReach(e: number, el0: number, d: number, R: number): number {
  const f = (x: number): number => { const el = el0 - (d + x) / R; return el > 0.035 ? e * (1 + 1 / Math.tan(el)) + 4 : Infinity; };
  let x = 0;
  for (let it = 0; it < 12 && Number.isFinite(x); it++) x = f(x) * 1.02 + 0.5;
  return f(x) <= x ? x : Infinity;
}

/**
 * PERF F22: can a caster whose base is within `d` of the camera, its shadow within `reach` of the base, shade any pixel
 * at view depth >= nearSplit? A pixel's distance from the camera is at least its view depth. true = it cannot.
 */
export function nearSplitCut(d: number, reach: number, margin: number, nearSplit: number): boolean {
  return d + reach + margin < nearSplit;
}

interface Bucket {
  mesh: InstancedMesh; depth: ShaderMaterial; count: number; kind: number; variant: number; lod: number; extra: InstancedBufferAttribute;
  /** PERF F6: each instance's distance from the rebuild camera; after a fill the instances are ordered by distance
   *  band and binEnd[i] = instances in bands 0..i, so a shadow cascade draws only the prefix that can reach it */
  dist: Float32Array; binEnd: Uint32Array;
  /** extent of the unit geometry about its base (bounding sphere |centre| + radius) and the largest instance's (m) */
  geoR: number; eMax: number;
  /** PERF F22: the farthest instance's distance from the rebuild camera (m) */
  dMax: number;
}
/** the fields a cell's plants read besides the ground and the stamped tree / shrub / burnt / treeSpecies (PERF F9) */
const VEG_INPUTS = ['water', 'temperature', 'moisture', 'snow', 'crop', 'road', 'sand', 'soil', 'shrubSpecies'] as const;
/** distance bands of the per-cascade shadow prefix (PERF F6) */
const NB = 48;

const SHRUB = KINDS.indexOf('shrub');
const IS_SHRUB = KINDS.map((k) => SHRUB_KINDS.includes(k));
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _m = new Matrix4();
const _c = new Color();
const _v = new Vector3();
const _cells: number[] = [];

/**
 * Metres kept clear of trees beyond a building's half-diagonal: a house stands in its yard, not in a wood (crowns
 * 3-5 m across would otherwise reach through its roof); walls and aqueducts are long and thin, so their half-diagonal
 * already clears more than they cover. Shrubs come 1.5 m closer (garden hedges, a bush by the door).
 */
const CLEAR_MARGIN: Partial<Record<string, number>> = { wall: 0.5, gate: 1.5, aqueduct: 0.5, pen: 1.5, market: 2, well: 2.5, hearth: 2.5 };
const CLEAR_DEFAULT = 3.2;
const SHRUB_CLOSER = 1.5;

/** the season and the per-tree fields every plant instance reads (one per rebuild; dy: the camera's hemisphere) */
interface PlantEnv { autumn: number; winterK: number; yfH: number; snowF?: Float32Array; burntF?: Float32Array; fireF?: Float32Array; treeF?: Float32Array }
function plantEnv(pv: PlanetView, dy: number, yearFrac: number): PlantEnv {
  // autumn at the camera's latitude (northern autumn at year fraction 0.5–0.75, southern half a year later)
  const yfH = dy >= 0 ? yearFrac : (yearFrac + 0.5) % 1;
  const autumn = smooth(0.5, 0.6, yfH) * (1 - smooth(0.74, 0.8, yfH));
  // leaf fall: from the end of autumn through winter, leafing out again early in spring
  const winterK = yfH >= 0.5 ? smooth(0.72, 0.8, yfH) : 1 - smooth(0.06, 0.14, yfH);
  return { autumn, winterK, yfH, snowF: pv.fields.get('snow'), burntF: pv.fields.get('burnt'), fireF: pv.fields.get('fire'), treeF: pv.fields.get('tree') };
}
const _pm = new Float32Array(16), _pc = new Float32Array(3), _pe = new Float32Array(4);

/**
 * One plant's instance (shared by the near trees and the far layer, so a far tree IS the near tree): its matrix
 * (column-major, into m at mo), foliage tint (c at co) and extra (snow, char, leaf loss + fruit, canopy x 0.4: the
 * caller adds its LOD role to the last). Returns the girth scale.
 */
function plantInstance(pv: PlanetView, rec: Float32Array, i: number, env: PlantEnv, m: Float32Array, mo: number, col: Float32Array, co: number, ext: Float32Array, eo: number): number {
  const kind = rec[i + 6];
  const gr = rec[i + 3];
  const px = rec[i] * gr, py = rec[i + 1] * gr, pz = rec[i + 2] * gr;
  const seed = rec[i + 9];
  // basis: up = the radial direction tilted by this tree's own lean (≤ ~5°), yaw about it, scale = height
  let ux = rec[i], uy = rec[i + 1], uz = rec[i + 2];
  let ex = uz, ez = -ux;
  const el = Math.hypot(ex, ez) || 1;
  ex /= el; ez /= el;
  let nx = uy * ez, ny = uz * ex - ux * ez, nz = -uy * ex;
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
  m[mo] = ax * sx; m[mo + 1] = ay * sx; m[mo + 2] = az * sx; m[mo + 3] = 0;
  m[mo + 4] = ux * s; m[mo + 5] = uy * s; m[mo + 6] = uz * s; m[mo + 7] = 0;
  m[mo + 8] = bx * sx; m[mo + 9] = by * sx; m[mo + 10] = bz * sx; m[mo + 11] = 0;
  m[mo + 12] = px - rec[i] * 0.25; m[mo + 13] = py - rec[i + 1] * 0.25; m[mo + 14] = pz - rec[i + 2] * 0.25; m[mo + 15] = 1;
  // foliage tint (the shader applies it to leaves only): species colour, autumn for deciduous species, and a
  // per-tree brightness and yellow-green ↔ blue-green shift so a forest is never one colour
  const sp = rec[i + 8];
  const look = sp >= 0 ? SPECIES[sp] : null;
  let tr = 1, tg = 1, tbl = 1;
  if (look) { tr = look.tint[0]; tg = look.tint[1]; tbl = look.tint[2]; }
  if (look?.autumn && !IS_SHRUB[kind]) {
    const turn = Math.min(1, env.autumn * (0.55 + 0.9 * ((seed * 3.3) % 1)));
    tr += (look.autumn[0] - tr) * turn; tg += (look.autumn[1] - tg) * turn; tbl += (look.autumn[2] - tbl) * turn;
  }
  // per tree: value ±20 %, a yellow-green ↔ blue-green hue shift of ±6 %
  const th = (seed * 17.9) % 1;
  const tb = 0.8 + 0.4 * ((seed * 5.77) % 1);
  col[co] = tr * tb * (0.94 + 0.12 * th); col[co + 1] = tg * tb; col[co + 2] = tbl * tb * (1.06 - 0.12 * th);
  // per tree: snow on the branches (the ground's snow cover), fire char near burnt ground, leaf fall of
  // deciduous species through late autumn into winter (bare in winter, leafing again in spring)
  const ux0 = rec[i], uy0 = rec[i + 1], uz0 = rec[i + 2];
  const g = pv.grid;
  const snowA = env.snowF ? Math.min(1, g.sample(env.snowF, ux0, uy0, uz0) / 0.25) : 0;
  // char from the scar of a past fire, or the fire burning here now
  const charA = Math.min(0.9, Math.max(env.burntF ? (g.sample(env.burntF, ux0, uy0, uz0) - 0.15) * 1.6 : 0, env.fireF ? g.sample(env.fireF, ux0, uy0, uz0) * 0.85 : 0, 0));
  const leafless = look?.deciduous && !IS_SHRUB[kind] ? Math.min(1, env.winterK * (0.7 + 0.6 * ((seed * 9.1) % 1))) : 0;
  // fruit hangs in its season only (a few days' spread from tree to tree)
  const fs = look?.fruit;
  const yfT = ((PLANT_PROBE.yearFrac >= 0 ? PLANT_PROBE.yearFrac : env.yfH) + ((seed * 7.3) % 1) * 0.03) % 1;
  const fruitOff = !fs || (fs[0] <= fs[1] ? yfT < fs[0] || yfT > fs[1] : yfT < fs[0] && yfT > fs[1]);
  // the canopy around it (0..1, carried in the role's fraction: the role is an integer 1..5): under a closed
  // canopy the trunks and lower crown see little sky
  const canopy = env.treeF ? Math.min(1, Math.max(0, (g.sample(env.treeF, ux0, uy0, uz0) - 0.3) / 0.5)) : 0;
  ext[eo] = snowA; ext[eo + 1] = kind === K('burnt') ? 0 : charA; ext[eo + 2] = leafless + (fruitOff ? 2 : 0); ext[eo + 3] = canopy * 0.4;
  return sx;
}

// ── PERF P2 far layer: settings and types ──
/** the far layer on by default; `?fartrees=0` = the old hand-over (whole trees shrink into the canopy shading) */
const FAR_DEFAULT = perfSwitch('fartrees');
/** PERF F22: trees left out of the cascades their shadows cannot reach by view depth (`?shnear=0` = off) */
const SH_NEAR = perfSwitch('shnear');
/** main-thread ms a frame for making far blocks (scatter + instance data of a cell, ~0.1 ms each) */
const FAR_BUDGET_MS = (() => { try { return Number(new URLSearchParams(globalThis.location?.search ?? '').get('farbudget')) || 3; } catch { return 3; } })();
/** main-thread ms a frame for re-listing the far cells as the camera moves */
const FAR_SCAN_MS = 1.5;
/** the tallest tree a far cell may hold (m), and how far ahead of need (x the reach) cells are made */
const FAR_H_MAX = 41;
const PREFETCH = 1.5;
const KELP = KINDS.indexOf('kelp');
/** the plant scatter's fields (a change re-scatters the cells around it) and the far tint's (snow, fire) */
const PLANT_FIELDS = ['tree', 'shrub', 'burnt', 'treeSpecies', 'snow', 'fire'] as const;
/**
 * PERF item 3: far buckets by DISTANCE BAND from the camera (x the far layer's inner edge), one per band and hull lod —
 * every kind and variant together (the hull comes from the table by iHull). 4 bands x 2 lods = at most 8 far draws a
 * pass (was ~66: one per kind, variant and lod); the bands let each shadow cascade draw only the far trees whose
 * shadows can reach it (farShadow).
 */
const FAR_BAND_EDGES = [1.6, 2.6, 5.2] as const;
const FAR_BANDS = FAR_BAND_EDGES.length + 1;
/** a placed cell keeps its band while within this factor of the band's edges (no churn at an edge) */
const FAR_BAND_SLACK = 0.1;
function farBandOf(d: number, inner: number): number {
  let b = 0;
  while (b < FAR_BAND_EDGES.length && d >= FAR_BAND_EDGES[b] * inner) b++;
  return b;
}
function farBandKeeps(band: number, d: number, inner: number): boolean {
  const lo = band > 0 ? FAR_BAND_EDGES[band - 1] * inner * (1 - FAR_BAND_SLACK) : -Infinity;
  const hi = band < FAR_BAND_EDGES.length ? FAR_BAND_EDGES[band] * inner * (1 + FAR_BAND_SLACK) : Infinity;
  return d >= lo && d < hi;
}
interface FarBlock {
  n: number; keys: number[]; starts: number[]; m: Float32Array; c: Float32Array; e: Float32Array;
  hMin: number; hMax: number; cx: number; cy: number; cz: number; r: number; stale: boolean; env: string;
}
interface FarBucket {
  mesh: InstancedMesh; extra: InstancedBufferAttribute; hull: InstancedBufferAttribute; cap: number; hi: number; live: number;
  /** free ranges [start, n, ...] sorted by start; dirty ranges [start, n, ...] to upload */
  free: number[]; dirty: number[]; band: number; lod: number;
  /** distance bounds (m) of its placed trees (crown extent included) from `anchor` (farBounds) */
  dMin: number; dMax: number;
}
/** upload the given instance ranges of an attribute (coalesced; three bufferSubData per range) */
function flushRanges(a: InstancedBufferAttribute | BufferAttribute, ranges: number[], w: number): void {
  const r: [number, number][] = [];
  for (let k = 0; k < ranges.length; k += 2) r.push([ranges[k], ranges[k] + ranges[k + 1]]);
  r.sort((x, y) => x[0] - y[0]);
  a.clearUpdateRanges();
  let s0 = -1, e0 = -1;
  const len = a.array.length;
  const add = () => { if (s0 >= 0 && e0 > s0) a.addUpdateRange(s0 * w, Math.min(len, e0 * w) - s0 * w); };
  for (const [s1, e1] of r) { if (s0 >= 0 && s1 <= e0 + 64) e0 = Math.max(e0, e1); else { add(); s0 = s1; e0 = e1; } }
  add();
  a.needsUpdate = true;
}

export class Vegetation {
  readonly group = new Group();
  private buckets: Bucket[] = [];
  private cache = new Map<number, Float32Array>();
  private stamp = '';
  /** building clearings: cell -> [ux, uy, uz, clear radius m, ...] of the buildings whose clearing reaches its plants */
  private clearings = new Map<number, number[]>();
  private clearBlock: BuildingBlock | null = null;
  private clearSig = '';
  /** ARC §2.6: the towers' clearings signature (their sites are felled like a building's plot) */
  private towerSig = '';
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
    this.group.add(this.nearGroup, this.farGroup);
    this.nearGroup.matrixAutoUpdate = false; this.farGroup.matrixAutoUpdate = false;
    this.nearGroup.name = 'vegetation-near'; this.farGroup.name = 'vegetation-far';
    this.material = makeVegMaterial(shared, this.fade, leafTex, { on: this.farOn, layer: false });
    this.farMat = makeVegMaterial(shared, this.fade, leafTex, { on: this.farOn, layer: true });
    this.leafTex = leafTex;
    const depthUniforms = { uTime: shared.uTime, uWindDir: shared.uWindDir, uLeafTex: leafTex, uCamBody: shared.uCamBody, uBodyToView: shared.uBodyToView, uFade: this.fade, uWindK: WIND_K, uLodBand: LOD_BAND, uGodWind: GOD_WIND, uFarOn: this.farOn, uFarBand: FAR_BAND, uPxPerRad: PX_PER_RAD, uFarHulls: FAR_HULLS };
    this.farDepth = new ShaderMaterial({ vertexShader: VEG_DEPTH_VERT, fragmentShader: VEG_DEPTH_FRAG, uniforms: depthUniforms, colorWrite: false, side: DoubleSide, defines: { VEG_FAR: '' } });
    // the far hulls' table (once per page: the leaf atlas' tile colours are the same for every world)
    farTable ??= farHullTable(KINDS, VARIANTS, (k) => SHRUB_KINDS.includes(k) || k === 'kelp', leafTex.value as Texture | null);
    FAR_HULLS.value = farTable.tex;
    // one far mesh from the start (hidden, empty) so the load-time warm-up links the far program and its depth twin
    this.farBucket(0, 0);
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
          whiteColors(mesh, cap);
          mesh.count = 0;
          mesh.frustumCulled = false;
          mesh.matrixAutoUpdate = false;
          const depth = new ShaderMaterial({ vertexShader: VEG_DEPTH_VERT, fragmentShader: VEG_DEPTH_FRAG, uniforms: depthUniforms, colorWrite: false, side: DoubleSide });
          geo.computeBoundingSphere();
          const bs = geo.boundingSphere!;
          this.buckets.push({ mesh, depth, count: 0, kind: k, variant: v, lod: l, extra, dist: new Float32Array(cap), binEnd: new Uint32Array(NB), geoR: bs.center.length() + bs.radius, eMax: 0, dMax: 0 });
          this.nearGroup.add(mesh);
        }
      }
    }
  }

  setShadowCasting(on: boolean): void {
    if (on === this.castShadows) return;
    this.castShadows = on;
    for (const b of this.buckets) { if (on) b.mesh.layers.enable(1); else b.mesh.layers.disable(1); }
    for (const b of this.far) if (b) { if (on) b.mesh.layers.enable(1); else b.mesh.layers.disable(1); }
  }

  swapDepth(depth: boolean): void {
    for (const b of this.buckets) b.mesh.material = depth ? b.depth : this.material;
    for (const b of this.far) if (b) b.mesh.material = depth ? this.farDepth : this.farMat;
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
    const cellLook = treeSp && treeSp[c] >= 0 ? SPECIES[Math.round(treeSp[c])] : null;
    const wetC = water ? water[c] : 0;
    if ((tc > 0.02 || sc > 0.02) && (wetC <= 1 || (cellLook != null && cellLook.wetMax > 0 && wetC <= cellLook.wetMax + 0.3))) {
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
      const near = this.clearings.get(c);
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
        // no tree inside a building or on its doorstep: the town's footprint is cleared
        if (near) {
          for (let k = 0; k < near.length; k += 4) {
            const ddx = dx - near[k], ddy = dy - near[k + 1], ddz = dz - near[k + 2];
            const r = isShrub ? near[k + 3] - SHRUB_CLOSER : near[k + 3];
            if ((ddx * ddx + ddy * ddy + ddz * ddz) * R0 * R0 < r * r) return;
          }
        }
        const hit = g.locate(dx, dy, dz);
        const at = (f: Float32Array | undefined) => (f ? f[hit.a] * hit.wa + f[hit.b] * hit.wb + f[hit.c] * hit.wc : 0);
        // groves and clearings: a ~45 m clumping noise modulates the acceptance (mean ≈ 1), so stands cluster
        // instead of filling the field's area evenly
        const fq = R0 / 45;
        const clump = Math.min(1.6, Math.max(0.15, 1 + 1.1 * pv.noise.noise(dx * fq + 3.3, dy * fq, dz * fq - 1.7)));
        const cover = (under ? at(tree) * 0.7 : isShrub ? at(shrub) : at(tree)) * (under ? 1 : clump);
        if (h3 > cover) return;
        // (no tree or bush on a field: the terrain tills its rows from crop ≈ 0.02 and they are plain by ≈ 0.1 — cleared
        // only above 0.4, palms stood in the furrows of every young field; orchards are trees, not crop)
        const wAt = at(water);
        if ((wAt > 0.05 && isShrub) || at(road) > 0.45 || at(crop) > 0.08 || at(snow) > 1.2 || (at(sand) > 0.5 && isShrub)) return;
        const t = at(temp), m = at(moist), b = at(burnt);
        // species: one of the three cells around the point, chosen by its weight (stands mix along their borders)
        const hs4 = hashFloat(c, i, salt + 6);
        const pick = hs4 < hit.wa ? hit.a : hs4 < hit.wa + hit.wb ? hit.b : hit.c;
        const spf = isShrub ? shrubSp : treeSp;
        let sp = spf ? Math.round(spf[pick]) : -1;
        if (sp < 0 && spf) sp = Math.round(spf[c]);
        if (!isShrub && PLANT_PROBE.tree.size) sp = PLANT_PROBE.tree.get(sp) ?? sp;
        let look = sp >= 0 && sp < SPECIES.length ? SPECIES[sp] : null;
        if (look && look.layer === 'sea') return; // kelp grows under the sea, placed above
        // a species of the wrong functional type for this layer (a mod, a stale index) is ignored, not obeyed
        if (look && (look.layer === 'shrub') !== isShrub) look = null;
        // standing water: only a tree that grows in it (mangrove) stands there, up to its depth
        if (wAt > 0.05 && !(look && look.wetMax > 0 && wAt <= look.wetMax + 0.3)) return;
        // (sand: no tree on a beach or a dune — but a mangrove's bed is the tidal sand it stands in)
        if (at(sand) > 0.5 && !(look && look.wetMax > 0)) return;
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
    this.young.set(c, this.epoch);
    return rec;
  }

  /**
   * Index the buildings' clearings by the cells whose scattered plants they can reach (a plant lies within ~0.62 of a
   * cell's spacing of its centre), and drop the cached plants of only the cells whose clearings changed: a new house
   * fells the trees on its plot, a fresh town does not re-scatter the whole forest.
   */
  private syncClearings(pv: PlanetView): void {
    const b = pv.buildings ?? null;
    const tc = towerClearings(pv.towers);
    if (b === this.clearBlock && tc.sig === this.towerSig) return;
    this.clearBlock = b;
    this.towerSig = tc.sig;
    let h = 0;
    const n = b ? b.count : 0;
    if (b) {
      for (let i = 0; i < n; i++) {
        h = (Math.imul(h, 31) + b.id[i]) | 0;
        h = (Math.imul(h, 31) + b.type[i]) | 0;
        h = (Math.imul(h, 31) + Math.round(b.pos[i * 3] * 4e6) + Math.round(b.pos[i * 3 + 2] * 4e6)) | 0;
        h = (Math.imul(h, 31) + Math.round((b.scale[i] || 1) * 20)) | 0;
      }
    }
    const sig = `${pv.id}|${n}|${h}|${tc.sig}`;
    if (sig === this.clearSig) return;
    this.clearSig = sig;
    const g = pv.grid, R = pv.params.radius;
    const next = new Map<number, number[]>();
    if (b) {
      for (let i = 0; i < n; i++) {
        const look = buildingAt(b.type[i]);
        const sc = Math.max(0.4, Math.min(4, b.scale[i] || 1));
        const clear = 0.5 * Math.hypot(look.w, look.d) * sc + (CLEAR_MARGIN[look.kind] ?? CLEAR_DEFAULT);
        let ux = b.pos[i * 3], uy = b.pos[i * 3 + 1], uz = b.pos[i * 3 + 2];
        const l = Math.hypot(ux, uy, uz) || 1;
        ux /= l; uy /= l; uz /= l;
        const c0 = g.nearestCell(ux, uy, uz);
        const reach = clear + Math.sqrt(g.area[c0]) * R * 0.75;
        for (const c of g.cellsWithin(ux, uy, uz, reach / R, _cells)) {
          let a = next.get(c);
          if (!a) next.set(c, (a = []));
          a.push(ux, uy, uz, clear);
        }
      }
    }
    // the towers' sites: the whole base, the stair's foot, the piles and the struck mound (a tree never stands on a
    // terrace or grows out of the rubble)
    for (let k = 0; k < tc.at.length; k += 4) {
      const ux = tc.at[k], uy = tc.at[k + 1], uz = tc.at[k + 2], clear = tc.at[k + 3];
      const c0 = g.nearestCell(ux, uy, uz);
      const reach = clear + Math.sqrt(g.area[c0]) * R * 0.75;
      for (const c of g.cellsWithin(ux, uy, uz, reach / R, _cells)) {
        let a = next.get(c);
        if (!a) next.set(c, (a = []));
        a.push(ux, uy, uz, clear + SHRUB_CLOSER);
      }
    }
    let changed = false;
    const same = (x: number[] | undefined, y: number[] | undefined): boolean => {
      if (!x || !y) return x === y;
      if (x.length !== y.length) return false;
      for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return false;
      return true;
    };
    for (const [c, a] of next) if (!same(a, this.clearings.get(c))) { this.dropCell(c); changed = true; }
    for (const c of this.clearings.keys()) if (!next.has(c)) { this.dropCell(c); changed = true; }
    this.clearings = next;
    if (changed) this.lastFrame = -1e9;
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
    // (the scatter's own fields — tree, shrub, burnt, species — drop only the cells around a changed value: below)
    const stamp = `${this.density}|${PLANT_PROBE.version}`;
    // PERF F9: a new ground drops only the cached cells whose inputs changed (below), not the whole cache
    const sv = pv.fieldVersion.get('surface') ?? 0;
    this.syncEpoch(pv);
    if (sv !== this.surfVer) { this.surfVer = sv; this.groundChanged(pv); }
    // a season step re-tints the instances (autumn colour) without re-scattering them
    const season = Math.floor(this.yearFrac * 48);
    if (season !== this.seasonStep) { this.seasonStep = season; this.lastFrame = -1e9; }
    if (stamp !== this.stamp) { this.stamp = stamp; this.dropAll(); this.lastFrame = -1e9; }
    this.plantFieldsChanged(pv);
    this.syncClearings(pv);
    const R = pv.params.radius;
    const rc = camBody.length();
    const alt = rc - R - Math.max(0, pv.maxSurface * 0.5);
    const range = this.range;
    this.fade.value.x = range * 0.72;
    this.fade.value.y = range;
    // (with the far layer the near trees stay on at any height: what is within range is drawn — a mountain's forest
    // under a high camera too; without it they switch off up where nothing is within range anyway)
    const visible = this.enabled && (this.farOn.value > 0.5 || alt < range * 1.2);
    this.nearGroup.visible = visible;
    this.farUpdate(pv, camBody, frame, range);
    // PERF P2 (no pop-in, no stall on arrival): the plants of the cells about to come into range are scattered ahead,
    // a few ms a frame — while descending toward the trees' altitude and in a ring beyond the drawn range — so the
    // frame that first draws them finds them ready (it scattered every cell within range at once: a long frame)
    if (this.enabled && alt < range * 2.5) this.prefetch(pv, camBody, range);
    if (!visible) { this.stats.instances = 0; return; }
    const moved = camBody.distanceTo(this.lastCam);
    if (moved < range * 0.04 && frame - this.lastFrame < 240) return;
    this.lastCam.copy(camBody);
    this.lastFrame = frame;
    // gather from the cells around the point under the camera
    const dx = camBody.x / rc, dy = camBody.y / rc, dz = camBody.z / rc;
    const cells = pv.grid.cellsWithin(dx, dy, dz, (range + 60) / R);
    for (const b of this.buckets) { b.count = 0; b.eMax = 0; b.dMax = 0; }
    const lod0 = range * 0.16, lod1 = range * 0.42;
    const b0a = lod0 * 0.85, b0b = lod0 * 1.15, b1a = lod1 * 0.88, b1b = lod1 * 1.12;
    LOD_BAND.value.set(b0a, b0b, b1a, b1b);
    // the camera moves up to range * 0.04 before the next rebuild: trees that may enter a band by then draw in both LODs
    const M = range * 0.04 + 2;
    const env = plantEnv(pv, dy, this.yearFrac);
    // PERF (session 6): each cell's instance data (matrix, tint, extra) is made once and kept with its plants — a
    // rebuild (every few metres the camera moves) only picks LODs and copies; it re-made every plant's matrix and
    // sampled four fields per plant each time. Re-made with the cell's plants, a season step, the camera changing
    // hemisphere, or a snow / fire / burnt / tree change around it (plantFieldsChanged).
    const envKey = `${this.seasonStep}|${dy >= 0 ? 1 : 0}`;
    if (envKey !== this.nearEnv) { this.nearEnv = envKey; this.nearInst.clear(); }
    let total = 0;
    for (const c of cells) {
      const rec = this.cellPlants(pv, c);
      let ni = this.nearInst.get(c);
      if (!ni || ni.rec !== rec) {
        const np = rec.length / REC;
        ni = { rec, m: new Float32Array(np * 16), c: new Float32Array(np * 3), e: new Float32Array(np * 4), sx: new Float32Array(np) };
        for (let q = 0; q < np; q++) ni.sx[q] = plantInstance(pv, rec, q * REC, env, ni.m, q * 16, ni.c, q * 3, ni.e, q * 4);
        this.nearInst.set(c, ni);
      }
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
        const q = i / REC;
        const sxMax = ni.sx[q];
        for (const [b, role] of bB ? [[bA, ra], [bB, rb]] as const : [[bA, ra]] as const) {
          const n = b.count;
          (b.mesh.instanceMatrix.array as Float32Array).set(ni.m.subarray(q * 16, q * 16 + 16), n * 16);
          (b.mesh.instanceColor!.array as Float32Array).set(ni.c.subarray(q * 3, q * 3 + 3), n * 3);
          const ea = b.extra.array as Float32Array;
          ea[n * 4] = ni.e[q * 4]; ea[n * 4 + 1] = ni.e[q * 4 + 1]; ea[n * 4 + 2] = ni.e[q * 4 + 2]; ea[n * 4 + 3] = role + ni.e[q * 4 + 3];
          b.dist[n] = d;
          if (d > b.dMax) b.dMax = d;
          b.count++;
          const e = b.geoR * Math.max(rec[i + 5], sxMax);
          if (e > b.eMax) b.eMax = e;
        }
        total++;
      }
    }
    this.binW = Math.max(1, range / NB);
    for (const b of this.buckets) {
      if (b.count) this.orderByBand(b);
      b.mesh.count = b.count;
      b.mesh.visible = b.count > 0;
      if (b.count) {
        uploadPrefix(b.mesh.instanceMatrix, b.count);
        uploadPrefix(b.mesh.instanceColor, b.count);
        uploadPrefix(b.extra, b.count);
      }
    }
    this.stats.instances = total;
    this.stats.cells = cells.length;
    if (this.nearInst.size > cells.length * 3 + 64) { const keep = new Set(cells); for (const c of [...this.nearInst.keys()]) if (!keep.has(c)) this.nearInst.delete(c); }
  }

  // ── PERF P2 (session 6): the FAR-TREE layer ────────────────────────────────────────────────────────────────────
  // Every tree past the near range is still drawn — the same plant records as the near trees (cellPlants), the same
  // instance matrix, tint and extra (plantInstance) — as a hull of its own LOD-2 mesh (farcrown.ts), so a forest
  // exists at every altitude and nothing grows into view around the camera. The hull takes the near tree's chunks
  // over across the hand-over band and gives itself up to the terrain's canopy shading only where the tree is a few
  // pixels tall (FAR_PX, by its true height and the view's pixels per radian). Per cell the trees are made once into a
  // block (matrix, tint, extra) and placed into the far buckets' slots incrementally as cells enter / leave; a
  // changed input re-makes just the cells around it (stale blocks keep drawing until their new one is ready).
  readonly nearGroup = new Group();
  readonly farGroup = new Group();
  /** 1 = the far layer is on (`?fartrees=0` turns it off: the old shrink-into-the-canopy hand-over) */
  readonly farOn: IUniform<number> = { value: FAR_DEFAULT ? 1 : 0 };
  /** render pixels per radian of the view (vertical), set by the planet view each frame */
  pxPerRad = 536;
  farStats = { instances: 0, cells: 0, blocks: 0, built: 0, queue: 0, ms: 0, refreshMs: 0, refreshCells: 0, grows: 0 };
  private farMat: MeshStandardMaterial;
  private farDepth: ShaderMaterial;
  private leafTex: IUniform;
  private far: (FarBucket | undefined)[] = [];
  private blocks = new Map<number, FarBlock>();
  /** cell -> lod flags placed (1 hull lod 0, 2 hull lod 1) and their slots [bucket, start, count]... per lod */
  private placed = new Map<number, { f: number; s0: number[]; s1: number[]; band: number }>();
  /** the point the far buckets' distance bounds are measured from (farBounds) */
  private farAnchor = new Vector3(1e9, 0, 0);
  private farBoundsDirty = true;
  private farCam = new Vector3(1e9, 0, 0);
  private farPx = 0;
  private farFrame = -1e9;
  private farWant: number[] = [];
  private farWantAt = 0;
  private farEnv = '';
  private fRefs = new Map<string, Float32Array | null>();
  private farEMax = 0;
  private farMark = new Uint32Array(0);
  /** near trees: per cell the instance data of its plants (made with them; see update) */
  private nearInst = new Map<number, { rec: Float32Array; m: Float32Array; c: Float32Array; e: Float32Array; sx: Float32Array }>();
  private nearEnv = '';
  private farPend: number[] = [];
  private scan: { cells: number[]; i: number; stamp: number; kept: number; want: number[]; wantD: number[]; pend: number[]; pendD: number[]; ms: number } | null = null;
  private farPendAt = 0;
  private farStamp = 0;

  /** the cached plants of a cell go (its inputs changed); its far block is re-made too (it keeps drawing till then) */
  private dropCell(c: number): void {
    this.cache.delete(c);
    const b = this.blocks.get(c);
    if (b) { b.stale = true; this.farFrame = -1e9; }
  }
  private dropAll(): void {
    this.cache.clear();
    for (const b of this.blocks.values()) b.stale = true;
    this.farFrame = -1e9;
  }

  /**
   * The scatter's own fields (tree, shrub, burnt, species) and the far tint's (snow, fire) were republished: diff the
   * arrays, drop the cells within two rings of a changed value (a plant reads the three cells around its point) —
   * the near trees re-scatter only those, the far blocks around them are re-made. Was: the whole cache cleared at
   * every republish of the tree field (every cell in range re-scattered in one frame).
   */
  private plantFieldsChanged(pv: PlanetView): void {
    const n = pv.grid.count;
    let dirty: Uint8Array | null = null, tint: Uint8Array | null = null, full = false;
    for (const f of PLANT_FIELDS) {
      const now = pv.fields.get(f) ?? null;
      if (!this.fRefs.has(f)) { this.fRefs.set(f, now); continue; }
      const then = this.fRefs.get(f) ?? null;
      if (now === then) continue;
      this.fRefs.set(f, now);
      const scatter = f !== 'snow' && f !== 'fire';
      if (!now || !then || now.length !== n || then.length !== n) { if (scatter) full = true; else tint = new Uint8Array(n).fill(1); continue; }
      const d = scatter ? (dirty ??= new Uint8Array(n)) : (tint ??= new Uint8Array(n));
      for (let c = 0; c < n; c++) if (now[c] !== then[c]) d[c] = 1;
    }
    if (full) { this.dropAll(); this.lastFrame = -1e9; return; }
    const ns = pv.grid.nbrStart, nb = pv.grid.nbr;
    const grow = (m: Uint8Array, rings: number): Uint8Array => {
      let cur = m;
      for (let r = 0; r < rings; r++) { const g = cur.slice(); for (let c = 0; c < n; c++) if (cur[c]) for (let e = ns[c]; e < ns[c + 1]; e++) g[nb[e]] = 1; cur = g; }
      return cur;
    };
    if (dirty) {
      const cur = grow(dirty, 2);
      let any = false;
      for (const c of [...this.cache.keys()]) if (cur[c]) { this.dropCell(c); any = true; }
      for (const [c, b] of this.blocks) if (cur[c]) b.stale = true;
      if (any) this.lastFrame = -1e9;
      this.farFrame = -1e9;
    }
    if (tint) {
      const cur = grow(tint, 1);
      for (const [c, b] of this.blocks) if (cur[c]) b.stale = true;
      for (const c of [...this.nearInst.keys()]) if (cur[c]) { this.nearInst.delete(c); this.lastFrame = -1e9; }
      this.farFrame = -1e9;
    }
  }

  /** the far block of a cell: its trees (no shrubs, no kelp) as instance data grouped by bucket key */
  private makeBlock(pv: PlanetView, c: number, env: PlantEnv, keepRec: boolean): FarBlock {
    const had = this.cache.has(c);
    const rec = this.cellPlants(pv, c);
    if (!had && !keepRec) { this.cache.delete(c); this.young.delete(c); }
    const idx: number[] = [];
    for (let i = 0; i < rec.length; i += REC) { const k = rec[i + 6]; if (!IS_SHRUB[k] && k !== KELP) idx.push(i); }
    idx.sort((a, b) => (rec[a + 6] * VARIANTS + rec[a + 7]) - (rec[b + 6] * VARIANTS + rec[b + 7]));
    const n = idx.length;
    const blk: FarBlock = { n, keys: [], starts: [], m: new Float32Array(n * 16), c: new Float32Array(n * 3), e: new Float32Array(n * 4), hMin: 1e9, hMax: 0, cx: 0, cy: 0, cz: 0, r: 0, stale: false, env: this.farEnv };
    let sx = 0, sy = 0, sz = 0;
    for (let j = 0; j < n; j++) {
      const i = idx[j];
      const key = rec[i + 6] * VARIANTS + rec[i + 7];
      if (!blk.keys.length || blk.keys[blk.keys.length - 1] !== key) { blk.keys.push(key); blk.starts.push(j); }
      const g = plantInstance(pv, rec, i, env, blk.m, j * 16, blk.c, j * 3, blk.e, j * 4);
      const h = rec[i + 5];
      if (h < blk.hMin) blk.hMin = h;
      if (h > blk.hMax) blk.hMax = h;
      const e = h * Math.max(1, g / h) * 1.2;
      if (e > this.farEMax) this.farEMax = e;
      sx += blk.m[j * 16 + 12]; sy += blk.m[j * 16 + 13]; sz += blk.m[j * 16 + 14];
    }
    blk.starts.push(n);
    if (n) {
      blk.cx = sx / n; blk.cy = sy / n; blk.cz = sz / n;
      for (let j = 0; j < n; j++) blk.r = Math.max(blk.r, Math.hypot(blk.m[j * 16 + 12] - blk.cx, blk.m[j * 16 + 13] - blk.cy, blk.m[j * 16 + 14] - blk.cz));
    }
    return blk;
  }

  private farBucket(band: number, lod: number): FarBucket {
    const id = band * 2 + lod;
    let b = this.far[id];
    if (b) return b;
    b = { mesh: null as unknown as InstancedMesh, extra: null as unknown as InstancedBufferAttribute, hull: null as unknown as InstancedBufferAttribute, cap: 0, hi: 0, live: 0, free: [], dirty: [], band, lod, dMin: Infinity, dMax: -Infinity };
    this.growBucket(b, 2048);
    this.far[id] = b;
    return b;
  }

  /** (re)make a far bucket's mesh with room for `cap` instances, keeping its contents */
  private growBucket(b: FarBucket, cap: number): void {
    const geo = new BufferGeometry();
    const tpl = farTable!.tpl[b.lod];
    geo.setIndex(tpl.getIndex());
    geo.setAttribute('position', tpl.getAttribute('position'));
    geo.setAttribute('normal', tpl.getAttribute('normal'));
    const extra = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    extra.setUsage(DynamicDrawUsage);
    geo.setAttribute('iExtra', extra);
    const hull = new InstancedBufferAttribute(new Float32Array(cap), 1);
    hull.setUsage(DynamicDrawUsage);
    geo.setAttribute('iHull', hull);
    const mesh = new InstancedMesh(geo, this.farMat, cap);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    whiteColors(mesh, cap);
    if (!mesh.instanceColor) mesh.setColorAt(0, _c.setRGB(1, 1, 1));
    (mesh.instanceMatrix.array as Float32Array).fill(0);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'fartrees';
    if (this.castShadows) mesh.layers.enable(1);
    const old = b.mesh;
    if (old) {
      (mesh.instanceMatrix.array as Float32Array).set((old.instanceMatrix.array as Float32Array).subarray(0, b.hi * 16));
      (mesh.instanceColor!.array as Float32Array).set((old.instanceColor!.array as Float32Array).subarray(0, b.hi * 3));
      (extra.array as Float32Array).set((b.extra.array as Float32Array).subarray(0, b.hi * 4));
      (hull.array as Float32Array).set((b.hull.array as Float32Array).subarray(0, b.hi));
      mesh.material = old.material as MeshStandardMaterial;
      this.farGroup.remove(old);
      // (the shared index / position of the lod template stay — a geometry's dispose frees every buffer it holds — only
      // its instance buffers go)
      old.dispose(); old.geometry.setIndex(null); old.geometry.deleteAttribute('position'); old.geometry.deleteAttribute('normal'); old.geometry.dispose();
      b.dirty = [0, b.hi];
    }
    mesh.count = b.hi;
    mesh.visible = b.hi > 0;
    b.mesh = mesh; b.extra = extra; b.hull = hull; b.cap = cap;
    this.farGroup.add(mesh);
  }

  private allocSlots(b: FarBucket, n: number): number {
    for (let k = 0; k < b.free.length; k += 2) {
      if (b.free[k + 1] < n) continue;
      const at = b.free[k];
      if (b.free[k + 1] === n) b.free.splice(k, 2); else { b.free[k] += n; b.free[k + 1] -= n; }
      return at;
    }
    if (b.hi + n > b.cap) { this.growBucket(b, Math.max(b.cap * 2, Math.ceil((b.hi + n) * 1.5))); this.farStats.grows++; }
    const at = b.hi;
    b.hi += n;
    return at;
  }

  private freeSlots(b: FarBucket, at: number, n: number): void {
    (b.mesh.instanceMatrix.array as Float32Array).fill(0, at * 16, (at + n) * 16);
    b.dirty.push(at, n);
    b.live -= n;
    // insert sorted, merge with neighbours, give a free tail back to the high-water mark
    let k = 0;
    while (k < b.free.length && b.free[k] < at) k += 2;
    b.free.splice(k, 0, at, n);
    if (k + 2 < b.free.length && b.free[k] + b.free[k + 1] === b.free[k + 2]) { b.free[k + 1] += b.free[k + 3]; b.free.splice(k + 2, 2); }
    if (k > 0 && b.free[k - 2] + b.free[k - 1] === b.free[k]) { b.free[k - 1] += b.free[k + 1]; b.free.splice(k, 2); k -= 2; }
    const L = b.free.length;
    if (L && b.free[L - 2] + b.free[L - 1] === b.hi) { b.hi = b.free[L - 2]; b.free.length = L - 2; }
  }

  /** a cell's trees of one hull lod into the far bucket of its distance band: one slot range, every kind together */
  private place(c: number, blk: FarBlock, lod: number, band: number): number[] {
    const n = blk.n;
    if (!n) return [];
    const b = this.farBucket(band, lod);
    const at = this.allocSlots(b, n);
    (b.mesh.instanceMatrix.array as Float32Array).set(blk.m, at * 16);
    (b.mesh.instanceColor!.array as Float32Array).set(blk.c, at * 3);
    const ea = b.extra.array as Float32Array;
    ea.set(blk.e, at * 4);
    // role: 6 hull lod 0, 7 hull lod 1 (+ the canopy fraction already in the extra's w)
    for (let q = 0; q < n; q++) ea[(at + q) * 4 + 3] += 6 + lod;
    // the hull of each tree: its row in the far hull table
    const ha = b.hull.array as Float32Array;
    for (let g = 0; g < blk.keys.length; g++) ha.fill(blk.keys[g] * 2 + lod, at + blk.starts[g], at + blk.starts[g + 1]);
    b.dirty.push(at, n);
    b.live += n;
    this.farBoundsDirty = true;
    void c;
    return [band * 2 + lod, at, n];
  }

  private unplace(slots: number[]): void {
    for (let k = 0; k < slots.length; k += 3) { const b = this.far[slots[k]]; if (b) this.freeSlots(b, slots[k + 1], slots[k + 2]); }
    if (slots.length) this.farBoundsDirty = true;
  }

  /** which hull lods a cell's trees need at this camera (0: none), with `slack` (> 1 admits a little early) */
  private farNeed(blk: FarBlock, camBody: Vector3, inner: number, slack: number): number {
    if (!blk.n) return 0;
    const dc = Math.hypot(blk.cx - camBody.x, blk.cy - camBody.y, blk.cz - camBody.z);
    const dmin = Math.max(1, dc - blk.r - blk.hMax), dmax = dc + blk.r + blk.hMax;
    if (dmax < inner / slack) return 0;
    const f = this.pxPerRad;
    const pxMax = blk.hMax * f / dmin, pxMin = blk.hMin * f / dmax;
    if (pxMax * slack < FAR_PX.out[0]) return 0;
    let need = 0;
    if (pxMax * slack > FAR_PX.lod[0]) need |= 1;
    if (pxMin / slack < FAR_PX.lod[1]) need |= 2;
    return need;
  }

  private farUpdate(pv: PlanetView, camBody: Vector3, frame: number, range: number): void {
    const on = this.enabled && this.farOn.value > 0.5;
    this.farGroup.visible = on;
    if (!on) return;
    const t0 = performance.now();
    const R = pv.params.radius;
    const rc = camBody.length() || 1;
    const dx = camBody.x / rc, dy = camBody.y / rc, dz = camBody.z / rc;
    // the far tint's season (the near trees re-tint at every 1/48 year too); a new one re-makes the blocks, nearest first
    const env = plantEnv(pv, dy, this.yearFrac);
    const envKey = `${this.seasonStep}|${dy >= 0 ? 1 : 0}`;
    if (envKey !== this.farEnv) { this.farEnv = envKey; for (const b of this.blocks.values()) b.stale = true; this.farFrame = -1e9; }
    const inner = range * 0.72;
    // ── which cells: re-listed as the camera moves (a few % of its height) or the view's scale changes ──
    const moved = camBody.distanceTo(this.farCam);
    const altG = Math.max(5, rc - R - Math.max(0, pv.maxSurface));
    if (!this.scan && (moved > 3 + altG * 0.06 || Math.abs(this.pxPerRad - this.farPx) > this.farPx * 0.03 || frame - this.farFrame > 90)) {
      this.farCam.copy(camBody); this.farPx = this.pxPerRad; this.farFrame = frame;
      // every forest cell above the horizon (the tallest form decides how far a cell's trees can matter)
      const hor = Math.acos(Math.min(1, R / rc)) + Math.acos(Math.min(1, R / (R + Math.max(50, pv.maxSurface))));
      const reach = (FAR_H_MAX * this.pxPerRad * PREFETCH) / FAR_PX.out[0];
      const ang = Math.min(Math.PI, hor, Math.acos(Math.max(-1, Math.min(1, (R * R + rc * rc - reach * reach) / (2 * R * rc)))) + 0.02);
      if (this.farMark.length !== pv.grid.count) this.farMark = new Uint32Array(pv.grid.count);
      this.scan = { cells: pv.grid.cellsWithin(dx, dy, dz, ang).slice(), i: 0, stamp: ++this.farStamp, kept: 0, want: [], wantD: [], pend: [], pendD: [], ms: 0 };
    }
    // the listing is spread over a few frames (~1.5 ms each): the admission slack covers it
    const sc = this.scan;
    if (sc) {
      const ts = performance.now();
      const tree = pv.fields.get('tree'), shrub = pv.fields.get('shrub');
      const P = pv.grid.pos;
      const mark = this.farMark, stamp = sc.stamp;
      const cam = this.farCam;
      let k = sc.i;
      for (; k < sc.cells.length; k++) {
        if ((k & 255) === 255 && performance.now() - ts > FAR_SCAN_MS) break;
        const c = sc.cells[k];
        if (!((tree && tree[c] > 0.02) || (shrub && shrub[c] > 0.02))) continue;
        mark[c] = stamp; sc.kept++;
        const blk = this.blocks.get(c);
        const need = blk ? this.farNeed(blk, cam, inner, 1.15) : 0;
        const cur = this.placed.get(c);
        // (placement changes are applied over the next frames, nearest first, under the time budget: the admission
        // slack — a cell is placed some 15 % before its trees can show — covers the wait)
        const moveBand = !!(blk && need && cur && cur.f && this.farBand(blk, cam, inner, cur.band) !== cur.band);
        if (blk && ((cur?.f ?? 0) !== need || moveBand) && (!blk.stale || !need)) { sc.pend.push(c); sc.pendD.push(Math.hypot(blk.cx - cam.x, blk.cy - cam.y, blk.cz - cam.z)); }
        if (!blk || blk.stale) {
          // to make: what is (or may soon be) needed first; the rest of the visible forest in the background
          sc.want.push(c); sc.wantD.push(Math.hypot(P[c * 3] * R - cam.x, P[c * 3 + 1] * R - cam.y, P[c * 3 + 2] * R - cam.z));
        }
      }
      sc.i = k;
      sc.ms += performance.now() - ts;
      if (k >= sc.cells.length) {
        // cells no longer above the horizon / in reach: unplaced (their blocks kept a while for a camera coming back)
        for (const [c, cur] of this.placed) if (mark[c] !== stamp && cur.f) { this.unplace(cur.s0); this.unplace(cur.s1); this.placed.delete(c); }
        if (this.blocks.size > sc.kept * 1.5 + 2000) for (const c of [...this.blocks.keys()]) if (mark[c] !== stamp && !this.placed.has(c)) this.blocks.delete(c);
        const order = sc.want.map((_, i) => i).sort((a, b) => sc.wantD[a] - sc.wantD[b]);
        this.farWant = order.map((i) => sc.want[i]);
        this.farWantAt = 0;
        const po = sc.pend.map((_, i) => i).sort((a, b) => sc.pendD[a] - sc.pendD[b]);
        this.farPend = po.map((i) => sc.pend[i]);
        this.farPendAt = 0;
        this.farStats.refreshMs = sc.ms;
        this.farStats.refreshCells = sc.cells.length;
        this.scan = null;
      }
    }
    // ── placement changes (cheap: copies), then block making ──
    while (this.farPendAt < this.farPend.length && performance.now() - t0 < FAR_BUDGET_MS) {
      const c = this.farPend[this.farPendAt++];
      const blk = this.blocks.get(c);
      if (!blk) continue;
      const need = this.farNeed(blk, camBody, inner, 1.15);
      if (blk.stale && need) continue;
      const cur = this.placed.get(c);
      this.setPlacement(c, blk, need, cur, this.farBand(blk, camBody, inner, cur?.band ?? -1));
    }
    // ── make the blocks: nearest first, a time budget a frame (more while placed cells wait on a re-make) ──
    let built = 0;
    const nearR = range * 1.35 + 60;
    while (this.farWantAt < this.farWant.length) {
      const ms = performance.now() - t0;
      if (ms > FAR_BUDGET_MS) break;
      const c = this.farWant[this.farWantAt++];
      const old = this.blocks.get(c);
      if (old && !old.stale) continue;
      const P = pv.grid.pos;
      const keepRec = Math.hypot(P[c * 3] * R - camBody.x, P[c * 3 + 1] * R - camBody.y, P[c * 3 + 2] * R - camBody.z) < nearR;
      const blk = this.makeBlock(pv, c, env, keepRec);
      this.blocks.set(c, blk);
      built++;
      const cur = this.placed.get(c);
      if (cur && cur.f) { this.unplace(cur.s0); this.unplace(cur.s1); cur.s0 = []; cur.s1 = []; cur.f = 0; }
      this.setPlacement(c, blk, this.farNeed(blk, camBody, inner, 1.15), cur, this.farBand(blk, camBody, inner, cur?.band ?? -1));
    }
    // ── upload what changed ──
    let inst = 0;
    for (const b of this.far) {
      if (!b) continue;
      b.mesh.count = b.hi;
      b.mesh.visible = b.hi > 0;
      inst += b.live;
      if (b.dirty.length) {
        flushRanges(b.mesh.instanceMatrix, b.dirty, 16);
        flushRanges(b.mesh.instanceColor!, b.dirty, 3);
        flushRanges(b.extra, b.dirty, 4);
        flushRanges(b.hull, b.dirty, 1);
        b.dirty = [];
      }
      // a bucket mostly holes is compacted (its live ranges re-placed from their blocks next listing)
      if (b.hi > 4096 && b.live < b.hi * 0.25) this.compact(b);
    }
    if (this.farBoundsDirty) this.farBounds(camBody);
    this.farStats.instances = inst;
    this.farStats.cells = this.placed.size;
    this.farStats.blocks = this.blocks.size;
    this.farStats.built = built;
    this.farStats.queue = this.farWant.length - this.farWantAt + this.farPend.length - this.farPendAt + (this.scan ? 1 : 0);
    this.farStats.ms = performance.now() - t0;
  }

  /** the far band a cell's block belongs in at this camera (its current band while within the band's slack) */
  private farBand(blk: FarBlock, cam: Vector3, inner: number, cur: number): number {
    const d = Math.hypot(blk.cx - cam.x, blk.cy - cam.y, blk.cz - cam.z);
    return cur >= 0 && farBandKeeps(cur, d, inner) ? cur : farBandOf(d, inner);
  }

  private setPlacement(c: number, blk: FarBlock, need: number, cur: { f: number; s0: number[]; s1: number[]; band: number } | undefined, band: number): void {
    const f = cur?.f ?? 0;
    if (f === need && (!need || cur!.band === band)) return;
    const st = cur ?? { f: 0, s0: [], s1: [], band };
    if (st.band !== band) { this.unplace(st.s0); this.unplace(st.s1); st.s0 = []; st.s1 = []; st.f = 0; st.band = band; }
    const was = st.f;
    if ((was & 1) && !(need & 1)) { this.unplace(st.s0); st.s0 = []; }
    if ((was & 2) && !(need & 2)) { this.unplace(st.s1); st.s1 = []; }
    if (!(was & 1) && (need & 1)) st.s0 = this.place(c, blk, 0, band);
    if (!(was & 2) && (need & 2)) st.s1 = this.place(c, blk, 1, band);
    st.f = need;
    if (need) this.placed.set(c, st); else this.placed.delete(c);
  }

  /** re-pack a bucket: every placed cell's range in it is written again from the start (one full upload) */
  private compact(b: FarBucket): void {
    const id = b.band * 2 + b.lod;
    const ma = b.mesh.instanceMatrix.array as Float32Array, ca = b.mesh.instanceColor!.array as Float32Array, ea = b.extra.array as Float32Array;
    const ha = b.hull.array as Float32Array;
    const m2 = new Float32Array(ma.length), c2 = new Float32Array(ca.length), e2 = new Float32Array(ea.length), h2 = new Float32Array(ha.length);
    let at = 0;
    for (const st of this.placed.values()) {
      for (const sl of [st.s0, st.s1]) for (let k = 0; k < sl.length; k += 3) {
        if (sl[k] !== id) continue;
        const s0 = sl[k + 1], n = sl[k + 2];
        m2.set(ma.subarray(s0 * 16, (s0 + n) * 16), at * 16); c2.set(ca.subarray(s0 * 3, (s0 + n) * 3), at * 3); e2.set(ea.subarray(s0 * 4, (s0 + n) * 4), at * 4);
        h2.set(ha.subarray(s0, s0 + n), at);
        sl[k + 1] = at; at += n;
      }
    }
    ma.set(m2); ca.set(c2); ea.set(e2); ha.set(h2);
    b.hi = at; b.live = at; b.free = []; b.dirty = [0, at];
    b.mesh.count = at;
  }

  /** each far bucket's distance bounds from `anchor` over its placed cells (crown extent included) */
  private farBounds(anchor: Vector3): void {
    this.farAnchor.copy(anchor);
    this.farBoundsDirty = false;
    for (const b of this.far) if (b) { b.dMin = Infinity; b.dMax = -Infinity; }
    for (const [c, st] of this.placed) {
      const blk = this.blocks.get(c);
      if (!blk || !st.f) continue;
      const d = Math.hypot(blk.cx - anchor.x, blk.cy - anchor.y, blk.cz - anchor.z), ext = blk.r + blk.hMax * 1.2;
      for (const lod of [0, 1]) {
        if (!(st.f & (1 << lod))) continue;
        const b = this.far[st.band * 2 + lod];
        if (!b) continue;
        if (d - ext < b.dMin) b.dMin = d - ext;
        if (d + ext > b.dMax) b.dMax = d + ext;
      }
    }
  }

  /**
   * PERF F6 / F22 for the far layer, per distance band (PERF item 3): cascade k draws a band only if a shadow of one of
   * its trees can reach the cascade's sphere (the band's distance bounds from the anchor against the sphere's, widened
   * by the trees' shadow reach) and can fall at a view depth past the previous split (F22's near cut: the trees'
   * distance from the camera plus their reach). Same bounds as the near trees' (treeShadowReach: the sun's elevation at
   * the trees, curvature and slopes included); a sun too low to bound draws every band. k < 0 restores.
   */
  private farShadow(k: number, cx: number, cy: number, cz: number, r: number, sinEl: number, radius: number, cam?: { x: number; y: number; z: number }, nearSplit = 0, margin = 0): void {
    if (!this.farGroup.visible) return;
    if (k < 0) { for (const b of this.far) if (b) b.mesh.visible = b.hi > 0; return; }
    const A = this.farAnchor;
    const dcA = Math.hypot(cx - A.x, cy - A.y, cz - A.z);
    const move = cam ? Math.hypot(cam.x - A.x, cam.y - A.y, cam.z - A.z) : Infinity;
    const el0 = Math.asin(Math.max(-1, Math.min(1, sinEl))) - 0.2;
    for (const b of this.far) {
      if (!b) continue;
      let show = b.hi > 0;
      if (show && b.dMax >= b.dMin) {
        // (the trees are within dMax + move of the camera: the sun is at least that high over them)
        const dFar = b.dMax + (Number.isFinite(move) ? move : 0);
        const reach = treeShadowReach(this.farEMax, el0, Math.max(dFar, dcA + r), radius);
        if (Number.isFinite(reach)) {
          // the band's annulus about the anchor against the cascade sphere grown by the reach
          if (b.dMin - dcA > r + reach + margin || dcA - b.dMax > r + reach + margin) show = false;
          // nothing of the band can shade a pixel past the previous split
          if (SH_NEAR && nearSplit > 0 && Number.isFinite(move) && nearSplitCut(dFar, reach, margin, nearSplit)) show = false;
        }
      }
      b.mesh.visible = show;
    }
  }

  private surfVer = -1;
  private pfCells: number[] = [];
  private pfAt = 0;
  private pfCam = new Vector3(1e9, 0, 0);

  /** scatter not-yet-cached cells within range + a ring beyond it, nearest first, ~2 ms a frame */
  private prefetch(pv: PlanetView, camBody: Vector3, range: number): void {
    const R = pv.params.radius;
    if (camBody.distanceTo(this.pfCam) > range * 0.08 || this.pfAt >= this.pfCells.length) {
      // (refreshed as the camera moves; once every cell is cached it only re-checks every ~30 m)
      if (camBody.distanceTo(this.pfCam) <= range * 0.08 && this.pfAt >= this.pfCells.length) return;
      this.pfCam.copy(camBody);
      const rc = camBody.length() || 1;
      const dx = camBody.x / rc, dy = camBody.y / rc, dz = camBody.z / rc;
      const cells = pv.grid.cellsWithin(dx, dy, dz, (range * 1.35 + 60) / R).slice();
      const P = pv.grid.pos;
      cells.sort((a, b) => (P[b * 3] * dx + P[b * 3 + 1] * dy + P[b * 3 + 2] * dz) - (P[a * 3] * dx + P[a * 3 + 1] * dy + P[a * 3 + 2] * dz));
      this.pfCells = cells.filter((c) => !this.cache.has(c));
      this.pfAt = 0;
    }
    const t0 = performance.now();
    while (this.pfAt < this.pfCells.length && performance.now() - t0 < 2) {
      const c = this.pfCells[this.pfAt++];
      if (!this.cache.has(c)) this.cellPlants(pv, c);
    }
  }
  private surfRev = -1;
  private refs = new Map<string, Float32Array | null>();
  /** cell -> input epoch it was scattered in, for cells first built since the last check */
  private young = new Map<number, number>();
  /** bumped whenever one of the VEG_INPUTS arrays is replaced (syncEpoch, every update) */
  private epoch = 0;
  private refsEpoch = -1;
  private epochArrs: (Float32Array | null)[] = [];

  private syncEpoch(pv: PlanetView): void {
    let i = 0, changed = false;
    for (const f of VEG_INPUTS) { const a = pv.fields.get(f) ?? null; if (this.epochArrs[i] !== a) { this.epochArrs[i] = a; changed = true; } i++; }
    if (changed) this.epoch++;
  }

  /**
   * PERF F9 — the ground changed. The cache used to be dropped whole (and with it every cell's scatter rebuilt) at
   * every surface version; the plants of a cell read the ground (heights + gradients: pv.groundRev) and, at their
   * points, the fields below, so only the cells within two rings of a cell where any of them changed are dropped.
   * Those fields were only ever refreshed by that drop, so they are diffed against what the cache was built from.
   * The plants of a cell are a pure function of these inputs (hashes of the cell id): the kept cells are what a
   * rebuild would make. Without per-cell revisions (or after a full pass) the whole cache drops as before.
   */
  private groundChanged(pv: PlanetView): void {
    this.syncEpoch(pv);
    const gr = pv.groundRev;
    const n = pv.grid.count;
    const names = VEG_INPUTS;
    const ok = !!gr && this.surfRev >= 0 && gr.fullRev <= this.surfRev && this.cache.size > 0;
    let dirty: Uint8Array | null = null;
    if (ok) {
      dirty = new Uint8Array(n);
      const cr = gr!.cellRev, since = this.surfRev;
      for (let c = 0; c < n; c++) if (cr[c] > since) dirty[c] = 1;
      for (const f of names) {
        const now = pv.fields.get(f) ?? null, then = this.refs.get(f) ?? null;
        if (now === then) continue;
        if (!now || !then || now.length !== n || then.length !== n) { dirty = null; break; }
        for (let c = 0; c < n; c++) if (now[c] !== then[c]) dirty[c] = 1;
      }
    }
    if (!dirty) this.dropAll();
    else {
      const ns = pv.grid.nbrStart, nb = pv.grid.nbr;
      let cur: Uint8Array = dirty;
      for (let ring = 0; ring < 2; ring++) {
        const grow: Uint8Array = cur.slice();
        for (let c = 0; c < n; c++) if (cur[c]) for (let e = ns[c]; e < ns[c + 1]; e++) grow[nb[e]] = 1;
        cur = grow;
      }
      for (const c of [...this.cache.keys()]) if (cur[c]) this.dropCell(c);
      for (const c of this.blocks.keys()) if (cur[c]) this.dropCell(c);
      // cells first built since the last check from other arrays than `refs` read the fields of their own moment:
      // they go too (one built from the arrays of the last check is as consistent with refs as the old ones)
      for (const [c, ep] of this.young) if (ep !== this.refsEpoch) this.dropCell(c);
    }
    for (const f of names) this.refs.set(f, pv.fields.get(f) ?? null);
    this.young.clear();
    this.refsEpoch = this.epoch;
    this.surfRev = gr ? gr.rev : -1;
    this.lastFrame = -1e9;
  }

  private binW = 8;
  private sortTmp = new Float32Array(0);
  private binCur = new Uint32Array(NB);

  /** counting sort of a bucket's instances by distance band (matrix, colour, extra, distance move together) */
  private orderByBand(b: Bucket): void {
    const n = b.count, inv = 1 / this.binW, end = b.binEnd, cur = this.binCur;
    end.fill(0);
    for (let i = 0; i < n; i++) end[Math.min(NB - 1, Math.floor(b.dist[i] * inv))]++;
    let acc = 0;
    for (let j = 0; j < NB; j++) { cur[j] = acc; acc += end[j]; end[j] = acc; }
    const perm = new Uint32Array(n);
    for (let i = 0; i < n; i++) perm[i] = cur[Math.min(NB - 1, Math.floor(b.dist[i] * inv))]++;
    const permute = (arr: Float32Array, w: number): void => {
      if (this.sortTmp.length < n * w) this.sortTmp = new Float32Array(n * w * 2);
      const t = this.sortTmp;
      for (let i = 0; i < n; i++) { const o = perm[i] * w, q = i * w; for (let c = 0; c < w; c++) t[o + c] = arr[q + c]; }
      arr.set(t.subarray(0, n * w));
    };
    permute(b.mesh.instanceMatrix.array as Float32Array, 16);
    if (b.mesh.instanceColor) permute(b.mesh.instanceColor.array as Float32Array, 3);
    permute(b.extra.array as Float32Array, 4);
    permute(b.dist, 1);
  }

  /**
   * PERF F6 — shadow cascade k (Renderer.perCascade; k < 0 restores): draw only the trees that can throw a shadow into
   * the cascade's sphere (centre c in the body frame, radius r): within r + their shadow's reach of c. The reach is
   * the tree's extent times (1 + cot of the sun's lowest elevation over the drawn range, less 0.2 rad for slopes
   * falling away from the sun); a sun that low draws everything. Instances are ordered by distance band from the
   * rebuild camera, so the cascade draws a prefix. The image is unchanged: what is left out cannot reach a pixel
   * that reads this cascade (the shader picks the cascade by view depth, inside its sphere).
   *
   * PERF F22 (session 9; g2u: near trees = 6.2 M of 7.1 M shadow triangles at Ultra, every LOD-0 tree in all four
   * cascades): a pixel reads cascade k only if its view depth is past the previous split `nearSplit`, so its distance
   * from the camera is too; a tree's shadow lies within its reach (the bound above) of the tree, and the tree within
   * dMax (+ the camera's move since the rebuild) of the camera. A bucket whose every tree is nearer than nearSplit less
   * its reach (less `margin`: filter taps and normal offset) cannot shade any pixel that reads cascade k and is left
   * out of it — the LOD-0 bucket (the costly full trees, within ~0.2 x range) then draws only into the first cascade
   * by day. Exact by the same argument as F6; a low sun (no finite reach) draws everything. `?shnear=0` = off.
   */
  shadowCascade(k: number, cx: number, cy: number, cz: number, r: number, sinEl: number, radius: number, cam?: { x: number; y: number; z: number }, nearSplit = 0, margin = 0): void {
    this.farShadow(k, cx, cy, cz, r, sinEl, radius, cam, nearSplit, margin);
    if (!this.nearGroup.visible) return;
    if (k < 0) {
      for (const b of this.buckets) { b.mesh.count = b.count; b.mesh.visible = b.count > 0; }
      return;
    }
    const L = this.lastCam;
    const dc = Math.hypot(cx - L.x, cy - L.y, cz - L.z);
    // the sun's elevation at a tree x metres from the camera is at least el − x / R (the planet's curvature: a
    // 3 km world turns 1° every 52 m). A tree that matters lies within dc + r + reach of the camera, and its reach
    // depends on that elevation: iterate reach = e (1 + cot(el − (dc + r + reach) / R − slopes)) up from 0
    // (monotone; a fixed point or a sun too low to bound it)
    const el0 = Math.asin(Math.max(-1, Math.min(1, sinEl))) - 0.2;
    let eMax = 0;
    for (const b of this.buckets) if (b.count && b.eMax > eMax) eMax = b.eMax;
    // (any x with f(x) <= x bounds the shadow: the ray from a crown top descends at least x·tan(el(x)) >= e over x)
    const f = (x: number): number => { const el = el0 - (dc + r + x) / radius; return el > 0.035 ? eMax * (1 + 1 / Math.tan(el)) + 4 : Infinity; };
    let reach = 0;
    for (let it = 0; it < 12 && Number.isFinite(reach); it++) reach = f(reach) * 1.02 + 0.5;
    if (!(f(reach) <= reach)) reach = Infinity;
    const elT = el0 - (dc + r + reach) / radius;
    const cot = Number.isFinite(reach) && elT > 0.035 ? 1 / Math.tan(elT) : Infinity;
    const dCam = cam ? Math.hypot(cam.x - L.x, cam.y - L.y, cam.z - L.z) : Infinity;
    const nearCut = SH_NEAR && nearSplit > 0 && Number.isFinite(dCam);
    for (const b of this.buckets) {
      if (!b.count) continue;
      const D = dc + r + b.eMax * (1 + cot) + 4;
      const j = Number.isFinite(D) ? Math.floor(D / this.binW) : NB;
      let n = j >= NB ? b.count : b.binEnd[j];
      if (nearCut && n > 0) {
        // (the sun's elevation at these trees: nearer the camera than the cascade, so less curvature than `cot`'s)
        const d0 = b.dMax + dCam;
        if (nearSplitCut(d0, treeShadowReach(b.eMax, el0, d0, radius), margin, nearSplit)) n = 0;
      }
      b.mesh.count = n;
      b.mesh.visible = n > 0;
    }
  }

  dispose(): void {
    for (const b of this.buckets) { b.mesh.dispose(); b.depth.dispose(); }
    for (const b of this.far) if (b) { b.mesh.dispose(); b.mesh.geometry.setIndex(null); b.mesh.geometry.deleteAttribute('position'); b.mesh.geometry.deleteAttribute('normal'); b.mesh.geometry.dispose(); }
    this.farMat.dispose(); this.farDepth.dispose();
    this.material.dispose();
  }
}

/**
 * the per-instance colours made up front, all white (three's own default on its first setColorAt), instead of at the
 * first fill: a program's key holds whether the mesh has them, so the shader Renderer.warmUp linked at load was not the
 * one drawn, and the real one linked in the frame the first meadow or field came into view (macfix/smooth.md F12).
 * Every fill writes every drawn instance's colour: the image is unchanged.
 */
export function whiteColors(m: InstancedMesh, cap: number): void {
  if (!WHITE_UP_FRONT) return;
  m.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
}
/** (dev A/B for the pixel diff: ?white=0 makes the colours at the first fill, as before) */
const WHITE_UP_FRONT = (() => { try { return new URLSearchParams(globalThis.location?.search ?? '').get('white') !== '0'; } catch { return true; } })();
