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
import type { JellyPalette, Rgb } from './oklch.ts';
import { NOISE_GLSL } from './shaderlib.ts';
import { KEY_DIR, RIM_DIR } from './env.ts';

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
}

const lin = (c: Rgb): THREE.Color => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);

const VERT_PARS = /* glsl */`
attribute float aStrain;
attribute vec3 aRest;
varying float vStrain;
varying vec3 vRest;
varying vec3 vWPos;
`;
const VERT_MAIN = /* glsl */`
#include <begin_vertex>
vStrain = aStrain;
vRest = aRest;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAG_PARS = /* glsl */`
varying float vStrain;
varying vec3 vRest;
varying vec3 vWPos;
uniform float uTime, uCompress, uStretch, uBlushAmt, uPatStrength, uCoreAmt, uCoreRadius, uRimAmt, uScatter, uAlphaBase;
uniform vec3 uBlushCol, uPaleCol, uPatA, uPatB, uRimCol, uGlowCol, uKeyCol, uCoreCol, uSeed, uRimDir, uKeyDir, uCoreWorld;
float jBlush = 0.0;
float jPale = 0.0;
${NOISE_GLSL}
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
{
  float jComp = clamp((1.0 - vStrain) * 5.0, 0.0, 1.0);
  float jStr = clamp((vStrain - 1.0) * 4.0, 0.0, 1.0);
  jBlush = clamp(jComp + uCompress * 0.55, 0.0, 1.0) * uBlushAmt;
  jPale = clamp(jStr + uStretch * 0.5, 0.0, 1.0) * uBlushAmt;
  diffuseColor.rgb = mix(diffuseColor.rgb, uBlushCol, jBlush * 0.75);
  diffuseColor.rgb = mix(diffuseColor.rgb, uPaleCol, jPale * 0.6);
}
`;

// transmission: same chunk as three's, with thickness and attenuation modulated by the view angle and the blush
const TRANSMISSION = /* glsl */`
float jNdv0 = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
float jThick = (0.32 + 0.68 * jNdv0) * (1.0 - 0.55 * jPale + 0.12 * jBlush);
float jAtt = (1.0 + 1.8 * jPale) / (1.0 + 0.9 * jBlush);
${THREE.ShaderChunk.transmission_fragment
    .replace('material.thickness = thickness;', 'material.thickness = thickness * jThick;')
    .replace('material.attenuationDistance = attenuationDistance;', 'material.attenuationDistance = attenuationDistance * jAtt;')}
