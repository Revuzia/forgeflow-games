// The jelly material: MeshPhysicalMaterial (transmission / thickness / attenuation / clearcoat) plus a shader injection.
//
// Translucent-jelly recipe, with NO subsurface pass:
//   * Beer-law absorption through a view-dependent thickness (long path in the middle of the body, short at the rim)
//   * a fresnel rim glow, lagoon-cold on the side facing the rim light, body-warm elsewhere
//   * an inner scatter term (soft wrap of the key light through the body)
//   * a core halo: the glow of the inner ember, as seen along the view ray, brightens with compression
//   * the pressure blush: compressed regions (strain < 1) saturate and warm up, denser; stretched regions (> 1) go paler
//     and clearer (more transmission distance, thinner)
//   * procedural patterns (speckle / swirl / bands) from the REST direction, so they ride the body
// Tiers: high/med use transmission (the renderer's transmission target scale differs); low is an alpha-blended fresnel
// version of the same shader (define WH_LOW) with no transmission pass at all.
import * as THREE from 'three';
import type { Genome } from '../core/genome.ts';
import { mulberry32, lerp } from '../core/rng.ts';
import type { QualityTier } from '../contracts.ts';
import { genomePalette, tintShare, type JellyPalette, type Rgb } from './oklch.ts';
import { NOISE_GLSL } from './shaderlib.ts';
import { KEY_DIR, RIM_DIR, type EnvHub } from './env.ts';
import { TIERS } from './quality.ts';
import { getSpecies } from '../data/catalog.ts';
import { MATERIAL_FAMILIES, isMaterialFamilyId, resolveMaterial, translucencyMaxOf, type ResolvedLook } from '../data/materials.ts';
import type { TierStyle } from './rarity.ts';

const PATTERN_ID: Record<Genome['pattern'], number> = { plain: 0, speckle: 1, swirl: 2, bands: 3 };

export interface JellyUniforms {
  uTime: { value: number };
  uCompress: { value: number };
  uStretch: { value: number };
  uBlushAmt: { value: number };
  uPatStrength: { value: number };
  uCoreAmt: { value: number };
  uCoreRadius: { value: number };
  uRimAmt: { value: number };
  uScatter: { value: number };
  uAlphaBase: { value: number };
  uBlushCol: { value: THREE.Color };
  uPaleCol: { value: THREE.Color };
  uPatA: { value: THREE.Color };
  uPatB: { value: THREE.Color };
  uRimCol: { value: THREE.Color };
  uGlowCol: { value: THREE.Color };
  uKeyCol: { value: THREE.Color };
  uCoreCol: { value: THREE.Color };
  uSeed: { value: THREE.Vector3 };
  uRimDir: { value: THREE.Vector3 };
  uKeyDir: { value: THREE.Vector3 };
  uCoreWorld: { value: THREE.Vector3 };
  // rarity (DESIGN 5.3) and ceremonies
  uAurora: { value: number };
  uIri: { value: number };
  uTwoTone: { value: number };
  uTone2Col: { value: THREE.Color };
  uTierCol: { value: THREE.Color };
  uTierAmt: { value: number };
  /** 0..1: the body's own colour (diffuse AND the transmission absorption) leans toward uTierCol: the merge charge's tell, which additive
   *  light alone could not carry (it only whitened a warm ball). */
  uTierTint: { value: number };
  uMixCol: { value: THREE.Color };
  uMixAmt: { value: number };
  // stage B: contact glow (B5) and the material family's surface (RENDER-3)
  /** Fingertip contact glow, finger 0 / 1: xyz world position, w strength 0..1 (0 = off). */
  uTouch0: { value: THREE.Vector4 };
  uTouch1: { value: THREE.Vector4 };
  uTouchR: { value: number };
  /** Colour constancy against the studio's sodium-amber key (multiplies the body's own colour; luminance-neutral). */
  uWB: { value: THREE.Vector3 };
  /** The contact glow's colour: the genome's own core colour (before colour harmony: a small local bloom never muddies the body). */
  uTouchCol: { value: THREE.Color };
  /** Family micro-texture (foam pores, dusted mochi, bead lumps): bump strength and frequency over the rest direction. */
  uGrain: { value: number };
  uGrainFreq: { value: number };
  /** 1 = the grain is a bead bed (round lumps), 0 = pores / powder noise. */
  uBeads: { value: number };
  /** Family x "stretched regions go paler": 1 = the gel's. */
  uPaleMul: { value: number };
}

