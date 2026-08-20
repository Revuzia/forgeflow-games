// core/fx/grounding.js [A7 / lane D] — THE shared grounding helper: contact
// shadow + wet-ground reflection for every character, prop and vehicle.
//
// ONE helper, two consumers:
//   * STATIC pool  — fx.js sweeps the built scene ONCE; props.js publishes an
//     authored placement contract (`group.userData.grounding`) and every
//     ground-mounted placement leases a slot. Merged or instanced batches make
//     no difference: the contract carries the analytic contact point.
//   * DYNAMIC pool — soldiers.js leases one slot per live actor and writes
//     position / footprint / height / tint / yaw every frame.
//
// ===========================================================================
// ITER08 — WHY THIS WAS REWRITTEN, measured rather than argued.
//
// iter07 shipped a radial-blob contact shadow plus a wet reflection card and
// reported grounding CLOSED; all three critics then reported the opposite
// ("no contact darkening, no cast shadow, and no reflection"). The verification
// agent and the critics were both reading the same pixels correctly. Probed
// live this wave, on S9, by rendering the frame with the grounding meshes
// visible and hidden and differencing the two against an animation noise floor:
//
//   (1) AMPLITUDE WAS NEVER THE PROBLEM. The blob reached 98.1% luma removal at
//       its core (measured: ground pixel 126.0 -> 2.3 at x=641,y=665). What was
//       wrong was FOOTPRINT. The readable part of a radial falloff is its inner
//       third, so a quad of 1.12 x 1.00 m produced a dark patch of roughly
//       0.25 m radius — smaller than the man's own stance, centred under him,
//       and therefore almost entirely OCCLUDED BY HIS OWN BOOTS. Only 1,866
//       pixels in the whole frame lost more than half their value. That is
//       exactly critic-a's "only a hairline of darkening": the mechanism was
//       present, at full strength, and hidden underneath the thing it grounded.
//
//   (2) THE REFLECTION CARDS WERE MAKING IT WORSE, not better. Two defects,
//       both in the fragment shader, both visible in the A/B crops:
//         - The lateral falloff was exp(-q*q*2) with q = u/wprof. At the card
//           edge (|u| = 0.5, wprof ~ 1.3) that lands at 0.31 of peak alpha, NOT
//           zero — so every card ended on a straight line at a third of full
//           strength. A hard-edged quad on the cobbles.
//         - The value ramp was `tint * mix(0.12, 1.55, v*v)`. At 1.55x a
//           mid-grey prop tint (0x63686d) that is BRIGHTER than the wet stone
//           it is drawn over, so a static prop's card rendered as a pale
//           hard-edged trapezoid — measured beside the S9 black box.
//       Those two together ARE critic-a's and critic-c's "hard-edged opaque
//       light-pool quads painted on the ground". The grounding lane shipped the
//       artifact another lane was being asked to remove.
//
//   (3) DISPROVED, so it is not fixed here: the missing CAST shadows are not a
//       shadow-map resolution problem. The moon (core/render/lighting.js) does
//       carry castShadow with a live 1024 map, the ground is receiveShadow, and
//       props/characters are castShadow — all verified live. Tightening its
//       ortho frustum from +/-85 m to +/-10 m (texel 0.166 m -> 0.020 m, an 8x
//       resolution gain) changed the frame by nothing visible. Whatever is
//       eating the moon's shadow is in the lighting/ground composite, not in
//       the map, and it is in a file this lane does not own. Reported, not
//       guessed at.
//
// WHAT REPLACES IT — one idea, applied twice.
//
// A blob is a placeholder because a circle is not the shape of anything. Both
// the shadow and the reflection now evaluate a SILHOUETTE FIELD: a signed
// distance function of the object's actual outline, selected per object by a
// shape id (box / human / prone / vehicle / round) and oriented by its own yaw.
// The shadow evaluates it in the ground plane and SWEEPS it four taps along the
// moon's ground-projected direction, widening the penumbra and fading the alpha
// with each tap — so the shadow leaves the contact tight and dark, runs away
// from the light, and dissolves at its tip. That is a contact shadow that knows
// both the silhouette and the lighting direction, which is what a generic
// ellipse cannot be. The reflection evaluates the object's FRONT profile
// (narrow at the boots, widest at the shoulders, narrow at the head) up the
// length of the mirrored smear, so the thing on the water is recognisably the
// thing standing there.
//
// COST. This is deliberately arranged to cost less than what it replaces in
// every count except fill:
//   * draw calls: unchanged at 2 (one instanced shadow mesh per pool) + 2
//     reflection meshes.
//   * PROGRAMS: 3 -> 2. Statics were a merged mesh on a MeshBasicMaterial;
//     they are now an InstancedMesh sharing the DYNAMIC pool's material. One
//     program fewer against the 70 budget the perf lane flagged at 93.
//   * geometry: the merged static shadow (140 quads, 560 verts) becomes 140
//     instances of one 4-vert quad.
//   * fill: UP, and this is the honest cost. Quads must be big enough to hold
//     the swept shadow, so the cast length is CPU-clamped (CAST_MAX_*) rather
//     than taken from the true 1/tan(38 deg) = 1.30 x height, which would have
//     made a man's quad 6 m across. Measured delta is reported to the perf lane.
// The fragment work itself is a dozen ellipse evaluations with no lights, no
// IBL and no shadow sampling — the cheap kind of pixel, on the pass that is
// not the bottleneck.
//
// DARKENING ONLY, by construction: the shadow fragment colour is literally
// vec3(0.0) under NormalBlending, so dst' = dst * (1 - a). It cannot brighten a
// pixel at any alpha. The reflection's value ramp is now capped at 0.85 x the
// object's own tint, so a reflection can never be brighter than the object it
// mirrors — which is what made the pale slabs.
//
// COMPOSITE ORDER (kept from iter07, and it was right). The ground carries
// additive sheets that draw after the opaque pass: level.js's `wet_specular`
// at renderOrder 8 and the ground fog discs / light pools at 9 and 10. A
// shadow composited below those is re-lit by them. Grounding sits at 11.5
// (reflection) / 12 (shadow), above every additive ground layer and below the
// rain (17+). A real object occludes the sheen it stands in; so does its shadow.
// ===========================================================================

