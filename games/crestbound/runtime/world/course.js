/**
 * CRESTBOUND — runtime/world/course.js
 * ---------------------------------------------------------------------------
 * THE COURSE COMPILER.  CONTRACT §24.
 *
 * A course definition (runtime/data/courses/*.js, or runtime/data/keep.js for
 * the hub) is plain data.  This module turns it into a playable, performant
 * OPEN DIORAMA:
 *
 *   - validates the def with errors that name the offending object AND its kind
 *   - builds terrain (world/terrain.js) and its Heightfield, water bodies
 *     (world/water.js) and their swim Volumes
 *   - dispatches every static kind to world/builders.js — the Ascendant family
 *     (platform / beam / deco / text / light) plus the CRESTBOUND additions
 *     (ramp, stairs, tree, pole, net, bridge, painting, gatedoor, pedestal,
 *     fence, rock, cannon, rings, building)
 *   - dispatches every dynamic kind to hazards/index.js `makeHazard`
 *   - builds critters (entities/critters.js) and the collectible set
 *     (entities/collectibles.js: coins, 8 sigils, 7 crests)
 *   - builds checkpoint stations: a chamfered pad, a glowing ring, an
 *     activation shockwave, a slow-turning glyph, a pillar of light, and a
 *     `Volume` of kind 'checkpoint' carrying its index — each pad pulses on its
 *     own seeded phase, so two pads in one frame never read as one
 *   - builds THE KEEP's gates (painting / door / glass) into `Course.gates`,
 *     each with its art, its trigger volume and a lock state Game can flip
 *   - builds power hats (`def.powers`) and emits `power(id, seconds)`
 *   - bakes static art into per-chunk, per-material merged meshes over a 24 m
 *     grid across `def.bounds`, instances decor through world/props.js, and
 *     culls those chunks itself (distance + frustum) every frame
 *   - owns the deterministic COURSE CLOCK.  Hazards are a pure function of it,
 *     and `resetFrom(cp)` rewinds it to that checkpoint's `clockOffset`, so a
 *     gauntlet presents an identical phase on every attempt.  That is what
 *     makes CRESTBOUND learnable instead of lucky.
 *
 * OWNERSHIP.  The Course DETECTS and PRESENTS.  It lights its own pads, opens
 * its own gates, spins its own hazards — and then emits an event.  It never
 * writes the save, never plays a stinger, never touches the HUD: `game.js`
 * subscribes to `course.events` and does all of that exactly once.  One owner,
 * always.
 *
 * PERFORMANCE LAWS honoured here (contract hard rules 4 + 5):
 *   - zero heap allocation below `update()` — every vector, box and colour used
 *     per frame is a module-scope scratch hoisted above the class
 *   - the light budget is a FIXED pool of PointLights allocated before the
 *     first render and never grown: adding a light to a live scene re-keys
 *     three.js' program cache and recompiles every material in the scene
 *   - static art merges per (chunk, material); shared geometry out of builders'
 *     GeoCache (`userData.__shared`) is cloned, never consumed, never disposed
 *   - one course load is a single pass; no material is cloned per object
 *
 * Heritage: ported by transliteration from `games/ascendant/runtime/world/
 * stage.js` — the chunking, the merge, the light pool, the glow field, the
 * checkpoint instancing and the determinism contract are that module's, proven
 * over four Ascendant worlds.  Generalised here from a linear +X stage to an
 * open diorama bounded by `def.bounds`, and extended with terrain, water,
 * critters, collectibles, gates and powers.
 * ---------------------------------------------------------------------------
 */

import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';

import * as UtilMod from '../core/util.js';
import * as SettingsMod from '../core/settings.js';
import * as ColliderMod from './collider.js';
import * as MatsMod from './materials.js';
import * as ThemesMod from './themes.js';
import * as Builders from './builders.js';
import * as PropsMod from './props.js';
import * as TerrainMod from './terrain.js';
import * as WaterMod from './water.js';
import * as HazardLib from '../hazards/index.js';
import * as CollectiblesMod from '../entities/collectibles.js';
import * as CrittersMod from '../entities/critters.js';

/* ── dependency handles ─────────────────────────────────────────────────────
 * Namespace imports throughout: a sibling that ships a symbol late produces one
 * loud, actionable message from `_assertDeps()` instead of a cryptic
 * "undefined is not a constructor" three call frames deep.
 */
const clamp = UtilMod.clamp;
const damp = UtilMod.damp;
const mulberry32 = UtilMod.mulberry32;
const Emitter = UtilMod.Emitter;

const Settings = SettingsMod.Settings;
const QUALITY = SettingsMod.QUALITY;

const Collider = ColliderMod.Collider;
const KillVolume = ColliderMod.KillVolume;
const Volume = ColliderMod.Volume;
const Broadphase = ColliderMod.Broadphase;

const THEMES = ThemesMod.THEMES;
const mergeGeometries = BGU.mergeGeometries || BGU.mergeBufferGeometries;

/* ===========================================================================
 * Compiler tunables
 * ======================================================================== */

/** Contract §24: a 24 m grid over `def.bounds`. */
const CHUNK_SIZE = 24;
/**
 * Hard ceiling on chunk count — the cell GROWS rather than the draw calls.
 *
 * Every chunk costs one merged draw per material it contains, and an open
 * diorama fits inside one frustum, so a fine grid buys almost no culling while
 * multiplying the static-art draw calls by the chunk count.  Measured on
 * verdant-1 (144 x 144 m): a 24 m grid produced 21 chunks / 196 merged draws,
 * every one of them inside the frustum.  The perf gate allows 260 draws for the
 * WHOLE frame, so the static art gets a small fraction of that: 12 cells is the
 * most a course may spend before the cell is widened.
 */
const MAX_CHUNKS = 4;
/** Beyond this from the feet a hazard's VISUAL is skipped (never its simulation). */
const HAZARD_VIS_DIST = 90;
/** Chunks nearer than this stay visible off-screen so their shadows keep casting. */
const SHADOW_KEEP = 34;
const MAX_TEXT = 48;
const MAX_LIGHT_SITES = 96;

/* ── the light budget ───────────────────────────────────────────────────────
 * A `kind:'light'` object is a light SITE, not a THREE.PointLight.  Every site
 * gets a visible emissive bulb, a soft additive halo and a pool of light on the
 * floor beneath it — all baked into ONE extra draw call for the whole course
 * (`_buildGlowField`).  Only LIGHT_POOL_SIZE real PointLights ever exist; they
 * are allocated once, before the first render, and the per-frame budget only
 * ever MOVES and re-tints them.
 *
 * Never add or remove a light from a live scene: three.js keys its program
 * cache on the light counts, so a light appearing mid-run recompiles every
 * material in the scene and the frame hitches.  That is also why an unused slot
 * sits at intensity 0 rather than `visible = false` — an invisible light is
 * dropped from the render list, which changes the count, which is the same
 * recompile by another route.
 */
const LIGHT_POOL_SIZE = 6;
const LIGHT_FADE_IN = 5.0;    // 1/s
const LIGHT_FADE_OUT = 9.0;   // 1/s — a slot reaches 0 before it re-targets
const LIGHT_SELECT_HZ = 0.2;  // s between re-selections
/**
 * Clutter under this world radius never casts: a full extra shadow draw for a
 * sub-pixel blob.  The shadow pass is a SECOND full render of every caster, so
 * this threshold is the cheapest lever there is on both draws and triangles.
 */
/**
 * Default world bounding radius below which a mesh stops casting a shadow.
 * The active QUALITY preset's `shadowCasterRadius` overrides it per tier
 * (settings.js); this constant is the value HIGH still uses, so making it a
 * tier knob changed nothing about how HIGH looks.
 */
const SHADOW_MIN_RADIUS = 1.5;

/** Hazards that are course-spanning: never distance-cull their visuals. */
const NEVER_CULL = new Set(['chase', 'risinglava', 'wind', 'current', 'lava']);

/** Kinds this compiler hands to builders.js, and the export that owns each. */
const BUILDER_ROUTE = Object.freeze({
  platform: 'buildPlatform',
  beam: 'buildBeam',
  pad: 'buildPad',
  pillar: 'buildPillar',
  wall: 'buildWall',
  arch: 'buildArch',
  ring: 'buildRing',
  ramp: 'buildRamp',
  stairs: 'buildStairs',
  tree: 'buildTree',
  pole: 'buildPole',
  net: 'buildNet',
  bridge: 'buildBridge',
  painting: 'buildPainting',
  gatedoor: 'buildGateDoor',
  pedestal: 'buildPedestal',
  fence: 'buildFence',
  rock: 'buildRock',
  cannon: 'buildCannon',
  building: 'buildBuilding',
  deco: 'buildDeco',
});

/** Kinds the Course itself owns end-to-end (never routed out). */
const COURSE_KINDS = Object.freeze({ terrain: 1, water: 1, text: 1, light: 1 });

/** Climbable kinds: a ladder Volume is synthesised when the builder ships none. */
const CLIMB_KINDS = Object.freeze({ pole: 1, net: 1, tree: 1 });

/** How far a gate's walk-in trigger reaches OUT of the frame, into the room.
 *  The wall collider stops Nim ~0.38 m (his radius) short of the picture plane,
 *  so anything shallower than that can never contain his feet. */
const GATE_TRIGGER_DEPTH = 1.35;

/* ── module-scope scratch — NO per-frame allocation below this line ──────── */
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const _box1 = new THREE.Box3();
const _frustum = new THREE.Frustum();
const _projScreen = new THREE.Matrix4();
const _colScratch = new THREE.Color();
/** Borrowed only to convert an authored `rot` into a quaternion at build time. */
const _eulerHolder = new THREE.Object3D();

/* ===========================================================================
 * Small pure helpers
 * ======================================================================== */

function fin(n) { return typeof n === 'number' && Number.isFinite(n); }

/* Deliberately NOT `fin(+a[0])`: unary + coerces null/''/[] to 0, which would
 * let an authoring typo through as a silent (0,0,0).  Require real numbers. */
function fin3(a) {
  return Array.isArray(a) && a.length >= 3 && fin(a[0]) && fin(a[1]) && fin(a[2]);
}

/* A ring/arc CENTRE may be authored as [x, z] with the height carried by the
 * sibling `y` field (CONTRACT §25 lists `c` and `y` side by side, which only
 * makes sense if `y` is the height), or as a full [x, y, z]. Accept both.
 * entities/collectibles.js resolves the same two shapes. */
function finCentre(a) {
  if (!Array.isArray(a)) return false;
  if (a.length === 2) return fin(a[0]) && fin(a[1]);
  return fin3(a);
}

function v3(a, dx, dy, dz) {
  if (Array.isArray(a) && a.length >= 3) return new THREE.Vector3(+a[0], +a[1], +a[2]);
  if (a && typeof a === 'object' && fin(a.x)) return new THREE.Vector3(a.x, a.y, a.z);
  return new THREE.Vector3(dx || 0, dy || 0, dz || 0);
}

/** `rot` may be authored in radians or degrees; > 2π on any axis means degrees. */
function applyRot(obj, rot) {
  if (typeof rot === 'number' && fin(rot)) { obj.rotation.set(0, rot, 0); return; }
  if (!Array.isArray(rot) || rot.length < 3) return;
  const x = +rot[0] || 0, y = +rot[1] || 0, z = +rot[2] || 0;
  const deg = Math.abs(x) > 6.4 || Math.abs(y) > 6.4 || Math.abs(z) > 6.4;
  const k = deg ? Math.PI / 180 : 1;
  obj.rotation.set(x * k, y * k, z * k);
}

function colorOf(v, fallback) {
  try {
    if (v === undefined || v === null) return new THREE.Color(fallback);
    return new THREE.Color(v);
  } catch (e) { return new THREE.Color(fallback); }
}

function hashId(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

/** Chamfered box — never a naked BoxGeometry (contract hard rule 1). */
function chamferBox(w, h, d, b) {
  if (typeof Builders.bevelBoxGeometry === 'function') {
    try { return Builders.bevelBoxGeometry(w, h, d, b, 0.5); } catch (e) { /* local path */ }
  }
  const bev = Math.max(0.004, Math.min(b, w * 0.34, h * 0.34, d * 0.34));
  const sw = Math.max(0.002, w - 2 * bev);
  const sh = Math.max(0.002, h - 2 * bev);
  const shape = new THREE.Shape();
  shape.moveTo(-sw / 2, -sh / 2);
  shape.lineTo(sw / 2, -sh / 2);
  shape.lineTo(sw / 2, sh / 2);
  shape.lineTo(-sw / 2, sh / 2);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.002, d - 2 * bev),
    bevelEnabled: true, bevelSize: bev, bevelThickness: bev,
    bevelSegments: 2, curveSegments: 1, steps: 1,
  });
  g.center();
  g.computeVertexNormals();
  return g;
}

/** Chamfered disc via lathe — the checkpoint pad base. */
function chamferDisc(r, h, b, seg) {
  const bev = Math.max(0.004, Math.min(b, r * 0.4, h * 0.45));
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(r - bev, 0),
    new THREE.Vector2(r, bev),
    new THREE.Vector2(r, h - bev),
    new THREE.Vector2(r - bev, h),
    new THREE.Vector2(Math.max(0.001, r * 0.34), h),
    new THREE.Vector2(0, h * 0.86),
  ];
  const g = new THREE.LatheGeometry(pts, seg || 40);
  g.computeVertexNormals();
  return g;
}

/**
 * mergeGeometries refuses a batch that mixes indexed and non-indexed inputs, and
 * three's primitives disagree (Extrude/Lathe are NOT indexed; Box/Torus/
 * Cylinder/Plane ARE).  Give everything a trivial index.
 */
function ensureIndexed(g) {
  if (g.index) return g;
  const n = g.attributes.position.count;
  const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
  for (let i = 0; i < n; i++) arr[i] = i;
  g.setIndex(new THREE.BufferAttribute(arr, 1));
  return g;
}

/**
 * mergeGeometries requires an identical attribute set on every input.  Take the
 * intersection, then top up the two we can synthesise (uv, normal).
 */
function unifyAttributes(geos) {
  const common = {};
  const first = Object.keys(geos[0].attributes);
  for (let i = 0; i < first.length; i++) common[first[i]] = true;
  for (let i = 1; i < geos.length; i++) {
    const names = Object.keys(common);
    for (let n = 0; n < names.length; n++) {
      if (!geos[i].attributes[names[n]]) delete common[names[n]];
    }
  }
  common.position = true;
  common.normal = true;
  common.uv = true;
  for (let i = 0; i < geos.length; i++) {
    const g = geos[i];
    const have = Object.keys(g.attributes);
    for (let h = 0; h < have.length; h++) {
      if (!common[have[h]]) g.deleteAttribute(have[h]);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      const n = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
  }
}

/**
 * The ONE merge entry point.  Normalises index-ness and the attribute set first,
 * so a mixed batch of primitives can never silently return null.  Consumes
 * nothing: the caller still disposes `parts`.
 * @returns {THREE.BufferGeometry|null}
 */
function mergeParts(parts) {
  if (!parts || !parts.length) return null;
  const list = [];
  for (let i = 0; i < parts.length; i++) {
    const g = parts[i];
    if (g && g.attributes && g.attributes.position) list.push(ensureIndexed(g));
  }
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  unifyAttributes(list);
  let m = null;
  try { m = mergeGeometries(list, false); } catch (e) { m = null; }
  return m;
}

/**
 * Lift ONE material group out of a multi-material geometry into a standalone,
 * compacted geometry (vertices remapped, only that group's triangles kept).
 *
 * This is what lets a builder's six-slot platform mesh take part in the static
 * merge at all: `mergeGeometries(..., useGroups=true)` rewrites materialIndex to
 * the geometry's position in the batch, so it cannot preserve real slots.
 * Splitting first and merging per material is the only path to one draw call per
 * (chunk, material).
 * @returns {THREE.BufferGeometry|null} null when the geometry cannot be split
 */
function extractGroup(src, start, count) {
  const attrs = src.attributes;
  if (!attrs.position) return null;
  for (const name in attrs) {
    if (attrs[name].isInterleavedBufferAttribute) return null;   // not worth unpacking
  }
  const index = src.index;
  const g = new THREE.BufferGeometry();

  if (!index) {
    const n = Math.min(count, attrs.position.count - start);
    if (n <= 0) return null;
    for (const name in attrs) {
      const a = attrs[name];
      const its = a.itemSize;
      g.setAttribute(name, new THREE.BufferAttribute(
        a.array.slice(start * its, (start + n) * its), its, a.normalized));
    }
    return g;
  }

  const n = Math.min(count, index.count - start);
  if (n <= 0) return null;
  const srcIdx = index.array;
  const vCount = attrs.position.count;
  const remap = new Int32Array(vCount).fill(-1);
  const newIdx = new Uint32Array(n);
  let next = 0;
  for (let i = 0; i < n; i++) {
    const oi = srcIdx[start + i];
    let ni = remap[oi];
    if (ni < 0) { ni = next++; remap[oi] = ni; }
    newIdx[i] = ni;
  }
  for (const name in attrs) {
    const a = attrs[name];
    const its = a.itemSize;
    const out = new a.array.constructor(next * its);
    for (let oi = 0; oi < vCount; oi++) {
      const ni = remap[oi];
      if (ni < 0) continue;
      const so = oi * its, no = ni * its;
      for (let c = 0; c < its; c++) out[no + c] = a.array[so + c];
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, its, a.normalized));
  }
  g.setIndex(new THREE.BufferAttribute(next > 65535 ? newIdx : new Uint16Array(newIdx), 1));
  return g;
}

/**
 * Exempt a whole subtree from the static merge.
 *
 * `userData.noMerge` is tested per MESH, and `_collectMergeables` walks INTO
 * groups — so flagging only the root of an animated prop (a gate door, a
 * painting) lets the merge eat its children and leave an empty shell behind.
 * Anything that moves after build time goes through here.
 */
function markNoMerge(root) {
  if (!root) return root;
  if (typeof root.traverse === 'function') {
    root.traverse((o) => { o.userData = o.userData || {}; o.userData.noMerge = true; });
  } else {
    root.userData = root.userData || {};
    root.userData.noMerge = true;
  }
  return root;
}

/** Clone (or lift a group) + bake the world matrix + strip to a merge-safe set. */
function normaliseGeo(src, matrix, gStart, gCount) {
  let g;
  if (gStart >= 0) {
    g = extractGroup(src, gStart, gCount);
    if (!g) return null;
  } else {
    try { g = src.clone(); } catch (e) { return null; }
  }
  g.applyMatrix4(matrix);
  g.morphAttributes = {};
  g.clearGroups();
  const keep = { position: 1, normal: 1, uv: 1, uv1: 1, color: 1 };
  const names = Object.keys(g.attributes);
  for (let i = 0; i < names.length; i++) {
    if (!keep[names[i]]) g.deleteAttribute(names[i]);
  }
  if (!g.attributes.position) { g.dispose(); return null; }
  if (!g.attributes.normal) g.computeVertexNormals();
  ensureIndexed(g);
  return g;
}

/* ===========================================================================
 * SHADERS — checkpoint station, gate seal, power hat
 *
 * All five checkpoint meshes share ONE set of per-instance channels
 * (aState / aPulse / aAngle / aSeed), so the whole station set — however many
 * pads a course has — costs five draw calls total, and lighting a pad is three
 * float writes, not a scene-graph edit.
 * ======================================================================== */

/**
 * Volumetric light column.  Density is the chord length through the cylinder,
 * so it is bright through the middle and falls softly to nothing at the rim.
 */
const COLUMN_VERT = `
attribute float aState;
attribute float aPulse;
attribute float aSeed;
uniform float uTime;
varying vec2  vUv;
varying float vState;
varying float vSeed;
varying float vCore;
varying float vDepth;
varying float vAxisD;
varying float vHeightM;
void main(){
  vUv = uv; vState = aState; vSeed = aSeed;
  vec3 p = position;
  float grow = mix(0.60, 1.0, aState) + aPulse * 0.24;
  p.x *= grow; p.z *= grow;
  /* An UNLIT pad used to compress to 52 % of height. With the hero window
   * below (fragment stage: nothing is drawn under ~3.6 m) that left a 4.8 m
   * column with only its top 1.2 m eligible — and the cap term fades exactly
   * there, so an un-reached checkpoint would have shown no shaft at all and
   * stopped being a beacon. State is already carried by colour, by the 0.26
   * alpha floor and by the radial grow; height need not carry it too. */
  p.y *= mix(0.80, 1.0, aState);
  /* METRES above the pad, AFTER the state scale. The fragment stage needs a
   * real world height (not uv.y) to hold the hero window open at a fixed
   * 3.4 m no matter whether the pad is lit (9.2 m tall) or dark (4.8 m). */
  vHeightM = p.y;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  vDepth = -mv.z;
  vec4 wo = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vAxisD = length(wo.xz - cameraPosition.xz);
  vec3 radial = normalize(vec3(position.x, 0.0, position.z) + vec3(1e-5, 0.0, 1e-5));
  vec3 nrm = normalize(normalMatrix * radial);
  vec3 vdir = normalize(-mv.xyz);
  float axial = abs(dot(nrm, vdir));
  vCore = pow(axial, 1.35) + 0.10 * pow(1.0 - axial, 3.0);
  gl_Position = projectionMatrix * mv;
}`;

/**
 * The near-fades are load-bearing, not polish.  Standing ON a pad puts the
 * third-person camera INSIDE the cylinder; without the depth fade the near wall
 * paints the whole frame with an additive wash, and without the AXIS fade the
 * column's upper half (9 m tall, so 4-9 m away from a camera at the pad) arcs a
 * tinted dome across the top of the frame.
 *
 * ROUND 1 VISUAL FIX (owner-observed, `_shots/verify_keep.png` +
 * `_shots/verify_v1.png`): the ported Ascendant fades only fire when the camera
 * is INSIDE the tube.  A third-person camera sits ~6.5 m behind the hero, so at
 * the spawn pad `vAxisD` was ~6.5 and `vDepth` ~6 — BOTH fades read 1.0, the
 * column stayed at full density, and because the old height profile
 * (`pow(1-h, 1.65)`) peaked at h=0 the tube was BRIGHTEST at exactly hero
 * height.  Nim was swallowed at every checkpoint station of both courses.
 *
 * Two changes, both at this generator:
 *   1. HERO WINDOW — `vHeightM` is metres above the pad, and the column now
 *      fades in across 2.05 m -> 3.60 m.  Nothing is drawn where the hero
 *      stands; the shaft begins above his head and still reads as a pillar of
 *      light across a bowl.  The ground read is carried by the ring, the
 *      shockwave and the glyph, which are the silhouette the contract asks for.
 *   2. ACTIVE-PAD CARVE-OUT — the axis fade widens from 1.5..3.2 m to
 *      2.4..8.0 m, so the pad the player is standing on contributes almost
 *      nothing while distant pads keep the full beacon.
 * `fall` relaxes from 1.65 to 1.10 so the surviving upper shaft keeps its
 * density instead of collapsing with the base it no longer draws.
 */
const COLUMN_FRAG = `
uniform vec3  uColorOff;
uniform vec3  uColorOn;
uniform float uTime;
uniform float uGain;
varying vec2  vUv;
varying float vState;
varying float vSeed;
varying float vCore;
varying float vDepth;
varying float vAxisD;
varying float vHeightM;
void main(){
  float h = clamp(vUv.y, 0.0, 1.0);
  float fall = pow(1.0 - h, 1.10);
  float cap  = smoothstep(1.0, 0.52, h);
  float band = 0.5 + 0.5 * sin(h * 21.0 - uTime * (1.05 + 2.6 * vState) + vSeed * 6.2831);
  float a = fall * cap * vCore * (0.70 + 0.30 * band);
  a *= mix(0.26, 1.0, vState) * uGain;
  a *= mix(1.0, 0.58, smoothstep(70.0, 250.0, vDepth));
  a *= smoothstep(0.35, 3.5, vDepth);
  /* the hero window: never draw the shaft at head height */
  a *= smoothstep(2.05, 3.60, vHeightM);
  /* ROUND 2 — the owner's literal instruction, which round 1 only half met:
   * "ring + ground glow with NO FULL-HEIGHT PILLAR at the ACTIVE checkpoint."
   * At 2.40..8.00 a third-person camera 6.5 m back still read 0.73, so the pad
   * under the hero kept a 9 m tube that filled a quarter of the frame and
   * washed the whole background to its own hue (_shots/_v38_verdant.png
   * cropped to _shots/_zz_greenslab.png: the castle, the hills and the sky
   * behind it are all tinted mint by it).  The station you are STANDING at now
   * contributes nothing at all; the beacon fades up only once a pad is far
   * enough away to be a navigation cue rather than a filter over the world. */
  a *= smoothstep(9.00, 19.00, vAxisD);
  if (a <= 0.0025) discard;
  vec3 col = mix(uColorOff, uColorOn, vState);
  col *= 0.85 + 1.15 * vState + 0.30 * band;
  gl_FragColor = vec4(col, a);
}`;

