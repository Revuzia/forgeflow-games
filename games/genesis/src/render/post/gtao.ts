// GENESIS — ground-truth-style ambient occlusion (Jimenez et al. 2016, "Practical Real-Time Strategies for Accurate
// Indirect Occlusion") over the logarithmic depth buffer: contact shadows where trees, rocks and buildings meet the
// ground, in creases and under overhangs.
//
//   1. GTAO at half (Medium/High) or full (Ultra/Cinematic) resolution: view-space positions from the log depth,
//      normals from the depth's smallest-difference neighbours, N slices per pixel (rotated by a 4×4 interleaved
//      pattern) with a horizon search of M steps each way inside a world radius of ~1.6 m (capped in pixels), the
//      cosine-weighted visibility integral against the projected normal, a thickness heuristic (thin foreground does
//      not occlude everything behind it) and a fade with distance (AO is a contact effect; the far landscape is
//      shaded by the terrain shader's own concavity and horizon terms).
//      The same pass estimates each pixel's SUN SHARE — the direct sun's part of its light, from the cascaded sun
//      shadow, N·L of the depth normal and the sky / sun irradiance ratio — because AO is an ambient effect: sunlit
//      contact areas must not go grimy.
//   2. a 4×4 depth-aware blur (AO and sun share) that removes the interleave pattern without bleeding across
//      silhouettes.
//   3. apply: scene × mix(1, AO, strength · (1 − sun share)), before aerial perspective and clouds (haze is not
//      darkened). With air the apply is folded into the atmosphere composite (AO_APPLY_GLSL: no extra full-screen pass
//      and no copy-back); airless worlds use the apply + copy passes here.
// Cost per preset (taps per AO pixel): Medium 2 slices × 2 × 4 steps at ½ res; High 2 × 2 × 6 at ½ res;
// Ultra 3 × 2 × 6 at full res; Cinematic 4 × 2 × 8 at full res; + 5 shadow taps + 16-tap blur per AO pixel + a 4-tap
// upsample in the composite per pixel. Off on Low.

import { HalfFloatType, LinearFilter, Matrix4, NearestFilter, RGBAFormat, Vector2, Vector3, Vector4, WebGLRenderTarget, type Texture, type WebGLRenderer } from 'three';
import { FullscreenQuad, passMaterial } from './fsquad.ts';
import { LOGDEPTH_DECODE } from '../shaders/atmosphere.glsl.ts';
import { SHADOW_GLSL } from '../planet/lights.ts';
import type { IUniform } from 'three';

export interface AoSettings { scale: number; slices: number; steps: number; strength: number; radius: number }

/** per-preset AO settings (null = off) */
export function aoFor(preset: string): AoSettings | null {
  switch (preset) {
    case 'medium': return { scale: 0.5, slices: 2, steps: 4, strength: 0.85, radius: 1.6 };
    case 'high': return { scale: 0.5, slices: 2, steps: 6, strength: 0.9, radius: 1.6 };
    case 'ultra': return { scale: 1, slices: 3, steps: 6, strength: 0.9, radius: 1.8 };
    case 'cinematic': return { scale: 1, slices: 4, steps: 8, strength: 0.95, radius: 2.0 };
    default: return null;
  }
}

const COMMON = /* glsl */ `
${LOGDEPTH_DECODE}
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform float uFar;
uniform vec2 uDepthRes;
float viewZAt(vec2 uv) {
  float d = texture(tDepth, uv).r;
  return d >= 0.999999 ? 1e9 : viewZFromLogDepth(d, uFar);
}
vec3 viewPosAt(vec2 uv, float z) {
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  vec3 r = v.xyz / v.w;
  return r * (z / max(-r.z, 1e-6));
}
`;