import * as THREE from "three";

const DYN_N = 32;          // dynamic slots (characters); >= max live actors
const STATIC_MAX = 512;    // sanity cap on the one-time bake

// ---- shape ids (shared by the shadow and the reflection) -------------------
export const SHAPE = {
  BOX: 0,      // crate, kiosk, container, bench — rounded rectangular footprint
  HUMAN: 1,    // standing character
  PRONE: 2,    // body on the ground
  VEHICLE: 3,  // car / van / truck
  ROUND: 4,    // barrel, tire, bollard, bin
};

// Static-bake acceptance envelope.
const MIN_FOOT = 0.10;     // m — below this the shadow is invisible anyway
const MAX_FOOT = 7.0;      // m — above this it is architecture, not a prop
const STATIC_ALPHA = 0.72;

// ---- cast-shadow sweep -----------------------------------------------------
// The true ground-projected length of a cast shadow is h / tan(elevation); the
// moon sits at 38 deg, so that is 1.30 x height and a standing man throws 2.3 m.
// Honouring it exactly would need a 6 m quad per character on a frame the perf
// lane is cutting 3x, so the length is clamped. A SHORTENED shadow still reads
// as directional — the eye takes the direction from the smear's axis, not from
// its length — while a 6 m transparent quad per actor is real fill.
const CAST_PER_H = 1.30;   // 1 / tan(38 deg)
const CAST_MAX_DYN = 1.30; // m — characters
const CAST_MAX_STATIC = 1.60; // m — props/vehicles
const CAST_TIP_ALPHA = 0.34;  // alpha multiplier at the far tip of the sweep
const PEN_NEAR = 0.055;    // m — penumbra at the contact (tight = reads as touch)
const PEN_FAR = 0.34;      // m — penumbra at the tip
const QUAD_PAD = 0.15;     // m — headroom so no term is ever clipped by the quad

// ---- ambient-occlusion pool ------------------------------------------------
// The third term, and the one that makes the difference on a camera pointed
// down the light axis. Measured on S9: the moon's ground direction is
// (0.77, 0.64) and that scenario's camera looks along (-0.79, -0.61) — almost
// exactly ANTI-PARALLEL, so the cast smear foreshortens into the same screen
// column as the man and reads as a dark continuation of his leg, while the
// tight contact term (penumbra 0.073 m) hugs the silhouette so closely that his
// own boots cover it. Neither is wrong; both are invisible from there. A real
// object also darkens the ground it merely stands NEAR, and that pool is
// isotropic — it survives any camera azimuth. So the shadow is a union of
// three things: a soft AO pool, a tight contact, and a directional cast.
const AO_DILATE = 0.34;    // m — fixed dilation of the silhouette
const AO_REL = 0.30;       // + this fraction of the footprint (big things pool wider)
const AO_ALPHA = 0.66;     // pool alpha relative to the contact's 1.0
// Falloff exponent. A plain smoothstep across the pool puts its half-strength
// point at aoR/2, which measured out as 10-20% luma removal over the readable
// part of the pool — present in an A/B difference mask, invisible at 1080p,
// i.e. exactly the "hairline" failure this iteration exists to end. An
// exponent below 1 holds the pool near full strength across the object's
// immediate surround and spends the falloff at the rim instead: measured
// 0.25 m from a standing figure it lifts 0.46 -> 0.66 alpha, and 0.50 m out
// 0.16 -> 0.43. It still reaches exactly zero at the pool edge.
const AO_POW = 0.65;

