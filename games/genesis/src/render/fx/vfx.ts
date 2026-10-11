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
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { FX_DEPTH_GLSL, FX_LAYER } from './fxcommon.ts';

/** particle systems (vertex shader branches). < 20: the lit pass; ≥ 20: the emissive pass */
export const SYS = {
  dust: 0, plume: 1, ash: 2, pyro: 3, steam: 4, spray: 5, skirt: 6, miasma: 7, smoke: 8, sand: 9, fog: 10, swarm: 11,
  rainCol: 12, cloud: 13, leaves: 14, bounty: 15, precip: 16, splash: 17, debrisDust: 18, snowfall: 19,
  embers: 20, lava: 21, sparks: 22, plasma: 23, motes: 24, shower: 25, flash: 26, sparkle: 27, glints: 28,
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

float h1(float a, float b) { return fract(sin(a * 127.1 + b * 311.7) * 43758.5453); }
vec4 emit(float row, float k) { return texelFetch(tEmit, ivec2(int(k), int(row)), 0); }
void hideMe() { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); vColor = vec4(0.0); }

void main() {
  vec4 blk = texelFetch(tBlocks, ivec2(int(mod(iBlock.x, 64.0)), int(iBlock.x / 64.0)), 0);
  if (blk.x < 0.0) { hideMe(); return; }
  float row = blk.x;
  vec4 E0 = emit(row, 0.0), E1 = emit(row, 1.0), E2 = emit(row, 2.0), E3 = emit(row, 3.0), E4 = emit(row, 4.0);
  float sys = E0.w;
  bool litSys = sys < 19.5;
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
  if (burst) {
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
  int S = int(sys + 0.5);
  if (S == 0 || S == 18) {
    // dust: thrown out low and wide, billowing up a little, settling; debris dust trails stay where they were shed
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
    a = smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.6, 1.0, age)) * 0.9;
    soft = 0.6 * sz;
    glow = vec3(1.0, 0.4, 0.1) * 6.0 * (1.0 - smoothstep(0.0, 0.18, age)) * (1.0 - capK);
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
    // lava glows into the column's foot
    glow = vec3(1.0, 0.32, 0.06) * 9.0 * (1.0 - smoothstep(0.0, 0.12, age)) * p2;
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
    vec3 ctr = O + up * H + (e1 * sin(now * 0.21 + seed) + e2 * cos(now * 0.17 + seed * 2.0)) * R0 * 0.3;
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
  } else if (S == 17) {
    // splashes: on whatever surface lies under a random point of the screen (the depth buffer, read here)
    vec2 suv = vec2(r1, r2);
    float sz0 = textureLod(tSceneDepth, suv, 0.0).r;
    if (sz0 > p0 || sz0 > 1e6) { hideMe(); return; }
    vec4 rd4 = uInvProj * vec4(suv * 2.0 - 1.0, 1.0, 1.0);
    vec3 rd = rd4.xyz / rd4.w;
    vec3 Sv = rd * (sz0 / max(-rd.z, 1e-6));
    p = uViewToBody * Sv + uCamBody;
    sz = size * (0.3 + 1.2 * age) * mix(0.6, 1.0, r3);
    a = (1.0 - smoothstep(0.1, 1.0, age)) * power * 0.8;
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
  } else if (S == 21) {
    // lava fountains: incandescent blobs in ballistic arcs from the vent, darkening as they fall back
    float s = p1;
    vec3 v0 = up * s * (0.7 + 0.5 * r2) + side * s * 0.35 * sqrt(r3);
    p += side * sqrt(r4) * p0 * 0.3 + v0 * tS - up * 4.9 * tS * tS;
    vel = v0 - up * 9.8 * tS;
    sz = size * (0.6 + 0.8 * r1);
    float cool = smoothstep(0.3, 1.0, age);
    c = mix(vec3(1.0, 0.62, 0.2), vec3(0.6, 0.08, 0.01), cool) * 30.0;
    a = smoothstep(0.0, 0.03, age) * (1.0 - smoothstep(0.85, 1.0, age));
    kind = 2.0;
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
  // ── shading of lit particles ──
  vLight = vec3(1.0);
  vGlow = glow * power;
  if (litSys) {
    float rP = length(p);
    vec3 upP = p / rP;
    vec3 sun = uSunE * sunTransmittance(rP, dot(upP, uSunDirBody));
    vec3 sky = skyIrradiance(upP, upP, uSunDirBody);
    vLight = sun * 0.24 + sky * 0.3 + vec3(0.002, 0.003, 0.005) + uMoonE * 0.15;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDir = vec2(0.0, 1.0);
  if (kind > 0.5 && kind < 1.5 || kind > 4.5 && kind < 5.5) {
    // a streak along its flight on screen
    vec3 vv = (modelViewMatrix * vec4(vel, 0.0)).xyz;
    vec2 d = length(vv.xy) > 1e-5 ? normalize(vv.xy) : vec2(0.0, 1.0);
    vDir = d;
    float stretch = kind > 4.5 ? clamp(length(vv.xy) * 0.06, 2.0, 14.0) : 1.0 + clamp(length(vv.xy) * 0.08, 0.0, 10.0);
    vec2 nrm = vec2(d.y, -d.x);
    mv.xy += nrm * corner.x * sz + d * corner.y * sz * stretch;
  } else if (kind > 7.5) {
    // a splash: a little crown, wider than tall, standing on the surface
    mv.xy += vec2(corner.x * sz * 1.6, (corner.y * 0.5 + 0.5) * sz * 0.8);
  } else {
    float rot = r3 * 6.2831853 + (litSys ? age * (r1 - 0.5) * 2.0 : 0.0);
    vec2 cc = vec2(cos(rot) * corner.x - sin(rot) * corner.y, sin(rot) * corner.x + cos(rot) * corner.y);
    mv.xy += cc * sz;
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
varying vec2 vCorner;
varying vec4 vColor;
varying float vViewZ;
varying float vSoft;
varying vec3 vLight;
varying float vKind;
varying vec2 vDir;
varying vec3 vGlow;
varying float vSeed;
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
    float lit = clamp(0.55 + 0.55 * dot(nrm.xy, uSunS) + 0.15 * nrm.z, 0.15, 1.2);
    float under = smoothstep(0.4, -0.8, nrm.y);
    float a = vColor.a * puff * fade;
    vec3 c = vColor.rgb * (vLight * lit + vGlow * (0.35 + 0.65 * under));
    gl_FragColor = vec4(c * a, a);
  } else if (vKind > 3.5 && vKind < 4.5) {
    // a swarm's speck: a dark body with a flicker of wings
    if (r > 1.0) discard;
    float body = smoothstep(1.0, 0.4, r);
    float wing = 0.5 + 0.5 * sin(uFxTime * 60.0 + vSeed);
    float a = vColor.a * body * fade * (0.7 + 0.3 * wing);
    gl_FragColor = vec4(vColor.rgb * vLight * 0.6 * a, a);
  } else if (vKind > 4.5 && vKind < 5.5) {
    // a rain streak: thin, brightest in the middle, lit by the sky
    float k = (1.0 - smoothstep(0.0, 1.0, abs(vCorner.x))) * (1.0 - smoothstep(0.6, 1.0, abs(vCorner.y)));
    float a = vColor.a * k * fade * 0.55;
    gl_FragColor = vec4(vColor.rgb * (vLight * 1.6 + 0.01) * a, a);
  } else if (vKind > 5.5 && vKind < 6.5) {
    // a leaf: a little lit ellipse turning in the air
    vec2 q = vCorner * vec2(1.0, 0.55);
    if (length(q) > 0.6) discard;
    float a = vColor.a * fade;
    gl_FragColor = vec4(vColor.rgb * vLight * 1.4 * a, a);
  } else if (vKind > 6.5 && vKind < 7.5) {
    // a lit blob (fruit, a snowflake, a hailstone)
    if (r > 1.0) discard;
    float sh = 0.6 + 0.4 * (1.0 - r) + 0.25 * max(0.0, -vCorner.y);
    float a = vColor.a * smoothstep(1.0, 0.75, r) * fade;
    gl_FragColor = vec4(vColor.rgb * vLight * 1.6 * sh * a, a);
  } else if (vKind > 7.5) {
    // a splash crown
    float k = (1.0 - smoothstep(0.7, 1.0, abs(vCorner.x))) * smoothstep(-1.0, -0.6, vCorner.y) * (1.0 - smoothstep(0.2, 1.0, vCorner.y));
    float ring = smoothstep(0.35, 0.85, abs(vCorner.x));
    float a = vColor.a * k * (0.4 + 0.6 * ring) * 0.6;
    gl_FragColor = vec4(vColor.rgb * vLight * 1.8 * a, a);
  } else if (vKind > 0.5 && vKind < 1.5) {
    // an emissive streak: hottest at its head
    float core = (1.0 - smoothstep(0.0, 1.0, abs(vCorner.x))) * smoothstep(-1.0, 0.6, vCorner.y) * (1.0 - smoothstep(0.85, 1.0, vCorner.y));
    float a = vColor.a * core * fade;
    gl_FragColor = vec4(vColor.rgb * a * fxDisplay(0.35), 0.0);
  } else if (vKind > 1.5 && vKind < 2.5) {
    // an emissive blob
    if (r > 1.0) discard;
    float k = pow(1.0 - r, 1.8);
    float a = vColor.a * k * fade;
    gl_FragColor = vec4(vColor.rgb * a * fxDisplay(0.35), 0.0);
  } else {
    // a flash: a soft sphere of light falling off like a glow
    float k = exp(-r * r * 4.0) + 0.25 * exp(-r * r * 0.8);
    gl_FragColor = vec4(vColor.rgb * k * vColor.a * fade * fxDisplay(0.2), 0.0);
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
    const t0 = d.t0 ?? now;
    const tEnd = d.duration !== undefined ? t0 + d.duration : d.burst ? t0 : 1e9;
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
