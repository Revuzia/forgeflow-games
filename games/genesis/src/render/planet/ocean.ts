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
// wave direction: the seed direction pulled toward the wind (the long swell runs with it, the short waves spread);
// windT is the tangent wind direction scaled by how settled it is (0 in a calm)
vec3 gwDir(int i, vec3 up, vec3 windT) {
  vec3 d = GW_D[i].xyz;
  d = d - up * dot(d, up);
  d = normalize(d + 1e-5) + windT * (i < 2 ? 1.6 : 0.8);
  return normalize(d - up * dot(d, up) + 1e-5);
}
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
varying float vSalt;
varying vec3 vWind;
#include <logdepthbuf_pars_vertex>
void main() {
${TERRAIN_VERT_CORE}
  // the curved ground of surface.ts (tG), so the shoreline is where the water plane meets the same ground the
  // terrain draws: contours, never the straight edges of 50 m sim triangles
  float depth = tA.z - tG;
  vec3 up = normalize(tPos);
  vec4 F = tfInterp(uFieldF, aCells, aMisc.x);
  vec4 M1 = tfInterp(uFieldM1, aCells, aMisc.x);
  vec4 C = tfInterp(uFieldC, aCells, aMisc.x);
  vFlow = F.xyz;
  vSalt = F.w;
  vIce = M1.z;
  vTemp = C.x;
  vWind = tfInterp(uFieldD, aCells, aMisc.x).yzw;
  float sea = uWind * seaState(vWind);
  vec3 wT = windTan(vWind, up);
  // Gerstner displacement: calm in shallows, rivers and ice; faded where the LOD spacing cannot carry the wave
  float flowSpd = length(F.xyz);
  float calm = smoothstep(0.3, 4.0, depth) * (1.0 - smoothstep(0.4, 1.2, flowSpd)) * (1.0 - smoothstep(0.05, 0.4, M1.z));
  vec3 disp = vec3(0.0);
  float crest = 0.0;
  for (int i = 0; i < 4; i++) {
    float L = GW_D[i].w;
    // fade by camera distance (not by LOD level): both sides of a patch edge displace identically, no cracks
    float amp = GW_A[i] * sea * calm * (1.0 - smoothstep(L * 5.0, L * 11.0, distance(tPos, uCamBody)));
    if (amp <= 0.0) continue;
    vec3 d = gwDir(i, up, wT);
    float k = 6.2831853 / L;
    float c = sqrt(9.8 / k);
    float ph = k * dot(tPos, d) - c * k * uTime;
    float Q = 0.55;
    disp += d * (Q * amp * cos(ph)) + up * (amp * sin(ph));
    crest += amp * max(sin(ph), 0.0);
  }
  vCrest = crest / max(sea * 0.7, 0.05);
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
uniform float uFrame;
uniform mat4 uViewToPrevClip;
uniform vec3 uMoonE;
uniform vec3 uMoonDirBody;
varying vec3 vBodyPos;
varying vec3 vViewPos;
varying float vDepth;
varying vec3 vFlow;
varying float vIce;
varying float vTemp;
varying float vCrest;
varying float vSalt;
varying vec3 vWind;
float gSea = 1.0;
vec3 gWindT = vec3(0.0);

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
vec3 ripples(vec3 P, vec3 up, float fw, vec3 offset, float t) {
  vec3 g = vec3(0.0);
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    vec3 seed = vec3(sin(fi * 12.9898), cos(fi * 78.233), sin(fi * 37.719 + 1.3));
    float L = 0.17 * pow(1.42, fi);           // 0.17 m .. ~16 m
    // the longer wavelets run with the wind, capillaries go every way
    vec3 d = seed - up * dot(seed, up);
    d = normalize(d + 1e-5) + gWindT * smoothstep(0.5, 6.0, L) * 1.2;
    d = normalize(d - up * dot(d, up) + 1e-5);
    float k = 6.2831853 / L;
    // capillaries depend most on the wind (a calm sea is glassy, a breeze roughens it at once)
    float amp = L * 0.012 * uWind * mix(gSea, gSea * gSea, smoothstep(2.0, 0.3, L));
    float aa = 1.0 - smoothstep(0.15, 0.6, fw / L);
    gUnresolved += (amp * k) * (amp * k) * 0.5 * (1.0 - aa);
    if (aa <= 0.0) continue;
    float w = sqrt(9.8 * k);
    float ph = k * dot(P - offset, d) - w * t + fi * 1.7;
    g += d * (amp * k * cos(ph) * aa);
  }
  return g;
}

