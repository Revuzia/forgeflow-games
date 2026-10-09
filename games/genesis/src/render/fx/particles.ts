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

float h1(float a, float b) { return fract(sin(a * 127.1 + b * 311.7) * 43758.5453); }

void main() {
  float sys = iParam.x, size = iParam.y, power = iParam.z, seed = iParam.w;
  bool smokeSys = sys > 1.5 && sys < 2.5 || sys > 3.5 && sys < 4.5 || sys > 5.5;
  // each pass draws its own systems; the other's quads collapse
  if ((uPass > 0.5) != smokeSys) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  float life = sys < 0.5 ? 0.9 : sys < 1.5 ? 3.2 : sys < 2.5 ? 9.0 : sys < 3.5 ? 0.9 : sys < 4.5 ? 16.0 : sys < 5.5 ? 1.3 : 20.0;
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
  if (sys < 0.5 || sys > 4.5 && sys < 5.5) {
    // flames: born across the fire's base, rising and narrowing, flickering sideways
    float wild = sys > 4.5 ? 1.0 : 0.0;
    float base = size * mix(0.45, 0.75, wild) * sqrt(r2);
    // a sheet stays on its fuel for most of its life and only its tip breaks away at the end (buoyancy, accelerating):
    // rising the whole life stacked the sheets into tall streaky columns of light
    float rise = size * (0.12 + 0.75 * age * age) * (0.7 + 0.6 * r3);
    p += side * base * (1.0 - age * 0.3) + up * rise;
    p += (e1 * sin(uTime * 4.0 + r1 * 30.0) + e2 * cos(uTime * 3.3 + r2 * 20.0)) * 0.08 * size * age;
    // flames lean and are torn downwind
    p += iWind * tSec * (0.2 + 0.4 * age);
    sz = size * mix(0.7, 0.95, wild) * (0.75 + 0.45 * r3) * (1.0 - age * 0.35) * (0.75 + 0.25 * power);
    float a = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.55, 1.0, age));
    // the fragment shader shapes the tongue and colours it by heat: pass age, power and a seed
    col = vec4(age, power, r1, a);
    soft = 0.4 * size;
    vKind = 1.0;
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
    vec3 sc = stack ? vec3(0.045, 0.041, 0.038) : wild ? vec3(0.07, 0.064, 0.058) : vec3(0.34, 0.35, 0.38);
    sc = mix(sc, (stack || wild) ? vec3(0.17, 0.16, 0.15) : sc * 0.6, (stack || wild) ? smoothstep(0.3, 1.0, age) * 0.65 : r2 * 0.5);
    col = vec4(sc, a * dens * (0.6 + 0.4 * power));
    soft = 0.6 * sz;
    // fire glow lights the column from below: strong at its root, gone some tens of metres up
    vKind = 2.0;
    // (a hearth's chimney glows only at its mouth: lit for its whole first half the wisps floated as orange-brown
    // puffs high over a night village)
    vGlow = vec3(1.0, 0.4, 0.09) * 5.0 * (1.0 - smoothstep(0.0, column ? 0.42 : 0.08, age)) * (column ? 1.0 : 0.15) * power;
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
    // camera (its axis eases to screen-up), so a fire seen from the god camera is still a fire, not a line.
    vec3 upV = normalize((modelViewMatrix * vec4(up, 0.0)).xyz);
    vec2 ax0 = length(upV.xy) > 1e-3 ? normalize(upV.xy) : vec2(0.0, 1.0);
    float face = smoothstep(0.6, 0.92, abs(upV.z));
    vec2 ax = normalize(mix(ax0, vec2(0.0, 1.0), face) + vec2(1e-4, 0.0));
    vec2 rt = vec2(ax.y, -ax.x);
    // tongues of a fire differ in height (per emitter and per particle)
    float tall = (0.7 + 0.8 * h1(seed, 11.0)) * (0.8 + 0.4 * r2);
    // a broad sheet (the outline comes from the density noise in the fragment shader, not from the quad); its aspect
    // goes to the fragment shader so the turbulence keeps its proportions (stretched noise drew streaky curtains)
    float hgt = 1.25 * mix(1.0, tall, 0.8);
    // (widths differ per tongue: sheets of one width stacked side by side squared a fire off into a lit panel)
    float wj = 0.85 * (0.7 + 0.5 * h1(seed, 7.0));
    vGlow = vec3(hgt / wj, face, 0.0);
    mv.xy += rt * corner.x * sz * wj + ax * (corner.y + 0.6) * sz * hgt;
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
void main() {
#include <logdepthbuf_fragment>
  float r = length(vCorner);
  if (r > 1.0 && (vKind < 0.5 || vKind > 1.5)) discard;
  float sceneZ = texture(tSceneDepth, gl_FragCoord.xy / uResolution).r;
  if (vViewZ > sceneZ + 0.05) discard;
  float fade = clamp((sceneZ - vViewZ) / max(0.05, vSoft), 0.0, 1.0);
  // fade near the camera so a puff never fills the screen with a flat card
  fade *= smoothstep(0.3, 2.0, vViewZ);
  if (vKind > 0.5 && vKind < 1.5) {
    // a flame tongue: wide and hot at the base, licking up to a ragged tip; the noise scrolls upward so the
    // outline writhes. Colour from its heat — white-gold in the core, orange, a dull red at the cooling tips.
    // a sheet of burning gas: turbulent density scrolling up (the flow speeds up with height, so features stretch
    // vertically as they rise), a ragged base, a body that tears into tongues near the top and thins to holes
    float y = vCorner.y * 0.5 + 0.5;
    float sd = vColor.z * 17.0;
    float tt = uTime * 2.6;
    float asp = max(vGlow.x, 1.0);
    // isotropic noise in the sheet's own metres (the quad is 1.7·size wide and 1.7·asp·size tall: x ∈ [-1, 1] spans
    // 0.85·size per unit, y ∈ [0, 1] 1.7·asp·size — under-scaled in y, the turbulence stretched into vertical streaks),
    // scrolling up faster toward the top
    vec3 q = vec3(vCorner.x * 1.6, y * asp * 3.2 - tt * (0.9 + 0.6 * y), sd);
    float w1 = snoise(q * vec3(1.0, 0.8, 1.0));
    float w2 = snoise(q * 2.3 + vec3(5.2, -tt * 0.7, 1.3));
    float w3 = snoise(q * 5.1 + vec3(1.7, -tt * 1.6, 7.9));
    // domain-warped sideways (the sheet writhes), more toward the top
    // the finer octaves fade once their features shrink under ~3 pixels (thresholded sub-pixel noise drew every
    // distant tongue as fuzzy, speckled fur)
    float dq = 1.6 * max(fwidth(vCorner.x), asp * fwidth(vCorner.y));
    float k2 = 1.0 - smoothstep(0.2, 0.5, 2.3 * dq), k3 = 1.0 - smoothstep(0.2, 0.5, 5.1 * dq);
    float x = vCorner.x + (w1 * 0.3 + w2 * 0.12 * k2) * (0.2 + y);
    // the flame field: a broad base narrowing upward, eaten by turbulence that grows with height — thresholded, so
    // the turbulence carves defined licking tongues and holes (a soft falloff read as a fuzzy cream column)
    float n = w1 * 0.5 + w2 * 0.32 * k2 + w3 * 0.18 * k3;
    float tongues = 1.0 - abs(snoise(vec3(x * 2.2 + sd, y * asp * 1.5 - tt * 0.9, sd * 0.3)));
    // a teardrop: full width only at the foot, the upper half split along the ridges of the tongue noise into two or
    // three licks (a body solid to three quarters of its height made a fire's overlapping sheets one glowing haystack)
    float halfW = mix(0.9, 0.3, y);
    float body = min((1.0 - abs(x) / halfW) * 1.6, 1.0);
    float shape = body * (1.0 - pow(y, 0.9 + 1.1 * tongues)) * 1.35 + n * (0.2 + 0.5 * y) - 0.12;
    shape -= (1.0 - tongues) * smoothstep(0.25, 0.8, y) * 0.9;
    // a rounded, ragged foot (a flat full-width bottom edge read as a glowing box, above all in the canopy)
    // (an outline one pixel soft whatever the distance)
    float aw = clamp(fwidth(shape), 0.02, 0.1);
    float dens = smoothstep(0.2 - aw, 0.2 + aw, shape) * smoothstep(0.0, 0.16, y + 0.1 * w2 * k2 - 0.3 * x * x);
    // heat: the dense, low core is hottest; edges, tips and older gas cool through orange to a deep red
    float heat = clamp(smoothstep(0.18, 0.8, shape) * (1.1 - vColor.x * 0.6) * (1.0 - 0.45 * y), 0.0, 1.0);
    // a saturated orange body with a gold core, deep red rims — never white (sheets overlap; AgX takes bright
    // orange to cream, so the emission stays near a flame's own and lets the exposure do the rest)
    vec3 c = heat > 0.6 ? mix(vec3(1.0, 0.25, 0.028), vec3(1.0, 0.47, 0.1), (heat - 0.6) / 0.4)
                        : mix(vec3(0.45, 0.025, 0.0), vec3(1.0, 0.25, 0.028), heat / 0.6);
    // display-referred: about the same on screen at night and by day (see FX_EXPOSURE)
    float ex = uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 0.02) : 1.0;
    // (by day, at exposure^-0.65, a fire's overlapping sheets summed past AgX's saturated range into cream haystacks)
    float I = (0.06 + 0.55 * heat * heat) * vColor.y * pow(ex, -0.5) * 0.42;
    // seen from straight above a sheet turned to the camera is a flat stain of flame: dimmer, its light is the pool
    I *= mix(1.0, 0.3, vGlow.y);
    float a = vColor.a * dens * fade;
    // pure emission (a flame never darkens what is behind it: with an occluding alpha, flames by day turned into
    // brown haystacks); the overlap of sheets is kept from summing to white by the display-referred level above
    gl_FragColor = vec4(c * I * a, 0.0);
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
      tExposure: FX_EXPOSURE, uHasExposure: { value: 0 },
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
