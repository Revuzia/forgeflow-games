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
float cl_remap(float v, float a, float b, float c, float d) { return c + (v - a) / max(b - a, 1e-4) * (d - c); }
float cloudDensityAt(vec3 pb, float hf, float cov, float storm, bool detail) {
  cov = clamp(cov + uCloudScale.w, 0.0, 1.0);
  if (cov < 0.03 || hf <= 0.0 || hf >= 1.0) return 0.0;
  // vertical profile: flat-ish bases, rounded tops; storms tower through the whole shell
  // thin decks at low cover, towers where it is high or stormy
  float top = mix(0.3, 1.0, max(smoothstep(0.65, 0.98, cov), storm));
  float prof = smoothstep(0.0, 0.1, hf) * (1.0 - smoothstep(top * 0.45, top, hf));
  if (prof <= 0.0) return 0.0;
  vec3 q = (pb + uCloudWind) * uCloudScale.x;
  vec4 n = texture(uCloudBase, q);
  float wf = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float base = cl_remap(n.r, wf - 1.0, 1.0, 0.0, 1.0) * prof;
  float c = cl_remap(base, 1.0 - cov, 1.0, 0.0, 1.0) * cov;
  if (c <= 0.0) return 0.0;
  if (detail) {
    vec3 dn = texture(uCloudDetail, (pb + uCloudWind * 1.6) * uCloudScale.y).rgb;
    float df = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
    float er = mix(df, 1.0 - df, clamp(hf * 3.0, 0.0, 1.0));
    c = cl_remap(c, er * 0.42, 1.0, 0.0, 1.0);
  }
  // thin veils where cover is low, dense towers where it is high
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
  bool hitsInner = si.x <= si.y && si.y > 0.0;
  float t0, t1;
  if (r0 < uShell.x) { t0 = si.y; t1 = so.y; }
  else if (r0 < uShell.y) { t0 = 0.0; t1 = (hitsInner && si.x > 0.0) ? si.x : so.y; }
  else { t0 = so.x; t1 = (hitsInner && si.x > 0.0) ? si.x : so.y; }
  if (sg.x <= sg.y && sg.x > 0.0) t1 = min(t1, sg.x);
  t1 = min(t1, tScene);
  // grazing paths through the shell can be kilometres long: cap and let the steps grow with distance
  t1 = min(t1, t0 + 9000.0);
  if (t1 <= t0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  float nu = dot(d, uSunDir);
  // dual-lobe phase: strong forward silver lining + soft back-scatter
  float phase = mix(hg(nu, 0.75), hg(nu, -0.25), 0.25);
  float jitter = ign(gl_FragCoord.xy + uFrame * 5.588238);
  int steps = uSteps;
  float len = t1 - t0;
  float dt = len / float(steps);
  vec3 L = vec3(0.0);
  float T = 1.0;
  float thick = uShell.y - uShell.x;
  for (int i = 0; i < 128; i++) {
    if (i >= steps) break;
    float t = t0 + (float(i) + jitter) * dt;
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
    vec3 sunCol = uSunE * sunTransmittance(r, dot(up, uSunDir));
    // multiple-scattering octaves (Wrenninge 2013): energy at lower extinction with a flatter phase
    float ms = 0.0;
    float a = 1.0, b = 1.0, c = 1.0;
    for (int o2 = 0; o2 < 3; o2++) {
      ms += a * exp(-od * b) * mix(hg(nu, 0.75 * c), hg(nu, -0.25 * c), 0.25);
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
}

export class CloudPass {
  readonly material: ShaderMaterial;
  target: WebGLRenderTarget;
  readonly noise: CloudNoise;
  /** shared with terrain materials for cloud shadows */
  readonly shared: { uCloudBase: IUniform; uCloudDetail: IUniform; uCloudWind: IUniform<Vector3>; uCloudScale: IUniform<Vector4> };

  constructor() {
    this.noise = new CloudNoise();
    this.target = new WebGLRenderTarget(4, 4, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
    this.target.texture.wrapS = this.target.texture.wrapT = ClampToEdgeWrapping;
    this.shared = {
      uCloudBase: { value: this.noise.base.texture },
      uCloudDetail: { value: this.noise.detail.texture },
      uCloudWind: { value: new Vector3() },
      uCloudScale: { value: new Vector4(1 / 340, 1 / 90, 0.028, 0) },
    };
    this.material = passMaterial(CLOUD_FRAG, {
      ...this.shared,
      tDepth: { value: null }, uCoverage: { value: null }, uInvProj: { value: new Matrix4() }, uCamRot: { value: new Matrix3() },
      uWorldToBody: { value: new Matrix3() }, uFar: { value: 2e7 }, uPlanetPos: { value: new Vector3() },
      uSunDir: { value: new Vector3(1, 0, 0) }, uShell: { value: new Vector2(3180, 3420) }, uSteps: { value: 48 },
      uLightSteps: { value: 5 }, uFrame: { value: 0 }, uCloudBright: { value: 1.6 }, uNearFade: { value: new Vector2(20, 140) },
      uRg: { value: 0 }, uRt: { value: 0 }, uBetaR: { value: new Vector3() }, uHR: { value: 1 }, uBetaMs: { value: new Vector3() },
      uBetaMe: { value: new Vector3() }, uHM: { value: 1 }, uMieG: { value: 0.8 }, uBetaO: { value: new Vector3() },
      uOzone: { value: new Vector2(1, 1) }, uSunE: { value: new Vector3() }, uHasAtmo: { value: 1 },
      uTransLUT: { value: null }, uMsLUT: { value: null }, uSkyLUT: { value: null }, uIrrSH: { value: null },
    });
  }

  setSize(w: number, h: number): void {
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
  }

  bind(model: AtmosphereModel, coverage: Texture): void {
    const u = this.material.uniforms;
    const m = model.uniforms as unknown as Record<string, IUniform>;
    for (const k of Object.keys(m)) u[k] = m[k];
    u.uCoverage.value = coverage;
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
    fsq.render(renderer, this.material, this.target);
  }
}

