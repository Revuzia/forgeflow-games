// GENESIS — the Touch: the god's presence in the world (CONTRACT.md §11.4, §15.6; LIVING §0.1.7, §3.6, hook H7: "the
// Touch, drawn by the art team as light and weather"; nothing of it is a hand). The sim's hand entity (HandView) is
// unchanged — it still lifts, places, hurls, rebukes and soothes — this is how it is SEEN (its form: gen/handgen.ts):
//
//   * a shaft of light let down through a whorl in the cloud deck (a spiral of cloud with a gilded eye where the light
//     comes through), ending in a vortex of wind, light and cloud at the grip point: tufts of cloud riding a whirl up
//     round it, bands of wind spiralling up, motes of light, dust and leaves drawn up off the ground into it.
//   * when it HOLDS something the mantle gathers: the tufts of cloud close into a turning cradle round what it holds
//     (the low ones come in last, so it visibly gathers) — three bands of wind, below it, round its middle and over it,
//     each tilted its own way and slowly precessing, so they cross and weave a loose basket of wind with gaps to see
//     what it holds through and its crown open — six streaks of wind wrap round it and three stay below as the
//     column's tether to the ground; the light at its heart swells. Released, the cradle opens back into the whirl.
//   * behaviours instead of hand poses: open = a soft column and a loose whirl; reaching for something = the whirl
//     quickens and lowers; lift = the cradle (above); point (a power armed) = a narrow, focused beam down to the
//     ground; rebuke = a downdraft gust (the wind reverses and slams down, dust thrown out along the ground) with a cold
//     flash; soothe = a warm pool of light spreading on the ground, motes drifting down; sigil = the miracle's glyph
//     traced in light in the air (render/fx/sigils.ts, from the power's `sigil`) as the Touch casts it.
//   * its palette and its weather follow REGARD (HandView.regard, −1 feared … +1 trusted; LIVING §3.1): warm daylight
//     and still air when trusted (sunlit white cloud, gold light inside it), a pale silver-gold when merely awed,
//     storm-dark when feared — slate cloud churning, the column a dark downdraft, a cold light flickering inside it and
//     arcs crackling through its cloud and down to the ground (gen/handgen.ts touchLook, crackleArc).
//   * placement: it follows the cursor's ground hit through a critically damped spring — lag and inertia, the vortex
//     leaning into its motion and the shaft trailing from the clouds — or goes where the sim's hand is; its size
//     follows the camera distance (render/fx/present.ts: ~14 % of it, 3.2 m … 140 m, so from orbit it is a point of
//     light with its whorl, not a weather system); it hides above four planet radii.
//   * what it holds is DRAWN in proportion to it (present.ts: at least 0.35 × its size), people are drawn by the crowds
//     where `pinch` says; a light trail follows a fast motion (a throw); while carrying, the arc a throw toward the
//     cursor would fly, with a reticle where it lands; on the ground a pool of its light under it, and its cloud's
//     shadow cast by the sun (dark under a feared god's storm) — and round a feared god a broad gloom, its storm deck's
//     shade over the land, so feared reads from the god's height where the column itself is small.
// Everything is drawn over the composited image (FX layer) and soft-tested against the scene's depth; the held props are
// lit, shadowed scene meshes.

import {
  BufferAttribute, BufferGeometry, Color, CustomBlending, DoubleSide, Group, Matrix4, Mesh, MeshStandardMaterial, OneFactor,
  OneMinusSrcAlphaFactor, Points, ShaderMaterial, Vector3, type IUniform,
} from 'three';
import { makePropMaterial } from './fx/propmat.ts';
import { treeGeometry } from './gen/treegen.ts';
import { buildingMesh } from './gen/buildinggen.ts';
import { leafClusterTexture } from './gen/leaftex.ts';
import {
  CRADLE_ALPHA, TOUCH_N, bandGeometry, crackleArc, cradleOf, discGeometry, mantlePoint, moteGeometry, quadGeometry, stripGeometry, touchLook,
  touchRng, tuftGeometry, type VortexFrame,
} from './gen/handgen.ts';
import { materialAt, materialIndex } from './life/catalog.ts';
import { NOISE_GLSL } from './shaders/noise.glsl.ts';
import { ATMO_PARS, SKY_LOOKUP } from './shaders/atmosphere.glsl.ts';
import { ADD_LIGHT, FX_DEPTH_GLSL, FX_LAYER, clamp01, fxHash, smooth } from './fx/fxcommon.ts';
import { DECAL, decal, type DecalPass } from './fx/decals.ts';
import { HELD_SHARE, heldTrueSize, presentScale, touchSize } from './fx/present.ts';
import { sigilOfMiracle, sigilStroke } from './fx/sigils.ts';
import type { PlanetView } from '../client/worldview.ts';
import type { HandView } from '../sim/types.ts';
import { groundHeight } from '../sim/grid/surface.ts';

/** what the Touch is doing (the hand poses of the sim, seen as weather) */
export type TouchBehaviour = 'open' | 'reach' | 'lift' | 'point' | 'rebuke' | 'soothe' | 'sigil';

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
  /** (additive) the radius (body m) of the cloud deck's base, and whether the world has air: the shaft comes down from
   *  the deck through its whorl; an airless world gets the light alone */
  cloudBase?: number;
  air?: boolean;
  /** (additive) the vertical field of view (deg) and the view's height (px): sizes that must read on screen */
  fov?: number;
  viewH?: number;
  /** (additive) one-off weather the Touch throws into the world: a gust of dust along the ground, a flash (cold, or a
   *  crackle's — `size` its reach) */
  burst?: (kind: 'gust' | 'flash', p: Vector3, size: number) => void;
}

// ───────────────────────────── shaders ─────────────────────────────

const COMMON = /* glsl */ `
uniform vec3 uCamB;
uniform vec3 uCol;       // the Touch's light (regard: warm gold trusted … pale silver-gold awed … cold when feared)
uniform vec3 uRim;       // a feared god's cold light (the flicker inside its storm)
uniform float uDark;     // 0 light … 1 storm-dark (feared)
uniform float uPres;     // presence 0..1
uniform float uTouchT;   // seconds, real time (the Touch is the player's: it moves when the world is paused)
uniform float uL;        // the Touch's size (m)
uniform float uCrackK;   // a crackle's light now (feared: an arc lights the storm from inside)
`;

/** light on a lit thing at body point P: the sun through the air and the sky (FX particles' convention, vfx.ts) */
const LIGHT_GLSL = /* glsl */ `
${ATMO_PARS}
${SKY_LOOKUP}
uniform vec3 uSunDirBody;
vec3 touchLight(vec3 P) {
  float rP = length(P);
  vec3 upP = P / max(rP, 1.0);
  vec3 sun = uSunE * sunTransmittance(rP, dot(upP, uSunDirBody));
  vec3 sky = skyIrradiance(upP, upP, uSunDirBody);
  return sun * 0.24 + sky * 0.3 + vec3(0.002, 0.003, 0.005);
}
`;

// the shaft: a camera-facing strip along a quadratic curve from the whorl (top) through the grip to the ground
const COLUMN_VERT = /* glsl */ `
${COMMON}
${LIGHT_GLSL}
attribute float aT;
attribute float aSide;
uniform vec3 uTop;
uniform vec3 uGrip;
uniform vec3 uGround;
uniform float uGripT;
uniform float uWTop;
uniform float uWGrip;
uniform float uWGround;
varying float vT;
varying float vSide;
varying float vZ;
varying float vLen;
varying float vW;
varying vec3 vLight;
varying float vSunX;
vec3 bez(float t, vec3 c) { float u = 1.0 - t; return u * u * uTop + 2.0 * u * t * c + t * t * uGround; }
void main() {
  float tg = clamp(uGripT, 0.05, 0.95);
  // the control point that makes the curve pass through the grip at t = tg
  vec3 c = (uGrip - (1.0 - tg) * (1.0 - tg) * uTop - tg * tg * uGround) / (2.0 * (1.0 - tg) * tg);
  vec3 p = bez(aT, c);
  vec3 dir = normalize(2.0 * (1.0 - aT) * (c - uTop) + 2.0 * aT * (uGround - c) + 1e-5);
  float w = aT < tg ? mix(uWTop, uWGrip, pow(aT / tg, 0.55)) : mix(uWGrip, uWGround, (aT - tg) / (1.0 - tg));
  vec3 view = normalize(uCamB - p);
  vec3 side = cross(dir, view);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
  // (never thinner than a few pixels' worth of the view: from far away it is a thread of light, not nothing)
  w = max(w, length(uCamB - p) * 0.004);
  p += side * aSide * w;
  vT = aT; vSide = aSide; vW = w;
  vLen = aT * distance(uTop, uGround);
  vLight = touchLight(p);
  // which side of the strip faces the sun (the dark column is shaded as a body: lit flank, shadowed flank)
  vec3 sunH = uSunDirBody - dir * dot(uSunDirBody, dir);
  vSunX = dot(side, sunH) / max(length(sunH), 1e-4) * min(1.0, length(sunH) * 2.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const COLUMN_FRAG = /* glsl */ `