// Screen-space reflection against the opaque depth, coloured from the previous frame's composited image (sky, clouds
// and aerial perspective included) REPROJECTED to where that frame saw the hit point (uViewToPrevClip: this frame's
// view space → the planet's body frame → last frame's clip space), so reflections neither lag nor swim while the
// camera moves. The march starts at a per-pixel jittered distance (no stair-step banding), its thickness grows with
// the step, and a miss returns no confidence: the caller's sky radiance is then the one and only sky source.
// Returns rgb + confidence.
vec4 ssr(vec3 posV, vec3 rV, vec3 nV) {
  if (uPrevValid < 0.5) return vec4(0.0);
  // rays turning back toward the camera cannot be found on screen: fade them out (no hard cut line on the sea)
  float facing = 1.0 - smoothstep(0.05, 0.3, rV.z);
  if (facing <= 0.0) return vec4(0.0);
  float t = (2.0 + 0.01 * length(posV)) * (1.0 + 0.35 * ign(gl_FragCoord.xy + vec2(uFrame * 7.0, uFrame * 3.0)));
  float prz = -posV.z;
  for (int i = 0; i < 28; i++) {
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
    if (sz < 1e8 && rz > sz && sz > prz - (0.5 + 0.02 * sz) && rz < sz + max(1.0, t * 0.36)) {
      // refine between the last two samples
      float t0 = t / 1.35, t1 = t;
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
      vec3 rc = (texture(tPrevColor, puv).rgb * 2.0 + texture(tPrevColor, puv + sp).rgb + texture(tPrevColor, puv - sp).rgb) * 0.25;
      float far = 1.0 - smoothstep(0.3, 0.8, t1 / 400.0);
      return vec4(rc, e.x * e.y * facing * far);
    }
    prz = rz;
    t *= 1.35;
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
  float windSpd = length(vWind);
  // fetch: ponds, oases and small lakes (fresh, still) are sheltered — the same wind barely roughens them, so they keep
  // the mirror of their banks and sky (at the open sea's state a sunset pond went a dark, rough grey); rivers keep theirs
  gSea = seaState(vWind) * mix(0.4, 1.0, max(smoothstep(0.3, 0.8, vSalt), smoothstep(0.15, 0.6, length(vFlow))));
  gWindT = windTan(vWind, up);
  float sea = uWind * gSea;
  gUnresolved = 0.0;
  for (int i = 0; i < 4; i++) {
    float L = GW_D[i].w;
    // (the NORMAL fades only by footprint: the vertex shader fades the displacement by distance because a patch
    // cannot carry it, but faded here too it left the sea beyond ~60–200 m a flat glassy gel)
    float fade = 1.0 - smoothstep(0.2, 0.7, fw / L);
    float amp = GW_A[i] * sea * calm * fade;
    gUnresolved += pow(GW_A[i] * sea * calm * 6.2831853 / L, 2.0) * 0.5 * (1.0 - fade);
    vec3 d = gwDir(i, up, gWindT);
    float k = 6.2831853 / L;
    float ph = k * dot(P, d) - sqrt(9.8 * k) * uTime;
    grad += d * (amp * k * cos(ph));
  }
  // the long swell (34–90 m, normal only — the geometry cannot carry it everywhere): broad undulations in the reflection
  // that give the far sea its texture, running with the wind
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float L = 34.0 * pow(1.6, fi);
    vec3 seed = vec3(cos(fi * 2.4 + 0.7), sin(fi * 1.7), sin(fi * 2.4 + 0.7));
    vec3 d = seed - up * dot(seed, up);
    d = normalize(normalize(d + 1e-5) + gWindT * 2.0 + 1e-5);
    d = normalize(d - up * dot(d, up) + 1e-5);
    float k = 6.2831853 / L;
    float amp = L * 0.011 * sea * calm * (1.0 - smoothstep(0.2, 0.7, fw / L)) * smoothstep(3.0, 20.0, vDepth);
    grad += d * (amp * k * cos(k * dot(P, d) - sqrt(9.8 * k) * uTime + fi * 2.1));
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
  // (coastal and lake water carries plankton and silt: the floor fades within a few metres — a quay's foot 9 m down
  // stayed in plain view and every pool read as a swimming pool)
  vec3 sigmaA = vec3(0.45, 0.15, 0.11) + vec3(0.0, 0.02, 0.0) * smoothstep(15.0, 0.0, vTemp);
  // rivers carry silt: browner, murkier water
  float riverK = smoothstep(0.15, 0.6, length(vFlow));
  sigmaA += vec3(0.08, 0.16, 0.3) * riverK;
  vec3 sigmaS = vec3(0.018, 0.045, 0.05);
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
  inscat *= mix(0.5, 1.0, max(smoothstep(0.3, 0.8, vSalt), riverK));
  vec3 under = refr * Tw + inscat;

  // ── reflection ──
  // a rough sea (slopes this pixel cannot draw, gUnresolved) does not mirror the horizon: its facets tilt toward the
  // viewer, so on average it reflects higher sky with less Fresnel — the far sea is a darker band under a bright
  // horizon, not a sheet of sky. The mirror direction is lifted toward the zenith by that slope variance.
  float sig2 = gUnresolved;
  vec3 rB = reflect(-vB, nB);
  rB = normalize(rB + up * (max(0.0, -dot(rB, up)) * 1.02 + sqrt(sig2) * 0.8));
  vec3 skyR = skyRadiance(up, rB, uSunDirBody);
  // the clouds overhead, mirrored: the deck's density where the reflected ray crosses the mid-shell (the same density
  // the cloud shadows use), lit by the sun through the air at the cloud and by the sky; thin far out (it is the
  // reflected sky the SSR cannot see: off-screen above the frame)
  if (uCloudOn > 0.5) {
    float mid = 0.5 * (uCloudShell.x + uCloudShell.y);
    vec2 hit = raySphere(P, rB, mid);
    if (hit.y > 0.0) {
      // the waves' tilt, carried out to the cloud's distance, shatters the mirrored deck into rippled shards (sampled
      // at the exact mirror point the reflection was a crisp white blob painted on the sea)
      vec3 tilt = nB - up * dot(nB, up);
      vec3 q = P + rB * hit.y + tilt * hit.y * 1.6;
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
  float NdVr = sqrt(NdV * NdV + sig2 * 2.0);
  float F = 0.02 + 0.98 * pow(1.0 - clamp(NdVr, 0.0, 1.0), 5.0);
  // sun glint (GGX), roughness from the slope variance of the waves this pixel cannot draw (not a fixed blur): near,
  // a sharp sun in every facet; far, a broad road of glitter — sparkling where single facets catch the sun
  float a = clamp(sqrt(0.035 * 0.035 + 2.0 * gUnresolved) + (1.0 - calm) * 0.02, 0.035, 0.45);
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
  glint *= mix(1.0, 0.45 + 6.0 * step(0.9, spark) * dotK, smoothstep(0.06, 0.2, a) * smoothstep(0.12, 0.5, fw));

  // moonlight (renderer.ts: the brightest moon, art-directed): the moonlit sky in the reflection and a glitter path
  // of moon glints on the swell — the night sea's one bright thing
  if (dot(uMoonE, uMoonE) > 0.0) {
    float mUp = smoothstep(-0.03, 0.06, dot(up, uMoonDirBody));
    float kM = uMoonE.g / max(uSunE.g, 1e-6);
    skyR += skyRadiance(up, rB, uMoonDirBody) * kM * mUp;
    vec3 hM = normalize(uMoonDirBody + vB);
    float NdHm = max(dot(nB, hM), 0.0), NdLm = max(dot(nB, uMoonDirBody), 0.0);
    float ddm = NdHm * NdHm * (a2 - 1.0) + 1.0;
    float Dm = a2 / (3.14159 * ddm * ddm);
    float Vism = 0.25 / ((NdLm * (1.0 - k) + k) * (NdV * (1.0 - k) + k));
    glint += uMoonE * mUp * cloudShadowW(P, uMoonDirBody) * Dm * Vism * Fs * NdLm;
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
  float pulse = 0.5 + 0.5 * sin(uTime * 0.9 - vertThick * 2.4 + snoise(P * 0.05) * 3.0);
  float tN = vertThick + snoise(P * 0.35 + uTime * 0.05) * 0.25;
  float band = mix(0.35, 1.1, pulse);
  float shore = smoothstep(0.02, 0.15, tN) * (1.0 - smoothstep(band * 0.5, band, tN)) * level * waveE;
  // the band is a metre or so wide: once a pixel covers more than that it would only draw a white outline
  shore *= 1.0 - smoothstep(0.35, 2.0, fw);
  // streaks advected up and down the beach
  float surf = smoothstep(-0.2, 0.6, snoise(vec3(P.x * 0.18, P.y * 0.18 - uTime * 0.25, P.z * 0.18)));
  shore *= mix(0.15, 1.0, surf);
  float crest = smoothstep(0.75, 1.15, vCrest) * calm;
  // white water only where water really runs: fast flow, or a leaning sheet that is deep and moving (a cascade);
  // a still sheet on a slope is never painted as rapids
  float rapids = max(smoothstep(1.3, 3.0, flowSpd), smoothstep(0.06, 0.25, lean) * smoothstep(0.5, 2.0, vDepth) * smoothstep(0.3, 1.0, flowSpd));
  // rivers are shallow everywhere: their banks get a thin lip of foam, not a foamy bed
  shore *= mix(1.0, 0.25, riverK);
  // whitecaps: the open sea breaks into scattered white patches that drift and die away — a few, not a speckle
  // (uWind is the sea state the waves are built for: 1 is a moderate breeze, more under a gale)
  // Coverage by wind speed (Monahan's U^3.4, art-directed up so a breeze reads): none under ~4 m/s, a few percent at a
  // fresh breeze (8 m/s), ~10 % at 12 m/s; patches born on the crests (Gerstner phase), drawn out along the wind into
  // streaks, drifting
  vec3 wA = gWindT + (dot(gWindT, gWindT) < 1e-4 ? normalize(cross(up, vec3(0.0, 1.0, 0.0)) + 1e-4) : vec3(0.0));
  wA = normalize(wA - up * dot(wA, up) + 1e-5);
  vec3 wS = cross(up, wA);
  vec3 Pw = vec3(dot(P, wA) * 0.35 - uTime * 0.4, dot(P, wS), dot(P, up));
  float wcN = snoise(vec3(Pw.x * 0.09, Pw.y * 0.16, uTime * 0.05)) * 0.55 + snoise(vec3(Pw.x * 0.5, Pw.y * 0.9, uTime * 0.21)) * 0.3 + (vCrest - 0.6) * 0.35;
  float cover = clamp(0.0012 * pow(max(windSpd * uWind - 3.5, 0.0), 2.2), 0.0, 0.35);
  float whitecap = smoothstep(1.0 - cover * 4.0, 1.0 - cover * 2.0 + 0.02, wcN * 0.5 + 0.5) * step(0.001, cover) * smoothstep(0.3, 0.8, vSalt) * calm * smoothstep(2.0, 8.0, vDepth);
  // the streaks of foam a gale leaves behind (thin, long, along the wind)
  whitecap = max(whitecap, smoothstep(0.75, 0.95, snoise(vec3(Pw.x * 0.06, Pw.y * 1.4, 3.1)) * 0.5 + 0.5) * smoothstep(9.0, 16.0, windSpd * uWind) * 0.5 * calm * smoothstep(0.3, 0.8, vSalt));
  float foamAmt = clamp(max(max(max(shore, crest * 0.8), rapids * 0.85), whitecap * 0.7), 0.0, 1.0);
  if (foamAmt > 0.01) {
    vec3 fp = P * 1.4 - vFlow * uTime * 0.8;
    vec3 fv = voronoi3(fp);
    float bubbles = smoothstep(0.15, 0.55, fv.y - fv.x) * (1.0 - smoothstep(0.2, 1.2, fw));
    float pat = mix(0.65, bubbles, 1.0 - smoothstep(0.1, 1.0, fw));
    // falls: white water with faint streaks running down the slope with it
    if (lean > 0.06 && flowSpd > 1.0) {
      vec3 fd = normalize(vFlow + 1e-5);
      vec3 side = normalize(cross(fd, up) + 1e-5);
      float streak = smoothstep(0.1, 0.7, snoise(vec3(dot(P, side) * 2.2, dot(P, fd) * 0.25 - uTime * 2.5, 0.0)) * 0.5 + 0.5);
      pat = mix(pat, 0.75 + 0.25 * streak, smoothstep(0.06, 0.2, lean));
    }
    // soft coverage, never saturated white
    float foam = smoothstep(0.05, 0.9, foamAmt * (0.55 + 0.75 * pat)) * 0.8;
    vec3 foamC = vec3(0.85) * (sunCol * max(muS, 0.0) + skyE) / 3.14159;
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
    float edgeN = snoise(P * 0.07) * 0.3 + snoise(P * 0.45) * 0.08 + snoise(P * 1.9) * 0.03;
    float edge = smoothstep(0.015, 0.4, vertThick + min(edgeN, 0.12) * smoothstep(1.6, 0.2, vertThick));
    // at zero thickness exactly the ground behind: a sheet within depth precision of the ground (dry shore cells hold
    // their level a few cm under it) can never z-fight into speckles
    // (a film a few centimetres thick is the wet ground the terrain already darkens along its waterline band: darkened
    // again here it drew a dotted line of tiny pools wherever the 3 m detail relief dips under the level)
    float film = smoothstep(0.03, 0.3, vertThick);
    vec3 wetGround = mix(refr, refr * 0.8 + skyR * F * 0.3, film);
    col = mix(wetGround, col, edge * (1.0 - paper));
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
    tPrevColor: { value: null }, uPrevValid: { value: 0 }, uProj: { value: new Matrix4() }, uFrame: { value: 0 },
  };
}
