// BLOCKTOOTH — telegraph view (CONTRACT §6, §6.1, §8, §10). combat-view lane.
//
// Every alive Telegraph is painted as a GROUND DECAL: one camera-independent quad per shape in the
// shape's local frame, evaluated analytically in the fragment shader (signed distance → crisp at
// every zoom), in the pink telegraph colour (palette.telegraph) AND shape-coded with an animated
// hatch so it reads without colour (greyscale / colour-blind safe):
//   cone   = radial spokes (+ faint arcs travelling away from the apex)
//   oval   = concentric rings contracting toward the centre
//   lane   = chevrons marching toward the far end
//   ring   = dashed concentric bands (alternating rotation)
//   circle = cross-hatch
//   chain  = segmented links along the chain polyline
// Layers (inside → out): translucent tint · hatch · windup FILL sweeping from the origin to the edge
// (bright front line = time-to-impact) · bright rim · ink band outside the rim. The last 25 % of the
// windup pulses the rim faster and faster. On fire: a white flash (punch-scale), dimmed with
// settings.reduceFlashing. Active (dps) telegraphs stay fully filled and flicker until they end.
// Telegraphs removed without firing fade out.
//
// Titan-owned telegraphs (HEARTHBACK magma stomp, titan lob landings) use a WARM MAGMA variant
// (amber/orange, and a marching DASHED rim instead of a solid one) so friend never reads as foe
// even in greyscale.
//
// Readability across the 17 m → 533 m camera range: rim/ink widths are max(k·fwidth(sd), k'·uPx)
// where uPx = metres per CSS pixel at the look target (∝ f.camDist) — constant on-screen weight at
// every rank; the hatch spacing is also ∝ uPx (≈ 14 px), clamped by the shape's own size.
//
// Depth: the decal plane sits at y ≈ 0.03 and every vertex is slid toward the eye along its own
// view ray by uPull (0.3 m + 0.22 % of camDist): identical pixels, nearer depth — so decals win over
// curbs, raised sidewalks/lots and LOCKWATER's flood water (FLOOD_Y 0.06) at every rank, while
// buildings, titans and vehicles still occlude them. An X-RAY pass (depthFunc GREATER, rim + front
// line + a whisper of fill) then shows hostile telegraphs THROUGH whatever hides them — at Size V
// a boss cone half-buried behind megatowers still reads. depthWrite off, renderOrder 3 (after the
// flood water, before weather).
//
// Draw cost: ONE instanced draw per style (+ its x-ray twin; 12 programs, one ShaderMaterial per
// style and pass), hidden when empty. Per-telegraph view state is tracked by telegraph id (Map),
// never by array index (world.ts compacts arrays).

import * as THREE from 'three';
import type { Owner, Shape, Telegraph, TelegraphStyle, World } from '../core/types.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';
import { CAMERA, SIM_DT } from '../core/config.ts';
import { BIOMES } from '../data/biomes.ts';
import { INK } from './materials.ts';

// ─────────────────────────────── constants ───────────────────────────────
const STYLES: readonly TelegraphStyle[] = ['cone', 'oval', 'lane', 'ring', 'circle', 'chain'];
/** 2·tan(fov/2) — vertical view extent per metre of camera distance */
const K_VIEW = 2 * Math.tan((CAMERA.fovDeg * Math.PI) / 360);
/** white flash length after firing (s) */
const FLASH_S = 0.32;
/** fade-out for telegraphs removed without firing / active telegraphs ending (s) */
const FADE_S = 0.16;
/** pop-in (s) */
const POP_S = 0.14;
/** run end: every telegraph fades out over this long (the tabloid photo is taken ~2.5 s later) */
const END_FADE_S = 0.6;
/** a hostile shape counts as COVERED (tooth crown; through the titan's body the x-ray keeps only a
 *  thin dim rim, so a rocket circle under the titan never paints over it) below this × titan radius */
const COVER_LO = 1.2, COVER_HI = 1.8;
/** lanes are never drawn narrower than this many CSS px (visual pad only; the hit lane is unchanged) */
const LANE_MIN_PX = 18;
/** decal plane height (m); depth ordering against curbs / sidewalks / flood water comes from the
 *  view-ray pull below, so the plane itself stays near the ground (no parallax at Size I) */
const DECAL_Y0 = 0.03;
const DECAL_Y_PER_M = 0.00005;
/** view-ray depth pull (m) = PULL0 + PULL_PER_M × camDist  (Size I ≈ 0.34 m · Size V ≈ 1.5 m) */
const PULL0 = 0.3;
const PULL_PER_M = 0.0022;
/** x-ray pass (rim through buildings / bodies) */
const XRAY = true;
/** the titan body volume that masks the x-ray pass = its bind-pose box grown by this × its largest
 *  extent (walk / attack poses swing the neck, tail and limbs past the bind pose) */
const TITAN_XRAY_POSE_MARGIN = 0.1;
/** hatch spacing in CSS pixels at the look target */
const HATCH_PX = 14;
/** fallback telegraph pink (palette.telegraph is identical across biomes) */
const PINK_FALLBACK = '#ff4fa0';

const enum_SHAPE = { circle: 0, ring: 1, cone: 2, lane: 3, oval: 4, capsule: 5 } as const;

/** floats per instance, 6 × vec4 */
const STRIDE = 24;

// ─────────────────────────────── shaders ───────────────────────────────
const VERT = /* glsl */ `
attribute vec4 iA;   // x, z, rot (heading of local +Z), shape mode
attribute vec4 iB;   // shape params
attribute vec4 iC;   // local box: umin, umax, vmin, vmax
attribute vec4 iD;   // progress, flash, warm (0 hostile / 1 titan), fade
attribute vec4 iE;   // seed, active, scale, hatch spacing (m)
attribute vec4 iF;   // size ref (m), urgency, chain link radius (m), chain flags (0 = not a chain link; else 4 + (1 first) + (2 last))
uniform float uY;
uniform float uPull;
varying vec2 vL;
varying vec4 vB;
varying vec4 vD;
varying vec4 vE;
varying vec4 vF;
varying float vShape;
varying vec3 vW;
void main() {
  vec2 L = vec2(mix(iC.x, iC.y, position.x), mix(iC.z, iC.w, position.z));
  float c = cos(iA.z), s = sin(iA.z);
  vec3 wp = vec3(iA.x + L.x * c + L.y * s, uY, iA.y - L.x * s + L.y * c);
  vL = L; vB = iB; vD = iD; vE = iE; vF = iF; vShape = iA.w; vW = wp;
  // slide the vertex toward the eye along its view ray: identical pixels, nearer depth — the decal
  // wins against curbs / sidewalks / flood water within uPull of the ground, but anything taller
  // (buildings, titans, vehicles) still occludes it (and the x-ray pass shows the rim through them)
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float dl = max(length(mv.xyz), 1e-4);
  mv.xyz *= max(0.05, (dl - uPull) / dl);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG_COMMON = /* glsl */ `
