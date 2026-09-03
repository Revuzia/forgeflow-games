/**
 * CRESTBOUND — runtime/entities/collectibles.js
 * ---------------------------------------------------------------------------
 * CONTRACT §22. Every pick-up in a course: COINS (100 → 1 Crest), SIGILS
 * (8 → 1 Crest) and the seven CRESTS themselves, plus the race pads that gate
 * the `race` crest.
 *
 * DESIGN
 *  - Coins are ONE InstancedMesh: a bevelled gold disc with an embossed rune on
 *    both faces and a raised rim ring, merged into a single geometry. Per-
 *    instance phase drives bob + spin so a line of coins reads as a wave, never
 *    a lock-step row. A coin inside the 1.3 m magnet radius glides toward the
 *    hero and is taken on capsule overlap; the pick-up pitch climbs with the
 *    combo so a run of coins is a phrase, not a repeat (Ascendant Impacts.coin).
 *    Collected coins shrink to scale 0 (still one draw call) and stay hidden
 *    until reset().
 *  - Sigils are 8 larger crimson-gold rune coins in their own InstancedMesh, each
 *    carrying a numbered badge (an instanced enamel plate + one atlas-textured
 *    numeral quad, so eight numbers cost two draw calls). Collect all eight →
 *    'sigilsDone' + the `sigils` crest spawns.
 *  - Crests are an octagonal shield: gold plate + rim + cross emblem (one merged
 *    gold mesh), an enamel inlay in the realm colour, a radial light ring on the
 *    ground beneath and a soft additive halo sprite. Slow spin, 0.3 m float.
 *    Crest TYPES (def.type): open (placed, present from the start), sigils /
 *    coins / secret / boss / race (hidden until spawnCrest() with a fountain +
 *    stinger), power (placed, only takes when player.power === def.power).
 *    A crest the Save already holds renders as a translucent GHOST: it can be
 *    re-collected for time, but the tally does not increase.
 *  - Race: a start pad and a finish pad. Stepping on start → 'raceStart' and the
 *    clock runs; finish inside limitMs → the crest spawns; over → 'raceFail'.
 *
 * EVENTS (this.events, core/util Emitter)
 *   'coin'(n, index)  'sigil'(n, index)  'sigilsDone'  'coins100'
 *   'crest'(def, info{ghost, ms})  'crestSpawn'(def)  'crestLocked'(def)
 *   'raceStart'(def)  'raceFinish'(def, ms)  'raceFail'(def, ms)
 *
 * PERF: update(dt, player) allocates nothing — every vector, matrix and capsule
 * is a module-scope scratch. Coins beyond ANIM_RANGE keep a static pose, coins
 * beyond HIDE_RANGE are hidden; the whole set is still one draw call.
 *
 * DETERMINISM: bob/spin phase is a hash of the coin index; the clock is the
 * course clock accumulated from dt and zeroed by reset().
 *
 * The Save is READ here (ghost state); writes belong to Game.onCrest — the same
 * split Ascendant used for its coin/finish events.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { easeOutCubic, easeOutBack, Emitter, TAU } from '../core/util.js';
import { TUNE } from '../core/tuning.js';
import {
  bevelBoxGeometry, prismGeometry, ringProfileGeometry, discGeometry, tubeGeometry,
  getMaterial, getGlow, getEmissive,
} from '../world/builders.js';
import { Collider } from '../world/collider.js';

/* ===========================================================================
 * 0. Constants
 * ======================================================================== */

/** Coin disc radius / thickness (metres). */
const COIN_R = 0.26, COIN_H = 0.07;
/** Sigil disc radius / thickness. */
const SIGIL_R = 0.40, SIGIL_H = 0.10;
/** Crest half-width (0.9 m across). */
const CREST_R = 0.45;
/** Coins glide toward the hero inside this radius. CONTRACT §22. */
const MAGNET_R = 1.3;
const MAGNET_R2 = MAGNET_R * MAGNET_R;
/** Magnet pull acceleration (m/s²) and top speed (m/s). */
const MAGNET_ACCEL = 46, MAGNET_MAX = 12;
/** Collect pop duration (s). */
const POP_T = 0.26;
/** Beyond this distance coins keep a static pose (no per-frame matrix work). */
const ANIM_RANGE = 46;
const ANIM_RANGE2 = ANIM_RANGE * ANIM_RANGE;
/** Beyond this distance coins are hidden entirely. */
const HIDE_RANGE = 150;
const HIDE_RANGE2 = HIDE_RANGE * HIDE_RANGE;
/** Combo window for the rising coin pitch (s). */
const COMBO_WINDOW = 0.7;
const COMBO_MAX = 9;
/** Crest float: base lift + amplitude (0.3 m total travel). */
const CREST_LIFT = 0.15, CREST_BOB = 0.15;
const CREST_SPIN = 0.85;          // rad/s
const CREST_SPAWN_T = 0.7;        // s, scale-in
const CREST_POP_T = 0.55;         // s, take animation
const RACE_PAD_R = 0.95;
const PAD_STAND_R = 0.85;

const SIGILS_TOTAL = 8;

/** Number of atlas cells for the sigil badge numerals (4 × 2). */
const BADGE_COLS = 4, BADGE_ROWS = 2;

/* ===========================================================================
 * 1. Scratch (module scope — update paths never allocate)
 * ======================================================================== */

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _s0 = new THREE.Vector3();
const _m0 = new THREE.Matrix4();
const _capA = new THREE.Vector3();
const _capB = new THREE.Vector3();
const _cap = { a: _capA, b: _capB, r: TUNE.radius };
const _rayOut = { t: 0, normal: new THREE.Vector3(), collider: null };
const _sfxOpts = { rate: 1, gain: 1, pos: null, listener: null };
const _burstOpts = { color: 0, strength: 1, count: 0 };
const _crestInfo = { ghost: false, ms: 0 };
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

/* ===========================================================================
 * 2. Small helpers
 * ======================================================================== */

function fin(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

/** Read [x,y,z] | {x,y,z} into a Vector3. */
function readV3(src, out, dx, dy, dz) {
  out.set(dx || 0, dy || 0, dz || 0);
  if (!src) return out;
  if (Array.isArray(src)) {
    out.set(fin(src[0], out.x), fin(src[1], out.y), fin(src[2], out.z));
  } else if (typeof src === 'object') {
    out.set(fin(src.x, out.x), fin(src.y, out.y), fin(src.z, out.z));
  }
  return out;
}

function themeId(theme) {
  if (!theme) return undefined;
  return typeof theme === 'string' ? theme : theme.id;
}

function paletteOf(theme) {
  return (theme && typeof theme === 'object' && theme.palette) ? theme.palette : null;
}

/** Fill the shared capsule scratch from whatever the player exposes. */
function capsuleOf(player) {
  const c = player.capsule;
  if (c && c.a && c.b) {
    _capA.copy(c.a); _capB.copy(c.b);
    _cap.r = fin(c.r, TUNE.radius);
    return _cap;
  }
  const p = player.pos || player.position;
  const r = fin(player.radius, TUNE.radius);
  const h = fin(player.height, TUNE.height);
  _capA.set(p.x, p.y + r, p.z);
  _capB.set(p.x, p.y + Math.max(h - r, r + 0.01), p.z);
  _cap.r = r;
  return _cap;
}

/** Squared distance from point (px,py,pz) to segment a→b. Allocation-free. */
function segPointDistSq(a, b, px, py, pz) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = px - a.x, apy = py - a.y, apz = pz - a.z;
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 1e-12 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return dx * dx + dy * dy + dz * dz;
}

/** Capsule-centre height (metres above the feet) — the magnet's target point. */
function capsuleMidY(player) {
  const c = player.capsule;
  if (c && c.a && c.b) return (c.a.y + c.b.y) * 0.5 - player.pos.y;
  return fin(player.height, TUNE.height) * 0.5;
}

/* ===========================================================================
 * 3. Materials
 * ======================================================================== */

const _matCache = new Map();

/**
 * Resolve the shared 'gold' material from Mats; if the material bank does not
 * answer to 'gold' (returns its stone fallback), build a proper PBR gold here so
 * the coins are never grey.
 */
