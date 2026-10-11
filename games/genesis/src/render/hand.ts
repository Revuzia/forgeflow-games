// GENESIS — the god hand in the world (CONTRACT.md §11.4, §15.6; the visible hand of Black & White, fixed).
//
// One articulated right hand (gen/handgen.ts: an implicit-surface hand with palm, pads, knuckles, nails, webbing, 21
// bones) drawn in the primary planet's body frame:
//   * Placement: it follows the cursor's ground hit (the App feeds it every frame) through a critically damped spring
//     — lag and inertia — leaning into its motion; without a cursor it goes where the sim's hand is (HandView). Its
//     size follows the camera distance (≈ 13 % of the view height) so it reads from a street and from orbit; it hovers
//     a little higher while carrying and dips toward what it can take; fingertips never sink into the ground.
//   * Poses: open (relaxed), reach (over something it can take), grab (a pinch for a person, a claw for a boulder or a
//     tree), point (a power armed), slap (flat, the wrist snapping down), stroke (fingers together, a slow caress
//     wave), cast (fingers splayed, a tremor of power) — every joint eases between poses, the little finger leading
//     when the hand closes; the fingers breathe when idle.
//   * Skin: a lit MeshStandardMaterial driven by the planet's sun, sky, shadows and moon like everything else, with a
//     subsurface wrap and light glowing through the fingers when backlit, a rim of the god's glow (warm gold for a
//     benevolent god, a cold violet for a cruel one; the skin itself turns ashen and the nails dark), procedural normal
//     detail on the skin (pores, the joint creases of the palm and fingers, knuckle wrinkles, tendons fanning over the
//     back of the hand, veins, the palm's lines, fingerprints up close), glossy nails with a lunula, and a forearm that
//     dissolves into light. A glow shell (drawn over the composited image) halos its silhouette.
//   * What it holds: a person dangles between thumb and forefinger (render/life/crowds.ts draws them where the hand
//     says); a boulder, an uprooted tree or a bundle sits in its grip.
//   * Its contact shadow on the ground (a decal; the sun's shadow too when near), a light trail behind a fast motion
//     (a throw), and while carrying, the arc a throw toward the cursor would fly with a reticle where it would land.

import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Matrix4, Mesh, MeshStandardMaterial, Points, ShaderMaterial,
  AdditiveBlending, Vector3, type IUniform,
} from 'three';
import { makePropMaterial } from './fx/propmat.ts';
import { handMesh, type HandMesh } from './gen/handgen.ts';
import { Rig, RIG_SKIN_GLSL, type V3 } from './gen/rig.ts';
import { NOISE_GLSL } from './shaders/noise.glsl.ts';
import { ATMO_PARS, SKY_LOOKUP } from './shaders/atmosphere.glsl.ts';
import { SHADOW_GLSL } from './planet/lights.ts';
import { MOON_PARS, moonDirect } from './shaders/moon.glsl.ts';
import { FX_DEPTH_GLSL, FX_EXPOSURE, FX_LAYER, clamp01, smooth } from './fx/fxcommon.ts';
import { DECAL, decal, type DecalPass } from './fx/decals.ts';
import type { PlanetView } from '../client/worldview.ts';
import type { HandView } from '../sim/types.ts';
import { groundHeight } from '../sim/grid/surface.ts';

export type HandPose = 'open' | 'reach' | 'grab' | 'claw' | 'fist' | 'point' | 'slap' | 'stroke' | 'cast';

/** the UI's hand cursor states (src/ui/handinput.ts HandCursor) */
export type UiHandPose = 'none' | 'open' | 'carry' | 'press' | 'tool' | 'aim' | 'slap';

export interface HandCursor {
  planet: number;
  /** body-frame unit vector of the ground under the cursor */
  dir: ArrayLike<number>;
}

export interface HandFrame {
  pv: PlanetView;
  hand: HandView | null;
  camBody: Vector3;
  /** camera forward and up in the body frame */
  camFwd: Vector3;
  camUp: Vector3;
  /** real seconds since the last frame (motion), and the FX clock (animation; it stops while the sim is paused) */
  dt: number;
  fxTime: number;
  fxDt: number;
  cursor: HandCursor | null;
  uiPose: UiHandPose;
  aiming: boolean;
  decals: DecalPass;
  /** the primary planet's shared uniforms (proxied) */
  shared: Record<string, IUniform>;
}

const NB = 21;

// ───────────────────────────── shaders ─────────────────────────────

const SKIN_VERT_PARS = /* glsl */ `
uniform mat4 uBones[${NB}];
uniform mat4 uHandToBody;
${RIG_SKIN_GLSL}
attribute vec3 aRest;
attribute vec4 aMark;
attribute vec2 aPart;
varying vec3 vRest;
varying vec4 vMark;
varying vec2 vPart;
varying vec3 vBodyPos;
`;

const SKIN_FRAG_PARS = /* glsl */ `
${NOISE_GLSL}
${ATMO_PARS}
${SKY_LOOKUP}
${SHADOW_GLSL}
${MOON_PARS}
uniform mat3 uBodyToView;
uniform vec3 uSunDirBody;
uniform vec3 uSunDirView;
uniform vec3 uNightAmbient;
uniform float uHandScale;
uniform float uAlign;
uniform vec3 uGlowCol;
uniform float uGlowK;
uniform float uPresence;
uniform float uHandTime;
uniform sampler2D tExposure;
uniform float uHasExposure;
varying vec3 vRest;
varying vec4 vMark;
varying vec2 vPart;
varying vec3 vBodyPos;

float hsat(float x) { return clamp(x, 0.0, 1.0); }
// distance from p to the segment ab (2D)
float seg2(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = hsat(dot(pa, ba) / dot(ba, ba)); return length(pa - ba * h); }

// the skin's relief (hand units): pores, creases, knuckle wrinkles, tendons, veins, palm lines, fingerprints
float skinHeight(vec3 P, vec4 M, vec2 part, float fine) {
  float h = 0.0;
  float dors = M.y;
  float finger = part.x;
  // pores and fine grain (only where a pixel is small enough to hold them)
  h += 0.00045 * snoise(P * 820.0) * fine + 0.0008 * snoise(P * 260.0) * fine;
  // flexion creases on the palm side of every finger joint (two close lines), wrinkles over the knuckles' backs
  float c = M.z;
  float palmar = hsat(-dors * 2.0);
  float dorsal = hsat(dors * 2.0 - 0.2);
  if (finger < 4.5) {
    h -= 0.0045 * palmar * (exp(-pow((c - 0.004) / 0.0028, 2.0)) + 0.8 * exp(-pow((c + 0.005) / 0.0028, 2.0)));
    float wr = exp(-pow(c / 0.022, 2.0));
    h -= 0.0016 * dorsal * wr * (0.5 + 0.5 * sin(c * 520.0 + snoise(P * 60.0) * 2.0)) * fine;
  }
  // the palm: tendons fanning from the wrist to the knuckles on the back, the three great lines on the front
  if (finger > 4.5 && finger < 5.5) {
    vec2 q = P.xz;
    float t = 0.0;
    t += exp(-pow(seg2(q, vec2(0.02, 0.06), vec2(0.136, 0.53)) / 0.011, 2.0));
    t += exp(-pow(seg2(q, vec2(0.0, 0.06), vec2(0.041, 0.55)) / 0.012, 2.0));
    t += exp(-pow(seg2(q, vec2(-0.02, 0.06), vec2(-0.052, 0.53)) / 0.011, 2.0));
    t += exp(-pow(seg2(q, vec2(-0.04, 0.07), vec2(-0.134, 0.48)) / 0.01, 2.0));
    h += 0.0065 * dorsal * t * smoothstep(0.02, 0.16, P.z) * (1.0 - smoothstep(0.42, 0.53, P.z));
    // heart, head and life lines (curves on the palm's front)
    float heart = abs(P.z - (0.47 - 0.25 * pow(P.x + 0.16, 2.0) * 4.0 + 0.02 * sin(P.x * 30.0)));
    float headL = abs(P.z - (0.38 - 0.18 * (P.x + 0.1) + 0.015 * sin(P.x * 25.0 + 1.0)));
    float life = abs(length(P.xz - vec2(0.2, 0.12)) - 0.16);
    float lines = exp(-pow(heart / 0.0035, 2.0)) * step(-0.17, P.x) * step(P.x, 0.12)
                + exp(-pow(headL / 0.0035, 2.0)) * step(-0.14, P.x) * step(P.x, 0.15)
                + exp(-pow(life / 0.0035, 2.0)) * step(0.13, P.z) * step(P.z, 0.42) * step(P.x, 0.12);
    h -= 0.004 * palmar * lines;
  }
  // veins: meandering ridges over the back of the hand and the forearm
  if (finger > 4.5) {
    float v = 1.0 - abs(snoise(vec3(P.x * 11.0 + snoise(P * 7.0) * 0.6, P.z * 3.5, 3.0)));
    h += 0.0035 * pow(v, 10.0) * dorsal * (1.0 - smoothstep(0.4, 0.5, P.z));
  }
  // fingerprints: concentric ridges on the pads (up close only)
  if (finger < 4.5 && part.y > 0.7) {
    h += 0.00025 * sin(length(P.xz) * 2600.0 + snoise(P * 90.0) * 3.0) * palmar * fine;
  }
  return h;
}

vec3 bumpNormal(vec3 surfPos, vec3 n, float hgt) {
  vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
  return normalize(abs(det) * n - grad);
}
`;

