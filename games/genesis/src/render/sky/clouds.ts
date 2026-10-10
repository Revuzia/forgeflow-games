// GENESIS — volumetric clouds (CONTRACT.md §15.2): a cumulus shell (180–420 m on a 3 km world) plus a thin cirrus
// sheet above it, ray-marched with interleaved (one pixel of every k×k block per frame) sampling and resolved
// temporally at FULL resolution.
//
//   * Weather (baked): a body-frame cube (192² × 6 at High) holds the ORGANISED cloud field — coverage, storm strength,
//     cloud type and anvil cover — computed from the sim's per-cell cloud / precipitation cube and its weather systems:
//     a low-frequency weather mask with full range (clusters, cloud streets and clear holes, a power-law spread of
//     sizes), fronts as long curved bands trailing behind their system (comma clouds), convective storms as clusters of
//     cumulonimbus columns under a merged anvil, tropical cyclones as a smooth central dense overcast with spiral bands
//     and a clear eye, and a planet-wide override as meandering storm tracks. It is re-baked only when the weather
//     changes (at most every few frames). A second cube holds each column's cloud-shadow optical depth (four penumbra
//     taps × four heights): every material's cloud shadow (terrain, water, trees, roads, bodies, buildings) is one
//     fetch of it through `cloudDensityAt` — the same shape as the visible clouds, soft-edged, never black.
//   * Shape (Nubis-style): a tiling 128³ Perlin-Worley texture (1.2 km tile, remapped to a uniform 0..1 at bake time,
//     in float, so 8-bit storage cannot terrace the edges) gives the heaps; type from the weather — stratus (smooth thin decks) → stratocumulus → cumulus (heaps
//     with FLAT bases, rounded cauliflower tops) → cumulonimbus (a filled column to the top of the shell under a flat
//     anvil). A 64³ Worley detail texture (54 m tile), swirled by curl noise, erodes the edges — wispy and only lightly
//     at the base, billowy and deep at the tops — and within ~1.4 km a finer octave sharpens the silhouettes.
//   * Light: the star through the planet's air (transmittance LUT; sunset undersides glow orange and pink until the
//     sun sets for the CLOUD — on a 3 km world that is ~25° after it sets for the ground below), a cone light march for
//     self-shadowing (dark flat bases, bright tops), Beer–Lambert with four multiple-scattering octaves (Wrenninge) and a
//     diffusion floor, calibrated so a thick slab lit at 45° reaches ~0.8× a white Lambert patch (sunlit tops are as
//     bright as snow); dual-lobe Henyey–Greenstein (silver lining toward the sun), a mild powder term on thin edges,
//     ambient from the sky's SH irradiance (sky above, lit ground below), and moonlight at night.
//   * March: geometric steps over the path (budget ×1–1.5 by path length), empty columns skipped from the weather cube,
//     cheap shape-only coarse steps; on entering a cloud three bisection steps find its surface and the march switches
//     to fine steps sized so no step is thicker than τ ≈ 1.6 (a few metres in a dense core), lit at the middle of the
//     step. So limb paths kilometres long still see a lit white surface, not one opaque grey sample.
//   * Inside the layer: a 35 m near zone dissolves the cloud at the lens, replaced by fog of the local density lit like
//     the cloud (white-out when deep inside), so climbing through the deck passes through it.
//   * Cirrus: a 40 m-thick sheet at 88 % of the air's thickness, two samples across it, fibres and hooks from
//     curl-warped octaves stretched along the jets; it fades out as the camera nears the sheet.
//
// Sampling and resolve:
//   the march buffer has 1/k² of the render's pixels; frame f marches, for every k×k block of full-resolution pixels,
//   the one pixel at offset o(f) (a Bayer order over k² frames), with a blue-noise jittered start (a new rank each
//   visit). It also writes each sample's transmittance-weighted cloud distance (MRT). The resolve runs at full
//   resolution: history is reprojected through the planet's body frame AT THAT CLOUD DISTANCE (parallax-correct when
//   the camera climbs or flies), Catmull-Rom fetched, variance-clipped in YCoCg (mean ± 1.25σ of the depth-similar
//   current samples) and weighted by a confidence from the depth mismatch; the pixel marched this frame blends its
//   sample in at 1/n (n ≤ 12 per pixel while reprojection holds), the others keep their history or, where confidence
//   is low (disocclusion, fast parallax, screen edges, cuts), take a depth-aware Catmull-Rom (4×4) reconstruction of
//   the current samples. Geometry in front of every cloud layer is cloud-free analytically (no halo on mountains or
//   trees).
//
// Per-preset cost (marched pixels, steps — coarse steps are shape-only, empty columns are skipped — light steps,
// near octave; the weather and shadow cubes are re-baked only when the weather changes):
//   low        k = 4 (1/16 of the pixels)  24 steps  3 light  no near octave   weather cube  96²
//   medium     k = 3 (1/9)                 32 steps  4 light  no near octave   weather cube 128²
//   high       k = 2 (1/4)                 48 steps  5 light  near octave      weather cube 192²
//   ultra      k = 2 (1/4)                 72 steps  6 light  near octave      weather cube 256²
//   cinematic  k = 2 (1/4)                 96 steps  8 light  near octave      weather cube 256²
// plus one full-resolution resolve (16 current samples + their aux, 9 history taps + 1 aux) and two cirrus samples per
// marched pixel. Output (the resolved target): RGBA16F (in-scattered light, transmittance) + RGBA16F (log2 cloud
// distance, samples). Measured (SwiftShader = CPU raster, a loaded shared 4-core machine, so relative only; the p03 view,
// 640×360, Low 480×270, Medium 576×324; march + resolve): Low 0.23 s, Medium 0.52 s, High 1.1–3.4 s (by load),
// Ultra 2.8 s, Cinematic 4.7 s — about twice the previous round's relative cost on a software rasteriser (crisp edges
// need short steps inside clouds and a 4×4 resolve), Cinematic no longer ~4× High. Not yet timed on a real GPU.

