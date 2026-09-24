// BLOCKTOOTH — hazard view (CONTRACT §6, §6.1, §8, §10). combat-view lane.
//
// Every alive Hazard gets a ground decal (analytic signed-distance shader per HazardKind, one
// instanced draw per kind) plus kind-specific 3D dressing:
//   wire   VOLT-KITE LIVE WIRE — crackling cyan bolts along the capsule (jittered polyline
//          regenerated ~14×/s, forks, glowing end nodes) over a faint scorched streak.
//   magma  HEARTHBACK pools — crusted basalt plates with glowing, pulsing cracks; bubbles pop.
//   bloom  BRIARWICK turret — a flower-pod plant on a soil mound: segmented stem that sways,
//          leaves, a bulb pod whose five petals snap OPEN when it fires a seed (and part just
//          before), swells on each spore pulse, grows in with a spring and WITHERS (droops,
//          browns, sinks) over its last seconds.
//   spore  healing spore cloud — soft green haze with a dotted swirling rim, translucent puffs
//          drifting round the edge and motes rising.
//   frost  ice zone — pale fern-cracked decal with a bright rim and ink edge (reads on snow),
//          faceted ice crystals that grow in and melt away.
//   fire / oil — generic: scorch + flickering flame tongues / dark slick with an iridescent sheen.
// Hostile hazards (boss frost, any non-titan owner) add a dashed telegraph-pink rim: pink always
// means "this hurts YOU" (CONTRACT §6.1).
// Lifetime: fade/grow in over the first ~0.3 s, fade out over the tail of `life`; hazards removed
// early (turret cap, wire detonation) fade over 0.2 s instead of popping. Run end: the sim stops
// with hazards still alive, so every hazard (paint + dressing) fades out over END_FADE_S from the
// runEnd event — same curve as the telegraph view — clearing the stage for the aftermath and the
// tabloid freeze-frame (which hides this root anyway: no pop at the photo).
// Tracked by hazard id (Map), never by array index. Decals: plane at y ≈ 0.025 slid toward the eye
// along the view ray (same pixels, nearer depth: beats curbs / sidewalks / flood water, still hidden
// by buildings) by slightly less than the telegraph pull, renderOrder 2 — telegraphs always paint
// over hazards. depthWrite off. One instanced draw per kind + one per dressing mesh, hidden when empty.

import * as THREE from 'three';
import type { Hazard, HazardKind, Owner, Shape, World } from '../core/types.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';
import { CAMERA, SIM_DT } from '../core/config.ts';
import { BIOMES } from '../data/biomes.ts';
import { addOutline, bakeOutlineNormals, INK, makeToon } from './materials.ts';

// ─────────────────────────────── constants ───────────────────────────────
const K_VIEW = 2 * Math.tan((CAMERA.fovDeg * Math.PI) / 360);
const HKINDS: readonly HazardKind[] = ['wire', 'magma', 'bloom', 'spore', 'frost', 'fire', 'oil'];
/** decal plane height (m); depth order vs curbs / sidewalks / flood water comes from the view-ray
 *  pull (a little less than the telegraph pull, so telegraphs always paint over hazards) */
const DECAL_Y0 = 0.025;
const DECAL_Y_PER_M = 0.00004;
const PULL0 = 0.26;
const PULL_PER_M = 0.0019;
const GONE_FADE_S = 0.22;
/** run end: every hazard fades out over this long (matches telegraphview END_FADE_S) */
const END_FADE_S = 0.6;
const PINK_FALLBACK = '#ff4fa0';
const SHAPE_ID = { circle: 0, ring: 1, cone: 2, lane: 3, oval: 4, capsule: 5 } as const;
const MAX_TURRETS = 32;

// ─────────────────────────────── decal shaders ───────────────────────────────
const DECAL_VERT = /* glsl */ `
attribute vec4 iA;   // x, z, rot, shape mode
attribute vec4 iB;   // shape params
attribute vec4 iC;   // local box umin, umax, vmin, vmax
attribute vec4 iD;   // fade, age (s), life fraction, hostile
attribute vec4 iE;   // seed, size ref (m), intensity, reserved
uniform float uY;
uniform float uPull;
varying vec2 vL;
varying vec4 vB;
varying vec4 vD;
varying vec4 vE;
varying float vShape;
void main() {
  vec2 L = vec2(mix(iC.x, iC.y, position.x), mix(iC.z, iC.w, position.z));
  float c = cos(iA.z), s = sin(iA.z);
  vec3 wp = vec3(iA.x + L.x * c + L.y * s, uY, iA.y - L.x * s + L.y * c);
  vL = L; vB = iB; vD = iD; vE = iE; vShape = iA.w;
  // view-ray pull: same pixels, nearer depth (beats curbs / water, still hidden by buildings)
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float dl = max(length(mv.xyz), 1e-4);
  mv.xyz *= max(0.05, (dl - uPull) / dl);
  gl_Position = projectionMatrix * mv;
}
`;

const DECAL_COMMON = /* glsl */ `
uniform float uTime;
uniform float uPx;
uniform vec3 uPink;
uniform vec3 uInk;
varying vec2 vL;
varying vec4 vB;
varying vec4 vD;
varying vec4 vE;
varying float vShape;

vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
float hash1(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash1(i), hash1(i + vec2(1.0, 0.0)), f.x), mix(hash1(i + vec2(0.0, 1.0)), hash1(i + vec2(1.0, 1.0)), f.x), f.y);
}
// x = distance to the nearest cell point, y = F2 − F1 (≈ distance to the cell border)
vec2 voro(vec2 x) {
  vec2 n = floor(x), f = fract(x);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + hash2(n + g) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return vec2(sqrt(d1), sqrt(d2) - sqrt(d1));
}
float stripe(float x, float hw) {
  float d = abs(fract(x + 0.5) - 0.5);
  float fw = max(fwidth(x), 1e-4);
  return 1.0 - smoothstep(hw - fw, hw + fw, d);
}
void shapeEval(vec2 L, out float sd, out float per) {
  float m = vShape;
  if (m < 0.5) {
    float d = length(L); sd = d - vB.x; per = atan(L.x, L.y) * vB.x;
  } else if (m < 1.5) {
    float d = length(L); float r0 = vB.x, r1 = vB.y;
    sd = r0 > 1e-3 ? max(r0 - d, d - r1) : d - r1; per = atan(L.x, L.y) * r1;
  } else if (m < 2.5) {
    float d = length(L); float a = atan(L.x, L.y);
    sd = max(d - vB.x, d * sin(clamp(abs(a) - vB.y, -1.5707963, 1.5707963))); per = a * vB.x;
  } else if (m < 3.5) {
    sd = max(abs(L.x) - vB.y * 0.5, max(-L.y, L.y - vB.x)); per = L.y + abs(L.x);
  } else if (m < 4.5) {
    vec2 k = L / vec2(vB.x, vB.y); float e = length(k);
    vec2 g = L / vec2(vB.x * vB.x, vB.y * vB.y);
    sd = (e - 1.0) / max(length(g) / max(e, 1e-4), 1e-5); per = atan(k.x, k.y) * (vB.x + vB.y) * 0.5;
  } else {
    float cv = clamp(L.y, 0.0, vB.x);
    sd = length(vec2(L.x, L.y - cv)) - vB.y; per = L.y + abs(L.x);
  }
}
`;

