// GENESIS — the creatures in the world (CONTRACT.md §11.5, §15.6): giant procedural animals that learn.
//
// One CreatureVisual per CreatureView on the primary world: a skinned body (gen/creaturegen.ts) and, for the furred
// templates, fur SHELLS (copies of the skin pushed out along the normal, alpha-tested into strands, combed back and
// down, darker at the roots), animated on the CPU each frame from the view's animation state:
//   walk / run (gaits by body: a lateral walk; a trot for the ox, a rotary gallop for the cat and the wolf, a bounding
//   lope for the bear, a knuckle-walk for the ape, a tortoise's slow plod) with the stride synced to the measured
//   ground speed, body bob, roll and spine flex, head nod and tail sway; idle variations (breathing, looking about, a
//   sniff, sitting, scratching, a yawn); eat (head down, the jaw chewing); sleep (lying down, curled, slow breath);
//   fight (rearing, swipes, bites; the ape beats its chest); cast (rising, head up, glowing); play (bounces and play
//   bows); work / throw (the ape's overhand throw, a quadruped's head toss); held (dangling from the god's hand)
// Size follows the sim's height; the alignment morph reshapes the body (fat / strong / spiky → a rebuilt mesh) and
// shades it: a good creature brighter and warmer with glowing golden markings and warm eyes, a cruel one dark,
// desaturated, scarred, with red-glowing eyes. Footfalls raise dust (GodFx turns them into particles).

import {
  BufferAttribute, BufferGeometry, Color, Group, Matrix4, Mesh, MeshStandardMaterial, ShaderMaterial, Vector3, DoubleSide,
  type IUniform,
} from 'three';
import { creatureMesh, creatureRig, type CreatureMesh } from '../gen/creaturegen.ts';
import { Rig, RIG_SKIN_GLSL, type V3 } from '../gen/rig.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { SHADOW_GLSL } from '../planet/lights.ts';
import { MOON_PARS, moonDirect } from '../shaders/moon.glsl.ts';
import { FX_EXPOSURE } from '../fx/fxcommon.ts';
import { BASE_PACK } from '../../data/index.ts';
import type { CreatureView } from '../../sim/types.ts';
import { AnimState } from '../../sim/types.ts';
import type { PlanetView } from '../../client/worldview.ts';
import { groundHeight } from '../../sim/grid/surface.ts';

const MAXB = 24;
const SHELLS = 7;

/** coat colours per body (creatures.json colours: base, dark, light) */
const COLOURS = new Map<string, [string, string, string]>();
for (const c of ((BASE_PACK as unknown as { creatures?: { body: string; colors?: string[] }[] }).creatures ?? [])) {
  if (c.colors && c.colors.length >= 3 && !COLOURS.has(c.body)) COLOURS.set(c.body, [c.colors[0], c.colors[1], c.colors[2]]);
}

// ───────────────────────────── shaders ─────────────────────────────

const VERT_PARS = /* glsl */ `
uniform mat4 uBones[${MAXB}];
uniform mat4 uToBody;
uniform float uFurLen;
uniform vec3 uComb;
${RIG_SKIN_GLSL}
attribute vec3 aRest;
attribute vec4 aMark;
#ifdef FUR
attribute float aShell;
varying float vShell;
#endif
varying vec3 vRest;
varying vec4 vMark;
varying vec3 vBodyPos;
`;

const VERT_SKIN = /* glsl */ `
  mat4 sk = rigSkin();
  vec3 objectNormal = normalize(mat3(sk) * normal);
`;
const VERT_POS = /* glsl */ `
  vec3 transformed = (sk * vec4(position, 1.0)).xyz;
#ifdef FUR
  // a shell: out along the normal by its share of the fur, combed back and down (more toward the tips)
  float fl = uFurLen * aMark.z;
  transformed += objectNormal * aShell * fl + uComb * aShell * aShell * fl * 0.8;
  vShell = aShell;
#endif
`;
const VERT_POST = /* glsl */ `
  vBodyPos = (uToBody * vec4(transformed, 1.0)).xyz;
  vRest = aRest; vMark = aMark;
`;

const FRAG_PARS = /* glsl */ `
${NOISE_GLSL}
${ATMO_PARS}
${SKY_LOOKUP}
${SHADOW_GLSL}
${MOON_PARS}
uniform mat3 uBodyToView;
uniform vec3 uSunDirBody;
uniform vec3 uSunDirView;
uniform vec3 uNightAmbient;
uniform vec3 uCoat;
uniform vec3 uDark;
uniform vec3 uLight;
uniform vec3 uSkin;
uniform float uAlign;
uniform float uGlow;
uniform float uSpiky;
uniform float uPattern;
uniform float uTime;
uniform float uScaleM;
uniform sampler2D tExposure;
uniform float uHasExposure;
varying vec3 vRest;
varying vec4 vMark;
varying vec3 vBodyPos;
#ifdef FUR
varying float vShell;
#endif
float csat(float x) { return clamp(x, 0.0, 1.0); }
// a scute / cell pattern (tortoise shell): distance to the nearest cell border, the cell's own hash
vec2 cells(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0, id = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = gn_hash33(i + g) * 0.8 + 0.1;
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = gn_hash13(i + g); } else if (d < d2) d2 = d;
  }
  return vec2(sqrt(d2) - sqrt(d1), id);
}
`;