const RING_VERT = `
attribute float aState;
attribute float aPulse;
attribute float aSeed;
uniform float uTime;
varying vec2  vUv;
varying float vState;
varying float vPulse;
varying float vSeed;
varying float vDepth;
void main(){
  vUv = uv; vState = aState; vPulse = aPulse; vSeed = aSeed;
  vec3 p = position;
  float s = 1.0 + aPulse * 0.42 + aState * 0.05;
  p.x *= s; p.z *= s;
  p.y *= 1.0 + aPulse * 0.55;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

/* Peak gain is held near 2x on purpose: it clears every theme's bloom threshold
 * for a halo, but the ring keeps its HUE instead of clipping to white. */
const RING_FRAG = `
uniform vec3  uColorOff;
uniform vec3  uColorOn;
uniform float uTime;
varying vec2  vUv;
varying float vState;
varying float vPulse;
varying float vSeed;
varying float vDepth;
void main(){
  float dash = 0.5 + 0.5 * sin(vUv.x * 84.0 - uTime * (0.75 + 2.4 * vState) + vSeed * 6.2831);
  float tube = 0.55 + 0.45 * sin(vUv.y * 6.2831);
  float a = (0.34 + 0.66 * vState) * mix(0.48, 1.0, dash) * (0.7 + 0.3 * tube);
  a *= mix(1.0, 0.65, smoothstep(80.0, 260.0, vDepth));
  vec3 col = mix(uColorOff, uColorOn, vState);
  col *= 0.90 + 0.85 * vState + 0.80 * vPulse + 0.28 * dash;
  gl_FragColor = vec4(col, a);
}`;

/** Activation shockwave: born small and bright, expands outward as it fades. */
const WAVE_VERT = `
attribute float aPulse;
attribute float aState;
varying float vPulse;
void main(){
  vPulse = aPulse;
  float grow = 1.0 + (1.0 - aPulse) * 5.4;
  vec3 p = position;
  p.x *= grow; p.z *= grow;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
}`;

const WAVE_FRAG = `
uniform vec3 uColorOn;
varying float vPulse;
void main(){
  float a = pow(clamp(vPulse, 0.0, 1.0), 1.35) * 0.9;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(uColorOn * (1.4 + 1.6 * vPulse), a);
}`;

const GLYPH_VERT = `
attribute float aState;
attribute float aPulse;
attribute float aAngle;
attribute float aSeed;
uniform float uTime;
varying vec2  vUv;
varying float vState;
varying float vPulse;
varying float vAxisD;
void main(){
  vUv = uv; vState = aState; vPulse = aPulse;
  float c = cos(aAngle), s = sin(aAngle);
  vec3 p = position;
  vec3 r = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
  r *= mix(0.74, 1.0, aState);
  r.y += 0.34 + 0.30 * aState + 0.075 * sin(uTime * 1.5 + aSeed * 6.2831);
  vec4 wo = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vAxisD = length(wo.xz - cameraPosition.xz);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(r, 1.0);
}`;

/* The glyph floats a little under a standing player's chest.  At full gain it
 * becomes a floor-filling colour wash in every station screenshot, which is
 * exactly what `contrastcheck.py` measures, so it fades out as the camera
 * closes in; from approach range it still reads as the marker. */
const GLYPH_FRAG = `
uniform sampler2D uMap;
uniform vec3 uColorOff;
uniform vec3 uColorOn;
varying vec2  vUv;
varying float vState;
varying float vPulse;
varying float vAxisD;
void main(){
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * (0.30 + 0.85 * vState) * (1.0 + 0.9 * vPulse);
  a *= smoothstep(1.3, 2.8, vAxisD);
  if (a <= 0.004) discard;
  vec3 col = mix(uColorOff, uColorOn, vState) * (0.80 + 0.90 * vState + 0.75 * vPulse);
  gl_FragColor = vec4(col, a);
}`;

/**
 * A SEALED gate's shimmer.  Locked reads as a cold, slow-scrolling lattice with
 * a hard bright rim; unlocked dissolves it to nothing over 0.6 s.  Painted on a
 * plane the size of the gate opening, in front of the art.
 */
const SEAL_VERT = `
varying vec2 vUv;
varying float vDepth;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const SEAL_FRAG = `
uniform float uTime;
uniform float uLock;      // 1 sealed .. 0 open
uniform vec3  uColor;
uniform vec3  uHot;
varying vec2  vUv;
varying float vDepth;
void main(){
  if (uLock <= 0.002) discard;
  vec2 uv = vUv;
  float lat = max(
    smoothstep(0.46, 0.5, abs(fract(uv.x * 7.0 + uTime * 0.05) - 0.5)),
    smoothstep(0.46, 0.5, abs(fract(uv.y * 11.0 - uTime * 0.04) - 0.5)));
  float sweep = 0.5 + 0.5 * sin((uv.y - uTime * 0.11) * 12.0);
  float rim = smoothstep(0.5, 0.44, abs(uv.x - 0.5)) * smoothstep(0.5, 0.44, abs(uv.y - 0.5));
  rim = 1.0 - rim;
  float a = (0.16 + 0.30 * lat + 0.14 * sweep + 0.55 * rim) * uLock;
  a *= mix(1.0, 0.55, smoothstep(30.0, 110.0, vDepth));
  if (a <= 0.004) discard;
  vec3 col = mix(uColor, uHot, rim * 0.7 + lat * 0.3);
  gl_FragColor = vec4(col * (0.75 + 0.8 * rim + 0.35 * sweep), a);
}`;

/** Power-hat halo — an upward-fading shaft plus a dashed ground ring. */
const HALO_VERT = `
uniform float uTime;
uniform float uState;
varying vec2 vUv;
void main(){
  vUv = uv;
  vec3 p = position * mix(0.0, 1.0, clamp(uState, 0.0, 1.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const HALO_FRAG = `
