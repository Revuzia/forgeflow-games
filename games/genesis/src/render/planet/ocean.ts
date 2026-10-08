// GENESIS — water surface (CONTRACT.md §15.5) on the same chunk geometry as the terrain.
//
// Height = the water level from the field texture (wet cells: ground + depth; shore cells: the neighbours' level held
// just under their ground, so seas stay flat and the terrain's depth test draws the coastline).
//   * Waves: four Gerstner waves (vertex), amplitude by depth (shallows calm), wind and LOD spacing (a wave a patch
//     cannot represent fades instead of aliasing), plus twelve analytic sine ripples in the fragment, flow-mapped along
//     the sim's flow vectors on rivers (two-phase blend, so ripples travel downstream without stretching).
//   * Optics: Fresnel (F0 = 0.02) against the planet's sky radiance LUT, GGX sun glint whose roughness grows with pixel
//     footprint (a broad specular from orbit, sharp sparkles up close), refraction of the opaque scene copy with
//     Beer–Lambert absorption along the in-water view path and in-scattered sun/sky colour (turquoise shallows, deep blue
//     seas), shadows from the cascades and the clouds.
//   * Foam: shore (from the scene depth behind the surface), breaking crests (Gerstner phase), rapids (fast flow).
//   * Ice: where the sim's ice field is thick, an opaque cracked ice sheet replaces open water.

import { Matrix4, ShaderMaterial, Vector2, Vector4, type IUniform } from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { CLOUD_DENSITY_GLSL } from '../sky/clouds.ts';
import { SHADOW_GLSL } from './lights.ts';
import { TERRAIN_VERT_CORE, TERRAIN_VERT_PARS } from './terrainvert.glsl.ts';

const WAVES_GLSL = /* glsl */ `
// four Gerstner waves: (dir seed xyz, wavelength m), amplitude factor, steepness
const vec4 GW_D[4] = vec4[4](vec4(0.82, 0.11, 0.56, 21.0), vec4(-0.31, 0.27, 0.91, 13.0), vec4(0.55, -0.48, -0.68, 8.5), vec4(-0.77, 0.6, 0.2, 5.3));
const float GW_A[4] = float[4](0.34, 0.21, 0.12, 0.07);
vec3 gwDir(int i, vec3 up) {
  vec3 d = GW_D[i].xyz;
  return normalize(d - up * dot(d, up) + 1e-5);
}
`;

const OCEAN_VERT = /* glsl */ `
#define WATER_SURFACE
#include <common>
${TERRAIN_VERT_PARS}
uniform highp sampler2D uFieldM1;
uniform highp sampler2D uFieldF;
uniform highp sampler2D uFieldC;
uniform float uTime;
uniform float uWind;
${WAVES_GLSL}
varying vec3 vBodyPos;
varying vec3 vViewPos;
varying float vDepth;
varying vec3 vFlow;
varying float vIce;
varying float vTemp;
varying float vCrest;
#include <logdepthbuf_pars_vertex>
void main() {
${TERRAIN_VERT_CORE}
  float ground = tA.x + aMisc.y * tA.y;
  float depth = tA.z - ground;
  vec3 up = normalize(tPos);
  vec4 F = tfInterp(uFieldF, aCells, aMisc.x);
  vec4 M1 = tfInterp(uFieldM1, aCells, aMisc.x);
  vec4 C = tfInterp(uFieldC, aCells, aMisc.x);
  vFlow = F.xyz;
  vIce = M1.z;
  vTemp = C.x;
  // Gerstner displacement: calm in shallows, rivers and ice; faded where the LOD spacing cannot carry the wave
  float flowSpd = length(F.xyz);
  float calm = smoothstep(0.3, 4.0, depth) * (1.0 - smoothstep(0.4, 1.2, flowSpd)) * (1.0 - smoothstep(0.05, 0.4, M1.z));
  vec3 disp = vec3(0.0);
  float crest = 0.0;
  for (int i = 0; i < 4; i++) {
    float L = GW_D[i].w;
    // fade by camera distance (not by LOD level): both sides of a patch edge displace identically, no cracks
    float amp = GW_A[i] * uWind * calm * (1.0 - smoothstep(L * 5.0, L * 11.0, distance(tPos, uCamBody)));
    if (amp <= 0.0) continue;
    vec3 d = gwDir(i, up);
    float k = 6.2831853 / L;
    float c = sqrt(9.8 / k);
    float ph = k * dot(tPos, d) - c * k * uTime;
    float Q = 0.55;
    disp += d * (Q * amp * cos(ph)) + up * (amp * sin(ph));
    crest += amp * max(sin(ph), 0.0);
  }
  vCrest = crest / max(uWind * 0.7, 0.05);
  tPos += disp;
  vDepth = depth + disp.y * 0.0;
  vBodyPos = tPos;
  vec4 mv = modelViewMatrix * vec4(tPos, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;

const OCEAN_FRAG = /* glsl */ `
#include <common>
${NOISE_GLSL}
${ATMO_PARS}
${SKY_LOOKUP}
${CLOUD_DENSITY_GLSL}
${SHADOW_GLSL}
${WAVES_GLSL}
#include <logdepthbuf_pars_fragment>
uniform mat3 uBodyToView;
uniform vec3 uSunDirBody;
uniform vec3 uSunDirView;
uniform float uTime;
uniform float uWind;
uniform sampler2D tSceneColor;
uniform sampler2D tSceneDepth;
uniform sampler2D tPrevColor;
uniform float uPrevValid;
uniform mat4 uProj;
uniform vec2 uResolution;
uniform samplerCube uCloudCov;
uniform vec2 uCloudShell;
uniform float uCloudOn;
uniform float uKind;
uniform float uRadius;
varying vec3 vBodyPos;
varying vec3 vViewPos;
varying float vDepth;
varying vec3 vFlow;
varying float vIce;
varying float vTemp;
varying float vCrest;