const FRAG_SURFACE = /* glsl */ `
  float good = csat(uAlign), cruel = csat(-uAlign);
  int region = int(vMark.y + 0.5);
  float eye = vMark.x;
  vec3 R = vRest;
  // the coat: base colour, a darker back and markings by template, a lighter belly
  float back = smoothstep(0.55, 0.95, R.y) * (1.0 - smoothstep(0.85, 1.2, R.y));
  vec3 coat = mix(uCoat, uDark, back * 0.6);
  float pat = 0.0;
  if (uPattern > 0.5 && uPattern < 1.5) {
    // great cat: faint rosettes
    vec2 c = cells(R * vec3(14.0, 14.0, 14.0)).xy;
    pat = smoothstep(0.12, 0.05, c.x) * 0.55;
  } else if (uPattern > 1.5 && uPattern < 2.5) {
    // wolf: a dark saddle and a pale mask
    pat = smoothstep(0.62, 0.8, R.y) * smoothstep(0.6, 0.1, abs(R.z + 0.05)) * 0.7;
  }
  coat = mix(coat, uDark * 0.7, pat);
  float belly = region == 1 ? 1.0 : smoothstep(0.42, 0.25, R.y) * step(0.3, abs(R.z) + 0.3);
  coat = mix(coat, uLight, csat(belly) * 0.75);
  coat *= 0.85 + 0.25 * fbm3(R * 9.0);
  vec3 alb = coat;
  float rough = 0.8;
  if (region == 2) { alb = uSkin * (0.85 + 0.2 * fbm3(R * 40.0)); rough = 0.62; }
  else if (region == 3) { alb = vec3(0.16, 0.14, 0.12) * (0.8 + 0.3 * snoise(R * 60.0)); rough = 0.45; }
  else if (region == 4) {
    // shell: scutes with dark seams and growth rings, lighter centres
    vec2 c = cells(R * 5.5);
    float seam = smoothstep(0.02, 0.07, c.x);
    float rings = 0.5 + 0.5 * sin(c.x * 90.0);
    alb = mix(uDark * 0.6, mix(uCoat, uLight, c.y * 0.5) * (0.85 + 0.15 * rings), seam);
    rough = 0.5;
  } else if (region == 5) { alb = mix(vec3(0.12, 0.1, 0.09), vec3(0.25, 0.04, 0.03), cruel); rough = 0.4; }
  // the morph's colour: a good creature brighter and warmer, a cruel one dark and drained
  alb = mix(alb, alb * vec3(1.18, 1.1, 0.95) + vec3(0.03, 0.025, 0.0), good * 0.6);
  float l = dot(alb, vec3(0.3, 0.55, 0.15));
  alb = mix(alb, vec3(l) * vec3(0.7, 0.62, 0.62), cruel * 0.7);
  // scars on a cruel hide
  float scar = cruel * smoothstep(0.985, 1.0, 1.0 - abs(snoise(vec3(R.x * 6.0, R.y * 2.0, R.z * 9.0))));
  alb = mix(alb, vec3(0.32, 0.12, 0.1), scar * 0.8);
  // eyes: dark and glossy; a good creature's catch a warm light, a cruel one's burn red
  alb = mix(alb, vec3(0.02, 0.015, 0.01), csat(eye * 2.0));
  rough = mix(rough, 0.08, csat(eye * 2.0));
#ifdef FUR
  // strands: a hashed cell pattern thinning toward the tips; roots in shadow, tips lighter
  vec3 q = R * 520.0;
  vec3 qi = floor(q);
  vec3 qf = fract(q) - 0.5 + (gn_hash33(qi) - 0.5) * 0.6;
  float strand = 1.0 - length(qf.xz) * 1.6 - length(qf.xy) * 0.5;
  float thr = vShell * (0.85 + 0.3 * gn_hash13(qi + 7.0));
  if (vShell > 0.02 && strand < thr) discard;
  alb *= mix(0.55, 1.15, vShell);
#endif
  diffuseColor.rgb = alb;
  float cRough = rough;
`;

const FRAG_LIGHT = /* glsl */ `
  {
    float rP = length(vBodyPos);
    vec3 upB = vBodyPos / rP;
    float sh = sunShadow(-vViewPosition, normal);
    vec3 sunCol = uSunE * sunTransmittance(rP, dot(upB, uSunDirBody)) * sh;
    IncidentLight sunL;
    sunL.direction = uSunDirView;
    sunL.color = sunCol;
    sunL.visible = true;
    RE_Direct(sunL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    ${moonDirect('vBodyPos', '1.0')}
    // fur and hide catch the light at grazing angles (a sheen along the silhouette)
    float nv = max(dot(geometryNormal, geometryViewDir), 0.0), nl = max(dot(geometryNormal, uSunDirView), 0.0);
    reflectedLight.directDiffuse += sunCol * (diffuseColor.rgb * 0.7 + 0.02) * pow(1.0 - nv, 3.0) * (0.3 + 0.7 * nl) * 0.6;
  }
`;

