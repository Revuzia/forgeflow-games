// GENESIS — PERF s20 `?tnoise=tex`: the terrain fragment's simplex noise read from a 3D TEXTURE instead of computed.
// Round 10 on the M5: the terrain's procedural surface is the frame's main cost and `tshade=nonoise` (every noise call
// a constant) took 550 -> 399 ms. One arithmetic snoise is ~150 ALU ops; one trilinear tap of an RGBA16F volume replaces it.
//   * the volume holds snoise ITSELF (noise.glsl.ts, the same function, rendered once at boot, 8 texels per lattice
//     unit: trilinear error under ~2 % of the range), made periodic by cross-fading it with its own shifted copies
//     over the last TN_BLEND units of each axis (weights renormalised, so the variance holds through the blend);
//   * every call site looks it up through one of four fixed rotations (by __LINE__): the volume repeats every
//     `period` lattice units along ITS axes, and on a sphere a periodic volume shows as rows of look-alike blobs in
//     thin bands around the three great circles normal to those axes; with four rotations the bands of the terms of
//     one fragment never coincide, so no place on the planet has all its breakup repeating at once;
//   * textureLod(.., 0): no implicit derivatives (the calls sit inside dynamic branches) and no mip chain: every term is
//     already faded by its pixel footprint (aaF) exactly as with the arithmetic noise;
//   * NOT replaced: snoiseGrad (6 sites, analytic gradient for the micro normal: very near ground only) and voronoi3
//     (10 sites; `tshade=novor` was no gain on the M5).
// Default off; `?tnoise=tex` = 128^3 (period 16, 16.8 MB), `?tnoise=tex256` = 256^3 (period 32, 134 MB).
import {
  Data3DTexture, GLSL3, HalfFloatType, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, RawShaderMaterial,
  RepeatWrapping, RGBAFormat, UnsignedByteType, Vector2, Vector3, WebGL3DRenderTarget,
  type IUniform, type Texture, type WebGLRenderer,
} from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { perfList, perfNumEff } from '../perfswitch.ts';

const SET = perfList('tnoise');
/** the terrain fragment reads its simplex noise from the volume */
export const TNOISE = SET.has('tex') || SET.has('tex256');
/** PERF s21 `?wfast=1` (ocean.ts): the water reads the same volume, so it is built when either switch is on
 *  (`wfast` is a number: 3 = the default water (oceanfast.ts), 0 = the reference water, 1 / 2 = the s21 variants) */
export const WNOISE = perfNumEff('wfast', 3) === 1;
const TN_N = SET.has('tex256') ? 256 : 128;
const TN_TEXELS = 8;                  // texels per lattice unit of snoise
const TN_PERIOD = TN_N / TN_TEXELS;   // lattice units before the volume repeats
const TN_BLEND = 3;                   // units of cross-fade at the end of each axis

// a placeholder (noise = 0) until the volume is rendered: the first frame calls ensureTNoise before anything draws
const blank = new Data3DTexture(new Uint8Array(4), 1, 1, 1);
blank.format = RGBAFormat; blank.type = UnsignedByteType; blank.needsUpdate = true;

/** uniforms of the terrain program when TNOISE: the volume, and (scale, bias) decoding its red channel */
export const TNOISE_UNIFORMS: Record<string, IUniform> = {
  uTNoise: { value: blank as Texture },
  uTNoiseK: { value: new Vector2(1, 0) },
};

// four rotations (unit quaternions, fixed), scaled by 1 / period: lattice units -> texture coordinates
function rot(q: [number, number, number, number]): string {
  const l = Math.hypot(...q); const [x, y, z, w] = q.map((v) => v / l);
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ];
  return `mat3(${m.map((v) => (v / TN_PERIOD).toFixed(8)).join(', ')})`;
}
const ROTS = [[0.19, 0.41, -0.27, 0.85], [-0.52, 0.13, 0.36, 0.76], [0.31, -0.62, 0.48, 0.53], [0.71, 0.29, 0.57, -0.3]] as [number, number, number, number][];

