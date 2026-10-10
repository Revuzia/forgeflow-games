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
// Flames are SHEETS, not candles: each particle is a broad, upright (axis = local up on screen; facing the camera when
// seen from above) patch of burning gas whose density is turbulent noise scrolling upward — a ragged base, a body
// that tears into several licking tongues at the top, holes where it thins — so neighbouring particles of one fire
// merge into a single wavering wall of flame. Heat colours it (deep red at the thin edges and tips, orange body,
// a gold — never white — core where it is dense and low) at the luminance of a real flame.
// Smoke is alpha-blended and LIT: billowing puffs (lumpy noise with a fake normal, so each has a sunlit side and a
// self-shadowed side), the planet's sun through the transmittance LUT (warm at sunset, none at night), sky ambient,
// and the orange glow of the fire under the lower part of the column; stacks over a burning house are thick, dark and
// near-opaque at their root. Embers are short glowing streaks along their flight. Soft particles: each fragment fades
// where it nears the opaque scene (linear depth copy), and is hidden behind it.
// Drawn after the atmosphere composite so smoke against the sky is never mistaken for stars (render() is called by the
// Renderer through the life layer); wind from the sim's wind field leans the plumes.

import {
  CustomBlending, Group, InstancedBufferAttribute, InstancedBufferGeometry, Float32BufferAttribute, Mesh,
  OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Vector2, type Camera, type IUniform, type Texture,
  type WebGLRenderer, type WebGLRenderTarget, type Scene,
} from 'three';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';

/**
 * The adapted exposure (post/pipeline.ts, last frame's 1×1 target), set by the renderer each frame: flame emission is
 * partly display-referred (radiance ∝ exposure^-0.85), because a night's auto-exposure (up to ~5×) took any flame
 * bright enough to read by day into AgX's path to white — pale cream curtains instead of saturated orange fire.
 */
export const FX_EXPOSURE: IUniform<Texture | null> = { value: null };

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
uniform vec3 uMoonE;
varying vec2 vCorner;
varying vec4 vColor;
varying float vViewZ;
varying float vSoft;
varying vec3 vLight;
varying float vKind;
varying vec2 vSunS;      // the sun's direction on screen (smoke shading), and the fire glow share of the light
varying vec3 vGlow;
varying vec3 vPosV;     // fire light: this fragment's point on the screen quad (view space)
varying vec3 vCenterV;  // fire light: the light's position (view space)

float h1(float a, float b) { return fract(sin(a * 127.1 + b * 311.7) * 43758.5453); }

