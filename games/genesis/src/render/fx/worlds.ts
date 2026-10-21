// GENESIS — world events (CONTRACT.md §11.1 worlds, §12, §15.7): what the god does to whole worlds, drawn.
//
//   crack     the ground splits from pole to pole: glowing fissures draped on the terrain (a lava-bright core, a dark
//             crust at their lips, cooling over the following days), a DEBRIS RING of instanced rocks orbiting in the
//             equatorial plane (Kepler: the inner rocks run faster, each tumbles) inside a banded dust annulus that the
//             planet shadows and the sun lights forward, and the moonlets the sim throws off (planets of their own) born
//             glowing and cooling
//   erase     the world collapses: a shell of the world veined with fire shrinks to a point, a flash, a shock ring and
//             a cloud of glowing debris flying apart and fading
//   moon-fall the moon spirals in (the sim's orbit) and grows in the sky; the sea heaps under it (planet/ocean.ts uTide:
//             the equilibrium tide, rougher water); near the end it burns in the air — a fiery ablation shell and a plume
//             of plasma behind it; the strike is the impact the god layer draws for every 'impact' event (fx/godfx.ts)
//   birth     a new world gathers out of a swirl of glowing dust spiralling in, a molten ball that cools and crusts
//             over to reveal the world beneath
// Ring rocks and fissures are opaque scene geometry (lit, depth-tested, hazed by the atmosphere composite); the dust,
// flashes, swirls and molten shells are drawn after the atmosphere (WORLD_LAYER), soft against the linear depth.

import {
  BackSide, BufferAttribute, BufferGeometry, CustomBlending, DoubleSide, DstColorFactor, Group, IcosahedronGeometry,
  InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, Matrix4, ZeroFactor, Mesh, OneFactor, OneMinusSrcAlphaFactor, PlaneGeometry, Quaternion, RingGeometry,
  ShaderMaterial, SphereGeometry, Vector2, Vector3, Vector4, type Camera, type IUniform, type Scene, type Texture,
  type WebGLRenderer, type WebGLRenderTarget,
} from 'three';
import type { PlanetView, WorldView } from '../../client/worldview.ts';
import { blackbody, bodyQuat, orbitOffset, type D3 } from '../../client/orbits.ts';
import { Rng, hashFloat } from '../../sim/core/rng.ts';
import { tangentBasis } from '../../sim/core/vec3.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { TICKS_PER_SECOND_1X } from '../../sim/types.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { FX_EXPOSURE } from './particles.ts';
import { sunIlluminance, type CameraPose } from '../frame.ts';

/** layer of the world overlays (after the atmosphere): see fx/launch.ts FX_LAYER for the other layers */
export const WORLD_LAYER = 7;

// ───────────────────────────── the debris ring ─────────────────────────────

const ROCK_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aOrbit;   // radius (m), phase (rad), height off the plane (m), size (m)
attribute vec4 aSpin;    // tumble axis xyz, rate (rad/s)
uniform float uT;        // seconds at 1× (render tick / TICKS_PER_SECOND_1X: the ring turns with the world's time)
uniform float uOmega;    // angular rate (rad/s) at radius uR0
uniform float uR0;
uniform float uResY;     // the render height (px): rocks under a pixel are left to the dust
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vRingPos;
varying float vSeed;
vec3 rotAxis(vec3 v, vec3 a, float t) { float c = cos(t), s = sin(t); return v * c + cross(a, v) * s + a * dot(a, v) * (1.0 - c); }
void main() {
  float r = aOrbit.x;
  // Kepler: ω ∝ r^-1.5
  float th = aOrbit.y + uT * uOmega * pow(uR0 / r, 1.5);
  vec3 c = vec3(cos(th) * r, aOrbit.z, -sin(th) * r);
  vec3 ax = normalize(aSpin.xyz);
  float ang = uT * aSpin.w + aOrbit.y * 7.0;
  vec3 p = rotAxis(position * aOrbit.w, ax, ang);
  vec3 n = rotAxis(normal, ax, ang);
  vLocal = position;
  vSeed = fract(aOrbit.y * 13.17);
  vRingPos = c + p;
  vN = normalize(normalMatrix * n);
  vec4 mv = modelViewMatrix * vec4(c + p, 1.0);
  gl_Position = projectionMatrix * mv;
  // a rock smaller than a pixel would only sparkle as a uniform speck: the dust stands for it
  vec4 mc = modelViewMatrix * vec4(c, 1.0);
  float px = aOrbit.w * projectionMatrix[1][1] * uResY * 0.5 / max(-mc.z, 1.0);
  if (px < 0.8) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
#include <logdepthbuf_vertex>
}
`;

const ROCK_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform vec3 uSunView;
uniform vec3 uSunRing;   // toward the sun in the ring's frame
uniform vec3 uSunE;
uniform float uPlanetR;
uniform float uHeat;     // a fresh crack's rubble still glows
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vRingPos;
varying float vSeed;
void main() {
#include <logdepthbuf_fragment>
  vec3 n = normalize(vN);
  float m = snoise(vLocal * 3.0 + vSeed * 9.0) * 0.5 + 0.5;
  vec3 alb = mix(vec3(0.07, 0.065, 0.06), vec3(0.2, 0.17, 0.14), m) * (0.55 + 0.9 * vSeed * vSeed);
  // the planet's shadow on the ring: does the ray toward the sun hit the world?
  vec3 P = vRingPos;
  float b = dot(P, uSunRing);
  float c = dot(P, P) - uPlanetR * uPlanetR;
  float disc = b * b - c;
  float shadow = (disc > 0.0 && -b - sqrt(disc) > 0.0) ? 0.0 : 1.0;
  float lam = max(0.0, dot(n, uSunView));
  vec3 col = alb * (uSunE * lam * shadow * 0.32 + vec3(0.004, 0.005, 0.007));
  // still-hot rubble: embers in the cracks of the rock
  col += vec3(1.0, 0.3, 0.06) * uHeat * smoothstep(0.62, 0.8, snoise(vLocal * 5.0 + vSeed * 3.0) * 0.5 + 0.5) * 3.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

const DUST_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vRingPos;
varying float vViewZ;
void main() {
  vRingPos = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;

/** the ring's optical depth at radius r (ring frame) and angle: ringlets of differing depth, clear lanes, clumps */
const RING_DENS_GLSL = /* glsl */ `
uniform float uInner;
uniform float uOuter;
uniform float uDensity;
uniform vec4 uGaps;
uniform vec4 uGapW;
float ringBand(float x) { return snoise(vec3(x * 9.0, 0.0, 1.0)) * 0.5 + 0.5; }
float ringDens(float r, float ang, float t) {
  float x = (r - uInner) / (uOuter - uInner);
  if (x < 0.0 || x > 1.0) return 0.0;
  // ringlets: sharp-edged bands of differing optical depth, finer grooves inside them
  float band = ringBand(x);
  float ringlet = 0.25 + 0.75 * smoothstep(0.3, 0.7, band);
  float fine = 0.72 + 0.28 * sin(x * 150.0 + snoise(vec3(x * 23.0, 2.0, 0.0)) * 4.0);
  float micro = 0.82 + 0.18 * snoise(vec3(x * 340.0, 3.0, 0.0));
  // clear lanes of differing widths (the moonlets' resonances sweep them)
  float gap = 1.0;
  for (int i = 0; i < 4; i++) gap *= smoothstep(uGapW[i] * 0.45, uGapW[i], abs(x - uGaps[i]));
  float edge = smoothstep(0.0, 0.05, x) * (1.0 - smoothstep(0.86, 1.0, x));
  // the ring's architecture: a faint inner sheet, a broad dense belt, one wide dark division, a middling outer ring
  // with its own lane, a tenuous fringe — not even bands
  float zone = 0.22 + 0.78 * smoothstep(0.16, 0.26, x);
  zone *= 1.0 - 0.92 * smoothstep(0.585, 0.6, x) * (1.0 - smoothstep(0.655, 0.67, x));
  zone *= mix(1.0, 0.55, smoothstep(0.66, 0.7, x));
  zone *= 1.0 - 0.8 * smoothstep(0.84, 0.85, x) * (1.0 - smoothstep(0.865, 0.875, x));
  zone *= mix(1.0, 0.3, smoothstep(0.9, 0.94, x));
  // clumps sheared by the orbits (inner faster)
  float w = t / pow(r / uInner, 1.5);
  float clump = 0.72 + 0.28 * snoise(vec3(cos(ang + w) * 4.0, sin(ang + w) * 4.0, x * 12.0));
  return ringlet * fine * micro * gap * edge * zone * clump * uDensity;
}
`;

const DUST_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
${RING_DENS_GLSL}
uniform vec3 uSunRing;
uniform vec3 uSunE;
uniform float uPlanetR;
uniform float uT;
uniform vec3 uCamRing;
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
varying vec3 vRingPos;
varying float vViewZ;
void main() {
#include <logdepthbuf_fragment>
  float sceneZ = texture(tSceneDepth, gl_FragCoord.xy / uResolution).r;
  if (vViewZ > sceneZ) discard;
  float r = length(vRingPos.xz);
  float ang = atan(vRingPos.z, vRingPos.x);
  float dens = ringDens(r, ang, uT * 0.02);
  if (dens <= 0.002) discard;
  float x = (r - uInner) / (uOuter - uInner);
  // the planet's shadow across the ring
  vec3 P = vRingPos;
  float b = dot(P, uSunRing);
  float c = dot(P, P) - uPlanetR * uPlanetR;
  float disc = b * b - c;
  float shadow = (disc > 0.0 && -b - sqrt(disc) > 0.0) ? 0.0 : 1.0;
  // dust scatters forward: a ring seen against the sun glows (a narrow bright lobe and a broad one); the lit face is
  // the grey-tan of its rubble, each ringlet its own shade
  vec3 V = normalize(P - uCamRing);
  float cs = max(0.0, dot(V, uSunRing));
  float fwd = pow(cs, 10.0) * 1.6 + pow(cs, 3.0) * 0.35;
  vec3 tint = mix(vec3(0.3, 0.26, 0.21), vec3(0.36, 0.34, 0.31), ringBand(x * 1.7 + 0.3));
  // (a thin ring seen edge-on lets more of the sun through: the lit face dims as the view grazes it)
  vec3 col = tint * uSunE * (0.12 + fwd) * shadow + vec3(0.002);
  float a = clamp(dens * 0.8, 0.0, 0.9);
  gl_FragColor = vec4(col * a, a);
}
`;