function goldMaterial(theme, mats) {
  const tid = (theme && theme.id) || 'default';
  const key = 'gold:' + tid;
  let g = _matCache.get(key);
  if (g) return g;
  /* ROUND 2 VISUAL FIX — "coin unmistakable" (CONTRACT §15 readability law) was
   * not holding: `_shots/verdant-1/cp2.png` shows the coin line against a dark
   * meadow as a row of dull brown discs. A pure metal reads only what it
   * reflects, and a coin two thirds in shadow reflects almost nothing. Every
   * other readability-critical surface in this game is self-lit (kill, ring,
   * crest pedestal, checkpoint), so the coin gets the same treatment: the
   * theme's own `palette.coin` hue at a low intensity — enough to hold the
   * silhouette in shade, well under the bloom threshold so it does not become a
   * blob. Cached PER THEME because the hue is the theme's.
   *
   * This is a CLONE of the material bank's gold, so the hammered facets, the
   * anisotropic clearcoat and the box projection all survive; only the emission
   * is new, and nothing else that uses 'gold' is touched. */
  let base = null;
  try { base = getMaterial('gold', theme, mats); } catch (e) { base = null; }
  const coinHue = (theme && theme.palette && theme.palette.coin) || 0xffe27a;
  if (base && base.isMaterial && /gold/i.test(base.name || '')) {
    g = base.clone();
  } else {
    g = new THREE.MeshPhysicalMaterial({
      color: 0xf3c24f, metalness: 1.0, roughness: 0.24,
      clearcoat: 0.35, clearcoatRoughness: 0.25,
      envMapIntensity: 1.25,
    });
  }
  /* Emission has to lift the coin out of shade WITHOUT eating the hammered
   * facets and the anisotropic clearcoat that make it read as metal. The first
   * pass put the full pale `palette.coin` hue in at 0.55 and every coin came
   * back a featureless cream blob (`_shots/_r2b_verdant.png`). A deep amber at
   * a third of that intensity holds the silhouette in shadow and leaves the
   * specular in charge everywhere else. */
  g.emissive = new THREE.Color(coinHue).multiplyScalar(0.42);
  g.emissiveIntensity = 0.26;
  /* ROUND 4 (critic, `_shots/verdant-1/spawn.png`: "Coins are flat matte
   * 12-gon discs ... with a visible faceted silhouette and no specular sweep").
   * The segment count is NOT the fix: `coinGeometry` documents why a coin is a
   * 10-segment lathe (121 instances x every segment) and the tri budget is a
   * hard gate this round, so raising it would be paying for polish with frame
   * time. What was actually missing is the SWEEP. A coin spins; ten flat facets
   * under a tight specular lobe flash one after another as it turns, which is
   * what makes minted metal read as metal and turns the faceting from a defect
   * into the effect. The clone arrived with the material bank's hammered-plate
   * roughness, which is right for a plate and far too broad for a coin — it
   * smeared the ten highlights into one dull average, i.e. "flat matte". */
  g.roughness = Math.min(g.roughness === undefined ? 0.18 : g.roughness, 0.18);
  g.metalness = 1.0;
  g.envMapIntensity = Math.max(g.envMapIntensity || 0, 1.55);
  if ('clearcoat' in g) { g.clearcoat = 0.55; g.clearcoatRoughness = 0.14; }
  g.name = 'cb.gold.coin.' + tid;
  _matCache.set(key, g);
  return g;
}

/** Crimson-gold for the sigils: gold body with a hot ember core. */
function sigilMaterial() {
  const key = 'sigil';
  let m = _matCache.get(key);
  if (m) return m;
  m = new THREE.MeshPhysicalMaterial({
    color: 0xe0a43a, metalness: 1.0, roughness: 0.28,
    clearcoat: 0.55, clearcoatRoughness: 0.2,
    emissive: 0xb0142e, emissiveIntensity: 0.55,
    envMapIntensity: 1.2,
  });
  m.name = 'cb.sigil';
  _matCache.set(key, m);
  return m;
}

/** Realm-coloured enamel inlay for a crest. */
function enamelMaterial(color) {
  const key = 'enamel:' + (color >>> 0).toString(16);
  let m = _matCache.get(key);
  if (m) return m;
  m = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.08, roughness: 0.16,
    clearcoat: 1.0, clearcoatRoughness: 0.08,
    emissive: color, emissiveIntensity: 0.28,
    envMapIntensity: 1.1,
  });
  m.name = 'cb.enamel.' + key;
  _matCache.set(key, m);
  return m;
}

/** Dark enamel for the sigil badge plate. */
function badgePlateMaterial() {
  const key = 'badgeplate';
  let m = _matCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ color: 0x2a1020, roughness: 0.35, metalness: 0.2, emissive: 0x3a0a18, emissiveIntensity: 0.4 });
  m.name = 'cb.badgeplate';
  _matCache.set(key, m);
  return m;
}

/** Translucent ghost for already-collected crests. */
function ghostMaterial(color) {
  const key = 'ghost:' + (color >>> 0).toString(16);
  let m = _matCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.9,
    transparent: true, opacity: 0.22, depthWrite: false,
    roughness: 0.6, metalness: 0.0,
  });
  m.name = 'cb.ghost.' + key;
  _matCache.set(key, m);
  return m;
}

/** Radial gradient canvas → additive sprite material (crest halo). */
function haloMaterial(color) {
  const key = 'halo:' + (color >>> 0).toString(16);
  let m = _matCache.get(key);
  if (m) return m;
  const size = 128;
  const cnv = document.createElement('canvas');
  cnv.width = size; cnv.height = size;
  const ctx = cnv.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.14)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.SpriteMaterial({
    map: tex, color, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  m.name = 'cb.halo.' + key;
  _matCache.set(key, m);
  return m;
}

/**
 * The sigil numeral atlas: 4 × 2 cells, numerals 1..8 in gold on transparent.
 * One texture, one instanced quad, an `aCell` attribute per instance.
 */
function badgeAtlasMaterial() {
  const key = 'badgeatlas';
  let m = _matCache.get(key);
  if (m) return m;
  const cw = 128, ch = 128;
  const cnv = document.createElement('canvas');
  cnv.width = cw * BADGE_COLS; cnv.height = ch * BADGE_ROWS;
  const ctx = cnv.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, cnv.width, cnv.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < BADGE_COLS * BADGE_ROWS; i++) {
      const cx = (i % BADGE_COLS) * cw + cw / 2;
      const cy = Math.floor(i / BADGE_COLS) * ch + ch / 2;
      ctx.font = 'bold 92px Rajdhani, "Segoe UI", system-ui, sans-serif';
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(40,8,18,0.9)';
      ctx.strokeText(String(i + 1), cx, cy + 4);
      ctx.fillStyle = '#ffd97a';
      ctx.fillText(String(i + 1), cx, cy + 4);
    }
  }
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  m = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, alphaTest: 0.08, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  // per-instance atlas cell: vMapUv is remapped into the instance's cell
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCell;')
      .replace('#include <uv_vertex>',
        '#include <uv_vertex>\n'
        + 'vMapUv = vMapUv * vec2(' + (1 / BADGE_COLS).toFixed(4) + ', ' + (1 / BADGE_ROWS).toFixed(4) + ')'
        + ' + vec2(mod(aCell, ' + BADGE_COLS.toFixed(1) + ') * ' + (1 / BADGE_COLS).toFixed(4)
        + ', (' + (BADGE_ROWS - 1).toFixed(1) + ' - floor(aCell / ' + BADGE_COLS.toFixed(1) + ')) * ' + (1 / BADGE_ROWS).toFixed(4) + ');');
  };
  m.customProgramCacheKey = () => 'crestbound-badge-atlas';
  m.name = 'cb.badgeatlas';
  _matCache.set(key, m);
  return m;
}

/* ===========================================================================
 * 4. Geometry
 * ======================================================================== */

const _geoCache = new Map();

function cachedGeo(key, factory) {
  let g = _geoCache.get(key);
  if (g) return g;
  g = factory();
  g.userData.__shared = true;
  _geoCache.set(key, g);
  return g;
}

/**
 * Bevelled disc (a minted coin blank) via a lathe profile, revolved about Y,
 * then stood upright so its faces look along ±Z. Non-indexed + flat normals:
 * the rim reads as machined facets, the faces stay flat.
 */
function coinBlank(r, h, bevel, seg) {
  const b = Math.min(bevel, h * 0.45, r * 0.3);
  const pts = [
    new THREE.Vector2(0, -h / 2), new THREE.Vector2(r - b, -h / 2), new THREE.Vector2(r, -h / 2 + b),
    new THREE.Vector2(r, h / 2 - b), new THREE.Vector2(r - b, h / 2), new THREE.Vector2(0, h / 2),
  ];
  const lathe = new THREE.LatheGeometry(pts, seg);
  const g = lathe.toNonIndexed();
  lathe.dispose();
  g.computeVertexNormals();
  g.rotateX(Math.PI / 2);
  return g;
}

