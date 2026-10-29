// GENESIS — deferred ground decals and FX lights (CONTRACT.md §15.7, §15.8 "brush preview decal on the terrain").
//
// Everything that is painted ONTO the world rather than standing in it: the tool brush (radius, falloff, strength, the
// power's colour), target reticles (a meteor's impact point, an armed disaster), the hand's contact shadow, the region a
// weather front will be painted over, crater glow, glowing rift cracks, scorch, frost, blight / plague / drought tints,
// expanding rings (a shockwave's dust ring, a heal's golden ring, a forest's sprouting wave), a sinkhole's pit, the
// line where a shield dome meets the ground — and FX LIGHTS (impact flashes, lava, lightning, fireballs, miracles)
// shading the ground and everything standing on it with a Lambert term from the depth buffer's own normals.
//
// Each decal is an instanced screen quad over its bounding sphere; the fragment rebuilds the body-frame position of the
// opaque surface under the pixel from the linear depth copy, projects it into the decal's tangent frame and evaluates
// the decal there. Three blend groups: OVER (premultiplied over), ADD (emission and light), MUL (tints). Drawn into the
// HDR scene target after the opaque pass and before the water and the atmosphere (renderer.ts), so the haze and the
// water lie over them as they should.

import {
  CustomBlending, DstColorFactor, Group, InstancedBufferAttribute, InstancedBufferGeometry, Float32BufferAttribute, Matrix3,
  Matrix4, Mesh, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Vector2, Vector3, ZeroFactor, type Camera, type IUniform, type Texture,
  type WebGLRenderer, type WebGLRenderTarget, type Scene,
} from 'three';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { FX_EXPOSURE } from './particles.ts';

export const DECAL = {
  shadow: 0, brush: 1, reticle: 2, glow: 3, cracks: 4, scorch: 5, frost: 6, tint: 7, ring: 8, paint: 9, light: 10,
  path: 11, pit: 12, domeRing: 13, crackGlow: 14, ripple: 15,
} as const;

/** which blend group a decal type draws in */
const GROUP_OF: Record<number, 0 | 1 | 2> = {
  [DECAL.shadow]: 0, [DECAL.brush]: 0, [DECAL.reticle]: 0, [DECAL.cracks]: 0, [DECAL.scorch]: 0, [DECAL.frost]: 0,
  [DECAL.paint]: 0, [DECAL.path]: 0, [DECAL.pit]: 0, [DECAL.ring]: 0,
  [DECAL.glow]: 1, [DECAL.light]: 1, [DECAL.domeRing]: 1, [DECAL.crackGlow]: 1, [DECAL.ripple]: 1,
  [DECAL.tint]: 2,
};

export interface Decal {
  type: number;
  /** centre (body frame, m) and bounding radius (m) */
  x: number; y: number; z: number; r: number;
  /** a tangent direction for oriented decals (body frame); any vector works for round ones */
  ax: number; ay: number; az: number;
  /** colour + alpha / intensity */
  cr: number; cg: number; cb: number; ca: number;
  p0: number; p1: number; p2: number; p3: number;
  /** q0: slab half-height (m) the decal projects through (0 = from the radius); q1..q3 type-specific */
  q0: number; q1: number; q2: number; q3: number;
}

export function decal(type: number, c: ArrayLike<number>, r: number): Decal {
  return { type, x: c[0], y: c[1], z: c[2], r, ax: 0, ay: 0, az: 0, cr: 1, cg: 1, cb: 1, ca: 1, p0: r, p1: 0, p2: 0, p3: 0, q0: 0, q1: 0, q2: 0, q3: 0 };
}

const VERT = /* glsl */ `
#include <common>
attribute vec2 corner;
attribute vec4 iC;
attribute vec4 iA;
attribute vec4 iCol;
attribute vec4 iP;
attribute vec4 iQ;
varying vec3 vC;
varying vec3 vAxis;
varying float vType;
varying float vR;
varying vec4 vCol;
varying vec4 vP;
varying vec4 vQ;
void main() {
  vC = iC.xyz; vR = iC.w; vAxis = iA.xyz; vType = iA.w; vCol = iCol; vP = iP; vQ = iQ;
  vec4 mv = modelViewMatrix * vec4(iC.xyz, 1.0);
  float z = -mv.z;
  float R = iC.w;
  if (z - R < 0.5) {
    // the camera is inside (or nearly inside) the decal's sphere: cover the screen
    gl_Position = vec4(corner, 0.0, 1.0);
    return;
  }
  // a quad facing the camera in front of the sphere, large enough to cover its silhouette
  float zq = z - R;
  vec4 q = vec4(mv.xyz * (zq / z), 1.0);
  float half_ = R * zq / sqrt(max(z * z - R * R, 1e-4)) * 1.08;
  q.xy += corner * half_;
  gl_Position = projectionMatrix * q;
  // (no depth test: the fragment tests against the scene itself)
  gl_Position.z = 0.0;
}
`;