void main() {
  float sys = iParam.x, size = iParam.y, power = iParam.z, seed = iParam.w;
  // every fourth particle of a blaze / wildfire emitter (from the second) is smoke torn off the tongues' tips: dense,
  // dark and low over the flames — flames without their own smoke read as flame stickers by day
  float i4 = mod(iIdx.x, 4.0);
  bool tipSmoke = sys > 4.5 && sys < 5.5 && i4 > 0.5 && i4 < 1.5;
  bool smokeSys = sys > 1.5 && sys < 2.5 || sys > 3.5 && sys < 4.5 || sys > 5.5 || tipSmoke;
  // each pass draws its own systems; the other's quads collapse
  if ((uPass > 0.5) != smokeSys) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  float life = sys < 0.5 ? 0.9 : sys < 1.5 ? 3.2 : sys < 2.5 ? 9.0 : sys < 3.5 ? 0.9 : sys < 4.5 ? 16.0 : sys < 5.5 ? 1.3 : 20.0;
  if (tipSmoke) life = 3.4;
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
  vGlow = vec3(0.0);
  vPosV = vec3(0.0);
  vCenterV = vec3(0.0);
  if (sys > 4.5 && sys < 5.5 && iIdx.x < 0.5) {
    // the first particle of every blaze / wildfire emitter is not a tongue but the fire's LIGHT on what stands round
    // it — ground, walls, trunks, people — as a deferred point light over the opaque scene (fragment shader): every
    // fire lights its surroundings, not only the few nearest the light budget gives a three.js PointLight
    p = iOrigin + up * size * 0.8;
    float fl = 0.78 + 0.22 * sin(uTime * 9.1 + seed * 40.0) * sin(uTime * 3.7 + seed * 17.0);
    col = vec4(power * fl, 0.0, 0.0, 1.0);
    vKind = 4.0;
  } else if (tipSmoke) {
    // tip smoke: born at the tongues' tips across the fire, rising and billowing out, leaning with the wind; black-brown
    // and nearly opaque young, greying and thinning as it spreads; its underside lit by the flames while it is low
    float st = h1(seed, 29.0);
    float vigour = st < 0.25 ? 0.5 : st < 0.8 ? 1.0 : 1.5;
    p += side * size * 0.75 * sqrt(r2) + up * size * (0.9 + 0.6 * r3) * vigour;
    p += up * (1.2 * tSec + 0.2 * tSec * tSec) * (0.8 + 0.4 * r1);
    p += iWind * tSec * 0.55;
    p += (e1 * sin(tSec * 0.9 + r1 * 10.0) + e2 * cos(tSec * 0.7 + r3 * 10.0)) * 0.4 * age * size;
    sz = size * (0.45 + 1.1 * age) * (0.8 + 0.4 * r1) * mix(0.7, 1.0, step(0.75, vigour));
    // (short-lived: a dense cap over the flames that thins out into the column — long-lived, the few puffs per fire
    // drifted off as lone dark balls)
    float a = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.3, 0.9, age));
    vec3 sc = mix(vec3(0.04, 0.036, 0.032), vec3(0.12, 0.112, 0.104), smoothstep(0.2, 1.0, age));
    col = vec4(sc, a * 0.8 * (0.6 + 0.4 * power));
    soft = 0.6 * sz;
    vKind = 2.0;
    vGlow = vec3(1.0, 0.36, 0.07) * 3.2 * (1.0 - smoothstep(0.0, 0.35, age)) * power;
  } else if (sys < 0.5 || sys > 4.5 && sys < 5.5) {
    // flames: TONGUES. Each particle is one tongue of burning gas standing on the fuel, swaying, its edges licked by
    // turbulence, its tip tearing away late in its short life; a fire is a crown of such tongues of very different
    // heights over a bed of low, broad flames (every third particle). (Broad sheets, all of a size and stacked on each
    // other, merged into cream haystacks; equal tongues side by side read as a picket fence of candles.)
    float wild = sys > 4.5 ? 1.0 : 0.0;
    float bed = step(0.6, fract(iIdx.x / 3.0 + 0.01));
    // fires differ: each wild emitter (a patch of burning ground, a torching tree, a stretch of roof) is dying back to a
    // low bed, burning, or roaring — a burning field of identical crowns read as a parade of campfires
    float st = h1(seed, 29.0);
    float vigour = wild > 0.5 ? (st < 0.25 ? 0.5 : st < 0.8 ? 1.0 : 1.5) : 1.0;
    float base = size * mix(0.45, 0.85, wild) * sqrt(r2) * mix(1.0, 1.2, step(1.2, vigour));
    p += side * base;
    // (a tongue stays on its fuel — a gentle lift only; rising the whole life stacked them into streaky columns)
    p += up * size * (0.04 + 0.22 * age * age) * (1.0 - bed);
    p += (e1 * sin(uTime * 2.1 + r1 * 30.0) + e2 * cos(uTime * 1.7 + r2 * 20.0)) * 0.05 * size;
    // flames lean and are torn downwind
    p += iWind * tSec * 0.22;
    float hT = size * mix(mix(0.9, 2.4, r3 * r3) * mix(1.0, 0.8, wild), mix(0.5, 0.8, r3), bed) * (0.75 + 0.25 * power) * vigour;
    // it shoots up in the first fifth of its life
    hT *= 0.45 + 0.55 * smoothstep(0.0, 0.2, age);
    float wT = hT * mix(mix(0.26, 0.62, r1 * r1), 0.9, bed);
    sz = hT;
    float a = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.72, 1.0, age));
    // the fragment shader shapes the tongue and colours it by heat: pass age, power and a seed; aspect and bed below
    col = vec4(age, power * mix(0.8, 1.0, step(0.75, vigour)), r1, a);
    soft = 0.35 * size;
    vKind = 1.0;
    vGlow = vec3(hT / max(wT, 1e-3), 0.0, bed);
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
    // a hearth's few embers die within a couple of metres of the fire (rising for their whole life they hung over a
    // night street as a field of orange stars); a blaze's fly high
    if (!spark && size < 0.95) a *= (1.0 - smoothstep(0.15, 0.4, age)) * step(0.5, r2);
    float tw = 0.6 + 0.4 * sin(uTime * 23.0 + r2 * 40.0);
    // (glowing specks read at night; in daylight they are barely visible)
    float dayK = smoothstep(-0.1, 0.15, dot(up, uSunDirBody));
    // cooling: yellow-orange when fresh, deep red as they die
    vec3 ec = mix(vec3(1.0, 0.5, 0.1), vec3(0.9, 0.16, 0.02), smoothstep(0.2, 0.9, age));
    col = vec4(ec * 14.0 * tw * power * mix(1.0, 0.25, dayK), a);
    soft = 0.05;
    vKind = 3.0;
    // flight direction (for the streak): the velocity of the path above, in view space
    vec3 vel = v * (spark ? 0.7 : 1.0) * sp * 0.4 - up * (spark ? 9.8 * tSec : 0.0) + iWind * 0.7;
    vec3 velV = (modelViewMatrix * vec4(vel, 0.0)).xyz;
    vGlow = vec3(length(velV.xy) > 1e-4 ? normalize(velV.xy) : vec2(0.0, 1.0), clamp(length(velV.xy) * 0.06, 0.0, 1.0));
  } else {
    // smoke: chimneys a thin wisp that rises and slows; a fire's column (stack over a burning house, wildfire) keeps
    // climbing on its heat — a tight column of puffs that widens with height and leans with the wind, not a veil
    bool stack = sys > 3.5 && sys < 4.5, wild = sys > 5.5;
    bool column = stack || wild;
    float k = column ? 0.6 : 1.0;
    float rise = column
      ? (stack ? 2.6 : 3.2) * tSec * (1.0 - 0.3 * age) * (0.85 + 0.3 * r3) * (0.7 + 0.3 * min(size, 4.0) / 4.0)
      : (1.0 - exp(-tSec * 0.35)) / 0.35 * (0.8 + 0.4 * r3) * (0.6 + 0.4 * size);
    p += up * (rise + size * 0.3);
    // the plume bends over downwind as it rises (the wind grows with height)
    p += iWind * tSec * (column ? 0.35 + 0.45 * age : 0.55 + 0.25 * r2);
    p += side * (0.15 + 0.6 * age) * size * k * r2;
    p += (e1 * sin(tSec * 0.7 + r1 * 10.0) + e2 * cos(tSec * 0.5 + r3 * 10.0)) * 0.3 * age * (column ? 2.0 : k);
    sz = (stack ? 0.9 : wild ? 1.0 : 0.35) * size + (stack ? 7.0 : wild ? 10.0 : 2.6) * age * (0.7 + 0.6 * r1) * (0.5 + 0.5 * power);
    // a fire's column is dense at its root and stays thick a long way up before it thins out
    float a = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(stack || wild ? 0.55 : 0.45, 1.0, age));
    // (a hearth's chimney: a thin blue-grey wisp, not cotton-wool puffs over every roof)
    float dens = stack ? 0.92 : wild ? 0.85 : 0.15;
    // burning thatch and timber: dark brown-grey to near black, greyer and paler as it cools and spreads
    vec3 sc = stack ? vec3(0.045, 0.041, 0.038) : wild ? vec3(0.06, 0.055, 0.05) : vec3(0.34, 0.35, 0.38);
    // (a grass fire's smoke greys as it spreads, but not to white: at 0.17 its old puffs read as steam by day)
    sc = mix(sc, stack ? vec3(0.17, 0.16, 0.15) : wild ? vec3(0.13, 0.122, 0.112) : sc * 0.6, (stack || wild) ? smoothstep(0.3, 1.0, age) * 0.65 : r2 * 0.5);
    col = vec4(sc, a * dens * (0.6 + 0.4 * power));
    soft = 0.6 * sz;
    // fire glow lights the column from below: strong at its root, gone some tens of metres up
    vKind = 2.0;
    // (a hearth's chimney glows only at its mouth: lit for its whole first half the wisps floated as orange-brown
    // puffs high over a night village)
    // (lit for the first ~40 % of its life at 5× a column glowed tan-cream for tens of metres: glowing cotton, not smoke)
    vGlow = vec3(1.0, 0.36, 0.07) * 3.6 * (1.0 - smoothstep(0.0, column ? 0.24 : 0.08, age)) * (column ? 1.0 : 0.15) * power;
  }
  // lighting of smoke: sun through the air at this height + sky; computed per particle (cheap, smooth)
  vSunS = vec2(0.0, 1.0);
  if (smokeSys) {
    float rP = length(p);
    vec3 upP = p / rP;
    vec3 sun = uSunE * sunTransmittance(rP, dot(upP, uSunDirBody));
    vec3 sky = skyIrradiance(upP, upP, uSunDirBody);
    vLight += sun * 0.24 + sky * 0.3 + vec3(0.002, 0.003, 0.005);
    vec3 sV = (modelViewMatrix * vec4(uSunDirBody, 0.0)).xyz;
    vSunS = length(sV.xy) > 1e-4 ? normalize(sV.xy) * (0.4 + 0.6 * length(sV.xy)) : vec2(0.0);
    // the moonlit night: a little of the night ambient so a column reads against the stars
    vLight += uMoonE * 0.15;
  } else { vLight = vec3(1.0); }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  if (vKind > 0.5 && vKind < 1.5) {
    // flames: an upright tongue (its axis the local up as seen on screen), the base at the particle. Seen from above
    // the local up points at the camera and its screen image shrinks to a sliver: the tongue then turns to face the
    // camera (its axis eases to screen-up) and is shortened — a fire seen from the god camera is still a fire.
    vec3 upV = normalize((modelViewMatrix * vec4(up, 0.0)).xyz);
    vec2 ax0 = length(upV.xy) > 1e-3 ? normalize(upV.xy) : vec2(0.0, 1.0);
    float face = smoothstep(0.6, 0.92, abs(upV.z));
    vec2 ax = normalize(mix(ax0, vec2(0.0, 1.0), face) + vec2(1e-4, 0.0));
    vec2 rt = vec2(ax.y, -ax.x);
    float hT = sz * mix(1.0, 0.6, face), wT = sz / vGlow.x;
    // daylight on the fire (the fragment shader makes a sunlit flame paler and more see-through)
    vSunS = vec2(smoothstep(-0.1, 0.2, dot(up, uSunDirBody)), 0.0);
    vGlow = vec3(hT / wT, face, vGlow.z);
    // the quad: its foot a little below the particle (in the fuel), the tongue rising from it
    mv.xy += rt * corner.x * wT * 0.5 + ax * (corner.y * 0.5 + 0.45) * hT;
  } else if (vKind > 3.5) {
    // a screen quad over the light's reach, pulled toward the camera so it also covers what stands in front of the
    // fire (and over the whole view once the camera is inside the reach)
    float reach = clamp(8.0 + 4.0 * sz, 14.0, 28.0);
    float z = -mv.z;
    vCenterV = mv.xyz;
    if (z - reach < 1.0) {
      mv = vec4(0.0, 0.0, -1.0, 1.0);
      mv.xy += corner * 4.0;
    } else {
      float zq = z - reach;
      mv.xyz *= zq / z;
      mv.xy += corner * reach * 1.25;
    }
    vPosV = mv.xyz;
    vGlow = vec3(reach, 0.0, 0.0);
  } else if (vKind > 2.5) {
    // embers: a short streak along the flight on screen
    vec2 dir = vGlow.xy;
    vec2 nrm = vec2(dir.y, -dir.x);
    mv.xy += nrm * corner.x * sz + dir * corner.y * sz * (1.0 + 4.0 * vGlow.z);
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
uniform sampler2D tExposure;
uniform float uHasExposure;
uniform float uFireLight;
uniform vec2 uResolution;
uniform float uPass;
uniform float uTime;
varying vec2 vCorner;
varying vec4 vColor;
varying float vViewZ;
varying float vSoft;
varying vec3 vLight;
varying float vKind;
varying vec2 vSunS;
varying vec3 vGlow;
varying vec3 vPosV;     // fire light: this fragment's point on the screen quad (view space)
varying vec3 vCenterV;  // fire light: the light's position (view space)
void main() {
#include <logdepthbuf_fragment>
  float sceneZ = texture(tSceneDepth, gl_FragCoord.xy / uResolution).r;
  if (vKind > 3.5) {
    // the fire's light on the opaque surface seen through this pixel: its view position from the linear depth along
    // this pixel's ray, its normal from the screen derivatives of that position (facing the camera), Lambert, the
    // inverse square of ~0.45 of render/life nightlights' burning roof (55 cd; the nearest fires get those point lights
    // too) faded out over the reach, and a typical albedo (0.2) — physical units, so the night's exposure makes it the
    // light of the scene and the day's sun drowns it, as it should
    if (sceneZ > 1e6) discard;
    vec3 S = vPosV * (sceneZ / max(-vPosV.z, 1e-4));
    vec3 Lv = vCenterV - S;
    float d = length(Lv);
    float reach = vGlow.x;
    if (d > reach) discard;
    vec3 N = cross(dFdx(S), dFdy(S));
    float nl = length(N);
    N = nl > 1e-12 ? N / nl : vec3(0.0, 0.0, 1.0);
    if (dot(N, S) > 0.0) N = -N;
    // (a little wrap: derivative normals are noisy along silhouettes)
    float lam = 0.12 + 0.88 * clamp(dot(N, Lv / max(d, 1e-3)), 0.0, 1.0);
    // (windowed to zero with zero slope at the reach: a cut-off ring drew every pool as a spotlight ellipse)
    float win = 1.0 - (d * d) / (reach * reach);
    // (not on the burning thing itself — its charred roof and walls, a few metres from the flames: with an assumed
    // albedo they came out cream-lit; they have their own embers, and the budgeted point lights see their true colour)
    float E = 24.0 * vColor.x / (d * d + 1.5) * win * win * smoothstep(2.0, 6.0, d);
    gl_FragColor = vec4(vec3(1.0, 0.36, 0.07) * E * lam * (0.2 / 3.14159) * uFireLight, 0.0);
    return;
  }
  float r = length(vCorner);
  if (r > 1.0 && (vKind < 0.5 || vKind > 1.5)) discard;
  if (vViewZ > sceneZ + 0.05) discard;
  float fade = clamp((sceneZ - vViewZ) / max(0.05, vSoft), 0.0, 1.0);
  // fade near the camera so a puff never fills the screen with a flat card
  fade *= smoothstep(0.3, 2.0, vViewZ);
  if (vKind > 0.5 && vKind < 1.5) {
    // a flame tongue: a rounded foot widest at a fifth of its height, drawn up to a point; a slow sideways wave travels
    // up it (it sways); turbulence scrolling upward licks into its outline, more toward the tip; late in its life the
    // tip tears off as a separate lick. Colour by heat: a yellow core low in the middle, an orange body, deep red at the
    // rim and the tip. The outline is crisp (one pixel), the inside nearly solid: flames are bright, defined shapes.
    float y = vCorner.y * 0.5 + 0.5;
    float asp = max(vGlow.x, 0.5);
    float bed = vGlow.z;
    float sd = vColor.z * 17.0;
    float age = vColor.x;
    float tt = uTime;
    // the finer octave fades once its features shrink under a few pixels (sub-pixel noise drew fur)
    float dq = max(fwidth(vCorner.x), fwidth(vCorner.y) * asp);
    float k2 = 1.0 - smoothstep(0.12, 0.35, dq * 3.0);
    float sway = (snoise(vec3(y * asp * 0.55 - tt * 1.7, sd, 0.3)) * 0.42
      + snoise(vec3(y * asp * 1.3 - tt * 3.3, sd + 4.0, 1.7)) * 0.16 * k2) * y * (1.0 - 0.6 * bed);
    float xs = vCorner.x - sway;
    float yb = 0.2;
    float prof = y < yb ? sqrt(max(0.0, 1.0 - pow((yb - y) / (yb + 0.05), 2.0)))
                        : pow(max(0.0, 1.0 - (y - yb) / (1.0 - yb)), mix(0.8, 1.15, bed));
    float en = snoise(vec3(xs * 1.5, y * asp * 1.2 - tt * 3.4, sd + 2.0)) * (0.12 + 0.45 * y)
      + snoise(vec3(xs * 3.8, y * asp * 3.0 - tt * 6.0, sd + 9.0)) * 0.18 * y * k2;
    float edge = prof * (0.9 + en) - abs(xs);
    // a broad tongue forks: the upper part splits along a crease that wanders with the flow (two or three licks)
    float fork = 1.0 - abs(snoise(vec3(xs * 1.3 / max(prof, 0.3), y * asp * 0.8 - tt * 2.2, sd + 13.0)));
    edge -= pow(fork, 6.0) * smoothstep(0.3, 0.75, y) * prof * mix(0.9, 0.2, bed) * smoothstep(3.4, 1.9, asp);
    // the tip tears away: a gap opens across the tongue, moving down from the tip as it dies
    float tear = smoothstep(0.5, 0.92, age) * (1.0 - bed);
    float gapY = mix(0.92, 0.58, tear) + 0.06 * snoise(vec3(xs * 2.0, tt * 1.5, sd));
    edge -= tear * 0.45 * (1.0 - smoothstep(0.0, 0.07, abs(y - gapY)));
    float aw = clamp(fwidth(edge), 0.012, 0.25);
    // burning gas has no hard skin: the outline is soft — a pixel at the foot, ~a tenth of the tongue's width at the
    // tip where the gas thins and tears (one-pixel outlines all the way up drew flat, cartoon flame stickers)
    float dens = smoothstep(-aw, aw + prof * (0.04 + 0.22 * y * y), edge);
    // the upper part is thin, translucent gas
    dens *= 1.0 - 0.45 * smoothstep(0.45, 1.0, y) * (1.0 - bed);
    // heat: hottest low in the middle, cooling toward the rim and the tip and as the tongue ages
    float inner = clamp(edge / max(prof, 0.08), 0.0, 1.0);
    float heat = clamp(inner * 1.5 * (1.0 - 0.7 * y) + 0.12 * (1.0 - y), 0.0, 1.0) * (1.0 - 0.3 * age);
    // streaks of hotter and cooler gas rising through it (a flat-filled tongue read as a sticker)
    heat *= 0.8 + 0.35 * snoise(vec3(xs * 2.6, y * asp * 1.6 - tt * 4.2, sd + 21.0)) * k2 + 0.1;
    heat = clamp(heat, 0.0, 1.0);
    vec3 c = mix(vec3(0.6, 0.045, 0.005), vec3(1.0, 0.27, 0.025), smoothstep(0.0, 0.45, heat));
    c = mix(c, vec3(1.0, 0.55, 0.1), smoothstep(0.55, 1.0, heat));
    // by day a flame is pale, yellow-white at its hot core and see-through at its thin edges: the night's opaque
    // saturated orange read as cut-out flame stickers against the sunlit ground
    float dayF = vSunS.x;
    c = mix(c, mix(c, vec3(1.0, 0.72, 0.32), smoothstep(0.35, 1.0, heat)), dayF * 0.75);
    // display-referred (FX_EXPOSURE): a flame lands at about the same brightness on screen by day and by night — a
    // bright, saturated orange with a yellow core. The tongues are nearly opaque (alpha below), so a crowd of them
    // stays a fire's own colour instead of summing to a white-cream haystack
    float ex = uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 0.02) : 1.0;
    float level = mix(0.34, 1.05, heat * heat) * mix(0.6, 1.0, vColor.y);
    float I = level / ex;
    // seen from straight above a tongue is a stain of flame on the roof: dimmer, its light is the pool round it
    I *= mix(1.0, 0.55, vGlow.y);
    float a = vColor.a * dens * fade;
    // luminous gas, not a cut-out: a faint glow just outside the outline (added light, no cover)
    float halo = (1.0 - dens) * smoothstep(-0.22 * prof - aw, 0.0, edge) * 0.35 * vColor.a * fade;
    float cover = mix(mix(0.6, 0.92, smoothstep(0.0, 0.5, inner)), mix(0.25, 0.8, smoothstep(0.0, 0.6, inner)), dayF);
    gl_FragColor = vec4((c * a + vec3(1.0, 0.3, 0.04) * halo * 0.6) * I, a * cover);
  } else if (uPass < 0.5) {
    // embers and sparks: hot streaks, brightest at the head
    float core = pow(1.0 - r, 1.6) * (0.6 + 0.4 * smoothstep(-1.0, 1.0, vCorner.y));
    float a = vColor.a * core * fade;
    gl_FragColor = vec4(vColor.rgb * a, 0.0);
  } else {
    // smoke: a billowing puff — lumpy cauliflower outline (two octaves), a fake normal from the bulge and the noise,
    // so the sunward side is lit and the far side self-shadowed; the fire glows into the underside of a young column
    float sd = vColor.r * 40.0 + vColor.g * 13.0;
    float n1 = snoise(vec3(vCorner * 1.7, sd));
    float n2 = snoise(vec3(vCorner * 4.1 + 3.7, sd + uTime * 0.05));
    float rr = r * (1.0 - 0.22 * n1 - 0.08 * n2);
    float puff = smoothstep(1.0, 0.35, rr);
    puff *= 0.75 + 0.25 * n2;
    vec3 nrm = normalize(vec3(vCorner * 0.9 + vec2(n1, n2) * 0.25, sqrt(max(0.05, 1.0 - min(r * r, 1.0)))));
    float sunSide = dot(nrm.xy, vSunS);
    float lit = clamp(0.55 + 0.55 * sunSide + 0.15 * nrm.z, 0.15, 1.2);
    // the fire's glow comes from below: the lower half of the puff
    float under = smoothstep(0.4, -0.8, nrm.y);
    float a = vColor.a * puff * fade;
    vec3 c = vColor.rgb * (vLight * lit + vGlow * (0.35 + 0.65 * under));
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
      tExposure: FX_EXPOSURE, uHasExposure: { value: 0 }, uFireLight: { value: 1 },
    };
    const mk = (pass: number) => {
      const u: Record<string, IUniform> = { ...this.uniforms, uPass: { value: pass } };
      for (const k of Object.keys(shared)) if (!(k in u)) u[k] = shared[k];
      // premultiplied output composited over (One, OneMinusSrcAlpha): embers and sparks write alpha 0 (purely additive),
      // flames a partial alpha (emissive gas that also hides some of what is behind it), smoke its full coverage
      return new ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: u, transparent: true, depthWrite: false, depthTest: false,
        blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
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
    this.uniforms.uHasExposure.value = FX_EXPOSURE.value ? 1 : 0;
    for (const m of [this.matAdd, this.matSmoke]) {
      m.uniforms.uTime = this.uniforms.uTime; m.uniforms.tSceneDepth = this.uniforms.tSceneDepth; m.uniforms.uResolution = this.uniforms.uResolution;
      m.uniforms.tExposure = FX_EXPOSURE; m.uniforms.uHasExposure = this.uniforms.uHasExposure;
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
