/**
 * CRESTBOUND — VERDANT BAILEY 1 : "BAILEY MEADOW"
 * runtime/data/courses/verdant-1.js                                 CONTRACT §25
 * ===========================================================================
 *
 * The first course, and the one the critic sees first. An OPEN DIORAMA about
 * 120 x 120 m across a 140 x 140 m heightfield: rolling meadow in the south,
 * a brook with a broken bridge across the middle, a tumbledown FORT on a
 * flat-topped mound, a pond in the west, a windmill on the high hill in the
 * east, a ridge with a Warden's ring in the north, and a rock-cut chamber
 * nobody finds by accident.
 *
 * It is the tutorial and it never says so. Every move in the bible is TAUGHT by
 * a piece of terrain that only wants that move, then TWISTED, then COMBINED,
 * then given a BREATHER with coins before the next idea:
 *
 *   BEAT 1  MEADOW          analog run/walk, the first hop, bumblers, coin trail
 *   BEAT 2  THE BROOK       a bridge with a hole in it — one measured 3.50 m gap
 *   BEAT 3  THE CLIMB       a long grass slope, a climbable tree, coins on the
 *                           diagonal, the first sigil you have to work for
 *   BEAT 4  THE FORT        courtyard, crates, stairs, ramp, wall-kick shaft,
 *                           ramparts, and the crest on the high tower
 *   BEAT 5  THE GNASHER     a chained jaw guarding a cage — pound its post 3x
 *   BEAT 6  THE POND        swim tutorial: sinking lily pads, a dive, a ring
 *   BEAT 7  THE CAVE        a breakable wall behind boulders
 *   BEAT 8  THE MILL        ride an arm to a floating island — the set piece
 *   BEAT 9  THE RIDGE       jump pad, crag, and the Warden's ring
 *   BEAT 10 RACE / WINGS    two optional overlays across the whole map
 *
 * ---------------------------------------------------------------------------
 * THE TERRAIN SAMPLER — the exact formula, so world/terrain.js and
 * _harness/reachcheck.mjs can agree with this file to the millimetre.
 * ---------------------------------------------------------------------------
 * `terrainHeightAt(x, z)` (exported below, and used by every `p` in this file)
 * evaluates, IN THIS ORDER:
 *
 *   1. h = base
 *   2. HILLS      for each {p:[hx,hz], r, h}:  d = hypot(x-hx, z-hz)
 *                 if d < r:  h += hill.h * (1 - S(d / r))
 *   3. RIDGES     for each {a:[ax,az], b:[bx,bz], w, h}: d = distance from
 *                 (x,z) to the SEGMENT a..b (clamped, not the infinite line)
 *                 if d < w:  h += ridge.h * (1 - S(d / w))
 *   4. NOISE      h += noise.amp * (2 * valueNoise(x*freq, z*freq, seed) - 1)
 *   5. FLATS      for each {p:[fx,fz], r, h, core?} IN ARRAY ORDER:
 *                 d = hypot(x-fx, z-fz);  if d >= r: skip
 *                 c = r * (core ?? 0.55);  t = S((d - c) / (r - c))
 *                 h = flat.h * (1 - t) + h * t
 *                 (so h is EXACTLY flat.h inside the core radius and blends out
 *                  to the natural surface at the rim; a later flat wins over an
 *                  earlier one where they overlap.)
 *
 *   S(u) is the ONE smoothstep used everywhere:
 *        S(u) = 0            when u <= 0
 *        S(u) = 1            when u >= 1
 *        S(u) = u*u*(3-2*u)  otherwise
 *
 *   valueNoise is bilinear value noise on the integer lattice with S() as the
 *   interpolant and the integer hash `hash2` below (Math.imul, so the 32-bit
 *   wraparound is identical in every JS engine). It returns 0..1; step 4 maps
 *   it to -1..1.
 *
 * Because a hill's falloff is 1 - S(d/r), its APEX IS FLAT (S'(0) = 0) and its
 * skirt meets the surrounding ground at exactly zero slope, so no hill here has
 * a crease. A hill's steepest face is 1.5 * h / r — every hill is sized so that
 * stays under the slide threshold (TUNE.slope.slideDeg = 38 deg) on every
 * REQUIRED walk. Measured worst cases on the required spine:
 *     spawn -> bridge          2.4 deg
 *     bridge -> checkpoint 2  28.8 deg
 *     checkpoint 2 -> gate    27.0 deg
 *     gate -> courtyard        0.0 deg   (the plateau is a flat)
 *     mill terrace -> mill top 36.7 deg  (the steepest required thing here)
 *     west route to the arena 35.8 deg
 * The 46 deg north lip of the Warden's ring and the 38 deg brook banks are
 * DELIBERATE slide surfaces — nothing required crosses them.
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS (contract §25 + runtime/data/index.js)
 * ---------------------------------------------------------------------------
 *   p            CENTRE, [x, y, z].  s = FULL size, [sx, sy, sz].
 *                => a platform's walkable top is p[1] + s[1]/2.
 *   yaw          RADIANS. yaw 0 faces -Z. +yaw is counter-clockwise from above.
 *                (headingFromYaw in core/util.js is the ONLY converter.)
 *   rot          Euler XYZ radians.
 *   colours      hex NUMBERS.
 *   stripe:true  "you had to jump to get here" — earns the bright leading edge.
 *                Walk-on ground never gets one.
 *   text         built in the local XY plane facing local +Z, so rot [0,0,0]
 *                faces a player walking north (-Z) — which is every sign here.
 *
 * ---------------------------------------------------------------------------
 * THE REACH BUDGET ACTUALLY USED (safe limits from core/tuning.js REACH_TABLE:
 * single 4.52 flat / 3.88 at +1.0 / 3.28 at +1.6; double 5.24; triple 6.11)
 * ---------------------------------------------------------------------------
 *   longest REQUIRED gap    3.50 m at +0.31 m   BEAT 2, the broken bridge
 *                           (single-safe there is ~4.3 m and the approach is
 *                            7.5 m of straight deck)
 *   tallest REQUIRED step   1.30 m              BEAT 4, the rampart merlons
 *   wall-kick shaft         3.30 m clear, 7.60 m tall (limits: 3.4 m wide,
 *                           2.12 m per kick -> 1 jump + 4 kicks clears it)
 *   longest OPTIONAL gap    4.20 m              BEAT 9, crag -> ridge shelf
 *   riskiest OPTIONAL line  the lily pads: 2.10 / 1.30 / 2.20 m while sinking
 * Nothing here REQUIRES a long jump, a triple or a dive. All three are taught
 * (signs, coin arcs, the mill runway) and demanded in verdant-2.
 *
 * CONTENT LEDGER: 8 sigils · 7 crests · 121 coins · 5 checkpoints ·
 * families: mill, breakable, rings, water, current, jumppad, tree/climb, sinker
 * + critters gnasher, bumbler x3, skitter x2, warden.
 */

/* ===========================================================================
 * 0. Palette — VERDANT BAILEY
 * ======================================================================== */

const GRASS = 0x7fb85a;      // sunlit meadow green
const LEAF = 0x4e8f3f;       // canopy
const STONE = 0xbfae92;      // warm fort limestone
const TIMBER = 0x8a6033;     // beams, planks, crates
const BANNER = 0x2f7fd0;     // the fort's colours
const GOLD = 0xffd257;       // coin / sigil / crest glow
const FLOWER = 0xe06a9c;     // meadow flowers
const WATER_C = 0x3f9ecb;    // pond + brook
const EMBER = 0xff9c3c;      // torch flame
const SAFE_EDGE = 0xffe9a8;  // leading-edge stripe

/* ===========================================================================
 * 1. THE HEIGHTFIELD — every `p` in this file is justified against it
 * ======================================================================== */

/** Fraction of a flat's radius that is EXACTLY flat. Per-flat `core` overrides. */
const FLAT_CORE = 0.55;

