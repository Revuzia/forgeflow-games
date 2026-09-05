/**
 * CRESTBOUND — VERDANT BAILEY 2 : "GNASHER FORT"
 * runtime/data/courses/verdant-2.js                                 CONTRACT §25
 * ===========================================================================
 *
 * A ruined hill-fort on a single knoll in a flooded moat. BAILEY MEADOW taught
 * the moveset on open ground; GNASHER FORT asks for PRECISION and puts MOVING
 * GEOMETRY under the hero's feet. It is one diorama about 120 x 120 m across a
 * 140 x 140 m heightfield, with 30 m of verticality from the moat floor
 * (−2.76) to the crest on the keep's flagpole plinth (+28.60).
 *
 * The knoll is TERRACED, not conical: the ground is dead level at 19.00 on the
 * crown, and level again on the outer bailey ring at ~7.00, with 40–45 deg
 * grass SCARPS between them. Those scarps are deliberate — a hill fort's
 * earthworks are meant to stop you — and NOTHING required crosses one on foot.
 * Every climb in this course is authored geometry: a stair, a net, a jump pad,
 * a flight of vanishing flagstones, a mill's gondola, an orbit of carts.
 *
 *   BEAT 1  THE SOUTH SHORE   spawn, meadow, the coin path down to the water
 *   BEAT 2  THE CAUSEWAY      two SINKER stones across an 11 m moat  (cp-shore, cp-quay)
 *   BEAT 3  THE GNASHER GATE  two chained jaws flank the gate; pound a post
 *                             three times and the cage under the stair opens
 *   BEAT 4  THE OUTER WALL    net / gate stair / jump pad -> the rampart walk
 *                             at 12.00, then the BREACH and its three MOVER
 *                             carts on rails                        (cp-bailey, cp-rampart)
 *   BEAT 5  THE MIDDLE WALL   the east flight of VANISH flagstones up the scarp,
 *                             ROTOR bars on the walkway at 21.40
 *   BEAT 6  THE WEST MILL     a MILL gondola lifts you off the bailey to the
 *                             same walkway — the second way up
 *   BEAT 7  THE PORTCULLIS    a BREAKABLE grate you pound, and the inner court (cp-court)
 *   BEAT 8  THE KEEP          the Warden, the gallery stair, and a 3.20 m
 *                             WALL-KICK shaft in the north-west turret
 *   BEAT 9  THE ORBIT         three MOVER platforms circling the keep — the
 *                             set-piece, ridden while the mill sweeps behind
 *   BEAT 10 THE DROWNED CREST the metal hat, the moat CURRENT, and the floor
 *
 * ---------------------------------------------------------------------------
 * ROUTES TO THE OPEN CREST  (keep roof 27.30 -> crest 28.60)
 * ---------------------------------------------------------------------------
 * Every one of the three is STATIC-LEGAL end to end: no leg of any of them is
 * reachable only by riding something. (Measured gaps are in each beat below.)
 *
 *  A  THE GATE      causeway -> causeway stair -> outer bailey -> THE GRAND GATE
 *     (the long      STAIR through the south gate, up the south scarp, to the
 *      way, all      portcullis at 18.24 -> inner court 19.00 -> the keep's east
 *      stairs)       gallery stair -> gallery 23.30 -> three merlon corbels
 *                    (1.35 / 1.40 / 1.40 m) -> the cap at 27.30.
 *  B  THE FLIGHT    causeway -> bailey -> the NET (or the outer gate stair, or
 *     (precision)    the jump pad) -> outer rampart 12.00 -> the EAST VANISH
 *                    FLIGHT, six flagstones on a 3.4/1.6 s cycle, +1.4 m each
 *                    -> middle walk 21.40 -> the NW WALL-KICK SHAFT (3.20 m
 *                    clear, floor 18.60, exit 27.00: one jump + four kicks)
 *                    -> 3.90 m hop west-to-east onto the cap.
 *  C  THE RIDE      causeway -> bailey -> the WEST MILL's gondola (boarded
 *     (moving        1.10 m off the ground at the bottom of the sweep) -> middle
 *      geometry)     walk 21.40 -> THREE ORBIT MOVERS at 22.80 / 24.30 / 25.80
 *                    circling the keep -> the cap at 27.30.
 *
 * The BREACH carts and the outer rampart ring are a fourth, lateral choice:
 * the ring walk is whole on three sides, so the carts are a 16 m shortcut, never
 * a gate. (Reach rule obeyed: no REQUIRED target hangs off a mover or a mill.)
 *
 * ---------------------------------------------------------------------------
 * THE TERRAIN SAMPLER
 * ---------------------------------------------------------------------------
 * `terrainHeightAt(x, z)` below is a TRANSLITERATION of world/terrain.js
 * `sampleHeights()` (the recipe branch) — the same quintic-faded value-noise
 * fbm, the same cosine `bump` falloff, the same 0.55-core flat blend, in the
 * same order:
 *
 *     base  ->  + hills  ->  + ridges  ->  + fbm noise  ->  flats BLEND OVER
 *
 * so every `p` in this file is the number the physics and _harness/reachcheck
 * will actually produce, not an estimate. (verdant-1 carried its own smoothstep
 * approximation of the same shape; this one is the formula itself, which is why
 * `on()` here is exact rather than close.) NOTE: terrain.js ignores a per-flat
 * `core` key — the level core is always 0.55 * r — so no flat here writes one.
 *
 * MEASURED RADIAL PROFILE (metres from the knoll's axis, +Z arm):
 *     r   0..8.3  19.00  the INNER COURT (crown), dead level, 16.6 m across
 *     r   8.3..15 19.00 -> 13.5   the inner scarp   (34–53 deg: the wall stands here)
 *     r  15..20   13.5 -> 9.11    the middle scarp  (36–45 deg: SLIDE, not a path)
 *     r  20..27    9.11 -> 5.68   the OUTER BAILEY  (11–29 deg: walkable ring)
 *     r  27..33    5.68 -> 0.24   the glacis        (33–45 deg: SLIDE)
 *     r  33..45   the MOAT, water surface 0.00, floor −2.76 at r = 39
 *     r  45..68   the outer meadow, 0.17 -> 2.30, level to 0.6 deg past r = 51
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS (identical to verdant-1.js)
 * ---------------------------------------------------------------------------
 *   p            CENTRE, [x, y, z].  s = FULL size, [sx, sy, sz].
 *                => a platform's walkable top is p[1] + s[1]/2.
 *   yaw          RADIANS. yaw 0 faces −Z. +yaw counter-clockwise from above.
 *   rot          Euler XYZ radians.  colours are hex NUMBERS.
 *   stripe:true  "you had to jump to get here" — the bright leading edge.
 *                Walk-on ground and decor never get one.
 *   building p   the CENTRE of the s box: interior floor = p[1] − s[1]/2,
 *                rampart walk = p[1] + s[1]/2.
 *
 * ---------------------------------------------------------------------------
 * THE REACH BUDGET ACTUALLY USED
 * (safe limits from core/tuning.js: single 4.52 flat / 3.88 at +1.0 / 3.28 at
 *  +1.6; single vertical apex 1.91, safe 1.61; double 5.24 needs 4 m of run-up;
 *  triple 6.11 and long jump 6.42 both need 6 m)
 * ---------------------------------------------------------------------------
 *   longest REQUIRED horizontal gap  3.90 m at +0.30 m   BEAT 8, shaft ledge -> cap
 *                                    (safe there is 4.33 m; approach 3.40 m of
 *                                     ledge, so a single jump is the only move
 *                                     offered and it clears)
 *   longest REQUIRED gap on ROUTE A  1.20 m at +1.35 m   BEAT 8, gallery -> merlon 1
 *   tallest REQUIRED step            1.50 m              BEAT 9, orbit to orbit
 *   wall-kick shaft                  3.20 m clear, floor 18.60 -> exit 27.00
 *                                    (8.40 m: one jump at 1.91 + four kicks at
 *                                     2.12 = 10.39 m of envelope)
 *   longest OPTIONAL gap             4.20 m              BEAT 4, cart -> the far lip
 *   riskiest OPTIONAL line           the moat floor at −2.76 under a 2.6 m/s
 *                                    current, on a 25 s metal hat
 * Nothing REQUIRED here uses a double, a triple, a long jump or a dive. All of
 * them are rewarded (the sigil lines and the coin arcs want them) and none of
 * them is demanded, because this is difficulty 2.
 *
 * CONTENT LEDGER: 8 sigils · 7 crests · 118 coins · 5 checkpoints ·
 * families: sinker, mover, vanish, rotor, breakable, mill, jumppad, current
 * + critters gnasher x2, bumbler x4, skitter x2, warden.
 */

/* ===========================================================================
 * 0. Palette — VERDANT BAILEY, one realm north of the meadow
 * ======================================================================== */

const GRASS = 0x7fb85a;      // sunlit turf
const LEAF = 0x4e8f3f;       // canopy
const STONE = 0xbfae92;      // the fort's warm limestone
const STONE_OLD = 0xa2947c;  // the ruined outer wall — greyer, older
const TIMBER = 0x8a6033;     // beams, carts, gondolas, the gallery
const BANNER = 0x2f7fd0;     // the fort's colours
const GOLD = 0xffd257;       // coin / sigil / crest glow
const FLOWER = 0xe06a9c;     // meadow flowers
const WATER_C = 0x3f9ecb;    // the moat
const EMBER = 0xff9c3c;      // torch flame
const IRON = 0x5b6068;       // the portcullis, the gnasher chains
const SAFE_EDGE = 0xffe9a8;  // leading-edge stripe

