// GENESIS — full-screen FX over the composited image (CONTRACT.md §15.7): weather fog, sky and ground tints, the
// eclipse, flashes.
//   fog      height fog thickened by the local weather (fog banks, blizzards, sandstorms, ash, the forgetting fog):
//            exponential in the distance along each pixel's ray, densest near the ground, lit by the sky's colour
//   tints    a multiply on the sky and (less) on the ground: a blood-red sky, the orange of a firestorm, a flare's white
//            wash, a dust bowl's ochre, an ice age's cold blue — every one weighted and faded by GodFx
//   eclipse  a black disc over the star where the sky shows (the terrain still hides it), the pearly corona with its
//            streamers and the diamond ring at the edge as the disc nearly covers the sun; at totality a sunset glow
//            all round the horizon (the light of the sunlit air beyond the moon's shadow)
//   flash    an impact's or a bolt's light washing the whole view for an instant
//   lens     rain on the lens of an eye on the ground (walk, photo, a low follow): small sparse beads that show the view
//            behind them flipped, a few running slowly, gathering while the camera looks into the rain and drying
//            within seconds when it stops
// Passes: premultiplied over (fog, the disc, the corona and flash added), then the tint as a multiply, then (wet) a
// half-resolution copy of the frame that the drops refract.

import { CustomBlending, DstColorFactor, HalfFloatType, LinearFilter, Matrix4, OneFactor, OneMinusSrcAlphaFactor, Vector2, Vector3, WebGLRenderTarget, ZeroFactor, type IUniform, type Texture, type WebGLRenderer } from 'three';
import { passMaterial, type FullscreenQuad } from '../post/fsquad.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';

const COMMON = /* glsl */ `
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
uniform mat4 uInvProj;
uniform mat3 uViewToBody;
uniform vec3 uCamBody;
uniform float uGroundR;
varying vec2 vUv;
vec3 viewRay(vec2 uv) { vec4 r = uInvProj * vec4(uv * 2.0 - 1.0, -1.0, 1.0); return r.xyz / r.w; }
`;

const OVER = /* glsl */ `
${NOISE_GLSL}
${COMMON}
uniform vec3 uFogCol;
uniform float uFogDensity;
uniform float uFogScale;
uniform vec2 uSunUV;
uniform float uSunR;
uniform float uEcl;
uniform float uAspect;
uniform vec3 uFlash;
uniform float uTime;
uniform float uTotal;
uniform vec3 uHorizonCol;
void main() {
  float sz = texture(tSceneDepth, vUv).r;
  bool sky = sz > 1e6;
  vec3 rd = viewRay(vUv);
  float rl = length(rd);
  float d = sky ? 6000.0 : sz * rl / max(-rd.z, 1e-6);
  vec4 o = vec4(0.0);
  // ── fog: density falling off with height above the ground the camera stands on ──
  if (uFogDensity > 0.0) {
    vec3 dirB = normalize(uViewToBody * (rd / rl));
    vec3 upC = normalize(uCamBody);
    float h0 = length(uCamBody) - uGroundR;
    float slope = dot(dirB, upC);
    // ∫ exp(-(h0 + s·slope)/H) ds over [0, d]
    float H = uFogScale;
    float k = abs(slope) > 1e-4 ? (H / slope) * (exp(-h0 / H) - exp(-(h0 + d * slope) / H)) : d * exp(-h0 / H);
    float f = 1.0 - exp(-uFogDensity * max(k, 0.0));
    o = vec4(uFogCol * f, f);
  }
  // ── the eclipse: the moon's disc over the star (only where the sky shows), the corona round it ──
  if (uEcl > 0.0 && uSunUV.x > -1.0) {
    vec2 dv = (vUv - uSunUV) * vec2(uAspect, 1.0);
    float dist = length(dv);
    float R = uSunR;
    // the occluder slides across: its centre offset by the uncovered share
    vec2 off = vec2(1.0, 0.35) * R * 2.0 * (1.0 - uEcl);
    float dm = length(dv - off);
    float disc = 1.0 - smoothstep(R * 0.995, R * 1.01, dm);
    if (sky) {
      o.rgb *= 1.0 - disc; o.a = max(o.a, disc);
      // the corona: streamers fanning from the limb; the diamond ring where a sliver of sun shows at the edge
      float ang = atan(dv.y, dv.x);
      float streak = 0.55 + 0.45 * pow(abs(snoise(vec3(ang * 3.0, 0.0, uTime * 0.02))), 0.6);
      float full = smoothstep(0.86, 0.99, uEcl);
      float rr = R / max(dist, R);
      float cor = (pow(rr, 2.6) * streak * 0.55 + pow(rr, 9.0) * 1.6) * full;
      vec3 ccol = vec3(0.92, 0.94, 1.0) * cor * 4.0;
      float ring = (1.0 - smoothstep(0.0, R * 0.08, abs(dm - R))) * smoothstep(0.9, 0.995, uEcl) * (1.0 - smoothstep(0.995, 1.0, uEcl));
      ccol += vec3(1.0, 0.95, 0.85) * ring * 30.0 * smoothstep(R * 1.2, R * 0.8, length(dv - off * 0.0 + normalize(off + 1e-6) * R));
      o.rgb += ccol * step(R * 0.99, dm);
    }
  }
  // ── totality: the horizon glows sunset-orange all round (the air beyond the shadow is still in sunlight) ──
  if (uTotal > 0.0 && sky) {
    vec3 dirB = normalize(uViewToBody * (rd / rl));
    float e = dot(dirB, normalize(uCamBody));
    float band = exp(-max(e + 0.03, 0.0) / 0.075) * smoothstep(-0.2, -0.02, e);
    float var = 0.75 + 0.25 * snoise(vec3(atan(dirB.x, dirB.z) * 2.0, 0.0, 3.0));
    o.rgb += uHorizonCol * band * var * uTotal;
  }
  // ── a flash over everything ──
  o.rgb += uFlash;
  gl_FragColor = o;
}
`;

