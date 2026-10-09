// GENESIS — stateless GPU particles for fire and smoke (CONTRACT.md §15.7): every particle's position, size, colour
// and opacity are functions of (time, emitter, index, a per-cycle hash) evaluated in the vertex shader — the CPU only
// lists emitters (when they change) and the GPU recycles each particle along its own life cycle.
//
// Systems (per emitter kind; render/gen/buildinggen.ts EMIT):
//   hearth                — flames, embers spiralling up, a smoke column
//   blaze (a burning house) — tall tongues licking out of the roof, embers, sparks, with its black stack column
//   brazier / torch       — small flames, a wisp of smoke
//   kiln / forge mouth    — a tongue of flame at the mouth, sparks
//   chimney               — a thin wood-smoke plume leaning with the wind
//   stack (factory, a burning building's column) — a thick dark rising column that spreads and drifts
//   wildfire (the sim's `fire` field) — a front of tall flames, embers, and towering smoke over every burning cell
// Flames are upright tongues (the quad's axis is the local up as seen on screen): the fragment shader shapes a
// teardrop whose outline writhes with upward-scrolling noise and colours it by heat — white-gold core, orange body,
// dull red tips — at the luminance of a real flame (a few times a sunlit wall, not a white blob).
// Smoke is alpha-blended and LIT: the planet's sun through the transmittance LUT (warm at sunset, none at night), sky
// ambient, and the glow of the fire beneath young smoke; flames and embers are emissive (they bloom). Soft particles:
// each fragment fades where it nears the opaque scene (linear depth copy), and is hidden behind it.
// Drawn after the atmosphere composite so smoke against the sky is never mistaken for stars (render() is called by the
// Renderer through the life layer); wind from the sim's wind field leans the plumes.

import {
  CustomBlending, Group, InstancedBufferAttribute, InstancedBufferGeometry, Float32BufferAttribute, Mesh,
  OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Vector2, type Camera, type IUniform, type Texture,
  type WebGLRenderer, type WebGLRenderTarget, type Scene,
} from 'three';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';

/** particle system kinds (vertex shader branches) */
export const PSYS = { flame: 0, ember: 1, smoke: 2, spark: 3, stack: 4, wild: 5, wildSmoke: 6 } as const;

export interface FxEmitter {
  x: number; y: number; z: number;
  /** body-frame wind at the emitter (m/s, tangent) */
  wx: number; wy: number; wz: number;
  /** system kind, size (m), strength 0..1, seed */
  sys: number; size: number; power: number; seed: number;
  /** particles for this emitter */
  count: number;
}

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${ATMO_PARS}
${SKY_LOOKUP}
attribute vec2 corner;
attribute vec3 iOrigin;
attribute vec3 iWind;
attribute vec4 iParam;   // sys, size, power, seed
attribute vec2 iIdx;     // index, count
uniform float uTime;
uniform vec3 uSunDirBody;
uniform float uPass;     // 0 additive pass (flames, embers, sparks), 1 smoke pass
varying vec2 vCorner;
varying vec4 vColor;
varying float vViewZ;
varying float vSoft;
varying vec3 vLight;
varying float vKind;

float h1(float a, float b) { return fract(sin(a * 127.1 + b * 311.7) * 43758.5453); }

