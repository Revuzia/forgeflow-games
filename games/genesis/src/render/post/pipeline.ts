// GENESIS — the HDR post chain (CONTRACT.md §15.2). No EffectComposer: every pass is a full-screen shader over our
// own targets, in this order (the atmosphere composite is driven by the Renderer between 3 and 4):
//   1. scene → `hdr` (RGBA16F, MSAA by quality, float depth texture holding three's logarithmic depth)
//   2. copy → `sceneCopy` (colour, for water refraction) + `linDepth` (R32F view depth, for water thickness)
//   3. water → `hdr` again (depth-tested, reads the copies)
//   4. clouds (reduced res) + atmosphere composite → `atmoOut`
//   5. god rays: sky/sun occlusion mask (¼ res) → three radial blur passes toward the sun
//   6. bloom: 13-tap Karis-weighted downsample mip chain + tent upsample (Jimenez 2014), mixed at a few percent
//   7. auto exposure: luminance reduction to 1×1 (lit pixels only, so black space never blows out a planet) + temporal
//      adaptation in a 1×1 ping-pong
//   8. tone map: exposure → lens flare ghosts/halo/starburst gated by sun visibility (squared; no rings over an
//      occluder) → AgX (Blender's, log range −12.5..+2.8 EV) with a power look → gamut- and hue-limited saturation →
//      toe → lift-gamma-gain → split-tone grade (warm highlights / cool shadows; golden hour; moonlit night) →
//      vignette → sRGB → `ldr`
//   9. FXAA 3.11 + subtle animated film grain → screen

import {
  DepthTexture, FloatType, HalfFloatType, LinearFilter, NearestFilter, RGBAFormat, RedFormat, RGFormat, ShaderMaterial,
  UnsignedByteType, Vector2, Vector3, WebGLRenderTarget, AdditiveBlending, type Texture, type WebGLRenderer,
  type TextureDataType, type PixelFormat, type MagnificationTextureFilter,
} from 'three';
import { FullscreenQuad, passMaterial } from './fsquad.ts';
import { LOGDEPTH_DECODE } from '../shaders/atmosphere.glsl.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';

function rt(w: number, h: number, type: TextureDataType = HalfFloatType, format: PixelFormat = RGBAFormat, filter: MagnificationTextureFilter = LinearFilter): WebGLRenderTarget {
  return new WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type, format, minFilter: filter, magFilter: filter, depthBuffer: false, generateMipmaps: false,
  });
}

// ───────────────────────────── shaders ─────────────────────────────

const COPY_FRAG = /* glsl */ `
// one NaN / Inf pixel (a degenerate normal on the horizon) must never bloom into a screen-wide glare: drop it
vec3 sane(vec3 c) { return (any(isnan(c)) || any(isinf(c)) || !(dot(c, c) < 1e18)) ? vec3(0.0) : c; }
${LOGDEPTH_DECODE}
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform float uFar;
uniform float uMode;
void main() {
  if (uMode < 0.5) { gl_FragColor = vec4(sane(texture(tColor, vUv).rgb), 1.0); return; }
  float d = texture(tDepth, vUv).r;
  gl_FragColor = vec4(d >= 0.999999 ? 1e9 : viewZFromLogDepth(d, uFar), 0.0, 0.0, 1.0);
}
`;

const GOD_MASK_FRAG = /* glsl */ `
// one NaN / Inf pixel (a degenerate normal on the horizon) must never bloom into a screen-wide glare: drop it
vec3 sane(vec3 c) { return (any(isnan(c)) || any(isinf(c)) || !(dot(c, c) < 1e18)) ? vec3(0.0) : c; }
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uSunUV;
uniform float uAspect;
void main() {
  // sky pixels only (terrain and near geometry occlude); weight toward the sun so only it casts shafts
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 o = (vec2(float(i), float(j)) - 0.5) * 0.5 / vec2(textureSize(tColor, 0)) * 4.0;
    float d = texture(tDepth, vUv + o).r;
    vec3 c = sane(texture(tColor, vUv + o).rgb);
    acc += d >= 0.999999 ? c : vec3(0.0);
  }
  acc *= 0.25;
  vec2 dv = (vUv - uSunUV) * vec2(uAspect, 1.0);
  float w = exp(-dot(dv, dv) * 26.0);
  float l = dot(acc, vec3(0.2126, 0.7152, 0.0722));
  vec3 c = acc * smoothstep(0.0, 1.0, l) / max(l, 1e-4);
  gl_FragColor = vec4(min(c * w, vec3(60.0)), 1.0);
}
`;