const SKIN_SURFACE = /* glsl */ `
  // presence: the hand materialises from light (the forearm always fades toward the elbow)
  float dn = fbm3(vRest * 9.0 + vec3(0.0, uHandTime * 0.25, 0.0)) * 0.5 + 0.5;
  float arm = smoothstep(-0.56, -0.2, vRest.z);
  float keep = arm * uPresence;
  if (dn > keep * 1.05) discard;
  float edge = 1.0 - smoothstep(0.0, 0.09, keep * 1.05 - dn);
  float good = hsat(uAlign), cruel = hsat(-uAlign);
  float fine = 1.0 - smoothstep(0.0008, 0.004, length(fwidth(vRest)));
  // albedo: warm, alive skin; ashen and cold for a cruel god
  vec3 skin = mix(vec3(0.58, 0.40, 0.31), vec3(0.66, 0.47, 0.33), good);
  skin = mix(skin, vec3(0.2, 0.2, 0.235), cruel * 0.85);
  float palmar = hsat(-vMark.y * 1.5);
  skin = mix(skin, skin * vec3(1.12, 1.04, 1.0), palmar * 0.7);
  // blood near the surface: knuckles, fingertips, creases and the finger joints flush; the back of the hand cooler
  float tip = smoothstep(0.75, 1.0, vPart.y) * step(vPart.x, 4.5);
  float joint = exp(-pow(vMark.z / 0.03, 2.0)) * step(vPart.x, 4.5) * (0.4 + 0.6 * hsat(vMark.y));
  float flush = hsat(tip * 0.8 + joint * 0.5);
  skin = mix(skin, skin * mix(vec3(1.12, 0.82, 0.78), vec3(0.85, 0.75, 0.95), cruel), flush * 0.6);
  skin *= 0.93 + 0.1 * fbm3(vRest * 30.0) + 0.04 * snoise(vRest * 140.0) * fine;
  // veins show faintly through the back of the hand (dark for a cruel god)
  float vn = 1.0 - abs(snoise(vec3(vRest.x * 11.0 + snoise(vRest * 7.0) * 0.6, vRest.z * 3.5, 3.0)));
  float vein = pow(vn, 10.0) * hsat(vMark.y * 2.0) * step(4.5, vPart.x) * (1.0 - smoothstep(0.4, 0.5, vRest.z));
  skin = mix(skin, mix(vec3(0.42, 0.36, 0.42), vec3(0.06, 0.04, 0.08), cruel), vein * mix(0.25, 0.7, cruel));
  // nails: a glossy pink plate with a pale lunula and a white free edge; dark and sharp-edged for a cruel god
  float nail = smoothstep(0.35, 0.75, vMark.x);
  vec3 nailC = mix(vec3(0.72, 0.52, 0.47), vec3(0.06, 0.05, 0.07), cruel);
  float lun = smoothstep(0.82, 0.78, vPart.y) * (1.0 - cruel);
  nailC = mix(nailC, vec3(0.85, 0.78, 0.74), lun * 0.6);
  nailC = mix(nailC, vec3(0.86, 0.84, 0.8), smoothstep(0.965, 0.99, vPart.y) * (1.0 - cruel * 0.8));
  vec3 alb = mix(skin, nailC, nail);
  diffuseColor.rgb = alb;
  float hRough = mix(mix(0.56, 0.44, palmar), 0.24, nail);
  // relief → normal (in metres: the hand's scale)
  float hgt = skinHeight(vRest, vMark, vPart, fine) * (1.0 - nail * 0.9) * uHandScale;
`;

const SKIN_LIGHT = /* glsl */ `
  {
    float rP = length(vBodyPos);
    vec3 upB = vBodyPos / rP;
    float sh = sunShadow(-vViewPosition, normal);
    vec3 sunRaw = uSunE * sunTransmittance(rP, dot(upB, uSunDirBody));
    vec3 sunCol = sunRaw * sh;
    IncidentLight sunL;
    sunL.direction = uSunDirView;
    sunL.color = sunCol;
    sunL.visible = true;
    RE_Direct(sunL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    ${moonDirect('vBodyPos', '1.0')}
    // subsurface: light wraps past the terminator, reddened by the blood under the skin
    vec3 sssCol = mix(vec3(1.0, 0.38, 0.22), vec3(0.45, 0.4, 0.9), hsat(-uAlign));
    float ndl = dot(geometryNormal, uSunDirView);
    float wrap = max(0.0, (ndl + 0.55) / 1.55) - max(0.0, ndl);
    reflectedLight.directDiffuse += sunCol * diffuseColor.rgb * sssCol * wrap * 0.75;
    // light through the thin parts (fingers, the webs) when the sun is behind them
    float thin = vMark.w;
    float tr = pow(hsat(dot(geometryViewDir, -normalize(uSunDirView + geometryNormal * 0.35))), 3.0) * thin;
    reflectedLight.directDiffuse += sunRaw * mix(sh, 1.0, 0.6) * sssCol * diffuseColor.rgb * tr * 1.4;
  }
`;

const SKIN_AMBIENT = /* glsl */ `
  {
    vec3 upB = normalize(vBodyPos);
    vec3 nB = normalize(transpose(uBodyToView) * normal);
    iblIrradiance += (skyIrradiance(upB, nB, uSunDirBody) + uNightAmbient) * mix(0.75, 1.0, max(0.0, dot(nB, upB)) * 0.5 + 0.5);
  }
`;

const SKIN_EMISSIVE = /* glsl */ `
  {
    // the god's glow: a rim and an inner light, display-referred (it reads by day and by night alike)
    float ex = uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 1e-4) : 1.0;
    float nv = abs(dot(normal, normalize(vViewPosition)));
    float rim = pow(1.0 - nv, 2.6);
    vec3 g = uGlowCol * (rim * 0.75 + 0.035 + edge * 2.5) * uGlowK / ex;
    // a cruel god's veins smoulder
    g += uGlowCol * vein * hsat(-uAlign) * 0.35 * uGlowK / ex;
    totalEmissiveRadiance = g;
  }
`;

