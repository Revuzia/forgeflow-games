/**
 * CRESTBOUND — VERDANT BAILEY 3 : "WINDMILL HEIGHTS"
 * runtime/data/courses/verdant-3.js                                 CONTRACT §25
 * ===========================================================================
 *
 * A stepped valley of terraced farms rising north to a ridge of FIVE WINDMILLS.
 * An open diorama ~130 x 130 m over a 140 x 140 m heightfield: a millpond
 * meadow in the south, a river cutting the valley east-west with a downstream
 * current, wheat terraces climbing the north bank, a stone GRANARY with a
 * cellar nobody finds by accident, a ridge path strung with sacks and spinning
 * gates, and — at the east end — THE GREAT MILL, six sails on a nine-second
 * turn, whose blades carry you to the sky platform.
 *
 *   BEAT 1  RIVERMEAD        analog run/walk, the coin path, the first hop
 *   BEAT 2  THE LOG CROSSING two sinker logs on a moving river (the current)
 *   BEAT 3  THE WHEAT TERRACES  conveyor hay belts you must RUN AGAINST
 *   BEAT 4  THE GRANARY      mill 1's sails lift you to the roof; the floor
 *                            you pound through is the secret
 *   BEAT 5  THE RIDGE STAIR  a stone flight under two swinging sacks
 *   BEAT 6  THE RIDGE PATH   mills 2 and 3, rotor gates, the wing nest,
 *                            the bell and the staircase that answers it
 *   BEAT 7  THE GREAT MILL   the six-arm ride, the hanging coin arc, the crest
 *   BEAT 8  OVERLAYS         the millrace, the ten rings, the chaff cannon
 *
 * ---------------------------------------------------------------------------
 * ROUTES TO THE OPEN CREST  (sky platform, top 35.90; crest at 37.40)
 * ---------------------------------------------------------------------------
 * | route | line | longest move | needs |
 * |---|---|---|---|
 * | A  THE SCAFFOLD | mill-5 yard 23.60 -> six zig-zag scaffold ledges bolted
 *      to the tower (24.60 · 26.00 · 27.40 · 28.80 · 30.20 · 31.60) -> the
 *      tower GALLERY at 32.04 -> two crag ledges (33.50 · 34.90) -> sky
 *      platform 35.90 | 2.40 m flat / +1.40 m up (single-safe: 3.28 m at
 *      +1.60) | nothing. STATIC end to end — this is the route the reach gate
 *      walks, and the reason the mill ride is a shortcut and not a toll. |
 * | B  THE SAIL RIDE | yard -> boarding plinth 24.80 -> the gimballed gondola
 *      at the bottom of the sweep 25.85 -> ride a quarter turn (2.25 s) to the
 *      3 o'clock gondola at 35.85 -> step 1.60 m east onto the sky platform |
 *      1.60 m step off a moving deck | timing only |
 * | C  THE CHAFF CANNON | ridge path -> the mill's sack cannon at (14, -40),
 *      aimed at the sky platform; the launch speed is solved against gravity
 *      by hazards/launch.js from `target` | — | finding it |
 *
 * A fourth, power-gated line exists (wing hat on mill 3 + the ten rings) but
 * it buys the POWER crest, not the open one.
 *
 * ---------------------------------------------------------------------------
 * THE TERRAIN SAMPLER — transliterated from runtime/world/terrain.js
 * ---------------------------------------------------------------------------
 * `terrainHeightAt(x, z)` below is a LINE-FOR-LINE port of the recipe branch of
 * `sampleHeights()` in runtime/world/terrain.js — the same `bump()` falloff,
 * the same squared dome on hills, the same HALF-WIDTH reading of a ridge's `w`,
 * the same 4-octave fbm, the same dead-level 0.55 core on a flat. It is NOT the
 * verdant-1 sampler (that file documents a smoothstep recipe that terrain.js
 * does not use), so every `p` in this file is justified against the field the
 * game and `_harness/reachcheck.mjs` actually build, to the millimetre.
 *
 * Evaluation order, and it matters:
 *
 *   1. y = base
 *   2. HILLS   for each {p:[hx,hz], r, h}:  t = hypot(x-hx, z-hz) / r
 *              if t < 1:  k = bump(t);  y += h * k*k*(3-2k)     (a DOME)
 *   3. RIDGES  for each {a, b, w, h}: t = segDist(x,z,a,b) / (w/2)
 *              if t < 1:  y += h * bump(t)          (`w` is the FULL width)
 *   4. NOISE   y += fbm(x*freq, z*freq, seed, 4) * amp
 *   5. FLATS   for each {p:[fx,fz], r, h} IN ARRAY ORDER:
 *              t = hypot(x-fx, z-fz) / r;  if t >= 1: skip
 *              k = t <= 0.55 ? 1 : bump((t - 0.55) / 0.45)
 *              y += (h - y) * k
 *              (so y is EXACTLY flat.h inside the 0.55 core and melts out to
 *               the natural surface at the rim; a later flat wins.)
 *
 *   bump(t) = 0.5 * (1 + cos(PI * t))   — 1 at the centre, 0 at the rim, C1.
 *
 * Every flat here is authored within ~0.5 m of the NATURAL ground under it, so
 * no terrace is a cliff and no rim is a crease. Measured worst slopes on the
 * required spine (deg, 0.5 m central differences):
 *     spawn -> the quay          2.1
 *     the bank -> the terraces  24.8
 *     terraces -> granary       26.4
 *     granary -> the ridge      31.9   (the steepest required walk here)
 *     ridge -> the mill yard    19.6
 * TUNE.slope.slideDeg is 38, so nothing required slides. The 49 deg west face
 * under mill 3 and the 56 deg east spur below the sky platform are DELIBERATE
 * slide surfaces; nothing required crosses either.
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS (contract §25 + runtime/data/index.js)
 * ---------------------------------------------------------------------------
 *   p            CENTRE, [x, y, z].  s = FULL size, [sx, sy, sz].
 *                => a platform's walkable top is p[1] + s[1]/2.
 *   yaw          RADIANS. yaw 0 faces -Z. +yaw is counter-clockwise from above.
 *   rot          Euler XYZ radians.  (builders.js reads `rot`, never `yaw`,
 *                on stairs and ramps — so every flight here carries `rot`.)
 *   stripe:true  "you had to jump to get here" — earns the bright leading edge.
 *                Walk-on ground and decor never get one.
 *   text         built in the local XY plane facing local +Z, so rot [0,0,0]
 *                faces a player walking north (-Z) — which is most signs here.
 *
 * ---------------------------------------------------------------------------
 * THE REACH BUDGET ACTUALLY USED
 * (safe limits from core/tuning.js REACH_TABLE, printed by `reachBanner()`:
 *  single 4.52 flat / 3.88 at +1.0 / 3.28 at +1.6 · double 5.24 (4 m run-up)
 *  triple 6.11 (6 m) · long jump 6.42 (6 m) · wall kick +2.0/kick)
 * ---------------------------------------------------------------------------
 *   longest REQUIRED gap    3.20 m at -1.10 m   BEAT 2, quay -> first log
 *                           (single-safe at a 1.1 m DROP is well over 4.5 m,
 *                            and the quay gives 3.2 m of straight deck)
 *   tallest REQUIRED step   1.50 m              BEAT 7, scaffold ledge to
 *                           ledge (single-safe rise is 1.60 m)
 *   longest OPTIONAL gap    6.00 m              BEAT 8, the three millrace
 *                           long-jump gaps — each with 8.0 m of straight
 *                           runway behind it, so `longjump` (6.42 safe) and
 *                           `triple` (6.11 safe) both clear it
 *   riskiest OPTIONAL line  the bell staircase: six vanish flagstones on a
 *                           20 s window, 2.40 m apart, 9 m over the ridge
 * Nothing here REQUIRES a long jump, a triple, a dive or a wall kick. The long
 * jump is TAUGHT (a sign, a runway and a coin arc on the millrace) and the
 * triple is taught by the scaffold's own rhythm.
 *
 * CONTENT LEDGER: 8 sigils · 7 crests · 116 coins · 5 checkpoints ·
 * hazard families: sinker, current, conveyor, mill, pendulum, rotor, vanish,
 * breakable, rings, jumppad, cannon + critters gnasher, bumbler x3, skitter x2.
 */

/* ===========================================================================
 * 0. Palette — VERDANT BAILEY, harvest end
 * ======================================================================== */

const GRASS = 0x7fb85a;      // pasture green
const WHEAT = 0xd7b45a;      // the standing crop on the terraces
const LEAF = 0x4e8f3f;       // canopy
const STONE = 0xbfae92;      // warm terrace limestone
const TIMBER = 0x8a6033;     // sails, scaffolding, sack hoists
const CANVAS = 0xe8dfc6;     // sail cloth
const GOLD = 0xffd257;       // coin / sigil / crest glow
const FLOWER = 0xe06a9c;     // verges
const WATER_C = 0x3f9ecb;    // the river
const EMBER = 0xff9c3c;      // lantern flame
const SAFE_EDGE = 0xffe9a8;  // leading-edge stripe

/* ===========================================================================
 * 1. THE HEIGHTFIELD — every `p` in this file is justified against it
 * ======================================================================== */

/** Fraction of a flat's radius that is EXACTLY flat (terrain.js hard-codes it). */
const FLAT_CORE = 0.55;