const GOD_BLUR_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tIn;
uniform vec2 uSunUV;
uniform float uSpread;
uniform float uJitter;
void main() {
  vec2 dir = (uSunUV - vUv) * uSpread / 12.0;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  vec2 uv = vUv + dir * fract(uJitter + dot(gl_FragCoord.xy, vec2(0.0671, 0.0058)) * 52.98);
  for (int i = 0; i < 12; i++) {
    float w = 1.0 - float(i) / 14.0;
    acc += texture(tIn, uv).rgb * w;
    wsum += w;
    uv += dir;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}
`;

const BLOOM_DOWN_FRAG = /* glsl */ `
// one NaN / Inf pixel (a degenerate normal on the horizon) must never bloom into a screen-wide glare: drop it
vec3 sane(vec3 c) { return (any(isnan(c)) || any(isinf(c)) || !(dot(c, c) < 1e18)) ? vec3(0.0) : c; }
varying vec2 vUv;
uniform sampler2D tIn;
uniform vec2 uTexel;
uniform float uKaris;
void main() {
  vec2 t = uTexel;
  vec3 a = texture(tIn, vUv + t * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture(tIn, vUv + t * vec2(0.0, 2.0)).rgb;
  vec3 c = texture(tIn, vUv + t * vec2(2.0, 2.0)).rgb;
  vec3 d = texture(tIn, vUv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture(tIn, vUv).rgb;
  vec3 f = texture(tIn, vUv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture(tIn, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture(tIn, vUv + t * vec2(0.0, -2.0)).rgb;
  vec3 i = texture(tIn, vUv + t * vec2(2.0, -2.0)).rgb;
  vec3 j = texture(tIn, vUv + t * vec2(-1.0, 1.0)).rgb;
  vec3 kk = texture(tIn, vUv + t * vec2(1.0, 1.0)).rgb;
  vec3 l = texture(tIn, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture(tIn, vUv + t * vec2(1.0, -1.0)).rgb;
  vec3 res;
  if (uKaris > 0.5) {
    // Karis average of the five 13-tap groups: fireflies (sun, glints) cannot dominate a whole bloom level
    vec3 g0 = (j + kk + l + m) * 0.25;
    vec3 g1 = (a + b + d + e) * 0.25;
    vec3 g2 = (b + c + e + f) * 0.25;
    vec3 g3 = (d + e + g + h) * 0.25;
    vec3 g4 = (e + f + h + i) * 0.25;
    float w0 = 0.5 / (1.0 + dot(g0, vec3(0.2126, 0.7152, 0.0722)));
    float w1 = 0.125 / (1.0 + dot(g1, vec3(0.2126, 0.7152, 0.0722)));
    float w2 = 0.125 / (1.0 + dot(g2, vec3(0.2126, 0.7152, 0.0722)));
    float w3 = 0.125 / (1.0 + dot(g3, vec3(0.2126, 0.7152, 0.0722)));
    float w4 = 0.125 / (1.0 + dot(g4, vec3(0.2126, 0.7152, 0.0722)));
    res = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    res = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + kk + l + m) * 0.125;
  }
  gl_FragColor = vec4(min(sane(res), vec3(30000.0)), 1.0);
}
`;

const BLOOM_UP_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tIn;
uniform vec2 uTexel;
uniform float uRadius;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = texture(tIn, vUv).rgb * 4.0;
  s += (texture(tIn, vUv + vec2(-t.x, 0.0)).rgb + texture(tIn, vUv + vec2(t.x, 0.0)).rgb + texture(tIn, vUv + vec2(0.0, -t.y)).rgb + texture(tIn, vUv + vec2(0.0, t.y)).rgb) * 2.0;
  s += texture(tIn, vUv + vec2(-t.x, -t.y)).rgb + texture(tIn, vUv + vec2(t.x, -t.y)).rgb + texture(tIn, vUv + vec2(-t.x, t.y)).rgb + texture(tIn, vUv + vec2(t.x, t.y)).rgb;
  gl_FragColor = vec4(s / 16.0, 1.0);
}
`;

const LUM_FRAG = /* glsl */ `
// one NaN / Inf pixel (a degenerate normal on the horizon) must never bloom into a screen-wide glare: drop it
vec3 sane(vec3 c) { return (any(isnan(c)) || any(isinf(c)) || !(dot(c, c) < 1e18)) ? vec3(0.0) : c; }
varying vec2 vUv;
uniform sampler2D tIn;
uniform vec2 uSrcTexel;
uniform float uFirst;
uniform float uLumFloor;   // luminance below which a pixel does not count (stars, faint sky glow; lower at night)
void main() {
  vec2 acc = vec2(0.0);
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec2 uv = vUv + (vec2(float(i), float(j)) - 1.5) * uSrcTexel;
    if (uFirst > 0.5) {
      vec3 c = sane(texture(tIn, uv).rgb);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // centre-weighted, lit pixels only (empty space does not count)
      vec2 cw = uv - 0.5;
      // lit surfaces only: stars and faint sky glow (below the floor: ~0.004 by day, moonlit ground at night) never
      // drag the exposure up
      float w = smoothstep(uLumFloor, uLumFloor * 10.0, l) * (1.0 - dot(cw, cw) * 1.2);
      acc += vec2(log2(max(l, 1e-6)) * w, w);
    } else {
      acc += texture(tIn, uv).rg;
    }
  }
  gl_FragColor = vec4(acc / 16.0, 0.0, 1.0);
}
`;

const ADAPT_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tLum;
uniform sampler2D tPrev;
uniform float uDt;
uniform float uCut;
uniform float uKey;
uniform vec2 uRange;
void main() {
  vec2 s = texture(tLum, vec2(0.5)).rg;
  float avgLog = s.y > 1e-5 ? s.x / s.y : log2(0.02);
  float target = clamp(uKey / exp2(avgLog), uRange.x, uRange.y);
  float prev = texture(tPrev, vec2(0.5)).r;
  float rate = target < prev ? 2.2 : 1.1;
  float e = (uCut > 0.5 || prev <= 0.0) ? target : exp(mix(log(prev), log(target), 1.0 - exp(-uDt * rate)));
  gl_FragColor = vec4(e, target, 0.0, 1.0);
}
`;

const TONEMAP_FRAG = /* glsl */ `
// one NaN / Inf pixel (a degenerate normal on the horizon) must never bloom into a screen-wide glare: drop it
vec3 sane(vec3 c) { return (any(isnan(c)) || any(isinf(c)) || !(dot(c, c) < 1e18)) ? vec3(0.0) : c; }
${NOISE_GLSL}
varying vec2 vUv;
uniform sampler2D tHDR;
uniform sampler2D tBloom;
uniform sampler2D tGod;
uniform sampler2D tExposure;
uniform sampler2D tMask;
uniform float uBloom;
uniform float uBloomNorm;  // 1 / number of bloom levels: the additive upsample chain SUMS every level
uniform float uGod;
uniform vec3 uGodColor;
uniform vec2 uSunUV;
uniform float uSunOn;
uniform vec3 uSunColor;
uniform float uFlare;
uniform float uAspect;
uniform float uExposureBias;
uniform float uManualExposure;
uniform float uStarExposure;  // exposure that puts a close star's disc in range (limb darkening, granulation visible)
uniform float uStarMix;       // 0..1: how much of the frame the star's disc fills
uniform float uVignette;
uniform vec3 uWhite;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uSat;
uniform float uPower;
uniform float uGolden;   // 0..1: how low the sun is at the camera (golden hour / sunset grade)
uniform float uGrade;    // 0..1: everyday split-tone strength (warm highlights, cool shadows)
uniform float uNight;    // 0..1: night grade (moonlit blue shadows)
uniform float uToe;      // display-linear toe: the darkest shadows fall to true black

// AgX (Sobotka), as in Blender / three.js r16x: Rec.2020 working space, sigmoid in log2 space
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
const mat3 AgXInset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
const mat3 AgXOutset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
const float AgxMinEv = -12.47393;
// (Blender's 4.03 left diffuse white at 184/255 once the look's power was applied: 2.4 puts it at ~224 and scene 2.0
// at ~241 — sunlit cloud tops and snow reach the 230s, highlights still roll off, mid-tones are not pulled down)
const float AgxMaxEv = 2.4;
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 c) {
  c = LINEAR_SRGB_TO_LINEAR_REC2020 * c;
  c = AgXInset * c;
  c = max(c, 1e-10);
  c = clamp(log2(c), AgxMinEv, AgxMaxEv);
  c = (c - AgxMinEv) / (AgxMaxEv - AgxMinEv);
  c = agxContrast(c);
  // look: power (contrast) in AgX log space; saturation is applied after the curve, gamut-aware (see vibrance)
  c = pow(max(c, 0.0), vec3(uPower));
  c = AgXOutset * c;
  c = pow(max(vec3(0.0), c), vec3(2.2));
  c = LINEAR_REC2020_TO_LINEAR_SRGB * c;
  return clamp(c, 0.0, 1.0);
}
// saturation in display-linear sRGB, limited per pixel so no channel is pushed below a floor of its luminance or
// above 1 (no hue clipping: a sky's red channel or foliage's blue never hit 0), and half as strong on greens
// (70–160°) and sky blues (190–245°), which the curve already renders rich
vec3 vibrance(vec3 c, float s) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  if (mx - mn < 1e-5 || l <= 1e-6) return c;
  float h;
  if (mx == c.r) h = mod((c.g - c.b) / (mx - mn), 6.0);
  else if (mx == c.g) h = (c.b - c.r) / (mx - mn) + 2.0;
  else h = (c.r - c.g) / (mx - mn) + 4.0;
  h *= 60.0;
  float prot = max(smoothstep(55.0, 80.0, h) * (1.0 - smoothstep(150.0, 175.0, h)), smoothstep(180.0, 200.0, h) * (1.0 - smoothstep(240.0, 260.0, h)));
  s = mix(s, 1.0 + (s - 1.0) * 0.5, prot);
  // the largest saturation that keeps every channel inside [0.06 l, 1]
  vec3 lo3 = l * 0.94 / max(vec3(l) - c, vec3(1e-5));
  vec3 hi3 = (1.0 - l) / max(c - vec3(l), vec3(1e-5));
  vec3 lim = mix(hi3, lo3, step(c, vec3(l)));
  s = min(s, max(min(lim.r, min(lim.g, lim.b)), 1.0));
  c = l + s * (c - l);
  // gamut ceiling: no channel below 2.5 % of the brightest (≈ 0.85 saturation once encoded to sRGB) — backlit leaves
  // and deep sky keep their hue instead of clipping a channel to 0
  float cmx = max(c.r, max(c.g, c.b)), cmn = min(c.r, min(c.g, c.b));
  float den = cmx - cmn - 0.975 * (cmx - l);
  if (den > 1e-6) c = l + min(1.0, 0.975 * l / den) * (c - l);
  return max(c, 0.0);
}
vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float sunVisibility() {
  vec2 t = 1.0 / vec2(textureSize(tMask, 0));
  float v = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 uv = uSunUV + vec2(float(i), float(j)) * t * 1.5;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    v += step(1e-3, dot(texture(tMask, uv).rgb, vec3(1.0))) * inside;
  }
  return v / 25.0;
}

vec3 lensFlare(vec2 uv, float vis) {
  if (vis <= 0.0) return vec3(0.0);
  // a sun half hidden by foliage or a ridge must not paint ghosts and rings over the occluder
  float ringK = smoothstep(0.75, 0.95, vis);
  vis *= vis;
  vec3 f = vec3(0.0);
  vec2 axis = vec2(0.5) - uSunUV;
  // ghosts along the axis through the centre, chromatic tints, soft discs and rings
  for (int i = 0; i < 6; i++) {
    if (ringK <= 0.0) break;
    float fi = float(i);
    float k = 0.35 + fi * 0.33 - (i > 3 ? 1.25 : 0.0);
    vec2 c = uSunUV + axis * 2.0 * k;
    vec2 d = (uv - c) * vec2(uAspect, 1.0);
    float r = 0.025 + 0.03 * fract(fi * 0.618 + 0.2);
    float disc = smoothstep(r, r * 0.6, length(d));
    float ring = smoothstep(r * 0.15, 0.0, abs(length(d) - r)) * 0.5;
    vec3 tint = 0.5 + 0.5 * cos(6.2831 * (fi * 0.17 + vec3(0.0, 0.33, 0.67)));
    f += (disc * 0.5 + ring) * tint * (0.008 + 0.004 * fi) * ringK;
  }
  // faint chromatic halo ring around the sun
  vec2 ds = (uv - uSunUV) * vec2(uAspect, 1.0);
  float dl = length(ds);
  float ring = smoothstep(0.022, 0.0, abs(dl - 0.36));
  f += (vec3(0.55, 0.75, 1.0) * ring * 0.012 + vec3(1.0, 0.7, 0.5) * smoothstep(0.02, 0.0, abs(dl - 0.38)) * 0.006) * ringK;
  // starburst: fine diffraction streaks close to the disc only
  float ang = atan(ds.y, ds.x);
  float burst = pow(abs(snoise(vec3(ang * 5.0, 0.0, 1.7))), 4.0) + 0.6 * pow(max(cos(ang * 3.0), 0.0), 120.0);
  f += vec3(1.0, 0.94, 0.85) * burst * exp(-dl * 26.0) * 0.18;
  f += vec3(1.0, 0.9, 0.75) * exp(-dl * 40.0) * 0.35;
  return f * uSunColor * vis;
}

void main() {
  vec3 c = sane(texture(tHDR, vUv).rgb);
  vec3 b = sane(texture(tBloom, vUv).rgb);
  // (the upsample chain sums ~7 levels: unnormalised, a 4.5 % mix laid a 30 % veil of blur over every frame)
  c = mix(c, b * uBloomNorm, uBloom);
  c += texture(tGod, vUv).rgb * uGod * uGodColor;
  float ex = uManualExposure > 0.0 ? uManualExposure : mix(texture(tExposure, vec2(0.5)).r, uStarExposure, uStarMix);
  c *= ex * exp2(uExposureBias);
  if (uSunOn > 0.5) c += lensFlare(vUv, sunVisibility()) * uFlare;
  c *= uWhite;
  // golden hour: warm the light before the tone curve (so highlights roll off to gold, not white)
  c *= mix(vec3(1.0), vec3(1.28, 0.95, 0.68), uGolden);
  c = agx(c);
  c = vibrance(c, uSat);
  // toe: c²(1+t)/(c+t) takes the very deepest shadows to true black (space) and leaves the rest alone; lifted at golden
  // hour (backlit foliage and the shadow side of a sunset keep their colour instead of crushing) and at night (moonlit
  // ground lives in the bottom of the curve)
  float toe = uToe * (1.0 - 0.75 * uGolden) * (1.0 - 0.8 * uNight);
  c = c * c * (1.0 + toe) / (c + toe);
  // lift / gamma / gain grade in display-linear
  c = pow(max(c * uGain + uLift * (1.0 - c), 0.0), 1.0 / uGamma);
  // ... then split-tone: shadows a little cooler, highlights warmer — subtle by day, strong at golden hour; at night
  // the shadows go moonlit blue
  {
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 tone = mix(vec3(0.9, 0.93, 1.1), vec3(1.1, 0.98, 0.84), smoothstep(0.04, 0.55, lum));
    c = mix(c, c * tone, max(uGolden, uGrade));
    c = mix(c, c * vec3(0.84, 0.95, 1.18), uNight * (1.0 - smoothstep(0.08, 0.45, lum)));
    lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // (night takes colour out of the moonlit dark only: lights — fire, hearths, windows, lamps — keep theirs; desaturated
    // whole, a burning village at night turned salmon-cream and the lit windows beige)
    c = max(mix(vec3(lum), c, 1.0 + 0.28 * uGolden - 0.2 * uNight * (1.0 - smoothstep(0.1, 0.4, lum))), 0.0);
  }
  vec2 vc = vUv - 0.5;
  float vig = 1.0 - uVignette * smoothstep(0.25, 0.95, dot(vc * vec2(uAspect, 1.0), vc * vec2(uAspect, 1.0)) * 1.4);
  c *= vig;
  gl_FragColor = vec4(toSRGB(c), 1.0);
}
`;

// FXAA 3.11 (Lottes), quality preset ~12, on sRGB values with luma in alpha-free form; grain after AA
const FXAA_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tIn;
uniform vec2 uTexel;
uniform float uFxaa;
uniform float uGrain;
uniform float uTime;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 fxaa(vec2 uv) {
  vec3 rgbM = texture(tIn, uv).rgb;
  float lM = luma(rgbM);
  float lN = luma(texture(tIn, uv + vec2(0.0, uTexel.y)).rgb);
  float lS = luma(texture(tIn, uv - vec2(0.0, uTexel.y)).rgb);
  float lE = luma(texture(tIn, uv + vec2(uTexel.x, 0.0)).rgb);
  float lW = luma(texture(tIn, uv - vec2(uTexel.x, 0.0)).rgb);
  float lMin = min(lM, min(min(lN, lS), min(lE, lW)));
  float lMax = max(lM, max(max(lN, lS), max(lE, lW)));
  float range = lMax - lMin;
  if (range < max(0.0312, lMax * 0.125)) return rgbM;
  float lNW = luma(texture(tIn, uv + vec2(-uTexel.x, uTexel.y)).rgb);
  float lNE = luma(texture(tIn, uv + uTexel).rgb);
  float lSW = luma(texture(tIn, uv - uTexel).rgb);
  float lSE = luma(texture(tIn, uv + vec2(uTexel.x, -uTexel.y)).rgb);
  float edgeH = abs(-2.0 * lW + lNW + lSW) + abs(-2.0 * lM + lN + lS) * 2.0 + abs(-2.0 * lE + lNE + lSE);
  float edgeV = abs(-2.0 * lS + lSW + lSE) + abs(-2.0 * lM + lW + lE) * 2.0 + abs(-2.0 * lN + lNW + lNE);
  bool horz = edgeH >= edgeV;
  float l1 = horz ? lS : lW;
  float l2 = horz ? lN : lE;
  float g1 = l1 - lM, g2 = l2 - lM;
  bool steep1 = abs(g1) >= abs(g2);
  float gScaled = 0.25 * max(abs(g1), abs(g2));
  float stepLen = horz ? uTexel.y : uTexel.x;
  float lLocal;
  if (steep1) { stepLen = -stepLen; lLocal = 0.5 * (l1 + lM); } else { lLocal = 0.5 * (l2 + lM); }
  vec2 cuv = uv;
  if (horz) cuv.y += stepLen * 0.5; else cuv.x += stepLen * 0.5;
  vec2 off = horz ? vec2(uTexel.x, 0.0) : vec2(0.0, uTexel.y);
  vec2 uv1 = cuv - off, uv2 = cuv + off;
  float e1 = luma(texture(tIn, uv1).rgb) - lLocal;
  float e2 = luma(texture(tIn, uv2).rgb) - lLocal;
  bool r1 = abs(e1) >= gScaled, r2 = abs(e2) >= gScaled;
  const float Q[10] = float[10](1.0, 1.0, 1.0, 1.0, 1.5, 2.0, 2.0, 2.0, 4.0, 8.0);
  for (int i = 0; i < 10; i++) {
    if (r1 && r2) break;
    if (!r1) { uv1 -= off * Q[i]; e1 = luma(texture(tIn, uv1).rgb) - lLocal; r1 = abs(e1) >= gScaled; }
    if (!r2) { uv2 += off * Q[i]; e2 = luma(texture(tIn, uv2).rgb) - lLocal; r2 = abs(e2) >= gScaled; }
  }
  float d1 = horz ? uv.x - uv1.x : uv.y - uv1.y;
  float d2 = horz ? uv2.x - uv.x : uv2.y - uv.y;
  bool closer1 = d1 < d2;
  float dist = min(d1, d2);
  float edgeLen = d1 + d2;
  float pixOff = -dist / edgeLen + 0.5;
  bool lMSmaller = lM < lLocal;
  bool correct = ((closer1 ? e1 : e2) < 0.0) != lMSmaller;
  float finalOff = correct ? pixOff : 0.0;
  float lAvg = (1.0 / 12.0) * (2.0 * (lN + lS + lE + lW) + lNW + lNE + lSW + lSE);
  float sub = clamp(abs(lAvg - lM) / range, 0.0, 1.0);
  sub = (-2.0 * sub + 3.0) * sub * sub;
  finalOff = max(finalOff, sub * sub * 0.75);
  vec2 fuv = uv;
  if (horz) fuv.y += finalOff * stepLen; else fuv.x += finalOff * stepLen;
  return texture(tIn, fuv).rgb;
}
void main() {
  vec3 c = uFxaa > 0.5 ? fxaa(vUv) : texture(tIn, vUv).rgb;
  // film grain: luminance-weighted, strongest in the mid-tones, animated
  float l = luma(c);
  float g = hash(gl_FragCoord.xy + fract(uTime * 13.37) * 1000.0) - 0.5;
  c += g * uGrain * (0.35 + 0.65 * (1.0 - abs(l * 2.0 - 1.0)));
  gl_FragColor = vec4(c, 1.0);
}
`;

// ───────────────────────────── pipeline ─────────────────────────────

export interface PostSettings {
  bloom: number;
  godRays: boolean;
  fxaa: boolean;
  grain: number;
  vignette: number;
  flare: number;
  exposureBias: number;
  manualExposure: number;
}

export interface SunScreen {
  uv: Vector2;
  onScreen: boolean;
  color: Vector3;
  /** 0..1: how much god rays / flare apply (inside an atmosphere, sun above the horizon) */
  strength: number;
}

export class PostPipeline {
  w = 1;
  h = 1;
  msaa = 0;
  hdr!: WebGLRenderTarget;
  sceneCopy!: WebGLRenderTarget;
  linDepth!: WebGLRenderTarget;
  atmoA!: WebGLRenderTarget;
  atmoB!: WebGLRenderTarget;
  /** last frame's composited HDR (sky, clouds, haze) — water reflections sample it */
  prevColor!: WebGLRenderTarget;
  prevValid = false;
  /** set by the renderer when a star's disc fills the view: exposure from the disc, bloom almost off */
  starExposure = 1;
  /** bloom scale for the light: by day a wide glow is only a veil over the view (halved), at night lights bloom fully */
  bloomScale = 1;
  starMix = 0;
  private godMask!: WebGLRenderTarget;
  private godA!: WebGLRenderTarget;
  private godB!: WebGLRenderTarget;
  private bloomMips: WebGLRenderTarget[] = [];
  private lum: WebGLRenderTarget[] = [];
  private adapt: WebGLRenderTarget[] = [];
  private adaptIdx = 0;
  private ldr!: WebGLRenderTarget;
  private copyMat = passMaterial(COPY_FRAG, { tColor: { value: null }, tDepth: { value: null }, uFar: { value: 2e7 }, uMode: { value: 0 } });
  private godMaskMat = passMaterial(GOD_MASK_FRAG, { tColor: { value: null }, tDepth: { value: null }, uSunUV: { value: new Vector2() }, uAspect: { value: 1 } });
  private godBlurMat = passMaterial(GOD_BLUR_FRAG, { tIn: { value: null }, uSunUV: { value: new Vector2() }, uSpread: { value: 1 }, uJitter: { value: 0 } });
  private downMat = passMaterial(BLOOM_DOWN_FRAG, { tIn: { value: null }, uTexel: { value: new Vector2() }, uKaris: { value: 0 } });
  private upMat = passMaterial(BLOOM_UP_FRAG, { tIn: { value: null }, uTexel: { value: new Vector2() }, uRadius: { value: 1 } }, { blending: AdditiveBlending });
  private lumMat = passMaterial(LUM_FRAG, { tIn: { value: null }, uSrcTexel: { value: new Vector2() }, uFirst: { value: 1 }, uLumFloor: { value: 0.004 } });
  private adaptMat = passMaterial(ADAPT_FRAG, {
    tLum: { value: null }, tPrev: { value: null }, uDt: { value: 0.016 }, uCut: { value: 1 }, uKey: { value: 0.16 }, uRange: { value: new Vector2(0.02, 6) },
  });
  readonly tonemapMat = passMaterial(TONEMAP_FRAG, {
    tHDR: { value: null }, tBloom: { value: null }, tGod: { value: null }, tExposure: { value: null }, tMask: { value: null },
    uBloom: { value: 0.04 }, uBloomNorm: { value: 1 }, uGod: { value: 0 }, uGodColor: { value: new Vector3(1, 1, 1) }, uSunUV: { value: new Vector2() },
    uSunOn: { value: 0 }, uSunColor: { value: new Vector3(1, 1, 1) }, uFlare: { value: 1 }, uAspect: { value: 1 },
    uExposureBias: { value: 0 }, uManualExposure: { value: 0 }, uStarExposure: { value: 1 }, uStarMix: { value: 0 }, uVignette: { value: 0.22 }, uWhite: { value: new Vector3(1, 1, 1) },
    // no lift: a lifted black turned space navy and every shadow milky; contrast and colour come from the curve
    uLift: { value: new Vector3(0, 0, 0) }, uGamma: { value: new Vector3(1.0, 1.0, 1.0) }, uGain: { value: new Vector3(1.02, 1.0, 0.97) },
    // AgX with a contrasty look on the narrower range: power 1.34 (the exposure key puts the scene's log-average at
    // ~122/255; diffuse white → ~224, scene 2.0 → ~241; the old 1.36 / 4.03 pair pulled mid-tones to 94 and capped white
    // at 184), a toe that takes the deepest shadows to black, saturation 1.1 after the curve, gamut- and hue-limited
    // (vibrance: greens and sky blues get half of it; 1.22 pushed skin, brick and awnings to orange pastel plastic)
    uSat: { value: 1.1 }, uPower: { value: 1.34 }, uGolden: { value: 0 }, uGrade: { value: 0.3 }, uNight: { value: 0 }, uToe: { value: 0.012 },
  });
  private fxaaMat = passMaterial(FXAA_FRAG, { tIn: { value: null }, uTexel: { value: new Vector2() }, uFxaa: { value: 1 }, uGrain: { value: 0.022 }, uTime: { value: 0 } });
  private cut = true;

  constructor() {
    for (let i = 0; i < 2; i++) this.adapt.push(rt(1, 1, FloatType, RGFormat, NearestFilter));
    this.lum.push(rt(64, 64, FloatType, RGFormat, LinearFilter), rt(16, 16, FloatType, RGFormat, LinearFilter), rt(4, 4, FloatType, RGFormat, LinearFilter), rt(1, 1, FloatType, RGFormat, NearestFilter));
  }

  /** next frame's exposure snaps to its target (after camera cuts / teleports) */
  cutExposure(): void { this.cut = true; }

  setSize(w: number, h: number, msaa: number): void {
    w = Math.max(2, Math.floor(w)); h = Math.max(2, Math.floor(h));
    if (w === this.w && h === this.h && msaa === this.msaa && this.hdr) return;
    this.w = w; this.h = h; this.msaa = msaa;
    for (const t of [this.hdr, this.sceneCopy, this.linDepth, this.atmoA, this.atmoB, this.prevColor, this.godMask, this.godA, this.godB, this.ldr]) t?.dispose();
    this.prevValid = false;
    for (const t of this.bloomMips) t.dispose();
    const depth = new DepthTexture(w, h, FloatType);
    this.hdr = new WebGLRenderTarget(w, h, { type: HalfFloatType, format: RGBAFormat, samples: msaa, depthTexture: depth, depthBuffer: true, minFilter: LinearFilter, magFilter: LinearFilter });
    this.sceneCopy = rt(w, h);
    this.linDepth = rt(w, h, FloatType, RedFormat, NearestFilter);
    this.atmoA = rt(w, h);
    this.atmoB = rt(w, h);
    this.prevColor = rt(w, h);
    const q = (n: number) => Math.max(1, Math.floor(n / 4));
    this.godMask = rt(q(w), q(h));
    this.godA = rt(q(w), q(h));
    this.godB = rt(q(w), q(h));
    this.bloomMips = [];
    let bw = Math.floor(w / 2), bh = Math.floor(h / 2);
    while (this.bloomMips.length < 7 && bw >= 4 && bh >= 4) {
      this.bloomMips.push(rt(bw, bh));
      bw = Math.floor(bw / 2); bh = Math.floor(bh / 2);
    }
    this.ldr = rt(w, h, UnsignedByteType, RGBAFormat, LinearFilter);
    this.cut = true;
  }

  get depthTexture(): DepthTexture { return this.hdr.depthTexture as DepthTexture; }

  /** step 2: colour + linear depth copies for the water pass */
  copyForWater(r: WebGLRenderer, fsq: FullscreenQuad, far: number): void {
    const u = this.copyMat.uniforms;
    u.tColor.value = this.hdr.texture;
    u.tDepth.value = this.hdr.depthTexture;
    u.uFar.value = far;
    u.uMode.value = 0;
    fsq.render(r, this.copyMat, this.sceneCopy);
    u.uMode.value = 1;
    fsq.render(r, this.copyMat, this.linDepth);
  }

  /** keep this frame's composited HDR for next frame's reflections */
  keepPrevious(r: WebGLRenderer, fsq: FullscreenQuad, input: Texture): void {
    const u = this.copyMat.uniforms;
    u.tColor.value = input;
    u.uMode.value = 0;
    fsq.render(r, this.copyMat, this.prevColor);
    this.prevValid = true;
  }

  /** exposure key (mid-grey target): lower at dusk so sunsets and twilight stay dusky instead of being lifted */
  setKey(key: number): void { this.adaptMat.uniforms.uKey.value = key; }
  /** auto-exposure limits and the metering floor (luminance below which pixels do not count): night lowers both */
  setMetering(minExposure: number, maxExposure: number, lumFloor: number): void {
    (this.adaptMat.uniforms.uRange.value as Vector2).set(minExposure, maxExposure);
    this.lumMat.uniforms.uLumFloor.value = lumFloor;
  }

  /** steps 5–9: from the composited HDR image to the screen */
  finish(r: WebGLRenderer, fsq: FullscreenQuad, input: Texture, s: PostSettings, sun: SunScreen, dt: number, time: number, target: WebGLRenderTarget | null = null): void {
    const aspect = this.w / this.h;
    // god rays
    const godOn = s.godRays && sun.strength > 0.01;
    if (godOn || s.flare > 0) {
      const m = this.godMaskMat.uniforms;
      m.tColor.value = input;
      m.tDepth.value = this.hdr.depthTexture;
      m.uSunUV.value.copy(sun.uv);
      m.uAspect.value = aspect;
      fsq.render(r, this.godMaskMat, this.godMask);
    }
    if (godOn) {
      const b = this.godBlurMat.uniforms;
      b.uSunUV.value.copy(sun.uv);
      let src = this.godMask, dst = this.godA;
      const spreads = [1.0, 0.5, 0.25];
      for (let i = 0; i < 3; i++) {
        b.tIn.value = src.texture;
        b.uSpread.value = spreads[i];
        b.uJitter.value = (time * 0.37 + i * 0.31) % 1;
        fsq.render(r, this.godBlurMat, dst);
        src = dst;
        dst = dst === this.godA ? this.godB : this.godA;
      }
      this.tonemapMat.uniforms.tGod.value = src.texture;
    }
    // bloom
    if (s.bloom > 0 && this.bloomMips.length) {
      let src: Texture = input;
      let sw = this.w, sh = this.h;
      for (let i = 0; i < this.bloomMips.length; i++) {
        const d = this.downMat.uniforms;
        d.tIn.value = src;
        d.uTexel.value.set(1 / sw, 1 / sh);
        d.uKaris.value = i === 0 ? 1 : 0;
        fsq.render(r, this.downMat, this.bloomMips[i]);
        src = this.bloomMips[i].texture;
        sw = this.bloomMips[i].width; sh = this.bloomMips[i].height;
      }
      const prevAuto = r.autoClear;
      r.autoClear = false;
      for (let i = this.bloomMips.length - 1; i > 0; i--) {
        const u = this.upMat.uniforms;
        u.tIn.value = this.bloomMips[i].texture;
        u.uTexel.value.set(1 / this.bloomMips[i].width, 1 / this.bloomMips[i].height);
        u.uRadius.value = 1.0;
        fsq.render(r, this.upMat, this.bloomMips[i - 1]);
      }
      r.autoClear = prevAuto;
    }
    // exposure
    let src: Texture = input;
    let sw = this.w, sh = this.h;
    for (let i = 0; i < this.lum.length; i++) {
      const l = this.lumMat.uniforms;
      l.tIn.value = src;
      l.uSrcTexel.value.set(Math.max(1, sw / this.lum[i].width) / sw / 4 * 1, Math.max(1, sh / this.lum[i].height) / sh / 4 * 1);
      l.uFirst.value = i === 0 ? 1 : 0;
      fsq.render(r, this.lumMat, this.lum[i]);
      src = this.lum[i].texture;
      sw = this.lum[i].width; sh = this.lum[i].height;
    }
    const a = this.adaptMat.uniforms;
    a.tLum.value = this.lum[this.lum.length - 1].texture;
    a.tPrev.value = this.adapt[this.adaptIdx].texture;
    a.uDt.value = dt;
    a.uCut.value = this.cut ? 1 : 0;
    this.cut = false;
    this.adaptIdx ^= 1;
    fsq.render(r, this.adaptMat, this.adapt[this.adaptIdx]);
    // tone map
    const t = this.tonemapMat.uniforms;
    t.tHDR.value = input;
    t.tBloom.value = this.bloomMips.length ? this.bloomMips[0].texture : input;
    // bloom weight on the level-normalised chain: twice the preset's mix (≈ 9 % of a wide glow at High)
    t.uBloom.value = this.bloomMips.length ? 2 * this.bloomScale * (s.bloom + (Math.min(s.bloom, 0.01) - s.bloom) * this.starMix) : 0;
    t.uBloomNorm.value = this.bloomMips.length ? 1 / this.bloomMips.length : 1;
    t.uStarExposure.value = this.starExposure;
    t.uStarMix.value = this.starMix;
    t.uGod.value = godOn ? 0.32 * sun.strength : 0;
    if (!godOn) t.tGod.value = this.godMask.texture;
    t.uGodColor.value.copy(sun.color);
    t.tExposure.value = this.adapt[this.adaptIdx].texture;
    t.tMask.value = this.godMask.texture;
    t.uSunUV.value.copy(sun.uv);
    t.uSunOn.value = sun.onScreen && s.flare > 0 ? 1 : 0;
    t.uSunColor.value.copy(sun.color);
    t.uFlare.value = s.flare;
    t.uAspect.value = aspect;
    t.uExposureBias.value = s.exposureBias;
    t.uManualExposure.value = s.manualExposure;
    t.uVignette.value = s.vignette;
    fsq.render(r, this.tonemapMat, this.ldr);
    // AA + grain → screen
    const f = this.fxaaMat.uniforms;
    f.tIn.value = this.ldr.texture;
    f.uTexel.value.set(1 / this.w, 1 / this.h);
    f.uFxaa.value = s.fxaa ? 1 : 0;
    f.uGrain.value = s.grain;
    f.uTime.value = time % 100;
    fsq.render(r, this.fxaaMat, target);
  }

  /** the adapted exposure lives on the GPU; the dev HUD reads it rarely through this */
  exposureTexture(): Texture { return this.adapt[this.adaptIdx].texture; }

  dispose(): void {
    for (const t of [this.hdr, this.sceneCopy, this.linDepth, this.atmoA, this.atmoB, this.godMask, this.godA, this.godB, this.ldr, ...this.bloomMips, ...this.lum, ...this.adapt]) t?.dispose();
  }
}

export type { ShaderMaterial };