const MUL = /* glsl */ `
${COMMON}
uniform vec3 uTintSky;
uniform vec3 uTintGround;
void main() {
  float sz = texture(tSceneDepth, vUv).r;
  vec3 t = sz > 1e6 ? uTintSky : uTintGround;
  gl_FragColor = vec4(t, 1.0);
}
`;

const COPY = /* glsl */ `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture(tSrc, vUv).rgb, 1.0); }
`;

/**
 * rain on the lens (an eye on the ground only): small, sparse beads, each a little lens — the view behind it turned
 * upside down and shrunk (sky at its foot, ground at its crown), framed by a thin dark rim with a bright caustic
 * crescent and a glint, its edge feathered; the view under it softly blurred. A few beads run, slowly. Premultiplied over.
 */
const LENS = /* glsl */ `
uniform sampler2D tCopy;
uniform float uWet;
uniform float uTime;
uniform float uAspect;
uniform vec2 uTexel;
varying vec2 vUv;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// one layer of beads on a grid (scale = cells per screen height): xy the point's offset from the bead's centre in
// bead radii, z the bead's coverage; out: the bead's centre (uv) and radius (uv-height units)
vec3 beads(vec2 uv, float scale, float t, float seed, float wet, out vec2 cUV, out float rUV) {
  vec2 p = vec2(uv.x * uAspect, uv.y) * scale;
  vec2 id = floor(p);
  vec2 f = fract(p) - 0.5;
  float r1 = h21(id + seed), r2 = h21(id + seed + 7.3), r3 = h21(id + seed + 13.1);
  // sparse: a cell holds a bead only once the lens is quite wet
  float on = step(r1, wet * 0.2);
  // a few run down, slowly, pausing
  float run = step(0.9, r2);
  float tt = t * (0.08 + r3 * 0.12) + r1 * 10.0;
  float slide = run * (fract(tt) + 0.1 * sin(tt * 6.2831));
  vec2 c = vec2((r2 - 0.5) * 0.5, (r3 - 0.5) * 0.5 - slide * 0.6 + run * 0.3);
  float R = mix(0.1, 0.22, r3 * r3);
  vec2 d = (f - c) / vec2(1.0, 1.12);
  float l = length(d);
  float m = (1.0 - smoothstep(R * 0.72, R, l)) * on;
  vec2 cp = id + 0.5 + c;
  cUV = vec2(cp.x / uAspect, cp.y) / scale;
  rUV = R / scale;
  return vec3(d / max(R, 1e-3), m);
}
void main() {
  vec2 cA, cB; float rA, rB;
  // (beads about 1–2 % of the frame's height across: a fifth of the old marbles, still big enough to show the view
  // turned over inside them)
  vec3 a = beads(vUv, 22.0, uTime, 1.7, uWet, cA, rA);
  vec3 b = beads(vUv + 0.37, 36.0, uTime * 0.7, 5.1, uWet * 0.8, cB, rB);
  bool useA = a.z >= b.z;
  vec3 d = useA ? a : b;
  vec2 cUV = useA ? cA : cB - 0.37;
  float rUV = useA ? rA : rB;
  float m = d.z;
  if (m < 0.002) discard;
  vec2 n = d.xy;
  float l = length(n);
  // the lens: the scene behind, flipped about the bead's centre and shrunk (a field ~2.6 beads across)
  vec2 off = -n * rUV * 2.6 * vec2(1.0 / uAspect, 1.0);
  vec2 suv = clamp(cUV + off, vec2(0.001), vec2(0.999));
  vec3 refr = texture(tCopy, suv).rgb;
  // the view under the bead, softly blurred (four taps of the half-size copy)
  vec2 k = uTexel * 2.0;
  vec3 under = 0.25 * (texture(tCopy, vUv + vec2(k.x, k.y)).rgb + texture(tCopy, vUv + vec2(-k.x, k.y)).rgb + texture(tCopy, vUv + vec2(k.x, -k.y)).rgb + texture(tCopy, vUv - k).rgb);
  vec3 c = mix(under, refr * 0.92, smoothstep(0.95, 0.55, l));
  // a thin dark rim (total internal reflection at the edge), a caustic crescent opposite the light, a glint
  float rim = smoothstep(0.66, 0.86, l) * (1.0 - smoothstep(0.86, 1.0, l));
  float lum = dot(refr, vec3(0.3333));
  float crescent = smoothstep(0.5, 0.85, l) * (1.0 - smoothstep(0.85, 0.98, l)) * pow(max(0.0, dot(normalize(n + 1e-5), vec2(0.4, -0.7))), 3.0);
  float glint = exp(-dot(n - vec2(-0.32, 0.42), n - vec2(-0.32, 0.42)) * 60.0);
  c = c * (1.0 - 0.55 * rim) + vec3(crescent * 0.5 + glint * 0.9) * (lum + 0.05);
  float al = m * 0.94;
  gl_FragColor = vec4(c * al, al);
}
`;