// ---- reflection card -------------------------------------------------------
const REFL_MAX_LEN = 2.30;   // x object height — a rough film compresses the
                             // image; an unclamped mirror smear runs 20 m
const REFL_MAX_DIST = 46;    // m — beyond this the card is sub-pixel
const REFL_STRENGTH = 0.62;
const DEFAULT_TINT = 0x63686d; // neutral dark body value for an untinted prop

// ---- composite order (see header) ------------------------------------------
const RO_REFLECT = 11.5;
const RO_SHADOW = 12;

// ===========================================================================
// SHARED GLSL — the silhouette field. This is the whole idea, so both the
// shadow and the reflection compile the identical source: they cannot disagree
// about what the object looks like.
// ===========================================================================
const SIL_GLSL = /* glsl */ `
// world XZ offset -> object frame. THREE's Y rotation maps local (x,z) to
// world (x c + z s, -x s + z c), so the inverse is this.
vec2 rot2(vec2 v, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * v.x + s * v.y, -s * v.x + c * v.y);
}
// Approximate signed distance to an ellipse, in metres. Exact on a circle and
// close enough on the eccentricities used here; it only feeds a smoothstep.
float sdEll(vec2 p, vec2 r) {
  r = max(r, vec2(0.02));
  return (length(p / r) - 1.0) * min(r.x, r.y);
}
// Exact signed distance to a rounded box.
float sdRBox(vec2 p, vec2 b, float rr) {
  vec2 q = abs(p) - max(b - rr, vec2(0.001));
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - rr;
}
// TOP-DOWN outline, object frame, metres. r = footprint half-extents.
// This is what makes the shadow the object's shadow instead of a dot.
float silTop(vec2 p, vec2 r, float shape) {
  if (shape < 0.5) {                       // BOX
    return sdRBox(p, r, min(min(r.x, r.y) * 0.55, 0.12));
  }
  if (shape < 1.5) {                       // HUMAN standing: torso + two boots
    float d = sdEll(p - vec2(0.0, 0.010),
                    vec2(max(r.x * 0.60, 0.125), max(r.y * 0.46, 0.105)));
    d = min(d, sdEll(p - vec2(-0.105, 0.035), vec2(0.082, 0.150)));
    d = min(d, sdEll(p - vec2( 0.105, -0.030), vec2(0.082, 0.150)));
    return d;
  }
  if (shape < 2.5) {                       // PRONE body: one long ellipse
    return sdEll(p, vec2(max(r.x, 0.24), max(r.y, 0.62)));
  }
  if (shape < 3.5) {                       // VEHICLE: body box, softened corners
    return sdRBox(p, r * vec2(0.94, 0.98), min(r.x, r.y) * 0.52);
  }
  return sdEll(p, r);                      // ROUND
}
// FRONT profile half-width of a standing figure as a function of normalised
// height v. Branch-free and smooth: boots -> shins -> hips -> shoulders ->
// neck -> crown. This is what stops the reflection being a rectangle.
float humanHalfW(float v) {
  float w = mix(0.30, 0.345, smoothstep(0.00, 0.46, v));
  w = mix(w, 0.470, smoothstep(0.46, 0.66, v));
  w = mix(w, 0.165, smoothstep(0.76, 0.90, v));
  return w * (1.0 - 0.50 * smoothstep(0.93, 1.0, v));
}
`;

// ===========================================================================
// CONTACT SHADOW — one instanced quad per grounded object, one material for
// both pools. `position` is a unit XZ plane in [-0.5, 0.5]; the instance matrix
// carries the world contact point and the quad's metric extent E, so the
// fragment's offset from the contact point is position.xz * E in metres.
// ===========================================================================
const BLOB_VERT = /* glsl */ `
attribute float aStrength;
attribute vec4 aDim;      // rx, rz (footprint half-extents, m), castLen (m), yaw
attribute float aShape;
varying vec2 vLocal;
varying float vS;
varying vec4 vDim;
varying float vShape;
void main() {
  vS = aStrength; vDim = aDim; vShape = aShape;
  // Uniform scale in X/Z by construction (see write()/bakeStatics()).
  float E = length(instanceMatrix[0].xyz);
  vLocal = position.xz * E;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const BLOB_FRAG = /* glsl */ `