const FRAG_AMBIENT = /* glsl */ `
  {
    vec3 upB = normalize(vBodyPos);
    vec3 nB = normalize(transpose(uBodyToView) * normal);
    // (the underside sees the ground's bounce, not the sky)
    iblIrradiance += (skyIrradiance(upB, nB, uSunDirBody) + uNightAmbient) * mix(0.55, 1.0, max(0.0, dot(nB, upB)) * 0.5 + 0.5);
  }
`;

const FRAG_EMISSIVE = /* glsl */ `
  {
    float ex = uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 1e-4) : 1.0;
    vec3 em = vec3(0.0);
    // glowing markings (a good creature): flowing contour lines over the coat, pulsing slowly
    float n = fbm3(vRest * 3.2 + vec3(0.0, uTime * 0.03, 0.0));
    float line = 1.0 - smoothstep(0.0, 0.06, abs(fract(n * 3.5) - 0.5) * 2.0 - 0.0);
    line *= smoothstep(0.45, 0.75, vRest.y) * step(float(region), 1.5);
    em += vec3(1.0, 0.72, 0.32) * line * uGlow * (0.6 + 0.4 * sin(uTime * 1.3 + n * 9.0)) * 0.9 / ex;
    // eyes
    float e = csat(vMark.x * 2.0);
    em += mix(vec3(1.0, 0.7, 0.3) * 0.25 * (0.3 + good), vec3(1.0, 0.08, 0.02) * 3.0, cruel) * e / ex * mix(0.4, 1.0, cruel);
    // a good creature's warm rim
    float nv = abs(dot(normal, normalize(vViewPosition)));
    em += vec3(1.0, 0.78, 0.45) * pow(1.0 - nv, 3.0) * uGlow * 0.35 / ex;
    totalEmissiveRadiance = em;
  }
`;