const DEPTH_VERT = /* glsl */ `
#include <common>
uniform mat4 uBones[${NB}];
${RIG_SKIN_GLSL}
attribute vec3 aRest;
varying vec3 vRest;
#include <logdepthbuf_pars_vertex>
void main() {
  mat4 sk = rigSkin();
  vec3 p = (sk * vec4(position, 1.0)).xyz;
  vRest = aRest;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
#include <logdepthbuf_vertex>
}
`;
const DEPTH_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uPresence;
varying vec3 vRest;
void main() {
#include <logdepthbuf_fragment>
  if (smoothstep(-0.56, -0.2, vRest.z) * uPresence < 0.5) discard;
  gl_FragColor = vec4(1.0);
}
`;

const GLOW_VERT = /* glsl */ `
#include <common>
uniform mat4 uBones[${NB}];
uniform float uInflate;
${RIG_SKIN_GLSL}
attribute vec3 aRest;
varying vec3 vN;
varying vec3 vV;
varying float vZ;
varying vec3 vRest;
void main() {
  mat4 sk = rigSkin();
  vec3 n = normalize(mat3(sk) * normal);
  vec3 p = (sk * vec4(position, 1.0)).xyz + n * uInflate;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vN = normalize(normalMatrix * n);
  vV = -mv.xyz;
  vZ = -mv.z;
  vRest = aRest;
  gl_Position = projectionMatrix * mv;
}
`;
const GLOW_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
uniform vec3 uGlowCol;
uniform float uGlowK;
uniform float uPresence;
varying vec3 vN;
varying vec3 vV;
varying float vZ;
varying vec3 vRest;
void main() {
  float sz = fxSceneZ();
  // the halo shows where the shell stands in front of the scene (its silhouette over the ground and the sky)
  if (vZ > sz + 0.02 * vZ) discard;
  float nv = abs(dot(normalize(vN), normalize(vV)));
  float k = pow(1.0 - nv, 3.0) * smoothstep(-0.5, -0.1, vRest.z) * uPresence;
  gl_FragColor = vec4(uGlowCol * k * uGlowK * 0.45 * fxDisplay(0.85), 0.0);
}
`;

const TRAIL_VERT = /* glsl */ `
attribute float aAge;
attribute float aSide;
varying float vAge;
varying float vSide;
varying float vZ;
void main() {
  vAge = aAge; vSide = aSide;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const TRAIL_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
uniform vec3 uGlowCol;
uniform float uTrailK;
varying float vAge;
varying float vSide;
varying float vZ;
void main() {
  float vis = fxSoft(vZ, 0.5);
  float a = pow(1.0 - vAge, 1.6) * (1.0 - abs(vSide)) * uTrailK * vis;
  gl_FragColor = vec4(uGlowCol * a * 1.6 * fxDisplay(0.8), 0.0);
}
`;