`;

const EMISSIVE_STAGE = /* glsl */`
{
  vec3 jV = normalize(cameraPosition - vWPos);
  vec3 jN = transformNormalByInverseViewMatrix(normal, viewMatrix);
  float jNdv = clamp(dot(jN, jV), 0.0, 1.0);
  float jFres = pow(1.0 - jNdv, 3.0);
  float jRimSide = clamp(dot(jN, uRimDir) * 0.6 + 0.5, 0.0, 1.0);
  vec3 jRim = (uRimCol * (0.2 + 1.7 * jRimSide) + uGlowCol * 0.45) * jFres * uRimAmt;
  float jWrap = clamp((dot(jN, uKeyDir) + 0.55) / 1.55, 0.0, 1.0);
  vec3 jScat = diffuseColor.rgb * uKeyCol * (0.18 + 0.82 * jWrap * jWrap) * uScatter * (1.0 - 0.5 * jFres);
  vec3 jRd = -jV;
  vec3 jToC = uCoreWorld - vWPos;
  float jAlong = dot(jToC, jRd);
  vec3 jPerp = jToC - jRd * jAlong;
  float jHalo = exp(-dot(jPerp, jPerp) / (uCoreRadius * uCoreRadius)) * smoothstep(-0.1, 0.25, jAlong);
  vec3 jCore = uCoreCol * jHalo * uCoreAmt * (0.55 + 0.45 * jNdv);
  totalEmissiveRadiance += jRim + jScat + jCore;
  #ifdef WH_LOW
    float jSpec = dot(totalSpecular, vec3(0.3333));
    diffuseColor.a = clamp(mix(uAlphaBase, 1.0, jFres) + jSpec * 1.6 + dot(jCore, vec3(0.3)) * 0.4, 0.0, 1.0);
  #endif
}
vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
`;

export class JellyMaterials {
  readonly uniforms: JellyUniforms;
  private readonly pattern: number;
  private readonly genome: Genome;
  private readonly palette: JellyPalette;
  private readonly scale: number;
  private full: THREE.MeshPhysicalMaterial | null = null;
  private low: THREE.MeshPhysicalMaterial | null = null;

  constructor(genome: Genome, palette: JellyPalette, scale: number) {
    this.genome = genome;
    this.pattern = PATTERN_ID[genome.pattern] ?? 0;
    const r = mulberry32(genome.seed ^ 0x5f3759df);
    const patStrength = this.pattern === 0 ? 0 : 0.35 + 0.65 * genome.speckle;
    this.uniforms = {
      uTime: { value: 0 }, uCompress: { value: 0 }, uStretch: { value: 0 },
      uBlushAmt: { value: 1 }, uPatStrength: { value: patStrength },
      uCoreAmt: { value: 0.5 + genome.coreGlow * 0.9 }, uCoreRadius: { value: 0.3 * scale },
      uRimAmt: { value: 0.55 }, uScatter: { value: 0.5 + 0.4 * genome.translucency }, uAlphaBase: { value: 0.5 + 0.3 * (1 - genome.translucency) },
      uBlushCol: { value: lin(palette.blush) }, uPaleCol: { value: lin(palette.pale) },
      uPatA: { value: lin(palette.patA) }, uPatB: { value: lin(palette.patB) },
      uRimCol: { value: new THREE.Color(0x59d6e6) }, uGlowCol: { value: lin(palette.glow) },
      uKeyCol: { value: new THREE.Color(0xffb347) },
      uCoreCol: { value: lin(palette.core) },
      uSeed: { value: new THREE.Vector3(r(), r(), r()) },
      uRimDir: { value: RIM_DIR.clone() }, uKeyDir: { value: KEY_DIR.clone() },
      uCoreWorld: { value: new THREE.Vector3() },
    };
    this.palette = palette;
    this.scale = scale;
  }

  private make(low: boolean): THREE.MeshPhysicalMaterial {
    const g = this.genome, p = this.palette, t = g.translucency, gl = g.gloss;
    const m = new THREE.MeshPhysicalMaterial({
      color: lin(p.body),
      roughness: lerp(0.42, 0.14, gl),
      metalness: 0,
      clearcoat: 0.45 + 0.55 * gl,
      clearcoatRoughness: lerp(0.3, 0.03, gl),
      ior: 1.42,
      specularIntensity: 1,
      envMapIntensity: 1.25,
      side: THREE.FrontSide,
      fog: false,
    });
    if (low) {
      m.transparent = true;
      m.depthWrite = false;
      m.transmission = 0;
    } else {
      m.transmission = lerp(0.62, 1, t);
      m.thickness = (0.45 + 0.35 * t) * this.scale;
      m.attenuationColor = lin(p.attenuation);
      m.attenuationDistance = lerp(0.3, 1.15, t) * this.scale;
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
        .replace('#include <transmission_fragment>', TRANSMISSION)
        .replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;', EMISSIVE_STAGE);
    };
    m.customProgramCacheKey = () => `wh-jelly-v1-${this.pattern}-${low ? 'low' : 'full'}`;
    return m;
  }

  /** The material for a tier (built lazily; both variants share one set of uniforms). */
  get(tier: QualityTier): THREE.MeshPhysicalMaterial {
    if (tier === 'low') return (this.low ??= this.make(true));
    return (this.full ??= this.make(false));
  }

  dispose(): void {
    this.full?.dispose(); this.low?.dispose();
    this.full = this.low = null;
  }
}