void main() {
  float sys = iParam.x, size = iParam.y, power = iParam.z, seed = iParam.w;
  bool smokeSys = sys > 1.5 && sys < 2.5 || sys > 3.5 && sys < 4.5 || sys > 5.5;
  // each pass draws its own systems; the other's quads collapse
  if ((uPass > 0.5) != smokeSys) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  float life = sys < 0.5 ? 0.9 : sys < 1.5 ? 3.2 : sys < 2.5 ? 9.0 : sys < 3.5 ? 0.9 : sys < 4.5 ? 16.0 : sys < 5.5 ? 1.3 : 20.0;
  life *= 0.85 + 0.3 * h1(seed, 3.0);
  float u = (uTime + seed * 97.0) / life + iIdx.x / max(1.0, iIdx.y);
  float cycle = floor(u);
  float age = fract(u);            // 0..1 through its life
  float r1 = h1(seed * 13.0 + iIdx.x, cycle), r2 = h1(seed * 7.0 + iIdx.x * 1.3, cycle + 3.1), r3 = h1(seed * 5.0 + iIdx.x * 0.7, cycle + 7.7);
  vec3 up = normalize(iOrigin);
  vec3 e1 = normalize(cross(up, abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(up, e1);
  float ang = r1 * 6.2831853;
  vec3 side = e1 * cos(ang) + e2 * sin(ang);
  float tSec = age * life;
  vec3 p = iOrigin;
  float sz = size;
  vec4 col = vec4(1.0);
  float soft = 0.3;
  vKind = 0.0;
  vLight = vec3(0.0);
  if (sys < 0.5 || sys > 4.5 && sys < 5.5) {
    // flames: born across the fire's base, rising and narrowing, flickering sideways
    float wild = sys > 4.5 ? 1.0 : 0.0;
    float base = size * mix(0.45, 0.7, wild) * sqrt(r2);
    float rise = (1.2 + 1.6 * r3) * mix(1.0, 2.6, wild) * tSec * (0.6 + size * 0.4);
    p += side * base * (1.0 - age * 0.7) + up * rise;
    p += (e1 * sin(uTime * 7.0 + r1 * 30.0) + e2 * cos(uTime * 6.0 + r2 * 20.0)) * 0.08 * size * age;
    p += iWind * tSec * 0.25;
    sz = size * mix(0.55, 1.1, wild) * (0.7 + 0.5 * r3) * (1.0 - age * 0.75) * (0.75 + 0.25 * power);
    float a = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.6, 1.0, age));
    // the fragment shader shapes the tongue and colours it by heat: pass age, power and a seed
    col = vec4(age, power, r1, a);
    soft = 0.4 * size;
    vKind = 1.0;
  } else if (sys < 1.5 || sys > 2.5 && sys < 3.5) {
    // embers (slow, spiralling up on the heat) and sparks (fast, falling back)
    bool spark = sys > 2.5;
    float sp = spark ? 3.5 : 1.0;
    vec3 v = side * (spark ? 1.6 : 0.5) * r2 + up * (spark ? 3.0 + 2.0 * r3 : 1.4 + 1.2 * r3);
    p += v * tSec * (spark ? 0.7 : 1.0) * sp * 0.4 - up * (spark ? 4.9 * tSec * tSec : 0.0);
    p += (e1 * sin(tSec * 3.0 + r1 * 20.0) + e2 * cos(tSec * 2.6 + r2 * 20.0)) * 0.4 * (spark ? 0.1 : 1.0) * size;
    p += iWind * tSec * 0.7;
    sz = (spark ? 0.035 : 0.06) * (0.6 + 0.8 * r3);
    float a = (1.0 - smoothstep(0.5, 1.0, age)) * step(0.15, r1);
    float tw = 0.6 + 0.4 * sin(uTime * 23.0 + r2 * 40.0);
    // (glowing specks read at night; in daylight they are barely visible)
    float dayK = smoothstep(-0.1, 0.15, dot(up, uSunDirBody));
    col = vec4(vec3(1.0, 0.42, 0.07) * 14.0 * tw * power * mix(1.0, 0.2, dayK), a);
    soft = 0.05;
  } else {
    // smoke: rises and slows, grows, leans with the wind, spreads at the top; chimneys thin, stacks thick and dark
    bool stack = sys > 3.5 && sys < 4.5, wild = sys > 5.5;
    float k = stack ? 2.2 : wild ? 3.5 : 1.0;
    float rise = (stack ? 2.2 : wild ? 3.0 : 1.0) * (1.0 - exp(-tSec * 0.35)) / 0.35 * (0.8 + 0.4 * r3) * (0.6 + 0.4 * size);
    p += up * (rise + size * 0.3);
    p += iWind * tSec * (0.55 + 0.25 * r2);
    p += side * (0.15 + 0.6 * age) * size * k * r2;
    p += (e1 * sin(tSec * 0.7 + r1 * 10.0) + e2 * cos(tSec * 0.5 + r3 * 10.0)) * 0.3 * age * k;
    sz = (stack ? 1.2 : wild ? 2.0 : 0.35) * size + (stack ? 6.5 : wild ? 12.0 : 2.6) * age * (0.7 + 0.6 * r1) * (0.5 + 0.5 * power);
    float a = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.45, 1.0, age));
    float dens = stack ? 0.55 : wild ? 0.42 : 0.24;
    vec3 sc = stack ? vec3(0.1, 0.095, 0.09) : wild ? vec3(0.22, 0.2, 0.18) : vec3(0.42, 0.42, 0.43);
    sc = mix(sc, sc * 0.6, r2 * 0.5);
    col = vec4(sc, a * dens * (0.6 + 0.4 * power));
    soft = 0.6 * sz;
    // fire glow lights the young smoke from below
    vKind = 2.0;
    vLight = vec3(1.0, 0.45, 0.12) * 2.5 * (1.0 - smoothstep(0.0, 0.35, age)) * (wild || stack ? 1.0 : 0.3) * power;
  }
  // lighting of smoke: sun through the air at this height + sky; computed per particle (cheap, smooth)
  if (smokeSys) {
    float rP = length(p);
    vec3 upP = p / rP;
    vec3 sun = uSunE * sunTransmittance(rP, dot(upP, uSunDirBody));
    vec3 sky = skyIrradiance(upP, upP, uSunDirBody);
    vLight += sun * 0.22 + sky * 0.35 + vec3(0.002, 0.003, 0.005);
  } else { vLight = vec3(1.0); }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  if (vKind > 0.5 && vKind < 1.5) {
    // flames: an upright tongue (its axis the local up as seen on screen), the base at the particle. Seen from above
    // the local up points at the camera and its screen image shrinks to a sliver: the tongue then turns to face the
    // camera (its axis eases to screen-up), so a fire seen from the god camera is still a fire, not a line.
    vec3 upV = normalize((modelViewMatrix * vec4(up, 0.0)).xyz);
    vec2 ax0 = length(upV.xy) > 1e-3 ? normalize(upV.xy) : vec2(0.0, 1.0);
    float face = smoothstep(0.6, 0.92, abs(upV.z));
    vec2 ax = normalize(mix(ax0, vec2(0.0, 1.0), face) + vec2(1e-4, 0.0));
    vec2 rt = vec2(ax.y, -ax.x);
    // tongues of a fire differ in height (0.5-2.5x, per emitter and per particle)
    float tall = (0.5 + 2.0 * h1(seed, 11.0)) * (0.75 + 0.5 * r2);
    mv.xy += rt * corner.x * sz * 0.62 + ax * (corner.y + 0.55) * sz * 1.15 * mix(1.0, tall, 0.85);
  } else {
    // billboard in view space, rotated per particle
    float rot = r3 * 6.2831853 + (smokeSys ? age * (r1 - 0.5) * 2.0 : 0.0);
    vec2 c = vec2(cos(rot) * corner.x - sin(rot) * corner.y, sin(rot) * corner.x + cos(rot) * corner.y);
    mv.xy += c * sz;
  }
  gl_Position = projectionMatrix * mv;
  vCorner = corner;
  vColor = col;
  vViewZ = -mv.z;
  vSoft = soft;