import {
  ClampToEdgeWrapping, GLSL3, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, Matrix3, Matrix4,
  NearestFilter, RGBAFormat, RepeatWrapping, ShaderMaterial, UnsignedByteType, Vector2, Vector3, Vector4,
  WebGL3DRenderTarget, WebGLCubeRenderTarget, WebGLRenderTarget, type Data3DTexture, type IUniform, type Texture,
  type WebGLRenderer,
} from 'three';
import { ATMO_PARS, LOGDEPTH_DECODE, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { FullscreenQuad, passMaterial } from '../post/fsquad.ts';
import type { AtmosphereModel } from './atmosphere.ts';
import { blueNoiseTexture } from './bluenoise.ts';

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
float tn_perlinFbm(vec3 p, float freq, int oct) {
  float s = 0.0, a = 1.0, n = 0.0;
  for (int o = 0; o < 6; o++) {
    if (o >= oct) break;
    s += a * tn_perlin(p * freq, freq); n += a; a *= 0.5; freq *= 2.0;
  }
  return s / n;
}
float tn_remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
`;

// base: R = the Perlin-Worley heap shape ALREADY remapped to a roughly uniform 0..1 (so the coverage threshold means
// "fraction of the sky", and an 8-bit-filtering GPU could not terrace the edges: the ×25 gain of that remap happens
// here, in float, not after the texture fetch — so RGBA8 storage is enough, ~2.6× cheaper to sample than half float
// on a software rasteriser), G/B/A = Worley fBm at 4 / 8 / 16 cells per tile (heap tops, bases)
const BASE_FRAG = /* glsl */ `
${TILE_NOISE}
uniform float uZ;
uniform float uSize;
void main() {
  vec3 p = vec3(gl_FragCoord.xy / uSize, uZ);
  float pf = tn_perlinFbm(p, 4.0, 4) * 0.5 + 0.5;
  float w1 = tn_worleyFbm(p, 4.0);
  float w2 = tn_worleyFbm(p, 8.0);
  float w3 = tn_worleyFbm(p, 16.0);
  float pw = clamp(tn_remap(pf, 0.0, 1.0, w1, 1.0), 0.0, 1.0);
  float wf = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
  float shape = clamp(tn_remap(pw, wf - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
  // (1–99 % of the remapped Perlin-Worley falls in 0.745–0.912, median 0.83: spread it to a roughly uniform 0..1)
  shape = smoothstep(0.75, 0.91, shape);
  gl_FragColor = vec4(shape, w1, w2, w3);
}
`;

// detail: three Worley fBm octaves (edges: billows and wisps) + a Perlin fBm (A) for the cirrus streaks
const DETAIL_FRAG = /* glsl */ `
${TILE_NOISE}
uniform float uZ;
uniform float uSize;
void main() {
  vec3 p = vec3(gl_FragCoord.xy / uSize, uZ);
  gl_FragColor = vec4(tn_worleyFbm(p, 2.0), tn_worleyFbm(p, 4.0), tn_worleyFbm(p, 8.0), tn_perlinFbm(p, 4.0, 4) * 0.5 + 0.5);
}
`;

// curl of a tiling vector potential (three Perlin fBm fields): a divergence-free swirl for the detail lookups
const CURL_FRAG = /* glsl */ `
${TILE_NOISE}
uniform float uZ;
uniform float uSize;
vec3 pot(vec3 p) {
  return vec3(tn_perlinFbm(p, 3.0, 2), tn_perlinFbm(p + vec3(0.37, 0.11, 0.73), 3.0, 2), tn_perlinFbm(p + vec3(0.61, 0.29, 0.17), 3.0, 2));
}
void main() {
  vec3 p = vec3(gl_FragCoord.xy / uSize, uZ);
  float e = 0.5 / uSize;
  vec3 dx = (pot(p + vec3(e, 0.0, 0.0)) - pot(p - vec3(e, 0.0, 0.0))) / (2.0 * e);
  vec3 dy = (pot(p + vec3(0.0, e, 0.0)) - pot(p - vec3(0.0, e, 0.0))) / (2.0 * e);
  vec3 dz = (pot(p + vec3(0.0, 0.0, e)) - pot(p - vec3(0.0, 0.0, e))) / (2.0 * e);
  vec3 curl = vec3(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x);
  gl_FragColor = vec4(clamp(curl * 0.06 + 0.5, 0.0, 1.0), 1.0);
}
`;

export class CloudNoise {
  readonly base: WebGL3DRenderTarget;
  readonly detail: WebGL3DRenderTarget;
  readonly curl: WebGL3DRenderTarget;
  private built = false;
  constructor(baseSize = 128, detailSize = 64, curlSize = 32) {
    const mk = (s: number, half: boolean) => {
      const rt = new WebGL3DRenderTarget(s, s, s, { type: half ? HalfFloatType : UnsignedByteType, format: RGBAFormat, depthBuffer: false });
      const t = rt.texture as Data3DTexture;
      t.wrapS = t.wrapT = t.wrapR = RepeatWrapping;
      // mip-mapped: the march reads the noise at the level of its pixel footprint (no lace of aliased detail from orbit)
      t.magFilter = LinearFilter;
      t.minFilter = LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      return rt;
    };
    this.base = mk(baseSize, false);
    this.detail = mk(detailSize, false);
    this.curl = mk(curlSize, false);
  }
  build(renderer: WebGLRenderer, fsq: FullscreenQuad): void {
    if (this.built) return;
    this.built = true;
    const prev = renderer.getRenderTarget();
    const gen = (rt: WebGL3DRenderTarget, frag: string) => {
      const size = rt.width;
      const m = passMaterial(frag, { uZ: { value: 0 }, uSize: { value: size } });
      const t = rt.texture;
      for (let z = 0; z < size; z++) {
        // the mip chain is generated once, after the last slice (the first render allocates storage with mip levels)
        t.generateMipmaps = z === 0 || z === size - 1;
        m.uniforms.uZ.value = (z + 0.5) / size;
        fsq.render(renderer, m, rt, z);
      }
      t.generateMipmaps = true;
      m.dispose();
    };
    gen(this.base, BASE_FRAG);
    gen(this.detail, DETAIL_FRAG);
    gen(this.curl, CURL_FRAG);
    renderer.setRenderTarget(prev);
  }
}

// ───────────────────────────── cloud shadows for every material ─────────────────────────────

/**
 * GLSL for the materials that receive cloud shadows (terrain, water, trees, roads, bodies, buildings):
 * `cloudDensityAt(pb, hf, cov, storm, detail)` returns an extinction (1/m) for a body-frame point on the mid-shell along
 * the sun; the callers integrate it over ~0.4 of the shell's thickness. It is ONE fetch of the baked shadow cube (the
 * column's optical depth through the visible clouds, blurred over the penumbra), scaled by `uCloudShadowK` so a dense
 * column leaves ~48 % of the sun (light scattered forward through the cloud): soft, graded, the same for every material.
 * The other arguments are kept for compatibility and ignored.
 */
export const CLOUD_DENSITY_GLSL = /* glsl */ `
#ifndef GENESIS_CLOUDDENS
#define GENESIS_CLOUDDENS
uniform samplerCube uCloudShadowMap;
uniform float uCloudShadowK;
#ifndef GENESIS_CLFP
#define GENESIS_CLFP
float cl_fp = -1.0;
#endif
float cloudDensityAt(vec3 pb, float hf, float cov, float storm, bool detail) {
  float tau = textureLod(uCloudShadowMap, pb, 0.0).r;
  return (1.0 - exp(-tau * 0.3)) * uCloudShadowK;
}
#endif
`;

// ───────────────────────────── the cloud field (march + bakes) ─────────────────────────────

const CLOUD_FIELD_GLSL = /* glsl */ `
uniform highp sampler3D uCloudBase;
uniform highp sampler3D uCloudDetail;
uniform highp sampler3D uCloudCurl;
uniform vec3 uCloudWind;     // body-frame noise offset (m)
uniform vec4 uCloudScale;    // x = 1/base tile (1/m), y = 1/detail tile, z = extinction of dense cloud (1/m), w = coverage bias
uniform vec4 uStorms[8];     // weather systems of the cloud planet: xyz = body-frame centre, w = angular radius (rad)
uniform vec4 uStormK[8];     // x = strength 0..1, y = spin sense (+1 counter-clockwise from above), z = style, w = cos(reach)
uniform vec4 uStormT[8];     // xyz = body-frame unit tangent the system's tail / front trails toward (against its motion)
uniform float uStormN;
uniform float uGlobalBands;  // 0..1: a planet-wide weather organised into storm tracks (±35°) and an ITCZ
float cl_remap(float v, float a, float b, float c, float d) { return c + (v - a) / max(b - a, 1e-4) * (d - c); }
#ifndef GENESIS_CLFP
#define GENESIS_CLFP
// pixel footprint (m) of the current sample; < 0: implicit derivatives
float cl_fp = -1.0;
#endif
vec4 cl_tex(highp sampler3D s, vec3 q, float texPerM) {
  if (cl_fp < 0.0) return texture(s, q);
  return textureLod(s, q, log2(max(cl_fp * texPerM, 1.0)));
}

// Weather-scale organisation of the sim's coverage (smooth per 50 m cell, a plain disc under a painted system):
// coverage, storm strength, cloud TYPE (0 stratus .. 0.5 stratocumulus .. 1 cumulus; storm → cumulonimbus) and
// ANVIL cover (the shelf under the top of the shell that spreads from storm towers).
//   style 0 (fronts: rain, drizzle, overcast, snow, monsoon): a comma — one spiral arm wrapping into the centre with a dry
//            slot behind it, and the front as a long curved band trailing behind the moving system
//   style 1 (convective: storms, thunderstorms, hail): a cluster of cumulonimbus columns under a merged anvil
//   style 2 (tropical cyclones): a smooth central dense overcast (an anvil shield), an eye, four spiral rain bands
void cloudOrganise(vec3 pb, inout float cov, inout float storm, out float ctype, out float anvil, out float sysW) {
  vec3 dir = normalize(pb);
  storm = clamp(storm, 0.0, 1.0);
  anvil = 0.0;
  float cov0 = cov;     // before the synoptic thinning: weather systems are coherent and keep their full cover
  sysW = 0.0;           // how much a weather system organises this point
  // weather mask: synoptic (~1.3 km) × cluster (~450 m) scales with a full range — clusters of heaps, streets and
  // clear holes (the base texture's R is uniform 0..1)
  vec3 wq = pb * (1.0 / 5200.0) + uCloudWind * (0.25 / 5200.0);
  vec3 warp = (textureLod(uCloudBase, wq * 0.6 + vec3(0.31, 0.07, 0.53), 0.0).gba - 0.6) * 0.8;
  float big = smoothstep(0.2, 0.8, textureLod(uCloudBase, wq + warp * 0.5, 0.0).r);
  float cluster = smoothstep(0.15, 0.85, textureLod(uCloudBase, pb * (1.0 / 1900.0) + warp * 0.3 + vec3(0.7, 0.2, 0.4), 0.0).r);
  // cloud streets: rows of heaps along the (east–west) flow, ~250 m apart, in some regions
  float streetsW = smoothstep(0.55, 0.8, textureLod(uCloudBase, wq * 0.7 + vec3(0.13, 0.81, 0.27), 0.0).r);
  float streets = smoothstep(0.25, 0.75, textureLod(uCloudBase, vec3(pb.x * (1.0 / 4200.0), pb.y * (1.0 / 1000.0), pb.z * (1.0 / 4200.0)) + warp * 0.15, 0.0).r);
  float mask = clamp(0.62 * big + 0.62 * cluster - 0.14, 0.0, 1.0);
  mask = mix(mask, mask * (0.25 + 1.0 * streets), streetsW * 0.6);
  // broken cover only: an overcast stays overcast
  float brk = 1.0 - smoothstep(0.75, 0.97, cov);
  cov *= mix(1.0, 0.15 + 1.1 * mask, brk);
  // fair-weather cumulus where cover is broken, stratocumulus as it closes, regional variety from the synoptic warp
  ctype = clamp(1.0 - 0.62 * smoothstep(0.5, 0.92, cov) + 0.5 * warp.x, 0.0, 1.0);
  if (uGlobalBands > 0.0) {
    // the tracks meander (planetary waves of wavenumber 4 and 7 plus the synoptic warp) and are wide, with broken
    // cloud between them (integer wavenumbers keep the longitude seam continuous)
    float lon = atan(dir.x, dir.z);
    float lat = asin(clamp(dir.y, -1.0, 1.0));
    float wl = lat + 0.1 * sin(4.0 * lon + 5.0 * warp.x) + 0.06 * sin(7.0 * lon - 4.0 * lat + 6.0 * warp.y) + 0.3 * warp.z;
    float tracks = exp(-pow((abs(wl) - 0.61) / 0.24, 2.0)) + 0.85 * exp(-pow(wl / 0.16, 2.0));
    cov = mix(cov, cov0 * clamp(0.35 + 0.8 * tracks * (0.6 + 0.4 * big), 0.0, 1.15), uGlobalBands);
    storm *= mix(1.0, 0.45 + 0.75 * tracks, uGlobalBands);
    ctype = mix(ctype, mix(ctype, 0.35, tracks), uGlobalBands);
  }
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uStormN) break;
    vec4 S = uStorms[i];
    vec4 K = uStormK[i];
    float cd = dot(dir, S.xyz);
    if (cd < K.w) continue;
    float ang = acos(clamp(cd, -1.0, 1.0)) / S.w;     // 0 at the centre, 1 at the system's radius
    vec3 e1 = uStormT[i].xyz - S.xyz * dot(uStormT[i].xyz, S.xyz);
    e1 = dot(e1, e1) > 1e-8 ? normalize(e1) : normalize(cross(S.xyz, abs(S.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(S.xyz, e1);
    float th = atan(dot(dir, e2), dot(dir, e1));      // 0 along the trailing direction
    if (K.z < 0.5) {
      // comma cloud: a head with one arm wrapping in (and a dry slot), the front trailing behind and curving with the spin
      float arm = 0.5 + 0.5 * cos(th + K.y * 2.4 * log(ang + 0.08));
      float head = (1.0 - smoothstep(0.5, 1.05, ang)) * mix(0.3, 1.0, arm);
      float th0 = K.y * 0.5 * ang;
      float lateral = abs(sin(0.5 * (th - th0))) * 2.0 * ang;
      float tail = exp(-pow(lateral / (0.14 + 0.07 * ang), 2.0)) * smoothstep(0.3, 0.75, ang) * (1.0 - smoothstep(1.9, 2.6, ang));
      float shape = max(head, tail);
      float reach = 1.0 - smoothstep(2.1, 2.6, ang);
      float cb = mix(cov, cov0, K.x * reach * shape);
      cov = mix(cov, clamp(max(cb * 0.3, shape * 0.98 + cb * 0.15), 0.0, 1.0), K.x * reach);
      sysW = max(sysW, K.x * reach);
      ctype = mix(ctype, mix(0.12, 0.6, tail), K.x * shape);
      storm = mix(storm, storm * (0.5 + 0.9 * tail) + 0.25 * K.x * tail, K.x * reach);
    } else if (K.z < 1.5) {
      // convective cluster: cumulonimbus columns in cells, densest and tallest at the core, under one merged anvil
      float cells = textureLod(uCloudDetail, pb * (1.0 / 900.0) + uCloudWind * (0.4 / 900.0), 0.0).r;
      float core = 1.0 - smoothstep(0.0, 1.1, ang);
      float c = smoothstep(0.45, 0.68, cells + 0.35 * core);
      float reach = 1.0 - smoothstep(0.85, 1.25, ang);
      cov = mix(cov, clamp(max(cov * 0.5, c * (0.6 + 0.5 * core)), 0.0, 1.0), K.x * reach);
      sysW = max(sysW, K.x * reach);
      storm = max(storm, K.x * c * (0.55 + 0.45 * core));
      ctype = mix(ctype, 1.0, K.x * reach);
      // anvils spread from the strongest towers near the core (patchy, ~1 km), overshooting tops pierce them
      float cellsW = textureLod(uCloudDetail, pb * (1.0 / 2100.0) + vec3(0.41, 0.13, 0.77), 0.0).r;
      anvil = max(anvil, K.x * (1.0 - smoothstep(0.35, 0.85, ang)) * smoothstep(0.62, 0.82, cellsW + 0.3 * core));
    } else {
      // tropical cyclone: a smooth bright central dense overcast with an eye, spiral rain bands outside it
      float arms = 0.5 + 0.5 * sin(4.0 * log(ang + 0.06) * K.y + 2.0 * th);
      float reach = 1.0 - smoothstep(0.85, 1.35, ang);
      float cdo = 1.0 - smoothstep(0.3, 0.52, ang);
      float m = mix(0.08 + 1.25 * arms, 1.0, cdo);
      float cb = mix(cov, cov0, K.x * reach);
      cov = mix(cov, clamp(max(cb, 0.35) * m * 1.25, 0.0, 1.0), reach * K.x);
      sysW = max(sysW, K.x * reach);
      float eye = smoothstep(0.08, 0.14, ang);
      float wall = eye * (1.0 - smoothstep(0.13, 0.26, ang));
      storm = mix(storm, mix((0.35 + 0.6 * arms), 0.8, cdo) + 0.2 * wall, reach * K.x);
      // the overcast's top is smooth (stratiform), the eyewall and the bands tower
      ctype = mix(ctype, mix(0.85, 0.12, cdo * (1.0 - wall)), reach * K.x);
      anvil = max(anvil, K.x * reach * cdo * eye);
      cov *= mix(1.0, eye, reach * K.x);
    }
  }
  // organised weather reads from orbit: bands and arms solid, the lanes between them clear
  cov = mix(cov, smoothstep(0.15, 0.8, cov), sysW);
}

// The cloud field before its coverage threshold. Returns v (the heap shape × the type's vertical profile) and the
// threshold lo: cloud is where v > lo, crisp over a narrow ramp (cl_cover). an = anvil density 0..1, hn = height within
// the local cloud's own profile (0 base .. 1 top).
float cloudField(vec3 pb, float hf, float cov, float storm, float ctype, float anvil, out float hn, out float lo, out float an) {
  hn = 0.0; lo = 2.0; an = 0.0;
  vec3 q = (pb + uCloudWind) * uCloudScale.x;
  vec4 n = cl_tex(uCloudBase, q, 128.0 * uCloudScale.x);
  float colm = smoothstep(0.45, 0.8, storm);
  // FLAT bases (one condensation level, barely undulating), tops from thin decks to towers
  // (stratiform decks undulate more and hang ragged scud: a dead-flat grey ceiling read as a painted plane)
  float base = mix(0.05, 0.1, ctype) + (n.b - 0.6) * mix(0.09, 0.03, ctype);
  float top = mix(0.2, 0.62, ctype) * (0.7 + 0.6 * n.g);
  top = mix(top, 0.9 + 0.1 * (n.g - 0.6), colm);
  // anvil: a flat-bottomed shelf under the top of the shell, spreading far wider than the towers
  if (anvil > 0.0) {
    float aBot = 0.74 + 0.04 * (n.b - 0.6);
    float aTop = 0.95 + 0.05 * (n.g - 0.6);
    an = anvil * smoothstep(aBot - 0.01, aBot + 0.015, hf) * (1.0 - smoothstep(aTop - 0.07, aTop, hf)) * smoothstep(0.35, 0.65, 0.6 * n.g + 0.4 * n.r + 0.15 * anvil);
  }
  if (hf < base || hf > top) return 0.0;
  hn = clamp((hf - base) / max(top - base, 0.05), 0.0, 1.0);
  float bottom = smoothstep(0.0, mix(0.08, 0.025, ctype), hn);
  // heaps taper into rounded tops; decks stay slabs; towers stay columns
  float upper = 1.0 - smoothstep(mix(0.82, 0.35, ctype * (1.0 - colm)), 1.0, hn);
  float shape = n.r;
  // stratus is a smooth sheet: lower the shape's contrast so coverage does not break it into cells
  shape = mix(0.45 + 0.55 * shape, shape, smoothstep(0.1, 0.55, ctype));
  // a cumulonimbus is a filled column (lumpy only at its edges)
  shape = mix(shape, 0.5 + 0.5 * shape, colm);
  // cauliflower: billows of ~75 / 150 m (the base texture's Worley octaves) push a heap's surface in and out, a little
  // stronger toward the top (one that only started above the base left a wider skirt under a narrower waist:
  // mushroom-shaped heaps); decks stay smooth
  float bil = (1.0 - (0.4 * n.b + 0.6 * n.a)) * (0.65 + 0.35 * smoothstep(0.1, 0.6, hn)) * smoothstep(0.3, 0.8, ctype);
  lo = 1.0 - 0.85 * cov;
  return shape * bottom * upper - bil * 0.14;
}
// coverage-faithful threshold with a NARROW ramp: a cumulus goes from clear air to its dense interior within a few
// metres (a ramp of 0.12 over a heap's gentle field gradient made 20–40 m translucent fringes: soft, out-of-focus
// blobs). w widens it for samples that stand for a large footprint (the light march's long cone steps)
float cl_cover(float v, float lo, float w) { return clamp(cl_remap(v, lo, min(1.0, lo + w), 0.0, 1.0), 0.0, 1.0); }
// how far below the threshold the detail can still raise a surface: coarse steps treat v > lo − CL_ERO as cloud
#define CL_ERO 0.2

// smooth shape (no detail), 0..1: light-march far steps, cloud shadows, coarse tests; w: threshold ramp width
float cloudShape(vec3 pb, float hf, float cov, float storm, float ctype, float anvil, float w, out float hn) {
  float lo, an;
  float v = cloudField(pb, hf, cov, storm, ctype, anvil, hn, lo, an);
  float c = v > 0.0 ? cl_cover(v, lo, w) : 0.0;
  if (an > c) { hn = mix(hn, 0.95, smoothstep(0.0, 0.3, an)); }
  return max(c, an * 0.5);
}

// the full cloud with detail: curl-swirled Worley detail DISPLACES the surface (it is subtracted from the field
// before the narrow threshold, up to ~30 m on a heap) — wispy and light at the flat base, deep cauliflower billows at
// the tops — and within ~1.4 km a finer octave sharpens the silhouettes. Returns 0..1.
float cloudDetailed(vec3 pb, float hf, float cov, float storm, float ctype, float anvil, float nearK, out float hn) {
  float lo, an;
  float v = cloudField(pb, hf, cov, storm, ctype, anvil, hn, lo, an);
  if (v <= lo - CL_ERO && an <= 0.0) return 0.0;
  vec3 dq = (pb + uCloudWind * 1.6) * uCloudScale.y;
  vec3 curl = cl_tex(uCloudCurl, dq * 0.29, 32.0 * 0.29 * uCloudScale.y).xyz * 2.0 - 1.0;
  dq += curl * mix(0.5, 0.12, hn);
  vec3 dn = cl_tex(uCloudDetail, dq, 64.0 * uCloudScale.y).rgb;
  float df = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
  float bill = clamp(hn * 4.0, 0.0, 1.0);
  float dmod = mix(df, 1.0 - df, bill);
  // (the base's own edge is ragged: wisps where the flat bottom turns up into the sides)
  float ero = mix(mix(0.13, 0.08, ctype), mix(0.12, CL_ERO, ctype), smoothstep(0.06, 0.4, hn));
  float vv = v - dmod * ero;
  if (nearK > 0.0) {
    float d2 = cl_tex(uCloudDetail, dq * 3.31 + vec3(0.37, 0.71, 0.13), 64.0 * 3.31 * uCloudScale.y).g;
    vv -= mix(d2, 1.0 - d2, bill) * 0.07 * nearK;
  }
  float c = v > 0.0 ? cl_cover(vv, lo, 0.03) : 0.0;
  if (an > 0.0) {
    // the anvil: smooth, fibrous, lightly eroded
    float ca = clamp(an - (1.0 - df) * 0.3, 0.0, 1.0) * 0.5;
    if (ca > c) hn = mix(hn, 0.95, smoothstep(0.0, 0.3, ca));
    c = max(c, ca);
  }
  return c;
}

// coarse test: could the detailed cloud be non-zero here?
float cloudMaybe(vec3 pb, float hf, float cov, float storm, float ctype, float anvil) {
  float hn, lo, an;
  float v = cloudField(pb, hf, cov, storm, ctype, anvil, hn, lo, an);
  return max(v - (lo - CL_ERO), an);
}

// GL cube-map face orientation (texel row 0 is tc = -1), as DirFieldCube builds the sim's cubes
vec3 cl_faceDir(vec2 st, float face) {
  float sc = st.x, tc = st.y;
  if (face < 0.5) return vec3(1.0, -tc, -sc);
  if (face < 1.5) return vec3(-1.0, -tc, sc);
  if (face < 2.5) return vec3(sc, 1.0, tc);
  if (face < 3.5) return vec3(sc, -1.0, -tc);
  if (face < 4.5) return vec3(sc, -tc, 1.0);
  return vec3(-sc, -tc, -1.0);
}
`;

// the organised weather, baked per cube texel: (coverage, storm, type, anvil)
const WX_FRAG = /* glsl */ `
${CLOUD_FIELD_GLSL}
uniform samplerCube uCoverage;
uniform float uFace;
uniform float uSize;
uniform float uMidR;
void main() {
  vec2 st = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec3 dir = normalize(cl_faceDir(st, uFace));
  vec2 cs = textureLod(uCoverage, dir, 0.0).rg;
  float cov = clamp(cs.x + uCloudScale.w, 0.0, 1.0);
  float storm = cs.y;
  // the sim's own storms (rain heavier than ~5 mm/h) spread an anvil downwind of their towers: the strongest
  // precipitation within ~300 m
  vec3 t1 = normalize(cross(dir, abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(dir, t1);
  float pw = cs.y;
  for (int k = 0; k < 6; k++) {
    float a = float(k) * 1.0472;
    pw = max(pw, textureLod(uCoverage, normalize(dir * uMidR + (t1 * cos(a) + t2 * sin(a)) * 300.0), 0.0).g * 0.9);
  }
  float ctype, anvil, sysW;
  cloudOrganise(dir * uMidR, cov, storm, ctype, anvil, sysW);
  // (not under an organised system: a painted hurricane rains over its whole disc, and that anvil covered its bands)
  anvil = max(anvil, smoothstep(0.6, 0.95, pw) * 0.8 * (1.0 - sysW) * smoothstep(0.5, 0.8, ctype));
  gl_FragColor = vec4(cov, storm, ctype, anvil);
}
`;

// each column's cloud-shadow optical depth: four penumbra taps × four heights through the shell
const SHADOW_FRAG = /* glsl */ `
${CLOUD_FIELD_GLSL}
uniform samplerCube uCloudWx;
uniform float uFace;
uniform float uSize;
uniform vec2 uShell;
uniform float uPenumbra;   // m: the sun's angular size × the distance to the cloud + the cloud's own thickness
void main() {
  vec2 st = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec3 dir = normalize(cl_faceDir(st, uFace));
  vec3 t1 = normalize(cross(dir, abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(dir, t1);
  float thick = uShell.y - uShell.x;
  float mid = 0.5 * (uShell.x + uShell.y);
  float tau = 0.0;
  cl_fp = uPenumbra * 0.5;
  for (int j = 0; j < 4; j++) {
    float a = float(j) * 1.5708 + 0.785;
    vec3 dj = normalize(dir * mid + (t1 * cos(a) + t2 * sin(a)) * uPenumbra);
    vec4 wx = textureLod(uCloudWx, dj, 0.0);
    if (wx.x < 0.02 && wx.w < 0.02) continue;
    for (int i = 0; i < 4; i++) {
      float hf = (float(i) + 0.5) / 4.0;
      float hn;
      float c = cloudShape(dj * (uShell.x + hf * thick), hf, wx.x, wx.y, wx.z, wx.w, 0.08, hn);
      tau += c * uCloudScale.z * (1.0 + 0.6 * wx.y) * thick * 0.25;
    }
  }
  gl_FragColor = vec4(tau * 0.25, 0.0, 0.0, 1.0);
}
`;

// ───────────────────────────── the march ─────────────────────────────

const CLOUD_FRAG = /* glsl */ `
#include <common>
${ATMO_PARS}
${SKY_LOOKUP}
${LOGDEPTH_DECODE}
${CLOUD_FIELD_GLSL}
layout(location = 0) out highp vec4 oCol;
layout(location = 1) out highp vec4 oAux;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform samplerCube uCloudWx;
uniform sampler2D tBlue;
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
uniform float uNearR;     // the near zone (m) where cloud at the lens dissolves into fog
uniform float uCamFog;    // 0..1: the camera is inside the shell (in-cloud fog from the local density)
uniform float uInsideAir; // 0 seen from space .. 1 from inside the air (art-directed low-sun reddening)
uniform float uCamMuS;    // sine of the sun's elevation at the camera
uniform vec2 uFullRes;    // render resolution
uniform vec2 uOffset;     // this frame's pixel inside each k×k block
uniform float uK;
uniform float uPixelAngle; // radians per full-resolution pixel
uniform float uNearDetail;
uniform float uCirrus;    // cirrus cover 0..1
uniform float uCirrusR;   // cirrus sheet radius (m)
uniform vec3 uMoonDir;    // world frame
uniform vec3 uMoonE;      // moon illuminance (0 when no moon is up)
uniform float uDebugView; // 1 first-hit distance, 2 transmittance, 3 samples taken

float hg(float nu, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * nu, 1e-4), 1.5)); }

// sunlight reaching a cloud at radius r: the air above it, the planet's shadow past the CLOUD's own horizon (it sits
// ~25° above the ground's on this world, so undersides glow orange and pink well after the ground's sunset), a little
// art-directed extra reddening toward a low sun from inside the air (never when the camera itself is in daylight:
// clouds a few km away are near their own sunset at noon here) and a slight grey-out just before the cloud's sunset
vec3 cloudSun(float r, float muC) {
  float dip = sqrt(max(0.0, 1.0 - (uRg / r) * (uRg / r)));
  float h = muC + dip;
  // in daylight at the camera, distant clouds (several km round this small world: near their own sunset at noon) are
  // not shown much redder than the sky overhead — salmon clouds on a noon horizon read as a grading error
  float dayK = smoothstep(0.15, 0.45, uCamMuS) * uInsideAir;
  vec3 Tc = sunTransmittance(r, mix(muC, max(muC, 0.7 * min(uCamMuS, 0.6)), dayK));
  Tc *= smoothstep(-0.015, 0.02, h);
  float kx = mix(1.0, 1.3, uInsideAir * (1.0 - smoothstep(0.0, 0.35, h)) * (1.0 - smoothstep(0.15, 0.45, uCamMuS)));
  Tc = pow(max(Tc, vec3(1e-5)), vec3(kx));
  float lumT = dot(Tc, vec3(0.2126, 0.7152, 0.0722));
  Tc = mix(Tc, mix(vec3(lumT), Tc, 0.7), 1.0 - smoothstep(-0.01, 0.06, h));
  return uSunE * Tc;
}

// in-scattering per unit extinction and illuminance: single scattering (dual-lobe HG: silver lining toward the sun,
// soft back-scatter) + three multiple-scattering octaves (Wrenninge: less extinction, flatter phase) + a diffusion
// floor. A thick slab lit at 45° from the camera's side returns ~0.43 E·uCloudBright (white Lambert: 0.225 E); a
// shadow side whose light crossed τ = 10 of cloud keeps ~20 % of that (form: dark bases, bright tops).
// (the octaves' phase values depend only on the ray and the light: computed once per ray — msPhases)
vec4 msPhases(float nu) {
  return vec4(0.75 * hg(nu, 0.6) + 0.25 * hg(nu, -0.3), 0.75 * hg(nu, 0.3) + 0.25 * hg(nu, -0.15),
              0.75 * hg(nu, 0.15) + 0.25 * hg(nu, -0.075), 0.75 * hg(nu, 0.06) + 0.25 * hg(nu, -0.03));
}
float msScatter(float od, vec4 ph) {
  return exp(-od) * ph.x + 0.7 * exp(-od * 0.4) * ph.y + 0.5 * exp(-od * 0.2) * ph.z + 0.35 * exp(-od * 0.1) * ph.w
       + 0.08 * exp(-od * 0.05) * (0.25 / PI);
}

float densityOf(float c, float storm) { return c * uCloudScale.z * (1.0 + storm * 0.6); }

// optical depth toward a light: a cone of steps growing from 3 m (High: 3, 8, 20, 53, 137 m — billows shade each
// other, the deck above darkens the base), each read at its middle and at a footprint of half its length; the first
// two with edge detail (Low / Medium reach less: with 3–4 steps a 150 m last step flips pixels between lit and black)
float lightOD(vec3 p, vec3 L, vec4 wx, float fp0, float thick) {
  float od = 0.0;
  float ls = 3.0;
  float lg = uLightSteps <= 3 ? 3.5 : uLightSteps == 4 ? 3.0 : uLightSteps == 5 ? 2.6 : uLightSteps == 6 ? 2.0 : 1.55;
  vec3 lp = p;
  for (int k = 0; k < 8; k++) {
    if (k >= uLightSteps) break;
    vec3 q = lp + L * (ls * 0.5);
    lp += L * ls;
    float lr = length(q);
    float lhf = (lr - uShell.x) / thick;
    if (lhf > 1.0 || lhf < 0.0) break;
    cl_fp = max(fp0, ls * 0.5);
    float lhn;
    // (the long steps stand for a wide cone: a softer threshold, or a single sample inside / outside a heap draws a
    // hard contour across its base)
    float lc = k < 2 ? cloudDetailed(q, lhf, wx.x, wx.y, wx.z, wx.w, 0.0, lhn) : cloudShape(q, lhf, wx.x, wx.y, wx.z, wx.w, min(0.3, 0.002 * ls + 0.03), lhn);
    od += densityOf(lc, wx.y) * ls;
    ls *= lg;
  }
  return od;
}

// thin cirrus sheet (40 m thick, two samples across it): fibres and hooks from curl-warped octaves stretched along the
// jets (body-frame east–west), thicker under the synoptic pattern
float cirrusFib(vec3 p) {
  vec3 q = vec3(p.x * (1.0 / 1500.0), p.y * (1.0 / 260.0), p.z * (1.0 / 1500.0));
  cl_fp = -1.0;
  vec3 cw = textureLod(uCloudCurl, q * 0.6 + vec3(0.11, 0.53, 0.29), 0.0).xyz * 2.0 - 1.0;
  q += cw * 0.22;
  float f1 = textureLod(uCloudDetail, q, 0.0).a;
  vec3 q2 = q * vec3(2.7, 6.1, 2.7) + cw * 0.35 + vec3(0.37, 0.19, 0.71);
  float f2 = textureLod(uCloudDetail, q2, 0.0).a;
  float fib = 1.0 - abs(f2 * 2.0 - 1.0);
  fib *= fib * fib;
  return f1 * 0.72 + fib * 0.38 * smoothstep(0.35, 0.7, f1);
}
vec4 cirrusAt(vec3 o, vec3 d, float tC, vec3 sun, float nu) {
  vec3 pc = o + d * tC;
  float r = length(pc);
  vec3 up = pc / r;
  float mu = abs(dot(up, d));
  float dt = min(20.0 / max(mu, 0.05), 400.0);
  float big = textureLod(uCloudBase, pc * (1.0 / 6800.0) + vec3(0.6, 0.2, 0.9), 0.0).r;
  float cov = uCirrus * (0.25 + 1.0 * big);
  float m = 0.0;
  for (int i = 0; i < 2; i++) {
    vec3 p = o + d * (tC + (float(i) - 0.5) * dt);
    m += clamp(cl_remap(cirrusFib(p), 1.0 - cov * 0.85, 1.0, 0.0, 1.0), 0.0, 1.0);
  }
  m *= 0.5;
  m *= m;
  if (m <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  // seen edge-on (along the limb) a thin sheet collapses into bright scratch lines: fade it out there
  m *= smoothstep(0.1, 0.38, mu);
  float tau = m * 0.7 / max(mu, 0.12);
  float Tci = exp(-tau);
  vec3 sunCol = cloudSun(r, dot(up, sun));
  float ph = mix(hg(nu, 0.7), hg(nu, -0.2), 0.3);
  vec3 amb = skyIrradiance(up, up, sun) / PI;
  vec3 S = sunCol * ph * 1.6 * uCloudBright + amb * 0.9;
  return vec4(S * (1.0 - Tci), Tci);
}

void main() {
  // the full-resolution pixel this march texel samples this frame
  vec2 pix = floor(gl_FragCoord.xy) * uK + uOffset + 0.5;
  if (pix.x > uFullRes.x || pix.y > uFullRes.y) { oCol = vec4(0.0, 0.0, 0.0, 1.0); oAux = vec4(-1.0, -1.0, 0.0, 0.0); return; }
  vec2 uv = pix / uFullRes;
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  vec3 vdir = normalize(v.xyz / v.w);
  float dz = texelFetch(tDepth, ivec2(pix), 0).r;
  float tScene = dz >= 0.999999 ? 1e30 : viewZFromLogDepth(dz, uFar) / max(-vdir.z, 1e-4);
  // (the resolve's depth weights read the sample's scene depth from here: 16 fewer full-res depth fetches per pixel)
  float zLog = dz >= 0.999999 ? 24.0 : log2(viewZFromLogDepth(dz, uFar) + 1.0);
  // march in the planet's body frame (the weather cubes and the noise live there)
  vec3 d = normalize(uWorldToBody * (uCamRot * vdir));
  vec3 o = uWorldToBody * (-uPlanetPos);
  vec3 sun = normalize(uWorldToBody * uSunDir);
  vec3 moon = normalize(uWorldToBody * uMoonDir);
  bool moonOn = dot(uMoonE, uMoonE) > 1e-12;
  float r0 = length(o);
  vec2 si = raySphere(o, d, uShell.x);
  vec2 so = raySphere(o, d, uShell.y);
  vec2 sg = raySphere(o, d, uRg - 2.0);
  bool hitsGround = sg.x <= sg.y && sg.x > 0.0;
  float tEnd = min(tScene, hitsGround ? sg.x : 1e30);
  float nu = dot(d, sun);
  vec4 phS = msPhases(nu);
  vec4 phM = moonOn ? msPhases(dot(d, moon)) : vec4(0.0);
  // blue-noise jitter (no diagonal hatching), a new rank each time this pixel is marched again
  float visit = floor(uFrame / (uK * uK));
  float jitter = fract(texelFetch(tBlue, ivec2(floor(gl_FragCoord.xy)) & 63, 0).r + visit * 0.618034);

  // cirrus (two samples where the ray crosses its sheet in front of the scene); gone as the camera nears the sheet
  vec4 ci = vec4(0.0, 0.0, 0.0, 1.0);
  float tCi = -1.0;
  float ciNear = smoothstep(60.0, 160.0, abs(r0 - uCirrusR));
  if (uCirrus > 0.01 && ciNear > 0.0) {
    vec2 sc = raySphere(o, d, uCirrusR);
    if (sc.x <= sc.y && sc.y > 0.0) {
      tCi = r0 < uCirrusR ? sc.y : (sc.x > 0.0 ? sc.x : -1.0);
      if (tCi > 0.0 && tCi < tEnd) {
        ci = cirrusAt(o, d, tCi, sun, nu);
        ci = mix(vec4(0.0, 0.0, 0.0, 1.0), ci, ciNear);
      } else tCi = -1.0;
    }
  }

  // the shell is the outer sphere MINUS the inner one: a ray from above that dips below the cloud base and comes back
  // out (near the limb) crosses it twice; both pieces are marched as one continuous path
  vec3 L = vec3(0.0);
  float T = 1.0;
  float tW = 0.0, wW = 0.0, firstHit = -1.0;
  float nSamp = 0.0;
  float a0 = 0.0, a1 = 0.0, len1 = 0.0, len = 0.0, b0 = 0.0, tFinal = 0.0;
  if (!(so.x > so.y || so.y < 0.0)) {
    bool hitsInner = si.x <= si.y && si.y > 0.0;
    a0 = max(so.x, 0.0); a1 = so.y;
    float b1 = 0.0;
    if (r0 < uShell.x) { a0 = si.y; a1 = so.y; }
    else if (hitsInner && si.x > 0.0) {
      a1 = si.x;
      if (!hitsGround) { b0 = si.y; b1 = so.y; }
    }
    a1 = min(a1, tEnd);
    b1 = min(b1, tEnd);
    // grazing paths through the shell can be tens of kilometres long: cap them
    a1 = min(a1, a0 + 9000.0);
    b1 = min(b1, b0 + max(0.0, 9000.0 - max(a1 - a0, 0.0)));
    len1 = max(a1 - a0, 0.0);
    len = len1 + max(b1 - b0, 0.0);
    tFinal = len > len1 ? b1 : a1;
  }
  float thick = uShell.y - uShell.x;
  vec3 ambTop = vec3(0.0), ambBot = vec3(0.0);
  bool ambDone = false;
  // in-cloud fog: inside the shell the cloud at the lens dissolves over the near zone; the fog of the local density
  // (lit like the cloud there) takes its place, so climbing through the deck passes THROUGH it (white-out when deep)
  if (uCamFog > 0.0 && r0 > uShell.x && r0 < uShell.y) {
    float hf = (r0 - uShell.x) / thick;
    vec4 wx = textureLod(uCloudWx, o, 0.0);
    float hn;
    cl_fp = 0.5;
    float c = cloudDetailed(o, hf, wx.x, wx.y, wx.z, wx.w, 0.0, hn);
    float dens = densityOf(c, wx.y) * uCamFog;
    if (dens > 1e-5) {
      vec3 up = o / r0;
      ambTop = skyIrradiance(up, up, sun) / PI;
      ambBot = skyIrradiance(up, -up, sun) / PI;
      ambDone = true;
      float od = lightOD(o, sun, wx, 0.5, thick);
      vec3 S = cloudSun(r0, dot(up, sun)) * msScatter(od, phS) * uCloudBright + mix(ambBot, ambTop, 0.5 + 0.5 * hn) * mix(0.5, 1.0, hn);
      float fl = min(uNearR * 0.6, tEnd);
      float stepT = exp(-dens * fl);
      L += S * (1.0 - stepT);
      T *= stepT;
      tW += (1.0 - stepT) * fl * 0.5; wW += 1.0 - stepT;
    }
  }
  if (len > 0.0) {
    // samples spaced geometrically over the path (step ∝ distance), with a budget that grows with the path (×1–1.5)
    float budget = float(uSteps) * clamp(len / 2000.0, 1.0, 1.5);
    float tS = max(a0, 12.0);
    float gStep = log(max(tFinal, tS + 1.0) / tS) / budget;
    int maxIt = int(budget) * 2 + 16;
    float s = 0.0;
    bool fine = false;
    int empty = 0;
    float dPrev = -1.0;
    float lastStep = 0.0;
    // powder: thin cloud (rims, the crevices between billows) scatters less light toward the viewer than a dense
    // surface — dark separation lines that show the cauliflower; none toward the sun, where rims are the silver lining
    float powderK = 0.55 * (1.0 - smoothstep(0.2, 0.9, nu));
    {
      float dt0 = max(0.6, tS * gStep);
      s = dt0 * jitter;
      lastStep = s;
    }
    for (int i = 0; i < 480; i++) {
      if (i >= maxIt || s >= len || T <= 0.0) break;
      float t = s < len1 ? a0 + s : b0 + (s - len1);
      // the geometric step (a few pixels' footprint), always reaching the end of the path within the budget
      float dtC = max(0.6, max(t, tS) * gStep);
      dtC = max(dtC, (len - s) / float(maxIt - i));
      if (!fine) {
        vec3 p = o + d * t;
        float r = length(p);
        float hf = (r - uShell.x) / thick;
        cl_fp = t * uPixelAngle * 1.5;
        vec4 wx = textureLod(uCloudWx, p, 0.0);
        if (wx.x < 0.02 && wx.w < 0.02) { s += dtC * 2.0; lastStep = dtC * 2.0; continue; }
        if (cloudMaybe(p, hf, wx.x, wx.y, wx.z, wx.w) <= 0.0) { s += dtC; lastStep = dtC; continue; }
        // entered a cloud: bisect back toward the last empty sample to find its surface
        float sa = max(s - lastStep, 0.0), sb = s;
        for (int b = 0; b < 3; b++) {
          float sm = 0.5 * (sa + sb);
          float tm = sm < len1 ? a0 + sm : b0 + (sm - len1);
          vec3 pm = o + d * tm;
          if (cloudMaybe(pm, (length(pm) - uShell.x) / thick, wx.x, wx.y, wx.z, wx.w) > 0.0) sb = sm; else sa = sm;
        }
        s = sa;
        fine = true; empty = 0; dPrev = -1.0;
        continue;
      }
      // fine: no step thicker than τ ≈ 1.6 (from the last sample's extinction), at most the geometric step; the first
      // step into a cloud is short (its density is unknown); evaluated at the middle of the step
      float dt = dPrev < 0.0 ? min(dtC, max(1.5, t * uPixelAngle * 2.0)) : clamp(1.6 / max(dPrev, 1e-5), 0.6, dtC);
      float sm = s + 0.5 * dt;
      float tm = sm < len1 ? a0 + sm : b0 + (sm - len1);
      vec3 p = o + d * tm;
      float r = length(p);
      float hf = (r - uShell.x) / thick;
      cl_fp = tm * uPixelAngle * 1.5;
      vec4 wx = textureLod(uCloudWx, p, 0.0);
      float hn = 0.0;
      float nearK = uNearDetail * (1.0 - smoothstep(300.0, 1400.0, tm));
      float c = cloudDetailed(p, hf, wx.x, wx.y, wx.z, wx.w, nearK, hn);
      // the near zone dissolves (the in-cloud fog above stands in for it)
      float dens = densityOf(c, wx.y) * (uCamFog > 0.0 ? smoothstep(uNearR * 0.25, uNearR, tm) : smoothstep(2.0, 12.0, tm));
      nSamp += 1.0;
      if (dens <= 1e-5) {
        empty++;
        if (empty >= 3) fine = false;
        s += max(dt, dtC * 0.5);
        lastStep = max(dt, dtC * 0.5);
        dPrev = -1.0;
        continue;
      }
      empty = 0;
      vec3 up = p / r;
      if (!ambDone) {
        // sky dome above, lit ground below (constant along one ray: the SH lookups once per pixel)
        ambTop = skyIrradiance(up, up, sun) / PI;
        ambBot = skyIrradiance(up, -up, sun) / PI;
        ambDone = true;
      }
      float fp0 = cl_fp;
      vec3 S = vec3(0.0);
      vec3 sunCol = cloudSun(r, dot(up, sun));
      if (dot(sunCol, sunCol) > 1e-10) {
        float od = lightOD(p, sun, wx, fp0, thick);
        float ms = msScatter(od, phS);
        ms *= mix(1.0, 1.0 - exp(-dens * 40.0), powderK);
        S += sunCol * ms * uCloudBright;
      }
      if (moonOn) {
        float muM = dot(up, moon);
        float dipM = sqrt(max(0.0, 1.0 - (uRg / r) * (uRg / r)));
        float vis = smoothstep(-0.02, 0.04, muM + dipM);
        if (vis > 0.0) S += uMoonE * vis * msScatter(lightOD(p, moon, wx, fp0, thick), phM) * uCloudBright;
      }
      // ambient: the cloud hides half of the sky from its own surface and more toward the base; storm cores darker still
      float ambOcc = mix(0.25, 0.75, smoothstep(0.0, 0.9, hn)) * (1.0 - 0.45 * smoothstep(0.3, 1.0, wx.y));
      S += mix(ambBot, ambTop, smoothstep(0.0, 1.0, hn)) * ambOcc;
      // sunset underglow: with the sun low for the cloud, its base and flanks take the warm light of the sunlit air
      // and of the neighbouring clouds (pink-orange undersides rather than brown-grey)
      S += sunCol * (0.035 * (1.0 - smoothstep(0.05, 0.4, dot(up, sun))) * (1.0 - 0.6 * hn) * uInsideAir);
      float stepT = exp(-dens * dt);
      float w = T * (1.0 - stepT);
      L += S * w;
      tW += w * tm; wW += w;
      if (firstHit < 0.0) firstHit = tm;
      T *= stepT;
      dPrev = dens;
      s += dt;
      lastStep = dt;
      if (T < 0.004) { T = 0.0; break; }
    }
  }
  // composite the cirrus sheet in its order along the ray
  if (tCi > 0.0) {
    float wc = 1.0 - ci.a;
    if (len <= 0.0 || tCi < a0) { L = ci.rgb + ci.a * L; tW = tW * ci.a + tCi * wc; wW = wW * ci.a + wc; }
    else { L = L + T * ci.rgb; tW += T * wc * tCi; wW += T * wc; }
    T *= ci.a;
  }
  float tCloud = wW > 1e-4 ? tW / wW : -1.0;
  oCol = vec4(L, T);
  oAux = vec4(tCloud > 0.0 ? log2(tCloud + 1.0) : -1.0, firstHit, nSamp, zLog);
  if (uDebugView > 0.5) {
    // debug views: first-hit distance (blue near → red far, log scale), transmittance, samples taken (heat)
    vec3 dc = vec3(0.0);
    if (uDebugView < 1.5) { float x = firstHit > 0.0 ? clamp(log2(firstHit + 1.0) / 14.0, 0.0, 1.0) : 0.0; dc = firstHit > 0.0 ? mix(vec3(0.1, 0.3, 1.0), vec3(1.0, 0.2, 0.05), x) : vec3(0.0); }
    else if (uDebugView < 2.5) dc = vec3(T);
    else { float x = clamp(nSamp / 64.0, 0.0, 1.0); dc = mix(vec3(0.0, 0.0, 0.4), vec3(1.0, 0.9, 0.1), x); }
    oCol = vec4(dc * 4.0, 0.0);
  }
}
`;

/**
 * Full-resolution temporal resolve of the interleaved march (see the header): parallax-correct reprojection at each
 * pixel's cloud distance, YCoCg variance clipping, confidence-weighted fallback to a depth-aware Catmull-Rom
 * reconstruction of the current samples, per-pixel sample counts.
 */
const RESOLVE_FRAG = /* glsl */ `
#include <common>
${ATMO_PARS}
${LOGDEPTH_DECODE}
layout(location = 0) out highp vec4 oCol;
layout(location = 1) out highp vec4 oAux;
varying vec2 vUv;
uniform sampler2D tCur;
uniform sampler2D tCurAux;
uniform sampler2D tHist;
uniform sampler2D tHistAux;
uniform sampler2D tDepth;
uniform vec2 uFullRes;
uniform vec2 uRawRes;
uniform vec2 uOffset;
uniform float uK;
uniform float uHistValid;
uniform float uMaxN;
uniform mat4 uInvProj;
uniform mat3 uCamRot;
uniform mat3 uWorldToBody;
uniform vec3 uPlanetPos;
uniform vec3 uPrevCamBody;
uniform vec2 uShell;
uniform float uCirrusR;
uniform float uFar;
uniform mat4 uPrevBodyToClip;

float zAt(ivec2 p) {
  float dz = texelFetch(tDepth, p, 0).r;
  return dz >= 0.999999 ? 24.0 : log2(viewZFromLogDepth(dz, uFar) + 1.0);
}
vec3 toYCoCg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }

// Catmull-Rom history fetch (9 bilinear taps): repeated reprojection under motion does not blur the clouds
vec4 histCR(vec2 uv) {
  vec2 sp = uv * uFullRes;
  // (a static view reprojects onto texel centres: fetch them exactly)
  vec2 fr = sp - 0.5;
  vec2 rf = floor(fr + 0.5);
  if (all(lessThan(abs(fr - rf), vec2(2e-3)))) return texelFetch(tHist, ivec2(rf), 0);
  vec2 t1 = floor(sp - 0.5) + 0.5;
  vec2 f = sp - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 tc0 = (t1 - 1.0) / uFullRes;
  vec2 tc3 = (t1 + 2.0) / uFullRes;
  vec2 tc12 = (t1 + w2 / w12) / uFullRes;
  vec4 r = vec4(0.0);
  r += texture(tHist, vec2(tc0.x, tc0.y)) * w0.x * w0.y;
  r += texture(tHist, vec2(tc12.x, tc0.y)) * w12.x * w0.y;
  r += texture(tHist, vec2(tc3.x, tc0.y)) * w3.x * w0.y;
  r += texture(tHist, vec2(tc0.x, tc12.y)) * w0.x * w12.y;
  r += texture(tHist, vec2(tc12.x, tc12.y)) * w12.x * w12.y;
  r += texture(tHist, vec2(tc3.x, tc12.y)) * w3.x * w12.y;
  r += texture(tHist, vec2(tc0.x, tc3.y)) * w0.x * w3.y;
  r += texture(tHist, vec2(tc12.x, tc3.y)) * w12.x * w3.y;
  r += texture(tHist, vec2(tc3.x, tc3.y)) * w3.x * w3.y;
  return r;
}

void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  vec2 uv = (vec2(P) + 0.5) / uFullRes;
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  vec3 vdir = normalize(v.xyz / v.w);
  vec3 d = normalize(uWorldToBody * (uCamRot * vdir));
  vec3 o = uWorldToBody * (-uPlanetPos);
  float r0 = length(o);
  float dz = texelFetch(tDepth, P, 0).r;
  float tScene = dz >= 0.999999 ? 1e30 : viewZFromLogDepth(dz, uFar) / max(-vdir.z, 1e-4);
  // geometry in front of every cloud layer sees no cloud at all
  float entry = 1e30;
  if (r0 >= uShell.x && r0 <= uShell.y) entry = 0.0;
  else if (r0 > uShell.y) {
    vec2 so = raySphere(o, d, uShell.y);
    if (so.x <= so.y && so.x > 0.0) entry = so.x;
  } else {
    vec2 si = raySphere(o, d, uShell.x);
    if (si.x <= si.y && si.y > 0.0) entry = si.y;
  }
  vec2 sc = raySphere(o, d, uCirrusR);
  if (sc.x <= sc.y) {
    float tcr = r0 < uCirrusR ? sc.y : sc.x;
    if (tcr > 0.0) entry = min(entry, tcr);
  }
  if (tScene <= entry) { oCol = vec4(0.0, 0.0, 0.0, 1.0); oAux = vec4(-1.0, 0.0, 0.0, 0.0); return; }

  int k = int(uK + 0.5);
  ivec2 off = ivec2(uOffset + 0.5);
  ivec2 rmax = ivec2(uRawRes) - 1;
  ivec2 Pmax = ivec2(uFullRes) - 1;
  bool marched = all(equal(P - (P / k) * k, off));
  float z0 = zAt(P);
  // this pixel's position among the raw samples (raw texel j sits at full-res pixel j·k + off)
  vec2 q = (vec2(P) - vec2(off)) / float(k);
  vec2 qb = floor(q);
  vec2 f = q - qb;
  vec2 cw0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 cw1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 cw2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 cw3 = f * f * (-0.5 + 0.5 * f);
  float wxs[4] = float[4](cw0.x, cw1.x, cw2.x, cw3.x);
  float wys[4] = float[4](cw0.y, cw1.y, cw2.y, cw3.y);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  vec4 m1 = vec4(0.0), m2 = vec4(0.0);
  float msum = 0.0;
  float dAcc = 0.0, dW = 0.0;
  vec4 mn = vec4(1e9), mx = vec4(-1e9);
  vec4 gm = vec4(0.0);
  float gw = 0.0;
  vec4 self = vec4(0.0, 0.0, 0.0, 1.0);
  float selfD = -1.0;
  for (int j = 0; j < 4; j++)
  for (int i = 0; i < 4; i++) {
    ivec2 Rj = clamp(ivec2(qb) + ivec2(i - 1, j - 1), ivec2(0), rmax);
    vec4 c = texelFetch(tCur, Rj, 0);
    vec4 a = texelFetch(tCurAux, Rj, 0);
    float wz = exp(-abs(a.w - z0) * 3.0);
    // depth-aware Catmull-Rom reconstruction
    float w = wxs[i] * wys[j] * (wz + 1e-4);
    acc += c * w;
    wsum += w;
    // statistics for the clip box and the sample's cross-bilateral filter: a Gaussian over the nearest samples
    vec2 dd = vec2(float(i - 1), float(j - 1)) - f;
    float wg = exp(-dot(dd, dd) * 0.9) * wz;
    vec3 y = toYCoCg(c.rgb);
    m1 += vec4(y, c.a) * wg;
    m2 += vec4(y * y, c.a * c.a) * wg;
    msum += wg;
    gm += c * wg; gw += wg;
    if (a.x > 0.0) { dAcc += a.x * wg; dW += wg; }
    if (i >= 1 && i <= 2 && j >= 1 && j <= 2 && wz > 0.3) { mn = min(mn, c); mx = max(mx, c); }
    if (i == 1 && j == 1) { self = c; selfD = a.x; }
  }
  vec4 spatial = abs(wsum) > 1e-5 ? acc / wsum : self;
  if (mn.x <= mx.x) spatial = clamp(spatial, mn, mx);
  spatial = vec4(max(spatial.rgb, vec3(0.0)), clamp(spatial.a, 0.0, 1.0));
  vec4 mean = msum > 1e-6 ? m1 / msum : vec4(toYCoCg(self.rgb), self.a);
  vec4 sigma = msum > 1e-6 ? sqrt(max(m2 / msum - mean * mean, vec4(0.0))) : vec4(0.0);
  float curLogD = marched && selfD > 0.0 ? selfD : (dW > 1e-6 ? dAcc / dW : -1.0);

  // reprojection: through the planet's body frame at this pixel's own cloud distance (the mid-shell where none)
  float tc = -1.0;
  if (curLogD > 0.0) tc = exp2(curLogD) - 1.0;
  else {
    float midR = 0.5 * (uShell.x + uShell.y);
    vec2 cm = raySphere(o, d, midR);
    if (cm.x <= cm.y && cm.y > 0.0) tc = r0 < midR ? cm.y : (cm.x > 0.0 ? cm.x : cm.y);
  }
  bool valid = uHistValid > 0.5 && tc > 0.0;
  vec2 puv = vec2(-1.0);
  vec3 X = o + d * max(tc, 0.0);
  if (valid) {
    vec4 pc = uPrevBodyToClip * vec4(X, 1.0);
    if (pc.w <= 0.0) valid = false;
    else {
      puv = pc.xy / pc.w * 0.5 + 0.5;
      if (puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) valid = false;
    }
  }
  vec4 outc;
  float n = 0.0;
  if (valid) {
    vec4 h = histCR(puv);
    vec4 ha = texelFetch(tHistAux, clamp(ivec2(puv * uFullRes), ivec2(0), Pmax), 0);
    // confidence: did the previous frame see a cloud at the distance this one expects there? (the per-pixel distance
    // estimate itself jitters by a few per cent: within ~6 % it is the same cloud)
    float conf = 1.0;
    if (ha.x > 0.0 && curLogD > 0.0) conf = 1.0 - smoothstep(0.08, 0.35, abs(ha.x - log2(length(X - uPrevCamBody) + 1.0)));
    else if ((ha.x > 0.0) != (curLogD > 0.0)) conf = 0.5;
    // variance clipping in YCoCg (mean ± 1.25σ of the depth-similar current samples)
    vec3 hy = toYCoCg(max(h.rgb, vec3(0.0)));
    vec4 hv = vec4(hy, clamp(h.a, 0.0, 1.0));
    vec4 ext = sigma * 1.25 + vec4(0.0015, 0.001, 0.001, 0.006);
    vec4 dlt = hv - mean;
    vec4 rr = abs(dlt) / max(ext, vec4(1e-5));
    float sc0 = max(max(rr.x, rr.y), max(rr.z, rr.w));
    if (sc0 > 1.0) hv = mean + dlt / sc0;
    h = vec4(max(fromYCoCg(hv.xyz), vec3(0.0)), hv.w);
    n = ha.y * conf;
    if (marched) {
      // a cross-bilateral filter on the new sample before it enters history: strong while the pixel has few samples
      // (a static view converges in a few visits instead of showing the jitter), light once history has built up
      vec4 sf = gw > 1e-6 ? mix(self, gm / gw, 0.45 - 0.3 * smoothstep(2.0, 8.0, n)) : self;
      n = min(n + 1.0, uMaxN);
      outc = mix(h, sf, 1.0 / n);
    } else {
      // pixels not marched this frame: history while it is trustworthy, else the spatial reconstruction
      outc = mix(spatial, h, clamp(n * 0.5, 0.0, 1.0));
    }
  } else {
    outc = marched ? self : spatial;
    n = marched ? 1.0 : 0.0;
  }
  oCol = vec4(max(outc.rgb, vec3(0.0)), clamp(outc.a, 0.0, 1.0));
  oAux = vec4(curLogD, n, 0.0, 0.0);
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
  /** world-frame direction to the moon and its illuminance at the planet (zero vector: no moonlight) */
  moonDir?: Vector3;
  moonE?: Vector3;
}

/**
 * a weather system for the cloud organisation: body-frame centre, radius (m), intensity 0..1, whether it has an eye,
 * its style (0 front / stratiform, 1 convective, 2 tropical cyclone) and body-frame velocity (the front trails behind)
 */
export interface CloudStorm { pos: ArrayLike<number>; radius: number; intensity: number; eye: boolean; style?: number; vel?: ArrayLike<number> }

const MAX_STORMS = 8;
/** Bayer-like visiting order of the k×k block offsets (k = 1..4) */
const ORDER: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[0, 0], [1, 1], [1, 0], [0, 1]],
  3: [[0, 0], [2, 1], [1, 2], [2, 0], [0, 1], [1, 0], [2, 2], [0, 2], [1, 1]],
  4: [[0, 0], [2, 2], [0, 2], [2, 0], [1, 1], [3, 3], [1, 3], [3, 1], [1, 0], [3, 2], [1, 2], [3, 0], [0, 1], [2, 3], [0, 3], [2, 1]],
};

const _o = new Vector3();
const _sunB = new Vector3();
const _zero = new Vector3();

function mrt(w: number, h: number, filter: typeof LinearFilter | typeof NearestFilter): WebGLRenderTarget {
  const t = new WebGLRenderTarget(w, h, { count: 2, type: HalfFloatType, format: RGBAFormat, depthBuffer: false, minFilter: filter, magFilter: filter });
  for (const tx of t.textures) { tx.wrapS = tx.wrapT = ClampToEdgeWrapping; tx.generateMipmaps = false; }
  // the aux target (cloud distance, sample count) is read texel-exact
  t.textures[1].minFilter = t.textures[1].magFilter = NearestFilter;
  return t;
}

function cubeTarget(n: number): WebGLCubeRenderTarget {
  const c = new WebGLCubeRenderTarget(n, { type: HalfFloatType, format: RGBAFormat, depthBuffer: false, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter });
  return c;
}

export class CloudPass {
  readonly material: ShaderMaterial;
  /** the resolved (temporally accumulated, full-resolution) clouds the atmosphere composite reads (textures[0]) */
  get target(): WebGLRenderTarget { return this.hist[this.histIdx]; }
  /** log2 cloud distance (+1) per pixel (x, < 0 where there is no cloud) and the accumulated sample count (y) */
  get aux(): Texture { return this.hist[this.histIdx].textures[1]; }
  /** interleave factor: one pixel of every k×k block is marched per frame */
  k = 2;
  /** debug view: 0 off, 1 first-hit distance, 2 transmittance, 3 samples taken */
  debugView = 0;
  private raw: WebGLRenderTarget;
  private hist: [WebGLRenderTarget, WebGLRenderTarget];
  private histIdx = 0;
  private histValid = false;
  private readonly resolveMat: ShaderMaterial;
  private readonly prevBodyToClip = new Matrix4();
  private readonly prevCamBody = new Vector3();
  private prevPlanet = -1;
  private fullW = 4;
  private fullH = 4;
  /** cirrus cover 0..1 (set with the weather) */
  private cirrus = 0.4;
  readonly noise: CloudNoise;
  /** the baked weather (organised coverage, storm, type, anvil) and cloud-shadow cubes */
  private wxRT: WebGLCubeRenderTarget;
  private shRT: WebGLCubeRenderTarget;
  private wxSize = 192;
  private readonly wxMat: ShaderMaterial;
  private readonly shMat: ShaderMaterial;
  private wxKey = '';
  private wxAge = 1e9;
  /** bakes since start (tests / dev HUD) */
  bakes = 0;
  /** shared with terrain / water / tree materials for cloud shadows */
  readonly shared: {
    uCloudBase: IUniform; uCloudDetail: IUniform; uCloudCurl: IUniform; uCloudWind: IUniform<Vector3>; uCloudScale: IUniform<Vector4>;
    uStorms: IUniform<Vector4[]>; uStormK: IUniform<Vector4[]>; uStormT: IUniform<Vector4[]>; uStormN: IUniform<number>; uGlobalBands: IUniform<number>;
    uCloudShadowMap: IUniform<Texture>; uCloudShadowK: IUniform<number>;
  };

  constructor() {
    this.noise = new CloudNoise();
    this.raw = mrt(4, 4, NearestFilter);
    this.hist = [mrt(4, 4, LinearFilter), mrt(4, 4, LinearFilter)];
    this.wxRT = cubeTarget(this.wxSize);
    this.shRT = cubeTarget(this.wxSize);
    this.shared = {
      uCloudBase: { value: this.noise.base.texture },
      uCloudDetail: { value: this.noise.detail.texture },
      uCloudCurl: { value: this.noise.curl.texture },
      uCloudWind: { value: new Vector3() },
      // base tile 1.2 km (heaps of 80–300 m, clustered by the weather mask), detail 54 m (a finer octave at 16 m near
      // the camera); dense cloud is optically thick (τ ≈ 16 through a 100 m heap): crisp edges, self-shadowed form
      uCloudScale: { value: new Vector4(1 / 1200, 1 / 54, 0.16, 0) },
      uStorms: { value: Array.from({ length: MAX_STORMS }, () => new Vector4()) },
      uStormK: { value: Array.from({ length: MAX_STORMS }, () => new Vector4()) },
      uStormT: { value: Array.from({ length: MAX_STORMS }, () => new Vector4()) },
      uStormN: { value: 0 },
      uGlobalBands: { value: 0 },
      uCloudShadowMap: { value: this.shRT.texture },
      uCloudShadowK: { value: 0.0078 },
    };
    const field = {
      uCloudBase: this.shared.uCloudBase, uCloudDetail: this.shared.uCloudDetail, uCloudCurl: this.shared.uCloudCurl,
      uCloudWind: this.shared.uCloudWind, uCloudScale: this.shared.uCloudScale, uStorms: this.shared.uStorms,
      uStormK: this.shared.uStormK, uStormT: this.shared.uStormT, uStormN: this.shared.uStormN, uGlobalBands: this.shared.uGlobalBands,
    };
    this.wxMat = passMaterial(WX_FRAG, { ...field, uCoverage: { value: null }, uFace: { value: 0 }, uSize: { value: this.wxSize }, uMidR: { value: 3300 } });
    this.shMat = passMaterial(SHADOW_FRAG, {
      ...field, uCloudWx: { value: this.wxRT.texture }, uFace: { value: 0 }, uSize: { value: this.wxSize },
      uShell: { value: new Vector2(3180, 3420) }, uPenumbra: { value: 14 },
    });
    this.material = passMaterial(CLOUD_FRAG, {
      ...field,
      tDepth: { value: null }, uCloudWx: { value: this.wxRT.texture }, tBlue: { value: blueNoiseTexture() },
      uInvProj: { value: new Matrix4() }, uCamRot: { value: new Matrix3() },
      uWorldToBody: { value: new Matrix3() }, uFar: { value: 2e7 }, uPlanetPos: { value: new Vector3() },
      uSunDir: { value: new Vector3(1, 0, 0) }, uShell: { value: new Vector2(3180, 3420) }, uSteps: { value: 48 },
      uLightSteps: { value: 5 }, uFrame: { value: 0 }, uCloudBright: { value: 1.9 }, uNearR: { value: 35 }, uCamFog: { value: 0 },
      uInsideAir: { value: 1 }, uCamMuS: { value: 1 }, uFullRes: { value: new Vector2(4, 4) }, uOffset: { value: new Vector2() }, uK: { value: 2 },
      uPixelAngle: { value: 0.001 }, uNearDetail: { value: 1 }, uCirrus: { value: 0.4 }, uCirrusR: { value: 3528 },
      uMoonDir: { value: new Vector3(0, 1, 0) }, uMoonE: { value: new Vector3() }, uDebugView: { value: 0 },
      uRg: { value: 0 }, uRt: { value: 0 }, uBetaR: { value: new Vector3() }, uHR: { value: 1 }, uBetaMs: { value: new Vector3() },
      uBetaMe: { value: new Vector3() }, uHM: { value: 1 }, uMieG: { value: 0.8 }, uBetaO: { value: new Vector3() },
      uOzone: { value: new Vector2(1, 1) }, uSunE: { value: new Vector3() }, uHasAtmo: { value: 1 },
      uTransLUT: { value: null }, uMsLUT: { value: null }, uSkyLUT: { value: null }, uIrrSH: { value: null },
    });
    this.material.glslVersion = GLSL3;
    this.resolveMat = passMaterial(RESOLVE_FRAG, {
      tCur: { value: null }, tCurAux: { value: null }, tHist: { value: null }, tHistAux: { value: null }, tDepth: { value: null },
      uFullRes: { value: new Vector2(4, 4) }, uRawRes: { value: new Vector2(2, 2) }, uOffset: { value: new Vector2() }, uK: { value: 2 },
      uHistValid: { value: 0 }, uMaxN: { value: 12 }, uInvProj: { value: new Matrix4() }, uCamRot: { value: new Matrix3() },
      uWorldToBody: { value: new Matrix3() }, uPlanetPos: { value: new Vector3() }, uPrevCamBody: { value: new Vector3() },
      uShell: { value: new Vector2(3180, 3420) }, uCirrusR: { value: 3528 }, uFar: { value: 2e7 },
      uPrevBodyToClip: { value: new Matrix4() }, uRg: { value: 0 }, uRt: { value: 0 },
    });
    this.resolveMat.glslVersion = GLSL3;
  }

  /** w × h: the render resolution; scale: the preset's cloud buffer scale (k = round(1 / scale), 1..4) */
  setSize(w: number, h: number, scale = 0.5): void {
    const k = Math.max(1, Math.min(4, Math.round(1 / Math.max(0.2, scale))));
    const rw = Math.max(1, Math.ceil(w / k)), rh = Math.max(1, Math.ceil(h / k));
    if (this.fullW !== w || this.fullH !== h || this.k !== k) {
      this.k = k;
      this.fullW = w; this.fullH = h;
      this.raw.setSize(rw, rh);
      this.hist[0].setSize(w, h);
      this.hist[1].setSize(w, h);
      this.histValid = false;
    }
  }

  /** weather / shadow cube resolution per face (by preset) */
  setWeatherRes(n: number): void {
    n = Math.max(32, Math.min(512, Math.round(n)));
    if (n === this.wxSize) return;
    this.wxSize = n;
    this.wxRT.dispose(); this.shRT.dispose();
    this.wxRT = cubeTarget(n);
    this.shRT = cubeTarget(n);
    this.shared.uCloudShadowMap.value = this.shRT.texture;
    this.shMat.uniforms.uCloudWx.value = this.wxRT.texture;
    this.material.uniforms.uCloudWx.value = this.wxRT.texture;
    this.wxKey = '';
  }

  /** forget the accumulated history (camera cut) */
  resetHistory(): void {
    this.histValid = false;
  }

  /**
   * the weather systems of the cloud planet (body frame), whether a planet-wide weather override is active and the
   * cirrus cover (0..1, from the planet's cloudiness)
   */
  setWeather(storms: CloudStorm[], planetRadius: number, globalBands: number, cirrus = 0.4): void {
    const S = this.shared.uStorms.value, K = this.shared.uStormK.value, Tt = this.shared.uStormT.value;
    let n = 0;
    for (const w of storms) {
      if (n >= MAX_STORMS) break;
      if (!(w.intensity > 0.02) || !(w.radius > 0)) continue;
      const ang = w.radius / planetRadius;
      const l = Math.hypot(w.pos[0], w.pos[1], w.pos[2]) || 1;
      const px = w.pos[0] / l, py = w.pos[1] / l, pz = w.pos[2] / l;
      S[n].set(px, py, pz, ang);
      const style = w.style ?? (w.eye ? 2 : 0);
      // fronts reach 2.6 radii behind their system, the others ~1.35
      const reach = style === 0 ? 2.6 : 1.35;
      // counter-clockwise (seen from above) in the north, clockwise in the south
      K[n].set(Math.min(1, w.intensity), py >= 0 ? 1 : -1, style, Math.cos(Math.min(Math.PI, ang * reach)));
      // trailing direction: against the motion; a still system trails toward the equator and west
      let tx = 0, ty = 0, tz = 0;
      const v = w.vel;
      if (v && Math.hypot(v[0], v[1], v[2]) > 1e-9) { tx = -v[0]; ty = -v[1]; tz = -v[2]; }
      else { tx = -pz; ty = py >= 0 ? -0.6 : 0.6; tz = px; }
      const tl = Math.hypot(tx, ty, tz) || 1;
      Tt[n].set(tx / tl, ty / tl, tz / tl, 0);
      n++;
    }
    this.shared.uStormN.value = n;
    this.shared.uGlobalBands.value = globalBands;
    this.cirrus = Math.max(0, Math.min(1, cirrus));
  }

  bind(model: AtmosphereModel, coverage: Texture): void {
    const u = this.material.uniforms;
    const m = model.uniforms as unknown as Record<string, IUniform>;
    for (const k of Object.keys(m)) u[k] = m[k];
    this.wxMat.uniforms.uCoverage.value = coverage;
    this.resolveMat.uniforms.uRg = m.uRg;
    this.resolveMat.uniforms.uRt = m.uRt;
  }

  /**
   * Re-bake the organised weather and cloud-shadow cubes of the cloud planet when its weather changed (coverage
   * texture version, systems, planet-wide override, shell) — at most every `minFrames` frames unless forced (cuts).
   * Call after bind() and setWeather(), before the scene renders (materials read the shadow cube).
   */
  bake(renderer: WebGLRenderer, fsq: FullscreenQuad, coverage: Texture, innerR: number, outerR: number, force = false, minFrames = 4): boolean {
    this.noise.build(renderer, fsq);
    const S = this.shared.uStorms.value, K = this.shared.uStormK.value;
    let key = `${coverage.uuid}:${coverage.version}|${this.shared.uStormN.value}|${this.shared.uGlobalBands.value}|${innerR.toFixed(1)}|${outerR.toFixed(1)}|${this.wxSize}`;
    for (let i = 0; i < this.shared.uStormN.value; i++) key += `|${S[i].x.toFixed(4)},${S[i].y.toFixed(4)},${S[i].z.toFixed(4)},${S[i].w.toFixed(4)},${K[i].x.toFixed(3)},${K[i].z}`;
    // (UI lane, additive) the coverage bias (uCloudScale.w — the map overlays thin the clouds with it) re-bakes too
    key += `|cb${this.shared.uCloudScale.value.w.toFixed(2)}`;
    this.wxAge++;
    if (key === this.wxKey) return false;
    if (!force && this.wxKey !== '' && this.wxAge < minFrames) return false;
    this.wxKey = key;
    this.wxAge = 0;
    this.bakes++;
    const prev = renderer.getRenderTarget();
    const thick = outerR - innerR;
    const w = this.wxMat.uniforms;
    w.uCoverage.value = coverage;
    w.uSize.value = this.wxSize;
    w.uMidR.value = 0.5 * (innerR + outerR);
    for (let f = 0; f < 6; f++) { w.uFace.value = f; fsq.render(renderer, this.wxMat, this.wxRT, f); }
    const s = this.shMat.uniforms;
    s.uSize.value = this.wxSize;
    (s.uShell.value as Vector2).set(innerR, outerR);
    // penumbra: the sun's ~0.5° disc over the ~300 m to the deck, plus a share of the deck's own thickness
    s.uPenumbra.value = 300 * 0.0093 + thick * 0.05;
    for (let f = 0; f < 6; f++) { s.uFace.value = f; fsq.render(renderer, this.shMat, this.shRT, f); }
    // callers integrate the returned density over ~0.4 of the shell: a dense column keeps ~47 % of the sun
    this.shared.uCloudShadowK.value = 0.75 / Math.max(1, 0.4 * thick);
    renderer.setRenderTarget(prev);
    return true;
  }

  render(renderer: WebGLRenderer, fsq: FullscreenQuad, i: CloudInputs, steps: number, lightSteps: number): void {
    this.noise.build(renderer, fsq);
    const u = this.material.uniforms;
    const k = this.k;
    const order = ORDER[k] ?? ORDER[2];
    const off = order[i.frame % order.length];
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
    u.uFrame.value = i.frame % 576;
    u.uFullRes.value.set(this.fullW, this.fullH);
    u.uOffset.value.set(off[0], off[1]);
    u.uK.value = k;
    u.uDebugView.value = this.debugView;
    // projection: invProj[1][1] = tan(fov / 2)
    u.uPixelAngle.value = (2 * i.invProj.elements[5]) / Math.max(1, this.fullH);
    u.uNearDetail.value = steps >= 40 ? 1 : 0;
    const rg = (u.uRg.value as number) || i.radius;
    const rt = (u.uRt.value as number) || i.outerR + 180;
    const cirrusR = rg + (rt - rg) * 0.88;
    u.uCirrusR.value = cirrusR;
    u.uCirrus.value = this.cirrus;
    // the camera in the body frame: in-cloud fog when it is inside the shell, its own sun elevation
    _o.copy(i.planetPos).negate().applyMatrix3(i.worldToBody);
    const r0 = _o.length();
    _sunB.copy(i.sunDir).applyMatrix3(i.worldToBody).normalize();
    u.uCamMuS.value = r0 > 0 ? _o.dot(_sunB) / r0 : 1;
    const edge = 20;
    u.uCamFog.value = Math.min(1, Math.max(0, (r0 - i.innerR + edge) / edge)) * Math.min(1, Math.max(0, (i.outerR + edge - r0) / edge));
    u.uNearR.value = 35;
    // the air's thickness from the shell (which spans 30–70 % of it): inside the air below ~1 thickness, space above 2
    const hi = i.outerR - i.radius;
    const thickAir = hi / 0.7;
    u.uInsideAir.value = 1 - Math.min(1, Math.max(0, (i.altitude - thickAir) / thickAir));
    (u.uMoonDir.value as Vector3).copy(i.moonDir ?? _zero);
    (u.uMoonE.value as Vector3).copy(i.moonE ?? _zero);
    fsq.render(renderer, this.material, this.raw);
    // temporal resolve into the other history buffer (full resolution)
    if (i.planetId !== this.prevPlanet) this.histValid = false;
    const r = this.resolveMat.uniforms;
    const prev = this.hist[this.histIdx];
    const next = this.hist[this.histIdx ^ 1];
    r.tCur.value = this.raw.textures[0];
    r.tCurAux.value = this.raw.textures[1];
    r.tHist.value = prev.textures[0];
    r.tHistAux.value = prev.textures[1];
    r.tDepth.value = i.depth;
    r.uFullRes.value.set(this.fullW, this.fullH);
    r.uRawRes.value.set(this.raw.width, this.raw.height);
    r.uOffset.value.set(off[0], off[1]);
    r.uK.value = k;
    r.uHistValid.value = this.histValid ? 1 : 0;
    // samples per pixel the history may hold while reprojection holds (k = 1 marches every pixel every frame)
    r.uMaxN.value = k === 1 ? 8 : 12;
    r.uInvProj.value.copy(i.invProj);
    r.uCamRot.value.copy(i.camRot);
    r.uWorldToBody.value.copy(i.worldToBody);
    r.uPlanetPos.value.copy(i.planetPos);
    (r.uPrevCamBody.value as Vector3).copy(this.prevCamBody);
    r.uShell.value.set(i.innerR, i.outerR);
    r.uCirrusR.value = cirrusR;
    r.uFar.value = i.far;
    r.uPrevBodyToClip.value.copy(this.prevBodyToClip);
    fsq.render(renderer, this.resolveMat, next);
    this.histIdx ^= 1;
    this.histValid = true;
    this.prevPlanet = i.planetId;
    this.prevBodyToClip.copy(i.bodyToClip);
    this.prevCamBody.copy(_o);
  }

  dispose(): void {
    this.raw.dispose(); this.hist[0].dispose(); this.hist[1].dispose();
    this.wxRT.dispose(); this.shRT.dispose();
    this.material.dispose(); this.resolveMat.dispose(); this.wxMat.dispose(); this.shMat.dispose();
  }
}