float cloudShadowW(vec3 P, vec3 sunB) {
  if (uCloudOn < 0.5) return 1.0;
  float mid = 0.5 * (uCloudShell.x + uCloudShell.y);
  vec2 hit = raySphere(P, sunB, mid);
  if (hit.y < 0.0) return 1.0;
  vec3 q = P + sunB * hit.y;
  vec2 cs = texture(uCloudCov, normalize(q)).rg;
  float dens = cloudDensityAt(q, 0.35, cs.x, cs.y, false);
  return max(exp(-dens * (uCloudShell.y - uCloudShell.x) * 0.55), 0.12);
}

// twelve analytic ripples: returns the surface gradient (tangent, body frame) for a given phase offset along the flow
vec3 ripples(vec3 P, vec3 up, float fw, vec3 offset, float t) {
  vec3 g = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    vec3 seed = vec3(sin(fi * 12.9898), cos(fi * 78.233), sin(fi * 37.719 + 1.3));
    vec3 d = normalize(seed - up * dot(seed, up) + 1e-5);
    float L = 0.35 * pow(1.42, fi);           // 0.35 m .. ~16 m
    float k = 6.2831853 / L;
    float amp = L * 0.012 * uWind;
    float aa = 1.0 - smoothstep(0.15, 0.6, fw / L);
    if (aa <= 0.0) continue;
    float w = sqrt(9.8 * k);
    float ph = k * dot(P - offset, d) - w * t + fi * 1.7;
    g += d * (amp * k * cos(ph) * aa);
  }
  return g;
}

// screen-space reflection against the opaque depth, coloured from the previous frame's composited image (sky,
// clouds and aerial perspective included). Returns rgb + confidence.
vec4 ssr(vec3 posV, vec3 rV) {
  if (uPrevValid < 0.5 || rV.z > 0.2) return vec4(0.0);
  float t = 2.0 + 0.01 * length(posV);
  vec2 lastUv = vec2(-1.0);
  for (int i = 0; i < 28; i++) {
    vec3 q = posV + rV * t;
    vec4 c = uProj * vec4(q, 1.0);
    if (c.w <= 0.0) break;
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    lastUv = uv;
    float sz = texture(tSceneDepth, uv).r;
    float rz = -q.z;
    if (sz < 1e8 && rz > sz && rz < sz + max(6.0, t * 0.25)) {
      // refine between the last two samples
      float t0 = t / 1.35, t1 = t;
      for (int k = 0; k < 5; k++) {
        float tm = 0.5 * (t0 + t1);
        vec3 qm = posV + rV * tm;
        vec4 cm = uProj * vec4(qm, 1.0);
        vec2 um = cm.xy / cm.w * 0.5 + 0.5;
        if (-qm.z > texture(tSceneDepth, um).r) { t1 = tm; uv = um; } else t0 = tm;
      }
      vec2 e = smoothstep(vec2(0.0), vec2(0.08), uv) * smoothstep(vec2(1.0), vec2(0.92), uv);
      return vec4(texture(tPrevColor, uv).rgb, e.x * e.y);
    }
    t *= 1.35;
  }
  // ray escaped: if it points at sky (or cloud) on screen, take that pixel of the previous frame
  vec4 ci = uProj * vec4(rV, 0.0);
  if (ci.w > 0.0) {
    vec2 uv = ci.xy / ci.w * 0.5 + 0.5;
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0 && texture(tSceneDepth, uv).r > 1e8) {
      vec2 e = smoothstep(vec2(0.0), vec2(0.1), uv) * smoothstep(vec2(1.0), vec2(0.9), uv);
      return vec4(texture(tPrevColor, uv).rgb, e.x * e.y);
    }
  }
  return vec4(0.0);
}

