// PLAYGROUND squishmoji bubbles (LIFE.md 7, PLAYGROUND_BUILD.md 9, RD-04, RD-09): ONE instanced, alpha-blended screen-space draw
// (renderOrder 40, depth test off: always readable), a pool of 8 slots, the 24 icons as signed-distance shapes (at most 4 primitives each:
// circle, ring, segment, arc, triangle, star) in one fragment shader: no texture, no image, nothing for the CSP.
//
// Look: a cream fill at 0.92 alpha, a 1.5 CSS px plum outline, ink line art (one stroke width, rounded ends: the UI icon family) and ONE
// accent per icon, each a deeper OKLCH tone of its token so it stands at 3:1 or better on the cream fill (ACCENT below; the leaf lagoon only,
// the moon an ink crescent with an amber fill, the postcard a sky band inside an ink frame). Styles: say (a tail toward the body), think (a
// wish: three trailing dots; it stays until cleared), group (pieces: a double outline, a smaller bubble, count dots 1..3); flags bit 0 = the
// sparkle badge (close friends), bit 1 = the still 14 px dot of a wish that is not the one wish on screen (LIFE 7.2).
// Size: 36 CSS px with a 22 px icon on a phone (a coarse pointer or a short side under 600 px), 40 / 26 px on a desktop, x0.85 for a group,
// 40 / 46 px for a wish. Motion: in 0.15 s (scale 0.6 to 1.0 with a 6% overshoot), hold `lifeS` (1.6 s), out 0.25 s; a wish re-glances at 8 s
// and 30 s (a 0.2 s grow), then rests as its still dot. **Calm or reduced motion (each on its own): every motion is a fade** (in and out 0.25 s,
// a re-glance is a 0.2 s opacity lift, never a grow). Never a flash (alpha only), nothing bobs or pulses.
// Anchor: the tail tip just above the body's top (1.3 x rest radius above its centre, or its top + 0.15 R if that is higher), clamped inside
// the HUD safe insets (a bubble is not part of a place's framing, RD-17 round 2: it slides along the safe frame's edge, its tail or a wish's
// trailing dots turned to keep pointing at its squishy), stacked upward when two overlap, slid clear of a waiting capsule; hidden while a
// ceremony plays (the reveal plate) and for a body off the frame. Style 3 (LIFE's WISH_DOT) is a wish drawn as its still dot. The stage only draws: LIFE's attention budget decides what reaches emote(). Zero allocation per frame.
import * as THREE from 'three';
import { oklchToLinear, linearToOklch, type Rgb } from './oklch.ts';
import { PALETTE } from './table.ts';

export const EMOTE_SLOTS = 8;
/** The quad's half extent in bubble radii (room for the tail, the think dots and the badge). */
const EXT = 1.6;

/** A theme token (src/ui/theme.ts PALETTE; table.ts holds the same eight as numbers, its `ember` is the coral token) in linear RGB. */
const hexLin = (h: number): Rgb => [16, 8, 0].map((sh) => { const v = ((h >> sh) & 255) / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }) as Rgb;
/** A token taken deeper in OKLCH lightness (same hue and chroma) to `L`: an accent that reads on the cream fill. */
const deep = (h: number, L: number): Rgb => { const o = linearToOklch(hexLin(h)); return oklchToLinear(L, o[1], o[2]).map((v) => Math.max(0, Math.min(1, v))) as Rgb; };

/** The bubble's colours (linear). Accents: the tokens at OKLCH L 0.60 / 0.585 / 0.62 (amber, lagoon, coral: 3.3:1 on the 0.92 cream fill over
 *  ink; the raw tokens are 1.5, 1.4 and 2.6:1), dusk as it is (7.3:1). RD-04 re-measures them on the rendered pixels. */
export const EMOTE_COLOURS = {
  cream: hexLin(PALETTE.cream), plum: hexLin(PALETTE.plum), ink: hexLin(PALETTE.ink), dusk: hexLin(PALETTE.dusk),
  amber: deep(PALETTE.amber, 0.6), lagoon: deep(PALETTE.lagoon, 0.585), coral: deep(PALETTE.ember, 0.62),
} as const;
/** Which accent each icon (EMOTE id 1..24) uses: 1 amber, 2 lagoon, 3 coral, 4 dusk, 5 the place's sky band (the postcard). */
export const EMOTE_ACCENT: readonly number[] = [0,
  3, 2, 1, 1, 2, 1, 4, 2, 1, 4, 4, 1, 3, 2, 2, 2, 2, 1, 1, 1, 3, 5, 3, 3];