const GTAO_FRAG = /* glsl */ `
#include <common>
${COMMON}
${SHADOW_GLSL}
varying vec2 vUv;
uniform vec3 uSunView;      // direction to the sun, view space
uniform float uSkyRatio;    // sky irradiance / direct sun irradiance at the camera (0: no sky)
uniform float uSunUp;       // 0..1: the sun is up at the camera
uniform vec2 uRes;          // AO target resolution
uniform float uProjScale;   // pixels (of the AO target) per metre at 1 m view depth
uniform float uRadius;      // world radius (m)
uniform int uSlices;
uniform int uSteps;
uniform float uFrameMod;

void main() {
  vec2 uv = vUv;
  float z = viewZAt(uv);
  // sky, and the far landscape (AO is a contact effect): fully visible
  // (depth stored clamped: the sky's 1e9 overflows half float to Inf, and Inf − Inf poisoned the blur with NaN)
  if (z > 600.0) { gl_FragColor = vec4(1.0, 6e4, 1.0, 1.0); return; }
  vec3 P = viewPosAt(uv, z);
  // normal from the smaller of the forward / backward depth differences (no smearing across silhouettes)
  vec2 px = 1.0 / uRes;
  vec3 Pr = viewPosAt(uv + vec2(px.x, 0.0), viewZAt(uv + vec2(px.x, 0.0)));
  vec3 Pl = viewPosAt(uv - vec2(px.x, 0.0), viewZAt(uv - vec2(px.x, 0.0)));
  vec3 Pu = viewPosAt(uv + vec2(0.0, px.y), viewZAt(uv + vec2(0.0, px.y)));
  vec3 Pd = viewPosAt(uv - vec2(0.0, px.y), viewZAt(uv - vec2(0.0, px.y)));
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 N = normalize(cross(dx, dy));
  vec3 V = normalize(-P);
  if (dot(N, V) < 0.0) N = -N;
  // 4×4 interleaved slice rotation and step jitter (the blur pass integrates the pattern away)
  ivec2 ip = ivec2(gl_FragCoord.xy) & 3;
  float rot = (float(ip.x * 4 + ip.y) * 0.0625 + 0.03125 * mod(uFrameMod, 2.0));
  float jit = fract(float((ip.x + 2 * ip.y) & 3) * 0.25 + 0.125);
  float rPx = clamp(uRadius * uProjScale / max(z, 0.05), 3.0, 64.0);
  float vis = 0.0;
  float wsum = 0.0;
  for (int s = 0; s < 4; s++) {
    if (s >= uSlices) break;
    float phi = (float(s) + rot) * PI / float(uSlices);
    vec2 dir2 = vec2(cos(phi), sin(phi));
    vec3 dirV = vec3(dir2, 0.0);
    // slice plane: spanned by the view vector and the screen direction
    vec3 orthoDir = dirV - dot(dirV, V) * V;
    vec3 axis = normalize(cross(dirV, V));
    vec3 projN = N - axis * dot(N, axis);
    float projLen = length(projN);
    if (projLen < 1e-4) continue;
    float cosN = clamp(dot(projN / projLen, V), -1.0, 1.0);
    float n = sign(dot(projN, orthoDir)) * acos(cosN);
    float h0 = -1.0, h1 = -1.0;
    for (int k = 0; k < 8; k++) {
      if (k >= uSteps) break;
      float t = (float(k) + jit) / float(uSteps);
      t = t * t;   // denser near the pixel (contact)
      vec2 off = dir2 * max(t * rPx, 1.0 + float(k)) * px;
      for (int side = 0; side < 2; side++) {
        vec2 suv = side == 0 ? uv + off : uv - off;
        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
        float sz = viewZAt(suv);
        vec3 S = viewPosAt(suv, sz) - P;
        float dl = length(S);
        float c = dot(S / max(dl, 1e-5), V);
        // falloff with distance; thin foreground (much closer than the sample radius allows) counts less
        float fo = clamp(1.0 - (dl * dl) / (uRadius * uRadius * 1.7), 0.0, 1.0);
        c = mix(-1.0, c, fo);
        if (side == 0) h0 = max(h0, c); else h1 = max(h1, c);
      }
    }
    // horizon angles (h0 on the +dir side, h1 on the −dir side), clamped to the hemisphere around the normal
    float a0 = -acos(clamp(h1, -1.0, 1.0));
    float a1 = acos(clamp(h0, -1.0, 1.0));
    a0 = n + max(a0 - n, -PI * 0.5);
    a1 = n + min(a1 - n, PI * 0.5);
    float sinN = sin(n);
    float v0 = 0.25 * (-cos(2.0 * a0 - n) + cosN + 2.0 * a0 * sinN);
    float v1 = 0.25 * (-cos(2.0 * a1 - n) + cosN + 2.0 * a1 * sinN);
    vis += projLen * (v0 + v1);
    wsum += projLen;
  }
  float ao = wsum > 0.0 ? clamp(vis / wsum, 0.0, 1.0) : 1.0;
  // fade out with distance (the far landscape keeps the terrain shader's own occlusion)
  ao = mix(ao, 1.0, smoothstep(250.0, 600.0, z));
  // the direct sun's share of this pixel's light: AO darkens only the rest (sky / bounce)
  float ndl = max(dot(N, uSunView), 0.0) * uSunUp;
  float sunT = ndl > 0.0 ? sunShadow(P, N) * ndl : 0.0;
  float share = sunT / (sunT + uSkyRatio + 1e-4);
  gl_FragColor = vec4(ao, z, share, 1.0);
}
`;