const ARC_VERT = /* glsl */ `
attribute float aT;
varying float vT;
varying float vZ;
uniform float uSize;
void main() {
  vT = aT;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (1.0 - 0.4 * aT);
}
`;
const ARC_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
uniform vec3 uArcCol;
uniform float uArcK;
varying float vT;
varying float vZ;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float vis = fxSoft(vZ, 0.3);
  float march = 0.6 + 0.4 * sin(vT * 60.0 - uFxTime * 8.0);
  float a = (1.0 - d) * uArcK * vis * march;
  gl_FragColor = vec4(uArcCol * a * fxDisplay(0.9), 0.0);
}
`;

// ───────────────────────────── poses ─────────────────────────────

/**
 * Pose tables: per finger (thumb, index, middle, ring, little) [MCP, PIP, DIP] flex and an extra MCP spread; the
 * thumb as [meta flex, meta spread, meta twist, P flex, D flex]; the wrist [flex, deviation].
 */
interface PoseDef { f: [number, number, number, number][]; t: [number, number, number, number, number]; w: [number, number] }

const POSES: Record<HandPose, PoseDef> = {
  open: { f: [[0.16, 0.22, 0.12, 0.05], [0.2, 0.28, 0.14, 0], [0.24, 0.31, 0.15, -0.04], [0.3, 0.36, 0.18, -0.06]], t: [0.12, 0.1, 0.05, 0.12, 0.16], w: [0.16, 0] },
  reach: { f: [[0.1, 0.18, 0.1, 0.12], [0.12, 0.2, 0.1, 0.02], [0.15, 0.22, 0.12, -0.08], [0.2, 0.25, 0.14, -0.14]], t: [0.0, 0.32, 0.0, 0.05, 0.1], w: [0.34, 0] },
  grab: { f: [[0.78, 0.82, 0.42, 0.02], [1.02, 1.18, 0.62, 0], [1.28, 1.38, 0.72, -0.02], [1.38, 1.48, 0.76, -0.04]], t: [0.55, -0.32, 0.32, 0.36, 0.4], w: [0.36, 0] },
  claw: { f: [[0.62, 0.78, 0.46, 0.06], [0.66, 0.82, 0.48, 0], [0.7, 0.84, 0.5, -0.05], [0.76, 0.86, 0.52, -0.1]], t: [0.62, -0.18, 0.25, 0.32, 0.32], w: [0.5, 0] },
  fist: { f: [[1.48, 1.68, 0.92, 0], [1.5, 1.7, 0.92, 0], [1.52, 1.7, 0.9, 0], [1.55, 1.7, 0.88, 0]], t: [0.92, -0.6, 0.35, 0.62, 0.42], w: [0.2, 0] },
  point: { f: [[0.04, 0.05, 0.02, 0.02], [1.38, 1.62, 0.86, 0], [1.48, 1.66, 0.86, -0.02], [1.55, 1.7, 0.86, -0.04]], t: [0.66, -0.46, 0.3, 0.46, 0.3], w: [0.08, 0] },
  slap: { f: [[0.02, 0.03, 0.01, -0.05], [0.0, 0.03, 0.01, 0], [0.02, 0.03, 0.02, 0.04], [0.03, 0.04, 0.02, 0.1]], t: [0.06, -0.14, 0.0, 0.02, 0.02], w: [0.0, 0] },
  stroke: { f: [[0.12, 0.15, 0.08, -0.04], [0.12, 0.15, 0.08, 0], [0.13, 0.16, 0.08, 0.04], [0.16, 0.18, 0.1, 0.08]], t: [0.12, -0.2, 0.05, 0.08, 0.08], w: [0.22, 0] },
  cast: { f: [[-0.12, 0.38, 0.28, 0.22], [-0.1, 0.36, 0.26, 0.06], [-0.08, 0.38, 0.27, -0.12], [-0.05, 0.4, 0.3, -0.26]], t: [-0.05, 0.42, -0.1, 0.12, 0.2], w: [0.05, 0] },
};

// ───────────────────────────── the visual ─────────────────────────────

const _m = new Matrix4();
/** a held tree hangs root-up from the grip */
const TREE_FLIP = new Matrix4().makeRotationX(Math.PI).multiply(new Matrix4().makeTranslation(0, -2.2, 0));
const _v: V3 = [0, 0, 0];
const _w: V3 = [0, 0, 0];

export class HandVisual {
  readonly group = new Group();
  private hm: HandMesh | null = null;
  private rig: Rig | null = null;
  private mesh: Mesh | null = null;
  private glow: Mesh | null = null;
  private skinMat: MeshStandardMaterial | null = null;
  private depthMat: ShaderMaterial | null = null;
  private readonly bones: IUniform<Float32Array> = { value: new Float32Array(NB * 16) };
  private readonly handToBody: IUniform<Matrix4> = { value: new Matrix4() };
  private readonly u = {
    uHandScale: { value: 1 }, uAlign: { value: 0 }, uGlowCol: { value: new Color(1, 0.75, 0.4) }, uGlowK: { value: 1 },
    uPresence: { value: 0 }, uHandTime: { value: 0 }, uInflate: { value: 0.02 }, uTrailK: { value: 0 }, uArcCol: { value: new Color(1, 0.85, 0.5) },
    uArcK: { value: 0 }, uSize: { value: 6 },
  };
  /** per bone local rotations: current and target */
  private cur = new Float32Array(NB * 3);
  private tgt = new Float32Array(NB * 3);
  /** body-frame state of the hand's reach point, its velocity, scale and facing */
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  scale = 8;
  private fwd = new Vector3(0, 0, 1);
  private placed = false;
  presence = 0;
  /** forced on (tests / photo) or off */
  force: boolean | null = null;
  private lastSim: string = '';
  private simActiveAt = -1e9;
  private cursorAt = -1e9;
  /** what it holds now: kind and id (from the sim) */
  heldKind = '';
  heldId = -1;
  /** the pinch point (body frame, m): where a held person hangs */
  readonly pinch = new Vector3();
  /** the palm's grip point (body frame) for boulders and trees */
  readonly grip = new Vector3();
  private pose: HandPose = 'open';
  private poseAt = 0;
  private slapAt = -1e9;
  private castAt = -1e9;
  private trail: { p: Vector3; t: number }[] = [];
  private trailGeo = new BufferGeometry();
  private trailMesh: Mesh;
  private arcGeo = new BufferGeometry();
  private arcMesh: Points;
  private heldMeshes = new Map<string, Mesh>();
  private heldGroup = new Group();
  private heldMat: MeshStandardMaterial | null = null;
  private building = false;
  private visibleNow = false;

  constructor() {
    this.group.name = 'hand';
    this.group.matrixAutoUpdate = false;
    this.heldGroup.matrixAutoUpdate = false;
    this.group.add(this.heldGroup);
    // trail ribbon (64 samples × 2 sides)
    const N = 64;
    this.trailGeo.setAttribute('position', new BufferAttribute(new Float32Array(N * 2 * 3), 3));
    this.trailGeo.setAttribute('aAge', new BufferAttribute(new Float32Array(N * 2), 1));
    this.trailGeo.setAttribute('aSide', new BufferAttribute(new Float32Array(N * 2), 1));
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    this.trailGeo.setIndex(idx);
    this.trailMesh = new Mesh(this.trailGeo, new ShaderMaterial({
      vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, uniforms: { uGlowCol: this.u.uGlowCol, uTrailK: this.u.uTrailK },
      transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    }));
    this.trailMesh.frustumCulled = false;
    this.trailMesh.layers.set(FX_LAYER);
    this.group.add(this.trailMesh);
    // throw arc beads (96 points)
    this.arcGeo.setAttribute('position', new BufferAttribute(new Float32Array(96 * 3), 3));
    this.arcGeo.setAttribute('aT', new BufferAttribute(new Float32Array(96), 1));
    this.arcMesh = new Points(this.arcGeo, new ShaderMaterial({
      vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, uniforms: { uArcCol: this.u.uArcCol, uArcK: this.u.uArcK, uSize: this.u.uSize },
      transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending,
    }));
    this.arcMesh.frustumCulled = false;
    this.arcMesh.layers.set(FX_LAYER);
    this.arcMesh.visible = false;
    this.group.add(this.arcMesh);
  }

  /** the FX materials need the shared depth / exposure uniforms (GodFx) */
  bindFx(fx: Record<string, IUniform>): void {
    for (const m of [this.trailMesh.material as ShaderMaterial, this.arcMesh.material as ShaderMaterial]) Object.assign(m.uniforms, fx);
    this.fxU = fx;
    if (this.glow) Object.assign((this.glow.material as ShaderMaterial).uniforms, fx);
  }
  private fxU: Record<string, IUniform> = {};

  /** build the mesh and materials on first use (the implicit surface takes a moment to polygonise) */
  private build(shared: Record<string, IUniform>): void {
    if (this.mesh || this.building) return;
    this.building = true;
    const hm = handMesh();
    this.hm = hm;
    this.rig = new Rig(hm.bones);
    const mat = new MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
    const u = this.u;
    mat.onBeforeCompile = (shader) => {
      for (const k of Object.keys(shared)) shader.uniforms[k] = shared[k];
      shader.uniforms.uBones = this.bones;
      shader.uniforms.uHandToBody = this.handToBody;
      for (const [k, v] of Object.entries(u)) shader.uniforms[k] = v as IUniform;
      shader.uniforms.tExposure = FX_EXPOSURE;
      shader.uniforms.uHasExposure = this.fxU.uHasExposure ?? { value: 0 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <clipping_planes_pars_vertex>', `#include <clipping_planes_pars_vertex>\n${SKIN_VERT_PARS}`)
        .replace('#include <beginnormal_vertex>', 'mat4 sk = rigSkin();\n  vec3 objectNormal = normalize(mat3(sk) * normal);')
        .replace('#include <begin_vertex>', 'vec3 transformed = (sk * vec4(position, 1.0)).xyz;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n  vBodyPos = (uHandToBody * vec4(transformed, 1.0)).xyz;\n  vRest = aRest; vMark = aMark; vPart = aPart;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${SKIN_FRAG_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${SKIN_SURFACE}`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = hRough;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = bumpNormal(-vViewPosition, normal, hgt);')
        .replace('#include <emissivemap_fragment>', SKIN_EMISSIVE)
        .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${SKIN_LIGHT}`)
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${SKIN_AMBIENT}`);
    };
    mat.customProgramCacheKey = () => 'genesis-hand-v1';
    this.skinMat = mat;
    const mesh = new Mesh(hm.geo, mat);
    mesh.name = 'hand-skin';
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.layers.enable(1);
    this.mesh = mesh;
    this.depthMat = new ShaderMaterial({ vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, uniforms: { uBones: this.bones, uPresence: u.uPresence }, colorWrite: false, side: DoubleSide });
    const glow = new Mesh(hm.geo, new ShaderMaterial({
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
      uniforms: { uBones: this.bones, uInflate: u.uInflate, uGlowCol: u.uGlowCol, uGlowK: u.uGlowK, uPresence: u.uPresence, ...this.fxU },
      transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending,
    }));
    glow.matrixAutoUpdate = false;
    glow.frustumCulled = false;
    glow.layers.set(FX_LAYER);
    this.glow = glow;
    this.group.add(mesh, glow);
    this.heldMat = makePropMaterial(shared, { key: 'held', roughness: 0.88 });
  }

  swapDepth(depth: boolean): void {
    if (!this.mesh || !this.skinMat || !this.depthMat) return;
    this.mesh.material = depth ? this.depthMat : this.skinMat;
  }

  /** a slap or a cast seen in the events (GodFx) */
  pulse(kind: 'slap' | 'stroke' | 'cast', t: number): void {
    if (kind === 'slap') this.slapAt = t;
    else if (kind === 'cast') this.castAt = t;
    else this.poseAt = t;
  }

  update(f: HandFrame): void {
    const pv = f.pv;
    const hv = f.hand && f.hand.planet === pv.id ? f.hand : null;
    const R = pv.params.radius;
    // ── presence: the cursor over this world, or the sim's hand doing something ──
    const sig = hv ? `${hv.pos[0].toFixed(5)},${hv.pos[1].toFixed(5)},${hv.alt.toFixed(1)},${hv.pose},${hv.held ? hv.held.kind + hv.held.id : ''}` : '';
    if (hv && sig !== this.lastSim) {
      if (this.lastSim) this.simActiveAt = f.fxTime;
      this.lastSim = sig;
    }
    const cursorHere = f.cursor && f.cursor.planet === pv.id ? f.cursor : null;
    if (cursorHere) this.cursorAt = f.fxTime;
    const simActive = !!hv && (!!hv.held || hv.pose !== 'open' || f.fxTime - this.simActiveAt < 30);
    const altCam = this.camAltitude(f);
    let want = (cursorHere ? 1 : 0) || (simActive ? 1 : 0) || (f.fxTime - this.cursorAt < 2 ? 1 : 0);
    if (altCam > R * 4) want = 0;
    if (this.force != null) want = this.force ? 1 : 0;
    this.presence += (want - this.presence) * Math.min(1, f.dt * (want > this.presence ? 3.2 : 2.2));
    if (this.presence < 0.004 && !want) {
      this.presence = 0;
      this.group.visible = false;
      this.visibleNow = false;
      this.placed = false;
      return;
    }
    this.group.visible = true;
    this.visibleNow = true;
    this.build(f.shared);
    const rig = this.rig!, hm = this.hm!;
    // ── what it holds ──
    this.heldKind = hv?.held ? hv.held.kind : '';
    this.heldId = hv?.held ? hv.held.id : -1;
    // ── target pose ──
    let pose: HandPose = 'open';
    const ui = cursorHere ? f.uiPose : 'none';
    if (this.heldKind) pose = this.heldKind === 'agent' || this.heldKind === 'item' ? 'grab' : 'claw';
    else if (ui === 'tool') pose = 'point';
    else if (ui === 'open') pose = 'reach';
    else if (ui === 'press') pose = 'claw';
    else if (ui === 'slap') pose = 'slap';
    if (hv && !this.heldKind) {
      if (hv.pose === 'point') pose = 'point';
      else if (hv.pose === 'cast') pose = 'cast';
      else if (hv.pose === 'slap') { pose = 'slap'; if (f.fxTime - this.slapAt > 0.8) this.slapAt = f.fxTime; }
      else if (hv.pose === 'stroke') pose = 'stroke';
    }
    if (f.fxTime - this.castAt < 1.4 && !this.heldKind) pose = 'cast';
    if (f.fxTime - this.slapAt < 0.55) pose = 'slap';
    if (pose !== this.pose) { this.pose = pose; this.poseAt = f.fxTime; }
    this.setTarget(POSES[pose]);
    // ease toward it: the little finger leads when the hand closes
    const dt = Math.min(0.1, f.dt);
    for (let i = 0; i < NB; i++) {
      let rate = 11;
      for (let fi = 1; fi < 5; fi++) if (hm.idx.phal[fi].includes(i) || hm.idx.meta[fi] === i) rate = 9 + fi * 1.6;
      if (i === hm.idx.hand) rate = 7;
      const k = 1 - Math.exp(-dt * rate);
      for (let a = 0; a < 3; a++) this.cur[i * 3 + a] += (this.tgt[i * 3 + a] - this.cur[i * 3 + a]) * k;
    }
    // ── procedural motion on top ──
    rig.rot.set(this.cur);
    const t = f.fxTime;
    const idle = pose === 'open' || pose === 'reach' ? 1 : 0.35;
    for (let fi = 1; fi < 5; fi++) {
      const ph = hm.idx.phal[fi];
      const br = Math.sin(t * 1.25 + fi * 0.8) * 0.045 * idle;
      rig.rot[ph[0] * 3] += br * 0.6; rig.rot[ph[1] * 3] += br; rig.rot[ph[2] * 3] += br * 0.5;
    }
    const wristI = hm.idx.hand;
    if (pose === 'slap') {
      // cocked back, then snapped down past flat
      const s = clamp01((t - this.slapAt) / 0.5);
      const flick = s < 0.35 ? -0.7 * smooth(0, 0.35, s) : -0.7 + 1.35 * smooth(0.35, 0.55, s) - 0.4 * smooth(0.6, 1, s);
      rig.rot[wristI * 3] += flick;
    } else if (pose === 'stroke') {
      const w = Math.sin(t * 3.2);
      rig.rot[wristI * 3] += 0.18 * w;
      for (let fi = 1; fi < 5; fi++) { const ph = hm.idx.phal[fi]; rig.rot[ph[0] * 3] += 0.12 * Math.sin(t * 3.2 - fi * 0.5); }
    } else if (pose === 'cast') {
      const tr = Math.sin(t * 31) * 0.012 + Math.sin(t * 17) * 0.01;
      for (let fi = 1; fi < 5; fi++) { const ph = hm.idx.phal[fi]; rig.rot[ph[0] * 3 + 1] += 0.05 * Math.sin(t * 2.2 + fi); rig.rot[ph[1] * 3] += tr; }
    }
    // ── placement ──
    this.place(f, rig, hm, hv, cursorHere, ui, altCam, dt);
    rig.update();
    this.bones.value.set(rig.skin);
    // the pinch (index tip ↔ thumb tip) and the grip, body frame
    const m = this.handToBody.value;
    const tTip = rig.carry(hm.idx.phal[0][1], hm.tips[0], [0, 0, 0]);
    const iTip = rig.carry(hm.idx.phal[1][2], hm.tips[1], [0, 0, 0]);
    this.pinch.set((tTip[0] + iTip[0]) * 0.5, (tTip[1] + iTip[1]) * 0.5, (tTip[2] + iTip[2]) * 0.5).applyMatrix4(m);
    const gp = rig.carry(hm.idx.meta[2], [0.03, -0.11, 0.42], [0, 0, 0]);
    this.grip.set(gp[0], gp[1], gp[2]).applyMatrix4(m);
    // ── look ──
    const align = hv?.alignment ?? 0;
    this.u.uAlign.value = align;
    const gc = this.u.uGlowCol.value as Color;
    if (align >= 0) gc.setRGB(1.0, 0.74 - 0.04 * align, 0.38 - 0.08 * align);
    else gc.setRGB(0.55 - 0.15 * Math.min(1, -align), 0.48 - 0.2 * Math.min(1, -align), 1.0);
    const castK = pose === 'cast' ? 1 + 1.6 * (0.6 + 0.4 * Math.sin(t * 9)) : 1;
    this.u.uGlowK.value = (0.55 + 0.45 * Math.abs(align)) * castK;
    this.u.uPresence.value = this.presence;
    this.u.uHandTime.value = t;
    this.u.uHandScale.value = this.scale;
    this.u.uInflate.value = 0.022;
    this.heldVisual(f, R);
    this.trailUpdate(f);
    this.arcUpdate(f, hv);
    // ── decals: contact shadow, a little of the glow on the ground below ──
    const up = _vec.copy(this.pos).normalize();
    const g = groundHeight(pv.ground, up.x, up.y, up.z);
    const hAbove = Math.max(0, this.pos.length() - g);
    const shadowK = (1 - smooth(this.scale * 0.6, this.scale * 3.5, hAbove)) * this.presence;
    if (shadowK > 0.01) {
      const d = decal(DECAL.shadow, [up.x * g, up.y * g, up.z * g], this.scale * 1.1);
      d.ax = this.fwd.x; d.ay = this.fwd.y; d.az = this.fwd.z;
      const spread = 1 + hAbove / this.scale * 0.6;
      d.p0 = this.scale * 0.42 * spread; d.p1 = this.scale * 0.24 * spread; d.p2 = 0.75;
      d.ca = 0.55 * shadowK;
      d.q0 = Math.max(1.2, this.scale * 0.35);
      f.decals.add(d);
    }
    const glowL = decal(DECAL.light, [up.x * g, up.y * g, up.z * g], this.scale * 2.4);
    glowL.cr = gc.r; glowL.cg = gc.g; glowL.cb = gc.b;
    glowL.p0 = this.scale * 2.4; glowL.p1 = (pose === 'cast' ? 260 : 60) * this.scale * this.scale * 0.05 * this.presence; glowL.p2 = hAbove; glowL.p3 = this.scale * 0.6;
    f.decals.add(glowL);
  }

  /** the camera's altitude over the ground under it */
  private camAltitude(f: HandFrame): number {
    const c = f.camBody;
    const l = c.length() || 1;
    return l - groundHeight(f.pv.ground, c.x / l, c.y / l, c.z / l);
  }

  private setTarget(p: PoseDef): void {
    const hm = this.hm!;
    this.tgt.fill(0);
    for (let fi = 0; fi < 4; fi++) {
      const [a, b, c, s] = p.f[fi];
      const ph = hm.idx.phal[fi + 1];
      this.tgt[ph[0] * 3] = a; this.tgt[ph[0] * 3 + 1] = s;
      this.tgt[ph[1] * 3] = b;
      this.tgt[ph[2] * 3] = c;
      // the palm cups a little toward the little finger as the hand closes
      this.tgt[hm.idx.meta[fi + 1] * 3] = a * (0.02 + fi * 0.035);
    }
    const [mf, ms, mt, pf, df] = p.t;
    this.tgt[hm.idx.meta[0] * 3] = mf; this.tgt[hm.idx.meta[0] * 3 + 1] = ms; this.tgt[hm.idx.meta[0] * 3 + 2] = mt;
    this.tgt[hm.idx.phal[0][0] * 3] = pf;
    this.tgt[hm.idx.phal[0][1] * 3] = df;
    this.tgt[hm.idx.hand * 3] = p.w[0];
    this.tgt[hm.idx.hand * 3 + 1] = p.w[1];
  }

  private place(f: HandFrame, rig: Rig, hm: HandMesh, hv: HandView | null, cursor: HandCursor | null, ui: UiHandPose, altCam: number, dt: number): void {
    const pv = f.pv;
    // the ground point it goes to
    let u: V3;
    let hoverWant: number;
    if (cursor) { u = [cursor.dir[0], cursor.dir[1], cursor.dir[2]]; }
    else if (hv) { u = [hv.pos[0], hv.pos[1], hv.pos[2]]; }
    else { u = this.placed ? normalized(this.pos) : [0, 1, 0]; }
    const ul = Math.hypot(u[0], u[1], u[2]) || 1;
    u[0] /= ul; u[1] /= ul; u[2] /= ul;
    let g = groundHeight(pv.ground, u[0], u[1], u[2]);
    const water = pv.fields.get('water');
    if (water) {
      const surf = pv.fields.get('surface');
      if (surf) g = Math.max(g, pv.params.radius + pv.grid.sample(surf, u[0], u[1], u[2]) + pv.grid.sample(water, u[0], u[1], u[2]));
    }
    // size: ~13 % of the view height at the hand's distance, bounded by the camera's altitude (a cursor near the
    // horizon would otherwise make it a mountain)
    const cx = f.camBody.x - u[0] * g, cy = f.camBody.y - u[1] * g, cz = f.camBody.z - u[2] * g;
    const camD = Math.min(Math.sqrt(cx * cx + cy * cy + cz * cz), altCam * 3.5 + 40);
    const Lw = Math.max(2.6, Math.min(6000, camD * 0.135));
    this.scale = this.placed ? this.scale + (Lw - this.scale) * Math.min(1, dt * 4) : Lw;
    const L = this.scale;
    // how high it hovers
    if (this.heldKind) hoverWant = Math.max(hv ? hv.alt : 0, L * 0.55 + (this.heldKind === 'agent' ? 1.6 : this.heldKind === 'tree' ? 6 : 1.2));
    else if (ui === 'open') hoverWant = L * 0.2;
    else if (ui === 'press') hoverWant = L * 0.12;
    else if (!cursor && hv) hoverWant = Math.max(L * 0.22, hv.alt);
    else hoverWant = L * 0.3;
    const tx = u[0] * (g + hoverWant), ty = u[1] * (g + hoverWant), tz = u[2] * (g + hoverWant);
    // a spring with a little lag; far jumps (a new place on the world, a camera cut) snap
    if (!this.placed || Math.hypot(tx - this.pos.x, ty - this.pos.y, tz - this.pos.z) > L * 25) {
      this.pos.set(tx, ty, tz); this.vel.set(0, 0, 0); this.placed = true;
    } else if (dt > 0) {
      const w = this.heldKind ? 10 : 13;
      const ax = w * w * (tx - this.pos.x) - 2 * w * this.vel.x, ay = w * w * (ty - this.pos.y) - 2 * w * this.vel.y, az = w * w * (tz - this.pos.z) - 2 * w * this.vel.z;
      this.vel.x += ax * dt; this.vel.y += ay * dt; this.vel.z += az * dt;
      this.pos.x += this.vel.x * dt; this.pos.y += this.vel.y * dt; this.pos.z += this.vel.z * dt;
    }
    // ── orientation: fingers away from the camera, palm down, leaning into its motion ──
    const up = _vec.copy(this.pos).normalize();
    const fw = _vec2.copy(f.camFwd).addScaledVector(up, -f.camFwd.dot(up));
    if (fw.lengthSq() < 1e-6) fw.copy(f.camUp).addScaledVector(up, -f.camUp.dot(up));
    fw.normalize();
    this.fwd.lerp(fw, this.placed ? Math.min(1, dt * 8) : 1).addScaledVector(up, -this.fwd.dot(up)).normalize();
    const right = _vec3.crossVectors(up, this.fwd).normalize(); // hand +x (the thumb side)
    // lean: the motion relative to the hand's size tips it (fingers trail, the hand banks)
    const vf = this.vel.dot(this.fwd) / L, vr = this.vel.dot(right) / L;
    const pitch = 0.32 + Math.max(-0.35, Math.min(0.35, -vf * 0.05)) + (this.heldKind ? -0.12 : 0);
    const roll = 0.22 + Math.max(-0.4, Math.min(0.4, vr * 0.05));
    rig.rootR[0] = 0; rig.rootR[1] = 0; rig.rootR[2] = 0;
    // basis: x = right, y = up, z = forward, then pitched about x (fingers down) and rolled about z
    const bx = right.clone(), by = up.clone(), bz = this.fwd.clone();
    rotAbout(by, bz, bx, pitch);
    rotAbout(bx, by, bz, -roll);
    // pose the rig (for the reach point) before placing
    rig.update();
    const reachLocal = this.heldKind === 'agent' || this.heldKind === 'item'
      ? midpoint(rig.carry(hm.idx.phal[0][1], hm.tips[0], _v), rig.carry(hm.idx.phal[1][2], hm.tips[1], _w))
      : rig.carry(hm.idx.meta[2], [0.03, -0.1, 0.5], _v);
    // M = [B·L | target − B·L·reach]
    const m = this.handToBody.value;
    m.makeBasis(bx, by, bz).scale(_s.set(L, L, L));
    const rx = reachLocal[0], ry = reachLocal[1], rz = reachLocal[2];
    const e = m.elements;
    const ox = this.pos.x - (e[0] * rx + e[4] * ry + e[8] * rz);
    const oy = this.pos.y - (e[1] * rx + e[5] * ry + e[9] * rz);
    const oz = this.pos.z - (e[2] * rx + e[6] * ry + e[10] * rz);
    m.setPosition(ox, oy, oz);
    // fingertips never sink into the ground: lift the whole hand if one would
    let lift = 0;
    for (let fi = 0; fi < 5; fi++) {
      const ph = hm.idx.phal[fi];
      const tip = rig.carry(ph[ph.length - 1], hm.tips[fi], _v);
      const wx = e[0] * tip[0] + e[4] * tip[1] + e[8] * tip[2] + ox, wy = e[1] * tip[0] + e[5] * tip[1] + e[9] * tip[2] + oy, wz = e[2] * tip[0] + e[6] * tip[1] + e[10] * tip[2] + oz;
      const wl = Math.hypot(wx, wy, wz);
      const gg = groundHeight(pv.ground, wx / wl, wy / wl, wz / wl) + L * 0.03;
      if (wl < gg) lift = Math.max(lift, gg - wl);
    }
    if (lift > 0) { m.setPosition(ox + up.x * lift, oy + up.y * lift, oz + up.z * lift); this.pos.addScaledVector(up, lift); }
    if (this.mesh) { this.mesh.matrix.copy(m); this.mesh.matrixWorldNeedsUpdate = true; }
    if (this.glow) { this.glow.matrix.copy(m); this.glow.matrixWorldNeedsUpdate = true; }
  }

  /** a boulder, a tree or a bundle in the grip (people are drawn by the crowds where `pinch` says) */
  private heldVisual(f: HandFrame, _R: number): void {
    const k = this.heldKind;
    for (const [key, m] of this.heldMeshes) m.visible = key === k;
    if (!k || k === 'agent' || k === 'creature' || k === 'animal') return;
    let mesh = this.heldMeshes.get(k);
    if (!mesh && this.heldMat) {
      mesh = new Mesh(k === 'tree' ? treeGeo() : k === 'rock' ? boulderGeo(7) : k === 'building' ? hutGeo() : bundleGeo(), this.heldMat);
      mesh.matrixAutoUpdate = false;
      mesh.layers.enable(1);
      this.heldMeshes.set(k, mesh);
      this.heldGroup.add(mesh);
    }
    if (!mesh) return;
    mesh.visible = true;
    // sized by what it is: a boulder by its mass, a tree a dozen metres, a hut a few
    const up = _vec.copy(this.grip).normalize();
    let s = 1;
    if (k === 'rock') s = Math.max(0.5, Math.cbrt((3 * Math.max(50, this.heldId) / 2600) / (4 * Math.PI)));
    else if (k === 'tree') s = 1;
    else if (k === 'building') s = 3;
    else s = 0.6;
    const at = k === 'tree' ? _vec2.copy(this.grip).addScaledVector(up, -2.2) : _vec2.copy(this.grip).addScaledVector(up, -s * 0.6);
    _m.makeBasis(_vec3.crossVectors(up, this.fwd).normalize(), up, this.fwd).scale(_s.set(s, s, s));
    if (k === 'tree') _m.multiply(TREE_FLIP);
    _m.setPosition(at.x, at.y, at.z);
    mesh.matrix.copy(_m);
    mesh.matrixWorldNeedsUpdate = true;
    void f;
  }

  /** a ribbon of light behind a fast motion (a throw) */
  private trailUpdate(f: HandFrame): void {
    const spd = this.vel.length() / this.scale;
    const now = f.fxTime;
    if (spd > 1.2 || this.trail.length) this.trail.push({ p: this.grip.clone(), t: now });
    while (this.trail.length && now - this.trail[0].t > 0.45) this.trail.shift();
    if (this.trail.length > 64) this.trail.splice(0, this.trail.length - 64);
    const want = clamp01((spd - 1.2) / 3);
    const k = this.u.uTrailK;
    k.value += (want - k.value) * Math.min(1, f.dt * 6);
    const n = this.trail.length;
    this.trailMesh.visible = n > 2 && k.value > 0.01;
    if (!this.trailMesh.visible) { if (k.value < 0.01) this.trail.length = 0; return; }
    const pos = this.trailGeo.getAttribute('position') as BufferAttribute;
    const age = this.trailGeo.getAttribute('aAge') as BufferAttribute;
    const side = this.trailGeo.getAttribute('aSide') as BufferAttribute;
    const camB = f.camBody;
    for (let i = 0; i < 64; i++) {
      const j = Math.min(n - 1, Math.max(0, n - 64 + i));
      const p = this.trail[j].p;
      const q = this.trail[Math.min(n - 1, j + 1)].p, o = this.trail[Math.max(0, j - 1)].p;
      const tx = q.x - o.x, ty = q.y - o.y, tz = q.z - o.z;
      const vx = camB.x - p.x, vy = camB.y - p.y, vz = camB.z - p.z;
      let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const a = clamp01((now - this.trail[j].t) / 0.45);
      const w = this.scale * 0.32 * (1 - a * 0.7);
      sx *= w / sl; sy *= w / sl; sz *= w / sl;
      pos.setXYZ(i * 2, p.x + sx, p.y + sy, p.z + sz);
      pos.setXYZ(i * 2 + 1, p.x - sx, p.y - sy, p.z - sz);
      age.setX(i * 2, a); age.setX(i * 2 + 1, a);
      side.setX(i * 2, 1); side.setX(i * 2 + 1, -1);
    }
    pos.needsUpdate = true; age.needsUpdate = true; side.needsUpdate = true;
  }

  /** while carrying: the arc a throw toward the cursor would fly (the sim's aimed throw: 35°, the speed to reach it) */
  private arcUpdate(f: HandFrame, hv: HandView | null): void {
    const want = this.heldKind && f.cursor && f.cursor.planet === f.pv.id ? (f.aiming ? 1 : 0.35) : 0;
    const k = this.u.uArcK;
    k.value += (want - k.value) * Math.min(1, f.dt * 5);
    this.arcMesh.visible = k.value > 0.02 && !!f.cursor && !!hv;
    if (!this.arcMesh.visible || !f.cursor || !hv) return;
    const pv = f.pv;
    const g0 = pv.params.gravity || 9.8;
    const start = (this.heldKind === 'agent' ? this.pinch : this.grip).clone();
    const to = new Vector3(f.cursor.dir[0], f.cursor.dir[1], f.cursor.dir[2]).normalize();
    const up0 = start.clone().normalize();
    const range = Math.acos(Math.max(-1, Math.min(1, up0.dot(to)))) * pv.params.radius;
    const ang = (35 * Math.PI) / 180;
    const v = Math.min(2000, Math.sqrt(Math.max(1, (range * g0) / Math.sin(2 * ang))));
    const dir = to.clone().addScaledVector(up0, -to.dot(up0)).normalize();
    const vel = dir.multiplyScalar(v * Math.cos(ang)).addScaledVector(up0, v * Math.sin(ang));
    // integrate on the sphere until it comes down
    const pos = this.arcGeo.getAttribute('position') as BufferAttribute;
    const at = this.arcGeo.getAttribute('aT') as BufferAttribute;
    const p = start.clone();
    const flight = Math.max(0.5, (2 * v * Math.sin(ang)) / g0) * 1.15;
    const dtS = flight / 95;
    let landed = -1;
    for (let i = 0; i < 96; i++) {
      pos.setXYZ(i, p.x, p.y, p.z);
      at.setX(i, i / 95);
      if (landed >= 0) continue;
      const r = p.length();
      const gk = g0 * (pv.params.radius / r) * (pv.params.radius / r);
      vel.addScaledVector(p, -gk * dtS / r);
      p.addScaledVector(vel, dtS);
      const u = p.clone().normalize();
      if (p.length() < groundHeight(pv.ground, u.x, u.y, u.z)) landed = i;
    }
    if (landed >= 0) for (let i = landed + 1; i < 96; i++) pos.setXYZ(i, p.x, p.y, p.z);
    pos.needsUpdate = true; at.needsUpdate = true;
    this.arcGeo.setDrawRange(0, landed >= 0 ? landed + 1 : 96);
    this.u.uSize.value = Math.max(3, Math.min(9, 6));
    // where it lands
    const land = pos.getX(landed >= 0 ? landed : 95), lx = land, ly = pos.getY(landed >= 0 ? landed : 95), lz = pos.getZ(landed >= 0 ? landed : 95);
    const d = decal(DECAL.reticle, [lx, ly, lz], Math.max(4, this.scale * 0.5));
    d.cr = 1.0; d.cg = 0.8; d.cb = 0.45; d.ca = k.value;
    d.p0 = Math.max(3, this.scale * 0.35); d.p1 = 0.6; d.p2 = 1.2; d.p3 = 0.3;
    f.decals.add(d);
  }

  get visible(): boolean { return this.visibleNow; }

  dispose(): void {
    this.skinMat?.dispose();
    this.depthMat?.dispose();
    (this.glow?.material as ShaderMaterial | undefined)?.dispose();
    this.trailGeo.dispose();
    this.arcGeo.dispose();
    for (const m of this.heldMeshes.values()) m.geometry.dispose();
    this.heldMat?.dispose();
  }
}

