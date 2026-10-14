// GENESIS — the god's body (CONTRACT.md §15.8 walk: "the player's body on the surface ... the people can see it and react
// by belief"), drawn in the Touch's language (LIVING §3.6: the god's presence as light and weather): a figure a head
// taller than the people made of moving light and air — no robe, no halo — whose surface flows upward in slow bands,
// whose edges thin and break into motes that drift off it and rise. Its look follows how the people see the god
// (HandView.regard; `alignment` until the UI switches): trusted, warm light; feared, storm-dark — a smoky body with
// cold flickers inside; in between, pale air. It stands in a pool of its own light on the ground (a deferred light in
// the launch FX pass, render/life/ships.ts placeAvatar) and the grass round its feet stirs in its wind (GOD_WIND, read
// by the vegetation material). Legs and arms swing with the stride; floating (a held jump), the legs hang and the motes
// stream down from it.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CustomBlending, FrontSide, Group, Mesh, OneFactor, OneMinusSrcAlphaFactor,
  Points, ShaderMaterial, Vector3, Vector4, type IUniform,
} from 'three';
import { KitBuilder } from '../gen/meshkit.ts';
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
  /** metres the feet are off the ground (a jump, floating): its light stays centred on the body */
  lift: 0,
  visible: true,
  /** how the people see the god: −1 feared .. +1 trusted */
  alignment: 0.5,
};

/**
 * the god's wind on the vegetation round the walking body: body-frame position of the feet (xyz), strength (w; 0 when
 * no body walks). render/life/vegetation.ts bends grass, shrubs and low boughs away from it in a slow ripple.
 */
export const GOD_WIND: IUniform<Vector4> = { value: new Vector4(0, 0, 0, 0) };