const BLUR_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tAO;
uniform vec2 uRes;
#ifdef AO_FETCH
// (PERF s15 cut #6: the raw AO may live in a linearly filtered target (the scene copy): exact texels by texelFetch —
// what the nearest-filtered own target gave, the offsets landing on texel corners, clamped to the edge as before)
vec3 aoTexel(ivec2 p) { return texelFetch(tAO, clamp(p, ivec2(0), ivec2(uRes) - 1), 0).rgb; }
#endif
void main() {
#ifdef AO_FETCH
  ivec2 pc = ivec2(gl_FragCoord.xy);
  vec3 c = aoTexel(pc);
#else
  vec3 c = texture(tAO, vUv).rgb;
#endif
  float z0 = c.g;
  vec2 acc = vec2(0.0);
  float w = 0.0;
  for (int j = -2; j <= 1; j++)
  for (int i = -2; i <= 1; i++) {
#ifdef AO_FETCH
    vec3 s = aoTexel(pc + ivec2(i + 1, j + 1));
#else
    vec3 s = texture(tAO, vUv + (vec2(float(i), float(j)) + 0.5) / uRes).rgb;
#endif
    float wz = exp(-abs(s.g - z0) / max(z0 * 0.03, 0.05));
    acc += s.rb * wz;
    w += wz;
  }
  vec2 r = w > 0.0 ? acc / w : c.rb;
  gl_FragColor = vec4(r.x, z0, r.y, 1.0);
}
`;

/**
 * GLSL for the composite that folds the AO apply in: `aoFactor(uv, viewZ)` is the multiplier for the scene radiance
 * (1 where there is no AO): a depth-aware upsample of the blurred AO, applied to the ambient share only.
 * Needs: uniform sampler2D tAO; uniform vec2 uAoRes; uniform float uAoStrength; uniform float uAoOn.
 */
export const AO_APPLY_GLSL = /* glsl */ `
uniform sampler2D tAO;
uniform vec2 uAoRes;
uniform float uAoStrength;
uniform float uAoOn;
float aoFactor(vec2 uv, float z) {
  if (uAoOn < 0.5 || z > 600.0) return 1.0;
  vec2 p = uv * uAoRes - 0.5;
  vec2 b = floor(p);
  vec2 f = p - b;
  vec2 acc = vec2(0.0);
  float w = 0.0;
  for (int j = 0; j < 2; j++)
  for (int i = 0; i < 2; i++) {
    vec2 o = vec2(float(i), float(j));
    vec3 s = texture(tAO, (b + o + 0.5) / uAoRes).rgb;
    float wb = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
    float wz = exp(-abs(s.g - z) / max(z * 0.03, 0.05));
    acc += s.rb * wb * wz;
    w += wb * wz;
  }
  vec2 a = w > 1e-4 ? acc / w : vec2(1.0, 1.0);
  return mix(1.0, a.x, uAoStrength * (1.0 - a.y));
}
`;

const APPLY_FRAG = /* glsl */ `
${COMMON}
${AO_APPLY_GLSL}
varying vec2 vUv;
uniform sampler2D tScene;
void main() {
  vec3 col = texture(tScene, vUv).rgb;
  gl_FragColor = vec4(col * aoFactor(vUv, viewZAt(vUv)), 1.0);
}
`;

const COPY_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tIn;
void main() { gl_FragColor = vec4(texture(tIn, vUv).rgb, 1.0); }
`;