uniform float uTime;
uniform float uPx;
uniform float uFlashMax;
uniform vec3 uHBase; uniform vec3 uHFill; uniform vec3 uHRim; uniform vec3 uHFront;
uniform vec3 uWBase; uniform vec3 uWFill; uniform vec3 uWRim; uniform vec3 uWFront;
uniform vec3 uInk;
uniform float uHatchInk;   // 0 dark ground (light hatch lines) .. 1 bright ground (ink hatch lines)
uniform vec4 uTitan;       // titan x, z, radius, how far past its centre (away from the camera) its body hides the ground (m)
uniform vec2 uAway;        // unit XZ direction away from the camera (toward the top of the screen)
// the titan's own body volume (x-ray pass): world → titan-root-local matrix and the body's bind-pose
// box in that space (+ a pose margin); uTOn 0 = no titan model found (fall back to the footprint patch)
uniform mat4 uTInv; uniform vec3 uTBMin; uniform vec3 uTBMax; uniform float uTOn;
varying vec3 vW;
varying vec2 vL;
varying vec4 vB;
varying vec4 vD;
varying vec4 vE;
varying vec4 vF;
varying float vShape;

// thin antialiased lines of half-width 'hw' (in period units) centred on integer x
float stripe(float x, float hw) {
  float d = abs(fract(x + 0.5) - 0.5);
  float fw = max(fwidth(x), 1e-4);
  return 1.0 - smoothstep(hw - fw, hw + fw, d);
}

// signed distance (m, <0 inside), fill coordinate q (0 origin → 1 edge), perimeter coordinate (m)
void shapeEval(vec2 L, out float sd, out float q, out float per) {
  float m = vShape;
  if (m < 0.5) {                       // circle
    float d = length(L);
    sd = d - vB.x; q = d / max(vB.x, 1e-3); per = atan(L.x, L.y) * vB.x;
  } else if (m < 1.5) {                // ring (annulus r0..r1)
    float d = length(L);
    float r0 = vB.x, r1 = vB.y;
    sd = r0 > 1e-3 ? max(r0 - d, d - r1) : d - r1;
    q = (d - r0) / max(r1 - r0, 1e-3); per = atan(L.x, L.y) * r1;
  } else if (m < 2.5) {                // cone: apex at origin, axis +v, radius r, half-angle
    float d = length(L);
    float a = atan(L.x, L.y);
    float e = abs(a) - vB.y;
    sd = max(d - vB.x, d * sin(clamp(e, -1.5707963, 1.5707963)));
    q = d / max(vB.x, 1e-3); per = a * vB.x;
  } else if (m < 3.5) {                // lane: from origin along +v, len, full width
    float hw = vB.y * 0.5;
    sd = max(abs(L.x) - hw, max(-L.y, L.y - vB.x));
    q = L.y / max(vB.x, 1e-3); per = L.y + abs(L.x);
  } else if (m < 4.5) {                // oval: rx across (u), rz along (v)
    vec2 k = L / vec2(vB.x, vB.y);
    float e = length(k);
    vec2 g = L / vec2(vB.x * vB.x, vB.y * vB.y);
    float ge = length(g) / max(e, 1e-4);
    sd = (e - 1.0) / max(ge, 1e-5);
    q = e; per = atan(k.x, k.y) * (vB.x + vB.y) * 0.5;
  } else {                             // capsule / chain segment: len, radius, sStart, sTotal
    float cv = clamp(L.y, 0.0, vB.x);
    sd = length(vec2(L.x, L.y - cv)) - vB.y;
    q = (vB.z + cv) / max(vB.w, 1e-3); per = vB.z + L.y + abs(L.x);
  }
}
`;

/** Style-specific hatch: returns a 0..1 line mask. */
const PATTERN: Record<TelegraphStyle, string> = {
  circle: /* glsl */ `
float pattern(vec2 L, float q, float sp, float t) {
  vec2 h = L / sp;
  return max(stripe((h.x + h.y) * 0.7071 + t * 0.35, 0.12), stripe((h.x - h.y) * 0.7071 - t * 0.35, 0.12));
}`,
  cone: /* glsl */ `
float pattern(vec2 L, float q, float sp, float t) {
  float d = length(L);
  float a = atan(L.x, L.y);
  float refR = max(vB.x * 0.5, sp * 2.0);
  float spoke = stripe(a * refR / (sp * 1.25), 0.15);
  float arcs = stripe(d / (sp * 2.2) - t * 0.9, 0.09);
  float apex = smoothstep(sp * 0.8, sp * 2.2, d);
  return max(spoke, arcs * 0.75) * apex;
}`,
  oval: /* glsl */ `
float pattern(vec2 L, float q, float sp, float t) {
  float R = (vB.x + vB.y) * 0.5;
  return stripe(q * R / (sp * 1.15) + t * 0.7, 0.17);
}`,
  lane: /* glsl */ `
float pattern(vec2 L, float q, float sp, float t) {
  float w = max(vB.y, 1e-3);
  // chevron period: never under ~24 CSS px, or the pattern mushes into the rim at Size IV-V
  float s = max(max(sp * 1.6, w * 0.22), uPx * 24.0);
  return stripe((L.y + abs(L.x) * 0.95) / s - t * 1.3, 0.2);
}`,
  ring: /* glsl */ `
float pattern(vec2 L, float q, float sp, float t) {
  float d = length(L);
  float a = atan(L.x, L.y);
  float bw = sp * 2.1;
  float k = floor(d / bw + 0.5);
  float body = stripe(d / bw, 0.27);
  float sgn = mod(k, 2.0) < 0.5 ? 1.0 : -1.0;
  float dash = stripe(a * max(d, bw) / (sp * 2.4) + t * 0.55 * sgn, 0.27);
  return body * dash;
}`,
  chain: /* glsl */ `