const FRAG = /* glsl */ `
${NOISE_GLSL}
uniform sampler2D tSceneDepth;
uniform vec2 uResolution;
uniform mat4 uInvProj;
uniform mat3 uViewToBody;
uniform vec3 uCamBody;
uniform float uTime;
uniform sampler2D tExposure;
uniform float uHasExposure;
uniform float uGroup;
varying vec3 vC;
varying vec3 vAxis;
varying float vType;
varying float vR;
varying vec4 vCol;
varying vec4 vP;
varying vec4 vQ;

float expo() { return uHasExposure > 0.5 ? max(texture(tExposure, vec2(0.5)).r, 1e-4) : 1.0; }
float sat(float x) { return clamp(x, 0.0, 1.0); }
// a 2D cell pattern: distance to the nearest cell edge (cracks)
float crackField(vec2 p, float seed) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(gn_hash12(i + g + seed * 17.0), gn_hash12(i + g + seed * 31.0 + 5.3));
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(d2) - sqrt(d1);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float sz = texture(tSceneDepth, uv).r;
  bool skyPx = sz > 1e6;
  vec4 rd4 = uInvProj * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
  vec3 rd = rd4.xyz / rd4.w;
  vec3 S = rd * (min(sz, 1e6) / max(-rd.z, 1e-6));
  // screen derivatives before any discard (they are undefined once neighbours have left the quad)
  vec3 dSx = dFdx(S), dSy = dFdy(S);
  // the pixel's own footprint (m): its depth × the angle a pixel subtends. Derivatives across a silhouette (a leaf
  // against ground or sky far behind it) are not a footprint: a 2×2 quad straddling the edge saw a "pixel" hundreds of
  // metres wide, so every ring widened to cover it and every light took a garbage normal there — blocky fringes round
  // each tree under a ward's ring, a reticle or a light. A silhouette is where the depth's one-sided differences
  // disagree (a plane, even one seen grazing, changes evenly from pixel to pixel): there the footprint caps them.
  vec3 rdn = rd / max(length(rd), 1e-6);
  float foot = length(S) * max(length(dFdx(rdn)), length(dFdy(rdn)));
  vec2 px1 = 1.0 / uResolution;
  float zl = texture(tSceneDepth, uv - vec2(px1.x, 0.0)).r, zr = texture(tSceneDepth, uv + vec2(px1.x, 0.0)).r;
  float zd = texture(tSceneDepth, uv - vec2(0.0, px1.y)).r, zu = texture(tSceneDepth, uv + vec2(0.0, px1.y)).r;
  float zc = min(sz, 1e6);
  float bend = max(abs((min(zr, 1e6) - zc) - (zc - min(zl, 1e6))), abs((min(zu, 1e6) - zc) - (zc - min(zd, 1e6))));
  bool edgeQuad = bend > 0.2 * zc + 0.5;
  vec3 P = uViewToBody * S + uCamBody;
  vec3 up = normalize(vC);
  vec3 d = P - vC;
  float hgt = dot(d, up);
  vec3 lat = d - up * hgt;
  vec3 ax = vAxis - up * dot(vAxis, up);
  ax = dot(ax, ax) > 1e-8 ? normalize(ax) : normalize(cross(up, abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 bx = cross(ax, up);
  vec2 q = vec2(dot(lat, bx), dot(lat, ax));
  float r = length(q);
  float fwR = edgeQuad ? min(fwidth(r), foot * 8.0 + 1e-4) : fwidth(r);
  if (skyPx) discard;
  int t = int(vType + 0.5);
  float slab = vQ.x > 0.0 ? vQ.x : vR * 0.35;
  float hf = 1.0 - smoothstep(slab * 0.6, slab, abs(hgt));
  if (t != 10 && hf <= 0.0) discard;
  float ex = expo();
  // display-referred overlays (brush, reticle, paint, path): the same brightness on screen by day and by night
  float disp = 1.0 / ex;
  vec4 o = vec4(0.0);
  if (t == 0) {
    // the hand's contact shadow: a soft ellipse along the hand
    vec2 e = q / vec2(max(vP.y, 1e-3), max(vP.x, 1e-3));
    float k = 1.0 - smoothstep(1.0 - vP.z, 1.0, length(e));
    float a = vCol.a * k * hf;
    o = vec4(0.0, 0.0, 0.0, a);
  } else if (t == 1) {
    // brush: a crisp ring at the radius with tick marks, the falloff as a soft fill, the strength as its density,
    // a slow sweep so it reads as live
    float R = vP.x;
    float px = max(fwR, R * 0.004);
    float ring = 1.0 - smoothstep(px * 0.8, px * 2.2, abs(r - R));
    float inner = 1.0 - smoothstep(px * 0.5, px * 1.6, abs(r - R * mix(0.98, 0.5, vP.y)));
    float ang = atan(q.x, q.y);
    float ticks = step(0.92, fract(ang * 24.0 / 6.2831853 + uTime * 0.05)) * (1.0 - smoothstep(px, px * 6.0, abs(r - R * 0.94)));
    float fall = r < R ? pow(1.0 - smoothstep(R * (1.0 - vP.y) * 0.98, R, r), 1.0) : 0.0;
    float sweep = 0.5 + 0.5 * sin(ang - uTime * 1.6);
    float fill = fall * (0.07 + 0.12 * vP.z) * (0.75 + 0.25 * sweep);
    float a = sat(ring * 0.95 + inner * 0.35 * vP.y + ticks * 0.6 + fill) * hf * vCol.a;
    o = vec4(vCol.rgb * disp * 0.9 * a, a * 0.55);
  } else if (t == 2) {
    // target reticle: converging rings (p1 = time to impact 1 → 0), a rotating segmented outer ring, crosshair gaps
    float R = vP.x;
    float px = max(fwR, R * 0.003);
    float ang = atan(q.x, q.y);
    float spin = uTime * vP.z;
    float outer = (1.0 - smoothstep(px, px * 2.5, abs(r - R))) * step(0.35, fract((ang + spin) * 6.0 / 6.2831853));
    float conv = mix(0.25, 0.95, vP.y);
    float inner = 1.0 - smoothstep(px, px * 2.5, abs(r - R * conv));
    float core = 1.0 - smoothstep(px, px * 2.0, abs(r - R * 0.12));
    float cross_ = (1.0 - smoothstep(px * 0.8, px * 2.0, min(abs(q.x), abs(q.y)))) * step(R * 0.2, r) * step(r, R * 0.55);
    float pulse = 0.65 + 0.35 * sin(uTime * mix(3.0, 12.0, vP.w));
    float a = sat(outer + inner * 0.8 + core + cross_ * 0.7) * hf * vCol.a * pulse;
    // a faint danger fill
    a = max(a, (1.0 - smoothstep(R * 0.2, R, r)) * 0.08 * vP.w * hf * vCol.a);
    o = vec4(vCol.rgb * disp * a, a * 0.5);
  } else if (t == 3) {
    // a glow pool (crater, vent, lava): irregular, hottest at the centre, flickering
    float R = vP.x;
    float n = fbm3(vec3(q / max(R * vP.y, 1e-3), vP.w + uTime * 0.15));
    float k = pow(sat(1.0 - r / R + 0.35 * n), 2.0);
    float fl = 0.85 + 0.15 * sin(uTime * 7.0 + vP.w * 30.0) * sin(uTime * 2.3);
    vec3 e = vCol.rgb * vP.z * k * fl * hf;
    // (a glow is hot rock, not a lamp: on screen it reads at most a bright orange, whatever the eye's adaptation — at
    // night the exposure meters moonlit ground (~100x the day's) and a vent's absolute glow blew a white disc over the
    // whole mountain at 1.3 km)
    float eL = dot(e, vec3(0.2126, 0.7152, 0.0722)) * expo();
    o = vec4(e * min(1.0, 1.0 / max(eL, 1e-6)), 0.0);
  } else if (t == 4 || t == 14) {
    // cracks along the axis (a rift, a quake's fissures, drought): dark seams; their glowing twin draws in the add group
    float L = vP.x, W = vP.y;
    float along = q.y / max(L, 1e-3);
    float band = (1.0 - smoothstep(0.8, 1.0, abs(along))) * (1.0 - smoothstep(W * 0.4, W, abs(q.x + W * 0.25 * snoise(vec3(q.y * 0.02, vP.w, 0.0)))));
    float cells = crackField(q / max(W * 0.35, 1e-3), vP.w);
    float main_ = 1.0 - smoothstep(0.0, W * 0.06, abs(q.x + W * 0.35 * snoise(vec3(q.y / max(W, 1e-3) * 0.6, vP.w + 3.0, 0.0))));
    float seam = max((1.0 - smoothstep(0.0, 0.06, cells)) * band, main_ * (1.0 - smoothstep(0.85, 1.0, abs(along))));
    if (t == 4) {
      float a = seam * vCol.a * hf;
      o = vec4(vec3(0.02, 0.015, 0.012) * a, a);
    } else {
      float fl = 0.8 + 0.2 * sin(uTime * 3.0 + q.y * 0.1);
      o = vec4(vCol.rgb * vP.z * seam * fl * hf, 0.0);
    }
  } else if (t == 5) {
    // scorch: blackened ground with a ragged edge
    float R = vP.x;
    float n = fbm3(vec3(q / (R * 0.4), vP.z));
    float k = sat((1.0 - r / R) * 2.0 + n * 0.8);
    float a = k * vP.y * hf * vCol.a;
    o = vec4(vec3(0.015, 0.012, 0.01) * a, a);
  } else if (t == 6) {
    // frost: crystalline white-blue over everything, sparkling where the sun catches it
    float R = vP.x;
    float n = fbm3(vec3(q / (R * 0.12), vP.z));
    float k = sat((1.0 - r / R) * 3.0) * sat(0.55 + n);
    float sp = pow(sat(gn_hash12(floor(q * 6.0) + floor(uTime * 2.0))), 40.0) * 3.0;
    float a = k * vP.y * hf * vCol.a;
    o = vec4((vec3(0.78, 0.86, 0.95) * 0.6 + sp) * a, a * 0.85);
  } else if (t == 7) {
    // tint (multiply): blight, plague, drought, a cold age — mottled
    float R = vP.x;
    float n = fbm3(vec3(q / max(R * vP.z, 1e-3), vP.w));
    float k = sat((1.0 - r / R) * 2.5) * sat(0.6 + n) * vP.y * hf * vCol.a;
    o = vec4(mix(vec3(1.0), vCol.rgb, k), 1.0);
  } else if (t == 8) {
    // an expanding ring of dust / light (p0 radius now, p1 width, p2 intensity)
    float w = max(vP.y, 0.5);
    float k = exp(-pow((r - vP.x) / w, 2.0)) * (1.0 - smoothstep(vP.x, vP.x + w * 0.5, r) * 0.6);
    float n = 0.7 + 0.3 * snoise(vec3(q * 0.05, uTime * 0.5));
    float a = k * n * vCol.a * hf;
    o = vec4(vCol.rgb * a, a);
  } else if (t == 15) {
    // an expanding ring of light (additive; display-referred mix)
    float w = max(vP.y, 0.5);
    float k = exp(-pow((r - vP.x) / w, 2.0));
    float n = 0.8 + 0.2 * snoise(vec3(q * 0.08, uTime));
    o = vec4(vCol.rgb * vP.z * k * n * hf * mix(1.0, disp, 0.7), 0.0);
  } else if (t == 9) {
    // region paint preview: a soft fill with drifting hatching and a bright rim
    float R = vP.x;
    float px = max(fwR, R * 0.004);
    float rim = 1.0 - smoothstep(px, px * 3.0, abs(r - R));
    float hatch = step(0.7, fract((q.x + q.y) / (R * 0.06) - uTime * 0.6));
    float fill = (1.0 - smoothstep(R * 0.9, R, r)) * (0.1 + 0.15 * hatch) * vP.y;
    float a = sat(rim + fill) * hf * vCol.a;
    o = vec4(vCol.rgb * disp * a, a * 0.5);
  } else if (t == 10) {
    // an FX light: the source at the centre, lifted p2 m; Lambert on the depth buffer's normal; a smooth window to
    // zero at the reach; intensity p1 (the inverse square has a core of p3 m: a volume of light, not a point)
    vec3 L = up * vP.z + vC - P;
    float dl = length(L);
    float reach = vP.x;
    if (dl > reach) discard;
    // the normal from THIS pixel's own neighbours in the depth buffer (the smaller one-sided difference on each axis,
    // so a silhouette is not bridged), not dFdx/dFdy of S: those are one value per 2×2 quad, and over foliage (depth
    // breaking every few pixels) each quad took its own random normal — a flash lit the canopy as a coarse 2×2
    // screen-door stipple. rd is linear in the pixel, so dFdx(rd) is exact everywhere
    vec3 rdx = dFdx(rd), rdy = dFdy(rd);
    vec3 rR = rd + rdx, rL = rd - rdx, rU = rd + rdy, rD = rd - rdy;
    vec3 SR = rR * (min(zr, 1e6) / max(-rR.z, 1e-6)), SL = rL * (min(zl, 1e6) / max(-rL.z, 1e-6));
    vec3 SU = rU * (min(zu, 1e6) / max(-rU.z, 1e-6)), SD = rD * (min(zd, 1e6) / max(-rD.z, 1e-6));
    vec3 ex = abs(zr - zc) < abs(zc - zl) ? SR - S : S - SL;
    vec3 ey = abs(zu - zc) < abs(zc - zd) ? SU - S : S - SD;
    vec3 N = cross(ex, ey);
    float nl = length(N);
    N = nl > 1e-12 ? N / nl : -normalize(S);
    if (dot(N, S) > 0.0) N = -N;
    vec3 Lv = mat3(transpose(uViewToBody)) * (L / max(dl, 1e-3));
    // where the depth is rough at the pixel scale (leaves, needles, grass blades) no single normal is the surface's:
    // there the light wraps (an even ~0.6) instead of picking lit and dark pixels
    float rough = smoothstep(0.004, 0.04, bend / max(zc, 1e-3)) * (edgeQuad ? 1.0 : 0.8);
    float lam = mix(0.15 + 0.85 * sat(dot(N, Lv)), 0.3 + 0.5 * sat(dot(N, Lv) * 0.5 + 0.5), rough);
    float win = 1.0 - (dl * dl) / (reach * reach);
    float E = vP.y / (dl * dl + vP.w * vP.w) * win * win;
    // the light lands on the surface's OWN colour: most of it multiplies the scene (drawn in the tint group too,
    // out = dst · (1 + ΔE / E_scene), E_scene from the adapted exposure — a typical surface sits near mid grey on
    // screen), so a flash brightens a palm canopy in its green; a third stays additive, so ground the scene leaves
    // black (a night strike) is still lit. (Added alone, as a white light × a typical albedo, it bleached the whole
    // canopy under a strike to frost-white.)
    vec3 A = vCol.rgb * E * lam * 0.064;
    // (expo(), not ex: this branch's own ex is the depth tangent above)
    // Both are capped: the scene at most ~4.5x (a palm canopy multiplied 13x went past the tone curve's shoulder,
    // where AgX takes every hue to white: the strike frame read as frost), and the additive part only lifts black
    // ground to a dim lit floor (added uncapped, a white light with no albedo in it, it laid a milky veil over the
    // whole hillside by day).
    // (each cap scales the light as a whole, keeping its hue: capped per channel, a strong orange light hit the cap in
    // all three and turned white — a volcano's glow at night lit its mountain as a white glare disc)
    vec3 Am = A * (expo() / 0.18);
    float mx = max(Am.r, max(Am.g, Am.b));
    float mx2 = max(A.r, max(A.g, A.b)) * 0.35;
    if (uGroup > 1.5) o = vec4(vec3(1.0) + Am * min(1.0, 3.5 / max(mx, 1e-6)), 1.0);
    else o = vec4(A * 0.35 * min(1.0, (0.05 / max(expo(), 1e-4)) / max(mx2, 1e-12)), 0.0);
  } else if (t == 11) {
    // a path ahead (a front's heading): chevrons marching along the axis
    float L = vP.x, W = vP.y;
    float along = q.y / max(L, 1e-3);
    if (along < 0.0 || along > 1.0) discard;
    float ch = fract(q.y / (W * 1.2) - abs(q.x) / (W * 1.2) - uTime * 0.8);
    float k = step(0.75, ch) * (1.0 - smoothstep(W * 0.5, W, abs(q.x))) * (1.0 - smoothstep(0.7, 1.0, along));
    float a = k * hf * vCol.a;
    o = vec4(vCol.rgb * disp * a, a * 0.5);
  } else if (t == 12) {
    // a pit: dark toward the middle, a broken rim
    float R = vP.x;
    float n = snoise(vec3(q / (R * 0.3), vP.z));
    float rr = r / R + n * 0.08;
    float pit = 1.0 - smoothstep(0.75, 1.0, rr);
    float rim = (1.0 - smoothstep(0.0, 0.12, abs(rr - 1.0))) * sat(crackField(q / (R * 0.15), vP.z) < 0.05 ? 1.0 : 0.0);
    float a = sat(pit * vP.y + rim * 0.6) * hf * vCol.a;
    o = vec4(vec3(0.01, 0.008, 0.006) * a, a);
  } else if (t == 13) {
    // the line where a shield dome meets the ground
    float R = vP.x;
    float px = max(fwR, R * 0.003);
    float k = (1.0 - smoothstep(px, px * 4.0, abs(r - R))) + 0.25 * exp(-abs(r - R) / (R * 0.05));
    // (p2 > 0: the ward at rest — a dim seam with a slow pulse of light running round it; else the old shimmer)
    float ang = atan(q.x, q.y);
    float run = pow(0.5 + 0.5 * cos(ang - uTime * 0.55), 28.0) + 0.6 * pow(0.5 + 0.5 * cos(ang + 3.14159 - uTime * 0.55), 40.0);
    float sh = vP.z > 0.5 ? 0.22 + 1.6 * run : 0.75 + 0.25 * sin(ang * 12.0 - uTime * 2.0);
    o = vec4(vCol.rgb * vP.y * k * sh * hf * mix(1.0, disp, 0.6), 0.0);
  } else {
    discard;
  }
  gl_FragColor = o;
}
`;