/** the ring's shadow on the world: where the sun's ray from a point on the ground crosses the ring, it dims */
const RINGSHADOW_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vViewPos;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;
const RINGSHADOW_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
${RING_DENS_GLSL}
uniform vec3 uSunRing;
uniform float uPlanetR;
uniform float uT;
uniform mat4 uViewToRing;
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
varying vec3 vViewPos;
void main() {
#include <logdepthbuf_fragment>
  float sceneZ = texture(tSceneDepth, gl_FragCoord.xy / uResolution).r;
  if (sceneZ > 1e6) discard;
  vec3 dir = normalize(vViewPos);
  vec3 S = dir * (sceneZ / max(-dir.z, 1e-5));
  vec3 P = (uViewToRing * vec4(S, 1.0)).xyz;
  // only the world's own surface (not a ship or a moon in front)
  if (length(P) > uPlanetR * 1.25) discard;
  if (abs(uSunRing.y) < 1e-4) discard;
  float t = -P.y / uSunRing.y;
  if (t <= 0.0) discard;
  vec3 H = P + uSunRing * t;
  float d = ringDens(length(H.xz), atan(H.z, H.x), uT * 0.02);
  // and the sun must be up there (the night side has no ring shadow to show)
  float day = smoothstep(-0.05, 0.1, dot(normalize(P), uSunRing));
  float k = clamp(d * 0.95, 0.0, 0.85) * day;
  gl_FragColor = vec4(vec3(1.0 - k), 1.0);
}
`;

interface RingVis {
  group: Group;
  rocks: InstancedMesh[];
  dust: Mesh;
  rockMat: ShaderMaterial;
  dustMat: ShaderMaterial;
  /** the ring's shadow on its world (a multiply over the composited ground) */
  shadow: Mesh;
  shadowMat: ShaderMaterial;
  key: string;
}

function rockGeometry(seed: number): BufferGeometry {
  const g = new IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position') as BufferAttribute;
  const rng = new Rng(seed);
  const sx = 0.7 + rng.float() * 0.6, sy = 0.5 + rng.float() * 0.5, sz = 0.7 + rng.float() * 0.6;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.75 + 0.5 * hashFloat(Math.round(x * 97), Math.round(y * 97), Math.round(z * 97) + seed);
    p.setXYZ(i, x * k * sx, y * k * sy, z * k * sz);
  }
  g.computeVertexNormals();
  return g;
}

function buildRing(R: number, ring: { inner: number; outer: number; density: number }, count: number, seed: number): RingVis {
  const group = new Group();
  group.name = 'debris-ring';
  const rng = new Rng(seed);
  // clear lanes: four, of differing widths, where the rubble is swept away (shared by the dust, the rocks, the shadow)
  const gaps = new Vector4(), gapW = new Vector4();
  for (let i = 0; i < 4; i++) { gaps.setComponent(i, 0.12 + 0.78 * rng.float()); gapW.setComponent(i, 0.004 + 0.03 * Math.pow(rng.float(), 2)); }
  const inGap = (x: number) => {
    if (x > 0.595 && x < 0.66) return true;
    for (let i = 0; i < 4; i++) if (Math.abs(x - gaps.getComponent(i)) < gapW.getComponent(i) * 0.7) return true;
    return false;
  };
  // (the ringlets' strength on the CPU: a smooth value noise of the radius, so the boulders crowd the dense bands)
  const bandAt = (x: number) => { const f = x * 9, i = Math.floor(f), t = f - i, a = hashFloat(i, seed, 0xb1), b = hashFloat(i + 1, seed, 0xb1); return a + (b - a) * t * t * (3 - 2 * t); };
  const rockMat = new ShaderMaterial({
    vertexShader: ROCK_VERT, fragmentShader: ROCK_FRAG,
    uniforms: {
      uT: { value: 0 }, uOmega: { value: 0.012 }, uR0: { value: ring.inner }, uSunView: { value: new Vector3(1, 0, 0) }, uSunRing: { value: new Vector3(1, 0, 0) },
      uSunE: { value: new Vector3(6, 6, 6) }, uPlanetR: { value: R }, uHeat: { value: 0 }, uResY: { value: 720 },
    },
  });
  const rocks: InstancedMesh[] = [];
  for (let v = 0; v < 3; v++) {
    const n = Math.round(count / 3);
    const geo = rockGeometry(seed * 7 + v);
    const orbit = new Float32Array(n * 4), spin = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      // radii: the dense belt and the strong ringlets get the most, the lanes none (rejection against both)
      let x = 0.5;
      for (let tries = 0; tries < 8; tries++) {
        x = rng.float() < 0.85 ? 0.5 + (rng.float() + rng.float() + rng.float() - 1.5) * 0.42 : rng.float();
        x = Math.max(0, Math.min(1, x));
        if (!inGap(x) && rng.float() < 0.3 + 0.7 * bandAt(x)) break;
      }
      const r = ring.inner + (ring.outer - ring.inner) * x;
      // sizes: a steep power law (pebbles of a few metres, a rare boulder the size of a hill)
      const s = 1.5 + 45 * Math.pow(rng.float(), 7) + (rng.float() < 0.006 ? 25 + 35 * rng.float() : 0);
      orbit.set([r, rng.float() * Math.PI * 2, (rng.float() - 0.5) * (ring.outer - ring.inner) * 0.02 * (0.4 + bandAt(x)), s], i * 4);
      const ax = [rng.float() - 0.5, rng.float() - 0.5, rng.float() - 0.5];
      spin.set([ax[0], ax[1], ax[2], (rng.float() - 0.5) * 0.6], i * 4);
    }
    geo.setAttribute('aOrbit', new InstancedBufferAttribute(orbit, 4));
    geo.setAttribute('aSpin', new InstancedBufferAttribute(spin, 4));
    const mesh = new InstancedMesh(geo, rockMat, n);
    mesh.frustumCulled = false;
    group.add(mesh);
    rocks.push(mesh);
  }
  const dens = { uInner: { value: ring.inner }, uOuter: { value: ring.outer }, uDensity: { value: ring.density }, uGaps: { value: gaps }, uGapW: { value: gapW } };
  const dustMat = new ShaderMaterial({
    vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, depthTest: false, side: DoubleSide,
    blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
    uniforms: {
      ...dens, uSunRing: rockMat.uniforms.uSunRing, uSunE: rockMat.uniforms.uSunE, uPlanetR: { value: R },
      uT: rockMat.uniforms.uT, uCamRing: { value: new Vector3() }, tSceneDepth: { value: null }, uResolution: { value: new Vector2(1, 1) },
    },
  });
  const dg = new RingGeometry(ring.inner * 0.98, ring.outer * 1.02, 384, 6);
  dg.rotateX(-Math.PI / 2);
  const dust = new Mesh(dg, dustMat);
  dust.frustumCulled = false;
  dust.layers.set(WORLD_LAYER);
  dust.renderOrder = 1;
  group.add(dust);
  // its shadow: a sphere round the world (front faces cover its disc on the screen) that dims the ground under the ring
  const shadowMat = new ShaderMaterial({
    // (back faces: one layer over the world's disc from outside, the whole view from inside the sphere)
    vertexShader: RINGSHADOW_VERT, fragmentShader: RINGSHADOW_FRAG, transparent: true, depthWrite: false, depthTest: false, side: BackSide,
    blending: CustomBlending, blendSrc: DstColorFactor, blendDst: ZeroFactor,
    uniforms: {
      ...dens, uSunRing: rockMat.uniforms.uSunRing, uPlanetR: { value: R }, uT: rockMat.uniforms.uT, uViewToRing: { value: new Matrix4() },
      tSceneDepth: dustMat.uniforms.tSceneDepth, uResolution: dustMat.uniforms.uResolution,
    },
  });
  const shadow = new Mesh(new SphereGeometry(R * 1.2, 64, 40), shadowMat);
  shadow.frustumCulled = false;
  shadow.layers.set(WORLD_LAYER);
  shadow.renderOrder = 0;
  group.add(shadow);
  return { group, rocks, dust, rockMat, dustMat, shadow, shadowMat, key: `${ring.inner}|${ring.outer}|${ring.density}|${count}` };
}

// ───────────────────────────── fissures ─────────────────────────────

const CRACK_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec2 aRib;    // across (−1..1 over the ribbon, which is three rift half-widths each side), along (m)
attribute vec3 aSide;   // the across direction on the ground (body frame, unit)
attribute float aW;     // the rift's half-width here (m)
uniform vec3 uSunDirBody;
varying vec2 vRib;
varying float vViewZ;
varying vec3 vRay;      // the eye's ray in the rift's own frame: (across, along, up)
varying vec3 vSunL;     // the sun in that frame
varying float vW;
void main() {
  vRib = aRib;
  vW = aW;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewZ = -mv.z;
  vec3 up = normalize(position);
  vec3 side = normalize(aSide - up * dot(aSide, up));
  vec3 along = cross(up, side);
  // (the planet group carries no scale: the body frame is the world's turned)
  vec3 eyeB = transpose(mat3(modelMatrix)) * ((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  vRay = vec3(dot(eyeB, side), dot(eyeB, along), dot(eyeB, up));
  vSunL = vec3(dot(uSunDirBody, side), dot(uSunDirBody, along), dot(uSunDirBody, up));
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;
const CRACK_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform float uHeat;
uniform float uTime;
uniform vec3 uSunE;
uniform sampler2D tExposure;
uniform float uHasExposure;
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
varying vec2 vRib;
varying float vViewZ;
varying vec3 vRay;
varying vec3 vSunL;
varying float vW;
// the chasm's cross-section (s: across in rift half-widths, already divided by the wandering width): steep walls
// falling from the lips to a narrow molten floor; depth in units of the half-width
float floorZ(float s) { float a = min(abs(s), 1.0); float a2 = a * a; return -(1.0 - a2 * a2 * a2); }
void main() {
#include <logdepthbuf_fragment>
  // drawn over the composited image, on the ground: hidden only where something stands clearly in front (a hill, a
  // wall) — the terrain's coarse far LODs may lie a little above the true ground the ribbon is draped on
  // (from orbit the terrain's coarse far LODs lie tens of metres off the true ground the ribbon is draped on: the
  // tolerance grows with distance, else a rift seen from 15 km is cut away by its own ground)
  float sceneZ = texture(tSceneDepth, gl_FragCoord.xy / uResolution).r;
  if (vViewZ > sceneZ * 1.015 + 6.0) discard;
  float u = vRib.x * 3.0, v = vRib.y;
  // a ragged rift: its width wanders along it, its lips break up
  float wv = 0.7 + 0.3 * snoise(vec3(v * 0.006, 1.0, 0.0)) + 0.15 * snoise(vec3(v * 0.03, 2.0, 0.0));
  float rag = 0.14 * snoise(vec3(v * 0.08, u * 0.7, 5.0));
  float lip = abs(u) / wv + rag;
  if (lip > 3.0) discard;
  float ex = uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 0.02) : 1.0;
  float K = mix(1.0, 1.0 / ex, 0.6) * 3.0;
  float flow = snoise(vec3(v * 0.03 - uTime * 0.15, u * 0.6, 3.0)) * 0.5 + 0.5;
  // how many pixels the chasm spans: from afar it is a line of fire, its walls under a pixel
  float px = fwidth(u);
  if (lip > 1.0) {
    // the glow of the fire on the ground either side (additive), the scorched, cracked lips, a halo that carries the
    // rift's light far (the bloom finds it from orbit)
    float g = exp(-(lip - 1.0) * 2.6) * uHeat;
    float sc = (1.0 - smoothstep(1.0, 1.7, lip)) * 0.7;
    float halo = exp(-(lip - 1.0) * 0.9) * uHeat * smoothstep(0.3, 1.0, px) * 0.4;
    gl_FragColor = vec4(vec3(1.0, 0.32, 0.07) * (g * 0.16 + halo) * K + vec3(0.02, 0.017, 0.014) * sc, sc);
    return;
  }
  // ── inside: march the eye's ray down into the chasm (walls, floor) ──
  vec3 rd = normalize(vRay);
  float W = max(vW * wv, 1.0);
  float D = 0.95;                       // depth / half-width
  float x0 = u / wv + rag;              // where the ray enters, in half-widths
  vec2 dir = normalize(vec2(rd.x, rd.z));
  // (units: half-widths across, depth in half-widths; the march steps in t along that 2-D section)
  float t = 0.0, tPrev = 0.0;
  float hitT = -1.0;
  float tMax = 2.4 + D / max(0.05, -dir.y);
  for (int i = 1; i <= 20; i++) {
    float tt = tMax * float(i) / 20.0;
    float x = x0 + dir.x * tt, z = dir.y * tt;
    if (z < D * floorZ(x)) { hitT = tt; tPrev = tMax * float(i - 1) / 20.0; break; }
  }
  if (hitT < 0.0) hitT = tMax;
  for (int i = 0; i < 5; i++) {
    float tm = 0.5 * (tPrev + hitT);
    float x = x0 + dir.x * tm, z = dir.y * tm;
    if (z < D * floorZ(x)) hitT = tm; else tPrev = tm;
  }
  float xh = x0 + dir.x * hitT;
  float h = clamp(-(dir.y * hitT) / D, 0.0, 1.0);         // 0 at the lips .. 1 on the floor
  // the wall's slope there, its normal in the (across, up) section
  float a = min(abs(xh), 1.0);
  float slope = D * 6.0 * a * a * a * a * a * sign(xh);
  vec2 n2 = normalize(vec2(-slope, 1.0));
  vec3 nL = vec3(n2.x, 0.0, n2.y);
  // rock: dark basalt strata in the walls, lit by the sun (when it reaches down) and by the fire below
  float strata = 0.5 + 0.5 * snoise(vec3(h * 9.0, v * 0.02, xh * 0.5 + 7.0));
  vec3 rock = mix(vec3(0.03, 0.026, 0.024), vec3(0.09, 0.075, 0.065), strata);
  float sunIn = max(0.0, dot(nL, vSunL)) * (1.0 - smoothstep(0.15, 0.8, h)) * step(0.0, vSunL.z);
  vec3 lit = rock * (uSunE * sunIn * 0.3 + vec3(0.004, 0.005, 0.007));
  // the glow climbing the walls from the magma, hotter with depth; cracks in the walls glowing through
  float cracks = smoothstep(0.62, 0.86, snoise(vec3(xh * 3.0, v * 0.05, h * 4.0)) * 0.5 + 0.5);
  float hot = pow(h, 3.0);
  vec3 magma = mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.55, 0.12), hot * (0.6 + 0.4 * flow));
  magma = mix(magma, vec3(1.0, 0.86, 0.55), smoothstep(0.96, 1.0, h) * flow * uHeat);
  float I = (0.22 * hot + 2.8 * smoothstep(0.94, 1.0, h) * (0.7 + 0.3 * flow) + cracks * 0.45 * h) * uHeat;
  // from afar the chasm is mostly its fire (the walls under a pixel): the floor's light spreads over its whole width
  float far = smoothstep(0.5, 1.2, px);
  I = mix(I, (0.9 + 0.8 * flow) * uHeat, far);
  vec3 col = lit * (1.0 - far) + rock * magma * hot * 2.0 + magma * I * K;
  gl_FragColor = vec4(col, 1.0);
}
`;