/** Heightfield definition. Consumed verbatim by world/terrain.js (contract §18). */
const HEIGHTS = {
  seed: 20260902,
  base: 2.0,
  hills: [
    // --- meadow swells: rolling silhouette that never exceeds 13 deg, so
    //     BEAT 1 is somewhere safe to learn what the stick does. ---
    { p: [26, 40], r: 22, h: 3.2 },    // south-east swell (the coin trail crests it)
    { p: [-22, 46], r: 20, h: 2.4 },   // south-west swell
    { p: [10, 58], r: 18, h: 1.6 },    // south lip — closes the diorama behind spawn
    { p: [54, 26], r: 20, h: 4.2 },    // east shoulder — closes it on the right
    { p: [-56, -20], r: 22, h: 3.4 },  // west shoulder
    { p: [-4, 10], r: 16, h: 2.2 },    // the hillock the coin arc jumps over
    { p: [-34, 34], r: 15, h: 4.0 },   // knuckle of rock above the cave
    { p: [-56, 10], r: 14, h: 6.0 },   // west bluff
    // --- the three landmarks ---
    { p: [0, -24], r: 40, h: 7.0 },    // FORT MOUND (flat-topped by the flat below)
    { p: [38, -6], r: 40, h: 13.0 },   // WINDMILL HILL — high ground, 26 deg face
    { p: [-40, -8], r: 22, h: -3.2 },  // POND BASIN (a negative hill is a bowl)
    // --- the north ---
    { p: [-14, -46], r: 32, h: 4.2 },  // shoulder carrying the ridge west
    { p: [-2, -54], r: 32, h: 2.6 },   // broad dome that flattens the ridge crest
  ],
  ridges: [
    // THE BROOK. A negative ridge is a channel. It ends at x = -20 (a spring
    // head in the meadow) so it never reaches the pond, which sits 1.1 m higher.
    { a: [-20, 22], b: [58, 22], w: 9.0, h: -3.8 },
    // THE NORTH RIDGE. Wide (30 m) so its faces stay near 22 deg and the walk
    // up to the Warden is a walk, not a slide.
    { a: [-48, -52], b: [46, -58], w: 30.0, h: 8.4 },
  ],
  flats: [
    { p: [0, 44], r: 11, h: 2.0 },                 // spawn meadow            (cp1)
    { p: [0, 9], r: 7, h: 4.4 },                   // north-bank terrace      (cp2)
    { p: [0, -24], r: 24, h: 9.0, core: 0.45 },    // FORT PLATEAU            (cp3)
    { p: [-8, -7], r: 9, h: 7.4, core: 0.22 },     // the Gnasher's sunken pen
    { p: [28, 8], r: 12, h: 9.6, core: 0.16 },     // mill-hill terrace       (cp5)
    { p: [-28, 28], r: 7, h: 2.2 },                // cave apron
    { p: [-2, -54], r: 11, h: 16.4, core: 0.3 },   // the Warden's ring
  ],
  noise: { amp: 0.30, freq: 0.045 },
};

/* --- the sampler (formula in the header) --------------------------------- */

/** The one smoothstep. */
function S(u) { return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u); }

/** Integer hash -> 0..1. Math.imul so the 32-bit wrap is engine-identical. */
function hash2(ix, iz, seed) {
  let n = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/** Bilinear value noise, S()-interpolated, 0..1. */
function valueNoise(x, z, seed) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = S(x - x0), fz = S(z - z0);
  const n00 = hash2(x0, z0, seed), n10 = hash2(x0 + 1, z0, seed);
  const n01 = hash2(x0, z0 + 1, seed), n11 = hash2(x0 + 1, z0 + 1, seed);
  const a = n00 + (n10 - n00) * fx;
  const b = n01 + (n11 - n01) * fx;
  return a + (b - a) * fz;
}

/** Distance from (x,z) to the SEGMENT a..b (clamped at both ends). */
function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((x - a[0]) * dx + (z - a[1]) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

/**
 * Ground height at (x, z). THE authority for every placement in this file.
 * Exported so world/terrain.js can assert its baked heightfield matches, and
 * _harness/reachcheck.mjs can walk the surface without building a mesh.
 */
export function terrainHeightAt(x, z) {
  let h = HEIGHTS.base;
  for (let i = 0; i < HEIGHTS.hills.length; i++) {
    const k = HEIGHTS.hills[i];
    const d = Math.hypot(x - k.p[0], z - k.p[1]);
    if (d < k.r) h += k.h * (1 - S(d / k.r));
  }
  for (let i = 0; i < HEIGHTS.ridges.length; i++) {
    const r = HEIGHTS.ridges[i];
    const d = segDist(x, z, r.a, r.b);
    if (d < r.w) h += r.h * (1 - S(d / r.w));
  }
  h += HEIGHTS.noise.amp * (2 * valueNoise(x * HEIGHTS.noise.freq, z * HEIGHTS.noise.freq, HEIGHTS.seed) - 1);
  for (let i = 0; i < HEIGHTS.flats.length; i++) {
    const f = HEIGHTS.flats[i];
    const d = Math.hypot(x - f.p[0], z - f.p[1]);
    if (d >= f.r) continue;
    const c = f.r * (f.core === undefined ? FLAT_CORE : f.core);
    const t = S((d - c) / (f.r - c));
    h = f.h * (1 - t) + h * t;
  }
  return h;
}

/* ===========================================================================
 * 2. Authoring helpers — every one resolves against the heightfield, so no
 *    placement in this file is a guess.
 * ======================================================================== */

const gy = terrainHeightAt;
const r2 = (v) => Math.round(v * 100) / 100;

/** A point ON the ground at (x, z), lifted `up` metres. */
function on(x, z, up) { return [r2(x), r2(gy(x, z) + (up || 0)), r2(z)]; }

/** Centre of a box of full height `sy` whose base sits on the ground, sunk `sink` m. */
function seat(x, z, sy, sink) { return [r2(x), r2(gy(x, z) - (sink || 0) + sy / 2), r2(z)]; }

/**
 * Coins along a jump ARC from a to b, peaking `h` above the chord. Expanded to
 * explicit {p} entries here rather than shipped as a new def kind, so an arc
 * can never be silently dropped by a Collectibles build that only knows the
 * contract's {p} / {ring} / {line} forms.
 */
function arcCoins(a, b, h, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    out.push({ p: [r2(a[0] + (b[0] - a[0]) * t),
                   r2(a[1] + (b[1] - a[1]) * t + h * 4 * t * (1 - t)),
                   r2(a[2] + (b[2] - a[2]) * t)] });
  }
  return out;
}

/**
 * Coins that FOLLOW THE GROUND along a polyline of [x,z] waypoints, evenly
 * spaced by arc length, floating `up` metres. A straight {line} would bury half
 * a trail in a meadow this lumpy; this cannot.
 */
function trailCoins(pts, n, up) {
  const lift = up === undefined ? 1.1 : up;
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(L); total += L;
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    let want = total * (i + 0.5) / n, k = 0;
    while (k < seg.length - 1 && want > seg[k]) { want -= seg[k]; k++; }
    const t = seg[k] > 0 ? want / seg[k] : 0;
    out.push({ p: on(pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t,
                     pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t, lift) });
  }
  return out;
}

/** A fence ring on the ground with one gap (the way in). */
function fenceRing(cx, cz, r, n, gapFrom, gapTo) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const mid = (a0 + a1) * 0.5;
    if (mid >= gapFrom && mid <= gapTo) continue;
    out.push({
      kind: 'fence',
      a: on(cx + Math.cos(a0) * r, cz + Math.sin(a0) * r, 0),
      b: on(cx + Math.cos(a1) * r, cz + Math.sin(a1) * r, 0),
      mat: 'wood', tint: TIMBER,
    });
  }
  return out;
}

/**
 * Deterministic scatter over an annulus. `make(x, z, rnd, i)` returns the def.
 * Seeded by `hash2`, so the meadow dresses itself identically every load and
 * `reset()` never moves a tree (contract hard rule 3).
 */
function scatter(cx, cz, rIn, rOut, n, seed, make) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const ang = hash2(i + 11, seed, seed) * Math.PI * 2;
    const rad = rIn + (rOut - rIn) * Math.sqrt(hash2(i + 71, seed * 3 + 5, seed));
    const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
    const d = make(x, z, hash2(i + 131, seed * 7 + 13, seed), i);
    if (d) out.push(d);
  }
  return out;
}

/* ===========================================================================
 * 3. Measured constants the beats below refer to by name
 * ======================================================================== */

const WATER_BROOK_Y = 0.30;   // brook surface. Channel floor ~ -1.80 => 2.1 m deep.
const WATER_POND_Y = 1.40;    // pond surface. Basin floor -1.00 => 2.40 m deep.

// BEAT 2 — the bridge. Deck rises 2.20 -> 3.70 over 17 m (5 deg), because the
// north bank is 2.06 m higher than the south one and a level bridge would have
// buried its north end. The hole is 3.50 m at +0.31 m: single-jump-safe there
// is ~4.30 m and the run-up is 7.50 m of straight deck.
const BR_S_Z = 31.0, BR_S_Y = 2.20;
const BR_N_Z = 14.0, BR_N_Y = 3.70;
const brDeckY = (z) => r2(BR_S_Y + (BR_N_Y - BR_S_Y) * (BR_S_Z - z) / (BR_S_Z - BR_N_Z));
const BR_GAP_S = 23.5, BR_GAP_N = 20.0;   // 3.50 m of nothing

// BEAT 4 — the fort. Plateau is EXACTLY 9.00 inside 10.8 m of (0,-24).
const FORT_Y = 9.00;          // courtyard / plateau
const WALL_TOP = 14.40;       // rampart walk  (fort box: 9.00 .. 14.40)
const TOWER_W = [-9.2, -32.8];// west tower centre — the wall-kick shaft
const TOWER_E = [9.2, -32.8]; // east tower centre — the crest
const SHAFT_TOP = 16.60;      // top of the shaft walls / the exit ledge
const CAP_TOP = 18.15;        // the crest tower's cap walk