/** Strip a geometry to exactly {position, normal, uv} so merges always agree. */
function normalizeAttrs(g) {
  for (const k of Object.keys(g.attributes)) {
    if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  return g.index ? g.toNonIndexed() : g;
}

/** Bevelled bar placed with rotation about Z at (x, y, z). */
function bar(w, h, d, x, y, z, rz) {
  const g = bevelBoxGeometry(w, h, d, Math.min(w, h, d) * 0.28, 1);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/**
 * The same bar with square corners (12 triangles instead of ~100).
 *
 * Emboss bars are 2 cm proud of a 30 cm coin face and there are 121 coins in a
 * course: at the distance a coin is ever read, a 3 mm bevel on the emboss is
 * sub-pixel while the bevelled version costs ~600 of the coin's ~1440
 * triangles.  The BLANK keeps its lathe bevel — that is the silhouette the
 * doctrine is about; this is the engraving inside it.
 */
function flatBar(w, h, d, x, y, z, rz) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/**
 * A rune glyph (ᛉ-like: stem + two raised arms) embossed on a face at depth z.
 * `s` scales the glyph, `flip` mirrors for the back face.
 */
function runeParts(s, z, flip) {
  const zz = flip ? -z : z;
  const parts = [];
  parts.push(flatBar(0.05 * s, 0.30 * s, 0.022, 0, 0, zz, 0));
  parts.push(flatBar(0.045 * s, 0.17 * s, 0.022, -0.065 * s, 0.075 * s, zz, 0.62));
  parts.push(flatBar(0.045 * s, 0.17 * s, 0.022, 0.065 * s, 0.075 * s, zz, -0.62));
  return parts;
}

/** Four-point star emblem for the crest / sigil (crossed bars + a hub). */
function starParts(s, z) {
  const parts = [];
  parts.push(flatBar(0.07 * s, 0.44 * s, 0.05, 0, 0, z, 0));
  parts.push(flatBar(0.07 * s, 0.44 * s, 0.05, 0, 0, z, Math.PI / 2));
  parts.push(flatBar(0.055 * s, 0.30 * s, 0.045, 0, 0, z, Math.PI / 4));
  parts.push(flatBar(0.055 * s, 0.30 * s, 0.045, 0, 0, z, -Math.PI / 4));
  const hub = prismGeometry(0.075 * s, 0.06, 6, 1);
  hub.rotateX(Math.PI / 2);
  hub.translate(0, 0, z);
  parts.push(hub);
  return parts;
}

/** Upright ring (machined torus with a chamfered profile) facing ±Z at depth z. */
function faceRing(r, hw, hh, ch, seg, z) {
  const g = ringProfileGeometry(r, [hw, hh, ch], seg, 1);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, z);
  return g;
}

/** THE coin: blank + rim rings + embossed rune on both faces. One geometry. */
function coinGeometry() {
  return cachedGeo('coin', () => {
    /* 12 lathe segments, not 28: a coin is ~0.3 m across and there are 121 of
       them in one InstancedMesh, so every segment costs 121x. */
    const parts = [normalizeAttrs(coinBlank(COIN_R, COIN_H, 0.022, 10))];
    parts.push(faceRing(COIN_R * 0.80, 0.014, 0.012, 0.004, 10, COIN_H / 2));
    parts.push(faceRing(COIN_R * 0.80, 0.014, 0.012, 0.004, 10, -COIN_H / 2));
    for (const p of runeParts(1.0, COIN_H / 2, false)) parts.push(p);
    for (const p of runeParts(1.0, COIN_H / 2, true)) parts.push(p);
    const g = mergeGeometries(parts.map(normalizeAttrs), false);
    for (const p of parts) p.dispose();
    g.computeBoundingSphere();
    return g;
  });
}

/** The sigil: a heavier blank, double rim, star emblem on both faces. */
function sigilGeometry() {
  return cachedGeo('sigil', () => {
    const parts = [normalizeAttrs(coinBlank(SIGIL_R, SIGIL_H, 0.03, 16))];
    parts.push(faceRing(SIGIL_R * 0.84, 0.018, 0.014, 0.005, 16, SIGIL_H / 2));
    parts.push(faceRing(SIGIL_R * 0.84, 0.018, 0.014, 0.005, 16, -SIGIL_H / 2));
    parts.push(faceRing(SIGIL_R * 0.60, 0.012, 0.012, 0.004, 16, SIGIL_H / 2));
    parts.push(faceRing(SIGIL_R * 0.60, 0.012, 0.012, 0.004, 16, -SIGIL_H / 2));
    for (const p of starParts(0.72, SIGIL_H / 2 + 0.01)) parts.push(p);
    for (const p of starParts(0.72, -SIGIL_H / 2 - 0.01)) parts.push(p);
    const g = mergeGeometries(parts.map(normalizeAttrs), false);
    for (const p of parts) p.dispose();
    g.computeBoundingSphere();
    return g;
  });
}

/** Sigil badge plate: a small bevelled octagon on a short stalk. */
function badgePlateGeometry() {
  return cachedGeo('badgeplate', () => {
    const plate = prismGeometry(0.19, 0.035, 8, 1);
    plate.rotateX(Math.PI / 2);
    const rim = faceRing(0.19, 0.016, 0.024, 0.006, 8, 0);
    const g = mergeGeometries([normalizeAttrs(plate), normalizeAttrs(rim)], false);
    plate.dispose(); rim.dispose();
    g.computeBoundingSphere();
    return g;
  });
}

/** Numeral quad (both faces) with plain 0..1 UVs, sitting just proud of the plate. */
function badgeQuadGeometry() {
  return cachedGeo('badgequad', () => {
    const s = 0.15;
    const pos = new Float32Array([
      -s, -s, 0.02,  s, -s, 0.02,  s, s, 0.02,
      -s, -s, 0.02,  s, s, 0.02,  -s, s, 0.02,
      s, -s, -0.02,  -s, -s, -0.02,  -s, s, -0.02,
      s, -s, -0.02,  -s, s, -0.02,  s, s, -0.02,
    ]);
    const uv = new Float32Array([
      0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
    ]);
    const nrm = new Float32Array(36);
    for (let i = 0; i < 6; i++) { nrm[i * 3 + 2] = 1; nrm[18 + i * 3 + 2] = -1; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    return g;
  });
}

/** Crest gold body: octagon plate, octagonal rim, cross emblem both faces. */
function crestGoldGeometry() {
  return cachedGeo('crestgold', () => {
    const parts = [];
    const plate = prismGeometry(CREST_R, 0.07, 8, 1);
    plate.rotateX(Math.PI / 2);
    plate.rotateZ(Math.PI / 8);
    parts.push(plate);
    const rim = ringProfileGeometry(CREST_R * 1.01, [0.035, 0.055, 0.014], 8, 1);
    rim.rotateX(Math.PI / 2);
    rim.rotateZ(Math.PI / 8);
    parts.push(rim);
    for (const p of starParts(1.0, 0.055)) parts.push(p);
    for (const p of starParts(1.0, -0.055)) parts.push(p);
    // four rivet studs at the octagon's cardinal points
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const st = prismGeometry(0.035, 0.03, 6, 1);
      st.rotateX(Math.PI / 2);
      st.translate(Math.cos(a) * CREST_R * 0.78, Math.sin(a) * CREST_R * 0.78, 0.05);
      parts.push(st);
      const sb = prismGeometry(0.035, 0.03, 6, 1);
      sb.rotateX(Math.PI / 2);
      sb.translate(Math.cos(a) * CREST_R * 0.78, Math.sin(a) * CREST_R * 0.78, -0.05);
      parts.push(sb);
    }
    const g = mergeGeometries(parts.map(normalizeAttrs), false);
    for (const p of parts) p.dispose();
    g.computeBoundingSphere();
    return g;
  });
}

/** Crest enamel inlay: a slightly thicker inner octagon so the enamel sits proud. */
function crestEnamelGeometry() {
  return cachedGeo('crestenamel', () => {
    const g = prismGeometry(CREST_R * 0.80, 0.088, 8, 1);
    g.rotateX(Math.PI / 2);
    g.rotateZ(Math.PI / 8);
    g.computeBoundingSphere();
    return g;
  });
}

/** Ground light ring: a radial-UV disc for the glow shader. */
function poolDiscGeometry() {
  return cachedGeo('pooldisc', () => {
    const g = discGeometry(1.15, 24);
    g.computeBoundingSphere();
    return g;
  });
}

/** Race pad: octagon plate + rim + centre stud, thin enough to step onto. */
function padGeometry() {
  return cachedGeo('racepad', () => {
    const plate = prismGeometry(RACE_PAD_R, 0.08, 8, 0.5);
    plate.rotateY(Math.PI / 8);
    const g = normalizeAttrs(plate);
    g.computeBoundingSphere();
    return g;
  });
}

function padRingGeometry() {
  return cachedGeo('racepadring', () => {
    const g = ringProfileGeometry(RACE_PAD_R * 0.86, [0.05, 0.02, 0.008], 8, 1);
    g.rotateY(Math.PI / 8);
    g.translate(0, 0.05, 0);
    g.computeBoundingSphere();
    return g;
  });
}

/** Race pad finial: a short post with a gem prism on top (the finish reads from afar). */
function padPostGeometry() {
  return cachedGeo('racepadpost', () => {
    const post = tubeGeometry(0.05, 0.07, 1.3, 8, 1);
    post.translate(0, 0.65, 0);
    const gem = prismGeometry(0.11, 0.26, 6, 1);
    gem.translate(0, 1.42, 0);
    const g = mergeGeometries([normalizeAttrs(post), normalizeAttrs(gem)], false);
    post.dispose(); gem.dispose();
    g.computeBoundingSphere();
    return g;
  });
}

/* ===========================================================================
 * 5. Placement expansion — def.coins entries
 * ======================================================================== */

/**
 * Expand a coin entry into world points. Entries:
 *   {p:[x,y,z]}                        one coin
 *   {ring:{c, r, n, y}}                n coins on a circle (y = height above c)
 *   {line:{a, b, n}}                   n coins evenly from a to b (inclusive)
 *   {arc:{c, r, a0, a1, n, y}}         n coins on an arc (radians, CCW from +X)
 * Any entry may add `snap:true` to drop each coin onto the ground below it.
 */
/**
 * Resolve a ring/arc CENTRE. Two authored shapes, both legal (CONTRACT §25 lists
 * `c` and `y` side by side, so `y` is the HEIGHT, not an offset):
 *   c:[x, z]      -> centre y comes from `y` alone (absolute height)
 *   c:[x, y, z]   -> `y` is added to c.y as an offset (the older reading)
 * world/course.js `finCentre` validates the same two shapes.
 * @returns {THREE.Vector3} `out`, centre INCLUDING the height
 */
function readCentre(src, y, out) {
  if (Array.isArray(src) && src.length === 2) {
    return out.set(fin(src[0], 0), fin(y, 0), fin(src[1], 0));
  }
  readV3(src, out);
  out.y += fin(y, 0);
  return out;
}

function expandCoinEntry(entry, out) {
  if (!entry) return;
  const snap = !!entry.snap || !!entry.ground;
  if (entry.p) {
    out.push({ p: readV3(entry.p, new THREE.Vector3()), snap });
  } else if (entry.ring) {
    const r = entry.ring;
    const c = readCentre(r.c, r.y, new THREE.Vector3());
    const n = Math.max(1, Math.round(fin(r.n, 8)));
    const rad = fin(r.r, 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      out.push({ p: new THREE.Vector3(c.x + Math.cos(a) * rad, c.y, c.z + Math.sin(a) * rad), snap });
    }
  } else if (entry.line) {
    const l = entry.line;
    const a = readV3(l.a, new THREE.Vector3());
    const b = readV3(l.b, new THREE.Vector3());
    const n = Math.max(1, Math.round(fin(l.n, 5)));
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      out.push({ p: new THREE.Vector3().lerpVectors(a, b, t), snap });
    }
  } else if (entry.arc) {
    const r = entry.arc;
    const c = readCentre(r.c, r.y, new THREE.Vector3());
    const n = Math.max(1, Math.round(fin(r.n, 6)));
    const rad = fin(r.r, 3);
    const a0 = fin(r.a0, 0), a1 = fin(r.a1, Math.PI);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const a = a0 + (a1 - a0) * t;
      // an arc rises along its span when `rise` is given — the classic jump arc of coins
      const lift = fin(r.rise, 0) * Math.sin(t * Math.PI);
      out.push({ p: new THREE.Vector3(c.x + Math.cos(a) * rad, c.y + lift, c.z + Math.sin(a) * rad), snap });
    }
  }
}