/** steam and smoke rising from the rifts: looping puffs over each vent, lit by the sun above and the magma below */
const VENT_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec2 corner;
attribute vec4 iV;      // vent (body frame), the rift's half-width there
attribute vec2 iS;      // puff index phase (0..1), seed
uniform float uT;       // seconds of sim-paced time (real seconds at 1×, never faster; frozen while paused)
uniform float uHeat;
uniform vec3 uWindB;
uniform vec3 uSunDirBody;
uniform vec3 uSunE;
varying vec2 vC;
varying float vA;
varying vec3 vLight;
varying vec3 vGlow;
varying float vViewZ;
varying float vSeed;
varying float vSize;
void main() {
  float life = 70.0 + 50.0 * iS.y;
  float a = fract(uT / life + iS.x + iS.y * 0.37);
  vec3 up = normalize(iV.xyz);
  float W = iV.w;
  float H = 140.0 + W * 6.0;
  vec3 p = iV.xyz + up * (H * pow(a, 0.75) + 4.0) + uWindB * (a * life * 0.6) + cross(up, vec3(0.3, 1.0, 0.2)) * (iS.y - 0.5) * W * 0.8;
  float sz = W * 0.55 + (W * 1.2 + 40.0) * sqrt(a);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float rot = iS.y * 6.2831 + a * 1.5;
  vec2 c = vec2(cos(rot) * corner.x - sin(rot) * corner.y, sin(rot) * corner.x + cos(rot) * corner.y);
  mv.xy += c * sz;
  gl_Position = projectionMatrix * mv;
  vC = corner;
  vSeed = iS.y;
  vSize = sz;
  vViewZ = -mv.z;
  vA = smoothstep(0.0, 0.08, a) * (1.0 - smoothstep(0.45, 1.0, a)) * (0.35 + 0.65 * uHeat);
  float sunUp = dot(up, uSunDirBody);
  vLight = uSunE * max(0.0, sunUp + 0.15) * 0.22 + vec3(0.006, 0.008, 0.012);
  // the magma's light from below, strongest low in the column
  vGlow = vec3(1.0, 0.36, 0.08) * exp(-a * 3.5) * uHeat;
#include <logdepthbuf_vertex>
}
`;
const VENT_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform sampler2D tSceneDepth;
uniform sampler2D tExposure;
uniform float uHasExposure;
uniform vec2 uResolution;
varying vec2 vC;
varying float vA;
varying vec3 vLight;
varying vec3 vGlow;
varying float vViewZ;
varying float vSeed;
varying float vSize;
void main() {
#include <logdepthbuf_fragment>
  float sceneZ = texture(tSceneDepth, gl_FragCoord.xy / uResolution).r;
  if (vViewZ > sceneZ + 0.1) discard;
  float fade = clamp((sceneZ - vViewZ) / max(1.0, vSize * 0.5), 0.0, 1.0);
  float r = length(vC);
  float n = snoise(vec3(vC * 1.7, vSeed * 23.0));
  float puff = smoothstep(1.0, 0.25, r * (1.0 - 0.25 * n));
  float a = vA * puff * fade * 0.42;
  if (a < 0.003) discard;
  float ex = uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 0.02) : 1.0;
  vec3 steam = vec3(0.7, 0.7, 0.72) * (vLight * (0.75 + 0.25 * n));
  vec3 under = vGlow * mix(1.0, 1.0 / ex, 0.6) * 0.5 * smoothstep(0.6, -0.4, vC.y);
  gl_FragColor = vec4((steam + under) * a, a);
}
`;
/** the rifts' light on the cloud deck above them (where the sim's clouds are), added over the composited sky */
const CLOUDGLOW_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec2 aRib;
attribute vec3 aSide;
attribute float aW;
uniform float uCloudR;
varying vec3 vB;
varying float vAcross;
varying float vViewZ;
void main() {
  vec3 centre = position - aSide * aRib.x * 3.0 * aW;
  vec3 q = centre + aSide * aRib.x * 3.0 * aW * 2.6;
  vec3 p = normalize(q) * uCloudR;
  vB = p;
  vAcross = aRib.x;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;
const CLOUDGLOW_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform samplerCube uCloudCov;
uniform float uCloudOn;
uniform float uHeat;
uniform sampler2D tSceneDepth;
uniform sampler2D tExposure;
uniform float uHasExposure;
uniform vec2 uResolution;
varying vec3 vB;
varying float vAcross;
varying float vViewZ;
void main() {
#include <logdepthbuf_fragment>
  if (uCloudOn < 0.5) discard;
  float sceneZ = texture(tSceneDepth, gl_FragCoord.xy / uResolution).r;
  if (vViewZ > sceneZ * 1.002 + 10.0) discard;
  float cov = texture(uCloudCov, normalize(vB)).r;
  float k = smoothstep(0.15, 0.7, cov) * exp(-vAcross * vAcross * 4.0) * uHeat;
  float ex = uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 0.02) : 1.0;
  gl_FragColor = vec4(vec3(1.0, 0.34, 0.08) * k * 0.6 * mix(1.0, 1.0 / ex, 0.6), 0.0);
}
`;

interface CrackVis { mesh: Mesh; mat: ShaderMaterial; t0: number; group: Group | null; vents: Mesh | null; ventMat: ShaderMaterial | null; glow: Mesh | null; glowMat: ShaderMaterial | null }

/**
 * fissures across a world: meandering great-circle paths draped on the ground, as ribbons with across / along coords,
 * seven vertices across (each on its own ground height, so a wide rift follows the land); returns the vents (points on
 * the rifts, body frame + their half-width) where steam and smoke rise
 */
function buildCracks(pv: PlanetView, seed: number): { geo: BufferGeometry; vents: Float32Array } {
  const R = pv.params.radius;
  const sea = pv.fields.get('water') ? R + pv.params.seaLevel : -Infinity;
  const rng = new Rng(seed);
  const pos: number[] = [], rib: number[] = [], side3: number[] = [], wid: number[] = [], idx: number[] = [];
  const vents: number[] = [];
  const ACROSS = [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1];
  const NA = ACROSS.length;
  const paths = 7;
  for (let k = 0; k < paths; k++) {
    // two long rifts run from pole to pole; the rest branch off
    const main = k < 2;
    const lenM = (main ? 1.0 : 0.25 + rng.float() * 0.35) * Math.PI * R;
    const step = 22;
    const n = Math.floor(lenM / step);
    let p: D3 = main ? [Math.cos(k * 2.1 + seed) * 0.15, 0.98, Math.sin(k * 2.1 + seed) * 0.15] : [rng.float() - 0.5, (rng.float() - 0.5) * 1.4, rng.float() - 0.5];
    let l = Math.hypot(p[0], p[1], p[2]); p = [p[0] / l, p[1] / l, p[2] / l];
    const e: D3 = [0, 0, 0], no: D3 = [0, 0, 0];
    tangentBasis(e, no, p);
    let h = main ? Math.PI + (rng.float() - 0.5) * 0.6 : rng.float() * Math.PI * 2;
    // rift half-widths (wide magma chasms: they read from orbit); the ribbon is three times as wide, for the glow
    const W0 = main ? 58 : 20 + rng.float() * 16;
    let along = 0;
    let prev = -1;
    for (let i = 0; i <= n; i++) {
      tangentBasis(e, no, p);
      const d: D3 = [no[0] * Math.cos(h) + e[0] * Math.sin(h), no[1] * Math.cos(h) + e[1] * Math.sin(h), no[2] * Math.cos(h) + e[2] * Math.sin(h)];
      const side: D3 = [p[1] * d[2] - p[2] * d[1], p[2] * d[0] - p[0] * d[2], p[0] * d[1] - p[1] * d[0]];
      const W = W0 * (0.6 + 0.4 * Math.sin(i * 0.11 + k)) * (i < 4 || i > n - 4 ? 0.3 : 1);
      const w = W * 3;
      const base = pos.length / 3;
      let wet = false;
      for (const sx of ACROSS) {
        const q: D3 = [p[0] + side[0] * (sx * w) / R, p[1] + side[1] * (sx * w) / R, p[2] + side[2] * (sx * w) / R];
        const ql = Math.hypot(q[0], q[1], q[2]);
        const u: D3 = [q[0] / ql, q[1] / ql, q[2] / ql];
        const g0 = groundHeight(pv.ground, u[0], u[1], u[2]);
        const g = g0 + 0.6;
        pos.push(u[0] * g, u[1] * g, u[2] * g);
        if (g0 < sea) wet = true;
        rib.push(sx, along);
        side3.push(side[0], side[1], side[2]);
        wid.push(W);
      }
      // under the sea the rift goes on unseen (its ribbon is cut there: beyond the lips, discarded)
      if (wet) for (let j = 0; j < NA; j++) rib[(base + j) * 2] = ACROSS[j] < 0 ? -1.2 : 1.2;
      else if (i % 9 === 4 && W > 10) { const g = groundHeight(pv.ground, p[0], p[1], p[2]); vents.push(p[0] * g, p[1] * g, p[2] * g, W); }
      if (prev >= 0) for (let j = 0; j < NA - 1; j++) idx.push(prev + j, prev + j + 1, base + j + 1, prev + j, base + j + 1, base + j);
      prev = base;
      // walk on: the heading meanders
      h += (rng.float() - 0.5) * 0.35;
      const a = step / R;
      p = [p[0] * Math.cos(a) + d[0] * Math.sin(a), p[1] * Math.cos(a) + d[1] * Math.sin(a), p[2] * Math.cos(a) + d[2] * Math.sin(a)];
      l = Math.hypot(p[0], p[1], p[2]); p = [p[0] / l, p[1] / l, p[2] / l];
      along += step;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aRib', new BufferAttribute(new Float32Array(rib), 2));
  g.setAttribute('aSide', new BufferAttribute(new Float32Array(side3), 3));
  g.setAttribute('aW', new BufferAttribute(new Float32Array(wid), 1));
  g.setIndex(pos.length / 3 > 65535 ? new BufferAttribute(new Uint32Array(idx), 1) : new BufferAttribute(new Uint16Array(idx), 1));
  g.computeBoundingSphere();
  return { geo: g, vents: new Float32Array(vents) };
}

// ───────────────────────────── erase, birth, the falling moon (overlays) ─────────────────────────────

const GLOW_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec2 uDir;      // the quad's +y on the screen (view xy)
uniform float uOffset;  // shift along it (in quad half-sizes): a tail starts at its body
uniform float uFront;   // depth test against this many metres nearer than the centre (a body's face, not its middle)
varying vec2 vUv;
varying float vViewZ;
void main() {
  vUv = uv * 2.0 - 1.0;
  // a camera-facing quad of the object's scale, turned to uDir
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(modelMatrix[0].xyz);
  vec2 p = position.xy;
  mv.xy += (p.x * vec2(uDir.y, -uDir.x) + p.y * uDir + uDir * uOffset) * s;
  vViewZ = -mv.z - uFront;
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;
const GLOW_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform vec3 uColor;
uniform float uKind;     // 0 flash, 1 shock ring, 2 accretion swirl, 3 ablation shell, 4 plasma tail, 5 a burning face
uniform float uK;        // 0..1 progress / strength
uniform float uTime;
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
uniform float uDepthTest;
uniform sampler2D tExposure;
uniform float uHasExposure;
varying vec2 vUv;
varying float vViewZ;
void main() {
#include <logdepthbuf_fragment>
  if (uDepthTest > 0.5) { float sz = texture(tSceneDepth, gl_FragCoord.xy / uResolution).r; if (vViewZ > sz * 1.002) discard; }
  float r = length(vUv);
  if (r > 1.0) discard;
  vec3 c = vec3(0.0);
  // (a flash and its shock ring are display-referred, like fire: the exposure of a dark sky must not lift the faint
  // tail of a fading flash into a haze over the whole frame)
  float ex = uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 0.02) : 1.0;
  float dk = mix(1.0, 1.0 / ex, 0.85);
  if (uKind < 0.5) {
    c = uColor * (exp(-r * r * 9.0) * 3.0 + exp(-r * 3.5) * 0.6 * (1.0 - r * r)) * uK * dk;
  } else if (uKind < 1.5) {
    float ring = exp(-pow((r - uK) / 0.035, 2.0)) * (1.0 - uK);
    c = uColor * ring * 1.5 * dk;
  } else if (uKind < 2.5) {
    // a disc of dust spiralling in: logarithmic arms turning, thinning toward the centre as it gathers
    float a = atan(vUv.y, vUv.x);
    float arms = 0.5 + 0.5 * sin(3.0 * a - 7.0 * log(max(r, 0.02)) + uTime * 1.6);
    float n = snoise(vec3(vUv * 6.0, uTime * 0.3)) * 0.5 + 0.5;
    // filaments wound along the arms (dust lanes, not a smooth glow)
    // (noise of the arm's phase through its cosine and sine: no seam where the angle wraps)
    float ph = 3.0 * a - 7.0 * log(max(r, 0.02));
    float fil = 0.45 + 0.55 * smoothstep(0.2, 0.8, snoise(vec3(r * 18.0 - uTime * 0.4, cos(ph) * 1.6, sin(ph) * 1.6)) * 0.5 + 0.5);
    float inner = smoothstep(0.08 + 0.25 * uK, 0.3 + 0.3 * uK, r);
    float outer = 1.0 - smoothstep(0.6 * (1.0 - uK) + 0.2, 1.0 - 0.5 * uK, r);
    vec3 dustC = mix(uColor * vec3(0.8, 0.55, 0.45), uColor, smoothstep(0.6, 0.15, r));
    c = dustC * pow(arms, 2.0) * (0.4 + 0.6 * n) * fil * inner * outer * (1.0 - uK * 0.85) * 1.3;
  } else if (uKind < 3.5) {
    // ablation: a burning shell round the falling body
    float shell = smoothstep(0.55, 0.75, r) * (1.0 - smoothstep(0.75, 1.0, r));
    float n = snoise(vec3(vUv * 5.0, uTime * 2.0)) * 0.5 + 0.5;
    c = uColor * (shell * (0.6 + 0.8 * n) + exp(-r * r * 2.0) * 0.15) * uK * 2.5;
  } else if (uKind > 4.5) {
    // a moon breaking up inside the Roche limit: the grey, sunlit body stays itself, split by a web of fractures —
    // dark rifts with a dull red glow deep in them, widening as it comes apart (uK: the break-up). The quad is sized so
    // the silhouette lies at r ≈ 0.93; nothing is drawn between the rifts
    float rr = min(1.0, r / 0.9);
    float mu = sqrt(max(0.0, 1.0 - rr * rr));
    // the rifts run over the visible face (a 3-D noise on the sphere point under this pixel: they curve with it)
    vec3 sp = vec3(vUv / 0.9, mu);
    float w = 0.012 + 0.05 * uK;
    float f1 = 1.0 - smoothstep(0.0, w, abs(snoise(sp * 2.6 + 1.7)));
    float f2 = (1.0 - smoothstep(0.0, w * 0.7, abs(snoise(sp * 6.1 + 4.2)))) * smoothstep(0.25, 0.8, uK);
    float rift = max(f1, f2 * 0.8) * (1.0 - smoothstep(0.86, 0.93, r));
    float glowK = rift * (0.35 + 0.65 * smoothstep(0.3, 1.0, uK)) * (0.5 + 0.5 * mu);
    vec3 col = vec3(0.012, 0.009, 0.008) + vec3(1.0, 0.28, 0.06) * glowK * 0.9;
    float a = rift * clamp(uK * 3.0, 0.0, 1.0) * 0.92;
    gl_FragColor = vec4(col * a, a);
    return;
  } else {
    // a tail of plasma along +y of the quad: as wide as the body at its head, streaming back in torn ribbons, white-hot
    // at the root through orange to a dull red as it trails off
    float x = vUv.x, y = vUv.y * 0.5 + 0.5;
    float w = 0.22 * (1.0 - y) * (1.0 - y) + 0.04 + 0.04 * y;
    float streak = 0.55 + 0.45 * (snoise(vec3(x * 9.0 / max(w, 0.05), y * 3.0 - uTime * 2.4, 1.0)) * 0.5 + 0.5);
    float torn = smoothstep(0.15, 0.6, snoise(vec3(x * 3.0, y * 5.0 - uTime * 1.7, 4.0)) * 0.5 + 0.5 + (1.0 - y) * 0.5);
    // (the root rises from behind the body: no edge where the quad begins)
    float body = exp(-pow(x / w, 2.0)) * exp(-y * 3.2) * streak * torn * smoothstep(0.0, 0.12, y);
    vec3 heat = mix(vec3(0.9, 0.18, 0.05), mix(vec3(1.0, 0.55, 0.15), vec3(1.0, 0.9, 0.75), smoothstep(0.75, 0.95, 1.0 - y)), smoothstep(0.3, 0.9, 1.0 - y));
    c = heat * body * uK * 3.0;
  }
  gl_FragColor = vec4(c, 0.0);
}
`;