const VERT = /* glsl */`
attribute vec4 iA;   // centre (ndc x, y), radius (ndc x, y)
attribute vec4 iB;   // icon, style, alpha, scale
attribute vec4 iC;   // dots, flags, radius in CSS px, icon size over bubble size
attribute float iT;  // the tail's turn from straight down toward its body (radians; 0 = the bubble sits right over its anchor)
varying vec2 vP;
varying vec4 vB;
varying vec4 vC;
varying vec2 vT;
void main() {
  vP = position.xy * ${EXT.toFixed(2)};
  vB = iB; vC = iC; vT = vec2(cos(iT), sin(iT));
  gl_Position = vec4(iA.xy + position.xy * ${EXT.toFixed(2)} * iA.zw * iB.w, 0.0, 1.0);
}
`;

const FRAG = /* glsl */`
precision highp float;
varying vec2 vP;
varying vec4 vB;
varying vec4 vC;
varying vec2 vT;
uniform vec3 uCream, uPlum, uInk, uAmber, uLagoon, uCoral, uDusk, uSky;
#define PI 3.14159265
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float sdArc(vec2 p, vec2 c, float r, float a0, float a1) {
  vec2 d = p - c; float mid = 0.5 * (a0 + a1), hw = 0.5 * (a1 - a0);
  float da = mod(atan(d.y, d.x) - mid + PI, 2.0 * PI) - PI; da = clamp(da, -hw, hw);
  return length(p - (c + r * vec2(cos(mid + da), sin(mid + da))));
}
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2, v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
float sdStar(vec2 p, float r, float n, float m) {   // a regular star: n points, inner ratio m (iq)
  float an = PI / n, en = PI / m; vec2 acs = vec2(cos(an), sin(an)), ecs = vec2(cos(en), sin(en));
  float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  p -= r * acs; p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
  return length(p) * sign(p.x);
}
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
vec2 rep(vec2 p, float n) { float a = 2.0 * PI / n; float t = mod(atan(p.y, p.x) + 0.5 * a, a) - 0.5 * a; return length(p) * vec2(cos(t), sin(t)); }

// one icon in icon space (q in -1..1): ink line strength (a distance to a stroke centre line, or an outline) and an accent fill
float gInk, gAcc;
void stroke(float d, float w, float aa) { gInk = max(gInk, clamp(0.5 - (d - w) / aa, 0.0, 1.0)); }
void fillA(float d, float aa) { gAcc = max(gAcc, clamp(0.5 - d / aa, 0.0, 1.0)); }
void shape(float d, float w, float aa) { fillA(d, aa); stroke(abs(d), w, aa); }   // an accent fill with an ink outline
void icon(int id, vec2 q, float w, float aa) {
  gInk = 0.0; gAcc = 0.0;
  if (id == 1) {          // snug: two round blobs leaning together
    shape(length(q - vec2(-0.33, -0.12)) - 0.42, w, aa); shape(length(q - vec2(0.33, 0.02)) - 0.42, w, aa);
  } else if (id == 2) {   // hello: three short nested arcs and a dot
    for (int i = 0; i < 3; i++) stroke(sdArc(q, vec2(-0.62, -0.1), 0.42 + 0.36 * float(i), -0.75, 0.75), w, aa);
    fillA(length(q - vec2(-0.62, -0.1)) - 0.17, aa);
  } else if (id == 3) {   // giggle: a wavy squiggle and a dot
    stroke(sdArc(q, vec2(-0.5, -0.1), 0.25, 0.0, PI), w, aa); stroke(sdArc(q, vec2(0.0, -0.1), 0.25, PI, 2.0 * PI), w, aa);
    stroke(sdArc(q, vec2(0.5, -0.1), 0.25, 0.0, PI), w, aa); shape(length(q - vec2(0.42, 0.52)) - 0.17, w, aa);
  } else if (id == 4) {   // sparkle: a four-point twinkle
    shape(sdStar(q, 0.86, 4.0, 2.6), w, aa);
  } else if (id == 5) {   // question: a curl and a dot
    stroke(sdArc(q, vec2(0.0, 0.32), 0.36, -0.9, PI), w, aa); stroke(sdSeg(q, vec2(0.22, 0.04), vec2(0.0, -0.22)), w, aa);
    shape(length(q - vec2(0.0, -0.66)) - 0.14, w, aa);
  } else if (id == 6) {   // wow: a burst ring and a dot
    vec2 r = rep(q, 8.0); stroke(sdSeg(r, vec2(0.58, 0.0), vec2(0.86, 0.0)), w, aa); shape(length(q) - 0.3, w, aa);
  } else if (id == 7) {   // zzz: three small z strokes stepping up (in dusk)
    for (int i = 0; i < 3; i++) {
      float s = 0.22 + 0.08 * float(i); vec2 o = vec2(-0.5 + 0.5 * float(i), -0.5 + 0.48 * float(i));
      vec2 a = o + vec2(-s, s), b = o + vec2(s, s), c = o + vec2(-s, -s), d = o + vec2(s, -s);
      float dz = min(min(sdSeg(q, a, b), sdSeg(q, b, c)), sdSeg(q, c, d));
      fillA(dz - w, aa);
    }
  } else if (id == 8) {   // note: an eighth note
    shape(length((q - vec2(-0.22, -0.5)) * vec2(1.0, 1.3)) - 0.27, w, aa);
    stroke(sdSeg(q, vec2(0.04, -0.46), vec2(0.04, 0.7)), w, aa); stroke(sdArc(q, vec2(0.44, 0.7), 0.4, PI, 1.6 * PI), w, aa);
  } else if (id == 9) {   // star: five points
    shape(sdStar(q - vec2(0.0, -0.05), 0.86, 5.0, 3.0), w, aa);
  } else if (id == 10) {  // swirl: a spiral (in dusk)
    float d = min(sdArc(q, vec2(0.0, 0.0), 0.72, 0.0, PI), sdArc(q, vec2(-0.18, 0.0), 0.54, PI, 2.0 * PI));
    d = min(d, sdArc(q, vec2(0.0, 0.0), 0.36, 0.0, PI)); d = min(d, sdArc(q, vec2(-0.09, 0.0), 0.27, PI, 2.0 * PI));
    fillA(d - w, aa);
  } else if (id == 11) {  // puff: a small cloud puff (dusk)
    float d = min(min(length(q - vec2(-0.38, -0.12)) - 0.36, length(q - vec2(0.36, -0.14)) - 0.34), length(q - vec2(0.0, 0.18)) - 0.46);
    d = max(d, -(q.y + 0.46)); shape(d, w, aa);
  } else if (id == 12) {  // sun: a disc with 8 short rays
    vec2 r = rep(q, 8.0); stroke(sdSeg(r, vec2(0.6, 0.0), vec2(0.86, 0.0)), w, aa); shape(length(q) - 0.38, w, aa);
  } else if (id == 13) {  // flame: a teardrop flame
    float d = smin(length(q - vec2(0.0, -0.3)) - 0.48, sdTri(q, vec2(-0.36, -0.12), vec2(0.36, -0.12), vec2(0.06, 0.88)), 0.18);
    shape(d, w, aa);
  } else if (id == 14) {  // snowflake: six short spokes and a lagoon heart
    vec2 r = rep(q, 6.0); stroke(sdSeg(r, vec2(0.0, 0.0), vec2(0.82, 0.0)), w, aa); stroke(sdSeg(r, vec2(0.52, 0.0), vec2(0.72, 0.18)), w, aa);
    shape(length(q) - 0.2, w, aa);
  } else if (id == 15) {  // droplet: a teardrop
    float d = smin(length(q - vec2(0.0, -0.28)) - 0.5, sdTri(q, vec2(-0.38, -0.08), vec2(0.38, -0.08), vec2(0.0, 0.86)), 0.16);
    shape(d, w, aa);
  } else if (id == 16) {  // bubbles: three circles of three sizes
    shape(length(q - vec2(-0.3, -0.3)) - 0.44, w, aa); stroke(abs(length(q - vec2(0.42, 0.08)) - 0.28), w, aa);
    stroke(abs(length(q - vec2(0.02, 0.6)) - 0.17), w, aa);
  } else if (id == 17) {  // leaf: an almond with a midrib (lagoon only)
    vec2 r = vec2(q.x * 0.7071 - q.y * 0.7071, q.x * 0.7071 + q.y * 0.7071);
    float d = max(length(r - vec2(0.0, -0.62)) - 0.95, length(r - vec2(0.0, 0.62)) - 0.95);
    shape(d, w, aa); stroke(sdSeg(r, vec2(-0.6, 0.0), vec2(0.62, 0.0)), w, aa);
  } else if (id == 18) {  // moon: an ink crescent with an amber fill
    float d = max(length(q) - 0.78, -(length(q - vec2(0.42, 0.26)) - 0.6)); shape(d, w, aa);
  } else if (id == 19) {  // ball: a circle with a seam arc
    shape(length(q) - 0.76, w, aa); stroke(sdArc(q, vec2(-0.95, 0.0), 0.95, -0.85, 0.85), w, aa);
  } else if (id == 20) {  // bell: a bell outline and a clapper
    float d = max(length(q - vec2(0.0, 0.0)) - 0.66, -(q.y + 0.44)); shape(d, w, aa);
    stroke(sdSeg(q, vec2(-0.74, -0.44), vec2(0.74, -0.44)), w, aa); shape(length(q - vec2(0.0, -0.68)) - 0.13, w, aa);
  } else if (id == 21) {  // shell: a fan of five ribs
    vec2 b = q - vec2(0.0, -0.62);
    float d = max(length(b) - 1.24, -b.y); d = max(d, abs(atan(b.x, b.y)) - 1.25); shape(d, w, aa);
    float an = atan(b.x, b.y), k = clamp(floor(an / 0.5 + 0.5), -2.0, 2.0) * 0.5;
    stroke(sdSeg(b, vec2(0.0), vec2(sin(k), cos(k)) * 1.1), w, aa);
  } else if (id == 22) {  // postcard: a card in an ink frame with a sky band
    vec2 bq = abs(q) - vec2(0.84, 0.6); float box = length(max(bq, 0.0)) + min(max(bq.x, bq.y), 0.0);
    fillA(max(box, -(q.y - 0.05)), aa); stroke(abs(box), w, aa); stroke(sdSeg(q, vec2(-0.6, -0.3), vec2(0.1, -0.3)), w, aa);
  } else if (id == 23) {  // squeeze: two soft brackets pressing a dot
    stroke(sdArc(q, vec2(-1.05, 0.0), 0.7, -0.75, 0.75), w, aa); stroke(sdArc(q, vec2(1.05, 0.0), 0.7, PI - 0.75, PI + 0.75), w, aa);
    shape(length(q) - 0.24, w, aa);
  } else if (id == 24) {  // stretch: a dot with two rounded arrows out
    vec2 m = vec2(abs(q.x), q.y);
    stroke(sdSeg(m, vec2(0.42, 0.0), vec2(0.88, 0.0)), w, aa); stroke(sdSeg(m, vec2(0.88, 0.0), vec2(0.64, 0.24)), w, aa);
    stroke(sdSeg(m, vec2(0.88, 0.0), vec2(0.64, -0.24)), w, aa); shape(length(q) - 0.22, w, aa);
  }
}

void main() {
  int id = int(vB.x + 0.5), style = int(vB.y + 0.5), flags = int(vC.y + 0.5);
  bool dotOnly = (flags / 2) % 2 == 1, badge = flags % 2 == 1;
  vec2 p = vP;
  float aa = max(fwidth(p.x), 1e-4);              // bubble units per device px
  float ow = 0.75 / max(vC.z, 1.0);   // half the 1.5 CSS px outline, in bubble units (vC.z = the radius in CSS px)
  // the bubble's outline shape
  float body = length(p) - 1.0;
  // the tail (and a wish's trailing dots) turned toward the body: a bubble clamped into the safe frame slides along its edge and still points
  vec2 pt = vec2(vT.x * p.x + vT.y * p.y, -vT.y * p.x + vT.x * p.y);
  if (!dotOnly && style == 0) body = smin(body, sdTri(pt, vec2(-0.32, -0.8), vec2(0.32, -0.8), vec2(0.0, -1.34)), 0.1);
  float sh = body;
  if (!dotOnly && style == 1) sh = min(min(sh, length(pt - vec2(-0.66, -1.04)) - 0.17), length(pt - vec2(-0.98, -1.34)) - 0.1);
  float fill = clamp(0.5 - sh / aa, 0.0, 1.0);
  float line = clamp(0.5 - (abs(sh) - ow) / aa, 0.0, 1.0);
  if (!dotOnly && style == 2) line = max(line, clamp(0.5 - (abs(length(p) - 0.82) - ow * 0.8) / aa, 0.0, 1.0));
  vec3 col = uCream;
  float a = fill * 0.92;
  if (dotOnly) {
    // the still dot: a small cream dot with the icon's accent at its heart
    float ad = clamp(0.5 - (length(p) - 0.42) / aa, 0.0, 1.0);
    col = mix(col, ACCENT_OF_ICON, ad);
  } else if (id > 0) {
    float s = vC.w * (style == 2 ? 0.85 : 1.0);   // the icon's size over the bubble's (a group's icon is smaller, LIFE 7.2)
    vec2 q = p / s;
    float qaa = aa / s, w = ICON_STROKE;
    icon(id, q, w, qaa);
    col = mix(col, ACCENT_OF_ICON, gAcc * fill);
    col = mix(col, uInk, gInk * fill);
  }
  // count dots (group, 1..3) along the bottom inside the bubble
  if (!dotOnly && style == 2) {
    int nd = int(vC.x + 0.5);
    for (int i = 0; i < 3; i++) {
      if (i >= nd) break;
      float x = (float(i) - 0.5 * float(nd - 1)) * 0.26;
      col = mix(col, uInk, clamp(0.5 - (length(p - vec2(x, -0.62)) - 0.095) / aa, 0.0, 1.0) * fill);
    }
  }
  col = mix(col, uPlum, line);
  a = max(a, line);
  // the sparkle badge: a small amber twinkle on a cream disc with a plum outline, top right
  if (!dotOnly && badge) {
    vec2 b = p - vec2(0.8, 0.8);
    float bd = length(b) - 0.34;
    float bf = clamp(0.5 - bd / aa, 0.0, 1.0), bl = clamp(0.5 - (abs(bd) - ow) / aa, 0.0, 1.0);
    col = mix(col, uCream, bf); a = max(a, bf * 0.96);
    col = mix(col, uAmber, clamp(0.5 - sdStar(b, 0.26, 4.0, 2.6) / aa, 0.0, 1.0));
    col = mix(col, uPlum, bl); a = max(a, bl);
  }
  gl_FragColor = vec4(col, a * vB.z);
  #include <colorspace_fragment>
}
`;