/** Heightfield definition. Consumed verbatim by world/terrain.js (contract §18). */
const HEIGHTS = {
  seed: 20260903,
  base: 1.6,
  hills: [
    // --- THE MIDSLOPE. Three overlapping domes strung along X so the rise out
    //     of the river valley is a WALL OF FARMLAND from -50 to +50, not a
    //     single cone with nothing either side of it. ---
    { p: [-38, -6], r: 50, h: 8.0 },
    { p: [0, -8], r: 50, h: 8.0 },
    { p: [38, -6], r: 50, h: 8.0 },
    // --- THE MILL RIDGE. Same trick, higher and further north: the five mills
    //     stand on this. ---
    { p: [-40, -48], r: 54, h: 15.0 },
    { p: [0, -50], r: 54, h: 15.0 },
    { p: [40, -48], r: 54, h: 15.0 },
    // --- the valley walls, which close the diorama east and west ---
    { p: [-62, 16], r: 26, h: 4.0 },
    { p: [62, 12], r: 26, h: 4.0 },
    // --- the south lip, so the meadow behind spawn has a horizon ---
    { p: [-26, 58], r: 26, h: 2.4 },
    { p: [26, 58], r: 26, h: 2.4 },
    // --- THE SACK GULLY. A negative dome is a bowl: this is the hollow the
    //     pendulum crossing spans, and the only place on the north side where
    //     the ground falls away under you. ---
    { p: [16, -26], r: 13, h: -4.5 },
  ],
  ridges: [
    // THE RIVER. A negative ridge is a channel; `w` is the FULL width, so this
    // is 14 m either side of the line and the bed bottoms out near -4.9.
    { a: [-64, 27], b: [64, 29], w: 28, h: -7.0 },
  ],
  noise: { amp: 0.26, freq: 0.05 },
  flats: [
    // Each `h` sits within ~0.5 m of the natural ground under it (measured),
    // so every pad is dead level without carving a step into the hillside.
    { p: [0, 54], r: 11, h: 2.00 },     // RIVERMEAD, the spawn apron  (natural 1.60)
    { p: [0, 42], r: 9, h: 1.90 },      // south bank + quay      cp1  (1.53)
    { p: [0, 2], r: 10, h: 10.20 },     // the lower wheat field       (10.15)
    { p: [-2, -16], r: 11, h: 13.60 },  // the granary terrace    cp3  (13.34)
    { p: [30, -10], r: 9, h: 13.00 },   // the east terrace            (12.94)
    { p: [-4, -30], r: 10, h: 19.20 },  // the ridge path midpoint cp4 (19.13)
    { p: [26, -46], r: 12, h: 23.60 },  // THE MILL YARD          cp5  (23.69)
    { p: [-34, -44], r: 8, h: 20.00 },  // the mill-3 pad              (19.84)
  ],
};

/* --- the sampler (formula in the header, ported from terrain.js) --------- */

/** Smooth radial falloff: 1 at the centre, 0 at (and past) the rim, C1 at both. */
function bump(t) {
  if (t >= 1) return 0;
  if (t <= 0) return 1;
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

/** Quintic smoothstep — terrain.js `fade`, the noise interpolant. */
function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

/** Integer hash in [0, 1). Math.imul only, so the 32-bit wrap is engine-identical. */
function ihash(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** 2D value noise in [-1, 1]. */
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = fade(x - ix), fz = fade(z - iz);
  const a = ihash(ix, iz, seed), b = ihash(ix + 1, iz, seed);
  const c = ihash(ix, iz + 1, seed), d = ihash(ix + 1, iz + 1, seed);
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return (ab + (cd - ab) * fz) * 2 - 1;
}

/** Fractal value noise in roughly [-1, 1] — terrain.js defaults (4 octaves). */
function fbm(x, z, seed) {
  let v = 0, a = 1, f = 1, norm = 0;
  for (let i = 0; i < 4; i++) {
    v += vnoise(x * f, z * f, seed + i * 131) * a;
    norm += a;
    a *= 0.5; f *= 2.03;
  }
  return norm > 0 ? v / norm : 0;
}

/** Distance from (px,pz) to the SEGMENT a..b in the XZ plane (clamped at both ends). */
function segDist(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - a[0]) * dx + (pz - a[1]) * dz) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = a[0] + dx * t - px, cz = a[1] + dz * t - pz;
  return Math.sqrt(cx * cx + cz * cz);
}

/**
 * Ground height at (x, z). THE authority for every placement in this file, and
 * bit-for-bit what runtime/world/terrain.js `sampleHeights(def)` returns for the
 * def below — which is also what `_harness/reachcheck.mjs` floods over.
 */
export function terrainHeightAt(x, z) {
  let y = HEIGHTS.base;
  for (let i = 0; i < HEIGHTS.hills.length; i++) {
    const H = HEIGHTS.hills[i];
    const d = Math.hypot(x - H.p[0], z - H.p[1]);
    if (d < H.r) {
      const k = bump(d / H.r);
      y += H.h * (k * k * (3 - 2 * k));
    }
  }
  for (let i = 0; i < HEIGHTS.ridges.length; i++) {
    const R = HEIGHTS.ridges[i];
    const w = R.w * 0.5;
    const d = segDist(x, z, R.a, R.b);
    if (d < w) y += R.h * bump(d / w);
  }
  y += fbm(x * HEIGHTS.noise.freq, z * HEIGHTS.noise.freq, HEIGHTS.seed) * HEIGHTS.noise.amp;
  for (let i = 0; i < HEIGHTS.flats.length; i++) {
    const F = HEIGHTS.flats[i];
    const d = Math.hypot(x - F.p[0], z - F.p[1]);
    if (d >= F.r) continue;
    const t = d / F.r;
    const k = t <= FLAT_CORE ? 1 : bump((t - FLAT_CORE) / (1 - FLAT_CORE));
    y += (F.h - y) * k;
  }
  return y;
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
 * explicit {p} entries here rather than shipped as a def kind, so an arc can
 * never be silently dropped by a Collectibles build that only knows the
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
 * a trail in a valley this stepped; this cannot.
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

/** A fence run along a polyline of [x,z] points, seated on the ground. */
function fenceRun(pts) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    out.push({ kind: 'fence', a: on(pts[i - 1][0], pts[i - 1][1], 0),
               b: on(pts[i][0], pts[i][1], 0), mat: 'wood', tint: TIMBER });
  }
  return out;
}

/**
 * KEEP-OUT VOLUMES. The dressing block at the bottom scatters trees, rocks and
 * crop clumps over the whole valley; these rectangles are what stop a scatter
 * from planting one inside a sail's sweep, on the scaffold, in the river or in
 * the granary — the failure verdant-1 shipped once (a tree collider through its
 * wall-kick shaft) and paid a gate for. The margin is generous because a tree's
 * collider is its trunk radius, not its point.
 *
 * Rects are [x0, x1, z0, z1] in world metres, already margined.
 */
const KEEPOUT = [
  [-70.0, 70.0, 16.0, 40.0],    // BEAT 2: the river, both banks and the logs
  [-26.0, 4.0, -26.0, -6.0],    // BEAT 4: the granary, mill 1's sweep, the pen
  [-14.0, 14.0, -30.0, -18.0],  // BEAT 5: the ridge stair and its sacks
  [4.0, 30.0, -34.0, -18.0],    // BEAT 5: the sack gully crossing
  [-30.0, -14.0, -42.0, -26.0], // BEAT 6: mill 2's sweep
  [-42.0, -26.0, -52.0, -36.0], // BEAT 6: mill 3's sweep and the wing nest
  [0.0, 40.0, -34.0, -26.0],    // BEAT 6: the bell staircase corridor
  [12.0, 58.0, -58.0, -36.0],   // BEAT 7: THE GREAT MILL, scaffold, sky platform
];

/** Is (x, z) inside any authored keep-out volume? */
function blocked(x, z) {
  for (let i = 0; i < KEEPOUT.length; i++) {
    const k = KEEPOUT[i];
    if (x >= k[0] && x <= k[1] && z >= k[2] && z <= k[3]) return true;
  }
  return false;
}

/**
 * Deterministic scatter over an annulus. `make(x, z, rnd, i)` returns the def.
 * Seeded by `ihash`, so the valley dresses itself identically every load and
 * `reset()` never moves a tree (contract hard rule 3). Points inside a KEEPOUT
 * are dropped HERE rather than in each `make`, so no call site can forget.
 */
function scatter(cx, cz, rIn, rOut, n, seed, make) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const ang = ihash(i + 11, seed, seed) * Math.PI * 2;
    const rad = rIn + (rOut - rIn) * Math.sqrt(ihash(i + 71, seed * 3 + 5, seed));
    const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
    if (blocked(x, z)) continue;
    const d = make(x, z, ihash(i + 131, seed * 7 + 13, seed), i);
    if (d) out.push(d);
  }
  return out;
}

/* ===========================================================================
 * 3. Measured constants the beats below refer to by name
 * ======================================================================== */

/* --- BEAT 2, the river ---------------------------------------------------
 * Surface 0.60. The bed bottoms out at -4.89 under (-14, 28), so the deepest
 * water is 5.5 m — a real dive, which is where sigil 1 lives. At x = 0 the
 * waterline runs z 20.9 (north) to 35.3 (south): 14.4 m of moving water. */
const RIVER_Y = 0.60;
const QUAY_TOP = 2.30;        // south quay deck, north edge z = 37.5
const LOG_TOP = 1.20;         // the sinker logs, before they sink
const JETTY_TOP = 2.60;       // north jetty deck, cp2 stands on it