void main() {
  #include <logdepthbuf_fragment>
  if (vDepth < -0.6) discard;
  vec3 P = vBodyPos;
  vec3 up = normalize(P);
  float fw = length(fwidth(P));
  // ── surface normal: Gerstner (analytic) + ripples (flow-mapped on rivers) ──
  vec3 grad = vec3(0.0);
  float calm = smoothstep(0.3, 4.0, vDepth) * (1.0 - smoothstep(0.05, 0.4, vIce));
  for (int i = 0; i < 4; i++) {
    float L = GW_D[i].w;
    float amp = GW_A[i] * uWind * calm * (1.0 - smoothstep(0.2, 0.7, fw / L)) * (1.0 - smoothstep(L * 5.0, L * 11.0, length(vViewPos)));
    vec3 d = gwDir(i, up);
    float k = 6.2831853 / L;
    float ph = k * dot(P, d) - sqrt(9.8 * k) * uTime;
    grad += d * (amp * k * cos(ph));
  }
  float flowSpd = length(vFlow);
  vec3 g1, g2;
  float mixF = 0.0;
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
  vec3 skyE = skyIrradiance(up, up, uSunDirBody) + vec3(0.004, 0.006, 0.012);

  // ── refraction + absorption ──
  vec2 suv = gl_FragCoord.xy / uResolution;
  float fragZ = -vViewPos.z;
  float sceneZ0 = texture(tSceneDepth, suv).r;
  float thick0 = max(sceneZ0 - fragZ, 0.0);
  vec2 ruv = suv + nV.xy * 0.035 * clamp(thick0 * 0.25, 0.0, 1.0) / max(fragZ * 0.02, 1.0);
  float sceneZ = texture(tSceneDepth, ruv).r;
  if (sceneZ < fragZ) { ruv = suv; sceneZ = sceneZ0; }
  float cosV = max(abs(normalize(vViewPos).z), 0.05);
  float pathLen = max(sceneZ - fragZ, 0.0) / cosV;
  pathLen = min(pathLen, 400.0);
  vec3 refr = texture(tSceneColor, ruv).rgb;
  // cold seas a little greener, warm shallows turquoise
  vec3 sigmaA = vec3(0.42, 0.075, 0.042) + vec3(0.0, 0.01, 0.0) * smoothstep(15.0, 0.0, vTemp);
  // rivers carry silt: browner, murkier water
  float riverK = smoothstep(0.15, 0.6, length(vFlow));
  sigmaA += vec3(0.08, 0.16, 0.3) * riverK;
  vec3 sigmaS = vec3(0.004, 0.018, 0.022);
  vec3 Tw = exp(-(sigmaA + sigmaS) * pathLen * 1.25);
  vec3 inscat = sigmaS / (sigmaA + sigmaS) * (1.0 - Tw) * (sunCol * max(muS, 0.0) * 0.22 + skyE * 0.3) / 3.14159;
  vec3 under = refr * Tw + inscat;

  // ── reflection ──
  vec3 rB = reflect(-vB, nB);
  rB = normalize(rB + up * max(0.0, -dot(rB, up)) * 1.02);
  vec3 skyR = skyRadiance(up, rB, uSunDirBody);
  {
    vec3 rV = normalize(uBodyToView * rB);
    vec4 sr = ssr(vViewPos, rV);
    skyR = mix(skyR, sr.rgb, clamp(sr.a, 0.0, 1.0));
  }
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  // sun glint (GGX), roughness from the unresolved wave slopes at this pixel size
  float a = clamp(0.035 + fw * 0.012 + (1.0 - calm) * 0.02, 0.035, 0.45);
  vec3 hB = normalize(uSunDirBody + vB);
  float NdH = max(dot(nB, hB), 0.0);
  float NdL = max(dot(nB, uSunDirBody), 0.0);
  float a2 = a * a;
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * dd * dd);
  float k = a * 0.5;
  float Vis = 0.25 / ((NdL * (1.0 - k) + k) * (NdV * (1.0 - k) + k));
  float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(hB, vB), 0.0), 5.0);
  vec3 glint = sunCol * D * Vis * Fs * NdL;

  vec3 col = mix(under, skyR, F) + glint;

  // ── foam: shore, crests, rapids ──
  float vertThick = max(sceneZ0 - fragZ, 0.0) * cosV;
  float shore = 1.0 - smoothstep(0.0, 1.4, vertThick + snoise(P * 0.35 + uTime * 0.05) * 0.5);
  // surf: broken patches that wash in and out, never a painted line
  float surf = smoothstep(-0.2, 0.6, snoise(vec3(P.x * 0.18, P.y * 0.18 - uTime * 0.25, P.z * 0.18)));
  shore *= mix(0.25, 1.0, surf);
  float crest = smoothstep(0.75, 1.15, vCrest) * calm;
  float rapids = smoothstep(1.3, 3.0, flowSpd);
  // rivers are shallow everywhere: their banks get a thin lip of foam, not a foamy bed
  shore *= mix(1.0, 0.25, riverK);
  float foamAmt = clamp(max(max(shore, crest * 0.8), rapids * 0.85), 0.0, 1.0);
  if (foamAmt > 0.01) {
    vec3 fp = P * 1.4 - vFlow * uTime * 0.8;
    vec3 fv = voronoi3(fp);
    float bubbles = smoothstep(0.15, 0.55, fv.y - fv.x) * (1.0 - smoothstep(0.2, 1.2, fw));
    float pat = mix(0.65, bubbles, 1.0 - smoothstep(0.1, 1.0, fw));
    float foam = smoothstep(0.15, 0.75, foamAmt * (0.55 + 0.75 * pat));
    vec3 foamC = vec3(0.85) * (sunCol * max(muS, 0.0) + skyE) / 3.14159;
    col = mix(col, foamC, foam);
  }

  // ── sea ice ──
  // floe edges: noise breaks the per-cell field so the pack ice never follows the grid's triangles
  float iceW = vIce > 0.01 ? smoothstep(0.08, 0.5, vIce + (snoise(P * 0.012) * 0.3 + snoise(P * 0.06) * 0.12) * min(1.0, vIce * 6.0)) : 0.0;
  if (iceW > 0.0) {
    vec3 iv = voronoi3(P * 0.09);
    float cr = 1.0 - smoothstep(0.0, 0.04, iv.y - iv.x);
    vec3 alb = mix(vec3(0.62, 0.72, 0.8), vec3(0.85, 0.89, 0.93), smoothstep(0.3, 1.5, vIce)) * (0.9 + 0.12 * iv.z);
    alb = mix(alb, vec3(0.2, 0.32, 0.4), cr * 0.6);
    vec3 iceC = alb * (sunCol * max(dot(up, uSunDirBody), 0.0) + skyE) / 3.14159 + skyR * 0.04;
    col = mix(col, iceC, iceW);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

/** water material for one LOD level; shares the planet uniforms and the terrain level's morph uniform */
export function makeOceanMaterial(shared: Record<string, IUniform>, morph: IUniform<Vector4>, scene: Record<string, IUniform>): ShaderMaterial {
  const uniforms: Record<string, IUniform> = {};
  for (const k of Object.keys(shared)) uniforms[k] = shared[k];
  for (const k of Object.keys(scene)) uniforms[k] = scene[k];
  uniforms.uMorph = morph;
  const m = new ShaderMaterial({
    vertexShader: OCEAN_VERT,
    fragmentShader: OCEAN_FRAG,
    uniforms,
    depthWrite: true,
    depthTest: true,
    transparent: false,
  });
  m.extensions = { clipCullDistance: false, multiDraw: false } as ShaderMaterial['extensions'];
  return m;
}

export function makeWaterSceneUniforms(): Record<string, IUniform> {
  return {
    tSceneColor: { value: null }, tSceneDepth: { value: null }, uResolution: { value: new Vector2(1, 1) }, uWind: { value: 1 },
    tPrevColor: { value: null }, uPrevValid: { value: 0 }, uProj: { value: new Matrix4() },
  };
}