float pattern(vec2 L, float q, float sp, float t) {
  float R = max(vF.z, 1e-3);
  float Lk = max(R * 2.4, sp * 2.6);
  float s = vB.z + L.y;
  float lk = s / Lk - t * 0.45;
  float idx = floor(lk);
  float f = (fract(lk) - 0.5) * Lk;           // metres along, centred on the link
  vec2 p = vec2(L.x, f);
  if (mod(idx, 2.0) < 0.5) {
    // flat link seen from above: rounded-rectangle ring
    vec2 hb = vec2(R * 0.62, Lk * 0.52);
    float rr = R * 0.5;
    vec2 qd = abs(p) - hb + rr;
    float sdl = length(max(qd, 0.0)) + min(max(qd.x, qd.y), 0.0) - rr;
    float th = R * 0.2;
    float fw = max(fwidth(sdl), 1e-4);
    return 1.0 - smoothstep(th - fw, th + fw, abs(sdl));
  }
  // edge-on link: a bar
  float fw2 = max(fwidth(p.x), 1e-4);
  float bar = 1.0 - smoothstep(R * 0.16 - fw2, R * 0.16 + fw2, abs(p.x));
  float fw3 = max(fwidth(p.y), 1e-4);
  return bar * (1.0 - smoothstep(Lk * 0.62 - fw3, Lk * 0.62 + fw3, abs(p.y)));
}`,
};

const FRAG_MAIN = /* glsl */ `
void main() {
  float seed = vE.x;
  float t = uTime + seed * 7.31;
  float prog = vD.x, flash = vD.y, warm = vD.z, fade = vD.w;
  float act = vE.y, sc = max(vE.z, 1e-3), sp = max(vE.w, 1e-3);
  float sizeRef = max(vF.x, 1e-3), urg = vF.y;

  vec2 L = vL / sc;
  float sd, q, per;
  shapeEval(L, sd, q, per);
  float aa = max(fwidth(sd), 1e-4);
  float rimW = min(max(3.2 * aa, uPx * 3.0), sizeRef * 0.3);
  // hostile shapes carry a heavier (~3 px) ink band: the edge must survive greyscale on bright snow
  float inkW = max(2.2 * aa, uPx * mix(3.0, 2.1, warm));
  float inside = 1.0 - smoothstep(-aa, aa, sd);
  float rimM = inside * smoothstep(-rimW - aa, -rimW + aa, sd);
  float inkM = (1.0 - inside) * (1.0 - smoothstep(inkW - aa, inkW + aa, sd));
  // COVERED hostile shapes (smaller than ~1.5x the titan that stands in them): a crown of
  // outward-pointing teeth just outside the ink band — "this edge, get past it", not a reticle
  float cover = (vShape < 4.5 && vF.w > 0.0 && vF.w < 1.5) ? vF.w * (1.0 - warm) : 0.0;
  float toothM = 0.0;
  if (cover > 0.0) {
    float bw = uPx * 9.0;
    float u = (sd - inkW) / bw;                       // 0 at the ink band → 1 at the tooth tips
    float tw = 0.36 * (1.0 - clamp(u, 0.0, 1.0));     // tapering half-width → triangles
    float per2 = per / max(sp * 2.2, uPx * 26.0) - t * 0.25;
    float dper = abs(fract(per2 + 0.5) - 0.5);
    float fwp = max(fwidth(per2), 1e-4);
    toothM = cover * step(0.0, u) * step(u, 1.0) * (1.0 - smoothstep(tw - fwp, tw + fwp, dper));
  }
  // chain joints: interior link caps carry no rim/ink and half weight (the neighbour segment overlaps)
  float joint = 0.0;
  if (vShape > 4.5 && vF.w > 3.5) {
    float fl = vF.w - 4.0;
    float first = mod(fl, 2.0) > 0.5 ? 1.0 : 0.0;
    float last = fl > 1.5 ? 1.0 : 0.0;
    joint = max((1.0 - first) * step(L.y, 0.0), (1.0 - last) * step(vB.x, L.y));
    rimM *= 1.0 - joint;
    inkM *= 1.0 - joint;
  }
  if (inside + inkM + toothM < 0.003) discard;

  vec3 cBase = mix(uHBase, uWBase, warm);
  vec3 cFill = mix(uHFill, uWFill, warm);
  vec3 cRim = mix(uHRim, uWRim, warm);
  vec3 cFront = mix(uHFront, uWFront, warm);

  float pat = pattern(L, q, sp, t);
  float fq = max(fwidth(q), 1e-5);
  float started = step(0.0005, prog);
  float fillM = act > 0.5 ? 1.0 : (1.0 - smoothstep(prog - fq, prog + fq, q)) * started;
  float frontM = (act > 0.5 || prog > 0.998) ? 0.0 : (1.0 - smoothstep(fq * 1.3, fq * 2.8, abs(q - prog))) * started;

  // interior: tint + hatch (unfilled) / solid fill with darker hatch (filled)
  // hatch LINES: lighter pink on dark ground; on bright ground (snow, day plazas) they lean to ink,
  // so the pattern keeps its luminance contrast in greyscale (a light-pink line on snow vanishes)
  float hInk = uHatchInk * (1.0 - warm);
  vec3 hatchCol = mix(mix(cBase, cRim, 0.35), uInk, 0.55 * hInk);
  vec3 colU = mix(cBase, hatchCol, pat);
  // unfilled tint: stronger once the camera is far out (Size IV-V), or the zone reads as an outline only
  float far = smoothstep(0.07, 0.2, uPx) * (1.0 - warm);
  float aU = mix(mix(0.13, 0.28, far), mix(0.55, 0.62, hInk), pat);
  vec3 colF = mix(cFill, cFill * 0.52, pat);
  float aF = mix(0.46, 0.7, pat);
  if (act > 0.5) {
    float fl = 0.5 + 0.5 * sin(t * 31.0 + q * 18.0);
    colF = mix(colF, cRim, 0.18 * fl);
    aF += 0.08 * fl;
  }
  vec3 col = mix(colU, colF, fillM);
  float a = mix(aU, aF, fillM);
  col = mix(col, cFront, frontM);
  a = mix(a, 0.96, frontM);

  // rim: solid (hostile) / marching dashes (titan); urgency pulse in the last quarter
  float dashes = mix(1.0, stripe(per / (sp * 2.6) - t * 1.2, 0.26), warm);
  float pulse = urg > 0.0 ? 0.5 + 0.5 * sin(t * (10.0 + 26.0 * urg)) : 0.0;
  vec3 rimCol = mix(cRim, vec3(1.0), 0.45 * pulse * urg);
  float rimA = 0.97 * dashes;
  col = mix(col, rimCol, rimM * dashes);
  a = mix(a, rimA, rimM * dashes);

  // fire flash (white punch)
  col = mix(col, vec3(1.0), flash);
  a = mix(a, 0.9, flash * inside);

  // ink band outside the rim (titan-owned: dashed with the rim → a dashed OUTLINE, readable in greyscale)
  inkM *= dashes;
  col = mix(col, uInk, inkM);
  a = mix(a, 0.85, inkM);
  vec3 toothCol = mix(cRim, vec3(1.0), 0.25);
  col = mix(col, toothCol, toothM);
  a = mix(a, 0.92, toothM);
  a *= 1.0 - 0.5 * joint;

#ifdef XRAY
  // drawn only where something stands between the camera and the decal (a tower, the titan's own body).
  // Hostile paint must stay a ZONE there, not a hairline: hatch at >= 0.35, the rim, a solid ink band
  // and (covered shapes) the tooth crown. Hatch lines are lightened pink here (they sit on bodies and
  // walls, not on the ground). Friendly (titan-owned) telegraphs skip the x-ray: the hero is not
  // striped by its own stomps.
  float hatchX = 0.35 + 0.1 * cover;
  vec3 xc = mix(cBase, mix(cBase, cRim, 0.55), pat);
  float xa = inside * (0.08 + 0.1 * fillM + pat * hatchX);
  xc = mix(xc, cFill, fillM * (1.0 - pat) * 0.5);
  xc = mix(xc, cFront, frontM); xa = max(xa, frontM * 0.85);
  xc = mix(xc, rimCol, rimM * dashes); xa = max(xa, rimM * dashes * 0.85);
  xc = mix(xc, vec3(1.0), flash); xa = max(xa, flash * inside * 0.6);
  xc = mix(xc, uInk, inkM); xa = max(xa, inkM * 0.85);
  xc = mix(xc, toothCol, toothM); xa = max(xa, toothM * 0.9);
  // COVERED zones (a rocket / mortar circle the titan stands in): through buildings only a thin, dimmer
  // rim (+ the teeth and a faint fire flash) is kept — the ground decal + tooth crown say "get out".
  float xaCov = max(max(rimM * dashes * 0.42, inkM * 0.3), max(toothM * 0.45, flash * inside * 0.22));
  xa = mix(xa, xaCov, cover);
  // THROUGH THE TITAN'S OWN BODY: nothing. Hostile paint whose view ray passes through the titan's
  // body volume (its bind-pose box in root space + a pose margin, tested exactly per fragment) is not
  // x-rayed at all — overlapping rocket circles under a Size II MOLO read as a pink swirl over its head
  // and torso (a rim-only footprint patch 1.0–1.3 R wide missed MOLO's head and tail). The ground decal
  // around the feet still draws (depth-tested), so the zone stays readable.
  if (uTOn > 0.5) {
    vec3 o = (uTInv * vec4(cameraPosition, 1.0)).xyz;
    vec3 d = (uTInv * vec4(vW, 1.0)).xyz - o;
    vec3 dd = vec3(abs(d.x) < 1e-6 ? 1e-6 : d.x, abs(d.y) < 1e-6 ? 1e-6 : d.y, abs(d.z) < 1e-6 ? 1e-6 : d.z);
    vec3 t0 = (uTBMin - o) / dd, t1 = (uTBMax - o) / dd;
    vec3 tn = min(t0, t1), tf = max(t0, t1);
    float tin = max(max(max(tn.x, tn.y), tn.z), 0.0), tout = min(min(min(tf.x, tf.y), tf.z), 1.0);
    // chord through the box in body heights (the model is normalised to height 1): soft silhouette edge
    xa *= 1.0 - smoothstep(0.0, 0.05, (tout - tin) * length(d));
  } else {
    // fallback (no model yet): the footprint circle stretched away from the camera by the body height
    vec2 dT = vW.xz - uTitan.xy;
    float alongT = dot(dT, uAway);
    float latT = abs(dT.x * uAway.y - dT.y * uAway.x);
    float rT = uTitan.z * 1.6;
    float bodyM = (1.0 - smoothstep(rT * 1.0, rT * 1.3, latT))
      * smoothstep(-rT * 1.3, -rT * 1.0, alongT) * (1.0 - smoothstep(uTitan.w, uTitan.w + rT * 0.3, alongT));
    xa *= 1.0 - bodyM;
  }
  col = xc;
  a = xa * (1.0 - warm) * (1.0 - 0.5 * joint);
#endif
  gl_FragColor = vec4(col, a * fade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ─────────────────────────────── instanced batch ───────────────────────────────
class DecalBatch {
  readonly geo: THREE.InstancedBufferGeometry;
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private cap = 0;
  private data: Float32Array = new Float32Array(0);
  private attrs: THREE.InterleavedBufferAttribute[] = [];
  private buf: THREE.InstancedInterleavedBuffer | null = null;
  n = 0;

  readonly xray: THREE.Mesh | null;

  constructor(mat: THREE.ShaderMaterial, xrayMat: THREE.ShaderMaterial | null, cap: number, name: string) {
    this.mat = mat;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1], 3));
    geo.setIndex([0, 2, 1, 1, 2, 3]);
    geo.instanceCount = 0;
    this.geo = geo;
    this.alloc(cap);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    this.mesh = mesh;
    if (xrayMat) {
      const xm = new THREE.Mesh(geo, xrayMat);
      xm.name = name + ':xray';
      xm.frustumCulled = false;
      xm.renderOrder = 3;
      xm.castShadow = false;
      xm.receiveShadow = false;
      xm.matrixAutoUpdate = false;
      this.xray = xm;
    } else this.xray = null;
  }

  private alloc(cap: number): void {
    const old = this.data;
    const data = new Float32Array(cap * STRIDE);
    data.set(old.subarray(0, Math.min(old.length, data.length)));
    if (this.attrs.length) this.geo.dispose();   // release the old GPU buffers (re-uploaded next draw)
    this.data = data;
    this.cap = cap;
    // six vec4 attributes interleaved in one buffer
    const ib = new THREE.InstancedInterleavedBuffer(data, STRIDE, 1);
    ib.setUsage(THREE.DynamicDrawUsage);
    const names = ['iA', 'iB', 'iC', 'iD', 'iE', 'iF'];
    this.attrs = [];
    for (let i = 0; i < names.length; i++) {
      const a = new THREE.InterleavedBufferAttribute(ib, 4, i * 4);
      this.geo.setAttribute(names[i], a);
      this.attrs.push(a);
    }
    this.buf = ib;
  }

  begin(): void { this.n = 0; }

  /** reserve one instance, returning the float offset to write STRIDE floats at */
  slot(): number {
    if (this.n >= this.cap) this.alloc(this.cap * 2);
    return (this.n++) * STRIDE;
  }
  get f(): Float32Array { return this.data; }

  end(): void {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (this.xray) this.xray.visible = this.n > 0;
    if (this.n > 0 && this.buf) {
      this.buf.clearUpdateRanges();
      this.buf.addUpdateRange(0, this.n * STRIDE);
      this.buf.needsUpdate = true;
    }
  }

  dispose(): void { this.geo.dispose(); }
}