const SHELL_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vP;
varying vec3 vN;
varying vec3 vV;
varying float vViewZ;
void main() {
  vP = position;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;
const SHELL_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform float uHeat;    // 1 molten .. 0 cold
uniform float uAlpha;   // cover (the molten birth shell fades away to reveal the world)
uniform float uCracks;  // a world breaking: fire in the cracks
uniform vec3 uSunView;
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
uniform sampler2D tExposure;
uniform float uHasExposure;
varying vec3 vP;
varying vec3 vN;
varying vec3 vV;
varying float vViewZ;
void main() {
#include <logdepthbuf_fragment>
  float sz = texture(tSceneDepth, gl_FragCoord.xy / uResolution).r;
  if (vViewZ > sz * 1.01 + 2.0) discard;
  vec3 n = normalize(vN);
  vec3 p = normalize(vP);
  float n1 = snoise(p * 4.0) * 0.5 + 0.5;
  float n2 = snoise(p * 13.0) * 0.5 + 0.5;
  float cells = 1.0 - smoothstep(0.0, 0.08, abs(n1 - 0.5));
  float cracks = 1.0 - smoothstep(0.0, 0.05, abs(n2 - 0.5));
  vec3 rock = mix(vec3(0.05, 0.045, 0.04), vec3(0.13, 0.11, 0.09), n1);
  float lam = max(0.0, dot(n, uSunView));
  vec3 col = rock * (lam * 3.0 + 0.02);
  // molten: the whole surface glows, crusting over as it cools (dark plates, bright seams)
  float crust = smoothstep(0.2, 0.9, 1.0 - uHeat) * smoothstep(0.35, 0.65, n1 * 0.7 + n2 * 0.3);
  // (deep reds and oranges at a moderate level: the tone curve bleaches a bright molten ball to cream)
  vec3 lava = mix(vec3(1.0, 0.24, 0.03), vec3(1.0, 0.58, 0.18), uHeat * n2) * (0.5 + 0.7 * uHeat);
  float ex = uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 0.02) : 1.0;
  float k = mix(1.0, 1.0 / ex, 0.5) * 2.0;
  col = mix(lava * k * uHeat, col, crust) + vec3(1.0, 0.3, 0.05) * (cells * 0.6 + cracks) * (uCracks + uHeat * 0.4) * k;
  float a = uAlpha;
  gl_FragColor = vec4(col * a, a);
}
`;

interface Burst {
  kind: 'erase' | 'birth' | 'strike';
  /** system-frame centre (erase: where the world was; birth: follows the planet; strike: the point of contact) */
  sys: D3;
  /** strike: system-frame outward normal at the contact, and the struck world */
  up: D3 | null;
  planet: number;
  R: number;
  /** real seconds and render tick it began at: it plays on the slower of the two clocks (paused: it waits; a stepped
   * capture: it plays with the steps; at 100× it still takes its seconds) */
  t0: number;
  tick0: number;
  group: Group;
  shell: Mesh;
  glows: Mesh[];
  debris: InstancedMesh | null;
  debrisMat: ShaderMaterial | null;
  done: boolean;
}

const DEBRIS_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aDir;   // direction xyz, speed (radii / s)
uniform float uT;
uniform float uR;
uniform vec3 uBias;    // a strike throws its ejecta up and out of the ground (0 for an erasure: every way)
varying float vHeat;
void main() {
  float t = uT;
  vec3 dir = normalize(normalize(aDir.xyz) + uBias);
  vec3 c = dir * uR * (0.3 + aDir.w * t);
  float s = uR * 0.012 * (0.5 + fract(aDir.w * 37.0)) * (1.0 - smoothstep(4.0, 9.0, t));
  vHeat = exp(-t * 0.5);
  vec4 mv = modelViewMatrix * vec4(c + position * s, 1.0);
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;
const DEBRIS_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform float uFade;
varying float vHeat;
void main() {
#include <logdepthbuf_fragment>
  vec3 c = mix(vec3(0.08, 0.06, 0.05), vec3(1.0, 0.42, 0.1) * 6.0, vHeat);
  gl_FragColor = vec4(c * uFade, 1.0);
}
`;

// ───────────────────────────── a moon torn apart (the Roche break-up) ─────────────────────────────

/**
 * Fragments peeling off a falling moon in its last hours, in the host's frame (system axes, host at the origin): two
 * tidal streams along the moon's orbit — the leading one sinking inward ahead of it (into the air, where its pieces
 * burn), the trailing one lagging outward behind. Each piece's place is a function of the break-up progress, so a
 * capture, a pause or a step shows the same stream.
 */