const MAX = 192;

class DecalGroup {
  readonly geo = new InstancedBufferGeometry();
  readonly mesh: Mesh;
  private c = new Float32Array(MAX * 4);
  private a = new Float32Array(MAX * 4);
  private col = new Float32Array(MAX * 4);
  private p = new Float32Array(MAX * 4);
  private qq = new Float32Array(MAX * 4);
  private attrs: InstancedBufferAttribute[];
  n = 0;

  constructor(mat: ShaderMaterial) {
    this.geo.setAttribute('corner', new Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.attrs = [
      new InstancedBufferAttribute(this.c, 4), new InstancedBufferAttribute(this.a, 4), new InstancedBufferAttribute(this.col, 4),
      new InstancedBufferAttribute(this.p, 4), new InstancedBufferAttribute(this.qq, 4),
    ];
    ['iC', 'iA', 'iCol', 'iP', 'iQ'].forEach((k, i) => { this.attrs[i].setUsage(35048 /* DynamicDrawUsage */); this.geo.setAttribute(k, this.attrs[i]); });
    this.geo.instanceCount = 0;
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.layers.set(5);
  }

  begin(): void { this.n = 0; }

  push(d: Decal): void {
    if (this.n >= MAX) return;
    const k = this.n++ * 4;
    this.c[k] = d.x; this.c[k + 1] = d.y; this.c[k + 2] = d.z; this.c[k + 3] = d.r;
    this.a[k] = d.ax; this.a[k + 1] = d.ay; this.a[k + 2] = d.az; this.a[k + 3] = d.type;
    this.col[k] = d.cr; this.col[k + 1] = d.cg; this.col[k + 2] = d.cb; this.col[k + 3] = d.ca;
    this.p[k] = d.p0; this.p[k + 1] = d.p1; this.p[k + 2] = d.p2; this.p[k + 3] = d.p3;
    this.qq[k] = d.q0; this.qq[k + 1] = d.q1; this.qq[k + 2] = d.q2; this.qq[k + 3] = d.q3;
  }

  end(): void {
    this.geo.instanceCount = this.n;
    for (const a of this.attrs) { a.clearUpdateRanges(); a.addUpdateRange(0, this.n * 4); a.needsUpdate = true; }
    this.mesh.visible = this.n > 0;
  }
}

/** the decal pass: collects decals each frame and draws them over the opaque scene */
export class DecalPass {
  readonly group = new Group();
  private uniforms: Record<string, IUniform>;
  private groups: DecalGroup[];
  private list: Decal[] = [];
  private readonly viewToBody = new Matrix3();
  /** debugging: decal types to skip; `capture` keeps a copy of the last frame's list in `captured` */
  skip = new Set<number>();
  capture = false;
  captured: Decal[] = [];