/**
 * PERF s15 (GPU-MEMORY-PLAN cuts #6 / #7): at full-resolution AO (Ultra / Cinematic) the two GTAO targets are each a
 * full-res RGBA16F target (11 MB at 1686x873) that lives only between the GTAO pass and the first composite. The
 * renderer lends targets that are idle then: the raw AO goes into the scene copy (rewritten by the copy for the water
 * right after the blur has read it; `?aoalias=0` keeps an own target) and the blur into atmoB when an atmosphere
 * composite follows (read by the first composite, which writes atmoA; `?aoblur=0` keeps an own target). Own targets
 * are made only on first need (half-res AO, an airless view).
 */
export class GtaoPass {
  private ao: WebGLRenderTarget | null = null;
  private blur: WebGLRenderTarget | null = null;
  /** the target this frame's blurred AO is in */
  private res: WebGLRenderTarget | null = null;
  private aoMat = passMaterial(GTAO_FRAG, {
    tDepth: { value: null }, uInvProj: { value: new Matrix4() }, uFar: { value: 2e7 }, uDepthRes: { value: new Vector2(1, 1) },
    uRes: { value: new Vector2(1, 1) }, uProjScale: { value: 500 }, uRadius: { value: 1.6 }, uSlices: { value: 2 }, uSteps: { value: 6 },
    uFrameMod: { value: 0 }, uSunView: { value: new Vector3(0, 1, 0) }, uSkyRatio: { value: 0.25 }, uSunUp: { value: 1 },
    uShadowMap: { value: null }, uShadowMat: { value: [new Matrix4(), new Matrix4(), new Matrix4(), new Matrix4()] }, uShadowSplits: { value: new Vector4() }, uShadowBias: { value: new Vector4() },
    uShadowOn: { value: 0 }, uShadowCount: { value: 0 }, uShadowTexel: { value: 1 },
  });
  private blurMat = passMaterial(BLUR_FRAG, { tAO: { value: null }, uRes: { value: new Vector2(1, 1) } });
  private blurFetchMat = passMaterial(BLUR_FRAG, { tAO: { value: null }, uRes: { value: new Vector2(1, 1) } }, { defines: { AO_FETCH: 1 } });
  private applyMat = passMaterial(APPLY_FRAG, {
    tDepth: { value: null }, uInvProj: { value: new Matrix4() }, uFar: { value: 2e7 }, uDepthRes: { value: new Vector2(1, 1) },
    tScene: { value: null }, tAO: { value: null }, uAoRes: { value: new Vector2(1, 1) }, uAoStrength: { value: 0.9 }, uAoOn: { value: 1 },
  });
  private copyMat = passMaterial(COPY_FRAG, { tIn: { value: null } });
  private w = 0;
  private h = 0;

