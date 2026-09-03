/**
 * CRESTBOUND — runtime/player/hero.js
 * ---------------------------------------------------------------------------
 * NIM — the hero. CONTRACT §13.
 *
 *   export class Hero {
 *     constructor(scene, mats, quality);
 *     root;                      // THREE.Group at player.renderPos, rotation.y = facing
 *     update(dt, player);        // pose blend from player.anim/animT/vel/grounded
 *     setTheme(theme); setVisible(v); setPower(powerId|null);
 *     shadowBlob;                // soft radial plane, projected onto the ground below
 *   }
 *
 * ===========================================================================
 * DESIGN
 * ===========================================================================
 * Nim is a stylised explorer in the A-Hat-in-Time / Astro-Bot register: a big
 * round head (0.50 m across), a compact 0.55 m barrel of a coat, chunky boots
 * and mitten hands, goggles pushed up on the brow, a small pack with a rolled
 * blanket, and a long scarf that does all the secondary motion the skeleton
 * cannot. Total height 1.50 m — exactly `TUNE.height`, so the silhouette and
 * the collision capsule agree and the player can read their own clearance.
 *
 * Everything is procedural. There is no GLB, no image file and no naked
 * primitive anywhere: every visible part is a lathe of an authored profile, a
 * chamfered box from `builders.bevelBoxGeometry`, a tapered tube from
 * `builders.tubeGeometry`, or a merge of several of those. Parts that share a
 * material AND a bone are merged at construction, which is what keeps a fully
 * articulated character down to ~26 draw calls.
 *
 * ---------------------------------------------------------------------------
 * RIG
 * ---------------------------------------------------------------------------
 * A hierarchy of plain Object3Ds — no SkinnedMesh, no skinning cost, and every
 * bone is a real transform the harness can read:
 *
 *   root ──► rig ──► hips ──► spine ──► chest ──► neck ──► head ──► eyes/goggles
 *                      │                  ├─► shoulderR ─► upperArmR ─► lowerArmR ─► handR
 *                      │                  └─► shoulderL ─► upperArmL ─► lowerArmL ─► handL
 *                      ├─► upperLegR ─► lowerLegR ─► footR
 *                      └─► upperLegL ─► lowerLegL ─► footL
 *
 * `root` carries world position + facing (contract). `rig` carries everything
 * the ANIMATOR owns and the world must not see baked into facing: squash /
 * stretch scale, the flip rotations (somersault, backflip, cartwheel, pound
 * spin), the run bob and the lean. Splitting them means a somersault never
 * corrupts `root.rotation.y`, which other systems read.
 *
 * Bone convention: a limb's own axis runs down −Y, so a POSITIVE rotation about
 * X swings its tip toward −Z, i.e. FORWARD (yaw 0 faces −Z, contract §0). The
 * character's right is +X. This is asserted once here and assumed everywhere
 * below, so every pose number reads as "positive = forward".
 *
 * ---------------------------------------------------------------------------
 * ANIMATOR
 * ---------------------------------------------------------------------------
 * Two layers that never fight:
 *
 *  1. POSE — one writer per controller state (§11's list, all 31 of them) fills
 *     a flat table of per-bone Euler TARGETS. Every frame the rest pose is
 *     copied in first, so a writer only states what it actually changes.
 *     Targets are then integrated toward with an exponential (critically
 *     damped) smoother at 14 /s per bone, 18 /s for the root — the contract's
 *     numbers — which is what makes state changes read as a body accelerating
 *     rather than a puppet snapping.
 *
 *  2. CYCLES — procedural, phase-driven, layered on top of the pose. The run
 *     cycle is driven by DISTANCE TRAVELLED, not by time: stride 1.90 m at a
 *     full run, 1.10 m at a walk, interpolated by the analog speed. Feet
 *     therefore never skate — the contact phase is locked to ground motion at
 *     every stick magnitude, which is the single biggest tell between a
 *     hand-made platformer and a shipped one. On top: contra-rotating arm
 *     swing, hip sway with counter-rotating shoulders, a 2× head bob, lean into
 *     the turn from `player.leanX` and forward lean from normalised speed.
 *
 * Flips are NOT sprung — a somersault has to land on exactly one turn, so
 * `jump3` drives root pitch through +2π over its measured air time, `backflip`
 * through −2π, `sideflip` rolls a full cartwheel, and `poundHang` spins yaw 2π
 * inside its 0.20 s hang. They are written straight to the rig and then decay
 * out over the landing.
 *
 * Squash and stretch: 0.85 on landing, 1.12 leaving the ground, volume
 * preserved on XZ, sprung back at 13 /s.
 *
 * Feet plant: while grounded a two-bone analytic IK pulls each foot onto the
 * ground plane implied by `player.pos` + the ground normal, blended in by a
 * weight that falls to zero the moment the hero leaves the floor. Slopes get
 * an ankle roll so the boot sole lies flat instead of stabbing the hill.
 *
 * ---------------------------------------------------------------------------
 * SCARF
 * ---------------------------------------------------------------------------
 * A 7-link Verlet chain (8 particles) simulated in WORLD space so it carries
 * real inertia through a run, a flip and a wall kick. Forces: gravity,
 * air drag, a wind term derived from the hero's own velocity (so it streams
 * behind at speed and settles at rest) and a slow gust. Constraints, three
 * relaxation passes: segment length, and a sphere push-out around the chest so
 * it can never sink into the coat. The ribbon geometry is rebuilt in place into
 * a pre-allocated Float32Array — no allocation, no BufferGeometry churn.
 *
 * ---------------------------------------------------------------------------
 * SHADOW
 * ---------------------------------------------------------------------------
 * Nim casts a real shadow (castShadow on, receiveShadow off — a 1.5 m character
 * self-shadowing at this scale only ever produces acne), PLUS a contact blob:
 * a radial-alpha disc on a custom ShaderMaterial with depthWrite off, projected
 * by a single downward `world.broadphase.raycast` onto whatever is beneath, laid
 * on the surface normal, spreading and fading with altitude. The blob is what
 * makes a landing readable; the cast shadow is what makes the hero belong to the
 * scene. Both are needed.
 *
 * ---------------------------------------------------------------------------
 * PERFORMANCE
 * ---------------------------------------------------------------------------
 * `update()` performs ZERO heap allocation: every temporary is module scope,
 * the bone table is a fixed array of records, the Verlet state is two
 * Float32Arrays, and the shadow raycast writes into a reused result object.
 * Quality scales lathe/tube segment counts and the scarf's relaxation passes.
 *
 * @module runtime/player/hero
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bevelBoxGeometry, tubeGeometry, discGeometry } from '../world/builders.js';
// bevelBoxGeometry / tubeGeometry / discGeometry are the studio's shared
// vocabulary (world/builders.js). Everything they do not cover — a lathe of an
// authored profile, a tapered limb capsule — is built below in the SAME
// non-indexed {position, normal, uv} format so any combination can be merged.
import {
  clamp, clamp01, lerp, damp, dampAngle, smoothstep, mulberry32, numOr, TAU,
} from '../core/util.js';
import { TUNE } from '../core/tuning.js';

/* ═════════════════════════════════ constants ═════════════════════════════════ */

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Proportions, metres. Read as: feet on y = 0, crown at 1.50 m (= TUNE.height).
 * Head 0.50 m across and torso 0.55 m tall are the two numbers the silhouette
 * lives or dies by; everything else is derived so the joints land on them.
 */
const P = {
  hipY: 0.66,          // hips bone, world y at rest
  hipDrop: 0.04,       // leg sockets sit slightly below the hips bone
  spineY: 0.10,        // spine   local +y from hips
  chestY: 0.18,        // chest   local +y from spine   -> world 0.94
  neckY: 0.16,         // neck    local +y from chest   -> world 1.10
  headY: 0.12,         // head    local +y from neck    -> world 1.22
  headR: 0.250,        // head radius -> crown 1.47, hair tuft to ~1.52
  torsoR: 0.205,       // coat half-width at the chest
  waistR: 0.170,
  shoulderX: 0.185,
  shoulderY: 0.055,
  upperArm: 0.215,
  lowerArm: 0.195,
  handLen: 0.105,
  legX: 0.112,
  upperLeg: 0.245,
  lowerLeg: 0.215,
  ankleY: 0.160,       // boot top / ankle joint
  bootH: 0.160,
  bootL: 0.300,
  bootW: 0.170,
};

/** Stride lengths (metres of ground travel per FULL cycle). Contract §13. */
const STRIDE_RUN = 1.90;
const STRIDE_WALK = 1.10;

/** Blend rates — the contract's critically-damped spring constants. */
const BONE_LAMBDA = 14;
const ROOT_LAMBDA = 18;
const SQUASH_LAMBDA = 13;

/** Squash / stretch extremes. */
const SQUASH_LAND = 0.85;
const STRETCH_JUMP = 1.12;

/**
 * Height of the rig's ROTATION pivot above the soles, metres. Every flip, lean
 * and topple turns about this point — the hips (`P.hipY` 0.66 less the small
 * drop to the joint) — not about the feet. See `_applyRoot`.
 */
const RIG_PIVOT_Y = 0.62;

/**
 * Boot sole contact points, foot-local metres from the ankle. These are the
 * geometry the sole clamp measures — keep them in step with _buildLegs().
 */
const SOLE_TOE_Z = 0.185;
const SOLE_HEEL_Z = 0.100;

/**
 * Eye placement, HEAD-LOCAL metres. The eyes are SPHERES sunk into the skull
 * (centre inside the surface) rather than the flat 0.124 m discs the face audit
 * found stuck on the front of the face: with `EYE_R` 0.046 and the centre
 * 0.196 m out, the skull crops them to a ~0.056 m visible cap, which is a
 * stylised eye set in a socket instead of a googly eye glued on.
 */
const EYE_X = 0.075;
const EYE_Y = 0.010;
const EYE_Z = -0.185;
const EYE_R = 0.058;

/** Idle "look around" fires after this many seconds of standing still. */
const IDLE_LOOK_AFTER = 4.0;

/** Blink cadence, seconds. */
const BLINK_MIN = 3.0;
const BLINK_MAX = 5.0;
const BLINK_TIME = 0.13;

/** Scarf. */
const SCARF_LINKS = 7;                 // contract: 7 links => 8 particles
const SCARF_SEG = 0.105;               // metres per link -> ~0.74 m of scarf
const SCARF_GRAVITY = -15.5;
const SCARF_DAMP = 0.965;              // velocity retention per Verlet step
const SCARF_WIND = 0.115;              // how hard the hero's own velocity drags it
const SCARF_BODY_R = 0.255;            // sphere the scarf may never enter
const SCARF_W0 = 0.088;                // ribbon half-width at the collar
const SCARF_W1 = 0.046;                // ...and at the tip

/** Palette. The coat is the read-at-40-m silhouette colour; keep it hot. */
const COL = {
  coat: 0xd8532b,        // warm orange-red
  coatDark: 0xa63a1c,    // shadowed panels / under-flap
  trim: 0x2c4a52,        // dark teal — mittens, collar, cuffs, knee caps
  skin: 0xf3cba4,
  skinShade: 0xe0ae86,
  hair: 0x4a2f22,
  boot: 0x37312e,
  leather: 0x7a5233,
  rope: 0xc7ab7a,
  metal: 0xb9c2cb,
  lens: 0x9fe8ff,
  eyeWhite: 0xf7f1e6,
  eyePupil: 0x161b22,
  blanket: 0xcfd6c8,
  buckle: 0xd8b25c,
};

/** Scarf tint per realm — the one piece of Nim that changes with the world. */
const SCARF_TINT = {
  keep: 0xf0d9a8,
  verdant: 0xd53a2c,
  ember: 0xffc23a,
  rime: 0x92dcff,
  azure: 0x7fe3d4,
};
const SCARF_DEFAULT = 0xd53a2c;

/** Fallback PBR for every material key, used when Mats cannot answer. */
const MAT_FALLBACK = {
  cloth: { color: 0xffffff, roughness: 0.92, metalness: 0.0 },
  rubber: { color: 0xffffff, roughness: 0.78, metalness: 0.0 },
  metal: { color: 0xffffff, roughness: 0.30, metalness: 0.92 },
  glass: { color: 0xffffff, roughness: 0.08, metalness: 0.0 },
  wood: { color: 0xffffff, roughness: 0.80, metalness: 0.0 },
  rope: { color: 0xffffff, roughness: 0.95, metalness: 0.0 },
  plaster: { color: 0xffffff, roughness: 0.88, metalness: 0.0 },
  gold: { color: 0xffffff, roughness: 0.28, metalness: 0.95 },
  emissive: { color: 0xffffff, roughness: 1.0, metalness: 0.0 },
};

/**
 * The size in METRES of the hero part each material dresses. This is half of
 * the texel-scale contract: a world texture is baked for a fixed
 * tiles-per-metre (`texture.repeat`, e.g. plaster 0.30 = one 3.3 m crack
 * network per tile), hero UVs run 0..1 across a part, so the ONLY repeat that
 * shows the pattern at world scale on a part `L` metres across is
 * `L × sourceTilesPerMetre`. Hand-picking 1..4 here is what stretched a 3.3 m
 * wall-crack network across a 0.50 m skull. Keep these in step with the
 * geometry builders below (and with _harness/heromatcheck.py's PART_SIZE).
 */
const PART_M = {
  coat: 0.58, coatDark: 0.58, trim: 0.20, scarf: 0.74,
  skin: 0.50, hair: 0.30, boot: 0.30, metal: 0.16, gold: 0.05,
  leather: 0.24, rope: 0.30, blanket: 0.23, lens: 0.10,
  eyeWhite: 0.12, eyeDark: 0.06,
};

/** Bone table order. Index-addressable so the update loop never allocates. */
const BONE_NAMES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderR', 'upperArmR', 'lowerArmR', 'handR',
  'shoulderL', 'upperArmL', 'lowerArmL', 'handL',
  'upperLegR', 'lowerLegR', 'footR',
  'upperLegL', 'lowerLegL', 'footL',
];

/* ═════════════════════════════════ scratch ═════════════════════════════════ */
/* Module scope. Nothing in update() may allocate — the profiler is watching.  */

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _col0 = new THREE.Color();
const _col1 = new THREE.Color();

/** Reused raycast result for the contact blob (Broadphase.raycast writes here). */
const _rayHit = {
  t: 0,
  normal: new THREE.Vector3(0, 1, 0),
  point: new THREE.Vector3(),
  collider: null,
  heightfield: null,
};

/** Two-bone IK output. One shared record — read it before the next solve. */
const _ik = { hip: 0, knee: 0, reached: false };

/* ═══════════════════════════ geometry primitives ═══════════════════════════ */
/*
 * `builders.js` owns the world's geometry vocabulary and every one of its
 * helpers emits NON-INDEXED {position, normal, uv}, which is what makes any
 * combination legal for `mergeGeometries`. The two shapes a character needs
 * that a platform never does — a lathe of an authored profile and a capsule —
 * are built here in the same format so hero parts merge with builder parts.
 */

/**
 * Revolve a 2D profile around +Y. `pts` is [[radius, y], …] bottom-to-top; a
 * radius of 0 caps the end with a fan. Emits non-indexed pos/normal/uv, with
 * V running along the profile and U around the revolution.
 *
 * @param {Array<Array<number>>} pts
 * @param {number} seg radial segments
 * @returns {THREE.BufferGeometry}
 */