  constructor() {
    this.group.name = 'decals';
    this.group.matrixAutoUpdate = false;
    this.uniforms = {
      tSceneDepth: { value: null }, uResolution: { value: new Vector2(1, 1) }, uInvProj: { value: new Matrix4() },
      uViewToBody: { value: this.viewToBody }, uCamBody: { value: new Vector3() }, uTime: { value: 0 },
      tExposure: FX_EXPOSURE, uHasExposure: { value: 0 },
    };
    const mk = (group: number) => new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...this.uniforms, uGroup: { value: group } },
      transparent: true, depthTest: false, depthWrite: false, blending: CustomBlending,
      blendSrc: group === 2 ? DstColorFactor : OneFactor, blendDst: group === 2 ? ZeroFactor : group === 1 ? OneFactor : OneMinusSrcAlphaFactor,
      blendSrcAlpha: group === 2 ? ZeroFactor : OneFactor, blendDstAlpha: OneFactor,
    });
    this.groups = [new DecalGroup(mk(0)), new DecalGroup(mk(2)), new DecalGroup(mk(1))];
    // draw order: tints, then over, then light on top
    this.groups[1].mesh.renderOrder = 0;
    this.groups[0].mesh.renderOrder = 1;
    this.groups[2].mesh.renderOrder = 2;
    for (const g of this.groups) this.group.add(g.mesh);
  }

  /** this frame's decals (cleared by draw) */
  add(d: Decal): void { this.list.push(d); }
  get count(): number { return this.list.length; }

  /**
   * Draw into `target` (the HDR scene) — `depth` is the linear view-depth copy. `bodyToView` is the primary planet's
   * body → view rotation and `camBody` the camera in its body frame; the group must be a child of that planet.
   */
  draw(r: WebGLRenderer, scene: Scene, camera: Camera & { projectionMatrixInverse: Matrix4 }, target: WebGLRenderTarget | null, depth: Texture, w: number, h: number, bodyToView: Matrix3, camBody: Vector3, time: number): void {
    const [over, mul, add] = this.groups;
    if (this.capture) this.captured = this.list.slice();
    over.begin(); mul.begin(); add.begin();
    for (const d of this.list) {
      if (this.skip.size && this.skip.has(d.type)) continue;
      const g = GROUP_OF[d.type] ?? 0;
      (g === 0 ? over : g === 1 ? add : mul).push(d);
      // (an FX light draws twice: multiplying the scene in the tint group, and a third of it added — see FRAG t == 10)
      if (d.type === DECAL.light) mul.push(d);
    }
    this.list.length = 0;
    over.end(); mul.end(); add.end();
    if (!over.n && !mul.n && !add.n) return;
    const u = this.uniforms;
    u.tSceneDepth.value = depth;
    (u.uResolution.value as Vector2).set(w, h);
    (u.uInvProj.value as Matrix4).copy(camera.projectionMatrixInverse);
    this.viewToBody.copy(bodyToView).transpose();
    (u.uCamBody.value as Vector3).copy(camBody);
    u.uTime.value = time;
    u.uHasExposure.value = FX_EXPOSURE.value ? 1 : 0;
    const prevAuto = r.autoClear;
    const prevMask = camera.layers.mask;
    r.autoClear = false;
    r.setRenderTarget(target);
    camera.layers.set(5);
    r.render(scene, camera);
    camera.layers.mask = prevMask;
    r.autoClear = prevAuto;
  }

  dispose(): void {
    for (const g of this.groups) { g.geo.dispose(); (g.mesh.material as ShaderMaterial).dispose(); }
  }
}