/* ===========================================================================
 * 6. Collectibles
 * ======================================================================== */

export class Collectibles {
  /**
   * @param {object} courseDef  CONTRACT §25 course def (coins, sigils, crests)
   * @param {object} ctx  {scene|group, mats, theme, fx, audio, save, courseId, world, quality, camera?}
   */
  constructor(courseDef, ctx) {
    this.def = courseDef || {};
    this.ctx = ctx || {};
    this.courseId = this.ctx.courseId || this.def.id || 'course';
    this.theme = this.ctx.theme || null;
    this.themeId = themeId(this.theme);
    this.mats = this.ctx.mats || null;
    this.audio = this.ctx.audio || null;
    this.save = this.ctx.save || null;
    this.world = this.ctx.world || null;
    this.quality = this.ctx.quality || 'high';
    this.camera = this.ctx.camera || (this.ctx.engine && this.ctx.engine.camera) || null;

    const fx = this.ctx.fx || null;
    /** ParticleSystem (burst/ambient) — resolved from any of the shapes Game may hand us. */
    this.ps = fx ? (typeof fx.burst === 'function' ? fx
      : (fx.ps && typeof fx.ps.burst === 'function') ? fx.ps
      : (fx.particles && typeof fx.particles.burst === 'function') ? fx.particles : null) : null;
    /** Impacts (collect/pound reactions) — optional. */
    this.impacts = fx ? (typeof fx.collect === 'function' ? fx
      : (fx.impacts && typeof fx.impacts.collect === 'function') ? fx.impacts : null) : null;

    const pal = paletteOf(this.theme);
    this.colors = {
      coin: pal && pal.coin !== undefined ? pal.coin : 0xffcf4d,
      sigil: pal && pal.sigil !== undefined ? pal.sigil : 0xff4d6a,
      crest: pal && pal.crest !== undefined ? pal.crest : 0xffd166,
      accent: pal && pal.accent !== undefined ? pal.accent : 0x7ec8ff,
      realm: pal && pal.crest !== undefined ? pal.crest : (pal && pal.accent !== undefined ? pal.accent : 0x4fd1ff),
    };

    this.events = new Emitter();
    this.group = new THREE.Group();
    this.group.name = 'collectibles';
    this.time = 0;
    this._silent = true;

    /** Live tallies (HUD reads these directly). */
    this.counts = { coins: 0, coinsTotal: 0, sigils: 0, sigilsTotal: SIGILS_TOTAL, crests: 0, crestsTotal: 0 };

    /** Race readout for the HUD snap: `active` while the clock runs, `done` once the
     *  finish pad froze it (the crest is out, waiting to be taken). */
    this.race = { active: false, done: false, ms: 0, limitMs: 0, def: null };

    /** Thin pad colliders (race pads) — register with the course broadphase if desired. */
    this.colliders = [];

    this._combo = 0;
    this._comboT = 0;
    this._lockedCd = 0;

    this._buildCoins();
    this._buildSigils();
    this._buildCrests();

    const parent = this.ctx.group || this.ctx.scene || null;
    if (parent && typeof parent.add === 'function') parent.add(this.group);

    this._silent = false;
  }

  /* ------------------------------------------------------------------ *
   *  build — coins
   * ------------------------------------------------------------------ */

  _groundY(x, y, z) {
    const w = this.world;
    if (!w || typeof w.raycast !== 'function') return NaN;
    _v0.set(x, y + 2.5, z);
    _rayOut.t = 0; _rayOut.collider = null;
    let hit = false;
    try { hit = w.raycast(_v0, DOWN, 60, _rayOut); } catch (e) { hit = false; }
    if (!hit) return NaN;
    return _v0.y - _rayOut.t;
  }

  _buildCoins() {
    const pts = [];
    const defs = Array.isArray(this.def.coins) ? this.def.coins : [];
    for (let i = 0; i < defs.length; i++) expandCoinEntry(defs[i], pts);
    const n = pts.length;
    this.coinCount = n;
    this.counts.coinsTotal = n;

    this._cHome = new Float32Array(n * 3);
    this._cOff = new Float32Array(n * 3);   // magnet displacement from home
    this._cVel = new Float32Array(n * 3);   // magnet velocity
    this._cPhase = new Float32Array(n);
    this._cState = new Uint8Array(n);       // 0 collected, 1 live, 2 popping
    this._cPop = new Float32Array(n);       // pop timer
    // LOD band the coin's matrix was last written for (tri-state, NOT a bool):
    //   0 = far band  — static pose written once, no per-frame matrix work
    //   1 = near band — animated every frame (bob + spin + magnet)
    //   2 = hidden    — scale-0 pose written once
    // The band is compared, never toggled, so a coin that starts outside
    // HIDE_RANGE is hidden on its very first update instead of only after it
    // has passed through the middle band.
    this._cDirty = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
      const p = pts[i].p;
      let y = p.y;
      if (pts[i].snap) {
        const gy = this._groundY(p.x, p.y, p.z);
        if (isFinite(gy)) y = gy + 0.55;
      }
      this._cHome[i * 3] = p.x; this._cHome[i * 3 + 1] = y; this._cHome[i * 3 + 2] = p.z;
      // hash-derived phase: deterministic, and neighbours differ by a golden step
      this._cPhase[i] = ((i * 0.6180339887) % 1) * TAU;
      this._cState[i] = 1;
      this._cDirty[i] = 1;
    }

    const geo = coinGeometry();
    const mat = goldMaterial(this.theme, this.mats);
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    mesh.name = 'coins';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.count = n;
    this.coinMesh = mesh;
    this.group.add(mesh);