/* --- BEAT 3/4, the terraces ---------------------------------------------- */
const FIELD_Y = 10.20;        // the lower wheat field (flat)
const TERR_A_TOP = 11.00;     // first hay deck
const TERR_B_TOP = 12.30;     // second hay deck
const GRANARY_Y = 13.60;      // the granary terrace (flat) — also the cellar floor
const GRANARY_ROOF = 21.60;   // building centre 17.60, s.y 8.00 -> roof deck
const GRANARY_FLOOR = 17.20;  // the breakable mezzanine you pound through

/* --- BEAT 5/6, the ridge -------------------------------------------------- */
const RIDGE_Y = 19.20;        // the ridge path (flat)

/* --- BEAT 7, THE GREAT MILL ----------------------------------------------
 * Axle 35.60 over a 12.00 m tower, so the drum foots exactly on the yard flat
 * at 23.60. Six sails, len 10, one turn every 9 s (1.5 s between arms).
 * hazards/mill.js: gallery deck = base + tower*0.68 + 0.28 = 32.04, and the
 * gimballed gondolas ride at radius `len`, staying level all the way round —
 * bottom pose 25.85, 3 o'clock pose (38.00, 35.85, -48.00), top pose 45.85.
 * The sail disc is VERTICAL (yaw 0 => the axle lies along Z), sweeping
 * x 18.0..38.0, y 25.6..45.6 in a 2.6 m band about z = -48. Everything built
 * near the mill is kept out of that band. */
const MILL5 = [28, 35.60, -48];
const MILL5_LEN = 10;
const MILL5_GALLERY = 32.04;
const SKY_TOP = 35.90;        // sky platform deck, near edge x = 40.5

/* ===========================================================================
 * 4. THE COURSE
 * ======================================================================== */