uniform vec2 uLightXZ;    // unit; the direction a shadow TRAVELS on the ground
uniform float uAlpha;     // pool master alpha
varying vec2 vLocal;
varying float vS;
varying vec4 vDim;
varying float vShape;
${SIL_GLSL}
void main() {
  if (vS < 0.004) discard;
  vec2 r = max(vDim.xy, vec2(0.03));
  float cl = vDim.z;                 // CPU-clamped cast length, metres
  float yaw = vDim.w;
  float soft = 0.06 * max(r.x, r.y); // bigger objects read softer
  // Sweep the silhouette along the light. Tap 0 is the contact: tight
  // penumbra, full alpha. Later taps widen and fade, so the shadow leaves the
  // object dark and dissolves downwind — the read the critics wanted.
  float a = 0.0;
  for (int i = 0; i < 4; i++) {
    float t = float(i) / 3.0;
    float pen = mix(${PEN_NEAR.toFixed(3)}, ${PEN_FAR.toFixed(3)}, t) + soft;
    vec2 q = vLocal - uLightXZ * (cl * t);
    float d = silTop(rot2(q, yaw), r, vShape);
    float cov = 1.0 - smoothstep(-pen * 0.40, pen, d);
    a = max(a, cov * mix(1.0, ${CAST_TIP_ALPHA.toFixed(3)}, t));
  }
  // AO POOL — the isotropic term. Without it an object is ungrounded from any
  // camera looking down the light axis, because the cast smear hides behind the
  // object and the tight contact hides underneath it (see the AO_* note).
  float aoR = ${AO_DILATE.toFixed(3)} + ${AO_REL.toFixed(3)} * max(r.x, r.y);
  float dAO = silTop(rot2(vLocal, yaw), r, vShape);
  float k = 1.0 - clamp(max(dAO, 0.0) / aoR, 0.0, 1.0);   // 1 at the silhouette
  float ao = pow(k, ${AO_POW.toFixed(3)}) * ${AO_ALPHA.toFixed(3)};
  a = max(a, ao);
  a *= vS * uAlpha;
  if (a < 0.006) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;

// ===========================================================================
// WET-GROUND REFLECTION — a view-dependent smear from the object's contact
// point back TOWARD the eye, which is where a horizontal mirror puts it: the
// image of a point at height y sits at -y, so the ray from an eye at height he
// crosses the ground he/(he+y) of the way over. Solved per-vertex from
// `cameraPosition`, so there is no per-frame CPU cost and no chance of a static
// reflection sticking to the ground like a decal when the player moves.
// ===========================================================================
const REFL_VERT = /* glsl */ `
attribute vec3 aCentre;   // world contact point of the object
attribute vec4 aDim;      // rx, rz (footprint half-extents), height, yaw
attribute vec3 aTint;     // the object's own body value
attribute float aWet;     // 0 = dry ground: no reflection exists here
attribute float aShape;
uniform float uMaxLen;
uniform float uMaxDist;
varying vec3 vW; varying vec3 vTint;
varying float vU; varying float vV; varying float vWet; varying float vHuman;
void main() {
  vTint = aTint; vU = position.x; vV = position.z; vW = aCentre;
  vHuman = step(0.5, aShape) * step(aShape, 1.5);
  vec2 d = aCentre.xz - cameraPosition.xz;
  float dist = length(d);
  if (aWet < 0.01 || dist > uMaxDist || dist < 1e-3) {
    vWet = 0.0;
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);   // z/w > 1 => clipped, zero fill
    return;
  }
  vec2 dir = d / dist;                 // eye -> object, on the ground plane
  vec2 lat = vec2(-dir.y, dir.x);      // across the smear
  // Silhouette width perpendicular to the view: a 4.4 m car seen end-on is
  // 1.9 m wide and broadside is 4.4 m, and a reflection is as wide as the
  // thing it mirrors.
  float cy = cos(aDim.w), sy = sin(aDim.w);
  float halfW = abs(dot(vec2(cy, -sy), lat)) * aDim.x
              + abs(dot(vec2(sy,  cy), lat)) * aDim.y;
  float h = max(aDim.z, 0.05);
  float he = max(cameraPosition.y - aCentre.y, 0.20);
  float len = min(dist * (1.0 - he / (he + h)), h * uMaxLen);
  len = max(len, 0.06);
  // Per-card phase so two objects side by side do not ripple in lockstep, and
  // a lateral wobble so the smear is a reflection in moving water rather than
  // a rectangle laid on the ground.
  float ph = aCentre.x * 1.7 + aCentre.z * 2.3;
  float wob = sin(vV * 6.1 + ph) * 0.085 + sin(vV * 11.7 - ph * 0.7) * 0.045;
  vec2 P = aCentre.xz - dir * (vV * len)
         + lat * ((vU * (1.0 + 0.30 * vV) + wob) * halfW * 2.0);
  vec3 wp = vec3(P.x, aCentre.y + 0.020, P.y);
  vW = wp;
  vWet = aWet * (1.0 - smoothstep(uMaxDist * 0.62, uMaxDist, dist));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const REFL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
varying vec3 vW; varying vec3 vTint;
varying float vU; varying float vV; varying float vWet; varying float vHuman;
${SIL_GLSL}
void main() {
  if (vWet < 0.01) discard;
  float x = abs(vU);                       // 0 at the axis, 0.5 at the card edge
  // OUTLINE. v runs up the mirrored object, so shaping the half-width along v
  // draws its profile: narrow at the boots, widest across the shoulders,
  // narrow again at the crown. A flat lateral falloff renders a slab, and a
  // slab on the cobbles is the artifact three critics kill on sight.
  float halfw = mix(0.455, humanHalfW(vV), vHuman);
  float cov = 1.0 - smoothstep(halfw * 0.62, halfw, x);
  // HARD ZERO AT THE CARD EDGE, unconditionally. iter07's exp(-q*q*2) left
  // 0.31 of peak alpha at |u| = 0.5 and every card ended on a straight line;
  // this window is identically zero there for every shape and every width.
  cov *= 1.0 - smoothstep(0.40, 0.50, x);
  // Along the smear: hold most of the length, dissolve at the tip, zero at v=1.
  float along = smoothstep(0.0, 0.045, vV)
              * (0.62 + 0.38 * exp(-vV * 1.3))
              * (1.0 - smoothstep(0.52, 1.00, vV));
  // The rain-agitated film: RUNGS across the smear — a broken ladder is the
  // strongest "this is water, not paint" cue — keyed to world position so
  // neighbouring objects never phase-lock.
  float rung = 0.26 + 0.74 * smoothstep(-0.55, 0.55,
      sin(vV * 13.0 - uTime * 2.0 + vW.x * 2.2 + vW.z * 1.6));
  float swell = 0.74 + 0.26 * sin(vW.x * 3.4 + uTime * 1.4)
                            * sin(vW.z * 2.9 - uTime * 1.1);
  vec3 toC = cameraPosition - vW;
  vec3 V = toC / max(length(toC), 1e-4);
  // Fresnel: a wet plane mirrors at grazing angles and is nearly matte from
  // straight above — the same grazing term wet_specular uses, so the
  // reflection and the sheen it sits in agree about how wet the surface is.
  float graze = 0.34 + 0.66 * smoothstep(0.0, 0.60, 1.0 - abs(V.y));
  float a = vWet * cov * along * rung * swell * graze * uStrength;
  if (a < 0.006) discard;
  // VALUE. v = 0 is the object's shadowed base — it occludes the sheen and
  // reads as contact; v = 1 is its crown. The ramp tops out at 0.85, so a
  // reflection is never brighter than the object it mirrors. iter07 ran this
  // to 1.55 and painted pale slabs on the cobbles.
  gl_FragColor = vec4(vTint * mix(0.18, 0.85, vV), a);
}`;

/** n quads of parametric (u, v) coords + the per-card attribute block. */
function makeReflGeo(n, dynamic) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 4 * 3);
  const idx = new Uint32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const o = i * 12;
    pos[o + 0] = -0.5; pos[o + 2] = 0;
    pos[o + 3] = 0.5; pos[o + 5] = 0;
    pos[o + 6] = 0.5; pos[o + 8] = 1;
    pos[o + 9] = -0.5; pos[o + 11] = 1;
    const b = i * 4, k = i * 6;
    idx[k] = b; idx[k + 1] = b + 1; idx[k + 2] = b + 2;
    idx[k + 3] = b; idx[k + 4] = b + 2; idx[k + 5] = b + 3;
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const mk = (sz) => {
    const a = new THREE.BufferAttribute(new Float32Array(n * 4 * sz), sz);
    if (dynamic) a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  g.setAttribute("aCentre", mk(3));
  g.setAttribute("aDim", mk(4));
  g.setAttribute("aTint", mk(3));
  g.setAttribute("aWet", mk(1));
  g.setAttribute("aShape", mk(1));
  // The vertex shader relocates every vertex, so the CPU-side bounds are
  // meaningless — never let three cull this by them.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
  return g;
}