// BEAT 8 — the mill. Hub 25.50, arms 9.50 => tips sweep 16.00 .. 35.00.
// Ground at the mill top is 14.90, so an arm deck passes 0.75 m clear of it at
// the bottom of its sweep: you hop 1.35 m onto a moving deck. At the 3 o'clock
// position the deck's outer edge sits at x = 48.60, 0.90 m short of the
// island's near edge at 49.50 — a step across, not a leap of faith.
const MILL_HUB = [38, 25.50, -6];
const MILL_LEN = 9.50;
const ISLAND_TOP = 25.20;

/* ===========================================================================
 * 4. THE COURSE
 * ======================================================================== */

export default {
  id: 'verdant-1',
  realm: 'verdant',
  theme: 'verdant',
  name: 'BAILEY MEADOW',
  subtitle: 'Open hills and a fort with a hole in it',
  order: 1,
  difficulty: 1,
  music: 'verdant',

  /* Par times per crest id (ms) — the HUD shows them, nothing gates on them. */
  par: {
    open: 75000, sigils: 210000, coins: 260000,
    secret: 110000, boss: 130000, race: 55000, wing: 120000,
  },

  /* Spawn on the meadow flat (EXACTLY 2.00), yaw 0 => facing -Z, which points
     straight down the mown path at the bridge with the fort on the skyline
     behind it and the windmill turning on the right. The whole course is
     legible from here; that is the job of the first two seconds. */
  spawn: { p: [0, 2.0, 44], yaw: 0 },
  killY: -30,
  bounds: { min: [-70, -8, -70], max: [70, 42, 70] },

  intro: {
    text: 'BAILEY MEADOW',
    cam: [
      { p: [0, 26, 62], look: [0, 8, -20], t: 0 },
      { p: [22, 20, 26], look: [0, 11, -24], t: 2.6 },
      { p: [4, 6, 52], look: [0, 3, 30], t: 5.4 },
    ],
  },

  ambience: { wind: 0.30, birds: 0.55, water: 0.35 },

  /* ------------------------------------------------------------------------
   * TERRAIN + WATER
   * --------------------------------------------------------------------- */

  terrain: {
    kind: 'terrain',
    origin: [-70, -70],
    size: [140, 140],
    res: 1.0,
    surface: 'grass',
    heights: HEIGHTS,
    grass: { density: 1.0, height: 0.42, color: GRASS },
    // Mown paths: darker, shorter grass and no blades, so the eye is led even
    // though the course is open. These are the routes the coins follow.
    paths: [
      { pts: [[0, 46], [0, 31]], w: 3.6 },                              // spawn -> bridge
      { pts: [[0, 14], [0, 9], [-1, -2], [0, -14]], w: 3.4 },           // bridge -> fort gate
      { pts: [[-2, 6], [-14, -2], [-26, -6]], w: 2.8 },                 // fort -> pond
      { pts: [[-27, 0], [-28, 14], [-28, 26]], w: 2.4 },                // pond -> cave apron
      { pts: [[4, 6], [16, 10], [28, 8], [36, -4]], w: 3.0 },           // -> mill hill
      { pts: [[-9, -33], [-15, -42], [-12, -50], [-3, -54]], w: 2.6 },  // fort -> the ring
    ],
  },

  waters: [
    {
      // THE BROOK. Surface 0.30. Box edges are all buried: ground at x=-26 is
      // 1.03, at x=58 is 2.33, at z=13 is 4.40 and at z=31 is 2.06 — every one
      // above the surface, so the plane is hidden by the bank, not clipped by it.
      kind: 'water', kind2: 'lake',
      p: [16, WATER_BROOK_Y - 1.2, 22], s: [84, 2.4, 18],
      flow: [1.0, 0], tint: WATER_C,
    },
    {
      // THE POND. Surface 1.40, floor -1.00 at the centre => 2.40 m deep, which
      // is a real dive and a real surfacing. Edge samples: -61,-8 => 3.00;
      // -19,-8 => 4.44; -40,13 => 1.87; -40,-29 => 3.16; corners 2.03 .. 8.35.
      kind: 'water', kind2: 'lake',
      p: [-40, WATER_POND_Y - 1.9, -8], s: [42, 3.8, 42],
      tint: WATER_C,
    },
  ],

  /* ------------------------------------------------------------------------
   * CHECKPOINTS — 5. Four sit on flats (EXACT heights, no slope under the
   * respawn); the fifth is the rampart walk, which is authored geometry and
   * therefore flat by construction. None is more than ~35 s of replay from the
   * next difficulty spike, and every one sits BEFORE its spike, never after.
   * --------------------------------------------------------------------- */
  checkpoints: [
    { id: 'cp-meadow', p: [0, 2.0, 40], yaw: 0 },        // flat 2.00 — before the bridge
    { id: 'cp-brook', p: [0, 4.4, 9], yaw: 0 },          // flat 4.40 — after the hole, before the climb
    { id: 'cp-gate', p: [0, 9.0, -14], yaw: 0 },         // flat 9.00 — inside the fort gateway
    { id: 'cp-rampart', p: [10.0, WALL_TOP, -26.0], yaw: Math.PI }, // the east rampart walk
    { id: 'cp-mill', p: [28, 9.6, 8], yaw: -0.9 },       // flat 9.60 — foot of the windmill hill
  ],

  /* ------------------------------------------------------------------------
   * CRESTS — 7, one of each type in the contract.
   * --------------------------------------------------------------------- */
  crests: [
    {
      id: 'open', type: 'open', name: 'CREST ON THE RAMPARTS',
      hint: 'The high tower. Stairs, crates or the shaft — pick one.',
      p: [TOWER_E[0], CAP_TOP + 1.15, TOWER_E[1]],
    },
    {
      id: 'sigils', type: 'sigils', name: 'EIGHT SIGILS OF THE MEADOW',
      hint: 'Meadow, brook, crates, rampart, pond, cave, treetop, island.',
      spawnAt: [0, FORT_Y + 1.45, -24],          // on the courtyard pedestal
    },
    {
      id: 'coins', type: 'coins', name: 'A HUNDRED COINS', threshold: 100,
      hint: '121 are lying about. You can miss twenty-one.',
      spawnAt: [-5, 3.45, 41],                   // on the meadow pedestal, flat 2.00
    },
    {
      id: 'secret', type: 'secret', name: 'WHAT THE GNASHER GUARDS',
      trigger: 'gnasher-freed',
      hint: 'Pound the post. Three times. Mind the chain.',
      spawnAt: [-12, 7.95, -6],                  // inside the cage, ground 6.97
    },
    {
      id: 'boss', type: 'boss', name: 'THE WARDEN OF THE RIDGE',
      hint: 'Jump the shockwave, dodge the charge, pound its back.',
      spawnAt: [-2, 16.4 + 1.6, -54],            // the ring centre, flat 16.40
    },
    {
      id: 'race', type: 'race', name: 'MEADOW DASH',
      hint: 'Fort gate, round the pond, up the mill. 55 seconds.',
      start: [0, FORT_Y, -15.5], finish: [38, 14.7, -3.0], limitMs: 55000,
      spawnAt: [38, 16.1, -3.0],
    },
    {
      id: 'wing', type: 'power', name: 'THE LONG WAY ROUND', power: 'wing',
      hint: 'Take the hat, thread all eight rings before it wears off.',
      p: [4.2, 31.8, -22.0],
    },
  ],

  /* ------------------------------------------------------------------------
   * SIGILS — 8, one per beat, so collecting them is a tour of the course.
   * Each is verified against the surface it belongs to.
   * --------------------------------------------------------------------- */
  sigils: [
    { p: on(-11, 34, 2.55), note: '1 — meadow, on the rock outcrop (2.19 + 1.5 rock + 1.05)' },
    { p: [-3.0, 1.90, 22.0], note: '2 — brook, on the stepping stone under the bridge (top 0.85)' },
    { p: [-5.5, 13.50, -17.2], note: '3 — fort courtyard, above the crate stack (top 12.60)' },
    { p: [-10.0, WALL_TOP + 1.20, -34.2], note: '4 — the north-west merlon on the rampart' },
    { p: [-40.0, -0.45, -9.0], note: '5 — the bottom of the pond (floor -1.00, 1.85 m under)' },
    { p: [-28.0, 3.55, 25.4], note: '6 — the cave chamber (floor 2.20)' },
    { p: [14.0, 12.90, 32.0], note: '7 — the crown of the old oak (nest top 11.98)' },
    { p: [55.5, ISLAND_TOP + 1.40, -6.0], note: '8 — the floating island off the mill' },
  ],

  /* ------------------------------------------------------------------------
   * COINS — 121 placed, 100 needed. Every group rewards a line the player
   * chose; the trail out of spawn is the only one you cannot miss, because the
   * first thirty seconds of a game teach with breadcrumbs, not with signs.
   * --------------------------------------------------------------------- */
  coins: [
    // BEAT 1 — the mown path out of spawn, over the swell, to the bridge. (10)
    ...trailCoins([[0, 45], [-2, 40], [1, 36], [0, 32]], 10, 1.1),
    // BEAT 1 — an ARC over the meadow rock: the first thing that asks for a jump. (6)
    ...arcCoins(on(-14, 34, 1.0), on(-8, 34, 1.0), 1.6, 6),
    // BEAT 2 — the arc across the hole in the bridge. Peak 1.4 m, which is
    // exactly where a held single jump puts you. (5)
    ...arcCoins([0, brDeckY(BR_GAP_S) + 1.0, BR_GAP_S], [0, brDeckY(BR_GAP_N) + 1.0, BR_GAP_N], 1.4, 5),
    // BEAT 2 — four on the brook stones, for anyone who fell in. (4)
    { p: [-3.0, 1.35, 22.0] }, { p: [3.4, 1.35, 20.5] },
    { p: [-6.4, 0.95, 24.6] }, { p: [6.6, 0.95, 18.4] },
    // BEAT 3 — the diagonal climb to the gate, hugging the mown path. (8)
    ...trailCoins([[0, 8], [-2, 0], [-1, -7], [0, -13]], 8, 1.1),
    // BEAT 3 — a spiral up the old oak, so climbing is worth it twice. (6)
    { p: [15.6, 4.6, 32.0] }, { p: [14.0, 5.8, 33.6] }, { p: [12.4, 7.0, 32.0] },
    { p: [14.0, 8.2, 30.4] }, { p: [15.6, 9.4, 32.0] }, { p: [14.0, 10.6, 33.4] },
    // BEAT 4 — up the earth ramp on the outside of the east wall. (6)
    ...trailCoins([[19.0, -24], [16.0, -24], [13.0, -24]], 6, 2.2),
    // BEAT 4 — a ring around the courtyard pedestal. (8)
    { ring: { c: [0, -24], r: 4.2, n: 8, y: FORT_Y + 1.1 } },
    // BEAT 4 — the rampart walk, north side, between the two towers. (8)
    { line: { a: [-6.0, WALL_TOP + 1.05, -34.0], b: [6.0, WALL_TOP + 1.05, -34.0], n: 8 } },
    // BEAT 5 — five inside the Gnasher's reach. The whole point is that you
    // can see them from safety and have to decide. (5)
    { p: [-8.0, 8.5, -3.4] }, { p: [-10.4, 8.4, -5.0] }, { p: [-5.6, 8.4, -5.2] },
    { p: [-9.2, 8.5, -9.4] }, { p: [-6.2, 8.5, -10.0] },
    // BEAT 6 — down the pond beach, then the lily pads. (6)
    ...trailCoins([[-22, -4], [-26, -7], [-28.4, -8]], 6, 1.1),
    ...arcCoins([-30.4, 2.9, -8], [-38.1, 2.9, -8], 1.1, 6),
    // BEAT 6 — the ring on the pond floor around sigil 5. Underwater coins are
    // the reason anyone learns to swim down instead of paddling. (10)
    { ring: { c: [-40, -9], r: 4.0, n: 10, y: 0.10 } },
    // BEAT 7 — the cave chamber. (6)
    { ring: { c: [-28, 27], r: 2.6, n: 6, y: 3.30 } },
    // BEAT 8 — the mill terrace path, the last easy money before the ride. (8)
    ...trailCoins([[16, 10], [22, 10], [28, 8], [33, 3]], 8, 1.1),
    // BEAT 8 — an arc off the arm onto the island. (6)
    ...arcCoins([48.6, 26.4, -6], [53.0, 26.4, -6], 1.2, 6),
    // BEAT 9 — the jump-pad crag. (5)
    { ring: { c: [13, -51], r: 1.4, n: 5, y: 19.55 } },
    // BEAT 9 — the ridge path to the Warden's ring. (8)
    ...trailCoins([[-9, -33], [-15, -42], [-12, -50], [-4, -53]], 8, 1.2),
  ],

  /* ------------------------------------------------------------------------
   * POWERS — two wing hats. One is the reward for the mill ride; the other is
   * in the courtyard, because a ring run that begins 58 m from the first ring
   * is not a ring run, it is a commute.
   * --------------------------------------------------------------------- */
  powers: [
    { kind: 'wing', p: [52.0, ISLAND_TOP + 0.9, -6.0], duration: 30 },
    { kind: 'wing', p: [3.0, FORT_Y + 1.0, -21.0], duration: 30 },
  ],

  /* ------------------------------------------------------------------------
   * OBJECTS — the built world, beat by beat.
   * --------------------------------------------------------------------- */
  objects: [

    /* ========================================================================
     * BEAT 1 — THE MEADOW
     * Twenty seconds of nothing trying to hurt you. The ground rolls but never
     * past 13 deg, the path is mown, the coins go where the path goes, and the
     * only vertical thing in reach is a rock you can hop onto. Spawn faces -Z:
     * bridge, fort and windmill are all on screen before the first input.
     * ===================================================================== */

    { kind: 'deco', kindOf: 'sign', p: on(3.0, 41, 1.15), s: [0.14, 1.7, 1.2], mat: 'wood', tint: TIMBER },
    { kind: 'deco', kindOf: 'post', p: on(3.0, 41, 0.65), s: [0.16, 1.3, 0.16], mat: 'wood', tint: 0x6b4a28 },
    { kind: 'text', p: [3.0, 3.95, 41], rot: [0, 0, 0], text: 'BAILEY MEADOW', size: 0.60, color: 0x2d3d1f },
    { kind: 'text', p: [3.0, 3.42, 41], rot: [0, 0, 0], text: 'EASE THE STICK TO WALK  ·  ALL THE WAY TO RUN', size: 0.22, color: 0x4d6038 },
    { kind: 'text', p: [3.0, 3.05, 41], rot: [0, 0, 0], text: 'JUMP  ·  LAND AND JUMP AGAIN TO CHAIN A HIGHER ONE', size: 0.22, color: 0x4d6038 },

    // The rock the first jump is for. Top 3.69; sigil 1 floats 1.05 above it,
    // so a walk-up-and-hop collects it and nothing else is required.
    { kind: 'platform', p: seat(-11, 34, 1.5), s: [2.7, 1.5, 2.5], mat: 'moss', tint: 0x6f8452, stripe: true, edge: SAFE_EDGE },
    { kind: 'rock', p: on(-12.9, 33.0, -0.25), r: 1.1, seed: 3121, mat: 'stone' },
    { kind: 'rock', p: on(-9.4, 35.4, -0.3), r: 0.9, seed: 3122, mat: 'stone' },

    // The pedestal the HUNDRED COINS crest lands on when you finally hit 100.
    { kind: 'pedestal', p: on(-5, 41, 0), mat: 'stone', tint: STONE, glow: GOLD },

    /* ========================================================================
     * BEAT 2 — THE BROOK AND THE BRIDGE WITH A HOLE IN IT
     * The one required jump in the course, and it is measured: 3.50 m across a
     * +0.31 m rise, with 7.50 m of straight deck behind it. Miss it and you
     * fall 2.6 m into water that carries you EAST at 3.2 m/s until the channel
     * shallows at x ~ 23 and you walk out — a lesson, not a death. The deck
     * rises 2.20 -> 3.70 because the north bank is 2.06 m higher than the
     * south; a level bridge would have buried its far end in the hill.
     * ===================================================================== */

    { kind: 'bridge', a: [0, BR_S_Y, BR_S_Z], b: [0, brDeckY(BR_GAP_S), BR_GAP_S], w: 3.2, sag: 0.22, mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'bridge', a: [0, brDeckY(BR_GAP_N), BR_GAP_N], b: [0, BR_N_Y, BR_N_Z], w: 3.2, sag: 0.18, mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },

    // Two planks hanging off the broken ends, so the hole reads as damage and
    // not as a missing asset.
    { kind: 'deco', kindOf: 'panel', p: [0.95, brDeckY(BR_GAP_S) - 0.35, BR_GAP_S - 0.6], s: [0.2, 0.09, 1.7], rot: [0.42, 0, -0.18], mat: 'wood', tint: TIMBER },
    { kind: 'deco', kindOf: 'panel', p: [-1.05, brDeckY(BR_GAP_N) - 0.28, BR_GAP_N + 0.5], s: [0.2, 0.09, 1.4], rot: [-0.34, 0, 0.16], mat: 'wood', tint: TIMBER },

    // Stone piers standing in the channel. Height solved from the deck line
    // down to the actual streambed, not eyeballed.
    { kind: 'deco', kindOf: 'pillar', p: [0, r2((gy(0, 26) + brDeckY(26)) / 2), 26], s: [1.3, r2(brDeckY(26) - gy(0, 26)), 1.3], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'pillar', p: [0, r2((gy(0, 18) + brDeckY(18)) / 2), 18], s: [1.3, r2(brDeckY(18) - gy(0, 18)), 1.3], mat: 'stone', tint: STONE },

    // Stepping stones. Sigil 2 sits on the first one, 1.05 m up — visible from
    // the bridge, so falling in stops being a punishment and becomes a route.
    { kind: 'platform', p: [-3.0, 0.15, 22.0], s: [2.2, 1.4, 2.2], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [3.4, 0.05, 20.5], s: [2.0, 1.3, 2.0], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-6.4, -0.05, 24.6], s: [1.8, 1.2, 1.8], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [6.6, -0.10, 18.4], s: [1.8, 1.2, 1.8], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },

    // The current. Gentle (3.2 m/s against a 4.5 m/s swim), pushing downstream
    // toward the shallow exit — it teaches "water moves" without drowning you.
    { kind: 'current', p: [16, WATER_BROOK_Y - 1.0, 22], s: [80, 2.0, 7.0], dir: [1, 0, 0], power: 3.2 },

    { kind: 'text', p: [3.4, brDeckY(27) + 1.5, 27], rot: [0, 0, 0], text: 'IT IS ONLY WATER', size: 0.22, color: 0x4d6038 },

    /* ========================================================================
     * BEAT 3 — THE CLIMB, AND THE TREE
     * A long open diagonal up to the fort gate (27 deg, never more) with coins
     * on the mown line. Off to the right, the old oak: the course's climbing
     * lesson and sigil 7 at the top of it. Nothing about the tree is required.
     * ===================================================================== */

    { kind: 'tree', p: on(14, 32, 0), h: 10.0, r: 3.4, climbable: true, mat: 'bark', tint: 0x6b4a2a, leafTint: LEAF, seed: 771 },
    // The crow's nest at the crown: top 11.88, sigil 7 floats 1.02 above it.
    { kind: 'platform', p: [14, r2(gy(14, 32) + 8.72), 32], s: [2.4, 0.4, 2.4], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [16.6, r2(gy(16.6, 33.6) + 1.7), 33.6], rot: [0, -0.55, 0], text: 'PRESS INTO THE TRUNK TO CLIMB', size: 0.22, color: 0x4d6038 },
    { kind: 'text', p: [2.8, r2(gy(2.8, 6) + 1.2), 6], rot: [0, 0, 0], text: 'CROUCH + JUMP AT SPEED  ·  LONG JUMP', size: 0.24, color: 0x4d6038 },

    /* ========================================================================
     * BEAT 4 — THE FORT
     * The set piece and the shape of the whole course. Plateau EXACTLY 9.00 for
     * 10.8 m around (0,-24). Outer wall 9.00 -> 14.40 (the rampart walk), two
     * towers, a gate facing the meadow. THREE independent ways onto the walk:
     *
     *   A  THE STAIRS   inside the west wall, 18 x 0.30 m. Always works.
     *   B  THE SHAFT    the west tower is hollow, 3.30 m clear and 7.60 m tall
     *                   — one jump plus four wall kicks (2.12 m each) and you
     *                   come out on the ledge at 16.60, above everyone.
     *   C  THE RAMP     a fallen earth-and-timber ramp against the OUTSIDE of
     *                   the east wall, 30.7 deg, for anyone who never went in.
     *
     * Then the crest: rampart 14.40 -> merlon 15.70 -> merlon 17.00 -> cap
     * 18.15, three 1.30/1.15 m hops, every one inside a single jump's 1.91 m
     * apex, every one striped.
     *
     * NOTE FOR world/builders.js: the plateau rim under the corners samples
     * 8.07 (SW) to 10.12 (NW), so the fort's footings must sink at least 1.5 m
     * below p.y - s.y/2 or the south-west corner will float 0.9 m.
     * ===================================================================== */

    {
      kind: 'building', style: 'fort', p: [0, FORT_Y + 2.7, -24], s: [22, 5.4, 22],
      mat: 'stone', tint: STONE, wallThick: 2.0, footing: 2.0, rampart: true, merlons: true,
      doors: [{ side: 'south', w: 4.6, h: 5.0 }, { side: 'north', w: 3.0, h: 4.0 }],
    },

    // --- the crest tower (east). Solid, 9.00 -> 17.55, corbelled cap at 18.15.
    { kind: 'building', style: 'tower', p: [TOWER_E[0], r2(FORT_Y + 8.55 / 2), TOWER_E[1]], s: [6.4, 8.55, 6.4], mat: 'stone', tint: STONE, footing: 2.0, merlons: true },
    { kind: 'platform', p: [TOWER_E[0], r2(CAP_TOP - 0.3), TOWER_E[1]], s: [7.0, 0.6, 7.0], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },

    // --- the merlon staircase up the tower's south face (14.40 -> 18.15)
    { kind: 'platform', p: [10.0, 15.05, -27.0], s: [1.6, 1.3, 1.6], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [10.0, 16.35, -28.6], s: [1.4, 1.3, 1.4], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },

    // --- ROUTE B: the hollow west tower. Four slabs, 0.4 m thick, leaving a
    //     3.30 x 3.30 m shaft (limit is 3.4) that runs 9.00 -> 16.60. The east
    //     face has a 1.30 x 2.40 m doorway under a lintel, so you can only get
    //     in at the bottom and can only get out at the top.
    { kind: 'platform', p: [TOWER_W[0], 12.8, -34.65], s: [4.1, 7.6, 0.4], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [TOWER_W[0], 12.8, -30.95], s: [4.1, 7.6, 0.4], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [-11.05, 12.8, TOWER_W[1]], s: [0.4, 7.6, 3.3], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [-7.35, 12.8, -34.05], s: [0.4, 7.6, 1.2], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [-7.35, 12.8, -31.55], s: [0.4, 7.6, 1.2], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [-7.35, 14.0, TOWER_W[1]], s: [0.4, 5.2, 1.3], mat: 'stone', tint: STONE },
    // The exit ledge over the courtyard — the reward for four clean kicks.
    { kind: 'platform', p: [TOWER_W[0], r2(SHAFT_TOP - 0.15), -29.3], s: [5.4, 0.3, 2.6], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [-7.0, 10.4, -30.4], rot: [0, -1.35, 0], text: 'KICK ONE WALL, THEN THE OTHER', size: 0.20, color: 0xd8c79a },

    // --- ROUTE A: the grand stair, 18 risers of 0.30 m up the inside of the
    //     west wall, and a landing that bridges its top onto the walk.
    { kind: 'stairs', p: [-7.6, FORT_Y, -16.4], w: 2.6, rise: 0.30, run: 0.36, n: 18, yaw: 0, mat: 'stone', tint: STONE },
    { kind: 'platform', p: [-8.9, r2(WALL_TOP - 0.15), -23.8], s: [3.4, 0.3, 2.2], mat: 'stone', tint: STONE },

    // --- ROUTE C: the fallen ramp outside the east wall. Foot 9.29, top 14.40
    //     over 8.4 m of run = 30.7 deg. Local +X is the ramp's length; a
    //     negative Z-rotation drops the +X (downhill) end.
    {
      kind: 'ramp',
      p: [15.4, r2((gy(19.6, -24) + WALL_TOP) / 2), -24],
      s: [r2(Math.hypot(8.4, WALL_TOP - gy(19.6, -24))), 0.5, 3.8],
      rot: [0, 0, r2(-Math.atan2(WALL_TOP - gy(19.6, -24), 8.4))],
      mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE,
    },
    { kind: 'deco', kindOf: 'buttress', p: [17.4, r2(gy(17.4, -21.6) + 1.1), -21.6], s: [5.0, 2.2, 0.5], mat: 'stone', tint: STONE },

    // --- the courtyard: crates to climb (sigil 3 on top), barrels to smash.
    { kind: 'platform', p: [-6.0, 9.60, -17.0], s: [1.3, 1.2, 1.3], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-5.6, 10.80, -17.3], s: [1.3, 1.2, 1.3], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-5.5, 12.05, -17.2], s: [1.5, 1.1, 1.5], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'breakable', p: [-3.6, 9.55, -17.6], s: [1.0, 1.1, 1.0], mat: 'wood', shape: 'barrel', drop: 'coins' },
    { kind: 'breakable', p: [-3.4, 9.55, -19.0], s: [1.0, 1.1, 1.0], mat: 'wood', shape: 'barrel', drop: 'coins' },
    { kind: 'breakable', p: [6.4, 9.60, -18.4], s: [1.2, 1.2, 1.2], mat: 'wood', shape: 'crate', drop: 'coins' },

    // --- the pedestal the EIGHT SIGILS crest rises from.
    { kind: 'pedestal', p: [0, FORT_Y, -24], mat: 'stone', tint: STONE, glow: GOLD },

    // --- light and colour. A courtyard this deep needs its own key or the
    //     sun just makes a bright box with a black hole in it.
    { kind: 'deco', kindOf: 'brazier', p: [-4.2, FORT_Y + 1.1, -14.4], s: [0.7, 1.6, 0.7], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'brazier', p: [4.2, FORT_Y + 1.1, -14.4], s: [0.7, 1.6, 0.7], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'brazier', p: [-6.6, FORT_Y + 1.1, -30.0], s: [0.7, 1.6, 0.7], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'brazier', p: [6.6, FORT_Y + 1.1, -30.0], s: [0.7, 1.6, 0.7], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'brazier', p: [10.0, WALL_TOP + 1.0, -20.0], s: [0.6, 1.4, 0.6], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'brazier', p: [-10.0, WALL_TOP + 1.0, -20.0], s: [0.6, 1.4, 0.6], mat: 'metal', tint: EMBER },
    { kind: 'light', p: [0, FORT_Y + 3.6, -22.0], color: 0xffd9a0, intensity: 11, distance: 26 },
    { kind: 'light', p: [0, FORT_Y + 2.6, -13.2], color: EMBER, intensity: 7, distance: 15 },
    { kind: 'light', p: [TOWER_W[0], 11.0, TOWER_W[1]], color: 0xbcd8f5, intensity: 5, distance: 10 },
    { kind: 'light', p: [TOWER_E[0], CAP_TOP + 1.4, TOWER_E[1]], color: GOLD, intensity: 9, distance: 18 },
    { kind: 'deco', kindOf: 'banner', p: [-2.9, FORT_Y + 3.4, -12.9], s: [0.08, 2.8, 1.4], mat: 'cloth', tint: BANNER },
    { kind: 'deco', kindOf: 'banner', p: [2.9, FORT_Y + 3.4, -12.9], s: [0.08, 2.8, 1.4], mat: 'cloth', tint: BANNER },
    { kind: 'deco', kindOf: 'flagpole', p: [TOWER_E[0], CAP_TOP + 1.9, TOWER_E[1] - 2.4], s: [0.12, 3.8, 0.12], mat: 'wood', tint: TIMBER },
    { kind: 'text', p: [0, FORT_Y + 5.6, -12.7], rot: [0, 0, 0], text: 'BAILEY FORT', size: 0.44, color: 0xe9dcbd },

    /* ========================================================================
     * BEAT 5 — THE GNASHER
     * A sunken pen beside the gate (flat, EXACTLY 7.40) with a chained jaw in
     * it. Chain 6.00 m, so its reach is a disc you can pace out from the fence
     * line. The post is at the disc's centre and the cage is 5.90 m from the
     * post — INSIDE the reach. Five coins are scattered across the danger zone
     * at eye level so you can price the risk before you take it. Telegraph is
     * 0.5 s of crouch before every lunge (critters.js), which is the whole fight.
     * ===================================================================== */

    ...fenceRing(-8, -7, 8.6, 12, 0.9, 2.3),
    { kind: 'text', p: [-8.0, r2(gy(-8, 1.6) + 1.6), 1.6], rot: [0, 0, 0], text: 'POUND THE POST  ·  THREE TIMES', size: 0.26, color: 0x7a2f2f },
    { kind: 'text', p: [-8.0, r2(gy(-8, 1.6) + 1.2), 1.6], rot: [0, 0, 0], text: 'it can only reach so far', size: 0.20, color: 0x4d6038 },

    // The cage. The secret crest spawns inside it the moment the post gives
    // way; then you pound the cage too.
    { kind: 'breakable', p: [-12, r2(gy(-12, -6) + 1.1), -6], s: [2.2, 2.2, 2.2], mat: 'wood', shape: 'cage', tint: 0x5a4128, drop: 'crest', openOn: 'gnasher-freed' },
    { kind: 'deco', kindOf: 'lantern', p: [-12, r2(gy(-12, -6) + 2.9), -6], s: [0.5, 0.7, 0.5], mat: 'metal', tint: GOLD },
    { kind: 'light', p: [-12, r2(gy(-12, -6) + 2.6), -6], color: GOLD, intensity: 6, distance: 12 },
    { kind: 'deco', kindOf: 'stump', p: on(-4.4, -9.6, 0.3), s: [1.0, 0.7, 1.0], mat: 'wood', tint: 0x6b4a28 },

    /* ========================================================================
     * BEAT 6 — THE POND
     * The swim tutorial, and it teaches by taking the floor away. Two lily pads
     * sink under your weight (2.10 m from the shore to the first, 1.30 m
     * between them, 2.20 m onto the islet) so the only way to dawdle is to get
     * wet. Surface 1.40, floor -1.00: sigil 5 is 2.40 m down with a ring of ten
     * coins around it, which is exactly deep enough that you have to hold the
     * dive and come back up for air on purpose.
     * ===================================================================== */

    { kind: 'sinker', p: [-32.0, 1.50, -8.0], s: [3.2, 0.4, 3.2], delay: 1.4, speed: 0.85, mat: 'moss', tint: 0x6aa04e, stripe: true, edge: SAFE_EDGE },
    { kind: 'sinker', p: [-36.5, 1.50, -8.0], s: [3.2, 0.4, 3.2], delay: 2.0, speed: 0.85, mat: 'moss', tint: 0x6aa04e, stripe: true, edge: SAFE_EDGE },
    // The islet you dive from. Top 1.60, clear of sigil 5 at z = -9.
    { kind: 'platform', p: [-41.0, 1.30, -6.0], s: [4.2, 0.6, 4.2], mat: 'moss', tint: 0x6f8452, stripe: true, edge: SAFE_EDGE },
    { kind: 'rock', p: [-42.6, 0.9, -4.6], r: 1.3, seed: 6101, mat: 'stone' },
    { kind: 'rock', p: [-39.4, 0.8, -4.2], r: 1.0, seed: 6102, mat: 'stone' },
    { kind: 'deco', kindOf: 'plant', p: [-41.6, 2.1, -7.2], s: [1.2, 1.1, 1.2], mat: 'leaves', tint: LEAF },
    { kind: 'text', p: [-26.0, r2(gy(-26, -3) + 1.3), -3], rot: [0, 0.6, 0], text: 'JUMP TO STROKE  ·  CROUCH TO SINK', size: 0.22, color: 0x35607a },
    { kind: 'light', p: [-40, 3.4, -9], color: 0x8fd8ff, intensity: 5, distance: 16 },
    // Reeds around the shoreline (ground samples 1.65 .. 2.6, i.e. the water
    // line) so the pond has an edge instead of a seam.
    ...scatter(-40, -8, 15.0, 17.5, 16, 6110, (x, z, rnd) => (
      gy(x, z) < 1.15 || gy(x, z) > 2.6 ? null
        : { kind: 'deco', kindOf: 'plant', p: on(x, z, 0.35 + rnd * 0.3), s: [0.7, 0.9 + rnd * 0.8, 0.7], mat: 'leaves', tint: 0x5f8f45 }
    )),

    /* ========================================================================
     * BEAT 7 — THE CAVE
     * A rock-cut chamber on the apron north-west of the pond, its mouth filled
     * by a mossy wall and screened by boulders. Nothing points at it; the only
     * clue is that the boulder pile is too regular. Pound the wall, walk in,
     * take sigil 6 and six coins. (Built ABOVE the heightfield, not inside it:
     * a heightfield has no overhangs, so a "cave" that is really a hole in the
     * terrain would push the player straight back out of it.)
     * ===================================================================== */

    { kind: 'platform', p: [-28.0, 4.00, 24.2], s: [9.0, 3.6, 0.6], mat: 'stone', tint: 0x9a9384 },
    { kind: 'platform', p: [-32.2, 4.00, 27.5], s: [0.6, 3.6, 7.2], mat: 'stone', tint: 0x9a9384 },
    { kind: 'platform', p: [-23.8, 4.00, 27.5], s: [0.6, 3.6, 7.2], mat: 'stone', tint: 0x9a9384 },
    { kind: 'platform', p: [-28.0, 5.95, 27.5], s: [9.0, 0.7, 7.8], mat: 'stone', tint: 0x9a9384 },
    { kind: 'platform', p: [-30.7, 4.00, 30.8], s: [2.4, 3.6, 0.6], mat: 'stone', tint: 0x9a9384 },
    { kind: 'platform', p: [-25.3, 4.00, 30.8], s: [2.4, 3.6, 0.6], mat: 'stone', tint: 0x9a9384 },
    // The wall you pound. Fills the 3.0 x 2.8 m doorway exactly.
    { kind: 'breakable', p: [-28.0, 3.60, 30.8], s: [3.0, 2.8, 0.6], mat: 'moss', tint: 0x5c7a44, drop: 'coins' },
    { kind: 'deco', kindOf: 'brazier', p: [-28.0, 3.3, 25.0], s: [0.6, 1.4, 0.6], mat: 'metal', tint: EMBER },
    { kind: 'light', p: [-28.0, 4.2, 26.6], color: EMBER, intensity: 8, distance: 12 },
    // The boulders that hide the mouth.
    { kind: 'rock', p: on(-31.6, 32.2, -0.4), r: 2.1, seed: 7201, mat: 'stone' },
    { kind: 'rock', p: on(-24.6, 32.6, -0.4), r: 2.3, seed: 7202, mat: 'stone' },
    { kind: 'rock', p: on(-28.4, 33.4, -0.5), r: 1.8, seed: 7203, mat: 'stone' },
    { kind: 'rock', p: on(-33.4, 29.0, -0.6), r: 2.0, seed: 7204, mat: 'stone' },
    { kind: 'rock', p: on(-22.8, 28.4, -0.6), r: 1.7, seed: 7205, mat: 'stone' },
    ...scatter(-28, 30, 3.0, 7.0, 7, 7210, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'mushroom', p: on(x, z, 0.16), s: [0.4 + rnd * 0.35, 0.5 + rnd * 0.4, 0.4 + rnd * 0.35], mat: 'plaster', tint: 0xd9c8a6 }
    )),

    /* ========================================================================
     * BEAT 8 — THE WINDMILL  (the set piece)
     * The mill stands on the only 15 m hill in the course. Hub 25.50, four arms
     * 9.50 m long, one turn every 11 s. At the BOTTOM of the sweep an arm's
     * deck passes 1.35 m above the hilltop — a single jump onto a moving
     * platform, which is the only genuinely new verb in the course. Ride a
     * quarter turn (2.75 s) to the 3 o'clock position, where the deck's outer
     * edge stops 0.90 m short of the island and 0.55 m above it: a step, not a
     * leap. Sigil 8 and a wing hat are waiting on the island.
     * ===================================================================== */

    // THE MILLER'S HOUSE. It used to stand ON the axle at [38, -6] with its floor
    // 5.30 m in the AIR (`p` is a building's FLOOR, not its centre — builders.js
    // lays the interior slab at local y −0.11 and raises the shell from 0 to H),
    // where the sails swept straight through it and it covered the very patch of
    // hilltop this beat needs left open. It is now a cottage on the flat ground
    // north-east of the mill: clear of the sail disc (z >= −3.70 against the
    // disc's −4.77) and outside the tower drum, with a pitched roof so it can
    // never be mistaken for a platform.
    { kind: 'building', style: 'cottage', p: [43.4, r2(gy(43.4, -1.4) - 0.25), -1.4], s: [4.6, 3.6, 4.6], mat: 'plaster', tint: 0xe6dcc2, footing: 2.5 },
    // `dir: -1` so the arms turn the way this beat is written: an arm boarded at
    // the bottom of the sweep reaches 3 o'clock in a QUARTER turn (2.75 s), not
    // three quarters the long way over the top.
    { kind: 'mill', p: MILL_HUB, arms: 4, len: MILL_LEN, period: 11.0, yaw: 0, dir: -1, deck: { w: 2.2, d: 1.6, t: 0.5 }, mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [38, r2(gy(38, -1.6) + 1.4), -1.6], rot: [0, 0, 0], text: 'RIDE AN ARM  ·  STEP OFF AT THE TOP OF THE SWING', size: 0.24, color: 0x6b5a3a },

    // THE FLOATING ISLAND. Top 25.20, near edge x = 49.50 — the arm sweep
    // stops at x = 48.60, so nothing ever collides with it.
    { kind: 'platform', p: [55.5, r2(ISLAND_TOP - 0.7), -6], s: [12, 1.4, 12], mat: 'moss', tint: 0x6f8452, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'arch', p: [57.5, ISLAND_TOP + 2.1, -6], s: [0.9, 0.8, 5.6], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'pillar', p: [57.5, ISLAND_TOP + 1.0, -8.6], s: [0.9, 2.2, 0.9], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'pillar', p: [57.5, ISLAND_TOP + 1.0, -3.4], s: [0.9, 2.2, 0.9], mat: 'stone', tint: STONE },
    { kind: 'tree', p: [59.4, ISLAND_TOP, -8.8], h: 4.2, r: 1.7, climbable: false, mat: 'bark', tint: 0x6b4a2a, leafTint: LEAF, seed: 811 },
    { kind: 'deco', kindOf: 'flowerbed', p: [53.0, ISLAND_TOP + 0.1, -9.2], s: [3.0, 0.25, 2.2], mat: 'leaves', tint: FLOWER },
    { kind: 'light', p: [55.5, ISLAND_TOP + 3.0, -6], color: GOLD, intensity: 8, distance: 20 },

    /* ========================================================================
     * BEAT 9 — THE RIDGE AND THE WARDEN
     * The jump pad is the last new toy: an 8.00 m apex off a slab at 12.22 onto
     * a crag at 18.40 (6.18 m of rise, 0.80 m of drift) with five coins on it.
     * From the crag, one optional 4.20 m hop north onto a shelf for the best
     * view in the course. Then the ring: the flattest 6 m of the ridge crest
     * (EXACTLY 16.40), fenced, entered from the gentle west side. The Warden's
     * charge needs a wall to break itself on; the fence is that wall.
     * ===================================================================== */

    { kind: 'jumppad', p: [13, r2(gy(13, -47) + 0.14), -47], s: [2.8, 0.28, 2.8], power: 8.0, dir: [0, 1, 0], mat: 'rubber', tint: 0x54c47a },
    { kind: 'platform', p: [13, 17.80, -51], s: [3.6, 1.2, 3.6], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [13, 17.35, -58.5], s: [4.0, 1.0, 4.0], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [13, r2(gy(13, -43.4) + 1.3), -43.4], rot: [0, 0, 0], text: 'STAND ON IT', size: 0.24, color: 0x4d6038 },

    ...fenceRing(-2, -54, 8.0, 12, Math.PI - 0.35, Math.PI + 0.35),
    { kind: 'deco', kindOf: 'monolith', p: on(-9.6, -60.4, 1.4), s: [1.2, 3.4, 1.0], mat: 'stone', tint: 0x8e8a80 },
    { kind: 'deco', kindOf: 'monolith', p: on(5.4, -60.0, 1.2), s: [1.1, 3.0, 0.9], mat: 'stone', tint: 0x8e8a80 },
    { kind: 'deco', kindOf: 'banner', p: [-2, 19.6, -60.4], s: [0.08, 2.4, 1.3], mat: 'cloth', tint: 0x7a3040 },
    { kind: 'light', p: [-2, 21.0, -54], color: 0xffe0b0, intensity: 7, distance: 24 },
    { kind: 'text', p: [-9.6, 18.6, -50.2], rot: [0, 0.9, 0], text: 'JUMP THE WAVE  ·  DODGE THE CHARGE  ·  POUND ITS BACK', size: 0.22, color: 0x8c5a3a },

    /* ========================================================================
     * BEAT 10 — THE RACE AND THE RINGS  (two overlays on the whole map)
     * The race: fort gate -> round the pond -> up the mill, 55 s. It is exactly
     * the route the mown paths already draw, which is why the paths exist.
     * The rings: take a wing hat and thread eight rings that spiral around the
     * fort from 15.0 up to 30.4 — the only time the course lets you look at
     * itself from above, and the reason the fort's roofline was worth building.
     * ===================================================================== */

    { kind: 'platform', p: [0, r2(FORT_Y - 0.04), -15.5], s: [3.8, 0.2, 3.8], mat: 'stone', tint: 0xd8c79a },
    { kind: 'platform', p: [38, r2(gy(38, -3) - 0.04), -3], s: [3.8, 0.2, 3.8], mat: 'stone', tint: 0xd8c79a },
    { kind: 'text', p: [0, FORT_Y + 1.3, -15.5], rot: [0, 0, 0], text: 'MEADOW DASH  ·  55s', size: 0.26, color: 0x7a5a2a },
    {
      kind: 'rings', r: 2.6, tint: GOLD, mat: 'gold',
      pts: Array.from({ length: 8 }, (_, i) => {
        const a = i * (Math.PI * 2 / 8) * 1.25;   // 1.25 turns over eight rings
        const rad = 22 - i * 2.0;                 // spiralling in
        return [r2(Math.cos(a) * rad), r2(15 + i * 2.2), r2(-24 + Math.sin(a) * rad)];
      }),
    },

    /* ========================================================================
     * DRESSING — trees, rocks, bushes, flowers, fences.
     * Every scatter is seeded by hash2, so the meadow dresses itself
     * identically on every load and `reset()` never moves a tree (hard rule 3).
     * Nothing scatters below y = 1.6 (that is water) and nothing lands inside
     * the fort, the ring or the mill's sweep.
     * ===================================================================== */

    ...scatter(24, 36, 6, 16, 5, 9001, (x, z, rnd) => (
      gy(x, z) < 1.6 ? null
        : { kind: 'tree', p: on(x, z, -0.25), h: 7.0 + rnd * 4.5, r: 2.4 + rnd * 1.3, mat: 'bark', tint: 0x6b4a2a, leafTint: LEAF, seed: 9001 + x }
    )),
    ...scatter(-18, 38, 5, 15, 5, 9002, (x, z, rnd) => (
      gy(x, z) < 1.6 ? null
        : { kind: 'tree', p: on(x, z, -0.25), h: 6.5 + rnd * 4.0, r: 2.2 + rnd * 1.2, mat: 'bark', tint: 0x6b4a2a, leafTint: 0x59a047, seed: 9002 + x }
    )),
    ...scatter(48, 6, 6, 16, 4, 9003, (x, z, rnd) => (
      gy(x, z) < 1.6 ? null
        : { kind: 'tree', p: on(x, z, -0.25), h: 6.0 + rnd * 4.0, r: 2.1 + rnd * 1.1, mat: 'bark', tint: 0x64452a, leafTint: 0x46893c, seed: 9003 + x }
    )),
    ...scatter(-52, 12, 5, 13, 4, 9004, (x, z, rnd) => (
      gy(x, z) < 1.6 ? null
        : { kind: 'tree', p: on(x, z, -0.25), h: 6.5 + rnd * 3.5, r: 2.2 + rnd * 1.0, mat: 'bark', tint: 0x64452a, leafTint: 0x4e8f3f, seed: 9004 + x }
    )),
    ...scatter(-22, -36, 5, 14, 4, 9005, (x, z, rnd) => (
      gy(x, z) < 1.6 ? null
        : { kind: 'tree', p: on(x, z, -0.25), h: 6.0 + rnd * 3.5, r: 2.0 + rnd * 1.0, mat: 'bark', tint: 0x64452a, leafTint: 0x4e8f3f, seed: 9005 + x }
    )),

    ...scatter(6, 30, 4, 24, 12, 9101, (x, z, rnd) => (
      gy(x, z) < 1.7 ? null
        : { kind: 'deco', kindOf: 'bush', p: on(x, z, 0.35), s: [1.1 + rnd, 0.8 + rnd * 0.6, 1.1 + rnd], mat: 'leaves', tint: 0x568c40 }
    )),
    ...scatter(-30, 12, 4, 20, 8, 9102, (x, z, rnd) => (
      gy(x, z) < 1.7 ? null
        : { kind: 'deco', kindOf: 'bush', p: on(x, z, 0.32), s: [1.0 + rnd, 0.7 + rnd * 0.6, 1.0 + rnd], mat: 'leaves', tint: 0x4f8a3c }
    )),
    ...scatter(20, -34, 6, 22, 8, 9103, (x, z, rnd) => (
      gy(x, z) < 1.7 ? null
        : { kind: 'deco', kindOf: 'bush', p: on(x, z, 0.3), s: [0.9 + rnd, 0.7 + rnd * 0.5, 0.9 + rnd], mat: 'leaves', tint: 0x50864a }
    )),

    ...scatter(-4, 30, 6, 26, 7, 9201, (x, z, rnd) => (
      gy(x, z) < 1.8 ? null : { kind: 'rock', p: on(x, z, -0.35), r: 0.8 + rnd * 1.4, seed: 9201 + x, mat: 'stone' }
    )),
    ...scatter(26, -20, 8, 24, 6, 9202, (x, z, rnd) => (
      gy(x, z) < 1.8 ? null : { kind: 'rock', p: on(x, z, -0.35), r: 0.9 + rnd * 1.5, seed: 9202 + x, mat: 'stone' }
    )),
    ...scatter(-30, -34, 6, 20, 5, 9203, (x, z, rnd) => (
      gy(x, z) < 1.8 ? null : { kind: 'rock', p: on(x, z, -0.4), r: 1.0 + rnd * 1.6, seed: 9203 + x, mat: 'stone' }
    )),

    { kind: 'deco', kindOf: 'flowerbed', p: on(-6.4, 38.0, 0.1), s: [3.4, 0.25, 2.4], mat: 'leaves', tint: FLOWER },
    { kind: 'deco', kindOf: 'flowerbed', p: on(7.2, 35.6, 0.1), s: [2.8, 0.25, 3.0], mat: 'leaves', tint: 0xf0d24e },
    { kind: 'deco', kindOf: 'flowerbed', p: on(-13.6, 27.4, 0.1), s: [3.0, 0.25, 2.2], mat: 'leaves', tint: 0xc7e0f5 },
    { kind: 'deco', kindOf: 'flowerbed', p: on(12.4, 14.6, 0.1), s: [2.6, 0.25, 2.6], mat: 'leaves', tint: FLOWER },
    { kind: 'deco', kindOf: 'flowerbed', p: on(-24.0, 2.4, 0.1), s: [3.2, 0.25, 2.4], mat: 'leaves', tint: 0xf0d24e },
    { kind: 'deco', kindOf: 'flowerbed', p: on(21.0, 4.0, 0.1), s: [2.6, 0.25, 2.8], mat: 'leaves', tint: FLOWER },

    { kind: 'deco', kindOf: 'stump', p: on(9.6, 27.0, 0.28), s: [1.1, 0.65, 1.1], mat: 'wood', tint: 0x6b4a28 },
    { kind: 'deco', kindOf: 'stump', p: on(-17.2, 20.4, 0.26), s: [1.0, 0.6, 1.0], mat: 'wood', tint: 0x6b4a28 },
    { kind: 'deco', kindOf: 'stump', p: on(31.2, 20.0, 0.3), s: [1.2, 0.7, 1.2], mat: 'wood', tint: 0x6b4a28 },

    // A meadow paddock behind spawn, so the diorama has a human edge.
    { kind: 'fence', a: on(-12, 50, 0), b: on(-4, 51, 0), mat: 'wood', tint: TIMBER },
    { kind: 'fence', a: on(-4, 51, 0), b: on(5, 50, 0), mat: 'wood', tint: TIMBER },
    { kind: 'fence', a: on(5, 50, 0), b: on(12, 47, 0), mat: 'wood', tint: TIMBER },
    { kind: 'fence', a: on(-12, 50, 0), b: on(-16, 44, 0), mat: 'wood', tint: TIMBER },
    { kind: 'fence', a: on(12, 47, 0), b: on(16, 41, 0), mat: 'wood', tint: TIMBER },
  ],

  /* ------------------------------------------------------------------------
   * CRITTERS
   * --------------------------------------------------------------------- */
  critters: [
    // THE GNASHER. Post on the pen flat (EXACTLY 7.40). Chain 6 m, so its
    // reach is a readable disc you can pace out from outside it; the cage sits
    // 5.9 m from the post, INSIDE that disc, which is the whole puzzle.
    {
      kind: 'gnasher', p: [-8.0, 7.40, -2.0], chain: 6.0,
      post: [-8.0, 7.40, -7.0], postHits: 3, trigger: 'gnasher-freed',
      telegraph: 0.5, tint: 0x3c4450,
    },
    // BUMBLERS. Side contact = knockback, not death (contract §23). Three, on
    // ground that is flat enough that their waddle reads at 40 m.
    { kind: 'bumbler', path: [on(-8, 36), on(6, 33), on(2, 39), on(-8, 36)], speed: 1.5 },
    { kind: 'bumbler', path: [on(-5, -19), on(5, -19), on(5, -29), on(-5, -29), on(-5, -19)], speed: 1.7 },
    { kind: 'bumbler', path: [on(20, 11), on(28, 9), on(31, 4), on(28, 9), on(20, 11)], speed: 1.4 },
    // SKITTERS. Flyers on sine paths — one over the pond (it swoops at anyone
    // on a lily pad), one circling the mill hill.
    { kind: 'skitter', p: [-36, 4.6, -4], path: [[-30, 5.0, -2], [-46, 6.4, -14]], amp: 1.6, speed: 3.4 },
    { kind: 'skitter', p: [30, 17.0, -2], path: [[30, 17.0, -2], [44, 19.5, -12]], amp: 2.0, speed: 3.8 },
    // THE WARDEN. Three hits, in a fenced ring on the flattest 6 m of the
    // ridge crest (EXACTLY 16.40). Its charge needs a wall to hit — the fence
    // ring is that wall.
    { kind: 'warden', p: [-2, 16.40, -54], arena: { c: [-2, -54], r: 7.0 }, hp: 3, tint: 0x6d7a86 },
  ],
};
