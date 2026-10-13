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
  BufferAttribute, BufferGeometry, CustomBlending, DoubleSide, Group, IcosahedronGeometry,
  InstancedBufferAttribute, InstancedMesh, Mesh, OneFactor, OneMinusSrcAlphaFactor, PlaneGeometry, Quaternion, RingGeometry,
  ShaderMaterial, SphereGeometry, Vector2, Vector3, Vector4, type Camera, type IUniform, type Scene, type Texture,
  type WebGLRenderer, type WebGLRenderTarget,
} from 'three';
import type { PlanetView, WorldView } from '../../client/worldview.ts';
import { blackbody, bodyQuat, orbitOffset, type D3 } from '../../client/orbits.ts';
import { Rng, hashFloat } from '../../sim/core/rng.ts';
import { tangentBasis } from '../../sim/core/vec3.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
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
uniform float uT;        // seconds
uniform float uOmega;    // angular rate (rad/s) at radius uR0
uniform float uR0;
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
  vec3 alb = mix(vec3(0.07, 0.065, 0.06), vec3(0.2, 0.17, 0.14), m) * (0.8 + 0.4 * vSeed);
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

const DUST_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform vec3 uSunRing;
uniform vec3 uSunE;
uniform float uPlanetR;
uniform float uInner;
uniform float uOuter;
uniform float uDensity;
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
  float x = (r - uInner) / (uOuter - uInner);
  if (x < 0.0 || x > 1.0) discard;
  // bands and gaps: broad soft ringlets with finer structure in them (no groove-like regularity), thinning at both edges
  float bands = 0.62 + 0.38 * (snoise(vec3(x * 7.0, 0.0, 1.0)) * 0.5 + 0.5);
  bands *= 0.82 + 0.18 * sin(x * 37.0 + snoise(vec3(x * 5.0, 2.0, 0.0)) * 3.0);
  bands *= 0.85 + 0.15 * (snoise(vec3(x * 60.0, 3.0, 0.0)) * 0.5 + 0.5);
  float gap = smoothstep(0.02, 0.06, abs(x - 0.38)) * smoothstep(0.01, 0.03, abs(x - 0.71));
  float edge = smoothstep(0.0, 0.08, x) * (1.0 - smoothstep(0.85, 1.0, x));
  // clumps orbiting (a slow shear pattern around the ring)
  float ang = atan(vRingPos.z, vRingPos.x);
  float clump = 0.75 + 0.25 * snoise(vec3(cos(ang + uT * 0.02 / pow(r / uInner, 1.5)) * 3.0, sin(ang) * 3.0, x * 8.0));
  float dens = bands * gap * edge * clump * uDensity;
  // the planet's shadow
  vec3 P = vRingPos;
  float b = dot(P, uSunRing);
  float c = dot(P, P) - uPlanetR * uPlanetR;
  float disc = b * b - c;
  float shadow = (disc > 0.0 && -b - sqrt(disc) > 0.0) ? 0.0 : 1.0;
  // dust scatters forward: brighter seen toward the sun (backlit), the lit face a dusty grey-brown
  vec3 V = normalize(P - uCamRing);
  float fwd = pow(max(0.0, dot(V, uSunRing)), 6.0);
  // (albedo ~0.3 grey-brown rubble; the lit face back-scatters like the ground, a backlit ring glows)
  vec3 col = vec3(0.32, 0.27, 0.22) * uSunE * (0.12 + 0.9 * fwd) * shadow + vec3(0.002);
  float a = clamp(dens * 0.75, 0.0, 0.85);
  gl_FragColor = vec4(col * a, a);
}
`;

interface RingVis {
  group: Group;
  rocks: InstancedMesh[];
  dust: Mesh;
  rockMat: ShaderMaterial;
  dustMat: ShaderMaterial;
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
  const rockMat = new ShaderMaterial({
    vertexShader: ROCK_VERT, fragmentShader: ROCK_FRAG,
    uniforms: {
      uT: { value: 0 }, uOmega: { value: 0.012 }, uR0: { value: ring.inner }, uSunView: { value: new Vector3(1, 0, 0) }, uSunRing: { value: new Vector3(1, 0, 0) },
      uSunE: { value: new Vector3(6, 6, 6) }, uPlanetR: { value: R }, uHeat: { value: 0 },
    },
  });
  const rocks: InstancedMesh[] = [];
  const rng = new Rng(seed);
  for (let v = 0; v < 3; v++) {
    const n = Math.round(count / 3);
    const geo = rockGeometry(seed * 7 + v);
    const orbit = new Float32Array(n * 4), spin = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      // radii: denser toward the middle of the band, a few strays
      const u = rng.float();
      const x = u < 0.92 ? 0.5 + (rng.float() + rng.float() + rng.float() - 1.5) * 0.4 : rng.float();
      const r = ring.inner + (ring.outer - ring.inner) * Math.max(0, Math.min(1, x));
      // sizes: a power law (many pebbles of a few metres, a few boulders the size of a hill)
      const s = 3 + 70 * Math.pow(rng.float(), 6);
      orbit.set([r, rng.float() * Math.PI * 2, (rng.float() - 0.5) * (ring.outer - ring.inner) * 0.025, s], i * 4);
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
  const dustMat = new ShaderMaterial({
    vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, depthTest: false, side: DoubleSide,
    blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
    uniforms: {
      uSunRing: rockMat.uniforms.uSunRing, uSunE: rockMat.uniforms.uSunE, uPlanetR: { value: R }, uInner: { value: ring.inner }, uOuter: { value: ring.outer },
      uDensity: { value: ring.density }, uT: rockMat.uniforms.uT, uCamRing: { value: new Vector3() }, tSceneDepth: { value: null }, uResolution: { value: new Vector2(1, 1) },
    },
  });
  const dg = new RingGeometry(ring.inner * 0.98, ring.outer * 1.02, 384, 6);
  dg.rotateX(-Math.PI / 2);
  const dust = new Mesh(dg, dustMat);
  dust.frustumCulled = false;
  dust.layers.set(WORLD_LAYER);
  dust.renderOrder = 1;
  group.add(dust);
  return { group, rocks, dust, rockMat, dustMat, key: `${ring.inner}|${ring.outer}|${ring.density}|${count}` };
}

// ───────────────────────────── fissures ─────────────────────────────

const CRACK_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec2 aRib;    // across (-1..1), along (m)
varying vec2 vRib;
varying float vViewZ;
void main() {
  vRib = aRib;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;
const CRACK_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform float uHeat;
uniform float uTime;
uniform sampler2D tExposure;
uniform float uHasExposure;
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
varying vec2 vRib;
varying float vViewZ;
void main() {
#include <logdepthbuf_fragment>
  // drawn over the composited image, on the ground: hidden only where something stands clearly in front (a hill, a
  // wall) — the terrain's coarse far LODs may lie a little above the true ground the ribbon is draped on
  float sceneZ = texture(tSceneDepth, gl_FragCoord.xy / uResolution).r;
  if (vViewZ > sceneZ * 1.004 + 4.0) discard;
  // the ribbon is three rift half-widths each side: the chasm in the middle third, its glow on the ground beyond
  float u = vRib.x * 3.0, v = vRib.y;
  // a ragged rift: its width wanders along it, its lips break up
  float wv = 0.7 + 0.3 * snoise(vec3(v * 0.006, 1.0, 0.0)) + 0.15 * snoise(vec3(v * 0.03, 2.0, 0.0));
  float lip = abs(u) / wv + 0.14 * snoise(vec3(v * 0.08, u * 0.7, 5.0));
  if (lip > 3.0) discard;
  float ex = uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 0.02) : 1.0;
  float K = mix(1.0, 1.0 / ex, 0.6) * 3.0;
  float flow = snoise(vec3(v * 0.03 - uTime * 0.15, u * 0.6, 3.0)) * 0.5 + 0.5;
  if (lip > 1.0) {
    // the glow of the fire on the ground either side (additive), and the scorched lips
    float g = exp(-(lip - 1.0) * 2.2) * uHeat;
    float sc = (1.0 - smoothstep(1.0, 1.6, lip)) * 0.6;
    gl_FragColor = vec4(vec3(1.0, 0.32, 0.07) * g * 0.35 * K + vec3(0.02, 0.017, 0.014) * sc, sc);
    return;
  }
  float core = 1.0 - smoothstep(0.0, 0.55, lip);
  float crust = smoothstep(0.35, 0.95, lip);
  vec3 hot = mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.55, 0.12), core * (0.6 + 0.4 * flow));
  hot = mix(hot, vec3(1.0, 0.85, 0.5), pow(core, 4.0) * uHeat);
  float I = (0.5 + 2.6 * core) * uHeat * (0.75 + 0.25 * flow) * K;
  // (premultiplied: the dark lips cover the ground, the fire adds its light)
  float a = crust * 0.85;
  vec3 col = hot * I * (1.0 - crust) + vec3(0.02, 0.017, 0.014) * a;
  gl_FragColor = vec4(col, a);
}
`;