const SHARD_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec4 aF;   // side (+1 leading, −1 trailing), how far along the stream it goes (0..1), radial jitter, vertical jitter
attribute vec4 aG;   // size (m), onset (0..1 of the break-up), spin seed, spin rate (rad per second at 1×)
uniform vec3 uE1;
uniform vec3 uE2;
uniform vec3 uNrm;
uniform float uA;
uniform float uB;
uniform float uRm;
uniform float uR;
uniform float uAir;
uniform float uT;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vP;
varying float vHeat;
varying float vSeed;
vec3 rotA(vec3 v, vec3 a, float t) { float c = cos(t), s = sin(t); return v * c + cross(a, v) * s + a * dot(a, v) * (1.0 - c); }
void main() {
  float q = clamp((uB - 0.6 * aG.y) / max(1.0 - 0.6 * aG.y, 1e-3), 0.0, 1.0);
  float side = aF.x;
  float dth = side * (uRm / uA * 1.05 + q * aF.y * 0.9);
  // (the leading stream loses its height and falls toward the world — the farthest along reach the air and burn; the
  // trailing one is flung outward)
  float r = side > 0.0 ? max(uR + 20.0, uR + (uA - uR) * (1.0 - q * aF.y * 0.98) + aF.z * uRm * 0.3) : uA * (1.0 + q * aF.y * 0.25) + aF.z * uRm * 0.45;
  float h = aF.w * uRm * 0.55 * (1.0 - 0.4 * q);
  vec3 c = (cos(dth) * uE1 + sin(dth) * uE2) * r + uNrm * h;
  float sz = aG.x * step(0.001, q);
  vec3 ax = normalize(vec3(fract(aG.z * 7.13) - 0.5, fract(aG.z * 13.71) - 0.5, fract(aG.z * 3.37) - 0.5) + vec3(1e-3));
  float ang = uT * aG.w + aG.z * 10.0;
  vec3 p = rotA(position * sz, ax, ang);
  vN = normalize(normalMatrix * rotA(normal, ax, ang));
  vLocal = position;
  vP = c + p;
  vSeed = aG.z;
  vHeat = smoothstep(uAir * 1.3, uAir * 0.1, length(c) - uR) * q;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(c + p, 1.0);
#include <logdepthbuf_vertex>
}
`;

const SHARD_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform vec3 uSunView;
uniform vec3 uSunSys;
uniform vec3 uSunE;
uniform float uR;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vP;
varying float vHeat;
varying float vSeed;
void main() {
#include <logdepthbuf_fragment>
  vec3 n = normalize(vN);
  float m = snoise(vLocal * 3.0 + vSeed * 9.0) * 0.5 + 0.5;
  // the moon's own grey regolith over darker fresh rock from inside it
  vec3 alb = mix(vec3(0.09, 0.088, 0.085), vec3(0.24, 0.235, 0.225), m);
  // the host's shadow
  float b = dot(vP, uSunSys);
  float c = dot(vP, vP) - uR * uR;
  float disc = b * b - c;
  float shadow = (disc > 0.0 && -b - sqrt(disc) > 0.0) ? 0.0 : 1.0;
  vec3 col = alb * (uSunE * max(0.0, dot(n, uSunView)) * shadow * 0.32 + vec3(0.004, 0.005, 0.007));
  // a piece in the air burns: its face toward the flow white-hot, the rest glowing through cracks
  float cr = smoothstep(0.55, 0.8, snoise(vLocal * 4.0 + vSeed * 5.0) * 0.5 + 0.5);
  col += vec3(1.0, 0.36, 0.08) * vHeat * (2.0 + 6.0 * cr);
  gl_FragColor = vec4(col, 1.0);
}
`;

interface MoonBreak { group: Group; mesh: InstancedMesh; mat: ShaderMaterial; streaks: Mesh[]; params: Float32Array; sizes: Float32Array }

const SHARDS = 640;
const STREAKS = 14;

const _v = new Vector3();
const _v2 = new Vector3();
const _bA = new Vector3();
const _bB = new Vector3();
const _bC = new Vector3();
const _bD = new Vector3();
const _q = new Quaternion();
const _bb: D3 = [1, 1, 1];
const _o0: D3 = [0, 0, 0];
const _o1: D3 = [0, 0, 0];

export interface WorldPlanetRef { group: Group; uniforms: Record<string, IUniform>; pv: PlanetView }

/** the live world-event layer (the renderer's): for the test surface and the shot harness's scripts */
export const WORLD_FX: { last: WorldFx | null } = { last: null };

export class WorldFx {
  /** overlays in the system frame (erase, birth, the falling moon's fire), placed relative to the camera */
  readonly spaceGroup = new Group();
  private rings = new Map<number, RingVis>();
  private ringGroups = new Map<number, Group>();
  private cracks = new Map<number, CrackVis>();
  private crackedAt = new Map<number, number>();
  private bursts: Burst[] = [];
  private known = new Map<number, { sys: D3; R: number; parent: number }>();
  private started = false;
  private moonGlows = new Map<number, { shell: Mesh; tail: Mesh; face: Mesh }>();
  /** moons breaking up (their rubble streams), and those seen this frame */
  private breaks = new Map<number, MoonBreak>();
  private breakSeen = new Set<number>();
  private rockGeo: BufferGeometry | null = null;
  /** moons falling this frame (a falling moon that vanishes has struck: a strike, not an erasure) */
  private falling = new Map<number, { host: number; dir: D3; R: number; Rm: number }>();
  private fellLast = new Map<number, { host: number; dir: D3; R: number; Rm: number }>();
  private glowGeo = new PlaneGeometry(2, 2);
  private sphereGeo = new SphereGeometry(1, 64, 40);
  private uniformsShared: { tSceneDepth: IUniform<Texture | null>; uResolution: IUniform<Vector2> } = { tSceneDepth: { value: null }, uResolution: { value: new Vector2(1, 1) } };
  private tickNow = 0;
  /**
   * the vents' steam clock (godfx.ts's FX clock): real seconds at 1× (1× is TICKS_PER_SECOND_1X ticks a second, LIVING
   * §1.1), never faster than real time — a looping puff that rose for a minute at 1× strobed in a few frames at 300× —
   * and frozen while the sim is paused (the lava beside it flows on wall time)
   */
  private ventClock = 0;
  private ventReal = -1;
  private ventTick = 0;
  /** rock count (quality) */
  rockBudget = 2400;

  constructor() {
    this.spaceGroup.name = 'world-fx';
    WORLD_FX.last = this;
  }

  private glowMat(kind: number, color: [number, number, number], depthTest: boolean): ShaderMaterial {
    // (light is added; a burning face, kind 5, covers what is under it: premultiplied alpha)
    return new ShaderMaterial({
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: CustomBlending, blendSrc: OneFactor, blendDst: kind === 5 ? OneMinusSrcAlphaFactor : OneFactor,
      uniforms: {
        uColor: { value: new Vector3(...color) }, uKind: { value: kind }, uDir: { value: new Vector2(0, 1) }, uOffset: { value: 0 }, uFront: { value: 0 }, uK: { value: 0 }, uTime: { value: 0 }, uDepthTest: { value: depthTest ? 1 : 0 },
        tSceneDepth: this.uniformsShared.tSceneDepth, uResolution: this.uniformsShared.uResolution, tExposure: FX_EXPOSURE, uHasExposure: this.hasExposure,
      },
    });
  }
  /** (shared: whether the post pipeline's exposure texture exists yet) */
  private hasExposure: IUniform<number> = { value: 0 };

  private shellMat(): ShaderMaterial {
    return new ShaderMaterial({
      vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, depthWrite: false, depthTest: false,
      blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
      uniforms: {
        uHeat: { value: 1 }, uAlpha: { value: 1 }, uCracks: { value: 0 }, uSunView: { value: new Vector3(1, 0, 0) },
        tSceneDepth: this.uniformsShared.tSceneDepth, uResolution: this.uniformsShared.uResolution, tExposure: FX_EXPOSURE, uHasExposure: { value: 1 },
      },
    });
  }