/** the regard's colours: warm light (trusted), pale air, storm-dark (feared) — shared by the body, motes and pool */
export function regardColour(g: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const warm = [1.0, 0.74, 0.4], pale = [0.66, 0.8, 1.0], cold = [0.5, 0.55, 1.0];
  const t = Math.max(-1, Math.min(1, g));
  const a = t >= 0 ? pale : cold, b = t >= 0 ? warm : pale;
  const k = t >= 0 ? Math.min(1, t / 0.7) : 1 - Math.min(1, -t / 0.7);
  for (let i = 0; i < 3; i++) out[i] = a[i] + (b[i] - a[i]) * k;
  return out;
}

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${NOISE_GLSL}
uniform float uTime;
uniform float uFloat;
attribute float aExt;   // 0 in the body .. 1 at the extremities (the crown, the hands, the feet): where it thins away
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying float vExt;
varying float vViewZ;
void main() {
  vec3 p = position;
  // air in motion: the surface breathes and streams upward, more toward the extremities
  float n = snoise(vec3(p * 3.2 + vec3(0.0, -uTime * 0.9, 0.0)));
  p += normal * (0.012 + 0.035 * aExt) * n;
  p += vec3(0.0, 1.0, 0.0) * uFloat * aExt * 0.05 * sin(uTime * 3.0 + p.x * 9.0);
  vP = p;
  vExt = aExt;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform float uTime;
uniform float uRegard;
uniform vec3 uCol;
uniform float uDay;
uniform sampler2D tExposure;
uniform float uHasExposure;
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
varying float vExt;
varying float vViewZ;
void main() {
#include <logdepthbuf_fragment>
  // drawn over the composited image (the launch FX pass): hidden by whatever stands in front of it (people, walls)
  if (vViewZ > texture(tSceneDepth, gl_FragCoord.xy / uResolution).r + 0.03) discard;
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  float nv = abs(dot(n, v));
  float fres = pow(1.0 - nv, 2.2);
  float trusted = smoothstep(-0.1, 0.8, uRegard);
  float feared = smoothstep(0.1, -0.8, uRegard);
  // bands of light flowing up through the body, finer wisps over them
  float flow = snoise(vec3(vP.x * 4.0, vP.y * 2.6 - uTime * 1.1, vP.z * 4.0)) * 0.5 + 0.5;
  float wisp = snoise(vec3(vP * 11.0 + vec3(0.0, -uTime * 2.4, 0.0))) * 0.5 + 0.5;
  // the edges thin and break up into motes: the silhouette dissolves (more at the crown, hands and feet)
  float dissolve = fres * 0.8 + vExt * 0.6;
  float grain = snoise(vec3(vP * 26.0 + vec3(0.0, -uTime * 3.0, 0.0))) * 0.5 + 0.5;
  if (grain < dissolve * 0.9 - 0.08) discard;
  float edge = 1.0 - smoothstep(0.0, 0.18, grain - (dissolve * 0.9 - 0.08));
  float ex = uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 0.02) : 1.0;
  // (display-referred: as bright against a noon street as at night, never a white blob — saturated so the tone curve
  // keeps it gold / pale / cold)
  float dk = mix(1.0, 1.0 / ex, 0.65);
  // (a translucent core — the street shows through it — under a bright rim and bright breaking edges: a figure of light
  // and air, not a pale statue; the bands of light flowing up it are what fills it in)
  vec3 light = uCol * (0.06 + 0.34 * flow * flow + 0.3 * wisp * wisp + 1.25 * fres + 0.95 * edge) * dk;
  // light: mostly added (a trusted god is light); feared: a storm-dark body that hides what is behind it, cold light
  // flickering inside it like lightning in a cloud
  float flick = smoothstep(0.86, 1.0, snoise(vec3(vP.y * 3.0, uTime * 2.3, 1.7))) * (0.5 + 0.5 * wisp);
  vec3 storm = vec3(0.018, 0.02, 0.028) * (0.6 + 0.6 * flow) + uCol * (flick * 2.4 + fres * 0.6 + edge * 0.5) * dk;
  vec3 c = mix(light, storm, feared);
  // coverage: the light body lets the world through (its light added), the storm body occludes it
  float a = mix(0.06 + 0.12 * flow * (1.0 - trusted), 0.62 + 0.25 * flow, feared) * (1.0 - edge * 0.6);
  gl_FragColor = vec4(c * (0.7 + 0.3 * uDay), clamp(a, 0.0, 0.95));
}
`;

/** motes rising off the body (GPU-animated by time; each loops from a point on the body upward and out, fading) */
const MOTE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aM;   // birth height (0..1 of the body), angle, radius share, seed
uniform float uTime;
uniform float uFloat;
uniform float uPx;
varying float vA;
varying float vSeed;
varying float vViewZ;
void main() {
  float life = 2.2 + 2.0 * fract(aM.w * 7.3);
  float a = fract(uTime / life + aM.w);
  float h = aM.x * 2.0;
  float ang = aM.y + a * (1.2 + aM.w) * (fract(aM.w * 3.1) > 0.5 ? 1.0 : -1.0);
  float r = (0.12 + 0.22 * aM.z) * (0.6 + 0.4 * sin(h * 2.4)) + a * (0.35 + 0.5 * aM.z);
  // they rise off a standing body, stream down and back from a floating one
  float rise = mix(a * (0.8 + 1.2 * aM.w), -a * 1.4, uFloat);
  vec3 p = vec3(cos(ang) * r, h + rise, sin(ang) * r * 0.75);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vViewZ = -mv.z;
  vA = smoothstep(0.0, 0.12, a) * (1.0 - smoothstep(0.45, 1.0, a));
  vSeed = aM.w;
  gl_PointSize = clamp((0.035 + 0.04 * fract(aM.w * 11.0)) * uPx / max(-mv.z, 0.1), 1.0, 14.0);
#include <logdepthbuf_vertex>
}
`;
const MOTE_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uCol;
uniform float uRegard;
uniform sampler2D tExposure;
uniform float uHasExposure;
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
varying float vA;
varying float vSeed;
varying float vViewZ;
void main() {
#include <logdepthbuf_fragment>
  if (vViewZ > texture(tSceneDepth, gl_FragCoord.xy / uResolution).r + 0.03) discard;
  vec2 d = gl_PointCoord - 0.5;
  float g = exp(-dot(d, d) * 18.0);
  float ex = uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 0.02) : 1.0;
  // (feared: fewer, colder sparks among the smoke)
  float k = mix(1.0, 0.45, smoothstep(0.1, -0.8, uRegard));
  gl_FragColor = vec4(uCol * g * vA * k * 1.6 * mix(1.0, 1.0 / ex, 0.65), 0.0);
}
`;

const MOTES = 220;

interface Limb { pivot: Group; mesh: Mesh }

/** tag a built part's vertices with how far out toward an extremity they lie (by their local height) */
function withExt(geo: BufferGeometry, ext: (y: number) => number): BufferGeometry {
  const p = geo.getAttribute('position');
  const a = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) a[i] = Math.max(0, Math.min(1, ext(p.getY(i))));
  geo.setAttribute('aExt', new BufferAttribute(a, 1));
  return geo;
}
const ramp = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Avatar {
  readonly group = new Group();
  private material: ShaderMaterial;
  private moteMat: ShaderMaterial;
  private uniforms: Record<string, IUniform>;
  private legs: Limb[] = [];
  private arms: Limb[] = [];
  private motes: Points;

  /**
   * `depth`: the linear scene depth and the frame size of the pass it is drawn in (`layer`: the launch FX pass, over
   * the composited image — a body of light and air is not an opaque mesh: it is tested against the scene by hand)
   */
  constructor(depth: { tSceneDepth: IUniform; uResolution: IUniform }, layer: number) {
    this.group.name = 'god-avatar';
    this.uniforms = {
      uTime: { value: 0 }, uFloat: { value: 0 }, uRegard: { value: 0.5 }, uCol: { value: new Vector3(1, 0.8, 0.5) }, uDay: { value: 1 },
      tExposure: FX_EXPOSURE, uHasExposure: { value: 0 }, uPx: { value: 600 }, tSceneDepth: depth.tSceneDepth, uResolution: depth.uResolution,
    };
    // premultiplied: light adds, a storm body covers (front faces: no doubled layer where the far side shows through)
    this.material = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, side: FrontSide, transparent: true, depthWrite: false, depthTest: false,
      blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
    });
    // the body: a slender figure, the shoulders a little broad, the head small — no robe; the limbs are separate
    const kt = new KitBuilder();
    kt.lathe(0, 0, [[0.05, 0.92], [0.13, 0.96], [0.15, 1.08], [0.13, 1.22], [0.165, 1.4], [0.2, 1.55], [0.17, 1.63], [0.065, 1.68], [0.05, 1.73]], 18, 0, 0, [1, 1, 1], 1, 1);
    for (let i = 0; i < kt.pos.length; i += 3) { kt.pos[i] *= 1.22; kt.pos[i + 2] *= 0.74; }
    kt.lathe(0, 0, [[0.02, 1.72], [0.085, 1.75], [0.11, 1.82], [0.106, 1.9], [0.078, 1.96], [0.02, 1.99]], 16, 0, 0, [1, 1, 1], 1, 1);
    const torso = new Mesh(withExt(kt.build(), (y) => ramp(1.62, 1.99, y) + 0.5 * ramp(1.0, 0.92, y)), this.material);
    this.group.add(torso);
    // legs (pivot at the hip) and arms (pivot at the shoulder): the hands and feet thin away (aKit.w = extremity)
    for (const sx of [-1, 1]) {
      const kl = new KitBuilder();
      kl.tube([[0, 0, 0], [0, -0.47, 0.035], [0, -0.9, 0]], [0.075, 0.055, 0.035], 10, 0, 0, [1, 1, 1], { cap: true, ao1: 0.4 });
      const pivot = new Group();
      pivot.position.set(sx * 0.1, 0.96, 0);
      const mesh = new Mesh(withExt(kl.build(), (y) => ramp(-0.55, -0.9, y)), this.material);
      pivot.add(mesh);
      this.group.add(pivot);
      this.legs.push({ pivot, mesh });
      const ka = new KitBuilder();
      ka.tube([[0, 0, 0], [sx * 0.05, -0.29, 0.02], [sx * 0.07, -0.55, 0.07], [sx * 0.075, -0.66, 0.08]], [0.05, 0.038, 0.03, 0.012], 9, 0, 0, [1, 1, 1], { cap: true });
      const ap = new Group();
      ap.position.set(sx * 0.24, 1.58, 0);
      const am = new Mesh(withExt(ka.build(), (y) => ramp(-0.42, -0.66, y)), this.material);
      ap.add(am);
      this.group.add(ap);
      this.arms.push({ pivot: ap, mesh: am });
    }
    // the motes
    const mg = new BufferGeometry();
    const M = new Float32Array(MOTES * 4);
    for (let i = 0; i < MOTES; i++) {
      const h = (i * 0.618034) % 1, s = ((i * 0.754877) % 1);
      M.set([0.05 + 0.95 * Math.pow(h, 0.8), s * Math.PI * 2, (i * 0.3819) % 1, (i * 0.1234567 + 0.5 * s) % 1], i * 4);
    }
    mg.setAttribute('position', new BufferAttribute(new Float32Array(MOTES * 3), 3));
    mg.setAttribute('aM', new BufferAttribute(M, 4));
    this.moteMat = new ShaderMaterial({
      vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
    });
    this.motes = new Points(mg, this.moteMat);
    this.group.add(this.motes);
    for (const o of this.group.children) o.traverse((c) => { (c as Mesh).frustumCulled = false; c.layers.set(layer); });
    this.motes.renderOrder = 1;
  }

  /** pose for this frame (AVATAR_STATE) and the time; `sunView` = the sun in view space; `day` 0..1 */
  pose(time: number, sunView: Vector3 | null, day = 1, pxScale = 600): void {
    const s = AVATAR_STATE;
    const u = this.uniforms;
    u.uTime.value = time % 1000;
    u.uRegard.value = s.alignment;
    u.uFloat.value = s.float;
    u.uDay.value = day;
    u.uPx.value = pxScale;
    u.uHasExposure.value = FX_EXPOSURE.value ? 1 : 0;
    const c = regardColour(s.alignment);
    (u.uCol.value as Vector3).set(c[0], c[1], c[2]);
    void sunView;
    const sw = Math.sin(s.stride) * s.moving * (1 - s.float);
    // legs swing opposite; floating, they hang a little back
    this.legs[0].pivot.rotation.x = sw * 0.55 + s.float * 0.18;
    this.legs[1].pivot.rotation.x = -sw * 0.55 + s.float * 0.28;
    // arms counter-swing; floating, they open a little, palms out
    this.arms[0].pivot.rotation.x = -sw * 0.4;
    this.arms[1].pivot.rotation.x = sw * 0.4;
    this.arms[0].pivot.rotation.z = -0.08 - s.float * 0.45;
    this.arms[1].pivot.rotation.z = 0.08 + s.float * 0.45;
    this.group.visible = s.active && s.visible;
  }

  dispose(): void {
    this.group.traverse((o) => { const m = o as Mesh; if (m.geometry) m.geometry.dispose(); });
    this.material.dispose();
    this.moteMat.dispose();
  }
}