/** Bubble geometry per style (CSS px), by phone / desktop: [bubble diameter, icon size]. */
const SIZE = { phone: { say: [36, 22], wish: [40, 24.4] }, desk: { say: [40, 26], wish: [46, 30] } } as const;
/** A group bubble is x0.85, but never under RD-04's 36 CSS px floor (LIFE 7.2's x0.85 of a 36 px phone bubble is 30.6 px): it keeps 36 px
 *  there and its icon draws x0.85 smaller instead ("a smaller icon", LIFE 7.2 Styles). */
const GROUP_K = 0.85, MIN_PX = 36, DOT_PX = 14;

class Slot {
  on = false; body = -1; icon = 0; style = 0; lifeS = 1.6; dots = 0; flags = 0;
  age = 0; outAge = -1;
  /** On screen this frame: centre and radius (CSS px), alpha and scale. */
  x = 0; y = 0; r = 0; alpha = 0; scale = 1; shown = false;
  /** Stacking offset (CSS px upward): its target, and the eased value drawn (a change glides, it never jumps). */
  liftT = 0; lift = 0;
  /** Sort key: the anchor's screen y (nearer bodies are lower on screen and keep their spot); and its x. */
  ay = 0; ax = 0;
  /** The tail's turn toward the anchor (radians, 0 = straight down). */
  tail = 0;
  dot = false;
  /** The icon's size over the bubble's. */
  ir = 0.61;
}