#include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
uniform float uPass;
uniform float uTime;
varying vec2 vCorner;
varying vec4 vColor;
varying float vViewZ;
varying float vSoft;
varying vec3 vLight;
varying float vKind;
void main() {
#include <logdepthbuf_fragment>
  float r = length(vCorner);
  if (r > 1.0 && (vKind < 0.5 || vKind > 1.5)) discard;
  float sceneZ = texture(tSceneDepth, gl_FragCoord.xy / uResolution).r;
  if (vViewZ > sceneZ + 0.05) discard;
  float fade = clamp((sceneZ - vViewZ) / max(0.05, vSoft), 0.0, 1.0);
  // fade near the camera so a puff never fills the screen with a flat card
  fade *= smoothstep(0.3, 2.0, vViewZ);
  if (vKind > 0.5 && vKind < 1.5) {
    // a flame tongue: wide and hot at the base, licking up to a ragged tip; the noise scrolls upward so the
    // outline writhes. Colour from its heat — white-gold in the core, orange, a dull red at the cooling tips.
    float y = vCorner.y * 0.5 + 0.5;
    float n = snoise(vec3(vCorner.x * 2.1, vCorner.y * 1.5 - uTime * 3.2, vColor.z * 17.0));
    float x = vCorner.x + n * 0.3 * y;
    float wdt = mix(0.9, 0.1, pow(y, 0.75));
    float d = abs(x) / wdt;
    float body = (1.0 - smoothstep(0.45, 1.0, d)) * smoothstep(0.0, 0.2, y) * (1.0 - smoothstep(0.55, 1.0, y + n * 0.18));
    float heat = clamp(body * (1.05 - vColor.x * 0.75) * (1.0 - 0.55 * y), 0.0, 1.0);
    // the core stays orange-gold (many tongues add up: a white core reads as a gas jet, not a wood fire)
    vec3 c = heat > 0.5 ? mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.56, 0.18), heat * 2.0 - 1.0)
                        : mix(vec3(0.45, 0.04, 0.0), vec3(1.0, 0.36, 0.06), heat * 2.0);
    float I = (0.4 + 1.25 * heat * heat) * vColor.y;
    float a = vColor.a * body * fade;
    gl_FragColor = vec4(c * I * a, 0.0);
  } else if (uPass < 0.5) {
    // embers and sparks: hot points
    float core = pow(1.0 - r, 1.6);
    float a = vColor.a * core * fade;
    gl_FragColor = vec4(vColor.rgb * a, 0.0);
  } else {
    // smoke: a lumpy puff, lit; lighter on its sunward / upper side by a fake sphere normal
    float puff = smoothstep(1.0, 0.25, r) * (0.7 + 0.3 * snoise(vec3(vCorner * 2.2, vColor.r * 40.0)));
    vec3 n = vec3(vCorner, sqrt(max(0.0, 1.0 - r * r)));
    float lit = 0.65 + 0.35 * n.y;
    float a = vColor.a * puff * fade;
    vec3 c = vColor.rgb * vLight * lit;
    gl_FragColor = vec4(c * a, a);
  }
}
`;

export class Particles {
  readonly group = new Group();
  private geo: InstancedBufferGeometry;
  private add: Mesh;
  private smoke: Mesh;
  private matAdd: ShaderMaterial;
  private matSmoke: ShaderMaterial;
  private uniforms: Record<string, IUniform>;
  stats = { emitters: 0, particles: 0 };

  constructor(shared: Record<string, IUniform>) {
    this.group.name = 'particles';
    this.group.matrixAutoUpdate = false;
    this.geo = new InstancedBufferGeometry();
    this.geo.setAttribute('corner', new Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.uniforms = {
      uTime: { value: 0 }, tSceneDepth: { value: null }, uResolution: { value: new Vector2(1, 1) }, uPass: { value: 0 },
    };
    const mk = (pass: number) => {
      const u: Record<string, IUniform> = { ...this.uniforms, uPass: { value: pass } };
      for (const k of Object.keys(shared)) if (!(k in u)) u[k] = shared[k];
      // premultiplied output: flames add (One, One), smoke composites over (One, OneMinusSrcAlpha)
      return new ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: u, transparent: true, depthWrite: false, depthTest: false,
        blending: CustomBlending, blendSrc: OneFactor, blendDst: pass === 0 ? OneFactor : OneMinusSrcAlphaFactor,
      });
    };
    this.matAdd = mk(0);
    this.matSmoke = mk(1);
    this.add = new Mesh(this.geo, this.matAdd);
    this.smoke = new Mesh(this.geo, this.matSmoke);
    for (const m of [this.smoke, this.add]) { m.frustumCulled = false; m.matrixAutoUpdate = false; m.layers.set(3); this.group.add(m); }
    // smoke first, then the glowing flames over it
    this.smoke.renderOrder = 0;
    this.add.renderOrder = 1;
    this.setEmitters([]);
  }

  /** rebuild the instance buffers for a new emitter list (not per frame) */
  setEmitters(list: FxEmitter[]): void {
    let n = 0;
    for (const e of list) n += e.count;
    const origin = new Float32Array(Math.max(1, n) * 3), wind = new Float32Array(Math.max(1, n) * 3), param = new Float32Array(Math.max(1, n) * 4), idx = new Float32Array(Math.max(1, n) * 2);
    let k = 0;
    for (const e of list) {
      for (let i = 0; i < e.count; i++, k++) {
        origin[k * 3] = e.x; origin[k * 3 + 1] = e.y; origin[k * 3 + 2] = e.z;
        wind[k * 3] = e.wx; wind[k * 3 + 1] = e.wy; wind[k * 3 + 2] = e.wz;
        param[k * 4] = e.sys; param[k * 4 + 1] = e.size; param[k * 4 + 2] = e.power; param[k * 4 + 3] = e.seed;
        idx[k * 2] = i; idx[k * 2 + 1] = e.count;
      }
    }
    this.geo.setAttribute('iOrigin', new InstancedBufferAttribute(origin, 3));
    this.geo.setAttribute('iWind', new InstancedBufferAttribute(wind, 3));
    this.geo.setAttribute('iParam', new InstancedBufferAttribute(param, 4));
    this.geo.setAttribute('iIdx', new InstancedBufferAttribute(idx, 2));
    this.geo.instanceCount = n;
    this.group.visible = n > 0;
    this.stats.emitters = list.length;
    this.stats.particles = n;
  }

  /**
   * Draw both passes into `target` (the composited HDR image) with the scene's linear depth for soft particles. The
   * caller has positioned the planet group (this group is its child) for this frame.
   */
  render(renderer: WebGLRenderer, scene: Scene, camera: Camera, target: WebGLRenderTarget | null, depth: Texture, w: number, h: number, time: number): void {
    if (!this.group.visible || !this.stats.particles) return;
    this.uniforms.uTime.value = time;
    this.uniforms.tSceneDepth.value = depth;
    (this.uniforms.uResolution.value as Vector2).set(w, h);
    for (const m of [this.matAdd, this.matSmoke]) {
      m.uniforms.uTime = this.uniforms.uTime; m.uniforms.tSceneDepth = this.uniforms.tSceneDepth; m.uniforms.uResolution = this.uniforms.uResolution;
    }
    const prevAuto = renderer.autoClear;
    const prevMask = camera.layers.mask;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    camera.layers.set(3);
    renderer.render(scene, camera);
    camera.layers.mask = prevMask;
    renderer.autoClear = prevAuto;
  }

  dispose(): void {
    this.geo.dispose();
    this.matAdd.dispose();
    this.matSmoke.dispose();
  }
}