const lin = (c: Rgb): THREE.Color => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);

const VERT_PARS = /* glsl */`
attribute float aStrain;
attribute vec3 aRest;
attribute vec2 aDisp;
varying vec2 vDisp;
varying float vStrain;
varying vec3 vRest;
varying vec3 vWPos;
`;
const VERT_MAIN = /* glsl */`
#include <begin_vertex>
vStrain = aStrain;
vDisp = aDisp;
vRest = aRest;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAG_PARS = /* glsl */`
varying float vStrain;
varying vec2 vDisp;
varying vec3 vRest;
varying vec3 vWPos;
uniform float uTime, uCompress, uStretch, uBlushAmt, uPatStrength, uCoreAmt, uCoreRadius, uRimAmt, uScatter, uAlphaBase;
uniform vec3 uBlushCol, uPaleCol, uPatA, uPatB, uRimCol, uGlowCol, uKeyCol, uCoreCol, uSeed, uRimDir, uKeyDir, uCoreWorld;
uniform float uAurora, uIri, uTwoTone, uTierAmt, uTierTint, uMixAmt;
uniform vec3 uTone2Col, uTierCol, uMixCol;
uniform vec4 uTouch0, uTouch1;
uniform float uTouchR, uGrain, uGrainFreq, uPaleMul, uBeads;
uniform vec3 uWB, uTouchCol;
vec3 jBumpN(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
float jBlush = 0.0;
float jTwo = 0.0;
float jPale = 0.0;
float jMix = 0.0;
${NOISE_GLSL}
float jBeadH(vec3 q) {
  vec3 c = floor(q), f = fract(q);
  vec3 r = whHash33(c);
  float d = length(f - (0.4 + 0.2 * r)) / (0.3 + 0.1 * r.z);
  return sqrt(max(0.0, 1.0 - d * d));
}
float jSpeckleLayer(vec3 d, float scale, float seed) {
  vec3 q = d * scale + seed;
  vec3 c = floor(q);
  vec3 f = fract(q);
  vec3 r = whHash33(c);
  vec3 ctr = 0.32 + 0.36 * r;
  float rad = 0.12 + 0.14 * fract(r.x * 7.31);
  float on = step(0.45, fract(r.y * 13.7));
  return on * (1.0 - smoothstep(rad * 0.55, rad, length(f - ctr)));
}
`;

const COLOR_STAGE = /* glsl */`
#include <color_fragment>
#if WH_PATTERN == 1
  float jSp = max(jSpeckleLayer(vRest, 5.5, uSeed.x * 17.0), 0.85 * jSpeckleLayer(vRest + 3.1, 9.5, uSeed.y * 17.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, uPatB, jSp * uPatStrength);
#elif WH_PATTERN == 2
  float jAng = atan(vRest.z, vRest.x);
  float jSw = sin(jAng * 3.0 + (1.0 - vRest.y) * 7.0 + uSeed.x * 6.2832 + 1.1 * whNoise3(vRest * 3.0 + uSeed * 9.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, uPatA, smoothstep(0.05, 0.5, jSw) * uPatStrength);
#elif WH_PATTERN == 3
  float jBd = sin(vRest.y * 10.0 + 1.4 * whNoise3(vRest * 2.5 + uSeed * 9.0) + uSeed.y * 6.2832);
  diffuseColor.rgb = mix(diffuseColor.rgb, uPatA, smoothstep(0.15, 0.55, jBd) * uPatStrength);
#endif
  // rarity: Epic's two-tone gradient body (a second hue blooms toward the top). The diffuse mix alone barely shows on a translucent body
  // (the transmission carries its colour) or on a frosted one (the glow does): jTwo also tints the absorption and adds a little light
  jTwo = 0.7 * uTwoTone * smoothstep(-0.15, 0.85, vRest.y + 0.3 * whNoise3(vRest * 2.0 + uSeed * 5.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, uTone2Col, jTwo);
  // merge ceremony: the parents' colours swirl together (lineage)
  float jMixSw = smoothstep(-0.2, 0.6, sin(atan(vRest.z, vRest.x) * 2.0 + vRest.y * 6.0 + uTime * 0.9 + 1.3 * whNoise3(vRest * 2.5)));
  jMix = uMixAmt * jMixSw;
  diffuseColor.rgb = mix(diffuseColor.rgb, uMixCol, jMix);
{
  // strain < 1 = compressed edges; the dent depth term catches local presses (edge lengths barely change in a dent)
  float jComp = max(clamp((1.0 - vStrain) * 5.0, 0.0, 1.0), smoothstep(0.0, 0.8, vDisp.x));
  float jStr = max(clamp((vStrain - 1.0) * 4.0, 0.0, 1.0), 0.8 * smoothstep(0.1, 0.9, vDisp.y));
  jBlush = clamp((jComp + uCompress * 0.55) * uBlushAmt, 0.0, 1.0);
  jPale = clamp((jStr + uStretch * 0.5) * uBlushAmt * uPaleMul, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uBlushCol, jBlush * 0.75);
  diffuseColor.rgb = mix(diffuseColor.rgb, uPaleCol, jPale * 0.6);
  diffuseColor.rgb = mix(diffuseColor.rgb, uTierCol, uTierTint);
  diffuseColor.rgb *= uWB;
}
`;

// transmission: same chunk as three's, with thickness and attenuation modulated by the view angle and the blush
const TRANSMISSION = /* glsl */`
float jNdv0 = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
float jThick = (0.32 + 0.68 * jNdv0) * (1.0 - 0.55 * jPale + 0.12 * jBlush);
float jAtt = (1.0 + 1.8 * jPale) / (1.0 + 0.9 * jBlush);
${THREE.ShaderChunk.transmission_fragment
    .replace('material.attenuationColor = attenuationColor;', 'material.attenuationColor = min(mix(mix(attenuationColor, uTone2Col, jTwo), uTierCol, uTierTint) * uWB, vec3(1.0));')
    .replace('material.thickness = thickness;', 'material.thickness = thickness * jThick;')
    .replace('material.attenuationDistance = attenuationDistance;', 'material.attenuationDistance = attenuationDistance * jAtt;')}
`;

const EMISSIVE_STAGE = /* glsl */`
{
  vec3 jV = normalize(cameraPosition - vWPos);
  vec3 jN = transformNormalByInverseViewMatrix(normal, viewMatrix);
  float jNdv = clamp(dot(jN, jV), 0.0, 1.0);
  float jFres = pow(1.0 - jNdv, 3.4);
  float jRimSide = clamp(dot(jN, uRimDir) * 0.6 + 0.5, 0.0, 1.0);
  vec3 jRim = (uRimCol * (0.08 + 2.2 * jRimSide * jRimSide) + uGlowCol * 0.4) * jFres * uRimAmt;
  float jWrap = clamp((dot(jN, uKeyDir) + 0.55) / 1.55, 0.0, 1.0);
  vec3 jScat = diffuseColor.rgb * uKeyCol * (0.18 + 0.82 * jWrap * jWrap) * uScatter * (1.0 - 0.5 * jFres);
  #ifdef WH_LOW
    jScat *= 0.35;
  #endif
  vec3 jRd = -jV;
  vec3 jToC = uCoreWorld - vWPos;
  float jAlong = dot(jToC, jRd);
  vec3 jPerp = jToC - jRd * jAlong;
  float jHalo = exp(-dot(jPerp, jPerp) / (uCoreRadius * uCoreRadius)) * smoothstep(-0.1, 0.25, jAlong);
  // soft knee above 0.45: a bright (high-tier, high-coreGlow, squeezed) core keeps rising but saturates in its own hue, never clips to white
  float jC = jHalo * uCoreAmt;
  jC = jC < 0.45 ? jC : 0.45 + (jC - 0.45) / (1.0 + (jC - 0.45) / 0.35);
  vec3 jCore = uCoreCol * jC * (0.55 + 0.45 * jNdv);
  vec3 jExtra = vec3(0.0);
  if (uAurora > 0.001) {          // Legendary: slow aurora CURTAINS drifting inside the body, sodium amber low -> rose -> lagoon high
    float jw = whNoise3(vRest * 1.5 + vec3(0.0, uTime * 0.05, uTime * 0.03));
    float jcur = 0.5 + 0.5 * sin(atan(vRest.z, vRest.x) * 3.0 + 2.4 * jw + vRest.y * 1.5 + uTime * 0.12);
    jcur = jcur * jcur * jcur;                                                   // soft folds, no hard stripe edges
    float jh = smoothstep(-0.6, 0.1, vRest.y) * (1.0 - smoothstep(0.45, 1.0, vRest.y));
    float jg = clamp(vRest.y * 0.8 + 0.45 + 0.25 * jw, 0.0, 1.0);
    vec3 jaur = mix(vec3(1.0, 0.5, 0.06), vec3(1.0, 0.22, 0.42), smoothstep(0.0, 0.55, jg));
    jaur = mix(jaur, vec3(0.12, 0.8, 0.78), smoothstep(0.5, 1.0, jg));
    jExtra += jaur * jcur * jh * (0.08 + 0.26 * (1.0 - jFres)) * uAurora;
  }
  if (uIri > 0.001) {             // Mythic: thin-film iridescence, the hue slides with the view angle
    vec3 jfilm = 0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + jNdv * 1.35 + vRest.y * 0.25 + uTime * 0.03));
    jExtra += jfilm * (0.08 + 0.9 * jFres) * 0.55 * uIri;
    totalSpecular *= mix(vec3(1.0), 0.55 + jfilm, 0.6 * uIri);
  }
  jExtra += uTone2Col * jTwo * (0.1 + 0.25 * (1.0 - jFres));            // Epic two-tone: the second hue also glows a little from inside
  // contact glow (stage B5, "touch the light"): a soft bloom of the CORE's colour where a fingertip presses, on top of the pressure blush
  vec3 jTd0 = vWPos - uTouch0.xyz, jTd1 = vWPos - uTouch1.xyz;
  float jTouch = uTouch0.w * exp(-dot(jTd0, jTd0) / (uTouchR * uTouchR)) + uTouch1.w * exp(-dot(jTd1, jTd1) / (uTouchR * uTouchR));
  jTouch = min(jTouch, 1.2);
  // (kept apart from the jelly's own light: the low tier's deepen / saturate pass below must not recolour it, it is the same bloom on every tier)
  vec3 jTouchE = mix(uTouchCol, vec3(1.0, 0.95, 0.85), 0.35 * jTouch) * jTouch * (0.5 + 0.5 * jNdv) * 1.15;
  jExtra += uTierCol * uTierAmt * (0.25 + 0.9 * jFres + 0.5 * jHalo);   // the tier "tell": light drifting toward the result colour
  jExtra += uMixCol * jMix * (0.16 + 0.3 * (1.0 - jFres));             // merge lineage: the other parents' colours swirl through as light
  totalEmissiveRadiance += jRim + jScat + jCore + jExtra;
  #ifdef WH_LOW
    // low tier: no transmission target, so the body carries its own colour (a base glow) and is only lightly see-through
    totalDiffuse *= 0.16;   // the transmissive tiers keep only ~10% of the direct diffuse; the glow below stands in for the rest
    // fake depth for the transmission-less tier: a thick centre is deeper and more saturated, and the core glows through it
    totalEmissiveRadiance += (diffuseColor.rgb * (0.2 + 0.16 * jWrap) + uBlushCol * (0.34 * pow(jNdv, 1.4)) * (1.0 - 0.35 * jWrap)) * 0.68;
    float jLow = smoothstep(0.45, -0.7, vRest.y) * (1.0 - 0.5 * jFres);   // the lower body is where the core glow sits behind thick jelly
    vec3 jDeep = uBlushCol / max(max(uBlushCol.r, uBlushCol.g), max(uBlushCol.b, 1e-3));
    totalEmissiveRadiance = mix(totalEmissiveRadiance, totalEmissiveRadiance * jDeep * 1.15, 0.85 * jLow);
    // without the transmission pass's absorption the glow reads paler than med/high at the same pose (measured +8..12% in G and B):
    // a saturation lift on the jelly's own light closes most of that gap for free (specular highlights stay white)
    totalEmissiveRadiance = max(mix(vec3(dot(totalEmissiveRadiance, vec3(0.2126, 0.7152, 0.0722))), totalEmissiveRadiance, 1.0 + 0.3 * (1.0 - jLow)), 0.0);
    float jSpec = dot(totalSpecular, vec3(0.3333));
    diffuseColor.a = clamp(mix(uAlphaBase, 1.0, jFres) + jSpec * 0.45, 0.0, 1.0);
  #endif
  totalEmissiveRadiance += jTouchE;
}
vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
`;

/**
 * The translucency the renderer draws for a genome at a rarity tier: the genome's own value plus the tier's "a little more translucency"
 * (DESIGN 5.3), capped at the material family's `lookBounds.translucencyMax` (CONTRACT 11, the same cap `resolveMaterial` applies): a
 * physically opaque family (foam, marshmallow, putty, mochi, bead squeeze) stays frosted at every tier, its rarity shows through core
 * glow, glitter, gloss and the tier FX instead. An unknown species (an old share string) is uncapped.
 */
export function drawnTranslucency(g: Genome, tierAdd = 0): number {
  const def = getSpecies(g.species);
  const cap = def ? translucencyMaxOf(def.family) : 1;
  return Math.max(0, Math.min(1, cap, (Number.isFinite(g.translucency) ? g.translucency : 0) + tierAdd));
}

/** The material family of a genome's species (catalog); an unknown species (an old share string) is the gel. */
export function familyOfGenome(g: Genome): string { return getSpecies(g.species)?.family ?? 'jellygel'; }

/** Grain frequency over the rest direction per family: foam pores fine, dusted mochi medium, a bead bed coarse lumps. */
const GRAIN_FREQ: Record<string, number> = { slowrise: 30, marshmallow: 18, mochidough: 22, putty: 26, beadsqueeze: 6, firmsilicone: 30, popdome: 20 };

// the family's micro-texture: a bump from noise over the REST direction (it rides the deformation), only where the family has grain
const GRAIN_STAGE = /* glsl */`
#include <normal_fragment_maps>
#define GRAIN_AMP 0.022
if (uGrain > 0.001) {
  vec3 jq = vRest * uGrainFreq;
  // fade the grain out before it aliases (cells smaller than ~3 px: a far or small body, the phone's low tier)
  float jFade = 1.0 - smoothstep(0.2, 0.45, length(fwidth(jq)));
  if (jFade > 0.0) {
    // height in world units, slope = its screen derivative over the surface's own screen derivative (a real bump, any distance)
    // pores / powder: two octaves of noise; a bead bed: round caps, one per cell (beads pressing up under the skin)
    float jH = uBeads > 0.5 ? jBeadH(jq) * 1.6 : whNoise3(jq) + 0.5 * whNoise3(jq * 2.3 + 4.1);
    jH *= uGrain * uCoreRadius * GRAIN_AMP * jFade;
    vec3 jPx = dFdx(-vViewPosition), jPy = dFdy(-vViewPosition);
    vec2 jdH = vec2(dFdx(jH) / max(length(jPx), 1e-6), dFdy(jH) / max(length(jPy), 1e-6));
    normal = jBumpN(-vViewPosition, normal, jdH, faceDirection);
  }
}
`;

/**
 * Colour constancy: the studio's key softbox is sodium amber (env.ts, [1, 0.74, 0.42]); under it a dusty-mauve foam read tan and a sage
 * dome khaki in the 50-species gallery. The body's own colour (diffuse, its patterns and blushes) is pre-balanced against a share of the
 * key's tint, luminance kept, so each species' catalog colour survives the warm light while the room keeps its mood.
 */
const KEY_TINT: Rgb = [1.0, 0.74, 0.42];
/** Transmission share kept by the most opaque family (cap 0.3: slow-rise foam, putty); rises to 1 at cap 1. */
const OPAQUE_KEEP = 0.3;
/** White-balance strength: a clear jelly (its colour is the transmission's) takes a little, an opaque skin (its colour is its lit diffuse) the most. */
const WB_CLEAR = 0.3, WB_OPAQUE = 1.3;
function whiteBalance(k: number, out: THREE.Vector3): THREE.Vector3 {
  const r = Math.pow(KEY_TINT[0], -k), g = Math.pow(KEY_TINT[1], -k), b = Math.pow(KEY_TINT[2], -k);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return out.set(r / y, g / y, b / y);
}

export class JellyMaterials {
  readonly uniforms: JellyUniforms;
  private readonly genome: Genome;
  private readonly palette: JellyPalette;
  private readonly scale: number;
  private full: THREE.MeshPhysicalMaterial | null = null;
  private low: THREE.MeshPhysicalMaterial | null = null;

  private readonly hub: EnvHub;
  private style: TierStyle;
  private pattern: number;
  /** The species' material family's surface (resolveMaterial(family, genome).look): roughness, sheen, grain, thickness, blush, pale. */
  readonly look: ResolvedLook;
  readonly familyId: string;
  /** Share of the transmission the body keeps (1 = a glassy body; set per tier style in applyStyleUniforms). */
  private opacityKeep = 1;
  private readonly famKeep: number;

  constructor(genome: Genome, palette: JellyPalette, scale: number, hub: EnvHub, style: TierStyle) {
    this.hub = hub;
    this.genome = genome;
    const fam = familyOfGenome(genome);
    this.familyId = fam;
    this.look = resolveMaterial(fam, genome).look;
    // how much transmission the body keeps: an opaque family keeps 30..65% (LookBounds cap 0.3 .. 0.5)
    // ... and a clear-castable family whose character is frosted (silicone 0.25, pop dome 0.35 reference translucency) keeps 50..64%
    const cap = translucencyMaxOf(fam), ref = isMaterialFamilyId(fam) ? MATERIAL_FAMILIES[fam].look.translucency : 0.82;
    this.famKeep = cap < 1 ? OPAQUE_KEEP + (1 - OPAQUE_KEEP) * Math.max(0, Math.min(1, (cap - 0.3) / 0.7))
      : 1 - 0.5 * Math.max(0, Math.min(1, (0.6 - ref) / 0.35));
    this.style = style;
    this.pattern = PATTERN_ID[genome.pattern] ?? 0;
    if (this.pattern === 0 && style.swirlFloor > 0) this.pattern = 2;       // Rare and up: a plain body gets a swirl layer
    const r = mulberry32(genome.seed ^ 0x5f3759df);
    const patStrength = this.patternStrength();
    this.uniforms = {
      uTime: { value: 0 }, uCompress: { value: 0 }, uStretch: { value: 0 },
      uBlushAmt: { value: 1 }, uPatStrength: { value: patStrength },
      uCoreAmt: { value: 0.5 + genome.coreGlow * 0.9 }, uCoreRadius: { value: 0.3 * scale },
      uRimAmt: { value: 0.8 }, uScatter: { value: 0.2 + 0.2 * drawnTranslucency(genome) }, uAlphaBase: { value: 0.94 - 0.07 * drawnTranslucency(genome) },
      uBlushCol: { value: lin(palette.blush) }, uPaleCol: { value: lin(palette.pale) },
      uPatA: { value: lin(palette.patA) }, uPatB: { value: lin(palette.patB) },
      uRimCol: { value: new THREE.Color(0x59d6e6) }, uGlowCol: { value: lin(palette.glow) },
      uKeyCol: { value: new THREE.Color(0xffb347) },
      uCoreCol: { value: lin(palette.core) },
      uSeed: { value: new THREE.Vector3(r(), r(), r()) },
      uRimDir: { value: RIM_DIR.clone() }, uKeyDir: { value: KEY_DIR.clone() },
      uCoreWorld: { value: new THREE.Vector3() },
      uAurora: { value: 0 }, uIri: { value: 0 }, uTwoTone: { value: 0 }, uTone2Col: { value: lin(palette.tone2) },
      uTierCol: { value: lin(style.tell) }, uTierAmt: { value: 0 }, uTierTint: { value: 0 }, uMixCol: { value: lin(palette.body) }, uMixAmt: { value: 0 },
      uTouch0: { value: new THREE.Vector4(0, -10, 0, 0) }, uTouch1: { value: new THREE.Vector4(0, -10, 0, 0) }, uTouchR: { value: 0.12 * scale },
      uGrain: { value: 0 }, uGrainFreq: { value: 24 }, uPaleMul: { value: 1 }, uBeads: { value: fam === 'beadsqueeze' ? 1 : 0 }, uWB: { value: new THREE.Vector3(1, 1, 1) }, uTouchCol: { value: lin(genomePalette(genome).core) },
    };
    this.palette = palette;
    this.scale = scale;
    this.applyStyleUniforms();
  }

  private patternStrength(): number {
    const g = this.genome;
    const pat = PATTERN_ID[g.pattern] ?? 0;
    if (pat === 0) return this.style.swirlFloor;
    const own = pat === 1 ? 0.6 + 0.4 * g.speckle : 0.4 + 0.6 * g.speckle;
    return Math.max(own, this.style.swirlFloor * 0.8);
  }

  private applyStyleUniforms(): void {
    const u = this.uniforms, s = this.style, g = this.genome;
    const lk = this.look;
    u.uRimAmt.value = 0.8 * s.rim * (1 + 0.35 * lk.fuzz);                     // a dusted / foam skin catches the rim light softly
    u.uBlushAmt.value = s.blush * Math.min(1.15, Math.max(0.25, lk.blush / 0.85));   // the gel's 0.85 = the tuned blush
    u.uPaleMul.value = Math.min(1.3, Math.max(0.2, lk.stretchPale / 0.75));
    u.uGrain.value = lk.grain;
    u.uGrainFreq.value = GRAIN_FREQ[this.familyId] ?? 24;
    u.uAurora.value = s.aurora; u.uIri.value = s.iri; u.uTwoTone.value = s.twoTone;
    u.uTierCol.value.setRGB(s.tell[0], s.tell[1], s.tell[2], THREE.LinearSRGBColorSpace);
    const pc = this.palette.core, k = s.coreTint * tintShare(s.tell, this.palette);
    u.uCoreCol.value.setRGB(pc[0] + (s.tell[0] - pc[0]) * k, pc[1] + (s.tell[1] - pc[1]) * k, pc[2] + (s.tell[2] - pc[2]) * k, THREE.LinearSRGBColorSpace);
    u.uPatStrength.value = this.patternStrength();
    const t = drawnTranslucency(g, s.translucencyAdd);
    u.uScatter.value = 0.14 + 0.2 * t + 0.1 * lk.subsurface;
    // a body of a clear family whose genome is only half-translucent (t < 0.65: a frosted dome, a cloudy gummy) keeps a little less
    // transmission than the glassy ones; the less it keeps, the more its colour is its own lit skin, which the white balance protects
    this.opacityKeep = this.famKeep * (1 - 0.6 * Math.max(0, Math.min(1, (0.65 - t) / 0.35)));
    const opq = Math.max(0, Math.min(1, (1 - this.opacityKeep) / (1 - OPAQUE_KEEP)));
    whiteBalance(WB_CLEAR + (WB_OPAQUE - WB_CLEAR) * opq, u.uWB.value);
    u.uAlphaBase.value = 0.94 - 0.07 * t + 0.05 * opq;                       // low tier: an opaque skin is (almost) opaque there too
  }

  /** Re-style for another rarity tier (rebuilds the GPU materials: a pattern define may change). */
  setStyle(style: TierStyle): void {
    this.style = style;
    this.pattern = PATTERN_ID[this.genome.pattern] ?? 0;
    if (this.pattern === 0 && style.swirlFloor > 0) this.pattern = 2;
    this.applyStyleUniforms();
    this.dispose();
  }

  private make(low: boolean): THREE.MeshPhysicalMaterial {
    const g = this.genome, p = this.palette, t = drawnTranslucency(g, this.style.translucencyAdd), gl = g.gloss, lk = this.look;
    const m = new THREE.MeshPhysicalMaterial({
      color: lin(p.body),
      // frosted body (blurs what refracts through it); the clearcoat carries the gloss. The tuned gel (family roughness 0.08) is the
      // reference: a wet slime (0.03) is a touch clearer, a chalky marshmallow (0.95) / dusted mochi (0.85) / foam (0.7) goes matte
      roughness: Math.min(0.95, Math.max(0.12, lerp(0.58, 0.32, gl) + 0.6 * (lk.roughness - 0.08))),
      metalness: 0,
      clearcoat: (0.45 + 0.55 * gl) * (1 - 0.6 * lk.fuzz),
      clearcoatRoughness: Math.min(0.6, lerp(0.3, 0.07, gl) + 0.3 * Math.max(0, lk.roughness - 0.08) * (1 - gl)),
      // velvet / dust at grazing angles (foam skin, marshmallow, mochi): three's sheen, in the body's pale colour
      sheen: lk.fuzz, sheenRoughness: 0.55, sheenColor: lin(p.pale),
      ior: 1.42,
      specularIntensity: 1,
      side: THREE.FrontSide,
      fog: false,
    });
    this.hub.apply(m, 1.25);
    if (low) {
      m.color = lin(p.attenuation).lerp(lin(p.body), 0.35);   // no absorption pass: bake the deep, saturated look into the base colour
      m.transparent = true;
      m.depthWrite = false;
      m.transmission = 0;
      m.clearcoatRoughness = Math.max(m.clearcoatRoughness, 0.16);   // soften the softbox reflection: it is the only thing that shows through here
    } else {
      // an opaque family (foam, marshmallow, mochi, putty, bead bed: LookBounds cap < 1) lets much less light through: its colour comes
      // from its own lit skin and inner glow, not from the felt seen through it (a 62%-transmissive "marshmallow" was a tinted glass
      // over the amber key pool and read tan whatever its colour)
      m.transmission = lerp(0.62, 1, t) * this.opacityKeep;
      m.thickness = (0.45 + 0.35 * t) * this.scale * lk.thickness;
      m.attenuationColor = lin(p.attenuation);
      m.attenuationDistance = lerp(0.3, 1.0, t) * this.scale * this.style.attenuation;
      m.depthWrite = false; // glitter / bubbles / eyes inside or in front of the body are depth-tested against the table only
    }
    const defs: Record<string, unknown> = { ...(m.defines ?? {}), WH_PATTERN: this.pattern };
    if (low) defs.WH_LOW = '';
    m.defines = defs;
    const u = this.uniforms;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <begin_vertex>', VERT_MAIN);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
        .replace('#include <color_fragment>', COLOR_STAGE)
        .replace('#include <normal_fragment_maps>', GRAIN_STAGE)
        .replace('#include <transmission_fragment>', TRANSMISSION)
        .replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;', EMISSIVE_STAGE)
        // three writes the transmission alpha (< 1) UNBLENDED for an opaque transmissive material, and the canvas has an alpha channel: the
        // page's CSS background showed through the jelly (lighter halos, holes in toDataURL captures). The jelly's pixels are opaque.
        .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n#ifndef WH_LOW\n  gl_FragColor.a = 1.0;\n#endif');
    };
    m.customProgramCacheKey = () => `wh-jelly-v3-${this.pattern}-${low ? 'low' : 'full'}`;
    return m;
  }

  /** The material for a tier (built lazily; both variants share one set of uniforms). */
  get(tier: QualityTier): THREE.MeshPhysicalMaterial {
    if (!TIERS[tier].transmission) return (this.low ??= this.make(true));
    return (this.full ??= this.make(false));
  }

  dispose(): void {
    if (this.full) this.hub.release(this.full);
    if (this.low) this.hub.release(this.low);
    this.full?.dispose(); this.low?.dispose();
    this.full = this.low = null;
  }
}