/** What the emote layer needs from the stage each frame (no allocation: the stage fills one reused object). */
export interface EmoteFrame {
  camera: THREE.PerspectiveCamera;
  cssW: number; cssH: number; dpr: number;
  safe: { top: number; right: number; bottom: number; left: number };
  /** World anchor of a body (its centre x, z, and the tail tip's y); false when the body is unknown or hidden. */
  anchor(bodyId: number, out: Float32Array): boolean;
  /** The waiting capsule's screen circle (CSS px), or r 0 for none. */
  capX: number; capY: number; capR: number;
  /** A ceremony is playing (the reveal plate): bubbles fade out. */
  ceremony: boolean;
  /** Calm effects or reduced motion: every motion is a fade. */
  quiet: boolean;
  /** A phone (a coarse pointer, or the short side under 600 CSS px). */
  phone: boolean;
}

export class Emotes {
  readonly mesh: THREE.Mesh;
  readonly slots: Slot[] = [];
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private readonly aA: THREE.InstancedBufferAttribute;
  private readonly aB: THREE.InstancedBufferAttribute;
  private readonly aC: THREE.InstancedBufferAttribute;
  private readonly aT: THREE.InstancedBufferAttribute;
  private readonly tmp = new Float32Array(3);
  private readonly v = new THREE.Vector3();
  private readonly order: Slot[] = [];
  private inPhoto = true;