/* ===========================================================================
 * 1. THE HEIGHTFIELD — every `p` in this file is justified against it
 * ======================================================================== */

/** Heightfield definition. Consumed verbatim by world/terrain.js (contract §18). */
const HEIGHTS = {
  seed: 20260903,
  base: 2.2,
  hills: [
    // THE KNOLL. One hill, 44 m of radius and 18 m of rise; the flats below cut
    // it into terraces. Its own apex is flat (bump'(0) = 0), so the crown has no
    // crease under the keep.
    { p: [0, 0], r: 44, h: 18.0 },
    // Four meadow swells OUTSIDE the moat, purely to close the diorama's
    // silhouette so the fort is not an island in a table-top.
    { p: [-46, 34], r: 18, h: 3.4 },
    { p: [44, 40], r: 16, h: 2.8 },
    { p: [-40, -46], r: 20, h: 3.0 },
    { p: [46, -40], r: 18, h: 2.6 },
  ],
  ridges: [],
  flats: [
    // ORDER MATTERS: a later flat wins where two overlap, so the moat basin is
    // carved first and the three terraces are stamped back into it, largest
    // first. Each flat's r is chosen so its rim dies before the next one's
    // level core begins — that is what keeps the terraces terraces.
    { p: [0, 0], r: 54, h: -6.0 },   // THE MOAT BASIN  (level core r < 29.7)
    { p: [0, 0], r: 42, h: 7.0 },    // THE OUTER BAILEY (level core r < 23.1)
    { p: [0, 0], r: 24, h: 14.0 },   // the middle shelf (level core r < 13.2)
    { p: [0, 0], r: 15, h: 19.0 },   // THE INNER COURT  (level core r < 8.25)
    // The spawn meadow. h matches the natural ground there (2.27–2.32) so the
    // flat's rim is invisible: it only takes the noise out from under the feet
    // of a hero who has not been given the controls yet.
    { p: [0, 56], r: 7, h: 2.30 },
  ],
  noise: { amp: 0.22, freq: 0.05 },
};

/* --- the sampler: a transliteration of world/terrain.js sampleHeights ----- */

/** Integer hash in [0, 1). Math.imul only, so the 32-bit wrap is engine-identical. */
function ihash(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Quintic smoothstep — C2 continuous, so the fbm has no normal creases. */
function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

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

/** Fractal value noise in roughly [-1, 1] (4 octaves, gain 0.5, lacunarity 2.03). */
function fbm(x, z, seed, octaves) {
  const O = octaves || 4;
  let v = 0, a = 1, f = 1, norm = 0;
  for (let i = 0; i < O; i++) {
    v += vnoise(x * f, z * f, seed + i * 131) * a;
    norm += a;
    a *= 0.5; f *= 2.03;
  }
  return norm > 0 ? v / norm : 0;
}

/** Smooth radial falloff: 1 at the centre, 0 at (and past) the rim, C1 at both. */
function bump(t) {
  if (t >= 1) return 0;
  if (t <= 0) return 1;
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

/** Distance from (px, pz) to the SEGMENT a..b in the XZ plane (clamped). */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = ax + dx * t - px, cz = az + dz * t - pz;
  return Math.sqrt(cx * cx + cz * cz);
}

/**
 * Ground height at (x, z). THE authority for every placement in this file, and
 * bit-for-bit the function world/terrain.js builds from HEIGHTS.
 */
export function terrainHeightAt(x, z) {
  let y = HEIGHTS.base;
  for (let i = 0; i < HEIGHTS.hills.length; i++) {
    const Hh = HEIGHTS.hills[i];
    const r = Hh.r || 1;
    const dx = x - Hh.p[0], dz = z - Hh.p[1];
    const dd = Math.sqrt(dx * dx + dz * dz);
    if (dd < r) { const k = bump(dd / r); y += (Hh.h || 0) * (k * k * (3 - 2 * k)); }
  }
  for (let i = 0; i < HEIGHTS.ridges.length; i++) {
    const R = HEIGHTS.ridges[i];
    const w = (R.w || 1) * 0.5;
    const dd = segDist(x, z, R.a[0], R.a[1], R.b[0], R.b[1]);
    if (dd < w) y += (R.h || 0) * bump(dd / w);
  }
  y += fbm(x * HEIGHTS.noise.freq, z * HEIGHTS.noise.freq, HEIGHTS.seed, 4) * HEIGHTS.noise.amp;
  for (let i = 0; i < HEIGHTS.flats.length; i++) {
    const F = HEIGHTS.flats[i];
    const r = F.r || 1;
    const dx = x - F.p[0], dz = z - F.p[1];
    const dd = Math.sqrt(dx * dx + dz * dz);
    if (dd < r) {
      const t = dd / r;
      const k = t <= 0.55 ? 1 : bump((t - 0.55) / 0.45);
      y += ((F.h === undefined ? y : F.h) - y) * k;
    }
  }
  return y;
}

/* ===========================================================================
 * 2. Authoring helpers — every placement resolves against the heightfield
 * ======================================================================== */

const gy = terrainHeightAt;
const r2 = (v) => Math.round(v * 100) / 100;

/** A point ON the ground at (x, z), lifted `up` metres. */
function on(x, z, up) { return [r2(x), r2(gy(x, z) + (up || 0)), r2(z)]; }

/** Centre of a box of full height `sy` whose base sits on the ground, sunk `sink` m. */
function seat(x, z, sy, sink) { return [r2(x), r2(gy(x, z) - (sink || 0) + sy / 2), r2(z)]; }

/**
 * Coins along a jump ARC from a to b, peaking `h` above the chord. Expanded to
 * explicit {p} entries so an arc can never be silently dropped by a build that
 * only knows the contract's {p} / {ring} / {line} forms.
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
 * Coins that FOLLOW THE GROUND along a polyline of [x, z] waypoints, evenly
 * spaced by arc length, floating `up` metres. A straight {line} would bury half
 * a trail on a knoll this steep; this cannot.
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

/** Coins in a ring at a FIXED height (a walk, a deck) — no ground sampling. */
function ringCoins(cx, cz, r, n, y, from) {
  const out = [];
  const a0 = from === undefined ? 0 : from;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    out.push({ p: [r2(cx + Math.cos(a) * r), r2(y), r2(cz + Math.sin(a) * r)] });
  }
  return out;
}

/** A fence run on the ground between two [x, z] points. */
function fenceRun(ax, az, bx, bz) {
  // Returns an ARRAY so call sites can spread it like the other run helpers.
  return [{ kind: 'fence', a: on(ax, az, 0), b: on(bx, bz, 0), mat: 'wood', tint: TIMBER }];
}

/**
 * KEEP-OUT VOLUMES — the scatter below must never drop a tree inside the moat,
 * the fort, the mill's sweep or the causeway lane. verdant-1 learned this the
 * expensive way: an unguarded scatter planted a tree through its own wall-kick
 * shaft and ROUTE B could not be performed at all. Rects are
 * [x0, x1, z0, z1] in world metres, already margined by a trunk radius.
 */