  /** this frame: rings, fissures, tides, the falling moons' fire, erasures and births */
  update(view: WorldView, pose: CameraPose, planets: Map<number, WorldPlanetRef>, scene: Scene, time: number, camQuatInv: Quaternion): void {
    if (this.spaceGroup.parent !== scene) scene.add(this.spaceGroup);
    const tick = view.renderTick;
    this.tickNow = tick;
    if (this.ventReal >= 0) {
      const realDt = Math.max(0, Math.min(0.1, time - this.ventReal));
      const dTick = tick - this.ventTick;
      if (dTick > 1e-6) this.ventClock += Math.min(realDt, dTick / TICKS_PER_SECOND_1X + 1e-3);
    }
    this.ventReal = time;
    this.ventTick = tick;
    // ── who is here: worlds that vanished (erased), worlds that appeared (born) ──
    if (view.snapshots > 0) {
      const now = new Map<number, PlanetView>();
      for (const pv of view.planets) if (pv.alive !== false) now.set(pv.id, pv);
      if (this.started) {
        const gone = [...this.known.keys()].filter((id) => !now.has(id));
        const born = [...now.keys()].filter((id) => !this.known.has(id));
        // a whole new universe (a load, a reset): no worlds died or were born, the view simply changed
        const reload = (gone.length > 0 && gone.length >= this.known.size) || born.length > 3 || gone.length > 6;
        if (!reload) {
          for (const id of gone) {
            const k = this.known.get(id)!;
            const fell = this.fellLast.get(id);
            const host = fell ? view.planet(fell.host) : null;
            if (fell && host) {
              // the moon struck its world: where it touched, a flash, the shock running out and the ejecta thrown up
              const at: D3 = [host.center[0] + fell.dir[0] * fell.R, host.center[1] + fell.dir[1] * fell.R, host.center[2] + fell.dir[2] * fell.R];
              this.burst('strike', fell.host, at, fell.Rm, time, true, fell.dir);
            } else this.burst('erase', id, k.sys, k.R, time, k.parent >= 0);
          }
          for (const id of born) { const pv = now.get(id)!; this.burst('birth', id, [pv.center[0], pv.center[1], pv.center[2]], pv.params.radius, time, pv.params.orbit.parent >= 0); }
        }
      }
      this.known.clear();
      for (const [id, pv] of now) this.known.set(id, { sys: [pv.center[0], pv.center[1], pv.center[2]], R: pv.params.radius, parent: pv.params.orbit.parent });
      this.started = true;
    }
    // an erased world stays in the view for a snapshot (alive = false): the collapse stands in for it from the first frame
    for (const pv of view.planets) if (pv.alive === false) { const ref = planets.get(pv.id); if (ref) ref.group.visible = false; }
    // ── rings ──
    const seen = new Set<number>();
    for (const pv of view.planets) {
      const ring = pv.params.ring;
      if (!ring || !(ring.density > 0) || pv.alive === false) continue;
      seen.add(pv.id);
      if (!this.crackedAt.has(pv.id)) this.crackedAt.set(pv.id, this.started && view.snapshots > 2 ? tick : tick - 1e6);
      let rv = this.rings.get(pv.id);
      const count = Math.max(300, Math.round(this.rockBudget * Math.min(1, ring.density)));
      const key = `${ring.inner}|${ring.outer}|${ring.density}|${count}`;
      if (!rv || rv.key !== key) {
        if (rv) { rv.group.parent?.remove(rv.group); for (const m of rv.rocks) m.geometry.dispose(); rv.rockMat.dispose(); rv.dustMat.dispose(); rv.dust.geometry.dispose(); rv.shadow.geometry.dispose(); rv.shadowMat.dispose(); }
        rv = buildRing(pv.params.radius, ring, count, pv.seed + 77);
        this.rings.set(pv.id, rv);
      }
      // the ring's frame: the planet's centre, its equator (orbit plane × tilt, no spin)
      let g = this.ringGroups.get(pv.id);
      if (!g) { g = new Group(); g.name = `ring-frame-${pv.id}`; this.ringGroups.set(pv.id, g); }
      if (g.parent !== scene) scene.add(g);
      if (rv.group.parent !== g) g.add(rv.group);
      g.position.set(pv.center[0] - pose.pos[0], pv.center[1] - pose.pos[1], pv.center[2] - pose.pos[2]);
      const qe = bodyQuat(pv.params, 0);
      g.quaternion.set(qe[0], qe[1], qe[2], qe[3]);
      g.updateMatrixWorld(true);
      const u = rv.rockMat.uniforms;
      // (seconds at 1×, locked to the tick like the planet's spin it turns over: pausing stops it, a step moves it
      // exactly, at 100× it turns 100× as fast; the /10 of the old pace turned it at a tenth of its speed at 1×)
      u.uT.value = (tick / TICKS_PER_SECOND_1X) % 1e5;
      // the sun toward the star from the planet, in the ring's frame and in view space
      _q.copy(g.quaternion).invert();
      const sd = _v.set(pv.sunDir[0], pv.sunDir[1], pv.sunDir[2]);
      (u.uSunRing.value as Vector3).copy(sd).applyQuaternion(_q);
      (u.uSunView.value as Vector3).copy(sd).applyQuaternion(camQuatInv);
      const E = sunIlluminance(view.star.luminosity, Math.hypot(pv.center[0], pv.center[1], pv.center[2]));
      const sc = blackbody(view.star.temperature || 5800, _bb);
      (u.uSunE.value as Vector3).set(sc[0] * E, sc[1] * E, sc[2] * E);
      const ca = this.crackedAt.get(pv.id) ?? 0;
      u.uHeat.value = Math.max(0, 1 - (tick - ca) / 2880) * 0.8;
      // the camera in the ring's frame (forward scattering)
      (rv.dustMat.uniforms.uCamRing.value as Vector3).set(pose.pos[0] - pv.center[0], pose.pos[1] - pv.center[1], pose.pos[2] - pv.center[2]).applyQuaternion(_q);
      // fissures (once per crack) on the planet's own group
      const ref = planets.get(pv.id);
      let cv = this.cracks.get(pv.id);
      if (!cv && ref && pv.fields.get('surface')) {
        const { geo, vents } = buildCracks(pv, pv.seed + 31);
        const mat = new ShaderMaterial({
          vertexShader: CRACK_VERT, fragmentShader: CRACK_FRAG, side: DoubleSide, transparent: true, depthWrite: false, depthTest: false,
          blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
          uniforms: {
            uHeat: { value: 1 }, uTime: { value: 0 }, tExposure: FX_EXPOSURE, uHasExposure: { value: 1 },
            tSceneDepth: this.uniformsShared.tSceneDepth, uResolution: this.uniformsShared.uResolution,
            uSunDirBody: ref.uniforms.uSunDirBody ?? { value: new Vector3(0, 1, 0) }, uSunE: ref.uniforms.uSunE ?? { value: new Vector3(6, 6, 6) },
          },
        });
        const mesh = new Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.layers.set(WORLD_LAYER);
        mesh.name = 'fissures';
        // steam and smoke over the vents; the fire's light on the clouds above
        const ventGeo = new InstancedBufferGeometry();
        ventGeo.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
        ventGeo.setIndex([0, 1, 2, 0, 2, 3]);
        const PUFFS = 9;
        const nv = vents.length / 4;
        const iV = new Float32Array(nv * PUFFS * 4), iS = new Float32Array(nv * PUFFS * 2);
        for (let i = 0; i < nv; i++) for (let j = 0; j < PUFFS; j++) {
          const k = i * PUFFS + j;
          iV.set([vents[i * 4], vents[i * 4 + 1], vents[i * 4 + 2], vents[i * 4 + 3]], k * 4);
          iS.set([j / PUFFS, hashFloat(i, j, 0x5e7)], k * 2);
        }
        ventGeo.setAttribute('iV', new InstancedBufferAttribute(iV, 4));
        ventGeo.setAttribute('iS', new InstancedBufferAttribute(iS, 2));
        ventGeo.instanceCount = nv * PUFFS;
        const ventMat = new ShaderMaterial({
          vertexShader: VENT_VERT, fragmentShader: VENT_FRAG, transparent: true, depthWrite: false, depthTest: false,
          blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
          uniforms: {
            uT: { value: 0 }, uHeat: { value: 1 }, uWindB: { value: new Vector3() }, uSunDirBody: mat.uniforms.uSunDirBody, uSunE: mat.uniforms.uSunE,
            tSceneDepth: this.uniformsShared.tSceneDepth, uResolution: this.uniformsShared.uResolution, tExposure: FX_EXPOSURE, uHasExposure: this.hasExposure,
          },
        });
        const ventMesh = new Mesh(ventGeo, ventMat);
        ventMesh.frustumCulled = false;
        ventMesh.layers.set(WORLD_LAYER);
        ventMesh.renderOrder = 2;
        let glow: Mesh | null = null, glowMat: ShaderMaterial | null = null;
        if (ref.uniforms.uCloudCov && ref.uniforms.uCloudShell) {
          glowMat = new ShaderMaterial({
            vertexShader: CLOUDGLOW_VERT, fragmentShader: CLOUDGLOW_FRAG, transparent: true, depthWrite: false, depthTest: false, side: DoubleSide,
            blending: CustomBlending, blendSrc: OneFactor, blendDst: OneFactor,
            uniforms: {
              uCloudCov: ref.uniforms.uCloudCov, uCloudOn: ref.uniforms.uCloudOn ?? { value: 1 }, uCloudR: { value: pv.params.radius + 260 }, uHeat: mat.uniforms.uHeat,
              tSceneDepth: this.uniformsShared.tSceneDepth, uResolution: this.uniformsShared.uResolution, tExposure: FX_EXPOSURE, uHasExposure: this.hasExposure,
            },
          });
          glow = new Mesh(geo, glowMat);
          glow.frustumCulled = false;
          glow.layers.set(WORLD_LAYER);
          glow.renderOrder = 3;
        }
        cv = { mesh, mat, t0: ca, group: null, vents: ventMesh, ventMat, glow, glowMat };
        this.cracks.set(pv.id, cv);
      }
      if (cv && ref) {
        if (cv.group !== ref.group) {
          for (const m of [cv.mesh, cv.vents, cv.glow]) if (m) { m.parent?.remove(m); ref.group.add(m); }
          cv.group = ref.group;
        }
        if (cv.ventMat) {
          const vu = cv.ventMat.uniforms;
          vu.uT.value = this.ventClock % 1e5;
          vu.uHeat.value = cv.mat.uniforms.uHeat.value;
          const wx = pv.fields.get('windX'), wy = pv.fields.get('windY'), wz = pv.fields.get('windZ');
          // (a gentle drift: the mean wind over the world's face, or none)
          if (wx && wy && wz && !(vu.uWindB.value as Vector3).lengthSq()) {
            let sx = 0, sy = 0, sz = 0;
            for (let i = 0; i < wx.length; i += 97) { sx += wx[i]; sy += wy[i]; sz += wz[i]; }
            const n = Math.ceil(wx.length / 97);
            (vu.uWindB.value as Vector3).set(sx / n, sy / n, sz / n).clampLength(0, 6);
          }
        }
        if (cv.glowMat && ref.uniforms.uCloudShell) { const sh = ref.uniforms.uCloudShell.value as Vector2; cv.glowMat.uniforms.uCloudR.value = 0.5 * (sh.x + sh.y); }
        // the rifts cool over three days to a dull red glow, never quite out
        cv.mat.uniforms.uHeat.value = 0.28 + 0.72 * Math.exp(-Math.max(0, tick - ca) / 1440);
        cv.mat.uniforms.uTime.value = time % 1000;
        cv.mat.uniforms.uHasExposure.value = FX_EXPOSURE.value ? 1 : 0;
      }
    }
    for (const [id, rv] of this.rings) {
      if (seen.has(id)) continue;
      rv.group.parent?.remove(rv.group);
      this.rings.delete(id);
      const cv = this.cracks.get(id);
      if (cv) this.disposeCrack(id, cv);
    }
    // ── falling moons: tides on the host's sea, fire round the moon near the end ──
    for (const ref of planets.values()) {
      const tide = ref.uniforms.uTide?.value as Vector4 | undefined;
      if (tide) tide.w = 0;
    }
    const liveMoons = new Set<number>();
    for (const pv of view.planets) {
      for (const d of pv.disasters) {
        if (d.kind !== 'moon-fall') continue;
        // which moon: the one of this world whose height over it matches the disaster's (the sim's moonAlt), else the nearest
        let moon: PlanetView | null = null, best = Infinity;
        for (const m of view.planets) {
          if (m.params.orbit.parent !== pv.id || m.alive === false) continue;
          const dm = Math.hypot(m.center[0] - pv.center[0], m.center[1] - pv.center[1], m.center[2] - pv.center[2]);
          const score = d.params.moonAlt != null ? Math.abs(dm - pv.params.radius - d.params.moonAlt) : dm;
          if (score < best) { best = score; moon = m; }
        }
        if (!moon) continue;
        const prog = Math.max(0, Math.min(1, d.progress));
        const dx = moon.center[0] - pv.center[0], dy = moon.center[1] - pv.center[1], dz = moon.center[2] - pv.center[2];
        const dm = Math.hypot(dx, dy, dz) || 1;
        // tides: the sea heaps toward the moon and away from it (the equilibrium tide grows as m / d³: a moon a quarter of
        // the world's size at a few radii raises it a metre); in the last day it is a surge tens of metres high, the
        // water wild (ocean.ts roughens with it)
        const ref = planets.get(pv.id);
        const tide = ref?.uniforms.uTide?.value as Vector4 | undefined;
        if (tide) {
          _q.set(pv.quat[0], pv.quat[1], pv.quat[2], pv.quat[3]).invert();
          _v.set(dx / dm, dy / dm, dz / dm).applyQuaternion(_q);
          const k = (moon.params.radius / pv.params.radius) ** 3 * (pv.params.radius / dm) ** 3 * 600;
          tide.set(_v.x, _v.y, _v.z, Math.min(36, 0.6 + k + 30 * prog ** 4));
        }
        liveMoons.add(moon.id);
        let mg = this.moonGlows.get(moon.id);
        if (!mg) {
          const shell = new Mesh(this.glowGeo, this.glowMat(3, [1.0, 0.45, 0.12], true));
          const tail = new Mesh(this.glowGeo, this.glowMat(4, [1.0, 0.55, 0.2], true));
          const face = new Mesh(this.glowGeo, this.glowMat(5, [1.0, 0.5, 0.15], true));
          for (const m of [shell, tail, face]) { m.frustumCulled = false; m.layers.set(WORLD_LAYER); m.renderOrder = 4; this.spaceGroup.add(m); }
          mg = { shell, tail, face };
          this.moonGlows.set(moon.id, mg);
        }
        // the moon stays a grey, cratered, sunlit body (its own planet visual, growing in the sky as it comes): it burns
        // only where its lower limb tears into the air at the very end; in its last hours, inside the Roche limit, it
        // fractures and sheds two streams of rubble along its orbit, whose leading pieces sink into the air and burn
        const Rm = moon.params.radius, Rh = pv.params.radius;
        const gap = dm - Rm - Rh;
        const airTop = pv.params.atmosphere.pressure > 0.02 ? Rh * 0.2 : 0;
        const burn = airTop > 0 ? Math.pow(Math.max(0, Math.min(1, 1 - gap / airTop)), 1.5) : 0;
        const breakK = Math.max(0, Math.min(1, (prog - 0.9) / 0.1));
        const brk = breakK * breakK * (3 - 2 * breakK);
        this.falling.set(moon.id, { host: pv.id, dir: [dx / dm, dy / dm, dz / dm], R: Rh, Rm });
        for (const m of [mg.shell, mg.tail]) {
          m.visible = burn > 0.01;
          m.position.set(moon.center[0] - pose.pos[0], moon.center[1] - pose.pos[1], moon.center[2] - pose.pos[2]);
          const mu = (m.material as ShaderMaterial).uniforms;
          mu.uK.value = burn;
          mu.uTime.value = time % 1000;
        }
        mg.face.visible = brk > 0.01;
        mg.face.position.set(moon.center[0] - pose.pos[0], moon.center[1] - pose.pos[1], moon.center[2] - pose.pos[2]);
        { const fu = (mg.face.material as ShaderMaterial).uniforms; fu.uK.value = brk; fu.uTime.value = time % 1000; }
        mg.shell.scale.setScalar(Rm * 1.45);
        mg.tail.scale.setScalar(Rm * 3.2);
        // (the silhouette seen from here — a near sphere looks bigger than its radius at its centre's depth, and its
        // craters and ridges stand ~8 % proud — lands at r ≈ 0.93 of the quad)
        const dc = Math.hypot(moon.center[0] - pose.pos[0], moon.center[1] - pose.pos[1], moon.center[2] - pose.pos[2]);
        const Rs = Rm * 1.08;
        const proj = Rs * dc / Math.sqrt(Math.max(dc * dc - Rs * Rs, Rs * Rs * 0.04));
        mg.face.scale.setScalar(proj / 0.93);
        // (tested just in front of the whole body: its own rock never hides it, a hill or a cloud bank in front does)
        (mg.face.material as ShaderMaterial).uniforms.uFront.value = Rm * 1.05;
        // the moon's motion about its world (its orbit's tangent), for the plume and the streams
        const tk = view.renderTick;
        const a0 = orbitOffset(moon.params.orbit, tk, _o0), a1 = orbitOffset(moon.params.orbit, tk + 1, _o1);
        _v.set(a0[0] - a1[0], a0[1] - a1[1], a0[2] - a1[2]);
        const back = _v2.copy(_v).normalize();
        _v.applyQuaternion(camQuatInv);
        const sl = Math.hypot(_v.x, _v.y) || 1;
        const tu = (mg.tail.material as ShaderMaterial).uniforms;
        (tu.uDir.value as Vector2).set(_v.x / sl, _v.y / sl);
        tu.uOffset.value = 0.85;
        // the break-up's streams
        if (brk > 0.001) this.breakUp(moon.id, pv, moon, dm, back, brk, pose, view, camQuatInv, time, airTop);
      }
    }
    this.fellLast = new Map(this.falling);
    this.falling.clear();
    for (const [id, mg] of this.moonGlows) if (!liveMoons.has(id)) { for (const m of [mg.shell, mg.tail, mg.face]) { m.parent?.remove(m); (m.material as ShaderMaterial).dispose(); } this.moonGlows.delete(id); }
    for (const [id, mb] of this.breaks) if (!liveMoons.has(id) || !this.breakSeen.has(id)) this.disposeBreak(id, mb);
    this.breakSeen.clear();
    // ── bursts ──
    for (const b of this.bursts) this.updateBurst(b, view, pose, time, camQuatInv);
    this.bursts = this.bursts.filter((b) => { if (b.done) { b.group.parent?.remove(b.group); this.disposeBurst(b); } return !b.done; });
  }

