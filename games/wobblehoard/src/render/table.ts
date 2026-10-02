// The set: procedural dusk-indigo sky dome, a dark felt play-mat disc (procedural fibre grain, soft vignette, a stitched
// ring) on a darker table that fades into the horizon, plus the two decals that sit under the body: a soft contact
// shadow and the coloured light pool (fake caustic) that widens and brightens as the body squashes.
//
// Everything that must be refracted by the jelly lives in the OPAQUE list (so it ends up in three's transmission
// target): the sky, mat, ground, shadow and pool all use blending states that work without `transparent`.
import * as THREE from 'three';
import { NOISE_GLSL } from './shaderlib.ts';
import type { Rgb } from './oklch.ts';
import type { EnvHub } from './env.ts';

export const PALETTE = {
  ink: 0x14102a, plum: 0x2a1744, dusk: 0x5b3a86, felt: 0x2a2150, amber: 0xffb347, lagoon: 0x59d6e6, ember: 0xff5a4d, cream: 0xfff1d6,
} as const;

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
vec3 whSkyLinear(vec3 d) {
  float e = d.y;
  vec3 c = mix(uHorizon, uPlum, smoothstep(0.0, 0.2, e));
  c = mix(c, uInk, smoothstep(0.12, 0.6, e));
  c = mix(c, uZenith, smoothstep(0.55, 1.0, e));
  float up = smoothstep(-0.02, 0.05, e) * (1.0 - smoothstep(0.08, 0.5, e)) + 0.55 * (1.0 - smoothstep(-0.12, 0.0, e));
  c += uGlowWarm * pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(0.3, 0.0, -0.95))), 0.0), 7.0) * up;
  c += uGlowCool * pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(-0.75, 0.0, -0.6))), 0.0), 6.0) * up;
  return c;
}
vec3 whToSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
`;
const SKY_FRAG = /* glsl */`
varying vec3 vDir;
${SKY_FN}
${NOISE_GLSL}
void main() {
  gl_FragColor = vec4(whSkyLinear(normalize(vDir)), 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb += (whHash21(gl_FragCoord.xy) - 0.5) / 255.0;
}
`;

const FELT_PARS = /* glsl */`
varying vec3 vWP;
uniform float uMatR;
uniform float uFibre;
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
  float fw = length(fwidth(fp));
  float kA = 1.0 - smoothstep(0.006, 0.014, fw);
  float kB = 1.0 - smoothstep(0.0022, 0.005, fw);
  float a = whNoise2(fp * 70.0);
  float b = whNoise2(fp * 210.0 + 9.0);
  float ang = whHash21(floor(fp * 5.0)) * 6.2832;
  vec2 rp = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * fp;
  float s = whNoise2(rp * vec2(34.0, 260.0));
  float fib = mix(0.5, a, kA) * 0.55 + mix(0.5, b, kB) * 0.25 + mix(0.5, s, kB) * 0.3;
  jFibre = fib;
  diffuseColor.rgb *= 0.45 + 1.1 * mix(0.5, fib, uFibre);
  diffuseColor.rgb *= 0.86 + 0.28 * whNoise2(fp * 2.1 + 3.0);
  diffuseColor.rgb *= mix(1.0, 0.3, smoothstep(uVigIn, uVigOut, r));
  float dashes = step(0.5, fract(atan(fp.y, fp.x) * 64.0 / 6.2832));
  float ring = 1.0 - smoothstep(0.004, 0.011, abs(r - (uMatR - 0.16)));
  diffuseColor.rgb = mix(diffuseColor.rgb, uStitchCol, ring * dashes * uStitch);
}
`;
const FELT_NORMAL = /* glsl */`
#include <normal_fragment_maps>
{
  vec2 dH = vec2(dFdx(jFibre), dFdy(jFibre)) * uFibre * 0.6;
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

function makeFelt(o: FeltOpts, hub: EnvHub): THREE.MeshPhysicalMaterial {
  // physical, only for specularIntensity: felt scatters, it must not mirror the cyan rim at grazing angles
  const mat = new THREE.MeshPhysicalMaterial({ color: o.color, roughness: o.roughness, metalness: 0, specularIntensity: 0.1 });
  hub.apply(mat, o.env);
  const u = {
    uMatR: { value: o.matR }, uFibre: { value: o.fibre }, uStitch: { value: o.stitch },
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
  mat.customProgramCacheKey = () => 'wh-felt-v1';
  return mat;
}

const GROUND_VERT = /* glsl */`
varying vec3 vWP;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;
const GROUND_FRAG = /* glsl */`
varying vec3 vWP;
uniform vec3 uBase;
uniform vec3 uWarm;
uniform float uFogNear;
uniform float uFogFar;
${SKY_FN}
${NOISE_GLSL}
void main() {
  float r = length(vWP.xz);
  vec3 c = uBase * (0.8 + 0.4 * whNoise2(vWP.xz * 1.7)) + uWarm * exp(-r * 0.42);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  vec3 rd = normalize(vWP - cameraPosition);
  float fogT = smoothstep(uFogNear, uFogFar, length(vWP - cameraPosition));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, whToSrgb(whSkyLinear(vec3(rd.x, 0.0, rd.z))), fogT);
}
`;

const DECAL_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const SHADOW_FRAG = /* glsl */`
varying vec2 vUv;
uniform float uStrength;
uniform float uSoft;   // 1 = tight contact shadow, 0 = very soft
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r2 = dot(p, p);
  float tight = exp(-r2 * mix(3.0, 11.0, uSoft)) * 0.62;
  float wide = exp(-r2 * mix(1.6, 3.2, uSoft)) * 0.42;
  float edge = 1.0 - smoothstep(0.7, 1.0, sqrt(r2));
  float a = clamp((tight + wide) * uStrength * edge, 0.0, 0.92);
  gl_FragColor = vec4(0.012, 0.004, 0.035, a);
}
`;
const POOL_FRAG = /* glsl */`
varying vec2 vUv;
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
uniform float uRing;
${NOISE_GLSL}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float body = exp(-r * r * 5.0);
  float fringe = exp(-pow((r - 0.62) * 4.2, 2.0)) * uRing;       // caustic fringe just outside the shadow edge
  float cau = 0.8 + 0.4 * whNoise2(p * 7.0 + vec2(uTime * 0.25, -uTime * 0.18));
  float edge = 1.0 - smoothstep(0.78, 1.0, r);
  float a = (body * 0.75 + fringe * 0.55) * cau * edge * uStrength;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface Footprint {
  cx: number; cz: number;      // body centre on the table plane
  rx: number; rz: number;      // horizontal half extents of the body
  lowY: number;                // height of the lowest vertex above the table (0 when resting)
  compression: number;         // metrics.compression 0..1
  stretch: number;             // metrics.stretch 0..1
}

