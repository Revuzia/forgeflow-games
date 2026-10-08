// GENESIS — volumetric clouds (CONTRACT.md §15.2): a cloud shell (180–420 m on a 3 km world) ray-marched at reduced
// resolution, upsampled in the atmosphere composite.
//
//   * Shape: a tiling 64³ Perlin-Worley texture (R) with Worley fBm octaves (GBA), eroded by a 32³ Worley detail
//     texture — both generated once on the GPU into 3D render targets.
//   * Coverage: the sim's per-cell `cloud` field resampled into a body-frame cube texture (DirFieldCube), so clouds sit
//     exactly where the sim says and rotate with the planet; `precip` (G channel) darkens and thickens storm cores.
//   * Light: the star through the planet's air (transmittance LUT, so sunset clouds glow orange), Beer–powder with a
//     three-octave multiple-scattering approximation (Wrenninge), dual-lobe Henyey–Greenstein silver lining, and sky
//     ambient from the SH irradiance LUT.
// Output: RGBA16F (in-scattered light, transmittance).

import {
  ClampToEdgeWrapping, Data3DTexture, HalfFloatType, LinearFilter, Matrix3, Matrix4, RGBAFormat, RepeatWrapping,
  ShaderMaterial, UnsignedByteType, Vector2, Vector3, Vector4, WebGL3DRenderTarget, WebGLRenderTarget, type IUniform,
  type Texture, type WebGLRenderer,
} from 'three';
import { ATMO_PARS, LOGDEPTH_DECODE, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { FullscreenQuad, passMaterial } from '../post/fsquad.ts';
import type { AtmosphereModel } from './atmosphere.ts';

// ───────────────────────────── tiling 3D noise generation ─────────────────────────────

const TILE_NOISE = /* glsl */ `
vec3 tn_hash(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
// gradient noise with period 'per' (in lattice units)
float tn_perlin(vec3 p, float per) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n = 0.0;
  float res[8];
  for (int k = 0; k < 8; k++) {
    vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 g = tn_hash(mod(i + o, per)) * 2.0 - 1.0;
    res[k] = dot(normalize(g + 1e-4), f - o);
  }
  float x00 = mix(res[0], res[1], u.x), x10 = mix(res[2], res[3], u.x);
  float x01 = mix(res[4], res[5], u.x), x11 = mix(res[6], res[7], u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}
// inverted Worley (1 - F1) with period 'per' cells
float tn_worley(vec3 p, float per) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d = 1.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 h = tn_hash(mod(i + o, per));
    vec3 r = o + h - f;
    d = min(d, dot(r, r));
  }
  return 1.0 - sqrt(d);
}
float tn_worleyFbm(vec3 p, float freq) {
  return tn_worley(p * freq, freq) * 0.625 + tn_worley(p * freq * 2.0, freq * 2.0) * 0.25 + tn_worley(p * freq * 4.0, freq * 4.0) * 0.125;
}
float tn_remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
`;

const BASE_FRAG = /* glsl */ `
${TILE_NOISE}
uniform float uZ;
uniform float uSize;
void main() {
  vec3 p = vec3(gl_FragCoord.xy / uSize, uZ);
  // perlin fbm (period-aware)
  float pf = 0.0, amp = 1.0, norm = 0.0, fr = 4.0;
  for (int o = 0; o < 4; o++) { pf += amp * tn_perlin(p * fr, fr); norm += amp; amp *= 0.5; fr *= 2.0; }
  pf = pf / norm * 0.5 + 0.5;
  float w1 = tn_worleyFbm(p, 4.0);
  float w2 = tn_worleyFbm(p, 8.0);
  float w3 = tn_worleyFbm(p, 16.0);
  float pw = clamp(tn_remap(pf, 0.0, 1.0, w1, 1.0), 0.0, 1.0);
  gl_FragColor = vec4(pw, w1, w2, w3);
}
`;

const DETAIL_FRAG = /* glsl */ `
${TILE_NOISE}
uniform float uZ;
uniform float uSize;
void main() {
  vec3 p = vec3(gl_FragCoord.xy / uSize, uZ);
  gl_FragColor = vec4(tn_worleyFbm(p, 2.0), tn_worleyFbm(p, 4.0), tn_worleyFbm(p, 8.0), 1.0);
}
`;

export class CloudNoise {
  readonly base: WebGL3DRenderTarget;
  readonly detail: WebGL3DRenderTarget;
  private built = false;
  constructor(baseSize = 64, detailSize = 32) {
    const mk = (s: number) => {
      const rt = new WebGL3DRenderTarget(s, s, s, { type: UnsignedByteType, format: RGBAFormat, depthBuffer: false });
      const t = rt.texture as Data3DTexture;
      t.wrapS = t.wrapT = t.wrapR = RepeatWrapping;
      t.minFilter = t.magFilter = LinearFilter;
      t.generateMipmaps = false;
      return rt;
    };
    this.base = mk(baseSize);
    this.detail = mk(detailSize);
  }
  build(renderer: WebGLRenderer, fsq: FullscreenQuad): void {
    if (this.built) return;
    this.built = true;
    const prev = renderer.getRenderTarget();
    const gen = (rt: WebGL3DRenderTarget, frag: string) => {
      const size = rt.width;
      const m = passMaterial(frag, { uZ: { value: 0 }, uSize: { value: size } });
      for (let z = 0; z < size; z++) {
        m.uniforms.uZ.value = (z + 0.5) / size;
        fsq.render(renderer, m, rt, z);
      }
      m.dispose();
    };
    gen(this.base, BASE_FRAG);
    gen(this.detail, DETAIL_FRAG);
    renderer.setRenderTarget(prev);
  }
}

// ───────────────────────────── cloud density (shared with terrain cloud shadows) ─────────────────────────────

/** GLSL: cloud density at body-frame point pb (m) with height fraction hf in the shell, coverage cov, storm s */
export const CLOUD_DENSITY_GLSL = /* glsl */ `
#ifndef GENESIS_CLOUDDENS
#define GENESIS_CLOUDDENS
uniform highp sampler3D uCloudBase;
uniform highp sampler3D uCloudDetail;
uniform vec3 uCloudWind;     // body-frame noise offset (m), advances with time
uniform vec4 uCloudScale;    // x = 1/base tile (1/m), y = 1/detail tile, z = density (1/m), w = coverage bias
uniform vec4 uStorms[8];     // weather systems of the cloud planet: xyz = body-frame centre, w = angular radius (rad)
uniform vec4 uStormK[8];     // x = strength 0..1, y = spin sense (+1 counter-clockwise from above), z = eye, w = cos(reach)
uniform float uStormN;
uniform float uGlobalBands;  // 0..1: a planet-wide weather organised into storm tracks (±35°) and an ITCZ
float cl_remap(float v, float a, float b, float c, float d) { return c + (v - a) / max(b - a, 1e-4) * (d - c); }

// Weather-scale organisation of the sim's coverage (which is smooth per 50 m cell, and a plain disc under a painted
// system): a slow domain-warped synoptic pattern; latitude bands under a planet-wide override; log-spiral arms,
// cellular cores and an eye around every weather system — a painted storm never reads as a disc.
void cloudOrganise(vec3 pb, inout float cov, inout float storm) {
  vec3 dir = normalize(pb);
  vec3 wq = pb * (1.0 / 2600.0) + uCloudWind * (0.25 / 2600.0);
  vec3 warp = (texture(uCloudBase, wq * 0.6 + vec3(0.31, 0.07, 0.53)).gba - 0.5) * 0.7;
  float big = smoothstep(0.2, 0.8, texture(uCloudBase, wq + warp).r);
  cov *= 0.55 + 0.45 * big;
  if (uGlobalBands > 0.0) {
    // the tracks meander (planetary waves of wavenumber 4 and 7 plus the synoptic warp) and are wide, with broken
    // cloud between them: plain latitude bands with clean edges read as a stack of plates, not as a stormy world.
    // (integer wavenumbers keep the longitude seam continuous)
    float lon = atan(dir.x, dir.z);
    float lat = asin(clamp(dir.y, -1.0, 1.0));
    float wl = lat + 0.1 * sin(4.0 * lon + 5.0 * warp.x) + 0.06 * sin(7.0 * lon - 4.0 * lat + 6.0 * warp.y) + 0.3 * warp.z;
    float tracks = exp(-pow((abs(wl) - 0.61) / 0.24, 2.0)) + 0.85 * exp(-pow(wl / 0.16, 2.0));
    cov = mix(cov, cov * clamp(0.55 + 0.65 * tracks * (0.6 + 0.4 * big), 0.0, 1.15), uGlobalBands);
    storm *= mix(1.0, 0.45 + 0.75 * tracks, uGlobalBands);
  }
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uStormN) break;
    vec4 S = uStorms[i];
    vec4 K = uStormK[i];
    float cd = dot(dir, S.xyz);
    if (cd < K.w) continue;
    float ang = acos(clamp(cd, -1.0, 1.0)) / S.w;     // 0 at the centre, 1 at the painted edge
    vec3 e1 = normalize(cross(S.xyz, abs(S.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(S.xyz, e1);
    float th = atan(dot(dir, e2), dot(dir, e1));
    float arms = 0.5 + 0.5 * sin(4.0 * log(ang + 0.06) * K.y + 2.0 * th);
    float reach = 1.0 - smoothstep(0.75, 1.3, ang);
    float cells = texture(uCloudDetail, pb * (1.0 / 700.0)).r;
    float core = 1.0 - smoothstep(0.0, 0.55, ang);
    float m = mix(0.2 + 1.1 * arms, 0.95 + 0.4 * cells, core * 0.6);
    cov = mix(cov, clamp(cov * m, 0.0, 1.0), reach * K.x);
    storm *= mix(1.0, 0.35 + 0.95 * arms, reach * K.x * (1.0 - core * 0.5));
    if (K.z > 0.5) cov *= mix(1.0, smoothstep(0.06, 0.13, ang), reach);
  }
}

float cloudDensityAt(vec3 pb, float hf, float cov, float storm, bool detail) {
  cov = clamp(cov + uCloudScale.w, 0.0, 1.0);
  if (cov < 0.03 || hf <= 0.0 || hf >= 1.0) return 0.0;
  cloudOrganise(pb, cov, storm);
  if (cov < 0.03) return 0.0;
  vec3 q = (pb + uCloudWind) * uCloudScale.x;
  vec4 n = texture(uCloudBase, q);
  // ragged bases (the base rises by up to a sixth of the shell, never below the inner sphere the march starts at: no
  // razor-straight cloud floor) and varied tops (towers beside low heaps). Ordinary cover makes decks a quarter to half the shell deep; only storm cores (the sim's
  // precipitation) tower through it, spreading into anvils under the top of the shell
  hf -= n.a * 0.18;
  if (hf <= 0.0) return 0.0;
  float top = mix(0.26, 0.52, smoothstep(0.55, 0.95, cov));
  top = mix(top, 1.0, smoothstep(0.15, 0.75, storm));
  top *= 0.65 + 0.35 * n.g;
  float prof = smoothstep(0.0, 0.25, hf) * (1.0 - smoothstep(top * 0.35, top, hf));
  float anvil = smoothstep(0.5, 0.9, storm) * smoothstep(0.7, 0.84, hf) * (1.0 - smoothstep(0.9, 1.0, hf));
  prof = max(prof, anvil * 0.8);
  if (prof <= 0.0) return 0.0;
  float wf = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float base = cl_remap(n.r, wf - 1.0, 1.0, 0.0, 1.0) * prof;
  // a steep remap: full cover still breaks into cells with gaps; thin cover is scattered heaps, not a veil
  float c = clamp(cl_remap(base, 1.0 - cov * 0.85, 1.0 - cov * 0.55, 0.0, 1.0), 0.0, 1.0);
  if (c <= 0.0) return 0.0;
  if (detail) {
    vec3 dn = texture(uCloudDetail, (pb + uCloudWind * 1.6) * uCloudScale.y).rgb;
    float df = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
    // wispy bases, billowy tops; the edges erode at every height
    float er = mix(df, 1.0 - df, clamp(hf * 3.0, 0.0, 1.0));
    c = cl_remap(c, er * 0.55, 1.0, 0.0, 1.0);
  }
  return max(c, 0.0) * uCloudScale.z * (0.35 + 0.65 * cov) * (1.0 + storm * 0.8);
}
#endif
`;

// ───────────────────────────── the cloud pass ─────────────────────────────

const CLOUD_FRAG = /* glsl */ `
#include <common>
${ATMO_PARS}
${SKY_LOOKUP}
${LOGDEPTH_DECODE}
${NOISE_GLSL}
${CLOUD_DENSITY_GLSL}
varying vec2 vUv;
uniform sampler2D tDepth;
uniform samplerCube uCoverage;
uniform mat4 uInvProj;
uniform mat3 uCamRot;
uniform mat3 uWorldToBody;
uniform float uFar;
uniform vec3 uPlanetPos;
uniform vec3 uSunDir;
uniform vec2 uShell;
uniform int uSteps;
uniform int uLightSteps;
uniform float uFrame;
uniform float uCloudBright;
uniform vec2 uNearFade;   // clouds dissolve within this distance of the camera (gameplay views inside the layer)
uniform float uInsideAir; // 0 seen from space .. 1 from inside the air (art-directed low-sun reddening)

float hg(float nu, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * nu, 1e-4), 1.5)); }

vec2 covAt(vec3 pw) {
  vec3 dirB = uWorldToBody * normalize(pw);
  vec4 c = texture(uCoverage, dirB);
  return c.rg;
}

void main() {
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
  vec3 vdir = normalize(v.xyz / v.w);
  vec3 d = normalize(uCamRot * vdir);
  float dz = texture(tDepth, vUv).r;
  float tScene = dz >= 0.999999 ? 1e30 : viewZFromLogDepth(dz, uFar) / max(-vdir.z, 1e-4);
  vec3 o = -uPlanetPos;
  float r0 = length(o);
  vec2 si = raySphere(o, d, uShell.x);
  vec2 so = raySphere(o, d, uShell.y);
  vec2 sg = raySphere(o, d, uRg - 2.0);
  if (so.x > so.y || so.y < 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  // the shell is the outer sphere MINUS the inner one: a ray from above that dips below the cloud base and comes back
  // out (near the limb) crosses it twice. Marching only the first piece left a razor-straight cut where rays turn
  // tangent to the inner sphere; both pieces are marched as one continuous path.
  bool hitsInner = si.x <= si.y && si.y > 0.0;
  bool hitsGround = sg.x <= sg.y && sg.x > 0.0;
  float a0 = max(so.x, 0.0), a1 = so.y, b0 = 0.0, b1 = 0.0;
  if (r0 < uShell.x) { a0 = si.y; a1 = so.y; }
  else if (hitsInner && si.x > 0.0) {
    a1 = si.x;
    if (!hitsGround) { b0 = si.y; b1 = so.y; }
  }
  float tEnd = min(tScene, hitsGround ? sg.x : 1e30);
  a1 = min(a1, tEnd);
  b1 = min(b1, tEnd);
  // grazing paths through the shell can be kilometres long: cap and let the steps grow with distance
  a1 = min(a1, a0 + 9000.0);
  b1 = min(b1, b0 + max(0.0, 9000.0 - max(a1 - a0, 0.0)));
  float len1 = max(a1 - a0, 0.0), len2 = max(b1 - b0, 0.0);
  float len = len1 + len2;
  if (len <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  float nu = dot(d, uSunDir);
  // dual-lobe phase: forward silver lining + soft back-scatter. g = 0.62 rather than a droplet's ~0.85: on a 3 km world
  // the camera is often inside thin cloud with a low sun, where a sharper peak floods half the frame white
  float phase = mix(hg(nu, 0.62), hg(nu, -0.25), 0.25);
  // jitter cycles through an 8-frame golden-ratio sequence: the temporal resolve averages it into smooth edges
  float jitter = fract(ign(gl_FragCoord.xy) + mod(uFrame, 8.0) * 0.618034);
  int steps = uSteps;
  float dt = len / float(steps);
  vec3 L = vec3(0.0);
  float T = 1.0;
  float thick = uShell.y - uShell.x;
  for (int i = 0; i < 128; i++) {
    if (i >= steps) break;
    float sAlong = (float(i) + jitter) * dt;
    float t = sAlong < len1 ? a0 + sAlong : b0 + (sAlong - len1);
    vec3 p = o + d * t;
    float r = length(p);
    float hf = (r - uShell.x) / thick;
    vec2 cs = covAt(p);
    vec3 pb = uWorldToBody * p;
    float dens = cloudDensityAt(pb, hf, cs.x, cs.y, true) * smoothstep(uNearFade.x, uNearFade.y, t);
    if (dens <= 1e-5) continue;
    vec3 up = p / r;
    // light march toward the sun (cone of growing steps)
    float od = 0.0;
    float ls = thick * 0.11;
    vec3 lp = p;
    for (int k = 0; k < 8; k++) {
      if (k >= uLightSteps) break;
      lp += uSunDir * ls;
      float lr = length(lp);
      float lhf = (lr - uShell.x) / thick;
      if (lhf > 1.0 || lhf < 0.0) break;
      vec2 lc = covAt(lp);
      od += cloudDensityAt(uWorldToBody * lp, lhf, lc.x, lc.y, k < 2) * ls;
      ls *= 1.6;
    }
    // Low sun: the cloud shell sits 2–4 Rayleigh scale heights up a 3 km world's air, where sunlight is barely
    // reddened. Seen from inside the air, some extra extinction toward a low sun (k ≤ 2.5) gives sunset clouds their
    // gold and pink; from space the physical transmittance stands (a 7th power painted terminator clouds blood red).
    // Near the cloud's own horizon the reddened light is desaturated, and past the geometric horizon at this radius
    // the point is in the planet's shadow: terminator clouds fade through pink to grey, never glow red.
    float muC = dot(up, uSunDir);
    vec3 Tc = sunTransmittance(r, muC);
    float kx = mix(1.0, mix(1.0, 2.5, uInsideAir), 1.0 - smoothstep(0.02, 0.45, muC));
    Tc = pow(max(Tc, vec3(1e-4)), vec3(kx));
    float lumT = dot(Tc, vec3(0.2126, 0.7152, 0.0722));
    Tc = mix(Tc, mix(vec3(lumT), Tc, 0.65), 1.0 - smoothstep(-0.05, 0.1, muC));
    float dip = sqrt(max(0.0, 1.0 - (uRg / r) * (uRg / r)));
    Tc *= smoothstep(-0.02, 0.03, muC + dip);
    vec3 sunCol = uSunE * Tc;
    // multiple-scattering octaves (Wrenninge 2013): energy at lower extinction with a flatter phase
    float ms = 0.0;
    float a = 1.0, b = 1.0, c = 1.0;
    for (int o2 = 0; o2 < 3; o2++) {
      ms += a * exp(-od * b) * mix(hg(nu, 0.62 * c), hg(nu, -0.25 * c), 0.25);
      a *= 0.5; b *= 0.4; c *= 0.5;
    }
    float powder = 1.0 - exp(-dens * 2.0 * 60.0);
    vec3 amb = skyIrradiance(up, up, uSunDir) * (0.35 + 0.65 * hf) / PI;
    vec3 S = dens * (sunCol * ms * mix(0.55, 1.0, powder) * uCloudBright + amb * (0.6 + 0.4 * (1.0 - cs.y)));
    float stepT = exp(-dens * dt);
    L += T * (S - S * stepT) / max(dens, 1e-6);
    T *= stepT;
    if (T < 0.015) { T = 0.0; break; }
  }
  gl_FragColor = vec4(L, T);
}
`;

/**
 * Temporal resolve of the half-resolution cloud march: last frame's resolved clouds, reprojected through the planet's
 * body frame at the cloud layer (the mid-shell point seen through each pixel), clamped to this frame's 3×3
 * neighbourhood (no ghosting where clouds appear or the view cuts), blended at 12 % per frame. With the 8-frame jitter
 * the march's noise and the edge shimmer average out into stable, resolved cloud edges.
 */
const RESOLVE_FRAG = /* glsl */ `
#include <common>
${ATMO_PARS}
varying vec2 vUv;
uniform sampler2D tCur;
uniform sampler2D tHist;
uniform vec2 uTexel;
uniform float uHistValid;
uniform mat4 uInvProj;
uniform mat3 uCamRot;
uniform mat3 uWorldToBody;
uniform vec3 uPlanetPos;
uniform vec2 uShell;
uniform mat4 uPrevBodyToClip;
void main() {
  vec4 cur = texture(tCur, vUv);
  if (uHistValid < 0.5) { gl_FragColor = cur; return; }
  vec4 mn = cur, mx = cur;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec4 c = texture(tCur, vUv + vec2(float(i), float(j)) * uTexel);
    mn = min(mn, c); mx = max(mx, c);
  }
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
  vec3 d = normalize(uCamRot * normalize(v.xyz / v.w));
  vec3 o = -uPlanetPos;
  float r0 = length(o);
  float mid = 0.5 * (uShell.x + uShell.y);
  vec2 cm = raySphere(o, d, mid);
  if (cm.x > cm.y || cm.y < 0.0) { gl_FragColor = cur; return; }
  float tc = r0 < mid ? cm.y : (cm.x > 0.0 ? cm.x : cm.y);
  vec4 pc = uPrevBodyToClip * vec4(uWorldToBody * (o + d * tc), 1.0);
  if (pc.w <= 0.0) { gl_FragColor = cur; return; }
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  if (puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) { gl_FragColor = cur; return; }
  vec4 h = clamp(texture(tHist, puv), mn, mx);
  gl_FragColor = mix(h, cur, 0.12);
}
`;

export interface CloudInputs {
  depth: Texture;
  invProj: Matrix4;
  camRot: Matrix3;
  worldToBody: Matrix3;
  far: number;
  planetPos: Vector3;
  sunDir: Vector3;
  innerR: number;
  outerR: number;
  frame: number;
  /** camera altitude above the datum (m) and the planet's datum radius */
  altitude: number;
  radius: number;
  /** the planet's body frame → this frame's clip space (temporal reprojection) and an id for history validity */
  bodyToClip: Matrix4;
  planetId: number;
}

/** a weather system for the cloud organisation (body-frame unit centre, radius in metres) */
export interface CloudStorm { pos: ArrayLike<number>; radius: number; intensity: number; eye: boolean }

const MAX_STORMS = 8;

export class CloudPass {
  readonly material: ShaderMaterial;
  /** the resolved (temporally accumulated) clouds the atmosphere composite reads */
  get target(): WebGLRenderTarget { return this.hist[this.histIdx]; }
  private raw: WebGLRenderTarget;
  private hist: [WebGLRenderTarget, WebGLRenderTarget];
  private histIdx = 0;
  private histValid = false;
  private readonly resolveMat: ShaderMaterial;
  private readonly prevBodyToClip = new Matrix4();
  private prevPlanet = -1;
  readonly noise: CloudNoise;
  /** shared with terrain materials for cloud shadows */
  readonly shared: {
    uCloudBase: IUniform; uCloudDetail: IUniform; uCloudWind: IUniform<Vector3>; uCloudScale: IUniform<Vector4>;
    uStorms: IUniform<Vector4[]>; uStormK: IUniform<Vector4[]>; uStormN: IUniform<number>; uGlobalBands: IUniform<number>;
  };

  constructor() {
    this.noise = new CloudNoise();
    const mk = () => {
      const t = new WebGLRenderTarget(4, 4, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
      t.texture.wrapS = t.texture.wrapT = ClampToEdgeWrapping;
      return t;
    };
    this.raw = mk();
    this.hist = [mk(), mk()];
    this.shared = {
      uCloudBase: { value: this.noise.base.texture },
      uCloudDetail: { value: this.noise.detail.texture },
      uCloudWind: { value: new Vector3() },
      // base tile 200 m, detail 45 m: crisp cell edges at the scale of a 3 km world's weather
      uCloudScale: { value: new Vector4(1 / 200, 1 / 45, 0.028, 0) },
      uStorms: { value: Array.from({ length: MAX_STORMS }, () => new Vector4()) },
      uStormK: { value: Array.from({ length: MAX_STORMS }, () => new Vector4()) },
      uStormN: { value: 0 },
      uGlobalBands: { value: 0 },
    };
    this.material = passMaterial(CLOUD_FRAG, {
      ...this.shared,
      tDepth: { value: null }, uCoverage: { value: null }, uInvProj: { value: new Matrix4() }, uCamRot: { value: new Matrix3() },
      uWorldToBody: { value: new Matrix3() }, uFar: { value: 2e7 }, uPlanetPos: { value: new Vector3() },
      uSunDir: { value: new Vector3(1, 0, 0) }, uShell: { value: new Vector2(3180, 3420) }, uSteps: { value: 48 },
      uLightSteps: { value: 5 }, uFrame: { value: 0 }, uCloudBright: { value: 1.6 }, uNearFade: { value: new Vector2(20, 140) },
      uInsideAir: { value: 1 },
      uRg: { value: 0 }, uRt: { value: 0 }, uBetaR: { value: new Vector3() }, uHR: { value: 1 }, uBetaMs: { value: new Vector3() },
      uBetaMe: { value: new Vector3() }, uHM: { value: 1 }, uMieG: { value: 0.8 }, uBetaO: { value: new Vector3() },
      uOzone: { value: new Vector2(1, 1) }, uSunE: { value: new Vector3() }, uHasAtmo: { value: 1 },
      uTransLUT: { value: null }, uMsLUT: { value: null }, uSkyLUT: { value: null }, uIrrSH: { value: null },
    });
    this.resolveMat = passMaterial(RESOLVE_FRAG, {
      tCur: { value: null }, tHist: { value: null }, uTexel: { value: new Vector2(1, 1) }, uHistValid: { value: 0 },
      uInvProj: { value: new Matrix4() }, uCamRot: { value: new Matrix3() }, uWorldToBody: { value: new Matrix3() },
      uPlanetPos: { value: new Vector3() }, uShell: { value: new Vector2(3180, 3420) }, uPrevBodyToClip: { value: new Matrix4() },
      uRg: { value: 0 }, uRt: { value: 0 },
    });
  }

  setSize(w: number, h: number): void {
    if (this.raw.width !== w || this.raw.height !== h) {
      this.raw.setSize(w, h);
      this.hist[0].setSize(w, h);
      this.hist[1].setSize(w, h);
      this.histValid = false;
    }
  }

  /** forget the accumulated history (camera cut) */
  resetHistory(): void {
    this.histValid = false;
  }

  /** the weather systems of the cloud planet (body frame) and whether a planet-wide weather override is active */
  setWeather(storms: CloudStorm[], planetRadius: number, globalBands: number): void {
    const S = this.shared.uStorms.value, K = this.shared.uStormK.value;
    let n = 0;
    for (const w of storms) {
      if (n >= MAX_STORMS) break;
      if (!(w.intensity > 0.02) || !(w.radius > 0)) continue;
      const ang = w.radius / planetRadius;
      const l = Math.hypot(w.pos[0], w.pos[1], w.pos[2]) || 1;
      S[n].set(w.pos[0] / l, w.pos[1] / l, w.pos[2] / l, ang);
      // counter-clockwise (seen from above) in the north, clockwise in the south
      K[n].set(Math.min(1, w.intensity), w.pos[1] >= 0 ? 1 : -1, w.eye ? 1 : 0, Math.cos(Math.min(Math.PI, ang * 1.3)));
      n++;
    }
    this.shared.uStormN.value = n;
    this.shared.uGlobalBands.value = globalBands;
  }

  bind(model: AtmosphereModel, coverage: Texture): void {
    const u = this.material.uniforms;
    const m = model.uniforms as unknown as Record<string, IUniform>;
    for (const k of Object.keys(m)) u[k] = m[k];
    u.uCoverage.value = coverage;
    this.resolveMat.uniforms.uRg = m.uRg;
    this.resolveMat.uniforms.uRt = m.uRt;
  }

  render(renderer: WebGLRenderer, fsq: FullscreenQuad, i: CloudInputs, steps: number, lightSteps: number): void {
    this.noise.build(renderer, fsq);
    const u = this.material.uniforms;
    u.tDepth.value = i.depth;
    u.uInvProj.value.copy(i.invProj);
    u.uCamRot.value.copy(i.camRot);
    u.uWorldToBody.value.copy(i.worldToBody);
    u.uFar.value = i.far;
    u.uPlanetPos.value.copy(i.planetPos);
    u.uSunDir.value.copy(i.sunDir);
    u.uShell.value.set(i.innerR, i.outerR);
    u.uSteps.value = steps;
    u.uLightSteps.value = lightSteps;
    u.uFrame.value = i.frame % 64;
    // inside or just above the cloud layer the camera would see only fog: open a clear bubble around it that grows
    // with how deep in the layer it is (from below or far above the clouds look as they are)
    const lo = i.innerR - i.radius, hi = i.outerR - i.radius;
    const inside = Math.min(1, Math.max(0, (i.altitude - lo * 0.7) / (lo * 0.3 + 1))) * Math.min(1, Math.max(0, (hi * 1.6 - i.altitude) / (hi * 0.6)));
    u.uNearFade.value.set(20 + inside * 60, 140 + inside * 520);
    // the air's thickness from the shell (which spans 30–70 % of it): inside the air below ~1 thickness, space above 2
    const thick = hi / 0.7;
    u.uInsideAir.value = 1 - Math.min(1, Math.max(0, (i.altitude - thick) / thick));
    fsq.render(renderer, this.material, this.raw);
    // temporal resolve into the other history buffer
    if (i.planetId !== this.prevPlanet) this.histValid = false;
    const r = this.resolveMat.uniforms;
    const prev = this.hist[this.histIdx];
    const next = this.hist[this.histIdx ^ 1];
    r.tCur.value = this.raw.texture;
    r.tHist.value = prev.texture;
    r.uTexel.value.set(1 / this.raw.width, 1 / this.raw.height);
    r.uHistValid.value = this.histValid ? 1 : 0;
    r.uInvProj.value.copy(i.invProj);
    r.uCamRot.value.copy(i.camRot);
    r.uWorldToBody.value.copy(i.worldToBody);
    r.uPlanetPos.value.copy(i.planetPos);
    r.uShell.value.set(i.innerR, i.outerR);
    r.uPrevBodyToClip.value.copy(this.prevBodyToClip);
    fsq.render(renderer, this.resolveMat, next);
    this.histIdx ^= 1;
    this.histValid = true;
    this.prevPlanet = i.planetId;
    this.prevBodyToClip.copy(i.bodyToClip);
  }
}
