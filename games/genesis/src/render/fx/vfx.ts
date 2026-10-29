// GENESIS — the god layer's GPU particles (CONTRACT.md §15.7 "GPU particles: stateless, soft, lit by the sun,
// emissive where hot"; the extension of render/fx/particles.ts for disasters, weather and miracles).
//
// Stateless like particles.ts — every particle's place, size, colour and opacity are a function of the FX time, its
// emitter and its index (with a hash per life cycle) — but POOLED and LIVE:
//   * the pool is a fixed instance buffer of blocks of 64 particles; an emitter takes some blocks, a block table
//     texture maps each block to its emitter's row (no geometry is rebuilt when emitters come and go);
//   * every emitter's state lives in a float texture (5 texels a row: origin + system, axis + size, power / seed /
//     birth / cycle, four system parameters + the time births stop, colour + mode), uploaded each frame, so an emitter
//     can follow a moving meteor or tornado and fade its power without touching the pool;
//   * continuous emitters recycle their particles over a cycle; BURSTS fire every particle once; when an emitter
//     stops (tEnd) no particle is born after it and the live ones play out — nothing pops.
// Two passes over the composited image (after the atmosphere): lit smoke / dust / ash / steam / spray / fog / swarm /
// rain / bounty (premultiplied over, lit by the planet's sun through the transmittance LUT and its sky, with a glow
// from below where something burns), and the emissive pass (embers, lava, sparks, plasma, motes, flashes). Soft depth
// test against the scene's linear depth. Precipitation splashes are placed on whatever surface is under a random
// screen point (the depth buffer read in the vertex shader), so they land on roofs and streets alike.

import {
  CustomBlending, DataTexture, FloatType, Group, InstancedBufferAttribute, InstancedBufferGeometry, Float32BufferAttribute, Matrix4, Mesh,
  NearestFilter, OneFactor, OneMinusSrcAlphaFactor, RGBAFormat, ShaderMaterial, Vector3, type IUniform,
} from 'three';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { CLOUD_DENSITY_GLSL } from '../sky/clouds.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { FX_DEPTH_GLSL, FX_LAYER } from './fxcommon.ts';

/** particle systems (vertex shader branches). 0–19 and 40–59: the lit pass; 20–39: the emissive pass */
/** the display luminance additive emission (sparks, embers, lava, flashes) rolls off toward (punch P03) */
export const EMIT_CAP = 3;

export const SYS = {
  dust: 0, plume: 1, ash: 2, pyro: 3, steam: 4, spray: 5, skirt: 6, miasma: 7, smoke: 8, sand: 9, fog: 10, swarm: 11,
  rainCol: 12, cloud: 13, leaves: 14, bounty: 15, precip: 16, splash: 17, trail: 18, snowfall: 19,
  embers: 20, lava: 21, sparks: 22, plasma: 23, motes: 24, shower: 25, flash: 26, sparkle: 27, glints: 28,
  /** the glowing heads of things thrown on ballistic arcs (impact debris, lava bombs): cooling, short streaks */
  arcGlow: 29,
  /** a rain or hail shaft seen from afar: tall soft grey curtains under a storm cell */
  shaft: 40,
  /** an impact's fireball: puffs swelling and rising, white-hot cooling through orange to black smoke */
  fireball: 41,
  /** an impact's shock ring: an opaque wall of dust rolling outward along the ground, slowing, billowing up */
  shockRing: 42,
  /** an impact's ejecta curtain: an inverted cone of rock and dust thrown up and out from the rim */
  ejecta: 43,
  /** smoke left along ballistic arcs (the trails of impact debris, of lava bombs) — p2 = the arcs' seed, shared with arcGlow */
  arcSmoke: 44,
  /** a low haze hugging the ground (plague miasma in the streets) */
  groundHaze: 46,
  /** crows circling over a place of death */
  crows: 47,
  /** a swarm's body: dark puffs flowing with internal waves (its specks are `swarm`) */
  swarmMass: 48,
  /** blowing snow streaming along the ground round the camera (a blizzard's ground sheet) */
  drift: 49,
} as const;

export interface EmitterDef {
  sys: number;
  x: number; y: number; z: number;
  /** a direction for the system (velocity, wind, the front's heading); body frame */
  ax?: number; ay?: number; az?: number;
  /** size (m), power 0..1+ (opacity / brightness), cycle or burst life (s), particles */
  size: number;
  power?: number;
  life: number;
  count: number;
  p0?: number; p1?: number; p2?: number;
  /** colour (linear) */
  r?: number; g?: number; b?: number;
  /** a burst fires once; else particles recycle until the emitter stops */
  burst?: boolean;
  /** FX time of birth (default now) and how long it emits (default for ever) */
  t0?: number;
  duration?: number;
  /**
   * seconds of history a continuous emitter starts with (rain the camera walks into, an ash column already standing
   * when the view arrives): it is born that much earlier, so it is full at once — even on a paused world, whose FX
   * clock does not move. Bursts ignore it.
   */
  prewarm?: number;
}

const BLOCK = 64;
const ROWS = 1024;          // emitter rows
const TEX_W = 5;            // texels per emitter row

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${ATMO_PARS}
${SKY_LOOKUP}
uniform sampler2D tEmit;
uniform sampler2D tBlocks;
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
uniform mat4 uInvProj;
uniform mat3 uViewToBody;
uniform vec3 uCamBody;
uniform float uFxTime;
uniform float uPass;
uniform vec3 uSunDirBody;
uniform vec3 uMoonE;
${CLOUD_DENSITY_GLSL}
uniform samplerCube uCloudCov;
uniform vec2 uCloudShell;
uniform float uCloudOn;
attribute vec2 corner;
attribute vec2 iBlock;     // block, index in the block
varying vec2 vCorner;
varying vec4 vColor;
varying float vViewZ;
varying float vSoft;
varying vec3 vLight;
varying float vKind;
varying vec2 vDir;
varying vec3 vGlow;
varying float vSeed;
varying vec3 vAirT;
varying vec3 vAirIn;
varying vec3 vSkyL;

float h1(float a, float b) { return fract(sin(a * 127.1 + b * 311.7) * 43758.5453); }
vec4 emit(float row, float k) { return texelFetch(tEmit, ivec2(int(k), int(row)), 0); }
void hideMe() { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); vColor = vec4(0.0); }
// the cloud deck's shade on a particle under it: the sun through the deck (as the ground gets it), and the dimmer sky
// under an overcast (a tornado's dust skirt, a blizzard's flakes, the smoke under a storm are not sunlit)
vec2 fxCloudShade(vec3 P, float rP) {
  if (uCloudOn < 0.5 || rP > uCloudShell.y) return vec2(1.0);
  float mid = 0.5 * (uCloudShell.x + uCloudShell.y);
  vec2 hit = raySphere(P, uSunDirBody, mid);
  float sun = 1.0;
  if (hit.y > 0.0) {
    vec3 q = P + uSunDirBody * hit.y;
    vec2 cs = textureLod(uCloudCov, normalize(q), 0.0).rg;
    cl_fp = 0.0;
    sun = max(exp(-cloudDensityAt(q, 0.35, cs.x, cs.y, false) * (uCloudShell.y - uCloudShell.x) * 0.4), 0.3);
  }
  float over = clamp(textureLod(uCloudCov, P / rP, 0.0).r, 0.0, 1.0);
  float sky = mix(1.0, 0.6, smoothstep(0.4, 0.95, over));
  // (inside the deck, half way to its top, the shade lifts)
  float k = smoothstep(uCloudShell.x, uCloudShell.y, rP);
  return mix(vec2(sun, sky), vec2(1.0), k);
}