export interface ScreenState {
  fogCol: Vector3;
  fogDensity: number;
  fogScale: number;
  /** multiply tints (1 = none) */
  tintSky: Vector3;
  tintGround: Vector3;
  /** the eclipse: coverage 0..1, the star's screen position (uv) and angular radius in uv-height units */
  eclipse: number;
  sunUV: Vector2;
  sunR: number;
  flash: Vector3;
  /** rain on the lens (0 dry .. 1 streaming) */
  lens: number;
  /** totality (0..1) and the horizon's glow then (radiance) */
  totality: number;
  horizonCol: Vector3;
}

export function newScreenState(): ScreenState {
  return { fogCol: new Vector3(), fogDensity: 0, fogScale: 120, tintSky: new Vector3(1, 1, 1), tintGround: new Vector3(1, 1, 1), eclipse: 0, sunUV: new Vector2(-10, -10), sunR: 0.01, flash: new Vector3(), lens: 0, totality: 0, horizonCol: new Vector3() };
}

export class ScreenFx {
  private over;
  private mul;
  private shared: Record<string, IUniform>;
  private copy;
  private lens;
  private lensRT: WebGLRenderTarget | null = null;
  constructor() {
    this.shared = {
      tSceneDepth: { value: null }, uResolution: { value: new Vector2(1, 1) }, uInvProj: { value: new Matrix4() },
      uViewToBody: { value: null }, uCamBody: { value: new Vector3() }, uGroundR: { value: 3000 },
    };
    this.over = passMaterial(OVER, {
      ...this.shared, uFogCol: { value: new Vector3() }, uFogDensity: { value: 0 }, uFogScale: { value: 120 }, uSunUV: { value: new Vector2() },
      uSunR: { value: 0.01 }, uEcl: { value: 0 }, uAspect: { value: 1 }, uFlash: { value: new Vector3() }, uTime: { value: 0 },
      uTotal: { value: 0 }, uHorizonCol: { value: new Vector3() },
    });
    this.over.blending = CustomBlending; this.over.blendSrc = OneFactor; this.over.blendDst = OneMinusSrcAlphaFactor;
    this.over.transparent = true; this.over.depthTest = false; this.over.depthWrite = false;
    this.mul = passMaterial(MUL, { ...this.shared, uTintSky: { value: new Vector3(1, 1, 1) }, uTintGround: { value: new Vector3(1, 1, 1) } });
    this.mul.blending = CustomBlending; this.mul.blendSrc = DstColorFactor; this.mul.blendDst = ZeroFactor;
    this.mul.transparent = true; this.mul.depthTest = false; this.mul.depthWrite = false;
    this.copy = passMaterial(COPY, { tSrc: { value: null } });
    this.lens = passMaterial(LENS, { tCopy: { value: null }, uWet: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 }, uTexel: { value: new Vector2(1 / 640, 1 / 360) } });
    this.lens.blending = CustomBlending; this.lens.blendSrc = OneFactor; this.lens.blendDst = OneMinusSrcAlphaFactor;
    this.lens.transparent = true; this.lens.depthTest = false; this.lens.depthWrite = false;
  }

  render(r: WebGLRenderer, fsq: FullscreenQuad, target: WebGLRenderTarget | null, s: ScreenState, depth: unknown, w: number, h: number, invProj: Matrix4, viewToBody: unknown, camBody: Vector3, groundR: number, time: number): void {
    const any = s.fogDensity > 1e-6 || s.eclipse > 0.001 || s.flash.lengthSq() > 1e-8;
    const tint = Math.abs(s.tintSky.x - 1) + Math.abs(s.tintSky.y - 1) + Math.abs(s.tintSky.z - 1) + Math.abs(s.tintGround.x - 1) + Math.abs(s.tintGround.y - 1) + Math.abs(s.tintGround.z - 1) > 0.003;
    const wet = s.lens > 0.02 && !!target;
    if (!any && !tint && !wet) return;
    const sh = this.shared;
    sh.tSceneDepth.value = depth;
    (sh.uResolution.value as Vector2).set(w, h);
    (sh.uInvProj.value as Matrix4).copy(invProj);
    sh.uViewToBody.value = viewToBody;
    (sh.uCamBody.value as Vector3).copy(camBody);
    sh.uGroundR.value = groundR;
    const prevAuto = r.autoClear;
    r.autoClear = false;
    if (any) {
      const u = this.over.uniforms;
      (u.uFogCol.value as Vector3).copy(s.fogCol);
      u.uFogDensity.value = s.fogDensity;
      u.uFogScale.value = s.fogScale;
      (u.uSunUV.value as Vector2).copy(s.sunUV);
      u.uSunR.value = s.sunR;
      u.uEcl.value = s.eclipse;
      u.uAspect.value = w / h;
      (u.uFlash.value as Vector3).copy(s.flash);
      u.uTime.value = time;
      u.uTotal.value = s.totality;
      (u.uHorizonCol.value as Vector3).copy(s.horizonCol);
      fsq.render(r, this.over, target);
    }
    if (tint) {
      (this.mul.uniforms.uTintSky.value as Vector3).copy(s.tintSky);
      (this.mul.uniforms.uTintGround.value as Vector3).copy(s.tintGround);
      fsq.render(r, this.mul, target);
    }
    if (wet && target) {
      // the frame so far at half size: what the drops refract
      const hw = Math.max(1, Math.floor(w / 2)), hh = Math.max(1, Math.floor(h / 2));
      if (!this.lensRT || this.lensRT.width !== hw || this.lensRT.height !== hh) {
        this.lensRT?.dispose();
        this.lensRT = new WebGLRenderTarget(hw, hh, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
      }
      this.copy.uniforms.tSrc.value = target.texture as Texture;
      fsq.render(r, this.copy, this.lensRT);
      const u = this.lens.uniforms;
      u.tCopy.value = this.lensRT.texture;
      u.uWet.value = Math.min(1, s.lens);
      u.uTime.value = time;
      u.uAspect.value = w / h;
      (u.uTexel.value as Vector2).set(1 / hw, 1 / hh);
      fsq.render(r, this.lens, target);
    }
    r.autoClear = prevAuto;
  }

  dispose(): void { this.over.dispose(); this.mul.dispose(); this.copy.dispose(); this.lens.dispose(); this.lensRT?.dispose(); }
}