uniform float uTime;
uniform float uState;
uniform float uMode;    // 0 shaft, 1 ring
uniform vec3  uColor;
varying vec2 vUv;
void main(){
  float a;
  if (uMode < 0.5) a = pow(1.0 - clamp(vUv.y, 0.0, 1.0), 2.1) * 0.55;
  else a = mix(0.28, 1.0, 0.5 + 0.5 * sin(vUv.x * 46.0 - uTime * 2.2)) * 0.7;
  a *= clamp(uState, 0.0, 1.0);
  if (a <= 0.004) discard;
  gl_FragColor = vec4(uColor * (1.15 + 0.5 * sin(uTime * 2.6)), a);
}`;

/* ===========================================================================
 * COURSE
 * ======================================================================== */

export class Course {
  /**
   * @param {object} def    course data (runtime/data/courses/*.js | keep.js)
   * @param {object} engine Engine instance (renderer / scene / camera / post)
   * @param {object} ctx    {mats, fx, audio, save, game, quality, settings, impacts, decals}
   */
  constructor(def, engine, ctx) {
    this.def = def || {};
    this.engine = engine || null;
    this.ctx = ctx || {};

    this.mats = this.ctx.mats || MatsMod.Mats || null;
    this.fx = this.ctx.fx || null;
    this.audio = this.ctx.audio || null;
    this.save = this.ctx.save || null;
    this.game = this.ctx.game || null;

    this.id = this.def.id ? String(this.def.id) : 'unknown';
    this.themeId = this.def.theme || this.def.realm || 'verdant';
    this.realmId = this.def.realm || null;
    this.isHub = this.def.isHub === true;
    this.theme = null;
    this.palette = null;

    this.group = new THREE.Group();
    this.group.name = 'course:' + this.id;
    this.group.matrixAutoUpdate = false;

    /* ---- the world the player collides against (contract §10) ---- */
    this.broadphase = null;
    /** @type {Array} KillVolume list (void plane, lava, spikes, critter bites…) */
    this.killVolumes = [];
    /** @type {Array} Volume list (water, wind, current, ladder, checkpoint, trigger…) */
    this.volumes = [];

    /* ---- content ---- */
    /** @type {Array<{h,def,kind,index,colliders,volumes,kills}>} hazard records */
    this.hazards = [];
    /** @type {Array} live Critter instances (each has .kind / .def / .mesh) */
    this.critters = [];
    /** @type {object|null} Collectibles (coins, sigils, crests) */
    this.collectibles = null;
    /** @type {Array<{index,pos,yaw,clockOffset,volume,...}>} */
    this.checkpoints = [];
    /** @type {Array} terrain records; `terrain` is the first (usually only) one */
    this.terrains = [];
    this.terrain = null;
    /** @type {Array<{def,mesh,volume,surfaceY,update}>} */
    this.waters = [];
    /** @type {Array} Keep gates — see `_buildGates` for the record shape */
    this.gates = [];
    /** @type {Array} power hats (`def.powers`) */
    this.powers = [];
    /** @type {Array} authored light SITES competing for the fixed PointLight pool */
    this.lights = [];
    /** @type {Array<THREE.Group>} in-world signage */
    this.texts = [];

    /* ---- the deterministic course clock ---- */
    this.clock = 0;
    this.cpIndex = -1;
    this.bounds = new THREE.Box3();
    this.killY = fin(this.def.killY) ? this.def.killY : -30;

    /**
     * checkpoint(i, cp) · gate(gate) · power(id, seconds) · trigger(id) ·
     * wardenDown() · dropCoins(pos, n) — the ONLY way course state leaves this
     * module.  Course detects and animates; Game owns save, HUD, audio,
     * particles and progression.  There is deliberately no flag that lets the
     * Course do those itself: one owner, always.
     */
    this.events = new Emitter();

    /** Convenience bundle for player/collide.js (`world` argument). */
    this.world = {
      broadphase: null,
      killVolumes: this.killVolumes,
      volumes: this.volumes,
      course: this,
    };

    /** Perf readout for `_harness/perfcheck.py` and the dev overlay. */
    this.stats = {
      chunks: 0, merged: 0, instanced: 0, lights: 0,
      colliders: 0, hazards: 0, critters: 0, objects: 0,
      tris: 0, loadMs: 0,
    };

    /* ---- internals ---- */
    this._built = false;
    this._disposed = false;
    this._chunks = [];
    this._chunkMap = new Map();
    this._chunkSize = CHUNK_SIZE;
    this._gridOX = 0;
    this._gridOZ = 0;
    this._allColliders = [];
    this._staticColliders = [];
    this._heightfields = [];
    this._ownedGeo = new Set();
    this._ownedMat = new Set();
    this._ownedTex = new Set();
    this._mergeSources = new Set();
    this._matCache = new Map();
    this._decoProps = [];        // deco defs routed to props.js placeProps
    this._propHandle = null;     // placeProps() teardown handle
    this._gateObjects = [];      // painting/gatedoor objects awaiting a gate record
    this._rng = mulberry32(hashId(this.id));
    this._pp = new THREE.Vector3();
    this._ppValid = false;
    this._playerRef = null;
    this._standOn = null;
    this._lightTimer = 0;
    this._lightIdx = [];
    this._maxLights = 3;
    this._lightPool = [];
    this._lightFirst = true;
    this._glowSites = [];
    this._glowField = null;
    this._cullFar = 260;
    this._detailFar = 90;
    this._cpDirty = true;
    this._settingsCb = null;
    this._warnedBuilders = new Set();
    this._warnedCameraFallback = false;
    this._triggered = new Set();
    this._time = 0;              // visual clock (drives FX shaders; never gameplay)
    this._quality = null;
    this._decor = 1;
  }

  /* ─────────────────────────────────────────── static load / validate ──── */

  /**
   * Build a complete, playable course.  Awaits GLB prop loading (the only async
   * step); everything else is one synchronous pass, which is what keeps the
   * contract's 1.5 s load budget reachable.
   * @returns {Promise<Course>}
   */
  static async load(def, engine, ctx) {
    Course.validate(def);
    const course = new Course(def, engine, ctx);
    await course._build();
    return course;
  }

  /**
   * Authoring validator.  Throws with the offending index AND kind so a data
   * mistake is diagnosable in one read.  Structural mistakes are ERRORS;
   * content-budget rules (≥ 3 checkpoints, 8 sigils, ≥ 100 coins, 7 crests,
   * ≥ 6 hazard families) are WARNINGS here and hard failures in
   * `_harness/reachcheck.mjs`, which is the gate that owns them.
   *
   * @returns {{ok:boolean, warnings:string[]}}
   */
  static validate(def) {
    const warnings = [];
    const cid = (def && def.id) || '<no id>';
    const fail = (msg) => { throw new Error('[Course.validate ' + cid + '] ' + msg); };
    const failObj = (i, kind, msg) => fail('objects[' + i + '] (kind "' + kind + '"): ' + msg);

    if (!def || typeof def !== 'object') fail('course definition is not an object');
    if (typeof def.id !== 'string' || !def.id) fail('missing required field "id" (string)');
    if (typeof def.theme !== 'string' || !def.theme) {
      fail('missing required field "theme" (string) — one of keep/verdant/ember/rime/azure');
    }
    if (!def.spawn || !fin3(def.spawn.p)) fail('missing/!finite "spawn.p" — expected [x,y,z]');
    if (def.spawn.yaw !== undefined && !fin(def.spawn.yaw)) fail('"spawn.yaw" is not a finite number');
    if (!fin(def.killY)) fail('missing/!finite "killY" (number)');
    if (!Array.isArray(def.objects)) fail('missing required field "objects" (array)');

    const isHub = def.isHub === true;

    /* ---- bounds: authoritative for culling and the minimap (contract §25) ---- */
    if (def.bounds !== undefined && def.bounds !== null) {
      const b = def.bounds;
      if (!b || !fin3(b.min) || !fin3(b.max)) fail('"bounds" must be {min:[x,y,z], max:[x,y,z]} of finite numbers');
      for (let a = 0; a < 3; a++) {
        if (b.max[a] <= b.min[a]) {
          fail('"bounds" is inverted or degenerate on axis ' + 'xyz'[a] +
               ' (min ' + b.min[a] + ' >= max ' + b.max[a] + ')');
        }
      }
      const sp = def.spawn.p;
      if (sp[0] < b.min[0] || sp[0] > b.max[0] || sp[2] < b.min[2] || sp[2] > b.max[2]) {
        warnings.push('spawn.p is outside "bounds" — the spawn chunk will never be culled in, ' +
                      'and the minimap will not show the player');
      }
    } else {
      warnings.push('no "bounds" — culling and the minimap will fall back to the built geometry');
    }

    /* ---- checkpoints ---- */
    const cps = Array.isArray(def.checkpoints) ? def.checkpoints : [];
    const seenCpIds = new Set();
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      if (!cp || !fin3(cp.p)) fail('checkpoints[' + i + '].p missing or not a finite [x,y,z]');
      if (cp.yaw !== undefined && !fin(cp.yaw)) fail('checkpoints[' + i + '].yaw is not finite');
      if (cp.clockOffset !== undefined && (!fin(cp.clockOffset) || cp.clockOffset < 0)) {
        fail('checkpoints[' + i + '].clockOffset must be a finite number >= 0 ' +
             '(it is the course-clock phase every respawn at this pad rewinds to)');
      }
      if (cp.r !== undefined && (!fin(cp.r) || cp.r <= 0)) fail('checkpoints[' + i + '].r must be > 0');
      if (cp.id !== undefined) {
        if (typeof cp.id !== 'string' || !cp.id) fail('checkpoints[' + i + '].id must be a non-empty string');
        if (seenCpIds.has(cp.id)) fail('checkpoints[' + i + '].id "' + cp.id + '" is a duplicate');
        seenCpIds.add(cp.id);
      }
      if (cp.p[1] < def.killY) {
        fail('checkpoints[' + i + '] sits at y=' + cp.p[1] + ', BELOW killY (' + def.killY +
             ') — every respawn there would die instantly');
      }
    }
    if (!isHub && cps.length < 3) {
      warnings.push('only ' + cps.length + ' checkpoint(s) — a full course needs at least 3 (contract §25)');
    }

    /* ---- crests ---- */
    const CREST_TYPES = { open: 1, sigils: 1, coins: 1, secret: 1, boss: 1, race: 1, power: 1 };
    const crests = Array.isArray(def.crests) ? def.crests : [];
    const seenCrest = new Set();
    for (let i = 0; i < crests.length; i++) {
      const c = crests[i];
      if (!c || typeof c !== 'object') fail('crests[' + i + '] is not an object');
      if (typeof c.id !== 'string' || !c.id) fail('crests[' + i + '] missing "id" (string)');
      if (seenCrest.has(c.id)) fail('crests[' + i + '].id "' + c.id + '" is a duplicate');
      seenCrest.add(c.id);
      const type = c.type || 'open';
      if (!CREST_TYPES[type]) {
        fail('crests[' + i + '] (id "' + c.id + '") has unknown type "' + type +
             '" — expected one of ' + Object.keys(CREST_TYPES).join(', '));
      }
      if (type === 'open' && !fin3(c.p)) fail('crests[' + i + '] type "open" needs a finite "p"');
      if ((type === 'sigils' || type === 'coins' || type === 'boss') && !fin3(c.spawnAt) && !fin3(c.p)) {
        fail('crests[' + i + '] type "' + type + '" needs "spawnAt" (or "p") — where the crest appears');
      }
      if (type === 'secret' && (typeof c.trigger !== 'string' || !c.trigger)) {
        fail('crests[' + i + '] type "secret" needs a "trigger" id (a string a hazard or critter fires)');
      }
      if (type === 'race') {
        if (!fin3(c.start) || !fin3(c.finish)) fail('crests[' + i + '] type "race" needs finite "start" and "finish"');
        if (!fin(c.limitMs) || c.limitMs <= 0) fail('crests[' + i + '] type "race" needs a positive "limitMs"');
      }
      if (type === 'power' && (typeof c.power !== 'string' || !c.power)) {
        fail('crests[' + i + '] type "power" needs a "power" id matching one of def.powers[].kind');
      }
      if (type === 'coins' && c.threshold !== undefined && (!fin(c.threshold) || c.threshold <= 0)) {
        fail('crests[' + i + '].threshold must be a positive number of coins');
      }
    }
    if (!isHub && crests.length !== 7) {
      warnings.push(crests.length + ' crest(s) — a full course carries exactly 7 (contract §22)');
    }

    /* ---- sigils / coins ---- */
    const sigils = Array.isArray(def.sigils) ? def.sigils : [];
    for (let i = 0; i < sigils.length; i++) {
      if (!sigils[i] || !fin3(sigils[i].p)) fail('sigils[' + i + '].p missing or not a finite [x,y,z]');
    }
    if (!isHub && sigils.length && sigils.length !== 8) {
      warnings.push(sigils.length + ' sigil(s) — a course carries exactly 8 (they buy one crest)');
    }
    if (def.coins !== undefined) {
      if (!Array.isArray(def.coins)) fail('"coins" must be an array');
      for (let i = 0; i < def.coins.length; i++) {
        const c = def.coins[i];
        if (!c || typeof c !== 'object') fail('coins[' + i + '] is not an object');
        const isPoint = fin3(c.p);
        const isRing = c.ring && finCentre(c.ring.c) && fin(c.ring.r) && fin(c.ring.n);
        const isLine = c.line && fin3(c.line.a) && fin3(c.line.b) && fin(c.line.n);
        // `arc` is the fourth form entities/collectibles.js expands (see
        // expandCoinEntry); the validator used to reject every one of them.
        const isArc = c.arc && finCentre(c.arc.c) && fin(c.arc.r) && fin(c.arc.n);
        if (!isPoint && !isRing && !isLine && !isArc) {
          fail('coins[' + i + '] must be {p:[x,y,z]} | {ring:{c,r,n,y?}} | {line:{a,b,n}} | {arc:{c,r,a0,a1,n,y?}}');
        }
      }
    }

    /* ---- critters ---- */
    const known = CrittersMod.CRITTERS || null;
    const critters = Array.isArray(def.critters) ? def.critters : [];
    for (let i = 0; i < critters.length; i++) {
      const c = critters[i];
      if (!c || typeof c.kind !== 'string') fail('critters[' + i + '] missing "kind" (string)');
      if (known && !known[c.kind]) {
        fail('critters[' + i + '] unknown kind "' + c.kind + '" — known: ' + Object.keys(known).join(', '));
      }
      if (c.p !== undefined && !fin3(c.p)) fail('critters[' + i + '].p must be a finite [x,y,z]');
      if (c.path !== undefined) {
        if (!Array.isArray(c.path) || c.path.length < 2) fail('critters[' + i + '].path needs at least 2 points');
        for (let k = 0; k < c.path.length; k++) {
          if (!fin3(c.path[k])) fail('critters[' + i + '].path[' + k + '] is not a finite [x,y,z]');
        }
      }
    }

    /* ---- powers ---- */
    const powers = Array.isArray(def.powers) ? def.powers : [];
    for (let i = 0; i < powers.length; i++) {
      const p = powers[i];
      if (!p || typeof p.kind !== 'string' || !p.kind) fail('powers[' + i + '] missing "kind" (string)');
      if (!fin3(p.p)) fail('powers[' + i + '].p must be a finite [x,y,z]');
      if (p.duration !== undefined && (!fin(p.duration) || p.duration <= 0)) {
        fail('powers[' + i + '].duration must be a positive number of seconds');
      }
    }

    /* ---- gates (THE KEEP) ---- */
    const gates = Array.isArray(def.gates) ? def.gates : [];
    if (gates.length && !isHub) {
      warnings.push('"gates" declared on a non-hub course — only the Keep opens courses');
    }
    for (let i = 0; i < gates.length; i++) {
      const g = gates[i];
      if (!g || typeof g !== 'object') fail('gates[' + i + '] is not an object');
      if (typeof g.course !== 'string' || !g.course) fail('gates[' + i + '] missing "course" (course id string)');
      if (!fin3(g.p)) fail('gates[' + i + '].p must be a finite [x,y,z]');
      if (g.yaw !== undefined && !fin(g.yaw)) fail('gates[' + i + '].yaw is not finite');
      if (g.kind !== undefined && ['painting', 'door', 'glass'].indexOf(g.kind) < 0) {
        fail('gates[' + i + '].kind must be "painting", "door" or "glass"');
      }
      if (g.requires !== undefined && g.requires !== null) {
        if (!g.requires || !fin(g.requires.crests) || g.requires.crests < 0) {
          fail('gates[' + i + '].requires must be {crests:<number >= 0>}');
        }
      }
    }
    if (isHub && !gates.length) {
      const paintings = def.objects.filter((o) => o && (o.kind === 'painting' || o.kind === 'gatedoor'));
      if (!paintings.length) warnings.push('the hub declares no gates and no painting/gatedoor objects — no course is reachable');
    }

    /* ---- objects ---- */
    const VEC_FIELDS = ['p', 's', 'rot', 'to', 'a', 'b', 'dir', 'axis', 'blade', 'origin', 'size', 'target', 'pts'];
    const families = new Set();
    let lowest = Infinity;
    for (let i = 0; i < def.objects.length; i++) {
      const o = def.objects[i];
      if (!o || typeof o !== 'object') fail('objects[' + i + '] is not an object');
      const k = o.kind;
      if (typeof k !== 'string' || !k) fail('objects[' + i + '] missing required field "kind"');
      if (!Course._routeOf(k)) {
        failObj(i, k, 'unknown kind — neither hazards/index.js nor world/builders.js owns it ' +
                      '(contract §25 lists every legal kind)');
      }
      families.add(k);

      /* NaN sweep over every vector-ish field */
      for (let f = 0; f < VEC_FIELDS.length; f++) {
        const name = VEC_FIELDS[f];
        const val = o[name];
        if (val === undefined || val === null || !Array.isArray(val)) continue;
        for (let c = 0; c < val.length; c++) {
          const e = val[c];
          if (Array.isArray(e)) {                       // pts: [[x,y,z], …]
            if (!fin3(e)) failObj(i, k, 'field "' + name + '[' + c + ']" is not a finite [x,y,z]');
            continue;
          }
          if (!fin(e)) {
            failObj(i, k, 'field "' + name + '[' + c + ']" is not a finite number (got ' +
                          (typeof e) + ' ' + String(e) + ')');
          }
        }
      }
      if (o.motion && o.motion.to !== undefined && !fin3(o.motion.to)) {
        failObj(i, k, 'motion.to must be a finite [x,y,z]');
      }

      /* HAZARD KINDS: one contract, owned by hazards/index.js.  Delegating makes
         the two verdicts identical by construction — a validator that accepts
         what `makeHazard` then rejects ships a course with a silent hole. */
      if (Course._routeOf(k) === 'hazard' && typeof HazardLib.validateHazardDef === 'function') {
        try {
          HazardLib.validateHazardDef(o, { courseId: cid, objectIndex: i });
        } catch (e) {
          failObj(i, k, (e && e.message) ? e.message : String(e));
        }
      }

      /* per-kind required fields the Course itself reads */
      switch (k) {
        case 'terrain':
          if (!Array.isArray(o.origin) || !fin(o.origin[0]) || !fin(o.origin[1])) {
            failObj(i, k, '"origin" must be [x, z] of finite numbers');
          }
          if (!Array.isArray(o.size) || !fin(o.size[0]) || !fin(o.size[1]) || o.size[0] <= 0 || o.size[1] <= 0) {
            failObj(i, k, '"size" must be [sizeX, sizeZ], both > 0');
          }
          if (o.res !== undefined && (!fin(o.res) || o.res <= 0)) failObj(i, k, '"res" must be a positive metre spacing');
          break;
        case 'water':
          if (!fin3(o.p)) failObj(i, k, '"p" must be a finite [x,y,z] (the water surface centre)');
          if (!Array.isArray(o.s) || !fin(o.s[0])) failObj(i, k, '"s" must be [sx, sy, sz] extents');
          break;
        case 'text':
          if (typeof o.text !== 'string' || !o.text.length) failObj(i, k, '"text" must be a non-empty string');
          break;
        case 'light':
          if (!fin3(o.p)) failObj(i, k, '"p" must be a finite [x,y,z]');
          if (o.intensity !== undefined && (!fin(o.intensity) || o.intensity < 0)) {
            failObj(i, k, '"intensity" must be a finite number >= 0, got ' + String(o.intensity));
          }
          break;
        case 'painting':
        case 'gatedoor':
          if (!fin3(o.p)) failObj(i, k, '"p" must be a finite [x,y,z]');
          if (o.course !== undefined && (typeof o.course !== 'string' || !o.course)) {
            failObj(i, k, '"course" must be a course id string');
          }
          break;
        case 'bridge':
          if (!fin3(o.a) || !fin3(o.b)) failObj(i, k, 'needs finite endpoints "a" and "b"');
          break;
        case 'fence':
        case 'sandboard':
          if (!fin3(o.a) || !fin3(o.b)) failObj(i, k, 'needs finite endpoints "a" and "b"');
          break;
        default:
          if (Course._routeOf(k) === 'builder' && o.p === undefined) {
            failObj(i, k, 'missing required field "p"');
          }
          if (Course._routeOf(k) === 'builder' && o.p !== undefined && !fin3(o.p)) {
            failObj(i, k, '"p" must be a finite [x,y,z]');
          }
          break;
      }

      if (fin3(o.p)) {
        const half = Array.isArray(o.s) && fin(o.s[1]) ? o.s[1] * 0.5 : 0;
        lowest = Math.min(lowest, o.p[1] - half);
      }
    }

    if (def.objects.length && Number.isFinite(lowest) && def.killY > lowest - 1.5) {
      warnings.push('killY (' + def.killY + ') sits at or above the lowest geometry (' +
                    lowest.toFixed(2) + ') — players may die standing on real ground');
    }
    if (!isHub) {
      let fam = 0;
      families.forEach((k) => { if (Course._routeOf(k) === 'hazard') fam++; });
      fam += new Set(critters.map((c) => c.kind)).size;
      if (fam < 6 && (def.difficulty || 1) > 1) {
        warnings.push('only ' + fam + ' hazard/critter families — a non-tutorial course wants at least 6');
      }
    }
    if (def.objects.length > 700) {
      warnings.push(def.objects.length + ' objects: expect merge cost at load; verify the 1.5 s budget');
    }

    return { ok: true, warnings };
  }

  /**
   * Which module owns a kind.  NOT a local table by preference: hazards/index.js
   * derives the map from its own factory registry, so this compiler cannot drift
   * out of step with it.  The local fallback covers the window in which
   * hazards/index.js has not published a route table yet.
   * @returns {'hazard'|'builder'|'course'|null}
   */
  static _routeOf(kind) {
    if (typeof kind !== 'string' || !kind) return null;
    if (COURSE_KINDS[kind]) return 'course';
    if (typeof HazardLib.routeOf === 'function') {
      const r = HazardLib.routeOf(kind);
      if (r) return r;
    }
    const table = HazardLib.KIND_ROUTE;
    if (table && Object.prototype.hasOwnProperty.call(table, kind)) return table[kind];
    const hz = HazardLib.HAZARDS;
    if (hz && Object.prototype.hasOwnProperty.call(hz, kind)) return 'hazard';
    if (Object.prototype.hasOwnProperty.call(BUILDER_ROUTE, kind)) return 'builder';
    return null;
  }

  /* ─────────────────────────────────────────────────────────────── build ── */

  _assertDeps() {
    const missing = [];
    if (typeof Collider !== 'function') missing.push('Collider (world/collider.js)');
    if (typeof Broadphase !== 'function') missing.push('Broadphase (world/collider.js)');
    if (typeof KillVolume !== 'function') missing.push('KillVolume (world/collider.js)');
    if (typeof Volume !== 'function') missing.push('Volume (world/collider.js)');
    if (typeof mergeGeometries !== 'function') missing.push('mergeGeometries (addons/utils/BufferGeometryUtils.js)');
    if (typeof clamp !== 'function' || typeof mulberry32 !== 'function') missing.push('clamp/mulberry32 (core/util.js)');
    if (typeof Emitter !== 'function') missing.push('Emitter (core/util.js)');
    if (missing.length) {
      throw new Error('[Course ' + this.id + '] required exports unavailable: ' + missing.join(', '));
    }
    /* Soft dependencies: a course still loads and plays without them, so they
       warn once rather than refusing the build. */
    if (typeof HazardLib.makeHazard !== 'function' && !HazardLib.HAZARDS) {
      console.warn('[Course ' + this.id + '] hazards/index.js exports neither makeHazard nor HAZARDS — ' +
                   'every dynamic object will be skipped');
    }
    if (typeof Builders.buildPlatform !== 'function') {
      console.warn('[Course ' + this.id + '] world/builders.js has no buildPlatform — using the course-local ' +
                   'fallback slab for every static surface');
    }
  }

  async _build() {
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    this._assertDeps();

    const report = Course.validate(this.def);
    for (let i = 0; i < report.warnings.length; i++) {
      console.warn('[Course ' + this.id + '] ' + report.warnings[i]);
    }

    this._resolveTheme();
    this._applyQuality();
    this._computeChunkGrid();

    this.broadphase = new Broadphase(6);
    this.world.broadphase = this.broadphase;

    if (this.engine && this.engine.scene && !this.group.parent) this.engine.scene.add(this.group);

    const objects = Array.isArray(this.def.objects) ? this.def.objects : [];
    this.stats.objects = objects.length;

    /* 1. TERRAIN FIRST.  Everything that ground-snaps (coins, critters, props,
          light pools) needs the heightfield registered before it asks. */
    for (let i = 0; i < objects.length; i++) {
      if (objects[i] && objects[i].kind === 'terrain') this._buildTerrain(objects[i], i);
    }
    if (this.def.terrain) this._buildTerrain(this.def.terrain, -1);

    /* 2. water bodies (their Volumes are what the swim state reads) */
    for (let i = 0; i < objects.length; i++) {
      if (objects[i] && objects[i].kind === 'water') this._buildWater(objects[i], i);
    }
    if (Array.isArray(this.def.waters)) {
      for (let i = 0; i < this.def.waters.length; i++) this._buildWater(this.def.waters[i], -1);
    }

    /* 3. hazards — they keep their own meshes; nothing merges them */
    const pending = [];
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      if (!o || typeof o.kind !== 'string') continue;
      if (Course._routeOf(o.kind) !== 'hazard') continue;
      const p = this._buildHazard(o, i);
      if (p) pending.push(p);
    }

    /* 4. static art (and the deco defs that route to props.js) */
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      if (!o || typeof o.kind !== 'string') continue;
      const route = Course._routeOf(o.kind);
      if (route === 'builder') this._buildStatic(o, i);
      else if (route === 'course' && o.kind === 'text') this._buildText(o, i);
      else if (route === 'course' && o.kind === 'light') this._buildLight(o, i);
    }

    /* 5. GLB props — the ONE await in the whole build */
    if (this._decoProps.length) pending.push(this._buildPropBatch());
    if (pending.length) await Promise.all(pending);
    if (this._disposed) return this;

    /* 6. the interactive furniture */
    this._buildCheckpoints();
    this._buildGates();
    this._buildPowers();
    this._buildCollectibles();
    this._buildCritters();

    /* 7. bounds, the void, the light budget, the merge */
    this._computeBounds();
    this._buildVoidVolume();
    /* The pool and the glow field are allocated BEFORE the first render and
       never touched again — see the LIGHT_POOL_SIZE note.  The glow field needs
       the colliders, so it comes after every builder and hazard. */
    this._buildLightPool();
    this._buildGlowField();
    this._mergeStatic();
    this._disposeMergeSources();

    /* 8. place everything at t = 0 */
    this.clock = 0;
    this._time = 0;
    for (let i = 0; i < this.hazards.length; i++) {
      const rec = this.hazards[i];
      try { if (typeof rec.h.reset === 'function') rec.h.reset(0); } catch (e) { /* reset is optional-safe */ }
      try { rec.h.update(0, 0, null); } catch (e) { this._hazardError(rec, e); }
      this._measureHazard(rec);
    }
    this._refreshHazardColliders();
    this._syncCheckpointAttrs(true);
    this._pruneShadowCasters();

    /* 9. react to quality changes for the life of the course */
    if (Settings && typeof Settings.on === 'function') {
      this._settingsCb = () => { this._applyQuality(); };
      Settings.on(this._settingsCb);
    }

    this.stats.colliders = this._allColliders.length;
    this.stats.hazards = this.hazards.length;
    this.stats.critters = this.critters.length;
    this.stats.lights = this.lights.length;
    this.stats.chunks = this._chunks.length;
    if (typeof Builders.triangleCount === 'function') {
      try { this.stats.tris = Math.round(Builders.triangleCount(this.group)); } catch (e) { /* advisory */ }
    }
    const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    this.stats.loadMs = Math.round(t1 - t0);

    this._built = true;
    return this;
  }

  /* ── theme + quality ─────────────────────────────────────────────────── */

  _resolveTheme() {
    const base = (THEMES && (THEMES[this.themeId] || THEMES[this.def.realm])) || null;
    let theme = base;
    if (this.def.ambience && base) {
      /* A course may tint its realm theme without forking it: shallow-merge one
         level so `ambience:{fog:{far:180}}` keeps the rest of `fog`. */
      theme = Object.assign({}, base);
      const amb = this.def.ambience;
      for (const k in amb) {
        if (!Object.prototype.hasOwnProperty.call(amb, k)) continue;
        const cur = theme[k];
        const inc = amb[k];
        if (cur && inc && typeof cur === 'object' && typeof inc === 'object' &&
            !Array.isArray(cur) && !Array.isArray(inc)) {
          theme[k] = Object.assign({}, cur, inc);
        } else {
          theme[k] = inc;
        }
      }
    }
    if (!theme) {
      console.warn('[Course ' + this.id + '] theme "' + this.themeId +
                   '" not found in world/themes.js — using a neutral fallback');
      theme = {
        id: this.themeId, name: this.themeId,
        palette: {}, fog: { near: 24, far: 260 }, lights: {},
      };
    }
    this.theme = theme;
    const pal = theme.palette || {};
    this.palette = {
      safe: colorOf(pal.safe, 0xb9c7d6),
      safeEdge: colorOf(pal.safeEdge, 0x8ef0ff),
      kill: colorOf(pal.kill, 0xff3a1f),
      killGlow: colorOf(pal.killGlow, 0xff7a3a),
      checkpoint: colorOf(pal.checkpoint, 0x2f5f8a),
      checkpointOn: colorOf(pal.checkpointOn, 0x62f5c8),
      crest: colorOf(pal.crest, 0xffd166),
      sigil: colorOf(pal.sigil, 0xff4d6a),
      coin: colorOf(pal.coin, 0xffcf4d),
      accent: colorOf(pal.accent, 0x5ec8ff),
      deco: colorOf(pal.deco, 0x6d7f96),
      water: colorOf(pal.water, 0x3aa6c8),
    };
    const key = theme.lights && theme.lights.key;
    this._keyDir = v3(key && key.dir, -0.45, 0.82, 0.36).normalize();
  }

  _qualityPreset() {
    let q = null;
    try {
      if (Settings && typeof Settings.quality === 'function') q = Settings.quality();
    } catch (e) { q = null; }
    if (!q || typeof q !== 'object' || !fin(q.decor)) {
      let name = 'high';
      try {
        if (Settings && typeof Settings.get === 'function') {
          const s = Settings.get();
          if (s && typeof s.quality === 'string') name = s.quality;
        }
      } catch (e) { /* defaults */ }
      q = (QUALITY && (QUALITY[name] || QUALITY.high)) || null;
    }
    if (!q) {
      q = { id: 'high', dpr: 1.5, shadowMap: 2048, bloom: true, particles: 1, decor: 1,
            shadowDistance: 70, grass: 1, maxLights: 6 };
    }
    return q;
  }

  _applyQuality() {
    const q = this._qualityPreset();
    this.quality = q;
    this._quality = q;
    const decor = fin(q.decor) ? clamp(q.decor, 0, 1) : 1;
    this._decor = decor;
    /* The preset owns the number in use (settings.js QUALITY[*].maxLights); the
       POOL is the hard ceiling, because slots cannot be allocated after the
       first render.  Raising quality mid-run therefore lights more of the pool,
       it never grows it. */
    const wantLights = fin(q.maxLights) ? q.maxLights : (decor >= 0.6 ? 3 : 2);
    this._maxLights = Math.max(1, Math.min(LIGHT_POOL_SIZE, Math.round(wantLights)));
    const fogFar = (this.theme && this.theme.fog && fin(this.theme.fog.far)) ? this.theme.fog.far : 240;
    this._cullFar = Math.max(150, fogFar * (0.9 + 0.5 * decor));
    this._detailFar = Math.max(52, 96 * (0.55 + 0.55 * decor));
  }

  /* ── spatial chunks ──────────────────────────────────────────────────── */

  /**
   * A 24 m grid over `def.bounds` (contract §24).  Courses are open dioramas,
   * so unlike an Ascendant corridor the grid is 2D: culling the far side of a
   * bowl matters as much as culling the far end of a run.  The cell only grows
   * when a course would blow past MAX_CHUNKS — every extra chunk multiplies
   * draw calls, because each one needs its own merged mesh per material.
   */
  _computeChunkGrid() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const see = (x, z) => {
      if (fin(x)) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
      if (fin(z)) { if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
    };
    const b = this.def.bounds;
    if (b && fin3(b.min) && fin3(b.max)) {
      see(b.min[0], b.min[2]);
      see(b.max[0], b.max[2]);
    } else {
      if (this.def.spawn && fin3(this.def.spawn.p)) see(this.def.spawn.p[0], this.def.spawn.p[2]);
      const cps = Array.isArray(this.def.checkpoints) ? this.def.checkpoints : [];
      for (let i = 0; i < cps.length; i++) if (fin3(cps[i].p)) see(cps[i].p[0], cps[i].p[2]);
      const objs = Array.isArray(this.def.objects) ? this.def.objects : [];
      for (let i = 0; i < objs.length; i++) {
        const o = objs[i];
        if (!o) continue;
        if (fin3(o.p)) see(o.p[0], o.p[2]);
        if (fin3(o.a)) see(o.a[0], o.a[2]);
        if (fin3(o.b)) see(o.b[0], o.b[2]);
      }
    }
    if (!Number.isFinite(minX)) { minX = -60; maxX = 60; minZ = -60; maxZ = 60; }

    let cell = CHUNK_SIZE;
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    while ((Math.ceil(spanX / cell) + 1) * (Math.ceil(spanZ / cell) + 1) > MAX_CHUNKS && cell < 400) {
      cell *= 1.5;
    }
    this._chunkSize = cell;
    /* Anchor the grid on the course's own minimum so a course centred far from
       the origin does not waste half its cells on empty space. */
    this._gridOX = Math.floor(minX / cell) * cell;
    this._gridOZ = Math.floor(minZ / cell) * cell;
  }

  _chunkFor(x, z) {
    const cell = this._chunkSize;
    const ix = Math.floor((x - this._gridOX) / cell);
    const iz = Math.floor((z - this._gridOZ) / cell);
    const key = (ix + 4096) * 16384 + (iz + 4096);
    let ch = this._chunkMap.get(key);
    if (!ch) {
      ch = {
        key, ix, iz,
        group: new THREE.Group(),
        main: new THREE.Group(),
        detail: new THREE.Group(),
        box: new THREE.Box3(),
        recsMain: [],
        recsDetail: [],
        visible: true,
        detailVisible: true,
      };
      ch.group.name = 'chunk ' + ix + ',' + iz;
      ch.group.matrixAutoUpdate = false;
      ch.main.matrixAutoUpdate = false;
      ch.detail.matrixAutoUpdate = false;
      ch.group.add(ch.main);
      ch.group.add(ch.detail);
      this.group.add(ch.group);
      this._chunkMap.set(key, ch);
      this._chunks.push(ch);
    }
    return ch;
  }

  /**
   * File a built object into its chunk.  `detail` art (decor, signage, small
   * clutter) lives in a second sub-group culled at a much nearer distance than
   * the structural art the player actually lands on.
   */
  _chunkAdd(obj, pos, detail) {
    const ch = this._chunkFor(pos.x, pos.z);
    (detail ? ch.detail : ch.main).add(obj);
    obj.updateMatrixWorld(true);
    try {
      _box1.setFromObject(obj);
      if (!_box1.isEmpty()) ch.box.union(_box1);
      else ch.box.expandByPoint(pos);
    } catch (e) { ch.box.expandByPoint(pos); }
    (detail ? ch.recsDetail : ch.recsMain).push(obj);
    return ch;
  }

  /* ── static object dispatch ──────────────────────────────────────────── */

  /**
   * Only kinds routed 'builder' arrive here.  `ice`, `jumppad`, `speedpad` and
   * `conveyor` deliberately do NOT: hazards/index.js owns them (frosted rims,
   * sparkle fields, the surface voice and the slippery collider), and a flat
   * static slab is a strictly worse duplicate of that.  A platform that merely
   * wants ice PHYSICS still says `{kind:'platform', surface:'ice'}`.
   */
  _buildStatic(o, index) {
    const fnName = BUILDER_ROUTE[o.kind];
    const isDeco = o.kind === 'deco';

    if (isDeco) return this._buildDeco(o, index);

    const bdef = o;
    let built = null;
    const fn = fnName ? Builders[fnName] : null;
    if (typeof fn === 'function') {
      try {
        built = fn(bdef, this.theme, this.mats);
      } catch (e) {
        console.error('[Course ' + this.id + '] ' + fnName + ' threw on objects[' + index +
                      '] (kind "' + o.kind + '")', e);
        built = null;
      }
    } else if (typeof Builders.build === 'function') {
      try { built = Builders.build(bdef, this.theme, this.mats); } catch (e) { built = null; }
    }

    if ((!built || !built.mesh) && !this._warnedBuilders.has(o.kind)) {
      this._warnedBuilders.add(o.kind);
      console.warn('[Course ' + this.id + '] world/builders.js has no working "' + (fnName || o.kind) +
                   '" — kind "' + o.kind + '" is falling back to the course-local slab. ' +
                   'The course is playable; the art is not final.');
    }
    if (!built || !built.mesh) built = this._fallbackPlatform(bdef);

    const detail = o.kind === 'fence' || o.kind === 'rock' || o.kind === 'pedestal';
    this._placeBuilt(built, bdef, index, detail);

    /* Climbables: poles, nets and climbable trees need a 'ladder' Volume for the
       controller's climb state.  The builder owns it when it ships one; this
       synthesises the fallback so a course is climbable the moment its art
       lands, and never doubles up. */
    if (CLIMB_KINDS[o.kind] && !(Array.isArray(built.volumes) && built.volumes.length)) {
      if (o.kind !== 'tree' || o.climbable) this._synthClimbVolume(o, built);
    }
    /* Keep gates are claimed later by `_buildGates`; remember the art now.
       Gate art ANIMATES (a door swings, a painting ripples on entry), so it must
       survive the static merge intact — `noMerge` on the root is not enough,
       because the merge walks into groups and consumes their children. */
    if (o.kind === 'painting' || o.kind === 'gatedoor') {
      markNoMerge(built.mesh);
      this._gateObjects.push({ def: o, built, index });
    }
    return null;
  }

  /**
   * Common tail for a builder result: position it, harvest its colliders,
   * volumes and kill volumes, and file it into a chunk.
   *
   * A builder may return art already placed at `p` (baked into the geometry or
   * into `mesh.position`) or art built around the origin.  Double-offsetting a
   * whole course is the worst possible failure, so the decision is made by
   * GEOMETRY: if the built bounds sit nearer to `p` than to the origin, it is
   * already placed.
   */
  _placeBuilt(built, bdef, index, detail) {
    const mesh = built.mesh;
    const p = v3(bdef.p, 0, 0, 0);
    if (mesh) {
      let baked = mesh.position.lengthSq() > 1e-9;
      if (!baked) {
        mesh.updateMatrixWorld(true);
        let boxed = false;
        try { _box1.setFromObject(mesh); boxed = !_box1.isEmpty(); } catch (e) { boxed = false; }
        if (boxed) {
          _box1.getCenter(_v1);
          baked = _v1.distanceTo(p) + 1e-3 < _v1.length();
        }
        if (!baked) mesh.position.copy(p);
      }
      if (!baked && bdef.rot !== undefined &&
          mesh.rotation.x === 0 && mesh.rotation.y === 0 && mesh.rotation.z === 0) {
        applyRot(mesh, bdef.rot);
      }
      /* Builders bake their own matrix and set matrixAutoUpdate = false, so any
         transform applied above has to be folded in explicitly. */
      if (!mesh.matrixAutoUpdate) mesh.updateMatrix();
      mesh.userData.courseIndex = index;
      this._chunkAdd(mesh, p, !!detail);
    }

    const cols = built.colliders;
    if (Array.isArray(cols)) {
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (!c) continue;
        if (bdef.surface && c.surface !== bdef.surface) c.surface = bdef.surface;
        if (bdef.props && !c.props) c.props = bdef.props;
        this._addCollider(c, null);
        this._staticColliders.push(c);
      }
    }
    if (Array.isArray(built.volumes)) {
      for (let i = 0; i < built.volumes.length; i++) this._addVolume(built.volumes[i], null);
    }
    if (Array.isArray(built.kills)) {
      for (let i = 0; i < built.kills.length; i++) this._addKill(built.kills[i], null);
    }
    if (Array.isArray(built.lights)) {
      for (let i = 0; i < built.lights.length; i++) {
        const l = built.lights[i];
        if (l && fin3(l.p !== undefined ? l.p : l.pos)) this.addLightSite(l);
      }
    }
  }

  /**
   * A vertical climb volume around a pole/net/tree.  `props.axis` tells the
   * controller which climb it is: 'pole' orbits the shaft, 'y' is a flat net or
   * ladder face.
   */
  _synthClimbVolume(o, built) {
    const p = v3(o.p, 0, 0, 0);
    const h = fin(o.h) ? o.h : (Array.isArray(o.s) && fin(o.s[1]) ? o.s[1] : 4);
    const r = fin(o.r) ? o.r : 0.28;
    const pole = o.kind !== 'net';
    /* Slightly wider than the shaft so the player grabs it rather than sliding
       past — TUNE.climb.radius is the controller's own grab radius. */
    const halfXZ = pole ? Math.max(0.75, r + 0.55) : Math.max(0.6, (Array.isArray(o.s) && fin(o.s[0]) ? o.s[0] : 2) * 0.5);
    const halfZ = pole ? halfXZ : 0.55;
    const v = new Volume({
      center: [p.x, p.y + h * 0.5, p.z],
      half: [halfXZ, h * 0.5, halfZ],
      quat: o.rot,
      kind: 'ladder',
      props: { axis: pole ? 'pole' : 'y', top: p.y + h, pole: [p.x, p.z], radius: r },
      ref: built || null,
    });
    this._addVolume(v, null);
    return v;
  }

  /** Never a naked box: chamfered slab + inset top plate + leading-edge stripes. */
  _fallbackPlatform(o) {
    const s = Array.isArray(o.s) && o.s.length >= 3
      ? [Math.abs(+o.s[0]) || 4, Math.abs(+o.s[1]) || 0.5, Math.abs(+o.s[2]) || 4]
      : [4, 0.5, 4];
    const g = new THREE.Group();

    const body = chamferBox(s[0], s[1], s[2], Math.min(0.09, s[1] * 0.3));
    this._own(body);
    const bodyMesh = new THREE.Mesh(body, this._mat(o.mat || 'stone'));
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    g.add(bodyMesh);

    const plate = chamferBox(Math.max(0.05, s[0] - 0.22), 0.05, Math.max(0.05, s[2] - 0.22), 0.02);
    plate.translate(0, s[1] * 0.5 + 0.005, 0);
    this._own(plate);
    const plateMesh = new THREE.Mesh(plate, this._mat('panel'));
    plateMesh.receiveShadow = true;
    g.add(plateMesh);

    if (o.stripe !== false) {
      const stripe = this._edgeStripeGeo(s[0], s[2], s[1] * 0.5 + 0.028, 0.10);
      this._own(stripe);
      g.add(new THREE.Mesh(stripe, this._stripeMat()));
    }

    const half = new THREE.Vector3(s[0] * 0.5, s[1] * 0.5, s[2] * 0.5);
    const center = v3(o.p, 0, 0, 0);
    const quat = new THREE.Quaternion();
    if (o.rot !== undefined) {
      applyRot(_eulerHolder, o.rot);
      quat.setFromEuler(_eulerHolder.rotation);
      g.quaternion.copy(quat);
    }
    const col = new Collider({
      center, half, quat,
      surface: o.surface || 'normal',
      ref: null, group: 'world',
    });
    if (o.props) col.props = Object.assign(col.props || {}, o.props);
    return { mesh: g, colliders: [col] };
  }

  /** The four leading-edge stripes of a fallback slab, as one geometry. */
  _edgeStripeGeo(sx, sz, y, w) {
    const parts = [];
    const mk = (x, z, dx, dz) => {
      const q = new THREE.BoxGeometry(dx, 0.035, dz);
      q.translate(x, y, z);
      parts.push(q);
    };
    mk(0, sz * 0.5 - w * 0.5, sx, w);
    mk(0, -sz * 0.5 + w * 0.5, sx, w);
    mk(sx * 0.5 - w * 0.5, 0, w, Math.max(0.01, sz - 2 * w));
    mk(-sx * 0.5 + w * 0.5, 0, w, Math.max(0.01, sz - 2 * w));
    const merged = mergeParts(parts);
    for (let i = 0; i < parts.length; i++) if (parts[i] !== merged) parts[i].dispose();
    return merged || new THREE.BoxGeometry(sx, 0.035, w);
  }

  _stripeMat() {
    if (this._stripeMaterial) return this._stripeMaterial;
    let m = null;
    if (typeof Builders.getEmissive === 'function') {
      try { m = Builders.getEmissive(this.palette.safeEdge.getHex(), 2.4); } catch (e) { m = null; }
    }
    if (!m || !m.isMaterial) {
      m = new THREE.MeshBasicMaterial({
        color: this.palette.safeEdge.clone().multiplyScalar(1.15),
        toneMapped: false, fog: true,
      });
      this._own(m);
    }
    this._stripeMaterial = m;
    return m;
  }

  /* ── terrain ─────────────────────────────────────────────────────────── */

  /**
   * Terrain is the ONE mesh in a course that is never chunked and never merged:
   * it spans the whole diorama, so a chunk would either always be visible or
   * would clip the ground out from under the player.  Its Heightfield goes
   * straight into the broadphase, where player/collide.js reads it as
   * `max(boxFloor, hf.heightAt)` with the analytic normal.
   */
  _buildTerrain(def, index) {
    if (typeof TerrainMod.buildTerrain !== 'function') {
      console.warn('[Course ' + this.id + '] world/terrain.js has no buildTerrain — objects[' + index +
                   '] (kind "terrain") skipped; the course will have no ground plane');
      return null;
    }
    let out = null;
    try {
      out = TerrainMod.buildTerrain(def, this.theme, this.mats, this.quality);
    } catch (e) {
      console.error('[Course ' + this.id + '] buildTerrain threw on objects[' + index + ']', e);
      return null;
    }
    if (!out) return null;

    if (out.mesh) {
      out.mesh.userData.noMerge = true;
      out.mesh.name = out.mesh.name || 'terrain';
      out.mesh.receiveShadow = true;
      this.group.add(out.mesh);
    }
    if (out.grass) {
      out.grass.userData.noMerge = true;
      out.grass.frustumCulled = false;
      this.group.add(out.grass);
      this.stats.instanced += (out.grass.count | 0) || 1;
    }
    if (out.heightfield && this.broadphase && typeof this.broadphase.addHeightfield === 'function') {
      try {
        this.broadphase.addHeightfield(out.heightfield);
        this._heightfields.push(out.heightfield);
      } catch (e) {
        console.error('[Course ' + this.id + '] broadphase.addHeightfield failed', e);
      }
    }
    const rec = { def, mesh: out.mesh || null, heightfield: out.heightfield || null,
                  grass: out.grass || null, bounds: out.bounds || null };
    this.terrains.push(rec);
    if (!this.terrain) this.terrain = rec;
    return rec;
  }

  /* ── water ───────────────────────────────────────────────────────────── */

  /**
   * A water body is a Gerstner surface plus a swim `Volume`.  The Volume is what
   * the controller reads (`inWater`, `waterSurfaceY`); the mesh is presentation
   * and rides the visual clock, not the course clock, so a paused course still
   * has moving water under the pause menu.
   */
  _buildWater(def, index) {
    if (!def) return null;
    if (typeof WaterMod.buildWater !== 'function') {
      console.warn('[Course ' + this.id + '] world/water.js has no buildWater — objects[' + index +
                   '] (kind "water") skipped; that pool will not be swimmable');
      return null;
    }
    let out = null;
    try {
      out = WaterMod.buildWater(def, this.theme, this.mats);
    } catch (e) {
      console.error('[Course ' + this.id + '] buildWater threw on objects[' + index + ']', e);
      return null;
    }
    if (!out) return null;

    if (out.mesh) {
      out.mesh.userData.noMerge = true;
      out.mesh.renderOrder = 2;
      this.group.add(out.mesh);
    }
    if (out.volume) this._addVolume(out.volume, null);
    const rec = {
      def,
      mesh: out.mesh || null,
      volume: out.volume || null,
      surfaceY: fin(out.surfaceY) ? out.surfaceY : (out.volume ? out.volume.surfaceY : 0),
      update: typeof out.update === 'function' ? out.update : null,
    };
    this.waters.push(rec);
    return rec;
  }

  /* ── in-world signage ────────────────────────────────────────────────── */

  _buildText(o, index) {
    if (this.texts.length >= MAX_TEXT) return null;
    const size = fin(o.size) ? clamp(o.size, 0.12, 4) : 0.42;
    const col = colorOf(o.color, this.palette.accent.getHex());
    const made = this._makeTextTexture(String(o.text), col);
    if (!made) return null;

    const w = size * made.aspect * 1.02;
    const h = size * 1.02;
    const group = new THREE.Group();

    const plateW = w + size * 0.7;
    const plateH = h + size * 0.62;
    const plate = chamferBox(plateW, plateH, 0.08, 0.05);
    this._own(plate);
    const plateMesh = new THREE.Mesh(plate, this._mat(o.mat || 'wood'));
    plateMesh.castShadow = false;
    plateMesh.receiveShadow = true;
    group.add(plateMesh);

    const bar = new THREE.BoxGeometry(plateW * 0.86, 0.028, 0.02);
    bar.translate(0, -plateH * 0.5 + 0.075, 0.052);
    this._own(bar);
    group.add(new THREE.Mesh(bar, this._glowMat(col, 1.25)));

    const planeGeo = new THREE.PlaneGeometry(w, h);
    planeGeo.translate(0, 0.03, 0.055);
    this._own(planeGeo);
    const planeMat = new THREE.MeshBasicMaterial({
      map: made.tex, transparent: true, depthWrite: false,
      toneMapped: false, side: THREE.FrontSide, fog: true,
    });
    this._own(planeMat);
    const planeMesh = new THREE.Mesh(planeGeo, planeMat);
    planeMesh.userData.noMerge = true;
    planeMesh.renderOrder = 3;
    group.add(planeMesh);

    const p = v3(o.p, 0, 0, 0);
    group.position.copy(p);
    /* Open dioramas have no "incoming" direction, so a sign faces the authored
       yaw, or — with none — the course spawn, which is the one place every
       player is guaranteed to stand. */
    if (o.rot !== undefined) applyRot(group, o.rot);
    else if (fin(o.yaw)) group.rotation.y = o.yaw;
    else {
      const sp = this.def.spawn && fin3(this.def.spawn.p) ? this.def.spawn.p : null;
      group.rotation.y = sp ? Math.atan2(sp[0] - p.x, sp[2] - p.z) : 0;
    }

    this.texts.push(group);
    this._chunkAdd(group, p, true);
    return null;
  }

  _makeTextTexture(text, color) {
    if (typeof document === 'undefined') return null;
    const lines = String(text).split('\n');
    const fs = 84;
    const pad = 30;
    const track = 5;
    const cnv = document.createElement('canvas');
    const ctx = cnv.getContext('2d');
    if (!ctx) return null;
    const font = '600 ' + fs + 'px Rajdhani, "Segoe UI", system-ui, -apple-system, sans-serif';
    ctx.font = font;
    let maxW = 1;
    for (let i = 0; i < lines.length; i++) {
      const m = ctx.measureText(lines[i]).width + track * Math.max(0, lines[i].length - 1);
      if (m > maxW) maxW = m;
    }
    const W = Math.min(2048, Math.max(64, Math.ceil(maxW + pad * 2)));
    const H = Math.max(32, Math.ceil(lines.length * fs * 1.22 + pad * 2));
    cnv.width = W; cnv.height = H;

    const c2 = cnv.getContext('2d');
    c2.clearRect(0, 0, W, H);
    c2.font = font;
    c2.textBaseline = 'middle';
    const hex = '#' + color.getHexString();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lw = c2.measureText(line).width + track * Math.max(0, line.length - 1);
      let x = (W - lw) * 0.5;
      const y = pad + fs * 0.62 + i * fs * 1.22;
      c2.shadowColor = hex;
      c2.shadowBlur = 22;
      c2.fillStyle = '#ffffff';
      for (let ch = 0; ch < line.length; ch++) {
        const g = line[ch];
        c2.fillText(g, x, y);
        x += c2.measureText(g).width + track;
      }
      c2.shadowBlur = 0;
      x = (W - lw) * 0.5;
      c2.fillStyle = hex;
      c2.globalAlpha = 0.55;
      for (let ch = 0; ch < line.length; ch++) {
        const g = line[ch];
        c2.fillText(g, x, y);
        x += c2.measureText(g).width + track;
      }
      c2.globalAlpha = 1;
    }
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this._own(tex);
    return { tex, aspect: W / H };
  }

  /** Cached unlit glow material — shared, so signage and bulbs still merge. */
  _glowMat(color, boost) {
    const b = fin(boost) ? boost : 1.25;
    const key = 'glow:' + color.getHexString() + ':' + b.toFixed(2);
    let m = this._matCache.get(key);
    if (m) return m;
    m = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(b), toneMapped: false });
    this._own(m);
    this._matCache.set(key, m);
    return m;
  }

  /* ── decor: procedural clusters + instanced GLB props ────────────────── */

  /**
   * `{kind:'deco', model:'…'}` routes to world/props.js, which collapses every
   * copy of one prop into a single InstancedMesh — a hundred crates is one draw
   * call.  Everything else goes to `builders.buildDeco`, which does the same for
   * its procedural families.
   */
  _buildDeco(o, index) {
    if (this._decor <= 0) return null;
    let count = fin(o.count) ? Math.max(1, Math.round(o.count)) : 1;
    count = Math.max(1, Math.round(count * (0.35 + 0.65 * this._decor)));
    if (this._decor < 0.4) count = Math.min(count, Math.max(1, Math.floor(count * 0.5)));

    if (typeof o.model === 'string' && o.model.length) {
      this._decoProps.push(Object.assign({}, o, { count }));
      return null;
    }
    if (typeof o.kindOf === 'string' && o.kindOf.length) {
      this._decoProps.push(Object.assign({}, o, { count }));
      return null;
    }

    const bdef = Object.assign({}, o, { count });
    if (typeof Builders.buildDeco === 'function') {
      let built = null;
      try { built = Builders.buildDeco(bdef, this.theme, this.mats); }
      catch (e) {
        console.error('[Course ' + this.id + '] buildDeco threw on objects[' + index + ']', e);
        built = null;
      }
      if (built && built.mesh) { this._placeBuilt(built, bdef, index, true); return null; }
    }

    /* Last-resort decor: a seeded cluster of chamfered shards.  Silhouette only,
       never a landable-looking slab — decorative geometry that reads as a
       platform is the fastest way to fail the critic's readability lane. */
    const rng = mulberry32(hashId(this.id + ':deco:' + index + ':' + (o.seed || 0)));
    const spread = fin(o.spread) ? o.spread : 2.2;
    const scale = fin(o.scale) ? o.scale : 1;
    const parts = [];
    for (let i = 0; i < count; i++) {
      const h = (0.5 + rng() * 1.5) * scale;
      const w = (0.25 + rng() * 0.5) * scale;
      const gg = chamferBox(w, h, w * (0.7 + rng() * 0.6), Math.min(0.06, w * 0.25));
      _m1.makeRotationY(rng() * Math.PI * 2);
      _m1.setPosition((rng() - 0.5) * spread * 2, h * 0.5, (rng() - 0.5) * spread * 2);
      gg.applyMatrix4(_m1);
      parts.push(gg);
    }
    const merged = mergeParts(parts);
    for (let i = 0; i < parts.length; i++) if (parts[i] !== merged) parts[i].dispose();
    if (!merged) return null;
    this._own(merged);
    const mesh = new THREE.Mesh(merged, this._mat(o.mat || 'stone'));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const p = v3(o.p, 0, 0, 0);
    mesh.position.copy(p);
    applyRot(mesh, o.rot);
    this._chunkAdd(mesh, p, true);
    return null;
  }

  /**
   * Load the theme's prop library once and place EVERY prop def in one batch.
   * This is the course's only asynchronous step; batching it means a course with
   * 200 props still pays one library load, not 200.
   *
   * Prop point lights are routed into this course's light-site budget through
   * `lightSink`, never created as real PointLights — see the LIGHT_POOL_SIZE
   * note: a row of eight braziers with their own lights taxes every material
   * within range of any of them.
   */
  async _buildPropBatch() {
    const defs = this._decoProps;
    if (!defs.length) return null;

    let lib = null;
    const renderer = this.engine ? this.engine.renderer : null;
    try {
      if (typeof PropsMod.loadProps === 'function') lib = await PropsMod.loadProps(this.themeId, renderer);
      else if (typeof PropsMod.proceduralLibrary === 'function') lib = PropsMod.proceduralLibrary(this.themeId);
    } catch (e) {
      console.warn('[Course ' + this.id + '] prop library failed to load — falling back to procedural', e);
      try {
        if (typeof PropsMod.proceduralLibrary === 'function') lib = PropsMod.proceduralLibrary(this.themeId);
      } catch (e2) { lib = null; }
    }
    if (this._disposed) return null;
    if (!lib || typeof PropsMod.placeProps !== 'function') {
      console.warn('[Course ' + this.id + '] world/props.js unavailable — ' + defs.length +
                   ' deco def(s) skipped');
      return null;
    }

    /* Props are decor: they live in one container per course rather than per
       chunk, because placeProps already collapses them to a handful of
       InstancedMeshes and instanced draws do not benefit from chunk culling. */
    const container = new THREE.Group();
    container.name = 'props';
    container.matrixAutoUpdate = false;
    this.group.add(container);

    const self = this;
    let out = null;
    try {
      out = PropsMod.placeProps(container, defs, lib, null, {
        shadows: this._decor > 0.35,
        maxLights: 0,
        /* Decor's slice of the perf gate (260 draws / 450k tris for the whole
           frame).  props.js thins density uniformly to fit rather than letting
           a generous `count:` in a course file spend the course's budget on
           mushrooms — measured on verdant-1, decor was 372 draws / 462k tris
           before this cap. */
        budget: { draws: Math.round(24 * (0.5 + 0.5 * this._decor)),
                  tris: Math.round(52000 * (0.45 + 0.55 * this._decor)) },
        lightSink: (site) => self.addLightSite(site),
      });
    } catch (e) {
      console.error('[Course ' + this.id + '] placeProps threw', e);
      out = null;
    }
    if (!out) return null;

    for (let i = 0; i < out.meshes.length; i++) {
      const m = out.meshes[i];
      if (!m) continue;
      m.userData.noMerge = true;
      m.frustumCulled = true;
    }
    if (out.skipped && out.skipped.length) {
      console.warn('[Course ' + this.id + '] props.js had no entry for: ' + out.skipped.join(', '));
    }
    this.stats.instanced += out.instances | 0;
    this._propHandle = out;
    return null;
  }

  /* ── point lights ────────────────────────────────────────────────────── */

  _buildLight(o, index) {
    if (this.lights.length >= MAX_LIGHT_SITES) return null;
    const p = v3(o.p, 0, 0, 0);
    const color = colorOf(o.color, this.palette.accent.getHex());
    const intensity = fin(o.intensity) ? o.intensity : 6;
    const distance = fin(o.distance) ? o.distance : 14;

    /* A physical bulb, so the source is a visible object rather than a floating
       glow with no cause. */
    const bulbGeo = new THREE.IcosahedronGeometry(Math.min(0.16, distance * 0.02 + 0.06), 1);
    bulbGeo.translate(p.x, p.y, p.z);
    this._own(bulbGeo);
    const bulb = new THREE.Mesh(bulbGeo, this._glowMat(color, 1.6));
    this._chunkAdd(bulb, p, true);

    /* The part that used to BE a PointLight: a halo around the bulb so the
       source still reads at range, and a pool of light on the floor beneath it
       so the fixture keeps lighting its own patch even when no slot of the pool
       is pointed at it.  Both bake flat in `_buildGlowField`. */
    this._glowSites.push({
      pos: p, color,
      halo: Math.min(2.2, Math.max(0.45, distance * 0.13)),
      pool: Math.min(6.5, Math.max(1.2, distance * 0.42)),
    });

    const site = this.addLightSite({
      p, color, intensity, distance,
      flicker: o.flicker, seed: index * 37.13,
    });
    site.bulb = bulb;
    return null;
  }

  /**
   * Register a dynamic light SITE.  Sites compete for the course's small fixed
   * pool of real PointLights — registering one never adds a light to the scene,
   * so a hazard or a prop may call this at build time or later without risking
   * the program-cache recompile that a live light addition causes.
   *
   * @param {object} o {p|pos, color, intensity, distance, decay, flicker, seed}
   * @returns {object} the site record: move it via `site.pos.set(...)`, dim it
   *                   via `site.base = n`, drop it via `site.remove()`.
   */
  addLightSite(o) {
    const pos = (o && o.pos && fin(o.pos.x)) ? o.pos : v3(o && o.p, 0, 0, 0);
    const distance = fin(o && o.distance) ? o.distance : 14;
    const self = this;
    const site = {
      pos,
      color: (o && o.color && o.color.isColor)
        ? o.color
        : colorOf(o && o.color, this.palette.accent.getHex()),
      base: fin(o && o.intensity) ? o.intensity : 6,
      distance,
      decay: fin(o && o.decay) ? o.decay : 2,
      flicker: !!(o && o.flicker),
      flickerAmt: fin(o && o.flicker) ? clamp(o.flicker, 0, 1) : 0.35,
      seed: fin(o && o.seed) ? (o.seed % 100) : (this.lights.length * 37.13) % 100,
      /* Beyond this the light's contribution is under the dither floor: never a candidate. */
      range2: (distance * 3.2) * (distance * 3.2),
      d2: 0, want: false, slot: -1, bulb: null,
      remove() {
        const i = self.lights.indexOf(site);
        if (i < 0) return;
        if (site.slot >= 0 && self._lightPool[site.slot]) self._lightPool[site.slot].site = null;
        site.slot = -1;
        self.lights.splice(i, 1);
        self._lightIdx.length = self.lights.length;
      },
    };
    this.lights.push(site);
    this._lightIdx.push(this.lights.length - 1);
    return site;
  }

  /**
   * Allocate the pool ONCE, before the first render.  Slots live on the course
   * group forever at intensity 0 until the budget points one at a site; they are
   * never added, removed or hidden after this, so the program cache is built for
   * LIGHT_POOL_SIZE point lights and stays valid for the whole run.
   */
  _buildLightPool() {
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 14, 2);
      l.name = 'cb.course.pointpool.' + i;
      l.castShadow = false;
      l.position.set(0, -1e4, 0);
      this.group.add(l);
      this._lightPool.push({ light: l, site: null, fade: 0 });
    }
  }

  /**
   * Bake every light site's halo and floor pool into ONE additive mesh.
   *
   * A halo is a camera-facing quad; a floor pool is a horizontal disc sitting on
   * whatever collider is under the fixture.  Both are the same four verts with a
   * radial falloff, so the fixture glow for a whole course costs one draw call
   * and no per-fragment light term on any other material in the scene.
   */
  _buildGlowField() {
    const sites = this._glowSites;
    if (!sites.length) return;

    const quads = [];
    for (let i = 0; i < sites.length; i++) {
      const g = sites[i];
      quads.push({ x: g.pos.x, y: g.pos.y, z: g.pos.z, size: g.halo, mode: 0, c: g.color });
      const fy = this._floorUnder(g.pos, g.pool * 2.4);
      if (fy !== null) quads.push({ x: g.pos.x, y: fy + 0.035, z: g.pos.z, size: g.pool, mode: 1, c: g.color });
    }
    if (!quads.length) return;

    const n = quads.length;
    const pos = new Float32Array(n * 4 * 3);
    const cor = new Float32Array(n * 4 * 2);
    const par = new Float32Array(n * 4 * 2);
    const tint = new Float32Array(n * 4 * 3);
    const idx = new Uint32Array(n * 6);
    const CX = [-1, 1, 1, -1], CY = [-1, -1, 1, 1];
    for (let q = 0; q < n; q++) {
      const d = quads[q];
      for (let v = 0; v < 4; v++) {
        const o3 = (q * 4 + v) * 3, o2 = (q * 4 + v) * 2;
        pos[o3] = d.x; pos[o3 + 1] = d.y; pos[o3 + 2] = d.z;
        cor[o2] = CX[v]; cor[o2 + 1] = CY[v];
        par[o2] = d.size; par[o2 + 1] = d.mode;
        tint[o3] = d.c.r; tint[o3 + 1] = d.c.g; tint[o3 + 2] = d.c.b;
      }
      const b = q * 4, o = q * 6;
      idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
      idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(cor, 2));
    geo.setAttribute('aParam', new THREE.BufferAttribute(par, 2));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    this._own(geo);

    /* Additive geometry cannot take three.js fog (fog ADDS its colour), so the
       distance fade is folded into alpha here with the theme's own curve —
       otherwise every fixture stays crisp through the haze. */
    const fogDensity = (this.theme && this.theme.fog && fin(this.theme.fog.density)) ? this.theme.fog.density : 0.0;
    const fogFar = (this.theme && this.theme.fog && fin(this.theme.fog.far)) ? this.theme.fog.far : 0.0;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uHaloGain: { value: 0.80 },
        uPoolGain: { value: 0.40 },
        uFogDensity: { value: fogDensity },
        uFogFar: { value: fogFar },
      },
      vertexShader: [
        'attribute vec2 aCorner;',
        'attribute vec2 aParam;',
        'attribute vec3 aTint;',
        'uniform float uFogDensity;',
        'uniform float uFogFar;',
        'varying vec2 vCorner;',
        'varying vec3 vTint;',
        'varying float vMode;',
        'varying float vFog;',
        'void main() {',
        '  vCorner = aCorner;',
        '  vTint = aTint;',
        '  vMode = aParam.y;',
        '  vec4 mv;',
        '  if (aParam.y < 0.5) {',
        '    mv = modelViewMatrix * vec4(position, 1.0);',
        '    mv.xy += aCorner * aParam.x;',
        '  } else {',
        '    vec3 wp = position;',
        '    wp.x += aCorner.x * aParam.x;',
        '    wp.z += aCorner.y * aParam.x;',
        '    mv = modelViewMatrix * vec4(wp, 1.0);',
        '  }',
        '  float dist = -mv.z;',
        '  float f = 1.0;',
        '  if (uFogDensity > 0.0) { float t = uFogDensity * dist; f = exp(-t * t); }',
        '  else if (uFogFar > 0.0) { f = clamp(1.0 - dist / uFogFar, 0.0, 1.0); }',
        '  vFog = f;',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform float uHaloGain;',
        'uniform float uPoolGain;',
        'varying vec2 vCorner;',
        'varying vec3 vTint;',
        'varying float vMode;',
        'varying float vFog;',
        'void main() {',
        '  float d = length(vCorner);',
        '  float a = 1.0 - clamp(d, 0.0, 1.0);',
        '  a = vMode < 0.5 ? pow(a, 2.6) : pow(a, 1.9);',
        '  a *= vFog * (vMode < 0.5 ? uHaloGain : uPoolGain);',
        '  gl_FragColor = vec4(vTint * a, a);',
        '}',
      ].join('\n'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    this._own(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'course.glowfield';
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;   // spans the course; one draw call either way
    mesh.matrixAutoUpdate = false;
    mesh.userData.noMerge = true;
    this.group.add(mesh);
    this._glowField = mesh;
  }

  /**
   * Highest collider top strictly below `p` and inside its XZ footprint, or null
   * when the fixture hangs over nothing — a light on a bridge rail with the void
   * beneath it must NOT paint a pool of light on empty air.  Terrain counts.
   */
  _floorUnder(p, maxDrop) {
    let best = -Infinity;
    const cols = this._allColliders;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const b = c && c.aabb;
      if (!b || b.isEmpty()) continue;
      if (p.x < b.min.x - 0.25 || p.x > b.max.x + 0.25) continue;
      if (p.z < b.min.z - 0.25 || p.z > b.max.z + 0.25) continue;
      const top = b.max.y;
      if (top > p.y - 0.08 || top < p.y - maxDrop) continue;
      if (top > best) best = top;
    }
    for (let i = 0; i < this._heightfields.length; i++) {
      const h = this._heightfields[i];
      let y = NaN;
      try { y = h.heightAt(p.x, p.z); } catch (e) { y = NaN; }
      if (!fin(y)) continue;
      if (y > p.y - 0.08 || y < p.y - maxDrop) continue;
      if (y > best) best = y;
    }
    return best === -Infinity ? null : best;
  }

  /**
   * Shadow-caster gate.  Clutter smaller than SHADOW_MIN_RADIUS costs a full
   * extra draw in the shadow pass and returns a sub-pixel blob; a transparent
   * surface casts an opaque silhouette, which is worse than no shadow at all.
   *
   * This runs at the SOURCE of the static merge on purpose: `_mergeInto` ORs the
   * flag across a material group, so without it one 8 cm bolt promotes every
   * wall sharing its material into the shadow pass.
   */
  _shouldCast(o) {
    if (!o || !o.castShadow) return false;
    const m = o.material;
    if (m && !Array.isArray(m) && (m.transparent === true || m.isMeshBasicMaterial)) return false;
    const g = o.geometry;
    if (!g) return false;
    if (!g.boundingSphere) { try { g.computeBoundingSphere(); } catch (e) { return true; } }
    if (!g.boundingSphere) return true;
    _v4.setFromMatrixScale(o.matrixWorld);
    const sc = Math.max(_v4.x, _v4.y, _v4.z) || 1;
    return g.boundingSphere.radius * sc >= SHADOW_MIN_RADIUS;
  }

  /* ── hazards ─────────────────────────────────────────────────────────── */

  /**
   * The hazard context.  Everything a hazard could reasonably need is reachable
   * from here WITHOUT the hazard knowing the shape of the Course: the resolvers
   * in hazards/lasers.js (`resolvePlayer`, `resolvePost`, `resolveListener`,
   * `hazTrigger`, `hazDropCoins`, `hazEvent`) walk exactly these fields.
   */
  _hazardCtx(index) {
    const self = this;
    return {
      // world + presentation
      mats: this.mats, builders: Builders,
      theme: this.theme, themeId: this.themeId, palette: this.palette,
      quality: this.quality, settings: Settings,
      engine: this.engine,
      renderer: this.engine ? this.engine.renderer : null,
      scene: this.engine ? this.engine.scene : null,
      camera: this.engine ? this.engine.camera : null,
      post: this.engine ? this.engine.post : null,
      listener: this.engine ? this.engine.camera : null,
      group: this.group,
      // gameplay wiring
      course: this, stage: this, game: this.game,
      world: this.world, broadphase: this.broadphase,
      fx: this.fx, audio: this.audio, save: this.save,
      events: this.events,
      cam: this.game ? this.game.cam : null,
      getPlayer() { return self._playerRef; },
      get player() { return self._playerRef; },
      get collectibles() { return self.collectibles; },
      trigger(id, payload) { self.trigger(id, payload); },
      dropCoins(pos, n) { self.dropCoins(pos, n); },
      awardCoins(n, pos) { self.dropCoins(pos, n); },
      lightSink(site) { return self.addLightSite(site); },
      // determinism: one seeded stream per object index, stable across reloads
      rng: mulberry32(hashId(this.id + ':hz:' + index)),
      seed: hashId(this.id + ':hz:' + index),
      index, courseDef: this.def, stageDef: this.def, courseId: this.id,
    };
  }

  _buildHazard(o, index) {
    const ctx = this._hazardCtx(index);
    let kind = o.kind;
    let h = null;
    try {
      if (typeof HazardLib.makeHazard === 'function') {
        /* CONTRACT §21: makeHazard(kind, def, ctx).  A factory that still takes
           the Ascendant (def, ctx) shape is detected by arity rather than by
           trial-and-error, so a hazard is never constructed twice. */
        h = HazardLib.makeHazard.length >= 3
          ? HazardLib.makeHazard(kind, o, ctx)
          : HazardLib.makeHazard(o, ctx);
      } else if (HazardLib.HAZARDS) {
        if (kind === 'lava' && o.rising && typeof HazardLib.HAZARDS.risinglava === 'function') kind = 'risinglava';
        const f = HazardLib.HAZARDS[kind];
        if (typeof f === 'function') h = f(o, ctx);
      }
    } catch (e) {
      console.error('[Course ' + this.id + '] hazard factory threw for objects[' + index +
                    '] (kind "' + o.kind + '")', e);
      return null;
    }
    if (h && typeof h.then === 'function') {
      return h.then((res) => { this._registerHazard(res, o, index); })
              .catch((e) => {
                console.error('[Course ' + this.id + '] async hazard failed objects[' + index + ']', e);
              });
    }
    this._registerHazard(h, o, index);
    return null;
  }

  _registerHazard(h, o, index) {
    if (!h || typeof h.update !== 'function') {
      console.warn('[Course ' + this.id + '] no hazard produced for objects[' + index +
                   '] (kind "' + o.kind + '") — that obstacle is MISSING from the course');
      return;
    }
    if (h.mesh && !h.mesh.parent) this.group.add(h.mesh);

    const colliders = [];
    if (Array.isArray(h.colliders)) {
      for (let i = 0; i < h.colliders.length; i++) {
        const c = h.colliders[i];
        if (!c) continue;
        if (c.ref === undefined || c.ref === null) c.ref = h;
        this._addCollider(c, h);
        colliders.push(c);
      }
    }
    const kills = [];
    if (Array.isArray(h.kills)) {
      for (let i = 0; i < h.kills.length; i++) {
        const k = this._addKill(h.kills[i], h);
        if (k) kills.push(k);
      }
    }
    const volumes = [];
    const vsrc = Array.isArray(h.volumes) && h.volumes.length ? h.volumes : h.fields;
    if (Array.isArray(vsrc)) {
      for (let i = 0; i < vsrc.length; i++) {
        const v = this._addVolume(vsrc[i], h);
        if (v) volumes.push(v);
      }
    }

    const rec = {
      h, def: o, index, kind: o.kind, colliders, kills, volumes,
      cullable: !NEVER_CULL.has(o.kind),
      far: false, broken: false, errCount: 0,
      cx: 0, cy: 0, cz: 0, radius: 4,
    };
    this.hazards.push(rec);
    return rec;
  }

  /** Static culling sphere: the hazard's rest bounds padded by its motion range. */
  _measureHazard(rec) {
    const o = rec.def;
    _box1.makeEmpty();
    if (rec.h.mesh) {
      try { _box1.setFromObject(rec.h.mesh); } catch (e) { _box1.makeEmpty(); }
    }
    if (_box1.isEmpty() && fin3(o.p)) {
      _v1.set(o.p[0], o.p[1], o.p[2]);
      _box1.setFromCenterAndSize(_v1, _v2.set(2, 2, 2));
    }
    if (_box1.isEmpty()) { rec.cullable = false; return; }
    _box1.getCenter(_v1);
    _box1.getSize(_v2);
    rec.cx = _v1.x; rec.cy = _v1.y; rec.cz = _v1.z;
    let r = _v2.length() * 0.5;

    /* Pad by everything the def says it can travel: a mover culled at its rest
       bounds pops back in halfway through its stroke. */
    let travel = 0;
    if (o.motion) {
      const m = o.motion;
      if (fin3(m.to) && fin3(o.p)) {
        travel = Math.max(travel, Math.hypot(m.to[0] - o.p[0], m.to[1] - o.p[1], m.to[2] - o.p[2]));
      }
      if (fin(m.radius)) travel = Math.max(travel, Math.abs(m.radius) * 2);
      if (fin(m.sinkSpeed) && fin(m.period)) travel = Math.max(travel, Math.abs(m.sinkSpeed * m.period));
    }
    if (fin(o.travel)) travel = Math.max(travel, Math.abs(o.travel));
    if (fin(o.len)) travel = Math.max(travel, Math.abs(o.len) * 2);
    if (fin(o.from) && fin(o.to)) travel = Math.max(travel, Math.abs(o.to - o.from));
    if (fin3(o.a) && fin3(o.b)) {
      travel = Math.max(travel, Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1], o.b[2] - o.a[2]));
    }
    if (Array.isArray(o.pts) && o.pts.length > 1) {
      for (let i = 1; i < o.pts.length; i++) {
        if (!fin3(o.pts[i]) || !fin3(o.pts[0])) continue;
        travel = Math.max(travel, Math.hypot(o.pts[i][0] - o.pts[0][0], o.pts[i][1] - o.pts[0][1], o.pts[i][2] - o.pts[0][2]));
      }
    }
    r += travel;
    rec.radius = r;
    if (r > 45) rec.cullable = false;
  }

  /** A hazard that throws is suspended, not left to throw 60 times a second. */
  _hazardError(rec, e) {
    if (rec.broken) return;
    rec.broken = true;
    rec.errCount = (rec.errCount || 0) + 1;
    if (rec.errCount <= 3) {
      console.error('[Course ' + this.id + '] hazard objects[' + rec.index + '] (kind "' + rec.kind +
                    '") threw in update() and has been suspended', e);
      if (rec.errCount === 3) {
        console.error('[Course ' + this.id + '] ...further errors from objects[' + rec.index + '] silenced');
      }
    }
  }

  /* ── critters ────────────────────────────────────────────────────────── */

  _buildCritters() {
    const defs = Array.isArray(this.def.critters) ? this.def.critters : [];
    const npcs = Array.isArray(this.def.npcs) ? this.def.npcs : [];
    const all = defs.concat(npcs);
    if (!all.length || typeof CrittersMod.makeCritter !== 'function') {
      if (all.length) console.warn('[Course ' + this.id + '] entities/critters.js has no makeCritter — ' +
                                   all.length + ' critter(s) skipped');
      return;
    }
    for (let i = 0; i < all.length; i++) {
      const d = all[i];
      if (!d || typeof d.kind !== 'string') continue;
      const ctx = this._hazardCtx(1000 + i);
      ctx.courseId = this.id;
      let c = null;
      try {
        c = CrittersMod.makeCritter(d, ctx);
      } catch (e) {
        console.error('[Course ' + this.id + '] critters[' + i + '] (kind "' + d.kind + '") failed to build', e);
        continue;
      }
      if (!c) continue;
      if (c.mesh && !c.mesh.parent) this.group.add(c.mesh);
      if (Array.isArray(c.colliders)) {
        for (let k = 0; k < c.colliders.length; k++) this._addCollider(c.colliders[k], c);
      }
      if (Array.isArray(c.kills)) {
        for (let k = 0; k < c.kills.length; k++) this._addKill(c.kills[k], c);
      }
      if (Array.isArray(c.volumes)) {
        for (let k = 0; k < c.volumes.length; k++) this._addVolume(c.volumes[k], c);
      }
      /* A warden's death is the `boss` crest's trigger AND a Game-level beat. */
      if (c.events && typeof c.events.on === 'function') {
        const self = this;
        c.events.on('down', () => {
          self.trigger('warden-down');
          self.events.emit('wardenDown', c);
        });
        c.events.on('trigger', (id) => { self.trigger(id); });
        c.events.on('coins', (n, pos) => { self.dropCoins(pos, n); });
      }
      this.critters.push(c);
    }
  }

  /* ── collectibles ────────────────────────────────────────────────────── */

  _buildCollectibles() {
    const Ctor = CollectiblesMod.Collectibles;
    if (typeof Ctor !== 'function') {
      console.warn('[Course ' + this.id + '] entities/collectibles.js has no Collectibles — ' +
                   'this course has no coins, sigils or crests');
      return;
    }
    let col = null;
    try {
      col = new Ctor(this.def, {
        group: this.group, scene: this.engine ? this.engine.scene : null,
        mats: this.mats, theme: this.theme, themeId: this.themeId,
        fx: this.fx, audio: this.audio, save: this.save,
        courseId: this.id, world: this.broadphase, quality: this.quality,
        camera: this.engine ? this.engine.camera : null,
        engine: this.engine, course: this,
      });
    } catch (e) {
      console.error('[Course ' + this.id + '] Collectibles failed to build', e);
      return;
    }
    this.collectibles = col;
    /* Race pads and any other collectible collider join the broadphase so the
       player can actually stand on them. */
    if (Array.isArray(col.colliders)) {
      for (let i = 0; i < col.colliders.length; i++) this._addCollider(col.colliders[i], col);
    }
    /* Collectibles own their own pickup presentation and events; the Course only
       re-broadcasts the ones that are course-level beats. */
    if (col.events && typeof col.events.on === 'function') {
      const self = this;
      col.events.on('power', (id, dur) => { self.events.emit('power', id, dur); });
    }
  }

  /* ── colliders / volumes / kill volumes ──────────────────────────────── */

  _addCollider(c, ref) {
    if (!c) return null;
    if (ref !== undefined && (c.ref === undefined || c.ref === null)) c.ref = ref;
    if (c.active === undefined) c.active = true;
    if (typeof c.update === 'function') { try { c.update(); } catch (e) { /* aabb optional */ } }
    try { this.broadphase.add(c); } catch (e) {
      console.error('[Course ' + this.id + '] broadphase.add failed', e);
    }
    this._allColliders.push(c);
    return c;
  }

  _addVolume(v, ref) {
    if (!v) return null;
    if (ref !== undefined && (v.ref === undefined || v.ref === null)) v.ref = ref;
    if (v.active === undefined) v.active = true;
    if (this.volumes.indexOf(v) < 0) this.volumes.push(v);
    return v;
  }

  _addKill(k, ref) {
    if (!k) return null;
    if (ref !== undefined && (k.ref === undefined || k.ref === null)) k.ref = ref;
    if (k.active === undefined) k.active = true;
    if (this.killVolumes.indexOf(k) < 0) this.killVolumes.push(k);
    return k;
  }

  /**
   * The kill plane at `killY` (contract §24: KillVolume kind 'void').
   *
   * collider.js documents `{type:'plane', y:killY}` as "kills everything BELOW
   * y", which is exactly the authored semantic, so that is the primary form.
   * The box fields ride along as an equivalent fallback for any KillVolume build
   * that only implements boxes; deliberately no `normal`, so the `y` branch wins.
   */
  _buildVoidVolume() {
    const killY = this.killY;
    let cx = 0, cz = 0;
    if (!this.bounds.isEmpty()) { this.bounds.getCenter(_v1); cx = _v1.x; cz = _v1.z; }
    const halfXZ = 6000;
    const halfY = 600;
    const center = new THREE.Vector3(cx, killY - halfY, cz);
    const half = new THREE.Vector3(halfXZ, halfY, halfXZ);
    const min = new THREE.Vector3(cx - halfXZ, killY - 2 * halfY, cz - halfXZ);
    const max = new THREE.Vector3(cx + halfXZ, killY, cz + halfXZ);
    let kv = null;
    try {
      kv = new KillVolume({
        type: 'plane', kind: 'void', ref: null, y: killY,
        center, half, min, max,
        box: new THREE.Box3(min.clone(), max.clone()),
      });
    } catch (e) {
      console.error('[Course ' + this.id + '] KillVolume(void) construction failed', e);
      kv = null;
    }
    if (kv) {
      if (kv.active === undefined) kv.active = true;
      this.voidVolume = kv;
      this.killVolumes.push(kv);
    }
  }

  _computeBounds() {
    this.bounds.makeEmpty();
    const b = this.def.bounds;
    if (b && fin3(b.min) && fin3(b.max)) {
      /* Authored bounds are AUTHORITATIVE (contract §25) — the built geometry
         only ever widens them, never narrows them, so a course that reserves
         airspace for a cannon shot keeps it. */
      this.bounds.min.set(b.min[0], b.min[1], b.min[2]);
      this.bounds.max.set(b.max[0], b.max[1], b.max[2]);
    }
    for (let i = 0; i < this._chunks.length; i++) {
      if (!this._chunks[i].box.isEmpty()) this.bounds.union(this._chunks[i].box);
    }
    for (let i = 0; i < this.hazards.length; i++) {
      const m = this.hazards[i].h.mesh;
      if (!m) continue;
      try {
        _box1.setFromObject(m);
        if (!_box1.isEmpty()) this.bounds.union(_box1);
      } catch (e) { /* ignore odd hazard graphs */ }
    }
    for (let i = 0; i < this.terrains.length; i++) {
      const hf = this.terrains[i].heightfield;
      if (hf && hf.aabb && !hf.aabb.isEmpty()) this.bounds.union(hf.aabb);
    }
    if (this.def.spawn && fin3(this.def.spawn.p)) {
      this.bounds.expandByPoint(_v1.set(this.def.spawn.p[0], this.def.spawn.p[1], this.def.spawn.p[2]));
    }
    for (let i = 0; i < this.checkpoints.length; i++) this.bounds.expandByPoint(this.checkpoints[i].pos);
    if (this.bounds.isEmpty()) this.bounds.setFromCenterAndSize(_v1.set(0, 0, 0), _v2.set(20, 20, 20));
    this.bounds.expandByScalar(2);
  }

  /**
   * ONE pass over the finished course that takes `castShadow` away from
   * everything too small to cast a readable shadow.
   *
   * The shadow map is a SECOND full render of every caster: each hazard bolt,
   * critter eye, coin rim and signage plate that keeps `castShadow` costs an
   * extra draw call and its triangles again, for a smudge a few texels across
   * at 2048 over `shadowDistance` metres.  `_shouldCast` already applied this
   * rule inside the static merge; hazards, critters, collectibles and props
   * build their own meshes and never went through it, so the rule is applied
   * here to the whole graph instead of being restated in eight modules.
   *
   * Nothing is hidden and nothing is removed — only the shadow contribution of
   * sub-metre clutter, plus the materials three.js cannot cast correctly from
   * anyway (transparent, unlit basic and additive).
   */
  _pruneShadowCasters() {
    let dropped = 0;
    const q = (this.engine && this.engine.quality) || null;
    const minR = (q && Number.isFinite(q.shadowCasterRadius))
      ? q.shadowCasterRadius : SHADOW_MIN_RADIUS;
    this.group.traverse((obj) => {
      if (!obj.isMesh || !obj.castShadow) return;
      const m = obj.material;
      const mats = Array.isArray(m) ? m : [m];
      let bad = false;
      for (let i = 0; i < mats.length; i++) {
        const x = mats[i];
        if (!x) continue;
        if (x.transparent === true || x.isMeshBasicMaterial || x.blending === THREE.AdditiveBlending) bad = true;
      }
      const g = obj.geometry;
      if (!bad && g) {
        if (!g.boundingSphere) { try { g.computeBoundingSphere(); } catch (e) { /* keep casting */ } }
        if (g.boundingSphere) {
          obj.updateWorldMatrix(true, false);
          _v4.setFromMatrixScale(obj.matrixWorld);
          const sc = Math.max(_v4.x, _v4.y, _v4.z) || 1;
          if (g.boundingSphere.radius * sc < minR) bad = true;
        }
      }
      if (bad) { obj.castShadow = false; dropped++; }
    });
    this.stats.shadowPruned = dropped;
  }

  /* ── static merge ────────────────────────────────────────────────────── */

  _mergeStatic() {
    if (!this._chunks.length) return;
    let drawCalls = 0;
    for (let i = 0; i < this._chunks.length; i++) {
      const ch = this._chunks[i];
      drawCalls += this._mergeInto(ch.main, ch.recsMain, false);
      /* Detail art (decor, signage, clutter) is culled at `_detailFar` and is
         never the thing a player reads a landing off, so it never pays for a
         second pass through the shadow camera. */
      drawCalls += this._mergeInto(ch.detail, ch.recsDetail, true);
      ch.recsMain.length = 0;
      ch.recsDetail.length = 0;
      if (ch.box.isEmpty()) ch.box.setFromCenterAndSize(_v1.set(0, 0, 0), _v2.set(1, 1, 1));
    }
    this.stats.merged = drawCalls;
  }

  /**
   * Pull every mergeable mesh out of `roots`, bake its world matrix, group by
   * material and emit ONE mesh per (chunk, material).
   * @returns {number} resulting draw calls for this group
   */
  _mergeInto(target, roots, noCast) {
    if (!roots.length) return 0;
    const recs = [];
    const keep = [];
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      const rootMerged = this._collectMergeables(root, recs);
      if (!rootMerged && (root.children.length > 0 || root.isMesh || root.isLight ||
                          root.isPoints || root.isLine || root.isInstancedMesh)) {
        keep.push(root);
      } else if (!rootMerged) {
        if (root.parent) root.parent.remove(root);
      }
    }
    /* Clear then re-add: keeps the graph tidy and predictable. */
    for (let i = 0; i < roots.length; i++) {
      const r = roots[i];
      if (r.parent === target && keep.indexOf(r) < 0) target.remove(r);
    }

    const byMat = new Map();
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      let a = byMat.get(rec.mat);
      if (!a) { a = []; byMat.set(rec.mat, a); }
      a.push(rec);
    }

    let calls = keep.length;
    byMat.forEach((list, mat) => {
      /* Sole whole-mesh user of this material: reuse its geometry as-is, no copy. */
      if (list.length === 1 && list[0].gStart < 0) {
        const rec = list[0];
        const m = new THREE.Mesh(rec.geo, mat);
        m.castShadow = noCast ? false : rec.cast;
        m.receiveShadow = rec.recv;
        m.matrixAutoUpdate = false;
        m.matrix.copy(rec.mw);
        m.matrixWorldNeedsUpdate = true;
        target.add(m);
        calls++;
        return;
      }
      const geos = [];
      let cast = false, recv = false;
      for (let i = 0; i < list.length; i++) {
        const rec = list[i];
        const g = normaliseGeo(rec.geo, rec.mw, rec.gStart, rec.gCount);
        if (!g) continue;
        cast = cast || rec.cast;
        recv = recv || rec.recv;
        geos.push(g);
        this._mergeSources.add(rec.geo);
      }
      if (!geos.length) return;
      const merged = mergeParts(geos);
      if (!merged) {
        /* Every geo here is already a standalone, world-baked copy, so the
           fallback is one identity-transform mesh each — never the raw source,
           which for a group slice would draw the WHOLE multi-material mesh. */
        console.warn('[Course ' + this.id + '] merge failed for a material group (' + geos.length +
                     ' parts) — falling back to individual draws');
        for (let i = 0; i < geos.length; i++) {
          this._own(geos[i]);
          const m = new THREE.Mesh(geos[i], mat);
          m.castShadow = noCast ? false : cast; m.receiveShadow = recv;
          m.matrixAutoUpdate = false;
          m.updateMatrix();
          target.add(m);
          calls++;
        }
        return;
      }
      for (let i = 0; i < geos.length; i++) if (geos[i] !== merged) geos[i].dispose();
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      this._own(merged);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = 'merged_' + (mat.name || mat.type);
      mesh.castShadow = noCast ? false : cast;
      mesh.receiveShadow = recv;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      target.add(mesh);
      calls++;
    });
    return calls;
  }

  /** @returns {boolean} true if `root` itself was consumed by the merge */
  _collectMergeables(root, out) {
    root.updateMatrixWorld(true);
    const found = [];
    const stack = [root];
    while (stack.length) {
      const o = stack.pop();
      for (let i = 0; i < o.children.length; i++) stack.push(o.children[i]);
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh) continue;
      if (o.userData && (o.userData.noMerge || o.userData.dynamic)) continue;
      if (!o.material) continue;
      if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) continue;
      if (o.geometry.morphAttributes && Object.keys(o.geometry.morphAttributes).length) continue;
      if (Array.isArray(o.material)) {
        /* A multi-material mesh is mergeable only if its groups fully describe it. */
        const groups = o.geometry.groups;
        if (!groups || !groups.length) continue;
        let bad = false;
        for (let gi = 0; gi < groups.length; gi++) {
          const m = o.material[groups[gi].materialIndex];
          if (!m || !m.isMaterial) { bad = true; break; }
        }
        if (bad) continue;
      }
      found.push(o);
    }
    let rootConsumed = false;
    for (let i = 0; i < found.length; i++) {
      const o = found[i];
      const mw = o.matrixWorld.clone();
      const cast = this._shouldCast(o), recv = !!o.receiveShadow;
      if (Array.isArray(o.material)) {
        const groups = o.geometry.groups;
        for (let gi = 0; gi < groups.length; gi++) {
          const g = groups[gi];
          out.push({ geo: o.geometry, mat: o.material[g.materialIndex], mw, cast, recv,
                     gStart: g.start, gCount: g.count });
        }
      } else {
        out.push({ geo: o.geometry, mat: o.material, mw, cast, recv, gStart: -1, gCount: 0 });
      }
      if (o === root) rootConsumed = true;
      if (o.parent) o.parent.remove(o);
    }
    return rootConsumed;
  }

  /**
   * Source geometries are safe to free once nothing in the graph references them
   * — but NEVER a geometry another module owns.  builders.js hands out cached,
   * course-spanning geometry through GeoCache (`userData.__shared`) and we only
   * ever cloned from it; disposing one would blank every other user.
   */
  _disposeMergeSources() {
    if (!this._mergeSources.size) return;
    const inUse = new Set();
    this.group.traverse((o) => { if (o.geometry) inUse.add(o.geometry); });
    this._mergeSources.forEach((g) => {
      if (g.userData && g.userData.__shared) return;
      if (!inUse.has(g) && this._ownedGeo.has(g)) {
        this._ownedGeo.delete(g);
        try { g.dispose(); } catch (e) { /* already gone */ }
      }
    });
    this._mergeSources.clear();
  }

  /* ── checkpoints ─────────────────────────────────────────────────────── */

  /**
   * A checkpoint STATION: a chamfered metal pad, a dashed glowing ring, an
   * activation shockwave, a slow-turning glyph and a pillar of light — five
   * instanced meshes sharing one set of per-instance channels, so however many
   * pads a course carries the whole set costs five draw calls.
   *
   * Each pad also carries a `Volume` of kind 'checkpoint' whose `props.index` is
   * its own index: that is what game.js's belt-and-braces detector reads, and it
   * is why a pad's trigger shape is authored data (`cp.r`) rather than a
   * hard-coded radius.
   *
   * The `seed` channel gives every pad its OWN pulse phase.  Two pads visible in
   * one frame must never breathe in lockstep — in playtest that reads as one
   * light source, and the player stops treating them as separate promises.
   */
  _buildCheckpoints() {
    const defs = Array.isArray(this.def.checkpoints) ? this.def.checkpoints : [];
    this.checkpoints = [];
    if (!defs.length) return;

    const n = defs.length;
    for (let i = 0; i < n; i++) {
      const d = defs[i];
      const pos = v3(d.p, 0, 0, 0);
      const radius = fin(d.r) ? d.r : 2.15;
      const cp = {
        index: i,
        id: typeof d.id === 'string' ? d.id : ('cp' + (i + 1)),
        def: d,
        pos,
        yaw: fin(d.yaw) ? d.yaw : 0,
        clockOffset: fin(d.clockOffset) ? d.clockOffset : 0,
        radius,
        reached: false,
        state: 0,
        pulse: 0,
        angle: (i * 1.37) % 6.2831853,
        lockAngle: 0,
        locking: false,
        /* golden-ratio step: neighbouring pads are maximally out of phase */
        seed: (i * 0.6180339887) % 1,
        volume: null,
      };
      let vol = null;
      try {
        vol = new Volume({
          center: [pos.x, pos.y + 1.1, pos.z],
          half: [radius, 1.9, radius],
          kind: 'checkpoint',
          props: { index: i, cp: i, id: cp.id },
          ref: cp,
        });
      } catch (e) { vol = null; }
      if (vol) { cp.volume = vol; this._addVolume(vol, cp); }
      this.checkpoints.push(cp);
    }

    const g = new THREE.Group();
    g.name = 'checkpoints';
    g.matrixAutoUpdate = false;
    this.group.add(g);
    this._cpGroup = g;

    const aState = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    const aPulse = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    const aAngle = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    const aSeed = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    aState.setUsage(THREE.DynamicDrawUsage);
    aPulse.setUsage(THREE.DynamicDrawUsage);
    aAngle.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) aSeed.setX(i, this.checkpoints[i].seed);
    this._cpAttr = { aState, aPulse, aAngle, aSeed };

    const off = this.palette.checkpoint;
    const on = this.palette.checkpointOn;

    /* 1. the physical pad (a real PBR material, tinted per instance)
     *
     * ROUND 2 READABILITY FIX. `contrastcheck.py` samples the walked surface
     * just below the hero's feet — and at a checkpoint station that surface is
     * THIS DISC, not the floor. Measured (contrastcheck 17:56, every station of
     * both courses): keep spawn deck [33,64,74] vs band [97,88,93] = 1.61:1,
     * keep cp1 2.12, cp3 1.78, verdant cp1 [34,141,134] = 2.05 — i.e. the pad a
     * player lands on is DARKER than the floor it sits in, at seven of ten
     * stations, against a 3.5:1 law.
     *
     * The cause is the material, not the tint: `metal` has no diffuse albedo,
     * so a metal disc is only what it reflects, and in a dim hall that is
     * nothing — the same "a mirror in a dim hall renders as a dark floor"
     * failure the marble bake hit. A checkpoint pad is a LANDABLE SURFACE, so
     * it is now built out of the walked-surface family and tinted from
     * `palette.safe`, which is the exact colour the readability law names as
     * the bright half of the figure/ground pair. The checkpoint IDENTITY is
     * carried where it always was: the ring, the shockwave, the glyph and the
     * beacon, all in `checkpointOn`. */
    const baseGeo = chamferDisc(1.55, 0.14, 0.06, 44);
    this._own(baseGeo);
    /* NO per-instance tint. `setColorAt` writes `instanceColor`, which three
     * only multiplies into the albedo when the material also has
     * `vertexColors: true` — and turning that on for a geometry with no `color`
     * attribute makes WebGL feed the shader the default generic attribute
     * (0,0,0), i.e. it BLACKENS the mesh. Measured both ways this session:
     * untinted stone gave a light readable pad (`_shots/verdant-1/cp1.png`),
     * the "tinted" version gave a dark green disc and dropped verdant cp1 from
     * 2.53:1 to 1.10:1. The stone bank material already carries the theme's own
     * walked-surface tint, which is the colour the readability law wants here. */
    /* A checkpoint pad is a LANDING TARGET, and the readability law is measured
     * exactly on it (contrastcheck samples the band under the hero's feet). A
     * diffuse stone disc inside a hall lit to exposure 0.84 cannot be the bright
     * half of any figure/ground pair — measured: keep cp1 deck [49,64,68]
     * against a lit far wall at [117,95,84], i.e. the pad is the DARK half. So
     * the pad carries a low self-lit floor in the theme's own `safe` hue: it
     * reads in any light, in any room, without changing a single light in the
     * rig, and it is well under every theme's bloom threshold so it lifts rather
     * than glows. Cloned, never the shared bank material (the static merge uses
     * that one), and owned by the course so it is disposed with it. */
    const padMat = this._mat('stone').clone();
    padMat.emissive = new THREE.Color(this.palette.safe);
    padMat.emissiveIntensity = 0.55;
    padMat.name = 'cb.cp.pad';
    this._own(padMat);
    const baseMesh = new THREE.InstancedMesh(baseGeo, padMat, n);
    baseMesh.castShadow = false;
    baseMesh.receiveShadow = true;
    baseMesh.frustumCulled = false;
    baseMesh.userData.noMerge = true;
    g.add(baseMesh);
    this._cpBase = baseMesh;

    /* 2. the ring */
    const ringGeo = new THREE.TorusGeometry(1.42, 0.055, 8, 76);
    ringGeo.rotateX(-Math.PI / 2);
    ringGeo.translate(0, 0.155, 0);
    this._own(ringGeo);
    this._cpAttachAttrs(ringGeo);
    const ringMat = this._fxMaterial(RING_VERT, RING_FRAG, {
      uTime: { value: 0 }, uColorOff: { value: off.clone() }, uColorOn: { value: on.clone() },
    });
    const ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, n);
    ringMesh.frustumCulled = false;
    ringMesh.renderOrder = 6;
    g.add(ringMesh);
    this._cpRing = ringMesh;

    /* 3. the activation shockwave */
    const waveGeo = new THREE.RingGeometry(1.30, 1.52, 72, 1);
    waveGeo.rotateX(-Math.PI / 2);
    waveGeo.translate(0, 0.17, 0);
    this._own(waveGeo);
    this._cpAttachAttrs(waveGeo);
    const waveMat = this._fxMaterial(WAVE_VERT, WAVE_FRAG, { uColorOn: { value: on.clone() } });
    const waveMesh = new THREE.InstancedMesh(waveGeo, waveMat, n);
    waveMesh.frustumCulled = false;
    waveMesh.renderOrder = 6;
    g.add(waveMesh);
    this._cpWave = waveMesh;

    /* 4. the glyph */
    const glyphGeo = new THREE.PlaneGeometry(1.72, 1.72);
    glyphGeo.rotateX(-Math.PI / 2);
    this._own(glyphGeo);
    this._cpAttachAttrs(glyphGeo);
    const glyphTex = this._makeGlyphTexture();
    const glyphMat = this._fxMaterial(GLYPH_VERT, GLYPH_FRAG, {
      uTime: { value: 0 }, uMap: { value: glyphTex },
      uColorOff: { value: off.clone() }, uColorOn: { value: on.clone() },
    });
    const glyphMesh = new THREE.InstancedMesh(glyphGeo, glyphMat, n);
    glyphMesh.frustumCulled = false;
    glyphMesh.renderOrder = 7;
    g.add(glyphMesh);
    this._cpGlyph = glyphMesh;

    /* 5. the pillar of light — the silhouette that says CHECKPOINT across a bowl */
    /* ROUND 2: 1.02/1.30 m over 9.2 m is a 2.6 m wide, 9 m tall wall of light —
     * as a DISTANT beacon that is a slab, not a shaft.  A beacon reads by being
     * tall and NARROW; halving the radius costs nothing and stops the far pads
     * tinting whatever is behind them. */
    const colGeo = new THREE.CylinderGeometry(0.52, 0.86, 8.6, 18, 1, true);
    colGeo.translate(0, 4.3, 0);
    this._own(colGeo);
    this._cpAttachAttrs(colGeo);
    const colMat = this._fxMaterial(COLUMN_VERT, COLUMN_FRAG, {
      uTime: { value: 0 }, uGain: { value: 1.0 },
      uColorOff: { value: off.clone() }, uColorOn: { value: on.clone() },
    });
    const colMesh = new THREE.InstancedMesh(colGeo, colMat, n);
    colMesh.frustumCulled = false;
    colMesh.renderOrder = 5;
    g.add(colMesh);
    this._cpColumn = colMesh;

    /* Instance transforms are static — pads never move. */
    const meshes = [baseMesh, ringMesh, waveMesh, glyphMesh, colMesh];
    for (let i = 0; i < n; i++) {
      const cp = this.checkpoints[i];
      _m1.makeTranslation(cp.pos.x, cp.pos.y, cp.pos.z);
      for (let m = 0; m < meshes.length; m++) meshes[m].setMatrixAt(i, _m1);
    }
    for (let m = 0; m < meshes.length; m++) meshes[m].instanceMatrix.needsUpdate = true;
    this._cpMeshes = meshes;

    /* Restore this SESSION's checkpoint (Save.checkpoint is session-scoped by
       contract §3) so a course re-entered from the Keep lights what the player
       had already lit. */
    if (this.save && typeof this.save.checkpoint === 'function') {
      try {
        const idx = this.save.checkpoint(this.id);
        if (fin(idx) && idx >= 0) this.setCheckpointIndex(Math.min(idx, n - 1), true);
      } catch (e) { /* save is advisory here */ }
    }
  }

  _cpAttachAttrs(geo) {
    geo.setAttribute('aState', this._cpAttr.aState);
    geo.setAttribute('aPulse', this._cpAttr.aPulse);
    geo.setAttribute('aAngle', this._cpAttr.aAngle);
    geo.setAttribute('aSeed', this._cpAttr.aSeed);
  }

  /** The checkpoint glyph: a broken outer ring, radial ticks and a chevron stack. */
  _makeGlyphTexture() {
    if (typeof document === 'undefined') return null;
    const S = 256;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const x = c.getContext('2d');
    if (!x) return null;
    x.clearRect(0, 0, S, S);
    x.translate(S / 2, S / 2);
    x.strokeStyle = '#ffffff';
    x.lineCap = 'round';

    x.lineWidth = 7;
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2 + 0.16;
      const a1 = a0 + (Math.PI * 2) / 6 - 0.32;
      x.beginPath(); x.arc(0, 0, 104, a0, a1); x.stroke();
    }
    x.lineWidth = 4;
    x.globalAlpha = 0.75;
    x.beginPath(); x.arc(0, 0, 78, 0, Math.PI * 2); x.stroke();
    x.globalAlpha = 0.9;
    x.lineWidth = 6;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = i % 3 === 0 ? 56 : 66;
      x.beginPath();
      x.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      x.lineTo(Math.cos(a) * 72, Math.sin(a) * 72);
      x.stroke();
    }
    x.globalAlpha = 1;
    x.lineWidth = 11;
    for (let k = 0; k < 3; k++) {
      const off = -20 + k * 20;
      x.beginPath();
      x.moveTo(-26, off + 12);
      x.lineTo(0, off - 12);
      x.lineTo(26, off + 12);
      x.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this._own(tex);
    return tex;
  }

  _updateCheckpoints(dt) {
    const cps = this.checkpoints;
    if (!cps.length) return;
    const t = this._time;
    let dirty = false;
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      const target = cp.reached ? 1 : 0;
      if (Math.abs(cp.state - target) > 0.0005) {
        cp.state = damp ? damp(cp.state, target, 7.5, dt) : cp.state + (target - cp.state) * Math.min(1, dt * 7.5);
        dirty = true;
      } else if (cp.state !== target) { cp.state = target; dirty = true; }

      if (cp.pulse > 0) { cp.pulse = Math.max(0, cp.pulse - dt / 0.9); dirty = true; }

      if (cp.locking) {
        cp.angle += (cp.lockAngle - cp.angle) * Math.min(1, dt * 5.5);
        if (Math.abs(cp.lockAngle - cp.angle) < 0.004) { cp.angle = cp.lockAngle; cp.locking = false; }
        dirty = true;
      } else if (!cp.reached) {
        cp.angle += dt * 0.75;
        if (cp.angle > 6.2831853) cp.angle -= 6.2831853;
        dirty = true;
      } else {
        /* Locked, but never DEAD on screen: a slow breathing wobble on its own
           seeded phase. */
        cp.angle = cp.lockAngle + Math.sin(t * 0.9 + cp.seed * 6.2831853) * 0.035;
        dirty = true;
      }
    }
    if (dirty) this._syncCheckpointAttrs(true);
    if (this._cpRing) this._cpRing.material.uniforms.uTime.value = t;
    if (this._cpGlyph) this._cpGlyph.material.uniforms.uTime.value = t;
    if (this._cpColumn) this._cpColumn.material.uniforms.uTime.value = t;
  }

  _syncCheckpointAttrs(withColor) {
    const a = this._cpAttr;
    if (!a) return;
    const cps = this.checkpoints;
    for (let i = 0; i < cps.length; i++) {
      const cp = cps[i];
      a.aState.setX(i, cp.state);
      a.aPulse.setX(i, cp.pulse);
      a.aAngle.setX(i, cp.angle);
    }
    a.aState.needsUpdate = true;
    a.aPulse.needsUpdate = true;
    a.aAngle.needsUpdate = true;
    /* `withColor` used to re-tint the pad's instanceColor on lighting. That was
     * always a no-op (the pad material has no `vertexColors`, so nothing reads
     * the varying — see the pad note in _buildCheckpoints) and, now that the
     * build no longer allocates instanceColor at all, the first such call would
     * ALLOCATE it and change the shader permutation mid-play for no visible
     * gain. The lit/unlit read is carried by the ring, shockwave, glyph and
     * beacon, all of which key off `aState` in their own shaders. */
    void withColor;
  }

  /**
   * Light a checkpoint.  Never re-fires and never regresses to a lower index.
   *
   * OWNERSHIP: the Course owns DETECTION and the pad's own presentation — the
   * ring, the glyph lock, the light column.  It does NOT play a sound, spend a
   * particle, write the save or touch the HUD; it emits `checkpoint` and Game
   * does all of that, once.
   *
   * @param {number} i
   * @param {boolean} [silent] skip the event (used when restoring a save)
   * @returns {boolean} whether this call changed the checkpoint index
   */
  activateCheckpoint(i, silent) {
    if (!fin(i) || i < 0 || i >= this.checkpoints.length) return false;
    if (i <= this.cpIndex) return false;

    for (let j = 0; j <= i; j++) {
      const cp = this.checkpoints[j];
      if (cp.reached) continue;
      cp.reached = true;
      cp.pulse = j === i ? 1 : 0;
      cp.lockAngle = Math.round(cp.angle / (Math.PI / 4)) * (Math.PI / 4);
      cp.locking = true;
    }
    this.cpIndex = i;
    this._syncCheckpointAttrs(true);
    if (!silent) this.events.emit('checkpoint', i, this.checkpoints[i]);
    return true;
  }

  /** Restore the lit state up to `i` without firing events (save restore / resetFrom). */
  setCheckpointIndex(i, silent) {
    if (!fin(i)) return;
    const n = this.checkpoints.length;
    const idx = clamp(Math.floor(i), -1, n - 1);
    for (let j = 0; j < n; j++) {
      const cp = this.checkpoints[j];
      const on = j <= idx;
      cp.reached = on;
      cp.state = on ? 1 : 0;
      cp.pulse = 0;
      cp.locking = false;
      if (on) {
        cp.lockAngle = Math.round(cp.angle / (Math.PI / 4)) * (Math.PI / 4);
        cp.angle = cp.lockAngle;
      }
    }
    this.cpIndex = idx;
    this._syncCheckpointAttrs(true);
    if (!silent && idx >= 0) this.events.emit('checkpoint', idx, this.checkpoints[idx]);
  }

  /** @returns {number} index of an un-reached checkpoint pad at `p`, else -1 */
  checkpointAt(p) {
    if (!p) return -1;
    for (let i = this.cpIndex + 1; i < this.checkpoints.length; i++) {
      const cp = this.checkpoints[i];
      if (cp.reached) continue;
      if (cp.volume && typeof cp.volume.contains === 'function') {
        if (cp.volume.contains(p)) return i;
        continue;
      }
      const dx = p.x - cp.pos.x, dz = p.z - cp.pos.z, dy = p.y - cp.pos.y;
      if (dx * dx + dz * dz <= cp.radius * cp.radius && dy > -1.7 && dy < 3.6) return i;
    }
    return -1;
  }

  /**
   * Nearest checkpoint to a world point, by 3D distance.  Used by the death
   * handler when a course has no linear order to fall back on — an open diorama
   * can be re-entered from any direction, so "the last one lit" is not always
   * the one the player will want.
   * @returns {number} index, or -1 when the course has no checkpoints
   */
  nearestCheckpoint(pos) {
    const cps = this.checkpoints;
    if (!cps.length || !pos) return -1;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < cps.length; i++) {
      const c = cps[i].pos;
      const dx = pos.x - c.x, dy = pos.y - c.y, dz = pos.z - c.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /* ── the Keep's gates ────────────────────────────────────────────────── */

  /**
   * A GATE is a painting, a door or a pane of glass that leads into a course.
   *
   * The record deliberately carries BOTH shapes the rest of the game reads:
   *   - `{def, volume, mesh}`  — the compiler-facing view
   *   - `{course, kind, p, pos, yaw, requires, locked, setLocked()}` — the
   *     Game-facing view (game.js `_resolveGates` reads these directly)
   * so nothing has to translate between them at runtime.
   *
   * Art comes from a `painting`/`gatedoor` OBJECT when the course data authored
   * one, and is built here from the gate entry when it did not — a hub that only
   * lists `gates` still gets frames on the walls.  A sealed gate is visible and
   * readable (the shimmer lattice, `SEAL_FRAG`) rather than hidden: a locked
   * door the player can see is a promise; a missing one is a dead end.
   */
  _buildGates() {
    this.gates = [];
    const entries = Array.isArray(this.def.gates) ? this.def.gates : [];
    const claimed = new Set();

    for (let i = 0; i < entries.length; i++) {
      const gd = entries[i];
      if (!gd || typeof gd.course !== 'string') continue;
      let art = null;
      /* match by course id first, then by proximity to the authored point */
      for (let k = 0; k < this._gateObjects.length; k++) {
        if (claimed.has(k)) continue;
        const o = this._gateObjects[k].def;
        if (o.course && o.course === gd.course) { art = this._gateObjects[k]; claimed.add(k); break; }
      }
      if (!art && fin3(gd.p)) {
        let bestK = -1, bestD = 9;   // 3 m radius
        for (let k = 0; k < this._gateObjects.length; k++) {
          if (claimed.has(k)) continue;
          const o = this._gateObjects[k].def;
          if (!fin3(o.p)) continue;
          const dx = o.p[0] - gd.p[0], dy = o.p[1] - gd.p[1], dz = o.p[2] - gd.p[2];
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestD) { bestD = d; bestK = k; }
        }
        if (bestK >= 0) { art = this._gateObjects[bestK]; claimed.add(bestK); }
      }
      this.gates.push(this._makeGate(gd, art, this.gates.length));
    }

    /* Any painting/gatedoor object that names a course but was not claimed by a
       `gates` entry becomes its own gate. */
    for (let k = 0; k < this._gateObjects.length; k++) {
      if (claimed.has(k)) continue;
      const rec = this._gateObjects[k];
      if (!rec.def.course) continue;
      this.gates.push(this._makeGate(rec.def, rec, this.gates.length));
    }
    this._gateObjects.length = 0;
  }

  /**
   * @param {object} gd   the gate definition (a `def.gates` entry, or the object)
   * @param {object|null} art {def, built} of the painting/gatedoor object, if any
   */
  _makeGate(gd, art, index) {
    const artMeta = (art && art.built && art.built.mesh && art.built.mesh.userData)
      ? art.built.mesh.userData.gate : null;
    const pos = v3(gd.p, 0, 0, 0);
    const yaw = fin(gd.yaw) ? gd.yaw : (art && fin(art.def.yaw) ? art.def.yaw : 0);
    const kind = gd.kind || (artMeta && artMeta.kind) ||
                 (art && art.def.kind === 'gatedoor' ? 'door' : 'painting');
    const w = fin(gd.w) ? gd.w : (art && fin(art.def.w) ? art.def.w : (kind === 'door' ? 3.4 : 3.0));
    const h = fin(gd.h) ? gd.h : (art && fin(art.def.h) ? art.def.h : (kind === 'door' ? 4.6 : 3.6));
    let requires = (gd.requires && fin(gd.requires.crests)) ? gd.requires.crests : 0;
    if (!requires && artMeta && fin(artMeta.requires)) requires = artMeta.requires;

    let mesh = art && art.built ? art.built.mesh : null;
    let volume = null;
    if (art && art.built && Array.isArray(art.built.volumes)) {
      for (let i = 0; i < art.built.volumes.length; i++) {
        const v = art.built.volumes[i];
        if (v && (v.kind === 'trigger' || v.kind === 'checkpoint')) { volume = v; break; }
      }
    }

    /* No authored art: build a frame here so the wall is never blank.  The art
       is built UNLOCKED on purpose — the lock is a live state Game flips from
       the crest total, so it belongs on the animated seal below, not baked into
       a material at build time. */
    if (!mesh) {
      const fnName = kind === 'door' ? 'buildGateDoor' : 'buildPainting';
      const fn = Builders[fnName];
      const bdef = { kind: kind === 'door' ? 'gatedoor' : 'painting', p: gd.p, yaw, w, h,
                     course: gd.course, realm: gd.realm, requires: gd.requires,
                     locked: false, mat: gd.mat };
      let built = null;
      if (typeof fn === 'function') {
        try { built = fn(bdef, this.theme, this.mats); } catch (e) { built = null; }
      }
      if (!built || !built.mesh) built = this._fallbackGateArt(bdef, w, h, yaw);
      markNoMerge(built.mesh);
      this._placeBuilt(built, bdef, -1, false);
      mesh = built.mesh;
      if (!volume && Array.isArray(built.volumes) && built.volumes.length) volume = built.volumes[0];
    }

    /* The trigger volume: a slab standing in the doorway, on the ROOM side,
       reaching the floor the player walks in on.  Built (or re-fitted) here
       because only the Course knows both the authored floor and the art. */
    volume = this._fitGateTrigger(volume, gd, pos, yaw, w, h, index);
    if (volume) this._addVolume(volume, null);

    /* The seal: a shimmer plane in the opening while the gate is locked. */
    const sealMat = this._fxMaterial(SEAL_VERT, SEAL_FRAG, {
      uTime: { value: 0 }, uLock: { value: 1 },
      uColor: { value: this.palette.checkpoint.clone() },
      uHot: { value: this.palette.accent.clone() },
    }, THREE.DoubleSide);
    const sealGeo = new THREE.PlaneGeometry(Math.max(0.4, w * 0.96), Math.max(0.4, h * 0.96));
    this._own(sealGeo);
    const seal = new THREE.Mesh(sealGeo, sealMat);
    seal.position.set(pos.x, pos.y + h * 0.5, pos.z);
    seal.rotation.y = yaw;
    seal.translateZ(0.06);
    seal.renderOrder = 8;
    seal.userData.noMerge = true;
    seal.matrixAutoUpdate = false;
    seal.updateMatrix();
    this.group.add(seal);

    /* A `gatedoor` from builders hangs its leaves on pivots and exposes
       `setOpen(t)`, which also deactivates the door colliders as it swings.
       `_updateGates` drives it off the same eased lock value as the seal, so the
       doors open with the shimmer rather than after it. */
    const setOpen = (mesh && mesh.userData && typeof mesh.userData.setOpen === 'function')
      ? mesh.userData.setOpen : null;

    const gate = {
      index,
      def: gd,
      course: gd.course || (artMeta && artMeta.course) || null,
      kind,
      /* both spellings: game.js reads `p`/`pos` through its own toVec3 */
      p: [pos.x, pos.y, pos.z],
      pos,
      yaw,
      w, h,
      requires,
      requiresCrests: requires,
      volume,
      mesh: mesh || null,
      seal,
      sealMat,
      setOpen,
      locked: true,
      lockT: 1,
      /** Game flips this whenever the crest total changes. */
      setLocked(v) {
        gate.locked = !!v;
        /* The trigger volume always reads: Game decides whether entering it
           opens the course card or shows the "N CRESTS" prompt.  Silencing it
           here would make a sealed gate un-promptable, which is worse than a
           locked door — the player would not know what it wants. */
        if (gate.volume) gate.volume.active = true;
        return gate.locked;
      },
    };
    if (setOpen) { try { setOpen(0); } catch (e) { /* art hook is optional */ } }
    return gate;
  }

  /**
   * Fit a gate's walk-in trigger to the room in front of it.
   *
   * WHY THIS EXISTS. The builders place their trigger from the art's own frame
   * of reference and cannot know two things the Course does: which side of the
   * wall the room is on, and where its floor is. Left to them the verdant-1
   * painting's slab sat 0.9 m BEHIND the picture plane (inside the masonry, and
   * 0.33 m further in than the wall collider lets Nim reach) and floated 0.6 m
   * above the floor — while `_updateGates` tests `volume.contains(player.pos)`,
   * and `player.pos` is the FEET (contract §10). The dwell could therefore never
   * accumulate: walking into the painting did nothing, and only KeyE opened the
   * card, against contract §26.
   *
   * The slab this builds:
   *   · protrudes IN FRONT of the frame (local +Z — the face the art is on, and
   *     the side keep.js publishes as `exitP = p − heading(yaw) · 1.9`),
   *   · spans from the walking floor (authored `exitP.y`, else a raycast, else a
   *     generous drop below the frame) to the top of the frame,
   *   · is a little wider than the frame so a shoulder counts as an entry.
   *
   * Build-time only — no per-frame allocation.
   */
  _fitGateTrigger(volume, gd, pos, yaw, w, h, index) {
    /* Local +Z is the face of a painting/door (its plate, beads and sigil are
       all authored at +z), and keep.js's `yaw` is the heading the player HAS
       walking in, so −heading(yaw) = local +Z = back into the room. */
    const fx = Math.sin(yaw), fz = Math.cos(yaw);

    /* --- the floor in front of the gate ------------------------------- */
    let floorY = NaN;
    if (fin3(gd.exitP)) floorY = gd.exitP[1] - 0.05;
    if (!fin(floorY) && fin(gd.floor)) floorY = gd.floor;
    if (!fin(floorY) && this.broadphase && typeof this.broadphase.raycast === 'function') {
      const org = _v1.set(pos.x + fx * 0.9, pos.y + h * 0.5, pos.z + fz * 0.9);
      const dir = _v2.set(0, -1, 0);
      const hit = { t: 0, normal: new THREE.Vector3(), collider: null, heightfield: null };
      try {
        if (this.broadphase.raycast(org, dir, h + 10, hit) && fin(hit.t)) floorY = org.y - hit.t;
      } catch (e) { floorY = NaN; }
    }
    if (!fin(floorY)) floorY = pos.y - h * 0.5 - 1.2;

    const top = pos.y + h * 0.5 + 0.15;
    const bottom = Math.min(floorY - 0.20, pos.y - h * 0.5, top - 0.6);
    const depth = GATE_TRIGGER_DEPTH;                 // metres in FRONT of the plane
    const cx = pos.x + fx * (depth * 0.5 - 0.10);
    const cz = pos.z + fz * (depth * 0.5 - 0.10);
    const cy = (top + bottom) * 0.5;
    const hx = Math.max(0.85, w * 0.5 + 0.15);
    const hy = Math.max(0.6, (top - bottom) * 0.5);
    const hz = depth * 0.5;

    if (volume && volume.center && volume.half) {
      volume.center.set(cx, cy, cz);
      volume.half.set(hx, hy, hz);
      if (volume.quat && typeof volume.quat.setFromEuler === 'function') {
        _eulerHolder.rotation.set(0, yaw, 0);
        volume.quat.copy(_eulerHolder.quaternion);
      }
      volume.kind = 'trigger';
      volume.active = true;
      if (typeof volume.update === 'function') volume.update();
      return volume;
    }

    try {
      return new Volume({
        center: [cx, cy, cz],
        half: [hx, hy, hz],
        quat: [0, yaw, 0],
        kind: 'trigger',
        props: { gate: index, course: gd.course },
      });
    } catch (e) { return null; }
  }

  /** A framed panel with a shimmering surface — used when builders ship no painting. */
  _fallbackGateArt(bdef, w, h, yaw) {
    const g = new THREE.Group();
    const frameParts = [];
    const t = 0.22;
    const mkBar = (x, y, sx, sy) => {
      const b = chamferBox(sx, sy, 0.28, 0.05);
      b.translate(x, y, 0);
      frameParts.push(b);
    };
    mkBar(0, h * 0.5 + t * 0.5, w + t * 2, t);
    mkBar(0, -h * 0.5 - t * 0.5, w + t * 2, t);
    mkBar(-w * 0.5 - t * 0.5, 0, t, h);
    mkBar(w * 0.5 + t * 0.5, 0, t, h);
    const frame = mergeParts(frameParts);
    for (let i = 0; i < frameParts.length; i++) if (frameParts[i] !== frame) frameParts[i].dispose();
    if (frame) {
      this._own(frame);
      const fm = new THREE.Mesh(frame, this._mat('gold'));
      fm.castShadow = true;
      fm.receiveShadow = true;
      g.add(fm);
    }
    const canvasGeo = new THREE.PlaneGeometry(w, h);
    this._own(canvasGeo);
    const cm = new THREE.Mesh(canvasGeo, this._mat('painting'));
    cm.receiveShadow = true;
    g.add(cm);

    const p = v3(bdef.p, 0, 0, 0);
    g.position.set(p.x, p.y + h * 0.5, p.z);
    g.rotation.y = yaw;
    return { mesh: g, colliders: [] };
  }

  /** Ease the seal open/closed and keep its shimmer running. */
  _updateGates(dt) {
    const gs = this.gates;
    if (!gs.length) return;
    const t = this._time;
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i];
      const target = g.locked ? 1 : 0;
      if (Math.abs(g.lockT - target) > 0.001) {
        g.lockT = damp ? damp(g.lockT, target, 5.0, dt) : g.lockT + (target - g.lockT) * Math.min(1, dt * 5);
      } else g.lockT = target;
      if (g.sealMat) {
        g.sealMat.uniforms.uTime.value = t;
        g.sealMat.uniforms.uLock.value = g.lockT;
      }
      if (g.seal) g.seal.visible = g.lockT > 0.004;
      if (g.setOpen && g.lockT !== g._openT) {
        g._openT = g.lockT;
        try { g.setOpen(1 - g.lockT); } catch (e) { /* art hook is optional */ }
      }
    }
  }

  /* ── power hats ──────────────────────────────────────────────────────── */

  /**
   * A POWER is a hat on a plinth of light.  Taking it emits
   * `power(kind, seconds)`; Game owns what the power then DOES (hero.setPower,
   * the HUD timer, the controller flag).  The hat re-appears after
   * `respawn` seconds so a course is never made unwinnable by one bad attempt.
   */
  _buildPowers() {
    const defs = Array.isArray(this.def.powers) ? this.def.powers : [];
    this.powers = [];
    if (!defs.length) return;

    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      const pos = v3(d.p, 0, 0, 0);
      const color = colorOf(d.color, this.palette.accent.getHex());
      const root = new THREE.Group();
      root.position.copy(pos);
      root.userData.noMerge = true;

      /* The hat: a lathed crown + a brim + a band.  Multi-part and bevelled —
         never a naked cone (contract hard rule 1). */
      const crownPts = [
        new THREE.Vector2(0.0, 0.0),
        new THREE.Vector2(0.20, 0.02),
        new THREE.Vector2(0.215, 0.16),
        new THREE.Vector2(0.20, 0.30),
        new THREE.Vector2(0.155, 0.34),
        new THREE.Vector2(0.0, 0.355),
      ];
      const crown = new THREE.LatheGeometry(crownPts, 28);
      crown.computeVertexNormals();
      this._own(crown);
      const crownMesh = new THREE.Mesh(crown, this._mat('cloth'));
      crownMesh.castShadow = true;
      root.add(crownMesh);

      const brim = new THREE.TorusGeometry(0.235, 0.055, 8, 30);
      brim.rotateX(-Math.PI / 2);
      brim.translate(0, 0.045, 0);
      this._own(brim);
      const brimMesh = new THREE.Mesh(brim, this._mat('cloth'));
      brimMesh.castShadow = true;
      root.add(brimMesh);

      const band = new THREE.CylinderGeometry(0.222, 0.222, 0.075, 26, 1, true);
      band.translate(0, 0.115, 0);
      this._own(band);
      root.add(new THREE.Mesh(band, this._glowMat(color, 1.5)));

      /* the plinth of light */
      const shaftGeo = new THREE.CylinderGeometry(0.20, 0.52, 2.6, 18, 1, true);
      shaftGeo.translate(0, -1.3, 0);
      this._own(shaftGeo);
      const shaftMat = this._fxMaterial(HALO_VERT, HALO_FRAG, {
        uTime: { value: 0 }, uState: { value: 1 }, uMode: { value: 0 },
        uColor: { value: color.clone() },
      });
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.renderOrder = 5;
      root.add(shaft);

      const ringGeo = new THREE.TorusGeometry(0.62, 0.03, 6, 44);
      ringGeo.rotateX(-Math.PI / 2);
      ringGeo.translate(0, -2.58, 0);
      this._own(ringGeo);
      const ringMat = this._fxMaterial(HALO_VERT, HALO_FRAG, {
        uTime: { value: 0 }, uState: { value: 1 }, uMode: { value: 1 },
        uColor: { value: color.clone() },
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.renderOrder = 6;
      root.add(ring);

      this.group.add(root);

      let vol = null;
      try {
        vol = new Volume({
          center: [pos.x, pos.y + 0.1, pos.z],
          half: [0.85, 1.15, 0.85],
          kind: 'trigger',
          props: { power: d.kind, index: i },
        });
      } catch (e) { vol = null; }
      if (vol) this._addVolume(vol, null);

      const rec = {
        index: i, def: d, kind: d.kind, pos,
        duration: fin(d.duration) ? d.duration : 30,
        respawn: fin(d.respawn) ? d.respawn : 12,
        root, shaftMat, ringMat, volume: vol,
        taken: false, cooldown: 0, state: 1,
        phase: (i * 0.6180339887) % 1,
      };
      this.powers.push(rec);
      this._glowSites.push({ pos: pos.clone(), color, halo: 0.7, pool: 1.9 });
    }
  }

  _updatePowers(dt) {
    const ps = this.powers;
    if (!ps.length) return;
    const t = this._time;
    const havePP = this._ppValid;
    const px = this._pp.x, py = this._pp.y, pz = this._pp.z;
    for (let i = 0; i < ps.length; i++) {
      const r = ps[i];
      if (r.taken) {
        r.cooldown -= dt;
        if (r.cooldown <= 0) { r.taken = false; }
      }
      const target = r.taken ? 0 : 1;
      r.state = damp ? damp(r.state, target, 8, dt) : r.state + (target - r.state) * Math.min(1, dt * 8);
      r.root.visible = r.state > 0.01;
      r.root.rotation.y = t * 0.9 + r.phase * 6.2831853;
      r.root.position.y = r.pos.y + Math.sin(t * 1.5 + r.phase * 6.2831853) * 0.12;
      r.root.scale.setScalar(Math.max(0.001, r.state));
      if (r.shaftMat) { r.shaftMat.uniforms.uTime.value = t; r.shaftMat.uniforms.uState.value = r.state; }
      if (r.ringMat) { r.ringMat.uniforms.uTime.value = t; r.ringMat.uniforms.uState.value = r.state; }

      if (r.taken || !havePP || r.state < 0.6) continue;
      let inside;
      if (r.volume && typeof r.volume.contains === 'function') {
        _v2.set(px, py, pz);
        inside = r.volume.contains(_v2);
      } else {
        const dx = px - r.pos.x, dz = pz - r.pos.z, dy = py - r.pos.y;
        inside = dx * dx + dz * dz < 0.9 && dy > -1.3 && dy < 1.6;
      }
      if (!inside) continue;
      r.taken = true;
      r.cooldown = r.respawn;
      this.events.emit('power', r.kind, r.duration);
    }
  }

  _resetPowers() {
    for (let i = 0; i < this.powers.length; i++) {
      const r = this.powers[i];
      r.taken = false;
      r.cooldown = 0;
      r.state = 1;
      r.root.visible = true;
      r.root.scale.setScalar(1);
    }
  }

  /* ═══════════════════════════════════════════════════════════════ loop ══ */

  /**
   * Register the player so hazard culling, light selection, stand detection and
   * pad triggers track the FEET, not the eye.  Game calls this the moment the
   * course is built; without it `_resolvePlayerPos` falls back to the camera,
   * which in third person sits metres away from the hero and skews every
   * proximity test in this file — so reaching that fallback is reported once,
   * loudly, naming the call that was missed.
   */
  setPlayer(player) {
    this._playerRef = player || null;
    if (this._playerRef) this._warnedCameraFallback = false;
    return this;
  }

  /**
   * Advance the course by one frame.
   *
   * ORDER MATTERS.  Hazards move first (they carry the player), then critters
   * (they read where the player is), then collectibles (they magnet toward the
   * player's final position of LAST frame — game.js runs course.update before
   * player.update, so everything here reads one physics step of history, which
   * is exactly what makes carrying and magnetism stable instead of jittery).
   *
   * @param {number} dt seconds (already clamped by the engine)
   * @param {object|THREE.Vector3} [player] the live Player, or a bare position
   */
  update(dt, player) {
    if (!this._built || this._disposed) return;
    if (!fin(dt)) dt = 0;
    if (dt > 0.25) dt = 0.25;

    this.clock += dt;
    this._time += dt;

    if (player && player.isVector3) { this._pp.copy(player); this._ppValid = true; }
    else {
      if (player && player.pos && fin(player.pos.x)) this._playerRef = player;
      this._ppValid = this._resolvePlayerPos();
    }
    const p = this._playerRef;

    this._detectStand();
    this._updateHazards(dt, p);
    this._updateCritters(dt, p);
    this._updateWaters(dt);
    this._updateCulling(dt);
    this._updateLights(dt);
    this._updateCheckpoints(dt);
    this._updateGates(dt);
    this._updatePowers(dt);

    if (this.collectibles && typeof this.collectibles.update === 'function') {
      try { this.collectibles.update(dt, p); } catch (e) { this._once('collectibles', e); }
    }

    if (this._ppValid) {
      const cp = this.checkpointAt(this._pp);
      if (cp >= 0) this.activateCheckpoint(cp, false);
    }

    /* Shared animation clocks — one write each, never per material. */
    if (typeof Builders.setFxTime === 'function') Builders.setFxTime(this._time);
    if (typeof PropsMod.setPropsTime === 'function') PropsMod.setPropsTime(this._time);
    if (this.mats && typeof this.mats.update === 'function') {
      try { this.mats.update(dt, this._time); } catch (e) { /* optional hook */ }
    }
  }

  /** One console line per subsystem per course, not one per frame. */
  _once(tag, e) {
    if (!this._onceSet) this._onceSet = new Set();
    if (this._onceSet.has(tag)) return;
    this._onceSet.add(tag);
    console.error('[Course ' + this.id + '] ' + tag + ' threw in update() (silenced after this)', e);
  }

  /**
   * Feet first: the registered Player, then a player handed in through ctx.  The
   * camera is a LAST-DITCH fallback that in a third-person game is metres behind
   * and above the hero, so reaching it is reported once, loudly, naming the call
   * that was missed — a silent multi-metre error is unfindable.
   */
  _resolvePlayerPos() {
    const pr = this._playerRef;
    if (pr && pr.pos && fin(pr.pos.x)) { this._pp.copy(pr.pos); return true; }
    const cpr = this.ctx && this.ctx.player;
    if (cpr && cpr.pos && fin(cpr.pos.x)) { this._pp.copy(cpr.pos); return true; }
    const cam = this.engine && this.engine.camera;
    if (cam) {
      if (!this._warnedCameraFallback) {
        this._warnedCameraFallback = true;
        console.error('[Course ' + this.id + '] no player registered — trigger detection, culling and ' +
                      'light selection are running against the CAMERA, which in third person sits ' +
                      'several metres from the hero. Call course.setPlayer(player) after Course.load().');
      }
      if (cam.parent) this._pp.setFromMatrixPosition(cam.matrixWorld);
      else this._pp.copy(cam.position);
      return fin(this._pp.x);
    }
    return false;
  }

  /**
   * STAND DETECTION.  The collision layer never calls `hazard.onStand()`, and a
   * hazard's ctx carries no player handle, so crumble tiles, sinkers and
   * elevators would self-detect by proximity — which in Ascendant measured as
   * INERT in the shipped game on four stages.  The Course is the one place that
   * knows BOTH the player's ground contact and which hazard owns that collider,
   * so it fires the hook on a STAND TRANSITION: the frame the player's grounded
   * collider becomes this one, whether by landing or by walking on from a
   * neighbour, and never on a fly-over, a walk-underneath or a teleport-in (a
   * respawn arrives airborne).
   *
   * course.update() runs before player.update() (game.js), so the contact read
   * here is last frame's: one physics step of latency, no proximity band.
   */
  _detectStand() {
    const p = this._playerRef;
    const c = (p && p.grounded === true) ? (p.groundCollider || null) : null;
    if (c === this._standOn) return;
    this._standOn = c;
    if (!c) return;
    const ref = c.ref;
    if (ref && typeof ref.onStand === 'function') {
      try { ref.onStand(p, c, this.clock); } catch (e) { /* a hook threw; the sim goes on */ }
    }
  }

  _updateHazards(dt, player) {
    const t = this.clock;
    const hz = this.hazards;
    const havePP = this._ppValid;
    const px = this._pp.x, py = this._pp.y, pz = this._pp.z;
    for (let i = 0; i < hz.length; i++) {
      const rec = hz[i];
      if (rec.broken) continue;
      const h = rec.h;

      /* DETERMINISM LAW: the transform is a pure function of `t` and is NEVER
         skipped, however far away the hazard is. Only its VISUAL is culled. */
      try { h.update(t, dt, player); } catch (e) { this._hazardError(rec, e); continue; }

      if (havePP && rec.cullable && h.mesh) {
        const dx = px - rec.cx, dy = py - rec.cy, dz = pz - rec.cz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - rec.radius;
        const far = d > HAZARD_VIS_DIST;
        if (far !== rec.far) {
          rec.far = far;
          h.mesh.visible = !far;
          if (typeof h.setVisual === 'function') {
            try { h.setVisual(!far); } catch (e) { /* optional hook */ }
          }
          /* Re-entering: run one more update so the frame it becomes visible is
             already in the right pose, not one frame stale. */
          if (!far) {
            try { h.update(t, dt, player); } catch (e) { this._hazardError(rec, e); continue; }
          }
        }
      }

      const cs = rec.colliders;
      for (let j = 0; j < cs.length; j++) {
        const c = cs[j];
        if (typeof c.update === 'function') c.update();
        else if (this.broadphase && typeof this.broadphase.refresh === 'function') this.broadphase.refresh(c);
      }
      const vs = rec.volumes;
      for (let j = 0; j < vs.length; j++) {
        const v = vs[j];
        if (typeof v.update === 'function') v.update();
      }
      const ks = rec.kills;
      for (let j = 0; j < ks.length; j++) {
        const k = ks[j];
        if (typeof k.update === 'function') k.update();
      }
    }
  }

  _refreshHazardColliders() {
    for (let i = 0; i < this.hazards.length; i++) {
      const rec = this.hazards[i];
      for (let j = 0; j < rec.colliders.length; j++) {
        const c = rec.colliders[j];
        if (typeof c.update === 'function') c.update();
        if (this.broadphase && typeof this.broadphase.refresh === 'function') this.broadphase.refresh(c);
      }
      for (let j = 0; j < rec.volumes.length; j++) {
        if (typeof rec.volumes[j].update === 'function') rec.volumes[j].update();
      }
      for (let j = 0; j < rec.kills.length; j++) {
        if (typeof rec.kills[j].update === 'function') rec.kills[j].update();
      }
    }
  }

  _updateCritters(dt, player) {
    const cr = this.critters;
    for (let i = 0; i < cr.length; i++) {
      const c = cr[i];
      if (!c || c.enabled === false) continue;
      try { c.update(dt, player); } catch (e) { this._once('critter:' + (c.kind || i), e); continue; }
      if (Array.isArray(c.colliders)) {
        for (let j = 0; j < c.colliders.length; j++) {
          const col = c.colliders[j];
          if (typeof col.update === 'function') col.update();
          else if (this.broadphase && typeof this.broadphase.refresh === 'function') this.broadphase.refresh(col);
        }
      }
      if (Array.isArray(c.kills)) {
        for (let j = 0; j < c.kills.length; j++) {
          if (typeof c.kills[j].update === 'function') c.kills[j].update();
        }
      }
    }
  }

  /** Water rides the VISUAL clock: the surface keeps moving while a menu is up. */
  _updateWaters(dt) {
    for (let i = 0; i < this.waters.length; i++) {
      const w = this.waters[i];
      if (!w.update) continue;
      try { w.update(this._time); } catch (e) { this._once('water', e); }
    }
    /* ROUND 2 — the grass has never swayed. terrain.js owns ONE shared wind
     * clock and exports `setGrassTime`, and grep says nothing in `runtime/`
     * outside terrain.js ever wrote it: the only writer is the terrain record's
     * own `update(t)`, which no caller ever invoked. So CONTRACT §18's "wind
     * sway shader" has been running at t = 0 since the module was written —
     * a dead uniform, not a missing feature. Same visual clock as the water. */
    if (this.terrains.length && typeof TerrainMod.setGrassTime === 'function') {
      try { TerrainMod.setGrassTime(this._time); } catch (e) { this._once('grasstime', e); }
    }
  }

  /**
   * Chunk culling, every frame (contract §24).  Distance kills the far side of
   * the diorama, the frustum kills what is behind the camera, and a near band
   * stays visible off-screen so its shadow casters keep contributing.  A Box3
   * frustum test is six plane dots; at a few hundred chunks this is under
   * 0.05 ms and buys back far more than it costs.
   */
  _updateCulling(dt) {
    const chunks = this._chunks;
    if (!chunks.length) return;

    const cam = this.engine && this.engine.camera;
    let haveFrustum = false;
    if (cam) {
      cam.updateMatrixWorld();
      _projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_projScreen);
      haveFrustum = true;
    }
    const px = this._ppValid ? this._pp.x : (cam ? cam.position.x : 0);
    const py = this._ppValid ? this._pp.y : (cam ? cam.position.y : 0);
    const pz = this._ppValid ? this._pp.z : (cam ? cam.position.z : 0);
    _v1.set(px, py, pz);

    const far = this._cullFar;
    const detailFar = this._detailFar;
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      const d = ch.box.distanceToPoint(_v1);
      let vis;
      if (d > far) vis = false;
      else if (d < SHADOW_KEEP) vis = true;
      else vis = haveFrustum ? _frustum.intersectsBox(ch.box) : true;
      if (vis !== ch.visible) { ch.visible = vis; ch.group.visible = vis; }
      if (vis) {
        const dv = d < detailFar;
        if (dv !== ch.detailVisible) { ch.detailVisible = dv; ch.detail.visible = dv; }
      }
    }
  }

  /**
   * Point the fixed pool at the nearest light sites.
   *
   * Nothing is added, removed or hidden here — only moved, re-tinted and faded.
   * A slot must fade to ZERO before it re-targets, so a light never visibly
   * slides across a room: it dies on the fixture you left and lifts on the one
   * you reached, under the halo and floor pool that are always there.
   * Allocation-free; safe to call every frame.
   */
  _updateLights(dt) {
    const L = this.lights;
    const P = this._lightPool;
    if (!P.length) return;
    const nActive = Math.min(this._maxLights, P.length);

    this._lightTimer -= dt;
    if (this._lightTimer <= 0 && L.length) {
      this._lightTimer = LIGHT_SELECT_HZ;
      const px = this._pp.x, py = this._pp.y, pz = this._pp.z;
      for (let i = 0; i < L.length; i++) {
        const l = L[i];
        const dx = px - l.pos.x, dy = py - l.pos.y, dz = pz - l.pos.z;
        l.d2 = this._ppValid ? dx * dx + dy * dy + dz * dz : 0;
        l.want = false;
      }

      /* Partial selection sort — only the nActive nearest are ever ordered. */
      const idx = this._lightIdx;
      idx.length = L.length;
      for (let i = 0; i < L.length; i++) idx[i] = i;
      const n = Math.min(nActive, L.length);
      for (let a = 0; a < n; a++) {
        let best = a;
        for (let b = a + 1; b < L.length; b++) if (L[idx[b]].d2 < L[idx[best]].d2) best = b;
        const tmp = idx[a]; idx[a] = idx[best]; idx[best] = tmp;
      }
      for (let a = 0; a < n; a++) {
        const l = L[idx[a]];
        if (l.base <= 0.01) continue;                // a dark site never holds a slot
        if (!this._ppValid || l.d2 < l.range2) l.want = true;
      }

      /* Release slots whose site fell out of the set (or was removed). */
      for (let s = 0; s < P.length; s++) {
        const slot = P[s];
        const site = slot.site;
        if (!site) continue;
        if (!site.want || site.slot !== s || s >= nActive || L.indexOf(site) < 0) {
          site.slot = -1;
          slot.site = null;
        }
      }

      /* Fill free, fully-dark slots with wanted sites, nearest first. */
      for (let a = 0; a < n; a++) {
        const l = L[idx[a]];
        if (!l.want || l.slot >= 0) continue;
        for (let s = 0; s < nActive; s++) {
          const slot = P[s];
          if (slot.site || slot.fade > 0.02) continue;
          slot.site = l;
          l.slot = s;
          slot.light.position.copy(l.pos);
          slot.light.color.copy(l.color);
          slot.light.distance = l.distance;
          slot.light.decay = l.decay;
          break;
        }
      }
    }

    const t = this.clock;
    for (let s = 0; s < P.length; s++) {
      const slot = P[s];
      const site = slot.site;
      const target = (site && s < nActive) ? 1 : 0;
      if (this._lightFirst) slot.fade = target;      // no lift-in on the first frame
      else {
        const rate = target > slot.fade ? LIGHT_FADE_IN : LIGHT_FADE_OUT;
        slot.fade += (target - slot.fade) * Math.min(1, dt * rate);
      }
      if (!site || slot.fade < 0.004) {
        if (slot.fade < 0.004) slot.fade = 0;
        if (slot.light.intensity !== 0) slot.light.intensity = 0;
        continue;
      }
      /* A site can move: a rising lava pool, a swinging lantern. */
      slot.light.position.copy(site.pos);
      let k = 1;
      if (site.flicker) {
        const f = 0.62 + 0.22 * Math.sin(t * 11.3 + site.seed) +
                         0.16 * Math.sin(t * 27.7 + site.seed * 3.1);
        k = 1 - site.flickerAmt + site.flickerAmt * clamp(f, 0, 1.3);
      }
      slot.light.intensity = site.base * slot.fade * k;
    }
    this._lightFirst = false;
  }

  /* ── gameplay bridges hazards and critters call ──────────────────────── */

  /**
   * Fire a named trigger (contract §22: a `secret` crest spawns on its trigger
   * id).  Idempotent by id — pounding a gnasher's post a fourth time must not
   * spawn a second crest.
   */
  trigger(id, payload) {
    if (!id || this._triggered.has(id)) return false;
    this._triggered.add(id);
    if (this.collectibles && typeof this.collectibles.trigger === 'function') {
      try { this.collectibles.trigger(id); } catch (e) { /* never break the sim */ }
    }
    this.events.emit('trigger', id, payload);
    return true;
  }

  /** Coins from a squished bumbler or a smashed crate. */
  dropCoins(pos, n) {
    const count = fin(n) ? Math.max(0, Math.round(n)) : 0;
    if (!count) return false;
    const col = this.collectibles;
    if (col && typeof col.spawnCoins === 'function') {
      try { col.spawnCoins(pos, count); return true; } catch (e) { /* fall through */ }
    }
    this.events.emit('dropCoins', pos, count);
    return false;
  }

  /* ─────────────────────────────────────────────── reset / spawn ──────── */

  /**
   * FULL reset (restart the course): clock 0, every hazard back to phase 0,
   * every critter re-seeded, every coin and sigil back on its post, every
   * checkpoint dark.  Crests taken this session stay ghosts — the Save has them.
   */
  reset() {
    this.clock = 0;
    this._time = 0;
    this._triggered.clear();
    this.setCheckpointIndex(-1, true);
    this._resetHazards(0);
    this._resetCritters();
    this._resetPowers();
    if (this.collectibles && typeof this.collectibles.reset === 'function') {
      try { this.collectibles.reset(); } catch (e) { this._once('collectibles.reset', e); }
    }
    this._lightTimer = 0;
  }

  /**
   * RESPAWN reset.  Rewinds the course clock to the checkpoint's authored
   * `clockOffset` so the gauntlet ahead presents an identical phase on every
   * attempt — muscle memory, not luck (contract §21 DETERMINISM LAW).
   *
   * Collectibles deliberately KEEP their collected state: dying should cost the
   * player time, never the twenty coins they already earned.
   */
  resetFrom(cpIndex) {
    let idx = fin(cpIndex) ? Math.floor(cpIndex) : -1;
    idx = clamp(idx, -1, this.checkpoints.length - 1);
    const cp = idx >= 0 ? this.checkpoints[idx] : null;
    this.clock = (cp && fin(cp.clockOffset)) ? cp.clockOffset : 0;
    this.setCheckpointIndex(idx, true);
    this._resetHazards(this.clock);
    this._resetCritters();
    this._resetPowers();
    /* NO collectibles.reset() here — see the doc comment. */
  }

  /** Re-arm crumble/vanish tiles, un-sink sinkers, rewind chasers. */
  _resetHazards(t) {
    /* Forget the last stand: a player still grounded on a re-armed tile after a
       reset must re-trigger it next frame, not ride it for free. */
    this._standOn = null;
    for (let i = 0; i < this.hazards.length; i++) {
      const rec = this.hazards[i];
      const h = rec.h;
      rec.broken = false;
      if (typeof h.rearm === 'function') { try { h.rearm(t); } catch (e) { /* optional */ } }
      if (typeof h.reset === 'function') {
        try { h.reset(t); } catch (e) { this._hazardError(rec, e); continue; }
      }
      /* `reset(t)` must place it exactly where `update(t)` would; calling update
         makes that true even for a hazard that only moves inside update(). */
      try { h.update(t, 0, this._playerRef); } catch (e) { this._hazardError(rec, e); continue; }
      if (h.mesh && rec.far) { h.mesh.visible = true; rec.far = false; }
      for (let j = 0; j < rec.colliders.length; j++) {
        const c = rec.colliders[j];
        if (typeof c.update === 'function') c.update();
        if (this.broadphase && typeof this.broadphase.refresh === 'function') this.broadphase.refresh(c);
      }
      for (let j = 0; j < rec.volumes.length; j++) {
        if (typeof rec.volumes[j].update === 'function') rec.volumes[j].update();
      }
      for (let j = 0; j < rec.kills.length; j++) {
        if (typeof rec.kills[j].update === 'function') rec.kills[j].update();
      }
    }
  }

  _resetCritters() {
    for (let i = 0; i < this.critters.length; i++) {
      const c = this.critters[i];
      if (!c || typeof c.reset !== 'function') continue;
      try { c.reset(); } catch (e) { this._once('critter.reset', e); }
      if (Array.isArray(c.colliders)) {
        for (let j = 0; j < c.colliders.length; j++) {
          const col = c.colliders[j];
          if (typeof col.update === 'function') col.update();
          if (this.broadphase && typeof this.broadphase.refresh === 'function') this.broadphase.refresh(col);
        }
      }
    }
  }

  /**
   * Where the player appears for a given checkpoint (or the course spawn at -1).
   * @returns {{pos: THREE.Vector3, yaw: number}}
   */
  spawnFor(cpIndex) {
    const idx = fin(cpIndex) ? Math.floor(cpIndex) : -1;
    if (idx >= 0 && idx < this.checkpoints.length) {
      const cp = this.checkpoints[idx];
      return { pos: cp.pos.clone(), yaw: cp.yaw };
    }
    const sp = this.def.spawn || {};
    return { pos: v3(sp.p, 0, 0, 0), yaw: fin(sp.yaw) ? sp.yaw : 0 };
  }

  /* ─────────────────────────────────────────────────────────── warm-up ── */

  /**
   * Force every chunk (and every culled hazard mesh) visible and render two
   * frames, so ALL shader programs compile and every merged geometry uploads
   * NOW, while the loading veil covers the screen — then restore culling.
   *
   * Why this exists: first visibility is expensive.  Respawning into a chunk
   * that has never been visible compiles its programs and uploads its geometry
   * inside ONE frame, and death is exactly when a chunk tends to become visible
   * for the first time (the checkpoint may sit in a corner the player sprinted
   * past).  Ascendant measured that hitch at over 1.5 s inside a respawn; the
   * contract's 700 ms median death loop cannot survive it.
   *
   * Three details are load-bearing and were each learned the hard way:
   *  1. run every checkpoint's `resetFrom` FIRST — re-arming state hazards
   *     creates meshes and material VARIANTS on their first reset;
   *  2. warm through a synthetic wide camera above the course, not the player
   *     camera: `render()` respects frustum culling, so warming through the
   *     player's view misses everything a death cam then reveals;
   *  3. render into a LINEAR HalfFloat target, not the canvas — the program
   *     cache key includes the output colour space, and real frames go through
   *     the composer (srgb-linear), so a canvas warm-up compiles only useless
   *     `srgb` variants.
   */
  warmup(renderer, camera) {
    if (!renderer || this._disposed) return;
    /* A warm-up must leave gameplay state EXACTLY as it found it: Game has
       already chosen the checkpoint and spawned the player by the time it calls
       this, so cycling the hazards through every phase must not also rewind the
       run.  Snapshot, cycle, restore. */
    const savedCp = this.cpIndex;
    const savedClock = this.clock;
    try {
      for (let i = 0; i < this.checkpoints.length; i++) this.resetFrom(i);
      this.resetFrom(savedCp);
      this.clock = savedClock;
    } catch (e) { /* a warm-up must never break a load */ }

    const saved = [];
    for (let i = 0; i < this._chunks.length; i++) {
      const ch = this._chunks[i];
      saved.push([ch, ch.visible, ch.detailVisible]);
      ch.visible = true; ch.group.visible = true;
      ch.detailVisible = true; ch.detail.visible = true;
    }
    const objFlags = [];
    const sceneRoot = this.group.parent || this.group;
    sceneRoot.traverse((o) => {
      objFlags.push([o, o.visible, o.frustumCulled]);
      o.visible = true;
      o.frustumCulled = false;
    });
    const hazVis = [];
    for (let i = 0; i < this.hazards.length; i++) {
      const m = this.hazards[i].h.mesh;
      if (m) { hazVis.push([m, m.visible]); m.visible = true; }
    }

    let warmRT = null;
    try {
      const scene = this.group.parent || this.group;
      const b = this.bounds;
      const warmCam = new THREE.PerspectiveCamera(110, 1.78, 0.1, 4000);
      /* A fresh camera sees only layer 0 — meshes on selective layers (glow,
         bloom overlays) would upload geometry but never DRAW, so their programs
         would still compile mid-death.  See everything. */
      warmCam.layers.enableAll();
      if (b && isFinite(b.min.x)) {
        const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
        const spanX = b.max.x - b.min.x, spanZ = b.max.z - b.min.z;
        const hh = Math.max(spanX, spanZ) * 0.42 + (b.max.y - b.min.y) + 20;
        warmCam.position.set(cx, b.max.y + hh, cz);
        warmCam.lookAt(cx, b.min.y, cz);
      } else if (camera) {
        warmCam.copy(camera);
      }
      warmCam.updateMatrixWorld(true);

      warmRT = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType });
      const prevRT = renderer.getRenderTarget();
      renderer.setRenderTarget(warmRT);
      renderer.render(scene, warmCam);       // compiles + uploads + shadow variants
      renderer.render(scene, warmCam);
      if (camera) renderer.render(scene, camera);
      renderer.setRenderTarget(prevRT);
    } catch (e) { /* a warm-up must never break a load */ }
    if (warmRT) { try { warmRT.dispose(); } catch (e) { /* already gone */ } }

    for (let i = 0; i < objFlags.length; i++) {
      objFlags[i][0].visible = objFlags[i][1];
      objFlags[i][0].frustumCulled = objFlags[i][2];
    }
    for (let i = 0; i < saved.length; i++) {
      const ch = saved[i][0];
      ch.visible = saved[i][1]; ch.group.visible = saved[i][1];
      ch.detailVisible = saved[i][2]; ch.detail.visible = saved[i][2];
    }
    for (let i = 0; i < hazVis.length; i++) hazVis[i][0].visible = hazVis[i][1];
  }

  /* ───────────────────────────────────────────────────────── plumbing ── */

  /** Track a resource this course created, and therefore must dispose. */
  _own(x) {
    if (!x) return x;
    if (x.isBufferGeometry) this._ownedGeo.add(x);
    else if (x.isMaterial) this._ownedMat.add(x);
    else if (x.isTexture) this._ownedTex.add(x);
    return x;
  }

  _fxMaterial(vert, frag, uniforms, side) {
    const m = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: side || THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    this._own(m);
    return m;
  }

  /**
   * A shared PBR material by key.  Mats first (contract §14 — cached and shared,
   * box-projected), then builders' own bank, then a local safety net.  Only the
   * safety net is `_own`ed: disposing a Mats material would blank every other
   * user of it, including the next course.
   */
  _mat(key) {
    let m = this._matCache.get(key);
    if (m) return m;
    try {
      if (this.mats && typeof this.mats.get === 'function') m = this.mats.get(key, this.themeId);
    } catch (e) { m = null; }
    if ((!m || !m.isMaterial) && typeof Builders.getMaterial === 'function') {
      try { m = Builders.getMaterial(key, this.theme, this.mats); } catch (e) { m = null; }
    }
    if (!m || !m.isMaterial) {
      m = this._makeFallbackMat(key);
      this._own(m);
    }
    this._matCache.set(key, m);
    return m;
  }

  /** Reached only when world/materials.js and world/builders.js both decline a key. */
  _makeFallbackMat(key) {
    const pal = this.palette;
    const T = {
      stone: { color: pal.safe.getHex(), rough: 0.86, metal: 0.04 },
      metal: { color: 0x8f9aa8, rough: 0.36, metal: 0.92 },
      panel: { color: 0x59677a, rough: 0.55, metal: 0.35 },
      grate: { color: 0x4a5563, rough: 0.62, metal: 0.7 },
      ice: { color: 0xbfe9ff, rough: 0.12, metal: 0.05 },
      glass: { color: 0xcfe8ff, rough: 0.06, metal: 0.0 },
      emissive: { color: pal.accent.getHex(), rough: 0.4, metal: 0.1, emissive: pal.accent.getHex() },
      lava: { color: 0x2a0a04, rough: 0.75, metal: 0.0, emissive: pal.kill.getHex() },
      obsidian: { color: 0x16181f, rough: 0.34, metal: 0.28 },
      crystal: { color: 0x9fd8ff, rough: 0.14, metal: 0.1 },
      wood: { color: 0x6b4a2f, rough: 0.9, metal: 0.0 },
      sand: { color: 0xc9b184, rough: 0.95, metal: 0.0 },
      neon: { color: pal.accent.getHex(), rough: 0.3, metal: 0.2, emissive: pal.accent.getHex() },
      checker: { color: 0x9aa6b4, rough: 0.7, metal: 0.1 },
      hazard: { color: pal.kill.getHex(), rough: 0.5, metal: 0.2, emissive: pal.kill.getHex() },
      rubber: { color: 0x2b2f36, rough: 0.98, metal: 0.0 },
      conveyor: { color: 0x3a4048, rough: 0.8, metal: 0.3 },
      cloud: { color: 0xe7f1ff, rough: 1.0, metal: 0.0 },
      grass: { color: 0x5f8f43, rough: 0.95, metal: 0.0 },
      dirt: { color: 0x6b5334, rough: 0.98, metal: 0.0 },
      plaster: { color: 0xd8cfbd, rough: 0.9, metal: 0.0 },
      brick: { color: 0x8d5a48, rough: 0.88, metal: 0.0 },
      bark: { color: 0x5a4430, rough: 0.95, metal: 0.0 },
      leaves: { color: 0x4e8a3a, rough: 0.85, metal: 0.0 },
      snow: { color: 0xeaf4ff, rough: 0.78, metal: 0.0 },
      water: { color: pal.water.getHex(), rough: 0.1, metal: 0.0 },
      gold: { color: 0xd8a63a, rough: 0.28, metal: 0.95 },
      cloth: { color: 0x9c4a5e, rough: 0.92, metal: 0.0 },
      painting: { color: 0x6f7f9a, rough: 0.7, metal: 0.05, emissive: pal.accent.getHex() },
      marble: { color: 0xe3e0d8, rough: 0.3, metal: 0.02 },
      moss: { color: 0x4c6b3b, rough: 0.98, metal: 0.0 },
      copper: { color: 0xb87246, rough: 0.42, metal: 0.9 },
      rope: { color: 0xa98b5c, rough: 0.98, metal: 0.0 },
    };
    const t = T[key] || T.stone;
    const m = new THREE.MeshStandardMaterial({
      color: t.color, roughness: t.rough, metalness: t.metal,
      emissive: t.emissive !== undefined ? t.emissive : 0x000000,
      emissiveIntensity: t.emissive !== undefined ? 0.55 : 0,
      flatShading: false,
    });
    m.name = 'course-fallback:' + key;
    return m;
  }

  /* ─────────────────────────────────────────────────────────── dispose ── */

  /**
   * Free everything this course created — and NOTHING it merely borrowed.
   * Mats' shared cache, builders' GeoCache and the critter/collectible module
   * caches all outlive a course and are deliberately untouched here: they are
   * released once at game teardown, not once per course, which is what makes
   * returning to the Keep cheap.
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    if (this._settingsCb && Settings && typeof Settings.off === 'function') {
      try { Settings.off(this._settingsCb); } catch (e) { /* optional */ }
    }
    this._settingsCb = null;

    for (let i = 0; i < this.hazards.length; i++) {
      const h = this.hazards[i].h;
      if (h && typeof h.dispose === 'function') {
        try { h.dispose(); } catch (e) { console.error('[Course ' + this.id + '] hazard dispose failed', e); }
      }
    }
    for (let i = 0; i < this.critters.length; i++) {
      const c = this.critters[i];
      if (c && typeof c.dispose === 'function') {
        try { c.dispose(); } catch (e) { console.error('[Course ' + this.id + '] critter dispose failed', e); }
      }
    }
    if (this.collectibles && typeof this.collectibles.dispose === 'function') {
      try { this.collectibles.dispose(); } catch (e) { console.error('[Course ' + this.id + '] collectibles dispose failed', e); }
    }
    if (this._propHandle && typeof this._propHandle.dispose === 'function') {
      try { this._propHandle.dispose(); } catch (e) { /* best effort */ }
    }
    this._propHandle = null;

    if (this.broadphase) {
      if (typeof this.broadphase.remove === 'function') {
        for (let i = 0; i < this._allColliders.length; i++) {
          try { this.broadphase.remove(this._allColliders[i]); } catch (e) { /* best effort */ }
        }
      }
      if (typeof this.broadphase.removeHeightfield === 'function') {
        for (let i = 0; i < this._heightfields.length; i++) {
          try { this.broadphase.removeHeightfield(this._heightfields[i]); } catch (e) { /* best effort */ }
        }
      }
      if (typeof this.broadphase.clear === 'function') {
        try { this.broadphase.clear(); } catch (e) { /* best effort */ }
      }
    }
    this._heightfields.length = 0;

    for (let i = 0; i < this._lightPool.length; i++) {
      const l = this._lightPool[i].light;
      if (l.parent) l.parent.remove(l);
      if (typeof l.dispose === 'function') l.dispose();
    }
    this._lightPool.length = 0;
    this._glowField = null;

    /* Terrain and water own geometry the course built through a sibling module;
       those siblings hand back plain meshes, so the geometry is ours to free —
       but a SHARED geometry (GeoCache) is never touched. */
    const disposeTree = (root) => {
      if (!root) return;
      root.traverse((o) => {
        if (o.isMesh || o.isPoints || o.isLine) {
          const g = o.geometry;
          if (g && !(g.userData && g.userData.__shared) && !this._ownedGeo.has(g)) {
            try { g.dispose(); } catch (e) { /* already gone */ }
          }
        }
      });
    };
    for (let i = 0; i < this.terrains.length; i++) {
      disposeTree(this.terrains[i].mesh);
      disposeTree(this.terrains[i].grass);
    }
    for (let i = 0; i < this.waters.length; i++) disposeTree(this.waters[i].mesh);

    if (this.group.parent) this.group.parent.remove(this.group);

    this._ownedGeo.forEach((g) => { try { g.dispose(); } catch (e) { /* already gone */ } });
    this._ownedMat.forEach((m) => { try { m.dispose(); } catch (e) { /* already gone */ } });
    this._ownedTex.forEach((t) => { try { t.dispose(); } catch (e) { /* already gone */ } });
    this._ownedGeo.clear();
    this._ownedMat.clear();
    this._ownedTex.clear();

    this.events.clear();
    this._matCache.clear();
    this._chunkMap.clear();
    this._chunks.length = 0;
    this._allColliders.length = 0;
    this._staticColliders.length = 0;
    this._mergeSources.clear();
    this._triggered.clear();
    this.killVolumes.length = 0;
    this.volumes.length = 0;
    this.hazards.length = 0;
    this.critters.length = 0;
    this.checkpoints.length = 0;
    this.gates.length = 0;
    this.powers.length = 0;
    this.waters.length = 0;
    this.terrains.length = 0;
    this.lights.length = 0;
    this._glowSites.length = 0;
    this.texts.length = 0;
    this._decoProps.length = 0;
    this._cpAttr = null;
    this._cpMeshes = null;
    this._cpBase = null;
    this._cpRing = null;
    this._cpWave = null;
    this._cpGlyph = null;
    this._cpColumn = null;
    this.collectibles = null;
    this.terrain = null;
    this._playerRef = null;
    this._standOn = null;
    this._built = false;
  }
}

export default Course;