void main() {
  vec4 blk = texelFetch(tBlocks, ivec2(int(mod(iBlock.x, 64.0)), int(iBlock.x / 64.0)), 0);
  if (blk.x < 0.0) { hideMe(); return; }
  float row = blk.x;
  vec4 E0 = emit(row, 0.0), E1 = emit(row, 1.0), E2 = emit(row, 2.0), E3 = emit(row, 3.0), E4 = emit(row, 4.0);
  float sys = E0.w;
  bool litSys = sys < 19.5 || (sys > 39.5 && sys < 59.5);
  if ((uPass > 0.5) != litSys) { hideMe(); return; }
  float count = blk.z * ${BLOCK}.0;
  float idx = blk.y * ${BLOCK}.0 + iBlock.y;
  vec3 O = E0.xyz;
  vec3 axis = E1.xyz;
  float size = E1.w;
  float power = E2.x, seed = E2.y, t0 = E2.z, life = max(E2.w, 1e-3);
  float p0 = E3.x, p1 = E3.y, p2 = E3.z, tEnd = E3.w;
  vec3 col = E4.rgb;
  bool burst = E4.w > 0.5;
  float now = uFxTime;
  // ── this particle's age (0..1) and life cycle ──
  float age, cycle, born;
  bool arcSys = sys > 28.5 && sys < 29.5 || sys > 43.5 && sys < 44.5;
  if (arcSys) {
    // (arc systems keep their own clocks along each arc, below)
    age = clamp((now - t0) / life, 0.0, 1.0); cycle = 0.0; born = t0;
    if (now < t0 || now - t0 > life * 1.3) { hideMe(); return; }
  } else if (burst) {
    float stagger = h1(seed + idx * 0.37, 1.7) * min(0.25, life * 0.15) * step(0.5, mod(sys, 2.0) + 0.0);
    float lk = life * (0.7 + 0.6 * h1(seed * 3.1 + idx, 2.3));
    age = (now - t0 - stagger) / lk;
    cycle = 0.0;
    born = t0 + stagger;
    if (age < 0.0 || age > 1.0) { hideMe(); return; }
  } else {
    float lk = life * (0.85 + 0.3 * h1(seed, 3.0));
    float u = (now - t0) / lk + idx / max(1.0, count);
    cycle = floor(u);
    age = fract(u);
    born = now - age * lk;
    // never shown before the emitter began, nor born after it stopped
    if (born < t0 - 1e-3 || born > tEnd) { hideMe(); return; }
  }
  float r1 = h1(seed * 13.0 + idx, cycle), r2 = h1(seed * 7.0 + idx * 1.3, cycle + 3.1), r3 = h1(seed * 5.0 + idx * 0.7, cycle + 7.7), r4 = h1(seed * 11.0 + idx * 2.1, cycle + 1.9);
  vec3 up = normalize(O);
  vec3 e1 = normalize(cross(up, abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(up, e1);
  float ang = r1 * 6.2831853;
  vec3 side = e1 * cos(ang) + e2 * sin(ang);
  float tS = age * life;
  vec3 p = O;
  float sz = size;
  float a = 1.0;
  float kind = 0.0;   // 0 lit puff, 1 emissive streak, 2 emissive blob, 3 flash, 4 dark speck, 5 rain streak, 6 leaf, 7 lit blob
  vec3 vel = vec3(0.0);
  vec3 glow = vec3(0.0);
  float soft = 0.5 * size;
  vec3 c = col;
  float lift = 0.0;
  float selfSh = 0.0;      // a column's own shadow on its far side from the sun (0 none … 1 full)
  float stretchCap = 11.0; // the longest a streak is smeared along its motion (× its width)
  float squash = 1.0;      // a puff flattened toward the ground (hazes)
  int S = int(sys + 0.5);
  if (S == 18) {
    // a smoke trail left along a known path (a meteor's): from the head (p0 along the axis from O) back up to where
    // it began (p1); the puff at path coordinate s was shed (s − p0) / speed seconds ago (p2 = speed, m/s)
    float rs = h1(seed + idx * 1.37, 0.0), rt = h1(seed * 3.3 + idx * 0.71, 0.0);
    float s = mix(p0, p1, rs * rs);
    float since = (s - p0) / max(p2, 1.0);
    float at = since / life;
    if (at > 1.0) { hideMe(); return; }
    vec3 sd = e1 * cos(rt * 6.2831853) + e2 * sin(rt * 6.2831853);
    p = O + axis * s + sd * size * (0.2 + 2.2 * sqrt(at)) * h1(seed + idx, 4.4) + up * at * size * 0.6;
    sz = size * (0.35 + 2.2 * sqrt(at)) * (0.7 + 0.6 * h1(seed + idx, 5.5));
    a = (1.0 - smoothstep(0.35, 1.0, at)) * smoothstep(0.0, 0.03, since) * 0.75;
    soft = 0.6 * sz;
    glow = vec3(1.0, 0.45, 0.15) * 6.0 * (1.0 - smoothstep(0.0, 0.02, since / max(life, 1e-3)));
  } else if (S == 0) {
    // dust: thrown out low and wide, billowing up a little, settling
    float out_ = (1.0 - exp(-tS * 2.2)) / 2.2;
    p += side * (sqrt(r2) * p0 * 0.3 + out_ * (p1 + 0.5) * (0.5 + r3)) + up * (out_ * (0.6 + r4) * p1 * 0.4 + size * 0.3);
    p += axis * tS * 0.6;
    sz = size * (0.5 + 1.4 * sqrt(age)) * (0.7 + 0.6 * r1);
    a = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.35, 1.0, age)) * 0.75;
    soft = 0.6 * sz;
  } else if (S == 1) {
    // an impact's plume: a column rising on its heat, rolling into a mushroom cap; the stem thins
    float H = p0, Rr = p1;
    float hgt = H * (1.0 - exp(-tS * 0.35 / max(0.2, life * 0.06))) * (0.3 + 0.7 * r2);
    float capK = smoothstep(0.55, 0.95, hgt / max(H, 1.0));
    float rad = mix(Rr * 0.18 * sqrt(r3), Rr * (0.35 + 0.65 * sqrt(r3)), capK) * (0.5 + 0.5 * smoothstep(0.0, 0.3, age));
    p += up * hgt + side * rad + axis * tS * 0.8;
    // the cap rolls: a toroidal swirl
    p += up * sin(r4 * 6.28 + tS * 0.3) * Rr * 0.1 * capK;
    sz = size * (0.6 + 1.6 * age) * mix(0.8, 1.6, capK);
    a = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.6, 1.0, age)) * 0.92;
    soft = 0.6 * sz;
    glow = vec3(1.0, 0.4, 0.1) * 6.0 * (1.0 - smoothstep(0.0, 0.18, age)) * (1.0 - capK);
    selfSh = 1.0;
  } else if (S == 2) {
    // a volcano's ash column: it rises to its height, spreads under the sky's lid into an umbrella, leans downwind
    float H = p0, Rr = p1;
    float hgt = H * pow(age, 0.55);
    float top = smoothstep(0.75, 1.0, hgt / max(H, 1.0));
    float rad = mix(H * 0.035 + hgt * 0.06, Rr * sqrt(r3), top);
    p += up * hgt + side * rad * (0.6 + 0.4 * r2);
    p += axis * (hgt / max(H, 1.0)) * (hgt / max(H, 1.0)) * H * 0.35;
    p += (e1 * sin(tS * 0.3 + r1 * 10.0) + e2 * cos(tS * 0.25 + r2 * 10.0)) * rad * 0.15;
    sz = size * (0.5 + 2.2 * age) * (0.7 + 0.6 * r4) * mix(1.0, 1.8, top);
    a = smoothstep(0.0, 0.04, age) * (1.0 - smoothstep(0.8, 1.0, age)) * 0.95;
    soft = 0.6 * sz;
    // lava glows into the column's foot, and the vent lights the column's underside from below (by day the sun
    // drowns it; at night the ash stands up orange over the crater)
    // (the vent lights the column's underside all the way up the stem at night: the ash stands up orange over the
    // crater, darkest and densest in its core; p2 = the vent's glow)
    glow = vec3(1.0, 0.32, 0.06) * 9.0 * (1.0 - smoothstep(0.0, 0.12, age)) * p2
         + vec3(1.0, 0.34, 0.07) * 2.6 * exp(-hgt / max(H * 0.55, 1.0)) * p2;
    selfSh = 1.0;
  } else if (S == 3) {
    // a pyroclastic flow: billows hugging the ground, racing out from the vent and rolling up behind
    float reach = p0;
    float d = reach * pow(age, 0.6) * (0.6 + 0.4 * r2);
    vec3 dir = normalize(side + axis * 0.8 * r3);
    p += dir * d + up * (size * 0.4 + d * 0.04 * r4 + size * 1.5 * age * age);
    sz = size * (0.8 + 2.0 * age) * (0.7 + 0.6 * r1);
    a = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.6, 1.0, age));
    soft = 0.6 * sz;
    glow = vec3(1.0, 0.35, 0.08) * 4.0 * (1.0 - smoothstep(0.0, 0.3, age));
    selfSh = 0.6;
  } else if (S == 4) {
    // steam: white billows rising and spreading (rifts, lava meeting water), shed along the axis
    p += axis * (r2 - 0.5) * p0 + side * sqrt(r3) * size * 0.5;
    p += up * (tS * (1.5 + 2.0 * r4) + size * 0.2);
    p += (e1 * sin(tS * 0.9 + r1 * 10.0) + e2 * cos(tS * 0.7 + r3 * 10.0)) * age * size * 0.6;
    sz = size * (0.4 + 1.8 * age);
    a = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.4, 1.0, age)) * 0.55;
    soft = 0.6 * sz;
  } else if (S == 5) {
    // spray: white water thrown up and forward along the axis (the tsunami's crest, a splash crown)
    float s = p1;
    vec3 v0 = up * s * (0.6 + 0.8 * r2) + axis * s * (0.3 + 0.7 * r3) + side * s * 0.35 * r4;
    p += side * (r1 - 0.5) * p0 * 2.0 * step(1.0, p0) + v0 * tS - up * 4.9 * tS * tS;
    p += axis * (r2 - 0.5) * p0 * 0.2;
    sz = size * (0.4 + 1.8 * age);
    a = smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.35, 1.0, age)) * 0.7;
    soft = 0.5 * sz;
  } else if (S == 6) {
    // a tornado's skirt: dust and debris whirling round the foot of the funnel, climbing a little
    float R0 = p0, H = p1;
    float th = r1 * 6.2831853 + now * (2.2 + r2 * 1.5);
    float rr = R0 * (0.5 + 0.9 * r3) * (1.0 + age * 0.6);
    p += (e1 * cos(th) + e2 * sin(th)) * rr + up * (H * pow(age, 1.5) * (0.2 + 0.8 * r4) + size * 0.3);
    sz = size * (0.6 + 1.2 * age) * (0.6 + 0.8 * r2);
    a = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.5, 1.0, age)) * 0.8;
    soft = 0.6 * sz;
  } else if (S == 7) {
    // plague miasma: low, slow, sickly wisps drifting through the town
    float R0 = p0;
    p += side * sqrt(r2) * R0 + up * (size * 0.2 + r3 * size * 0.8 + sin(tS * 0.3 + r1 * 6.0) * size * 0.2);
    p += (e1 * sin(tS * 0.12 + r4 * 6.0) + e2 * cos(tS * 0.1 + r1 * 6.0)) * size * 1.2;
    sz = size * (0.7 + 0.8 * r4) * (0.7 + 0.6 * age);
    a = smoothstep(0.0, 0.25, age) * (1.0 - smoothstep(0.6, 1.0, age)) * 0.4;
    soft = 0.8 * sz;
  } else if (S == 8) {
    // a fire's smoke column (firestorm, wildfire front): thick, rising, spreading, leaning downwind
    float H = p0;
    float hgt = H * pow(age, 0.7);
    p += side * (sqrt(r2) * size * 0.8 + hgt * 0.12 * r3) + up * hgt + axis * hgt * hgt / max(H, 1.0) * 0.5;
    sz = size * (0.6 + 2.4 * age) * (0.7 + 0.6 * r4);
    a = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.6, 1.0, age)) * 0.85;
    soft = 0.6 * sz;
    glow = vec3(1.0, 0.36, 0.07) * 5.0 * (1.0 - smoothstep(0.0, 0.2, age)) * p1;
    selfSh = 1.0;
  } else if (S == 9) {
    // blowing sand and dust: low clouds streaming along the wind over the area (radius p0)
    float R0 = p0;
    vec3 off = side * sqrt(r2) * R0;
    p += off + axis * (age - 0.5) * R0 * 0.8 + up * (size * 0.3 + r3 * size * 1.2 + tS * 0.3);
    sz = size * (0.8 + 1.0 * r4) * (0.7 + 0.6 * age);
    a = smoothstep(0.0, 0.2, age) * (1.0 - smoothstep(0.65, 1.0, age)) * 0.55;
    soft = 0.8 * sz;
  } else if (S == 10) {
    // a fog bank: big pale puffs, barely moving
    float R0 = p0;
    p += side * sqrt(r2) * R0 + up * (size * 0.25 + r3 * size * 0.5) + axis * tS * 0.3;
    sz = size * (0.8 + 0.6 * r4);
    a = smoothstep(0.0, 0.3, age) * (1.0 - smoothstep(0.7, 1.0, age)) * 0.45;
    soft = 1.0 * sz;
  } else if (S == 11) {
    // a swarm: dark specks flocking — each orbits a wandering centre on its own noisy path
    float R0 = p0, H = p1;
    // (p2: the CPU moves the emitter — a swarm's wandering mass, whose shadow follows it — so no wander here)
    vec3 ctr = O + up * H + (p2 > 0.5 ? vec3(0.0) : (e1 * sin(now * 0.21 + seed) + e2 * cos(now * 0.17 + seed * 2.0)) * R0 * 0.3);
    float th = r1 * 6.2831853 + now * (0.6 + r2 * 0.9) * (r3 > 0.5 ? 1.0 : -1.0);
    float rr = R0 * (0.15 + 0.85 * sqrt(r4));
    p = ctr + (e1 * cos(th) + e2 * sin(th)) * rr + up * (sin(now * 1.3 + r2 * 20.0) * H * 0.4 + (r3 - 0.5) * H * 0.8);
    p += (e1 * sin(now * 3.1 + r1 * 30.0) + e2 * cos(now * 2.7 + r2 * 30.0) + up * sin(now * 3.7 + r3 * 20.0)) * size * 6.0;
    sz = size;
    a = 1.0;
    kind = 4.0;
    vel = (e1 * -sin(th) + e2 * cos(th));
  } else if (S == 12) {
    // a column of rain (the water miracle, a storm's downpour): streaks falling through a cylinder
    float R0 = p0, H = p1;
    p += side * sqrt(r2) * R0 + up * (H * (1.0 - age));
    vel = -up * 9.0 + axis;
    sz = size;
    a = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.92, 1.0, age)) * 0.6;
    kind = 5.0;
  } else if (S == 13) {
    // a gathering cloud: big dark billows boiling at a height over the place
    float R0 = p0, H = p1;
    p += up * (H + r3 * size * 0.6) + side * sqrt(r2) * R0 * (0.6 + 0.4 * smoothstep(0.0, 0.3, age));
    p += (e1 * sin(tS * 0.2 + r1 * 6.0) + e2 * cos(tS * 0.15 + r4 * 6.0)) * size * 0.4;
    sz = size * (0.7 + 0.6 * r4) * (0.6 + 0.4 * smoothstep(0.0, 0.3, age));
    a = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.75, 1.0, age)) * 0.9;
    soft = 0.8 * sz;
  } else if (S == 14) {
    // leaves and petals swirling up (the forest and fertility miracles)
    float R0 = p0;
    float th = r1 * 6.2831853 + tS * (1.2 + r2);
    p += (e1 * cos(th) + e2 * sin(th)) * R0 * sqrt(r3) * (0.4 + 0.6 * age) + up * (tS * (1.5 + 2.0 * r4) + size);
    sz = size * (0.7 + 0.6 * r2);
    a = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.7, 1.0, age));
    kind = 6.0;
    vel = vec3(cos(tS * 3.0 + r1 * 9.0), sin(tS * 2.0 + r2 * 9.0), 0.0);
  } else if (S == 15) {
    // bounty: fruit and loaves falling from the sky, bouncing once where they land
    float R0 = p0, H = p1;
    float fall = H * (1.0 - min(1.0, age * 1.4) * min(1.0, age * 1.4));
    float bounce = age > 0.714 ? abs(sin((age - 0.714) * 11.0)) * size * 3.0 * (1.0 - (age - 0.714) * 3.5) : 0.0;
    p += side * sqrt(r2) * R0 + up * (max(fall, 0.0) + max(bounce, 0.0) + size);
    sz = size * (0.8 + 0.4 * r3);
    a = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.92, 1.0, age));
    kind = 7.0;
    c = r4 < 0.3 ? vec3(0.55, 0.06, 0.03) : r4 < 0.55 ? vec3(0.6, 0.32, 0.03) : r4 < 0.8 ? vec3(0.5, 0.33, 0.13) : vec3(0.16, 0.32, 0.05);
    // (p2: one kind of thing, in the emitter's colour — logs for the wood miracle)
    if (p2 > 0.5) c = col * (0.75 + 0.5 * r4);
  } else if (S == 16 || S == 19) {
    // precipitation round the camera: a box (half size p0) that wraps as the camera moves; rain streaks, snowflakes
    // (S 19: tumbling, drifting), hail, ash, sand, blood or acid by colour; it falls along -up plus the wind (axis)
    float B = p0;
    float fallV = p1;
    vec3 base = uCamBody;
    vec3 upC = normalize(base);
    vec3 c1 = normalize(cross(upC, abs(upC.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 c2 = cross(upC, c1);
    // positions in a box fixed in the world, wrapped round the camera
    vec3 drift = axis * now - upC * fallV * now;
    vec3 seedP = vec3(r1, r2, r3) * 2.0 * B;
    vec3 q = seedP + vec3(dot(drift, c1), dot(drift, upC), dot(drift, c2)) - vec3(dot(base, c1), dot(base, upC) * 0.0, dot(base, c2));
    q = mod(q, 2.0 * B) - B;
    if (S == 19) q += vec3(sin(now * 1.3 + r4 * 20.0), 0.0, cos(now * 1.1 + r1 * 20.0)) * 0.6;
    p = base + c1 * q.x + upC * q.y + c2 * q.z;
    vel = -upC * fallV + axis;
    sz = size;
    // thin out toward the box's edge (no visible wall of rain)
    float edge = 1.0 - smoothstep(0.6, 1.0, length(q) / B);
    a = edge * power;
    kind = S == 19 ? 7.0 : 5.0;
    if (S == 19) { sz *= 0.6 + 0.8 * r4; }
    // (S 19 with p2: big flakes right at the lens, out of focus — soft discs)
    // (faint, and none in the last metre before the lens: at 0.55 a flake a hand's breadth away filled a fifth of the
    // frame, and a blizzard read as a screen of opaque white circles)
    if (S == 19 && p2 > 0.5) { kind = 11.0; a *= 0.3 * smoothstep(0.8, 1.8, length(q)); }
    // (p2: a driven snow — flakes, white and soft, smeared along the gale, not rain's long thin streaks)
    if (S == 16 && p2 > 0.5) { kind = 5.25; sz *= 0.7 + 0.6 * r4; }
  } else if (S == 17) {
    // splashes: on whatever surface lies under a random point of the screen (the depth buffer, read here)
    vec2 suv = vec2(r1, r2);
    float sz0 = textureLod(tSceneDepth, suv, 0.0).r;
    if (sz0 > p0 || sz0 > 1e6) { hideMe(); return; }
    vec4 rd4 = uInvProj * vec4(suv * 2.0 - 1.0, -1.0, 1.0);
    vec3 rd = rd4.xyz / rd4.w;
    vec3 Sv = rd * (sz0 / max(-rd.z, 1e-6));
    // only on surfaces that face the sky (the ground, a roof, a table): not up a wall or down someone's back — the
    // surface's slope from two neighbouring depth samples
    vec2 suvX = suv + vec2(0.004, 0.0), suvY = suv + vec2(0.0, 0.004);
    vec4 rx4 = uInvProj * vec4(suvX * 2.0 - 1.0, -1.0, 1.0), ry4 = uInvProj * vec4(suvY * 2.0 - 1.0, -1.0, 1.0);
    vec3 rx = rx4.xyz / rx4.w, ry = ry4.xyz / ry4.w;
    vec3 Sx = rx * (textureLod(tSceneDepth, suvX, 0.0).r / max(-rx.z, 1e-6));
    vec3 Sy = ry * (textureLod(tSceneDepth, suvY, 0.0).r / max(-ry.z, 1e-6));
    vec3 Nv = cross(Sx - Sv, Sy - Sv);
    vec3 upV = normalize(normalize(uCamBody) * uViewToBody);
    if (dot(Nv, Nv) < 1e-12 || abs(dot(normalize(Nv), upV)) < 0.75) { hideMe(); return; }
    p = uViewToBody * Sv + uCamBody;
    // (a crown a few centimetres across that opens and is gone in a blink; never larger than the drops would throw)
    sz = size * (0.25 + 0.9 * sqrt(age)) * mix(0.6, 1.0, r3);
    a = (1.0 - smoothstep(0.05, 1.0, age)) * power * 0.55;
    kind = 8.0;
  } else if (S == 20) {
    // embers: glowing bits flung up from the fire or the vent, drifting down as they cool
    float s = p1;
    vec3 v0 = up * s * (0.5 + r2) + side * s * 0.4 * r3 + axis;
    p += side * sqrt(r4) * p0 + v0 * tS - up * 1.2 * tS * tS;
    vel = v0 - up * 2.4 * tS;
    sz = size * (0.5 + r1);
    float cool = smoothstep(0.2, 1.0, age);
    c = mix(vec3(1.0, 0.55, 0.12), vec3(0.8, 0.12, 0.02), cool) * 18.0;
    a = (1.0 - smoothstep(0.6, 1.0, age)) * step(0.1, r1);
    kind = 1.0;
    stretchCap = 2.5;
  } else if (S == 21) {
    // lava fountains: incandescent blobs in ballistic arcs from the vent, darkening as they fall back
    float s = p1;
    vec3 v0 = up * s * (0.7 + 0.5 * r2) + side * s * 0.35 * sqrt(r3);
    p += side * sqrt(r4) * p0 * 0.3 + v0 * tS - up * 4.9 * tS * tS;
    vel = v0 - up * 9.8 * tS;
    // (sizes from spatter to bombs: all alike, they read from afar as a row of identical orange bars)
    sz = size * (0.3 + 1.3 * r1 * r1);
    // lava bombs: short red-orange streaks along their arcs, cooling and darkening as they fly (never sparkler spikes)
    float cool = smoothstep(0.05, 0.8, age);
    c = mix(vec3(1.0, 0.5, 0.12), vec3(0.45, 0.05, 0.01), cool) * mix(14.0, 2.5, cool);
    a = smoothstep(0.0, 0.03, age) * (1.0 - smoothstep(0.8, 1.0, age));
    kind = 1.0;
    stretchCap = 2.2;
    lift = 1.0;
  } else if (S == 22) {
    // sparks: fast, falling streaks
    vec3 v0 = (side * (0.6 + r2) + up * (0.8 + r3)) * p1 + axis;
    p += v0 * tS - up * 4.9 * tS * tS;
    vel = v0 - up * 9.8 * tS;
    sz = size * (0.5 + r1);
    c = col * 20.0;
    a = 1.0 - smoothstep(0.5, 1.0, age);
    kind = 1.0;
    stretchCap = 3.0;
  } else if (S == 23) {
    // a meteor's plasma: streaks shed behind the glowing head along its path (axis = its flight, p0 = trail length)
    float back = r2 * r2 * p0;
    p -= axis * back;
    p += side * size * (0.3 + 2.5 * age) * r3;
    vel = axis;
    sz = size * (1.0 - 0.6 * r2) * (1.0 - age * 0.5);
    c = mix(col, vec3(1.0, 0.45, 0.15), r2) * 40.0 * (1.0 - r2 * 0.8);
    a = (1.0 - smoothstep(0.3, 1.0, age)) * (1.0 - r2 * 0.5);
    kind = 1.0;
  } else if (S == 24) {
    // motes: soft points of light spiralling up (heal gold, fertility green, calm blue, teaching white)
    float R0 = p0;
    float th = r1 * 6.2831853 + tS * (0.8 + r2) * (r3 > 0.5 ? 1.0 : -1.0);
    float rr = R0 * sqrt(r4) * (1.0 - 0.5 * age);
    p += (e1 * cos(th) + e2 * sin(th)) * rr + up * (tS * (1.0 + 2.5 * r3) + size) + axis * age * p1;
    sz = size * (0.6 + 0.8 * r2) * (1.0 - age * 0.4);
    c = col * 8.0 * (0.6 + 0.4 * sin(now * 6.0 + r1 * 30.0));
    a = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.6, 1.0, age));
    // (a mote that drifts up past the camera is not a lit disc a metre across on the lens: the art review's pale and
    // yellow-green 'lens ghost' discs over a camp and a field were sacred-place motes within a few metres of the eye)
    a *= smoothstep(3.0, 14.0, length(p - uCamBody));
    kind = 2.0;
  } else if (S == 25) {
    // a meteor shower: streaks across the sky high over the place, all from one radiant (axis)
    vec3 start = O + up * p0 + side * sqrt(r2) * p1 + axis * (r3 - 0.5) * p1;
    float L = p0 * 0.5;
    p = start + axis * age * L;
    vel = axis;
    sz = size * (0.5 + r4);
    c = mix(vec3(1.0, 0.9, 0.7), vec3(0.6, 0.85, 1.0), r1) * 60.0;
    a = sin(age * 3.1415) * step(0.35, r4);
    kind = 1.0;
  } else if (S == 26) {
    // a flash: one soft sphere of light (an impact, a fireball's heart, a bolt lighting its cloud)
    p += up * p0;
    sz = size * (0.4 + 0.6 * sqrt(age)) * (idx < 0.5 ? 1.0 : 0.0);
    if (idx > 0.5) { hideMe(); return; }
    c = col * p1 * pow(1.0 - age, 2.2);
    a = 1.0;
    kind = 3.0;
  } else if (S == 27 || S == 28) {
    // sparkles (a shield struck, a thread of teaching) and glints (ice, glass): tiny twinkling stars
    p += side * sqrt(r2) * p0 + up * (r3 * p1) + axis * age * p2;
    sz = size * (0.5 + r4);
    c = col * 12.0 * pow(max(0.0, sin(now * (6.0 + 10.0 * r1) + r2 * 40.0)), 8.0);
    a = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.7, 1.0, age));
    kind = 2.0;
  }
  else if (S == 40) {
    // a rain or hail shaft under a storm cell, seen from afar: tall soft grey curtains (p0 radius, p1 the cloud base
    // above O) streaming slowly down, leaning with the wind (axis)
    float R0 = p0, H = p1;
    float hh = fract(r3 - tS * 0.08);
    p += side * sqrt(r2) * R0 + up * (H * hh) + axis * (1.0 - hh) * H * 0.15;
    vel = -up * H + axis * H * 0.15;
    sz = size * (0.7 + 0.6 * r4);
    // (feathered: thinning toward the ground and out from the core, some streaks denser than others — a hard-edged
    // pillar of bright haze read as fog, not rain)
    a = smoothstep(0.0, 0.5, hh) * (1.0 - smoothstep(0.88, 1.0, hh)) * (1.0 - smoothstep(0.35, 1.0, sqrt(r2))) * (0.45 + 0.9 * r1 * r1) * 0.3;
    kind = 10.0;
    stretchCap = 4.5;
    soft = 2.0 * sz;
  } else if (S == 41) {
    // an impact's fireball: puffs filling a swelling hemisphere that rises on its own heat; each white-hot at first,
    // cooling through orange and red to black smoke (p0 its final radius, p1 its rise speed m/s)
    float R0 = p0;
    float z = r3;
    float rxy = sqrt(max(0.0, 1.0 - z * z));
    vec3 dirv = (e1 * cos(ang) + e2 * sin(ang)) * rxy + up * z;
    float rr = R0 * (1.0 - exp(-tS * 2.0)) * pow(r2, 0.33);
    p += dirv * rr + up * (tS * p1 * (0.6 + 0.4 * r4) + rr * 0.35);
    p += (e1 * sin(tS * 1.3 + r1 * 20.0) + e2 * cos(tS * 1.1 + r2 * 20.0)) * R0 * 0.08 * age;
    sz = size * (0.45 + 1.4 * sqrt(age)) * (0.7 + 0.6 * r4);
    a = smoothstep(0.0, 0.02, age) * (1.0 - smoothstep(0.6, 1.0, age)) * 0.95;
    soft = 0.6 * sz;
    // temperature: hottest in the core and early; a blackbody ramp
    float T = exp(-tS * (0.9 + 0.6 * r2)) * (1.0 - 0.35 * r2);
    glow = mix(vec3(0.6, 0.06, 0.0), vec3(1.0, 0.42, 0.08), smoothstep(0.1, 0.5, T));
    glow = mix(glow, vec3(1.0, 0.86, 0.6), smoothstep(0.55, 0.95, T)) * 22.0 * T * T;
    selfSh = 1.0;
  } else if (S == 42) {
    // an impact's shock ring: a wall of dust rolling out along the ground (p0 its farthest reach, p1 its spread rate),
    // slowing as it goes and billowing up behind its front
    float Rr = p0 * (1.0 - exp(-tS * p1));
    float slow = 1.0 - exp(-tS * p1);
    p += side * (Rr + (r2 - 0.5) * size * 1.6) + up * (size * 0.35 + size * (0.4 + 1.6 * r3) * slow);
    sz = size * (0.55 + 1.3 * age) * (0.7 + 0.6 * r4);
    a = smoothstep(0.0, 0.02, age) * (1.0 - smoothstep(0.5, 1.0, age)) * 0.92;
    soft = 0.5 * sz;
    selfSh = 0.5;
  } else if (S == 43) {
    // the ejecta curtain: rock and dust thrown up and out from the rim (p0 rim radius) at a steep angle — an inverted
    // cone sheet that falls back outside the crater (p1 launch speed m/s)
    float el = 0.88 + 0.22 * r3;
    float sp = p1 * (0.55 + 0.6 * r2);
    vec3 v0 = side * sp * cos(el) + up * sp * sin(el);
    float tt = tS;
    vec3 q = side * p0 * (0.75 + 0.3 * r4) + v0 * tt - up * 4.9 * tt * tt;
    float hU = dot(q, up);
    if (hU < 0.0) { q -= up * hU; }
    p += q;
    sz = size * (0.5 + 1.2 * age) * (0.7 + 0.6 * r4);
    a = smoothstep(0.0, 0.03, age) * (1.0 - smoothstep(0.45, 1.0, age)) * 0.85 * (hU < 0.0 ? 0.5 : 1.0);
    soft = 0.5 * sz;
    selfSh = 0.5;
  } else if (S == 44 || S == 29) {
    // things thrown on ballistic arcs from O: arc j's launch from a hash of the emitters' shared seed (p2); smoke
    // puffs left along each arc (44, twelve per arc) and the glowing heads (29, one per arc)
    float j = S == 44 ? floor(idx / 12.0) : idx;
    float kk = S == 44 ? mod(idx, 12.0) : 0.0;
    float aj = h1(p2 * 1.7 + j * 0.37, 11.0) * 6.2831853;
    float el = 0.45 + 0.6 * h1(p2 * 2.3 + j * 0.71, 12.0);
    float spd = p1 * (0.35 + 0.65 * h1(p2 * 3.1 + j * 0.53, 13.0));
    vec3 hz = e1 * cos(aj) + e2 * sin(aj);
    float g = 9.8;
    float Tj = 2.0 * spd * sin(el) / g + 0.05;
    float tAll = now - t0;
    if (S == 44) {
      float tau = (kk / 12.0) * Tj;
      float pa = (tAll - tau) / (life * 0.45);
      if (tAll < tau || pa > 1.0 || tau > tAll) { hideMe(); return; }
      p += hz * spd * cos(el) * tau + up * (spd * sin(el) * tau - 0.5 * g * tau * tau + pa * size * 2.0);
      sz = size * (0.35 + 1.6 * sqrt(pa));
      a = smoothstep(0.0, 0.05, pa) * (1.0 - smoothstep(0.35, 1.0, pa)) * 0.6;
      soft = 0.6 * sz;
      age = pa;
    } else {
      if (tAll > Tj) { hideMe(); return; }
      float tt = tAll;
      vec3 v0 = hz * spd * cos(el) + up * spd * sin(el);
      p += v0 * tt - up * 0.5 * g * tt * tt;
      vel = v0 - up * g * tt;
      float cool = clamp(tt / max(Tj, 0.1), 0.0, 1.0);
      c = mix(vec3(1.0, 0.65, 0.25), vec3(0.5, 0.07, 0.01), smoothstep(0.0, 0.85, cool)) * mix(16.0, 2.0, cool);
      sz = size * (0.6 + 0.6 * h1(p2 + j, 14.0));
      a = 1.0 - smoothstep(0.85, 1.0, cool);
      kind = 1.0;
      stretchCap = 2.5;
      age = cool;
    }
  } else if (S == 46) {
    // a low haze hugging the ground: wide flat puffs drifting slowly (plague miasma in the streets, at dusk)
    float R0 = p0;
    p += side * sqrt(r2) * R0 + up * (size * 0.12 + r3 * size * 0.25) + axis * tS * 0.25;
    p += (e1 * sin(tS * 0.08 + r4 * 6.0) + e2 * cos(tS * 0.07 + r1 * 6.0)) * size * 0.8;
    sz = size * (0.8 + 0.6 * r4);
    a = smoothstep(0.0, 0.3, age) * (1.0 - smoothstep(0.65, 1.0, age)) * 0.42;
    soft = 1.2 * sz;
    squash = 0.38;
  } else if (S == 47) {
    // crows circling over a place of death (p0 the circle's radius, p1 its height)
    float th = r1 * 6.2831853 + now * (0.22 + 0.12 * r2) * (r3 > 0.5 ? 1.0 : -1.0);
    float rr = p0 * (0.45 + 0.55 * r4);
    p += (e1 * cos(th) + e2 * sin(th)) * rr + up * (p1 * (0.75 + 0.5 * r2) + sin(now * 0.6 + r1 * 10.0) * 2.5);
    vel = (e1 * -sin(th) + e2 * cos(th)) * (r3 > 0.5 ? 1.0 : -1.0);
    float camD = length(p - uCamBody);
    sz = max(size, camD * 0.004);
    a = smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.9, 1.0, age));
    kind = 9.0;
  } else if (S == 48) {
    // a swarm's body: a dark mass of puffs flowing round a wandering centre, waves running through it
    float R0 = p0, H = p1;
    vec3 ctr = O + up * H;
    float th = r1 * 6.2831853 + now * (0.35 + 0.25 * r2) * (r3 > 0.5 ? 1.0 : -1.0);
    float rr = R0 * sqrt(r4) * (0.75 + 0.25 * sin(now * 0.7 + r2 * 8.0));
    p = ctr + (e1 * cos(th) + e2 * sin(th)) * rr + up * ((r3 - 0.5) * H * 0.7 + sin(th * 3.0 + now * 1.7) * H * 0.18);
    sz = size * (0.7 + 0.6 * r2);
    a = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.8, 1.0, age)) * 0.3;
    soft = 0.8 * sz;
  } else if (S == 49) {
    // blowing snow streaming along the ground round the camera: a box (half size p0) wrapped round the eye, within a
    // metre and a half of the ground (p1: the camera's height over it), smeared along the wind (axis)
    float B = p0;
    vec3 base = uCamBody;
    vec3 upC = normalize(base);
    vec3 c1 = normalize(cross(upC, abs(upC.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 c2 = cross(upC, c1);
    vec3 drift = axis * now;
    vec2 q = vec2(r1, r2) * 2.0 * B + vec2(dot(drift, c1), dot(drift, c2)) - vec2(dot(base, c1), dot(base, c2));
    q = mod(q, 2.0 * B) - B;
    float hq = -p1 + 0.05 + r3 * r3 * 1.6 + sin(now * 2.0 + r4 * 20.0) * 0.08;
    p = base + c1 * q.x + c2 * q.y + upC * hq;
    vel = axis;
    sz = size * (0.6 + 0.8 * r4);
    float edge = 1.0 - smoothstep(0.6, 1.0, length(q) / B);
    // (wisps, not a blanket: at 0.5 the sheet read as a bank of white fog over the street)
    // (and near the lens they fade: long smears passing a metre from the eye read as shafts of light, not snow)
    a = edge * power * (0.12 + 0.3 * r4 * r4) * smoothstep(1.5, 5.0, length(q));
    kind = 10.0;
    stretchCap = 4.0;
    soft = 1.0;
  }
  // ── shading of lit particles ──
  vLight = vec3(1.0);
  vSkyL = vec3(0.0);
  vGlow = glow * power;
  if (litSys) {
    float rP = length(p);
    vec3 upP = p / rP;
    vec2 shade = fxCloudShade(p, rP);
    vec3 sun = uSunE * sunTransmittance(rP, dot(upP, uSunDirBody)) * shade.x;
    vec3 sky = skyIrradiance(upP, upP, uSunDirBody) * shade.y;
    // direct light (the sun, the moon) and the sky's apart: a puff's sunlit side warm, its shade blue-grey
    vLight = sun * 0.24 + uMoonE * 0.15 * shade.x;
    vSkyL = sky * 0.3 + vec3(0.002, 0.003, 0.005);
    if (selfSh > 0.0) {
      // a column's far side from the sun lies in its own shadow
      vec3 sunH = uSunDirBody - up * dot(uSunDirBody, up);
      float sl = length(sunH);
      float lit = sl > 1e-4 ? smoothstep(-0.7, 0.7, dot(side, sunH / sl)) : 1.0;
      vLight *= mix(1.0, 0.18 + 0.82 * lit, selfSh * min(1.0, sl * 3.0));
      vSkyL *= mix(1.0, 0.7 + 0.3 * lit, selfSh);
    }
  }
  // ── aerial perspective: the air between the camera and the particle dims it and veils it in the sky's colour
  // (density averaged along the path between the two heights; the veil is the sky's radiance that way) ──
  vAirT = vec3(1.0);
  vAirIn = vec3(0.0);
  if (uHasAtmo > 0.5) {
    vec3 dv = p - uCamBody;
    float L = length(dv);
    float hc = max(length(uCamBody) - uRg, 0.0), hp = max(length(p) - uRg, 0.0);
    float dh = hp - hc;
    float dR = abs(dh) > 1.0 ? uHR * (exp(-hc / uHR) - exp(-hp / uHR)) / dh : exp(-hc / uHR);
    float dM = abs(dh) > 1.0 ? uHM * (exp(-hc / uHM) - exp(-hp / uHM)) / dh : exp(-hc / uHM);
    vAirT = exp(-(uBetaR * dR + uBetaMe * dM) * L);
    vAirIn = skyRadiance(normalize(uCamBody), dv / max(L, 1e-3), uSunDirBody) * (1.0 - vAirT);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDir = vec2(0.0, 1.0);
  if (kind > 0.5 && kind < 1.5 || kind > 4.5 && kind < 5.5 || kind > 9.5 && kind < 10.5) {
    // a streak along its flight on screen
    vec3 vv = (modelViewMatrix * vec4(vel, 0.0)).xyz;
    vec2 d = length(vv.xy) > 1e-5 ? normalize(vv.xy) : vec2(0.0, 1.0);
    vDir = d;
    // (a drop smeared over a 1/60 s exposure: its length is its screen speed × the shutter, many times its width)
    float stretch = kind > 9.5 ? stretchCap : kind > 5.1 ? clamp(length(vv.xy) * 0.12, 2.2, 6.0) : kind > 4.5 ? clamp(length(vv.xy) * 0.0083 / max(sz, 1e-3), 2.0, 14.0) : min(stretchCap, 1.0 + clamp(length(vv.xy) * 0.08, 0.0, 10.0));
    vec2 nrm = vec2(d.y, -d.x);
    mv.xy += nrm * corner.x * sz + d * corner.y * sz * stretch;
  } else if (kind > 7.5 && kind < 8.5) {
    // a splash: a little crown, wider than tall, standing on the surface
    mv.xy += vec2(corner.x * sz * 1.6, (corner.y * 0.5 + 0.5) * sz * 0.8);
  } else {
    float rot = squash < 0.99 || kind > 8.5 ? 0.0 : r3 * 6.2831853 + (litSys ? age * (r1 - 0.5) * 2.0 : 0.0);
    vec2 cc = vec2(cos(rot) * corner.x - sin(rot) * corner.y, sin(rot) * corner.x + cos(rot) * corner.y);
    if (kind > 8.5 && kind < 9.5) {
      // a bird: a flat V seen side-on, along its flight on screen
      vec3 vv = (modelViewMatrix * vec4(vel, 0.0)).xyz;
      vec2 d = length(vv.xy) > 1e-5 ? normalize(vv.xy) : vec2(1.0, 0.0);
      vDir = d;
    }
    mv.xy += vec2(cc.x, cc.y * squash) * sz;
  }
  gl_Position = projectionMatrix * mv;
  vCorner = corner;
  vColor = vec4(c, a * power);
  vViewZ = -mv.z;
  vSoft = soft;
  vKind = kind;
  vSeed = r1 * 40.0 + r2 * 13.0;
#include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
${FX_DEPTH_GLSL}
uniform float uPass;
uniform vec2 uSunS;
uniform float uEmitCap;
varying vec2 vCorner;
varying vec4 vColor;
varying float vViewZ;
varying float vSoft;
varying vec3 vLight;
varying float vKind;
varying vec2 vDir;
varying vec3 vGlow;
varying float vSeed;
varying vec3 vAirT;
varying vec3 vAirIn;
varying vec3 vSkyL;
// emission rolls off softly toward uEmitCap in display terms (0 = off): at the night's exposure a volcano's lava
// bombs and embers (14-18x physical) came out hundreds of times display white, and the bloom spread them into a
// white glare disc over the whole frame (punch P03; gone with the additive particles hidden). By day, and for anything
// already within the display's range, nothing changes.
vec3 emitCap(vec3 c) {
  if (uEmitCap <= 0.0) return c;
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722)) * fxExposure();
  return c / (1.0 + L / uEmitCap);
}
void main() {
#include <logdepthbuf_fragment>
  if (vColor.a <= 0.0) discard;
  float sz = fxSceneZ();
  if (vViewZ > sz + 0.05) discard;
  float fade = clamp((sz - vViewZ) / max(0.05, vSoft), 0.0, 1.0) * smoothstep(0.3, 2.0, vViewZ);
  float r = length(vCorner);
  if (vKind < 0.5) {
    // a lit puff: a lumpy outline, a fake normal (sunlit and self-shadowed sides), a glow from below
    if (r > 1.0) discard;
    float n1 = snoise(vec3(vCorner * 1.7, vSeed));
    float n2 = snoise(vec3(vCorner * 4.1 + 3.7, vSeed + uFxTime * 0.05));
    float rr = r * (1.0 - 0.22 * n1 - 0.08 * n2);
    float puff = smoothstep(1.0, 0.35, rr) * (0.75 + 0.25 * n2);
    vec3 nrm = normalize(vec3(vCorner * 0.9 + vec2(n1, n2) * 0.25, sqrt(max(0.05, 1.0 - min(r * r, 1.0)))));
    float lit = clamp(0.42 + 0.78 * dot(nrm.xy, uSunS) + 0.2 * nrm.z, 0.0, 1.3);
    float under = smoothstep(0.4, -0.8, nrm.y);
    float a = vColor.a * puff * fade;
    // (smoke lit from below by a fire or a vent borrows its light: on screen the borrowed glow tops out at a deep orange
    // whatever the eye's adaptation — at the night's exposure a volcano's ash column read as a white glare disc)
    vec3 gl = vColor.rgb * vGlow * (0.35 + 0.65 * under);
    float glL = dot(gl, vec3(0.2126, 0.7152, 0.0722)) * fxExposure();
    vec3 c = vColor.rgb * (vLight * lit + vSkyL * (0.7 + 0.3 * nrm.z)) + gl / (1.0 + glL / 0.35);
    c = c * vAirT + vAirIn;
    gl_FragColor = vec4(c * a, a);
  } else if (vKind > 3.5 && vKind < 4.5) {
    // a swarm's speck: a dark body with a flicker of wings
    if (r > 1.0) discard;
    float body = smoothstep(1.0, 0.4, r);
    float wing = 0.5 + 0.5 * sin(uFxTime * 60.0 + vSeed);
    float a = vColor.a * body * fade * (0.7 + 0.3 * wing);
    gl_FragColor = vec4((vColor.rgb * (vLight + vSkyL) * 0.6 * vAirT + vAirIn) * a, a);
  } else if (vKind > 4.5 && vKind < 5.5) {
    // a rain streak: thin, brightest in the middle, lit by the sky
    float k = (1.0 - smoothstep(0.0, 1.0, abs(vCorner.x))) * (1.0 - smoothstep(0.6, 1.0, abs(vCorner.y)));
    float bright = 1.6;
    if (vKind > 5.1) {
      // a driven flake: a soft, rounded smear (no hard-edged card), a diffuse white body
      float rr = length(vec2(vCorner.x, max(abs(vCorner.y) - 0.3, 0.0) / 0.7));
      k = exp(-rr * rr * 3.2) * (1.0 - smoothstep(0.75, 1.0, rr));
      bright = 1.25;
    }
    float a = vColor.a * k * fade * 0.55;
    gl_FragColor = vec4((vColor.rgb * ((vLight + vSkyL) * bright + 0.01) * vAirT + vAirIn) * a, a);
  } else if (vKind > 5.5 && vKind < 6.5) {
    // a leaf: a little lit ellipse turning in the air
    vec2 q = vCorner * vec2(1.0, 0.55);
    if (length(q) > 0.6) discard;
    float a = vColor.a * fade;
    gl_FragColor = vec4((vColor.rgb * (vLight + vSkyL) * 1.4 * vAirT + vAirIn) * a, a);
  } else if (vKind > 6.5 && vKind < 7.5) {
    // a lit blob (fruit, a snowflake, a hailstone)
    if (r > 1.0) discard;
    float sh = 0.6 + 0.4 * (1.0 - r) + 0.25 * max(0.0, -vCorner.y);
    float a = vColor.a * smoothstep(1.0, 0.75, r) * fade;
    gl_FragColor = vec4((vColor.rgb * (vLight + vSkyL) * 1.6 * sh * vAirT + vAirIn) * a, a);
  } else if (vKind > 7.5 && vKind < 8.5) {
    // a splash crown: a thin rim of droplets thrown up and out (the arc of a ring seen side-on), open in the middle
    vec2 cq = vec2(vCorner.x, (vCorner.y + 1.0) * 0.9);
    float rim = abs(length(cq) - 0.85);
    float k = (1.0 - smoothstep(0.0, 0.16, rim)) * step(0.0, cq.y) * (1.0 - smoothstep(0.6, 1.0, abs(vCorner.x)) * 0.5);
    // droplets along the rim, not a solid band
    float drops = step(0.35, fract(atan(cq.y, cq.x) * 3.1 + vSeed));
    float a = vColor.a * k * drops * 0.5;
    gl_FragColor = vec4((vColor.rgb * (vLight + vSkyL) * 1.8 * vAirT + vAirIn) * a, a);
  } else if (vKind > 8.5 && vKind < 9.5) {
    // a bird: two dark wings in a shallow V, beating
    vec2 q = vec2(dot(vCorner, vDir), dot(vCorner, vec2(-vDir.y, vDir.x)));
    float flap = sin(uFxTime * 9.0 + vSeed * 3.0);
    float wing = abs(q.y + abs(q.x) * (0.35 + 0.35 * flap) - 0.1) - (0.14 - 0.1 * abs(q.x));
    float body = length(q * vec2(0.9, 2.6)) - 0.22;
    float m = (1.0 - smoothstep(0.0, 0.06, min(wing, body))) * step(abs(q.x), 0.95);
    float a = vColor.a * m * fade;
    if (a <= 0.003) discard;
    gl_FragColor = vec4((vColor.rgb * (vLight + vSkyL) * 0.5 * vAirT + vAirIn) * a, a);
  } else if (vKind > 9.5 && vKind < 10.5) {
    // a soft streak (a rain shaft, blowing snow): a long soft ellipse along its motion
    float k = exp(-vCorner.x * vCorner.x * 3.0) * (1.0 - smoothstep(0.55, 1.0, abs(vCorner.y)));
    float a = vColor.a * k * fade;
    gl_FragColor = vec4((vColor.rgb * (vLight + vSkyL) * 1.2 * vAirT + vAirIn) * a, a);
  } else if (vKind > 10.5) {
    // a big flake at the lens, out of focus: a soft bright disc
    if (r > 1.0) discard;
    float a = vColor.a * exp(-r * r * 2.2) * (1.0 - smoothstep(0.8, 1.0, r)) * fade;
    gl_FragColor = vec4((vColor.rgb * (vLight + vSkyL) * 1.5 * vAirT + vAirIn) * a, a);
  } else if (vKind > 0.5 && vKind < 1.5) {
    // an emissive streak: hottest at its head
    float core = (1.0 - smoothstep(0.0, 1.0, abs(vCorner.x))) * smoothstep(-1.0, 0.6, vCorner.y) * (1.0 - smoothstep(0.85, 1.0, vCorner.y));
    float a = vColor.a * core * fade;
    gl_FragColor = vec4(emitCap(vColor.rgb * vAirT * a * fxDisplay(0.35)), 0.0);
  } else if (vKind > 1.5 && vKind < 2.5) {
    // an emissive blob
    if (r > 1.0) discard;
    float k = pow(1.0 - r, 1.8);
    float a = vColor.a * k * fade;
    gl_FragColor = vec4(emitCap(vColor.rgb * vAirT * a * fxDisplay(0.35)), 0.0);
  } else {
    // a flash: a soft sphere of light falling off like a glow, windowed to nothing at the sprite's edge
    if (r > 1.0) discard;
    float win = (1.0 - r * r) * (1.0 - r * r);
    float k = (exp(-r * r * 9.0) * 1.6 + 0.3 * exp(-r * r * 2.5)) * win;
    gl_FragColor = vec4(emitCap(vColor.rgb * vAirT * k * vColor.a * fade * fxDisplay(0.2)), 0.0);
  }
}
`;

interface Live {
  row: number;
  blocks: number[];
  def: Required<Pick<EmitterDef, 'sys' | 'size' | 'life' | 'count'>> & EmitterDef;
  t0: number;
  tEnd: number;
  /** remove after this FX time */
  until: number;
}

const _sunV = new Vector3();

/** the god layer's particle pool */
export class Vfx {
  readonly group = new Group();
  private geo = new InstancedBufferGeometry();
  private lit: Mesh;
  private add: Mesh;
  private emitTex: DataTexture;
  private blockTex: DataTexture;
  private emitData: Float32Array;
  private blockData: Float32Array;
  private freeRows: number[] = [];
  private freeBlocks: number[] = [];
  private live = new Map<number, Live>();
  private nextId = 1;
  private maxBlocks: number;
  private uniforms: Record<string, IUniform>;
  private dirtyBlocks = true;
  stats = { emitters: 0, particles: 0 };

  constructor(shared: Record<string, IUniform>, fx: Record<string, IUniform>, poolParticles = 65536) {
    this.group.name = 'vfx';
    this.group.matrixAutoUpdate = false;
    this.maxBlocks = Math.min(4096, Math.ceil(poolParticles / BLOCK));
    this.emitData = new Float32Array(TEX_W * ROWS * 4);
    this.emitTex = new DataTexture(this.emitData, TEX_W, ROWS, RGBAFormat, FloatType);
    this.emitTex.minFilter = this.emitTex.magFilter = NearestFilter;
    this.emitTex.needsUpdate = true;
    this.blockData = new Float32Array(64 * 64 * 4).fill(-1);
    this.blockTex = new DataTexture(this.blockData, 64, 64, RGBAFormat, FloatType);
    this.blockTex.minFilter = this.blockTex.magFilter = NearestFilter;
    this.blockTex.needsUpdate = true;
    for (let i = ROWS - 1; i >= 0; i--) this.freeRows.push(i);
    for (let i = this.maxBlocks - 1; i >= 0; i--) this.freeBlocks.push(i);
    this.geo.setAttribute('corner', new Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    const inst = new Float32Array(this.maxBlocks * BLOCK * 2);
    for (let b = 0; b < this.maxBlocks; b++) for (let i = 0; i < BLOCK; i++) { inst[(b * BLOCK + i) * 2] = b; inst[(b * BLOCK + i) * 2 + 1] = i; }
    this.geo.setAttribute('iBlock', new InstancedBufferAttribute(inst, 2));
    this.geo.instanceCount = 0;
    this.uniforms = {
      tEmit: { value: this.emitTex }, tBlocks: { value: this.blockTex }, uInvProj: { value: new Matrix4() },
      uViewToBody: { value: null }, uSunS: { value: new Float32Array([0, 1]) },
      // (display-referred ceiling on additive emission: see emitCap in FRAG)
      uEmitCap: { value: EMIT_CAP },
    };
    const mk = (pass: number) => {
      const u: Record<string, IUniform> = { ...this.uniforms, uPass: { value: pass } };
      for (const k of Object.keys(fx)) u[k] = fx[k];
      for (const k of Object.keys(shared)) if (!(k in u)) u[k] = shared[k];
      return new ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: u, transparent: true, depthWrite: false, depthTest: false,
        blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
      });
    };
    this.lit = new Mesh(this.geo, mk(1));
    this.add = new Mesh(this.geo, mk(0));
    for (const m of [this.lit, this.add]) { m.frustumCulled = false; m.matrixAutoUpdate = false; m.layers.set(FX_LAYER); this.group.add(m); }
    this.lit.renderOrder = 10;
    this.add.renderOrder = 11;
  }

  /** start an emitter; returns its handle (0 when the pool is full) */
  emit(d: EmitterDef, now: number): number {
    const row = this.freeRows.pop();
    if (row === undefined) return 0;
    const want = Math.max(1, Math.ceil(d.count / BLOCK));
    const blocks: number[] = [];
    while (blocks.length < want && this.freeBlocks.length) blocks.push(this.freeBlocks.pop()!);
    if (!blocks.length) { this.freeRows.push(row); return 0; }
    const id = this.nextId++;
    const pre = !d.burst && d.prewarm ? Math.max(0, d.prewarm) : 0;
    const t0 = (d.t0 ?? now) - pre;
    const tEnd = d.duration !== undefined ? t0 + pre + d.duration : d.burst ? t0 : 1e9;
    const until = d.burst ? t0 + d.life * 1.35 + 0.3 : tEnd + d.life * 1.2;
    const lv: Live = { row, blocks, def: { ...d }, t0, tEnd, until };
    this.live.set(id, lv);
    for (let k = 0; k < blocks.length; k++) {
      const b = blocks[k];
      this.blockData[b * 4] = row; this.blockData[b * 4 + 1] = k; this.blockData[b * 4 + 2] = blocks.length; this.blockData[b * 4 + 3] = 0;
    }
    this.dirtyBlocks = true;
    this.write(lv);
    return id;
  }

  /** move / re-power a live emitter */
  set(id: number, patch: Partial<EmitterDef>): void {
    const lv = this.live.get(id);
    if (!lv) return;
    Object.assign(lv.def, patch);
    this.write(lv);
  }

  /** stop births now (the live particles play out), or remove at once */
  stop(id: number, now: number, hard = false): void {
    const lv = this.live.get(id);
    if (!lv) return;
    if (hard) { this.free(id, lv); return; }
    lv.tEnd = Math.min(lv.tEnd, now);
    lv.until = Math.min(lv.until, now + lv.def.life * 1.2);
    this.write(lv);
  }

  alive(id: number): boolean { return this.live.has(id); }

  private free(id: number, lv: Live): void {
    for (const b of lv.blocks) { this.blockData[b * 4] = -1; this.freeBlocks.push(b); }
    this.freeRows.push(lv.row);
    this.live.delete(id);
    this.dirtyBlocks = true;
  }

  private write(lv: Live): void {
    const d = lv.def, o = lv.row * TEX_W * 4, E = this.emitData;
    E[o] = d.x; E[o + 1] = d.y; E[o + 2] = d.z; E[o + 3] = d.sys;
    E[o + 4] = d.ax ?? 0; E[o + 5] = d.ay ?? 0; E[o + 6] = d.az ?? 0; E[o + 7] = d.size;
    E[o + 8] = d.power ?? 1; E[o + 9] = (lv.row * 0.6180339 + lv.t0 * 0.137) % 97; E[o + 10] = lv.t0; E[o + 11] = d.life;
    E[o + 12] = d.p0 ?? 0; E[o + 13] = d.p1 ?? 0; E[o + 14] = d.p2 ?? 0; E[o + 15] = lv.tEnd;
    E[o + 16] = d.r ?? 1; E[o + 17] = d.g ?? 1; E[o + 18] = d.b ?? 1; E[o + 19] = d.burst ? 1 : 0;
  }

  /** per frame: retire finished emitters, upload, set the pass uniforms */
  update(now: number, viewToBody: unknown, invProj: Matrix4, sunView: Vector3): void {
    for (const [id, lv] of this.live) if (now > lv.until) this.free(id, lv);
    let hi = 0, n = 0;
    for (const lv of this.live.values()) for (const b of lv.blocks) { if (b + 1 > hi) hi = b + 1; n += BLOCK; }
    this.geo.instanceCount = hi * BLOCK;
    this.group.visible = hi > 0;
    this.emitTex.needsUpdate = true;
    if (this.dirtyBlocks) { this.blockTex.needsUpdate = true; this.dirtyBlocks = false; }
    this.uniforms.uViewToBody.value = viewToBody;
    (this.uniforms.uInvProj.value as Matrix4).copy(invProj);
    _sunV.copy(sunView);
    const l = Math.hypot(_sunV.x, _sunV.y) || 1;
    const k = Math.min(1, l) * 0.6 + 0.4;
    const s = this.uniforms.uSunS.value as Float32Array;
    s[0] = (_sunV.x / l) * k; s[1] = (_sunV.y / l) * k;
    this.stats.emitters = this.live.size;
    this.stats.particles = n;
  }

  dispose(): void {
    this.geo.dispose();
    (this.lit.material as ShaderMaterial).dispose();
    (this.add.material as ShaderMaterial).dispose();
    this.emitTex.dispose();
    this.blockTex.dispose();
  }
}