  private own(which: 'ao' | 'blur'): WebGLRenderTarget {
    let t = this[which];
    if (!t) {
      t = new WebGLRenderTarget(Math.max(2, this.w), Math.max(2, this.h), { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
      t.texture.name = which === 'ao' ? 'gtao' : 'gtaoBlur';
      if (which === 'ao') t.texture.minFilter = t.texture.magFilter = NearestFilter;
      this[which] = t;
    } else if (t.width !== this.w || t.height !== this.h) t.setSize(this.w, this.h);
    return t;
  }

  setSize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.ao?.setSize(w, h);
    this.blur?.setSize(w, h);
  }

  /** a lent target the pass may use (its size and format), else null */
  private fits(t: WebGLRenderTarget | null | undefined): WebGLRenderTarget | null {
    return t && t.width === this.w && t.height === this.h && t.samples === 0 && t.texture.type === HalfFloatType && t.texture.format === RGBAFormat ? t : null;
  }

  /** the cascaded sun shadow uniforms (by reference) for the sun-share estimate */
  bindShadows(shadow: Record<string, IUniform>): void {
    for (const k of Object.keys(shadow)) this.aoMat.uniforms[k] = shadow[k];
  }

  /** the blurred AO target (r = AO, g = view depth, b = sun share) and its resolution, for the folded apply */
  get result(): Texture { return (this.res ?? this.own('blur')).texture; }
  get resultSize(): [number, number] { return [this.w, this.h]; }

  /**
   * AO + sun share of the current depth into the blurred target. sunView: direction to the sun in view space;
   * skyRatio: sky / direct-sun irradiance at the camera; sunUp: 0..1 the sun is above the horizon.
   */
  compute(r: WebGLRenderer, fsq: FullscreenQuad, s: AoSettings, depth: Texture, invProj: Matrix4, proj: Matrix4, far: number,
          fullW: number, fullH: number, frame: number, sunView: Vector3, skyRatio: number, sunUp: number,
          scratch: WebGLRenderTarget | null = null, blurTo: WebGLRenderTarget | null = null): void {
    const aw = Math.max(2, Math.round(fullW * s.scale)), ah = Math.max(2, Math.round(fullH * s.scale));
    this.setSize(aw, ah);
    (this.aoMat.uniforms.uSunView.value as Vector3).copy(sunView);
    this.aoMat.uniforms.uSkyRatio.value = skyRatio;
    this.aoMat.uniforms.uSunUp.value = sunUp;
    const a = this.aoMat.uniforms;
    a.tDepth.value = depth;
    a.uInvProj.value.copy(invProj);
    a.uFar.value = far;
    a.uDepthRes.value.set(fullW, fullH);
    a.uRes.value.set(aw, ah);
    // projection[1][1] = 1 / tan(fov / 2): pixels per metre at unit depth = proj11 · height / 2
    a.uProjScale.value = proj.elements[5] * ah * 0.5;
    a.uRadius.value = s.radius;
    a.uSlices.value = s.slices;
    a.uSteps.value = s.steps;
    a.uFrameMod.value = frame % 2;
    const raw = this.fits(scratch) ?? this.own('ao');
    fsq.render(r, this.aoMat, raw);
    const bm = raw === this.ao ? this.blurMat : this.blurFetchMat;
    const b = bm.uniforms;
    b.tAO.value = raw.texture;
    b.uRes.value.set(aw, ah);
    this.res = this.fits(blurTo) ?? this.own('blur');
    fsq.render(r, bm, this.res);
  }

  /** the standalone apply (worlds without air): `scene` × AO into `out`, copied on into `back` when given */
  apply(r: WebGLRenderer, fsq: FullscreenQuad, s: AoSettings, depth: Texture, invProj: Matrix4, far: number,
        fullW: number, fullH: number, scene: Texture, out: WebGLRenderTarget, back: WebGLRenderTarget | null = null): void {
    const aw = this.w, ah = this.h;
    const p = this.applyMat.uniforms;
    p.tDepth.value = depth;
    p.uInvProj.value.copy(invProj);
    p.uFar.value = far;
    p.uDepthRes.value.set(fullW, fullH);
    p.tScene.value = scene;
    p.tAO.value = this.result;
    p.uAoRes.value.set(aw, ah);
    p.uAoStrength.value = s.strength;
    fsq.render(r, this.applyMat, out);
    if (back) {
      // (no auto clear: `back` carries the scene's depth attachment, which every later pass still reads)
      this.copyMat.uniforms.tIn.value = out.texture;
      const prevClear = r.autoClear;
      r.autoClear = false;
      fsq.render(r, this.copyMat, back);
      r.autoClear = prevClear;
    }
  }

  dispose(): void {
    this.ao?.dispose(); this.blur?.dispose();
    this.aoMat.dispose(); this.blurMat.dispose(); this.blurFetchMat.dispose(); this.applyMat.dispose(); this.copyMat.dispose();
  }
}