interface CrackVis { mesh: Mesh; mat: ShaderMaterial; t0: number; group: Group | null }

/** fissures across a world: meandering great-circle paths draped on the ground, as ribbons with across / along coords */
function buildCracks(pv: PlanetView, seed: number): BufferGeometry {
  const R = pv.params.radius;
  const sea = pv.fields.get('water') ? R + pv.params.seaLevel : -Infinity;
  const rng = new Rng(seed);
  const pos: number[] = [], rib: number[] = [], idx: number[] = [];
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
    // (rift half-widths: the ribbon is three times as wide, for the glow on the ground either side)
    const width = (main ? 36 : 12 + rng.float() * 12) * 3;
    let along = 0;
    let prev = -1;
    for (let i = 0; i <= n; i++) {
      tangentBasis(e, no, p);
      const d: D3 = [no[0] * Math.cos(h) + e[0] * Math.sin(h), no[1] * Math.cos(h) + e[1] * Math.sin(h), no[2] * Math.cos(h) + e[2] * Math.sin(h)];
      const side: D3 = [p[1] * d[2] - p[2] * d[1], p[2] * d[0] - p[0] * d[2], p[0] * d[1] - p[1] * d[0]];
      const w = width * (0.6 + 0.4 * Math.sin(i * 0.11 + k)) * (i < 4 || i > n - 4 ? 0.3 : 1);
      const base = pos.length / 3;
      for (const sx of [-1, 1]) {
        const q: D3 = [p[0] + side[0] * (sx * w) / R, p[1] + side[1] * (sx * w) / R, p[2] + side[2] * (sx * w) / R];
        const ql = Math.hypot(q[0], q[1], q[2]);
        const u: D3 = [q[0] / ql, q[1] / ql, q[2] / ql];
        const g0 = groundHeight(pv.ground, u[0], u[1], u[2]);
        const g = g0 + 0.6;
        pos.push(u[0] * g, u[1] * g, u[2] * g);
        // under the sea the rift goes on unseen (its ribbon is cut there: beyond the lips, discarded)
        rib.push(g0 < sea ? sx * 3 : sx, along);
      }
      if (prev >= 0) idx.push(prev, prev + 1, base + 1, prev, base + 1, base);
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
  g.setIndex(pos.length / 3 > 65535 ? new BufferAttribute(new Uint32Array(idx), 1) : new BufferAttribute(new Uint16Array(idx), 1));
  g.computeBoundingSphere();
  return g;
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
    // the face of a body burning in the air: a dark crust split by molten seams, the limb hottest where the air tears at
    // it. It COVERS the body's disc (alpha blended, not added): the hazed, cratered rock under it would otherwise show
    // as a dark, jagged band round the limb and tint the fire violet. The quad is sized so the true silhouette (relief
    // included) lies at r ≈ 0.93; the edge fades out past it into the burning shell.
    float rr = min(1.0, r / 0.9);
    float mu = sqrt(max(0.0, 1.0 - rr * rr));
    float seams = 1.0 - smoothstep(0.0, 0.09, abs(snoise(vec3(vUv * 3.2, uTime * 0.05)) ));
    float seams2 = 1.0 - smoothstep(0.0, 0.06, abs(snoise(vec3(vUv * 7.5 + 3.0, uTime * 0.07))));
    float limb = pow(1.0 - mu, 2.0);
    vec3 crust = vec3(0.3, 0.06, 0.018) * (0.35 + 0.65 * mu);
    vec3 fire = vec3(1.0, 0.42, 0.09) * (seams * 1.6 + seams2 * 0.8) * (0.55 + 0.45 * mu) + vec3(1.0, 0.58, 0.22) * limb * 2.4;
    float cover = (1.0 - smoothstep(0.9, 1.0, r)) * clamp(uK * 2.5, 0.0, 1.0);
    gl_FragColor = vec4((crust + fire) * (0.5 + 0.9 * uK) * 1.6 * cover, cover);
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

const _v = new Vector3();
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
  /** moons falling this frame (a falling moon that vanishes has struck: a strike, not an erasure) */
  private falling = new Map<number, { host: number; dir: D3; R: number; Rm: number }>();
  private fellLast = new Map<number, { host: number; dir: D3; R: number; Rm: number }>();
  private glowGeo = new PlaneGeometry(2, 2);
  private sphereGeo = new SphereGeometry(1, 64, 40);
  private uniformsShared: { tSceneDepth: IUniform<Texture | null>; uResolution: IUniform<Vector2> } = { tSceneDepth: { value: null }, uResolution: { value: new Vector2(1, 1) } };
  private tickNow = 0;
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
        if (rv) { rv.group.parent?.remove(rv.group); for (const m of rv.rocks) m.geometry.dispose(); rv.rockMat.dispose(); rv.dustMat.dispose(); rv.dust.geometry.dispose(); }
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
      u.uT.value = (tick / 10) % 1e5;
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
        const geo = buildCracks(pv, pv.seed + 31);
        const mat = new ShaderMaterial({
          vertexShader: CRACK_VERT, fragmentShader: CRACK_FRAG, side: DoubleSide, transparent: true, depthWrite: false, depthTest: false,
          blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
          uniforms: {
            uHeat: { value: 1 }, uTime: { value: 0 }, tExposure: FX_EXPOSURE, uHasExposure: { value: 1 },
            tSceneDepth: this.uniformsShared.tSceneDepth, uResolution: this.uniformsShared.uResolution,
          },
        });
        const mesh = new Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.layers.set(WORLD_LAYER);
        mesh.name = 'fissures';
        cv = { mesh, mat, t0: ca, group: null };
        this.cracks.set(pv.id, cv);
      }
      if (cv && ref) {
        if (cv.group !== ref.group) { cv.mesh.parent?.remove(cv.mesh); ref.group.add(cv.mesh); cv.group = ref.group; }
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
      if (cv) { cv.mesh.parent?.remove(cv.mesh); cv.mesh.geometry.dispose(); cv.mat.dispose(); this.cracks.delete(id); }
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
        // the world's size at a few radii raises it a metre; at the end, grazing, ten), and the water roughens
        const ref = planets.get(pv.id);
        const tide = ref?.uniforms.uTide?.value as Vector4 | undefined;
        if (tide) {
          _q.set(pv.quat[0], pv.quat[1], pv.quat[2], pv.quat[3]).invert();
          _v.set(dx / dm, dy / dm, dz / dm).applyQuaternion(_q);
          const k = (moon.params.radius / pv.params.radius) ** 3 * (pv.params.radius / dm) ** 3 * 600;
          tide.set(_v.x, _v.y, _v.z, Math.min(10, 0.6 + k + 9 * prog * prog * prog));
        }
        // the fire of the last fifth: the moon grazes the air and burns, a plume of plasma streaming behind it
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
        // it burns as it comes down into the air (and the tides tear at it): from ~1.5 radii over the ground to grazing
        const Rm = moon.params.radius, Rh = pv.params.radius;
        const gap = dm - Rm - Rh;
        const burn = Math.pow(Math.max(0, Math.min(1, 1 - (gap - 0.2 * Rh) / (1.3 * Rh))), 1.5) * Math.min(1, prog * 2);
        this.falling.set(moon.id, { host: pv.id, dir: [dx / dm, dy / dm, dz / dm], R: Rh, Rm });
        for (const m of [mg.shell, mg.tail, mg.face]) {
          m.visible = burn > 0.01;
          m.position.set(moon.center[0] - pose.pos[0], moon.center[1] - pose.pos[1], moon.center[2] - pose.pos[2]);
          const mu = (m.material as ShaderMaterial).uniforms;
          mu.uK.value = burn;
          mu.uTime.value = time % 1000;
        }
        mg.shell.scale.setScalar(Rm * 1.45);
        mg.tail.scale.setScalar(Rm * 3.2);
        // (the silhouette seen from here — a near sphere looks bigger than its radius at its centre's depth, and its
        // craters and ridges stand ~8 % proud — lands at r ≈ 0.93 of the quad: no rock shows round the burning face)
        const dc = Math.hypot(moon.center[0] - pose.pos[0], moon.center[1] - pose.pos[1], moon.center[2] - pose.pos[2]);
        const Rs = Rm * 1.08;
        const proj = Rs * dc / Math.sqrt(Math.max(dc * dc - Rs * Rs, Rs * Rs * 0.04));
        mg.face.scale.setScalar(proj / 0.93);
        // (tested just in front of the whole body: its own rock never hides it, a hill or a cloud bank in front does)
        (mg.face.material as ShaderMaterial).uniforms.uFront.value = Rm * 1.05;
        // the plume trails behind the moon's motion about its world, as seen on the screen
        const tk = view.renderTick;
        const a0 = orbitOffset(moon.params.orbit, tk, _o0), a1 = orbitOffset(moon.params.orbit, tk + 1, _o1);
        _v.set(a0[0] - a1[0], a0[1] - a1[1], a0[2] - a1[2]);
        // (orbit offsets are system-frame displacements from the parent)
        _v.applyQuaternion(camQuatInv);
        const sl = Math.hypot(_v.x, _v.y) || 1;
        const tu = (mg.tail.material as ShaderMaterial).uniforms;
        (tu.uDir.value as Vector2).set(_v.x / sl, _v.y / sl);
        tu.uOffset.value = 0.85;
      }
    }
    this.fellLast = new Map(this.falling);
    this.falling.clear();
    for (const [id, mg] of this.moonGlows) if (!liveMoons.has(id)) { for (const m of [mg.shell, mg.tail, mg.face]) { m.parent?.remove(m); (m.material as ShaderMaterial).dispose(); } this.moonGlows.delete(id); }
    // ── bursts ──
    for (const b of this.bursts) this.updateBurst(b, view, pose, time, camQuatInv);
    this.bursts = this.bursts.filter((b) => { if (b.done) { b.group.parent?.remove(b.group); this.disposeBurst(b); } return !b.done; });
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
    const t = Math.max(0, Math.min(time - b.t0, (view.renderTick - b.tick0) / 10));
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
      const fk = t < 1.4 ? 0 : Math.exp(-(t - 1.4) * 2.2) * Math.max(0, Math.min(1, (4.4 - t) / 1.5));
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
    for (const rv of this.rings.values()) { rv.dustMat.uniforms.tSceneDepth.value = depth; (rv.dustMat.uniforms.uResolution.value as Vector2).set(w, h); }
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
      moons: [...this.moonGlows].map(([id, g]) => ({ id, shell: glow(g.shell), tail: glow(g.tail) })),
      bursts: this.bursts.map((b) => ({ kind: b.kind, planet: b.planet, R: Math.round(b.R), tick0: Math.round(b.tick0) })),
      rings: [...this.rings.keys()], cracks: [...this.cracks.keys()],
    };
  }

  dispose(): void {
    for (const rv of this.rings.values()) { for (const m of rv.rocks) m.geometry.dispose(); rv.rockMat.dispose(); rv.dustMat.dispose(); rv.dust.geometry.dispose(); }
    for (const cv of this.cracks.values()) { cv.mesh.geometry.dispose(); cv.mat.dispose(); }
    for (const b of this.bursts) this.disposeBurst(b);
    this.glowGeo.dispose();
    this.sphereGeo.dispose();
  }
}