  /** a falling moon's rubble streams (instanced, lit, burning where they sink into the air) and their entry streaks */
  private breakUp(id: number, host: PlanetView, moon: PlanetView, dm: number, back: Vector3, brk: number, pose: CameraPose, view: WorldView, camQuatInv: Quaternion, time: number, airTop: number): void {
    this.breakSeen.add(id);
    let mb = this.breaks.get(id);
    if (!mb) {
      if (!this.rockGeo) this.rockGeo = rockGeometry(4242);
      const geo = new InstancedBufferGeometry();
      geo.index = this.rockGeo.index;
      geo.setAttribute('position', this.rockGeo.getAttribute('position'));
      geo.setAttribute('normal', this.rockGeo.getAttribute('normal'));
      const F = new Float32Array(SHARDS * 4), G = new Float32Array(SHARDS * 4);
      const rng = new Rng(moon.seed + 913);
      const Rm = moon.params.radius;
      for (let i = 0; i < SHARDS; i++) {
        // leading pieces first among the ones that go far (they make the burning stream); sizes by a power law
        const side = i < SHARDS * 0.55 ? 1 : -1;
        F.set([side, Math.pow(rng.float(), 0.8), rng.float() * 2 - 1, (rng.float() + rng.float() - 1)], i * 4);
        G.set([Rm * (0.012 + 0.11 * Math.pow(rng.float(), 5)), rng.float(), rng.float(), (rng.float() - 0.5) * 0.8], i * 4);
      }
      // (the streaks: the leading pieces that travel farthest along the stream, i.e. lowest into the air)
      const order = [...Array(SHARDS).keys()].filter((i) => F[i * 4] > 0).sort((a, b) => F[b * 4 + 1] - F[a * 4 + 1]).slice(0, STREAKS);
      const params = new Float32Array(STREAKS * 8);
      order.forEach((i, k) => { params.set([F[i * 4], F[i * 4 + 1], F[i * 4 + 2], F[i * 4 + 3], G[i * 4], G[i * 4 + 1], 0, 0], k * 8); });
      geo.setAttribute('aF', new InstancedBufferAttribute(F, 4));
      geo.setAttribute('aG', new InstancedBufferAttribute(G, 4));
      geo.instanceCount = SHARDS;
      const mat = new ShaderMaterial({
        vertexShader: SHARD_VERT, fragmentShader: SHARD_FRAG,
        uniforms: {
          uE1: { value: new Vector3() }, uE2: { value: new Vector3() }, uNrm: { value: new Vector3() }, uA: { value: 1 }, uB: { value: 0 }, uRm: { value: Rm },
          uR: { value: host.params.radius }, uAir: { value: Math.max(1, airTop) }, uT: { value: 0 },
          uSunView: { value: new Vector3() }, uSunSys: { value: new Vector3() }, uSunE: { value: new Vector3(6, 6, 6) },
        },
      });
      const mesh = new InstancedMesh(geo, mat, SHARDS);
      mesh.frustumCulled = false;
      const group = new Group();
      group.name = `moon-breakup-${id}`;
      group.add(mesh);
      this.spaceGroup.add(group);
      const streaks: Mesh[] = [];
      for (let k = 0; k < STREAKS; k++) {
        const st = new Mesh(this.glowGeo, this.glowMat(4, [1.0, 0.6, 0.25], true));
        st.frustumCulled = false; st.layers.set(WORLD_LAYER); st.renderOrder = 4;
        this.spaceGroup.add(st);
        streaks.push(st);
      }
      mb = { group, mesh, mat, streaks, params, sizes: G };
      this.breaks.set(id, mb);
    }
    // the moon's orbital frame about its world, now: e1 toward it, e2 along its motion, the orbit's normal
    const e1 = _bA.set(moon.center[0] - host.center[0], moon.center[1] - host.center[1], moon.center[2] - host.center[2]).normalize();
    const e2 = _bB.copy(back).negate().addScaledVector(e1, back.dot(e1)).normalize();
    const nrm = _bC.crossVectors(e1, e2);
    const u = mb.mat.uniforms;
    (u.uE1.value as Vector3).copy(e1); (u.uE2.value as Vector3).copy(e2); (u.uNrm.value as Vector3).copy(nrm);
    u.uA.value = dm; u.uB.value = brk; u.uT.value = (view.renderTick / TICKS_PER_SECOND_1X) % 1e5; u.uAir.value = Math.max(1, airTop);
    const sun = _bD.set(-host.center[0], -host.center[1], -host.center[2]).normalize();
    (u.uSunSys.value as Vector3).copy(sun);
    (u.uSunView.value as Vector3).copy(sun).applyQuaternion(camQuatInv);
    const E = sunIlluminance(view.star.luminosity, Math.hypot(host.center[0], host.center[1], host.center[2]));
    const sc = blackbody(view.star.temperature || 5800, _bb);
    (u.uSunE.value as Vector3).set(sc[0] * E, sc[1] * E, sc[2] * E);
    mb.group.position.set(host.center[0] - pose.pos[0], host.center[1] - pose.pos[1], host.center[2] - pose.pos[2]);
    // entry streaks behind the burning pieces (the same placement as the shader's)
    const R = host.params.radius, Rm = moon.params.radius;
    for (let k = 0; k < STREAKS; k++) {
      const P = mb.params;
      const side = P[k * 8], along = P[k * 8 + 1], jr = P[k * 8 + 2], jh = P[k * 8 + 3], size = P[k * 8 + 4], onset = P[k * 8 + 5];
      const q = Math.max(0, Math.min(1, (brk - 0.6 * onset) / Math.max(1e-3, 1 - 0.6 * onset)));
      const dth = side * (Rm / dm * 1.05 + q * along * 0.9);
      const r = side > 0 ? Math.max(R + 20, R + (dm - R) * (1 - q * along * 0.98) + jr * Rm * 0.3) : dm * (1 + q * along * 0.25) + jr * Rm * 0.45;
      const h = jh * Rm * 0.55 * (1 - 0.4 * q);
      const cx = (Math.cos(dth) * e1.x + Math.sin(dth) * e2.x) * r + nrm.x * h;
      const cy = (Math.cos(dth) * e1.y + Math.sin(dth) * e2.y) * r + nrm.y * h;
      const cz = (Math.cos(dth) * e1.z + Math.sin(dth) * e2.z) * r + nrm.z * h;
      const alt = Math.hypot(cx, cy, cz) - R;
      const heat = airTop > 0 ? Math.max(0, Math.min(1, (airTop * 1.3 - alt) / (airTop * 1.2))) * q : 0;
      const st = mb.streaks[k];
      st.visible = heat > 0.05;
      if (!st.visible) continue;
      st.position.set(host.center[0] + cx - pose.pos[0], host.center[1] + cy - pose.pos[1], host.center[2] + cz - pose.pos[2]);
      st.scale.setScalar(Math.max(size * 6, 25) * (0.6 + 0.4 * heat));
      // the tail streams back along the piece's path (opposite its motion along the orbit at its place)
      const tx = -(-Math.sin(dth) * e1.x + Math.cos(dth) * e2.x), ty = -(-Math.sin(dth) * e1.y + Math.cos(dth) * e2.y), tz = -(-Math.sin(dth) * e1.z + Math.cos(dth) * e2.z);
      _bD.set(tx, ty, tz).applyQuaternion(camQuatInv);
      const l = Math.hypot(_bD.x, _bD.y) || 1;
      const su = (st.material as ShaderMaterial).uniforms;
      (su.uDir.value as Vector2).set(_bD.x / l, _bD.y / l);
      su.uOffset.value = 0.85;
      su.uK.value = heat;
      su.uTime.value = time % 1000;
    }
  }

  private disposeCrack(id: number, cv: CrackVis): void {
    for (const m of [cv.mesh, cv.vents, cv.glow]) m?.parent?.remove(m);
    cv.mesh.geometry.dispose(); cv.mat.dispose();
    cv.vents?.geometry.dispose(); cv.ventMat?.dispose(); cv.glowMat?.dispose();
    this.cracks.delete(id);
  }

  private disposeBreak(id: number, mb: MoonBreak): void {
    mb.group.parent?.remove(mb.group);
    mb.mesh.geometry.dispose();
    mb.mat.dispose();
    for (const st of mb.streaks) { st.parent?.remove(st); (st.material as ShaderMaterial).dispose(); }
    this.breaks.delete(id);
  }