const _vec = new Vector3();
const _vec2 = new Vector3();
const _vec3 = new Vector3();
const _s = new Vector3();

function normalized(v: Vector3): V3 { const l = v.length() || 1; return [v.x / l, v.y / l, v.z / l]; }
function midpoint(a: V3, b: V3): V3 { return [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5]; }

/** rotate the pair (a, b) about axis `ax` (all unit, a ⟂ b ⟂ ax) by angle t: a → a cos t + b sin t */
function rotAbout(a: Vector3, b: Vector3, _ax: Vector3, t: number): void {
  const c = Math.cos(t), s = Math.sin(t);
  const ax = a.x, ay = a.y, az = a.z;
  a.set(ax * c + b.x * s, ay * c + b.y * s, az * c + b.z * s);
  b.set(b.x * c - ax * s, b.y * c - ay * s, b.z * c - az * s);
}

// ───────────────────────────── held things ─────────────────────────────

function vcol(geo: BufferGeometry, f: (x: number, y: number, z: number) => [number, number, number]): BufferGeometry {
  const p = geo.getAttribute('position');
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const col = f(p.getX(i), p.getY(i), p.getZ(i)); c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
  geo.setAttribute('color', new BufferAttribute(c, 3));
  return geo;
}

/** a lumpy boulder of radius ~1 (an icosphere displaced by noise) */
export function boulderGeo(seed: number): BufferGeometry {
  const g = icosphere(2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.18 * Math.sin(x * 4.1 + seed) * Math.cos(y * 3.3 - seed) + 0.1 * Math.sin(z * 7.7 + x * 2.0 + seed * 2);
    p.setXYZ(i, x * n * 1.1, y * n * 0.85, z * n);
  }
  g.computeVertexNormals();
  return vcol(g, (x, y, z) => { const k = 0.38 + 0.06 * Math.sin(x * 9 + y * 7 + z * 5); return [k * 1.0, k * 0.95, k * 0.88]; });
}

