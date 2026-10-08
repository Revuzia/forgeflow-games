// GENESIS — physical sky (CONTRACT.md §15.2): per-planet atmosphere model, its precomputed LUTs, and the full-screen
// composite pass that ray-marches single scattering (+ a multiple-scattering LUT) through the planet's air shell.
//
// AtmosphereModel turns PlanetParams.atmosphere into scattering coefficients and keeps four small float LUTs:
//   transmittance (256×64), multiple scattering (32×32, Hillaire 2020), ground sky radiance (16 azimuth slices of
//   32×32, used for water reflections) and L1-SH sky irradiance per sun angle (64×4, terrain/cloud ambient).
// They are recomputed only when the planet's air changes. Its `uniforms` bag is shared BY REFERENCE with the terrain,
// water and cloud materials, so one update reaches every shader of that planet.
//
// The composite pass reconstructs view distance from the logarithmic depth buffer and applies, per pixel:
//   final = L(0..tc) + T(0..tc)·cloud + Tcloud·[ L(tc..ts) + T(0..ts)·scene ]
// with tc the cloud layer and ts the scene depth: sky from the surface, sunsets, the blue limb from orbit, aerial
// perspective over terrain and haze in front of clouds — one integral. Pressure 0 skips the planet (black sky).

import {
  FloatType, HalfFloatType, LinearFilter, Matrix3, Matrix4, NearestFilter, RGBAFormat, ShaderMaterial, Vector2, Vector3,
  WebGLRenderTarget, ClampToEdgeWrapping, type IUniform, type Texture, type WebGLRenderer,
} from 'three';
import type { AtmosphereParams } from '../../sim/types.ts';
import { ATMO_PARS, LOGDEPTH_DECODE, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { FullscreenQuad, passMaterial } from '../post/fsquad.ts';

/** "drama" factor on Earth's vertical optical depths: a 3 km world needs denser air for real sunsets */
const SKY_DEPTH_SCALE = 1.45;
const EARTH_TAU_R = [0.0464, 0.108, 0.265];
const EARTH_TAU_O3 = [0.0098, 0.028, 0.0013];

export interface AtmoUniforms {
  uRg: IUniform<number>;
  uRt: IUniform<number>;
  uBetaR: IUniform<Vector3>;
  uHR: IUniform<number>;
  uBetaMs: IUniform<Vector3>;
  uBetaMe: IUniform<Vector3>;
  uHM: IUniform<number>;
  uMieG: IUniform<number>;
  uBetaO: IUniform<Vector3>;
  uOzone: IUniform<Vector2>;
  uSunE: IUniform<Vector3>;
  uHasAtmo: IUniform<number>;
  uTransLUT: IUniform<Texture | null>;
  uMsLUT: IUniform<Texture | null>;
  uSkyLUT: IUniform<Texture | null>;
  uIrrSH: IUniform<Texture | null>;
}

function lutTarget(w: number, h: number): WebGLRenderTarget {
  const rt = new WebGLRenderTarget(w, h, {
    type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false,
    wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping, generateMipmaps: false,
  });
  return rt;
}

// ───────────────────────────── LUT shaders ─────────────────────────────

const TRANS_FRAG = /* glsl */ `
${ATMO_PARS}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5) / vec2(255.0, 63.0);
  float H = sqrt(max(0.0, uRt * uRt - uRg * uRg));
  float rho = H * uv.y;
  float r = sqrt(rho * rho + uRg * uRg);
  float dmin = uRt - r;
  float dmax = rho + H;
  float d = dmin + uv.x * (dmax - dmin);
  float mu = d <= 0.0 ? 1.0 : (H * H - rho * rho - d * d) / (2.0 * r * d);
  mu = clamp(mu, -1.0, 1.0);
  vec3 o = vec3(0.0, r, 0.0);
  vec3 dir = vec3(sqrt(max(0.0, 1.0 - mu * mu)), mu, 0.0);
  float tEnd = raySphere(o, dir, uRt).y;
  vec3 od = vec3(0.0);
  const int N = 48;
  float dt = tEnd / float(N);
  for (int i = 0; i < N; i++) {
    vec3 p = o + dir * ((float(i) + 0.5) * dt);
    od += atmoExtinction(atmoDensity(length(p) - uRg)) * dt;
  }
  gl_FragColor = vec4(exp(-od), 1.0);
}
`;

// Hillaire 2020 multiple-scattering LUT: second-order luminance with an isotropic phase, summed as a geometric series
const MS_FRAG = /* glsl */ `
${ATMO_PARS}
uniform vec3 uGroundAlbedo;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5) / 31.0;
  float muS = uv.x * 2.0 - 1.0;
  float r = uRg + 1.0 + uv.y * (uRt - uRg - 2.0);
  vec3 sunDir = vec3(sqrt(max(0.0, 1.0 - muS * muS)), muS, 0.0);
  vec3 o = vec3(0.0, r, 0.0);
  vec3 Lsum = vec3(0.0);
  vec3 fms = vec3(0.0);
  const int SQ = 8;
  const int STEPS = 20;
  float isoPhase = 1.0 / (4.0 * ATMO_PI);
  for (int i = 0; i < SQ; i++)
  for (int j = 0; j < SQ; j++) {
    float u = (float(i) + 0.5) / float(SQ);
    float v = (float(j) + 0.5) / float(SQ);
    float ct = 1.0 - 2.0 * u;
    float st = sqrt(max(0.0, 1.0 - ct * ct));
    float ph = 2.0 * ATMO_PI * v;
    vec3 d = vec3(st * cos(ph), ct, st * sin(ph));
    vec2 tg = raySphere(o, d, uRg);
    bool hitsGround = tg.x <= tg.y && tg.x > 0.0;
    float tEnd = hitsGround ? tg.x : raySphere(o, d, uRt).y;
    float dt = tEnd / float(STEPS);
    vec3 T = vec3(1.0);
    vec3 L = vec3(0.0);
    vec3 F = vec3(0.0);
    for (int k = 0; k < STEPS; k++) {
      vec3 p = o + d * ((float(k) + 0.5) * dt);
      float pr = length(p);
      vec3 dens = atmoDensity(pr - uRg);
      vec3 ext = atmoExtinction(dens);
      vec3 sc = uBetaR * dens.x + uBetaMs * dens.y;
      vec3 Ts = sunTransmittance(pr, dot(p / pr, sunDir));
      vec3 stepT = exp(-ext * dt);
      vec3 S = sc * Ts * isoPhase;
      L += T * (S - S * stepT) / max(ext, vec3(1e-9));
      F += T * (sc - sc * stepT) / max(ext, vec3(1e-9));
      T *= stepT;
    }
    if (hitsGround) {
      vec3 gp = o + d * tEnd;
      vec3 gn = normalize(gp);
      float ndl = max(dot(gn, sunDir), 0.0);
      L += T * sunTransmittance(uRg + 1.0, dot(gn, sunDir)) * ndl * uGroundAlbedo / ATMO_PI;
    }
    Lsum += L;
    fms += F * isoPhase;
  }
  float n = float(SQ * SQ);
  // integral over the sphere of (value · isotropic phase) = mean × 4π × 1/(4π)
  vec3 L2 = Lsum / n;
  vec3 f = fms * 4.0 * ATMO_PI / n;
  gl_FragColor = vec4(L2 / max(vec3(1.0) - f, vec3(0.05)), 1.0);
}
`;

// sky radiance seen from sea level: 16 azimuth slices × 32 view zenith (horizon-dense) × 32 sun zenith
const SKY_FRAG = /* glsl */ `
${ATMO_PARS}
uniform vec3 uGroundAlbedo;
void main() {
  float x = gl_FragCoord.x - 0.5;
  float slice = floor(x / 32.0);
  float xi = x - slice * 32.0;
  float u = xi / 31.0;
  float mu = u < 0.25 ? mix(-0.2, 0.0, u / 0.25) : pow((u - 0.25) / 0.75, 2.0);
  float muS = -0.35 + 1.35 * ((gl_FragCoord.y - 0.5) / 31.0);
  float phi = slice / 15.0 * ATMO_PI;
  vec3 up = vec3(0.0, 1.0, 0.0);
  float r = uRg + 2.0;
  vec3 o = up * r;
  vec3 sunDir = vec3(sqrt(max(0.0, 1.0 - muS * muS)), muS, 0.0);
  float smu = sqrt(max(0.0, 1.0 - mu * mu));
  vec3 d = vec3(smu * cos(phi), mu, smu * sin(phi));
  vec2 tg = raySphere(o, d, uRg);
  bool hitsGround = tg.x <= tg.y && tg.x > 0.0;
  float tEnd = hitsGround ? tg.x : raySphere(o, d, uRt).y;
  vec3 L, T, Lm, Tm;
  atmoIntegrate(o, d, sunDir, 0.0, tEnd, 40, 0.5, 1.0, 1e30, L, T, Lm, Tm);
  if (hitsGround) {
    vec3 gn = normalize(o + d * tEnd);
    float ndl = max(dot(gn, sunDir), 0.0);
    L += T * sunTransmittance(uRg + 1.0, dot(gn, sunDir)) * ndl * uGroundAlbedo / ATMO_PI;
  }
  gl_FragColor = vec4(L, 1.0);
}
`;

// L1 SH projection of the sky (upper hemisphere from the sky LUT, lower hemisphere = lit ground) per sun zenith
const IRR_FRAG = /* glsl */ `
${ATMO_PARS}
${SKY_LOOKUP}
uniform vec3 uGroundAlbedo;
void main() {
  float muS = -0.35 + 1.35 * ((gl_FragCoord.x - 0.5) / 63.0);
  int k = int(gl_FragCoord.y);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 sunDir = vec3(sqrt(max(0.0, 1.0 - muS * muS)), muS, 0.0);
  vec3 groundL = uGroundAlbedo / ATMO_PI * sunTransmittance(uRg + 1.0, muS) * max(muS, 0.0);
  vec3 acc = vec3(0.0);
  const int NT = 16;
  const int NP = 32;
  for (int i = 0; i < NT; i++)
  for (int j = 0; j < NP; j++) {
    float ct = 1.0 - 2.0 * (float(i) + 0.5) / float(NT);
    float st = sqrt(max(0.0, 1.0 - ct * ct));
    float ph = 2.0 * ATMO_PI * (float(j) + 0.5) / float(NP);
    vec3 d = vec3(st * cos(ph), ct, st * sin(ph));
    vec3 L = ct > -0.02 ? skyRadiance(up, d, sunDir) : groundL;
    float y = k == 0 ? 0.282095 : k == 1 ? 0.488603 * d.y : k == 2 ? 0.488603 * d.z : 0.488603 * d.x;
    acc += L * y;
  }
  gl_FragColor = vec4(acc * 4.0 * ATMO_PI / float(NT * NP), 1.0);
}
`;

// ───────────────────────────── model ─────────────────────────────

export class AtmosphereModel {
  readonly uniforms: AtmoUniforms;
  readonly groundAlbedo = new Vector3(0.22, 0.22, 0.22);
  /** atmosphere shell thickness (m), aerial-perspective density for geometry */
  thickness = 600;
  has = false;
  private key = '';
  private dirty = true;
  private trans = lutTarget(256, 64);
  private ms = lutTarget(32, 32);
  private sky = lutTarget(512, 32);
  private irr: WebGLRenderTarget;
  private mats: ShaderMaterial[] = [];
  private transMat: ShaderMaterial;
  private msMat: ShaderMaterial;
  private skyMat: ShaderMaterial;
  private irrMat: ShaderMaterial;
  private unitSun = { value: new Vector3(1, 1, 1) };

  constructor() {
    this.irr = new WebGLRenderTarget(64, 4, {
      type: FloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: NearestFilter, depthBuffer: false,
      generateMipmaps: false,
    });
    this.irr.texture.magFilter = LinearFilter;
    this.uniforms = {
      uRg: { value: 3000 }, uRt: { value: 3600 }, uBetaR: { value: new Vector3() }, uHR: { value: 120 },
      uBetaMs: { value: new Vector3() }, uBetaMe: { value: new Vector3() }, uHM: { value: 30 }, uMieG: { value: 0.8 },
      uBetaO: { value: new Vector3() }, uOzone: { value: new Vector2(180, 120) }, uSunE: { value: new Vector3(8, 8, 8) },
      uHasAtmo: { value: 0 }, uTransLUT: { value: this.trans.texture }, uMsLUT: { value: this.ms.texture },
      uSkyLUT: { value: this.sky.texture }, uIrrSH: { value: this.irr.texture },
    };
    // LUT passes see the same coefficients but a UNIT sun (LUTs are per unit illuminance)
    const lutUniforms = (): Record<string, IUniform> => ({ ...this.uniforms, uSunE: this.unitSun, uGroundAlbedo: { value: this.groundAlbedo } });
    this.transMat = passMaterial(TRANS_FRAG, lutUniforms());
    this.msMat = passMaterial(MS_FRAG, lutUniforms());
    this.skyMat = passMaterial(SKY_FRAG, lutUniforms());
    this.irrMat = passMaterial(IRR_FRAG, lutUniforms());
    this.mats.push(this.transMat, this.msMat, this.skyMat, this.irrMat);
  }

  /** set the air from sim params; LUTs are rebuilt on the next update() only if something changed */
  configure(radius: number, a: AtmosphereParams, kind: string): void {
    const key = [radius, a.pressure, a.dust, a.o2, a.co2, a.methane, a.tint?.join(',') ?? '', kind].join('|');
    if (key === this.key) return;
    this.key = key;
    this.dirty = true;
    const u = this.uniforms;
    const p = Math.max(0, a.pressure);
    this.has = p > 0.002;
    u.uHasAtmo.value = this.has ? 1 : 0;
    const thick = Math.max(160, radius * 0.2);
    this.thickness = thick;
    u.uRg.value = radius;
    u.uRt.value = radius + thick;
    u.uHR.value = thick * 0.2;
    u.uHM.value = thick * 0.06;
    u.uOzone.value.set(thick * 0.32, thick * 0.2);
    // pressure thickens the column sub-linearly in look (very dense air saturates to a milky sky)
    const col = Math.pow(p, 0.85);
    let tr = EARTH_TAU_R.map((t) => t * SKY_DEPTH_SCALE * col);
    if (a.tint) {
      // override the spectral shape: the tint colour scatters most (blood-red skies, green skies)
      const s = a.tint[0] + a.tint[1] + a.tint[2] || 1;
      const total = tr[0] + tr[1] + tr[2];
      const shaped = a.tint.map((c) => (c / s) * total * 1.1);
      tr = tr.map((t, i) => t * 0.15 + shaped[i] * 0.85);
    }
    // methane worlds look teal-cyan; CO2-heavy thin air is pale
    if (a.methane > 0.05) tr = [tr[0] * 0.6, tr[1] * 1.15, tr[2] * 1.05];
    u.uBetaR.value.set(tr[0] / u.uHR.value, tr[1] / u.uHR.value, tr[2] / u.uHR.value);
    const dust = Math.max(0, a.dust);
    const tauM = (0.018 + dust * 0.6) * SKY_DEPTH_SCALE * Math.min(1.5, Math.max(p, dust > 0.05 ? 0.4 : 0));
    const ms = tauM / u.uHM.value;
    u.uBetaMs.value.set(ms, ms, ms);
    // dust absorbs blue: a warm, rusty extinction; clean haze barely absorbs
    const absorb = [0.1 + dust * 0.25, 0.12 + dust * 0.55, 0.14 + dust * 1.1];
    u.uBetaMe.value.set(ms * (1 + absorb[0]), ms * (1 + absorb[1]), ms * (1 + absorb[2]));
    u.uMieG.value = 0.78 - dust * 0.12;
    const oz = a.o2 > 0.05 ? 0.7 : 0.1;
    u.uBetaO.value.set(
      (EARTH_TAU_O3[0] * SKY_DEPTH_SCALE * col * oz) / u.uOzone.value.y,
      (EARTH_TAU_O3[1] * SKY_DEPTH_SCALE * col * oz) / u.uOzone.value.y,
      (EARTH_TAU_O3[2] * SKY_DEPTH_SCALE * col * oz) / u.uOzone.value.y,
    );
    const alb = kind === 'desert' ? [0.38, 0.24, 0.16] : kind === 'ice' ? [0.7, 0.75, 0.8] : kind === 'barren' || kind === 'moon' ? [0.18, 0.18, 0.18] : [0.2, 0.22, 0.2];
    this.groundAlbedo.set(alb[0], alb[1], alb[2]);
  }

  /** set the sun illuminance colour at this planet (changes every frame with distance, no LUT rebuild) */
  setSun(r: number, g: number, b: number): void {
    this.uniforms.uSunE.value.set(r, g, b);
  }

  update(renderer: WebGLRenderer, fsq: FullscreenQuad): void {
    if (!this.dirty || !this.has) return;
    this.dirty = false;
    const prev = renderer.getRenderTarget();
    fsq.render(renderer, this.transMat, this.trans);
    fsq.render(renderer, this.msMat, this.ms);
    fsq.render(renderer, this.skyMat, this.sky);
    fsq.render(renderer, this.irrMat, this.irr);
    renderer.setRenderTarget(prev);
  }

  dispose(): void {
    this.trans.dispose(); this.ms.dispose(); this.sky.dispose(); this.irr.dispose();
    for (const m of this.mats) m.dispose();
  }
}

// ───────────────────────────── composite pass ─────────────────────────────

const COMPOSITE_FRAG = /* glsl */ `
#include <common>
${ATMO_PARS}
${LOGDEPTH_DECODE}
${NOISE_GLSL}
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tCloud;
uniform float uHasCloud;
uniform vec2 uCloudRes;
uniform vec2 uCloudShell;
uniform mat4 uInvProj;
uniform mat3 uCamRot;
uniform float uFar;
uniform vec3 uPlanetPos;
uniform vec3 uSunDir;
uniform int uSteps;
uniform float uApScale;

vec3 viewDir(vec2 uv) {
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  return normalize(v.xyz / v.w);
}

float sceneDistance(vec2 uv, vec3 vdir) {
  float dz = texture(tDepth, uv).r;
  if (dz >= 0.999999) return 1e30;
  return viewZFromLogDepth(dz, uFar) / max(-vdir.z, 1e-4);
}

// joint-bilateral upsample of the low-resolution cloud buffer (weights favour low-res texels at the same depth)
vec4 cloudSample(vec2 uv, float tScene) {
  vec2 p = uv * uCloudRes - 0.5;
  vec2 b = floor(p);
  vec2 f = p - b;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  float lz = log2(min(tScene, 1e7) + 1.0);
  for (int j = 0; j < 2; j++)
  for (int i = 0; i < 2; i++) {
    vec2 o = vec2(float(i), float(j));
    vec2 tuv = (b + o + 0.5) / uCloudRes;
    vec3 vd = viewDir(tuv);
    float tz = log2(min(sceneDistance(tuv, vd), 1e7) + 1.0);
    float wb = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
    float w = wb * exp(-abs(tz - lz) * 4.0) + 1e-5;
    acc += texture(tCloud, tuv) * w;
    wsum += w;
  }
  return acc / wsum;
}

void main() {
  vec3 scene = texture(tScene, vUv).rgb;
  vec3 vdir = viewDir(vUv);
  vec3 d = normalize(uCamRot * vdir);
  float tScene = sceneDistance(vUv, vdir);
  vec3 o = -uPlanetPos;
  vec2 ts = raySphere(o, d, uRt);
  vec4 cl = vec4(0.0, 0.0, 0.0, 1.0);
  if (uHasCloud > 0.5) cl = cloudSample(vUv, tScene);
  if (ts.x > ts.y || ts.y < 0.0) {
    gl_FragColor = vec4(scene * cl.a + cl.rgb, 1.0);
    return;
  }
  float t0 = max(ts.x, 0.0);
  bool geo = tScene < ts.y;
  float t1 = min(ts.y, tScene);
  // cloud layer distance (where the cloud buffer's light sits along the ray)
  float tc = 1e30;
  if (cl.a < 0.999) {
    float r0 = length(o);
    vec2 ci = raySphere(o, d, uCloudShell.x);
    vec2 co = raySphere(o, d, uCloudShell.y);
    float mid = 0.5 * (uCloudShell.x + uCloudShell.y);
    vec2 cm = raySphere(o, d, mid);
    if (r0 < mid) tc = cm.y; else tc = cm.x > 0.0 ? cm.x : cm.y;
    tc = clamp(tc, t0, t1);
  }
  float jitter = ign(gl_FragCoord.xy);
  vec3 L, T, Lm, Tm;
  atmoIntegrate(o, d, uSunDir, t0, t1, uSteps, jitter, geo ? uApScale : 1.0, tc, L, T, Lm, Tm);
  // stars drown in a bright sky (contrast): sky pixels fainter than the in-scattered light fade out (the sun stays)
  if (!geo) {
    float ls = dot(scene, vec3(0.2126, 0.7152, 0.0722));
    float lsky = dot(L, vec3(0.2126, 0.7152, 0.0722));
    if (ls < 40.0) scene *= clamp(1.0 - lsky / 0.008, 0.0, 1.0);
  }
  vec3 col;
  if (cl.a < 0.999) col = Lm + Tm * cl.rgb + cl.a * ((L - Lm) + T * scene);
  else col = L + T * scene;
  gl_FragColor = vec4(col, 1.0);
}
`;

export class AtmospherePass {
  readonly material: ShaderMaterial;
  constructor() {
    this.material = passMaterial(COMPOSITE_FRAG, {
      tScene: { value: null }, tDepth: { value: null }, tCloud: { value: null }, uHasCloud: { value: 0 },
      uCloudRes: { value: new Vector2(1, 1) }, uCloudShell: { value: new Vector2(3180, 3420) },
      uInvProj: { value: new Matrix4() }, uCamRot: { value: new Matrix3() }, uFar: { value: 2e7 },
      uPlanetPos: { value: new Vector3() }, uSunDir: { value: new Vector3(1, 0, 0) }, uSteps: { value: 16 },
      uApScale: { value: 0.15 },
      // per-planet atmosphere uniforms are swapped in by bind()
      uRg: { value: 0 }, uRt: { value: 0 }, uBetaR: { value: new Vector3() }, uHR: { value: 1 }, uBetaMs: { value: new Vector3() },
      uBetaMe: { value: new Vector3() }, uHM: { value: 1 }, uMieG: { value: 0.8 }, uBetaO: { value: new Vector3() },
      uOzone: { value: new Vector2(1, 1) }, uSunE: { value: new Vector3() }, uHasAtmo: { value: 1 },
      uTransLUT: { value: null }, uMsLUT: { value: null },
    });
  }

  /** point this pass at one planet's atmosphere (copies the shared uniform objects' values) */
  bind(model: AtmosphereModel): void {
    const u = this.material.uniforms;
    const m = model.uniforms as unknown as Record<string, IUniform>;
    for (const k of ['uRg', 'uRt', 'uBetaR', 'uHR', 'uBetaMs', 'uBetaMe', 'uHM', 'uMieG', 'uBetaO', 'uOzone', 'uSunE', 'uHasAtmo', 'uTransLUT', 'uMsLUT']) {
      u[k] = m[k];
    }
  }
}