/** kind paint: vec4 paint(vec2 L, float sd, float R, float t, float seed, float aa, float life) → rgb (linear), alpha */
const PAINT: Record<HazardKind, string> = {
  magma: /* glsl */ `
vec4 paint(vec2 L, float sd, float R, float t, float seed, float aa, float life) {
  float n = vnoise(L / (R * 0.32) + seed * 17.0);
  float e = sd + (n - 0.5) * R * 0.2;
  float inside = 1.0 - smoothstep(-aa, aa, e);
  if (inside <= 0.001) return vec4(0.0);
  vec2 v = voro(L / (R * 0.27) + vec2(seed * 9.1, seed * 3.7));
  float wob = vnoise(L / (R * 0.18) + vec2(t * 0.35, -t * 0.22));
  float cw = 0.05 + 0.035 * wob;
  float crack = 1.0 - smoothstep(cw * 0.35, cw, v.y);
  float core = 1.0 - smoothstep(0.0, R, length(L));
  float pulse = 0.72 + 0.28 * sin(t * 2.4 + wob * 6.2832 + seed * 5.0);
  float cell = hash1(floor(L / (R * 0.27) + vec2(seed * 9.1, seed * 3.7)));
  vec3 crust = mix(lin(vec3(0.165, 0.141, 0.2)), lin(vec3(0.29, 0.247, 0.322)), cell * 0.8 + 0.2 * (1.0 - v.x));
  // cooler outer crust ring
  float edge = smoothstep(-R * 0.18, 0.0, e);
  crust = mix(crust, lin(vec3(0.11, 0.09, 0.12)), edge * 0.6);
  vec3 hot = mix(lin(vec3(1.0, 0.478, 0.18)), lin(vec3(1.0, 0.82, 0.4)), crack * pulse * (0.4 + 0.6 * core));
  float glowAmt = crack * (0.45 + 0.55 * core) * (1.0 - edge * 0.7);
  // hot seep between plates near the centre
  float seep = (1.0 - smoothstep(0.0, 0.25, v.y)) * core * 0.35 * pulse;
  vec3 col = mix(crust, hot, clamp(glowAmt + seep, 0.0, 1.0));
  return vec4(col, 0.97 * inside);
}`,
  frost: /* glsl */ `
vec4 paint(vec2 L, float sd, float R, float t, float seed, float aa, float life) {
  float n = vnoise(L / (R * 0.28) + seed * 11.0);
  float e = sd + (n - 0.5) * R * 0.14;
  float inkW = max(1.5 * aa, uPx * 1.3);
  float inside = 1.0 - smoothstep(-aa, aa, e);
  float ink = (1.0 - inside) * (1.0 - smoothstep(inkW - aa, inkW + aa, e));
  if (inside + ink <= 0.001) return vec4(0.0);
  vec2 v = voro(L / (R * 0.2) + seed * 5.0);
  vec2 v2 = voro(L / (R * 0.07) + seed * 2.0);
  float crack = 1.0 - smoothstep(0.012, 0.05, v.y);
  float fine = (1.0 - smoothstep(0.02, 0.07, v2.y)) * 0.45;
  float rimW = max(2.2 * aa, uPx * 2.0);
  float rim = inside * smoothstep(-rimW - R * 0.05, -aa, e);
  vec3 ice = mix(lin(vec3(0.75, 0.9, 1.0)), lin(vec3(0.9, 0.97, 1.0)), smoothstep(-R, 0.0, e));
  vec3 col = mix(ice, lin(vec3(0.36, 0.63, 0.84)), max(crack, fine));
  float a = mix(0.58, 0.8, max(crack, fine));
  float tw = step(0.985, hash1(floor(L / max(R * 0.045, uPx * 3.0)) + seed)) * (0.5 + 0.5 * sin(t * 6.0 + hash1(floor(L / max(R * 0.045, uPx * 3.0))) * 30.0));
  col = mix(col, vec3(1.0), tw);
  col = mix(col, vec3(1.0), rim * 0.85);
  a = mix(a, 0.95, rim);
  col = mix(col, uInk, ink);
  a = mix(a * inside, 0.6, ink);
  return vec4(col, a);
}`,
  spore: /* glsl */ `
vec4 paint(vec2 L, float sd, float R, float t, float seed, float aa, float life) {
  float d = length(L);
  float soft = 1.0 - smoothstep(-R * 0.08, 0.0, sd);
  if (soft <= 0.001 && sd > 0.0) return vec4(0.0);
  float a0 = mix(0.12, 0.3, smoothstep(-R, 0.0, sd)) * soft;
  float ang = atan(L.x, L.y);
  float swirl = stripe(ang * 1.5915 * 3.0 + d / (R * 0.35) - t * 0.35, 0.1) * 0.5 * soft;
  // dotted rim of spores circling slowly
  float band = -sd;
  float ringC = R * 0.07;
  float per = ang * R;
  float cellW = max(R * 0.16, uPx * 8.0);
  float along = fract(per / cellW - t * 0.12) - 0.5;
  vec2 dp = vec2(along * cellW, band - ringC);
  float dotR = max(R * 0.035, uPx * 2.2);
  float dotsM = 1.0 - smoothstep(dotR - aa, dotR + aa, length(dp));
  vec3 cA = lin(vec3(0.847, 1.0, 0.478));
  vec3 cB = lin(vec3(0.56, 0.82, 0.31));
  vec3 col = mix(cB, cA, swirl + dotsM);
  float a = max(a0 + swirl * 0.35, dotsM * 0.9);
  return vec4(col, a);
}`,
  wire: /* glsl */ `
vec4 paint(vec2 L, float sd, float R, float t, float seed, float aa, float life) {
  float inside = 1.0 - smoothstep(-aa, aa, sd);
  if (inside <= 0.001) return vec4(0.0);
  float core = clamp(-sd / max(R, 1e-3), 0.0, 1.0);
  float n = vnoise(L / (R * 0.6) + seed * 3.0);
  float scorch = 0.42 * pow(core, 0.6) * (0.65 + 0.35 * n);
  float flick = 0.6 + 0.4 * sin(t * 37.0 + L.y * 0.7 / max(R, 1e-3));
  float glow = exp(-pow((1.0 - core) * 3.2, 2.0)) * flick * 0.55;
  vec3 col = mix(lin(vec3(0.106, 0.078, 0.149)), lin(vec3(0.435, 0.953, 1.0)), glow);
  return vec4(col, max(scorch, glow) * inside);
}`,
  fire: /* glsl */ `
vec4 paint(vec2 L, float sd, float R, float t, float seed, float aa, float life) {
  float n = vnoise(L / (R * 0.3) + seed * 7.0);
  float e = sd + (n - 0.5) * R * 0.25;
  float inside = 1.0 - smoothstep(-R * 0.1, 0.0, e);
  if (inside <= 0.001) return vec4(0.0);
  float em = vnoise(L / (R * 0.09) + vec2(0.0, -t * 0.8));
  float hot = smoothstep(0.62, 0.9, em) * (0.6 + 0.4 * sin(t * 9.0 + em * 20.0));
  vec3 col = mix(lin(vec3(0.12, 0.09, 0.1)), lin(vec3(1.0, 0.55, 0.2)), hot);
  return vec4(col, (0.6 + 0.35 * hot) * inside);
}`,
  oil: /* glsl */ `
vec4 paint(vec2 L, float sd, float R, float t, float seed, float aa, float life) {
  float n = vnoise(L / (R * 0.35) + seed * 13.0);
  float e = sd + (n - 0.5) * R * 0.3;
  float inside = 1.0 - smoothstep(-aa, aa, e);
  if (inside <= 0.001) return vec4(0.0);
  float s = vnoise(L / (R * 0.22) + vec2(t * 0.05, t * 0.03)) * 6.2832;
  vec3 sheen = 0.5 + 0.5 * cos(s + vec3(0.0, 2.1, 4.2));
  float band = smoothstep(0.55, 0.9, sin(s * 2.0 + t * 0.4) * 0.5 + 0.5);
  vec3 col = mix(lin(vec3(0.078, 0.07, 0.1)), lin(sheen * 0.45), band * 0.55);
  col = mix(col, vec3(0.9), 0.35 * (1.0 - smoothstep(0.0, R * 0.05, abs(e + R * 0.06))));
  return vec4(col, 0.88 * inside);
}`,
  bloom: /* glsl */ `
vec4 paint(vec2 L, float sd, float R, float t, float seed, float aa, float life) {
  float n = vnoise(L / (R * 0.4) + seed * 19.0);
  float e = sd + (n - 0.5) * R * 0.35;
  float inside = 1.0 - smoothstep(-aa * 2.0, aa * 2.0, e);
  if (inside <= 0.001) return vec4(0.0);
  // round moss tufts + fallen petals scattered on the soil (jittered dots, one per cell)
  float cs = max(R * 0.16, 1e-3);
  vec2 cell = floor(L / cs);
  vec2 fc = fract(L / cs) - 0.5 - (hash2(cell + seed) - 0.5) * 0.5;
  float h = hash1(cell + seed);
  float dotM = 1.0 - smoothstep(0.2, 0.26, length(fc));
  vec3 soil = mix(lin(vec3(0.29, 0.23, 0.165)), lin(vec3(0.42, 0.29, 0.18)), vnoise(L / (R * 0.12)));
  vec3 col = soil;
  if (h > 0.62) col = mix(col, lin(vec3(0.37, 0.56, 0.23)), dotM);
  if (h > 0.9) col = mix(col, lin(vec3(1.0, 0.62, 0.78)), dotM);
  col = mix(col, soil * 0.7, life * 0.8);
  return vec4(col, 0.9 * inside);
}`,
};

