// GENESIS — a lit material for the god layer's props (CONTRACT.md §15.6–15.7): boulders and trees in the hand or in
// flight, ballistic debris, a miracle's falling bounty. Like every surface of a planet it is lit by that planet's own
// sun through the transmittance LUT, its sky, the cascaded sun shadow, the moon and the night ambient (the scene has
// no three.js lights for the star); albedo comes from vertex colours (× an optional instance colour). The body-frame
// position is rebuilt from the view position (the planet's body → view rotation and camera are shared uniforms), so
// any mesh under the planet group works, instanced or not.

import { MeshStandardMaterial, type IUniform } from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { SHADOW_GLSL } from '../planet/lights.ts';
import { MOON_PARS, moonDirect } from '../shaders/moon.glsl.ts';

const PARS = /* glsl */ `
${NOISE_GLSL}
${ATMO_PARS}
${SKY_LOOKUP}
${SHADOW_GLSL}
${MOON_PARS}
uniform mat3 uBodyToView;
uniform vec3 uCamBody;
uniform vec3 uSunDirBody;
uniform vec3 uSunDirView;
uniform vec3 uNightAmbient;
uniform float uPropGlow;
vec3 propBodyPos() { return transpose(uBodyToView) * (-vViewPosition) + uCamBody; }
`;

const LIGHT = /* glsl */ `
  {
    vec3 bp = propBodyPos();
    float rP = length(bp);
    vec3 upB = bp / rP;
    float sh = sunShadow(-vViewPosition, normal);
    IncidentLight sunL;
    sunL.direction = uSunDirView;
    sunL.color = uSunE * sunTransmittance(rP, dot(upB, uSunDirBody)) * sh;
    sunL.visible = true;
    RE_Direct(sunL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    ${moonDirect('bp', '1.0')}
  }
`;

const AMBIENT = /* glsl */ `
  {
    vec3 bp = propBodyPos();
    vec3 upB = normalize(bp);
    vec3 nB = normalize(transpose(uBodyToView) * normal);
    iblIrradiance += (skyIrradiance(upB, nB, uSunDirBody) + uNightAmbient) * mix(0.7, 1.0, max(0.0, dot(nB, upB)) * 0.5 + 0.5);
  }
`;

export interface PropMatOpts {
  roughness?: number;
  /** extra GLSL in the fragment after the albedo (may change diffuseColor, set `propEmit`) */
  surface?: string;
  /** extra vertex GLSL (the instanced debris uses its own) */
  vertexPars?: string;
  /** replaces three's beginnormal chunk (must declare objectNormal) and begin chunk (must declare transformed) */
  vertexNormal?: string;
  vertexBegin?: string;
  key: string;
  extraUniforms?: Record<string, IUniform>;
}

/** a MeshStandardMaterial lit by the planet (shared = the planet's uniforms; may be a proxy record) */
export function makePropMaterial(shared: Record<string, IUniform>, o: PropMatOpts): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ roughness: o.roughness ?? 0.9, metalness: 0, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(shared)) shader.uniforms[k] = shared[k];
    if (o.extraUniforms) for (const [k, v] of Object.entries(o.extraUniforms)) shader.uniforms[k] = v;
    if (!shader.uniforms.uPropGlow) shader.uniforms.uPropGlow = { value: 0 };
    if (o.vertexPars) shader.vertexShader = shader.vertexShader.replace('#include <clipping_planes_pars_vertex>', `#include <clipping_planes_pars_vertex>\n${o.vertexPars}`);
    if (o.vertexNormal) shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', o.vertexNormal);
    if (o.vertexBegin) shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', o.vertexBegin);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n  vec3 propEmit = vec3(0.0);\n${o.surface ?? ''}`)
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = propEmit;')
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${LIGHT}`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${AMBIENT}`);
  };
  mat.customProgramCacheKey = () => `genesis-prop-${o.key}`;
  return mat;
}