/** an uprooted tree: trunk, root ball, a broad crown (radius ~4, 12 m tall) */
function treeGeo(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const trunk = cylinder(0.35, 0.22, 9, 10);
  parts.push(vcol(trunk, () => [0.16, 0.11, 0.07]));
  const roots = icosphere(1); roots.scale(1.2, 0.7, 1.2); roots.translate(0, -0.3, 0);
  parts.push(vcol(roots, (x, y) => (y < -0.5 ? [0.12, 0.09, 0.06] : [0.2, 0.15, 0.1])));
  for (let k = 0; k < 7; k++) {
    const c = icosphere(1);
    const a = k * 2.4, r = k === 0 ? 0 : 2.2;
    const s = k === 0 ? 3.2 : 2.3;
    c.scale(s, s * 0.8, s);
    c.translate(Math.cos(a) * r, 9.5 + (k === 0 ? 1 : 0.3 * Math.sin(a * 3)), Math.sin(a) * r);
    parts.push(vcol(c, (x, y, z) => { const v = 0.6 + 0.4 * Math.sin(x * 3 + y * 2 + z * 4); return [0.06 * v, 0.13 * v, 0.04 * v]; }));
  }
  return merge(parts);
}

function hutGeo(): BufferGeometry {
  const walls = cylinder(1, 1, 1.2, 12); walls.translate(0, 0.6, 0);
  const roof = cylinder(1.25, 0.05, 1.3, 12); roof.translate(0, 1.85, 0);
  return merge([vcol(walls, () => [0.36, 0.28, 0.2]), vcol(roof, () => [0.42, 0.34, 0.18])]);
}