export default {
  id: 'verdant-3',
  realm: 'verdant',
  theme: 'verdant',
  name: 'WINDMILL HEIGHTS',
  subtitle: 'Five sails, a river and a staircase that only exists for twenty seconds',
  order: 3,
  difficulty: 3,
  music: 'verdant',

  /* Par times per crest id (ms) — the HUD shows them, nothing gates on them. */
  par: {
    open: 95000, sigils: 250000, coins: 280000,
    secret: 120000, race: 65000, bell: 60000, wing: 140000,
  },

  /* Spawn on the RIVERMEAD flat (EXACTLY 2.00), yaw 0 => facing -Z: the mown
     path, the quay, the river, the terraces stepping up behind it and all five
     mills turning on the skyline. The whole course is legible from here; that
     is the job of the first two seconds. */
  spawn: { p: [0, 2.0, 54], yaw: 0 },
  killY: -20,
  bounds: { min: [-70, -22, -70], max: [70, 54, 70] },
  /* Static-merge chunk ceiling (course.js _computeChunkGrid; default 2 -> this
   * 144 m course collapsed to ONE chunk, so the 36 m sun-shadow frustum drew the
   * whole static merge every frame). 4 = 2 x 2 quadrants: measured 2026-09-04,
   * group-1 validator, see the note in course.js. */
  /* Data lane 2026-09-04: 9 -> 16 (the course.js ceiling). Measured at the
   * spawn with _harness/_g1_triattr2.py: the centre column's two static
   * chunks drew 54.6k triangles, 24 of them shadow-cast, because a 46 m cell
   * cannot leave the 36 m shadow frustum; 35 m cells can. */
  chunks: 16,

  intro: {
    /* One sentence: where you are, and what the course is about. game.js
       already prints "VERDANT BAILEY · WINDMILL HEIGHTS" above this line. */
    text: 'Five mills on the ridge, and the far one is turning fast enough to carry you. Cross the water first.',
    cam: [
      { p: [0, 30, 66], look: [0, 16, -30], t: 0 },
      { p: [34, 34, 8], look: [10, 22, -44], t: 2.8 },
      { p: [4, 7, 60], look: [0, 3, 34], t: 5.6 },
    ],
  },

  ambience: { wind: 0.55, birds: 0.40, water: 0.45 },

  /* ------------------------------------------------------------------------
   * TERRAIN + WATER
   * --------------------------------------------------------------------- */

  terrain: {
    kind: 'terrain',
    origin: [-70, -70],
    size: [140, 140],
    /* 1.25 m samples (was 1.0): 39.2k -> 25.3k triangles at EVERY station,
       the single largest fixed cost on the course. HEIGHTS is a closed-form
       function, so the flats the checkpoints and pads sit on are sampled
       exactly at any grid pitch; reachcheck re-walks the whole course on
       the same def (data lane, 2026-09-04). */
    res: 1.25,
    surface: 'grass',
    heights: HEIGHTS,
    /* The grass is a camera-local ring (terrain.js buildGrass): `density` is
       blades per square metre and sizes that tile, `count` is the ceiling.
       `cross: false` keeps the field at 2 triangles per blade, which is what a
       course carrying five mills and a heightfield can afford. */
    grass: { count: 17000, density: 42, height: 0.24, cross: false, color: 0x6d9a45 },
    // Cart tracks: darker, shorter grass and no blades, so the eye is led
    // through an open diorama. These are the lines the coins follow.
    paths: [
      { pts: [[0, 56], [0, 44], [0, 38]], w: 3.6 },                       // spawn -> quay
      { pts: [[0, 20], [0, 12], [0, 3]], w: 3.2 },                        // bank -> field
      { pts: [[0, 2], [-4, -8], [-2, -18]], w: 3.2 },                     // field -> granary
      { pts: [[-2, -20], [-6, -26], [-4, -32]], w: 2.8 },                 // granary -> ridge
      { pts: [[-4, -32], [8, -38], [20, -44], [26, -46]], w: 3.0 },       // ridge -> mill yard
      { pts: [[-8, -32], [-20, -36], [-32, -42]], w: 2.4 },               // ridge -> mills 2 & 3
    ],
  },

  waters: [
    {
      /* THE RIVER. Surface 0.60, box bottom -5.40 (below the -4.92 deepest
         bed, so the volume really does reach the gravel). Every box edge is
         buried: at z = 14 the ground is 5.24 / 7.25 / 8.55 across the width and
         at z = 40 it is 1.90 / 1.47 / 0.88 — all above the surface, so the
         plane is hidden by the bank rather than clipped by it. It runs off both
         map edges on purpose: a river comes from somewhere. */
      kind: 'water', kind2: 'lake',
      p: [0, RIVER_Y - 3.0, 27], s: [140, 6.0, 26],
      flow: [1.0, 0], tint: WATER_C,
      /* 1.4 m quads (the verdant-2 moat precedent): normals are analytic, so
         the mesh only has to carry the Gerstner displacement — 9.0k -> ~3.7k
         triangles at every station (data lane, measured 2026-09-04). */
      res: 1.4,
    },
  ],

  /* ------------------------------------------------------------------------
   * CHECKPOINTS — 5, every one BEFORE its difficulty spike, never after.
   * `clockOffset` is the course-clock phase a respawn here rewinds to, chosen
   * so the timed geometry is in a FAIR pose the instant you get control back.
   * --------------------------------------------------------------------- */
  checkpoints: [
    {
      id: 'cp-riverbank', p: [0, 1.90, 42], yaw: 0, clockOffset: 0,
      // South bank flat, EXACTLY 1.90, 4.5 m south of the quay deck so the
      // beam never stands on the hero. Before the logs.
    },
    {
      id: 'cp-northbank', p: [0, JETTY_TOP, 20.4], yaw: 0, clockOffset: 3.4,
      // The north jetty deck — flat by construction, and the only level ground
      // between the water and the terraces. Before the conveyors.
      // 3.4 s puts the hay belts mid-run and mill 1 a third into its turn.
    },
    {
      id: 'cp-granary', p: [4, GRANARY_Y, -14], yaw: 0, clockOffset: 5.25,
      // Granary terrace flat, EXACTLY 13.60, 6 m east of the granary door so
      // the ring clears both the building and the gnasher's chain.
      // 5.25 s = half of mill 1's 10.5 s turn: a sail is at 9 o'clock, so the
      // ride is boardable rather than overhead.
    },
    {
      id: 'cp-ridge', p: [-4, RIDGE_Y, -30], yaw: Math.PI, clockOffset: 6.0,
      // Ridge path flat, EXACTLY 19.20. Before the sacks, the gates and the
      // bell. 6.0 s leaves both pendulums at the far end of their swing.
    },
    {
      id: 'cp-yard', p: [22, 23.60, -44], yaw: -0.6, clockOffset: 2.25,
      // The mill yard flat, EXACTLY 23.60, before THE GREAT MILL. 2.25 s is a
      // quarter of the 9 s turn, which parks a gondola at the bottom of the
      // sweep — you always respawn onto a boardable mill.
    },
  ],

  /* ------------------------------------------------------------------------
   * CRESTS — 7. The brief's "boss-or-timed" slot is TIMED here (there is no
   * Warden on this course), and the contract has no `timed` crest type, so the
   * bell staircase ships as a second `race`: a start pad at the bell, a finish
   * pad at the top of the stair, and 20 s — which is exactly the vanish window.
   * Ids are unique; entities/collectibles.js supports more than one race pad
   * pair (a fresh attempt cancels another crest's race).
   * --------------------------------------------------------------------- */
  crests: [
    {
      id: 'open', type: 'open', name: 'CREST ABOVE THE SAILS',
      hint: 'The sky platform. Scaffold, sail or cannon — pick one.',
      p: [47.0, SKY_TOP + 1.50, -48.0],
    },
    {
      id: 'sigils', type: 'sigils', name: 'EIGHT SIGILS OF THE HEIGHTS',
      hint: 'Riverbed, log, terrace, granary roof, gully crag, and three mills.',
      spawnAt: [-2, GRANARY_Y + 1.45, -20],       // the granary terrace pedestal
    },
    {
      id: 'coins', type: 'coins', name: 'A HUNDRED COINS', threshold: 100,
      hint: '116 are lying about the valley. You can miss sixteen.',
      spawnAt: [-6, 3.45, 51],                    // the meadow pedestal, flat 2.00
    },
    {
      id: 'secret', type: 'secret', name: 'WHAT THE GRANARY FLOOR HIDES',
      trigger: 'granary-floor',
      hint: 'The boards under the sacks sound hollow. Pound them.',
      spawnAt: [-8, GRANARY_Y + 1.40, -16],       // in the cellar, floor 13.60
    },
    {
      id: 'race', type: 'race', name: 'THE MILLRACE',
      hint: 'Wheat field to the mill yard. Sixty-five seconds. Take the long jumps.',
      start: [0, FIELD_Y, 2.0], finish: [26, 23.60, -50.0], limitMs: 65000,
      spawnAt: [26, 25.10, -50.0],
    },
    {
      id: 'bell', type: 'race', name: 'THE BELL STAIR',
      hint: 'Pound the bell, then run the flagstones before they go.',
      start: [4, 19.60, -30.0], finish: [38, 30.60, -30.0], limitMs: 20000,
      spawnAt: [38, 32.10, -30.0],
    },
    {
      id: 'wing', type: 'power', name: 'TEN RINGS OVER THE RIDGE', power: 'wing',
      hint: 'Take the hat from the nest on mill 3 and thread all ten.',
      p: [44.0, 33.60, -34.0],
    },
  ],

  /* ------------------------------------------------------------------------
   * SIGILS — 8, every one on an OPTIONAL line you have to choose: the deep
   * river, a sinking log, past the belts, up a mill. None is on the required
   * spine, and each is verified against the surface it belongs to.
   * --------------------------------------------------------------------- */
  sigils: [
    { p: [-14.0, -3.30, 28.0], note: '1 — the riverbed under the deep pool (bed -4.89, so 1.59 m up: a held dive)' },
    { p: [18.0, LOG_TOP + 1.40, 26.0], note: '2 — on the downstream log, which sinks while you decide' },
    { p: [12.0, TERR_B_TOP + 1.35, -4.0], note: '3 — the far end of the upper hay deck, against the belt' },
    { p: [-8.0, GRANARY_ROOF + 1.40, -16.0], note: '4 — the granary roof (deck 21.60): ride a sail or climb the sack stair' },
    { p: [16.0, 20.50, -26.0], note: '5 — the crag in the sack gully (crag top 19.10), between two swinging sacks' },
    { p: [-22.0, 29.00, -34.0], note: '6 — mill 2s gallery balcony (27.58)' },
    { p: [-30.08, 29.50, -44.0], note: '7 — mill 3s sail shelf at 3 oclock (28.17) — ride it round' },
    { p: [28.0, MILL5_GALLERY + 1.46, -48.0], note: '8 — THE GREAT MILLs gallery (32.04), halfway up the scaffold' },
  ],

  /* ------------------------------------------------------------------------
   * COINS — 116 placed, 100 needed. Every group pays for a line the player
   * chose; the trail out of spawn is the only one you cannot miss, because the
   * first thirty seconds of a game teach with breadcrumbs, not with signs.
   * --------------------------------------------------------------------- */
  coins: [
    // BEAT 1 — the cart track out of spawn, down to the quay. (10)
    // Data lane 2026-09-04: the game boots at checkpoints[0], not `spawn`, so
    // this trail used to start BEHIND the player, between hero and camera
    // (metre-wide pancakes in the first frame). It now enters from the side
    // and joins the path at the pad.
    ...trailCoins([[-7, 46], [-4, 44], [-1.5, 41.5], [0, 39]], 10, 1.1),
    // BEAT 1 — a ring in the paddock behind the pedestal, for looking around. (6)
    { ring: { c: [-12, 0, 50], r: 3.6, n: 6, y: 3.20 } },
    // BEAT 2 — the arc across the first log gap. Peak 1.3 m, which is where a
    // held single jump puts you over a 3.20 m gap at a 1.10 m drop. (5)
    ...arcCoins([0, QUAY_TOP + 0.9, 37.5], [0, LOG_TOP + 0.9, 34.3], 1.3, 5),
    // BEAT 2 — the downstream logs, the optional line to sigil 2. (5)
    { line: { a: [10.0, LOG_TOP + 1.0, 30.0], b: [22.0, LOG_TOP + 1.0, 24.0], n: 5 } },
    // BEAT 2 — a ring on the riverbed around sigil 1. Underwater coins are the
    // reason anyone learns to swim DOWN instead of paddling. (10)
    { ring: { c: [-14, 0, 28], r: 4.2, n: 10, y: -3.60 } },
    // BEAT 3 — up the north bank on the cart track. (8)
    ...trailCoins([[0, 19], [0, 13], [0, 6], [0, 2]], 8, 1.1),
    // BEAT 3 — straight down the middle of the two hay belts, so the reward for
    // running against the belt is on the belt. (12)
    { line: { a: [7.0, TERR_A_TOP + 1.05, 1.4], b: [7.0, TERR_A_TOP + 1.05, -5.0], n: 6 } },
    { line: { a: [10.0, TERR_B_TOP + 1.05, -1.0], b: [10.0, TERR_B_TOP + 1.05, -7.0], n: 6 } },
    // BEAT 4 — a ring around the granary pedestal. (8)
    { ring: { c: [-2, 0, -20], r: 4.0, n: 8, y: GRANARY_Y + 1.1 } },
    // BEAT 5 — the ridge stair, and the arc over the sack gully. (8 + 6)
    ...trailCoins([[-6, -19], [-6, -23], [-6, -27], [-4, -31]], 8, 1.2),
    ...arcCoins([9.0, 19.60, -22.0], [16.0, 20.10, -26.0], 1.4, 6),
    // BEAT 6 — the ridge path west to mills 2 and 3. (8)
    ...trailCoins([[-6, -32], [-16, -35], [-26, -39], [-33, -43]], 8, 1.2),
    // BEAT 6 — a ring on mill 3's gallery, the reward for finding the jump pad. (6)
    { ring: { c: [-34, 0, -44], r: 2.0, n: 6, y: 26.90 } },
    // BEAT 7 — THE SET PIECE. A hanging arc strung across THE GREAT MILL's
    // sweep at 3 o'clock: the gondola carries you through it and you jump at
    // the top. Radius 13.5 from the axle, so it hangs 3.5 m clear of the sails
    // and is collected on the ride, not on a platform. (10)
    ...arcCoins([40.0, 30.20, -48.0], [40.0, 41.00, -48.0], 2.6, 10),
    // BEAT 7 — a ring on the sky platform, under the crest. (8)
    { ring: { c: [47, 0, -48], r: 4.4, n: 8, y: SKY_TOP + 1.10 } },
    // BEAT 7 — up the scaffold, one per ledge. (6)
    { p: [17.0, 25.70, -44.2] }, { p: [17.0, 27.10, -39.4] }, { p: [22.8, 28.50, -39.4] },
    { p: [22.8, 29.90, -44.2] }, { p: [28.6, 31.30, -44.2] }, { p: [28.6, 32.70, -39.4] },
  ],

  /* ------------------------------------------------------------------------
   * POWERS — two wing hats. One is the nest on mill 3 (the brief's), the other
   * sits by the first ring, because a ring run that begins 40 m from ring one
   * is not a ring run, it is a commute.
   * --------------------------------------------------------------------- */
  powers: [
    { kind: 'wing', p: [-34.0, 26.60, -44.0], duration: 30 },
    { kind: 'wing', p: [-6.0, RIDGE_Y + 1.0, -32.0], duration: 30 },
  ],

  /* ------------------------------------------------------------------------
   * OBJECTS — the built world, beat by beat.
   * --------------------------------------------------------------------- */
  objects: [

    /* ========================================================================
     * BEAT 1 — RIVERMEAD
     * Twenty seconds of nothing trying to hurt you, on a flat that is EXACTLY
     * 2.00 for 6 m around spawn. The track is cut, the coins go where the track
     * goes, and the only vertical thing in reach is a stack of hay bales you
     * can hop. Spawn faces -Z: quay, terraces and all five mills are on screen
     * before the first input.
     * ===================================================================== */

    { kind: 'deco', kindOf: 'sign', p: on(3.4, 51, 1.15), s: [0.14, 1.7, 1.2], mat: 'wood', tint: TIMBER },
    { kind: 'deco', kindOf: 'post', p: on(3.4, 51, 0.65), s: [0.16, 1.3, 0.16], mat: 'wood', tint: 0x6b4a28 },
    { kind: 'text', p: [3.4, 3.95, 51], rot: [0, 0, 0], text: 'WINDMILL HEIGHTS', size: 0.58, color: 0x2d3d1f },
    { kind: 'text', p: [3.4, 3.42, 51], rot: [0, 0, 0], text: 'EASE THE STICK TO WALK  ·  ALL THE WAY TO RUN', size: 0.22, color: 0x4d6038 },
    { kind: 'text', p: [3.4, 3.05, 51], rot: [0, 0, 0], text: 'LAND AND JUMP AGAIN TO CHAIN A HIGHER ONE', size: 0.22, color: 0x4d6038 },

    // The bale stack the first hop is for. Top 3.50 over ground 2.00.
    { kind: 'platform', p: seat(-9, 47, 1.5), s: [2.6, 1.5, 2.4], mat: 'cloth', tint: WHEAT, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: seat(-9.2, 44.6, 1.1), s: [2.4, 1.1, 2.2], mat: 'cloth', tint: 0xc9a44e, stripe: true, edge: SAFE_EDGE },

    // The pedestal the HUNDRED COINS crest lands on when you finally hit 100.
    { kind: 'pedestal', p: on(-6, 51, 0), mat: 'stone', tint: STONE, glow: GOLD },

    // A paddock behind spawn, so the diorama has a human edge.
    ...fenceRun([[-16, 58], [-8, 60], [2, 60], [11, 57], [16, 52]]),

    /* ========================================================================
     * BEAT 2 — THE LOG CROSSING
     * The river is 14.4 m of moving water at x = 0 and the crossing is two
     * SINKER logs: stand still and you go under. The chain, measured against
     * the reach table (single-safe 4.52 m flat, and more on a drop):
     *
     *   south quay 2.30, north edge z 37.5
     *     -> 3.20 m gap at -1.10 m  -> LOG A, top 1.20, z 30.7..34.3
     *     -> 3.20 m gap at  0.00 m  -> LOG B, top 1.20, z 24.1..27.5
     *     -> 1.20 m gap at +1.40 m  -> north jetty 2.60, z 19.3..22.7
     *
     * Fall in and the current carries you EAST at 3.4 m/s (against a 4.5 m/s
     * swim) until the channel shallows and you walk out — a lesson, not a
     * death. Sigil 1 and ten coins are 5.5 m down in the deep pool, which is
     * the only reason anyone dives here on purpose.
     * ===================================================================== */

    { kind: 'platform', p: [0, QUAY_TOP - 0.75, 39.1], s: [8.0, 1.5, 3.2], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [0, JETTY_TOP - 1.30, 21.0], s: [9.0, 2.6, 3.4], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },

    // The two logs on the required line. delay 1.5 s is long enough to read
    // and short enough to punish dawdling; a pound skips the delay entirely.
    { kind: 'sinker', p: [0, LOG_TOP - 0.25, 32.5], s: [3.6, 0.5, 3.6], delay: 1.5, speed: 0.9, depth: 5.0, mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'sinker', p: [0, LOG_TOP - 0.25, 25.8], s: [3.6, 0.5, 3.6], delay: 1.5, speed: 0.9, depth: 5.0, mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },

    // Three more downstream: the OPTIONAL line to sigil 2, taken across the
    // current rather than against it. Gaps 2.9 / 3.0 / 3.1 m, all flat.
    { kind: 'sinker', p: [7.5, LOG_TOP - 0.25, 30.6], s: [3.4, 0.5, 3.4], delay: 1.2, speed: 1.0, depth: 5.0, mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'sinker', p: [13.0, LOG_TOP - 0.25, 28.4], s: [3.4, 0.5, 3.4], delay: 1.2, speed: 1.0, depth: 5.0, mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'sinker', p: [18.0, LOG_TOP - 0.25, 26.0], s: [3.4, 0.5, 3.4], delay: 1.2, speed: 1.0, depth: 5.0, mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },

    // The current. Gentle, pushing downstream toward the shallow east exit —
    // it teaches "water moves" without drowning anyone.
    { kind: 'current', p: [0, RIVER_Y - 1.6, 27], s: [136, 3.4, 12.0], dir: [1, 0, 0], power: 3.4 },

    // Stone piers of the mill leat, solved from the quay deck down to the real
    // riverbed rather than eyeballed.
    { kind: 'deco', kindOf: 'pillar', p: [-5.6, r2((gy(-5.6, 33) + QUAY_TOP) / 2), 33], s: [1.3, r2(QUAY_TOP - gy(-5.6, 33)), 1.3], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'pillar', p: [5.6, r2((gy(5.6, 24) + QUAY_TOP) / 2), 24], s: [1.3, r2(QUAY_TOP - gy(5.6, 24)), 1.3], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'lantern', p: [3.2, QUAY_TOP + 1.9, 39.1], s: [0.5, 0.7, 0.5], mat: 'metal', tint: GOLD },
    { kind: 'light', p: [0, JETTY_TOP + 2.6, 21.0], color: 0x8fd8ff, intensity: 5, distance: 16 },

    { kind: 'text', p: [3.6, QUAY_TOP + 1.5, 39.1], rot: [0, 0, 0], text: 'THE LOGS SINK WHEN YOU STAND  ·  KEEP MOVING', size: 0.22, color: 0x35607a },
    { kind: 'text', p: [-3.6, QUAY_TOP + 1.15, 39.1], rot: [0, 0, 0], text: 'crouch under water to sink  ·  jump to stroke', size: 0.19, color: 0x35607a },

    /* ========================================================================
     * BEAT 3 — THE WHEAT TERRACES
     * The north bank is a walkable 24.8 deg climb, so the difficulty here is
     * not the hill — it is the HAY BELTS. Two stone threshing decks carry
     * conveyors running SOUTH (downhill, back the way you came) at 5.0 and
     * 5.5 m/s. A full run is 9.0 m/s, so you make 4.0 and 3.5 m/s up the belt:
     * enough to cross, not enough to stroll. Twelve coins sit on the belts,
     * which is the only reason to be on them at all, and sigil 3 is at the far
     * end of the upper one.
     *
     * The decks are also the walk-around: their tops are 0.8 and 1.3 m proud of
     * ground that keeps climbing beside them, so nothing here is required.
     * ===================================================================== */

    { kind: 'platform', p: [4.0, TERR_A_TOP - 0.5, -2.0], s: [22, 1.0, 9.0], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [6.0, TERR_B_TOP - 0.5, -8.0], s: [20, 1.0, 8.0], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },

    { kind: 'conveyor', p: [7.0, TERR_A_TOP + 0.15, -2.0], s: [5.0, 0.3, 8.4], dir: [0, 0, 1], power: 5.0, mat: 'cloth', tint: WHEAT },
    { kind: 'conveyor', p: [10.0, TERR_B_TOP + 0.15, -8.0], s: [5.0, 0.3, 7.4], dir: [0, 0, 1], power: 5.5, mat: 'cloth', tint: WHEAT },
    { kind: 'conveyor', p: [-6.0, TERR_A_TOP + 0.15, -2.0], s: [4.4, 0.3, 8.4], dir: [0, 0, -1], power: 4.0, mat: 'cloth', tint: 0xc9a44e },

    // The stair off the first deck onto the second. builders.js reads `rot`,
    // never `yaw`: [0, PI, 0] turns local +Z (the ascent) to world -Z, i.e.
    // uphill. 9 risers of 0.30 => 11.00 -> 12.80, first tread 11.30.
    { kind: 'stairs', p: [-3.0, TERR_A_TOP, -6.2], w: 3.0, rise: 0.30, run: 0.36, n: 9, rot: [0, Math.PI, 0], mat: 'stone', tint: STONE },

    // A jump pad on the lower deck: 4.0 m of apex puts you on the upper deck
    // without touching a belt, for anyone who would rather not fight one.
    { kind: 'jumppad', p: [-9.0, TERR_A_TOP + 0.14, -3.0], s: [2.6, 0.28, 2.6], power: 4.0, dir: [0, 1, 0], mat: 'rubber', tint: 0x54c47a },

    { kind: 'text', p: [0, TERR_A_TOP + 1.6, 2.4], rot: [0, 0, 0], text: 'THE BELTS RUN DOWNHILL  ·  RUN THROUGH THEM', size: 0.24, color: 0x6b5a3a },
    { kind: 'text', p: [-9.0, TERR_A_TOP + 1.3, -0.4], rot: [0, 0, 0], text: 'STAND ON IT', size: 0.22, color: 0x4d6038 },
    { kind: 'deco', kindOf: 'crate', p: [-2.0, TERR_A_TOP + 0.4, 0.6], s: [0.9, 0.8, 0.9], rot: [0, 0.3, 0], mat: 'wood', tint: TIMBER, count: 3, spread: 2.6, jitter: 0.3 },
    { kind: 'deco', kindOf: 'barrel', p: [-4.6, TERR_B_TOP + 0.45, -9.4], s: [0.8, 0.9, 0.8], mat: 'wood', tint: TIMBER, count: 3, spread: 2.4, jitter: 0.3 },

    /* ========================================================================
     * BEAT 4 — THE GRANARY AND MILL 1
     * A stone granary standing on the terrace flat (13.60). Its s box is
     * [12, 8, 9] centred at 17.60, so builders.js lays the interior floor at
     * 13.60 — that is the CELLAR — and roofs it with a solid deck at 21.60.
     * Between them, at 17.20, a `breakable` mezzanine: the floor the sacks
     * stand on. Pound it and you drop into the cellar, where the secret crest
     * is waiting (trigger 'granary-floor').
     *
     * TWO ways onto the roof, because sigil 4 lives there and a collectible
     * reachable only by riding is a collectible the reach gate calls impossible:
     *   RIDE  mill 1 turns beside it (axle 21.60, six-metre arms, yaw PI/2 so
     *         the sails sweep in the Z-Y plane and never touch the building).
     *         Its 12 o'clock-side gondola stops 2.41 m from the roof deck at
     *         the same height: a step across, not a leap of faith.
     *   CLIMB the sack stair on the east gable — five ledges, 13.60 -> 21.60
     *         in 1.60 m steps, every one inside a single jump's 1.91 m apex.
     * ===================================================================== */

    {
      kind: 'building', style: 'fort', p: [-8, 17.60, -16], s: [12, 8.0, 9],
      mat: 'plaster', tint: 0xe4d8ba, wall: 0.5, footing: 2.4, roofSolid: true,
      doors: [{ side: 'south', w: 3.0, h: 3.4 }],
    },
    // The floor you pound through. It fills the granary's inner span exactly.
    { kind: 'breakable', p: [-8, GRANARY_FLOOR, -16], s: [10.4, 0.5, 7.4], mat: 'wood', tint: TIMBER, drop: 'none', trigger: 'granary-floor' },
    { kind: 'deco', kindOf: 'crate', p: [-10.6, GRANARY_FLOOR + 0.85, -17.4], s: [1.0, 1.0, 1.0], rot: [0, 0.4, 0], mat: 'cloth', tint: WHEAT, count: 4, spread: 3.0, jitter: 0.34 },
    { kind: 'light', p: [-8, GRANARY_Y + 2.2, -16], color: EMBER, intensity: 7, distance: 13 },
    { kind: 'deco', kindOf: 'lantern', p: [-8, GRANARY_Y + 2.6, -13.0], s: [0.5, 0.7, 0.5], mat: 'metal', tint: GOLD },

    // --- the sack stair on the east gable: 13.60 -> 21.60 in five 1.60 m steps
    { kind: 'platform', p: [-0.4, 14.85, -19.6], s: [2.8, 0.7, 2.8], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-0.4, 16.45, -17.6], s: [2.8, 0.7, 2.8], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-0.4, 18.05, -15.6], s: [2.8, 0.7, 2.8], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-0.4, 19.65, -13.6], s: [2.8, 0.7, 2.8], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-1.6, 21.25, -12.0], s: [3.4, 0.7, 2.8], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },

    // --- MILL 1. yaw PI/2 lays the axle along -X, so the sail disc is the
    //     Z-Y plane at x = -18: it sweeps z -24..-12 and y 15.6..27.6, which
    //     clears the granary's west wall (x = -14) by 3.1 m.
    {
      kind: 'mill', p: [-18, 21.60, -16], arms: 4, len: 6, period: 10.5,
      yaw: Math.PI / 2, dir: -1, tower: 6.6, towerR: 2.1,
      deck: { w: 2.4, d: 1.8, t: 0.5 },
      mat: 'wood', tint: TIMBER, sailTint: CANVAS, stripe: true, edge: SAFE_EDGE,
    },
    { kind: 'text', p: [-13.4, 16.4, -10.4], rot: [0, 0.5, 0], text: 'RIDE A SAIL  ·  STEP OFF AT THE TOP OF THE SWING', size: 0.23, color: 0x6b5a3a },
    { kind: 'text', p: [-8, GRANARY_ROOF + 1.0, -11.2], rot: [0, 0, 0], text: 'POUND THE FLOOR', size: 0.26, color: 0x7a5a2a },

    // --- the pedestal the EIGHT SIGILS crest rises from.
    { kind: 'pedestal', p: [-2, GRANARY_Y, -20], mat: 'stone', tint: STONE, glow: GOLD },
    { kind: 'deco', kindOf: 'cage', p: [-13.8, GRANARY_Y + 1.0, -21.4], s: [1.6, 1.8, 1.6], mat: 'wood', tint: 0x5a4128 },

    /* ========================================================================
     * BEAT 5 — THE RIDGE STAIR AND THE SACK GULLY
     * 13.60 -> 19.20 is the steepest required walk on the course (31.9 deg),
     * and it is answered twice: a seventeen-riser stone flight at x = -6, and a
     * cart ramp at x = +9 for anyone carrying speed. Two grain sacks swing
     * across the flight on a 4.0 s period with a 46 deg amplitude — the chain
     * is safe, only the sack kills, and 4.0 s is a count you can hear.
     *
     * East of the stair the ground falls into the SACK GULLY (the negative
     * dome at (16,-26): natural ground there drops to ~13.5). Three crags
     * bridge it with two more sacks swinging between them, and sigil 5 stands
     * on the middle one. Nothing here is required — it is the fast line, and
     * the millrace's second long jump lands on the far lip.
     * ===================================================================== */

    // 17 risers of 0.32: base 13.60, first tread 13.92, top 19.04.
    { kind: 'stairs', p: [-6, GRANARY_Y, -22.6], w: 3.2, rise: 0.32, run: 0.36, n: 17, rot: [0, Math.PI, 0], mat: 'stone', tint: STONE, rail: true },
    // The cart ramp: 13.90 at the foot, 19.10 at the head, over 9.0 m of run
    // = 30.0 deg, comfortably under the 38 deg slide angle.
    {
      kind: 'ramp',
      p: [9.0, 16.50, -23.0],
      s: [r2(Math.hypot(9.0, 5.2)), 0.5, 4.0],
      rot: [0, Math.PI / 2, r2(-Math.atan2(5.2, 9.0))],
      mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE,
    },

    { kind: 'pendulum', p: [-6, 22.60, -21.4], len: 3.4, ampDeg: 46, period: 4.0, phase: 0, axis: 'x', mode: 'ball', radius: 0.85, mat: 'cloth', tint: WHEAT },
    { kind: 'pendulum', p: [-6, 23.90, -25.4], len: 3.4, ampDeg: 46, period: 4.0, phaseCycles: 0.5, axis: 'x', mode: 'ball', radius: 0.85, mat: 'cloth', tint: WHEAT },
    { kind: 'text', p: [-6, GRANARY_Y + 1.5, -18.2], rot: [0, 0, 0], text: 'THE SACKS SWING ON A COUNT OF FOUR', size: 0.23, color: 0x7a5a2a },

    // --- the sack gully crossing. Crag tops 17.70 / 19.10 / 20.30; gaps
    //     3.20 m at +1.40 and 3.20 m at +1.20, both inside the single jump's
    //     3.28 m safe reach at +1.60.
    { kind: 'platform', p: [9.6, 16.90, -22.0], s: [3.4, 1.6, 3.4], mat: 'stone', tint: 0x9a9384, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [16.0, 18.30, -26.0], s: [3.6, 1.6, 3.6], mat: 'stone', tint: 0x9a9384, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [22.0, 19.50, -29.4], s: [3.6, 1.6, 3.6], mat: 'stone', tint: 0x9a9384, stripe: true, edge: SAFE_EDGE },
    { kind: 'pendulum', p: [12.8, 24.20, -24.0], len: 3.8, ampDeg: 52, period: 3.4, phaseCycles: 0.25, axis: 'z', mode: 'ball', radius: 0.85, mat: 'cloth', tint: WHEAT },
    { kind: 'pendulum', p: [19.0, 25.40, -27.7], len: 3.8, ampDeg: 52, period: 3.4, phaseCycles: 0.75, axis: 'z', mode: 'ball', radius: 0.85, mat: 'cloth', tint: WHEAT },

    /* ========================================================================
     * BEAT 6 — THE RIDGE PATH
     * The spine of the ridge, west to east, at 19.2 climbing to 23.6. Three
     * ideas share it, none of them required:
     *
     *   THE GATES    two `rotor` bars, three arms each, turning slowly at
     *                waist height across the path. They are SOLID and rideable
     *                (style 'bar', no `kill`), so a gate is a moving floor you
     *                time, not a thing that murders you — difficulty 3.
     *   THE MILLS    mill 2 (gallery 27.58, sigil 6) is boarded off its own
     *                gondola at 23.11, 1.25 m above the path. Mill 3 (gallery
     *                25.72) is reached by the jump pad at its foot: 7.0 m of
     *                apex against a 5.58 m rise, 6.73 m of horizontal reach.
     *                The WING NEST sits on mill 3's balcony.
     *   THE BELL     pound it and six flagstones fade in for 20 s, climbing
     *                east over the ridge at 1.60 m a step to a crag at 30.60.
     *                The BELL STAIR crest is a 20 s race from the bell to the
     *                crag, which is exactly the window.
     * ===================================================================== */

    { kind: 'rotor', p: [-11.0, RIDGE_Y + 1.15, -32.6], style: 'bar', arms: 3, len: 3.4, thick: 0.42, period: 7.0, axis: 'y', dir: 1, mat: 'wood', tint: TIMBER },
    { kind: 'rotor', p: [-24.5, 22.30, -37.6], style: 'bar', arms: 3, len: 3.4, thick: 0.42, period: 6.0, phase: 0.33, axis: 'y', dir: -1, mat: 'wood', tint: TIMBER },

    {
      kind: 'mill', p: [-22, 29.86, -34], arms: 4, len: 7, period: 12.0,
      yaw: 0, dir: 1, tower: 8.0, towerR: 2.38,
      deck: { w: 2.4, d: 1.8, t: 0.5 },
      mat: 'wood', tint: TIMBER, sailTint: CANVAS, stripe: true, edge: SAFE_EDGE,
    },
    {
      kind: 'mill', p: [-34, 28.00, -44], arms: 4, len: 7, period: 13.5,
      yaw: 0, dir: -1, tower: 8.0, towerR: 2.38,
      mat: 'wood', tint: TIMBER, sailTint: CANVAS, stripe: true, edge: SAFE_EDGE,
    },
    { kind: 'jumppad', p: [-30.0, 20.14, -44.0], s: [2.8, 0.28, 2.8], power: 7.0, dir: [0, 1, 0], mat: 'rubber', tint: 0x54c47a },
    { kind: 'text', p: [-30.0, 21.5, -40.6], rot: [0, 0, 0], text: 'THE NEST IS ON THE BALCONY  ·  STAND ON IT', size: 0.22, color: 0x4d6038 },
    { kind: 'deco', kindOf: 'flags', p: [-34.0, 27.4, -44.0], s: [1.2, 1.4, 1.2], mat: 'cloth', tint: 0x6f9a5a },
    { kind: 'light', p: [-34.0, 28.6, -44.0], color: GOLD, intensity: 6, distance: 16 },

    // --- THE BELL. A `breakable` frame on the ridge path; pounding it drops
    //     coins and fires 'bell-rung'. The flagstones run on the course clock
    //     (20 s solid, 12 s gone, 2.5 s of warning shimmer before each return),
    //     so the honest read is: ring it, then GO.
    { kind: 'breakable', p: [4.0, 20.60, -30.0], s: [1.7, 2.0, 1.7], mat: 'metal', tint: 0xc9a24a, drop: 'coins', dropCount: 5, trigger: 'bell-rung', respawn: 12 },
    { kind: 'deco', kindOf: 'archway', p: [4.0, 22.20, -30.0], s: [2.6, 2.6, 0.9], mat: 'wood', tint: TIMBER },
    { kind: 'text', p: [4.0, 23.9, -30.0], rot: [0, 0, 0], text: 'POUND THE BELL  ·  THE STAIR ANSWERS FOR TWENTY SECONDS', size: 0.22, color: 0x7a5a2a },

    { kind: 'vanish', p: [9.4, 21.30, -30.0], s: [3.0, 0.6, 3.0], mode: 'cycle', cycle: { on: 20, off: 12, warn: 2.5, phase: 0 }, mat: 'stone', tint: 0xb8c2a4, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [14.8, 22.90, -30.0], s: [3.0, 0.6, 3.0], mode: 'cycle', cycle: { on: 20, off: 12, warn: 2.5, phase: 0 }, mat: 'stone', tint: 0xb8c2a4, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [20.2, 24.50, -30.0], s: [3.0, 0.6, 3.0], mode: 'cycle', cycle: { on: 20, off: 12, warn: 2.5, phase: 0 }, mat: 'stone', tint: 0xb8c2a4, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [25.6, 26.10, -30.0], s: [3.0, 0.6, 3.0], mode: 'cycle', cycle: { on: 20, off: 12, warn: 2.5, phase: 0 }, mat: 'stone', tint: 0xb8c2a4, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [31.0, 27.70, -30.0], s: [3.0, 0.6, 3.0], mode: 'cycle', cycle: { on: 20, off: 12, warn: 2.5, phase: 0 }, mat: 'stone', tint: 0xb8c2a4, stripe: true, edge: SAFE_EDGE },
    // The crag at the head of the stair: top 30.60, 2.90 m from the last
    // flagstone at +1.30 — inside the single jump's 3.28 m safe reach.
    { kind: 'platform', p: [38.0, 29.90, -30.0], s: [5.0, 1.4, 5.0], mat: 'stone', tint: 0x9a9384, stripe: true, edge: SAFE_EDGE },
    { kind: 'light', p: [38.0, 32.6, -30.0], color: GOLD, intensity: 7, distance: 18 },
    { kind: 'deco', kindOf: 'monolith', p: [40.4, 32.0, -31.6], s: [1.1, 3.0, 0.9], mat: 'stone', tint: 0x8e8a80 },

    /* ========================================================================
     * BEAT 7 — THE GREAT MILL  (the set piece)
     * Six sails, ten metres each, one turn every nine seconds — an arm past
     * every 1.5 s. The tower foots on the yard flat at 23.60 and the axle is
     * 12 m above it. hazards/mill.js hangs a GIMBALLED gondola off every arm
     * tip, so unlike a bare sail shelf it stays level all the way round and is
     * standable at the bottom of the sweep: that is how a mill is boarded.
     *
     * ROUTE B is that ride: plinth 24.80 -> gondola 25.85 -> a quarter turn
     * (2.25 s) to the 3 o'clock pose at (38.00, 35.85, -48.00) -> 1.60 m east
     * onto the sky platform at 35.90. The hanging coin arc is strung at radius
     * 13.5 from the axle so the gondola carries you straight through it.
     *
     * ROUTE A is the SCAFFOLD, and it is why this crest is not gated on
     * timing: six ledges zig-zagging up the tower's south face, every step
     * 1.40 m at a 1.80 or 2.40 m gap (single-safe is 3.28 m at +1.60), then the
     * gallery, then two crag ledges. Every ledge is kept out of the sail band
     * (z -49.3..-46.7) and every one is striped.
     * ===================================================================== */

    {
      kind: 'mill', p: MILL5, arms: 6, len: MILL5_LEN, period: 9.0,
      yaw: 0, dir: -1, tower: 12.0, towerR: 3.4, chord: 2.6, thick: 0.34,
      deck: { w: 2.4, d: 1.8, t: 0.5 },
      mat: 'wood', tint: TIMBER, sailTint: CANVAS, stripe: true, edge: SAFE_EDGE,
    },

    // The boarding plinth. Top 24.80, 1.05 m under the gondola's bottom pose
    // and 1.20 m over the yard — and at 24.80 it sits 0.80 m BELOW the lowest
    // the sails ever reach (25.60), so it can never be swept.
    { kind: 'platform', p: [22, 24.20, -48], s: [4.0, 1.2, 3.0], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },

    // --- ROUTE A, the scaffold. Row south (z -45.7..-42.7) and row north
    //     (z -40.9..-37.9), climbing in a zig-zag: 24.60 · 26.00 · 27.40 ·
    //     28.80 · 30.20 · 31.60, then the gallery at 32.04 (a 2.78 m step at
    //     +0.44). Slab tops are p[1] + s[1]/2 with s[1] = 1.4.
    { kind: 'platform', p: [17.0, 23.90, -44.2], s: [3.4, 1.4, 3.0], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [17.0, 25.30, -39.4], s: [3.4, 1.4, 3.0], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [22.8, 26.70, -39.4], s: [3.4, 1.4, 3.0], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [22.8, 28.10, -44.2], s: [3.4, 1.4, 3.0], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [28.6, 29.50, -44.2], s: [3.4, 1.4, 3.0], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [28.6, 30.90, -39.4], s: [3.4, 1.4, 3.0], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    // Gallery -> sky platform: two crag ledges east of the sweep. G1 tops at
    // 33.50 (1.46 m over the gallery, 1.88 m across), G2 at 34.90 (+1.40 at
    // 1.90 m), then the deck at 35.90 is a 1.00 m step with the footprints
    // already overlapping.
    { kind: 'platform', p: [36.0, 32.80, -42.5], s: [3.6, 1.4, 3.4], mat: 'stone', tint: 0x9a9384, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [41.5, 34.20, -44.5], s: [3.6, 1.4, 3.4], mat: 'stone', tint: 0x9a9384, stripe: true, edge: SAFE_EDGE },

    // THE SKY PLATFORM. Top 35.90, near edge x = 40.5 — the gondola's outer
    // face stops at 38.90, so 1.60 m of air, and the sails themselves never
    // pass x = 38.0. Nothing on this platform can ever be struck.
    { kind: 'platform', p: [47.0, SKY_TOP - 0.60, -48.0], s: [13, 1.2, 13], mat: 'moss', tint: 0x6f8452, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'arch', p: [50.4, SKY_TOP + 2.1, -48.0], s: [0.9, 0.8, 5.6], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'pillar', p: [50.4, SKY_TOP + 1.0, -50.6], s: [0.9, 2.2, 0.9], mat: 'stone', tint: STONE, count: 2, spread: 5.2, jitter: 0.0 },
    { kind: 'deco', kindOf: 'flowerbed', p: [44.0, SKY_TOP + 0.1, -51.4], s: [3.0, 0.25, 2.2], mat: 'leaves', tint: FLOWER, count: 4, spread: 3.4, jitter: 0.34 },
    { kind: 'light', p: [47.0, SKY_TOP + 3.2, -48.0], color: GOLD, intensity: 9, distance: 22 },
    { kind: 'light', p: [28.0, MILL5_GALLERY + 1.6, -48.0], color: 0xffe0b0, intensity: 6, distance: 16 },
    { kind: 'text', p: [22.0, 26.30, -48.0], rot: [0, 1.57, 0], text: 'BOARD AT THE BOTTOM  ·  A QUARTER TURN IS 2.25 SECONDS', size: 0.22, color: 0x6b5a3a },

    /* ========================================================================
     * BEAT 8 — THE OVERLAYS
     * THE MILLRACE: wheat field to the mill yard in 65 s, along the cart tracks
     * the terrain already carves. It is where the long jump is TAUGHT — three
     * 6.00 m gaps, each with 8.0 m of straight timber runway behind it, which
     * is over the 6 m the long jump and the triple both need. Long-jump safe is
     * 6.42 m and triple-safe is 6.11 m, so neither is a "tight" call.
     * THE RINGS: ten hoops spiralling from mill 3 east over the ridge to the
     * sky platform's height, for the wing hat. The only time the course lets
     * you look at itself from above.
     * THE CHAFF CANNON: ROUTE C. `target` makes launch.js SOLVE the speed
     * against the asymmetric gravity, so it lands on the sky platform deck.
     * ===================================================================== */

    // LONG JUMP 1 — over the gully mouth on the wheat terrace. Runway 8.0 m.
    { kind: 'platform', p: [18.0, 12.30, 0.0], s: [3.6, 0.6, 8.0], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [18.0, 12.30, -10.0], s: [3.6, 0.6, 4.0], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [18.0, 14.2, 3.2], rot: [0, 0, 0], text: 'CROUCH + JUMP AT SPEED  ·  LONG JUMP', size: 0.24, color: 0x6b5a3a },
    // LONG JUMP 2 — across the sack gully, north lip to south lip. Runway 8.0 m.
    { kind: 'platform', p: [26.0, 15.40, -20.0], s: [3.6, 0.6, 8.0], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [26.0, 15.40, -30.0], s: [3.6, 0.6, 4.0], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    // LONG JUMP 3 — the last straight into the yard. Runway 8.0 m.
    { kind: 'platform', p: [12.0, 22.40, -36.0], s: [3.6, 0.6, 8.0], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [12.0, 22.40, -46.0], s: [3.6, 0.6, 4.0], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },

    { kind: 'text', p: [0, FIELD_Y + 1.3, 2.0], rot: [0, 0, 0], text: 'THE MILLRACE  ·  65s', size: 0.26, color: 0x7a5a2a },

    {
      kind: 'rings', r: 2.6, tint: GOLD, mat: 'gold',
      // Ten hoops from mill 3 (west) to the sky platform's height (east),
      // rising 26 -> 38 and swinging 12 m either side of the ridge line.
      pts: Array.from({ length: 10 }, (_, i) => {
        const t = i / 9;
        return [r2(-34 + 78 * t), r2(26 + 12 * t), r2(-40 + Math.sin(t * Math.PI * 2.2) * 12)];
      }),
    },

    {
      kind: 'cannon', p: [14.0, 23.10, -40.0], yaw: -0.9, pitchDeg: 46,
      target: [47.0, SKY_TOP + 0.6, -48.0], r: 1.5, len: 3.4, cooldown: 1.2,
      mat: 'metal', tint: 0x8e8a80, id: 'chaff-cannon',
    },
    { kind: 'text', p: [14.0, 25.4, -37.0], rot: [0, 0, 0], text: 'THE CHAFF CANNON  ·  CLIMB IN', size: 0.22, color: 0x6b5a3a },

    /* ========================================================================
     * DRESSING — hedges, crop clumps, stooks, stone and a few trees.
     * Every scatter is seeded by `ihash`, so the valley dresses itself
     * identically on every load and `reset()` never moves a hedge (hard rule
     * 3). Nothing scatters below y = 1.4 (that is river), and KEEPOUT keeps
     * every one of them out of the sails, the scaffold and the crossings.
     * The kinds are deliberately FEW and repeated with per-def `count`/`spread`
     * seeded clumping (props.js placeProps), because a repeated kind instances
     * and a one-off does not — this is a five-windmill course and the draw-call
     * budget belongs to the mills.
     * ===================================================================== */

    ...scatter(0, 46, 8, 30, 14, 41001, (x, z, rnd) => (
      gy(x, z) < 1.6 ? null
        : { kind: 'deco', kindOf: 'flowerbed', p: on(x, z, 0.08),
            s: [1.5 + rnd * 1.4, 0.22, 1.4 + rnd * 1.2], mat: 'leaves',
            tint: rnd > 0.6 ? 0xf0d24e : FLOWER, count: 4, spread: 3.0, jitter: 0.36 }
    )),
    ...scatter(-6, 4, 10, 34, 16, 41002, (x, z, rnd) => (
      gy(x, z) < 1.6 ? null
        : { kind: 'deco', kindOf: 'plant', p: on(x, z, 0.30 + rnd * 0.2),
            s: [0.8 + rnd * 0.5, 1.0 + rnd * 0.8, 0.8 + rnd * 0.5], mat: 'leaves',
            tint: rnd > 0.5 ? WHEAT : 0xc9a44e, count: 6, spread: 3.0, jitter: 0.4 }
    )),
    ...scatter(-4, -36, 12, 34, 14, 41003, (x, z, rnd) => (
      gy(x, z) < 1.6 ? null
        : { kind: 'deco', kindOf: 'plant', p: on(x, z, 0.26 + rnd * 0.2),
            s: [0.7 + rnd * 0.4, 0.9 + rnd * 0.7, 0.7 + rnd * 0.4], mat: 'leaves',
            tint: rnd > 0.45 ? 0xcfae56 : 0x8fae52, count: 6, spread: 2.8, jitter: 0.4 }
    )),
    ...scatter(0, 20, 14, 46, 12, 41004, (x, z, rnd) => (
      gy(x, z) < 1.7 ? null
        : { kind: 'deco', kindOf: 'bush', p: on(x, z, 0.34),
            s: [1.1 + rnd, 0.8 + rnd * 0.6, 1.1 + rnd], mat: 'leaves',
            tint: 0x568c40, count: 3, spread: 2.8, jitter: 0.32 }
    )),
    ...scatter(-10, -20, 14, 42, 10, 41005, (x, z, rnd) => (
      gy(x, z) < 1.7 ? null
        : { kind: 'deco', kindOf: 'stump', p: on(x, z, 0.28),
            s: [1.0 + rnd * 0.3, 0.62, 1.0 + rnd * 0.3], mat: 'wood',
            tint: 0x6b4a28, count: 3, spread: 4.0, jitter: 0.30 }
    )),
    ...scatter(-2, 8, 16, 48, 10, 41006, (x, z, rnd) => (
      gy(x, z) < 1.8 ? null : { kind: 'rock', p: on(x, z, -0.35), r: 0.9 + rnd * 1.5, seed: 41006 + Math.round(x), mat: 'stone' }
    )),
    ...scatter(6, -40, 14, 34, 8, 41007, (x, z, rnd) => (
      gy(x, z) < 1.8 ? null : { kind: 'rock', p: on(x, z, -0.4), r: 1.0 + rnd * 1.7, seed: 41007 + Math.round(x), mat: 'stone' }
    )),
    ...scatter(-40, 24, 8, 26, 6, 41008, (x, z, rnd) => (
      gy(x, z) < 1.8 ? null
        : { kind: 'tree', p: on(x, z, -0.25), h: 6.5 + rnd * 4.0, r: 2.2 + rnd * 1.2, mat: 'bark', tint: 0x9c7852, leafTint: LEAF, seed: 41008 + Math.round(x) }
    )),
    ...scatter(44, 22, 8, 26, 6, 41009, (x, z, rnd) => (
      gy(x, z) < 1.8 ? null
        : { kind: 'tree', p: on(x, z, -0.25), h: 6.0 + rnd * 4.0, r: 2.1 + rnd * 1.1, mat: 'bark', tint: 0x94704c, leafTint: 0x46893c, seed: 41009 + Math.round(x) }
    )),
    ...scatter(-52, -18, 8, 22, 5, 41010, (x, z, rnd) => (
      gy(x, z) < 1.8 ? null
        : { kind: 'tree', p: on(x, z, -0.25), h: 6.0 + rnd * 3.5, r: 2.0 + rnd * 1.0, mat: 'bark', tint: 0x94704c, leafTint: 0x4e8f3f, seed: 41010 + Math.round(x) }
    )),

    // Field hedges: the terraced-farm silhouette, and the only thing between
    // the cart tracks and the drop into the river.
    ...fenceRun([[-24, 12], [-14, 9], [-4, 8], [6, 9], [16, 12]]),
    /* Data lane 2026-09-04: the two ridge-side hedges run in two bays each
       instead of three (the river-drop hedge above keeps all four). Every
       fence post is a lathe cap + an iron ring (~170 triangles), so posts,
       not length, are what a hedge costs; the silhouette keeps its ends. */
    ...fenceRun([[-26, -6], [-14, -9], [-2, -7]]),
    ...fenceRun([[14, -12], [26, -15], [36, -20]]),
  ],

  /* ------------------------------------------------------------------------
   * CRITTERS
   * --------------------------------------------------------------------- */
  critters: [
    // THE GNASHER guarding the granary door. Post on the terrace flat (EXACTLY
    // 13.60), chain 5.5 m, so its reach is a disc you can pace out from the
    // cart track. The sack stair starts at x = -0.4, which is 6.6 m from the
    // post: OUTSIDE the disc, so the climb is a choice and not a gauntlet.
    {
      kind: 'gnasher', p: [-7.0, GRANARY_Y, -10.6], chain: 5.5,
      post: [-7.0, GRANARY_Y, -9.6], postHits: 3, trigger: 'gnasher-freed',
      telegraph: 0.5, tint: 0x3c4450,
    },
    // BUMBLERS. Side contact = knockback, not death (contract §23). Three, on
    // ground flat enough that their waddle reads at 40 m.
    { kind: 'bumbler', path: [on(-8, 48), on(6, 45), on(2, 52), on(-8, 48)], speed: 1.5 },
    { kind: 'bumbler', path: [on(-10, 2), on(2, 0), on(2, -8), on(-10, -6), on(-10, 2)], speed: 1.7 },
    { kind: 'bumbler', path: [on(-12, -32), on(-22, -38), on(-30, -40), on(-22, -38), on(-12, -32)], speed: 1.4 },
    // SKITTERS. One over the river (it swoops at anyone dithering on a log),
    // one circling the great mill.
    { kind: 'skitter', p: [-6, 5.0, 28], path: [[-18, 5.4, 30], [10, 6.6, 24]], amp: 1.7, speed: 3.4 },
    { kind: 'skitter', p: [34, 30.0, -40], path: [[34, 30.0, -40], [48, 34.0, -54]], amp: 2.0, speed: 3.8 },
  ],
};