// ─────────────────────────────── per-telegraph view state ───────────────────────────────
interface TgRec {
  id: number;
  style: TelegraphStyle;
  owner: Owner;
  ref: Telegraph | null;       // live sim object while it exists
  // copied shape (drawn after the sim object is gone)
  k: Shape['k'];
  x: number; z: number; rot: number;
  p0: number; p1: number; p2: number; p3: number;
  chain: number[] | null;
  windup: number;
  active: number;
  prog: number;                // last shown windup progress 0..1
  fired: boolean;
  firedAt: number;             // real time of fire (−1)
  goneAt: number;              // real time it left the sim (−1)
  bornAt: number;              // real time first drawn
  seen: boolean;
  seed: number;
}

function newRec(): TgRec {
  return {
    id: -1, style: 'circle', owner: 'enemy', ref: null, k: 'circle', x: 0, z: 0, rot: 0,
    p0: 0, p1: 0, p2: 0, p3: 0, chain: null, windup: 0, active: 0, prog: 0, fired: false,
    firedAt: -1, goneAt: -1, bornAt: 0, seen: false, seed: 0,
  };
}

/** copy the sim shape into the record (local frame: origin, rotation, params) */
function copyShape(r: TgRec, s: Shape): void {
  r.k = s.k;
  r.p2 = 0; r.p3 = 0;
  switch (s.k) {
    case 'circle': r.x = s.x; r.z = s.z; r.rot = 0; r.p0 = s.r; r.p1 = 0; break;
    case 'ring': r.x = s.x; r.z = s.z; r.rot = 0; r.p0 = Math.max(0, s.r0); r.p1 = Math.max(s.r0 + 1e-3, s.r1); break;
    case 'cone': r.x = s.x; r.z = s.z; r.rot = s.dir; r.p0 = s.r; r.p1 = Math.max(0.01, Math.min(Math.PI, s.half)); break;
    case 'lane': r.x = s.x; r.z = s.z; r.rot = s.dir; r.p0 = Math.max(0.01, s.len); r.p1 = Math.max(0.01, s.w); break;
    case 'oval': r.x = s.x; r.z = s.z; r.rot = s.rot; r.p0 = Math.max(0.01, s.rx); r.p1 = Math.max(0.01, s.rz); break;
    case 'capsule': {
      const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
      const len = Math.hypot(dx, dz);
      r.x = s.x0; r.z = s.z0; r.rot = len > 1e-6 ? Math.atan2(dx, dz) : 0;
      r.p0 = len; r.p1 = Math.max(0.01, s.r); r.p2 = 0; r.p3 = Math.max(1e-3, len);
      break;
    }
  }
}