const KEEPOUT = [
  [-52, 52, -52, 52],       // the knoll, the moat and every wall — the whole fort
  [-9, 9, 44, 62],          // the causeway lane and the spawn meadow's sight line
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
 * Seeded by `ihash`, so the meadow dresses itself identically every load and
 * `reset()` never moves a tree (contract hard rule 3).
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

const WATER_Y = 0.00;         // the moat surface. Floor −2.76 at r = 39 => 2.76 m deep.

// BEAT 2 — the causeway. Quay tops and sinker tops are all 1.55, so the run is
// dead level and the only variable is how long you stand still. Measured gaps,
// edge to edge: south quay -> A 1.70 m, A -> B 2.00 m, B -> north quay 0.70 m.
// Every one is trivially inside the 4.52 m single-jump-safe span: the hazard
// here is the SINK (0.8 s of delay, 1.2 m/s down), not the span.
const QUAY_TOP = 1.55;
const SINK_A_Z = 41.6;
const SINK_B_Z = 36.8;

// BEAT 4 — the outer wall. building p is the CENTRE of s, so floor = 8.0 − 4.0
// and the rampart walk = 8.0 + 4.0. `wall: 2.6` puts the walk ring at
// |x|,|z| = 20.00 .. 23.40 — a 3.40 m walk, which is what the rotor-free half
// of the course needs to feel like a rampart rather than a kerb.
const OUTER_WALK = 12.00;
const OUTER_IN = 20.00;       // inner edge of the outer rampart walk
const OUTER_OUT = 23.40;      // outer edge (0.40 m of overhang past the wall face)
const BREACH_Z = -22.5;       // the breach's centre on the north band
const BREACH_HALF = 7.0;      // the aperture removes the walk for |x| < 7.00

// BEAT 5/7 — the middle wall. Floor 17.20 (the grand stair arrives at 18.24),
// walk 21.40, `wall: 2.0` => the walk ring is |x|,|z| = 7.60 .. 10.40.
const MID_WALK = 21.40;
const MID_IN = 7.60;
const MID_OUT = 10.40;
const COURT_Y = 19.00;        // the crown: dead level for r < 8.25

// BEAT 8/9 — the keep. Tower floor 19.00, roof deck 27.30, crest 28.60.
// The gallery balcony at 23.30 is the landing ROUTE A and the shaft share.
const KEEP_Z = -3.0;
const KEEP_TOP = 27.30;
const GALLERY = 23.30;

// BEAT 8 — the wall-kick shaft in the north-west turret. Interior is
// x −9.00 .. −5.80, z −9.00 .. −5.80: 3.20 m clear, inside the 3.40 m limit.
// Floor 18.60, exit ledge 27.00 => 8.40 m, which one jump (1.91) plus four
// kicks (2.12 each) covers with 1.99 m to spare.
const SHAFT_C = [-7.4, -7.4];
const SHAFT_FLOOR = 18.60;
const SHAFT_EXIT = 27.00;

/* ===========================================================================
 * 4. THE COURSE
 * ======================================================================== */

export default {
  id: 'verdant-2',
  realm: 'verdant',
  theme: 'verdant',
  name: 'GNASHER FORT',
  subtitle: 'Three walls, a moat, and something on a chain',
  order: 2,
  difficulty: 2,
  music: 'verdant',

  /* Par times per crest id (ms) — the HUD shows them, nothing gates on them. */
  par: {
    open: 110000, sigils: 260000, coins: 300000,
    secret: 90000, boss: 150000, race: 50000, metal: 140000,
  },

  /* Spawn on the meadow flat (EXACTLY 2.30), yaw 0 => facing −Z: the causeway,
     the moat, the gate with its two chained jaws, and the keep's flagpole on
     the skyline are all on screen before the first input. The whole course
     reads from here, which is the job of the first two seconds. */
  spawn: { p: [0, 2.30, 57], yaw: 0 },
  killY: -24,
  bounds: { min: [-68, -14, -68], max: [68, 44, 68] },
  /* Static-merge chunk ceiling (course.js _computeChunkGrid; default 2 -> this
   * 144 m course collapsed to ONE chunk, so the 36 m sun-shadow frustum drew the
   * whole static merge every frame). 4 = 2 x 2 quadrants: measured 2026-09-04,
   * group-1 validator, see the note in course.js. */
  chunks: 4,

  intro: {
    text: 'Three walls climb the knoll, and the moat has swallowed the road. Whatever is chained at the gate has been waiting a long time.',
    cam: [
      { p: [0, 24, 66], look: [0, 12, 8], t: 0 },
      { p: [30, 18, 34], look: [0, 16, -4], t: 2.8 },
      { p: [2, 5, 60], look: [0, 20, -8], t: 5.6 },
    ],
  },

  ambience: { wind: 0.40, birds: 0.35, water: 0.45 },

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
    // Camera-local grass ring (terrain.js buildGrass): `density` is blades per
    // square metre and only sizes the tile that wraps the viewer, so this is
    // the same triangle cost as verdant-1's field at a higher apparent density.
    grass: { count: 17000, density: 42, height: 0.21, cross: false, color: 0x5f8f43 },
    // Mown/worn paths. These are exactly the lines the coins follow and the
    // race runs, which is the whole reason an open diorama can still be read.
    paths: [
      { pts: [[0, 58], [0, 49]], w: 3.6 },                       // spawn -> the shore
      { pts: [[0, 34], [0, 26]], w: 3.2 },                       // the quay -> the gate
      { pts: [[0, 26], [0, 20]], w: 2.8 },                       // through the gate
      { pts: [[-8, 25], [-16, 18], [-20, 6]], w: 2.4 },          // the bailey ring, west
      { pts: [[8, 25], [17, 17], [21, 5]], w: 2.4 },             // the bailey ring, east
      { pts: [[0, 12], [0, 6], [0, -2]], w: 2.6 },               // the court
    ],
  },

  waters: [
    {
      // THE MOAT. One plane at y = 0.00 with the knoll standing out of it — the
      // island construction, not four boxes with four seams. Every edge is
      // BURIED: the ground at (0, ±56) is 2.30 / 2.33, at (±56, 0) is 2.21 /
      // 2.18, and the corners sit on the base at 2.20, all above the surface,
      // so the plane is hidden by the shore rather than clipped by it.
      kind: 'water', kind2: 'lake',
      p: [0, WATER_Y - 3.5, 0], s: [112, 7.0, 112],
      /* res 1.4 m (default 0.9): the moat is 112 m square, and at 0.9 m quads it
       * was 30,752 triangles — a third of the whole spawn frame's budget
       * overage (measured 2026-09-04, group-1 validator: spawn 513k vs 450k).
       * Wave shading is per-pixel (analytic normals in the water shader), so
       * the quad size only samples the Gerstner heave; the shortest wave
       * (2.2 m) was already under-sampled at 0.9 m. 1.4 m -> 12,800 tris. */
      res: 1.4,
      tint: WATER_C,
    },
  ],

  /* ------------------------------------------------------------------------
   * CHECKPOINTS — 5, every one BEFORE its spike and on ground that is either a
   * terrain flat or authored geometry (so no respawn ever lands on a scarp).
   * `clockOffset` is the course-clock phase a respawn here rewinds to; each is
   * chosen so the timed hazard the checkpoint guards is in its FRIENDLY phase
   * on the frame the hero gets the controls back.
   * --------------------------------------------------------------------- */
  checkpoints: [
    // Flat 2.30, 4 m behind the spawn beam so neither ring sits on the hero.
    { id: 'cp-shore', p: [0, 2.30, 53], yaw: 0, clockOffset: 0 },
    // The north quay's deck — authored, therefore flat by construction. AFTER
    // the sinkers, BEFORE the gnasher gate. clockOffset 0 puts both sinkers at
    // full height, so the run back over them is the run you just learned.
    { id: 'cp-quay', p: [0, QUAY_TOP, 32.6], yaw: 0, clockOffset: 0 },
    // The gate-house forecourt slab on the outer bailey, BEFORE the wall climb.
    { id: 'cp-bailey', p: [0, 6.55, 26.4], yaw: 0, clockOffset: 0 },
    // The outer rampart walk, BEFORE the breach. clockOffset 0.0 puts cart 1
    // (phase 0) at the WEST lip — you can board on the frame you respawn.
    { id: 'cp-rampart', p: [0, OUTER_WALK, 21.7], yaw: Math.PI, clockOffset: 0 },
    // The inner court (flat 19.00), BEFORE the Warden and the keep climb.
    // clockOffset 0 puts all three orbit movers at their +X pose, over the
    // middle walk, which is the pose the route is authored around.
    // Data lane 2026-09-05 (loop gate): at (0, 6) facing -Z the lens sat
    // against the middle wall (jammed at 2.49 m; the court is 8.6 m to the
    // wall's inner face and the keep fills the middle). The pad is now on the
    // court's west side, 1.8 m off the keep's west face, facing the turret
    // (ROUTE B's shaft) with 7 m of open court behind it.
    { id: 'cp-court', p: [-6.0, COURT_Y, 0.5], yaw: 0, clockOffset: 0 },
  ],

  /* ------------------------------------------------------------------------
   * CRESTS — 7, one of each type in the contract.
   * --------------------------------------------------------------------- */
  crests: [
    {
      id: 'open', type: 'open', name: 'CREST ON THE FLAGPOLE',
      hint: 'The keep roof. The stair, the shaft or the carts — pick one.',
      p: [0, 28.60, KEEP_Z],
    },
    {
      id: 'sigils', type: 'sigils', name: 'EIGHT SIGILS OF THE FORT',
      hint: 'Moat, causeway, rampart, breach, mill, flight, gallery, corner.',
      spawnAt: [0, COURT_Y + 1.45, 5.0],          // the inner court pedestal
    },
    {
      id: 'coins', type: 'coins', name: 'A HUNDRED COINS', threshold: 100,
      hint: '118 are lying about the knoll. You can miss eighteen.',
      spawnAt: [3.6, 8.00, 26.4],                 // the bailey pedestal
    },
    {
      id: 'secret', type: 'secret', name: 'WHAT THE WEST JAW GUARDS',
      trigger: 'gnasher-freed',
      hint: 'Pound the west post. Three times. Then look under the stair.',
      spawnAt: [-4.2, 4.60, 29.8],                // inside the cage
    },
    {
      id: 'boss', type: 'boss', name: 'THE WARDEN OF THE KEEP',
      hint: 'Jump the shockwave, dodge the charge into the wall, pound its back.',
      spawnAt: [0, COURT_Y + 1.60, 2.0],
    },
    {
      id: 'race', type: 'race', name: 'PORTCULLIS DASH',
      hint: 'From the broken grate to the flagpole. Fifty seconds.',
      start: [0, 18.30, 10.4], finish: [0, KEEP_TOP, KEEP_Z], limitMs: 50000,
      spawnAt: [2.6, 28.60, KEEP_Z + 2.2],
    },
    {
      id: 'metal', type: 'power', name: 'THE DROWNED CREST', power: 'metal',
      hint: 'Take the iron hat on the shore. It sinks. Walk the moat floor.',
      p: [0, -1.40, 39.5],
    },
  ],

  /* ------------------------------------------------------------------------
   * SIGILS — 8, every one on an OPTIONAL line the required route never takes:
   * a dive, a ride, a lip, a corner. Each is verified against the surface it
   * belongs to, and each hangs 1.35–1.45 m above it (single-jump-safe rise is
   * 1.61 m, so a walk-up-and-hop takes every one).
   * --------------------------------------------------------------------- */
  sigils: [
    { p: [14.0, -1.00, 34.0], note: '1 — the moat floor, east arm (floor −2.34): swim down for it' },
    { p: [0.0, 2.90, SINK_A_Z], note: '2 — over sinker A (top 1.55) — it is going down while you take it' },
    { p: [-21.7, OUTER_WALK + 1.40, 21.7], note: '3 — the outer walk\'s south-west corner merlon (walk 12.00)' },
    { p: [-7.4, OUTER_WALK + 1.40, BREACH_Z], note: '4 — the west lip of the breach, over the drop (walk 12.00)' },
    { p: [-16.0, 19.40, 1.8], note: '5 — the mill\'s gallery balcony (deck 18.00), inside the sweep' },
    { p: [12.2, 20.80, 0.0], note: '6 — over the fifth vanishing flagstone (top 19.40), mid-cycle' },
    { p: [-4.6, GALLERY + 1.40, -7.6], note: '7 — the keep gallery\'s north-west overhang (deck 23.30)' },
    { p: [21.7, OUTER_WALK + 1.40, -21.7], note: '8 — the outer walk\'s north-east corner, past the breach' },
  ],

  /* ------------------------------------------------------------------------
   * COINS — 118 placed, 100 needed. Every group pays for a line the player
   * chose; only the trail out of spawn is unmissable, because the first thirty
   * seconds teach with breadcrumbs and not with signs.
   * --------------------------------------------------------------------- */
  coins: [
    // BEAT 1 — the mown path from spawn down to the water. (10)
    // Data lane 2026-09-04: the game boots at checkpoints[0], not `spawn`, so
    // this trail used to start BEHIND the player, between hero and camera
    // (metre-wide pancakes in the first frame). It now enters from the side
    // and joins the path at the pad.
    ...trailCoins([[-5.5, 55.5], [-2, 53.4], [1, 50], [0, 47]], 10, 1.1),
    // BEAT 2 — the arc over each causeway gap; peak 1.2 m, exactly where a held
    // single jump puts you. (4 + 4)
    ...arcCoins([0, QUAY_TOP + 1.0, 44.7], [0, QUAY_TOP + 1.0, 43.0], 1.2, 4),
    ...arcCoins([0, QUAY_TOP + 1.0, 40.2], [0, QUAY_TOP + 1.0, 38.2], 1.2, 4),
    // BEAT 2 — a ring on the north quay: the breather before the jaws. (6)
    ...ringCoins(0, 32.6, 2.6, 6, QUAY_TOP + 1.1),
    // BEAT 3 — five inside the west jaw's 5.5 m reach. The whole point is that
    // you can price the risk from outside the chain and then decide. (5)
    { p: on(-6.0, 22.6, 1.2) }, { p: on(-8.4, 24.6, 1.2) }, { p: on(-3.6, 24.6, 1.2) },
    { p: on(-8.4, 28.4, 1.2) }, { p: on(-3.6, 28.4, 1.2) },
    // BEAT 3 — the causeway stair, and the coins that lead past the cage. (8)
    ...trailCoins([[0, 33], [0, 30], [0, 27]], 8, 1.6),
    // BEAT 4 — a ring round the HUNDRED COINS pedestal on the bailey slab. (8)
    ...ringCoins(0, 26.4, 3.4, 8, 7.55),
    // BEAT 4 — the outer rampart walk, south band, between the two corners. (10)
    { line: { a: [-16.0, OUTER_WALK + 1.05, 21.7], b: [16.0, OUTER_WALK + 1.05, 21.7], n: 10 } },
    // BEAT 4 — the arc across the breach: 5 over the carts, 5 on the far lip. (10)
    ...arcCoins([-6.6, OUTER_WALK + 1.1, BREACH_Z], [6.6, OUTER_WALK + 1.1, BREACH_Z], 1.5, 10),
    // BEAT 4 — the north band's east half, the reward for crossing. (6)
    { line: { a: [9.0, OUTER_WALK + 1.05, -21.7], b: [19.0, OUTER_WALK + 1.05, -21.7], n: 6 } },
    // BEAT 5 — one over every vanishing flagstone, so the cycle has a rhythm
    // you can see as well as hear. (6)
    { p: [18.6, 14.70, 0] }, { p: [17.0, 16.20, 0] }, { p: [15.4, 17.70, 0] },
    { p: [13.8, 19.20, 0] }, { p: [12.2, 20.70, 0] }, { p: [10.6, 22.20, 0] },
    // BEAT 6 — a ring on the mill's gallery balcony. (6)
    ...ringCoins(-16, 0, 2.0, 6, 19.10),
    // BEAT 6 — an arc off the gondola onto the middle walk. (5)
    ...arcCoins([-11.6, 21.0, 0], [-9.0, 21.0, 0], 1.1, 5),
    // BEAT 7 — the middle wall walk, north and east bands. (10)
    { line: { a: [-8.0, MID_WALK + 1.05, -9.0], b: [8.0, MID_WALK + 1.05, -9.0], n: 5 } },
    { line: { a: [9.0, MID_WALK + 1.05, -7.0], b: [9.0, MID_WALK + 1.05, 7.0], n: 5 } },
    // BEAT 8 — the inner court, a ring around the sigil pedestal. (8)
    ...ringCoins(0, 5.0, 4.4, 8, COURT_Y + 1.1),
    // BEAT 8 — the shaft: five stacked in the chimney, one per kick. (5)
    { p: [-7.4, 20.4, -7.4] }, { p: [-7.4, 22.0, -7.4] }, { p: [-7.4, 23.6, -7.4] },
    { p: [-7.4, 25.2, -7.4] }, { p: [-7.4, 26.8, -7.4] },
    // BEAT 8 — the keep's gallery balcony ring. (8)
    ...ringCoins(0, KEEP_Z, 4.9, 8, GALLERY + 1.1),
    // BEAT 8 — up the three merlon corbels to the cap. (5)
    { p: [0, 25.9, 5.2] }, { p: [0, 26.6, 4.6] }, { p: [0, 27.3, 4.0] },
    { p: [0, 28.0, 3.4] }, { p: [0, 28.5, 2.6] },
    // BEAT 10 — the moat floor, a ring around the drowned crest. (10)
    ...ringCoins(0, 39.5, 4.0, 10, -1.60),
    // BEAT 10 — the west arm of the moat, riding the current. (8)
    { line: { a: [-34.0, -1.40, 14.0], b: [-34.0, -1.40, -14.0], n: 8 } },
  ],

  /* ------------------------------------------------------------------------
   * POWERS — one metal hat on the shore (BEAT 10) and one inside the fort, so
   * a player who finds the moat crest late does not have to swim the whole
   * course again to try it.
   * --------------------------------------------------------------------- */
  powers: [
    { kind: 'metal', p: [4.6, 1.60, 46.8], duration: 25 },
    { kind: 'metal', p: [-4.6, QUAY_TOP + 0.9, 32.6], duration: 25 },
  ],

  /* ------------------------------------------------------------------------
   * OBJECTS — the built world, beat by beat.
   * --------------------------------------------------------------------- */
  objects: [

    /* ========================================================================
     * BEAT 1 — THE SOUTH SHORE
     * Fifteen seconds of nothing trying to hurt you, on a flat that is EXACTLY
     * 2.30 for 3.85 m around the spawn. The path is worn, the coins go where
     * the path goes, and the only thing on the skyline is the answer.
     * ===================================================================== */

    { kind: 'deco', kindOf: 'sign', p: on(3.2, 52, 1.15), s: [0.14, 1.7, 1.2], mat: 'wood', tint: TIMBER },
    { kind: 'deco', kindOf: 'post', p: on(3.2, 52, 0.65), s: [0.16, 1.3, 0.16], mat: 'wood', tint: 0x6b4a28 },
    { kind: 'text', p: [3.2, 4.25, 52], rot: [0, 0, 0], text: 'GNASHER FORT', size: 0.58, color: 0x2d3d1f },
    { kind: 'text', p: [3.2, 3.72, 52], rot: [0, 0, 0], text: 'THE STONES SINK WHEN YOU STAND ON THEM', size: 0.22, color: 0x4d6038 },
    { kind: 'text', p: [3.2, 3.35, 52], rot: [0, 0, 0], text: 'SO DO NOT STAND ON THEM', size: 0.22, color: 0x4d6038 },

    ...fenceRun(-14, 58, -6, 60),
    ...fenceRun(-6, 60, 4, 60), ...fenceRun(4, 60, 13, 57), ...fenceRun(-14, 58, -18, 52),

    /* ========================================================================
     * BEAT 2 — THE CAUSEWAY  (cp-shore -> cp-quay)
     * Eleven metres of open water between two stone quays, bridged by two
     * SINKER stones that start dropping 0.8 s after your weight lands and fall
     * at 1.2 m/s. Deck tops are all 1.55, so the run is dead level and the gaps
     * are 1.70 / 2.00 / 0.70 m — nothing at all against a 4.52 m single. The
     * lesson is TEMPO, and the punishment for learning it slowly is a swim in
     * a moat you were going to have to swim eventually anyway.
     * ===================================================================== */

    // South quay. Base −0.15 against ground 0.53: bedded into the shore at the
    // back and standing clear of the water at the front.
    { kind: 'platform', p: [0, 0.70, 46.8], s: [9.0, 1.7, 4.2], mat: 'stone', tint: STONE_OLD, stripe: true, edge: SAFE_EDGE },
    { kind: 'sinker', p: [0, 1.30, SINK_A_Z], s: [2.8, 0.5, 2.8], delay: 0.8, speed: 1.2, rise: 1.6, depth: 5.0, mat: 'stone', tint: STONE_OLD, stripe: true, edge: SAFE_EDGE },
    { kind: 'sinker', p: [0, 1.30, SINK_B_Z], s: [2.8, 0.5, 2.8], delay: 0.8, speed: 1.2, rise: 1.6, depth: 5.0, mat: 'stone', tint: STONE_OLD, stripe: true, edge: SAFE_EDGE },
    // North quay (cp-quay stands on this deck).
    { kind: 'platform', p: [0, 0.70, 32.6], s: [9.0, 1.7, 4.2], mat: 'stone', tint: STONE_OLD, stripe: true, edge: SAFE_EDGE },

    // Broken piers either side, so the moat reads as a crossing that USED to be
    // a road rather than as two rocks in a pond.
    { kind: 'deco', kindOf: 'pillar', p: [-4.6, 0.2, 39.2], s: [1.2, 3.0, 1.2], mat: 'stone', tint: STONE_OLD },
    { kind: 'deco', kindOf: 'pillar', p: [4.6, -0.1, 41.0], s: [1.1, 2.6, 1.1], rot: [0.12, 0.4, 0.06], mat: 'stone', tint: STONE_OLD },
    { kind: 'deco', kindOf: 'pillar', p: [-5.2, -0.2, 35.0], s: [1.1, 2.4, 1.1], rot: [-0.1, 0.9, 0.08], mat: 'stone', tint: STONE_OLD },
    { kind: 'deco', kindOf: 'debris', p: [5.0, 0.1, 35.6], s: [2.2, 0.7, 2.2], mat: 'stone', tint: STONE_OLD },

    // The moat's own current: gentle (2.6 m/s against a 4.5 m/s swim), running
    // east round the south arm. It is what makes the BEAT 10 floor walk a route
    // and not a stroll, and it teaches "the water moves" while you can still
    // stand up in it.
    { kind: 'current', p: [0, -1.40, 39.5], s: [34.0, 2.8, 10.0], dir: [1, 0, 0], power: 2.6 },
    { kind: 'text', p: [-4.4, 2.9, 44.0], rot: [0, 0.5, 0], text: 'IT IS ONLY WATER', size: 0.22, color: 0x35607a },

    /* ========================================================================
     * BEAT 3 — THE GNASHER GATE
     * Two jaws on 5.5 m chains, one either side of the road, their posts 3.5 m
     * behind them so the danger discs overlap across the lane: there is a safe
     * line up the middle and it is 3 m wide.
     * Data lane 2026-09-04 (critic r2): the posts stood 6.0 m off the centre
     * line, which made the lane 1 m, not 3 — and cp-bailey, ON that line at
     * the posts' own z, was 6.0 m from each post against a 6.5 m bite reach:
     * every respawn there was GNASHED 0.6 s later. Posts at 7.0 m (14 m apart)
     * give the 3 m lane the text promises, keep the net, the gate stair's foot
     * and the jump pad inside the discs, still cover the door's edges, and put
     * the pad 0.5 m outside the bite reach and outside aggro range at rest. Five coins sit inside the west
     * disc at eye level — see them from safety, then decide.
     * Pound the WEST post three times and the chain gives; the cage beside the
     * causeway stair springs, and the secret crest is inside it.
     * ===================================================================== */

    { kind: 'deco', kindOf: 'post', p: on(-7.0, 26.5, 1.1), s: [0.34, 2.2, 0.34], mat: 'wood', tint: 0x6b4a28 },
    { kind: 'deco', kindOf: 'post', p: on(7.0, 26.5, 1.1), s: [0.34, 2.2, 0.34], mat: 'wood', tint: 0x6b4a28 },
    { kind: 'text', p: on(0, 30.6, 1.7), rot: [0, 0, 0], text: 'POUND THE WEST POST  ·  THREE TIMES', size: 0.26, color: 0x7a2f2f },
    { kind: 'text', p: on(0, 30.6, 1.3), rot: [0, 0, 0], text: 'they can only reach so far', size: 0.20, color: 0x4d6038 },

    // The cage, beside the causeway stair's east cheek. It only opens on the
    // 'gnasher-freed' trigger; then you pound the cage itself.
    { kind: 'breakable', p: on(-4.2, 29.8, 1.1), s: [2.2, 2.2, 2.2], mat: 'wood', shape: 'cage', tint: 0x5a4128, drop: 'crest', openOn: 'gnasher-freed' },
    { kind: 'deco', kindOf: 'lantern', p: on(-4.2, 29.8, 2.9), s: [0.5, 0.7, 0.5], mat: 'metal', tint: GOLD },
    { kind: 'light', p: on(-4.2, 29.8, 2.6), color: GOLD, intensity: 6, distance: 12 },

    /* ------------------------------------------------------------------------
     * THE CAUSEWAY STAIR. Quay (1.55) -> the outer bailey (6.25) over 7.50 m of
     * run: 20 risers of 0.300 at 0.375, i.e. 38.7 deg — a fortress ramp, not a
     * domestic flight. Ascent is toward −Z, so rot [0, PI, 0] (builders.js
     * climbs toward LOCAL +Z, and eulerBasis's z column is what reachcheck
     * reads; deriving it from headingFromYaw instead points every flight
     * backwards). Bottom tread 0.55 at z 33.00, top 6.25 at z 25.88.
     * --------------------------------------------------------------------- */
    { kind: 'stairs', p: [0, 0.25, 29.44], w: 4.2, rise: 0.30, run: 0.375, n: 20, rot: [0, Math.PI, 0], mat: 'stone', tint: STONE_OLD },
    { kind: 'deco', kindOf: 'buttress', p: on(3.2, 29.0, 1.2), s: [4.4, 2.4, 0.5], rot: [0, Math.PI / 2, 0], mat: 'stone', tint: STONE_OLD },

    /* ========================================================================
     * BEAT 4 — THE OUTER WALL  (cp-bailey -> cp-rampart)
     * A 46 x 46 m ruin: interior floor 4.00, rampart walk 12.00, the walk ring
     * 3.40 m wide between |x|,|z| = 20.00 and 23.40. Corners stand on ground of
     * 2.49 and mid-faces on 7.05, so `footing: 6` is what stops the south-west
     * corner floating — the same lesson verdant-1's fort recorded.
     *
     * THREE independent ways up onto the walk, all static:
     *   A  THE GATE STAIR  outside the south-east face, 35.3 deg, always works.
     *   B  THE NET         5.00 m of rope on the south face, climb speed 2.6.
     *   C  THE JUMP PAD    a 6.20 m apex off the bailey: launch 6.65 -> 12.85,
     *                      landing on the walk at 12.00 (measured horizontal
     *                      reach 6.02 m against a 0.00 m gap — the pad is
     *                      under the walk's own overhang).
     * ===================================================================== */

    {
      kind: 'building', style: 'fort', p: [0, 8.0, 0], s: [46, 8.0, 46],
      mat: 'stone', tint: STONE_OLD, wall: 2.6, footing: 6.0, rampart: true, merlons: true,
      doors: [{ side: 'south', w: 5.0, h: 5.4 }, { side: 'north', w: 3.4, h: 4.2 }],
      // THE BREACH. The aperture is 6.00 m deep against a 3.33 m band, which is
      // deliberate: a shallower hole leaves a 0.43 m sliver of deck along the
      // walk's inner edge (rectSubtract keeps it, and so does builders.js), and
      // that sliver is a walkable bridge across the breach that makes the carts
      // decoration. Six metres cuts the band clean through.
      roofOpen: [{ x: 0, z: BREACH_Z, w: 14.0, d: 6.0 }],
    },

    // --- ROUTE A: the gate stair, hugging the south face. Foot 7.05 at x 10.0,
    //     top 11.70 at x 3.40 (0.30 m under the walk — a step). 16 risers of
    //     0.31 at 0.44 => 35.2 deg. Ascent toward −X, so rot [0, −PI/2, 0].
    { kind: 'stairs', p: [6.70, 6.74, 24.4], w: 2.6, rise: 0.31, run: 0.44, n: 16, rot: [0, -Math.PI / 2, 0], mat: 'stone', tint: STONE_OLD },

    // --- ROUTE B: the net. Foot on the bailey at 6.86, 5.00 m of rope, so the
    //     top rail is 11.86 — 0.14 m under the walk, which is a step off.
    { kind: 'net', p: on(6.0, 23.6, 0), s: [4.0, 5.0, 0.18], h: 5.0, r: 2.0, rot: [0, 0, 0], mat: 'rope', tint: 0xbfa77e },
    { kind: 'text', p: on(6.0, 26.8, 1.5), rot: [0, 0, 0], text: 'PRESS INTO THE NET TO CLIMB', size: 0.22, color: 0x4d6038 },

    // --- ROUTE C: the jump pad. `power` is a TARGET APEX IN METRES (hazards
    //     TRAP 3), not a velocity: 6.20 m off a 6.51 m deck reaches 12.71.
    { kind: 'jumppad', p: on(-8.0, 24.5, 0.14), s: [3.0, 0.28, 3.0], power: 6.2, dir: [0, 1, 0], mat: 'rubber', tint: 0x54c47a },
    { kind: 'text', p: on(-8.0, 27.6, 1.3), rot: [0, 0, 0], text: 'STAND ON IT', size: 0.24, color: 0x4d6038 },

    // --- the gate-house forecourt (cp-bailey stands here) and the pedestal the
    //     HUNDRED COINS crest rises from.
    { kind: 'platform', p: [0, 6.15, 26.4], s: [7.4, 0.8, 4.4], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'pedestal', p: [3.6, 6.55, 26.4], mat: 'stone', tint: STONE, glow: GOLD },

    // --- THE BREACH CARTS. Three linear movers on the same 16.00 m rail across
    //     the aperture, phase-staggered by a third of a period, decks at 12.15
    //     against a 12.00 walk. Boarding is a 0.15 m step at either lip because
    //     both end poses OVERLAP the surviving walk (west piece ends at x −7.00,
    //     the cart at x −8.00 spans −9.20 .. −6.80). The ring walk is whole on
    //     the other three sides, so the carts are a 16 m shortcut and never a
    //     gate — nothing required hangs off a mover in this course.
    { kind: 'mover', p: [-8.0, 11.90, -22.4], s: [2.4, 0.5, 2.8], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'linear', to: [8.0, 11.90, -22.4], period: 8.0, phase: 0.00, ease: 'sine', dwell: 0.5 } },
    { kind: 'mover', p: [-8.0, 11.90, -19.6], s: [2.4, 0.5, 2.8], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'linear', to: [8.0, 11.90, -19.6], period: 8.0, phase: 0.34, ease: 'sine', dwell: 0.5 } },
    { kind: 'mover', p: [-8.0, 11.90, -25.2], s: [2.4, 0.5, 2.8], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'linear', to: [8.0, 11.90, -25.2], period: 8.0, phase: 0.67, ease: 'sine', dwell: 0.5 } },
    { kind: 'text', p: [-11.0, OUTER_WALK + 1.5, -21.0], rot: [0, 0, 0], text: 'RIDE ONE  ·  OR WALK THE LONG WAY ROUND', size: 0.22, color: 0xd8c79a },

    // --- the walk's furniture. Braziers on the four corners so the ring reads
    //     at night-of-the-fog distances, and two banners at the gate.
    { kind: 'deco', kindOf: 'brazier', p: [-21.7, OUTER_WALK + 1.0, 21.7], s: [0.7, 1.6, 0.7], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'brazier', p: [21.7, OUTER_WALK + 1.0, 21.7], s: [0.7, 1.6, 0.7], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'brazier', p: [-21.7, OUTER_WALK + 1.0, -21.7], s: [0.7, 1.6, 0.7], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'brazier', p: [21.7, OUTER_WALK + 1.0, -21.7], s: [0.7, 1.6, 0.7], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'banner', p: [-3.2, 8.6, 23.6], s: [0.08, 2.8, 1.4], mat: 'cloth', tint: BANNER },
    { kind: 'deco', kindOf: 'banner', p: [3.2, 8.6, 23.6], s: [0.08, 2.8, 1.4], mat: 'cloth', tint: BANNER },
    { kind: 'light', p: [0, 10.4, 24.2], color: EMBER, intensity: 7, distance: 18 },
    { kind: 'light', p: [0, OUTER_WALK + 3.0, BREACH_Z], color: 0xbcd8f5, intensity: 6, distance: 20 },

    /* ========================================================================
     * BEAT 5 — THE MIDDLE WALL AND THE EAST FLIGHT
     * The scarp from the outer walk (12.00) up to the middle walk (21.40) is
     * 36–45 deg of grass: a slide, not a path, and that is the point. Six
     * VANISHING FLAGSTONES climb it on the east radius, +1.50 m and 0.20 m of
     * gap each (a 1.61 m safe vertical, so every step is a plain hop), on a
     * 3.4 s solid / 1.6 s gone cycle staggered half a second apart — so the
     * flight is a rhythm and standing still on it is the only way to fail.
     * Then the walk itself: two ROTOR bars, 2 arms, one turn per 7 s, sweeping
     * a 2.80 m walkway. They do not kill. They push.
     * ===================================================================== */

    {
      kind: 'building', style: 'fort', p: [0, 19.30, 0], s: [20, 4.2, 20],
      mat: 'stone', tint: STONE, wall: 2.0, footing: 8.0, rampart: true, merlons: true,
      // Floor 17.20 — chosen so the grand gate stair (BEAT 7) arrives at 18.24
      // INSIDE the south doorway rather than under it, and so the portcullis
      // fills an opening that starts on the stair's last tread.
      doors: [{ side: 'south', w: 3.6, h: 4.0 }],
    },

    // --- the east flight. Tops 13.40 / 14.90 / 16.40 / 17.90 / 19.40 / 20.90,
    //     the last 0.50 m under the middle walk. Terrain beneath them runs
    //     10.5 -> 17.4, so they sit 2.9–3.5 m clear of the scarp: flagstones on
    //     a ruined arcade, never mistakable for the ground.
    { kind: 'vanish', p: [18.6, 13.20, 0], s: [1.4, 0.4, 2.8], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE, cycle: { on: 3.4, off: 1.6, warn: 0.6, phase: 0.0 } },
    { kind: 'vanish', p: [17.0, 14.70, 0], s: [1.4, 0.4, 2.8], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE, cycle: { on: 3.4, off: 1.6, warn: 0.6, phase: 0.5 } },
    { kind: 'vanish', p: [15.4, 16.20, 0], s: [1.4, 0.4, 2.8], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE, cycle: { on: 3.4, off: 1.6, warn: 0.6, phase: 1.0 } },
    { kind: 'vanish', p: [13.8, 17.70, 0], s: [1.4, 0.4, 2.8], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE, cycle: { on: 3.4, off: 1.6, warn: 0.6, phase: 1.5 } },
    { kind: 'vanish', p: [12.2, 19.20, 0], s: [1.4, 0.4, 2.8], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE, cycle: { on: 3.4, off: 1.6, warn: 0.6, phase: 2.0 } },
    { kind: 'vanish', p: [10.6, 20.70, 0], s: [1.4, 0.4, 2.8], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE, cycle: { on: 3.4, off: 1.6, warn: 0.6, phase: 2.5 } },
    { kind: 'text', p: [20.4, 13.6, 0], rot: [0, -Math.PI / 2, 0], text: 'THEY COME BACK  ·  KEEP MOVING', size: 0.22, color: 0xd8c79a },

    // --- the rotor bars on the middle walk. `style: 'bar'` is a rideable solid
    //     (hazards/index.js): it shoves, it does not kill, which is the right
    //     verb for difficulty 2. `axis: 'y'` sweeps them flat across the walk.
    { kind: 'rotor', p: [0, MID_WALK + 0.55, -9.0], style: 'bar', arms: 2, len: 2.4, thick: 0.28, height: 0.9, period: 7.0, phase: 0.0, axis: 'y', dir: 1, mat: 'wood', tint: TIMBER },
    { kind: 'rotor', p: [9.0, MID_WALK + 0.55, 0], style: 'bar', arms: 2, len: 2.4, thick: 0.28, height: 0.9, period: 7.0, phase: 0.5, axis: 'y', dir: -1, mat: 'wood', tint: TIMBER },
    { kind: 'deco', kindOf: 'brazier', p: [-9.0, MID_WALK + 1.0, -9.0], s: [0.6, 1.4, 0.6], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'brazier', p: [9.0, MID_WALK + 1.0, 9.0], s: [0.6, 1.4, 0.6], mat: 'metal', tint: EMBER },
    { kind: 'light', p: [0, MID_WALK + 2.4, 0], color: 0xffd9a0, intensity: 9, distance: 24 },

    /* ========================================================================
     * BEAT 6 — THE WEST MILL  (the second way onto the middle walk)
     * The axle sits at 20.00 with a 7.13 m drum whose foot lands on ground of
     * 12.90 — the mill stands on the bailey, not in it. `deck` pins a GIMBALLED
     * gondola to each arm tip, so unlike a bare sail shelf it stays level all
     * the way round and is standable at the BOTTOM of the sweep:
     *   bottom pose  y 14.00, 1.10 m above the ground at (−16, 0)  -> a hop
     *   +X pose      y 20.20 at x −9.80, overlapping the middle walk's west
     *                band (|x| 7.60 .. 10.40) at 21.40  -> a 1.20 m step up
     * One turn per 11 s, `dir: -1`, so a gondola boarded at the bottom reaches
     * the walk in a quarter turn (2.75 s) rather than three quarters the long
     * way over the top.
     * ===================================================================== */

    { kind: 'mill', p: [-16.0, 20.0, 0], arms: 4, len: 6.2, period: 11.0, yaw: 0, dir: -1, tower: 7.13, towerR: 2.11, chord: 1.9, thick: 0.34, deck: { w: 2.2, d: 1.6, t: 0.4 }, mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [-16.0, 14.6, 3.4], rot: [0, 0, 0], text: 'STEP ON AT THE BOTTOM  ·  STEP OFF AT THE SIDE', size: 0.22, color: 0x6b5a3a },
    { kind: 'light', p: [-16.0, 22.0, 0], color: GOLD, intensity: 6, distance: 18 },

    /* ========================================================================
     * BEAT 7 — THE GRAND GATE STAIR AND THE PORTCULLIS  (-> cp-court)
     * The long way, and the only route that never asks for timing. 35 risers of
     * 0.335 at 0.414 (39.0 deg) run from the bailey at 6.85 (z 24.50), through
     * the outer wall's own 5.00 m south gateway, up the south scarp, to 18.24
     * at z 10.42 — the threshold of the middle wall's doorway (floor 17.20,
     * opening 17.20 .. 21.20). The court beyond is 19.00.
     * A BREAKABLE iron grate fills that opening. Pound it.
     * ===================================================================== */

    { kind: 'stairs', p: [0, 6.515, 17.46], w: 3.2, rise: 0.335, run: 0.414, n: 35, rot: [0, Math.PI, 0], mat: 'stone', tint: STONE },
    { kind: 'breakable', p: [0, 19.20, 9.4], s: [3.6, 4.0, 0.6], mat: 'metal', tint: IRON, shape: 'grate', drop: 'coins', dropCount: 6, trigger: 'portcullis-up' },
    { kind: 'text', p: [0, 17.0, 12.6], rot: [0, 0, 0], text: 'POUND THE PORTCULLIS', size: 0.28, color: 0xd8c79a },
    { kind: 'text', p: [0, 16.6, 12.6], rot: [0, 0, 0], text: 'PORTCULLIS DASH STARTS HERE  ·  50s', size: 0.20, color: 0x7a5a2a },
    { kind: 'platform', p: [0, 18.26, 10.4], s: [4.0, 0.2, 2.2], mat: 'stone', tint: 0xd8c79a },   // the race start pad
    { kind: 'deco', kindOf: 'buttress', p: [-3.0, 15.4, 12.0], s: [4.0, 3.0, 0.5], rot: [0, Math.PI / 2, 0], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'buttress', p: [3.0, 15.4, 12.0], s: [4.0, 3.0, 0.5], rot: [0, Math.PI / 2, 0], mat: 'stone', tint: STONE },

    /* ========================================================================
     * BEAT 8 — THE KEEP, THE WARDEN AND THE SHAFT
     * The inner court is the crown: EXACTLY 19.00 for 8.25 m around the axis,
     * 16.5 m across, fenced by the middle wall's 2.40 m parapet — which is the
     * wall the Warden's charge needs to break itself on.
     *
     * The keep: floor 19.00, roof deck 27.30, crest 28.60.
     *   ROUTE A  the east gallery stair (14 risers of 0.30, 40.0 deg) to the
     *            gallery at 23.30, then three merlon corbels: 23.30 -> 24.65
     *            (gap 1.20 m at +1.35) -> 26.05 (overlapping, +1.40) -> 27.45
     *            (overlapping, +1.40) -> the cap at 27.30, a step down.
     *   ROUTE B  the north-west turret's WALL-KICK SHAFT: 3.20 m clear, floor
     *            18.60, exit ledge 27.00. That is 8.40 m; one jump (1.91) plus
     *            four kicks (2.12 each) covers 10.39. From the ledge the cap is
     *            a 3.90 m single at +0.30 (safe there is 4.33 m, and the ledge
     *            gives 3.40 m of straight approach, which is all a single needs).
     * ===================================================================== */

    { kind: 'building', style: 'tower', p: [0, 23.10, KEEP_Z], s: [8.4, 8.2, 8.4], mat: 'stone', tint: STONE, footing: 6.0, merlons: true },
    { kind: 'platform', p: [0, 27.00, KEEP_Z], s: [9.2, 0.6, 9.2], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'flagpole', p: [2.6, KEEP_TOP + 2.0, KEEP_Z - 2.4], s: [0.12, 4.0, 0.12], mat: 'wood', tint: TIMBER },
    { kind: 'light', p: [0, KEEP_TOP + 1.8, KEEP_Z], color: GOLD, intensity: 10, distance: 20 },

    // --- ROUTE A: the gallery stair on the keep's east face. Foot 19.00 at
    //     z 4.00, top 22.90 at z −0.64, 0.40 m under the gallery deck: a step.
    { kind: 'stairs', p: [6.4, 18.70, 1.68], w: 2.6, rise: 0.30, run: 0.357, n: 14, rot: [0, Math.PI, 0], mat: 'stone', tint: STONE },
    // The gallery: a timber ring 1.30 m proud of the drum on every side, run
    // south far enough (z 5.50) to carry the three corbels.
    { kind: 'platform', p: [0, 23.05, -1.5], s: [11.0, 0.5, 14.0], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    // --- the three merlon corbels, gallery -> cap.
    { kind: 'platform', p: [0, 23.95, 4.6], s: [2.6, 1.4, 1.8], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [0, 25.35, 3.4], s: [2.6, 1.4, 1.8], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [0, 26.75, 2.2], s: [2.6, 1.4, 1.8], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },

    // --- ROUTE B: the north-west turret. Four slabs 0.40 m thick leaving a
    //     3.20 x 3.20 m shaft (limit 3.40) from 18.60 to 27.40, with a 1.30 m
    //     doorway split into the south face so you can only get IN at the
    //     bottom and only get OUT at the top.
    { kind: 'platform', p: [SHAFT_C[0], 18.30, SHAFT_C[1]], s: [3.2, 0.6, 3.2], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-9.2, 23.00, SHAFT_C[1]], s: [0.4, 8.8, 3.6], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [-5.6, 23.00, SHAFT_C[1]], s: [0.4, 8.8, 3.6], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [SHAFT_C[0], 23.00, -9.2], s: [4.0, 8.8, 0.4], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [-8.75, 23.00, -5.6], s: [1.3, 8.8, 0.4], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [-6.05, 23.00, -5.6], s: [1.3, 8.8, 0.4], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [SHAFT_C[0], 24.60, -5.6], s: [1.4, 5.6, 0.4], mat: 'stone', tint: STONE },   // the lintel
    // The exit ledge. Offset WEST so it never lids the chimney: its centre and
    // the shaft floor's centre bracket a midpoint of (−8.80, −7.40), which is
    // inside the clear interior — which is exactly where the kick ladder is.
    { kind: 'platform', p: [-10.2, 26.85, SHAFT_C[1]], s: [3.4, 0.3, 4.0], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [-5.2, 20.2, -6.6], rot: [0, -0.9, 0], text: 'KICK ONE WALL, THEN THE OTHER', size: 0.20, color: 0xd8c79a },

    // --- the court: the sigil pedestal, the Warden's braziers, and the sign.
    { kind: 'pedestal', p: [0, COURT_Y, 5.0], mat: 'stone', tint: STONE, glow: GOLD },
    { kind: 'deco', kindOf: 'brazier', p: [-5.2, COURT_Y + 1.1, 5.6], s: [0.7, 1.6, 0.7], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'brazier', p: [5.2, COURT_Y + 1.1, 5.6], s: [0.7, 1.6, 0.7], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'monolith', p: [-6.4, COURT_Y + 1.6, -2.0], s: [1.1, 3.2, 0.9], mat: 'stone', tint: 0x8e8a80 },
    { kind: 'deco', kindOf: 'monolith', p: [6.4, COURT_Y + 1.5, -2.0], s: [1.0, 3.0, 0.9], mat: 'stone', tint: 0x8e8a80 },
    { kind: 'light', p: [0, COURT_Y + 3.4, 3.0], color: 0xffe0b0, intensity: 9, distance: 22 },
    { kind: 'text', p: [-6.0, COURT_Y + 2.6, 7.4], rot: [0, 0.6, 0], text: 'JUMP THE WAVE  ·  DODGE THE CHARGE  ·  POUND ITS BACK', size: 0.22, color: 0x8c5a3a },

    /* ========================================================================
     * BEAT 9 — THE ORBIT  (the set piece)
     * Three platforms circling the keep at radii 7.40 / 6.60 / 5.80 about
     * (0, −3.00), decks at 22.80 / 24.30 / 25.80, one revolution every 13 / 11 /
     * 9 s in alternating directions. Board from the middle walk (21.40) where
     * the outermost passes over the west and east bands — a 1.40 m step — then
     * 1.50, 1.50 and a final 1.50 onto the cap at 27.30. Behind it all the mill
     * sweeps and the flagstones blink out one at a time.
     * Nothing REQUIRED hangs off these: ROUTE A reaches the same cap by stairs.
     * ===================================================================== */

    { kind: 'mover', p: [7.4, 22.55, KEEP_Z], s: [2.8, 0.5, 2.8], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'circle', radius: 7.4, axis: 'y', period: 13.0, phase: 0.0, dir: 1, ease: 'linear' } },
    { kind: 'mover', p: [6.6, 24.05, KEEP_Z], s: [2.6, 0.5, 2.6], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'circle', radius: 6.6, axis: 'y', period: 11.0, phase: 0.0, dir: -1, ease: 'linear' } },
    { kind: 'mover', p: [5.8, 25.55, KEEP_Z], s: [2.4, 0.5, 2.4], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'circle', radius: 5.8, axis: 'y', period: 9.0, phase: 0.0, dir: 1, ease: 'linear' } },
    { kind: 'text', p: [9.6, MID_WALK + 1.6, 3.0], rot: [0, -Math.PI / 2, 0], text: 'THREE RINGS  ·  ONE STEP EACH', size: 0.22, color: 0xd8c79a },

    /* ========================================================================
     * BEAT 10 — THE DROWNED CREST
     * An iron hat on the south shore makes you heavy: you sink instead of
     * swimming, and the moat floor at −2.76 becomes ground for 25 seconds. The
     * current runs east at 2.6 m/s, so the walk out is not the walk back.
     * ===================================================================== */

    { kind: 'deco', kindOf: 'pillar', p: [0, -1.6, 43.0], s: [1.0, 2.2, 1.0], mat: 'stone', tint: STONE_OLD },
    { kind: 'deco', kindOf: 'statue', p: [0, -0.8, 36.0], s: [1.4, 2.6, 1.4], mat: 'stone', tint: 0x8e8a80 },
    { kind: 'deco', kindOf: 'debris', p: [-8.0, -2.2, 39.0], s: [3.0, 0.8, 3.0], mat: 'stone', tint: STONE_OLD },
    { kind: 'deco', kindOf: 'debris', p: [9.0, -2.2, 38.0], s: [2.6, 0.7, 2.6], mat: 'stone', tint: STONE_OLD },
    { kind: 'light', p: [0, 1.2, 39.5], color: 0x8fd8ff, intensity: 6, distance: 20 },
    { kind: 'text', p: [4.6, 3.0, 46.8], rot: [0, -0.4, 0], text: 'IRON SINKS', size: 0.24, color: 0x35607a },

    /* ========================================================================
     * DRESSING — repeated kinds only, all instanced, all seeded by `ihash`, so
     * the meadow dresses itself identically every load and `reset()` never moves
     * a tree (hard rule 3). Every scatter is OUTSIDE the moat and the fort:
     * KEEPOUT covers the whole knoll, so nothing can land in a walk, a sweep or
     * a shaft the way verdant-1's scatter 9005 once did.
     * ===================================================================== */

    ...scatter(-44, 34, 6, 18, 6, 51001, (x, z, rnd) => (
      gy(x, z) < 1.9 ? null
        : { kind: 'tree', p: on(x, z, -0.25), h: 7.0 + rnd * 4.0, r: 2.3 + rnd * 1.2, mat: 'bark', tint: 0x9c7852, leafTint: LEAF, seed: 51001 + Math.round(x) }
    )),
    ...scatter(44, 40, 6, 16, 5, 51002, (x, z, rnd) => (
      gy(x, z) < 1.9 ? null
        : { kind: 'tree', p: on(x, z, -0.25), h: 6.5 + rnd * 4.0, r: 2.2 + rnd * 1.1, mat: 'bark', tint: 0x9c7852, leafTint: 0x59a047, seed: 51002 + Math.round(x) }
    )),
    ...scatter(-40, -46, 7, 19, 5, 51003, (x, z, rnd) => (
      gy(x, z) < 1.9 ? null
        : { kind: 'tree', p: on(x, z, -0.25), h: 6.5 + rnd * 3.5, r: 2.1 + rnd * 1.1, mat: 'bark', tint: 0x94704c, leafTint: 0x4e8f3f, seed: 51003 + Math.round(x) }
    )),
    ...scatter(46, -40, 6, 17, 5, 51004, (x, z, rnd) => (
      gy(x, z) < 1.9 ? null
        : { kind: 'tree', p: on(x, z, -0.25), h: 6.0 + rnd * 3.5, r: 2.0 + rnd * 1.0, mat: 'bark', tint: 0x94704c, leafTint: 0x4e8f3f, seed: 51004 + Math.round(x) }
    )),

    ...scatter(0, 0, 54, 66, 22, 52001, (x, z, rnd) => (
      gy(x, z) < 1.6 ? null
        : { kind: 'deco', kindOf: 'bush', p: on(x, z, 0.34), s: [1.0 + rnd, 0.7 + rnd * 0.6, 1.0 + rnd], mat: 'leaves', tint: 0x568c40, count: 3, spread: 2.8, jitter: 0.32 }
    )),
    ...scatter(0, 0, 50, 64, 20, 52002, (x, z, rnd) => (
      gy(x, z) < 1.5 ? null
        : { kind: 'deco', kindOf: 'flowerbed', p: on(x, z, 0.08), s: [1.5 + rnd * 1.3, 0.22, 1.4 + rnd * 1.2], mat: 'leaves', tint: rnd > 0.6 ? 0xf0d24e : FLOWER, count: 4, spread: 3.0, jitter: 0.36 }
    )),
    ...scatter(0, 0, 47, 62, 16, 52003, (x, z, rnd) => (
      gy(x, z) < 1.5 ? null
        : { kind: 'deco', kindOf: 'plant', p: on(x, z, 0.24 + rnd * 0.2), s: [0.6 + rnd * 0.4, 0.8 + rnd * 0.7, 0.6 + rnd * 0.4], mat: 'leaves', tint: rnd > 0.5 ? 0x5f8f45 : 0x6f9f4f, count: 5, spread: 2.6, jitter: 0.38 }
    )),
    // Reeds at the water line only (ground 0.20 .. 1.30 is the shore band).
    ...scatter(0, 0, 44, 50, 18, 52004, (x, z, rnd) => (
      gy(x, z) < 0.20 || gy(x, z) > 1.30 ? null
        : { kind: 'deco', kindOf: 'plant', p: on(x, z, 0.35 + rnd * 0.3), s: [0.7, 0.9 + rnd * 0.8, 0.7], mat: 'leaves', tint: 0x5f8f45, count: 4, spread: 2.2, jitter: 0.35 }
    )),
    // Fallen masonry on the bailey ring — the fort has been ruined a long time.
    ...scatter(0, 0, 24, 30, 10, 52005, (x, z, rnd) => (
      { kind: 'rock', p: on(x, z, -0.35), r: 0.8 + rnd * 1.3, seed: 52005 + Math.round(x), mat: 'stone' }
    )),
    ...scatter(0, 0, 56, 66, 10, 52006, (x, z, rnd) => (
      gy(x, z) < 1.8 ? null : { kind: 'rock', p: on(x, z, -0.4), r: 0.9 + rnd * 1.4, seed: 52006 + Math.round(x), mat: 'stone' }
    )),
  ],

  /* ------------------------------------------------------------------------
   * CRITTERS
   * --------------------------------------------------------------------- */
  critters: [
    // THE TWO JAWS. Posts 3.50 m behind each head and 14.00 m apart across the
    // road (7.00 m off the centre line — see BEAT 3), chains of 5.50 m: the two
    // danger discs overlap the lane but leave a walkable 3 m down the middle. Only the WEST one's post is wired to the
    // cage — the east one is there so you cannot tell which until you look.
    {
      kind: 'gnasher', p: [-7.0, 6.20, 23.0], chain: 5.5,
      post: [-7.0, 5.40, 26.5], postHits: 3, trigger: 'gnasher-freed',
      telegraph: 0.5, tint: 0x3c4450,
    },
    {
      kind: 'gnasher', p: [7.0, 6.20, 23.0], chain: 5.5,
      post: [7.0, 5.40, 26.5], postHits: 3, trigger: 'gnasher-east-freed',
      telegraph: 0.5, tint: 0x3c4450,
    },
    // BUMBLERS. Side contact is knockback, not death (contract §23). Four, all
    // on ground flat enough that the waddle reads from the far shore.
    { kind: 'bumbler', path: [on(-6, 50), on(6, 50), on(2, 56), on(-6, 50)], speed: 1.4 },
    { kind: 'bumbler', path: [[-21.7, OUTER_WALK, 21.7], [-21.7, OUTER_WALK, -14.0], [-21.7, OUTER_WALK, 21.7]], speed: 1.6 },
    { kind: 'bumbler', path: [[-9.0, MID_WALK, 9.0], [9.0, MID_WALK, 9.0], [9.0, MID_WALK, -9.0], [-9.0, MID_WALK, 9.0]], speed: 1.5 },
    { kind: 'bumbler', path: [[-5.0, COURT_Y, 7.0], [5.0, COURT_Y, 7.0], [5.0, COURT_Y, 1.0], [-5.0, COURT_Y, 7.0]], speed: 1.7 },
    // SKITTERS. One patrols the moat above the causeway (it swoops at anyone
    // dawdling on a sinker); one circles the breach.
    { kind: 'skitter', p: [0, 4.6, 40.0], path: [[-14, 4.6, 42.0], [14, 5.8, 36.0]], amp: 1.6, speed: 3.4 },
    { kind: 'skitter', p: [0, 16.0, -26.0], path: [[-14, 16.0, -26.0], [14, 18.0, -30.0]], amp: 2.0, speed: 3.8 },
    // THE WARDEN. Three hits, in the inner court (EXACTLY 19.00), with the
    // middle wall's 2.40 m parapet as the wall its charge has to break on.
    { kind: 'warden', p: [0, COURT_Y, 3.0], arena: { c: [0, 2.0], r: 6.4 }, hp: 3, tint: 0x6d7a86 },
  ],
};