/** the volume's uniforms and its tap functions (no macros): ocean.ts uses these with its own call sites */
export const NOISETEX_FN_GLSL = /* glsl */ `
uniform highp sampler3D uTNoise;
uniform vec2 uTNoiseK;
const mat3 TN_ROT[4] = mat3[4](${ROTS.map(rot).join(',\n  ')});
float snoiseT(vec3 v, int site) {
  vec3 u = fract(TN_ROT[site & 3] * v);
  vec4 s = textureLod(uTNoise, u, 0.0) * uTNoiseK.x + uTNoiseK.y;
  // r = the noise at the texel centres, gba = 4 x its second differences along x y z: the trilinear value minus the
  // quadratic term is an interpolant with a CONTINUOUS gradient (slope = the central difference at every texel centre),
  // so the bump normal taken from it by screen derivatives does not facet by texel
  vec3 t = fract(u * ${TN_N}.0 - 0.5);
  return s.r - 0.125 * dot(t * (1.0 - t), s.gba);
}
float fbm3T(vec3 p, int site) { return 0.5 * snoiseT(p, site) + 0.25 * snoiseT(p * 2.03 + 17.1, site + 1) + 0.125 * snoiseT(p * 4.07 - 9.3, site + 2); }
`;
/** GLSL placed after the noise library in the terrain fragment: later snoise / fbm3 calls become taps */
export const TNOISE_GLSL = !TNOISE ? '' : NOISETEX_FN_GLSL + /* glsl */ `
#define snoise(p) snoiseT(p, __LINE__)
#define fbm3(p) fbm3T(p, __LINE__)
`;

const GEN_FRAG = /* glsl */ `
precision highp float;
${NOISE_GLSL}
uniform float uZ;
uniform vec3 uGen;   // texels per unit, period, blend
uniform vec2 uEnc;   // value -> stored: scale, bias
out vec4 outColor;
float tiled(vec3 v) {
  float P = uGen.y;
  v = mod(v, P);
  vec3 t = smoothstep(P - uGen.z, P, v);
  float s = 0.0;
  for (int k = 0; k < 8; k++) {
    vec3 c = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 w3 = mix(1.0 - t, t, c);
    float w = w3.x * w3.y * w3.z;
    if (w > 0.0) s += w * snoise(v - P * c);
  }
  vec3 n2 = (1.0 - t) * (1.0 - t) + t * t;
  return s / sqrt(n2.x * n2.y * n2.z);
}
void main() {
  vec3 v = vec3(gl_FragCoord.xy, uZ + 0.5) / uGen.x;
  vec3 e = vec3(1.0 / uGen.x, 0.0, 0.0);
  float f = tiled(v);
  vec3 d2 = vec3(tiled(v + e.xyy) + tiled(v - e.xyy), tiled(v + e.yxy) + tiled(v - e.yxy), tiled(v + e.yyx) + tiled(v - e.yyx)) - 2.0 * f;
  outColor = vec4(f, d2 * 4.0) * uEnc.x + uEnc.y;
}`;

let built = false;
/** bytes the volume holds on the GPU (0 until built / when off) */
export let tnoiseBytes = 0;

/** render the volume once (call at the top of a frame, outside any render pass); a no-op afterwards and when off */
export function ensureTNoise(r: WebGLRenderer): void {
  if (!(TNOISE || WNOISE) || built) return;
  built = true;
  const half = r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float');
  if (!half) console.warn('[genesis] tnoise: no float render target, the noise volume is 8-bit');
  const rt = new WebGL3DRenderTarget(TN_N, TN_N, TN_N, {
    format: RGBAFormat, type: half ? HalfFloatType : UnsignedByteType,
    minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
  rt.texture.wrapS = rt.texture.wrapT = RepeatWrapping; rt.texture.wrapR = RepeatWrapping;
  rt.texture.name = 'tnoise';
  const enc = half ? new Vector2(1, 0) : new Vector2(0.5, 0.5);
  const mat = new RawShaderMaterial({
    glslVersion: GLSL3, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { uZ: { value: 0 }, uGen: { value: new Vector3(TN_TEXELS, TN_PERIOD, TN_BLEND) }, uEnc: { value: enc } },
    vertexShader: 'in vec3 position;\nvoid main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: GEN_FRAG,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = r.getRenderTarget(), prevCube = r.getActiveCubeFace(), prevMip = r.getActiveMipmapLevel();
  const auto = r.autoClear;
  r.autoClear = false;
  for (let z = 0; z < TN_N; z++) {
    mat.uniforms.uZ.value = z;
    r.setRenderTarget(rt, z);
    r.render(quad, cam);
  }
  r.setRenderTarget(prev, prevCube, prevMip);
  r.autoClear = auto;
  quad.geometry.dispose(); mat.dispose();
  TNOISE_UNIFORMS.uTNoise.value = rt.texture;
  (TNOISE_UNIFORMS.uTNoiseK.value as Vector2).set(half ? 1 : 2, half ? 0 : -1);
  tnoiseBytes = TN_N ** 3 * (half ? 8 : 4);
}