export class Table {
  readonly group = new THREE.Group();
  private readonly sky: THREE.Mesh;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly matTop: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private readonly feltMat: THREE.MeshPhysicalMaterial;
  private readonly groundMat: THREE.ShaderMaterial;
  private readonly shadow: THREE.Mesh;
  private readonly shadowMat: THREE.ShaderMaterial;
  private readonly pool: THREE.Mesh;
  private readonly poolMat: THREE.ShaderMaterial;
  private readonly geos: THREE.BufferGeometry[] = [];
  private floatT = 0;
  private floatTarget = 0;
  private poolK = 1;

  private readonly hub: EnvHub;

  constructor(hub: EnvHub) {
    this.hub = hub;
    const fogCol = new THREE.Color(PALETTE.dusk).multiplyScalar(0.62).convertLinearToSRGB(); // sky horizon colour, display-encoded
    // sky dome
    const skyU = {
      uZenith: { value: new THREE.Color(0x0a0818) }, uInk: { value: new THREE.Color(PALETTE.ink) }, uPlum: { value: new THREE.Color(PALETTE.plum) },
      uHorizon: { value: new THREE.Color(PALETTE.dusk).multiplyScalar(0.62) },
      uGlowWarm: { value: new THREE.Color(PALETTE.amber).multiplyScalar(0.14) }, uGlowCool: { value: new THREE.Color(PALETTE.lagoon).multiplyScalar(0.03) },
    };
    this.skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: skyU, side: THREE.BackSide, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    const skyGeo = new THREE.SphereGeometry(1, 32, 20);
    this.geos.push(skyGeo);
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.renderOrder = -100;
    this.sky.frustumCulled = false;
    this.sky.scale.setScalar(90);

    // felt mat (cylinder: top at y = 0, a visible lip) and the dark table that fades into the horizon
    const MAT_R = 3.5;
    this.feltMat = makeFelt({ env: 0.2, color: PALETTE.felt, roughness: 0.92, fibre: 1, stitch: 1, vigIn: 0.9, vigOut: MAT_R * 0.98, matR: MAT_R, fogCol }, hub);
    const matGeo = new THREE.CylinderGeometry(MAT_R, MAT_R, 0.06, 128, 1);
    matGeo.translate(0, -0.03, 0);
    this.geos.push(matGeo);
    this.matTop = new THREE.Mesh(matGeo, this.feltMat);
    this.matTop.renderOrder = -50;

    this.groundMat = new THREE.ShaderMaterial({
      vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, fog: false,
      uniforms: {
        ...skyU,
        uBase: { value: new THREE.Color(0x140e2a) }, uWarm: { value: new THREE.Color(PALETTE.amber).multiplyScalar(0.012) },
        uFogNear: { value: 4 }, uFogFar: { value: 20 },
      },
    });
    const groundGeo = new THREE.CircleGeometry(80, 64);
    groundGeo.rotateX(-Math.PI / 2);
    this.geos.push(groundGeo);
    this.ground = new THREE.Mesh(groundGeo, this.groundMat);
    this.ground.position.y = -0.045;
    this.ground.renderOrder = -60;

    // decals: unit quads lying on the mat
    const quad = new THREE.PlaneGeometry(2, 2);
    quad.rotateX(-Math.PI / 2);
    this.geos.push(quad);
    this.shadowMat = new THREE.ShaderMaterial({
      vertexShader: DECAL_VERT, fragmentShader: SHADOW_FRAG, uniforms: { uStrength: { value: 1 }, uSoft: { value: 1 } },
      transparent: false, depthWrite: false, depthTest: true, toneMapped: false, fog: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.shadow = new THREE.Mesh(quad, this.shadowMat);
    this.shadow.renderOrder = -40;
    this.shadow.position.y = 0.002;
    this.shadow.frustumCulled = false;

    this.poolMat = new THREE.ShaderMaterial({
      vertexShader: DECAL_VERT, fragmentShader: POOL_FRAG,
      uniforms: { uColor: { value: new THREE.Color(1, 0.6, 0.3) }, uStrength: { value: 1 }, uTime: { value: 0 }, uRing: { value: 1 } },
      transparent: false, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.pool = new THREE.Mesh(quad, this.poolMat);
    this.pool.renderOrder = -39;
    this.pool.position.y = 0.003;
    this.pool.frustumCulled = false;

    this.group.add(this.sky, this.ground, this.matTop, this.shadow, this.pool);
  }

  setPoolColor(c: Rgb): void { this.poolMat.uniforms.uColor.value.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace); }
  setFloat(on: boolean): void { this.floatTarget = on ? 1 : 0; }
  setFloatImmediate(on: boolean): void { this.floatTarget = on ? 1 : 0; this.floatT = this.floatTarget; }

  update(dt: number, time: number, camera: THREE.Camera, f: Footprint | null): void {
    this.sky.position.copy(camera.position);
    this.floatT += (this.floatTarget - this.floatT) * (1 - Math.exp(-dt * 5));
    this.poolMat.uniforms.uTime.value = time;
    if (!f) { this.shadow.visible = false; this.pool.visible = false; return; }
    this.shadow.visible = this.pool.visible = true;
    const h = Math.max(0, f.lowY);
    const lift = 1 / (1 + h * 1.6);                                  // body above the table: shadow thins out
    const fl = this.floatT;
    const rad = Math.max(f.rx, f.rz);
    // contact shadow: a little larger than the footprint, much softer and smaller-contrast in float mode
    const sS = 1.18 + 0.55 * fl + 0.45 * h;
    this.shadow.position.set(f.cx, 0.002, f.cz);
    this.shadow.scale.set(f.rx * sS + 0.05, 1, f.rz * sS + 0.05);
    this.shadowMat.uniforms.uStrength.value = (0.95 - 0.38 * fl) * lift;
    this.shadowMat.uniforms.uSoft.value = Math.max(0, 1 - 0.75 * fl - 0.5 * Math.min(1, h * 1.5));
    // light pool: widens and brightens with the squash; softer and smaller while floating
    const squash = Math.min(1, f.compression * 1.2 + f.stretch * 0.15);
    const pS = (1.22 + 0.8 * squash + 0.2 * h) * (1 - 0.1 * fl);
    this.poolK += ((0.3 + 0.7 * squash) - this.poolK) * (1 - Math.exp(-dt * 10));
    this.pool.position.set(f.cx, 0.003, f.cz);
    this.pool.scale.set(f.rx * pS + 0.1, 1, f.rz * pS + 0.1);
    this.poolMat.uniforms.uStrength.value = this.poolK * (1 - 0.5 * fl) * (0.85 / (1 + h * 0.9));
    this.poolMat.uniforms.uRing.value = 1 - 0.55 * fl;
    void rad;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.hub.release(this.feltMat);
    this.skyMat.dispose(); this.feltMat.dispose(); this.groundMat.dispose(); this.shadowMat.dispose(); this.poolMat.dispose();
  }
}