function latheGeo(pts, seg) {
  const s = Math.max(4, seg | 0);
  const n = pts.length;
  const pos = [];
  const nor = [];
  const uv = [];

  // profile normals: perpendicular to each segment in the (r, y) plane,
  // averaged at the shared vertices so the silhouette shades smoothly.
  const pn = new Array(n);
  for (let i = 0; i < n; i++) pn[i] = [0, 0];
  for (let i = 0; i < n - 1; i++) {
    const dr = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dr, dy) || 1;
    const nr = dy / l, ny = -dr / l;      // rotate the tangent +90° outward
    pn[i][0] += nr; pn[i][1] += ny;
    pn[i + 1][0] += nr; pn[i + 1][1] += ny;
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(pn[i][0], pn[i][1]) || 1;
    pn[i][0] /= l; pn[i][1] /= l;
  }

  // total profile length for a proportional V coordinate
  let total = 0;
  const vAt = new Array(n);
  vAt[0] = 0;
  for (let i = 1; i < n; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    vAt[i] = total;
  }
  if (total > 1e-6) for (let i = 0; i < n; i++) vAt[i] /= total;

  const push = (r, y, nr, ny, a, u, v) => {
    const c = Math.cos(a), si = Math.sin(a);
    pos.push(c * r, y, si * r);
    const nl = Math.hypot(nr, ny) || 1;
    nor.push((c * nr) / nl, ny / nl, (si * nr) / nl);
    uv.push(u, v);
  };

  for (let i = 0; i < s; i++) {
    const a0 = (i / s) * TAU;
    const a1 = ((i + 1) / s) * TAU;
    const u0 = i / s, u1 = (i + 1) / s;
    for (let j = 0; j < n - 1; j++) {
      const r0 = pts[j][0], y0 = pts[j][1];
      const r1 = pts[j + 1][0], y1 = pts[j + 1][1];
      const v0 = vAt[j], v1 = vAt[j + 1];
      if (r0 < 1e-5 && r1 < 1e-5) continue;
      if (r0 < 1e-5) {
        // bottom cap fan
        push(0, y0, pn[j][0], pn[j][1], a0, u0, v0);
        push(r1, y1, pn[j + 1][0], pn[j + 1][1], a1, u1, v1);
        push(r1, y1, pn[j + 1][0], pn[j + 1][1], a0, u0, v1);
        continue;
      }
      if (r1 < 1e-5) {
        // top cap fan
        push(r0, y0, pn[j][0], pn[j][1], a0, u0, v0);
        push(r0, y0, pn[j][0], pn[j][1], a1, u1, v0);
        push(0, y1, pn[j + 1][0], pn[j + 1][1], a0, u0, v1);
        continue;
      }
      // quad -> two triangles, wound CCW seen from outside
      push(r0, y0, pn[j][0], pn[j][1], a0, u0, v0);
      push(r0, y0, pn[j][0], pn[j][1], a1, u1, v0);
      push(r1, y1, pn[j + 1][0], pn[j + 1][1], a1, u1, v1);

      push(r0, y0, pn[j][0], pn[j][1], a0, u0, v0);
      push(r1, y1, pn[j + 1][0], pn[j + 1][1], a1, u1, v1);
      push(r1, y1, pn[j + 1][0], pn[j + 1][1], a0, u0, v1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/**
 * Capsule as a lathe profile — a limb, not a pill: `rTop`/`rBot` taper so an
 * upper arm reads thicker at the shoulder. Origin at the TOP of the shaft so a
 * bone can own it directly (limbs run down −Y).
 */
function limbGeo(rTop, rBot, len, seg, rings) {
  const rr = Math.max(3, rings | 0);
  const pts = [];
  // bottom hemisphere
  for (let i = rr; i >= 1; i--) {
    const a = (i / rr) * Math.PI * 0.5;
    pts.push([rBot * Math.sin(a), -len - rBot * Math.cos(a)]);
  }
  pts.push([rBot, -len]);
  pts.push([rTop, 0]);
  // top hemisphere
  for (let i = 1; i <= rr; i++) {
    const a = (i / rr) * Math.PI * 0.5;
    pts.push([rTop * Math.cos(a), rTop * Math.sin(a)]);
  }
  // profile runs bottom-to-top already
  return latheGeo(pts, seg);
}

/** Translate/rotate/scale a geometry in place (construction-time only). */
function place(g, x, y, z, rx, ry, rz, sx, sy, sz) {
  if (sx !== undefined) {
    g.scale(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz);
  }
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  if (x || y || z) g.translate(x || 0, y || 0, z || 0);
  return g;
}

/** Merge a list of geometries, disposing the inputs. Returns null if empty. */
function mergeAll(list) {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const out = mergeGeometries(list, false);
  if (out) for (let i = 0; i < list.length; i++) list[i].dispose();
  return out || list[0];
}

/* ═══════════════════════════════ materials ═══════════════════════════════ */

/**
 * Build a hero material from the shared library WITHOUT inheriting its
 * world-space box projection (which would swim across a moving character) and
 * without sharing its instance (the hero needs its own opacity for `heroFade`,
 * the vanish power and the metal swap).
 *
 * THREE RULES, all three learned from a material audit that scored Nim 2/10:
 *
 *  1. NEVER TINT THROUGH THE WORLD ALBEDO. three multiplies `color × map`, and
 *     a world albedo is a *dyed* fabric/plaster/leaf image, not a white base:
 *     the library's `cloth` mean is (0.12, 0.19, 0.22) dark teal, so an
 *     authored coat of #d8532b rendered as #190f09 — 6 % of its luminance,
 *     hue gone. The map is therefore rebuilt as a NEUTRAL VALUE map
 *     (`detailTex`): the same weave/grain/wear signal, greyscale, normalised
 *     about its own mean, so `color` survives exactly and the texture reads as
 *     shading rather than as dye. The library's normal and roughness maps are
 *     carried over untouched — they never tinted anything.
 *
 *  2. TEXEL SCALE COMES FROM THE PART, NOT FROM A HAND-PICKED NUMBER.
 *     `opts.size` is the part's size in metres; the repeat is
 *     `size × sourceTilesPerMetre`, which puts the pattern on Nim at exactly
 *     the size it is on the world. See PART_M.
 *
 *  3. THE MATERIAL CLASS FOLLOWS THE SOURCE. If the library baked this key as
 *     MeshPhysicalMaterial (cloth's sheen lobe, glass's clearcoat) the hero
 *     gets a physical material and inherits those lobes, so cloth reads as
 *     cloth and glass as glass instead of everything reading as one plastic.
 *     TRANSMISSION IS THE ONE THING NOT INHERITED: it makes the renderer draw
 *     the whole scene a second time into the transmission target — measured on
 *     verdant-1 at 871 draws vs 437 (materials.js `transmissionToAlpha`) — so
 *     the hero copies the world's own choice, alpha + clearcoat + envMap.
 *
 * @param {object} mats  the Mats singleton (or null)
 * @param {string} key   material key (contract §14)
 * @param {string} themeId
 * @param {object} opts  {color, roughness, metalness, emissive, emissiveIntensity,
 *                        size, detail, transparent, opacity, side, flatShading,
 *                        sheen, clearcoat, …}
 * @returns {THREE.MeshStandardMaterial|THREE.MeshPhysicalMaterial}
 */
function deriveMaterial(mats, key, themeId, opts) {
  const o = opts || {};
  let src = null;
  try {
    if (mats && typeof mats.get === 'function') src = mats.get(key, themeId);
  } catch (e) { src = null; }

  const fb = MAT_FALLBACK[key] || MAT_FALLBACK.cloth;
  const def = {
    color: o.color !== undefined ? o.color : fb.color,
    roughness: o.roughness !== undefined ? o.roughness : (src ? src.roughness : fb.roughness),
    metalness: o.metalness !== undefined ? o.metalness : (src ? src.metalness : fb.metalness),
  };
  const physical = !!(o.physical || (src && src.isMeshPhysicalMaterial));
  const m = physical ? new THREE.MeshPhysicalMaterial(def) : new THREE.MeshStandardMaterial(def);

  // ---- texel scale: part metres × the source's own tiles-per-metre ---------
  const size = numOr(o.size, 0.3);
  const srcRep = (src && src.map && src.map.repeat && src.map.repeat.x) || 1;
  const rep = clamp(size * srcRep, 0.02, 8);

  if (src) {
    // albedo -> neutral detail (rule 1). If the canvas cannot be read back
    // (tainted / DataTexture / no 2D context) we ship NO albedo map rather
    // than a map that would eat the authored colour.
    if (src.map) m.map = detailTex(src.map, rep, numOr(o.detail, 0.55));
    if (src.normalMap) {
      m.normalMap = cloneTex(src.normalMap, rep);
      m.normalScale.set(numOr(o.normalScale, 0.7), numOr(o.normalScale, 0.7));
    }
    if (src.roughnessMap) m.roughnessMap = cloneTex(src.roughnessMap, rep);
    if (src.metalnessMap) m.metalnessMap = m.roughnessMap || cloneTex(src.metalnessMap, rep);
    m.envMapIntensity = numOr(o.envMapIntensity, numOr(src.envMapIntensity, 1));

    // rule 3: inherit the source's surface LOBES (never its transmission)
    if (physical) {
      if (src.isMeshPhysicalMaterial) {
        if (src.sheen) {
          m.sheen = src.sheen;
          m.sheenRoughness = src.sheenRoughness;
          if (src.sheenColor) m.sheenColor.copy(src.sheenColor);
        }
        if (src.clearcoat) { m.clearcoat = src.clearcoat; m.clearcoatRoughness = src.clearcoatRoughness; }
        m.specularIntensity = src.specularIntensity;
        m.ior = src.ior;
      }
      if (o.sheen !== undefined) m.sheen = o.sheen;
      if (o.sheenRoughness !== undefined) m.sheenRoughness = o.sheenRoughness;
      if (o.sheenColor !== undefined) m.sheenColor.set(o.sheenColor);
      if (o.clearcoat !== undefined) m.clearcoat = o.clearcoat;
      if (o.clearcoatRoughness !== undefined) m.clearcoatRoughness = o.clearcoatRoughness;
      if (o.specularIntensity !== undefined) m.specularIntensity = o.specularIntensity;
      if (o.ior !== undefined) m.ior = o.ior;
    }
  }

  if (o.emissive !== undefined) {
    m.emissive = new THREE.Color(o.emissive);
    m.emissiveIntensity = o.emissiveIntensity === undefined ? 1 : o.emissiveIntensity;
  }
  if (o.transparent) { m.transparent = true; m.opacity = o.opacity === undefined ? 1 : o.opacity; }
  if (o.side !== undefined) m.side = o.side;
  if (o.flatShading) m.flatShading = true;
  if (o.depthWrite !== undefined) m.depthWrite = o.depthWrite;

  m.name = 'nim.' + key;
  m.userData.nimKey = key;
  m.userData.baseOpacity = m.opacity;
  m.userData.baseColor = m.color.getHex();
  return m;
}

const _texClones = new Map();
const _texDetail = new Map();

/** Clone a library texture once per (texture, repeat) and cache it. */
function cloneTex(t, repeat) {
  if (!t) return null;
  const id = (t.uuid || 'x') + '|' + repeat.toFixed(3);
  let c = _texClones.get(id);
  if (c) return c;
  c = t.clone();
  c.wrapS = THREE.RepeatWrapping;
  c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(repeat, repeat);
  c.needsUpdate = true;
  _texClones.set(id, c);
  return c;
}

/** Scratch canvas for the albedo readback. Construction-time only. */
let _detailCv = null;
let _detailCtx = null;

/**
 * Turn a world ALBEDO map into a neutral DETAIL map: greyscale, normalised so
 * its mean sits at `DETAIL_BASE`, with the deviation from that mean scaled by
 * `strength`. Multiplying an authored colour by this preserves the hue and
 * ~86 % of the luminance while keeping every weave, crack and wear mark the
 * bake produced.
 *
 * Built once per (texture, repeat, strength) at construction; the pixels are
 * never touched again. Returns null when the source cannot be read back, and
 * `deriveMaterial` then ships no albedo map at all — a flat authored colour is
 * a far smaller error than a destroyed one.
 */
/*
 * `DETAIL_BASE` is the sRGB grey the source's MEAN maps to, i.e. the albedo
 * multiplier Nim's authored palette is rendered through. It is calibrated, not
 * picked: the one hero material that was correctly exposed before this pass was
 * the skin, whose `plaster` albedo mean was 0.72 sRGB (~0.48 linear) — a
 * daylight-lit face at verdant's key 3.15 / exposure 1.06 sat just under clip
 * at that multiplier. 0.74 puts skin back exactly where it read right and lands
 * the coat's #d8532b at ~0.33 linear red: a rich orange that survives the sun
 * instead of a white blob. A neutral 1.0 base blows every sunlit panel out.
 */
const DETAIL_BASE = 0.74;     // sRGB grey the mean maps to  (~0.50 linear)
const DETAIL_N = 128;         // detail maps do not need the source's resolution

function detailTex(src, repeat, strength) {
  if (!src) return null;
  const id = (src.uuid || 'x') + '|' + repeat.toFixed(3) + '|' + strength.toFixed(2);
  const hit = _texDetail.get(id);
  if (hit !== undefined) return hit;

  let out = null;
  try {
    const img = src.image || (src.source && src.source.data);
    if (img && (img.width || 0) > 0) {
      if (!_detailCv) {
        _detailCv = document.createElement('canvas');
        _detailCv.width = DETAIL_N; _detailCv.height = DETAIL_N;
        _detailCtx = _detailCv.getContext('2d', { willReadFrequently: true });
      }
      const ctx = _detailCtx;
      ctx.clearRect(0, 0, DETAIL_N, DETAIL_N);
      ctx.drawImage(img, 0, 0, DETAIL_N, DETAIL_N);
      const id2 = ctx.getImageData(0, 0, DETAIL_N, DETAIL_N);
      const d = id2.data;

      // mean luminance of the source, in the space the pixels are stored in
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.30 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      const mean = Math.max(1, sum / (d.length / 4));

      const base = DETAIL_BASE * 255;
      for (let i = 0; i < d.length; i += 4) {
        const lum = d[i] * 0.30 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
        // ratio about the mean, softened, clamped so no texel can go black
        const r = 1 + (lum / mean - 1) * strength;
        const v = clamp(base * r, base * 0.58, 255);
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
      }
      ctx.putImageData(id2, 0, 0);

      // a fresh canvas per texture: CanvasTexture keeps a reference to it
      const cv = document.createElement('canvas');
      cv.width = DETAIL_N; cv.height = DETAIL_N;
      cv.getContext('2d').drawImage(_detailCv, 0, 0);

      out = new THREE.CanvasTexture(cv);
      out.name = (src.name || 'tex') + '.nimDetail';
      out.colorSpace = THREE.SRGBColorSpace;
      out.wrapS = THREE.RepeatWrapping;
      out.wrapT = THREE.RepeatWrapping;
      out.anisotropy = src.anisotropy || 1;
      out.generateMipmaps = true;
      out.minFilter = THREE.LinearMipmapLinearFilter;
      out.magFilter = THREE.LinearFilter;
      out.repeat.set(repeat, repeat);
      out.needsUpdate = true;
    }
  } catch (e) { out = null; }

  _texDetail.set(id, out);
  return out;
}

/* ═══════════════════════════════ shadow blob ═══════════════════════════════ */

const BLOB_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BLOB_FRAG = /* glsl */`
uniform vec3  uColor;
uniform float uOpacity;
uniform float uSoft;     // 0 = hard disc, 1 = pure gradient
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  float r = clamp(length(d) * 2.0, 0.0, 1.0);
  // two-lobe falloff: a dense core under the feet, a soft ambient skirt.
  float core = 1.0 - smoothstep(0.0, mix(0.55, 0.95, uSoft), r);
  float skirt = 1.0 - smoothstep(0.0, 1.0, r);
  float a = (core * 0.72 + skirt * 0.45) * uOpacity;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

/**
 * The contact shadow: a radial-alpha disc laid on whatever is beneath Nim.
 * Its whole job is to answer "where will I land" one frame before the player
 * asks, so it is projected by a real raycast and never a fixed plane.
 */
class ShadowBlob {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [opts] {radius, maxDist, opacity, color}
   */
  constructor(scene, opts) {
    const o = opts || {};
    this.scene = scene;
    this.radius = numOr(o.radius, 0.46);
    this.maxDist = numOr(o.maxDist, 7.0);
    this.maxOpacity = numOr(o.opacity, 0.60);

    this.geo = discGeometry(1, 32);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(o.color === undefined ? 0x05070c : o.color) },
        uOpacity: { value: 0 },
        uSoft: { value: 0.25 },
      },
      vertexShader: BLOB_VERT,
      fragmentShader: BLOB_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });

    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'nim.shadowBlob';
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this._visible = true;
    this._op = 0;
    this._scale = this.radius * 2;
    this._hit = false;
  }

  setTheme(theme) {
    // A cold blue hole under a hero standing in a furnace reads as a bug. Tint
    // the blob toward the theme's own fog so it sits in the same light.
    const fog = theme && theme.fog && theme.fog.color;
    if (fog !== undefined && fog !== null) {
      _col0.set(fog);
      this.mat.uniforms.uColor.value.copy(_col0).multiplyScalar(0.13);
    } else {
      this.mat.uniforms.uColor.value.set(0x05070c);
    }
  }

  setVisible(v) {
    this._visible = !!v;
    if (!this._visible) this.mesh.visible = false;
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} pos  hero feet, world
   * @param {object|null} world  {broadphase}
   * @param {number} scale       radius multiplier (squash widens the blob)
   */
  update(dt, pos, world, scale) {
    if (!this._visible) { this.mesh.visible = false; return; }
    const bp = world && world.broadphase;

    this._hit = false;
    if (bp && typeof bp.raycast === 'function') {
      _v0.set(pos.x, pos.y + 0.30, pos.z);
      try {
        this._hit = !!bp.raycast(_v0, DOWN, this.maxDist + 0.4, _rayHit);
      } catch (e) { this._hit = false; }
    }

    if (!this._hit) {
      this._op = damp(this._op, 0, 14, dt);
      if (this._op < 0.004) { this.mesh.visible = false; return; }
      this.mat.uniforms.uOpacity.value = this._op;
      return;
    }

    // Where the ray met the world, and how far above it we are.
    const gy = pos.y + 0.30 - _rayHit.t;
    const n = _rayHit.normal;
    const dist = Math.max(0, pos.y - gy);
    const t = clamp01(dist / this.maxDist);
    const fade = 1 - smoothstep(0, 1, t);

    const wantScale = this.radius * 2 * (1 + t * 1.45) * (scale || 1);
    const wantOp = this.maxOpacity * fade * fade;

    this._scale = damp(this._scale, wantScale, 16, dt);
    this._op = damp(this._op, wantOp, 16, dt);
    this.mat.uniforms.uSoft.value = 0.20 + t * 0.65;

    if (this._op < 0.004) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    this.mat.uniforms.uOpacity.value = this._op;

    // Lift a hair along the surface normal — z-fighting on a shadow reads as
    // strobing, which is worse than no shadow at all.
    this.mesh.position.set(pos.x + n.x * 0.022, gy + n.y * 0.022, pos.z + n.z * 0.022);
    _q0.setFromUnitVectors(UP, n);
    this.mesh.quaternion.copy(_q0);
    this.mesh.scale.set(this._scale, 1, this._scale);
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* ═══════════════════════════════ two-bone IK ═══════════════════════════════ */

/**
 * Analytic two-bone solve in the sagittal plane. `dy` is how far the target is
 * BELOW the hip socket, `fz` how far FORWARD of it (both metres, hip-local).
 * Writes `_ik` = {hip, knee} as bone-local X rotations under this file's
 * convention (positive X = tip forward, knee flexes negative).
 */
function solveLeg(dy, fz, l1, l2) {
  const dmin = Math.abs(l1 - l2) + 1e-3;
  const dmax = l1 + l2 - 1e-3;
  let d = Math.hypot(dy, fz);
  _ik.reached = d <= dmax;
  d = clamp(d, dmin, dmax);

  const base = Math.atan2(fz, Math.max(1e-4, dy));
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const cosB = clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1);

  _ik.hip = base + Math.acos(cosA);
  _ik.knee = -(Math.PI - Math.acos(cosB));
  return _ik;
}

/* ═══════════════════════════════════ Hero ═══════════════════════════════════ */

/**
 * The parts whose shadow IS Nim's silhouette.  Everything else on him is trim:
 * the shadow map is a second full draw of every caster, and a cuff, a goggle
 * lens or a pack clasp adds a few texels to a 1.5 m character's shadow for a
 * whole extra draw call each.  See Hero._attach.
 */
const HERO_SHADOW_PARTS = new Set([
  'coat', 'coatDark', 'head', 'hair', 'pack', 'bootL', 'bootR',
  'sleeveUL', 'sleeveUR', 'shinL', 'shinR', 'mittenL', 'mittenR',
]);

export class Hero {
  /**
   * @param {THREE.Scene} scene
   * @param {object} mats   the Mats singleton from world/materials.js
   * @param {string|object} quality 'low'|'medium'|'high'|'ultra' or a QUALITY record
   */
  constructor(scene, mats, quality) {
    this.scene = scene;
    this.mats = mats || null;
    this.quality = quality || 'high';
    this.q = Hero._qLevel(quality);          // 0..3

    this.themeId = 'keep';
    this.theme = null;
    this.visible = true;
    this.power = null;

    /** @type {THREE.Group} world transform: position = feet, rotation.y = facing */
    this.root = new THREE.Group();
    this.root.name = 'nim.root';
    this.root.matrixAutoUpdate = true;

    /** Animator-owned transform: squash/stretch, flips, bob, lean. */
    this.rig = new THREE.Object3D();
    this.rig.name = 'nim.rig';
    this.root.add(this.rig);

    // ---- rig -------------------------------------------------------------
    /** @type {Object<string, THREE.Object3D>} */
    this.bones = Object.create(null);
    /** flat, index-addressable bone records — the update loop's hot array */
    this._bones = [];
    this._buildSkeleton();

    // ---- materials -------------------------------------------------------
    this._mats = [];                 // every hero material, for fade / power / dispose
    this._geos = [];                 // every geometry, for dispose
    this._buildMaterials();

    // ---- meshes ----------------------------------------------------------
    this._meshes = [];
    this._buildBody();
    this._buildHead();
    this._buildArms();
    this._buildLegs();
    this._buildPack();
    this._buildWings();

    // ---- scarf (Verlet, world space) -------------------------------------
    this._scarfP = new Float32Array((SCARF_LINKS + 1) * 3);
    this._scarfPrev = new Float32Array((SCARF_LINKS + 1) * 3);
    this._scarfInit = false;
    this._buildScarf();

    // ---- shadow ----------------------------------------------------------
    this.shadowBlob = new ShadowBlob(scene, { radius: 0.46, maxDist: 7.0, opacity: 0.60 });

    // ---- animator state --------------------------------------------------
    this._anim = 'idle';
    this._prevAnim = 'idle';
    this._animT = 0;
    this._dist = 0;             // ground distance travelled (drives the run cycle)
    this._phase = 0;            // run cycle phase, radians
    this._speed = 0;
    this._speedN = 0;           // speed / speedRun, 0..1
    this._lean = 0;
    this._leanTgt = 0;
    this._grounded = true;
    this._prevGrounded = true;
    this._airT = 0;
    this._lastAirT = 0.5;
    this._idleT = 0;
    this._lookYaw = 0;
    this._lookPitch = 0;
    this._breathe = 0;

    this._squash = 1;
    this._squashTgt = 1;

    // flips are driven, not sprung — see the header
    this._flipPitch = 0;
    this._flipRoll = 0;
    this._flipYaw = 0;
    this._flipDecay = 0;

    this._rootPitch = 0;
    this._rootRoll = 0;
    this._rootYaw = 0;
    this._rootY = 0;
    this._rootZ = 0;

    this._ikW = 0;              // foot-plant IK blend weight
    this._groundN = new THREE.Vector3(0, 1, 0);

    this._blinkT = BLINK_MIN + Math.random() * (BLINK_MAX - BLINK_MIN);
    this._blink = 0;
    this._pupilX = 0;
    this._pupilY = 0;

    this._fade = 1;
    this._fadeApplied = -1;
    this._wingT = 0;

    this._rng = mulberry32(0x4e696d);

    scene.add(this.root);
    Hero.last = this;

    // rest pose is the reference every pose writer diffs against
    this._captureRest();
    this.setTheme('keep');
  }

  /* ───────────────────────────── construction ───────────────────────────── */

  /** Map a quality name (or QUALITY record) onto 0..3. */
  static _qLevel(q) {
    if (typeof q === 'number') return clamp(q | 0, 0, 3);
    const name = (q && typeof q === 'object') ? (q.name || q.quality || '') : String(q || '');
    switch (String(name).toLowerCase()) {
      case 'low': return 0;
      case 'medium': return 1;
      case 'ultra': return 3;
      default: return 2;
    }
  }

  /** Radial segment count for a lathe, by quality. */
  _seg(hi) { return [Math.max(6, hi >> 1), Math.max(8, (hi * 3) >> 2), hi, hi + 4][this.q]; }

  /**
   * The bone hierarchy. Every bone is a bare Object3D so the harness can read
   * `hero.bones.head.rotation` directly, and so a pose is a set of numbers
   * rather than a set of keyframes.
   */
  _buildSkeleton() {
    const mk = (name, parent, x, y, z) => {
      const o = new THREE.Object3D();
      o.name = 'nim.' + name;
      o.position.set(x, y, z);
      parent.add(o);
      this.bones[name] = o;
      return o;
    };

    const hips = mk('hips', this.rig, 0, P.hipY, 0);
    const spine = mk('spine', hips, 0, P.spineY, 0);
    const chest = mk('chest', spine, 0, P.chestY, 0);
    const neck = mk('neck', chest, 0, P.neckY, 0);
    mk('head', neck, 0, P.headY, 0);

    for (const s of [1, -1]) {
      const sfx = s > 0 ? 'R' : 'L';
      const sh = mk('shoulder' + sfx, chest, s * P.shoulderX, P.shoulderY, 0);
      const ua = mk('upperArm' + sfx, sh, 0, 0, 0);
      const la = mk('lowerArm' + sfx, ua, 0, -P.upperArm, 0);
      mk('hand' + sfx, la, 0, -P.lowerArm, 0);

      const ul = mk('upperLeg' + sfx, hips, s * P.legX, -P.hipDrop, 0);
      const ll = mk('lowerLeg' + sfx, ul, 0, -P.upperLeg, 0);
      mk('foot' + sfx, ll, 0, -P.lowerLeg, 0);
      void la; void ll;
    }

    // rest pose: arms a touch out and forward, legs a hair apart — a T-pose
    // reads as a mannequin even for one frame of a load hitch.
    this.bones.upperArmR.rotation.set(0.06, 0, 0.165);
    this.bones.upperArmL.rotation.set(0.06, 0, -0.165);
    this.bones.lowerArmR.rotation.set(0.32, 0, 0.06);
    this.bones.lowerArmL.rotation.set(0.32, 0, -0.06);
    this.bones.handR.rotation.set(0.10, 0, 0.05);
    this.bones.handL.rotation.set(0.10, 0, -0.05);
    this.bones.upperLegR.rotation.set(0, 0, 0.035);
    this.bones.upperLegL.rotation.set(0, 0, -0.035);
    this.bones.lowerLegR.rotation.set(-0.06, 0, 0);
    this.bones.lowerLegL.rotation.set(-0.06, 0, 0);
    this.bones.spine.rotation.set(-0.03, 0, 0);
    this.bones.chest.rotation.set(0.04, 0, 0);

    for (let i = 0; i < BONE_NAMES.length; i++) {
      const name = BONE_NAMES[i];
      const o = this.bones[name];
      this._bones.push({
        name, o,
        rx: o.rotation.x, ry: o.rotation.y, rz: o.rotation.z,   // rest
        tx: o.rotation.x, ty: o.rotation.y, tz: o.rotation.z,   // target
      });
    }
    /** name -> record, so pose writers read like prose. */
    this.B = Object.create(null);
    for (let i = 0; i < this._bones.length; i++) this.B[this._bones[i].name] = this._bones[i];

    // Pre-resolved limb groups. Any pose writer that has to pick a side at
    // RUNTIME (foot plant, wall brace) indexes these instead of concatenating
    // a bone name — string building in an update path is heap allocation.
    // Index 0 = right (+X), index 1 = left (−X).
    // `penY` is the foot-lock feedback term: the measured sole penetration from
    // the previous frame, fed back into this frame's IK target. It is what
    // closes the loop between the analytic leg solve (which only knows about
    // the ankle) and the real 0.30 m boot (whose toe and heel are what actually
    // touch). Converges in ~3 frames and decays to zero in the air.
    this._legs = [
      { side: 1, ul: this.B.upperLegR, ll: this.B.lowerLegR, ft: this.B.footR, penY: 0 },
      { side: -1, ul: this.B.upperLegL, ll: this.B.lowerLegL, ft: this.B.footL, penY: 0 },
    ];
    this._arms = [
      { side: 1, ua: this.B.upperArmR, la: this.B.lowerArmR, hd: this.B.handR },
      { side: -1, ua: this.B.upperArmL, la: this.B.lowerArmL, hd: this.B.handL },
    ];
  }

  _captureRest() {
    for (let i = 0; i < this._bones.length; i++) {
      const b = this._bones[i];
      b.rx = b.o.rotation.x; b.ry = b.o.rotation.y; b.rz = b.o.rotation.z;
    }
  }

  /** One material per look. All of them go through `deriveMaterial`. */
  _buildMaterials() {
    const M = this.mats;
    const t = this.themeId;
    const reg = (m) => { this._mats.push(m); return m; };

    // `size` is the part's size in metres (PART_M) — it, not a hand-picked
    // number, sets the texel scale. `detail` is how much of the source's own
    // value variation survives into the neutral detail map: high on woven and
    // grained parts, low on skin (a face is not a plaster wall).
    this.M = {
      coat: reg(deriveMaterial(M, 'cloth', t, {
        color: COL.coat, roughness: 0.88, size: PART_M.coat, detail: 0.60,
        sheen: 0.42, sheenRoughness: 0.62, sheenColor: 0x7a3a22, specularIntensity: 0.30,
      })),
      coatDark: reg(deriveMaterial(M, 'cloth', t, {
        color: COL.coatDark, roughness: 0.93, size: PART_M.coatDark, detail: 0.60,
        sheen: 0.38, sheenRoughness: 0.70, sheenColor: 0x5d2816, specularIntensity: 0.26,
      })),
      trim: reg(deriveMaterial(M, 'cloth', t, {
        color: COL.trim, roughness: 0.80, size: PART_M.trim, detail: 0.55,
        sheen: 0.40, sheenRoughness: 0.58, sheenColor: 0x2f4c55, specularIntensity: 0.34,
      })),
      scarf: reg(deriveMaterial(M, 'cloth', t, {
        color: SCARF_DEFAULT, roughness: 0.95, size: PART_M.scarf, detail: 0.65,
        side: THREE.DoubleSide,
        sheen: 0.48, sheenRoughness: 0.52, sheenColor: 0x7c2a1e, specularIntensity: 0.28,
      })),
      // Skin is the one place the library map is nearly suppressed: `plaster`
      // is the Keep's wall bake, and even at world scale its crack network has
      // no business on a face. It contributes pore-level value only.
      skin: reg(deriveMaterial(M, 'plaster', t, {
        color: COL.skin, roughness: 0.62, size: PART_M.skin, detail: 0.18,
        normalScale: 0.25, physical: true, sheen: 0.22, sheenRoughness: 0.75,
        sheenColor: 0x8a5a48, specularIntensity: 0.30, clearcoat: 0.08, clearcoatRoughness: 0.85,
      })),
      hair: reg(deriveMaterial(M, 'cloth', t, {
        color: COL.hair, roughness: 0.70, size: PART_M.hair, detail: 0.70,
        sheen: 0.55, sheenRoughness: 0.34, sheenColor: 0x3d2418, specularIntensity: 0.45,
      })),
      boot: reg(deriveMaterial(M, 'rubber', t, {
        color: COL.boot, roughness: 0.86, size: PART_M.boot, detail: 0.65,
        physical: true, clearcoat: 0.22, clearcoatRoughness: 0.60, specularIntensity: 0.45,
      })),
      metal: reg(deriveMaterial(M, 'metal', t, {
        color: COL.metal, roughness: 0.28, metalness: 0.94, size: PART_M.metal, detail: 0.75,
      })),
      gold: reg(deriveMaterial(M, 'gold', t, {
        color: COL.buckle, roughness: 0.30, metalness: 0.90, size: PART_M.gold, detail: 0.70,
      })),
      // Leather, not foliage: `leaves` is an alpha-cut canopy CARD baked GREEN
      // (albedo mean 0.12, 0.22, 0.06) — it turned the pack black-green. `wood`
      // is the library's organic grain and is what a waxed leather pack wants.
      leather: reg(deriveMaterial(M, 'wood', t, {
        color: COL.leather, roughness: 0.72, size: PART_M.leather, detail: 0.60,
        physical: true, clearcoat: 0.28, clearcoatRoughness: 0.45, specularIntensity: 0.50,
      })),
      rope: reg(deriveMaterial(M, 'rope', t, {
        color: COL.rope, roughness: 0.94, size: PART_M.rope, detail: 0.80, normalScale: 0.9,
      })),
      blanket: reg(deriveMaterial(M, 'cloth', t, {
        color: COL.blanket, roughness: 0.94, size: PART_M.blanket, detail: 0.60,
        sheen: 0.35, sheenRoughness: 0.68, sheenColor: 0x7e857a, specularIntensity: 0.22,
      })),
      // Glass the way the world does it (materials.js `transmissionToAlpha`):
      // alpha + clearcoat + a hot env term. A real `transmission` here would
      // re-draw the entire scene into the transmission target — the perf gate
      // is 260 draws and that alone measured +434 on verdant-1.
      lens: reg(deriveMaterial(M, 'glass', t, {
        color: COL.lens, roughness: 0.05, metalness: 0.0, size: PART_M.lens, detail: 0.35,
        physical: true, clearcoat: 1.0, clearcoatRoughness: 0.04, ior: 1.45,
        specularIntensity: 1.0, envMapIntensity: 1.8,
        emissive: COL.lens, emissiveIntensity: 0.16,
        transparent: true, opacity: 0.42, side: THREE.DoubleSide,
      })),
      // The sclera is a WET EYE, not a lamp: the old emissive 0.55 is what made
      // two 0.12 m discs read as stick-on googly eyes in every screenshot.
      eyeWhite: reg(deriveMaterial(M, 'plaster', t, {
        color: COL.eyeWhite, roughness: 0.38, size: PART_M.eyeWhite, detail: 0.10,
        normalScale: 0.15, physical: true, clearcoat: 0.16, clearcoatRoughness: 0.12,
        specularIntensity: 0.45, envMapIntensity: 0.18,
        emissive: 0xfff4e8, emissiveIntensity: 0.03,
      })),
      eyeDark: reg(deriveMaterial(M, 'plaster', t, {
        color: COL.eyePupil, roughness: 0.30, size: PART_M.eyeDark, detail: 0.10,
        normalScale: 0.15, physical: true, clearcoat: 0.20, clearcoatRoughness: 0.10,
        specularIntensity: 0.45, envMapIntensity: 0.10,
      })),
    };

    // Wing power — additive energy membrane. Built now, shown only on demand.
    this.M.wing = reg(new THREE.MeshBasicMaterial({
      color: 0x9fe8ff, transparent: true, opacity: 0.0, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    }));
    this.M.wing.userData.baseOpacity = 0.72;

    // Metal power — a chrome swap applied over every part.
    this.M.chrome = reg(new THREE.MeshStandardMaterial({
      color: 0xd6dde6, roughness: 0.10, metalness: 1.0,
    }));
    this.M.chrome.userData.baseOpacity = 1;
  }

  /**
   * The parts whose shadow is Nim's silhouette. Everything else on him is trim
   * and stops casting (see `_attach`) — measured: 24 shadow draws down to 8.
   */
  /**
   * Attach a mesh to a bone. Every hero mesh goes through here so the shadow
   * flags, frustum policy and bookkeeping are stated exactly once.
   */
  _attach(bone, geo, mat, name) {
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.name = 'nim.' + name;
    /* Nim casts a REAL shadow, but only from the parts that make his
       silhouette.  The shadow map is a second full draw of every caster, and a
       cuff, a goggle lens or a pack clasp adds a few texels to a 1.5 m
       character's shadow for a whole extra draw call each — the blob under his
       feet plus the big parts already read as "Nim, standing there". */
    m.castShadow = HERO_SHADOW_PARTS.has(name);
    m.receiveShadow = false;
    m.frustumCulled = false;    // the hero is always on screen or behind the camera
    m.matrixAutoUpdate = true;
    bone.add(m);
    this._meshes.push(m);
    this._geos.push(geo);
    return m;
  }

  /** Torso: a tapered coat barrel with a flared hem, belt and shoulder yoke. */
  _buildBody() {
    const seg = this._seg(16);
    const chest = this.bones.chest;
    const hips = this.bones.hips;

    // --- coat body: lathe from the hem up to the collar, chest-local ----
    // chest bone is at world 0.94; the coat runs 0.50 .. 1.08 world.
    const cy = P.hipY + P.spineY + P.chestY;
    const coat = latheGeo([
      [0.000, 0.50 - cy],
      [0.150, 0.505 - cy],
      [0.214, 0.545 - cy],          // flared hem lip
      [0.198, 0.600 - cy],
      [0.186, 0.680 - cy],          // waist
      [P.torsoR, 0.800 - cy],       // chest
      [0.196, 0.905 - cy],
      [0.168, 0.985 - cy],          // shoulders
      [0.120, 1.045 - cy],
      [0.086, 1.075 - cy],          // collar throat
      [0.000, 1.080 - cy],
    ], seg);

    // recessed front placket — the coat needs one hard line or it reads as a jar
    const placket = place(
      bevelBoxGeometry(0.055, 0.42, 0.045, 0.012, 1),
      0, 0.760 - cy, -0.185, 0.10, 0, 0,
    );
    this._attach(chest, mergeAll([coat, placket]), this.M.coat, 'coat');

    // --- dark accents: hem band + shoulder yoke. Same material, same bone,
    //     so they are ONE draw call, not two.
    const dark = [place(
      latheGeo([[0.206, 0.524 - cy], [0.222, 0.534 - cy], [0.222, 0.560 - cy], [0.206, 0.570 - cy]], seg),
      0, 0, 0,
    )];
    for (const s of [1, -1]) {
      dark.push(place(
        bevelBoxGeometry(0.145, 0.085, 0.185, 0.030, 1),
        s * 0.150, 0.985 - cy, 0, 0, 0, -s * 0.30,
      ));
    }
    this._attach(chest, mergeAll(dark), this.M.coatDark, 'coatDark');

    // --- collar (a soft roll the scarf sits in) ---
    const collar = latheGeo([
      [0.086, 1.062 - cy], [0.128, 1.078 - cy], [0.134, 1.108 - cy], [0.104, 1.126 - cy], [0.078, 1.120 - cy],
    ], seg);
    this._attach(chest, collar, this.M.trim, 'collar');

    // --- belt + side pouch on the hips bone, so they sway with them ---
    const belt = place(
      latheGeo([[0.190, -0.010], [0.203, -0.004], [0.203, 0.030], [0.190, 0.036]], seg),
      0, 0.006, 0,
    );
    const pouch = place(bevelBoxGeometry(0.110, 0.095, 0.070, 0.020, 1), 0.170, -0.030, 0.060, 0, 0.5, 0);
    this._attach(hips, mergeAll([belt, pouch]), this.M.leather, 'belt');

    const buckle = place(bevelBoxGeometry(0.085, 0.058, 0.030, 0.010, 1), 0, 0.013, -0.190);
    this._attach(hips, buckle, this.M.gold, 'buckle');
  }

  /**
   * Head: a lathe sphere with a subtle jaw wedge merged in, goggles pushed up
   * on the brow, big expressive eyes and a hair tuft. The eyes are the only
   * emissive thing on Nim — they are what the player's eye tracks.
   */
  _buildHead() {
    const seg = this._seg(20);
    const head = this.bones.head;
    const R = P.headR;

    // skull: slightly egg-shaped, wider at the cheeks than the crown
    const skull = latheGeo([
      [0.000, -R * 0.96],
      [R * 0.40, -R * 0.90],
      [R * 0.74, -R * 0.66],
      [R * 0.94, -R * 0.28],
      [R * 1.00, R * 0.06],
      [R * 0.95, R * 0.42],
      [R * 0.74, R * 0.72],
      [R * 0.40, R * 0.92],
      [0.000, R * 0.99],
    ], seg);

    // jaw: a soft wedge under the front of the skull. This is the whole
    // difference between "a ball with eyes" and "a face".
    const jaw = place(
      limbGeo(0.075, 0.075, 0.001, seg, 4),
      0, -0.115, -0.103, 0, 0, 0, 1.25, 0.80, 1.0,
    );
    // ears: two small discs so the profile silhouette is not a circle
    const ears = [];
    for (const s of [1, -1]) {
      ears.push(place(
        limbGeo(0.030, 0.036, 0.030, this._seg(10), 2),
        s * (R * 0.94), R * 0.02, 0.010, 0, 0, s * 1.35,
      ));
    }
    // Nose: a real button, not the 14 mm nub the face audit found. A tapered
    // bridge merged with a rounded tip, 5 cm across and 4 cm proud, so the
    // three-quarter silhouette has something between the goggles and the chin.
    const noseParts = [
      place(bevelBoxGeometry(0.046, 0.058, 0.052, 0.020, 1), 0, -R * 0.15, -R * 0.90, 0.22, 0, 0),
      place(limbGeo(0.024, 0.030, 0.014, this._seg(10), 3), 0, -R * 0.19, -R * 1.00, 1.42, 0, 0),
    ];
    // Cheeks: two soft pads that stop the lower face reading as a bare sphere.
    // Sunk like the eyes are — the skull crops them to a ~7 cm pad standing
    // 1.8 cm proud, which is a cheek, not a ball stuck on a ball.
    for (const s of [1, -1]) {
      noseParts.push(place(
        limbGeo(0.042, 0.042, 0.001, this._seg(12), 3),
        s * 0.098, -R * 0.28, -0.170,
      ));
    }

    this._attach(head, mergeAll([skull, jaw].concat(noseParts, ears)), this.M.skin, 'head');

    // --- hair: blades SWEPT BACK off the crown ------------------------------
    // They used to stand at −0.55 rad, which from the follow camera read as one
    // black cone — a party hat. Swept to −1.25 they read as hair moving.
    const hair = [];
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.34;
      hair.push(place(
        bevelBoxGeometry(0.040 - Math.abs(i - 2) * 0.005, 0.135, 0.026, 0.011, 1),
        Math.sin(a) * 0.072, R * 0.90 + 0.012, -0.010 - Math.cos(a) * 0.012,
        -1.25, a, a * 0.5,
      ));
    }
    // A short fringe over the brow, so the face has a hairline to sit under.
    for (let i = 0; i < 3; i++) {
      const a = (i - 1) * 0.46;
      hair.push(place(
        bevelBoxGeometry(0.058, 0.070, 0.024, 0.010, 1),
        Math.sin(a) * 0.108, R * 0.86, -R * 0.60 + Math.abs(a) * 0.030,
        0.75, a * 0.6, a * 0.7,
      ));
    }
    // a back fringe so the crown is not bald from the follow camera
    hair.push(place(
      latheGeo([[R * 0.99, R * 0.10], [R * 1.02, R * 0.36], [R * 0.86, R * 0.66], [R * 0.52, R * 0.86], [0, R * 0.90]], seg),
      0, 0, 0.012,
    ));
    // The goggle strap around the back of the skull is dark brown leather and
    // the hair is dark brown cloth — merging them costs nothing visually and
    // saves a whole draw call on the model the camera stares at all game.
    hair.push(place(
      latheGeo([[R * 1.01, R * 0.34], [R * 1.05, R * 0.40], [R * 1.05, R * 0.50], [R * 1.01, R * 0.56]], this._seg(14)),
      0, 0, 0,
    ));
    // brow line: a dark bar above each eye — the cheapest expression there is
    for (const s of [1, -1]) {
      hair.push(place(
        bevelBoxGeometry(0.076, 0.017, 0.018, 0.006, 1),
        s * EYE_X, EYE_Y + 0.060, -R * 0.90, 0.10, -s * 0.16, s * 0.20,
      ));
    }

    // --- the MOUTH. There was not one. A 12 cm smile arc in the same dark
    //     brown as the brows and lashes, merged into that mesh, so a face the
    //     camera stares at all game finally has three features instead of two.
    for (let i = 0; i < 9; i++) {
      const f = (i - 4) / 4;                       // −1 .. 1 across the mouth
      const x = f * 0.048;
      const y = -R * 0.40 + f * f * 0.016;         // corners lifted -> a smile
      // ride the skull's own cross-section at this height, then stand proud of
      // it so no segment can sink into the cheek
      const rr = R * 0.875;
      const z = -Math.sqrt(Math.max(0.001, rr * rr - x * x)) - 0.006;
      hair.push(place(
        bevelBoxGeometry(0.030, 0.014 - Math.abs(f) * 0.004, 0.018, 0.005, 1),
        x, y, z, 0.16, 0, -f * 0.34,
      ));
    }
    this._attach(head, mergeAll(hair), this.M.hair, 'hair');

    // --- goggles pushed up on the brow ---
    const gseg = this._seg(14);
    const frames = [];
    for (const s of [1, -1]) {
      // frame ring: a lathe torus-ish cup
      frames.push(place(
        latheGeo([
          [0.056, 0.000], [0.072, 0.004], [0.078, 0.026], [0.072, 0.044],
          [0.056, 0.048], [0.052, 0.030], [0.052, 0.006],
        ], gseg),
        s * 0.098, R * 0.44, -R * 0.80, Math.PI * 0.5 - 0.30, 0, 0,
      ));
      // rivets — a real machined cylinder from the builders vocabulary
      frames.push(place(tubeGeometry(0.011, 0.013, 0.014, 8, 1),
        s * 0.160, R * 0.50, -R * 0.72, Math.PI * 0.5, 0, 0));
    }
    // bridge between the two cups
    frames.push(place(bevelBoxGeometry(0.070, 0.024, 0.030, 0.008, 1), 0, R * 0.47, -R * 0.80, -0.30, 0, 0));
    this._attach(head, mergeAll(frames), this.M.metal, 'goggleFrame');

    // lenses inside the cups
    const lenses = [];
    for (const s of [1, -1]) {
      lenses.push(place(
        limbGeo(0.052, 0.052, 0.006, gseg, 2),
        s * 0.098, R * 0.44, -R * 0.79, Math.PI * 0.5 - 0.30, 0, 0,
      ));
    }
    this._attach(head, mergeAll(lenses), this.M.lens, 'goggleLens');

    // --- eyes ------------------------------------------------------------
    // A pivot per feature so blink (scale) and look (rotate) never interfere.
    // The pivot sits AT eye height so a blink collapses the lids in place.
    this._eyePivot = new THREE.Object3D();
    this._eyePivot.name = 'nim.eyes';
    this._eyePivot.position.set(0, EYE_Y, 0);
    head.add(this._eyePivot);

    const eseg = this._seg(14);
    const sclera = [];
    const pupils = [];
    for (const s of [1, -1]) {
      const ex = s * EYE_X, ey = 0, ez = EYE_Z;
      // eyeball: a real sphere, slightly flattened front-to-back, sunk in
      sclera.push(place(
        limbGeo(EYE_R, EYE_R, 0.001, eseg, 4),
        ex, ey, ez,
      ));
      // Iris: a shallow cap that must PROTRUDE through the eyeball's front, or
      // the sclera's own specular is all the camera sees (which is what made
      // the eyes read as two chrome rings). 0.95 R puts its rim ~3 mm proud.
      pupils.push(place(
        limbGeo(0.026, 0.026, 0.004, eseg, 3),
        ex, ey, ez - EYE_R * 0.99, Math.PI * 0.5, 0, 0, 1.0, 1.0, 1.20,
      ));
    }
    this._sclera = this._attach(this._eyePivot, mergeAll(sclera), this.M.eyeWhite, 'sclera');

    this._pupilPivot = new THREE.Object3D();
    this._pupilPivot.name = 'nim.pupils';
    this._eyePivot.add(this._pupilPivot);
    this._pupils = this._attach(this._pupilPivot, mergeAll(pupils), this.M.eyeDark, 'pupils');
    if (this._pupils) this._pupils.castShadow = false;
    if (this._sclera) this._sclera.castShadow = false;
  }

  /** Arms: sleeve, cuff and a mitten with a thumb wedge. */
  _buildArms() {
    const seg = this._seg(12);
    for (const s of [1, -1]) {
      const sfx = s > 0 ? 'R' : 'L';
      const ua = this.bones['upperArm' + sfx];
      const la = this.bones['lowerArm' + sfx];
      const hd = this.bones['hand' + sfx];

      // upper sleeve: thicker at the shoulder, gathered at the elbow
      const sleeve = limbGeo(0.086, 0.070, P.upperArm, seg, 3);
      const shoulderCap = place(limbGeo(0.092, 0.092, 0.010, seg, 3), 0, 0.006, 0);
      this._attach(ua, mergeAll([sleeve, shoulderCap]), this.M.coat, 'sleeveU' + sfx);

      // forearm + cuff
      const fore = limbGeo(0.068, 0.058, P.lowerArm, seg, 3);
      this._attach(la, fore, this.M.coat, 'sleeveL' + sfx);
      const cuff = place(
        latheGeo([[0.062, -P.lowerArm - 0.004], [0.078, -P.lowerArm + 0.006], [0.078, -P.lowerArm + 0.044], [0.062, -P.lowerArm + 0.052]], seg),
        0, 0, 0,
      );
      this._attach(la, cuff, this.M.trim, 'cuff' + sfx);

      // mitten: a rounded paddle plus a thumb wedge, merged
      const palm = place(
        limbGeo(0.062, 0.052, P.handLen - 0.052, seg, 3),
        0, -0.010, 0, 0, 0, 0, 1.0, 1.0, 0.80,
      );
      const thumb = place(
        limbGeo(0.026, 0.024, 0.042, this._seg(8), 2),
        -s * 0.052, -0.052, -0.014, 0.20, 0, -s * 1.05,
      );
      this._attach(hd, mergeAll([palm, thumb]), this.M.trim, 'mitten' + sfx);
    }
  }

  /** Legs: coat-matched thigh, gaitered shin, chunky boot with a tread sole. */
  _buildLegs() {
    const seg = this._seg(12);
    for (const s of [1, -1]) {
      const sfx = s > 0 ? 'R' : 'L';
      const ul = this.bones['upperLeg' + sfx];
      const ll = this.bones['lowerLeg' + sfx];
      const ft = this.bones['foot' + sfx];

      this._attach(ul, limbGeo(0.098, 0.082, P.upperLeg, seg, 3), this.M.coat, 'thigh' + sfx);

      // knee cap: reads the bend at 20 m
      const knee = place(limbGeo(0.084, 0.084, 0.012, seg, 3), 0, -P.upperLeg + 0.006, -0.008);
      this._attach(ul, knee, this.M.trim, 'knee' + sfx);

      this._attach(ll, limbGeo(0.078, 0.064, P.lowerLeg, seg, 3), this.M.trim, 'shin' + sfx);

      // Boot: chamfered shell + toe cap + rolled cuff + tread sole, ALL merged
      // into one rubber mesh. Four sub-parts, one draw call — the geometry is
      // what reads at 20 m, not four separate greys.
      const boot = [];
      boot.push(place(bevelBoxGeometry(P.bootW, P.bootH, P.bootL * 0.74, 0.038, 1), 0, -P.bootH * 0.5 + 0.016, -0.026));
      boot.push(place(bevelBoxGeometry(P.bootW * 0.90, P.bootH * 0.74, P.bootL * 0.42, 0.045, 1), 0, -P.bootH * 0.5 + 0.006, -0.108));
      boot.push(place(
        latheGeo([[0.074, 0.006], [0.094, 0.018], [0.094, 0.052], [0.074, 0.062]], seg),
        0, 0, -0.012,
      ));
      // Sole slab sits 4 mm proud of the ground; the three tread ribs are the
      // actual contact patch, bottoming at EXACTLY −bootH so a planted foot
      // touches the ground plane instead of sinking through it.
      boot.push(place(bevelBoxGeometry(P.bootW + 0.014, 0.034, P.bootL, 0.014, 1), 0, -P.bootH + 0.021, -0.052));
      for (let i = 0; i < 3; i++) {
        boot.push(place(
          bevelBoxGeometry(P.bootW - 0.010, 0.012, 0.030, 0.005, 1),
          0, -P.bootH + 0.006, -0.140 + i * 0.070,
        ));
      }
      this._attach(ft, mergeAll(boot), this.M.boot, 'boot' + sfx);
    }
  }

  /** Backpack with a rolled blanket and rope straps over the shoulders. */
  _buildPack() {
    const chest = this.bones.chest;
    const cy = P.hipY + P.spineY + P.chestY;
    const seg = this._seg(12);

    const body = place(bevelBoxGeometry(0.230, 0.235, 0.130, 0.032, 1), 0, 0.855 - cy, 0.225);
    const flap = place(bevelBoxGeometry(0.238, 0.090, 0.140, 0.028, 1), 0, 0.955 - cy, 0.228, -0.10, 0, 0);
    const sidePocketA = place(bevelBoxGeometry(0.060, 0.110, 0.090, 0.020, 1), 0.128, 0.840 - cy, 0.222);
    const sidePocketB = place(bevelBoxGeometry(0.060, 0.110, 0.090, 0.020, 1), -0.128, 0.840 - cy, 0.222);
    this._attach(chest, mergeAll([body, flap, sidePocketA, sidePocketB]), this.M.leather, 'pack');

    // rolled blanket lashed across the top. limbGeo's origin is at the TOP of
    // its shaft, so after the +Z roll it runs +X — shift back by half to centre.
    const roll = place(
      limbGeo(0.056, 0.056, 0.230, seg, 3),
      -0.115, 0.995 - cy, 0.232, 0, 0, Math.PI * 0.5,
    );
    this._attach(chest, roll, this.M.blanket, 'blanket');

    // straps: two over the shoulders, two lashing the roll
    const straps = [];
    for (const s of [1, -1]) {
      straps.push(place(bevelBoxGeometry(0.048, 0.300, 0.024, 0.008, 1), s * 0.118, 0.900 - cy, -0.115, 0.30, 0, -s * 0.12));
      straps.push(place(bevelBoxGeometry(0.040, 0.026, 0.290, 0.008, 1), s * 0.118, 0.975 - cy, 0.060, 0.18, 0, 0));
      straps.push(place(bevelBoxGeometry(0.030, 0.150, 0.026, 0.006, 1), s * 0.072, 0.995 - cy, 0.234, 0, 0, 0));
    }
    this._attach(chest, mergeAll(straps), this.M.rope, 'packStraps');

    // clasps
    const clasps = [];
    for (const s of [1, -1]) clasps.push(place(bevelBoxGeometry(0.044, 0.032, 0.020, 0.006, 1), s * 0.118, 0.795 - cy, -0.146));
    this._attach(chest, mergeAll(clasps), this.M.gold, 'packClasps');
  }

  /**
   * Wing power: two swept energy membranes, five feather blades each, hidden
   * until `setPower('wing')`. Additive so they glow rather than shade.
   */
  _buildWings() {
    const chest = this.bones.chest;
    const cy = P.hipY + P.spineY + P.chestY;

    this.wings = [];
    for (const s of [1, -1]) {
      const pivot = new THREE.Object3D();
      pivot.name = 'nim.wing' + (s > 0 ? 'R' : 'L');
      pivot.position.set(s * 0.115, 0.930 - cy, 0.150);
      pivot.visible = false;
      chest.add(pivot);

      const blades = [];
      for (let i = 0; i < 5; i++) {
        const f = i / 4;
        const len = 0.46 - f * 0.20;
        const a = -0.30 + f * 0.95;
        blades.push(place(
          bevelBoxGeometry(0.030, len, 0.008, 0.006, 1),
          s * (0.030 + f * 0.055), len * 0.42, -f * 0.055,
          0, 0, s * a,
        ));
      }
      const mesh = new THREE.Mesh(mergeAll(blades), this.M.wing);
      mesh.name = 'nim.wingMesh' + (s > 0 ? 'R' : 'L');
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      pivot.add(mesh);
      this._geos.push(mesh.geometry);
      this.wings.push(pivot);
    }
  }

  /**
   * The scarf ribbon. 7 quads, non-indexed, positions and normals rewritten in
   * place every frame from the Verlet chain. Parented to `root` (NOT `rig`) so
   * squash and flips never stretch the cloth.
   */
  _buildScarf() {
    const verts = SCARF_LINKS * 6;         // 7 quads * 2 tris * 3 verts
    this._scarfPos = new Float32Array(verts * 3);
    this._scarfNor = new Float32Array(verts * 3);
    this._scarfUv = new Float32Array(verts * 2);

    for (let i = 0; i < SCARF_LINKS; i++) {
      const v0 = i / SCARF_LINKS, v1 = (i + 1) / SCARF_LINKS;
      const o = i * 12;
      // tri A: (0,v0) (1,v0) (1,v1)   tri B: (0,v0) (1,v1) (0,v1)
      const uvs = [0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1];
      for (let k = 0; k < 12; k++) this._scarfUv[o + k] = uvs[k];
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this._scarfPos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this._scarfNor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this._scarfUv, 2));
    g.attributes.position.setUsage(THREE.DynamicDrawUsage);
    g.attributes.normal.setUsage(THREE.DynamicDrawUsage);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2.5);

    this.scarfMesh = new THREE.Mesh(g, this.M.scarf);
    this.scarfMesh.name = 'nim.scarf';
    this.scarfMesh.castShadow = true;
    this.scarfMesh.receiveShadow = false;
    this.scarfMesh.frustumCulled = false;
    this.root.add(this.scarfMesh);
    this._geos.push(g);
  }

  /* ─────────────────────────────── public API ─────────────────────────────── */

  /**
   * Realm dress. Accepts a ThemeDef (contract §15) or a bare theme id.
   * The scarf takes the realm colour; the blob takes the realm's fog.
   */
  setTheme(theme) {
    const def = (theme && typeof theme === 'object') ? theme : null;
    const id = def ? (def.id || 'keep') : String(theme || 'keep');
    this.theme = def;
    this.themeId = id;

    let tint = SCARF_TINT[id];
    if (tint === undefined) {
      tint = (def && def.palette && def.palette.accent !== undefined)
        ? def.palette.accent : SCARF_DEFAULT;
    }
    _col0.set(tint);
    this.M.scarf.color.copy(_col0);
    this.M.scarf.userData.baseColor = this.M.scarf.color.getHex();

    // Lenses pick up the realm accent so the goggles never read as dead glass.
    const acc = (def && def.palette && def.palette.crest !== undefined) ? def.palette.crest : COL.lens;
    _col1.set(acc).lerp(_col0.set(COL.lens), 0.55);
    this.M.lens.color.copy(_col1);
    this.M.lens.emissive.copy(_col1);
    this.M.lens.userData.baseColor = this.M.lens.color.getHex();

    // Wing energy matches the realm too.
    if (def && def.palette && def.palette.accent !== undefined) this.M.wing.color.set(def.palette.accent);

    this.shadowBlob.setTheme(def);
  }

  /** Show / hide the whole hero (peek camera, cinematics, the death iris). */
  setVisible(v) {
    const want = !!v;
    if (want === this.visible) return;
    this.visible = want;
    this.root.visible = want;
    this.shadowBlob.setVisible(want);
  }

  /**
   * Power hats (contract §22 `power` crests).
   *   'wing'   — energy wings + a lighter fall pose
   *   'metal'  — chrome material swap
   *   'vanish' — 40 % opacity
   * `null` restores the default dress.
   */
  setPower(id) {
    const p = id || null;
    if (p === this.power) return;
    this.power = p;

    // wings
    const wingOn = p === 'wing';
    for (let i = 0; i < this.wings.length; i++) this.wings[i].visible = wingOn;
    this.M.wing.opacity = wingOn ? this.M.wing.userData.baseOpacity : 0;

    // chrome swap
    const chromeOn = p === 'metal';
    for (let i = 0; i < this._meshes.length; i++) {
      const m = this._meshes[i];
      if (m === this._sclera || m === this._pupils) continue;      // keep the face readable
      if (chromeOn) {
        if (!m.userData.origMat) m.userData.origMat = m.material;
        m.material = this.M.chrome;
      } else if (m.userData.origMat) {
        m.material = m.userData.origMat;
        m.userData.origMat = null;
      }
    }
    if (this.scarfMesh) {
      if (chromeOn) {
        if (!this.scarfMesh.userData.origMat) this.scarfMesh.userData.origMat = this.scarfMesh.material;
        this.scarfMesh.material = this.M.chrome;
      } else if (this.scarfMesh.userData.origMat) {
        this.scarfMesh.material = this.scarfMesh.userData.origMat;
        this.scarfMesh.userData.origMat = null;
      }
    }

    // vanish opacity is applied through the same path as heroFade
    this._fadeApplied = -1;
  }

  /* ─────────────────────────────── the update ─────────────────────────────── */

  /**
   * One frame of hero. Reads the controller, writes the rig. ZERO allocation.
   * @param {number} dt seconds (already clamped by the engine)
   * @param {object} player the §11 Player
   */
  update(dt, player) {
    const d = clamp(numOr(dt, 0), 0, 1 / 15);
    if (!this.visible) { this.shadowBlob.update(d, this.root.position, null, 1); return; }

    // ---- read the controller (defensively — the hero must survive a stub) --
    const p = player || null;
    const rp = p && (p.renderPos || p.pos);
    const vel = p && p.vel;

    if (rp) this.root.position.set(rp.x, rp.y, rp.z);
    const facing = p ? numOr(p.facing, this.root.rotation.y) : this.root.rotation.y;
    this.root.rotation.y = facing;

    const vx = vel ? numOr(vel.x, 0) : 0;
    const vy = vel ? numOr(vel.y, 0) : 0;
    const vz = vel ? numOr(vel.z, 0) : 0;
    const horiz = Math.hypot(vx, vz);
    this._speed = p ? numOr(p.speed, horiz) : horiz;
    this._speedN = clamp01(this._speed / TUNE.speedRun);

    const grounded = p ? !!(p.grounded || p.onGround) : true;
    this._prevGrounded = this._grounded;
    this._grounded = grounded;

    let anim = p && typeof p.anim === 'string' ? p.anim : (p && typeof p.state === 'string' ? p.state : 'idle');
    if (p && p.dead) anim = 'dead';
    this._prevAnim = this._anim;
    this._anim = anim;
    this._animT = p ? numOr(p.animT, this._animT + d) : this._animT + d;
    if (anim !== this._prevAnim && !p) this._animT = 0;

    // ground normal (for the foot plant); the controller may not publish one
    const gn = p && (p.groundNormal || p.groundN);
    if (gn && typeof gn.y === 'number') this._groundN.set(gn.x || 0, gn.y, gn.z || 0);
    else this._groundN.set(0, 1, 0);
    if (this._groundN.lengthSq() < 1e-6) this._groundN.set(0, 1, 0);

    // ---- bookkeeping the cycles need ------------------------------------
    if (grounded) {
      this._dist += horiz * d;
      this._airT = 0;
    } else {
      if (this._prevGrounded) this._lastAirT = 0;
      this._airT += d;
    }
    const stride = lerp(STRIDE_WALK, STRIDE_RUN, clamp01((this._speed - TUNE.speedWalk) / (TUNE.speedRun - TUNE.speedWalk)));
    if (grounded && this._speed > 0.25) {
      // Wrapped, because `_dist` is cumulative for a whole course: a raw
      // phase of 10^5 rad would start losing sine precision late in a run.
      this._phase = ((this._dist / Math.max(0.3, stride)) * TAU) % TAU;
    }

    this._leanTgt = p ? clamp(numOr(p.leanX, 0), -1, 1) : 0;
    this._lean = damp(this._lean, this._leanTgt, 9, d);

    this._breathe += d * (1.15 + this._speedN * 0.9);
    if (anim === 'idle' && this._speed < 0.2) this._idleT += d; else this._idleT = 0;

    // ---- squash / stretch triggers ---------------------------------------
    this._updateSquash(d, anim, vy);

    // ---- pose ------------------------------------------------------------
    this._resetTargets();
    this._writePose(anim, d, p, vx, vy, vz, horiz);
    this._integrateBones(d);
    this._applyRoot(d);

    // ---- IK pass: after the blend, after the root. Order matters ---------
    this._applyFootPlant(d);

    // ---- world transform is final; children can now be resolved ----------
    this.root.updateMatrixWorld(true);

    // ---- secondary -------------------------------------------------------
    this._updateFace(d, anim);
    this._updateScarf(d, vx, vy, vz, facing);
    this._updateWings(d, anim);
    this._updateFade(p);

    // ---- contact shadow --------------------------------------------------
    const world = p && p.world ? p.world : null;
    this.shadowBlob.update(d, this.root.position, world, 1 / Math.max(0.6, this._squash));
  }

  /** Copy the rest pose into every target — pose writers then state only deltas. */
  _resetTargets() {
    const B = this._bones;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      b.tx = b.rx; b.ty = b.ry; b.tz = b.rz;
    }
    this._rootPitch = 0;
    this._rootRoll = 0;
    this._rootYaw = 0;
    this._rootY = 0;
    this._rootZ = 0;
    this._ikW = 0;
  }

  /** Integrate every bone toward its target with the contract's spring rate. */
  _integrateBones(dt) {
    const B = this._bones;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      const r = b.o.rotation;
      r.x = damp(r.x, b.tx, BONE_LAMBDA, dt);
      r.y = dampAngle(r.y, b.ty, BONE_LAMBDA, dt);
      r.z = damp(r.z, b.tz, BONE_LAMBDA, dt);
    }
  }

  /** Root transform: sprung lean + driven flips + squash. */
  _applyRoot(dt) {
    const rig = this.rig;

    // sprung lean / bob
    rig.userData.px = damp(numOr(rig.userData.px, 0), this._rootPitch, ROOT_LAMBDA, dt);
    rig.userData.rz = damp(numOr(rig.userData.rz, 0), this._rootRoll, ROOT_LAMBDA, dt);
    rig.userData.ry = damp(numOr(rig.userData.ry, 0), this._rootYaw, ROOT_LAMBDA, dt);
    rig.userData.oy = damp(numOr(rig.userData.oy, 0), this._rootY, ROOT_LAMBDA, dt);
    rig.userData.oz = damp(numOr(rig.userData.oz, 0), this._rootZ, ROOT_LAMBDA, dt);

    // flips decay out once the state that drove them is gone
    if (this._flipDecay > 0) {
      const k = Math.exp(-11 * dt);
      this._flipPitch *= k;
      this._flipRoll *= k;
      this._flipYaw *= k;
      this._flipDecay -= dt;
    }

    // NOTE the sign: `_flipPitch` is stated in the contract's units (+2π for a
    // jump3 somersault, −2π for a backflip) and negated here because a POSITIVE
    // rotation about +X tips the body BACKWARD in three's frame.
    rig.rotation.set(
      rig.userData.px - this._flipPitch,
      rig.userData.ry + this._flipYaw,
      rig.userData.rz + this._flipRoll,
    );

    this._squash = damp(this._squash, this._squashTgt, SQUASH_LAMBDA, dt);
    this._squashTgt = damp(this._squashTgt, 1, SQUASH_LAMBDA * 0.75, dt);
    const sy = this._squash;
    const sxz = 1 / Math.sqrt(Math.max(0.2, sy));       // preserve volume
    rig.scale.set(sxz, sy, sxz);

    /*
     * PIVOT. `rig` hangs off `root`, whose origin is the SOLE PLANE, so writing
     * the rotation straight onto it span every flip and every root pitch around
     * the boots: a jump3 somersault swung the whole body a full body-length
     * BELOW the feet, and `_poseDead` toppled the corpse two metres off its own
     * contact blob. A body rotates about its HIPS.
     *
     * Rather than re-parent (which would move the squash pivot off the feet and
     * hide the rig transform from every harness that reads `hero.rig`), apply
     * the pivot as a translation. For a pivot p in rig-local space, rotating
     * about p instead of the origin is exactly
     *      T = S·p − R·S·p
     * which leaves T = 0 when R is identity — so a standing, leaning, squashing
     * Nim is bit-identical to before, and only rotation moves the body about
     * the hips. Squash still scales from the soles.
     */
    _v0.set(0, RIG_PIVOT_Y * sy, 0).applyEuler(rig.rotation);
    rig.position.set(
      -_v0.x,
      RIG_PIVOT_Y * sy - _v0.y + rig.userData.oy,
      -_v0.z + rig.userData.oz,
    );
  }

  /**
   * Squash on impact, stretch on take-off. Triggered off state EDGES so it
   * fires once per event rather than every frame the state is held.
   */
  _updateSquash(dt, anim, vy) {
    const a = anim;
    const prev = this._prevAnim;
    if (a !== prev) {
      if (a === 'land' || a === 'hardLand' || a === 'poundLand') {
        const hard = a === 'hardLand' || a === 'poundLand';
        this._squashTgt = hard ? SQUASH_LAND - 0.06 : SQUASH_LAND;
        this._squash = this._squashTgt;
      } else if (a === 'jump1' || a === 'jump2' || a === 'jump3' ||
                 a === 'longjump' || a === 'backflip' || a === 'sideflip' ||
                 a === 'wallkick' || a === 'dive') {
        this._squashTgt = STRETCH_JUMP;
        this._squash = STRETCH_JUMP;
      }
    }
    // a fast landing with no explicit land state still deserves the impact
    if (this._grounded && !this._prevGrounded && a !== 'land' && a !== 'hardLand') {
      const impact = clamp01(-vy / 24);
      if (impact > 0.15) {
        this._squashTgt = lerp(1, SQUASH_LAND, impact);
        this._squash = this._squashTgt;
      }
    }
  }

  /* ───────────────────────────── pose writers ───────────────────────────── */

  /**
   * The pose table. One branch per controller state (§11). Every branch writes
   * bone targets; the cycles below layer on top. Numbers are radians and were
   * authored against the silhouette, not against a reference rig.
   */
  _writePose(anim, dt, player, vx, vy, vz, horiz) {
    const B = this.B;
    const t = this._animT;
    const sn = this._speedN;

    switch (anim) {
      case 'run':
      case 'crouchwalk':
        this._poseLocomotion(anim === 'crouchwalk');
        break;

      case 'idle':
        this._poseIdle(dt);
        break;

      case 'skid':
      case 'pivot':
        this._poseSkid(anim === 'pivot');
        break;

      case 'bonk':
        this._poseBonk(t);
        break;

      case 'crouch':
        this._poseCrouch(0.85);
        break;

      case 'jump1': this._poseJump(1, t); break;
      case 'jump2': this._poseJump(2, t); break;
      case 'jump3': this._poseJump(3, t); break;

      case 'longjump': this._poseLongJump(t); break;
      case 'backflip': this._poseBackflip(t); break;
      case 'sideflip': this._poseSideflip(t, player); break;

      case 'fall': this._poseFall(vy); break;
      case 'fly': this._poseFly(t); break;

      case 'dive': this._poseDive(t); break;
      case 'slide': this._poseSlide(t); break;
      case 'slideRecover': this._poseSlideRecover(t); break;

      case 'wallslide': this._poseWallslide(player); break;
      case 'wallkick': this._poseWallkick(t); break;

      case 'poundHang': this._posePoundHang(t); break;
      case 'poundFall': this._posePoundFall(t); break;
      case 'poundLand': this._posePoundLand(t); break;

      case 'land': this._poseLand(t, false); break;
      case 'hardLand': this._poseLand(t, true); break;

      case 'slopeSlide': this._poseSlopeSlide(horiz); break;

      case 'swimIdle': this._poseSwim(false, true); break;
      case 'swim': this._poseSwim(false, false); break;
      case 'swimDive': this._poseSwim(true, false); break;

      case 'climb': this._poseClimb(); break;
      case 'climbKick': this._poseClimbKick(t); break;

      case 'cannon': this._poseCannon(t); break;

      case 'dead': this._poseDead(t); break;

      default:
        // Unknown state: never freeze. Fall back to whichever of the two
        // universal poses matches the physical situation.
        if (this._grounded) this._poseLocomotion(false); else this._poseFall(vy);
        break;
    }

    // ---- universal layers -------------------------------------------------
    // NOTE the foot plant is NOT here. It is an IK pass and runs AFTER the
    // spring blend and after the root transform settles (see update()) —
    // correcting a target that is then damped at 14 /s would leave the boots
    // a frame and a half behind the ground during a fast run cycle.
    if (this._grounded) this._flipDecay = Math.max(this._flipDecay, 0.0001);

    // lean into the turn (contract: player.leanX) and forward by speed
    this._rootRoll += -this._lean * 0.38;
    B.chest.tz += -this._lean * 0.16;
    B.head.tz += -this._lean * 0.10;
    B.head.ty += this._lean * 0.22;                 // look where you are turning

    if (this._grounded && anim !== 'crouch' && anim !== 'slide' && anim !== 'dive') {
      this._rootPitch += sn * 0.20;                 // forward lean by speed
      this._rootY += -sn * 0.020;                   // ...and settle a little
    }

    void vx; void vz;
  }

  /**
   * Run / walk. Phase comes from DISTANCE, so contact never skates at any stick
   * magnitude. Amplitudes scale from a walk's shuffle to a run's full stride.
   */
  _poseLocomotion(crouched) {
    const B = this.B;
    const ph = this._phase;
    const sn = this._speedN;
    const walkMix = clamp01((this._speed - 0.3) / (TUNE.speedWalk - 0.2));
    const amp = lerp(0.16, 0.80, sn) * walkMix;
    const armAmp = lerp(0.20, 0.92, sn) * walkMix;
    const s = Math.sin(ph);
    const c = Math.cos(ph);

    if (this._speed < 0.18) { this._poseIdle(0); return; }

    // legs — opposite phase, knee flexes on the swing half
    B.upperLegR.tx = s * amp;
    B.upperLegL.tx = -s * amp;
    B.lowerLegR.tx = -(0.10 + clamp01(-Math.sin(ph + 0.95)) * (0.55 + sn * 0.85));
    B.lowerLegL.tx = -(0.10 + clamp01(-Math.sin(ph + 0.95 + Math.PI)) * (0.55 + sn * 0.85));
    B.footR.tx = 0.14 - s * 0.22 * amp;
    B.footL.tx = 0.14 + s * 0.22 * amp;

    // arms — contra to the legs, elbows pumping
    B.upperArmR.tx = -s * armAmp;
    B.upperArmL.tx = s * armAmp;
    B.upperArmR.tz = 0.165 + sn * 0.10;
    B.upperArmL.tz = -0.165 - sn * 0.10;
    B.lowerArmR.tx = 0.34 + clamp01(-s) * (0.30 + sn * 0.55);
    B.lowerArmL.tx = 0.34 + clamp01(s) * (0.30 + sn * 0.55);

    // hips sway, shoulders counter-rotate — the difference between a walk and
    // a puppet slid along a rail
    B.hips.ty = s * (0.06 + sn * 0.07);
    B.hips.tz = c * 0.045 * sn;
    B.chest.ty = -s * (0.07 + sn * 0.10);
    B.spine.tx = -0.03 - sn * 0.10;
    B.head.ty = s * 0.05;

    // 2× vertical bob, plus a touch of body roll on the plant
    this._rootY += Math.sin(ph * 2) * (0.010 + sn * 0.026) - sn * 0.012;
    this._rootRoll += Math.sin(ph) * 0.035 * sn;

    if (crouched) {
      this._poseCrouchOverlay(0.55);
      this._rootY -= 0.14;
    }
  }

  /** Idle: breathe, weight shift, and a look-around after 4 s of stillness. */
  _poseIdle(dt) {
    const B = this.B;
    const br = Math.sin(this._breathe * 1.5);
    const sway = Math.sin(this._breathe * 0.45);

    B.chest.tx = 0.04 + br * 0.035;
    B.spine.tx = -0.03 - br * 0.020;
    B.upperArmR.tx = 0.06 + br * 0.045;
    B.upperArmL.tx = 0.06 + br * 0.045;
    B.upperArmR.tz = 0.165 + br * 0.030;
    B.upperArmL.tz = -0.165 - br * 0.030;
    B.hips.tz = sway * 0.035;
    B.hips.ty = sway * 0.045;
    B.head.tz = -sway * 0.030;
    this._rootY += br * 0.010;

    // look-around: a slow scan of the room, on a 6 s loop, once idle > 4 s
    if (this._idleT > IDLE_LOOK_AFTER) {
      const lt = (this._idleT - IDLE_LOOK_AFTER) % 6.0;
      const w = smoothstep(0, 0.6, lt) * (1 - smoothstep(4.4, 5.4, lt));
      const dir = Math.sin(lt * 1.05);
      B.head.ty += dir * 0.72 * w;
      B.head.tx += (0.10 - Math.abs(dir) * 0.16) * w;
      B.chest.ty += dir * 0.16 * w;
      this._lookYaw = dir * w;
    } else {
      this._lookYaw = damp(this._lookYaw, 0, 6, Math.max(dt, 1 / 120));
    }
  }

  /**
   * BONK — grounded, shoulder into a wall that will not move. A short recoil
   * off the impact (the first 0.18 s), then a press: both palms flat on the
   * wall, weight forward, boots scuffing at half the run cadence so the hero
   * reads as TRYING rather than as a run cycle playing on the spot.
   */
  _poseBonk(t) {
    const B = this.B;
    const recoil = 1 - clamp01(t / 0.18);              // 1 -> 0 over the first 0.18 s
    const ph = t * 7.0;                                // slow scuff cadence
    const sc = Math.sin(ph);

    this._rootPitch = 0.20 - recoil * 0.30;            // snap back, then lean in
    this._rootY -= 0.05 + recoil * 0.06;

    // palms on the wall, elbows out
    B.upperArmR.tx = -1.42 - recoil * 0.25;
    B.upperArmL.tx = -1.42 - recoil * 0.25;
    B.upperArmR.tz = 0.46;
    B.upperArmL.tz = -0.46;
    B.lowerArmR.tx = 0.30;
    B.lowerArmL.tx = 0.30;

    // boots scuffing: a small, out-of-phase churn, never a full stride
    B.upperLegR.tx = 0.10 + sc * 0.26;
    B.upperLegL.tx = 0.10 - sc * 0.26;
    B.lowerLegR.tx = -0.30 - clamp01(sc) * 0.34;
    B.lowerLegL.tx = -0.30 - clamp01(-sc) * 0.34;
    B.footR.tx = 0.24 - sc * 0.14;
    B.footL.tx = 0.24 + sc * 0.14;

    B.hips.ty = sc * 0.05;
    B.spine.tx = 0.16;
    B.chest.tx = 0.10 + recoil * 0.18;
    B.head.tx = -0.28 - recoil * 0.10;                 // chin up, looking at the wall
  }

  /** Skid / pivot: lean AWAY from travel, arms flung out for balance. */
  _poseSkid(isPivot) {
    const B = this.B;
    const k = isPivot ? 1.0 : 0.75;
    this._rootPitch = -0.34 * k;                      // lean back into the stop
    this._rootY -= 0.10 * k;
    B.upperLegR.tx = 0.44 * k;
    B.upperLegL.tx = -0.30 * k;
    B.lowerLegR.tx = -0.42 * k;
    B.lowerLegL.tx = -0.20 * k;
    B.footR.tx = 0.42 * k;
    B.footL.tx = 0.10;
    B.upperArmR.tx = -0.75 * k;
    B.upperArmL.tx = -0.55 * k;
    B.upperArmR.tz = 0.62 * k;
    B.upperArmL.tz = -0.70 * k;
    B.lowerArmR.tx = 0.55;
    B.lowerArmL.tx = 0.70;
    B.chest.tx = -0.16 * k;
    B.head.tx = 0.22 * k;
    if (isPivot) {
      B.hips.ty = this._lean * 0.35;
      B.chest.ty = -this._lean * 0.40;
    }
  }

  _poseCrouch(k) { this._poseCrouchOverlay(k); this._rootY -= 0.30 * k; }

  /** The crouch shape, reusable by crouchwalk and the pre-longjump frames. */
  _poseCrouchOverlay(k) {
    const B = this.B;
    B.upperLegR.tx = 0.92 * k; B.upperLegL.tx = 0.92 * k;
    B.upperLegR.tz = 0.22 * k; B.upperLegL.tz = -0.22 * k;
    B.lowerLegR.tx = -1.55 * k; B.lowerLegL.tx = -1.55 * k;
    B.footR.tx = 0.62 * k; B.footL.tx = 0.62 * k;
    B.spine.tx = 0.30 * k;
    B.chest.tx = 0.22 * k;
    B.head.tx = -0.34 * k;
    B.upperArmR.tx = 0.55 * k; B.upperArmL.tx = 0.55 * k;
    B.upperArmR.tz = 0.34 * k; B.upperArmL.tz = -0.34 * k;
    B.lowerArmR.tx = 1.05 * k; B.lowerArmL.tx = 1.05 * k;
  }

  /**
   * The jump family. 1 = tuck, 2 = knee raise + arm punch, 3 = a full forward
   * somersault whose rotation is driven to land on exactly one turn over the
   * measured air time (contract §13).
   */
  _poseJump(n, t) {
    const B = this.B;
    const rise = clamp01(t / 0.22);

    if (n === 1) {
      // tuck: knees up, arms swept back then forward
      B.upperLegR.tx = 0.75 * rise; B.upperLegL.tx = 0.52 * rise;
      B.lowerLegR.tx = -0.95 * rise; B.lowerLegL.tx = -0.62 * rise;
      B.footR.tx = 0.35; B.footL.tx = 0.28;
      B.upperArmR.tx = -0.95 * rise; B.upperArmL.tx = -0.95 * rise;
      B.upperArmR.tz = 0.42; B.upperArmL.tz = -0.42;
      B.lowerArmR.tx = 0.62; B.lowerArmL.tx = 0.62;
      B.spine.tx = -0.14 * rise;
      B.head.tx = -0.12 * rise;
      this._rootPitch = -0.10;
    } else if (n === 2) {
      // knee raise + a punch of the arms overhead
      B.upperLegR.tx = 1.35 * rise; B.upperLegL.tx = 0.30 * rise;
      B.lowerLegR.tx = -1.45 * rise; B.lowerLegL.tx = -0.35 * rise;
      B.footR.tx = 0.50; B.footL.tx = 0.18;
      B.upperArmR.tx = -2.15 * rise; B.upperArmL.tx = -2.15 * rise;
      B.upperArmR.tz = 0.26; B.upperArmL.tz = -0.26;
      B.lowerArmR.tx = 0.32; B.lowerArmL.tx = 0.32;
      B.spine.tx = -0.20 * rise;
      B.head.tx = 0.16 * rise;
      this._rootPitch = -0.16;
      this._rootRoll += 0.10;
    } else {
      // jump3: full somersault. Air time is the exact reach-table figure, so
      // the turn always completes a hair before the landing frame.
      const air = Math.max(0.35, this._jumpAirTime(3));
      const f = clamp01(t / air);
      this._flipPitch = TAU * smoothstep(0.02, 0.92, f);
      this._flipDecay = 0.35;
      const tuck = Math.sin(Math.PI * clamp01(f * 1.12));
      B.upperLegR.tx = 1.55 * tuck; B.upperLegL.tx = 1.45 * tuck;
      B.lowerLegR.tx = -2.05 * tuck; B.lowerLegL.tx = -2.05 * tuck;
      B.footR.tx = 0.55 * tuck; B.footL.tx = 0.55 * tuck;
      B.upperArmR.tx = 0.85 * tuck; B.upperArmL.tx = 0.85 * tuck;
      B.upperArmR.tz = 0.55; B.upperArmL.tz = -0.55;
      B.lowerArmR.tx = 1.75 * tuck; B.lowerArmL.tx = 1.75 * tuck;
      B.spine.tx = 0.42 * tuck;
      B.chest.tx = 0.30 * tuck;
      B.head.tx = -0.30 * tuck;
    }
  }

  /** Air time of a jump-family move, from the published reach table. */
  _jumpAirTime(n) {
    // The reach table is computed by tuning.js from the SAME numbers the
    // controller integrates, so this can never drift from what actually happens.
    const v0 = TUNE.jumpV[clamp(n - 1, 0, 2)];
    return (v0 / TUNE.gravRise) + (v0 / TUNE.gravFall);
  }

  /** Long jump: superman. Body flat, arms forward, legs trailing and together. */
  _poseLongJump(t) {
    const B = this.B;
    const k = smoothstep(0, 0.16, t);
    this._rootPitch = -0.95 * k;                   // nose down the arc
    this._rootY += 0.10 * k;
    B.upperArmR.tx = -2.55 * k; B.upperArmL.tx = -2.55 * k;
    B.upperArmR.tz = 0.10; B.upperArmL.tz = -0.10;
    B.lowerArmR.tx = 0.10 * k; B.lowerArmL.tx = 0.10 * k;
    B.handR.tx = 0.05; B.handL.tx = 0.05;
    B.upperLegR.tx = -0.40 * k; B.upperLegL.tx = -0.32 * k;
    B.upperLegR.tz = 0.10; B.upperLegL.tz = -0.10;
    B.lowerLegR.tx = -0.28 * k; B.lowerLegL.tx = -0.20 * k;
    B.footR.tx = -0.35 * k; B.footL.tx = -0.35 * k;
    B.spine.tx = -0.22 * k;
    B.chest.tx = -0.18 * k;
    B.head.tx = 0.42 * k;                          // eyes on the landing
  }

  /** Backflip: a full backward turn, tight tuck, arms crossed in. */
  _poseBackflip(t) {
    const B = this.B;
    const air = (TUNE.backflip.vy / TUNE.gravRise) + (TUNE.backflip.vy / TUNE.gravFall);
    const f = clamp01(t / Math.max(0.35, air));
    this._flipPitch = -TAU * smoothstep(0.02, 0.90, f);
    this._flipDecay = 0.35;
    const tuck = Math.sin(Math.PI * clamp01(f * 1.10));
    B.upperLegR.tx = 1.65 * tuck; B.upperLegL.tx = 1.65 * tuck;
    B.lowerLegR.tx = -2.15 * tuck; B.lowerLegL.tx = -2.15 * tuck;
    B.footR.tx = 0.60 * tuck; B.footL.tx = 0.60 * tuck;
    B.upperArmR.tx = 1.10 * tuck; B.upperArmL.tx = 1.10 * tuck;
    B.upperArmR.tz = 0.42; B.upperArmL.tz = -0.42;
    B.lowerArmR.tx = 2.05 * tuck; B.lowerArmL.tx = 2.05 * tuck;
    B.spine.tx = 0.36 * tuck;
    B.head.tx = -0.42 * tuck;
  }

  /** Sideflip: a cartwheel about the roll axis, in the direction of the flip. */
  _poseSideflip(t, player) {
    const B = this.B;
    const air = (TUNE.sideflip.vy / TUNE.gravRise) + (TUNE.sideflip.vy / TUNE.gravFall);
    const f = clamp01(t / Math.max(0.35, air));
    const dir = (player && numOr(player.flipDir, 0)) || (this._lean >= 0 ? 1 : -1);
    this._flipRoll = dir * TAU * smoothstep(0.02, 0.90, f);
    this._flipDecay = 0.35;
    const tuck = Math.sin(Math.PI * clamp01(f * 1.10));
    B.upperLegR.tx = 0.95 * tuck; B.upperLegL.tx = 1.35 * tuck;
    B.upperLegR.tz = 0.45 * tuck; B.upperLegL.tz = -0.20 * tuck;
    B.lowerLegR.tx = -1.35 * tuck; B.lowerLegL.tx = -1.75 * tuck;
    B.upperArmR.tx = -1.10 * tuck; B.upperArmL.tx = -1.10 * tuck;
    B.upperArmR.tz = 1.35 * tuck; B.upperArmL.tz = -1.35 * tuck;
    B.lowerArmR.tx = 0.45; B.lowerArmL.tx = 0.45;
    B.chest.tz = dir * 0.30 * tuck;
    B.head.tz = -dir * 0.28 * tuck;
  }

  /** Falling: arms up and out, legs reaching for the floor as speed builds. */
  _poseFall(vy) {
    const B = this.B;
    const f = clamp01(-vy / 22);
    B.upperArmR.tx = -1.15 - f * 0.55; B.upperArmL.tx = -1.15 - f * 0.55;
    B.upperArmR.tz = 0.60 + f * 0.35; B.upperArmL.tz = -0.60 - f * 0.35;
    B.lowerArmR.tx = 0.55; B.lowerArmL.tx = 0.55;
    B.upperLegR.tx = 0.34 - f * 0.30; B.upperLegL.tx = 0.10 - f * 0.20;
    B.lowerLegR.tx = -0.55 + f * 0.35; B.lowerLegL.tx = -0.28 + f * 0.20;
    B.footR.tx = 0.25 + f * 0.25; B.footL.tx = 0.20 + f * 0.25;
    B.spine.tx = -0.10 + f * 0.16;
    B.head.tx = -0.16 - f * 0.22;             // look down at the landing
    this._rootPitch = -0.06 + f * 0.22;
    // a slow air-flail roll so a long fall never freezes
    this._rootRoll += Math.sin(this._breathe * 2.1) * 0.06 * f;
  }

  /** Wing power glide — arms out, body level, legs trailing. */
  _poseFly(t) {
    const B = this.B;
    const beat = Math.sin(t * 7.0);
    B.upperArmR.tx = -1.45; B.upperArmL.tx = -1.45;
    B.upperArmR.tz = 1.15 + beat * 0.16; B.upperArmL.tz = -1.15 - beat * 0.16;
    B.lowerArmR.tx = 0.18; B.lowerArmL.tx = 0.18;
    B.upperLegR.tx = -0.28; B.upperLegL.tx = -0.22;
    B.lowerLegR.tx = -0.30; B.lowerLegL.tx = -0.24;
    B.spine.tx = -0.16;
    B.head.tx = 0.24;
    this._rootPitch = -0.42 + beat * 0.05;
    this._rootY += 0.06 + beat * 0.03;
  }

  /** Dive: belly-first, arms speared forward, legs straight behind. */
  _poseDive(t) {
    const B = this.B;
    const k = smoothstep(0, 0.12, t);
    this._rootPitch = -1.35 * k;
    this._rootY += 0.22 * k;
    this._rootZ += -0.06 * k;
    B.upperArmR.tx = -2.75 * k; B.upperArmL.tx = -2.75 * k;
    B.upperArmR.tz = 0.16; B.upperArmL.tz = -0.16;
    B.lowerArmR.tx = 0.06; B.lowerArmL.tx = 0.06;
    B.handR.tx = -0.20; B.handL.tx = -0.20;
    B.upperLegR.tx = -0.30 * k; B.upperLegL.tx = -0.30 * k;
    B.lowerLegR.tx = -0.22 * k; B.lowerLegL.tx = -0.34 * k;
    B.footR.tx = -0.45; B.footL.tx = -0.45;
    B.spine.tx = -0.26 * k;
    B.head.tx = 0.55 * k;
  }

  /** Belly slide: flat on the deck, one arm forward, one tucked, feet kicking. */
  _poseSlide(t) {
    const B = this.B;
    this._rootPitch = -1.50;
    this._rootY += -0.42;
    const kick = Math.sin(t * 12);
    B.upperArmR.tx = -2.60; B.upperArmL.tx = -1.95;
    B.upperArmR.tz = 0.22; B.upperArmL.tz = -0.55;
    B.lowerArmR.tx = 0.10; B.lowerArmL.tx = 1.05;
    B.upperLegR.tx = -0.18 + kick * 0.16; B.upperLegL.tx = -0.18 - kick * 0.16;
    B.lowerLegR.tx = -0.50 - kick * 0.30; B.lowerLegL.tx = -0.50 + kick * 0.30;
    B.footR.tx = -0.40; B.footL.tx = -0.40;
    B.spine.tx = -0.20;
    B.head.tx = 0.62;
  }

  /** Slide into a wall: a 0.25 s scramble back to the feet. */
  _poseSlideRecover(t) {
    const B = this.B;
    const f = clamp01(t / 0.25);
    this._rootPitch = lerp(-1.50, -0.20, f);
    this._rootY += lerp(-0.42, -0.05, f);
    B.upperArmR.tx = lerp(-2.60, -0.30, f); B.upperArmL.tx = lerp(-1.95, -0.30, f);
    B.upperArmR.tz = 0.45; B.upperArmL.tz = -0.45;
    B.lowerArmR.tx = 1.15; B.lowerArmL.tx = 1.15;
    B.upperLegR.tx = lerp(-0.18, 0.95, f); B.upperLegL.tx = lerp(-0.18, 0.55, f);
    B.lowerLegR.tx = lerp(-0.50, -1.30, f); B.lowerLegL.tx = lerp(-0.50, -0.90, f);
    B.spine.tx = lerp(-0.20, 0.28, f);
    B.head.tx = lerp(0.62, -0.10, f);
  }

  /**
   * Wall slide: brace against the wall. `player.wallN` is the wall's outward
   * normal, so the hero turns his back toward −wallN and reaches into it.
   */
  _poseWallslide(player) {
    const B = this.B;
    const n = player && player.wallN;
    // side of the body the wall is on, in hero-local space
    let side = 1;
    if (n && typeof n.x === 'number') {
      const f = this.root.rotation.y;
      const lx = Math.cos(f) * n.x - Math.sin(f) * n.z;
      side = lx >= 0 ? 1 : -1;
    }
    // index into the pre-resolved limb groups — no string building per frame
    const ni = side > 0 ? 0 : 1;
    const fi = side > 0 ? 1 : 0;
    const armNear = this._arms[ni], armFar = this._arms[fi];
    const legNear = this._legs[ni], legFar = this._legs[fi];

    this._rootRoll += side * 0.20;
    this._rootPitch = 0.12;
    armNear.ua.tx = -1.85;
    armNear.ua.tz = side * 1.15;
    armNear.la.tx = 0.35;
    armFar.ua.tx = -0.55;
    armFar.ua.tz = -side * 0.35;
    armFar.la.tx = 1.05;
    legNear.ul.tx = 0.55;
    legNear.ul.tz = side * 0.28;
    legNear.ll.tx = -0.95;
    legFar.ul.tx = -0.10;
    legFar.ll.tx = -0.30;
    B.footR.tx = 0.30; B.footL.tx = 0.30;
    B.chest.tz = side * 0.22;
    B.head.ty = side * 0.35;
    B.head.tx = -0.10;
  }

  /** Wall kick: the coil-and-release off the wall, arms thrown up. */
  _poseWallkick(t) {
    const B = this.B;
    const f = clamp01(t / 0.20);
    B.upperArmR.tx = lerp(-0.6, -2.35, f); B.upperArmL.tx = lerp(-0.6, -2.35, f);
    B.upperArmR.tz = lerp(0.9, 0.28, f); B.upperArmL.tz = lerp(-0.9, -0.28, f);
    B.lowerArmR.tx = 0.35; B.lowerArmL.tx = 0.35;
    B.upperLegR.tx = lerp(1.25, -0.25, f); B.upperLegL.tx = lerp(0.85, 0.30, f);
    B.lowerLegR.tx = lerp(-1.55, -0.20, f); B.lowerLegL.tx = lerp(-1.10, -0.45, f);
    B.footR.tx = 0.30; B.footL.tx = 0.30;
    B.spine.tx = lerp(0.22, -0.22, f);
    B.head.tx = lerp(-0.20, 0.14, f);
    this._rootPitch = lerp(0.20, -0.18, f);
  }

  /**
   * Pound hang: the whole body spins a full turn about yaw inside the 0.20 s
   * hang (contract §11) and cocks a fist over the head.
   */
  _posePoundHang(t) {
    const B = this.B;
    const f = clamp01(t / TUNE.pound.hang);
    this._flipYaw = TAU * smoothstep(0, 1, f);
    this._flipDecay = 0.25;
    B.upperLegR.tx = 1.15; B.upperLegL.tx = 1.15;
    B.lowerLegR.tx = -1.70; B.lowerLegL.tx = -1.70;
    B.footR.tx = 0.55; B.footL.tx = 0.55;
    B.upperArmR.tx = -2.45; B.upperArmL.tx = -2.45;
    B.upperArmR.tz = 0.55; B.upperArmL.tz = -0.55;
    B.lowerArmR.tx = 0.85; B.lowerArmL.tx = 0.85;
    B.spine.tx = 0.22;
    B.head.tx = -0.18;
    this._rootY += 0.10;
  }

  /**
   * Pound fall: a rigid spear driving at the floor. The previous version wrote
   * 7–20° from rest and measured 6.3° rms against a settled idle — the only
   * state in `posecheck` that collapsed into standing still, and the shots
   * showed Nim upright with his arms at his sides at −40 m/s.
   *
   * The read now: arms locked straight and swept BACK past the hips, fists
   * clenched, legs pressed together with the toes pointed hard, chest thrown
   * open and the head down watching the impact — a diving arrowhead whose
   * silhouette cannot be confused with anything else in the state table.
   */
  _posePoundFall(t) {
    const B = this.B;
    this._flipYaw *= 0.55;
    // a slow residual roll off the hang spin, so the fall is never dead-static
    const wob = Math.sin(t * 26) * 0.035;

    B.upperArmR.tx = -1.02 + wob; B.upperArmL.tx = -1.02 - wob;
    B.upperArmR.tz = 0.30; B.upperArmL.tz = -0.30;
    B.lowerArmR.tx = -0.26; B.lowerArmL.tx = -0.26;      // elbows locked out
    B.handR.tx = -0.50; B.handL.tx = -0.50;              // fists cocked back
    B.shoulderR.tz = -0.16; B.shoulderL.tz = 0.16;       // shoulders squeezed

    B.upperLegR.tx = -0.14; B.upperLegL.tx = -0.14;
    B.upperLegR.tz = -0.035; B.upperLegL.tz = 0.035;     // ankles together
    B.lowerLegR.tx = 0.10; B.lowerLegL.tx = 0.10;        // knees locked
    B.footR.tx = -0.78; B.footL.tx = -0.78;              // toes pointed

    B.spine.tx = -0.20; B.chest.tx = -0.14;              // chest thrown open
    B.neck.tx = 0.30; B.head.tx = 0.42;                  // watching the ground

    this._rootPitch = 0.13;
    this._rootY += 0.04;
  }

  /** Pound land: the shock crouch, then a fast pop back to standing. */
  _posePoundLand(t) {
    const B = this.B;
    const f = clamp01(t / 0.18);
    const k = 1 - f;
    this._poseCrouchOverlay(0.80 + k * 0.25);
    this._rootY -= 0.36 * (0.5 + k * 0.5);
    B.upperArmR.tx = -0.35 - k * 0.55; B.upperArmL.tx = -0.35 - k * 0.55;
    B.upperArmR.tz = 0.75 + k * 0.35; B.upperArmL.tz = -0.75 - k * 0.35;
    B.head.tx = -0.42 * (0.4 + k * 0.6);
  }

  /** Landing absorb. Hard landings drop further and take a hand to the floor. */
  _poseLand(t, hard) {
    const B = this.B;
    const dur = hard ? TUNE.hardLandLag : TUNE.landLag + 0.14;
    const f = clamp01(t / Math.max(0.06, dur));
    const k = (1 - f) * (hard ? 1.0 : 0.62);
    this._poseCrouchOverlay(0.35 + k * 0.62);
    this._rootY -= (0.10 + k * 0.24);
    B.upperArmR.tx = -0.20 - k * 1.10; B.upperArmL.tx = -0.20 - k * 0.55;
    B.upperArmR.tz = 0.40 + k * 0.45; B.upperArmL.tz = -0.40 - k * 0.30;
    B.lowerArmR.tx = 0.55 + k * 0.35; B.lowerArmL.tx = 0.85;
    if (hard) { B.chest.tx = 0.28 * k; B.head.tx = -0.44 * k; }
  }

  /** Slope slide: surfing stance, knees loaded, arms out for balance. */
  _poseSlopeSlide(horiz) {
    const B = this.B;
    const f = clamp01(horiz / TUNE.slope.maxSpeed);
    this._rootPitch = -0.22 - f * 0.18;
    this._rootRoll += this._lean * 0.30;
    this._rootY -= 0.16;
    B.upperLegR.tx = 0.72; B.upperLegL.tx = 0.42;
    B.upperLegR.tz = 0.28; B.upperLegL.tz = -0.20;
    B.lowerLegR.tx = -1.05; B.lowerLegL.tx = -0.70;
    B.footR.tx = 0.42; B.footL.tx = 0.30;
    B.upperArmR.tx = -0.95; B.upperArmL.tx = -0.95;
    B.upperArmR.tz = 1.05; B.upperArmL.tz = -1.05;
    B.lowerArmR.tx = 0.35; B.lowerArmL.tx = 0.35;
    B.spine.tx = 0.16;
    B.head.tx = 0.10;
  }

  /**
   * Swim. Surfaced: an alternating crawl stroke with a flutter kick.
   * Submerged: a frog kick — arms sweep together, legs snap and glide.
   */
  _poseSwim(submerged, idle) {
    const B = this.B;
    const t = this._breathe;
    if (idle) {
      // treading water
      const s = Math.sin(t * 2.4);
      this._rootPitch = -0.30;
      B.upperArmR.tx = -1.20 + s * 0.30; B.upperArmL.tx = -1.20 - s * 0.30;
      B.upperArmR.tz = 1.05; B.upperArmL.tz = -1.05;
      B.lowerArmR.tx = 0.75; B.lowerArmL.tx = 0.75;
      B.upperLegR.tx = 0.45 + s * 0.25; B.upperLegL.tx = 0.45 - s * 0.25;
      B.lowerLegR.tx = -0.75; B.lowerLegL.tx = -0.75;
      B.head.tx = 0.28;
      this._rootY += Math.sin(t * 1.6) * 0.03;
      return;
    }
    if (!submerged) {
      // front crawl
      const ph = t * 4.2;
      const s = Math.sin(ph), c = Math.sin(ph + Math.PI);
      this._rootPitch = -1.15;
      this._rootY += 0.18;
      B.upperArmR.tx = -1.55 - s * 1.35; B.upperArmL.tx = -1.55 - c * 1.35;
      B.upperArmR.tz = 0.35; B.upperArmL.tz = -0.35;
      B.lowerArmR.tx = 0.45 + clamp01(s) * 0.55; B.lowerArmL.tx = 0.45 + clamp01(c) * 0.55;
      B.upperLegR.tx = -0.15 + Math.sin(ph * 2) * 0.35;
      B.upperLegL.tx = -0.15 - Math.sin(ph * 2) * 0.35;
      B.lowerLegR.tx = -0.35; B.lowerLegL.tx = -0.35;
      B.footR.tx = -0.45; B.footL.tx = -0.45;
      B.chest.ty = s * 0.28;
      B.head.tx = 0.42; B.head.ty = s * 0.45;
      return;
    }
    // frog kick, submerged: pull, tuck, snap, glide
    const ph = (t * 2.1) % 1;
    const pull = smoothstep(0, 0.35, ph) * (1 - smoothstep(0.45, 0.75, ph));
    const kick = smoothstep(0.25, 0.55, ph) * (1 - smoothstep(0.60, 0.90, ph));
    this._rootPitch = -1.45;
    this._rootY += 0.20;
    B.upperArmR.tx = -2.45 + pull * 1.90; B.upperArmL.tx = -2.45 + pull * 1.90;
    B.upperArmR.tz = 0.20 + pull * 0.95; B.upperArmL.tz = -0.20 - pull * 0.95;
    B.lowerArmR.tx = 0.15 + pull * 0.55; B.lowerArmL.tx = 0.15 + pull * 0.55;
    B.upperLegR.tx = -0.20 + kick * 1.10; B.upperLegL.tx = -0.20 + kick * 1.10;
    B.upperLegR.tz = kick * 0.55; B.upperLegL.tz = -kick * 0.55;
    B.lowerLegR.tx = -0.15 - kick * 1.55; B.lowerLegL.tx = -0.15 - kick * 1.55;
    B.footR.tx = -0.40; B.footL.tx = -0.40;
    B.spine.tx = -0.10;
    B.head.tx = 0.35;
  }

  /** Climb: alternating reach up a pole / net, driven by height gained. */
  _poseClimb() {
    const B = this.B;
    const ph = this._dist * 3.4;
    const s = Math.sin(ph), c = Math.sin(ph + Math.PI);
    this._rootPitch = 0.08;
    B.upperArmR.tx = -2.35 - s * 0.55; B.upperArmL.tx = -2.35 - c * 0.55;
    B.upperArmR.tz = 0.30; B.upperArmL.tz = -0.30;
    B.lowerArmR.tx = 0.55 + clamp01(-s) * 0.75; B.lowerArmL.tx = 0.55 + clamp01(-c) * 0.75;
    B.upperLegR.tx = 0.55 + c * 0.45; B.upperLegL.tx = 0.55 + s * 0.45;
    B.upperLegR.tz = 0.30; B.upperLegL.tz = -0.30;
    B.lowerLegR.tx = -1.05 - clamp01(c) * 0.35; B.lowerLegL.tx = -1.05 - clamp01(s) * 0.35;
    B.footR.tx = 0.42; B.footL.tx = 0.42;
    B.chest.ty = s * 0.20;
    B.hips.ty = -s * 0.16;
    B.head.tx = 0.16;
  }

  /** Kicking off a pole: a hard push away with both legs. */
  _poseClimbKick(t) {
    const B = this.B;
    const f = clamp01(t / 0.22);
    B.upperArmR.tx = lerp(-2.35, -0.85, f); B.upperArmL.tx = lerp(-2.35, -0.85, f);
    B.upperArmR.tz = 0.75; B.upperArmL.tz = -0.75;
    B.lowerArmR.tx = 0.65; B.lowerArmL.tx = 0.65;
    B.upperLegR.tx = lerp(1.20, -0.30, f); B.upperLegL.tx = lerp(1.20, -0.30, f);
    B.lowerLegR.tx = lerp(-1.65, -0.15, f); B.lowerLegL.tx = lerp(-1.65, -0.15, f);
    B.spine.tx = lerp(0.28, -0.20, f);
    this._rootPitch = lerp(0.24, -0.16, f);
  }

  /** Loaded in a cannon: a tight ball, arms wrapped around the knees. */
  _poseCannon(t) {
    const B = this.B;
    this._poseCrouchOverlay(1.10);
    this._rootY -= 0.30;
    B.upperArmR.tx = 0.95; B.upperArmL.tx = 0.95;
    B.upperArmR.tz = 0.55; B.upperArmL.tz = -0.55;
    B.lowerArmR.tx = 1.95; B.lowerArmL.tx = 1.95;
    B.head.tx = -0.55;
    this._rootPitch = 0.22 + Math.sin(t * 18) * 0.03;      // fizzing on the fuse
  }

  /**
   * Dead: limp. Knees fold, arms drop, head lolls.
   *
   * The topple is a rotation about the HIPS (see `_applyRoot`), so the numbers
   * are the ones that put a 1.5 m body FLAT: −1.45 rad lays it prone with the
   * hips at the pivot height, and the 0.42 m drop then sets the torso down at
   * about its own half-thickness. The old −1.05 / −0.55 pair was tuned against
   * a rotation about the soles and buried the corpse in the terrain 2–3 m from
   * its own contact blob.
   */
  _poseDead(t) {
    const B = this.B;
    const f = clamp01(t / 0.45);
    this._rootPitch = -1.45 * f;
    this._rootRoll += 0.40 * f;
    this._rootY -= 0.42 * f;
    B.upperArmR.tx = -0.20 * f; B.upperArmL.tx = -0.10 * f;
    B.upperArmR.tz = 0.95 * f + 0.165; B.upperArmL.tz = -1.15 * f - 0.165;
    B.lowerArmR.tx = 0.30; B.lowerArmL.tx = 0.20;
    B.upperLegR.tx = 0.85 * f; B.upperLegL.tx = 0.45 * f;
    B.upperLegR.tz = 0.35 * f; B.upperLegL.tz = -0.15 * f;
    B.lowerLegR.tx = -1.35 * f; B.lowerLegL.tx = -0.75 * f;
    B.footR.tx = -0.20; B.footL.tx = -0.20;
    B.spine.tx = 0.30 * f;
    B.chest.tx = -0.15 * f;
    B.head.tx = 0.55 * f; B.head.tz = 0.35 * f;
  }

  /* ────────────────────────────── foot plant IK ────────────────────────────── */

  /**
   * Two-bone IK that keeps both boots on the ground plane implied by the
   * player's feet position and the ground normal.
   *
   * Runs as a POST pass on the blended rotations (`bone.o.rotation`), never on
   * the pose targets: the targets are damped at 14 /s, so a correction written
   * there arrives a frame and a half late and the boots swim through the floor
   * at run speed. This is the standard pose → blend → IK order.
   *
   * The plane is evaluated in RIG-LOCAL space: the rig origin is at the feet,
   * so the target height under a foot at (fx, fz) is simply the plane through
   * the origin with the (yaw-rotated) ground normal, corrected for the bob
   * offset and squash scale the rig is carrying this frame.
   */
  _applyFootPlant(dt) {
    const legs = this._legs;
    const a = this._anim;
    const off = !this._grounded ||
      a === 'slide' || a === 'dive' || a === 'dead' || a === 'cannon' ||
      a === 'swim' || a === 'swimIdle' || a === 'swimDive' || a === 'climb';
    if (off) {
      // release the foot lock smoothly — a snap on take-off is very visible
      legs[0].penY = damp(legs[0].penY, 0, 16, dt);
      legs[1].penY = damp(legs[1].penY, 0, 16, dt);
      return;
    }

    const w = clamp01(1 - this._speedN * 0.35) *
      (a === 'idle' || a === 'run' || a === 'crouchwalk' || a === 'crouch' || a === 'land' ||
        a === 'bonk' ? 1 : 0.45);
    if (w <= 0.01) return;

    // Per-leg CONTACT weight. Pinning the swing leg to the ground plane is
    // exactly how a run turns into a skate: only the planted foot gets IK.
    // Below a slow walk both feet are planted, so both get it in full.
    const moving = clamp01((this._speed - 0.35) / 1.2);
    const sp = Math.sin(this._phase);

    // ground normal into rig-local (root yaw only; rig lean is small enough
    // to ignore here and ignoring it keeps this allocation- and matrix-free)
    const f = this.root.rotation.y;
    const cf = Math.cos(f), sf = Math.sin(f);
    const nx = this._groundN.x, ny = Math.max(0.25, this._groundN.y), nz = this._groundN.z;
    const lnx = cf * nx - sf * nz;
    const lnz = sf * nx + cf * nz;

    const hipY = P.hipY - P.hipDrop;
    const l1 = P.upperLeg, l2 = P.lowerLeg;

    // The IK solves in UNSCALED rig-local metres, but the rig carries a bob
    // offset, a lean rotation AND a squash scale. Compensating only the offset
    // is not enough: a 0.16 rad forward lean alone drops a 0.62 m hip by 8 mm
    // and pushes the boots through the floor. Take the rig's real matrix and
    // invert its Y row, which handles all three exactly and for free.
    //   rootY = m10·x + m11·y + m12·z + m13   ⇒   y = (rootY − m10·x − m12·z − m13)/m11
    this.rig.updateMatrix();
    const e = this.rig.matrix.elements;
    const m10 = e[1], m12 = e[9], m13 = e[13];
    let m11 = e[5];
    if (Math.abs(m11) < 1e-4) m11 = 1;         // rig rotated flat on its side: bail to identity
    // the ankle rides `ankleY` above the sole, in the same unscaled space
    const soleY = P.ankleY;

    for (let i = 0; i < 2; i++) {
      const leg = this._legs[i];
      const s = leg.side;
      // the BLENDED rotations, not the targets — see the doc comment
      const ulr = leg.ul.o.rotation, llr = leg.ll.o.rotation, ftr = leg.ft.o.rotation;

      // contact: the R leg plants on the -sin half of the cycle, L on the +sin
      const contact = lerp(1, clamp01(-s * sp * 1.6 + 0.25), moving);
      const wl = w * contact;
      if (wl <= 0.01) continue;

      // where the animated pose put this foot, forward of the hip
      const fx = s * P.legX;
      const fz = Math.sin(ulr.x) * (l1 + l2) * 0.7;
      // Ground plane height in ROOT space under this foot. The foot's root-space
      // XZ is approximated by its rig-local XZ — on the steepest walkable slope
      // (slope.slideDeg = 38°) that costs at most a couple of millimetres, and
      // it keeps the solve to scalars.
      const groundY = -(lnx * fx + lnz * (-fz)) / ny;
      // ...expressed as the rig-local ankle height that lands the sole there,
      // plus the foot-lock feedback term measured from the real boot last frame
      const targetY = (groundY + leg.penY - m10 * fx - m12 * (-fz) - m13) / m11 + soleY;

      // Forward kinematics of the two-bone chain as the POSE currently has it.
      // Comparing this against the target is what lets the IK be a one-sided
      // ground CLAMP at speed instead of a hard lock that fights the run cycle.
      // 2 cm band, so any real penetration saturates to a FULL correction —
      // a proportional clamp leaves the boot permanently part-way through.
      const poseFootY = hipY - l1 * Math.cos(ulr.x) - l2 * Math.cos(ulr.x + llr.x);
      const pen = clamp01((targetY - poseFootY) / 0.02);

      // Standing and walking: full two-way plant, so a slope tilts the stance.
      // Running: only the penetration term, so the swing leg stays free and
      // nothing but an actual boot-through-floor gets corrected.
      // NOTE `pen` is deliberately NOT gated by `contact`: a swing foot must
      // stay out of the floor too, and penetration is penetration whatever the
      // cycle phase says. `contact` only shapes the two-way plant.
      const wEff = Math.max(wl * (1 - moving), pen);
      if (wEff <= 0.01) continue;

      solveLeg(hipY - targetY, fz, l1, l2);
      ulr.x = lerp(ulr.x, _ik.hip, wEff);
      llr.x = lerp(llr.x, _ik.knee, wEff);

      // ankle: lay the sole along the slope instead of stabbing it
      const slopeFwd = Math.atan2(-lnz, ny);
      const slopeSide = Math.atan2(lnx, ny);
      ftr.x = lerp(ftr.x, -(ulr.x + llr.x) + slopeFwd, wEff * 0.85);
      ftr.z = lerp(ftr.z, -slopeSide, wEff * 0.85);
      if (wEff > this._ikW) this._ikW = wEff;
    }

    this._clampSoles(dt);
  }

  /**
   * The sole clamp — the second half of the foot plant, and the half that
   * actually matters. The leg solve only knows where the ANKLE is; what the
   * player sees touching the floor is a 0.30 m boot whose toe and heel swing
   * ±70 mm as the ankle pitches through a run cycle.
   *
   * So: publish the pose, measure where the real toe and heel ended up, and
   *   1. LEVEL the boot toward the ground plane in proportion to the dig, which
   *      removes the dominant term immediately (this frame), and
   *   2. feed the residual back into each leg's `penY`, which the next frame's
   *      IK target lifts by. A closed loop, converging in about three frames —
   *      invisible at 60 fps, and it never fights the animation when the boot
   *      is already clear.
   *
   * Costs one extra `updateMatrixWorld` over the rig. That is ~35 matrix
   * multiplies; the pose is published again at the end of update() anyway.
   */
  _clampSoles(dt) {
    this.root.updateMatrixWorld(true);
    const rp = this.root.position;
    const n = this._groundN;
    const ny = Math.max(0.25, n.y);
    const legs = this._legs;

    for (let i = 0; i < 2; i++) {
      const leg = legs[i];
      const mw = leg.ft.o.matrixWorld;
      const ftr = leg.ft.o.rotation;

      // real world contact points of the boot, in foot-local metres
      _v0.set(0, -P.ankleY, -SOLE_TOE_Z).applyMatrix4(mw);
      _v1.set(0, -P.ankleY, SOLE_HEEL_Z).applyMatrix4(mw);

      // ground plane through the player's feet, world
      const gToe = rp.y - (n.x * (_v0.x - rp.x) + n.z * (_v0.z - rp.z)) / ny;
      const gHeel = rp.y - (n.x * (_v1.x - rp.x) + n.z * (_v1.z - rp.z)) / ny;
      const penToe = gToe - _v0.y;
      const penHeel = gHeel - _v1.y;
      const pen = Math.max(penToe, penHeel);

      if (pen > 0.002) {
        // 1. level: rotate the ankle toward flat, hardest on the digging end
        const k = clamp01(pen / 0.03);
        const slopeFwd = Math.atan2(-(Math.sin(this.root.rotation.y) * n.x + Math.cos(this.root.rotation.y) * n.z), ny);
        const legX = leg.ul.o.rotation.x + leg.ll.o.rotation.x;
        ftr.x = lerp(ftr.x, -legX + slopeFwd, k);
        // 2. feed the residual into the next frame's IK target
        leg.penY = clamp(leg.penY + pen, 0, 0.20);
        if (k > this._ikW) this._ikW = k;
      } else {
        // clear of the floor: bleed the lock off so it cannot accumulate
        leg.penY = damp(leg.penY, 0, 7, dt);
      }
    }
  }

  /* ──────────────────────────────── the face ──────────────────────────────── */

  /**
   * Blink on a 3–5 s random cadence, and look toward the turn. Both are pure
   * transform work on two pivots — no material churn, no texture swap.
   */
  _updateFace(dt, anim) {
    // blink
    this._blinkT -= dt;
    if (this._blinkT <= 0) {
      this._blink = BLINK_TIME;
      this._blinkT = BLINK_MIN + this._rng() * (BLINK_MAX - BLINK_MIN);
    }
    let closed = 0;
    if (this._blink > 0) {
      this._blink -= dt;
      const f = clamp01(1 - this._blink / BLINK_TIME);
      closed = Math.sin(Math.PI * f);          // down and back up
    }
    // dead / hard land: eyes squeezed shut, no random blink needed
    if (anim === 'dead') closed = 1;
    else if (anim === 'hardLand' || anim === 'poundLand') closed = Math.max(closed, 0.75);

    const open = 1 - closed * 0.94;
    this._eyePivot.scale.set(1, open, 1);
    this._eyePivot.position.y = -P.headR * 0.06 - closed * 0.012;

    // look toward the turn direction, with a little vertical from pitch
    const wantX = clamp(this._lean, -1, 1) * 0.42 + this._lookYaw * 0.55;
    const wantY = clamp(-this._rootPitch * 0.8, -0.5, 0.5);
    this._pupilX = damp(this._pupilX, wantX, 11, dt);
    this._pupilY = damp(this._pupilY, wantY, 11, dt);
    this._pupilPivot.rotation.set(this._pupilY * 0.30, this._pupilX * 0.34, 0);
    this._pupilPivot.position.set(this._pupilX * 0.012, this._pupilY * 0.008, 0);
  }

  /* ─────────────────────────────── the scarf ─────────────────────────────── */

  /**
   * 7-link Verlet chain, simulated in WORLD space, drawn in root-local space.
   * The world→local step is a hand-rolled inverse of (translate + yaw) — the
   * rig's squash must NOT reach the cloth, so the full matrix inverse would be
   * wrong even if it were free.
   */
  _updateScarf(dt, vx, vy, vz, facing) {
    const N = SCARF_LINKS + 1;
    const p = this._scarfP;
    const q = this._scarfPrev;

    // anchor at the collar, in world space
    _v0.setFromMatrixPosition(this.bones.neck.matrixWorld);
    const ax = _v0.x, ay = _v0.y + 0.04, az = _v0.z;

    if (!this._scarfInit) {
      for (let i = 0; i < N; i++) {
        p[i * 3] = ax; p[i * 3 + 1] = ay - i * SCARF_SEG; p[i * 3 + 2] = az;
        q[i * 3] = p[i * 3]; q[i * 3 + 1] = p[i * 3 + 1]; q[i * 3 + 2] = p[i * 3 + 2];
      }
      this._scarfInit = true;
    }

    // If the hero teleported (respawn, checkpoint, painting entry) the chain
    // would whip across the level. Snap it home instead.
    const dx0 = p[0] - ax, dy0 = p[1] - ay, dz0 = p[2] - az;
    if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > 9) {
      for (let i = 0; i < N; i++) {
        p[i * 3] = ax; p[i * 3 + 1] = ay - i * SCARF_SEG; p[i * 3 + 2] = az;
        q[i * 3] = p[i * 3]; q[i * 3 + 1] = p[i * 3 + 1]; q[i * 3 + 2] = p[i * 3 + 2];
      }
    }

    // wind: the hero's own motion, plus a slow gust so a standing scarf lives
    const gust = Math.sin(this._breathe * 0.9) * 0.55 + Math.sin(this._breathe * 2.3) * 0.25;
    const drape = 1.35 * (1 - this._speedN);
    const wx = -vx * SCARF_WIND * 9 + gust * 0.45 + Math.cos(facing) * drape;
    const wy = -vy * SCARF_WIND * 3.2 + gust * 0.20;
    const wz = -vz * SCARF_WIND * 9 + gust * 0.35 - Math.sin(facing) * drape;

    const h = Math.min(dt, 1 / 45);
    const h2 = h * h;

    // A travelling ripple, phase-offset down the chain. Without it a strong
    // wind term drives every particle the same way and an inextensible chain
    // becomes a straight rod pointing downwind — the "rigid blade" read.
    const flut = 0.55 + this._speedN * 2.6;
    const flutT = this._breathe * 9.5;

    // integrate
    for (let i = 1; i < N; i++) {
      const o = i * 3;
      const px = p[o], py = p[o + 1], pz = p[o + 2];
      let ivx = (px - q[o]) * SCARF_DAMP;
      let ivy = (py - q[o + 1]) * SCARF_DAMP;
      let ivz = (pz - q[o + 2]) * SCARF_DAMP;
      // tip links are lighter, so they trail further
      const light = 0.7 + (i / N) * 0.6;
      const rip = Math.sin(flutT - i * 1.35) * flut * (i / N);
      ivx += (wx + rip * 0.9) * h2 * light * 14;
      ivy += (SCARF_GRAVITY + wy + rip * 1.6) * h2 * 14;
      ivz += (wz - rip * 0.9) * h2 * light * 14;
      q[o] = px; q[o + 1] = py; q[o + 2] = pz;
      p[o] = px + ivx; p[o + 1] = py + ivy; p[o + 2] = pz + ivz;
    }
    // the collar link is pinned
    p[0] = ax; p[1] = ay; p[2] = az;
    q[0] = ax; q[1] = ay; q[2] = az;

    /*
     * RELAX. Order and gain both matter, and both were wrong: the body push-out
     * ran AFTER the length pass inside the same iteration, so the LAST thing
     * done to the chain every pass was to re-break the segment lengths — and
     * the length pass itself only applied half the correction (×0.5), twice.
     * Measured result: a 0.105 m link reaching 0.455 m (433 %) and a 0.735 m
     * scarf spanning 1.61 m at a 9 m/s run. That is not cloth, it is an elastic
     * band, and it rendered as a rigid blade and as a detached floating shard.
     *
     * Now: push out of the body FIRST, then project the lengths at full gain,
     * so the length constraint is always the last word.
     */
    _v1.setFromMatrixPosition(this.bones.chest.matrixWorld);
    const iters = this.q === 0 ? 4 : 8;
    const bodyR2 = SCARF_BODY_R * SCARF_BODY_R;
    for (let k = 0; k < iters; k++) {
      // body sphere: the scarf may never sink into the coat
      for (let i = 1; i < N; i++) {
        const o = i * 3;
        const ex = p[o] - _v1.x, ey = p[o + 1] - _v1.y, ez = p[o + 2] - _v1.z;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 < bodyR2 && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = (SCARF_BODY_R - d) / d;
          p[o] += ex * push; p[o + 1] += ey * push; p[o + 2] += ez * push;
        }
      }
      for (let i = 0; i < SCARF_LINKS; i++) {
        const a = i * 3, b = (i + 1) * 3;
        let ddx = p[b] - p[a], ddy = p[b + 1] - p[a + 1], ddz = p[b + 2] - p[a + 2];
        const len = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) || 1e-6;
        const corr = (len - SCARF_SEG) / len;
        ddx *= corr; ddy *= corr; ddz *= corr;
        // the collar particle is pinned, so link 0 takes its whole correction
        // on the far end
        if (i > 0) {
          p[a] += ddx * 0.5; p[a + 1] += ddy * 0.5; p[a + 2] += ddz * 0.5;
          p[b] -= ddx * 0.5; p[b + 1] -= ddy * 0.5; p[b + 2] -= ddz * 0.5;
        } else {
          p[b] -= ddx; p[b + 1] -= ddy; p[b + 2] -= ddz;
        }
      }
      p[0] = ax; p[1] = ay; p[2] = az;
    }

    /*
     * INEXTENSIBILITY, guaranteed. Gauss–Seidel converges toward the length
     * constraint but never reaches it, and a scarf that stretches even 20 %
     * reads as rubber. One follow-the-leader pass from the pinned collar
     * outward clamps every link to AT MOST its rest length — O(7), no
     * allocation, and it makes 100 % the hard ceiling on stretch rather than a
     * number that depends on how violent the frame was.
     */
    for (let i = 1; i < N; i++) {
      const a = (i - 1) * 3, b = i * 3;
      const ddx = p[b] - p[a], ddy = p[b + 1] - p[a + 1], ddz = p[b + 2] - p[a + 2];
      const len = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      if (len > SCARF_SEG && len > 1e-6) {
        const s = SCARF_SEG / len;
        p[b] = p[a] + ddx * s;
        p[b + 1] = p[a + 1] + ddy * s;
        p[b + 2] = p[a + 2] + ddz * s;
      }
    }

    this._writeScarfGeometry(ax, ay, az, facing);
  }

  /**
   * Rebuild the ribbon in place. World points are converted to root-local by
   * subtracting the root position and un-rotating by facing (root has no other
   * transform — see the class header).
   */
  _writeScarfGeometry(ax, ay, az, facing) {
    const N = SCARF_LINKS + 1;
    const p = this._scarfP;
    const pos = this._scarfPos;
    const nor = this._scarfNor;
    const rp = this.root.position;
    const cf = Math.cos(-facing), sf = Math.sin(-facing);

    // hero-local "right" used to break the degenerate case of a vertical scarf
    const rx = cf * 1 + sf * 0, rz = -sf * 1 + cf * 0;

    // build local-space centreline into scratch, one link at a time
    let px0 = 0, py0 = 0, pz0 = 0;
    let sx0 = 0, sy0 = 0, sz0 = 0;
    let nx0 = 0, ny0 = 0, nz0 = 0;
    let have = false;

    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const wx = p[o] - rp.x, wy = p[o + 1] - rp.y, wz = p[o + 2] - rp.z;
      // Ry(-facing) * (wx, wy, wz)
      const lx = cf * wx + sf * wz;
      const ly = wy;
      const lz = -sf * wx + cf * wz;

      // tangent (toward the next point; reuse the previous for the tip)
      let tx = 0, ty = -1, tz = 0;
      if (i < N - 1) {
        const o2 = (i + 1) * 3;
        const wx2 = p[o2] - rp.x, wy2 = p[o2 + 1] - rp.y, wz2 = p[o2 + 2] - rp.z;
        tx = (cf * wx2 + sf * wz2) - lx;
        ty = wy2 - ly;
        tz = (-sf * wx2 + cf * wz2) - lz;
      } else if (have) {
        tx = lx - px0; ty = ly - py0; tz = lz - pz0;
      }
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;

      // side = tangent × up, falling back to hero-right when vertical
      let sx = ty * 0 - tz * 1, sy = tz * 0 - tx * 0, sz = tx * 1 - ty * 0;
      let sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (sl < 0.08) { sx = rx; sy = 0; sz = rz; sl = Math.sqrt(sx * sx + sz * sz) || 1; }
      sx /= sl; sy /= sl; sz /= sl;

      // normal = side × tangent
      const nx = sy * tz - sz * ty;
      const ny = sz * tx - sx * tz;
      const nz = sx * ty - sy * tx;

      const w = lerp(SCARF_W0, SCARF_W1, i / (N - 1));

      if (have) {
        // Emit the quad between the previous ring and this one, written
        // straight into the typed arrays — an intermediate [] per link per
        // frame would be 14 heap allocations a frame for nothing.
        const oi = (i - 1) * 18;
        const w0 = lerp(SCARF_W0, SCARF_W1, (i - 1) / (N - 1));

        const a0x = px0 - sx0 * w0, a0y = py0 - sy0 * w0, a0z = pz0 - sz0 * w0;
        const a1x = px0 + sx0 * w0, a1y = py0 + sy0 * w0, a1z = pz0 + sz0 * w0;
        const b0x = lx - sx * w, b0y = ly - sy * w, b0z = lz - sz * w;
        const b1x = lx + sx * w, b1y = ly + sy * w, b1z = lz + sz * w;

        // tri A: a0, a1, b1
        pos[oi] = a0x; pos[oi + 1] = a0y; pos[oi + 2] = a0z;
        pos[oi + 3] = a1x; pos[oi + 4] = a1y; pos[oi + 5] = a1z;
        pos[oi + 6] = b1x; pos[oi + 7] = b1y; pos[oi + 8] = b1z;
        // tri B: a0, b1, b0
        pos[oi + 9] = a0x; pos[oi + 10] = a0y; pos[oi + 11] = a0z;
        pos[oi + 12] = b1x; pos[oi + 13] = b1y; pos[oi + 14] = b1z;
        pos[oi + 15] = b0x; pos[oi + 16] = b0y; pos[oi + 17] = b0z;

        nor[oi] = nx0; nor[oi + 1] = ny0; nor[oi + 2] = nz0;
        nor[oi + 3] = nx0; nor[oi + 4] = ny0; nor[oi + 5] = nz0;
        nor[oi + 6] = nx; nor[oi + 7] = ny; nor[oi + 8] = nz;
        nor[oi + 9] = nx0; nor[oi + 10] = ny0; nor[oi + 11] = nz0;
        nor[oi + 12] = nx; nor[oi + 13] = ny; nor[oi + 14] = nz;
        nor[oi + 15] = nx; nor[oi + 16] = ny; nor[oi + 17] = nz;
      }

      px0 = lx; py0 = ly; pz0 = lz;
      sx0 = sx; sy0 = sy; sz0 = sz;
      nx0 = nx; ny0 = ny; nz0 = nz;
      have = true;
    }

    const g = this.scarfMesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    void ax; void ay; void az;
  }

  /* ──────────────────────────── powers and fade ──────────────────────────── */

  _updateWings(dt, anim) {
    if (this.power !== 'wing') return;
    this._wingT += dt;
    const flap = anim === 'fly' || !this._grounded;
    const beat = Math.sin(this._wingT * (flap ? 11 : 2.2));
    for (let i = 0; i < this.wings.length; i++) {
      const s = i === 0 ? 1 : -1;
      const w = this.wings[i];
      w.rotation.z = s * (0.30 + beat * (flap ? 0.55 : 0.10));
      w.rotation.x = beat * 0.12;
      w.scale.setScalar(0.92 + beat * 0.06);
    }
    this.M.wing.opacity = this.M.wing.userData.baseOpacity * (0.7 + Math.abs(beat) * 0.3);
  }

  /**
   * `player.heroFade` is the FADE AMOUNT, not the opacity: 0 = solid, 1 = fully
   * hidden. That is the convention both producers use — FollowCamera writes
   * `fade = 1` for peek (which must hide the hero completely, since peek is a
   * first-person view from `headPos`) and `0` at full camera distance, and
   * Player initialises the field to 0 meaning "solid". Reading it as an opacity
   * made Nim 100 % invisible at spawn in both the Keep and verdant-1.
   * Opacity is therefore `1 - heroFade`; the vanish power multiplies it.
   * Materials are only touched when the value actually moves.
   */
  _updateFade(player) {
    let want = 1 - clamp01(numOr(player ? player.heroFade : 0, 0));
    if (this.power === 'vanish') want *= 0.40;
    this._fade = want;
    if (Math.abs(this._fade - this._fadeApplied) < 0.004) return;
    this._fadeApplied = this._fade;

    const solid = this._fade >= 0.995;
    for (let i = 0; i < this._mats.length; i++) {
      const m = this._mats[i];
      if (m === this.M.wing) continue;                  // additive, own opacity
      const base = numOr(m.userData.baseOpacity, 1);
      const o = base * this._fade;
      m.opacity = o;
      const wantTrans = !solid || base < 1;
      if (m.transparent !== wantTrans) { m.transparent = wantTrans; m.needsUpdate = true; }
      m.depthWrite = o > 0.62;
    }
    // fully faded: stop drawing entirely rather than paying for 26 invisible meshes
    this.rig.visible = this._fade > 0.02;
    this.scarfMesh.visible = this._fade > 0.02;
  }

  /* ───────────────────────────────── teardown ───────────────────────────────── */

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    this.shadowBlob.dispose();
    for (let i = 0; i < this._geos.length; i++) {
      const g = this._geos[i];
      if (g && g.dispose) g.dispose();
    }
    for (let i = 0; i < this._mats.length; i++) {
      const m = this._mats[i];
      if (m && m.dispose) m.dispose();
    }
    this._geos.length = 0;
    this._mats.length = 0;
    this._meshes.length = 0;
    if (Hero.last === this) Hero.last = null;
  }
}

/** The most recently constructed Hero — the harness hook binds to this. */
Hero.last = null;

/**
 * Harness surface (contract §13 / the gates). Read-only snapshots; safe to call
 * from `python _harness/*` through `CRESTBOUND.game.hero`.
 *
 *   Hero.__test.bones()  -> {name: {x,y,z, wx,wy,wz}}  local euler + world pos
 *   Hero.__test.pose()   -> {anim, animT, phase, speed, squash, flip…, ik, fade}
 */
Hero.__test = {
  bones(hero) {
    const h = hero || Hero.last;
    if (!h) return null;
    const out = {};
    for (let i = 0; i < h._bones.length; i++) {
      const b = h._bones[i];
      _v0.setFromMatrixPosition(b.o.matrixWorld);
      out[b.name] = {
        x: +b.o.rotation.x.toFixed(4),
        y: +b.o.rotation.y.toFixed(4),
        z: +b.o.rotation.z.toFixed(4),
        wx: +_v0.x.toFixed(4), wy: +_v0.y.toFixed(4), wz: +_v0.z.toFixed(4),
      };
    }
    return out;
  },
  pose(hero) {
    const h = hero || Hero.last;
    if (!h) return null;
    return {
      anim: h._anim,
      animT: +h._animT.toFixed(4),
      phase: +h._phase.toFixed(4),
      dist: +h._dist.toFixed(3),
      speed: +h._speed.toFixed(3),
      speedN: +h._speedN.toFixed(3),
      grounded: h._grounded,
      squash: +h._squash.toFixed(4),
      flipPitch: +h._flipPitch.toFixed(4),
      flipRoll: +h._flipRoll.toFixed(4),
      flipYaw: +h._flipYaw.toFixed(4),
      lean: +h._lean.toFixed(4),
      ik: +h._ikW.toFixed(3),
      blink: +h._blink.toFixed(3),
      fade: +h._fade.toFixed(3),
      power: h.power,
      theme: h.themeId,
      meshes: h._meshes.length,
      scarfTip: [
        +h._scarfP[SCARF_LINKS * 3].toFixed(3),
        +h._scarfP[SCARF_LINKS * 3 + 1].toFixed(3),
        +h._scarfP[SCARF_LINKS * 3 + 2].toFixed(3),
      ],
      shadow: {
        visible: h.shadowBlob.mesh.visible,
        opacity: +h.shadowBlob._op.toFixed(3),
        y: +h.shadowBlob.mesh.position.y.toFixed(3),
      },
    };
  },
};

export default Hero;