${NOISE_GLSL}
${FX_DEPTH_GLSL}
${COMMON}
uniform float uGripT;
uniform float uBeamK;    // how bright the shaft is (behaviour)
uniform float uGroundK;  // how much of it reaches on below the grip to the ground (0 none … 1 all)
uniform float uFlashK;   // a rebuke's cold flash
varying float vT;
varying float vSide;
varying float vZ;
varying float vLen;
varying float vW;
varying vec3 vLight;
varying float vSunX;
void main() {
  float vis = fxSoft(vZ, max(0.5, vW * 0.6));
  if (vis <= 0.0) discard;
  float x = abs(vSide);
  // (a beam of light seen through air: a soft body falling off well inside the strip, never a tube's edge)
  float core = exp(-x * x * 26.0);
  float body = exp(-x * x * 6.0) * (1.0 - smoothstep(0.7, 1.0, x));
  // light streaming down the shaft: long rays scrolling toward the ground, turning slowly
  float s = vLen / max(uL, 0.5);
  float n1 = snoise(vec3(vSide * 2.2, s * 0.32 - uTouchT * 0.8, 1.3));
  float n2 = snoise(vec3(vSide * 5.5 + 3.0, s * 1.1 - uTouchT * 2.0, 4.1));
  float rays = 0.6 + 0.28 * n1 + 0.14 * n2;
  // it fades up into the cloud; below the grip it reaches down only as far as the behaviour asks
  float top = smoothstep(0.0, 0.28, vT);
  float below = vT > uGripT ? mix(1.0, uGroundK, smoothstep(uGripT, min(1.0, uGripT + 0.35 * (1.0 - uGripT) + 0.02), vT)) * (1.0 - smoothstep(0.96, 1.0, vT) * 0.6) : 1.0;
  float env = top * below * uPres;
  // (kept below the tone curve's shoulder: brighter, the shaft burned to white and lost its regard's colour)
  float k = (core * 0.5 + body * 0.24) * rays * env * uBeamK;
  vec3 light = uCol * k * (1.0 - 0.8 * uDark);
  // a rebuke: the shaft blazes cold white for a moment
  light += vec3(0.75, 0.85, 1.0) * (core * 1.6 + body * 0.4) * env * uFlashK;
  // storm-dark: a churning downdraft of dark cloud, occluding — billows bulging out of a ragged edge, lit on its sun
  // flank and shadowed on the other, darker low down where it drags dust; lit from inside by its crackling
  float dn = 0.5 + 0.5 * snoise(vec3(vSide * 2.2, s * 0.42 + uTouchT * 1.3, 7.7));
  float dn2 = 0.5 + 0.5 * snoise(vec3(vSide * 4.5 + 2.0, s * 1.2 + uTouchT * 2.2, 1.9));
  float dn3 = 0.5 + 0.5 * snoise(vec3(s * 0.9 - uTouchT * 0.7, 3.3, 9.1));
  float edgeR = 0.42 + 0.3 * dn3 + 0.16 * dn2;
  float dbody = 1.0 - smoothstep(edgeR - 0.32, edgeR + 0.04, x);
  // (thinner at the foot, where it meets the canopy or the street: there the storm is scud and rain, not a wall —
  // at 0.95 over its 0.05 albedo the foot punched a black hole into the trees under it)
  float dk = uDark * dbody * env * (0.7 + 0.3 * dn) * mix(0.9, 0.6, smoothstep(0.6, 0.95, vT));
  float sunSide = clamp(0.5 + 0.5 * vSide * vSunX, 0.0, 1.0);
  float shade = (0.45 + 0.65 * sunSide * sunSide) * (0.75 + 0.5 * dn2) * mix(0.7, 1.0, smoothstep(0.55, 0.15, vT));
  // a storm cloud's own albedo, lit by the sun and the sky (slate, darker than the land it shades — never a void)
  // (0.3 read as pale smoke, not a storm; the black pit was the shadow decals, not this body: dark slate aloft,
  // lighter scud and rain at the foot)
  vec3 dc = mix(vec3(0.12, 0.125, 0.145), vec3(0.22, 0.23, 0.255), smoothstep(0.55, 0.95, vT)) * vLight * shade;
  // (a flicker now and then lights a stretch of the storm from inside — a stretch, softly: lit whole and full, the dark
  // column became a white bar)
  float fseed = floor(uTouchT * 9.0);
  float burst = pow(max(0.0, snoise(vec3(fseed * 0.37, 0.5, 2.0))), 6.0) * 1.4;
  float stretch = smoothstep(0.35, 0.85, 0.5 + 0.5 * snoise(vec3(s * 0.45, fseed * 1.7, 5.0)));
  // (an arc's own light: the stretch of the storm round the grip it struck from glows, falling off up and down the
  // column — the whole column lit at once read as a bar of white light, not a storm)
  float nearGrip = exp(-pow((vT - uGripT) / 0.09, 2.0));
  float fl = uDark * burst * stretch + uCrackK * 0.22 * nearGrip * (0.5 + 0.5 * stretch);
  vec3 flick = uRim * fl * dbody * exp(-x * x * 4.0) * (0.4 + 0.6 * dn) * env;
  vec3 c = (light + flick) * fxDisplay(0.6);
  // a dense shaft of lit air veils what is behind it a little (premultiplied over): over a blue sky a purely added
  // gold light summed to grey-white, and the regard's colour was lost
  float veil = clamp((core * 0.4 + body * 0.28) * env * uBeamK, 0.0, 0.38) * (1.0 - uDark);
  gl_FragColor = vec4((c + dc * dk) * vis, max(dk, veil) * vis);
}
`;

// the whorl in the cloud deck at the top of the shaft: a disc in the tangent plane
const WHORL_VERT = /* glsl */ `
${COMMON}
${LIGHT_GLSL}
uniform vec3 uTop;
uniform vec3 uTE1;      // the tangent plane at the top
uniform vec3 uTE2;
uniform float uRw;
varying vec2 vXZ;
varying float vZ;
varying vec3 vLight;
void main() {
  vXZ = position.xz;
  vec3 p = uTop + (uTE1 * position.x + uTE2 * position.z) * uRw;
  vLight = touchLight(uTop);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const WHORL_FRAG = /* glsl */ `
${NOISE_GLSL}
${FX_DEPTH_GLSL}
${COMMON}
uniform float uRw;
uniform float uWhorlK;
uniform float uSpinW;
varying vec2 vXZ;
varying float vZ;
varying vec3 vLight;
void main() {
  float vis = fxSoft(vZ, uRw * 0.25);
  if (vis <= 0.0) discard;
  float r = length(vXZ);
  if (r > 1.0) discard;
  float th = atan(vXZ.y, vXZ.x);
  // two spiral arms winding in to the eye (log spiral), torn by noise; the eye is open where the light comes through
  float sp = th * 2.0 + log(r + 0.04) * 3.4 - uSpinW;
  float arms = pow(0.5 + 0.5 * sin(sp), 2.2);
  float n = fbm3(vec3(cos(sp) * 1.2 + r * 4.0, sin(sp) * 1.2 - r * 2.0, uTouchT * 0.04 + 3.1));
  float ring = smoothstep(0.14, 0.34, r) * (1.0 - smoothstep(0.6, 1.0, r));
  float dens = smoothstep(0.38, 0.78, arms * 0.85 + n * 0.5) * ring;
  float a = dens * uWhorlK * uPres * vis * mix(0.85, 0.95, uDark);
  // seen from below: shaded undersides, brighter where the arm thins (light through it); storm-dark when feared
  vec3 cloud = vLight * mix(0.62, 0.3, uDark) * (0.65 + 0.35 * n) + vLight * 0.3 * (1.0 - dens) * (1.0 - uDark);
  // the eye: light pouring through; the arms' inner edges gilded (cold-rimmed when feared)
  float eye = 1.0 - smoothstep(0.0, 0.3, r);
  float edge = exp(-pow((r - 0.22) / 0.08, 2.0)) * (0.3 + 0.7 * dens);
  vec3 glow = uCol * (eye * 0.55 + edge * 1.1) * (1.0 - 0.85 * uDark) + uRim * edge * (uDark * 0.8 + uCrackK * 0.35);
  gl_FragColor = vec4(cloud * a + glow * uWhorlK * uPres * vis * fxDisplay(0.6), a);
}
`;

// the vortex and the cradle (gen/handgen.ts vortexR / mantlePoint are the CPU twins)
const VORTEX_PARS = /* glsl */ `
uniform vec3 uBase;     // the vortex's foot: the ground under the grip
uniform vec3 uAx;       // its axis (unit; it leans into the motion)
uniform vec3 uE1;
uniform vec3 uE2;
uniform float uHg;      // the grip's height over the foot (m)
uniform float uRG;      // radius at the ground
uniform float uRK;      // radius at the grip (tight while it lifts)
uniform float uSpin;    // spin phase (rad, integrated)
uniform float uGrasp;   // 0 open … 1 gathered into the cradle round what it holds
uniform vec3 uCC;       // the cradle's centre
uniform float uCR;      // its horizontal and vertical radii
uniform float uCH;
vec3 vortexAt(float h, float r, float th) { return uBase + uAx * h + (uE1 * cos(th) + uE2 * sin(th)) * r; }
float vortexR(float h, float j) {
  float h0 = uHg + uL * 0.75;
  float tg = clamp(h / max(uHg, 1e-3), 0.0, 1.0);
  float r = mix(uRG, uRK, smoothstep(0.0, 1.0, pow(tg, 0.7))) * (0.8 + 0.4 * j);
  return r * (1.0 + 0.55 * smoothstep(uHg, h0, h));
}
vec3 cradleAt(float sl, float th, float rr) {
  float cl = sqrt(max(0.0, 1.0 - sl * sl));
  return uCC + uAx * (sl * uCH * rr) + (uE1 * cos(th) + uE2 * sin(th)) * (cl * uCR * rr);
}
float gathered(float g, float b) { float e = 0.42 * (1.0 - b); return smoothstep(e, e + 0.58, g); }
// (gen/handgen.ts cradleLat: three bands of wind round what it holds, each a ring tilted its own way, precessing)
float cradleLat(float b, float th) {
  float band = min(2.0, floor(b * 3.0));
  float tilt = band > 0.5 && band < 1.5 ? 0.3 : 0.18;
  return (band < 0.5 ? -0.6 : band < 1.5 ? 0.0 : 0.45) + tilt * sin(th + band * 2.094 - uSpin * 0.21) + ((b * 3.0 - band) - 0.5) * 0.16;
}
`;

const STREAK_VERT = /* glsl */ `
${COMMON}
${LIGHT_GLSL}
${VORTEX_PARS}
attribute float aRib;
attribute float aS;
attribute float aSide;
varying float vS;
varying float vSide;
varying float vZ;
varying float vRib;
varying vec3 vLight;
varying float vWin;
vec3 helix(float s, float rib) {
  float j = fract(rib * 0.618034 + 0.13);
  // (gathered, the three tether bands reach only from the ground up to the cradle's foot)
  float hTop = uHg + uL * 0.75;
  float foot = max(0.4, dot(uCC - uBase, uAx) - uCH * 0.7);
  if (rib > 5.5) hTop = mix(hTop, foot, uGrasp);
  float h = s * hTop;
  // (each streak its own wobbling path: wind, not a coil)
  float wob = sin(s * 7.0 + rib * 2.3 + uTouchT * 1.1) * 0.22 + sin(s * 13.0 - rib * 1.7 - uTouchT * 1.7) * 0.1;
  float th = rib * 0.7854 + s * (1.2 + 1.1 * j) * 6.2831853 + uSpin * (0.85 + 0.3 * j) + wob;
  vec3 p = vortexAt(h + sin(s * 9.0 + rib) * uL * 0.04, vortexR(h, j) * (1.0 - 0.45 * uGrasp * step(5.5, rib)) * (1.0 + wob * 0.6), th);
  if (rib < 5.5) {
    // gathered: wind bound round the held thing, each band a loose turn round the cradle from its foot to its crown
    float thg = rib * 1.0472 + s * 7.5 + uSpin * (1.4 + 0.2 * j) + wob * 0.5;
    vec3 pg = cradleAt(mix(-0.95, 0.78, s), thg, 1.06 + 0.1 * j + wob * 0.08);
    p = mix(p, pg, smoothstep(0.0, 1.0, uGrasp));
  }
  return p;
}
void main() {
  vec3 p = helix(aS, aRib);
  vec3 t = helix(min(1.0, aS + 0.01), aRib) - helix(max(0.0, aS - 0.01), aRib);
  vec3 view = normalize(uCamB - p);
  vec3 side = cross(t, view);
  float sl = length(side);
  side = sl > 1e-6 ? side / sl : uE1;
  float j = fract(aRib * 0.618034 + 0.13);
  float w = max(uL * 0.028 * (0.6 + 0.8 * j) * (1.0 - 0.35 * uGrasp), length(uCamB - p) * 0.0016);
  // (gathered, the bands crossing the side of the cradle toward the eye thin to a window, as the wisps do: from a
  // god's 40 m the bound bands drew a white ring over the held person, who could not be seen at all)
  float facingB = dot(normalize(p - uCC + 1e-5), normalize(uCamB - uCC + 1e-5));
  vWin = 1.0 - 0.85 * uGrasp * step(aRib, 5.5) * smoothstep(0.1, 0.7, facingB);
  p += side * aSide * w;
  vS = aS; vSide = aSide; vRib = aRib;
  vLight = touchLight(p);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const STREAK_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
${COMMON}
uniform float uStreakK;  // brightness of the wind's light
uniform float uDustK;    // dust carried up near the ground
uniform float uFlowPh;   // the flow's phase (rising; a downdraft runs it backwards)
uniform float uGrasp;
varying float vS;
varying float vSide;
varying float vZ;
varying float vRib;
varying vec3 vLight;
varying float vWin;
void main() {
  float vis = fxSoft(vZ, max(0.3, uL * 0.2));
  if (vis <= 0.0) discard;
  float x = abs(vSide);
  float across = exp(-x * x * 3.0) * (1.0 - smoothstep(0.85, 1.0, x));
  float j = fract(vRib * 0.618034 + 0.13);
  // a gust: one stretch of each streak lit at a time, running along it with the flow and fading as it goes (the rest
  // of the streak is invisible air), broken by noise into wisps; wrapped round the cradle the bands stay lit longer
  float c0 = fract(j * 7.31 + uFlowPh * (0.22 + 0.12 * j));
  float dd = vS - c0;
  dd -= floor(dd + 0.5);
  float wrap = uGrasp * step(vRib, 5.5);
  float gust = exp(-dd * dd / mix(0.018 + 0.01 * j, 0.09, wrap)) * mix(smoothstep(0.0, 0.25, c0) * (1.0 - smoothstep(0.7, 1.0, c0)), 1.0, wrap);
  float wisp = smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(vS * 40.0 + j * 20.0 - uFlowPh * 6.0) * cos(vS * 17.0 + j * 9.0));
  float ends = smoothstep(0.0, 0.1, vS) * (1.0 - smoothstep(0.78, 1.0, vS));
  float k = across * gust * mix(0.35, 1.0, wisp) * ends * uPres * 0.55 * smoothstep(1.0, 4.0, vZ) * vWin;
  vec3 light = uCol * k * uStreakK * (1.0 - 0.85 * uDark) * mix(0.55, 1.0, smoothstep(0.1, 0.5, vS));
  light += uRim * k * uCrackK * 0.4;
  // dust whirled up off the ground (and, when feared, the storm's dark scud all the way up)
  float low = (1.0 - smoothstep(0.12, 0.5, vS)) * (1.0 - wrap);
  float da = k * clamp(uDustK * low * 0.55 + uDark * 0.5, 0.0, 0.85);
  vec3 dcol = mix(vec3(0.45, 0.38, 0.29), vec3(0.07, 0.07, 0.085), uDark) * vLight;
  vec3 c = light * fxDisplay(0.6) + dcol * da;
  gl_FragColor = vec4(c * vis, da * vis);
}
`;

// the mantle: wisps of cloud riding the whirl up, or gathered into the cradle round what the Touch holds — each a soft
// torn billow stretched along the way it is turning, so the whirl reads as cloud streaming round, not a puff
const TUFT_VERT = /* glsl */ `
${COMMON}
${LIGHT_GLSL}
${VORTEX_PARS}
attribute vec2 corner;
attribute vec4 iSeed;
uniform float uFlowPh;
uniform float uTuftK;
uniform vec3 uGrip;
uniform vec3 uCamR;     // the camera's right and up axes (body frame)
uniform vec3 uCamU;
varying vec2 vC;
varying float vA;
varying float vZ;
varying float vSoft;
varying vec3 vLight;
varying vec3 vSunS;
varying float vSeed;
varying float vCore;
varying float vG;
void main() {
  float a = iSeed.x, b = iSeed.y, c = iSeed.z, d = iSeed.w;
  // open: riding the whirl up (one climb every 5–9 s of flow), fading in and out at the ends of the climb
  float life = 5.0 + 4.0 * d;
  float ph = fract(uFlowPh * 0.3 / life + a);
  float h = ph * (uHg + 0.9 * uL);
  float r = vortexR(h, c) * (0.75 + 0.5 * c);
  float th = a * 6.2831853 + uSpin * (0.55 + 0.3 * b) + ph * 2.4;
  vec3 po = vortexAt(h, r, th);
  vec3 to = -uE1 * sin(th) + uE2 * cos(th) + uAx * 0.22;
  float fo = sin(3.14159265 * ph);
  // gathered: turning on the cradle's shell, its crown left open for the light
  float th2 = a * 6.2831853 + uSpin * (1.1 + 0.5 * c);
  float rr = 0.82 + 0.36 * c;
  vec3 pg = cradleAt(cradleLat(b, th2), th2, rr);
  // (along its tilted band: the way it is blown round)
  vec3 tg = normalize(cradleAt(cradleLat(b, th2 + 0.05), th2 + 0.05, rr) - pg + 1e-5);
  float g = gathered(uGrasp, b);
  vec3 p = mix(po, pg, g);
  vec3 tang = normalize(mix(to, tg, g) + 1e-4);
  float env = mix(fo, ${CRADLE_ALPHA.toFixed(3)}, g);
  // (gathered, the side of the cradle toward the eye thins to a window: what it holds is seen held in its weather, not
  // hidden in a ball of cloud)
  float facing = dot(normalize(pg - uCC + 1e-5), normalize(uCamB - uCC + 1e-5));
  env *= 1.0 - 0.8 * g * smoothstep(0.15, 0.8, facing);
  // a wisp: long along its way round, thin across; the open ones grow as they rise, the gathered ones a tight weave
  float szO = uL * (0.13 + 0.12 * d) * (0.55 + 0.75 * smoothstep(0.0, uHg + uL, h));
  float szG = max(uCR, uCH) * (0.2 + 0.12 * d);
  float sz = mix(szO, szG, g);
  float dist = length(p - uCamB);
  sz = max(sz, dist * 0.003);
  // (a camera inside the whirl: what passes near the lens fades instead of filling the frame)
  vA = env * uTuftK * uPres * smoothstep(0.6 + 0.12 * uL, 1.6 + 0.5 * uL, dist - sz * 0.5);
  vLight = touchLight(p);
  vSeed = a * 17.0 + b * 5.0;
  vec3 heart = mix(uGrip, uCC, g);
  vCore = 1.0 - smoothstep(0.0, max(max(uCR, uCH) * mix(1.0, 1.7, g), uL * 0.6) * 1.7, length(p - heart));
  vG = g;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // its long axis along the way it turns, as seen on screen (seen end-on it is round)
  vec2 ts = (modelViewMatrix * vec4(tang, 0.0)).xy;
  float tl = length(ts);
  float stretch = 1.0 + 1.5 * smoothstep(0.15, 0.8, tl);
  vec2 ax = tl > 1e-5 ? ts / tl : vec2(1.0, 0.0);
  vec2 ay = vec2(-ax.y, ax.x);
  vec2 cc = ax * corner.x * stretch + ay * corner.y * 0.75;
  mv.xy += cc * sz;
  // the sun in the wisp's own frame (its long and short axes; z toward the eye)
  vec2 s2 = vec2(dot(uSunDirBody, uCamR), dot(uSunDirBody, uCamU));
  vSunS = vec3(dot(s2, ax), dot(s2, ay), dot(uSunDirBody, normalize(uCamB - p)));
  vC = corner;
  vZ = -mv.z;
  vSoft = sz * 1.2;
  gl_Position = vA <= 0.002 ? vec4(0.0, 0.0, -2.0, 1.0) : projectionMatrix * mv;
}
`;
const TUFT_FRAG = /* glsl */ `
${NOISE_GLSL}
${FX_DEPTH_GLSL}
${COMMON}
uniform float uCloudA;   // the cloud's albedo (sunlit white … slate)
uniform float uGlowK;    // the light inside it
uniform float uWarm;     // how warm a trusted god's cloud is (lit gold from within)
varying vec2 vC;
varying float vA;
varying float vZ;
varying float vSoft;
varying vec3 vLight;
varying vec3 vSunS;
varying float vSeed;
varying float vCore;
varying float vG;
void main() {
  float r = length(vC);
  if (r > 1.0 || vA < 0.002) discard;
  float vis = fxSoft(vZ, vSoft);
  if (vis <= 0.0) discard;
  // a torn wisp: a soft body eaten by noise into strands along its length, thin at the rim (light comes through)
  float n = fbm3(vec3(vC * vec2(1.1, 2.4) + vSeed, vSeed * 0.37 + uTouchT * 0.09));
  float n2 = snoise(vec3(vC * vec2(2.2, 6.5) - vSeed, uTouchT * 0.25 + 3.0));
  float edge = r + 0.38 * n + 0.12 * n2;
  float dens = (1.0 - smoothstep(0.3, 0.92, edge)) * (0.45 + 0.55 * smoothstep(-0.35, 0.55, n + 0.3 * n2));
  if (dens <= 0.004) discard;
  // the wisp as a lumpy body lit by the sun: a lit flank, a shaded one (wrapped), a powdered rim
  vec3 nrm = normalize(vec3(vC + vec2(n2, n) * 0.3, sqrt(max(0.0, 1.0 - r * r)) + 0.2));
  vec3 sd = normalize(vSunS + vec3(0.0, 0.0, 1e-3));
  float lam = clamp(dot(nrm, sd) * 0.55 + 0.45, 0.0, 1.0);
  float powder = 1.0 - exp(-dens * 3.0);
  vec3 alb = uCloudA * mix(vec3(1.0), vec3(1.0, 0.7, 0.36), uWarm);
  // (a trusted god's cloud is lit more by its own light than by the sun: sunlit white swamped the gold)
  // (and kept below the tone curve's shoulder, where white swallows colour: its gold must survive to the screen)
  vec3 lit = vLight * alb * (0.25 + 0.75 * lam) * mix(0.75, 1.05, powder) * (1.0 - 0.6 * uWarm);
  // its own light inside the cloud: strongest at its heart and through the thin parts (warm gold; a cold glimmer when
  // feared, flaring with each arc)
  float thin = 1.0 - dens;
  vec3 inner = uCol * vCore * (0.45 + 1.2 * thin) * uGlowK * (1.0 - 0.85 * uDark) * mix(0.8, 1.3, vG);
  inner += uRim * (uCrackK * (0.08 + 0.35 * vCore) + uDark * 0.04 * vCore) * (0.5 + thin);
  float a = clamp(dens * vA * 0.82, 0.0, 1.0) * vis;
  gl_FragColor = vec4((lit + inner * fxDisplay(0.6)) * a, a * 0.92);
}
`;

// motes of light, dust and leaves drawn up into the vortex (instanced quads; stateless cycles on the flow's phase)
const MOTE_VERT = /* glsl */ `
${COMMON}
${LIGHT_GLSL}
${VORTEX_PARS}
attribute vec2 corner;
attribute vec4 iSeed;    // a, b, c, kind (0 a mote of light, 1 dust, 2 a leaf)
uniform float uFlowPh;
uniform float uMoteK;
uniform float uMoteS;    // the motes of light's size (a trusted god's larger)
uniform float uDustK;
uniform float uLeafK;
varying vec2 vC;
varying float vKind;
varying float vA;
varying float vZ;
varying float vSoft;
varying vec3 vLight;
varying float vTw;
void main() {
  float a = iSeed.x, b = iSeed.y, c = iSeed.z, kind = iSeed.w;
  float life = mix(2.2, 4.6, b);
  float ph = fract(uFlowPh / life + a);
  float h0 = uHg + uL * 0.75;
  // dust stays low, leaves climb half way, motes ride all the way up
  float reach = kind < 0.5 ? 1.0 : kind < 1.5 ? 0.3 : 0.75;
  float h = ph * h0 * reach;
  float r = vortexR(h, c) * (0.55 + 0.7 * c);
  float th = a * 6.2831853 + uSpin * (1.05 + 0.55 * b) + ph * 2.6;
  vec3 p = vortexAt(h, r, th);
  // gathered, the motes of light swarm round the cradle
  if (kind < 0.5) p = mix(p, cradleAt(mix(-0.8, 0.85, ph), th * 1.3, 0.9 + 0.35 * c), uGrasp * step(0.35, b));
  float dist = length(p - uCamB);
  float sz = kind < 0.5 ? uL * 0.016 * (0.6 + 0.8 * c) * uMoteS : kind < 1.5 ? uL * 0.11 * (0.6 + 0.8 * c) : uL * 0.03 * (0.7 + 0.6 * c);
  // (a mote of light never under a couple of pixels: a trusted god's are larger, the warm light it is made of)
  if (kind < 0.5) sz = max(sz, dist * 0.0018 * uMoteS);
  float on = kind < 0.5 ? uMoteK : kind < 1.5 ? uDustK : uLeafK;
  // (a camera inside the vortex: what passes within a metre or two of the lens fades, or it fills the frame with
  // great blurred discs of dust and light)
  vA = sin(3.14159265 * ph) * on * uPres * smoothstep(1.0 + 0.1 * uL, 2.5 + 0.5 * uL, dist);
  vKind = kind;
  vTw = 0.6 + 0.4 * sin(uTouchT * (5.0 + 6.0 * b) + a * 40.0);
  vLight = touchLight(p);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float rot = a * 6.2831853 + uTouchT * (kind > 1.5 ? 4.0 * (b - 0.5) : 0.3);
  vec2 cc = vec2(cos(rot) * corner.x - sin(rot) * corner.y, sin(rot) * corner.x + cos(rot) * corner.y);
  mv.xy += cc * sz * (kind > 1.5 ? vec2(1.0, 0.45 + 0.4 * abs(sin(uTouchT * 6.0 + a * 20.0))) : vec2(1.0));
  vC = corner;
  vZ = -mv.z;
  vSoft = sz * 2.0;
  gl_Position = vA <= 0.001 ? vec4(0.0, 0.0, -2.0, 1.0) : projectionMatrix * mv;
}
`;
const MOTE_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
${COMMON}
varying vec2 vC;
varying float vKind;
varying float vA;
varying float vZ;
varying float vSoft;
varying vec3 vLight;
varying float vTw;
void main() {
  float vis = fxSoft(vZ, vSoft);
  float r = length(vC);
  if (r > 1.0 || vis <= 0.0) discard;
  if (vKind < 0.5) {
    // a point of the god's light, twinkling
    float k = pow(1.0 - r, 2.2) * vA * vTw * vis;
    vec3 col = mix(uCol, uRim, uDark * 0.6) * (1.0 - 0.75 * uDark);
    gl_FragColor = vec4(col * k * 2.2 * fxDisplay(0.7), 0.0);
  } else if (vKind < 1.5) {
    // a puff of dust, lit like the ground's (thin: from the street a thick puff hid the people round the Touch)
    float a = smoothstep(1.0, 0.3, r) * vA * 0.2 * vis;
    vec3 c = mix(vec3(0.46, 0.39, 0.3), vec3(0.08, 0.08, 0.09), uDark * 0.7) * vLight;
    gl_FragColor = vec4(c * a, a);
  } else {
    // a leaf
    float a = smoothstep(1.0, 0.75, r) * vA * vis;
    vec3 c = mix(vec3(0.16, 0.3, 0.06), vec3(0.42, 0.3, 0.1), step(0.5, fract(vTw * 13.0))) * vLight * 1.5;
    gl_FragColor = vec4(c * a, a);
  }
}
`;

// a sigil traced in light, the trail behind a throw, a crackle's arcs: camera-facing strips built on the CPU
const STRIP_VERT = /* glsl */ `
attribute float aT;
attribute float aSide;
attribute float aStrip;
varying float vT;
varying float vSide;
varying float vZ;
varying float vStrip;
void main() {
  vT = aT; vSide = aSide; vStrip = aStrip;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const GLYPH_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
${COMMON}
uniform float uTrace;    // how much of the stroke is drawn (0..1)
uniform float uGlyphK;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  float vis = fxSoft(vZ, 0.5);
  if (vis <= 0.0) discard;
  float x = abs(vSide);
  // a thread of light about a pixel wide in a broad glow of its own colour. (A broad bright core read as a lit white
  // tube: at night the fork's strokes were plastic bars; at dusk, near-white over most of the strip, two hard white
  // rods hung in the air. The thread is now thin and never brighter than its colour; the glow carries the shape.)
  float core = exp(-x * x * 48.0), halo = exp(-x * x * 4.0) * (1.0 - smoothstep(0.75, 1.0, x));
  float drawn = 1.0 - smoothstep(uTrace - 0.004, uTrace + 0.004, vT);
  float head = exp(-pow((vT - uTrace) / 0.025, 2.0)) * (1.0 - step(0.999, uTrace));
  // (the light runs along the stroke, from where it began toward its head: beads of brightness, never a steady rod)
  float flow = 0.6 + 0.4 * sin(vT * 150.0 - uTouchT * 9.0) * (0.55 + 0.45 * sin(vT * 41.0 + uTouchT * 2.3));
  float ends = smoothstep(0.0, 0.035, vT);
  float kc = core * 0.55 * flow * drawn * ends + head * core * 1.3;
  float kh = halo * 0.2 * (0.75 + 0.25 * flow) * drawn * ends + head * halo * 0.45;
  // the regard's gold — or a feared god's cold blue — saturated in the glow (cubed): the tone curve and the bloom
  // pale a light colour to white, so the hue lives in the glow round the thread
  vec3 col = mix(uCol, uRim, uDark * 0.75);
  vec3 deep = col * col * col;
  vec3 c = col * kc + deep * kh * 1.6 + vec3(0.22) * head * core;
  // (the air behind the line a little veiled: against a bright sky light added alone summed to a white thread and the
  // glyph's shape and colour were lost; over the night it changes nothing)
  float veil = clamp(halo * 0.2 + core * 0.1, 0.0, 0.32) * max(drawn, head) * ends * uGlyphK * uPres * vis;
  gl_FragColor = vec4(c * uGlyphK * uPres * vis * fxDisplay(0.92), veil);
}
`;
const CRACKLE_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
${COMMON}
uniform vec3 uArcK;      // each arc's brightness now
varying float vT;
varying float vSide;
varying float vZ;
varying float vStrip;
void main() {
  float vis = fxSoft(vZ, 0.4);
  if (vis <= 0.0) discard;
  float k = vStrip < 0.5 ? uArcK.x : vStrip < 1.5 ? uArcK.y : uArcK.z;
  if (k <= 0.001) discard;
  float x = abs(vSide);
  // (lightning's own look at a small scale: a white-hot core, a cold glow; its ends taper into the cloud)
  float core = exp(-x * x * 40.0), glow = exp(-x * x * 5.0) * (1.0 - smoothstep(0.8, 1.0, x));
  float ends = smoothstep(0.0, 0.08, vT) * (1.0 - smoothstep(0.9, 1.0, vT) * 0.7);
  vec3 c = vec3(0.95, 0.96, 1.0) * core * 14.0 + uRim * glow * 2.2;
  gl_FragColor = vec4(c * k * ends * vis * uPres * fxDisplay(0.3), 0.0);
}
`;
// the vortex's heart: a soft glow round what it holds (it hangs in light), a camera-facing quad
const HEART_VERT = /* glsl */ `
${COMMON}
attribute vec2 corner;
uniform vec3 uHeartC;
uniform float uHeartR;
uniform float uHeartBack; // holding: the glow hangs BEHIND what it holds, which stands dark against it
varying vec2 vC;
varying float vZ;
void main() {
  vC = corner;
  vec3 up0 = normalize(uHeartC);
  vec3 view = normalize(uCamB - uHeartC);
  vec3 sx = cross(view, up0);
  sx = dot(sx, sx) > 1e-8 ? normalize(sx) : vec3(1.0, 0.0, 0.0);
  vec3 sy = cross(sx, view);
  vec3 p = uHeartC + (sx * corner.x + sy * corner.y) * uHeartR + view * uHeartR * mix(0.3, -0.7, uHeartBack);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const HEART_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
${COMMON}
uniform float uHeartK;
uniform float uHeartR;
uniform float uHeartBack;
varying vec2 vC;
varying float vZ;
void main() {
  // (behind what it holds the depth test is sharp: their silhouette cuts the glow)
  float vis = fxSoft(vZ, uHeartR * mix(0.8, 0.12, uHeartBack));
  float r = length(vC);
  if (r > 1.0 || vis <= 0.0) discard;
  float win = (1.0 - r * r) * (1.0 - r * r);
  // (a broad soft glow and a bright heart: by day only the heart reads, at dusk the whole glow)
  float k = (exp(-r * r * 3.5) * 0.65 + exp(-r * r * 18.0) * 0.9) * win;
  vec3 col = mix(uCol, uRim, uDark * 0.5) * (1.0 - 0.85 * uDark) + uRim * uCrackK * 0.25;
  gl_FragColor = vec4(col * k * uHeartK * uPres * vis * fxDisplay(0.6), 0.0);
}
`;

const TRAIL_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
${COMMON}
uniform float uTrailK;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  float vis = fxSoft(vZ, 0.5);
  float a = pow(1.0 - vT, 1.6) * (1.0 - abs(vSide)) * uTrailK * vis;
  vec3 col = mix(uCol, uRim, uDark * 0.6);
  gl_FragColor = vec4(col * a * 1.2 * fxDisplay(0.8), 0.0);
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
uniform float uArcAimK;
varying float vT;
varying float vZ;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float vis = fxSoft(vZ, 0.3);
  float march = 0.6 + 0.4 * sin(vT * 60.0 - uFxTime * 8.0);
  float a = (1.0 - d) * uArcAimK * vis * march;
  gl_FragColor = vec4(uArcCol * a * fxDisplay(0.9), 0.0);
}
`;

// ───────────────────────────── the visual ─────────────────────────────

const _m = new Matrix4();
const _v = new Vector3(), _w = new Vector3(), _x = new Vector3(), _y = new Vector3(), _z = new Vector3(), _s = new Vector3();
const _p3 = [0, 0, 0], _q3 = [0, 0, 0];

interface Sigil { stroke: Float32Array; t0: number }

/** a crackle: one arc lit in a slot of the Touch's clock (deterministic in that clock, so a held capture is stable) */
interface Crackle { slot: number; pts: Float32Array; low: Vector3 }

/** a crackle's slot length (s) and life within it */
const CRACK_SLOT = 0.42;
const CRACK_LIFE = 0.24;

export class HandVisual {
  readonly group = new Group();
  /** what the Touch is doing now (dominant behaviour; for probes and the audio) */
  behaviour: TouchBehaviour = 'open';
  /** body-frame state of the grip point (where things are held), its velocity, the Touch's size */
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  scale = 8;
  presence = 0;
  /** forced on (tests / photo) or off */
  force: boolean | null = null;
  /**
   * captures: hold the Touch's clock at this many seconds (behaviours settle at once), so a moment — a rebuke 0.2 s in,
   * a sigil half traced, a crackle — can be pulsed at a chosen age and photographed on a slow renderer; null runs on
   * real time
   */
  hold: number | null = null;
  /** what it holds now: kind and id (from the sim) */
  heldKind = '';
  heldId = -1;
  /** the point a held person hangs from (the top of their body: they hang through the grip), body frame */
  readonly pinch = new Vector3();
  /** the grip: the heart of the vortex, where a boulder, a tree or a bundle turns */
  readonly grip = new Vector3();
  /** the cradle's centre (body frame) and how far the mantle has gathered into it (0 open … 1 holding) */
  readonly cradle = new Vector3();
  grasp = 0;
  /** a held thing's swing (rad): a pendulum driven by the Touch's acceleration */
  swing = 0;
  /** regard as the Touch shows it (eased; −1 feared … +1 trusted) */
  regard = 0;
  /** arcs alive this frame (feared: its crackling), for probes */
  crackling = 0;
  private swingV = 0;
  private lastVf = 0;
  private fwd = new Vector3(0, 0, 1);
  private placed = false;
  private lastSim = '';
  private simActiveAt = -1e9;
  private cursorAt = -1e9;
  private lastHvPose = 'open';
  private slapAt = -1e9;
  private strokeAt = -1e9;
  private castAt = -1e9;
  private sigil: Sigil | null = null;
  /** behaviour weights, eased */
  private w = { reach: 0, lift: 0, point: 0, soothe: 0 };
  private spin = 0;
  private flowPh = 0;
  private spinW = 0;
  /** the shaft's top (a unit vector that lags the grip: the shaft trails from the clouds) */
  private topU = new Vector3(0, 1, 0);
  private axis = new Vector3(0, 1, 0);
  private built = false;
  private visibleNow = false;
  /** the drawn size of what it holds (m), eased (the cradle's size) */
  private heldDrawn = 0;
  private cradleR = 1;
  private cradleH = 1;
  private crackles: Crackle[] = [];
  private placedTop = false;
  private gustSent = false;
  private flashSlot = -1;
  /** the CPU twin of the vortex's uniforms (gen/handgen.ts mantlePoint): arcs and the shadow are placed with it */
  private readonly vf: VortexFrame = {
    base: [0, 0, 0], ax: [0, 1, 0], e1: [1, 0, 0], e2: [0, 0, 1], hg: 4, L: 8, rg: 6, rk: 2, spin: 0, flow: 0, grasp: 0, c: [0, 0, 0], cr: 1, ch: 1,
  };
  private readonly u = {
    uCamB: { value: new Vector3() }, uCol: { value: new Color(1, 0.9, 0.7) }, uRim: { value: new Color(0.55, 0.7, 1) }, uDark: { value: 0 },
    uPres: { value: 0 }, uTouchT: { value: 0 }, uL: { value: 8 }, uCrackK: { value: 0 },
    // shaft
    uTop: { value: new Vector3() }, uGrip: { value: new Vector3() }, uGround: { value: new Vector3() }, uGripT: { value: 0.8 },
    uWTop: { value: 10 }, uWGrip: { value: 2 }, uWGround: { value: 3 }, uBeamK: { value: 1 }, uGroundK: { value: 0.2 }, uFlashK: { value: 0 },
    // whorl
    uE1: { value: new Vector3(1, 0, 0) }, uE2: { value: new Vector3(0, 0, 1) }, uRw: { value: 30 }, uWhorlK: { value: 0.8 }, uSpinW: { value: 0 },
    // vortex and cradle
    uBase: { value: new Vector3() }, uAx: { value: new Vector3(0, 1, 0) }, uHg: { value: 4 }, uRG: { value: 6 }, uRK: { value: 2 }, uSpin: { value: 0 },
    uGrasp: { value: 0 }, uCC: { value: new Vector3() }, uCR: { value: 1 }, uCH: { value: 1 },
    uStreakK: { value: 0.5 }, uDustK: { value: 0.4 }, uFlowPh: { value: 0 }, uMoteK: { value: 0.7 }, uMoteS: { value: 1 }, uLeafK: { value: 0.3 },
    // mantle
    uTuftK: { value: 0.8 }, uCloudA: { value: 0.8 }, uGlowK: { value: 0.5 }, uWarm: { value: 0 }, uCamR: { value: new Vector3(1, 0, 0) }, uCamU: { value: new Vector3(0, 1, 0) },
    // glyph, trail, arc, crackles, heart
    uTrace: { value: 0 }, uGlyphK: { value: 0 }, uTrailK: { value: 0 }, uHeartC: { value: new Vector3() }, uHeartR: { value: 4 }, uHeartK: { value: 0.3 }, uHeartBack: { value: 0 },
    uArcCol: { value: new Color(1, 0.85, 0.5) }, uArcAimK: { value: 0 }, uSize: { value: 6 }, uArcK: { value: new Vector3() },
    // the whorl's frame at the top (its own pair: the vortex frame leans)
    uTE1: { value: new Vector3(1, 0, 0) }, uTE2: { value: new Vector3(0, 0, 1) },
  };
  private column!: Mesh;
  private whorl!: Mesh;
  private streaks!: Mesh;
  private tufts!: Mesh;
  private motes!: Mesh;
  private glyph!: Mesh;
  private heart!: Mesh;
  private trailMesh!: Mesh;
  private crackMesh!: Mesh;
  private arcMesh!: Points;
  private glyphGeo = stripGeometry(TOUCH_N.glyph);
  private trailGeo = stripGeometry(TOUCH_N.trail);
  private crackGeo = stripGeometry(TOUCH_N.arc, TOUCH_N.arcs);
  private arcGeo = new BufferGeometry();
  private trail: { p: Vector3; t: number }[] = [];
  private heldMeshes = new Map<string, Mesh>();
  private heldGroup = new Group();
  private heldMat: MeshStandardMaterial | null = null;
  private heldLeafMat: MeshStandardMaterial | null = null;
  private sharedU: Record<string, IUniform> = {};
  private fxU: Record<string, IUniform> = {};
  private mats: ShaderMaterial[] = [];

  constructor() {
    this.group.name = 'touch';
    this.group.matrixAutoUpdate = false;
    this.heldGroup.matrixAutoUpdate = false;
    this.group.add(this.heldGroup);
    this.arcGeo.setAttribute('position', new BufferAttribute(new Float32Array(96 * 3), 3));
    this.arcGeo.setAttribute('aT', new BufferAttribute(new Float32Array(96), 1));
  }

  /** the FX materials need the shared depth / exposure uniforms (GodFx) */
  bindFx(fx: Record<string, IUniform>): void {
    this.fxU = fx;
    for (const m of this.mats) Object.assign(m.uniforms, fx);
  }

  /** make the meshes on first use: their materials take the planet's (proxied) atmosphere uniforms */
  private build(shared: Record<string, IUniform>): void {
    if (this.built) return;
    this.built = true;
    this.sharedU = shared;
    const mk = (vert: string, frag: string, additive: boolean): ShaderMaterial => {
      const uniforms: Record<string, IUniform> = { ...this.u };
      for (const k of Object.keys(this.fxU)) uniforms[k] = this.fxU[k];
      for (const k of Object.keys(shared)) if (!(k in uniforms)) uniforms[k] = shared[k];
      const m = new ShaderMaterial({
        vertexShader: vert, fragmentShader: frag, uniforms, transparent: true, depthTest: false, depthWrite: false, side: DoubleSide,
        // (premultiplied over: light adds with alpha 0, the storm's dark cloud occludes with its alpha)
        ...(additive ? ADD_LIGHT : { blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor }),
      });
      this.mats.push(m);
      return m;
    };
    const fxMesh = <T extends Mesh | Points>(o: T, order: number): T => {
      o.frustumCulled = false; o.matrixAutoUpdate = false; o.layers.set(FX_LAYER); o.renderOrder = order;
      this.group.add(o);
      return o;
    };
    this.whorl = fxMesh(new Mesh(discGeometry(14, 48), mk(WHORL_VERT, WHORL_FRAG, false)), 13);
    this.column = fxMesh(new Mesh(stripGeometry(TOUCH_N.column), mk(COLUMN_VERT, COLUMN_FRAG, false)), 14);
    this.tufts = fxMesh(new Mesh(tuftGeometry(), mk(TUFT_VERT, TUFT_FRAG, false)), 15);
    this.motes = fxMesh(new Mesh(moteGeometry(), mk(MOTE_VERT, MOTE_FRAG, false)), 16);
    this.heart = fxMesh(new Mesh(quadGeometry(), mk(HEART_VERT, HEART_FRAG, true)), 16);
    this.streaks = fxMesh(new Mesh(bandGeometry(), mk(STREAK_VERT, STREAK_FRAG, false)), 17);
    this.glyph = fxMesh(new Mesh(this.glyphGeo, mk(STRIP_VERT, GLYPH_FRAG, false)), 18);
    this.trailMesh = fxMesh(new Mesh(this.trailGeo, mk(STRIP_VERT, TRAIL_FRAG, true)), 18);
    this.crackMesh = fxMesh(new Mesh(this.crackGeo, mk(STRIP_VERT, CRACKLE_FRAG, true)), 19);
    this.arcMesh = fxMesh(new Points(this.arcGeo, mk(ARC_VERT, ARC_FRAG, true)), 19);
    this.arcMesh.visible = false;
    this.glyph.visible = false;
    this.crackMesh.visible = false;
    this.heldMat = makePropMaterial(shared, { key: 'held', roughness: 0.88 });
  }

  /** the Touch has no opaque body: what it holds is a prop, swapped by GodFx with the others */
  swapDepth(_depth: boolean): void { /* nothing of its own casts */ }

  /**
   * a rebuke, a soothing or a cast seen in the events (GodFx): `what` is the miracle's kind for a cast (its sigil, the
   * power's `sigil` field, is traced in light)
   */
  pulse(kind: 'slap' | 'stroke' | 'cast', t: number, what?: string): void {
    if (kind === 'slap') this.slapAt = t;
    else if (kind === 'stroke') this.strokeAt = t;
    else {
      this.castAt = t;
      this.sigil = { stroke: sigilStroke(sigilOfMiracle(what ?? ''), TOUCH_N.glyph), t0: t };
    }
  }

  update(f: HandFrame): void {
    const pv = f.pv;
    const hv = f.hand && f.hand.planet === pv.id ? f.hand : null;
    const R = pv.params.radius;
    const t = this.hold ?? f.fxTime;
    // ── presence: the cursor over this world, or the sim's hand doing something ──
    const sig = hv ? `${hv.pos[0].toFixed(5)},${hv.pos[1].toFixed(5)},${hv.alt.toFixed(1)},${hv.pose},${hv.held ? hv.held.kind + hv.held.id : ''}` : '';
    if (hv && sig !== this.lastSim) {
      if (this.lastSim) this.simActiveAt = t;
      this.lastSim = sig;
    }
    const cursorHere = f.cursor && f.cursor.planet === pv.id ? f.cursor : null;
    if (cursorHere) this.cursorAt = t;
    const simActive = !!hv && (!!hv.held || hv.pose !== 'open' || t - this.simActiveAt < 30);
    const altCam = this.camAltitude(f);
    let want = (cursorHere ? 1 : 0) || (simActive ? 1 : 0) || (t - this.cursorAt < 2 ? 1 : 0);
    if (altCam > R * 4) want = 0;
    // from orbit only the player's own cursor brings the Touch: the sim's hand moving on its own (an idle drift, a held
    // pose) lit its glint as a lone white speck on the terminator of the title's backdrop and of every orbit view
    if (altCam > R * 1.2 && !cursorHere && t - this.cursorAt >= 2) want = 0;
    if (this.force != null) want = this.force ? 1 : 0;
    this.presence += (want - this.presence) * Math.min(1, f.dt * (want > this.presence ? 2.4 : 2.0));
    if (this.force === true) this.presence = 1;
    if (this.presence < 0.004 && !want) {
      this.presence = 0;
      this.group.visible = false;
      this.visibleNow = false;
      this.placed = false;
      this.crackling = 0;
      return;
    }
    this.group.visible = true;
    this.visibleNow = true;
    this.build(f.shared);
    const dt = Math.min(0.1, f.dt);
    // ── what it holds ──
    this.heldKind = hv?.held ? hv.held.kind : '';
    this.heldId = hv?.held ? hv.held.id : -1;
    // ── behaviour: the sim's pose, the UI's cursor, one-off events ──
    const ui = cursorHere ? f.uiPose : 'none';
    const hp = hv?.pose ?? 'open';
    if (hp !== this.lastHvPose) {
      if (hp === 'slap') this.slapAt = t;
      if (hp === 'stroke') this.strokeAt = t;
      if (hp === 'cast' && t - this.castAt > 1.5) this.pulse('cast', t);
      this.lastHvPose = hp;
    }
    if (ui === 'slap' && t - this.slapAt > 0.9) this.slapAt = t;
    const lifting = this.heldKind !== '';
    const W = this.w;
    const ease = (cur: number, to: number, rate: number) => cur + (to - cur) * Math.min(1, this.hold !== null ? 1 : dt * rate);
    W.lift = ease(W.lift, lifting ? 1 : 0, 2.2);
    W.reach = ease(W.reach, !lifting && (ui === 'open' || ui === 'press') ? 1 : 0, 4);
    W.point = ease(W.point, !lifting && (ui === 'tool' || ui === 'aim' || hp === 'point') ? 1 : 0, 4);
    W.soothe = ease(W.soothe, hp === 'stroke' || t - this.strokeAt < 2.5 ? 1 : 0, 1.6);
    const rebukeAge = t - this.slapAt;
    const rk = rebukeAge >= 0 && rebukeAge < 1.6 ? Math.exp(-rebukeAge * 2.6) * smooth(0, 0.06, rebukeAge) : 0;
    const castAge = t - this.castAt;
    const ck = castAge >= 0 && castAge < 2.4 ? Math.sin(Math.PI * Math.min(1, castAge / 2.4)) : 0;
    this.behaviour = rk > 0.2 ? 'rebuke' : ck > 0.2 ? 'sigil' : W.lift > 0.5 ? 'lift' : W.point > 0.5 ? 'point' : W.soothe > 0.5 ? 'soothe' : W.reach > 0.5 ? 'reach' : 'open';
    // ── placement ──
    this.place(f, hv, cursorHere, ui, altCam, dt);
    const L = this.scale;
    const up = _v.copy(this.pos).normalize();
    const gR = groundHeight(pv.ground, up.x, up.y, up.z);
    const hAbove = Math.max(0.5, this.pos.length() - gR);
    // ── regard → palette and weather (eased: a people's view of its god does not flip in a frame) ──
    const regard = Math.max(-1, Math.min(1, hv?.regard ?? hv?.alignment ?? 0));
    this.regard += (regard - this.regard) * Math.min(1, this.hold !== null ? 1 : dt * 1.2);
    const look = touchLook(this.regard);
    const trusted = look.trusted, feared = look.feared;
    const col = this.u.uCol.value;
    col.setRGB(look.light[0], look.light[1], look.light[2]);
    this.u.uDark.value = look.dark;
    this.u.uRim.value.setRGB(look.rim[0], look.rim[1], look.rim[2]);
    this.u.uArcCol.value.copy(col);
    // ── behaviour → the weather's numbers ──
    const air = f.air !== false;
    const nearG = 1 - smooth(1.2 * L, 4 * L, hAbove);
    const grasp = W.lift;
    this.grasp = grasp;
    this.u.uGrasp.value = grasp;
    // (a trusted god's shaft is warm daylight let down to them: stronger than an awed god's pale one — but at 1.7x, with
    // its veil and bloom, from 110 m it washed a quarter of the frame to a gold haze and hid the land under it)
    this.u.uBeamK.value = (0.5 + 0.2 * grasp + 0.55 * W.point + 0.35 * W.soothe + 0.35 * ck) * (1 - 0.3 * feared) * (1 + 0.4 * trusted);
    this.u.uGroundK.value = Math.min(1, 0.16 + 0.75 * W.point + 0.45 * W.soothe + 0.3 * ck);
    this.u.uFlashK.value = rk * 1.2;
    this.u.uStreakK.value = Math.max(0.08, 0.32 + 0.4 * grasp + 0.35 * W.reach - 0.2 * W.soothe - 0.25 * W.point + 1.1 * rk + 0.3 * ck);
    // (a trusted god's air is still: little dust raised — a cloud of beige dust round it read as a dust devil, not light)
    this.u.uDustK.value = air ? (0.35 + 0.05 * grasp + 0.3 * W.reach + 1.2 * rk) * nearG * (1 - 0.55 * trusted) : 0;
    this.u.uMoteK.value = 0.6 + 0.6 * W.soothe + 0.8 * ck + 0.3 * grasp + 0.4 * trusted;
    this.u.uMoteS.value = 1 + 0.9 * trusted + 0.4 * ck + 0.3 * W.soothe;
    this.u.uLeafK.value = air ? (0.25 + 0.3 * grasp + 0.4 * W.reach) * nearG * (1 - 0.6 * feared) : 0;
    this.u.uWhorlK.value = air ? 0.75 + 0.2 * feared : 0;
    // the mantle: a light whirl of cloud open, a dense cradle holding; a feared god's storm is thick and dark; on an
    // airless world there is no cloud to gather (the light and the motes alone)
    this.u.uTuftK.value = air ? (0.42 + 0.06 * grasp + 0.25 * W.reach - 0.25 * W.point + 0.3 * feared + 0.2 * rk) * (1 - 0.35 * W.soothe) : 0;
    this.u.uCloudA.value = look.cloud;
    this.u.uWarm.value = 0.95 * trusted;
    // (its own light inside its cloud: warm gold through a trusted god's whirl — the cloud reads as lit by the god, not
    // only by the sun)
    this.u.uGlowK.value = (0.6 + 0.7 * grasp + 0.6 * W.soothe + 0.8 * ck) * (0.7 + 2.2 * trusted);
    // spin: still air when trusted, a storm when feared; fast while it lifts; a rebuke reverses the flow (downdraft)
    const omega = (0.7 + 0.5 * (1 - trusted) + 1.8 * feared) * (1 + 1.3 * grasp + 0.7 * W.reach - 0.55 * W.soothe) + 7 * rk;
    this.spin += omega * dt;
    const flow = (0.75 + 0.9 * grasp + 0.3 * W.reach - 0.95 * W.soothe) * (1 + feared * 0.6) - 4.5 * rk;
    this.flowPh += flow * dt;
    this.spinW += (0.12 + 0.35 * feared) * dt;
    this.u.uSpin.value = this.spin % (Math.PI * 2000);
    this.u.uFlowPh.value = this.flowPh % 1000;
    this.u.uSpinW.value = this.spinW % (Math.PI * 200);
    this.u.uPres.value = this.presence;
    this.u.uTouchT.value = t % 3600;
    this.u.uL.value = L;
    (this.u.uCamB.value as Vector3).copy(f.camBody);
    this.u.uCamR.value.copy(f.camFwd).cross(f.camUp).normalize();
    this.u.uCamU.value.copy(f.camUp);
    // ── the vortex: its foot on the ground under the grip, its axis leaning into the motion ──
    const vt = _w.copy(this.vel).addScaledVector(up, -this.vel.dot(up));
    const lean = Math.min(0.4, vt.length() / Math.max(1, L * 5));
    if (vt.lengthSq() > 1e-8) vt.normalize();
    this.axis.copy(up).multiplyScalar(Math.cos(lean)).addScaledVector(vt, Math.sin(lean)).normalize();
    const Hg = hAbove;
    this.u.uBase.value.copy(this.pos).addScaledVector(this.axis, -Hg);
    this.u.uAx.value.copy(this.axis);
    tangentFrame(this.axis, this.u.uE1.value, this.u.uE2.value);
    this.u.uHg.value = Hg;
    // wide at the ground (the dust it draws up), tight at the grip (tighter still while it lifts); a rebuke flings it out
    this.u.uRG.value = L * (0.85 + 0.35 * W.reach - 0.3 * W.point + 0.5 * W.soothe + 1.4 * rk - 0.25 * grasp);
    this.u.uRK.value = L * (0.36 - 0.18 * grasp - 0.08 * W.reach - 0.12 * W.point + 0.15 * W.soothe + 0.4 * rk);
    // ── the grip, the pinch, and the cradle round what it holds ──
    this.grip.copy(this.pos);
    this.pinch.copy(this.pos).addScaledVector(up, 0.95);
    this.heldVisual(L, t);
    const cr = this.heldKind ? cradleOf(this.heldKind, this.heldDrawn, L) : null;
    if (cr) {
      this.cradleR = ease(this.cradleR, cr.r, 5);
      this.cradleH = ease(this.cradleH, cr.h, 5);
      this.cradle.copy(this.heldKind === 'agent' ? this.pinch : this.grip).addScaledVector(up, -cr.drop);
    } else this.cradle.copy(this.grip);
    this.u.uCC.value.copy(this.cradle);
    this.u.uCR.value = this.cradleR;
    this.u.uCH.value = this.cradleH;
    this.syncFrame(L, Hg, grasp);
    // the heart: what it holds hangs in its light
    this.u.uHeartC.value.copy(this.cradle);
    this.u.uHeartR.value = L * (0.55 + 0.3 * ck + 0.3 * W.soothe) * (1 - 0.5 * grasp) + grasp * Math.max(this.cradleR, this.cradleH) * 0.4;
    this.u.uHeartK.value = (0.22 + 0.2 * W.reach + 0.25 * W.soothe + 0.8 * rk) * (1 - 0.3 * grasp) + 0.3 * grasp + 0.2 * trusted;
    this.u.uHeartBack.value = grasp;
    // ── a trusted god is warm light more than weather: its cloud thins, the light at its heart swells and its shaft
    //    brightens, motes of light thicken in the air and almost no dust is raised (open, as fully as it can: a sunlit
    //    whirl of cloud read as a white dust devil; holding, half as far: the cradle's weave must still show, and what
    //    it holds must stand dark against the light, not drown in it) ──
    if (trusted > 0) {
      const tw = trusted * (1 - 0.5 * grasp);
      this.u.uTuftK.value *= 1 - trusted * (0.65 - 0.2 * grasp);
      this.u.uHeartK.value *= 1 + 2.5 * tw;
      this.u.uHeartR.value *= 1 + tw;
      this.u.uMoteK.value *= 1 + 1.5 * tw;
      this.u.uBeamK.value *= 1 + 0.7 * tw;
      this.u.uDustK.value *= 1 - trusted * (0.8 - 0.15 * grasp);
      this.u.uGlowK.value *= 1 + 0.8 * tw;
    }
    // a cast's own swell of light, added after the regard's: multiplied by a trusted god's warmth with the rest, the
    // heart of a cast burned the town round it and the sigil traced over it to white
    this.u.uHeartK.value += 0.4 * ck;
    // ── far away (from the god's height and beyond) the Touch condenses to a point of light under its whorl: its cloud,
    //    its wind and its dust fade, its heart glows (at ~140 m it would read as a weather system from orbit) ──
    const camD = this.pos.distanceTo(f.camBody);
    const farK = smooth(500, 2500, camD);
    if (farK > 0) {
      this.u.uTuftK.value *= 1 - 0.85 * farK;
      this.u.uStreakK.value *= 1 - 0.8 * farK;
      this.u.uDustK.value *= 1 - farK;
      this.u.uLeafK.value *= 1 - farK;
      this.u.uHeartK.value += 0.55 * farK;
      this.u.uHeartR.value = Math.max(this.u.uHeartR.value * (1 - 0.6 * farK), camD * 0.011 * farK);
    }
    // ── the shaft: down from the deck's whorl, through the grip, to the ground ──
    const deck = f.cloudBase !== undefined && air ? Math.max(f.cloudBase - gR, Hg + 2 * L) : Hg + 9 * L;
    const topH = Math.min(deck, Hg + 40 * L);
    // the top lags the grip (the shaft trails from the clouds as the Touch moves), faster than the grip's own spring
    if (!this.placedTop) { this.topU.copy(up); this.placedTop = true; }
    else this.topU.lerp(up, Math.min(1, dt * 2.2)).normalize();
    const tu = this.topU;
    const gTop = groundHeight(pv.ground, tu.x, tu.y, tu.z);
    this.u.uTop.value.copy(tu).multiplyScalar(gTop + topH);
    this.u.uGrip.value.copy(this.pos);
    this.u.uGround.value.copy(up).multiplyScalar(gR + 0.2);
    const lenTop = this.u.uTop.value.distanceTo(this.pos), lenBot = hAbove;
    this.u.uGripT.value = lenTop / Math.max(1e-3, lenTop + lenBot);
    // (the strip is wider than the light in it: the beam's soft falloff needs the room; a feared god's downdraft is
    // a broad column of dark cloud)
    const wk = 1.6 * (1 + 0.45 * feared) * (1 + 0.2 * trusted * (1 - grasp)) * (1 - 0.55 * farK);
    this.u.uWTop.value = Math.max(L * 1.1, topH * 0.06) * (1 + 0.4 * W.soothe - 0.35 * W.point) * wk;
    this.u.uWGrip.value = L * (0.3 - 0.1 * grasp - 0.17 * W.point + 0.2 * W.soothe + 0.25 * rk) * wk;
    this.u.uWGround.value = L * (0.42 + 0.55 * W.soothe - 0.3 * W.point) * wk;
    // the whorl: a disc at the top in the tangent plane there
    this.u.uRw.value = Math.max(2.4 * L, topH * 0.3) * (1 + 0.25 * feared);
    tangentFrame(tu, this.u.uTE1.value, this.u.uTE2.value);
    this.whorl.visible = air && this.u.uWhorlK.value > 0;
    this.tufts.visible = this.u.uTuftK.value > 0.01;
    // from orbit the shaft is a thin grey needle standing off the limb (behind the title, too): above a few tenths of a
    // radius (a third of the way out to the disc-filling view) only the glint at its foot and the whorl in the deck say
    // where the Touch is
    const orbK = smooth(R * 0.35, R * 0.6, altCam);
    this.u.uBeamK.value *= 1 - orbK;
    this.u.uStreakK.value *= 1 - orbK;
    this.column.visible = orbK < 0.98;
    this.streaks.visible = orbK < 0.98;
    // the pendulum: pushed by its forward acceleration, damped
    {
      const vf = this.vel.dot(this.fwd);
      const acc = dt > 0 ? (vf - this.lastVf) / dt : 0;
      this.lastVf = vf;
      const w0 = 2.6;
      this.swingV += (-w0 * w0 * this.swing - 1.2 * this.swingV - acc * 0.1) * dt;
      this.swing = Math.max(-0.9, Math.min(0.9, this.swing + this.swingV * dt)) + Math.sin(t * 1.3) * 0.002 * grasp;
    }
    this.glyphUpdate(f, L, castAge);
    this.trailUpdate(f);
    this.arcUpdate(f, hv);
    const g = gR;
    const gp: [number, number, number] = [up.x * g, up.y * g, up.z * g];
    this.crackleUpdate(f, t, look.crackle * (air ? 1 : 0.5), L, gp);
    // ── on the ground: a pool of the god's light (lifted to the grip, so it lights what it holds); the shadow its cloud
    //    casts in the sun; the ring of dust the vortex stirs; a rebuke's gust rolling out ──
    const reachL = L * (2.2 + 1.6 * W.soothe) + hAbove * 0.5;
    const pool = decal(DECAL.light, gp, reachL);
    pool.cr = col.r; pool.cg = col.g; pool.cb = col.b;
    pool.p0 = reachL; pool.p2 = hAbove * 0.7; pool.p3 = Math.max(1, L * 0.5);
    pool.p1 = (2 + 4 * W.soothe + 2.5 * W.point + 3.5 * ck + 2 * grasp) * L * L * this.presence * (1 - 0.8 * feared) * (1 - 0.5 * smooth(2 * L, 8 * L, hAbove));
    f.decals.add(pool);
    this.cloudShadow(f, up, gR, L, feared, grasp, air);
    // (decal colours are radiance: the dust is lit by the day, dark at night)
    const sunE = (f.shared.uSunE?.value as Vector3 | undefined)?.y ?? 8;
    const sunD = f.shared.uSunDirBody?.value as Vector3 | undefined;
    const dayK = Math.max(0.015, Math.min(1, (sunE / 8) * (0.12 + 0.88 * Math.max(0, sunD ? up.dot(sunD) : 0.6))));
    if (air && nearG > 0.02) {
      const ring = decal(DECAL.ring, gp, this.u.uRG.value * 1.5 + L * 0.4);
      ring.cr = 0.42 * dayK; ring.cg = 0.36 * dayK; ring.cb = 0.28 * dayK; ring.ca = 0.1 * this.u.uDustK.value * this.presence;
      ring.p0 = this.u.uRG.value * 0.95; ring.p1 = L * 0.28; ring.q0 = Math.max(2, L * 0.5);
      f.decals.add(ring);
    }
    if (rk > 0.01 && air) {
      const rr = L * (1 + rebukeAge * 7);
      const gust = decal(DECAL.ring, gp, rr + L);
      gust.cr = 0.48 * dayK; gust.cg = 0.42 * dayK; gust.cb = 0.34 * dayK; gust.ca = 0.55 * (1 - smooth(0, 1.5, rebukeAge)) * this.presence;
      gust.p0 = rr; gust.p1 = L * (0.4 + rebukeAge * 0.8); gust.q0 = Math.max(2, L * 0.6);
      f.decals.add(gust);
      const cold = decal(DECAL.light, gp, L * 6);
      cold.cr = 0.7; cold.cg = 0.82; cold.cb = 1.0; cold.p0 = L * 6; cold.p1 = 40 * L * L * rk * this.presence; cold.p2 = hAbove; cold.p3 = L;
      f.decals.add(cold);
      if (!this.gustSent && rebukeAge < 0.5) { this.gustSent = true; f.burst?.('gust', _x.copy(up).multiplyScalar(g), L); f.burst?.('flash', this.pos, L); }
    } else this.gustSent = false;
  }

  /** the CPU twin of the vortex uniforms (arcs and the shadow are placed on the same whirl the shaders draw) */
  private syncFrame(L: number, hg: number, grasp: number): void {
    const v = this.vf, u = this.u;
    const set = (o: [number, number, number], s: Vector3) => { o[0] = s.x; o[1] = s.y; o[2] = s.z; };
    set(v.base, u.uBase.value); set(v.ax, u.uAx.value); set(v.e1, u.uE1.value); set(v.e2, u.uE2.value); set(v.c, u.uCC.value);
    v.hg = hg; v.L = L; v.rg = u.uRG.value; v.rk = u.uRK.value; v.spin = u.uSpin.value; v.flow = u.uFlowPh.value; v.grasp = grasp;
    v.cr = u.uCR.value; v.ch = u.uCH.value;
  }

  /**
   * a feared god's storm crackles: in each slot of the Touch's clock an arc may fire (at `rate` per second), from a
   * point of its cloud to another or down to the ground; it flickers for a moment, lights the storm from inside and
   * flashes cold on the ground. Deterministic in the clock (a held capture shows the same arc).
   */
  private crackleUpdate(f: HandFrame, t: number, rate: number, L: number, gp: [number, number, number]): void {
    const pos = this.crackGeo.getAttribute('position') as BufferAttribute;
    const arcK = this.u.uArcK.value;
    arcK.set(0, 0, 0);
    let lit = 0, crack = 0;
    if (rate > 0 && this.presence > 0.2) {
      const slot0 = Math.floor(t / CRACK_SLOT);
      // the live slots (the current one and the one before, whose arc may still be lit)
      for (let s = slot0 - 1; s <= slot0; s++) {
        const pFire = 1 - Math.exp(-rate * CRACK_SLOT);
        if (fxHash(s, 0x51c) >= pFire) continue;
        const start = s * CRACK_SLOT + fxHash(s, 0x51d) * (CRACK_SLOT - CRACK_LIFE * 0.5);
        const age = t - start;
        if (age < 0 || age > CRACK_LIFE) continue;
        if (lit >= TOUCH_N.arcs) break;
        let arc = this.crackles.find((c) => c.slot === s);
        if (!arc) {
          arc = this.makeArc(s, L, gp);
          this.crackles.push(arc);
          if (this.crackles.length > 6) this.crackles.shift();
        }
        // a lightning stroke's flicker: a bright stroke, a dip, a re-strike, fading
        const k = (age < 0.04 ? 1 : 0.35 + 0.65 * Math.abs(Math.sin(age * 55))) * (1 - age / CRACK_LIFE) * (0.8 + 0.4 * fxHash(s, 0x51e));
        // the strip of this arc, camera-facing
        const n = TOUCH_N.arc, pts = arc.pts, cam = f.camBody;
        const w = Math.max(L * 0.012, 0.05);
        for (let i = 0; i < n; i++) {
          const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
          const px = pts[i * 3], py = pts[i * 3 + 1], pz = pts[i * 3 + 2];
          const tx = pts[i1 * 3] - pts[i0 * 3], ty = pts[i1 * 3 + 1] - pts[i0 * 3 + 1], tz = pts[i1 * 3 + 2] - pts[i0 * 3 + 2];
          const vx = cam.x - px, vy = cam.y - py, vz = cam.z - pz;
          let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
          const d = Math.hypot(vx, vy, vz);
          const ww = Math.max(w, d * 0.0016) * 4;
          const sl = Math.hypot(sx, sy, sz) || 1;
          sx *= ww / sl; sy *= ww / sl; sz *= ww / sl;
          const o = (lit * n + i) * 2;
          pos.setXYZ(o, px + sx, py + sy, pz + sz);
          pos.setXYZ(o + 1, px - sx, py - sy, pz - sz);
        }
        if (lit === 0) arcK.x = k; else if (lit === 1) arcK.y = k; else arcK.z = k;
        crack = Math.max(crack, k);
        lit++;
        // its light: cold, on the ground under its lower end; the view flickers a little when near (once per arc)
        const fl = decal(DECAL.light, [arc.low.x, arc.low.y, arc.low.z], L * 5);
        fl.cr = 0.62; fl.cg = 0.74; fl.cb = 1.0; fl.p0 = L * 5; fl.p1 = 1.2 * L * L * k * this.presence; fl.p2 = L * 0.6; fl.p3 = L * 0.5;
        f.decals.add(fl);
        if (this.flashSlot !== s && age < 0.05) { this.flashSlot = s; f.burst?.('flash', arc.low, L * 0.12); }
      }
    }
    // (unused strips collapse to nothing)
    for (let a = lit; a < TOUCH_N.arcs; a++) for (let i = 0; i < TOUCH_N.arc * 2; i++) pos.setXYZ(a * TOUCH_N.arc * 2 + i, 0, 0, 0);
    pos.needsUpdate = true;
    this.crackMesh.visible = lit > 0;
    this.crackling = lit;
    this.u.uCrackK.value = crack * this.presence;
  }

  /**
   * captures: the first moment at or after `from` (s of the Touch's clock) when one of its arcs has just struck, at
   * the crackling rate of regard `regard` (null when it does not crackle) — hold the clock there to photograph it
   */
  nextCrackle(from: number, regard = this.regard): number | null {
    const rate = touchLook(regard).crackle;
    if (rate <= 0) return null;
    const pFire = 1 - Math.exp(-rate * CRACK_SLOT);
    for (let s = Math.floor(from / CRACK_SLOT); s < Math.floor(from / CRACK_SLOT) + 2000; s++) {
      if (fxHash(s, 0x51c) >= pFire) continue;
      // (a moment into the stroke, past its first white-out: the arc still lit, the storm still dark)
      const t = s * CRACK_SLOT + fxHash(s, 0x51d) * (CRACK_SLOT - CRACK_LIFE * 0.5) + 0.06;
      if (t >= from) return t;
    }
    return null;
  }

  /** an arc for slot s: through the storm cloud, or down out of it to the ground (a third of them) */
  private makeArc(s: number, L: number, gp: [number, number, number]): Crackle {
    const rnd = touchRng(0x9e37 + s * 7919);
    const v = this.vf;
    mantlePoint(v, rnd(), 0.35 + 0.6 * rnd(), rnd(), rnd(), _p3);
    const toGround = rnd() < 0.34;
    if (toGround) {
      // to the ground beside the whirl's foot
      const a = rnd() * Math.PI * 2, r = (0.4 + 0.8 * rnd()) * Math.max(v.rg, L * 0.4);
      for (let i = 0; i < 3; i++) _q3[i] = gp[i] + (v.e1[i] * Math.cos(a) + v.e2[i] * Math.sin(a)) * r;
    } else mantlePoint(v, rnd(), rnd(), rnd(), rnd(), _q3);
    const len = Math.hypot(_q3[0] - _p3[0], _q3[1] - _p3[1], _q3[2] - _p3[2]);
    // a jagged channel: 2^5 + 1 = 33 points (TOUCH_N.arc)
    const pts = crackleArc(_p3, _q3, len * 0.18, 5, rnd);
    const lowEnd = toGround ? _q3 : (Math.hypot(_p3[0], _p3[1], _p3[2]) < Math.hypot(_q3[0], _q3[1], _q3[2]) ? _p3 : _q3);
    return { slot: s, pts, low: new Vector3(lowEnd[0], lowEnd[1], lowEnd[2]) };
  }

  /**
   * the shadow the Touch's cloud casts: the mantle's centre projected along the sun onto the ground, stretched along the
   * sun's bearing as the sun gets low; faint under a trusted god's light cloud, dark under a feared god's storm, gone
   * at night and on a world with no air (no cloud)
   */
  private cloudShadow(f: HandFrame, up: Vector3, gR: number, L: number, feared: number, grasp: number, air: boolean): void {
    if (!air) return;
    // a feared god brings its storm with it: the land round the Touch lies under a gloom — a broad soft shade, the
    // storm deck's over it (diffuse: the sky's light is cut as well as the sun's, so it sits under the Touch, not
    // thrown by the sun) — so feared reads at a glance from the god's height, where the column itself is small
    if (feared > 0.02) {
      const R = Math.min(L * 6.5, 520);
      const gl = decal(DECAL.shadow, [up.x * gR, up.y * gR, up.z * gR], R * 1.05 + 2);
      gl.ax = this.fwd.x; gl.ay = this.fwd.y; gl.az = this.fwd.z;
      // (deep enough to read through the tone curve and the eye's adaptation: at 0.3 it was a 10 % dimming on screen)
      gl.p0 = R; gl.p1 = R; gl.p2 = 0.9;
      gl.ca = 0.42 * feared * this.presence * (0.92 + 0.08 * Math.sin(this.u.uTouchT.value * 0.7));
      // (a deep slab: on a hillside the gloom lies over the slope above and below the Touch's foot)
      gl.q0 = Math.max(4, R * 0.45);
      f.decals.add(gl);
    }
    const sunD = f.shared.uSunDirBody?.value as Vector3 | undefined;
    if (!sunD) return;
    const el = sunD.dot(up);
    if (el < 0.04) return;
    const centre = _s.copy(this.grasp > 0.5 ? this.cradle : this.pos);
    // the mantle's middle sits about at the grip (open, a little above it)
    if (this.grasp <= 0.5) centre.addScaledVector(up, L * 0.25);
    const h = centre.length() - gR;
    // (never far from the Touch: a grazing sun would throw it across the land)
    const tk = Math.min(h / Math.max(0.25, el), h + 5 * L);
    const au = _x.copy(centre).addScaledVector(sunD, -tk).normalize();
    const g2 = groundHeight(f.pv.ground, au.x, au.y, au.z);
    const across = (grasp > 0.5 ? Math.max(this.cradleR, this.cradleH) * 1.15 : this.u.uRK.value * 1.4 + L * 0.35);
    const along = across / Math.max(0.4, el);
    const sh = decal(DECAL.shadow, [au.x * g2, au.y * g2, au.z * g2], along * 1.3 + 2);
    // the axis along the sun's bearing on the ground
    const sb = _y.copy(sunD).addScaledVector(up, -el);
    if (sb.lengthSq() < 1e-8) sb.copy(this.fwd);
    sb.normalize();
    sh.ax = sb.x; sh.ay = sb.y; sh.az = sb.z;
    sh.p0 = along; sh.p1 = across; sh.p2 = 0.85;
    const dens = Math.min(1, this.u.uTuftK.value);
    // (under a feared god it lies inside the gloom above: the two stacked must leave the land at least half its light —
    // stacked at full strength they left it under 30 %, a black pit in the trees)
    sh.ca = (0.12 + 0.45 * feared + 0.1 * grasp) * dens * this.presence * smooth(0.04, 0.2, el) * (1 - 0.6 * feared);
    sh.q0 = Math.max(2, L * 0.6);
    f.decals.add(sh);
  }

  /** the camera's altitude over the ground under it */
  private camAltitude(f: HandFrame): number {
    const c = f.camBody;
    const l = c.length() || 1;
    return l - groundHeight(f.pv.ground, c.x / l, c.y / l, c.z / l);
  }

  private place(f: HandFrame, hv: HandView | null, cursor: HandCursor | null, ui: UiHandPose, altCam: number, dt: number): void {
    const pv = f.pv;
    // (aiming a throw, the Touch holds still where the sim's hand is and the cursor picks the target)
    const aimingHere = f.aiming && !!hv && !!this.heldKind;
    let ux: number, uy: number, uz: number;
    if (cursor && !aimingHere) { ux = cursor.dir[0]; uy = cursor.dir[1]; uz = cursor.dir[2]; }
    else if (hv) { ux = hv.pos[0]; uy = hv.pos[1]; uz = hv.pos[2]; }
    else if (this.placed) { ux = this.pos.x; uy = this.pos.y; uz = this.pos.z; }
    else { ux = 0; uy = 1; uz = 0; }
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    let g = groundHeight(pv.ground, ux, uy, uz);
    const water = pv.fields.get('water');
    if (water) {
      const surf = pv.fields.get('surface');
      if (surf) g = Math.max(g, pv.params.radius + pv.grid.sample(surf, ux, uy, uz) + pv.grid.sample(water, ux, uy, uz));
    }
    // size: a share of the view at its distance (render/fx/present.ts), bounded by the camera's altitude (a cursor near
    // the horizon would otherwise make it a mountain)
    const cx = f.camBody.x - ux * g, cy = f.camBody.y - uy * g, cz = f.camBody.z - uz * g;
    const camD = Math.min(Math.sqrt(cx * cx + cy * cy + cz * cz), altCam * 3.5 + 40);
    const Lw = touchSize(camD);
    this.scale = this.placed ? this.scale + (Lw - this.scale) * Math.min(1, dt * 4) : Lw;
    const L = this.scale;
    // how high the grip hovers: high enough that what it holds (drawn at its presentation size) clears the ground
    let hover: number;
    if (this.heldKind) {
      const hs = this.heldKind === 'agent' ? 1.8 : this.heldKind === 'tree' ? Math.max(12, HELD_SHARE * L) : this.heldKind === 'building' ? Math.max(5, HELD_SHARE * L) : Math.max(1.5, HELD_SHARE * L);
      hover = Math.max(hv ? hv.alt : 0, L * 0.6 + hs * 0.6);
    } else if (ui === 'open') hover = L * 0.42;
    else if (ui === 'press') hover = L * 0.32;
    else if (ui === 'tool' || ui === 'aim') hover = L * 0.55;
    else if (!cursor && hv) hover = Math.max(L * 0.5, hv.alt);
    else hover = L * 0.5;
    const tx = ux * (g + hover), ty = uy * (g + hover), tz = uz * (g + hover);
    // a spring with a little lag; far jumps (a new place on the world, a camera cut) snap
    if (!this.placed || Math.hypot(tx - this.pos.x, ty - this.pos.y, tz - this.pos.z) > L * 25) {
      this.pos.set(tx, ty, tz); this.vel.set(0, 0, 0); this.placed = true; this.placedTop = false;
    } else if (dt > 0) {
      // (critically damped, solved exactly over the step: stable at any frame rate — stepped forward naively the
      // spring diverged below ~15 fps, and the Touch flew apart on a slow machine)
      const w = this.heldKind ? 8 : 11;
      const e = Math.exp(-w * dt);
      const sx = springStep(this.pos.x - tx, this.vel.x, w, dt, e), sy = springStep(this.pos.y - ty, this.vel.y, w, dt, e), sz = springStep(this.pos.z - tz, this.vel.z, w, dt, e);
      this.pos.set(tx + sx[0], ty + sy[0], tz + sz[0]);
      this.vel.set(sx[1], sy[1], sz[1]);
    }
    // the facing (for what it holds): away from the camera, level; aiming, toward the target
    const up = _y.copy(this.pos).normalize();
    const fw = _z.copy(f.camFwd).addScaledVector(up, -f.camFwd.dot(up));
    if (aimingHere && cursor) {
      const R = pv.params.radius;
      fw.set(cursor.dir[0] * R - this.pos.x, cursor.dir[1] * R - this.pos.y, cursor.dir[2] * R - this.pos.z);
      fw.addScaledVector(up, -fw.dot(up));
      if (fw.lengthSq() < 1) fw.copy(f.camFwd).addScaledVector(up, -f.camFwd.dot(up));
    }
    if (fw.lengthSq() < 1e-6) fw.copy(f.camUp).addScaledVector(up, -f.camUp.dot(up));
    fw.normalize();
    this.fwd.lerp(fw, this.placed ? Math.min(1, dt * 6) : 1).addScaledVector(up, -this.fwd.dot(up)).normalize();
  }

  /** a boulder, a tree, a hut or a bundle turning inside the cradle (people are drawn by the crowds at `pinch`) */
  private heldVisual(L: number, t: number): void {
    const k = this.heldKind;
    for (const [key, m] of this.heldMeshes) m.visible = key === k;
    if (!k) { this.heldDrawn = 0; return; }
    if (k === 'agent') { this.heldDrawn = 1.8; return; }
    if (k === 'animal') { this.heldDrawn = Math.max(1.4, HELD_SHARE * L); return; }
    // its true size (a boulder by its mass, a tree a dozen metres, a hut a few), drawn at least HELD_SHARE of the Touch
    const { size: sTrue, unit } = heldTrueSize(k, this.heldId);
    const drawn = presentScale(sTrue, L, -1);
    this.heldDrawn = drawn;
    let mesh = this.heldMeshes.get(k);
    if (!mesh && this.heldMat) {
      // an uprooted tree is the world's own broadleaf (gen/treegen.ts, its leaf sprays alpha-tested), a building the
      // hut its people build (gen/buildinggen.ts)
      if (k === 'tree' && !this.heldLeafMat) this.heldLeafMat = makeLeafPropMaterial(this.sharedU);
      mesh = new Mesh(heldPropGeometry(k), k === 'tree' ? this.heldLeafMat! : this.heldMat);
      mesh.matrixAutoUpdate = false;
      mesh.layers.enable(1);
      this.heldMeshes.set(k, mesh);
      this.heldGroup.add(mesh);
    }
    if (!mesh) return;
    mesh.visible = true;
    const up = _v.copy(this.grip).normalize();
    const s = drawn / unit;
    // it turns slowly in the wind, tilted, rocking with the swing
    const spin = this.spin * 0.18;
    const tilt = (k === 'tree' ? 0.35 : 0.22) + this.swing * 0.5 + Math.sin(t * 0.9) * 0.06;
    const ex = _x.crossVectors(up, this.fwd).normalize();
    const ez = _z.crossVectors(ex, up);
    const cs = Math.cos(spin), sn = Math.sin(spin);
    const rx = _s.copy(ex).multiplyScalar(cs).addScaledVector(ez, sn);
    const rz = _w.copy(ez).multiplyScalar(cs).addScaledVector(ex, -sn);
    // tilt about rx
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const by = _y.copy(up).multiplyScalar(ct).addScaledVector(rz, st);
    const bz = rz.multiplyScalar(ct).addScaledVector(up, -st);
    _m.makeBasis(rx, by, bz).scale(_x.set(s, s, s));
    // centred on the grip: a tree by the middle of its height, a hut by its middle, a rock and a bundle at their centre
    const lift = k === 'tree' ? -drawn * 0.5 : k === 'building' ? -drawn * 0.35 : 0;
    const e = _m.elements;
    _m.setPosition(this.grip.x + e[4] / s * lift, this.grip.y + e[5] / s * lift, this.grip.z + e[6] / s * lift);
    mesh.matrix.copy(_m);
    mesh.matrixWorldNeedsUpdate = true;
  }

  /** the sigil of a cast, traced in light in the air over the Touch, facing the camera */
  private glyphUpdate(f: HandFrame, L: number, age: number): void {
    const sg = this.sigil;
    if (!sg || age < 0 || age > 2.6) { this.glyph.visible = false; if (sg && age > 2.6) this.sigil = null; return; }
    this.glyph.visible = true;
    this.u.uTrace.value = smooth(0, 0.95, age);
    this.u.uGlyphK.value = smooth(0, 0.15, age) * (1 - smooth(1.9, 2.6, age));
    // (on the camera's own axes: it faces the eye from a street and from the god's height alike)
    const wup = _w.copy(this.grip).normalize();
    const up = _y.copy(f.camUp);
    const right = _x.copy(f.camFwd).cross(up);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0).cross(up);
    right.normalize();
    up.crossVectors(right, f.camFwd).normalize();
    const G = L * 0.75;
    const cx = this.grip.x + wup.x * L * 1.15, cy = this.grip.y + wup.y * L * 1.15, cz = this.grip.z + wup.z * L * 1.15;
    const pos = this.glyphGeo.getAttribute('position') as BufferAttribute;
    const cam = f.camBody;
    const wpx = f.fov && f.viewH ? Math.tan((f.fov * Math.PI) / 360) * 2 / f.viewH : 0.002;
    const n = TOUCH_N.glyph, st = sg.stroke, tw = this.u.uTouchT.value;
    for (let i = 0; i < n; i++) {
      const j0 = Math.max(0, i - 1), j1 = Math.min(n - 1, i + 1);
      const px = cx + (right.x * st[i * 2] + up.x * st[i * 2 + 1]) * G, py = cy + (right.y * st[i * 2] + up.y * st[i * 2 + 1]) * G, pz = cz + (right.z * st[i * 2] + up.z * st[i * 2 + 1]) * G;
      // the stroke's tangent on the glyph's plane, and the side across it (in that plane)
      const tx = (st[j1 * 2] - st[j0 * 2]), ty = (st[j1 * 2 + 1] - st[j0 * 2 + 1]);
      const tl = Math.hypot(tx, ty) || 1;
      const sx = -ty / tl, sy = tx / tl;
      const d = Math.hypot(cam.x - px, cam.y - py, cam.z - pz);
      // (the strip ±7 px at any distance: a one-pixel thread at its heart, its glow round it)
      const w = Math.max(L * 0.05, d * wpx * 7);
      // (the line wavers a little in its plane, as drawn light would: a ruler-straight stroke read as a rod)
      const wob = G * 0.02 * (0.6 * Math.sin(i * 0.43 + tw * 7.3) + 0.4 * Math.sin(i * 1.31 - tw * 11.7));
      const qx = px + (right.x * sx + up.x * sy) * wob, qy = py + (right.y * sx + up.y * sy) * wob, qz = pz + (right.z * sx + up.z * sy) * wob;
      const ox = (right.x * sx + up.x * sy) * w, oy = (right.y * sx + up.y * sy) * w, oz = (right.z * sx + up.z * sy) * w;
      pos.setXYZ(i * 2, qx + ox, qy + oy, qz + oz);
      pos.setXYZ(i * 2 + 1, qx - ox, qy - oy, qz - oz);
    }
    pos.needsUpdate = true;
  }

  /** a ribbon of light behind a fast motion (a throw) */
  private trailUpdate(f: HandFrame): void {
    const spd = this.vel.length() / this.scale;
    const now = f.fxTime;
    if (spd > 1.2 || this.trail.length) this.trail.push({ p: this.grip.clone(), t: now });
    while (this.trail.length && now - this.trail[0].t > 0.45) this.trail.shift();
    if (this.trail.length > TOUCH_N.trail) this.trail.splice(0, this.trail.length - TOUCH_N.trail);
    const want = clamp01((spd - 1.2) / 3);
    const k = this.u.uTrailK;
    k.value += (want - k.value) * Math.min(1, f.dt * 6);
    const n = this.trail.length;
    this.trailMesh.visible = n > 2 && k.value > 0.01;
    if (!this.trailMesh.visible) { if (k.value < 0.01) this.trail.length = 0; return; }
    const pos = this.trailGeo.getAttribute('position') as BufferAttribute;
    const age = this.trailGeo.getAttribute('aT') as BufferAttribute;
    const camB = f.camBody;
    const N = TOUCH_N.trail;
    for (let i = 0; i < N; i++) {
      const j = Math.min(n - 1, Math.max(0, n - N + i));
      const p = this.trail[j].p;
      const q = this.trail[Math.min(n - 1, j + 1)].p, o = this.trail[Math.max(0, j - 1)].p;
      const tx = q.x - o.x, ty = q.y - o.y, tz = q.z - o.z;
      const vx = camB.x - p.x, vy = camB.y - p.y, vz = camB.z - p.z;
      let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const a = clamp01((now - this.trail[j].t) / 0.45);
      const w = this.scale * 0.22 * (1 - a * 0.7);
      sx *= w / sl; sy *= w / sl; sz *= w / sl;
      pos.setXYZ(i * 2, p.x + sx, p.y + sy, p.z + sz);
      pos.setXYZ(i * 2 + 1, p.x - sx, p.y - sy, p.z - sz);
      age.setX(i * 2, a); age.setX(i * 2 + 1, a);
    }
    pos.needsUpdate = true; age.needsUpdate = true;
  }

  /** while carrying: the arc a throw toward the cursor would fly (the sim's aimed throw: 35°, the speed to reach it) */
  private arcUpdate(f: HandFrame, hv: HandView | null): void {
    const want = this.heldKind && f.cursor && f.cursor.planet === f.pv.id ? (f.aiming ? 1 : 0.35) : 0;
    const k = this.u.uArcAimK;
    k.value += (want - k.value) * Math.min(1, f.dt * 5);
    this.arcMesh.visible = k.value > 0.02 && !!f.cursor && !!hv;
    if (!this.arcMesh.visible || !f.cursor || !hv) return;
    const pv = f.pv;
    const g0 = pv.params.gravity || 9.8;
    const start = _x.copy(this.heldKind === 'agent' ? this.pinch : this.grip);
    const to = _w.set(f.cursor.dir[0], f.cursor.dir[1], f.cursor.dir[2]).normalize();
    const up0 = _y.copy(start).normalize();
    const range = Math.acos(Math.max(-1, Math.min(1, up0.dot(to)))) * pv.params.radius;
    const ang = (35 * Math.PI) / 180;
    const v = Math.min(2000, Math.sqrt(Math.max(1, (range * g0) / Math.sin(2 * ang))));
    const dir = to.addScaledVector(up0, -to.dot(up0)).normalize();
    const vel = _z.copy(dir).multiplyScalar(v * Math.cos(ang)).addScaledVector(up0, v * Math.sin(ang));
    // integrate on the sphere until it comes down
    const pos = this.arcGeo.getAttribute('position') as BufferAttribute;
    const at = this.arcGeo.getAttribute('aT') as BufferAttribute;
    const p = start;
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
      const l = p.length();
      if (l < groundHeight(pv.ground, p.x / l, p.y / l, p.z / l)) landed = i;
    }
    if (landed >= 0) for (let i = landed + 1; i < 96; i++) pos.setXYZ(i, p.x, p.y, p.z);
    pos.needsUpdate = true; at.needsUpdate = true;
    this.arcGeo.setDrawRange(0, landed >= 0 ? landed + 1 : 96);
    this.u.uSize.value = 6;
    // where it lands
    const li = landed >= 0 ? landed : 95;
    const d = decal(DECAL.reticle, [pos.getX(li), pos.getY(li), pos.getZ(li)], Math.max(4, this.scale * 0.5));
    d.cr = this.u.uCol.value.r; d.cg = this.u.uCol.value.g; d.cb = this.u.uCol.value.b; d.ca = k.value;
    d.p0 = Math.max(3, this.scale * 0.35); d.p1 = 0.6; d.p2 = 1.2; d.p3 = 0.3;
    f.decals.add(d);
  }

  get visible(): boolean { return this.visibleNow; }
  /** the Touch's light colour now (its regard): what it throws is streaked in it */
  get light(): Color { return this.u.uCol.value; }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    for (const o of [this.column, this.whorl, this.streaks, this.motes, this.heart, this.tufts]) o?.geometry.dispose();
    this.glyphGeo.dispose();
    this.trailGeo.dispose();
    this.crackGeo.dispose();
    this.arcGeo.dispose();
    // (the tree and hut geometries are the generators' cached ones: not ours to dispose)
    for (const [k, m] of this.heldMeshes) if (k !== 'tree' && k !== 'building') m.geometry.dispose();
    this.heldMat?.dispose();
    this.heldLeafMat?.dispose();
  }
}

/**
 * One step of a critically damped spring (angular frequency w) toward 0: offset x0 and velocity v0 after dt, exactly
 * (`e` = exp(−w·dt)): x = (x0 + (v0 + w·x0)·dt)·e, v = (v0 − w·(v0 + w·x0)·dt)·e. It never rings and never diverges,
 * whatever the step (from rest it closes without passing its target).
 */
export function springStep(x0: number, v0: number, w: number, dt: number, e = Math.exp(-w * dt)): [number, number] {
  const c = v0 + w * x0;
  return [(x0 + c * dt) * e, (v0 - w * c * dt) * e];
}

/** an orthonormal pair (e1, e2) round unit axis a */
function tangentFrame(a: Vector3, e1: Vector3, e2: Vector3): void {
  e1.set(0, 1, 0).cross(a);
  if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0).cross(a);
  e1.normalize();
  e2.crossVectors(a, e1);
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

/**
 * The mesh of a thing the god holds or throws, by kind: an uprooted broadleaf (unit height, draw it with
 * makeLeafPropMaterial), a thatched hut (metres), a boulder (radius ~1) or a bundle of goods. The tree and the hut are
 * the generators' cached meshes (do not dispose them).
 */
export function heldPropGeometry(kind: string): BufferGeometry {
  return kind === 'tree' ? treeGeometry('broadleaf', 1, 2) : kind === 'rock' ? boulderGeo(7) : kind === 'building' ? heldHutGeo() : bundleGeo();
}

/** the hut a people builds (thatch, round), whole, as torn from its footing */
function heldHutGeo(): BufferGeometry {
  return buildingMesh({ kind: 'hut', mat: materialAt(materialIndex('thatch')), style: 0, era: 1, mood: 0, w: 4.5, d: 4.5, lod: 1 }).geo;
}

/** a prop material for treegen meshes: bark and leaf cards from vertex colours, the sprays alpha-tested in the atlas */
export function makeLeafPropMaterial(shared: Record<string, IUniform>): MeshStandardMaterial {
  const tex = leafClusterTexture();
  const mat = makePropMaterial(shared, {
    key: 'held-tree', roughness: 0.85,
    extraUniforms: { tLeaf: { value: tex } },
    vertexPars: 'attribute vec2 aLeafUv;\nattribute float aCard;\nvarying vec2 vLeafUv;\nvarying float vCard;',
    vertexBegin: '  vLeafUv = aLeafUv; vCard = aCard;\n  vec3 transformed = position;',
    fragmentPars: 'uniform sampler2D tLeaf;\nvarying vec2 vLeafUv;\nvarying float vCard;',
    alphaTest: '  if (vCard > 0.75) { float la = texture(tLeaf, vLeafUv).a; if ((la - 0.45) / max(fwidth(la), 1e-4) + 0.5 < 0.5) discard; }',
    surface: '  if (vCard > 0.5) diffuseColor.rgb *= texture(tLeaf, vLeafUv).rgb * 1.7;',
  });
  mat.side = DoubleSide;
  (mat.userData.propDepth as ShaderMaterial).side = DoubleSide;
  return mat;
}

function bundleGeo(): BufferGeometry {
  const b = icosphere(1); b.scale(1, 0.75, 0.9);
  return vcol(b, (x, y) => (y > 0.6 ? [0.3, 0.2, 0.12] : [0.48, 0.38, 0.24]));
}

function icosphere(sub: number): BufferGeometry {
  const t = (1 + Math.sqrt(5)) / 2;
  const v: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; });
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
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(v.flat()), 3));
  g.setIndex(f.flat());
  g.computeVertexNormals();
  return g;
}