    // seed every matrix once (static pose) so far coins are correct before the first update
    for (let i = 0; i < n; i++) this._writeCoinMatrix(i, 0, 1);
    mesh.instanceMatrix.needsUpdate = true;
    if (n > 0) {
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) mesh.boundingSphere.radius += MAGNET_R + 1.5;
    } else {
      mesh.visible = false;
    }
  }

  /** Compose one coin instance matrix: home + offset, spin about Y, bob, scale. */
  _writeCoinMatrix(i, t, scale) {
    const h = this._cHome, o = this._cOff, ph = this._cPhase[i];
    const bob = scale > 0 ? Math.sin(t * 2.4 + ph) * 0.09 : 0;
    _v0.set(h[i * 3] + o[i * 3], h[i * 3 + 1] + o[i * 3 + 1] + bob, h[i * 3 + 2] + o[i * 3 + 2]);
    _q0.setFromAxisAngle(UP, t * 2.6 + ph);
    _s0.set(scale, scale, scale);
    _m0.compose(_v0, _q0, _s0);
    this.coinMesh.setMatrixAt(i, _m0);
  }

  /* ------------------------------------------------------------------ *
   *  build — sigils
   * ------------------------------------------------------------------ */

  _buildSigils() {
    const defs = Array.isArray(this.def.sigils) ? this.def.sigils : [];
    const n = Math.min(SIGILS_TOTAL, defs.length);
    this.sigilCount = n;
    this.counts.sigilsTotal = SIGILS_TOTAL;

    this._sHome = new Float32Array(SIGILS_TOTAL * 3);
    this._sOff = new Float32Array(SIGILS_TOTAL * 3);
    this._sVel = new Float32Array(SIGILS_TOTAL * 3);
    this._sPhase = new Float32Array(SIGILS_TOTAL);
    this._sState = new Uint8Array(SIGILS_TOTAL);
    this._sPop = new Float32Array(SIGILS_TOTAL);

    for (let i = 0; i < n; i++) {
      readV3(defs[i].p, _v0);
      let y = _v0.y;
      if (defs[i].snap || defs[i].ground) {
        const gy = this._groundY(_v0.x, _v0.y, _v0.z);
        if (isFinite(gy)) y = gy + 0.75;
      }
      this._sHome[i * 3] = _v0.x; this._sHome[i * 3 + 1] = y; this._sHome[i * 3 + 2] = _v0.z;
      this._sPhase[i] = (i / SIGILS_TOTAL) * TAU;
      this._sState[i] = 1;
    }

    const mat = sigilMaterial();
    this.sigilMat = mat;
    const mesh = new THREE.InstancedMesh(sigilGeometry(), mat, SIGILS_TOTAL);
    mesh.name = 'sigils';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.count = n;
    mesh.frustumCulled = false;   // 8 instances spread across the whole course
    this.sigilMesh = mesh;
    this.group.add(mesh);

    // badges: plate + numeral quad, both instanced, both face the hero
    const plate = new THREE.InstancedMesh(badgePlateGeometry(), badgePlateMaterial(), SIGILS_TOTAL);
    plate.name = 'sigilBadgePlates';
    plate.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    plate.castShadow = false;
    plate.count = n;
    plate.frustumCulled = false;
    this.badgePlate = plate;
    this.group.add(plate);

    const quadGeo = badgeQuadGeometry();
    const cells = new Float32Array(SIGILS_TOTAL);
    for (let i = 0; i < SIGILS_TOTAL; i++) cells[i] = i;
    const numGeo = new THREE.InstancedBufferGeometry();
    numGeo.setAttribute('position', quadGeo.attributes.position);
    numGeo.setAttribute('normal', quadGeo.attributes.normal);
    numGeo.setAttribute('uv', quadGeo.attributes.uv);
    numGeo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 1));
    numGeo.boundingSphere = quadGeo.boundingSphere;
    this._badgeNumGeo = numGeo;
    const num = new THREE.InstancedMesh(numGeo, badgeAtlasMaterial(), SIGILS_TOTAL);
    num.name = 'sigilBadgeNumerals';
    num.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    num.castShadow = false;
    num.count = n;
    num.frustumCulled = false;
    this.badgeNum = num;
    this.group.add(num);

    for (let i = 0; i < n; i++) this._writeSigilMatrices(i, 0, 1, 0);
    mesh.instanceMatrix.needsUpdate = true;
    plate.instanceMatrix.needsUpdate = true;
    num.instanceMatrix.needsUpdate = true;
    if (n === 0) { mesh.visible = false; plate.visible = false; num.visible = false; }
  }

  /** Sigil disc + badge matrices. `faceYaw` orients the badge toward the hero. */
  _writeSigilMatrices(i, t, scale, faceYaw) {
    const h = this._sHome, o = this._sOff, ph = this._sPhase[i];
    const bob = scale > 0 ? Math.sin(t * 1.9 + ph) * 0.11 : 0;
    const x = h[i * 3] + o[i * 3], y = h[i * 3 + 1] + o[i * 3 + 1] + bob, z = h[i * 3 + 2] + o[i * 3 + 2];
    _v0.set(x, y, z);
    _q0.setFromAxisAngle(UP, t * 1.7 + ph);
    _s0.set(scale, scale, scale);
    _m0.compose(_v0, _q0, _s0);
    this.sigilMesh.setMatrixAt(i, _m0);

    // badge hovers 0.66 m above the disc and turns to face the hero
    _v0.set(x, y + 0.66 + Math.sin(t * 2.6 + ph) * 0.03, z);
    _q1.setFromAxisAngle(UP, faceYaw);
    _m0.compose(_v0, _q1, _s0);
    this.badgePlate.setMatrixAt(i, _m0);
    this.badgeNum.setMatrixAt(i, _m0);
  }

  /* ------------------------------------------------------------------ *
   *  build — crests + race pads
   * ------------------------------------------------------------------ */

  _savedCrests() {
    const s = this.save;
    if (!s || typeof s.course !== 'function') return null;
    try {
      const rec = s.course(this.courseId);
      return rec && Array.isArray(rec.crests) ? rec.crests : null;
    } catch (e) { return null; }
  }

  _buildCrests() {
    const defs = Array.isArray(this.def.crests) ? this.def.crests : [];
    const saved = this._savedCrests();
    this.crests = [];
    this.crestById = new Map();
    this._sessionCollected = new Set();
    this.counts.crestsTotal = defs.length;

    const realm = this.colors.realm;
    const goldMat = goldMaterial(this.theme, this.mats);
    const enamel = enamelMaterial(realm);
    const ghost = ghostMaterial(realm);
    const glow = getGlow(realm, { mode: 'radial', speed: 0.7, power: 2.2, gain: 0.85 });
    const halo = haloMaterial(realm);

    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      const type = d.type || 'open';
      const placed = type === 'open' || type === 'power';
      const c = {
        def: d, id: d.id || ('crest' + i), type, index: i,
        placed,
        home: new THREE.Vector3(),
        groundY: NaN,
        present: false,     // visible & collectable this session
        ghost: false,       // in the save already
        taken: false,       // taken this session (animation running / done)
        phase: (i * 0.73) % TAU,
        spawnT: 1,          // 0..1 scale-in
        popT: 0,            // >0 while the take animation runs
        lockedCd: 0,
        root: null, gold: null, enamelMesh: null, pool: null, halo: null,
        goldMat, enamel, ghostMat: ghost, glow,
        race: null,
      };
      c.ghost = !!(saved && saved.indexOf(c.id) >= 0);

      // position: placed crests use p; spawned ones use spawnAt (or their finish / p)
      const src = d.p || d.spawnAt || (d.finish ? d.finish : null);
      readV3(src, c.home);
      if (d.snap || d.ground) {
        const gy = this._groundY(c.home.x, c.home.y, c.home.z);
        if (isFinite(gy)) c.home.y = gy + 0.9;
      }
      c.groundY = this._groundY(c.home.x, c.home.y, c.home.z);
      if (!isFinite(c.groundY)) c.groundY = c.home.y - 0.9;

      // ---- mesh ----
      const root = new THREE.Group();
      root.name = 'crest_' + c.id;
      root.position.copy(c.home);
      const gold = new THREE.Mesh(crestGoldGeometry(), c.ghost ? ghost : goldMat);
      gold.castShadow = true;
      gold.name = 'crestGold';
      root.add(gold);
      const en = new THREE.Mesh(crestEnamelGeometry(), c.ghost ? ghost : enamel);
      en.castShadow = false;
      en.name = 'crestEnamel';
      root.add(en);
      const sprite = new THREE.Sprite(halo);
      sprite.scale.set(2.2, 2.2, 1);
      sprite.name = 'crestHalo';
      sprite.visible = !c.ghost;
      root.add(sprite);
      this.group.add(root);

      const pool = new THREE.Mesh(poolDiscGeometry(), glow);
      pool.name = 'crestPool';
      pool.position.set(c.home.x, c.groundY + 0.02, c.home.z);
      pool.visible = false;
      this.group.add(pool);

      c.root = root; c.gold = gold; c.enamelMesh = en; c.halo = sprite; c.pool = pool;

      if (type === 'race') c.race = this._buildRacePads(c, d);

      c.present = placed;
      this._applyCrestVisibility(c);
      this.crests.push(c);
      this.crestById.set(c.id, c);
      if (c.ghost) this.counts.crests++;
    }
  }

  _buildRacePads(c, d) {
    const start = readV3(d.start, new THREE.Vector3());
    const finish = readV3(d.finish, new THREE.Vector3());
    const gStart = this._groundY(start.x, start.y + 0.5, start.z);
    const gFinish = this._groundY(finish.x, finish.y + 0.5, finish.z);
    if (isFinite(gStart)) start.y = gStart;
    if (isFinite(gFinish)) finish.y = gFinish;

    const marble = getMaterial('marble', this.theme, this.mats);
    const startEm = getEmissive(0x62f28a, 2.4);
    const finishEm = getEmissive(this.colors.crest, 2.6);

    const mkPad = (pos, em, withPost, name) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.copy(pos);
      const plate = new THREE.Mesh(padGeometry(), marble);
      plate.position.y = 0.04;
      plate.receiveShadow = true;
      plate.castShadow = false;
      g.add(plate);
      const ring = new THREE.Mesh(padRingGeometry(), em);
      ring.position.y = 0.04;
      g.add(ring);
      if (withPost) {
        const post = new THREE.Mesh(padPostGeometry(), marble);
        post.position.set(RACE_PAD_R * 0.72, 0.08, RACE_PAD_R * 0.72);
        post.castShadow = true;
        g.add(post);
        const gem = new THREE.Mesh(prismGeometry(0.12, 0.28, 6, 1), em);
        gem.position.set(RACE_PAD_R * 0.72, 1.5, RACE_PAD_R * 0.72);
        g.add(gem);
      }
      this.group.add(g);
      const col = new Collider({
        center: [pos.x, pos.y + 0.04, pos.z], half: [RACE_PAD_R * 0.92, 0.04, RACE_PAD_R * 0.92],
        surface: 'normal', group: 'world', ref: null,
      });
      this.colliders.push(col);
      return { group: g, ring, em, pos, col };
    };

    return {
      start: mkPad(start, startEm, false, 'racePadStart'),
      finish: mkPad(finish, finishEm, true, 'racePadFinish'),
      limitMs: Math.max(1000, fin(d.limitMs, 60000)),
      onStart: false,
      onFinish: false,
    };
  }

  /** Apply present/ghost/taken to the crest's meshes + materials. */
  _applyCrestVisibility(c) {
    const show = c.present && !c.taken;
    c.root.visible = show || c.popT > 0;
    c.pool.visible = show && !c.ghost;
    c.halo.visible = show && !c.ghost;
    c.gold.material = c.ghost ? c.ghostMat : c.goldMat;
    c.enamelMesh.material = c.ghost ? c.ghostMat : c.enamel;
  }

  /* ------------------------------------------------------------------ *
   *  fx / audio helpers
   * ------------------------------------------------------------------ */

  _burst(preset, pos, color, strength) {
    if (!this.ps) return;
    _burstOpts.color = color;
    _burstOpts.strength = strength === undefined ? 1 : strength;
    try { this.ps.burst(preset, pos, _burstOpts); } catch (e) { /* VFX never breaks pickup */ }
  }

  _sfx(name, pos, rate, gain) {
    if (!this.audio || typeof this.audio.sfx !== 'function') return;
    _sfxOpts.rate = rate === undefined ? 1 : rate;
    _sfxOpts.gain = gain === undefined ? 1 : gain;
    _sfxOpts.pos = pos || null;
    _sfxOpts.listener = this.camera;
    try { this.audio.sfx(name, _sfxOpts); } catch (e) { /* audio never breaks pickup */ }
  }

  _stinger(name) {
    if (!this.audio || typeof this.audio.stinger !== 'function') return;
    try { this.audio.stinger(name); } catch (e) { /* noop */ }
  }

  /* ------------------------------------------------------------------ *
   *  update
   * ------------------------------------------------------------------ */

  /**
   * @param {number} dt seconds
   * @param {object} player  Player (pos = feet, capsule, vel, dead, power)
   */
  update(dt, player) {
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    const t = this.time;

    if (this._comboT > 0) { this._comboT -= dt; if (this._comboT <= 0) this._combo = 0; }
    if (this._lockedCd > 0) this._lockedCd -= dt;

    const alive = !!player && !player.dead;
    let px = 0, py = 0, pz = 0, cap = null, midY = 0;
    if (player) {
      const pp = player.pos || player.position;
      px = pp.x; py = pp.y; pz = pp.z;
      cap = capsuleOf(player);
      midY = capsuleMidY(player);
    }

    this._updateCoins(dt, t, player, alive, px, py, pz, cap, midY);
    this._updateSigils(dt, t, player, alive, px, py, pz, cap, midY);
    this._updateCrests(dt, t, player, alive, px, py, pz, cap);
    this._updateRace(dt, player, alive, px, py, pz);

    // sigil ember breathes on its own beat
    if (this.sigilMat) this.sigilMat.emissiveIntensity = 0.55 + 0.25 * Math.sin(t * 3.1);
  }

  _updateCoins(dt, t, player, alive, px, py, pz, cap, midY) {
    const n = this.coinCount;
    if (!n) return;
    const home = this._cHome, off = this._cOff, vel = this._cVel;
    const state = this._cState, pop = this._cPop, dirty = this._cDirty;
    const mesh = this.coinMesh;
    let any = false;
    const tyTarget = py + midY;
    const reach = (cap ? cap.r : TUNE.radius) + COIN_R * 0.9;
    const reach2 = reach * reach;

    for (let i = 0; i < n; i++) {
      const s = state[i];
      if (s === 0) continue;
      const i3 = i * 3;
      const x = home[i3] + off[i3], y = home[i3 + 1] + off[i3 + 1], z = home[i3 + 2] + off[i3 + 2];

      if (s === 2) {
        // take pop: scale 1 → 1.45 → 0
        pop[i] += dt / POP_T;
        if (pop[i] >= 1) {
          state[i] = 0; pop[i] = 0;
          this._writeCoinMatrix(i, t, 0);
        } else {
          const k = pop[i];
          const sc = k < 0.35 ? 1 + 0.45 * (k / 0.35) : 1.45 * (1 - easeOutCubic((k - 0.35) / 0.65));
          off[i3 + 1] += dt * 1.6;   // lifts as it pops
          this._writeCoinMatrix(i, t, sc);
        }
        any = true;
        continue;
      }

      if (!player) continue;
      const dx = x - px, dy = y - py, dz = z - pz;
      const d2 = dx * dx + dy * dy + dz * dz;

      if (d2 > HIDE_RANGE2) {
        // hidden band: collapse to scale 0 once, then never touch it again
        if (dirty[i] !== 2) { this._writeCoinMatrix(i, t, 0); dirty[i] = 2; any = true; }
        continue;
      }
      if (d2 > ANIM_RANGE2) {
        // far band: one static pose, written the frame it enters the band
        if (dirty[i] !== 0) { this._writeCoinMatrix(i, 0, 1); dirty[i] = 0; any = true; }
        continue;
      }
      dirty[i] = 1;

      // magnet: glide toward the capsule centre inside MAGNET_R
      const mx = px - x, my = tyTarget - y, mz = pz - z;
      const md2 = mx * mx + my * my + mz * mz;
      if (alive && md2 < MAGNET_R2 && md2 > 1e-6) {
        const md = Math.sqrt(md2);
        const k = MAGNET_ACCEL * dt / md;
        vel[i3] += mx * k; vel[i3 + 1] += my * k; vel[i3 + 2] += mz * k;
        const vl = Math.sqrt(vel[i3] * vel[i3] + vel[i3 + 1] * vel[i3 + 1] + vel[i3 + 2] * vel[i3 + 2]);
        if (vl > MAGNET_MAX) { const f = MAGNET_MAX / vl; vel[i3] *= f; vel[i3 + 1] *= f; vel[i3 + 2] *= f; }
        off[i3] += vel[i3] * dt; off[i3 + 1] += vel[i3 + 1] * dt; off[i3 + 2] += vel[i3 + 2] * dt;
      } else if (off[i3] !== 0 || off[i3 + 1] !== 0 || off[i3 + 2] !== 0) {
        // out of reach again: settle home
        const f = 1 - Math.exp(-dt * 6);
        off[i3] -= off[i3] * f; off[i3 + 1] -= off[i3 + 1] * f; off[i3 + 2] -= off[i3 + 2] * f;
        vel[i3] *= 0.5; vel[i3 + 1] *= 0.5; vel[i3 + 2] *= 0.5;
        if (Math.abs(off[i3]) + Math.abs(off[i3 + 1]) + Math.abs(off[i3 + 2]) < 0.002) {
          off[i3] = off[i3 + 1] = off[i3 + 2] = 0; vel[i3] = vel[i3 + 1] = vel[i3 + 2] = 0;
        }
      }

      // collect on capsule overlap
      if (alive && cap && md2 < 4.0) {
        const cx = home[i3] + off[i3], cy = home[i3 + 1] + off[i3 + 1], cz = home[i3 + 2] + off[i3 + 2];
        if (segPointDistSq(cap.a, cap.b, cx, cy, cz) < reach2) {
          this._takeCoin(i, cx, cy, cz);
          any = true;
          continue;
        }
      }

      this._writeCoinMatrix(i, t, 1);
      any = true;
    }
    if (any) mesh.instanceMatrix.needsUpdate = true;
  }

  _takeCoin(i, x, y, z) {
    const i3 = i * 3;
    this._cState[i] = 2;
    this._cPop[i] = 0;
    this._cVel[i3] = this._cVel[i3 + 1] = this._cVel[i3 + 2] = 0;
    this.counts.coins++;
    if (!this._silent) {
      this._combo = Math.min(COMBO_MAX, this._comboT > 0 ? this._combo + 1 : 0);
      this._comboT = COMBO_WINDOW;
      _v1.set(x, y, z);
      this._burst('coin', _v1, this.colors.coin, 0.6);
      this._sfx('coin', _v1, 1 + this._combo * 0.06, 0.8);
      this.events.emit('coin', this.counts.coins, i);
      this._checkCoinThreshold();
    }
  }

  _checkCoinThreshold() {
    for (let k = 0; k < this.crests.length; k++) {
      const c = this.crests[k];
      if (c.type !== 'coins' || c.present) continue;
      const need = Math.max(1, Math.round(fin(c.def.threshold, 100)));
      if (this.counts.coins >= need) {
        this.events.emit('coins100', this.counts.coins);
        this._stinger('coins100');
        this.spawnCrest(c.id);
      }
    }
  }

  _updateSigils(dt, t, player, alive, px, py, pz, cap, midY) {
    const n = this.sigilCount;
    if (!n) return;
    const home = this._sHome, off = this._sOff, vel = this._sVel, state = this._sState, pop = this._sPop;
    const tyTarget = py + midY;
    const reach = (cap ? cap.r : TUNE.radius) + SIGIL_R * 0.9;
    const reach2 = reach * reach;
    let any = false;

    for (let i = 0; i < n; i++) {
      const s = state[i];
      const i3 = i * 3;
      const x = home[i3] + off[i3], y = home[i3 + 1] + off[i3 + 1], z = home[i3 + 2] + off[i3 + 2];
      const faceYaw = player ? Math.atan2(px - x, pz - z) : 0;
      if (s === 0) continue;
      if (s === 2) {
        pop[i] += dt / (POP_T * 1.3);
        if (pop[i] >= 1) { state[i] = 0; pop[i] = 0; this._writeSigilMatrices(i, t, 0, faceYaw); }
        else {
          const k = pop[i];
          const sc = k < 0.35 ? 1 + 0.5 * (k / 0.35) : 1.5 * (1 - easeOutCubic((k - 0.35) / 0.65));
          off[i3 + 1] += dt * 1.8;
          this._writeSigilMatrices(i, t, sc, faceYaw);
        }
        any = true;
        continue;
      }
      if (player) {
        const mx = px - x, my = tyTarget - y, mz = pz - z;
        const md2 = mx * mx + my * my + mz * mz;
        if (alive && md2 < MAGNET_R2 * 1.4 && md2 > 1e-6) {
          const md = Math.sqrt(md2);
          const k = MAGNET_ACCEL * dt / md;
          vel[i3] += mx * k; vel[i3 + 1] += my * k; vel[i3 + 2] += mz * k;
          const vl = Math.sqrt(vel[i3] * vel[i3] + vel[i3 + 1] * vel[i3 + 1] + vel[i3 + 2] * vel[i3 + 2]);
          if (vl > MAGNET_MAX) { const f = MAGNET_MAX / vl; vel[i3] *= f; vel[i3 + 1] *= f; vel[i3 + 2] *= f; }
          off[i3] += vel[i3] * dt; off[i3 + 1] += vel[i3 + 1] * dt; off[i3 + 2] += vel[i3 + 2] * dt;
        } else if (off[i3] !== 0 || off[i3 + 1] !== 0 || off[i3 + 2] !== 0) {
          const f = 1 - Math.exp(-dt * 6);
          off[i3] -= off[i3] * f; off[i3 + 1] -= off[i3 + 1] * f; off[i3 + 2] -= off[i3 + 2] * f;
          vel[i3] *= 0.5; vel[i3 + 1] *= 0.5; vel[i3 + 2] *= 0.5;
        }
        if (alive && cap && md2 < 6.0) {
          const cx = home[i3] + off[i3], cy = home[i3 + 1] + off[i3 + 1], cz = home[i3 + 2] + off[i3 + 2];
          if (segPointDistSq(cap.a, cap.b, cx, cy, cz) < reach2) {
            this._takeSigil(i, cx, cy, cz);
            any = true;
            continue;
          }
        }
      }
      this._writeSigilMatrices(i, t, 1, faceYaw);
      any = true;
    }
    if (any) {
      this.sigilMesh.instanceMatrix.needsUpdate = true;
      this.badgePlate.instanceMatrix.needsUpdate = true;
      this.badgeNum.instanceMatrix.needsUpdate = true;
    }
  }

  _takeSigil(i, x, y, z) {
    const i3 = i * 3;
    this._sState[i] = 2;
    this._sPop[i] = 0;
    this._sVel[i3] = this._sVel[i3 + 1] = this._sVel[i3 + 2] = 0;
    this.counts.sigils++;
    if (this._silent) return;
    _v1.set(x, y, z);
    this._burst('sigil', _v1, this.colors.sigil, 1);
    this._sfx('sigil', _v1, 1 + (this.counts.sigils - 1) * 0.08, 1);
    if (this.impacts && typeof this.impacts.collect === 'function') {
      try { this.impacts.collect('sigil', _v1); } catch (e) { /* noop */ }
    }
    this.events.emit('sigil', this.counts.sigils, i);
    if (this.counts.sigils >= SIGILS_TOTAL) {
      this.events.emit('sigilsDone');
      this._stinger('sigilsDone');
      for (let k = 0; k < this.crests.length; k++) {
        const c = this.crests[k];
        if (c.type === 'sigils' && !c.present) this.spawnCrest(c.id);
      }
    }
  }

  _updateCrests(dt, t, player, alive, px, py, pz, cap) {
    const n = this.crests.length;
    const reach = (cap ? cap.r : TUNE.radius) + CREST_R * 0.85;
    const reach2 = reach * reach;
    for (let i = 0; i < n; i++) {
      const c = this.crests[i];
      if (c.lockedCd > 0) c.lockedCd -= dt;

      if (c.popT > 0) {
        // take animation: rise, spin fast, shrink
        c.popT -= dt / CREST_POP_T;
        const k = 1 - Math.max(0, c.popT);
        const r = c.root;
        r.position.set(c.home.x, c.home.y + CREST_LIFT + k * 1.4, c.home.z);
        r.rotation.y += dt * (CREST_SPIN + k * 22);
        const sc = k < 0.3 ? 1 + 0.35 * (k / 0.3) : 1.35 * (1 - easeOutCubic((k - 0.3) / 0.7));
        r.scale.setScalar(Math.max(0.0001, sc));
        if (c.popT <= 0) { c.popT = 0; this._applyCrestVisibility(c); }
        continue;
      }
      if (!c.present || c.taken) continue;

      // spawn-in
      if (c.spawnT < 1) {
        c.spawnT = Math.min(1, c.spawnT + dt / CREST_SPAWN_T);
        const sc = easeOutBack(c.spawnT, 1.6);
        c.root.scale.setScalar(Math.max(0.0001, sc));
      }

      // float + spin
      const bob = CREST_LIFT + CREST_BOB * Math.sin(t * 1.6 + c.phase);
      c.root.position.set(c.home.x, c.home.y + bob, c.home.z);
      c.root.rotation.y = t * CREST_SPIN + c.phase;
      if (c.halo.visible) {
        const hs = 2.1 + 0.25 * Math.sin(t * 2.3 + c.phase);
        c.halo.scale.set(hs, hs, 1);
      }
      if (c.pool.visible) {
        const ps = 1 + 0.08 * Math.sin(t * 1.6 + c.phase);
        c.pool.scale.set(ps, 1, ps);
      }

      // collect
      if (!alive || !cap) continue;
      const cx = c.root.position.x, cy = c.root.position.y, cz = c.root.position.z;
      const dx = cx - px, dz = cz - pz;
      if (dx * dx + dz * dz > 9) continue;
      if (segPointDistSq(cap.a, cap.b, cx, cy, cz) < reach2) {
        if (c.type === 'power') {
          const need = c.def.power;
          const has = player.power === need || (player.power && player.power.id === need);
          if (!has) {
            if (c.lockedCd <= 0) {
              c.lockedCd = 1.5;
              _v1.set(cx, cy, cz);
              this._burst('spark', _v1, this.colors.accent, 0.5);
              this._sfx('ui_back', _v1, 0.9, 0.6);
              this.events.emit('crestLocked', c.def);
            }
            continue;
          }
        }
        this._takeCrest(c, player);
      }
    }
  }

  _takeCrest(c, player) {
    c.taken = true;
    c.popT = 1;
    const wasGhost = c.ghost;
    let ms = Math.round(this.time * 1000);
    if (c.race) {
      ms = (this.race.active || this.race.done) && this.race.def === c.def ? Math.round(this.race.ms) : ms;
      this.race.active = false; this.race.done = false; this.race.def = null;
    }
    if (!wasGhost && !this._sessionCollected.has(c.id)) {
      this._sessionCollected.add(c.id);
      this.counts.crests++;
    }
    // it becomes a ghost from now on (re-collectable for time)
    c.ghost = true;
    _v1.copy(c.root.position);
    this._burst(wasGhost ? 'crest' : 'crestGrand', _v1, this.colors.crest, 1);
    this._sfx('crest', _v1, 1, 1);
    this._stinger('crest');
    if (this.impacts && typeof this.impacts.collect === 'function') {
      try { this.impacts.collect('crest', _v1); } catch (e) { /* noop */ }
    }
    _crestInfo.ghost = wasGhost; _crestInfo.ms = ms;
    this.events.emit('crest', c.def, _crestInfo);
  }

  _updateRace(dt, player, alive, px, py, pz) {
    const r = this.race;
    for (let i = 0; i < this.crests.length; i++) {
      const c = this.crests[i];
      if (!c.race) continue;
      const rc = c.race;
      const onStart = alive && this._onPad(rc.start.pos, px, py, pz);
      const onFinish = alive && this._onPad(rc.finish.pos, px, py, pz);

      // pulse rings: idle breath, faster during an active race
      const active = r.active && r.def === c.def;
      const pulse = active ? 0.5 + 0.5 * Math.sin(this.time * 9) : 0.5 + 0.5 * Math.sin(this.time * 2.2);
      rc.start.em.emissiveIntensity = 1.6 + 1.6 * pulse;
      rc.finish.em.emissiveIntensity = active ? 1.6 + 2.4 * pulse : 1.2 + 0.8 * pulse;

      if (onStart && !rc.onStart && !active && !(r.done && r.def === c.def)) {
        // step on start → the clock runs (a fresh attempt cancels another crest's race)
        r.active = true; r.done = false; r.ms = 0; r.limitMs = rc.limitMs; r.def = c.def;
        _v1.copy(rc.start.pos); _v1.y += 0.1;
        this._burst('checkpoint', _v1, 0x62f28a, 0.8);
        this._sfx('ring_pass', _v1, 1.1, 0.9);
        this.events.emit('raceStart', c.def);
      }
      rc.onStart = onStart;

      if (active) {
        r.ms += dt * 1000;
        if (!alive) {
          r.active = false; r.def = null;
          this.events.emit('raceFail', c.def, Math.round(r.ms));
        } else if (r.ms > r.limitMs) {
          r.active = false; r.def = null;
          _v1.copy(rc.finish.pos); _v1.y += 0.1;
          this._sfx('vanish_warn', _v1, 0.7, 0.8);
          this.events.emit('raceFail', c.def, Math.round(r.ms));
        } else if (onFinish && !rc.onFinish) {
          const ms = Math.round(r.ms);
          // freeze the clock: the crest appears at spawnAt (or over the finish pad)
          // and _takeCrest records the frozen run time
          r.active = false; r.done = true;
          this.events.emit('raceFinish', c.def, ms);
          _v1.copy(rc.finish.pos); _v1.y += 0.2;
          this._burst('courseClear', _v1, this.colors.crest, 1);
          this._sfx('ring_pass', _v1, 1.4, 1);
          if (!c.present) {
            if (!c.def.spawnAt) c.home.set(rc.finish.pos.x, rc.finish.pos.y + 1.4, rc.finish.pos.z);
            this.spawnCrest(c.id);
          } else if (c.taken) {
            c.taken = false; c.popT = 0; c.spawnT = 0; this._applyCrestVisibility(c);
          }
        }
      }
      rc.onFinish = onFinish;
    }
  }

  _onPad(pos, px, py, pz) {
    const dx = px - pos.x, dz = pz - pos.z;
    if (dx * dx + dz * dz > PAD_STAND_R * PAD_STAND_R) return false;
    const dy = py - pos.y;
    return dy > -0.4 && dy < 0.7;
  }

  /* ------------------------------------------------------------------ *
   *  public API (CONTRACT §22)
   * ------------------------------------------------------------------ */

  /**
   * Force-collect. kind 'coin'|'sigil' with an index, or 'crest' with a crest id.
   * @returns {boolean} true if something was collected
   */
  collect(kind, id) {
    if (kind === 'coin') {
      const i = id | 0;
      if (i < 0 || i >= this.coinCount || this._cState[i] !== 1) return false;
      const i3 = i * 3;
      this._takeCoin(i, this._cHome[i3] + this._cOff[i3], this._cHome[i3 + 1] + this._cOff[i3 + 1], this._cHome[i3 + 2] + this._cOff[i3 + 2]);
      this.coinMesh.instanceMatrix.needsUpdate = true;
      return true;
    }
    if (kind === 'sigil') {
      const i = id | 0;
      if (i < 0 || i >= this.sigilCount || this._sState[i] !== 1) return false;
      const i3 = i * 3;
      this._takeSigil(i, this._sHome[i3] + this._sOff[i3], this._sHome[i3 + 1] + this._sOff[i3 + 1], this._sHome[i3 + 2] + this._sOff[i3 + 2]);
      return true;
    }
    if (kind === 'crest') {
      const c = this.crestById.get(id);
      if (!c || c.taken) return false;
      if (!c.present) { c.present = true; c.spawnT = 1; this._applyCrestVisibility(c); }
      this._takeCrest(c, null);
      return true;
    }
    return false;
  }

  /**
   * Reveal a hidden crest with a fountain burst + stinger. `pos` overrides the
   * authored spawnAt. Returns the crest record or null.
   */
  spawnCrest(crestId, pos) {
    const c = this.crestById.get(crestId);
    if (!c) return null;
    if (pos) {
      readV3(pos, c.home);
      const gy = this._groundY(c.home.x, c.home.y, c.home.z);
      c.groundY = isFinite(gy) ? gy : c.home.y - 0.9;
      c.pool.position.set(c.home.x, c.groundY + 0.02, c.home.z);
    }
    if (c.present && !c.taken) return c;
    c.present = true;
    c.taken = false;
    c.popT = 0;
    c.spawnT = 0;
    c.root.scale.setScalar(0.0001);
    c.root.position.copy(c.home);
    this._applyCrestVisibility(c);
    if (!this._silent) {
      _v1.copy(c.home); _v1.y -= 0.4;
      this._burst('crest', _v1, this.colors.crest, 1);
      this._burst('spark', _v1, this.colors.realm, 1);
      this._sfx('gate_open', _v1, 1.2, 0.9);
      this._stinger('unlock');
      this.events.emit('crestSpawn', c.def);
    }
    return c;
  }

  /**
   * Fire a course trigger (a freed gnasher, a broken box, a fallen warden).
   * Spawns every `secret` crest whose def.trigger matches, and the `boss`
   * crest on 'warden-down'. Returns the number of crests spawned.
   */
  trigger(id) {
    let n = 0;
    for (let i = 0; i < this.crests.length; i++) {
      const c = this.crests[i];
      if (c.present) continue;
      const match = (c.def.trigger && c.def.trigger === id)
        || (c.type === 'boss' && (id === 'warden-down' || id === 'boss'));
      if (match) { this.spawnCrest(c.id); n++; }
    }
    return n;
  }

  /** Convenience for the boss crest. */
  onBossDown() { return this.trigger('warden-down'); }

  /** Sync the ghost set from the Save (call after Game writes a crest). */
  refreshSave() {
    const saved = this._savedCrests();
    if (!saved) return;
    for (let i = 0; i < this.crests.length; i++) {
      const c = this.crests[i];
      if (!c.ghost && saved.indexOf(c.id) >= 0) { c.ghost = true; this._applyCrestVisibility(c); }
    }
  }

  /**
   * Course reset: every coin and sigil back, spawned crests re-hidden, race
   * cancelled, clock zeroed. Crests taken this session stay ghosts (the Save
   * has them); the tally keeps counting them.
   */
  reset() {
    this._silent = true;
    this.time = 0;
    this._combo = 0; this._comboT = 0;

    for (let i = 0; i < this.coinCount; i++) {
      const i3 = i * 3;
      this._cState[i] = 1; this._cPop[i] = 0; this._cDirty[i] = 1;
      this._cOff[i3] = this._cOff[i3 + 1] = this._cOff[i3 + 2] = 0;
      this._cVel[i3] = this._cVel[i3 + 1] = this._cVel[i3 + 2] = 0;
      this._writeCoinMatrix(i, 0, 1);
    }
    if (this.coinCount) this.coinMesh.instanceMatrix.needsUpdate = true;
    this.counts.coins = 0;

    for (let i = 0; i < this.sigilCount; i++) {
      const i3 = i * 3;
      this._sState[i] = 1; this._sPop[i] = 0;
      this._sOff[i3] = this._sOff[i3 + 1] = this._sOff[i3 + 2] = 0;
      this._sVel[i3] = this._sVel[i3 + 1] = this._sVel[i3 + 2] = 0;
      this._writeSigilMatrices(i, 0, 1, 0);
    }
    if (this.sigilCount) {
      this.sigilMesh.instanceMatrix.needsUpdate = true;
      this.badgePlate.instanceMatrix.needsUpdate = true;
      this.badgeNum.instanceMatrix.needsUpdate = true;
    }
    this.counts.sigils = 0;

    for (let i = 0; i < this.crests.length; i++) {
      const c = this.crests[i];
      c.taken = false; c.popT = 0; c.spawnT = 1; c.lockedCd = 0;
      c.present = c.placed;
      readV3(c.def.p || c.def.spawnAt || c.def.finish, c.home);
      if (c.def.snap || c.def.ground) {
        const gy = this._groundY(c.home.x, c.home.y, c.home.z);
        if (isFinite(gy)) c.home.y = gy + 0.9;
      }
      c.root.position.copy(c.home);
      c.root.scale.setScalar(1);
      c.root.rotation.set(0, c.phase, 0);
      if (c.race) { c.race.onStart = false; c.race.onFinish = false; }
      this._applyCrestVisibility(c);
    }
    this.race.active = false; this.race.done = false; this.race.ms = 0; this.race.def = null;
    this._silent = false;
  }

  /** Detach and free everything this module created (shared Mats are untouched). */
  dispose() {
    this.events.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh || o.isSprite) {
        if (o.geometry && !o.geometry.userData.__shared && o.geometry !== this._badgeNumGeo) o.geometry.dispose();
      }
    });
    if (this._badgeNumGeo) { this._badgeNumGeo.dispose(); this._badgeNumGeo = null; }
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (c._bp && typeof c._bp.remove === 'function') c._bp.remove(c);
    }
    this.colliders.length = 0;
    this.crests.length = 0;
    this.crestById.clear();
    this.coinCount = 0;
    this.sigilCount = 0;
  }
}

/** Release the module-level geometry + material caches (course teardown at exit). */
export function disposeCollectibleCaches() {
  for (const g of _geoCache.values()) g.dispose();
  _geoCache.clear();
  for (const m of _matCache.values()) {
    if (m.map) m.map.dispose();
    m.dispose();
  }
  _matCache.clear();
}

export default Collectibles;