  private burst(kind: 'erase' | 'birth' | 'strike', planet: number, sys: D3, R: number, time: number, moon: boolean, up: D3 | null = null): void {
    const group = new Group();
    group.name = `world-${kind}-${planet}`;
    this.spaceGroup.add(group);
    const shell = new Mesh(this.sphereGeo, this.shellMat());
    shell.layers.set(WORLD_LAYER);
    shell.frustumCulled = false;
    shell.renderOrder = 2;
    group.add(shell);
    const glows: Mesh[] = [];
    const colour: [number, number, number] = kind === 'birth' ? [1.0, 0.55, 0.2] : kind === 'strike' ? [1.0, 0.78, 0.5] : [1.0, 0.7, 0.45];
    if (kind === 'erase' || kind === 'strike') {
      const flash = new Mesh(this.glowGeo, this.glowMat(0, colour, false));
      const ring = new Mesh(this.glowGeo, this.glowMat(1, [0.9, 0.7, 1.0], false));
      glows.push(flash, ring);
    } else if (!moon) {
      glows.push(new Mesh(this.glowGeo, this.glowMat(2, [1.0, 0.5, 0.2], false)));
    }
    for (const g of glows) { g.layers.set(WORLD_LAYER); g.frustumCulled = false; g.renderOrder = 3; group.add(g); }
    let debris: InstancedMesh | null = null, debrisMat: ShaderMaterial | null = null;
    if (kind === 'erase' || kind === 'strike') {
      const n = kind === 'strike' ? 1400 : 900;
      const dir = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const a = [hashFloat(i, planet, 1) - 0.5, hashFloat(i, planet, 2) - 0.5, hashFloat(i, planet, 3) - 0.5];
        dir.set([a[0], a[1], a[2], 0.15 + 0.9 * hashFloat(i, planet, 4)], i * 4);
      }
      const geo = new IcosahedronGeometry(1, 0);
      geo.setAttribute('aDir', new InstancedBufferAttribute(dir, 4));
      debrisMat = new ShaderMaterial({
        vertexShader: DEBRIS_VERT, fragmentShader: DEBRIS_FRAG,
        uniforms: { uT: { value: 0 }, uR: { value: R }, uFade: { value: 1 }, uBias: { value: up ? new Vector3(up[0], up[1], up[2]).multiplyScalar(1.15) : new Vector3() } },
      });
      debris = new InstancedMesh(geo, debrisMat, n);
      debris.frustumCulled = false;
      group.add(debris);
    }
    if (kind === 'strike') shell.visible = false;
    this.bursts.push({ kind, sys, up, planet, R, t0: time, tick0: this.tickNow, group, shell, glows, debris, debrisMat, done: false });
  }

  private updateBurst(b: Burst, view: WorldView, pose: CameraPose, time: number, camQuatInv: Quaternion): void {
    // (the world's time in seconds at 1×: 1× is TICKS_PER_SECOND_1X ticks a second — divided by the old ten, the tick
    // clock was always the slower one at 1× and an erasure's 1.4 s collapse took fourteen)
    const t = Math.max(0, Math.min(time - b.t0, (view.renderTick - b.tick0) / TICKS_PER_SECOND_1X));
    // a world being born is followed along its orbit; one being erased too, for as long as the view still carries it
    // (a snapshot or two with alive = false) — the eye over it holds where it was when it went, and so does the wreck
    if (b.kind === 'birth' || b.kind === 'erase') {
      const pv = view.planet(b.planet);
      if (pv) b.sys = [pv.center[0], pv.center[1], pv.center[2]];
    }
    b.group.position.set(b.sys[0] - pose.pos[0], b.sys[1] - pose.pos[1], b.sys[2] - pose.pos[2]);
    const sm = b.shell.material as ShaderMaterial;
    const sun = _v.set(-b.sys[0], -b.sys[1], -b.sys[2]).normalize().applyQuaternion(camQuatInv);
    (sm.uniforms.uSunView.value as Vector3).copy(sun);
    sm.uniforms.uHasExposure.value = FX_EXPOSURE.value ? 1 : 0;
    if (b.kind === 'erase') {
      // collapse (1.4 s): the world's shell, veined with fire, falls in on itself; a flash; the shock ring; debris
      const c = Math.min(1, t / 1.4);
      const s = b.R * (1.002 - 0.998 * c * c * c);
      b.shell.scale.setScalar(Math.max(1e-3, s));
      b.shell.visible = c < 1;
      sm.uniforms.uCracks.value = 0.4 + 2.5 * c;
      sm.uniforms.uHeat.value = c * 0.8;
      sm.uniforms.uAlpha.value = 1;
      const [flash, ring] = b.glows;
      // (the flash is over in a few seconds: its faint tail, filling the frame of an eye that stood near the world,
      // would otherwise be lifted to a beige haze by the exposure of the dark sky)
      const fk = t < 1.4 ? 0 : Math.exp(-(t - 1.4) * 4) * Math.max(0, Math.min(1, (3.0 - t) / 0.8));
      flash.scale.setScalar(b.R * (2 + 5 * Math.min(1, (t - 1.2) * 2)));
      (flash.material as ShaderMaterial).uniforms.uK.value = Math.max(0, fk) * 6;
      flash.visible = t > 1.2;
      const rk = Math.max(0, Math.min(1, (t - 1.4) / 4));
      ring.scale.setScalar(b.R * 18);
      ring.visible = t > 1.4 && rk < 1;
      (ring.material as ShaderMaterial).uniforms.uK.value = rk;
      if (b.debris && b.debrisMat) {
        b.debris.visible = t > 1.3;
        b.debrisMat.uniforms.uT.value = Math.max(0, t - 1.3);
        b.debrisMat.uniforms.uFade.value = Math.max(0, 1 - (t - 1.3) / 10);
      }
      if (t > 12) b.done = true;
    } else if (b.kind === 'strike') {
      // the moon strikes (its radius is b.R): a white flash where it touched, fading through orange; the shock runs out
      // over the ground; the ejecta fly up glowing and cool. The god layer draws the crater's plume and the shaking
      // (fx/godfx.ts, the 'impact' event); this is the light of it seen from anywhere, space included
      b.shell.visible = false;
      const host = view.planet(b.planet);
      let seen = 1;
      if (host && b.up) {
        // the contact point behind the struck world's limb: only the glow over the limb shows
        b.sys = [host.center[0] + b.up[0] * host.params.radius, host.center[1] + b.up[1] * host.params.radius, host.center[2] + b.up[2] * host.params.radius];
        const ox = pose.pos[0] - host.center[0], oy = pose.pos[1] - host.center[1], oz = pose.pos[2] - host.center[2];
        if (ox * b.up[0] + oy * b.up[1] + oz * b.up[2] < host.params.radius * 0.98) seen = 0.25;
        b.group.position.set(b.sys[0] - pose.pos[0], b.sys[1] - pose.pos[1], b.sys[2] - pose.pos[2]);
      }
      const [flash, ring] = b.glows;
      const fm = flash.material as ShaderMaterial;
      fm.uniforms.uK.value = (Math.exp(-t * 0.9) * 8 + Math.exp(-t * 0.15) * 0.6) * seen;
      (fm.uniforms.uColor.value as Vector3).set(1.0, 0.55 + 0.35 * Math.exp(-t * 0.7), 0.25 + 0.55 * Math.exp(-t * 1.2));
      flash.scale.setScalar(b.R * (3 + 4 * Math.min(1, t * 1.5)));
      const rk = Math.min(1, t / 7);
      ring.scale.setScalar(b.R * 14);
      ring.visible = rk < 1;
      (ring.material as ShaderMaterial).uniforms.uK.value = rk;
      if (b.debris && b.debrisMat) {
        b.debrisMat.uniforms.uT.value = t;
        b.debrisMat.uniforms.uFade.value = Math.max(0, 1 - t / 14);
      }
      if (t > 15) b.done = true;
    } else {
      // birth (10 s): the swirl gathers in, the molten ball cools, crusts, and fades to the world beneath
      const k = Math.min(1, t / 10);
      b.shell.scale.setScalar(b.R * 1.004);
      sm.uniforms.uHeat.value = Math.max(0, 1 - k * 1.25);
      sm.uniforms.uCracks.value = 0;
      sm.uniforms.uAlpha.value = 1 - Math.max(0, Math.min(1, (k - 0.6) / 0.38));
      const sw = b.glows[0];
      if (sw) {
        sw.scale.setScalar(b.R * 9);
        (sw.material as ShaderMaterial).uniforms.uK.value = k;
        (sw.material as ShaderMaterial).uniforms.uTime.value = t;
        sw.visible = k < 0.98;
      }
      if (t > 10.5) b.done = true;
    }
  }

  private disposeBurst(b: Burst): void {
    (b.shell.material as ShaderMaterial).dispose();
    for (const g of b.glows) (g.material as ShaderMaterial).dispose();
    b.debris?.geometry.dispose();
    b.debrisMat?.dispose();
  }

  /** the overlays (dust, flashes, swirls, molten shells, the moon's fire) over the composited image */
  render(renderer: WebGLRenderer, scene: Scene, camera: Camera, target: WebGLRenderTarget | null, depth: Texture, w: number, h: number): void {
    this.hasExposure.value = FX_EXPOSURE.value ? 1 : 0;
    this.uniformsShared.tSceneDepth.value = depth;
    this.uniformsShared.uResolution.value.set(w, h);
    for (const rv of this.rings.values()) {
      rv.dustMat.uniforms.tSceneDepth.value = depth; (rv.dustMat.uniforms.uResolution.value as Vector2).set(w, h);
      rv.rockMat.uniforms.uResY.value = h;
      // view → ring frame (the ring group's world matrix is current: placed this frame)
      (rv.shadowMat.uniforms.uViewToRing.value as Matrix4).copy(rv.group.matrixWorld).invert().multiply(camera.matrixWorld);
    }
    if (!this.rings.size && !this.bursts.length && !this.moonGlows.size) return;
    const prevAuto = renderer.autoClear;
    const prevMask = camera.layers.mask;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    camera.layers.set(WORLD_LAYER);
    renderer.render(scene, camera);
    camera.layers.mask = prevMask;
    renderer.autoClear = prevAuto;
  }

  /** active effects (tests, the dev HUD) */
  stats(): { rings: number; cracks: number; bursts: number; moons: number } {
    return { rings: this.rings.size, cracks: this.cracks.size, bursts: this.bursts.length, moons: this.moonGlows.size };
  }

  /** what each effect is doing (shot scripts, debugging) */
  detail(): Record<string, unknown> {
    const glow = (m: Mesh) => ({ visible: m.visible, k: +(m.material as ShaderMaterial).uniforms.uK.value.toFixed(3), scale: Math.round(m.scale.x), dist: Math.round(m.position.length()) });
    return {
      moons: [...this.moonGlows].map(([id, g]) => ({ id, shell: glow(g.shell), tail: glow(g.tail), face: glow(g.face) })),
      breaks: [...this.breaks].map(([id, b]) => ({ id, b: +(b.mat.uniforms.uB.value as number).toFixed(3), burning: b.streaks.filter((st) => st.visible).length })),
      bursts: this.bursts.map((b) => ({ kind: b.kind, planet: b.planet, R: Math.round(b.R), tick0: Math.round(b.tick0) })),
      rings: [...this.rings.keys()], cracks: [...this.cracks.keys()],
    };
  }

  dispose(): void {
    for (const rv of this.rings.values()) { for (const m of rv.rocks) m.geometry.dispose(); rv.rockMat.dispose(); rv.dustMat.dispose(); rv.dust.geometry.dispose(); rv.shadow.geometry.dispose(); rv.shadowMat.dispose(); }
    for (const [id, cv] of this.cracks) this.disposeCrack(id, cv);
    for (const b of this.bursts) this.disposeBurst(b);
    for (const [id, mb] of this.breaks) this.disposeBreak(id, mb);
    this.rockGeo?.dispose();
    this.glowGeo.dispose();
    this.sphereGeo.dispose();
  }
}