function bundleGeo(): BufferGeometry {
  const b = icosphere(1); b.scale(1, 0.75, 0.9);
  return vcol(b, (x, y) => (y > 0.6 ? [0.3, 0.2, 0.12] : [0.48, 0.38, 0.24]));
}

function icosphere(sub: number): BufferGeometry {
  const t = (1 + Math.sqrt(5)) / 2;
  let v: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; });
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < sub; s++) {
    const mid = new Map<string, number>();
    const m = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let i = mid.get(key);
      if (i === undefined) { const p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]; const l = Math.hypot(p[0], p[1], p[2]); v.push([p[0] / l, p[1] / l, p[2] / l]); i = v.length - 1; mid.set(key, i); }
      return i;
    };
    const nf: number[][] = [];
    for (const [a, b, c] of f) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  v = v.map((p) => p);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(v.flat()), 3));
  g.setIndex(f.flat());
  g.computeVertexNormals();
  return g;
}

function cylinder(r0: number, r1: number, h: number, seg: number): BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pos.push(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(a) * r1, h, Math.sin(a) * r1);
  }
  for (let i = 0; i < seg; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  let n = 0, m = 0;
  for (const p of parts) { n += p.getAttribute('position').count; m += p.index ? p.index.count : p.getAttribute('position').count; }
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3), idx = new Uint32Array(m);
  let o = 0, io = 0;
  for (const p of parts) {
    const P = p.getAttribute('position'), N = p.getAttribute('normal'), C = p.getAttribute('color');
    for (let i = 0; i < P.count; i++) {
      pos[(o + i) * 3] = P.getX(i); pos[(o + i) * 3 + 1] = P.getY(i); pos[(o + i) * 3 + 2] = P.getZ(i);
      if (N) { nrm[(o + i) * 3] = N.getX(i); nrm[(o + i) * 3 + 1] = N.getY(i); nrm[(o + i) * 3 + 2] = N.getZ(i); }
      if (C) { col[(o + i) * 3] = C.getX(i); col[(o + i) * 3 + 1] = C.getY(i); col[(o + i) * 3 + 2] = C.getZ(i); }
    }
    if (p.index) for (let i = 0; i < p.index.count; i++) idx[io++] = p.index.getX(i) + o;
    else for (let i = 0; i < P.count; i++) idx[io++] = i + o;
    o += P.count;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  return g;
}