/** a chain telegraph's link radius: from its shape when it has one, else a readable default */
function chainRadius(r: TgRec): number {
  switch (r.k) {
    case 'capsule': return r.p1;
    case 'circle': return Math.max(0.3, r.p0 * 0.5);
    case 'lane': return r.p1 * 0.5;
    case 'oval': return Math.min(r.p0, r.p1) * 0.5;
    case 'ring': return Math.max(0.3, (r.p1 - r.p0) * 0.5);
    case 'cone': return Math.max(0.3, r.p0 * 0.15);
  }
  return 1.2;
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);

// ─────────────────────────────── the view ───────────────────────────────
export class TelegraphView implements ViewModule {
  private readonly ctx: ViewCtx;
  private readonly root = new THREE.Group();
  private readonly mats = new Map<TelegraphStyle, THREE.ShaderMaterial>();
  private readonly xmats = new Map<TelegraphStyle, THREE.ShaderMaterial>();
  private readonly batches = new Map<TelegraphStyle, DecalBatch>();
  private readonly recs = new Map<number, TgRec>();
  private readonly pool: TgRec[] = [];
  private readonly doomed: number[] = [];
  private mounted = false;
  /** real time of the runEnd event (−1 = run live) */
  private endAt = -1;
  /** titan circle this frame (cover test) */
  private tx = 0; private tz = 0; private tr = 1;
  /** the titan model (scene child 'titan:<id>', read-only) whose body volume masks the x-ray pass, its
   *  bind-pose box in root-local space (+ TITAN_XRAY_POSE_MARGIN), when that box was last rebuilt */
  private titanRoot: THREE.Object3D | null = null;
  private titanId = '';
  private readonly tBox = new THREE.Box3();
  private tBoxAt = -1e9;
  private tAlive = false;
  private xrayFrame = -1;
  private readonly tInv = new THREE.Matrix4();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpB = new THREE.Box3();

  constructor(ctx: ViewCtx) {
    this.ctx = ctx;
    this.root.name = 'view:telegraphs';
    this.root.matrixAutoUpdate = false;
    for (const st of STYLES) {
      const mat = this.makeMaterial(st, false);
      this.mats.set(st, mat);
      let xm: THREE.ShaderMaterial | null = null;
      if (XRAY) { xm = this.makeMaterial(st, true); this.xmats.set(st, xm); }
      const b = new DecalBatch(mat, xm, st === 'circle' ? 64 : 24, 'tg:' + st);
      this.batches.set(st, b);
      this.root.add(b.mesh);
      if (b.xray) {
        this.root.add(b.xray);
        // the titan's pose is final only once the renderer has updated world matrices
        b.xray.onBeforeRender = () => this.syncTitanXray();
      }
    }
  }

  /** find the titan model (a direct scene child named 'titan:<id>'; titanview owns it — read-only) */
  private findTitanRoot(): THREE.Object3D | null {
    const want = 'titan:' + this.titanId;
    const r = this.titanRoot;
    if (r && r.parent === this.ctx.scene && r.name === want) return r;
    this.titanRoot = null;
    const ch = this.ctx.scene.children;
    for (let i = 0; i < ch.length; i++) if (ch[i].name === want) { this.titanRoot = ch[i]; break; }
    this.tBoxAt = -1e9;
    return this.titanRoot;
  }

