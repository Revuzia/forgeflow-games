// GENESIS — auroras (CONTRACT.md §15.3 "auroras near magnetic poles when magnetism > 0 and star activity / storms",
// §15.7 "aurora curtains", "solar flare: aurora surge").
//
// Around each magnetic pole (the spin poles tilted a little) an oval of folded curtains hangs at the top of the air:
// a ring of ribbons whose path wanders in latitude with slowly drifting folds, each ribbon a sheet of vertical rays —
// a sharp, bright green lower edge, fading up through green into red and violet — rippling as the folds travel.
// It is pure emission (added light), so it shows only against a dark sky: the night side, from the ground (curtains
// overhead at high latitudes, low on the horizon further south) and from orbit (glowing ovals round the poles). Its
// strength is magnetism × (a quiet glow + the star's activity + storms: GodFx adds solar flares, magnetic storms and
// aurora-storm weather), and it fades where the sun is up.

import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import { ADD_LIGHT, FX_DEPTH_GLSL, FX_LAYER } from '../fx/fxcommon.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';

const VERT = /* glsl */ `
uniform float uR0;
uniform float uR1;
uniform float uLat;
uniform float uPole;
uniform float uFxTime;
uniform vec3 uTilt;
attribute vec2 aUV;      // u around the oval (0..1), v up the curtain (0..1)
varying vec2 vUV;
varying float vZ;
varying vec3 vB;
varying float vFold;
void main() {
  float u = aUV.x, v = aUV.y;
  float lon = u * 6.2831853;
  // the oval's colatitude wanders: folds that drift along it
  float t = uFxTime;
  float fold = sin(lon * 7.0 + t * 0.07) * 0.035 + sin(lon * 17.0 - t * 0.11) * 0.018 + sin(lon * 3.0 + t * 0.03) * 0.05;
  float colat = uLat + fold;
  vFold = fold;
  vec3 dir = vec3(sin(colat) * cos(lon), cos(colat) * uPole, sin(colat) * sin(lon));
  // tilt the magnetic axis a little off the spin axis
  vec3 ax = normalize(uTilt);
  vec3 y = vec3(0.0, 1.0, 0.0);
  vec3 k = cross(y, ax);
  float s = length(k), c = dot(y, ax);
  if (s > 1e-5) { k /= s; dir = dir * c + cross(k, dir) * s + k * dot(k, dir) * (1.0 - c); }
  float r = mix(uR0, uR1, v);
  vec3 p = normalize(dir) * r;
  vB = p;
  vUV = vec2(u, v);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
${NOISE_GLSL}
${FX_DEPTH_GLSL}
uniform float uK;
uniform vec3 uSunDirBody;
varying vec2 vUV;
varying float vZ;
varying vec3 vB;
varying float vFold;
void main() {
  float vis = fxSoft(vZ, 30.0);
  if (vis <= 0.0) discard;
  float v = vUV.y;
  float u = vUV.x;
  // vertical rays: high-frequency streaks along the curtain, flickering and drifting
  float rays = 0.55 + 0.45 * snoise(vec3(u * 900.0, uFxTime * 0.35, 1.0));
  rays *= 0.6 + 0.4 * snoise(vec3(u * 140.0 + uFxTime * 0.05, v * 2.0, 4.0));
  // brightness bands along the oval
  float band = smoothstep(-0.2, 0.7, snoise(vec3(u * 18.0 - uFxTime * 0.02, 0.0, 7.0)));
  // a sharp lower edge, a long fade upward
  float prof = smoothstep(0.0, 0.06, v) * pow(1.0 - v, 1.6);
  vec3 green = vec3(0.12, 1.0, 0.42), red = vec3(0.9, 0.15, 0.35), violet = vec3(0.45, 0.2, 0.9);
  vec3 c = mix(green, red, smoothstep(0.35, 0.85, v));
  c = mix(c, violet, smoothstep(0.0, 0.05, v) * (1.0 - smoothstep(0.05, 0.12, v)) * 0.4);
  // only where the sun is down (at this point of the air)
  float night = smoothstep(0.08, -0.12, dot(normalize(vB), uSunDirBody));
  float k = prof * rays * (0.35 + 0.65 * band) * uK * night * vis;
  gl_FragColor = vec4(c * k * 2.2 * fxDisplay(0.55), 0.0);
}
`;

export class Aurora {
  readonly group = new Group();
  private meshes: Mesh[] = [];
  private u: Record<string, IUniform>;
  /** the poleward oval's (fainter) strength */
  private uK2: IUniform = { value: 0 };
  level = 0;

  constructor(fx: Record<string, IUniform>, shared: Record<string, IUniform>) {
    this.group.name = 'aurora';
    this.group.matrixAutoUpdate = false;
    this.u = { uR0: { value: 3300 }, uR1: { value: 3800 }, uK: { value: 0 }, uTilt: { value: new Vector3(0.12, 1, 0.05) } };
    const N = 384, M = 6;
    const pos = new Float32Array((N + 1) * (M + 1) * 3);
    const uv = new Float32Array((N + 1) * (M + 1) * 2);
    for (let i = 0; i <= N; i++) for (let j = 0; j <= M; j++) { const k = i * (M + 1) + j; uv[k * 2] = i / N; uv[k * 2 + 1] = j / M; }
    const idx: number[] = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, b = a + M + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aUV', new BufferAttribute(uv, 2));
    geo.setIndex(idx);
    for (const pole of [1, -1]) {
      for (const lat of [0.36, 0.42]) {
        const uni: Record<string, IUniform> = { ...this.u, uK: lat > 0.4 ? this.uK2 : this.u.uK, uPole: { value: pole }, uLat: { value: lat } };
        for (const k of Object.keys(fx)) uni[k] = fx[k];
        uni.uSunDirBody = shared.uSunDirBody;
        const m = new Mesh(geo, new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: uni, transparent: true, depthTest: false, depthWrite: false, ...ADD_LIGHT, side: DoubleSide }));
        m.frustumCulled = false;
        m.matrixAutoUpdate = false;
        m.layers.set(FX_LAYER);
        m.renderOrder = 1;
        this.meshes.push(m);
        this.group.add(m);
      }
    }
  }

  /** strength from magnetism, star activity and storms (boost); shell radii from the planet and its air */
  update(radius: number, airTop: number, magnetism: number, activity: number, boost: number, hasAir: boolean, dt: number): void {
    const want = hasAir ? Math.max(0, magnetism) * Math.min(3, 0.12 + activity * 0.8 + boost) : 0;
    this.level += (want - this.level) * Math.min(1, dt * 0.5 + 0.01);
    this.u.uK.value = this.level;
    // the two ovals differ a little: the second, poleward one fainter
    this.uK2.value = this.level * 0.55;
    this.u.uR0.value = radius + airTop * 0.55;
    this.u.uR1.value = radius + airTop * 1.35;
    this.group.visible = this.level > 0.01;
  }

  dispose(): void { for (const m of this.meshes) (m.material as ShaderMaterial).dispose(); this.meshes[0]?.geometry.dispose(); }
}
