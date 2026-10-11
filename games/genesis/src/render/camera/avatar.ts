// GENESIS — the god's body (CONTRACT.md §15.8 walk: "the player's body on the surface ... the people can see it and react
// by belief"): a luminous figure a head taller than the people, robed, haloed, walking on the curved ground (and on the
// water). Its look follows the god's alignment (HandView.alignment): a kind god is gold-white light with a soft inner
// glow and a bright halo; a feared god a dark figure veined with embers under a red rim, its halo a dull crown of fire;
// in between, pale silver-blue. The light it gives falls on the ground and the people around it (a deferred light in
// the launch FX pass). Parts are animated: legs and arms swing with the stride, the robe sways and trails, the halo
// turns; floating (a held jump) the legs hang and the robe streams.

import {
  AdditiveBlending, CircleGeometry, DoubleSide, Group, Mesh, ShaderMaterial, Vector3, type IUniform,
} from 'three';
import { KitBuilder, type V3 } from '../gen/meshkit.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { FX_EXPOSURE } from '../fx/particles.ts';

/** where the body stands this frame (set by camera/walk.ts; drawn by the ship layer's frame on the planet's group) */
export const AVATAR_STATE = {
  active: false,
  planet: -1,
  /** body-frame position of the feet (m), the body's up and facing (unit vectors) */
  pos: new Vector3(),
  up: new Vector3(0, 1, 0),
  fwd: new Vector3(0, 0, 1),
  /** stride phase (rad), stride amount 0..1, float 0..1 (off the ground), visible (third person) */
  stride: 0,
  moving: 0,
  float: 0,
  /** metres the feet are off the ground (a jump, floating): the glow stays on the ground */
  lift: 0,
  visible: true,
  /** −1 cruel .. +1 kind */
  alignment: 0.5,
};

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aKit;
uniform float uTime;
uniform float uSway;
uniform float uFloat;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying float vPart;
void main() {
  vec3 p = position;
  vPart = aKit.y;
  // the robe sways with the stride and streams when floating (more toward the hem)
  if (aKit.y > 0.5 && aKit.y < 1.5) {
    float k = clamp((1.15 - p.y) / 1.1, 0.0, 1.0);
    float a = atan(p.z, p.x);
    p.z -= k * k * (0.06 * uSway + 0.18 * uFloat);
    p.x += k * 0.025 * sin(uTime * 2.3 + p.y * 6.0 + a * 2.0);
    p.z += k * 0.02 * sin(uTime * 1.7 + a * 3.0);
    p.y += uFloat * k * 0.08 * sin(uTime * 3.0 + a * 4.0);
  }
  vP = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform float uTime;
uniform float uAlign;
uniform vec3 uSunDirView;
uniform sampler2D tExposure;
uniform float uHasExposure;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying float vPart;
void main() {
#include <logdepthbuf_fragment>
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  if (dot(n, v) < 0.0) n = -n;
  float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.4);
  float good = clamp(uAlign * 0.5 + 0.5, 0.0, 1.0);
  // light flowing up through the body
  float e = snoise(vec3(vP.x * 5.0, vP.y * 4.0 - uTime * 1.3, vP.z * 5.0)) * 0.5 + 0.5;
  float e2 = snoise(vec3(vP * 13.0 + vec3(0.0, -uTime * 2.6, 0.0))) * 0.5 + 0.5;
  vec3 kind = vec3(1.0, 0.84, 0.58);
  vec3 pale = vec3(0.72, 0.84, 1.0);
  vec3 dark = vec3(0.95, 0.16, 0.05);
  vec3 col = good > 0.5 ? mix(pale, kind, (good - 0.5) * 2.0) : mix(dark, pale, good * 2.0);
  // the body: bright for a kind god, a dark shell veined with embers for a feared one
  float body = mix(0.04, 0.85, smoothstep(0.15, 0.75, good)) * (0.55 + 0.45 * e);
  float veins = (1.0 - smoothstep(0.0, 0.08, abs(e2 - 0.5))) * (1.0 - good) * 1.6;
  float rim = fres * mix(2.6, 1.8, good);
  float robe = vPart > 0.5 && vPart < 1.5 ? 0.75 : 1.0;
  float halo = vPart > 2.5 ? 3.5 : 0.0;
  // a hint of form: the side away from the sun a little dimmer
  float form = 0.82 + 0.18 * clamp(dot(n, uSunDirView) * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = col * (body * robe * form + rim + veins + halo);
  // display-referred like the fire: a bright figure by day, not a white blob by night
  float ex = uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 0.02) : 1.0;
  gl_FragColor = vec4(c * 2.4 * mix(1.0, 1.0 / ex, 0.6), 1.0);
}
`;

const GLOW_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
#include <logdepthbuf_vertex>
}
`;
const GLOW_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uAlign;
uniform float uK;
uniform sampler2D tExposure;
uniform float uHasExposure;
varying vec2 vUv;
void main() {
#include <logdepthbuf_fragment>
  float r = length(vUv - 0.5) * 2.0;
  float g = exp(-r * r * 4.0) * (1.0 - smoothstep(0.85, 1.0, r));
  float good = clamp(uAlign * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = good > 0.5 ? mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.82, 0.5), (good - 0.5) * 2.0) : mix(vec3(0.9, 0.12, 0.04), vec3(0.72, 0.84, 1.0), good * 2.0);
  float ex = uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 0.02) : 1.0;
  gl_FragColor = vec4(col * g * uK * 0.7 * mix(1.0, 1.0 / ex, 0.6), 1.0);
}
`;

const PART_ROBE = 1, PART_HALO = 3;

interface Limb { pivot: Group; mesh: Mesh }

export class Avatar {
  readonly group = new Group();
  private material: ShaderMaterial;
  private glowMat: ShaderMaterial;
  private uniforms: Record<string, IUniform>;
  private legs: Limb[] = [];
  private arms: Limb[] = [];
  private halo: Mesh;
  private glow: Mesh;

  constructor() {
    this.group.name = 'god-avatar';
    this.uniforms = {
      uTime: { value: 0 }, uSway: { value: 0 }, uFloat: { value: 0 }, uAlign: { value: 0.5 }, uSunDirView: { value: new Vector3(0, 1, 0) },
      tExposure: FX_EXPOSURE, uHasExposure: { value: 0 },
    };
    this.material = new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, side: DoubleSide });
    // torso and head
    const kt = new KitBuilder();
    kt.lathe(0, 0, [[0.14, 0.98], [0.155, 1.1], [0.13, 1.22], [0.165, 1.4], [0.205, 1.56], [0.18, 1.63], [0.07, 1.68], [0.055, 1.73]], 18, 0, 0, [1, 1, 1], 1, 1);
    for (let i = 0; i < kt.pos.length; i += 3) { kt.pos[i] *= 1.25; kt.pos[i + 2] *= 0.78; }
    kt.lathe(0, 0, [[0.02, 1.72], [0.085, 1.75], [0.112, 1.82], [0.108, 1.9], [0.08, 1.96], [0.02, 1.985]], 16, 0, 0, [1, 1, 1], 1, 1);
    const torso = new Mesh(kt.build(), this.material);
    // robe: a lathe from the waist to the hem with folds
    const kr = new KitBuilder();
    const from = 0;
    kr.lathe(0, 0, [[0.215, 1.16], [0.25, 1.0], [0.3, 0.75], [0.36, 0.45], [0.42, 0.14], [0.44, 0.06]], 32, 0, PART_ROBE, [1, 1, 1], 1, 1);
    kr.jitterRadial(from, 0, 0, (a, y) => Math.cos(a * 7) * 0.022 * (1.16 - y) + Math.cos(a * 3 + 1) * 0.012 * (1.16 - y));
    // the hem's inside
    kr.lathe(0, 0, [[0.43, 0.065], [0.4, 0.2], [0.2, 0.9]], 32, 0, PART_ROBE, [1, 1, 1], 1, 1);
    const robe = new Mesh(kr.build(), this.material);
    this.group.add(torso, robe);
    // legs (pivot at the hip) and arms (pivot at the shoulder)
    for (const sx of [-1, 1]) {
      const kl = new KitBuilder();
      kl.tube([[0, 0, 0], [0, -0.47, 0.035], [0, -0.92, 0]], [0.08, 0.06, 0.045], 10, 0, 0, [1, 1, 1], { cap: true });
      kl.box(-0.045, -0.98, -0.04, 0.045, -0.92, 0.15, 0, 0, [1, 1, 1], {});
      const pivot = new Group();
      pivot.position.set(sx * 0.1, 0.98, 0);
      const mesh = new Mesh(kl.build(), this.material);
      pivot.add(mesh);
      this.group.add(pivot);
      this.legs.push({ pivot, mesh });
      const ka = new KitBuilder();
      ka.tube([[0, 0, 0], [sx * 0.05, -0.29, 0.02], [sx * 0.07, -0.55, 0.07]], [0.052, 0.04, 0.032], 9, 0, 0, [1, 1, 1], { cap: true });
      ka.lathe(sx * 0.075, 0.08, [[0.01, -0.68], [0.045, -0.64], [0.05, -0.6], [0.03, -0.56]], 8, 0, 0, [1, 1, 1], 1, 1);
      const ap = new Group();
      ap.position.set(sx * 0.25, 1.6, 0);
      const am = new Mesh(ka.build(), this.material);
      ap.add(am);
      this.group.add(ap);
      this.arms.push({ pivot: ap, mesh: am });
    }
    // the halo
    const kh = new KitBuilder();
    const ring: V3[] = [];
    for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; ring.push([Math.cos(a) * 0.19, 0, Math.sin(a) * 0.19]); }
    kh.tube(ring, new Array(41).fill(0.011), 6, 0, PART_HALO, [1, 1, 1], {});
    this.halo = new Mesh(kh.build(), this.material);
    this.halo.position.set(0, 2.1, -0.05);
    this.halo.rotation.x = -0.35;
    this.group.add(this.halo);
    // a glow on the ground under it
    this.glowMat = new ShaderMaterial({
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: { uAlign: this.uniforms.uAlign, uK: { value: 1 }, tExposure: FX_EXPOSURE, uHasExposure: this.uniforms.uHasExposure },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.glow = new Mesh(new CircleGeometry(3.2, 40), this.glowMat);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.06;
    this.glow.renderOrder = 4;
    this.group.add(this.glow);
    for (const o of this.group.children) o.traverse((c) => { (c as Mesh).frustumCulled = false; });
  }

  /** pose for this frame (AVATAR_STATE) and the time; `sunView` = the sun in view space */
  pose(time: number, sunView: Vector3 | null): void {
    const s = AVATAR_STATE;
    const u = this.uniforms;
    u.uTime.value = time % 1000;
    u.uAlign.value = s.alignment;
    u.uSway.value = s.moving;
    u.uFloat.value = s.float;
    u.uHasExposure.value = FX_EXPOSURE.value ? 1 : 0;
    if (sunView) (u.uSunDirView.value as Vector3).copy(sunView);
    const sw = Math.sin(s.stride) * s.moving * (1 - s.float);
    // legs swing opposite, knees implied by the swing; floating, they hang a little back
    this.legs[0].pivot.rotation.x = sw * 0.55 + s.float * 0.18;
    this.legs[1].pivot.rotation.x = -sw * 0.55 + s.float * 0.28;
    // arms counter-swing; floating, they open a little, palms out
    this.arms[0].pivot.rotation.x = -sw * 0.4;
    this.arms[1].pivot.rotation.x = sw * 0.4;
    this.arms[0].pivot.rotation.z = -0.08 - s.float * 0.45;
    this.arms[1].pivot.rotation.z = 0.08 + s.float * 0.45;
    this.halo.rotation.y = time * 0.4;
    (this.glowMat.uniforms.uK as IUniform<number>).value = 1 - 0.6 * s.float;
    this.glow.position.y = 0.06 - s.lift;
    this.group.visible = s.active && s.visible;
  }

  dispose(): void {
    this.group.traverse((o) => { const m = o as Mesh; if (m.geometry) m.geometry.dispose(); });
    this.material.dispose();
    this.glowMat.dispose();
  }
}