  constructor() {
    for (let i = 0; i < EMOTE_SLOTS; i++) this.slots.push(new Slot());
    const quad = new THREE.PlaneGeometry(2, 2);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(EMOTE_SLOTS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(EMOTE_SLOTS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(EMOTE_SLOTS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aT = new THREE.InstancedBufferAttribute(new Float32Array(EMOTE_SLOTS), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iA', this.aA); this.geo.setAttribute('iB', this.aB); this.geo.setAttribute('iC', this.aC); this.geo.setAttribute('iT', this.aT);
    this.geo.instanceCount = 0;
    const c = EMOTE_COLOURS, col = (v: Rgb) => ({ value: new THREE.Color().setRGB(v[0], v[1], v[2], THREE.LinearSRGBColorSpace) });
    // each icon's accent, picked in the shader by its id (a constant table: no texture)
    const accName = ['uAmber', 'uAmber', 'uLagoon', 'uCoral', 'uDusk', 'uSky'];
    let pick = '';
    for (let id = 1; id < EMOTE_ACCENT.length; id++) pick += `${id > 1 ? ' : ' : ''}(id == ${id}) ? ${accName[EMOTE_ACCENT[id]]}`;
    pick = `(${pick} : uAmber)`;
    const frag = FRAG
      .replace(/ACCENT_OF_ICON/g, pick)
      .replace('ICON_STROKE', '0.1');
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: frag,
      uniforms: {
        uCream: col(c.cream), uPlum: col(c.plum), uInk: col(c.ink), uAmber: col(c.amber), uLagoon: col(c.lagoon), uCoral: col(c.coral),
        uDusk: col(c.dusk), uSky: col(c.dusk),
      },
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
      // blend the colour, keep the canvas's opaque alpha (the page background never shows through a bubble)
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 40;
    this.mesh.visible = false;
  }

  /** The postcard's sky band: the place's sky colour (linear). */
  setSky(r: number, g: number, b: number): void { this.mat.uniforms.uSky.value.setRGB(r, g, b, THREE.LinearSRGBColorSpace); }
  setInPhoto(on: boolean): void { this.inPhoto = on; }

  show(slot: number, bodyId: number, icon: number, style: number, lifeS: number, dots: number, flags: number): void {
    const s = this.slots[slot | 0];
    if (!s || !Number.isFinite(slot)) return;
    // style 3 (LIFE's WISH_DOT, set by the attention budget) = a wish drawn as its still dot (the same as flags bit 1)
    let st = Math.floor(style) || 0, fl = Math.floor(flags) || 0;
    if (st === 3) { st = 1; fl |= 2; }
    const same = s.on && s.outAge < 0 && s.body === bodyId && s.icon === icon && s.style === st;
    s.body = bodyId; s.icon = Math.max(0, Math.min(24, Math.floor(icon) || 0)); s.style = Math.max(0, Math.min(2, st));
    s.lifeS = Number.isFinite(lifeS) && lifeS > 0 ? lifeS : 1.6;
    s.dots = Math.max(0, Math.min(3, Math.floor(dots) || 0)); s.flags = fl;
    s.dot = (s.flags & 2) !== 0;
    if (same) { s.age = Math.min(s.age, 0.15); return; }   // a re-show of the same bubble (a wish tapped or focused): it grows again, no pop
    s.on = true; s.age = 0; s.outAge = -1; s.lift = 0; s.liftT = 0;
  }
  clear(slot: number): void {
    const s = this.slots[slot | 0];
    if (s && s.on && s.outAge < 0) s.outAge = 0;
  }
  /** A body went away: its bubbles go at once. */
  dropBody(bodyId: number): void { for (const s of this.slots) if (s.on && s.body === bodyId) { s.on = false; s.shown = false; } }
  screen(slot: number, out: Float32Array): boolean {
    const s = this.slots[slot | 0];
    if (!s || !s.on || !s.shown) return false;
    out[0] = s.x; out[1] = s.y; out[2] = s.r * s.scale;
    return true;
  }

  update(dt: number, f: EmoteFrame): void {
    const order = this.order;
    order.length = 0;
    const W = f.cssW, H = f.cssH, sz = f.phone ? SIZE.phone : SIZE.desk;
    for (const s of this.slots) {
      if (!s.on) { s.shown = false; continue; }
      s.age += dt;
      if (s.outAge >= 0) { s.outAge += dt; if (s.outAge >= 0.25) { s.on = false; s.shown = false; continue; } }
      else if (s.style !== 1 && s.age >= 0.15 + s.lifeS) s.outAge = 0;   // say and group: in, hold, out
      // where: the anchor on screen (CSS px), hidden off the frame
      if (!f.anchor(s.body, this.tmp)) { s.shown = false; continue; }
      this.v.set(this.tmp[0], this.tmp[1], this.tmp[2]).project(f.camera);
      if (this.v.z > 1 || this.v.x < -1.05 || this.v.x > 1.05 || this.v.y < -1.05 || this.v.y > 1.05) { s.shown = false; continue; }
      const ax = (this.v.x * 0.5 + 0.5) * W, ay = (1 - (this.v.y * 0.5 + 0.5)) * H;
      // size: the still dot, a wish, a group (x0.85), a say bubble
      const wish = s.style === 1;
      const base = wish ? sz.wish : sz.say;
      const d = s.dot ? DOT_PX : s.style === 2 ? Math.max(MIN_PX, base[0] * GROUP_K) : base[0];
      s.r = d / 2; s.ir = base[1] / base[0];
      // the tail tip sits at the anchor: the bubble's centre is a radius and a tail above it
      s.x = ax; s.ax = ax; s.ay = ay; s.y = ay - s.r * (s.dot ? 1.2 : 1.34);
      // motion: alpha and scale (Calm or reduced motion: fades only, never a grow)
      let a = 1, sc = 1;
      if (f.quiet) {
        a = Math.min(1, s.age / 0.25);
        if (wish && !s.dot) { for (const t0 of [8, 30]) { const u = (s.age - t0) / 0.2; if (u >= 0 && u < 1) a *= 0.7 + 0.3 * u; } }   // a re-glance: an opacity lift
      } else {
        const u = Math.min(1, s.age / 0.15);
        a = u;
        // 0.6 -> 1.0 with a 6% overshoot (a back-out ease), then still
        const k = 1.70158 * 0.62, e = 1 + (k + 1) * Math.pow(u - 1, 3) + k * Math.pow(u - 1, 2);
        sc = 0.6 + 0.4 * e;
        if (wish && !s.dot) { for (const t0 of [8, 30]) { const v = (s.age - t0) / 0.2; if (v >= 0 && v < 1) sc *= 1 + 0.12 * Math.sin(Math.PI * v); } }   // a re-glance: a 0.2 s grow
      }
      // after its two re-glances a wish rests as its still dot (a re-show grows it again)
      if (wish && !s.dot && s.age > 30.45) { s.dot = true; s.age = 0; s.flags |= 2; }
      if (s.outAge >= 0) a *= 1 - s.outAge / 0.25;
      if (f.ceremony) a = 0;
      s.alpha = a; s.scale = sc; s.shown = a > 0.002;
      if (s.shown) order.push(s);
    }
    // stack: nearer bodies (lower on screen) keep their spot, a bubble that overlaps one already placed moves up above it; then inside the
    // HUD insets and clear of a waiting capsule (slid sideways)
    order.sort((p, q) => q.ay - p.ay);
    for (let i = 0; i < order.length; i++) {
      const s = order[i];
      let need = 0;
      for (let j = 0; j < i; j++) {
        const o = order[j], dx = s.x - o.x, gap = s.r + o.r + 3;
        if (Math.abs(dx) >= gap) continue;
        const want = s.y - (o.y - o.liftT - Math.sqrt(gap * gap - dx * dx));   // the rise that puts s just above o
        if (want > need) need = want;
      }
      s.liftT = need;
      s.lift += (need - s.lift) * (1 - Math.exp(-dt * 12));
    }
    let n = 0;
    const A = this.aA.array as Float32Array, B = this.aB.array as Float32Array, C = this.aC.array as Float32Array;
    const xLo = f.safe.left + 2, xHi = W - f.safe.right - 2, yLo = f.safe.top + 2, yHi = H - f.safe.bottom - 2;
    for (let i = 0; i < order.length; i++) {
      const s = order[i];
      let x = s.x, y = s.y - s.lift;
      const r = s.r * Math.max(1, s.scale);
      if (f.capR > 0) {
        const dx = x - f.capX, dy = y - f.capY, gap = r + f.capR + 4;
        if (dx * dx + dy * dy < gap * gap) x = f.capX + (dx >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, gap * gap - dy * dy));
      }
      x = Math.min(xHi - r, Math.max(xLo + r, x));
      const yWant = y;
      y = Math.min(yHi - r, Math.max(yLo + r, y));
      // held down by the top inset (a back body near the frame's top): it slides along the edge toward the frame's middle, off its body's
      // face, by as much as it was pushed down (at most 2.4 radii); its tail turns to keep pointing at the body
      const push = y - yWant;
      if (push > 0.5 * r) x = Math.min(xHi - r, Math.max(xLo + r, x + (x < W / 2 ? 1 : -1) * Math.min(push, 2.4 * r)));
      // no room above (the top inset held it down onto a bubble already placed): beside it instead, toward the side with more room
      for (let pass = 0; pass < 2; pass++) for (let j = 0; j < i; j++) {
        const o = order[j], dx = x - o.x, dy = y - o.y, gap = r + o.r * Math.max(1, o.scale) + 3;
        if (dx * dx + dy * dy >= gap * gap) continue;
        const side = Math.abs(dx) > 0.5 ? Math.sign(dx) : (o.x < W / 2 ? 1 : -1);
        let nx = o.x + side * Math.sqrt(Math.max(0, gap * gap - dy * dy));
        if (nx < xLo + r || nx > xHi - r) nx = o.x - side * Math.sqrt(Math.max(0, gap * gap - dy * dy));
        x = Math.min(xHi - r, Math.max(xLo + r, nx));
      }
      s.x = x; s.y = y;
      // the tail turns toward the anchor when the clamps moved the bubble off it (exactly 0 when they did not: today's pixels)
      const tdx = s.ax - x, tdy = s.ay - y;
      s.tail = Math.abs(tdx) < 0.01 && tdy > 0 ? 0 : Math.atan2(tdx, tdy);
      (this.aT.array as Float32Array)[n] = s.tail;
      const i4 = n * 4;
      A[i4] = (x / W) * 2 - 1; A[i4 + 1] = 1 - (y / H) * 2; A[i4 + 2] = (s.r / W) * 2; A[i4 + 3] = (s.r / H) * 2;
      B[i4] = s.icon; B[i4 + 1] = s.style; B[i4 + 2] = s.alpha; B[i4 + 3] = s.scale;
      C[i4] = s.dots; C[i4 + 1] = s.flags | (s.dot ? 2 : 0); C[i4 + 2] = s.r; C[i4 + 3] = s.ir;
      n++;
    }
    this.geo.instanceCount = n;
    this.aA.needsUpdate = true; this.aB.needsUpdate = true; this.aC.needsUpdate = true; this.aT.needsUpdate = true;
    this.mesh.visible = n > 0 && this.inPhoto;
  }

  /** How many bubbles are drawing (the harness). */
  get count(): number { return this.geo.instanceCount; }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}