  /** x-ray uniforms for the titan body volume, once per rendered frame (from the first visible x-ray
   *  batch's onBeforeRender, after the renderer's updateMatrixWorld — the pose drawn this frame) */
  private syncTitanXray(): void {
    const frame = this.ctx.renderer.info.render.frame;
    if (frame === this.xrayFrame) return;
    this.xrayFrame = frame;
    const root = this.tAlive ? this.findTitanRoot() : null;
    let on = 0;
    if (root && root.visible) {
      const now = performance.now();
      if (now - this.tBoxAt > 500) {
        // bind-pose bounds of every visible mesh, in root-local space (the model is normalised to height 1)
        this.tBoxAt = now;
        this.tBox.makeEmpty();
        this.tInv.copy(root.matrixWorld).invert();
        root.traverseVisible((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || !m.geometry) return;
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          const bb = m.geometry.boundingBox;
          if (!bb || bb.isEmpty()) return;
          this.tmpM.multiplyMatrices(this.tInv, m.matrixWorld);
          this.tmpB.copy(bb).applyMatrix4(this.tmpM);
          this.tBox.union(this.tmpB);
        });
        if (!this.tBox.isEmpty()) {
          const sx = this.tBox.max.x - this.tBox.min.x, sy = this.tBox.max.y - this.tBox.min.y, sz = this.tBox.max.z - this.tBox.min.z;
          const m = TITAN_XRAY_POSE_MARGIN * Math.max(sx, sy, sz);
          this.tBox.min.x -= m; this.tBox.min.z -= m; this.tBox.max.x += m; this.tBox.max.z += m;
          this.tBox.max.y += m; this.tBox.min.y = Math.min(this.tBox.min.y, 0) - m;
        }
      }
      if (!this.tBox.isEmpty()) {
        on = 1;
        this.tInv.copy(root.matrixWorld).invert();
      }
    }
    for (const m of this.xmats.values()) {
      const u = m.uniforms;
      u.uTOn.value = on;
      if (on) {
        (u.uTInv.value as THREE.Matrix4).copy(this.tInv);
        (u.uTBMin.value as THREE.Vector3).copy(this.tBox.min);
        (u.uTBMax.value as THREE.Vector3).copy(this.tBox.max);
      }
    }
  }

  private makeMaterial(style: TelegraphStyle, xray: boolean): THREE.ShaderMaterial {
    const pink = new THREE.Color(PINK_FALLBACK);
    const mat = new THREE.ShaderMaterial({
      name: 'telegraph:' + style + (xray ? ':xray' : ''),
      defines: xray ? { XRAY: '' } : {},
      uniforms: {
        uTime: { value: 0 },
        uPx: { value: 0.02 },
        uY: { value: DECAL_Y0 },
        uPull: { value: PULL0 },
        uFlashMax: { value: 1 },
        uHBase: { value: pink.clone() },
        uHFill: { value: pink.clone() },
        uHRim: { value: pink.clone() },
        uHFront: { value: new THREE.Color('#ffffff') },
        uWBase: { value: new THREE.Color('#ff7a2e') },
        uWFill: { value: new THREE.Color('#ff5a14') },
        uWRim: { value: new THREE.Color('#ffd166') },
        uWFront: { value: new THREE.Color('#fff3c4') },
        uInk: { value: new THREE.Color(INK) },
        uHatchInk: { value: 0 },
        uTitan: { value: new THREE.Vector4(0, 0, 0, 0) },
        uAway: { value: new THREE.Vector2(-Math.SQRT1_2, -Math.SQRT1_2) },
        uTInv: { value: new THREE.Matrix4() },
        uTBMin: { value: new THREE.Vector3() },
        uTBMax: { value: new THREE.Vector3() },
        uTOn: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG_COMMON + PATTERN[style] + FRAG_MAIN,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      depthFunc: xray ? THREE.GreaterDepth : THREE.LessEqualDepth,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: true,
    });
    return mat;
  }

  /** hostile palette from the biome's telegraph pink (fill deeper, rim bright) */
  private applyPalette(w: World): void {
    const pal = BIOMES[w.biomeId]?.palette;
    const hex = pal?.telegraph ?? PINK_FALLBACK;
    const base = new THREE.Color(hex);
    // ground brightness decides the hatch-line ink (snow / day plazas → ink lines; night port → light lines)
    const lum = (h: string | undefined) => {
      if (!h) return 0.5;
      const c = new THREE.Color(h);              // linear working space
      return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    };
    const gl = pal ? (lum(pal.ground) + lum(pal.sidewalk)) * 0.5 : 0.5;
    const hatchInk = Math.min(1, Math.max(0, (gl - 0.12) / 0.5));
    const fill = base.clone().lerp(new THREE.Color('#c8105a'), 0.35);
    const rim = base.clone().lerp(new THREE.Color('#ffffff'), 0.58);
    for (const m of this.allMats()) {
      (m.uniforms.uHBase.value as THREE.Color).copy(base);
      (m.uniforms.uHFill.value as THREE.Color).copy(fill);
      (m.uniforms.uHRim.value as THREE.Color).copy(rim);
      m.uniforms.uHatchInk.value = hatchInk;
    }
  }

  mount(world: World): void {
    this.clearRecs();
    this.endAt = -1;
    this.applyPalette(world);
    if (!this.mounted) { this.ctx.scene.add(this.root); this.mounted = true; }
    for (const b of this.batches.values()) { b.begin(); b.end(); }
  }

  unmount(): void {
    this.clearRecs();
    if (this.mounted) { this.ctx.scene.remove(this.root); this.mounted = false; }
    for (const b of this.batches.values()) { b.begin(); b.end(); }
  }

  /** release GPU resources (page teardown) */
  dispose(): void {
    this.unmount();
    for (const b of this.batches.values()) b.dispose();
    for (const m of this.allMats()) m.dispose();
  }

  private allMats(): THREE.ShaderMaterial[] {
    return [...this.mats.values(), ...this.xmats.values()];
  }

  private clearRecs(): void {
    for (const r of this.recs.values()) { r.ref = null; r.chain = null; this.pool.push(r); }
    this.recs.clear();
  }

  private rec(id: number, now: number): TgRec {
    let r = this.recs.get(id);
    if (!r) {
      r = this.pool.pop() ?? newRec();
      r.id = id; r.ref = null; r.chain = null; r.prog = 0; r.fired = false;
      r.firedAt = -1; r.goneAt = -1; r.bornAt = now; r.seen = false;
      r.seed = ((id * 2654435761) >>> 0) / 4294967296;
      this.recs.set(id, r);
    }
    return r;
  }

  update(w: World, f: FrameInfo): void {
    const now = f.time;
    // metres per CSS pixel at the look target (hatch spacing, rim/ink floor)
    const cssH = Math.max(1, this.ctx.renderer.domElement.clientHeight || 720);
    const px = Math.max(1e-4, (f.camDist * K_VIEW) / cssH);
    const flashMax = this.ctx.quality.reduceFlashing ? 0.3 : 0.92;
    const y = DECAL_Y0 + f.camDist * DECAL_Y_PER_M;
    const pull = PULL0 + f.camDist * PULL_PER_M;
    for (const m of this.mats.values()) this.setFrameUniforms(m, now, px, y, pull, flashMax);
    for (const m of this.xmats.values()) this.setFrameUniforms(m, now, px, y, pull, flashMax);

    for (const r of this.recs.values()) r.seen = false;
    const T = w.titan;
    this.tx = T.x; this.tz = T.z; this.tr = Math.max(0.1, T.radius);
    this.titanId = T.id; this.tAlive = T.alive;
    // the ground patch the titan's body hides (x-ray there is rim-only): its footprint stretched away
    // from the camera by the height it covers at this camera pitch
    {
      const cam = this.ctx.camera, ix = T.px + (T.x - T.px) * f.alpha, iz = T.pz + (T.z - T.pz) * f.alpha;
      let ax = ix - cam.position.x, az = iz - cam.position.z;
      const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
      const elev = Math.atan2(Math.max(0.01, cam.position.y), al);
      const far = this.tr + Math.max(0, T.height) / Math.tan(Math.max(0.2, elev));
      for (const m of this.xmats.values()) {
        (m.uniforms.uTitan.value as THREE.Vector4).set(ix, iz, T.alive ? this.tr : 0, T.alive ? far : 0);
        (m.uniforms.uAway.value as THREE.Vector2).set(ax, az);
      }
    }

    // fire events first (a telegraph can fire and be compacted between two frames)
    const ev = f.events;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.type === 'telegraphFire') {
        const r = this.recs.get(e.id);
        if (r && r.firedAt < 0) { r.fired = true; r.firedAt = now; r.prog = 1; }
      } else if (e.type === 'runEnd' && this.endAt < 0) this.endAt = now;
    }

    // sync with the sim
    const tgs = w.telegraphs;
    const back = f.frozen ? 0 : SIM_DT * (1 - Math.min(1, Math.max(0, f.alpha)));
    for (let i = 0; i < tgs.length; i++) {
      const tg = tgs[i];
      let r = this.recs.get(tg.id);
      if (!tg.alive) {
        if (r && r.goneAt < 0) {
          r.seen = true;
          r.goneAt = now;
          if (tg.fired && r.firedAt < 0) { r.fired = true; r.firedAt = now; r.prog = 1; }
          r.ref = null;
        } else if (r) r.seen = true;
        continue;
      }
      if (!r) r = this.rec(tg.id, now);
      r.seen = true;
      r.ref = tg;
      r.style = tg.style;
      r.owner = tg.owner;
      r.windup = tg.windup;
      r.active = tg.active;
      copyShape(r, tg.shape);
      if (tg.chain && tg.chain.length >= 4) {
        if (!r.chain || r.chain.length !== tg.chain.length) r.chain = tg.chain.slice();
        else for (let k = 0; k < tg.chain.length; k++) r.chain[k] = tg.chain[k];
      } else r.chain = null;
      if (tg.fired) {
        if (r.firedAt < 0) { r.fired = true; r.firedAt = now; }
        r.prog = 1;
      } else {
        const shownT = Math.max(0, tg.t - back);
        r.prog = tg.windup > 1e-6 ? Math.min(1, shownT / tg.windup) : 1;
      }
    }
    // telegraphs that vanished from the array without us seeing them die (compacted mid-frame)
    for (const r of this.recs.values()) {
      if (!r.seen && r.goneAt < 0) { r.goneAt = now; r.ref = null; }
    }

    // emit instances
    for (const b of this.batches.values()) b.begin();
    this.doomed.length = 0;
    // run over: clear the stage for the aftermath + the tabloid freeze-frame (the subject must be findable)
    const endK = this.endAt >= 0 ? Math.max(0, 1 - (now - this.endAt) / END_FADE_S) : 1;
    for (const r of this.recs.values()) {
      let fade = 1;
      let flash = 0;
      let active = 0;
      if (r.firedAt >= 0) {
        const k = (now - r.firedAt) / FLASH_S;
        if (k < 1) flash = flashMax * (1 - k) * (1 - k);
      }
      if (r.goneAt >= 0) {
        if (r.firedAt >= 0 && r.active <= 0) {
          // instant telegraph: the flash IS its exit
          const k = (now - r.firedAt) / FLASH_S;
          if (k >= 1) { this.doomed.push(r.id); continue; }
          fade = 1 - k * k;
        } else {
          const k = (now - r.goneAt) / FADE_S;
          if (k >= 1) { this.doomed.push(r.id); continue; }
          fade = 1 - k;
        }
      }
      if (r.fired && r.active > 0) active = 1;
      const pop = Math.min(1, (now - r.bornAt) / POP_S);
      fade *= 0.35 + 0.65 * pop;
      const scale = (0.86 + 0.14 * easeOut(pop)) * (1 + 0.05 * flash);
      const urg = !r.fired && r.prog > 0.75 ? (r.prog - 0.75) / 0.25 : 0;
      const warm = r.owner === 'titan' ? 1 : 0;
      fade *= endK;
      if (fade <= 0.002) continue;
      this.emit(r, px, fade, flash, warm, active, scale, urg);
    }
    for (let i = 0; i < this.doomed.length; i++) {
      const r = this.recs.get(this.doomed[i]);
      if (r) { r.ref = null; r.chain = null; this.pool.push(r); this.recs.delete(this.doomed[i]); }
    }
    for (const b of this.batches.values()) b.end();
  }

  private setFrameUniforms(m: THREE.ShaderMaterial, now: number, px: number, y: number, pull: number, flashMax: number): void {
    const u = m.uniforms;
    u.uTime.value = now;
    u.uPx.value = px;
    u.uY.value = y;
    u.uPull.value = pull;
    u.uFlashMax.value = flashMax;
  }

  /** write one telegraph (or its chain links) into its style batch */
  private emit(r: TgRec, px: number, fade: number, flash: number, warm: number, active: number, scale: number, urg: number): void {
    const b = this.batches.get(r.style);
    if (!b) return;
    const ink = px * 14 + 0.02;  // box padding: rim + ink + tooth crown + AA, foreshortening-safe
    if (r.style === 'chain' && r.chain) {
      const pts = r.chain;
      const R = chainRadius(r);
      let total = 0;
      for (let i = 2; i + 1 < pts.length; i += 2) total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      total = Math.max(1e-3, total);
      let s0 = 0;
      for (let i = 2; i + 1 < pts.length; i += 2) {
        const x0 = pts[i - 2], z0 = pts[i - 1], x1 = pts[i], z1 = pts[i + 1];
        const len = Math.hypot(x1 - x0, z1 - z0);
        const rot = len > 1e-6 ? Math.atan2(x1 - x0, z1 - z0) : 0;
        const pad = (R + ink) * 1.2;
        this.write(b, x0, z0, rot, enum_SHAPE.capsule, len, R, s0, total,
          -pad, pad, -pad, len + pad, r, px, fade, flash, warm, active, 1, urg, R);
        // chain flags: bit 0 first link, bit 1 last link (interior joints drop their cap rims)
        b.f[(b.n - 1) * STRIDE + 23] = 4 + (i === 2 ? 1 : 0) + (i + 2 >= pts.length - 1 ? 2 : 0);
        s0 += len;
      }
      return;
    }
    const pad = ink;
    switch (r.k) {
      case 'circle': {
        const R = r.p0 * scale + pad;
        this.write(b, r.x, r.z, 0, enum_SHAPE.circle, r.p0, 0, 0, 0, -R, R, -R, R, r, px, fade, flash, warm, active, scale, urg, r.p0);
        break;
      }
      case 'ring': {
        const R = r.p1 * scale + pad;
        this.write(b, r.x, r.z, 0, enum_SHAPE.ring, r.p0, r.p1, 0, 0, -R, R, -R, R, r, px, fade, flash, warm, active, scale, urg,
          r.p0 > 1e-3 ? Math.max(0.2, r.p1 - r.p0) : r.p1);
        break;
      }
      case 'cone': {
        const R = r.p0 * scale;
        const half = r.p1;
        const umax = (half >= Math.PI / 2 ? R : R * Math.sin(half)) + pad;
        const vmin = (half >= Math.PI / 2 ? R * Math.cos(half) : 0) - pad;
        this.write(b, r.x, r.z, r.rot, enum_SHAPE.cone, r.p0, half, 0, 0, -umax, umax, vmin, R + pad, r, px, fade, flash, warm, active, scale, urg,
          Math.min(r.p0, Math.max(0.2, r.p0 * Math.sin(Math.min(half, Math.PI / 2)))));
        break;
      }
      case 'lane': {
        const lw = Math.max(r.p1, px * LANE_MIN_PX);
        const hw = lw * 0.5 * scale + pad;
        this.write(b, r.x, r.z, r.rot, enum_SHAPE.lane, r.p0, lw, 0, 0, -hw, hw, -pad, r.p0 * scale + pad, r, px, fade, flash, warm, active, scale, urg,
          Math.min(r.p0, lw * 0.5));
        break;
      }
      case 'oval': {
        const ux = r.p0 * scale + pad, vz = r.p1 * scale + pad;
        this.write(b, r.x, r.z, r.rot, enum_SHAPE.oval, r.p0, r.p1, 0, 0, -ux, ux, -vz, vz, r, px, fade, flash, warm, active, scale, urg,
          Math.min(r.p0, r.p1));
        break;
      }
      case 'capsule': {
        const R = r.p1 * scale + pad;
        this.write(b, r.x, r.z, r.rot, enum_SHAPE.capsule, r.p0, r.p1, 0, r.p3, -R, R, -R, r.p0 + R, r, px, fade, flash, warm, active, 1, urg, r.p1);
        break;
      }
    }
  }

  /** 0..1: how much a hostile shape is a small zone the titan stands in (tooth crown + rim-only x-ray) */
  private cover(r: TgRec, warm: number): number {
    if (warm > 0.5 || r.style === 'chain') return 0;
    let ext = 0, cx = r.x, cz = r.z;
    switch (r.k) {
      case 'circle': ext = r.p0; break;
      case 'ring': ext = r.p1; break;
      case 'oval': ext = Math.max(r.p0, r.p1); break;
      case 'cone': ext = r.p0 * 0.5; cx += Math.sin(r.rot) * r.p0 * 0.5; cz += Math.cos(r.rot) * r.p0 * 0.5; break;
      case 'lane': ext = Math.max(r.p0, r.p1) * 0.5; cx += Math.sin(r.rot) * r.p0 * 0.5; cz += Math.cos(r.rot) * r.p0 * 0.5; break;
      default: return 0;
    }
    const k = ext / this.tr;
    if (k >= COVER_HI) return 0;
    if (Math.hypot(cx - this.tx, cz - this.tz) > ext + this.tr) return 0;   // not under the titan
    return k <= COVER_LO ? 1 : 1 - (k - COVER_LO) / (COVER_HI - COVER_LO);
  }

  private write(b: DecalBatch, x: number, z: number, rot: number, mode: number,
    p0: number, p1: number, p2: number, p3: number,
    umin: number, umax: number, vmin: number, vmax: number,
    r: TgRec, px: number, fade: number, flash: number, warm: number, active: number, scale: number, urg: number, sizeRef: number): void {
    const o = b.slot();
    const d = b.f;
    // hatch spacing: ~HATCH_PX on screen, but at least 3 and at most ~40 lines across the shape
    const sp = Math.min(Math.max(px * HATCH_PX, sizeRef / 40), Math.max(sizeRef / 3, 1e-3));
    d[o] = x; d[o + 1] = z; d[o + 2] = rot; d[o + 3] = mode;
    d[o + 4] = p0; d[o + 5] = p1; d[o + 6] = p2; d[o + 7] = p3;
    d[o + 8] = umin; d[o + 9] = umax; d[o + 10] = vmin; d[o + 11] = vmax;
    d[o + 12] = r.prog; d[o + 13] = flash; d[o + 14] = warm; d[o + 15] = fade;
    d[o + 16] = r.seed; d[o + 17] = active; d[o + 18] = scale; d[o + 19] = sp;
    d[o + 20] = sizeRef; d[o + 21] = urg; d[o + 22] = r.style === 'chain' ? chainRadius(r) : 0;
    d[o + 23] = mode === enum_SHAPE.capsule ? 0 : this.cover(r, warm);   // chain links overwrite this with their flags
  }

  /** number of telegraph decals drawn last frame (debug / tests) */
  get drawn(): number {
    let n = 0;
    for (const b of this.batches.values()) n += b.n;
    return n;
  }
}
