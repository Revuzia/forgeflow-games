// The set: a procedural dusk-indigo sky dome, a dark felt play-mat disc (procedural fibre grain, soft vignette, a stitched ring)
// and, beyond the mat, an ANALYTIC ground plane drawn by the same dome shader. The dome is one full-screen-covering sphere
// drawn last at the far plane: for rays that point down it intersects the ground plane analytically and fogs to the sky colour
// at the horizon, so the horizon is a continuous gradient at every aspect ratio and camera pitch (the earlier finite ground disc
// ended inside the view and left a hard-edged lighter band at the top of the frame).
// (The per-body decals: contact shadow and light pool, live in decals.ts.)
import * as THREE from 'three';
import { NOISE_GLSL } from './shaderlib.ts';
import type { EnvHub } from './env.ts';

export const PALETTE = {
  ink: 0x14102a, plum: 0x2a1744, dusk: 0x5b3a86, felt: 0x2a2150, amber: 0xffb347, lagoon: 0x59d6e6, ember: 0xff5a4d, cream: 0xfff1d6,
} as const;

export const GROUND_Y = -0.045;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;
const SKY_FN = /* glsl */`
uniform vec3 uZenith; uniform vec3 uInk; uniform vec3 uPlum; uniform vec3 uHorizon;
uniform vec3 uGlowWarm; uniform vec3 uGlowCool;
uniform vec3 uBase; uniform vec3 uWarm;
uniform float uGroundY; uniform float uFogNear; uniform float uFogFar;
vec3 whSky(vec3 d) {
  float e = max(d.y, 0.0);
  vec3 c = mix(uHorizon, uPlum, smoothstep(0.0, 0.2, e));
  c = mix(c, uInk, smoothstep(0.12, 0.6, e));
  c = mix(c, uZenith, smoothstep(0.55, 1.0, e));
  float up = smoothstep(-0.02, 0.05, e) * (1.0 - smoothstep(0.08, 0.5, e));
  vec2 az = normalize(vec2(d.x, d.z) + vec2(1e-5));
  c += uGlowWarm * pow(max(dot(az, normalize(vec2(0.3, -0.95))), 0.0), 7.0) * up;
  c += uGlowCool * pow(max(dot(az, normalize(vec2(-0.75, -0.6))), 0.0), 6.0) * up;
  return c;
}
`;
const SKY_FRAG = /* glsl */`
varying vec3 vDir;
${SKY_FN}
${NOISE_GLSL}
void main() {
  vec3 d = normalize(vDir);
  vec3 sky = whSky(d);
  vec3 col = sky;
  if (d.y < 0.004) {
    float h = max(cameraPosition.y - uGroundY, 0.05);
    float t = h / max(-d.y, 1e-4);                       // distance along the ray to the ground plane
    vec2 hp = cameraPosition.xz + d.xz * t;              // hit point
    vec3 ground = uBase * (0.8 + 0.4 * whNoise2(hp * 1.7)) + uWarm * exp(-length(hp) * 0.42);
    float fog = smoothstep(uFogNear, uFogFar, t);
    vec3 horizon = whSky(normalize(vec3(d.x, 0.0, d.z)));
    vec3 gcol = mix(ground, horizon, fog);
    col = mix(gcol, sky, smoothstep(-0.003, 0.004, d.y));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb += (whHash21(gl_FragCoord.xy) - 0.5) / 255.0;
}
`;

