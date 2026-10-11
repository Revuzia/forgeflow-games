// GENESIS — full-screen FX over the composited image (CONTRACT.md §15.7): weather fog, sky and ground tints, the
// eclipse, flashes.
//   fog      height fog thickened by the local weather (fog banks, blizzards, sandstorms, ash, the forgetting fog):
//            exponential in the distance along each pixel's ray, densest near the ground, lit by the sky's colour
//   tints    a multiply on the sky and (less) on the ground: a blood-red sky, the orange of a firestorm, a flare's white
//            wash, a dust bowl's ochre, an ice age's cold blue — every one weighted and faded by GodFx
//   eclipse  a black disc over the star where the sky shows (the terrain still hides it), the pearly corona with its
//            streamers and the diamond ring at the edge as the disc nearly covers the sun
//   flash    an impact's or a bolt's light washing the whole view for an instant
// Two passes: premultiplied over (fog, the disc, the corona and flash added), then the tint as a multiply.

import { CustomBlending, DstColorFactor, Matrix4, OneFactor, OneMinusSrcAlphaFactor, Vector2, Vector3, ZeroFactor, type IUniform, type WebGLRenderer, type WebGLRenderTarget } from 'three';
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
vec3 viewRay(vec2 uv) { vec4 r = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0); return r.xyz / r.w; }
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
      float cor = pow(R / max(dist, R), 5.0) * streak * full + pow(R / max(dist, R), 14.0) * 2.0 * full;
      vec3 ccol = vec3(0.92, 0.94, 1.0) * cor * 4.0;
      float ring = (1.0 - smoothstep(0.0, R * 0.08, abs(dm - R))) * smoothstep(0.9, 0.995, uEcl) * (1.0 - smoothstep(0.995, 1.0, uEcl));
      ccol += vec3(1.0, 0.95, 0.85) * ring * 30.0 * smoothstep(R * 1.2, R * 0.8, length(dv - off * 0.0 + normalize(off + 1e-6) * R));
      o.rgb += ccol * step(R * 0.99, dm);
    }
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
}

export function newScreenState(): ScreenState {
  return { fogCol: new Vector3(), fogDensity: 0, fogScale: 120, tintSky: new Vector3(1, 1, 1), tintGround: new Vector3(1, 1, 1), eclipse: 0, sunUV: new Vector2(-10, -10), sunR: 0.01, flash: new Vector3() };
}

export class ScreenFx {
  private over;
  private mul;
  private shared: Record<string, IUniform>;
  constructor() {
    this.shared = {
      tSceneDepth: { value: null }, uResolution: { value: new Vector2(1, 1) }, uInvProj: { value: new Matrix4() },
      uViewToBody: { value: null }, uCamBody: { value: new Vector3() }, uGroundR: { value: 3000 },
    };
    this.over = passMaterial(OVER, {
      ...this.shared, uFogCol: { value: new Vector3() }, uFogDensity: { value: 0 }, uFogScale: { value: 120 }, uSunUV: { value: new Vector2() },
      uSunR: { value: 0.01 }, uEcl: { value: 0 }, uAspect: { value: 1 }, uFlash: { value: new Vector3() }, uTime: { value: 0 },
    });
    this.over.blending = CustomBlending; this.over.blendSrc = OneFactor; this.over.blendDst = OneMinusSrcAlphaFactor;
    this.over.transparent = true; this.over.depthTest = false; this.over.depthWrite = false;
    this.mul = passMaterial(MUL, { ...this.shared, uTintSky: { value: new Vector3(1, 1, 1) }, uTintGround: { value: new Vector3(1, 1, 1) } });
    this.mul.blending = CustomBlending; this.mul.blendSrc = DstColorFactor; this.mul.blendDst = ZeroFactor;
    this.mul.transparent = true; this.mul.depthTest = false; this.mul.depthWrite = false;
  }

  render(r: WebGLRenderer, fsq: FullscreenQuad, target: WebGLRenderTarget | null, s: ScreenState, depth: unknown, w: number, h: number, invProj: Matrix4, viewToBody: unknown, camBody: Vector3, groundR: number, time: number): void {
    const any = s.fogDensity > 1e-6 || s.eclipse > 0.001 || s.flash.lengthSq() > 1e-8;
    const tint = Math.abs(s.tintSky.x - 1) + Math.abs(s.tintSky.y - 1) + Math.abs(s.tintSky.z - 1) + Math.abs(s.tintGround.x - 1) + Math.abs(s.tintGround.y - 1) + Math.abs(s.tintGround.z - 1) > 0.003;
    if (!any && !tint) return;
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
      fsq.render(r, this.over, target);
    }
    if (tint) {
      (this.mul.uniforms.uTintSky.value as Vector3).copy(s.tintSky);
      (this.mul.uniforms.uTintGround.value as Vector3).copy(s.tintGround);
      fsq.render(r, this.mul, target);
    }
    r.autoClear = prevAuto;
  }

  dispose(): void { this.over.dispose(); this.mul.dispose(); }
}