const DEPTH_VERT = /* glsl */ `
#include <common>
uniform mat4 uBones[${MAXB}];
${RIG_SKIN_GLSL}
#include <logdepthbuf_pars_vertex>
void main() {
  mat4 sk = rigSkin();
  vec3 p = (sk * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
#include <logdepthbuf_vertex>
}
`;
const DEPTH_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
void main() {
#include <logdepthbuf_fragment>
  gl_FragColor = vec4(1.0);
}
`;

function hexColor(s: string): [number, number, number] {
  const c = new Color(s);
  c.convertSRGBToLinear();
  return [c.r, c.g, c.b];
}

/** the body's geometry repeated SHELLS times with a per-copy shell height (fur) */
function shellGeometry(base: BufferGeometry): BufferGeometry {
  const n = base.getAttribute('position').count;
  const idx = base.index!;
  const g = new BufferGeometry();
  const names = ['position', 'normal', 'aRest', 'aBoneIdx', 'aBoneW', 'aMark'];
  for (const k of names) {
    const a = base.getAttribute(k) as BufferAttribute;
    const out = new Float32Array(a.array.length * SHELLS);
    for (let s = 0; s < SHELLS; s++) out.set(a.array as Float32Array, s * a.array.length);
    g.setAttribute(k, new BufferAttribute(out, a.itemSize));
  }
  const sh = new Float32Array(n * SHELLS);
  for (let s = 0; s < SHELLS; s++) sh.fill((s + 1) / SHELLS, s * n, (s + 1) * n);
  g.setAttribute('aShell', new BufferAttribute(sh, 1));
  const ii = new Uint32Array(idx.count * SHELLS);
  for (let s = 0; s < SHELLS; s++) for (let i = 0; i < idx.count; i++) ii[s * idx.count + i] = idx.getX(i) + s * n;
  g.setIndex(new BufferAttribute(ii, 1));
  g.boundingSphere = base.boundingSphere?.clone() ?? null;
  return g;
}

// ───────────────────────────── one creature ─────────────────────────────

const _v: V3 = [0, 0, 0];
const _up = new Vector3();
const _fw = new Vector3();
const _rt = new Vector3();

export interface FootFall { x: number; y: number; z: number; size: number }

class CreatureVisual {
  readonly group = new Group();
  readonly id: number;
  body = '';
  private cm: CreatureMesh | null = null;
  private rig: Rig | null = null;
  private skin: Mesh | null = null;
  private fur: Mesh | null = null;
  private furGeo: BufferGeometry | null = null;
  private mat: MeshStandardMaterial;
  private furMat: MeshStandardMaterial;
  private depth: ShaderMaterial;
  private readonly bones: IUniform<Float32Array> = { value: new Float32Array(MAXB * 16) };
  private readonly toBody: IUniform<Matrix4> = { value: new Matrix4() };
  readonly u = {
    uCoat: { value: new Vector3() }, uDark: { value: new Vector3() }, uLight: { value: new Vector3() }, uSkin: { value: new Vector3() },
    uAlign: { value: 0 }, uGlow: { value: 0 }, uSpiky: { value: 0 }, uPattern: { value: 0 }, uTime: { value: 0 }, uScaleM: { value: 10 },
    uFurLen: { value: 0.02 }, uComb: { value: new Vector3(0, -1, -0.5) },
  };
  private morphKey = '';
  /** smoothed body-frame position (m), heading, measured speed, gait phase */
  readonly pos = new Vector3();
  private placed = false;
  heading = 0;
  speed = 0;
  private phase = 0;
  private lastFoot = [0, 0, 0, 0];
  private anim = 0;
  private prevAnim = 0;
  private animAt = 0;
  private blend = 1;
  private height = 10;
  fade = 0;
  seen = true;

  constructor(id: number, shared: Record<string, IUniform>) {
    this.id = id;
    this.group.matrixAutoUpdate = false;
    const mk = (fur: boolean) => {
      const m = new MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
      if (fur) m.side = DoubleSide;
      m.defines = fur ? { FUR: '' } : {};
      m.onBeforeCompile = (sh) => {
        for (const k of Object.keys(shared)) sh.uniforms[k] = shared[k];
        for (const [k, v] of Object.entries(this.u)) sh.uniforms[k] = v as IUniform;
        sh.uniforms.uBones = this.bones;
        sh.uniforms.uToBody = this.toBody;
        sh.uniforms.tExposure = FX_EXPOSURE;
        sh.uniforms.uHasExposure = CREATURE_EXPOSURE_ON;
        sh.vertexShader = sh.vertexShader
          .replace('#include <clipping_planes_pars_vertex>', `#include <clipping_planes_pars_vertex>\n${VERT_PARS}`)
          .replace('#include <beginnormal_vertex>', VERT_SKIN)
          .replace('#include <begin_vertex>', VERT_POS)
          .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_POST}`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${FRAG_PARS}`)
          .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_SURFACE}`)
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = cRough;')
          .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE)
          .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${FRAG_LIGHT}`)
          .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${FRAG_AMBIENT}`);
      };
      m.customProgramCacheKey = () => `genesis-creature-v1-${fur ? 'fur' : 'skin'}`;
      return m;
    };
    this.mat = mk(false);
    this.furMat = mk(true);
    this.depth = new ShaderMaterial({ vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, uniforms: { uBones: this.bones }, colorWrite: false });
  }

  private ensureMesh(v: CreatureView): void {
    const fat = v.morph[0], strong = v.morph[1], spiky = v.morph[2];
    const q = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 4);
    const key = `${v.body}|${q(fat)}|${q(strong)}|${q(spiky)}`;
    if (key === this.morphKey && this.cm) return;
    this.morphKey = key;
    const cm = creatureMesh(v.body, { fat, strong, spiky });
    const keepRot = this.rig ? this.rig.rot.slice() : null;
    this.cm = cm;
    this.rig = creatureRig(cm);
    if (keepRot && keepRot.length === this.rig.rot.length) this.rig.rot.set(keepRot);
    this.body = cm.body;
    if (this.skin) { this.group.remove(this.skin); }
    if (this.fur) { this.group.remove(this.fur); this.furGeo?.dispose(); }
    this.skin = new Mesh(cm.geo, this.mat);
    this.skin.frustumCulled = false;
    this.skin.matrixAutoUpdate = false;
    this.skin.layers.enable(1);
    this.group.add(this.skin);
    this.fur = null;
    if (cm.fur > 0.05) {
      this.furGeo = shellGeometry(cm.geo);
      this.fur = new Mesh(this.furGeo, this.furMat);
      this.fur.frustumCulled = false;
      this.fur.matrixAutoUpdate = false;
      this.group.add(this.fur);
    }
    const cols = COLOURS.get(cm.body) ?? ['#6b5a48', '#3a3028', '#b9a68a'];
    this.u.uCoat.value.set(...hexColor(cols[0]));
    this.u.uDark.value.set(...hexColor(cols[1]));
    this.u.uLight.value.set(...hexColor(cols[2]));
    const skinCol: Record<string, [number, number, number]> = { ape: [0.06, 0.05, 0.05], ox: [0.07, 0.05, 0.045], cat: [0.22, 0.12, 0.1], wolf: [0.05, 0.045, 0.045], bear: [0.05, 0.04, 0.035], tortoise: [0.16, 0.16, 0.12] };
    this.u.uSkin.value.set(...(skinCol[cm.body] ?? [0.1, 0.08, 0.07]));
    this.u.uPattern.value = cm.body === 'cat' ? 1 : cm.body === 'wolf' ? 2 : 0;
  }

  swapDepth(depth: boolean): void {
    if (this.skin) this.skin.material = depth ? this.depth : this.mat;
  }

  /** pose and place for this frame; returns footfalls (positions in the body frame) */
  update(v: CreatureView, pv: PlanetView, dt: number, t: number, held: { x: number; y: number; z: number } | null, falls: FootFall[]): void {
    this.ensureMesh(v);
    const cm = this.cm!, rig = this.rig!;
    const R = pv.params.radius;
    this.height = Math.max(1, v.height);
    const H = this.height;
    // ── place: smooth toward the view's position; speed from the motion ──
    const ul = Math.hypot(v.pos[0], v.pos[1], v.pos[2]) || 1;
    const ux = v.pos[0] / ul, uy = v.pos[1] / ul, uz = v.pos[2] / ul;
    const g = groundHeight(pv.ground, ux, uy, uz);
    const tx = ux * g, ty = uy * g, tz = uz * g;
    if (!this.placed || Math.hypot(tx - this.pos.x, ty - this.pos.y, tz - this.pos.z) > H * 8) {
      this.pos.set(tx, ty, tz); this.placed = true; this.speed = 0;
    } else if (dt > 0) {
      const k = 1 - Math.exp(-dt * 6);
      const ox = this.pos.x, oy = this.pos.y, oz = this.pos.z;
      this.pos.x += (tx - ox) * k; this.pos.y += (ty - oy) * k; this.pos.z += (tz - oz) * k;
      const sp = Math.hypot(this.pos.x - ox, this.pos.y - oy, this.pos.z - oz) / dt;
      this.speed += (sp - this.speed) * Math.min(1, dt * 3);
    }
    let dh = v.heading - this.heading;
    dh -= Math.round(dh / (Math.PI * 2)) * Math.PI * 2;
    this.heading += dh * Math.min(1, dt * 2.5);
    // ── animation state (blended over 0.4 s) ──
    const anim = held ? AnimState.held : v.anim;
    if (anim !== this.anim) { this.prevAnim = this.anim; this.anim = anim; this.animAt = t; }
    this.blend = Math.min(1, (t - this.animAt) / 0.45);
    // gait: the cycle advances with the ground covered (a minimum pace when the sim says walk but the view stalls)
    const moving = anim === AnimState.walk || anim === AnimState.run || anim === AnimState.flee;
    const run = anim === AnimState.run || anim === AnimState.flee;
    const stride = cm.stride * H * (run ? 1.7 : 1);
    const pace = moving ? Math.max(this.speed, H * (run ? 0.45 : 0.16)) : 0;
    this.phase += (pace / Math.max(0.1, stride)) * dt;
    // ── pose ──
    rig.reset();
    this.pose(rig, cm, anim, this.phase, t, run);
    if (this.blend < 1) {
      const cur = rig.rot.slice(), cs = rig.shift.slice(), rt = [...rig.rootT], rr = [...rig.rootR];
      rig.reset();
      this.pose(rig, cm, this.prevAnim, this.phase, t, this.prevAnim === AnimState.run);
      const b = this.blend * this.blend * (3 - 2 * this.blend);
      for (let i = 0; i < cur.length; i++) rig.rot[i] += (cur[i] - rig.rot[i]) * b;
      for (let i = 0; i < cs.length; i++) rig.shift[i] += (cs[i] - rig.shift[i]) * b;
      for (let i = 0; i < 3; i++) { rig.rootT[i] += (rt[i] - rig.rootT[i]) * b; rig.rootR[i] += (rr[i] - rig.rootR[i]) * b; }
    }
    // the body follows the slope: pitch from the ground under the front and back feet
    _up.set(this.pos.x, this.pos.y, this.pos.z).normalize();
    let ex = _up.z, ez = -_up.x;
    const el = Math.hypot(ex, ez) || 1;
    ex /= el; ez /= el;
    const nx = _up.y * ez, ny = _up.z * ex - _up.x * ez, nz = -_up.y * ex;
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    _fw.set(nx * ch + ex * sh, ny * ch, nz * ch + ez * sh).normalize();
    if (!held) {
      const half = cm.length * H * 0.38;
      const gf = this.groundAlong(pv, _fw, half), gb = this.groundAlong(pv, _fw, -half);
      rig.rootR[0] += Math.atan2(gb - gf, half * 2) * 0.9;
    }
    rig.update();
    this.bones.value.set(rig.skin.subarray(0, Math.min(rig.skin.length, MAXB * 16)));
    // ── the transform: creature space (height units, +z forward, +y up) → body frame (m) ──
    _rt.crossVectors(_up, _fw).normalize(); // creature +x = its left = up × forward
    const M = this.toBody.value;
    M.makeBasis(_rt, _up, _fw).scale(_v3s.set(H, H, H));
    if (held) {
      // dangling from the hand by the scruff: the shoulders at the grip point
      M.setPosition(held.x - _up.x * H * 0.95, held.y - _up.y * H * 0.95, held.z - _up.z * H * 0.95);
    } else M.setPosition(this.pos.x, this.pos.y, this.pos.z);
    if (this.skin) { this.skin.matrix.copy(M); this.skin.matrixWorldNeedsUpdate = true; }
    if (this.fur) { this.fur.matrix.copy(M); this.fur.matrixWorldNeedsUpdate = true; }
    // ── look ──
    const align = v.alignment;
    this.u.uAlign.value = align;
    this.u.uGlow.value = Math.max(0, v.morph[3] ?? Math.max(0, align)) * (anim === AnimState.pray ? 1.8 : 1);
    this.u.uSpiky.value = v.morph[2];
    this.u.uTime.value = t;
    this.u.uScaleM.value = H;
    // fur length (height units) and the comb: back along the body and down
    this.u.uFurLen.value = (cm.fur > 0.5 ? 0.022 : 0.012) * (cm.fur);
    (this.u.uComb.value as Vector3).set(0, -0.8, -0.6);
    // ── footfalls: dust where a foot comes down while moving ──
    if (moving && !held) {
      const offs = this.gaitOffsets(cm.body, run);
      for (let i = 0; i < 4; i++) {
        const s = (((this.phase + offs[i]) % 1) + 1) % 1;
        if (this.lastFoot[i] > 0.6 && s < 0.4) {
          rig.carry(cm.b.legs[i][2], cm.feet[i], _v);
          const p = _v3a.set(_v[0], _v[1], _v[2]).applyMatrix4(M);
          falls.push({ x: p.x, y: p.y, z: p.z, size: H * (run ? 0.16 : 0.1) });
        }
        this.lastFoot[i] = s;
      }
    }
  }

  private groundAlong(pv: PlanetView, fw: Vector3, d: number): number {
    const p = _v3b.copy(this.pos).addScaledVector(fw, d);
    const l = p.length() || 1;
    return groundHeight(pv.ground, p.x / l, p.y / l, p.z / l) - l;
  }

  /** leg phase offsets (LF, RF, LH, RH) by gait */
  private gaitOffsets(body: string, run: boolean): [number, number, number, number] {
    if (!run) return [0.25, 0.75, 0.0, 0.5];                     // lateral-sequence walk
    if (body === 'ox' || body === 'tortoise') return [0.0, 0.5, 0.5, 0.0];   // trot
    if (body === 'bear' || body === 'ape') return [0.55, 0.65, 0.0, 0.1];    // lope / knuckle gallop
    return [0.5, 0.6, 0.0, 0.1];                                  // rotary gallop
  }

  /** procedural pose for one animation state (rig reset before) */
  private pose(rig: Rig, cm: CreatureMesh, anim: number, phase: number, t: number, run: boolean): void {
    const b = cm.b;
    const body = cm.body;
    const TAU = Math.PI * 2;
    const seed = (this.id * 0.618) % 1;
    const breathe = Math.sin(t * 1.6 + seed * 6) * 0.012;
    rig.shift[b.chest * 3 + 1] += breathe;
    const tailSway = (k: number, a: number, f: number) => { for (let i = 0; i < b.tail.length; i++) rig.rot[b.tail[i] * 3 + 1] += Math.sin(t * f + i * 0.7 + seed * 5) * a * (1 + i * 0.4) * k; };
    const ears = (a: number) => { for (const e of b.ears) rig.rot[e * 3] += a; };
    const legRot = (i: number, up: number, lo: number, ft: number) => {
      const L = b.legs[i];
      rig.rot[L[0] * 3] += up; rig.rot[L[1] * 3] += lo; rig.rot[L[2] * 3] += ft;
    };
    switch (anim) {
      case AnimState.walk: case AnimState.run: case AnimState.flee: {
        const offs = this.gaitOffsets(body, run);
        const A = run ? 0.6 : 0.36, Bk = run ? 0.9 : 0.6;
        for (let i = 0; i < 4; i++) {
          const th = TAU * (phase + offs[i]);
          const front = i < 2;
          const swing = Math.max(0, Math.sin(th + 0.5));
          // the leg reaches forward and sweeps back; the lower joint folds while the foot is in the air
          const up = -A * Math.sin(th) * (body === 'tortoise' ? 0.5 : 1);
          const lo = (front ? 1 : -0.6) * Bk * Math.pow(swing, 1.5) * (body === 'tortoise' ? 0.4 : 1);
          legRot(i, up, lo, -lo * 0.6 - up * 0.3);
        }
        const bob = Math.cos(TAU * phase * 2) * (run ? 0.035 : 0.015);
        rig.rootT[1] += bob;
        rig.rootR[2] += Math.sin(TAU * phase) * (run ? 0.02 : 0.035);
        if (run && (body === 'cat' || body === 'wolf' || body === 'bear')) {
          // the spine coils and stretches with the gallop
          const flex = Math.sin(TAU * phase) * 0.22;
          rig.rot[b.spine * 3] += flex; rig.rot[b.root * 3] -= flex * 0.6;
          rig.rootR[0] += Math.sin(TAU * phase + 1) * 0.06;
        }
        rig.rot[b.neck * 3] += -bob * 3 + (run ? -0.15 : 0);
        rig.rot[b.head * 3] += Math.sin(TAU * phase * 2 + 1) * 0.05;
        tailSway(1, run ? 0.12 : 0.18, TAU);
        if (b.tail.length) rig.rot[b.tail[0] * 3] += run ? -0.4 : -0.1;
        ears(run ? 0.35 : 0.05);
        if (body === 'ape') { rig.rot[b.chest * 3] += 0.05; }
        break;
      }
      case AnimState.eat: case AnimState.graze: {
        // head down to the ground, chewing
        rig.rot[b.neck * 3] += 0.85; rig.rot[b.head * 3] += 0.35;
        rig.rot[b.jaw * 3] -= 0.12 + 0.12 * Math.max(0, Math.sin(t * 7));
        for (let i = 0; i < 2; i++) legRot(i, -0.12, 0.15, 0);
        rig.rootR[0] += 0.08;
        tailSway(1, 0.15, 1.3);
        break;
      }
      case AnimState.sleep: {
        // lying down: legs folded under, the head down and to the side, slow breathing, the tail curled round
        rig.rootT[1] -= body === 'tortoise' ? 0.12 : 0.36;
        for (let i = 0; i < 4; i++) {
          const front = i < 2;
          legRot(i, front ? -0.5 : 0.75, front ? 1.7 : -1.6, front ? -0.9 : 0.9);
        }
        rig.rot[b.neck * 3] += 0.55; rig.rot[b.neck * 3 + 1] += 0.45; rig.rot[b.head * 3] += 0.3;
        rig.shift[b.chest * 3 + 1] += Math.sin(t * 0.8) * 0.02;
        for (const tb of b.tail) rig.rot[tb * 3 + 1] += 0.45;
        ears(-0.3);
        break;
      }
      case AnimState.fight: {
        // rear and strike: the forequarters up, a forepaw swiping, the jaw snapping (the ape beats its chest)
        const k = Math.sin(t * 5.5);
        if (body === 'ape') {
          rig.rootR[0] -= 0.75; rig.rootT[1] += 0.12;
          legRot(0, -1.3 + 0.35 * k, 1.4, 0.6); legRot(1, -1.3 - 0.35 * k, 1.4, 0.6);
          rig.rot[b.head * 3] -= 0.3; rig.rot[b.jaw * 3] -= 0.35;
        } else if (body === 'ox' || body === 'tortoise') {
          // a lowered head, pawing the ground, a butt
          rig.rot[b.neck * 3] += 0.45 + 0.25 * Math.max(0, k); legRot(0, -0.4 * Math.max(0, Math.sin(t * 3)), 0.6, 0);
          rig.rootT[2] += 0.05 * Math.max(0, k);
        } else {
          rig.rootR[0] -= 0.35 + 0.1 * k; rig.rootT[1] += 0.08;
          legRot(0, -1.0 - 0.4 * k, 0.6 + 0.4 * k, 0.4); legRot(1, -0.5, 0.4, 0.2);
          legRot(2, 0.25, -0.2, 0); legRot(3, 0.25, -0.2, 0);
          rig.rot[b.neck * 3] -= 0.3; rig.rot[b.head * 3] -= 0.2; rig.rot[b.jaw * 3] -= 0.55 * Math.max(0, Math.sin(t * 9));
        }
        tailSway(1, 0.35, 9);
        ears(0.6);
        break;
      }
      case AnimState.pray: {
        // cast: rising up with the head high; power flows (the shader glows)
        if (body === 'ape') {
          rig.rootR[0] -= 0.95; rig.rootT[1] += 0.2;
          legRot(0, -2.6, 0.3, 0); legRot(1, -2.6, 0.3, 0);
          legRot(2, -0.4, 0.5, 0); legRot(3, -0.4, 0.5, 0);
          rig.rot[b.head * 3] -= 0.4;
        } else {
          rig.rootR[0] -= 0.22; rig.rot[b.neck * 3] -= 0.55; rig.rot[b.head * 3] -= 0.35;
          legRot(2, 0.25, -0.2, 0); legRot(3, 0.25, -0.2, 0);
        }
        rig.shift[b.chest * 3 + 1] += Math.sin(t * 3) * 0.01;
        tailSway(1, 0.08, 2);
        break;
      }
      case AnimState.dance: {
        // play: bounding hops and play bows
        const k = Math.sin(t * 6);
        const hop = Math.max(0, k);
        rig.rootT[1] += hop * 0.12;
        const bow = (Math.sin(t * 0.9) > 0.3) ? 1 : 0;
        rig.rootR[0] += bow * 0.28;
        for (let i = 0; i < 2; i++) legRot(i, -0.3 * bow - 0.2 * hop, 0.4 * bow + 0.3 * hop, 0);
        tailSway(1, 0.4, 12);
        rig.rot[b.head * 3 + 1] += Math.sin(t * 2.5) * 0.3;
        ears(0.2 * hop);
        break;
      }
      case AnimState.work: {
        // throw: the ape rears and hurls overhand; a quadruped tosses its head
        const c = (t * 0.9) % 1;
        if (body === 'ape') {
          rig.rootR[0] -= 0.55; rig.rootT[1] += 0.08;
          const sw = c < 0.6 ? -2.4 * (c / 0.6) : -2.4 + 3.6 * Math.min(1, (c - 0.6) / 0.15);
          legRot(0, sw, 0.6, 0.3); legRot(1, -0.6, 0.6, 0.2);
        } else {
          rig.rot[b.neck * 3] += c < 0.5 ? 0.6 * (c / 0.5) : 0.6 - 1.4 * Math.min(1, (c - 0.5) / 0.12);
          legRot(0, -0.3 * Math.max(0, Math.sin(t * 6)), 0.5, 0);
        }
        tailSway(1, 0.2, 5);
        break;
      }
      case AnimState.held: {
        // dangling: legs hang, the tail droops, a slow paddle
        for (let i = 0; i < 4; i++) legRot(i, (i < 2 ? -0.25 : 0.25) + Math.sin(t * 2 + i) * 0.15, 0.2, 0.3);
        for (const tb of b.tail) rig.rot[tb * 3] += 0.4;
        rig.rot[b.neck * 3] += 0.3;
        ears(-0.4);
        break;
      }
      default: {
        // idle: looking about, now and then a sniff, a sit, a scratch or a yawn (a slow schedule per creature)
        const w = Math.floor(t / 6 + seed * 7);
        const pick = fract(Math.sin(w * 12.9898 + this.id * 78.233) * 43758.5453);
        const ph = (t / 6 + seed * 7) % 1;
        const env = Math.sin(Math.min(1, ph * 1.2) * Math.PI);
        rig.rot[b.neck * 3 + 1] += Math.sin(t * 0.35 + seed * 9) * 0.35;
        rig.rot[b.head * 3] += Math.sin(t * 0.5 + seed) * 0.08;
        if (pick < 0.2) { rig.rot[b.neck * 3] += 0.7 * env; rig.rot[b.head * 3] += 0.2 * env; }          // sniff the ground
        else if (pick < 0.35 && body !== 'tortoise') {                                                       // sit
          rig.rootR[0] -= 0.35 * env; rig.rootT[1] -= 0.12 * env;
          legRot(2, -0.9 * env, 1.4 * env, -0.5 * env); legRot(3, -0.9 * env, 1.4 * env, -0.5 * env);
        } else if (pick < 0.45) {                                                                            // yawn
          rig.rot[b.head * 3] -= 0.3 * env; rig.rot[b.jaw * 3] -= 0.6 * Math.pow(env, 3);
        } else if (pick < 0.55) {                                                                            // scratch
          legRot(3, -0.9 * env, 0.6 * env + 0.3 * Math.sin(t * 14) * env, 0); rig.rot[b.neck * 3 + 1] += 0.4 * env;
        }
        tailSway(1, 0.12, 1.1);
        ears(Math.sin(t * 0.7 + seed) > 0.95 ? 0.4 : 0);
        break;
      }
    }
  }

  dispose(): void {
    this.mat.dispose(); this.furMat.dispose(); this.depth.dispose(); this.furGeo?.dispose();
  }
}

const CREATURE_EXPOSURE_ON: IUniform<number> = { value: 0 };
const _v3s = new Vector3();
const _v3a = new Vector3();
const _v3b = new Vector3();
function fract(x: number): number { return x - Math.floor(x); }

// ───────────────────────────── the layer ─────────────────────────────

export class CreatureLayer {
  readonly group = new Group();
  private visuals = new Map<number, CreatureVisual>();
  private shared: Record<string, IUniform>;
  readonly falls: FootFall[] = [];

  constructor(shared: Record<string, IUniform>) {
    this.shared = shared;
    this.group.name = 'creatures';
    this.group.matrixAutoUpdate = false;
  }

  /** creatures on this world; `heldId` / `grip` when the hand holds one */
  update(list: CreatureView[], pv: PlanetView, dt: number, t: number, heldId: number, grip: Vector3 | null): void {
    CREATURE_EXPOSURE_ON.value = FX_EXPOSURE.value ? 1 : 0;
    this.falls.length = 0;
    for (const v of this.visuals.values()) v.seen = false;
    for (const c of list) {
      if (c.planet !== pv.id) continue;
      let vis = this.visuals.get(c.id);
      if (!vis) { vis = new CreatureVisual(c.id, this.shared); this.visuals.set(c.id, vis); this.group.add(vis.group); }
      vis.seen = true;
      vis.update(c, pv, dt, t, heldId === c.id && grip ? grip : null, this.falls);
    }
    for (const [id, v] of this.visuals) if (!v.seen) { this.group.remove(v.group); v.dispose(); this.visuals.delete(id); }
  }

  swapDepth(depth: boolean): void { for (const v of this.visuals.values()) v.swapDepth(depth); }

  get count(): number { return this.visuals.size; }

  dispose(): void { for (const v of this.visuals.values()) v.dispose(); this.visuals.clear(); }
}

export type { Rig };