const DECAL_MAIN = /* glsl */ `
void main() {
  float fade = vD.x, age = vD.y, lifeF = vD.z, hostile = vD.w;
  float seed = vE.x, R = max(vE.y, 1e-3);
  float t = uTime + seed * 13.7;
  float sd, per;
  shapeEval(vL, sd, per);
  float aa = max(fwidth(sd), 1e-4);
  if (sd > R * 0.4 + uPx * 6.0) discard;
  vec4 c = paint(vL, sd, R, t, seed, aa, lifeF);
  // hostile: dashed telegraph-pink rim (pink = hurts you)
  if (hostile > 0.5) {
    float rimW = max(2.4 * aa, uPx * 2.2);
    float band = (1.0 - smoothstep(-aa, aa, sd)) * smoothstep(-rimW - aa, -rimW + aa, sd);
    float dash = stripe(per / max(uPx * 10.0, R * 0.08) - t * 0.8, 0.3);
    float m = band * dash;
    c.rgb = mix(c.rgb, uPink, m);
    c.a = mix(c.a, 0.95, m);
  }
  c.a *= fade;
  if (c.a < 0.003) discard;
  gl_FragColor = c;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ribbons (wire bolts) and soft dots (end nodes, spore motes)
const RIBBON_VERT = /* glsl */ `
attribute vec4 iH;   // head xyz, half-width
attribute vec4 iT;   // tail xyz, half-width
attribute vec4 iC;   // rgb, alpha (negative = no fade along)
varying vec2 vQ;
varying vec4 vC;
void main() {
  vec4 h = viewMatrix * vec4(iH.xyz, 1.0);
  vec4 t = viewMatrix * vec4(iT.xyz, 1.0);
  vec2 d = t.xy - h.xy;
  float l = length(d);
  d = l > 1e-5 ? d / l : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  float a = position.x;
  float side = position.z * 2.0 - 1.0;
  vec4 p = mix(h, t, a);
  float wdt = mix(iH.w, iT.w, a);
  // overshoot both ends by the width so consecutive segments join without gaps
  p.xy += n * wdt * side + d * wdt * (a * 2.0 - 1.0);
  vQ = vec2(a, side);
  vC = iC;
  gl_Position = projectionMatrix * p;
}
`;
const RIBBON_FRAG = /* glsl */ `
varying vec2 vQ;
varying vec4 vC;
void main() {
  float along = vC.a < 0.0 ? 1.0 : 1.0 - vQ.x;
  float across = 1.0 - vQ.y * vQ.y;
  float a = abs(vC.a) * along * smoothstep(0.0, 0.45, across);
  if (a < 0.004) discard;
  vec3 col = mix(vC.rgb, vec3(1.0), 0.5 * across * across);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const DOT_VERT = /* glsl */ `
attribute vec4 iP;   // xyz, radius
attribute vec4 iC;   // rgb, alpha
varying vec2 vQ;
varying vec4 vC;
void main() {
  vec4 v = viewMatrix * vec4(iP.xyz, 1.0);
  vQ = position.xz * 2.0 - 1.0;
  v.xy += vQ * iP.w;
  vC = iC;
  gl_Position = projectionMatrix * v;
}
`;
const DOT_FRAG = /* glsl */ `
varying vec2 vQ;
varying vec4 vC;
void main() {
  float r = length(vQ);
  if (r >= 1.0) discard;
  float k = 1.0 - r;
  gl_FragColor = vec4(mix(vC.rgb, vec3(1.0), 0.35 * k * k * k), vC.a * k * k * (0.6 + 0.4 * k));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ─────────────────────────────── instanced quad batch ───────────────────────────────
class QuadBatch {
  readonly geo = new THREE.InstancedBufferGeometry();
  readonly mesh: THREE.Mesh;
  private data: Float32Array;
  private buf: THREE.InstancedInterleavedBuffer;
  private readonly stride: number;
  private readonly names: readonly string[];
  cap: number;
  n = 0;

  constructor(mat: THREE.Material, names: readonly string[], cap: number, name: string, renderOrder: number) {
    this.names = names;
    this.stride = names.length * 4;
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1], 3));
    this.geo.setIndex([0, 2, 1, 1, 2, 3]);
    this.geo.instanceCount = 0;
    this.cap = cap;
    this.data = new Float32Array(cap * this.stride);
    this.buf = this.bind(this.data);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
  }
  private bind(data: Float32Array): THREE.InstancedInterleavedBuffer {
    const ib = new THREE.InstancedInterleavedBuffer(data, this.stride, 1);
    ib.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.names.length; i++) this.geo.setAttribute(this.names[i], new THREE.InterleavedBufferAttribute(ib, 4, i * 4));
    return ib;
  }
  begin(): void { this.n = 0; }
  slot(): number {
    if (this.n >= this.cap) {
      const cap = this.cap * 2;
      const d = new Float32Array(cap * this.stride);
      d.set(this.data);
      this.geo.dispose();
      this.data = d;
      this.cap = cap;
      this.buf = this.bind(d);
    }
    return (this.n++) * this.stride;
  }
  get f(): Float32Array { return this.data; }
  end(): void {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0) {
      this.buf.clearUpdateRanges();
      this.buf.addUpdateRange(0, this.n * this.stride);
      this.buf.needsUpdate = true;
    }
  }
  dispose(): void { this.geo.dispose(); }
}

// ─────────────────────────────── faceted geometry (winding fixed by construction) ───────────────────────────────
const _c = new THREE.Color();
class Geo {
  pos: number[] = [];
  col: number[] = [];
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
    color: THREE.Color, ox: number, oy: number, oz: number): void {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-14) return;
    const gx = (ax + bx + cx) / 3 - ox, gy = (ay + by + cy) / 3 - oy, gz = (az + bz + cz) / 3 - oz;
    if (nx * gx + ny * gy + nz * gz >= 0) this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    else this.pos.push(ax, ay, az, cx, cy, cz, bx, by, bz);
    for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
  }
  /** surface of revolution around +Y; profile = [r, y] pairs bottom → top */
  latheY(profile: readonly number[], segs: number, color: (ring: number, seg: number) => string, roll = 0): void {
    for (let i = 0; i + 3 < profile.length; i += 2) {
      const r0 = profile[i], y0 = profile[i + 1], r1 = profile[i + 2], y1 = profile[i + 3];
      const ym = (y0 + y1) / 2;
      for (let j = 0; j < segs; j++) {
        const a0 = roll + (j / segs) * Math.PI * 2, a1 = roll + ((j + 1) / segs) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        _c.set(color(i / 2, j)); const col = _c.clone();
        if (r0 > 1e-6) this.tri(r0 * c0, y0, r0 * s0, r0 * c1, y0, r0 * s1, r1 * c1, y1, r1 * s1, col, 0, ym, 0);
        if (r1 > 1e-6) this.tri(r0 * c0, y0, r0 * s0, r1 * c1, y1, r1 * s1, r1 * c0, y1, r1 * s0, col, 0, ym, 0);
      }
    }
  }
  /** a thin double-faced leaf/petal lying along +Y from the origin (width across X, bulge toward +Z) */
  leaf(len: number, width: number, thick: number, cBase: string, cTip: string): void {
    // outline points along the leaf (y, half-width)
    const prof = [[0, 0.05], [0.25, 0.8], [0.55, 1.0], [0.8, 0.7], [1.0, 0]];
    const cb = new THREE.Color(cBase), ct = new THREE.Color(cTip);
    for (let i = 0; i + 1 < prof.length; i++) {
      const [y0, w0] = prof[i], [y1, w1] = prof[i + 1];
      const ya = y0 * len, yb = y1 * len;
      const xa = w0 * width * 0.5, xb = w1 * width * 0.5;
      const za = thick * (0.3 + 0.7 * Math.sin(y0 * Math.PI)), zb = thick * (0.3 + 0.7 * Math.sin(y1 * Math.PI));
      const col = cb.clone().lerp(ct, (y0 + y1) / 2);
      const ym = (ya + yb) / 2;
      // front (+Z bulge along the midrib) and back faces, each around its own inside reference
      this.tri(-xa, ya, 0, xa, ya, 0, 0, ym, (za + zb) * 0.5, col, 0, ym, -1);
      this.tri(-xa, ya, 0, -xb, yb, 0, 0, ym, (za + zb) * 0.5, col, 0, ym, -1);
      this.tri(xa, ya, 0, xb, yb, 0, 0, ym, (za + zb) * 0.5, col, 0, ym, -1);
      this.tri(-xb, yb, 0, xb, yb, 0, 0, ym, (za + zb) * 0.5, col, 0, ym, -1);
      const back = col.clone().multiplyScalar(0.8);
      this.tri(-xa, ya, 0, xa, ya, 0, 0, ym, -(za + zb) * 0.25, back, 0, ym, 1);
      this.tri(-xa, ya, 0, -xb, yb, 0, 0, ym, -(za + zb) * 0.25, back, 0, ym, 1);
      this.tri(xa, ya, 0, xb, yb, 0, 0, ym, -(za + zb) * 0.25, back, 0, ym, 1);
      this.tri(-xb, yb, 0, xb, yb, 0, 0, ym, -(za + zb) * 0.25, back, 0, ym, 1);
    }
  }
  rock(radius: number, detail: number, jitter: number, seed: number, sy: number, color: (ny: number, i: number) => string): void {
    const src = new THREE.IcosahedronGeometry(1, detail);
    const p = src.getAttribute('position');
    const idx = src.index;
    const n = idx ? idx.count : p.count;
    const jit = new Map<string, number>();
    const V = (k: number, out: number[]) => {
      const vi = idx ? idx.getX(k) : k;
      const x = p.getX(vi), y = p.getY(vi), z = p.getZ(vi);
      const key = x.toFixed(3) + ',' + y.toFixed(3) + ',' + z.toFixed(3);
      let s = jit.get(key);
      if (s === undefined) {
        const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453;
        s = 1 + (h - Math.floor(h) - 0.5) * 2 * jitter;
        jit.set(key, s);
      }
      out[0] = x * s * radius; out[1] = y * s * radius * sy; out[2] = z * s * radius;
    };
    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
    for (let k = 0; k + 2 < n; k += 3) {
      V(k, a); V(k + 1, b); V(k + 2, c);
      const gy = (a[1] + b[1] + c[1]) / 3 / Math.max(1e-6, radius * sy);
      _c.set(color(gy, k / 3));
      this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], _c.clone(), 0, 0, 0);
    }
    src.dispose();
  }
  build(outline: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    if (outline) bakeOutlineNormals(g);
    return g;
  }
}

// plant parts (unit scale; the view scales by the plant size S)
function moundGeo(): THREE.BufferGeometry {
  const g = new Geo();
  g.rock(1, 1, 0.22, 5, 0.42, (ny, i) => (ny > 0.55 ? (i % 3 === 0 ? '#6b8f3a' : '#5e8f3a') : i % 2 ? '#6b4a2f' : '#7a5a3a'));
  return g.build(true);
}
function stemGeo(): THREE.BufferGeometry {
  const g = new Geo();
  g.latheY([1, 0, 0.92, 0.5, 0.8, 1.0], 6, (ring, seg) => (seg % 2 ? '#4f7f2e' : '#5e8f3a'));
  return g.build(true);
}
function podGeo(): THREE.BufferGeometry {
  const g = new Geo();
  g.latheY([0.35, -0.1, 0.8, 0.15, 1.0, 0.5, 0.85, 0.9, 0.45, 1.2, 0, 1.38], 7,
    (ring, seg) => (ring >= 4 ? '#ff9ec7' : ring === 3 ? '#c9d98f' : seg % 2 ? '#6fa840' : '#8fbf4f'));
  return g.build(true);
}
function petalGeo(): THREE.BufferGeometry {
  const g = new Geo();
  g.leaf(1, 0.55, 0.12, '#e86aa0', '#ffd0e4');
  return g.build(true);
}
function leafGeo(): THREE.BufferGeometry {
  const g = new Geo();
  g.leaf(1, 0.5, 0.1, '#3f7a2a', '#8fbf4f');
  return g.build(true);
}
function crystalGeo(): THREE.BufferGeometry {
  const g = new Geo();
  // hexagonal ice shard with a pointed top (unit height)
  g.latheY([0.0, 0.0, 0.26, 0.02, 0.3, 0.55, 0.24, 0.72, 0.0, 1.0], 6,
    (ring, seg) => (ring >= 3 ? '#f4fbff' : seg % 2 ? '#bfe6ff' : '#9fd4f5'), 0.3);
  return g.build(true);
}
function bubbleGeo(): THREE.BufferGeometry {
  const g = new Geo();
  g.rock(1, 1, 0.08, 2, 1, (ny) => (ny > 0.35 ? '#ffd166' : ny > -0.2 ? '#ffb13b' : '#ff7a2e'));
  return g.build(false);
}
function flameGeo(): THREE.BufferGeometry {
  const g = new Geo();
  g.latheY([0.0, 0.0, 0.45, 0.08, 0.5, 0.3, 0.32, 0.62, 0.0, 1.0], 6,
    (ring) => (ring === 0 ? '#fff1a8' : ring === 1 ? '#ffd166' : ring === 2 ? '#ff9a3c' : '#ff5a2e'));
  return g.build(true);
}
function puffGeo(): THREE.BufferGeometry {
  const g = new Geo();
  g.rock(1, 1, 0.14, 9, 0.8, () => '#ffffff');
  return g.build(false);
}

// ─────────────────────────────── per-hazard view state ───────────────────────────────
interface HzRec {
  id: number;
  kind: HazardKind;
  owner: Owner;
  k: Shape['k'];
  x: number; z: number; rot: number;
  p0: number; p1: number; p2: number; p3: number;
  // capsule endpoints (wire bolts)
  x0: number; z0: number; x1: number; z1: number;
  t: number; life: number;
  size: number;                  // characteristic radius (m)
  h: number;                     // bloom: titan height at spawn
  cd: number; spore: number;     // bloom: last seen data
  fireAt: number; sporeAt: number;
  /** bloom: the last cooldown re-arm came from a REAL shot (not a no-target retry) */
  armed: boolean;
  /** bloom: last seen h.data.shots (−1 = the kit does not publish a shot counter) */
  shots: number;
  seen: boolean;
  goneAt: number;
  seed: number;
}

function newRec(): HzRec {
  return {
    id: -1, kind: 'fire', owner: 'titan', k: 'circle', x: 0, z: 0, rot: 0, p0: 0, p1: 0, p2: 0, p3: 0,
    x0: 0, z0: 0, x1: 0, z1: 0, t: 0, life: 1, size: 1, h: 1, cd: 1, spore: 4, fireAt: -99, sporeAt: -99,
    armed: false, shots: -1, seen: false, goneAt: -1, seed: 0,
  };
}

function copyShape(r: HzRec, s: Shape): void {
  r.k = s.k; r.p2 = 0; r.p3 = 0;
  switch (s.k) {
    case 'circle': r.x = s.x; r.z = s.z; r.rot = 0; r.p0 = s.r; r.p1 = 0; r.size = s.r; r.x0 = r.x1 = s.x; r.z0 = r.z1 = s.z; break;
    case 'ring': r.x = s.x; r.z = s.z; r.rot = 0; r.p0 = s.r0; r.p1 = Math.max(s.r0 + 1e-3, s.r1); r.size = s.r1; r.x0 = r.x1 = s.x; r.z0 = r.z1 = s.z; break;
    case 'cone': r.x = s.x; r.z = s.z; r.rot = s.dir; r.p0 = s.r; r.p1 = s.half; r.size = s.r * 0.5; r.x0 = r.x1 = s.x; r.z0 = r.z1 = s.z; break;
    case 'lane': r.x = s.x; r.z = s.z; r.rot = s.dir; r.p0 = s.len; r.p1 = s.w; r.size = s.w * 0.5;
      r.x0 = s.x; r.z0 = s.z; r.x1 = s.x + Math.sin(s.dir) * s.len; r.z1 = s.z + Math.cos(s.dir) * s.len; break;
    case 'oval': r.x = s.x; r.z = s.z; r.rot = s.rot; r.p0 = s.rx; r.p1 = s.rz; r.size = Math.min(s.rx, s.rz); r.x0 = r.x1 = s.x; r.z0 = r.z1 = s.z; break;
    case 'capsule': {
      const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
      const len = Math.hypot(dx, dz);
      r.x = s.x0; r.z = s.z0; r.rot = len > 1e-6 ? Math.atan2(dx, dz) : 0;
      r.p0 = len; r.p1 = Math.max(0.01, s.r); r.size = Math.max(0.01, s.r);
      r.x0 = s.x0; r.z0 = s.z0; r.x1 = s.x1; r.z1 = s.z1;
      break;
    }
  }
}

/** deterministic 0..1 hash of (a, b, c) for cosmetic layouts */
function h3(a: number, b: number, c: number): number {
  const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return s - Math.floor(s);
}
const easeOutBack = (t: number) => { const s = 1.70158, u = t - 1; return 1 + (s + 1) * u * u * u + s * u * u; };
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

interface IM { mesh: THREE.InstancedMesh; cap: number; n: number; }

// ─────────────────────────────── the view ───────────────────────────────
export class HazardView implements ViewModule {
  private readonly ctx: ViewCtx;
  private readonly root = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly decalMats = new Map<HazardKind, THREE.ShaderMaterial>();
  private readonly decals = new Map<HazardKind, QuadBatch>();
  private readonly ribbons: QuadBatch;
  private readonly dots: QuadBatch;
  private readonly mound: IM;
  private readonly stem: IM;
  private readonly pod: IM;
  private readonly petals: IM;
  private readonly leaves: IM;
  private readonly crystals: IM;
  private readonly bubbles: IM;
  private readonly flames: IM;
  private readonly puffs: IM;
  private readonly recs = new Map<number, HzRec>();
  private readonly pool: HzRec[] = [];
  private readonly doomed: number[] = [];
  private mounted = false;
  /** highest projectile id already checked for bloom seeds (seed shots → petal recoil) */
  private lastProjId = -1;
  /** real time of the runEnd event (−1 = run live) */
  private endAt = -1;
  /** 1 while the run is live, → 0 over END_FADE_S after runEnd (dressing that ignores the tail fade) */
  private endK = 1;

  // scratch
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly e = new THREE.Euler();
  private readonly col = new THREE.Color();
  private static readonly X = new THREE.Vector3(1, 0, 0);
  private static readonly Y = new THREE.Vector3(0, 1, 0);
  private readonly pts: number[] = new Array(64).fill(0);

  constructor(ctx: ViewCtx) {
    this.ctx = ctx;
    this.root.name = 'view:hazards';
    this.root.matrixAutoUpdate = false;

    for (const k of HKINDS) {
      const mat = new THREE.ShaderMaterial({
        name: 'hazard:' + k,
        uniforms: {
          uTime: { value: 0 }, uPx: { value: 0.02 }, uY: { value: DECAL_Y0 }, uPull: { value: PULL0 },
          uPink: { value: new THREE.Color(PINK_FALLBACK) }, uInk: { value: new THREE.Color(INK) },
        },
        vertexShader: DECAL_VERT,
        fragmentShader: DECAL_COMMON + PAINT[k] + DECAL_MAIN,
        transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
        toneMapped: true,
      });
      this.decalMats.set(k, mat);
      this.mats.push(mat);
      const b = new QuadBatch(mat, ['iA', 'iB', 'iC', 'iD', 'iE'], 16, 'hz:decal:' + k, 2);
      this.decals.set(k, b);
      this.root.add(b.mesh);
    }
    const ribbonMat = new THREE.ShaderMaterial({
      name: 'hazardRibbon', vertexShader: RIBBON_VERT, fragmentShader: RIBBON_FRAG,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: true,
    });
    const dotMat = new THREE.ShaderMaterial({
      name: 'hazardDot', vertexShader: DOT_VERT, fragmentShader: DOT_FRAG,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: true,
    });
    this.mats.push(ribbonMat, dotMat);
    this.ribbons = new QuadBatch(ribbonMat, ['iH', 'iT', 'iC'], 256, 'hz:bolts', 6);
    this.dots = new QuadBatch(dotMat, ['iP', 'iC'], 128, 'hz:dots', 6);
    this.root.add(this.ribbons.mesh, this.dots.mesh);

    const toon = makeToon({ vertexColors: true });
    const basic = new THREE.MeshBasicMaterial({ vertexColors: true });
    const puffMat = makeToon({ color: '#d8ff7a' });
    puffMat.transparent = true; puffMat.opacity = 0.5; puffMat.depthWrite = false;
    this.mats.push(toon, basic, puffMat);
    const mk = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, outline: number, tint: boolean, order = 0): IM => {
      this.geos.push(geo);
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.name = 'hz:' + name;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (tint) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.count = 0;
      mesh.visible = false;
      mesh.renderOrder = order;
      if (outline > 0) addOutline(mesh, outline);
      this.root.add(mesh);
      return { mesh, cap, n: 0 };
    };
    this.mound = mk('mound', moundGeo(), toon, MAX_TURRETS, 1.6, false);
    this.stem = mk('stem', stemGeo(), toon, MAX_TURRETS * 3, 1.4, true);
    this.pod = mk('pod', podGeo(), toon, MAX_TURRETS, 1.8, true);
    this.petals = mk('petal', petalGeo(), toon, MAX_TURRETS * 5, 1.4, true);
    this.leaves = mk('leaf', leafGeo(), toon, MAX_TURRETS * 3, 1.3, true);
    this.crystals = mk('crystal', crystalGeo(), toon, 320, 1.4, false);
    this.bubbles = mk('bubble', bubbleGeo(), basic, 256, 0, false);
    this.flames = mk('flame', flameGeo(), basic, 256, 1.2, false);
    this.puffs = mk('sporePuff', puffGeo(), puffMat, 512, 0, false, 7);
    // turret parts cast shadows: they are the only tall hazard dressing
    for (const m of [this.mound, this.stem, this.pod, this.petals, this.leaves]) m.mesh.castShadow = true;
  }

  mount(world: World): void {
    this.clearRecs();
    this.lastProjId = -1;
    this.endAt = -1;
    const hex = BIOMES[world.biomeId]?.palette?.telegraph ?? PINK_FALLBACK;
    for (const m of this.decalMats.values()) (m.uniforms.uPink.value as THREE.Color).set(hex);
    if (!this.mounted) { this.ctx.scene.add(this.root); this.mounted = true; }
    this.hideAll();
  }

  unmount(): void {
    this.clearRecs();
    if (this.mounted) { this.ctx.scene.remove(this.root); this.mounted = false; }
    this.hideAll();
  }

  /** release GPU resources (page teardown) */
  dispose(): void {
    this.unmount();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const b of this.decals.values()) b.dispose();
    this.ribbons.dispose(); this.dots.dispose();
  }

  private hideAll(): void {
    for (const b of this.decals.values()) { b.begin(); b.end(); }
    this.ribbons.begin(); this.ribbons.end();
    this.dots.begin(); this.dots.end();
    for (const m of this.ims()) { m.n = 0; m.mesh.count = 0; m.mesh.visible = false; }
  }

  private imList: IM[] | null = null;
  /** every instanced dressing mesh (cached: no per-frame allocation) */
  private ims(): IM[] {
    if (!this.imList) this.imList = [this.mound, this.stem, this.pod, this.petals, this.leaves, this.crystals, this.bubbles, this.flames, this.puffs];
    return this.imList;
  }

  private clearRecs(): void {
    for (const r of this.recs.values()) this.pool.push(r);
    this.recs.clear();
  }

  update(w: World, f: FrameInfo): void {
    const now = f.time;
    const cssH = Math.max(1, this.ctx.renderer.domElement.clientHeight || 720);
    const px = Math.max(1e-4, (f.camDist * K_VIEW) / cssH);
    const y = DECAL_Y0 + f.camDist * DECAL_Y_PER_M;
    const pull = PULL0 + f.camDist * PULL_PER_M;
    for (const m of this.decalMats.values()) {
      m.uniforms.uTime.value = now; m.uniforms.uPx.value = px; m.uniforms.uY.value = y; m.uniforms.uPull.value = pull;
    }
    const back = f.frozen ? 0 : SIM_DT * (1 - Math.min(1, Math.max(0, f.alpha)));
    const ev = f.events;
    for (let i = 0; i < ev.length; i++) {
      if (ev[i].type === 'runEnd' && this.endAt < 0) { this.endAt = now; break; }
    }
    // run over: the sim is stopped with hazards still alive — fade the whole stage out
    const endK = this.endK = this.endAt >= 0 ? clamp01(1 - (now - this.endAt) / END_FADE_S) : 1;

    for (const r of this.recs.values()) r.seen = false;
    const list = w.hazards;
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      if (!h.alive) continue;
      let r = this.recs.get(h.id);
      if (!r) {
        r = this.pool.pop() ?? newRec();
        r.id = h.id; r.goneAt = -1; r.fireAt = -99; r.sporeAt = -99; r.armed = false; r.shots = -1;
        r.seed = ((h.id * 2654435761) >>> 0) / 4294967296;
        r.cd = h.data.cd ?? 1; r.spore = h.data.spore ?? 4;
        this.recs.set(h.id, r);
      }
      this.sync(r, h, back, now);
    }
    this.matchSeeds(w, now);
    this.doomed.length = 0;
    for (const r of this.recs.values()) {
      if (!r.seen && r.goneAt < 0) r.goneAt = now;
      if (r.goneAt >= 0 && now - r.goneAt >= GONE_FADE_S) this.doomed.push(r.id);
    }
    for (let i = 0; i < this.doomed.length; i++) {
      const r = this.recs.get(this.doomed[i]);
      if (r) { this.pool.push(r); this.recs.delete(this.doomed[i]); }
    }

    // draw
    for (const b of this.decals.values()) b.begin();
    this.ribbons.begin(); this.dots.begin();
    for (const m of this.ims()) m.n = 0;
    const lvl = this.ctx.quality.level;
    let turrets = 0;
    for (const r of this.recs.values()) {
      const fade = this.fadeOf(r, now) * endK;
      if (fade <= 0.001) continue;
      this.decal(r, fade, px);
      switch (r.kind) {
        case 'wire': this.drawWire(r, fade, px, now, lvl); break;
        case 'magma': this.drawMagma(r, fade, px, now, lvl); break;
        case 'bloom': if (turrets++ < MAX_TURRETS) this.drawBloom(r, fade, px, now); break;
        case 'spore': this.drawSpore(r, fade, px, now, lvl); break;
        case 'frost': this.drawFrost(r, fade, px, now, lvl); break;
        case 'fire': this.drawFire(r, fade, px, now, lvl); break;
        case 'oil': break;
      }
    }
    for (const b of this.decals.values()) b.end();
    this.ribbons.end(); this.dots.end();
    for (const m of this.ims()) this.commit(m);
  }

  private sync(r: HzRec, h: Hazard, back: number, now: number): void {
    r.seen = true;
    r.kind = h.kind;
    r.owner = h.owner;
    copyShape(r, h.shape);
    r.t = Math.max(0, h.t - back);
    r.life = Math.max(1e-3, h.life);
    if (h.kind === 'bloom') {
      const hh = h.data.h;
      r.h = hh !== undefined && hh > 0 ? hh : Math.max(0.5, r.size / 0.3);
      // Shot detection. The kit re-arms the SAME cooldown field when it finds no target (seedRetryS),
      // so a cooldown jump is NOT a shot (that made idle pods recoil ~4x/s with no seed fired). A real
      // shot is either a change of h.data.shots (when the kit publishes a counter) or a new 'seed'
      // projectile leaving this pod (matchSeeds, after the sync loop).
      const shots = h.data.shots;
      if (shots !== undefined) {
        if (r.shots >= 0 && shots !== r.shots) { r.fireAt = now; r.armed = true; }
        r.shots = shots;
      }
      const cd = h.data.cd;
      if (cd !== undefined) {
        if (cd > r.cd + 0.15 && now - r.fireAt > 0.05) r.armed = false;   // re-armed without a shot: retry
        r.cd = cd;
      }
      const sp = h.data.spore;
      if (sp !== undefined) {
        if (sp > r.spore + 1) r.sporeAt = now;          // spore timer wrapped → pulse
        r.spore = sp;
      }
    }
  }

  /**
   * New titan 'seed' projectiles → the pod that fired them (seeds spawn at the pod centre and fly
   * straight: the pod lies on the seed's back-ray). Sets that pod's fireAt (petal-open + recoil).
   */
  private matchSeeds(w: World, now: number): void {
    const ps = w.projectiles;
    let maxId = this.lastProjId;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.id <= this.lastProjId) continue;
      if (p.id > maxId) maxId = p.id;
      if (!p.alive || p.owner !== 'titan' || p.kind !== 'seed') continue;
      const sp = Math.hypot(p.vx, p.vz);
      if (sp < 1e-4) continue;
      const ux = p.vx / sp, uz = p.vz / sp;
      let best: HzRec | null = null, bestD = Infinity;
      for (const r of this.recs.values()) {
        if (r.kind !== 'bloom' || r.goneAt >= 0 || r.shots >= 0) continue;
        const dx = r.x - p.x, dz = r.z - p.z;
        const along = dx * ux + dz * uz;                 // ≤ 0: the pod is behind the seed
        const tol = Math.max(0.5, r.size);
        if (along > tol || -along > sp * 0.3 + tol) continue;
        const perp = Math.abs(dx * uz - dz * ux);
        if (perp < tol && perp < bestD) { bestD = perp; best = r; }
      }
      if (best) { best.fireAt = now; best.armed = true; }
    }
    this.lastProjId = maxId;
  }

  /** 0..1 visibility: grow-in, tail fade over the end of life, early-removal fade */
  private fadeOf(r: HzRec, now: number): number {
    let f = 1;
    const inT = r.kind === 'wire' ? 0.08 : 0.25;
    f *= clamp01(r.t / inT);
    const tail = Math.min(0.6, r.life * 0.2);
    f *= clamp01((r.life - r.t) / Math.max(1e-3, tail));
    if (r.goneAt >= 0) {
      // natural expiry already faded to ~0; an early removal fades from where it was
      f *= clamp01(1 - (now - r.goneAt) / GONE_FADE_S);
    }
    return f;
  }

  private commit(m: IM): void {
    m.mesh.count = m.n;
    m.mesh.visible = m.n > 0;
    if (m.n > 0) {
      m.mesh.instanceMatrix.clearUpdateRanges();
      m.mesh.instanceMatrix.addUpdateRange(0, m.n * 16);
      m.mesh.instanceMatrix.needsUpdate = true;
      const ic = m.mesh.instanceColor;
      if (ic) { ic.clearUpdateRanges(); ic.addUpdateRange(0, m.n * 3); ic.needsUpdate = true; }
    }
  }

  private put(m: IM, pos: THREE.Vector3, q: THREE.Quaternion, s: THREE.Vector3, tint?: THREE.Color): void {
    if (m.n >= m.cap) return;
    this.m4.compose(pos, q, s);
    this.m4.toArray(m.mesh.instanceMatrix.array as Float32Array, m.n * 16);
    if (tint && m.mesh.instanceColor) {
      const a = m.mesh.instanceColor.array as Float32Array;
      a[m.n * 3] = tint.r; a[m.n * 3 + 1] = tint.g; a[m.n * 3 + 2] = tint.b;
    }
    m.n++;
  }

  // ─────────────────────────────── decal ───────────────────────────────
  private decal(r: HzRec, fade: number, px: number): void {
    const b = this.decals.get(r.kind);
    if (!b) return;
    const o = b.slot();
    const d = b.f;
    const pad = r.size * 0.3 + px * 6;
    let umin: number, umax: number, vmin: number, vmax: number, mode: number;
    switch (r.k) {
      case 'circle': mode = SHAPE_ID.circle; umin = vmin = -(r.p0 + pad); umax = vmax = r.p0 + pad; break;
      case 'ring': mode = SHAPE_ID.ring; umin = vmin = -(r.p1 + pad); umax = vmax = r.p1 + pad; break;
      case 'cone': mode = SHAPE_ID.cone; umin = vmin = -(r.p0 + pad); umax = vmax = r.p0 + pad; break;
      case 'lane': mode = SHAPE_ID.lane; umin = -(r.p1 * 0.5 + pad); umax = r.p1 * 0.5 + pad; vmin = -pad; vmax = r.p0 + pad; break;
      case 'oval': mode = SHAPE_ID.oval; umin = -(r.p0 + pad); umax = r.p0 + pad; vmin = -(r.p1 + pad); vmax = r.p1 + pad; break;
      default: mode = SHAPE_ID.capsule; umin = -(r.p1 + pad); umax = r.p1 + pad; vmin = -(r.p1 + pad); vmax = r.p0 + r.p1 + pad; break;
    }
    d[o] = r.x; d[o + 1] = r.z; d[o + 2] = r.rot; d[o + 3] = mode;
    d[o + 4] = r.p0; d[o + 5] = r.p1; d[o + 6] = r.p2; d[o + 7] = r.p3;
    d[o + 8] = umin; d[o + 9] = umax; d[o + 10] = vmin; d[o + 11] = vmax;
    const wither = r.kind === 'bloom' ? clamp01((3 - (r.life - r.t)) / 3) : clamp01(r.t / r.life);
    d[o + 12] = fade; d[o + 13] = r.t; d[o + 14] = wither; d[o + 15] = r.owner === 'titan' ? 0 : 1;
    d[o + 16] = r.seed; d[o + 17] = Math.max(r.size, px * 3); d[o + 18] = 1; d[o + 19] = 0;
  }

  // ─────────────────────────────── wire: crackling bolts ───────────────────────────────
  private drawWire(r: HzRec, fade: number, px: number, now: number, lvl: number): void {
    const R = Math.max(r.size, px * 3);
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    const ux = len > 1e-6 ? (r.x1 - r.x0) / len : 1, uz = len > 1e-6 ? (r.z1 - r.z0) / len : 0;
    const nx = -uz, nz = ux;                                 // lateral
    const segs = Math.max(5, Math.min(18, Math.round(len / Math.max(R * 0.9, px * 10))));
    const bolts = lvl >= 2 ? 3 : 2;
    const cw = Math.max(R * 0.08, px * 1.5);                 // core half-width
    const gw = Math.max(R * 0.34, px * 5);                   // glow half-width
    const life = clamp01((r.life - r.t) / r.life);
    const dim = (0.55 + 0.45 * life) * fade;
    const P = this.pts;
    for (let b = 0; b < bolts; b++) {
      const frame = Math.floor(now * 14 + b * 0.37 + r.seed * 3);
      for (let k = 0; k <= segs; k++) {
        const a = k / segs;
        const pin = Math.sqrt(Math.sin(Math.PI * a));
        const lat = (h3(r.id + b * 7.1, k, frame) - 0.5) * 2 * R * 0.6 * pin;
        const hy = R * (0.3 + 0.55 * h3(r.id - b * 3.3, k * 1.7, frame + 0.5) * pin);
        P[k * 3] = r.x0 + ux * len * a + nx * lat;
        P[k * 3 + 1] = hy;
        P[k * 3 + 2] = r.z0 + uz * len * a + nz * lat;
      }
      const main = b === 0;
      for (let k = 0; k < segs; k++) {
        this.ribbon(P[k * 3], P[k * 3 + 1], P[k * 3 + 2], P[k * 3 + 3], P[k * 3 + 4], P[k * 3 + 5], gw * (main ? 1 : 0.7), 0.435, 0.953, 1.0, 0.3 * dim);
      }
      for (let k = 0; k < segs; k++) {
        this.ribbon(P[k * 3], P[k * 3 + 1], P[k * 3 + 2], P[k * 3 + 3], P[k * 3 + 4], P[k * 3 + 5], cw * (main ? 1 : 0.65), 0.82, 0.98, 1.0, 0.95 * dim);
      }
      // a fork off the main bolt
      if (main) {
        const frame2 = Math.floor(now * 9 + r.seed * 5);
        const at = 1 + Math.floor(h3(r.id, 91, frame2) * (segs - 1));
        let fx = P[at * 3], fy = P[at * 3 + 1], fz = P[at * 3 + 2];
        const side = h3(r.id, 17, frame2) < 0.5 ? -1 : 1;
        for (let s = 0; s < 3; s++) {
          const step = R * 0.5;
          const tx = fx + (nx * side * 0.8 + ux * (h3(r.id, s, frame2) - 0.5)) * step;
          const tz = fz + (nz * side * 0.8 + uz * (h3(r.id, s + 5, frame2) - 0.5)) * step;
          const ty = Math.max(R * 0.05, fy - R * 0.18 * (s + 1) * h3(r.id, s + 9, frame2));
          this.ribbon(fx, fy, fz, tx, ty, tz, cw * 0.55, 0.82, 0.98, 1.0, 0.8 * dim * (1 - s * 0.25));
          fx = tx; fy = ty; fz = tz;
        }
      }
    }
    // glowing end nodes
    const nr = Math.max(R * 0.55, px * 6);
    const pulse = 0.8 + 0.2 * Math.sin(now * 23 + r.seed * 9);
    this.dot(r.x0, R * 0.35, r.z0, nr * pulse, 0.435, 0.953, 1.0, 0.55 * dim);
    this.dot(r.x1, R * 0.35, r.z1, nr * pulse, 0.435, 0.953, 1.0, 0.55 * dim);
  }

  private ribbon(ax: number, ay: number, az: number, bx: number, by: number, bz: number, hw: number, cr: number, cg: number, cb: number, a: number): void {
    const o = this.ribbons.slot();
    const d = this.ribbons.f;
    d[o] = ax; d[o + 1] = ay; d[o + 2] = az; d[o + 3] = hw;
    d[o + 4] = bx; d[o + 5] = by; d[o + 6] = bz; d[o + 7] = hw;
    // colours arrive as sRGB 0..1 → linear for the shader's output conversion
    d[o + 8] = cr * cr; d[o + 9] = cg * cg; d[o + 10] = cb * cb; d[o + 11] = -a;   // negative: no fade along
  }

  private dot(x: number, y: number, z: number, rad: number, cr: number, cg: number, cb: number, a: number): void {
    const o = this.dots.slot();
    const d = this.dots.f;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = rad;
    d[o + 4] = cr * cr; d[o + 5] = cg * cg; d[o + 6] = cb * cb; d[o + 7] = a;
  }

  // ─────────────────────────────── magma: popping bubbles ───────────────────────────────
  private drawMagma(r: HzRec, fade: number, px: number, now: number, lvl: number): void {
    const R = Math.max(r.size, px * 4);
    const n = lvl === 0 ? 3 : lvl === 1 ? 5 : 7;
    for (let i = 0; i < n; i++) {
      const per = 1.1 + h3(r.id, i, 1) * 0.9;
      const ph = ((now / per) + h3(r.id, i, 2)) % 1;
      const cyc = Math.floor(now / per + h3(r.id, i, 2));
      const ang = h3(r.id, i + cyc * 3, 3) * Math.PI * 2;
      const rad = Math.sqrt(h3(r.id, i + cyc * 5, 4)) * R * 0.72;
      const size = R * (0.06 + 0.06 * h3(r.id, i, 5));
      // swell, then pop
      const s = (ph < 0.85 ? easeOutBack(ph / 0.85) * 0.9 : (1 - (ph - 0.85) / 0.15) * 1.2) * size * fade;
      if (s < px * 0.4) continue;
      this.v.set(r.x + Math.sin(ang) * rad, 0.05 + s * 0.35, r.z + Math.cos(ang) * rad);
      this.q.identity();
      this.s.set(s, s * 0.8, s);
      this.put(this.bubbles, this.v, this.q, this.s);
    }
  }

  // ─────────────────────────────── bloom turret ───────────────────────────────
  private drawBloom(r: HzRec, fade: number, px: number, now: number): void {
    const S = Math.max(0.34 * r.h, 12 * px);               // plant scale (stem ≈ S tall, pod at ≈ 1.05 S)
    const remaining = r.life - r.t;
    const wither = clamp01((3 - remaining) / 3);
    const sink = clamp01((0.45 - remaining) / 0.45);
    const grow = clamp01(r.t / 0.6);
    const g = (grow < 1 ? easeOutBack(grow) : 1) * (1 - sink) * (r.goneAt >= 0 ? fade : this.endK);
    if (g <= 0.001) return;
    const sc = S * g;
    const phase = r.seed * 6.2832;
    // petal state
    const sinceFire = now - r.fireAt;
    let open = sinceFire >= 0 && sinceFire < 0.55 ? (sinceFire < 0.07 ? sinceFire / 0.07 : 1 - (sinceFire - 0.07) / 0.48) : 0;
    // anticipation only for a pod that is actually shooting (a no-target retry cycles cd every 0.25 s)
    if (r.armed && r.cd >= 0 && r.cd < 0.3) open = Math.max(open, ((0.3 - r.cd) / 0.3) * 0.3);
    open = Math.max(open, 0.08 + 0.05 * Math.sin(now * 1.3 + phase));
    open *= 1 - wither * 0.7;
    const sinceSpore = now - r.sporeAt;
    const swell = sinceSpore >= 0 && sinceSpore < 0.6 ? Math.sin((sinceSpore / 0.6) * Math.PI) * 0.18 : 0;
    const recoil = sinceFire >= 0 && sinceFire < 0.35 ? Math.sin((sinceFire / 0.35) * Math.PI) * 0.22 : 0;

    const tint = this.col;
    // mound
    this.v.set(r.x, 0, r.z);
    this.q.setFromAxisAngle(HazardView.Y, phase);
    this.s.set(sc * 0.46, sc * 0.46, sc * 0.46);
    this.put(this.mound, this.v, this.q, this.s);

    // stem (3 segments, forward kinematics)
    const yaw = phase;
    const sway = Math.sin(now * 1.7 + phase) * 0.1 + Math.sin(now * 2.9 + phase * 2) * 0.04;
    const droop = wither * 0.55;
    this.q.setFromAxisAngle(HazardView.Y, yaw);
    this.v.set(r.x, sc * 0.1, r.z);
    const segLen = sc * 0.34;
    tint.setRGB(1, 1, 1).lerp(this.col2(0.62, 0.5, 0.33), wither);
    for (let i = 0; i < 3; i++) {
      const bend = sway * (0.6 + i * 0.3) + droop * (0.3 + i * 0.35) - recoil * (i === 2 ? 1 : 0.4);
      this.q1.setFromAxisAngle(HazardView.X, bend);
      this.q.multiply(this.q1);
      const rad = sc * (0.075 - i * 0.012);
      this.s.set(rad, segLen, rad);
      this.put(this.stem, this.v, this.q, this.s, tint);
      this.v2.set(0, segLen * 0.96, 0).applyQuaternion(this.q);
      this.v.add(this.v2);
    }
    // pod on top
    const podS = sc * 0.2 * (1 + swell) * (1 - wither * 0.25);
    tint.setRGB(1, 1, 1).lerp(this.col2(0.7, 0.55, 0.4), wither);
    this.put(this.pod, this.v, this.q, this.s.set(podS, podS, podS), tint);
    // five petals hinged round the pod base, opening outward
    const baseY = podS * 0.1;
    const closedA = 0.16, openA = 1.9;
    const petalA = closedA + (openA - closedA) * open + wither * 0.9;
    tint.setRGB(1, 1, 1).lerp(this.col2(0.62, 0.42, 0.3), wither);
    const petalS = sc * 0.3 * (1 - wither * 0.2);
    for (let k = 0; k < 5; k++) {
      this.q1.setFromAxisAngle(HazardView.Y, (k / 5) * Math.PI * 2 + phase * 0.5);
      this.q2.setFromAxisAngle(HazardView.X, petalA);
      this.q1.multiply(this.q2);
      const qq = this.q2.copy(this.q).multiply(this.q1);
      // hinge on the pod's flank so a closed bud wraps the pod instead of hiding inside it
      const ha = (k / 5) * Math.PI * 2 + phase * 0.5;
      this.v2.set(Math.sin(ha) * podS * 0.62, baseY, Math.cos(ha) * podS * 0.62).applyQuaternion(this.q).add(this.v);
      this.put(this.petals, this.v2, qq, this.s.set(petalS, petalS, petalS), tint);
    }
    // leaves at the stem base
    tint.setRGB(1, 1, 1).lerp(this.col2(0.6, 0.48, 0.3), wither);
    for (let k = 0; k < 3; k++) {
      this.q.setFromAxisAngle(HazardView.Y, yaw + k * 2.1 + 0.4);
      this.q1.setFromAxisAngle(HazardView.X, 1.05 + droop * 0.6 + Math.sin(now * 1.4 + k + phase) * 0.06);
      this.q.multiply(this.q1);
      this.v.set(r.x, sc * 0.14, r.z);
      const ls = sc * (0.36 + 0.06 * k);
      this.put(this.leaves, this.v, this.q, this.s.set(ls, ls, ls), tint);
    }
  }

  private readonly c2 = new THREE.Color();
  private col2(r: number, g: number, b: number): THREE.Color { return this.c2.setRGB(r, g, b); }

  // ─────────────────────────────── spore cloud ───────────────────────────────
  private drawSpore(r: HzRec, fade: number, px: number, now: number, lvl: number): void {
    const R = Math.max(r.size, px * 6);
    const n = lvl === 0 ? 8 : lvl === 1 ? 14 : 20;
    const lifeK = clamp01(r.t / r.life);
    for (let i = 0; i < n; i++) {
      const a0 = h3(r.id, i, 11) * Math.PI * 2;
      const ang = a0 + now * (0.18 + 0.12 * h3(r.id, i, 12)) * (i % 2 ? 1 : -1);
      const rad = R * (0.45 + 0.5 * h3(r.id, i, 13)) * (0.9 + 0.1 * lifeK);
      const size = R * (0.08 + 0.06 * h3(r.id, i, 14)) * (0.6 + 0.4 * Math.min(1, r.t / 0.5)) * fade;
      if (size < px * 0.8) continue;
      const bob = Math.sin(now * 1.3 + i * 1.7 + r.seed * 6) * 0.25;
      this.v.set(r.x + Math.sin(ang) * rad, R * (0.05 + 0.06 * h3(r.id, i, 15) + 0.02 * bob) + size * 0.5, r.z + Math.cos(ang) * rad);
      this.e.set(i * 0.7, now * 0.3 + i, 0);
      this.q.setFromEuler(this.e);
      this.s.set(size, size * 0.8, size);
      this.put(this.puffs, this.v, this.q, this.s);
    }
    // motes rising
    const motes = lvl === 0 ? 8 : 16;
    for (let i = 0; i < motes; i++) {
      const per = 1.6 + h3(r.id, i, 21);
      const ph = ((now / per) + h3(r.id, i, 22)) % 1;
      const cyc = Math.floor(now / per + h3(r.id, i, 22));
      const ang = h3(r.id, i + cyc, 23) * Math.PI * 2;
      const rad = Math.sqrt(h3(r.id, i + cyc, 24)) * R * 0.95;
      const yy = R * 0.03 + ph * R * 0.35;
      const a = Math.sin(ph * Math.PI) * 0.6 * fade;
      this.dot(r.x + Math.sin(ang) * rad, yy, r.z + Math.cos(ang) * rad, Math.max(R * 0.025, px * 2.5), 0.85, 1.0, 0.48, a);
    }
  }

  // ─────────────────────────────── frost crystals ───────────────────────────────
  private drawFrost(r: HzRec, fade: number, px: number, now: number, lvl: number): void {
    const R = Math.max(r.size, px * 4);
    const n = lvl === 0 ? 5 : lvl === 1 ? 7 : 10;
    const grow = clamp01(r.t / 0.4);
    const melt = clamp01((1.0 - (r.life - r.t)) / 1.0);
    const g = easeOutBack(grow) * (1 - melt) * (r.goneAt >= 0 ? fade : this.endK);
    if (g <= 0.001) return;
    for (let i = 0; i < n; i++) {
      const ang = h3(r.id, i, 31) * Math.PI * 2;
      const rad = Math.sqrt(h3(r.id, i, 32)) * R * 0.8;
      const hgt = R * (0.14 + 0.2 * h3(r.id, i, 33)) * g;
      if (hgt < px * 0.8) continue;
      const wdt = hgt * (0.45 + 0.2 * h3(r.id, i, 34));
      this.e.set((h3(r.id, i, 35) - 0.5) * 0.7, h3(r.id, i, 36) * 6.28, (h3(r.id, i, 37) - 0.5) * 0.7);
      this.q.setFromEuler(this.e);
      this.v.set(r.x + Math.sin(ang) * rad, -hgt * 0.08, r.z + Math.cos(ang) * rad);
      this.s.set(wdt, hgt, wdt);
      this.put(this.crystals, this.v, this.q, this.s);
      // a smaller buddy shard
      if (i % 2 === 0) {
        this.e.set((h3(r.id, i, 38) - 0.5) * 1.1, h3(r.id, i, 39) * 6.28, (h3(r.id, i, 40) - 0.5) * 1.1);
        this.q.setFromEuler(this.e);
        this.v.x += wdt * 0.8; this.v.z -= wdt * 0.5;
        this.s.set(wdt * 0.6, hgt * 0.55, wdt * 0.6);
        this.put(this.crystals, this.v, this.q, this.s);
      }
    }
    void now;
  }

  // ─────────────────────────────── fire tongues ───────────────────────────────
  private drawFire(r: HzRec, fade: number, px: number, now: number, lvl: number): void {
    const R = Math.max(r.size, px * 4);
    const n = lvl === 0 ? 4 : lvl === 1 ? 6 : 8;
    for (let i = 0; i < n; i++) {
      const ang = h3(r.id, i, 41) * Math.PI * 2;
      const rad = Math.sqrt(h3(r.id, i, 42)) * R * 0.7;
      const fl = 0.75 + 0.25 * Math.sin(now * (9 + 4 * h3(r.id, i, 43)) + i * 2.3) + 0.1 * Math.sin(now * 23 + i);
      const hgt = R * (0.35 + 0.35 * h3(r.id, i, 44)) * fl * fade;
      if (hgt < px) continue;
      const wdt = hgt * 0.45;
      this.e.set(Math.sin(now * 3 + i) * 0.12, h3(r.id, i, 45) * 6.28, Math.cos(now * 2.6 + i) * 0.12);
      this.q.setFromEuler(this.e);
      this.v.set(r.x + Math.sin(ang) * rad, 0.02, r.z + Math.cos(ang) * rad);
      this.s.set(wdt, hgt, wdt);
      this.put(this.flames, this.v, this.q, this.s);
    }
  }

  /** decals drawn last frame per kind (debug / tests) */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const k of HKINDS) out[k] = this.decals.get(k)?.n ?? 0;
    out.bolts = this.ribbons.n; out.crystals = this.crystals.n; out.petals = this.petals.n;
    return out;
  }
}