const FELT_PARS = /* glsl */`
varying vec3 vWP;
uniform float uMatR;
uniform float uFibre;
uniform float uOctaves;
uniform float uStitch;
uniform float uVigIn;
uniform float uVigOut;
uniform vec3 uStitchCol;
uniform vec3 uFogCol;
uniform float uFogNear;
uniform float uFogFar;
float jFibre = 0.5;
${NOISE_GLSL}
vec3 jBump(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;
const FELT_COLOR = /* glsl */`
#include <color_fragment>
{
  vec2 fp = vWP.xz;
  float r = length(fp);
  float fw = max(length(fwidth(fp)), 1e-5);
  // band-limited grain: each octave only contributes while its cells are ~1.5..9 px wide (no aliasing far away,
  // no visible lattice blocks up close), so the felt always reads as fine fibre
  float fib = 0.0, wsum = 0.0;
  float ang = whHash21(floor(fp * 5.0)) * 6.2832;
  vec2 rp = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * fp;
  for (int o = 0; o < 4; o++) {
    if (float(o) >= uOctaves) break;
    float fq = o == 0 ? 40.0 : o == 1 ? 110.0 : o == 2 ? 300.0 : 800.0;
    float px = 1.0 / (fq * fw);
    float wgt = smoothstep(1.2, 2.4, px) * (1.0 - smoothstep(6.0, 12.0, px));
    float n = o == 3 ? whNoise2(rp * vec2(fq * 0.5, fq * 4.0)) : whNoise2(fp * fq + float(o) * 7.3);
    fib += wgt * (n - 0.5);
    wsum += wgt;
  }
  fib = 0.5 + fib / max(0.6, wsum) * 0.55;
  jFibre = fib;
  diffuseColor.rgb *= 0.64 + 0.72 * mix(0.5, fib, uFibre);
  diffuseColor.rgb *= 0.86 + 0.28 * whNoise2(fp * 2.1 + 3.0);
  diffuseColor.rgb *= mix(1.0, 0.3, smoothstep(uVigIn, uVigOut, r));
  // stitched ring, anti-aliased against its own pixel footprint (at grazing angles near the far edge it used to alias into a
  // dotted line along the horizon): the ring widens to >= ~1.5 px and loses coverage, the dash pattern relaxes to its mean
  float fr = max(fwidth(r), 1e-5);
  float arc = atan(fp.y, fp.x) * 64.0 / 6.2832;
  float dashes = mix(0.5, step(0.5, fract(arc)), 1.0 - smoothstep(0.25, 0.6, fwidth(arc)));
  float ring = 1.0 - smoothstep(max(0.004, fr * 0.5), max(0.011, fr * 1.5), abs(r - (uMatR - 0.16)));
  ring *= min(1.0, 0.012 / (fr * 1.5));
  diffuseColor.rgb = mix(diffuseColor.rgb, uStitchCol, ring * dashes * uStitch);
}
`;
const FELT_NORMAL = /* glsl */`
#include <normal_fragment_maps>
{
  vec2 dH = vec2(dFdx(jFibre), dFdy(jFibre)) * uFibre * 0.5;
  normal = jBump(-vViewPosition, normal, dH, faceDirection);
}
`;
const FELT_FOG = /* glsl */`
{
  float fogT = smoothstep(uFogNear, uFogFar, length(vWP - cameraPosition));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogCol, fogT);
}
`;

interface FeltOpts { env: number; color: number; roughness: number; fibre: number; stitch: number; vigIn: number; vigOut: number; matR: number; fogCol: THREE.Color }

const feltUniforms = new WeakMap<THREE.Material, { uOctaves: { value: number }; uFibre: { value: number } }>();

function makeFelt(o: FeltOpts, hub: EnvHub): THREE.MeshPhysicalMaterial {
  // physical, only for specularIntensity: felt scatters, it must not mirror the cyan rim at grazing angles
  const mat = new THREE.MeshPhysicalMaterial({ color: o.color, roughness: o.roughness, metalness: 0, specularIntensity: 0.1 });
  hub.apply(mat, o.env);
  const u = {
    uMatR: { value: o.matR }, uFibre: { value: o.fibre }, uOctaves: { value: 4 }, uStitch: { value: o.stitch },
    uVigIn: { value: o.vigIn }, uVigOut: { value: o.vigOut },
    uStitchCol: { value: new THREE.Color(PALETTE.dusk).multiplyScalar(1.1) },
    uFogCol: { value: o.fogCol }, uFogNear: { value: 5 }, uFogFar: { value: 22 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FELT_PARS)
      .replace('#include <color_fragment>', FELT_COLOR)
      .replace('#include <normal_fragment_maps>', FELT_NORMAL)
      .replace('#include <fog_fragment>', FELT_FOG);
  };
  mat.customProgramCacheKey = () => 'wh-felt-v2';
  feltUniforms.set(mat, u);
  return mat;
}


export class Table {
  readonly group = new THREE.Group();
  private readonly sky: THREE.Mesh;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly matTop: THREE.Mesh;
  private readonly feltMat: THREE.MeshPhysicalMaterial;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly hub: EnvHub;

  constructor(hub: EnvHub) {
    this.hub = hub;
    const fogCol = new THREE.Color(PALETTE.dusk).multiplyScalar(0.62).convertLinearToSRGB();
    const skyU = {
      uZenith: { value: new THREE.Color(0x0a0818) }, uInk: { value: new THREE.Color(PALETTE.ink) }, uPlum: { value: new THREE.Color(PALETTE.plum) },
      uHorizon: { value: new THREE.Color(PALETTE.dusk).multiplyScalar(0.62) },
      uGlowWarm: { value: new THREE.Color(PALETTE.amber).multiplyScalar(0.14) }, uGlowCool: { value: new THREE.Color(PALETTE.lagoon).multiplyScalar(0.03) },
      uBase: { value: new THREE.Color(0x140e2a) }, uWarm: { value: new THREE.Color(PALETTE.amber).multiplyScalar(0.012) },
      uGroundY: { value: GROUND_Y }, uFogNear: { value: 4 }, uFogFar: { value: 26 },
    };
    this.skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: skyU, side: THREE.BackSide, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    const skyGeo = new THREE.SphereGeometry(1, 48, 32);
    this.geos.push(skyGeo);
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.renderOrder = -100;  // FIRST of the opaque list: everything additive (halos, aura, pool) draws over it
    this.sky.frustumCulled = false;
    this.sky.scale.setScalar(90);

    // felt mat (cylinder: top at y = 0, a visible lip)
    const MAT_R = 3.5;
    this.feltMat = makeFelt({ env: 0.2, color: PALETTE.felt, roughness: 0.92, fibre: 1, stitch: 1, vigIn: 0.9, vigOut: MAT_R * 0.98, matR: MAT_R, fogCol }, hub);
    const matGeo = new THREE.CylinderGeometry(MAT_R, MAT_R, 0.06, 128, 1);
    matGeo.translate(0, -0.03, 0);
    this.geos.push(matGeo);
    this.matTop = new THREE.Mesh(matGeo, this.feltMat);
    this.matTop.renderOrder = -50;
    this.group.add(this.sky, this.matTop);
  }

  /** Low tier: two grain octaves instead of four (the felt covers half the screen). */
  setLite(on: boolean): void { const u = feltUniforms.get(this.feltMat); if (u) u.uOctaves.value = on ? 2 : 4; }

  update(camera: THREE.Camera): void { this.sky.position.copy(camera.position); }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.hub.release(this.feltMat);
    this.skyMat.dispose(); this.feltMat.dispose();
  }
}