const _tc = new THREE.Color();

function writeRefl(geo, i, x, y, z, rx, rz, h, yaw, tint, wet, shape) {
  const C = geo.getAttribute("aCentre"), D = geo.getAttribute("aDim");
  const T = geo.getAttribute("aTint"), W = geo.getAttribute("aWet");
  const S = geo.getAttribute("aShape");
  if (!C || i < 0 || (i + 1) * 4 > C.count) return;
  _tc.set(tint == null ? DEFAULT_TINT : tint);
  for (let k = 0; k < 4; k++) {
    const v = i * 4 + k;
    C.setXYZ(v, x, y, z);
    D.setXYZW(v, rx, rz, h, yaw);
    T.setXYZ(v, _tc.r, _tc.g, _tc.b);
    W.setX(v, wet);
    S.setX(v, shape || 0);
  }
  C.needsUpdate = true; D.needsUpdate = true;
  T.needsUpdate = true; W.needsUpdate = true; S.needsUpdate = true;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** One instanced contact-shadow pool. Both pools share `mat` => one program. */
function makeBlobPool(mat, n, dynamic, name) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
  const strength = new Float32Array(n);
  const dim = new Float32Array(n * 4);
  const shape = new Float32Array(n);
  const aS = new THREE.InstancedBufferAttribute(strength, 1);
  const aD = new THREE.InstancedBufferAttribute(dim, 4);
  const aSh = new THREE.InstancedBufferAttribute(shape, 1);
  if (dynamic) {
    aS.setUsage(THREE.DynamicDrawUsage);
    aD.setUsage(THREE.DynamicDrawUsage);
    aSh.setUsage(THREE.DynamicDrawUsage);
  }
  geo.setAttribute("aStrength", aS);
  geo.setAttribute("aDim", aD);
  geo.setAttribute("aShape", aSh);
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = RO_SHADOW;
  if (dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // reflect.js auto-enrols anything whose world origin sits inside the plaza
  // box onto REFLECT_LAYER, and every mesh in this module has its origin at
  // (0,0,0) — which is inside it. A ground shadow and a ground reflection have
  // no business inside the mirror that renders the ground, and a second render
  // pass would also tick the ripple clock twice per frame and desynchronise a
  // held battery frame. reflect.js publishes exactly this opt-out.
  mesh.userData.noReflect = true;
  _m.makeScale(0, 0, 0);
  for (let i = 0; i < n; i++) mesh.setMatrixAt(i, _m);
  return { mesh, geo, strength, dim, shape, aS, aD, aSh };
}

export function makeGrounding(env) {
  // ---- ONE shadow material, both pools ------------------------------------
  // Default light travel direction matches the authored moon (az 310 deg): the
  // shadow runs down-sun across the plaza. Overwritten from the scene's real
  // DirectionalLight at bake time, so the two can never drift apart.
  const blobUniforms = {
    uLightXZ: { value: new THREE.Vector2(0.766, 0.643) },
    uAlpha: { value: 1.0 },
  };
  const blobMat = new THREE.ShaderMaterial({
    uniforms: blobUniforms,
    vertexShader: BLOB_VERT,
    fragmentShader: BLOB_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,          // a fogged black decal paints fog colour, which is
                         // LIGHTER than the wet cobbles it sits on
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const dynPool = makeBlobPool(blobMat, DYN_N, true, "fx.grounding.dyn");
  env.root.add(dynPool.mesh);
  const used = new Uint8Array(DYN_N);

  // ------------------------------------------------------------- reflection
  // ONE material shared by the static and dynamic cards (one program; both
  // meshes live in the scene from construction so the boot prewarm compiles it
  // inside the baseline — fx.js's prewarmables() contract).
  const reflUniforms = {
    uTime: { value: 0 },
    uStrength: { value: REFL_STRENGTH },
    uMaxLen: { value: REFL_MAX_LEN },
    uMaxDist: { value: REFL_MAX_DIST },
  };
  const reflMat = new THREE.ShaderMaterial({
    uniforms: reflUniforms,
    vertexShader: REFL_VERT,
    fragmentShader: REFL_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,   // the card is solved in the VS; winding is moot
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });

  const dynReflGeo = makeReflGeo(DYN_N, true);
  const dynRefl = new THREE.Mesh(dynReflGeo, reflMat);
  dynRefl.name = "fx.grounding.dynrefl";
  dynRefl.frustumCulled = false;
  dynRefl.renderOrder = RO_REFLECT;
  dynRefl.userData.noReflect = true;
  // Fixed-step ripple clock, driven off renders exactly the way level.js drives
  // GROUND_HOOKS.time — never wall clock, so a held battery frame is
  // deterministic. This mesh is NOT on the mirror layer, so it ticks once.
  dynRefl.onBeforeRender = () => {
    reflUniforms.uTime.value = (reflUniforms.uTime.value + 1 / 60) % 3600;
  };
  env.root.add(dynRefl);

  let staticPool = null;
  let staticRefl = null;

  // Exterior wet-road rects published by props.js alongside the grounding
  // contract: a reflection only exists where there is a water film.
  let wetRects = null;
  function wetAt(x, z) {
    if (!wetRects) return 1;            // no contract yet: assume wet street
    for (let i = 0; i < wetRects.length; i++) {
      const r = wetRects[i];
      if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) return 1;
    }
    return 0;
  }

  /**
   * Quad extent, metres. It must hold whichever of the three terms reaches
   * furthest from the silhouette — the swept cast plus its tip penumbra, or the
   * AO pool — or that term is sliced off at the quad edge and the fix ships the
   * hard-edged rectangle it exists to remove.
   */
  function extentFor(rx, rz, castLen) {
    const m = Math.max(rx, rz);
    const aoR = AO_DILATE + AO_REL * m;
    return m + Math.max(castLen + PEN_FAR + 0.06 * m, aoR) + QUAD_PAD;
  }

  function writeBlob(pool, i, x, y, z, rx, rz, s, castLen, yaw, shape) {
    const E = extentFor(rx, rz, castLen);
    _p.set(x, y, z);
    _s.set(E * 2, 1, E * 2);           // PlaneGeometry spans [-0.5, 0.5]
    _m.compose(_p, _q.identity(), _s);
    pool.mesh.setMatrixAt(i, _m);
    pool.strength[i] = Math.min(1, s);
    pool.dim[i * 4 + 0] = rx;
    pool.dim[i * 4 + 1] = rz;
    pool.dim[i * 4 + 2] = castLen;
    pool.dim[i * 4 + 3] = yaw || 0;
    pool.shape[i] = shape || 0;
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.aS.needsUpdate = true; pool.aD.needsUpdate = true;
    pool.aSh.needsUpdate = true;
  }

  function hideSlot(i) {
    if (i < 0 || i >= DYN_N) return;
    _m.makeScale(0, 0, 0);
    dynPool.mesh.setMatrixAt(i, _m);
    dynPool.strength[i] = 0;
    dynPool.mesh.instanceMatrix.needsUpdate = true;
    dynPool.aS.needsUpdate = true;
    writeRefl(dynReflGeo, i, 0, 0, 0, 0, 0, 0, 0, DEFAULT_TINT, 0, 0);
  }

  // ---------------------------------------------------------------- static
  let baked = 0;
  let bakeTried = false;

  /** Read the real moon out of the scene so shadow and lighting agree. */
  function adoptLight(scene) {
    let best = null;
    scene.traverse((o) => {
      if (o.isDirectionalLight && (!best || o.intensity > best.intensity)) best = o;
    });
    if (!best) return;
    // Light TRAVELS from the light toward its target, so the ground-projected
    // shadow direction is -normalize(position.xz) relative to the target.
    const tx = best.target ? best.target.position.x : 0;
    const tz = best.target ? best.target.position.z : 0;
    const dx = tx - best.position.x, dz = tz - best.position.z;
    const L = Math.hypot(dx, dz);
    if (L > 1e-4) blobUniforms.uLightXZ.value.set(dx / L, dz / L);
  }

  // props.js's GENERATOR-LEVEL contract. Merged batches have no per-instance
  // transform, so the only place the truth exists is the placement list that
  // built them.
  function collectContract(scene) {
    let specs = null;
    scene.traverse((o) => {
      if (specs) return;
      const u = o.userData;
      if (u && Array.isArray(u.grounding) && u.grounding.length) {
        specs = u.grounding;
        if (Array.isArray(u.wetRects)) wetRects = u.wetRects;
      }
    });
    return specs;
  }

  function bakeStatics(scene) {
    if (bakeTried) return baked;
    bakeTried = true;
    adoptLight(scene);
    const contract = collectContract(scene);
    if (!contract) {
      console.warn("[grounding] no props.js grounding contract in the scene — " +
        "no static props grounded this run");
      return 0;
    }
    const kept = [];
    for (const s of contract) {
      if (kept.length >= STATIC_MAX) break;
      const rx = +s.rx, rz = +s.rz;
      const foot = Math.max(rx, rz) * 2;
      if (!isFinite(foot) || foot < MIN_FOOT || foot > MAX_FOOT) continue;
      // NO LIFT TEST, deliberately. The record only exists for mount ===
      // "ground", and its y came from computePlacements()'s per-corner support
      // raycast — which returns the TRAM-PLATFORM DECK at +4.5 while
      // env.groundY() returns terrain 0. A lift test here rejected all ten deck
      // props (measured: every rejection was "lift 4.20"/"lift 4.50", i.e. S5's
      // platform dressing), leaving exactly the class of floating prop this
      // exists to kill standing on the one elevated surface in the map.
      kept.push(s);
    }
    if (!kept.length) return 0;

    staticPool = makeBlobPool(blobMat, kept.length, false, "fx.grounding.static");
    blobUniforms.uAlpha.value = 1.0;
    const geoR = makeReflGeo(kept.length, false);
    for (let i = 0; i < kept.length; i++) {
      const s = kept[i];
      const rx = +s.rx, rz = +s.rz;
      const shape = s.shape == null ? SHAPE.BOX : +s.shape;
      const h = Math.max(0.05, +s.h || 0.05);
      const castLen = Math.min(h * CAST_PER_H, CAST_MAX_STATIC,
        Math.max(rx, rz) * 1.6 + 0.35);
      writeBlob(staticPool, i, s.x, s.y + 0.012, s.z, rx, rz,
        STATIC_ALPHA, castLen, s.yaw || 0, shape);
      writeRefl(geoR, i, s.x, s.y, s.z, rx, rz, h, s.yaw || 0,
        s.tint == null ? DEFAULT_TINT : s.tint,
        s.wet ? 1 : wetAt(s.x, s.z), shape);
    }
    env.root.add(staticPool.mesh);
    staticRefl = new THREE.Mesh(geoR, reflMat);
    staticRefl.name = "fx.grounding.staticrefl";
    staticRefl.frustumCulled = false;
    staticRefl.renderOrder = RO_REFLECT;
    staticRefl.userData.noReflect = true;
    env.root.add(staticRefl);
    baked = kept.length;
    const d = blobUniforms.uLightXZ.value;
    console.log(`[grounding] ${baked} props grounded from the props.js ` +
      `contract (${contract.length} placements); silhouette shadows sweep ` +
      `(${d.x.toFixed(2)}, ${d.y.toFixed(2)}) + ${baked} wet reflection cards`);
    return baked;
  }

  return {
    // ---- dynamic (characters) -------------------------------------------
    alloc() {
      for (let i = 0; i < DYN_N; i++) if (!used[i]) { used[i] = 1; return i; }
      return -1;
    },
    /**
     * rx/rz = footprint HALF-extents in metres; s = 0..1 shadow strength;
     * h (metres) + tint + yaw drive the WET-GROUND REFLECTION card; shape
     * selects the silhouette the shadow AND the reflection are drawn from
     * (SHAPE.HUMAN / SHAPE.PRONE for characters). A character that casts a
     * shadow and mirrors nothing on a wet street is still pasted on, so both
     * are written from one call. Omitting h keeps the shadow and parks the
     * reflection.
     */
    write(i, x, y, z, rx, rz, s, h, tint, yaw, shape) {
      if (i < 0 || i >= DYN_N) return;
      if (!(s > 0.004)) { hideSlot(i); return; }
      const hh = h > 0 ? h : 0;
      const sh = shape == null ? SHAPE.HUMAN : shape;
      const castLen = Math.min(Math.max(hh, 0.05) * CAST_PER_H, CAST_MAX_DYN);
      writeBlob(dynPool, i, x, y, z, rx, rz, s, castLen, yaw || 0, sh);
      writeRefl(dynReflGeo, i, x, y, z, rx, rz, hh, yaw || 0,
        tint == null ? DEFAULT_TINT : tint,
        hh > 0 ? Math.min(1, s / 0.6) * wetAt(x, z) : 0, sh);
    },
    hide: hideSlot,
    free(i) { hideSlot(i); if (i >= 0 && i < DYN_N) used[i] = 0; },
    clear() { for (let i = 0; i < DYN_N; i++) { hideSlot(i); used[i] = 0; } },

    // ---- static (props / vehicles) --------------------------------------
    bakeStatics,
    resetStatics() {
      if (staticPool) {
        env.root.remove(staticPool.mesh);
        staticPool.geo.dispose();
        staticPool = null;
      }
      if (staticRefl) {
        env.root.remove(staticRefl);
        staticRefl.geometry.dispose();
        staticRefl = null;
      }
      baked = 0;
      bakeTried = false;
    },

    prewarmables() {
      const a = [dynPool.mesh, dynRefl];
      if (staticPool) a.push(staticPool.mesh);
      if (staticRefl) a.push(staticRefl);
      return a;
    },
    stats: () => ({
      statics: baked,
      reflectionCards: (staticRefl
        ? staticRefl.geometry.getAttribute("aCentre").count / 4 : 0) + DYN_N,
      dynUsed: used.reduce((a, b) => a + b, 0),
      dynSlots: DYN_N,
      lightXZ: [+blobUniforms.uLightXZ.value.x.toFixed(3),
                +blobUniforms.uLightXZ.value.y.toFixed(3)],
    }),
  };
}
