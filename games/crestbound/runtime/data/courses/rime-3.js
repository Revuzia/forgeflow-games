/**
 * CRESTBOUND — RIME SPIRE 3 : "BLIZZARD PEAK"
 * runtime/data/courses/rime-3.js                                    CONTRACT §25
 * ===========================================================================
 *
 * The tallest mountain in the game and the last course before the Sanctum. An
 * OPEN DIORAMA about 130 x 130 m across a 150 x 150 m heightfield: a cone
 * mountain rising 1.0 -> 35.2 m of ground with a shrine on the cap at 38, a
 * BASE CAMP on the southern snowfield, a spiral of carved ledges up the west
 * face in a standing gale, a GORGE torn diagonally through the north-west
 * flank with a rope bridge over it, a terrace of ice on the east shoulder with
 * a crusher cave cut into the cliff behind it, and a stone stair-viaduct
 * climbing the last 8 m to the shrine gate where the Warden waits.
 *
 * Difficulty 7. Everything the realm taught (ice, slope, vanish, mills) is
 * remixed here and the WIND is the new verb: it never kills, it only pushes,
 * and every exposed ledge is authored wide enough to survive being pushed.
 *
 *   BEAT 1  BASE CAMP        the last flat ground. Signs, tents, a bumbler.
 *   BEAT 2  THE WEST FACE    wind volumes, carved shelves, pendulum logs,
 *                            a snow mill, and the first two sigils
 *   BEAT 3  THE GORGE        the set piece: a rope bridge in a gust, a stone
 *                            pier in the middle, a vanish-ice line beside it,
 *                            and a frozen fall at the bottom nobody finds
 *   BEAT 4  THE NORTH FLANK  open snow, ice slabs, rotor ice-wheels, bumblers
 *   BEAT 5  THE EAST SHOULDER the ice-shelf stair and the mill lift (ROUTE B)
 *   BEAT 6  THE CRUSHER CAVE crushers, beam tripwires, a wall-kick chimney
 *   BEAT 7  THE SHRINE STAIR a viaduct of stairs, prayer wheels, the Warden
 *   BEAT 8  RACE / WINGS     two optional overlays across the whole mountain
 *
 * ---------------------------------------------------------------------------
 * ROUTES TO THE OPEN CREST (three, and they converge on the north flank)
 * ---------------------------------------------------------------------------
 *   A  THE SPIRAL   base camp -> west shelves -> ROPE BRIDGE -> north flank ->
 *                   ICE-SHELF STAIR -> terrace -> crusher cave -> WALL-KICK
 *                   CHIMNEY -> stair viaduct -> shrine. Fully STATIC: every
 *                   required surface is authored geometry or walkable ground,
 *                   and nothing on it is a moving platform.
 *   B  THE MILL LIFT east flank -> board the east mill's gondola at the bottom
 *                   of its sweep (deck 12.65 over ground 11.83) -> ride a
 *                   quarter turn to the 9 o'clock pose at 20.65 -> step off
 *                   onto the terrace at 19.6. Skips the whole ice-shelf stair.
 *                   ROUTE A covers the same climb statically, so the reach
 *                   gate never has to credit the ride.
 *   C  THE GORGE    slide into the chasm off the bridge (a 13 m drop onto ice,
 *                   not a death), walk the frozen floor east, pound the FROZEN
 *                   FALL for the secret, then the CREVASSE CHIMNEY: a 2.8 m
 *                   shaft, 4 wall kicks, out onto the north flank at 15.8.
 *
 * ---------------------------------------------------------------------------
 * THE TERRAIN SAMPLER — a transliteration of world/terrain.js `sampleHeights`
 * ---------------------------------------------------------------------------
 * `terrainHeightAt(x, z)` below is the RECIPE branch of terrain.js's own
 * sampler, copied operation for operation, because that function is what the
 * heightfield collider AND `_harness/reachcheck.mjs` evaluate. It runs, in
 * this order:
 *
 *   1. y = base
 *   2. HILLS   for each {p:[hx,hz], r, h}: d = hypot(x-hx, z-hz)
 *              if d < r:  k = bump(d/r);  y += h * (k*k*(3-2k))
 *   3. RIDGES  for each {a, b, w, h}: HALF-WIDTH is w/2 (this is the trap —
 *              `w` is the FULL width of the channel), d = distance to the
 *              SEGMENT a..b; if d < w/2:  y += h * bump(d / (w/2))
 *   4. NOISE   y += fbm(x*freq, z*freq, seed, 4 octaves) * amp
 *   5. FLATS   for each {p, r, h} IN ARRAY ORDER: d = hypot(x-fx, z-fz)
 *              if d < r:  t = d/r;  k = t <= 0.55 ? 1 : bump((t-0.55)/0.45)
 *              y += (h - y) * k
 *              (dead level inside 0.55*r, melting into the mountain at the rim)
 *
 *   bump(t) = 0.5 * (1 + cos(PI * t))         — 1 at the centre, 0 at the rim
 *   fbm is 4 octaves of bilinear value noise, gain 0.5, lacunarity 2.03,
 *   quintic-faded, on the integer lattice with a Math.imul hash, so the 32-bit
 *   wraparound is identical in every JS engine.
 *
 * MEASURED SLOPES on the mountain (probe step 0.5 m, `slideDeg` is 38):
 *     base camp -> west face      21 - 28 deg   walk
 *     west face at the shelves    28 - 35 deg   walk (the wind is the danger)
 *     north flank cp4 -> east     26 - 37 deg   walk
 *     the gorge walls             45 - 73 deg   SLIDE — deliberate, that is
 *                                               how ROUTE C is entered
 *     the summit massif d 9..14   50 - 77 deg   CLIFF — the reason the cave,
 *                                               the chimney and the viaduct
 *                                               exist at all
 *     the summit cap  d <= 8      0 - 20 deg    walk (the shrine sits on it)
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS (contract §25 + runtime/data/index.js) — same as verdant-1.js
 * ---------------------------------------------------------------------------
 *   p            CENTRE, [x, y, z].  s = FULL size, [sx, sy, sz].
 *                => a platform's walkable top is p[1] + s[1]/2.
 *   yaw          RADIANS. yaw 0 faces -Z. +yaw is counter-clockwise from above.
 *   rot          Euler XYZ radians.
 *   stripe:true  "you had to jump to get here" — earns the bright leading edge.
 *                Walk-on ground and every piece of decor never gets one.
 *   cycle {}     SECONDS.  mover/rotor/crusher/mill `phase` is a FRACTION 0..1.
 *   wind.power   m/s^2.    jumppad.power would be METRES (none here).
 *
 * ---------------------------------------------------------------------------
 * THE REACH BUDGET ACTUALLY USED (safe limits from core/tuning.js REACH_TABLE:
 * single 4.52 flat / 3.88 at +1.0 / 3.28 at +1.6; double 5.24; triple 6.11;
 * long jump 6.42; wall kick +2.12 per kick in a shaft <= 3.40 m wide)
 * ---------------------------------------------------------------------------
 *   longest REQUIRED gap      3.00 m at +0.45   BEAT 3, deck -> pier
 *                             (single-safe at that rise is ~3.9 m and the
 *                              approach is 4.4 m of straight bridge deck)
 *   tallest REQUIRED step     1.84 m            BEAT 5, ground -> ice shelf 1
 *                             (single's own apex is 1.91 m, no run-up needed)
 *   REQUIRED wall kicks       the CAVE CHIMNEY, 3.20 m clear, 19.60 -> 27.70:
 *                             one jump plus four kicks (measured 8.10 m)
 *   longest OPTIONAL gap      3.40 m            BEAT 2, W-C -> the west spire
 *   riskiest OPTIONAL line    the VANISH ICE across the gorge — five tiles on
 *                             a 3.2 s cycle, 13 m over the frozen floor
 * Nothing here REQUIRES a triple, a long jump or a dive. All three shorten the
 * course and every one of them is signed.
 *
 * CONTENT LEDGER: 8 sigils · 7 crests · 114 coins · 6 checkpoints ·
 * hazard families: wind, pendulum, mill, vanish, crusher, beam, rotor, rings,
 * ice, breakable, mover  + critters gnasher, bumbler x3, skitter x3, warden.
 */

/* ===========================================================================
 * 0. Palette — RIME SPIRE
 * ======================================================================== */

const SNOW = 0xf2f8ff;       // lit snow
const ICE = 0x9fd8ef;        // blue glacier ice
const STONE = 0xb9c6d6;      // cold shrine granite
const TIMBER = 0x8a7a70;     // bridge planks, camp posts
const ROPE = 0xbcae94;       // the bridge cables
const AURORA = 0x6fffd0;     // the sky's own green
const GOLD = 0xffd04a;       // crest / coin glow
const SIGIL_C = 0xc07bff;    // sigil violet
const EMBER = 0xffa042;      // the camp fires — the only warm thing below
const SAFE_EDGE = 0xffe9a8;  // leading-edge stripe (theme palette.safeEdge)

/* ===========================================================================
 * 1. THE HEIGHTFIELD — every `p` in this file is justified against it
 * ======================================================================== */

/** Heightfield definition. Consumed verbatim by world/terrain.js (contract §18). */
const HEIGHTS = {
  seed: 20260903,
  base: 1.0,
  hills: [
    // THE MOUNTAIN. r 62 / h 20 keeps the walking skirt under the 38 deg slide
    // threshold everywhere (measured max 37.3 deg), so the lower two thirds of
    // the cone is snowfield you can actually walk on and the hazards, not the
    // gradient, are what stop you.
    { p: [0, -4], r: 62, h: 20.0 },
    // THE SUMMIT MASSIF. r 26 / h 13 puts a 50-77 deg cliff band between d 9
    // and d 14 — the wall the cave, the chimney and the viaduct exist to beat.
    { p: [0, -4], r: 26, h: 13.0 },
    // Foothills that close the diorama on all four sides.
    { p: [-52, 34], r: 20, h: 4.0 },
    { p: [50, 34], r: 20, h: 3.4 },
    { p: [58, -30], r: 22, h: 5.0 },
    { p: [-58, -34], r: 22, h: 5.5 },
  ],
  ridges: [
    // THE GORGE. A negative ridge is a channel: `w` is the FULL width, so this
    // is 16 m across and 14 m deep at its centre line, torn diagonally from the
    // north-west skirt up into the massif. Floor: -11.7 at the outer end,
    // -6.3 under the bridge, +6.6 at the inner end — a ravine that climbs, which
    // is what makes ROUTE C a route and not a pit.
    { a: [-47.4, -36.1], b: [-12.4, -9.4], w: 16.0, h: -14.0 },
  ],
  noise: { amp: 0.45, freq: 0.05 },
  flats: [
    { p: [0, 44], r: 13, h: 2.2 },        // BASE CAMP            (spawn, cp1)
    { p: [-25.2, 32.0], r: 8, h: 3.4 },   // west face 1/3        (cp2)
    { p: [-36, -13], r: 6.5, h: 6.6 },    // the gorge's near lip (cp3)
    { p: [-23.8, -30.7], r: 8, h: 8.0 },  // the bridge's far end (cp4)
    { p: [19, 2], r: 12, h: 19.6 },       // THE ICE TERRACE      (cp5)
    { p: [0, -4], r: 13, h: 35.2 },       // THE SUMMIT CAP       (shrine)
  ],
};

/* --- the sampler (formula in the header) --------------------------------- */

/** Smooth radial falloff: 1 at the centre, 0 at (and past) the rim. */
function bump(t) {
  if (t >= 1) return 0;
  if (t <= 0) return 1;
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

/** Integer hash in [0, 1). Math.imul so the 32-bit wrap is engine-identical. */
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

/** Fractal value noise in roughly [-1, 1]. Four octaves, gain .5, lac 2.03. */
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

/** Distance from (px,pz) to the SEGMENT a..b (clamped at both ends). */
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
 * an exact transliteration of world/terrain.js `sampleHeights` for a recipe
 * spec — so the mesh, the heightfield collider and _harness/reachcheck.mjs all
 * agree with the numbers written in the comments below.
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
    const w = R.w * 0.5;                       // `w` is the FULL channel width
    const d = segDist(x, z, R.a, R.b);
    if (d < w) y += R.h * bump(d / w);
  }

  y += fbm(x * HEIGHTS.noise.freq, z * HEIGHTS.noise.freq, HEIGHTS.seed, 4) * HEIGHTS.noise.amp;

  for (let i = 0; i < HEIGHTS.flats.length; i++) {
    const F = HEIGHTS.flats[i];
    const d = Math.hypot(x - F.p[0], z - F.p[1]);
    if (d < F.r) {
      const t = d / F.r;
      const k = t <= 0.55 ? 1 : bump((t - 0.55) / 0.45);
      y += (F.h - y) * k;
    }
  }
  return y;
}

/* ===========================================================================
 * 2. Authoring helpers — every one resolves against the heightfield, so no
 *    placement in this file is a guess. (Same set verdant-1.js uses.)
 * ======================================================================== */

const gy = terrainHeightAt;
const r2 = (v) => Math.round(v * 100) / 100;

/** A point ON the ground at (x, z), lifted `up` metres. */
function on(x, z, up) { return [r2(x), r2(gy(x, z) + (up || 0)), r2(z)]; }

/** Centre of a box of full height `sy` whose base sits on the ground, sunk `sink` m. */
function seat(x, z, sy, sink) { return [r2(x), r2(gy(x, z) - (sink || 0) + sy / 2), r2(z)]; }

/**
 * Coins along a jump ARC from a to b, peaking `h` above the chord. Expanded to
 * explicit {p} entries rather than shipped as a new def kind, so an arc can
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
 * a trail on a mountain this steep; this cannot.
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

/**
 * KEEP-OUT VOLUMES. Every scattered prop is dropped if it lands inside one, so
 * no seeded snowdrift can ever end up inside a mill's sweep, on the bridge, in
 * the wall-kick chimney or on the shrine cap — the class of bug that made
 * verdant-1's ROUTE B unperformable for a whole round.
 *
 * Rects are [x0, x1, z0, z1] in world metres, already margined.
 */
const KEEPOUT = [
  [-42.0, -26.0, 6.0, 12.0],    // BEAT 2: the west mill's 6.0 m sail disc @ (-34, 0) is
  [-41.0, -27.0, -6.0, 6.0],    //         a vertical disc in the plane z = 0
  [-38.0, -18.0, -34.0, -8.0],  // BEAT 3: the gorge, the bridge, the vanish line, the chimney
  [20.0, 40.0, -16.0, 4.0],     // BEAT 5: the east mill's 8.0 m sail disc @ (30, -6)
  [12.0, 27.0, -7.0, 3.0],      // BEAT 6: the crusher cave and its chimney
  [8.0, 18.0, -16.0, -2.0],     // BEAT 7: the shrine stair viaduct
  [-14.0, 14.0, -18.0, 10.0],   // BEAT 7: the summit cap, the shrine and the arena
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
 * Seeded by `ihash`, so the mountain dresses itself identically every load and
 * `reset()` never moves a drift (contract hard rule 3). Points inside a KEEPOUT
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

/* BEAT 3 — THE GORGE. The chasm's centre line runs (-47.4,-36.1) -> (-12.4,-9.4);
 * the bridge crosses it square, along u = (0.607, -0.795). Measured ground:
 * near lip (-36.0,-14.9) 6.60 (a flat) · chasm floor under the pier -6.26 ·
 * far lip (-23.9,-30.4) 8.00 (a flat). The pier is a 12 m ice column standing
 * on that floor; falling past it is a 13 m drop onto ROUTE C, not a death. */
const BR_A = [-36.0, 6.60, -14.9];      // near lip, on the cp3 flat
const BR_A_END = [-33.6, 6.30, -18.6];  // where the deck breaks off
const PIER = [-30.8, -22.5];            // the ice column, cap top 6.75
const PIER_TOP = 6.75;
const BR_B_START = [-28.2, 6.60, -26.6];
const BR_B = [-23.9, 7.95, -30.4];      // far lip, on the cp4 flat

/* BEAT 5 — THE EAST MILL (ROUTE B). Axle 20.40, arms 8.00, tower 8.50 => the
 * gondola's bottom pose sits at 12.65 over ground 11.83 (a 0.82 m hop) and its
 * 9 o'clock pose at 20.65, one metre over the terrace lip at 19.60. The tower's
 * gallery balcony lands at 17.96 and carries sigil 3. */
const MILL_E = [30, 20.40, -6];
const MILL_E_GAL = 17.96;

/* BEAT 6 — THE CRUSHER CAVE, cut into the cliff at the back of the terrace.
 * Floor is the terrace itself (EXACTLY 19.60 inside 6.6 m of (19, 2)); the
 * chimney is 3.20 m clear and lifts 8.10 m to the exit ledge — one jump plus
 * four kicks at ~2.12 m each (REACH_TABLE.wallkick, shaft limit 3.40 m). */
const TERRACE_Y = 19.60;
const CHIMNEY_TOP = 27.70;

/* BEAT 7 — THE SUMMIT. Cap is EXACTLY 35.20 inside 7.15 m of (0, -4) and the
 * walkable cap runs out to d = 8 (slope 19.8 deg); d = 9 is already 49.9 deg. */
const SUMMIT_Y = 35.20;
const GATE_TOP = 35.10;                 // the shrine gate landing (cp6)

/* ===========================================================================
 * 4. THE COURSE
 * ======================================================================== */

export default {
  id: 'rime-3',
  realm: 'rime',
  theme: 'rime',
  name: 'BLIZZARD PEAK',
  subtitle: 'A gale, a gorge and a shrine on the cap',
  order: 3,
  difficulty: 7,
  music: 'rime',

  /* Par times per crest id (ms) — the HUD shows them, nothing gates on them. */
  par: {
    open: 190000, sigils: 380000, coins: 420000,
    secret: 210000, boss: 240000, race: 90000, wing: 200000,
  },

  /* Spawn on the base-camp flat (EXACTLY 2.20), yaw 0 => facing -Z, straight up
     the mountain: the west shelves on the left, the gorge's shadow beyond them,
     the mill turning on the right shoulder and the shrine on the cap. The whole
     climb is legible from here; that is the job of the first two seconds. */
  spawn: { p: [0, 2.2, 46], yaw: 0 },
  killY: -30,
  bounds: { min: [-78, -34, -78], max: [78, 56, 78] },

  intro: {
    text: 'Everything above the camp is wind. It will not kill you — it will only ever push, and the ledges were cut wide enough for that.',
    cam: [
      { p: [0, 30, 74], look: [0, 20, -4], t: 0 },
      { p: [-48, 26, 18], look: [-4, 16, -14], t: 3.0 },
      { p: [6, 8, 56], look: [0, 30, -4], t: 6.0 },
    ],
  },

  ambience: { wind: 0.95, snow: 0.75, birds: 0.10 },

  /* ------------------------------------------------------------------------
   * TERRAIN — no water anywhere on this course; everything here is frozen.
   * `grass: {count: 0}` opts the blade field out entirely (terrain.js returns
   * null under a 32-blade budget), which is both correct for snow and worth
   * ~36 k triangles against the perf ceiling.
   * --------------------------------------------------------------------- */

  terrain: {
    kind: 'terrain',
    origin: [-75, -75],
    size: [150, 150],
    res: 1.0,
    surface: 'snow',
    heights: HEIGHTS,
    grass: { count: 0 },
    // Trodden snow tracks: darker, packed, no drift. These are the lines the
    // coins follow, and on a mountain with no walls they are the only way the
    // eye is led at all.
    paths: [
      { pts: [[0, 46], [-8, 39], [-16, 36], [-24, 33]], w: 3.4 },          // camp -> west face
      { pts: [[-27, 28], [-32.6, 20], [-35.4, 13.5], [-36, -2], [-36, -13]], w: 2.8 }, // the shelves
      { pts: [[-23.8, -30.7], [-14, -34], [-2, -38], [10, -34], [18, -28]], w: 3.0 },  // north flank
      { pts: [[20, -24], [25, -16], [26, -12]], w: 2.6 },                  // to the ice shelves
      { pts: [[24, -2], [19, 2], [15, 4]], w: 3.0 },                       // the terrace
    ],
  },

  /* ------------------------------------------------------------------------
   * CHECKPOINTS — 6, and every one sits BEFORE its spike, never after. Four
   * are on terrain flats (EXACT heights, no slope under the respawn); cp5 is
   * on the ice terrace flat and cp6 on the shrine gate landing, which is
   * authored geometry and therefore level by construction.
   *
   * `clockOffset` is the course-clock phase a respawn here rewinds to. The
   * gale gusts, the pendulum logs, the vanish ice, the crushers and the beams
   * are all pure functions of that clock, so without these a player who dies
   * at the bridge would respawn into whatever phase the gust happened to be
   * in. Each offset is set 2 s before that beat's hazard cycle begins.
   * --------------------------------------------------------------------- */
  checkpoints: [
    { id: 'cp-camp', p: [0, 2.2, 41], yaw: 0, clockOffset: 0 },
    { id: 'cp-westface', p: [-25.2, 3.4, 32.0], yaw: 2.55, clockOffset: 8 },
    { id: 'cp-gorge', p: [-36.0, 6.6, -13.0], yaw: 3.35, clockOffset: 16 },
    { id: 'cp-bridge', p: [-23.8, 8.0, -30.7], yaw: 1.30, clockOffset: 26 },
    { id: 'cp-terrace', p: [21.0, TERRACE_Y, 3.0], yaw: 3.60, clockOffset: 36 },
    { id: 'cp-gate', p: [10.6, GATE_TOP, -4.2], yaw: Math.PI / 2, clockOffset: 46 },
  ],

  /* ------------------------------------------------------------------------
   * CRESTS — 7, one of each type in the contract.
   * --------------------------------------------------------------------- */
  crests: [
    {
      id: 'open', type: 'open', name: 'THE CREST OF THE STORM SHRINE',
      hint: 'The cap. Bridge, cave and chimney, or ride the mill and skip a beat.',
      p: [0, 37.9, -4],
    },
    {
      id: 'sigils', type: 'sigils', name: 'EIGHT SIGILS OF THE PEAK',
      hint: 'Spire, log-pillar, mill gallery, vanish ice, gorge, cave, viaduct, cap.',
      spawnAt: [23.0, 21.05, 6.0],              // the terrace pedestal (top 20.10)
    },
    {
      id: 'coins', type: 'coins', name: 'A HUNDRED COINS', threshold: 100,
      hint: '114 are out in the snow. You can lose fourteen to the wind.',
      spawnAt: [-5.0, 3.55, 41.0],              // the base-camp pedestal (top 2.70)
    },
    {
      id: 'secret', type: 'secret', name: 'BEHIND THE FROZEN FALL',
      trigger: 'frozen-fall-broken',
      hint: 'Nothing on the mountain points at it. The waterfall stopped moving years ago.',
      spawnAt: [-23.0, 1.70, -16.0],            // inside the ice cave (floor 0.10)
    },
    {
      id: 'boss', type: 'boss', name: 'THE WARDEN OF THE SHRINE GATE',
      hint: 'Jump the shockwave, sidestep the charge, pound its back on the cap.',
      spawnAt: [0, SUMMIT_Y + 1.6, -9.0],
    },
    {
      id: 'race', type: 'race', name: 'BLIZZARD RUN',
      hint: 'Camp to the shrine gate. Ninety seconds. The mill is faster than the stair.',
      start: [0, 2.2, 40.0], finish: [10.4, GATE_TOP, -4.2], limitMs: 90000,
      spawnAt: [-2.5, SUMMIT_Y + 1.4, -1.5],
    },
    {
      id: 'wing', type: 'power', name: 'THE LONG FALL HOME', power: 'wing',
      hint: 'Take the hat on the cap and thread all fourteen rings down to the camp.',
      p: [6.0, 3.60, 42.0],
    },
  ],

  /* ------------------------------------------------------------------------
   * SIGILS — 8, every one on an OPTIONAL line off the required route, and
   * every one verified against the surface it belongs to.
   * --------------------------------------------------------------------- */
  sigils: [
    { p: [-42.0, 7.90, 14.0], note: '1 — the west spire (top 6.50), a 3.40 m hop out over the face' },
    { p: [-33.5, 7.90, 16.6], note: '2 — the log pillar (top 6.50), under pendulum 2\'s arc' },
    { p: [30.0, MILL_E_GAL + 1.34, -6.0], note: '3 — the east mill\'s gallery balcony (17.96)' },
    { p: [-26.2, 8.70, -21.2], note: '4 — over vanish tile 3, 13 m of air under it' },
    { p: [-24.5, 1.50, -17.5], note: '5 — the ice cave behind the frozen fall (floor 0.10)' },
    { p: [15.2, TERRACE_Y + 1.60, -2.0], note: '6 — the crusher cave, past the third hammer' },
    { p: [14.8, 33.70, -13.2], note: '7 — the guard spire beside the viaduct (top 32.30)' },
    { p: [-6.0, 39.00, -9.0], note: '8 — the ice pinnacle over the shrine (top 37.60)' },
  ],

  /* ------------------------------------------------------------------------
   * COINS — 114 placed, 100 needed. Every group rewards a line the player
   * chose; the trail out of the camp is the only one you cannot miss.
   * --------------------------------------------------------------------- */
  coins: [
    // BEAT 1 — the trodden track out of camp, up the first swell. (10)
    ...trailCoins([[0, 42], [-8, 39], [-16, 36], [-24, 33]], 10, 1.1),
    // BEAT 2 — the arc off shelf A onto shelf B, the first real hop. (6)
    ...arcCoins([-29.0, 5.2, 26.0], [-32.6, 6.2, 20.0], 1.3, 6),
    // BEAT 2 — a ring on the west-face flat, the breather before the logs. (8)
    { ring: { c: [-25.2, 32.0], r: 3.6, n: 8, y: 4.50 } },
    // BEAT 2 — down the carved shelves under the pendulums. (10)
    ...trailCoins([[-32.6, 20], [-35.4, 13.5], [-36.4, 6.5], [-36, -2]], 10, 2.0),
    // BEAT 2 — the west mill's gallery ring. (6)
    { ring: { c: [-34.0, 0.0], r: 2.6, n: 6, y: 13.90 } },
    // BEAT 3 — across the first bridge gap (3.00 m, deck -> pier). (4)
    ...arcCoins([BR_A_END[0], BR_A_END[1] + 1.0, BR_A_END[2]], [PIER[0], PIER_TOP + 1.0, PIER[1]], 1.1, 4),
    // BEAT 3 — across the second gap (3.00 m, pier -> deck). (4)
    ...arcCoins([PIER[0], PIER_TOP + 1.0, PIER[1]], [BR_B_START[0], BR_B_START[1] + 1.0, BR_B_START[2]], 1.1, 4),
    // BEAT 3 — the vanish ice line, five tiles over the void. (5)
    { p: [-31.0, 8.0, -14.9] }, { p: [-28.6, 8.2, -18.0] }, { p: [-26.2, 8.4, -21.2] },
    { p: [-23.8, 8.6, -24.4] }, { p: [-21.4, 8.8, -27.5] },
    // BEAT 3 — a ring on the gorge floor, for anyone who took ROUTE C. (8)
    { ring: { c: [-27.6, -19.0], r: 3.0, n: 8, y: 0.60 } },
    // BEAT 4 — the north flank, the longest breather in the course. (12)
    ...trailCoins([[-23.8, -30.7], [-14, -34], [-2, -38], [10, -34], [18, -28]], 12, 1.2),
    // BEAT 5 — the arc up the ice-shelf stair. (6)
    ...arcCoins([26.2, 16.4, -12.0], [26.2, 19.6, -3.6], 1.4, 6),
    // BEAT 5 — a ring on the terrace, around the pedestal. (8)
    { ring: { c: [19.0, 2.0], r: 4.2, n: 8, y: TERRACE_Y + 1.1 } },
    // BEAT 6 — a line straight through the crusher cave. (6)
    { line: { a: [23.5, TERRACE_Y + 1.0, -2.0], b: [16.5, TERRACE_Y + 1.0, -2.0], n: 6 } },
    // BEAT 6 — up the chimney, one per kick. (5)
    { p: [15.0, 21.2, -2.0] }, { p: [15.0, 22.6, -2.0] }, { p: [15.0, 24.0, -2.0] },
    { p: [15.0, 25.4, -2.0] }, { p: [15.0, 26.8, -2.0] },
    // BEAT 7 — up the viaduct, along the two flights. (8)
    { p: [14.4, 28.6, -4.6] }, { p: [13.9, 29.4, -6.0] }, { p: [13.4, 30.2, -7.4] },
    { p: [12.9, 31.0, -8.8] }, { p: [11.8, 32.0, -8.2] }, { p: [11.5, 32.9, -7.0] },
    { p: [11.2, 33.8, -5.8] }, { p: [10.9, 34.7, -4.6] },
    // BEAT 7 — the shrine ring on the cap. (8)
    { ring: { c: [0.0, -4.0], r: 5.0, n: 8, y: SUMMIT_Y + 1.2 } },
  ],

  /* ------------------------------------------------------------------------
   * POWERS — two wing hats. One on the cap (the ring run starts three metres
   * away); one on the terrace, so a run that ends in the snow halfway down
   * does not cost the whole climb back.
   * --------------------------------------------------------------------- */
  powers: [
    { kind: 'wing', p: [2.0, 36.30, 4.0], duration: 30 },
    { kind: 'wing', p: [17.0, TERRACE_Y + 1.2, 5.0], duration: 30 },
  ],

  /* ------------------------------------------------------------------------
   * OBJECTS — the built world, beat by beat.
   * --------------------------------------------------------------------- */
  objects: [

    /* ========================================================================
     * BEAT 1 — BASE CAMP
     * The last twenty seconds of flat ground in the realm. Flat EXACTLY 2.20
     * for 7.15 m around (0, 44); spawn faces -Z, so the mountain, the gorge's
     * shadow and the shrine are all on screen before the first input. Two
     * signs, because this course has one genuinely new verb and it deserves to
     * be said out loud before it is used.
     * ===================================================================== */

    { kind: 'deco', kindOf: 'sign', p: on(3.4, 41, 1.15), s: [0.14, 1.7, 1.2], mat: 'wood', tint: TIMBER },
    { kind: 'deco', kindOf: 'post', p: on(3.4, 41, 0.65), s: [0.16, 1.3, 0.16], mat: 'wood', tint: 0x6b5c50 },
    { kind: 'text', p: [3.4, 3.95, 41], rot: [0, 0, 0], text: 'BLIZZARD PEAK', size: 0.58, color: 0x25405c },
    { kind: 'text', p: [3.4, 3.44, 41], rot: [0, 0, 0], text: 'THE WIND PUSHES  ·  LEAN INTO IT AND KEEP RUNNING', size: 0.22, color: 0x3d5b78 },
    { kind: 'text', p: [3.4, 3.08, 41], rot: [0, 0, 0], text: 'IT NEVER KILLS  ·  THE DROP DOES', size: 0.22, color: 0x3d5b78 },

    // The pedestal the HUNDRED COINS crest lands on.
    { kind: 'pedestal', p: on(-5, 41, 0), mat: 'stone', tint: STONE, glow: GOLD },
    // ...and the one the ring run comes home to.
    { kind: 'pedestal', p: on(6, 42, 0), mat: 'stone', tint: STONE, glow: AURORA },
    { kind: 'text', p: [6, r2(gy(6, 42) + 1.5), 42], rot: [0, 0, 0], text: 'FOURTEEN RINGS COME DOWN HERE', size: 0.20, color: 0x3d5b78 },

    // The camp itself. Props build no colliders (props.js), so none of this is
    // in the player's way; it is here so the snowfield reads as somewhere the
    // climb starts from rather than an empty white plane.
    { kind: 'deco', kindOf: 'crate', p: on(-2.6, 46.4, 0.42), s: [0.9, 0.85, 0.9], rot: [0, 0.4, 0], mat: 'wood', tint: TIMBER, count: 3, spread: 2.2, jitter: 0.3 },
    { kind: 'deco', kindOf: 'crate', p: on(2.2, 47.6, 0.42), s: [0.9, 0.85, 0.9], rot: [0, -0.7, 0], mat: 'wood', tint: TIMBER },
    { kind: 'deco', kindOf: 'banner', p: on(-4.4, 44.6, 2.1), s: [0.10, 2.4, 1.3], mat: 'cloth', tint: 0x4a7fb8 },
    { kind: 'deco', kindOf: 'banner', p: on(4.6, 44.2, 2.1), s: [0.10, 2.4, 1.3], mat: 'cloth', tint: 0x7a5fa8 },
    { kind: 'deco', kindOf: 'flagpole', p: on(0, 48.4, 2.2), s: [0.12, 4.4, 0.12], mat: 'wood', tint: TIMBER },
    { kind: 'deco', kindOf: 'torch', p: on(-3.0, 42.4, 0.8), s: [0.4, 1.6, 0.4], mat: 'metal', tint: EMBER, count: 2, spread: 2.6, jitter: 0.2 },
    { kind: 'deco', kindOf: 'torch', p: on(3.0, 42.4, 0.8), s: [0.4, 1.6, 0.4], mat: 'metal', tint: EMBER },
    // ONE real light at the camp — the only warm source below the cave, and
    // the anchor the aurora-lit snow is read against.
    { kind: 'light', p: on(0, 43.4, 2.6), color: EMBER, intensity: 9, distance: 22 },

    // A snow fence, so the camp has a human edge and the wind has something to
    // pile against.
    { kind: 'fence', a: on(-11, 49, 0), b: on(-4, 50.4, 0), mat: 'wood', tint: TIMBER },
    { kind: 'fence', a: on(-4, 50.4, 0), b: on(4, 50.2, 0), mat: 'wood', tint: TIMBER },
    { kind: 'fence', a: on(4, 50.2, 0), b: on(11, 48.4, 0), mat: 'wood', tint: TIMBER },

    // BEAT 8 — the race start pad, on the camp flat.
    { kind: 'platform', p: [0, 2.16, 40.0], s: [3.8, 0.2, 3.8], mat: 'stone', tint: 0xd6e4f2 },
    { kind: 'text', p: [0, 3.5, 40.0], rot: [0, 0, 0], text: 'BLIZZARD RUN  ·  90s', size: 0.26, color: 0x2f5a86 },

    /* ========================================================================
     * BEAT 2 — THE WEST FACE
     * The gale, and the course's one new verb. Three `wind` volumes blow WEST,
     * off the mountain: 9 -> 12 m/s^2 of lateral acceleration against a 9 m/s
     * run, so you drift about a metre a second if you stop steering and you
     * lose nothing at all if you keep leaning. Wind publishes a Volume and
     * never a collider (hazards/surfaces.js), so it can never catch a jump.
     *
     * Four shelves are carved into the face under it. Ground samples along the
     * line: (-29,26) 3.87 · (-32.6,20) 4.50 · (-35.4,13.5) 5.40 · (-36.4,6.5)
     * 6.40 · (-36,-2) 7.27 — the shelves sit 0.3 to 1.1 m proud of that, which
     * is what makes them read as cut rather than dropped. Measured hops:
     *     A -> B   1.80 m at +1.05      (single-safe at +1.0 is 3.88)
     *     B -> C   2.50 m at +1.15
     *     C -> D   3.00 m at +1.15
     * and the two OPTIONAL branches off them:
     *     C -> the west spire   3.40 m at +0.15   (sigil 1, out over the face)
     *     B -> the log pillar   0.30 m at +1.30   (sigil 2, under the swing)
     * ===================================================================== */

    { kind: 'wind', p: [-28.0, 9.0, 25.0], s: [18, 10, 16], dir: [-0.92, 0, 0.39], power: 9.0 },
    { kind: 'wind', p: [-34.0, 10.5, 13.0], s: [16, 12, 20], dir: [-1, 0, 0], power: 11.0 },
    { kind: 'wind', p: [-35.0, 12.0, -3.0], s: [16, 12, 18], dir: [-0.97, 0, -0.24], power: 12.0 },

    { kind: 'text', p: [-25.2, 5.2, 29.6], rot: [0, 2.55, 0], text: 'LEAN WEST  ·  THE LEDGES ARE CUT WIDE FOR IT', size: 0.24, color: 0x3d5b78 },

    // --- the four carved shelves. A is a walk-on (no stripe); B, C and D are
    //     jumped to, so every one of them wears the leading edge.
    { kind: 'platform', p: [-29.0, 3.55, 26.0], s: [4.4, 1.2, 4.4], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [-32.6, 4.60, 20.0], s: [4.0, 1.2, 4.0], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-35.4, 5.75, 13.5], s: [4.0, 1.2, 4.0], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-36.4, 6.90, 6.5], s: [4.0, 1.2, 4.0], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },

    // --- OPTIONAL: the west spire. 3.40 m out from shelf C at +0.15, hanging
    //     over 40 m of face. Sigil 1 floats 1.40 m over its top at 6.50.
    { kind: 'platform', p: [-42.0, 4.00, 14.0], s: [2.4, 5.0, 2.4], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'icicle', p: [-42.0, 3.2, 14.0], s: [0.5, 1.4, 0.5], mat: 'ice', tint: ICE, count: 5, spread: 1.3, jitter: 0.4 },

    // --- OPTIONAL: the log pillar. Sigil 2 sits 1.40 m over its top at 6.50,
    //     directly under pendulum 2's arc — you have to time the swing to stand
    //     on a 2.2 m square.
    { kind: 'platform', p: [-33.5, 5.00, 16.6], s: [2.2, 3.0, 2.2], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },

    // --- the pendulum logs. `mode:'ball'` is a SOLID head that is only lethal
    //     above a threshold tip speed (hazards/pendulum.js), so a clipped log
    //     at the end of its swing shoves you and a log at the bottom of it does
    //     not. `axis:'x'` swings them ACROSS the path, which runs south->north.
    //     Every pivot is set so the head's low point clears the ground by 2.2 m.
    { kind: 'pendulum', p: [-31.0, 11.20, 22.5], len: 4.5, ampDeg: 55, period: 3.4, axis: 'x', mode: 'ball', radius: 1.0, mat: 'wood', tint: TIMBER },
    { kind: 'pendulum', p: [-33.5, 12.60, 16.6], len: 4.8, ampDeg: 62, period: 3.0, phaseCycles: 0.35, axis: 'x', mode: 'ball', radius: 1.1, mat: 'wood', tint: TIMBER },
    { kind: 'pendulum', p: [-36.5, 14.00, 1.0], len: 4.8, ampDeg: 58, period: 3.2, phaseCycles: 0.6, axis: 'x', mode: 'ball', radius: 1.0, mat: 'wood', tint: TIMBER },
    { kind: 'text', p: [-32.6, 6.6, 22.4], rot: [0, 3.0, 0], text: 'THE LOGS SWING  ·  WALK UNDER ON THE WAY BACK', size: 0.22, color: 0x3d5b78 },

    /* --- THE WEST SNOW MILL. Axle 15.40, arms 6.00, tower 7.50 in the plane
     *     z = 0, so the sails sweep x = -40 .. -28 and never touch a shelf (the
     *     nearest, D, is at z 4.5..8.5). Bottom gondola pose 9.63 over ground
     *     9.30; 3 o'clock pose 15.63 at (-28, 0) over ground 13.00 — a 2.6 m
     *     step down onto the flank, which is the whole point of a lift. Its
     *     gallery balcony lands at 13.28 and carries six coins. */
    {
      kind: 'mill', p: [-34, 15.40, 0], arms: 4, len: 6.0, period: 15.0, dir: 1, yaw: 0,
      tower: 7.5, towerR: 2.4, chord: 1.8, thick: 0.34,
      deck: { w: 2.0, d: 1.5, t: 0.45 },
      mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE,
    },
    { kind: 'deco', kindOf: 'chain', p: [-34, 9.6, 0], s: [0.2, 2.6, 0.2], mat: 'metal', tint: 0x9fb0c4, count: 3, spread: 2.0, jitter: 0.3 },

    /* ========================================================================
     * BEAT 3 — THE GORGE  (the set piece)
     * A 16 m chasm torn diagonally across the route, 13 m deep under the
     * crossing. The bridge is two spans of rope-and-plank with a stone pier in
     * the middle of the void, and it is authored as TWO `bridge` objects with
     * the pier between them, because a single span with a hole painted on it
     * would be a lie the collider does not tell.
     *
     * MEASURED, along the crossing direction u = (0.607, -0.795):
     *     deck end (-33.6,-18.6) -> pier cap        3.00 m at +0.45
     *     pier cap -> deck start (-28.2,-26.6)      3.00 m at -0.15
     * Single-jump-safe at +1.0 is 3.88 m and the approach on either side is
     * 4.4 m of straight deck, so both are inside the envelope with a metre to
     * spare — which is the right margin for a jump taken in a 10 m/s^2 gust.
     *
     * Miss it and you do not die: you slide 13 m down a 45-73 deg wall onto the
     * frozen floor, which is ROUTE C, the ice cave and the secret.
     * ===================================================================== */

    { kind: 'text', p: [-36.0, 8.4, -11.0], rot: [0, 3.35, 0], text: 'THE BRIDGE IS OLD  ·  THE PIER IS NOT', size: 0.24, color: 0x3d5b78 },
    { kind: 'text', p: [-36.0, 8.0, -11.0], rot: [0, 3.35, 0], text: 'falling in is a way down, not a way out', size: 0.19, color: 0x50708c },

    { kind: 'bridge', a: BR_A, b: BR_A_END, w: 3.0, sag: 0.24, mat: 'wood', tint: TIMBER, ropeTint: ROPE, stripe: true, edge: SAFE_EDGE },
    { kind: 'bridge', a: BR_B_START, b: BR_B, w: 3.0, sag: 0.22, mat: 'wood', tint: TIMBER, ropeTint: ROPE, stripe: true, edge: SAFE_EDGE },

    // Broken planks hanging off both torn ends, so the gap reads as damage.
    { kind: 'deco', kindOf: 'panel', p: [-32.9, 5.90, -19.2], s: [0.2, 0.09, 1.6], rot: [0.44, -0.9, -0.18], mat: 'wood', tint: TIMBER },
    { kind: 'deco', kindOf: 'panel', p: [-28.9, 6.24, -26.0], s: [0.2, 0.09, 1.4], rot: [-0.36, -0.9, 0.16], mat: 'wood', tint: TIMBER },

    // THE PIER. A 12 m ice column standing on the chasm floor at -6.26; the cap
    // top is 6.75, level with both deck ends to within half a metre.
    { kind: 'platform', p: [PIER[0], 0.75, PIER[1]], s: [3.4, 12.0, 3.4], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'icicle', p: [PIER[0], 4.6, PIER[1]], s: [0.5, 1.6, 0.5], mat: 'ice', tint: ICE, count: 8, spread: 1.9, jitter: 0.5 },
    { kind: 'light', p: [PIER[0], 9.0, PIER[1]], color: 0x9fd8ef, intensity: 6, distance: 20 },

    /* THE GUST. One wind volume over the whole crossing, blowing along the
     * bridge's perpendicular so it tries to walk you sideways off a 3 m deck.
     * Volumes are never colliders, so the gust cannot push you INTO anything —
     * only off. */
    { kind: 'wind', p: [-30.0, 12.0, -22.0], s: [24, 16, 24], dir: [0.795, 0, 0.607], power: 10.0 },

    /* --- OPTIONAL: THE VANISH ICE. Five tiles on a 3.2 s cycle strung parallel
     *     to the bridge, four metres downwind, thirteen metres over the frozen
     *     floor. Spacing is 3.96 m centre to centre on 2.6 m tiles, so each hop
     *     is ~1.4 m of air — trivial geometry, and entirely about the clock.
     *     `warn` is the tail of the OFF window (hazards/index.js), so the tile
     *     always telegraphs before it returns. Sigil 4 hangs over tile 3. */
    { kind: 'vanish', p: [-31.0, 6.75, -14.9], s: [2.6, 0.3, 2.6], mode: 'cycle', cycle: { on: 2.0, off: 1.2, warn: 0.5, phase: 0.0 }, mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [-28.6, 6.95, -18.0], s: [2.6, 0.3, 2.6], mode: 'cycle', cycle: { on: 2.0, off: 1.2, warn: 0.5, phase: 0.64 }, mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [-26.2, 7.15, -21.2], s: [2.6, 0.3, 2.6], mode: 'cycle', cycle: { on: 2.0, off: 1.2, warn: 0.5, phase: 1.28 }, mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [-23.8, 7.35, -24.4], s: [2.6, 0.3, 2.6], mode: 'cycle', cycle: { on: 2.0, off: 1.2, warn: 0.5, phase: 1.92 }, mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [-21.4, 7.55, -27.5], s: [2.6, 0.3, 2.6], mode: 'cycle', cycle: { on: 2.0, off: 1.2, warn: 0.5, phase: 2.56 }, mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },

    /* --- OPTIONAL: THE SWINGING PLANKS. Two `mover` oscillate slabs hung off
     *     the bridge's downwind cables, sliding 1.8 m across the chasm on a 4 s
     *     beat so the whole crossing breathes with the gust. They are pure
     *     decoration for ROUTE A and a faster line for anyone who trusts them;
     *     nothing REQUIRED is only reachable from them. */
    {
      kind: 'mover', p: [-32.1, 6.80, -17.0], s: [2.4, 0.28, 1.6],
      motion: { type: 'oscillate', axis: [0.795, 0, 0.607], amp: 1.8, period: 4.0, ease: 'sine', phase: 0.0 },
      mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE,
    },
    {
      kind: 'mover', p: [-26.9, 7.10, -23.9], s: [2.4, 0.28, 1.6],
      motion: { type: 'oscillate', axis: [0.795, 0, 0.607], amp: 1.8, period: 4.0, ease: 'sine', phase: 0.5 },
      mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE,
    },

    /* --- ROUTE C, part one: THE FROZEN FLOOR. Two ice shelves standing proud
     *     of the ravine bed so the bottom of the gorge is somewhere to be and
     *     not just somewhere you land. Ground under them: (-27.6,-19) -2.65 and
     *     (-31.5,-23.5) about -5.0. */
    { kind: 'platform', p: [-27.6, -1.60, -19.0], s: [4.6, 1.6, 4.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-31.5, -3.00, -23.5], s: [5.0, 1.6, 5.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'ice', p: [-29.5, -2.20, -21.0], s: [7.0, 0.4, 7.0], mat: 'ice', tint: 0xbfe6f6 },

    /* --- THE SECRET: THE FROZEN FALL. The ravine's east wall carries a sheet
     *     of ice that used to be a waterfall. Nothing on the mountain points at
     *     it; the only tell is that the icicle fringe over it is too regular.
     *     Pound it and the chamber behind opens: sigil 5 and the crest.
     *     Built ABOVE the heightfield (a heightfield has no overhangs, so a
     *     "cave" cut into the terrain would push the player straight back out).
     *     Ground at (-24.5,-17.5) samples 0.03, so the chamber floor is 0.10. */
    { kind: 'platform', p: [-23.5, -0.40, -16.5], s: [7.0, 1.0, 7.0], mat: 'ice', tint: 0x8fc8e2 },
    { kind: 'platform', p: [-23.5, 1.85, -19.7], s: [7.0, 3.5, 0.6], mat: 'ice', tint: 0x8fc8e2 },
    { kind: 'platform', p: [-23.5, 1.85, -13.3], s: [7.0, 3.5, 0.6], mat: 'ice', tint: 0x8fc8e2 },
    { kind: 'platform', p: [-20.3, 1.85, -16.5], s: [0.6, 3.5, 6.4], mat: 'ice', tint: 0x8fc8e2 },
    { kind: 'platform', p: [-23.5, 3.85, -16.5], s: [7.6, 0.7, 7.0], mat: 'ice', tint: 0x8fc8e2 },
    // The sheet that fills the 3.0 x 2.8 m mouth exactly.
    { kind: 'breakable', p: [-26.7, 1.60, -16.5], s: [0.7, 3.0, 3.2], mat: 'ice', tint: 0xcdeefb, drop: 'crest', trigger: 'frozen-fall-broken' },
    { kind: 'deco', kindOf: 'icicle', p: [-26.7, 3.4, -16.5], s: [0.4, 1.5, 0.4], mat: 'ice', tint: ICE, count: 9, spread: [0.3, 0, 1.7], jitter: 0.3 },
    { kind: 'light', p: [-23.5, 2.4, -16.8], color: 0x9fd8ef, intensity: 7, distance: 13 },
    { kind: 'deco', kindOf: 'crystal', p: [-21.6, 0.8, -18.4], s: [0.6, 1.1, 0.6], mat: 'crystal', tint: 0x8fe8ff, count: 4, spread: 1.6, jitter: 0.4 },

    /* --- ROUTE C, part two: THE CREVASSE CHIMNEY. A 2.80 m slot in the
     *     ravine's north wall, floor 3.60 to exit ledge 13.00 = 9.40 m, which
     *     is one jump plus four kicks at 2.12 m each (REACH_TABLE.wallkick,
     *     shaft limit 3.40 m). Then two 1.40 m steps onto the north flank at
     *     15.80, where the ground samples 16.71 and 33 deg — walkable. */
    { kind: 'platform', p: [-19.5, 3.00, -15.0], s: [3.0, 1.2, 3.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-21.2, 8.20, -15.0], s: [0.6, 10.0, 4.0], mat: 'ice', tint: 0x8fc8e2 },
    { kind: 'platform', p: [-17.8, 8.20, -15.0], s: [0.6, 10.0, 4.0], mat: 'ice', tint: 0x8fc8e2 },
    { kind: 'platform', p: [-19.5, 12.60, -17.4], s: [3.4, 0.8, 3.4], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-17.8, 13.90, -19.0], s: [2.6, 1.0, 2.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-16.2, 15.30, -20.8], s: [2.6, 1.0, 2.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [-19.5, 5.4, -13.0], rot: [0, 0, 0], text: 'KICK ONE WALL, THEN THE OTHER', size: 0.21, color: 0xbfe0f5 },

    /* ========================================================================
     * BEAT 4 — THE NORTH FLANK
     * The breather, and the only place on the mountain you can see the whole
     * of it at once. Open snow at 26-37 deg with two `ice` slabs across the
     * fall line (you drift, you do not die) and two `rotor` ice-wheels turning
     * slowly enough to walk through if you read them. cp4 is at its west end,
     * so nothing here is more than about thirty seconds of replay.
     * ===================================================================== */

    { kind: 'ice', p: [-8.0, 8.20, -36.0], s: [14, 0.4, 10], rot: [0, 0.16, 0], mat: 'ice', tint: 0xbfe6f6 },
    { kind: 'ice', p: [8.0, 8.90, -34.0], s: [14, 0.4, 10], rot: [0, -0.2, 0], mat: 'ice', tint: 0xbfe6f6 },
    { kind: 'text', p: [-14.0, 9.6, -33.0], rot: [0, 1.3, 0], text: 'ICE  ·  STOP EARLY', size: 0.24, color: 0x3d5b78 },

    // Ice wheels: `style:'bar'` rotors are RIDEABLE solids unless `kill` is set,
    // so these shove and carry rather than execute. Slow (7 s and 8 s a turn)
    // because the flank under them is a 35 deg slide if you get pushed.
    { kind: 'rotor', p: [-3.0, 9.60, -37.4], style: 'bar', arms: 3, len: 3.2, thick: 0.42, height: 0.9, period: 7.0, axis: 'y', mat: 'ice', tint: ICE },
    { kind: 'rotor', p: [13.0, 10.80, -32.0], style: 'bar', arms: 3, len: 3.4, thick: 0.42, height: 0.9, period: 8.0, phase: 0.4, axis: 'y', mat: 'ice', tint: ICE },

    { kind: 'deco', kindOf: 'monolith', p: on(-19.4, -36.4, 1.5), s: [1.2, 3.4, 1.0], mat: 'stone', tint: 0x8fa0b4 },
    { kind: 'deco', kindOf: 'monolith', p: on(6.0, -42.6, 1.3), s: [1.1, 3.0, 0.9], mat: 'stone', tint: 0x8fa0b4 },

    /* ========================================================================
     * BEAT 5 — THE EAST SHOULDER : the ice-shelf stair and the mill lift
     * Two ways onto the terrace, and this is where ROUTE A and ROUTE B part.
     *
     * ROUTE A, the ICE-SHELF STAIR. Four shelves cut out of the terrace's rim,
     * where the ground goes from 34 deg to 52 deg and walking stops working:
     *     ground (26.2,-13) 13.6  ->  IS1 top 15.20   1.60 m up, 0.5 m across
     *     IS1 -> IS2  1.60 m up, 0.6 m across
     *     IS2 -> IS3  1.60 m up, 1.8 m across   (single-safe at +1.6 is 3.28)
     *     IS3 -> IS4  1.20 m up, footprints touching
     *     IS4 top 19.60 IS the terrace lip.
     * Every one of them is striped, and none is inside the mill's sail disc
     * (the sails sweep the plane z = -6 +/- 1.3 m; IS3 starts at z = -5.1).
     *
     * ROUTE B, the MILL LIFT. Board the gondola at the bottom of the sweep
     * (12.65 over ground 11.83) and ride a quarter turn to the 9 o'clock pose
     * at 20.65, one metre over the terrace. The mill's own gallery balcony at
     * 17.96 is a landable ring, and IS3's top at 18.40 steps straight down onto
     * it — which is the STATIC approach sigil 3 needs, so the reach gate never
     * has to credit the ride for a collectible.
     * ===================================================================== */

    { kind: 'platform', p: [26.2, 14.60, -12.0], s: [3.0, 1.2, 3.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [26.4, 16.20, -8.4], s: [3.0, 1.2, 3.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [26.2, 17.80, -3.6], s: [3.0, 1.2, 3.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [25.0, 19.00, -1.6], s: [3.4, 1.2, 3.4], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },

    {
      kind: 'mill', p: MILL_E, arms: 4, len: 8.0, period: 13.0, dir: -1, yaw: 0,
      tower: 8.5, towerR: 3.0, chord: 2.6, thick: 0.40,
      deck: { w: 2.4, d: 1.8, t: 0.5 },
      mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE,
    },
    { kind: 'text', p: [30.0, 13.6, -10.4], rot: [0, 0, 0], text: 'RIDE A GONDOLA  ·  STEP OFF AT NINE O’CLOCK', size: 0.23, color: 0x3d5b78 },
    { kind: 'deco', kindOf: 'chain', p: [30.0, 13.0, -6.0], s: [0.2, 3.0, 0.2], mat: 'metal', tint: 0x9fb0c4, count: 4, spread: 2.6, jitter: 0.4 },

    /* ========================================================================
     * BEAT 6 — THE CRUSHER CAVE
     * Cut into the cliff at the back of the terrace, floor EXACTLY 19.60. A
     * 10.6 x 4.8 m chamber with three ice hammers on staggered thirds of a
     * 3.2 s beat and two beam tripwires between them, and at the back of it a
     * 3.20 m chimney open to the sky.
     *
     * `crusher` is lethal ONLY on the crushing face and ONLY while it drives
     * forward (hazards/crushers.js) — parked, each hammer is a safe shelf that
     * carries you, which is what makes reading the rhythm the answer instead of
     * sprinting. A `beam` never arms during `warn`, so the telegraph is always
     * survivable.
     *
     * THE CHIMNEY: two inner slabs 3.20 m apart spanning 19.60 -> 27.60, the
     * roof stopping at x = 16.6 so the shaft is open, and the exit ledge at
     * 27.70. That is 8.10 m: one jump (1.91) plus four kicks (2.12 each).
     * ===================================================================== */

    { kind: 'platform', p: [21.0, 21.40, -4.8], s: [9.0, 3.6, 0.8], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [21.0, 21.40, 0.8], s: [9.0, 3.6, 0.8], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [13.8, 21.40, -2.0], s: [0.8, 3.6, 6.4], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [21.0, 23.55, -2.0], s: [8.8, 0.7, 6.4], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [25.2, 22.80, -2.0], s: [0.8, 2.0, 6.4], mat: 'stone', tint: STONE },

    // The chimney's two kick walls. Span 19.60 -> 27.60 with a 3.20 m clear
    // slot between them (limit 3.40); the cave roof stops short of both.
    { kind: 'platform', p: [15.0, 23.60, -3.9], s: [3.0, 8.0, 0.6], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [15.0, 23.60, -0.1], s: [3.0, 8.0, 0.6], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [15.0, 27.30, -2.0], s: [3.4, 0.8, 3.4], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [17.6, 21.2, -2.0], rot: [0, -1.5708, 0], text: 'ONE JUMP, FOUR KICKS', size: 0.21, color: 0xd8e8f6 },

    // The three hammers, on thirds of one 3.2 s beat.
    { kind: 'crusher', p: [23.0, 22.60, -2.0], s: [3.0, 1.4, 4.0], axis: [0, -1, 0], travel: 2.6, period: 3.2, phase: 0.0, dwell: 0.3, mat: 'ice', tint: ICE },
    { kind: 'crusher', p: [20.5, 22.60, -2.0], s: [3.0, 1.4, 4.0], axis: [0, -1, 0], travel: 2.6, period: 3.2, phase: 0.34, dwell: 0.3, mat: 'ice', tint: ICE },
    { kind: 'crusher', p: [18.0, 22.60, -2.0], s: [3.0, 1.4, 4.0], axis: [0, -1, 0], travel: 2.6, period: 3.2, phase: 0.67, dwell: 0.3, mat: 'ice', tint: ICE },

    // Two tripwires across the gaps between them.
    { kind: 'beam', a: [21.8, 20.40, -4.2], b: [21.8, 20.40, 0.2], cycle: { on: 1.4, off: 2.0, warn: 0.6, phase: 0.0 }, radius: 0.12, color: 0xff2040 },
    { kind: 'beam', a: [19.2, 20.40, -4.2], b: [19.2, 20.40, 0.2], cycle: { on: 1.4, off: 2.0, warn: 0.6, phase: 1.7 }, radius: 0.12, color: 0xff2040 },

    // A rotten ice panel in the north wall, worth six coins to anyone who
    // pounds it while waiting out a hammer.
    { kind: 'breakable', p: [17.0, 20.60, -4.2], s: [1.6, 2.0, 0.6], mat: 'ice', tint: 0xcdeefb, drop: 'coins', dropCount: 6 },

    // The terrace itself: the pedestal the EIGHT SIGILS crest rises from, and
    // the two lights that keep a cave mouth from reading as a black hole cut in
    // a white mountain.
    { kind: 'pedestal', p: [23.0, TERRACE_Y, 6.0], mat: 'stone', tint: STONE, glow: SIGIL_C },
    { kind: 'deco', kindOf: 'torch', p: [24.6, TERRACE_Y + 0.9, -4.4], s: [0.4, 1.6, 0.4], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'torch', p: [24.6, TERRACE_Y + 0.9, 0.4], s: [0.4, 1.6, 0.4], mat: 'metal', tint: EMBER },
    { kind: 'light', p: [22.0, TERRACE_Y + 1.8, -2.0], color: EMBER, intensity: 8, distance: 16 },
    { kind: 'light', p: [16.4, TERRACE_Y + 2.2, -2.0], color: 0x9fd8ef, intensity: 6, distance: 14 },
    { kind: 'deco', kindOf: 'crate', p: [21.4, TERRACE_Y + 0.42, 5.2], s: [0.9, 0.85, 0.9], rot: [0, 0.6, 0], mat: 'wood', tint: TIMBER, count: 3, spread: 2.0, jitter: 0.3 },
    { kind: 'deco', kindOf: 'banner', p: [19.0, TERRACE_Y + 2.4, 6.6], s: [0.10, 2.4, 1.3], mat: 'cloth', tint: 0x7a5fa8 },

    /* ========================================================================
     * BEAT 7 — THE SHRINE STAIR AND THE CAP
     * The last eight metres, and the only piece of architecture above the snow
     * line. Two flights of stone stair on pillars, a landing with a prayer
     * wheel on it, and the shrine gate landing at 35.10 where the Warden is
     * waiting. Ground under the viaduct runs 19.7 -> 29.5, so the flights ride
     * 2.6 to 8 m clear of the cliff on buttresses — a stair bridge, which is
     * exactly what a shrine on an unclimbable cap needs.
     *
     * MEASURED: chimney ledge 27.70 -> P1 top 31.06 (13 risers of 0.28 over
     * 4.56 m of run, 38.6 deg) -> landing 31.10 -> P2 top 35.00 (14 risers of
     * 0.30 over 4.42 m, 43.5 deg) -> gate landing 35.10. From the gate landing
     * the walkable cap starts 0.60 m away at 35.06 (slope 19.8 deg): a step
     * across, not a leap.
     * ===================================================================== */

    /* Flight P1. `stairs` is CENTRED on `p`, climbs toward local +Z and is then
     * rotated by `rot`; ascent direction here is (-0.328, -0.944), which is
     * rot.y = atan2(-0.328, -0.944) = -2.808 rad. */
    { kind: 'stairs', p: [13.8, 27.42, -6.3], w: 2.6, rise: 0.28, run: 0.38, n: 13, rot: [0, -2.808, 0], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'buttress', p: [13.8, 24.4, -6.3], s: [2.0, 6.0, 0.6], rot: [0, -2.808, 0], mat: 'stone', tint: STONE },

    { kind: 'platform', p: [12.4, 30.70, -9.8], s: [3.4, 0.8, 3.4], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'pillar', p: [12.4, 27.6, -9.8], s: [1.2, 6.4, 1.2], mat: 'stone', tint: STONE },

    /* Flight P2, ascent direction (-0.2217, 0.9752) => rot.y = -0.2236 rad. */
    { kind: 'stairs', p: [11.4, 30.80, -6.4], w: 2.6, rise: 0.30, run: 0.34, n: 14, rot: [0, -0.2236, 0], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'buttress', p: [11.4, 27.6, -6.4], s: [2.0, 6.4, 0.6], rot: [0, -0.2236, 0], mat: 'stone', tint: STONE },

    // THE SHRINE GATE. cp6 stands on it; the Warden's arena starts four metres
    // west of it, which is the whole point of putting a checkpoint here.
    { kind: 'platform', p: [10.4, 34.70, -4.2], s: [3.6, 0.8, 3.6], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'pillar', p: [10.4, 31.6, -4.2], s: [1.3, 6.4, 1.3], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'banner', p: [11.4, 36.6, -4.2], s: [0.10, 2.6, 1.3], mat: 'cloth', tint: 0x7a3a52 },
    { kind: 'text', p: [10.4, 36.4, -4.2], rot: [0, Math.PI / 2, 0], text: 'THE SHRINE GATE', size: 0.30, color: 0xdce8f4 },
    { kind: 'text', p: [10.4, 36.0, -4.2], rot: [0, Math.PI / 2, 0], text: 'JUMP THE WAVE  ·  SIDESTEP THE CHARGE  ·  POUND ITS BACK', size: 0.20, color: 0xb08090 },

    // --- OPTIONAL: the guard spire beside the viaduct. 0.70 m across at +1.20
    //     off landing P, with a twelve-metre fall under it. Sigil 7 sits 1.40 m
    //     over its top at 32.30.
    { kind: 'platform', p: [14.8, 30.30, -13.2], s: [2.0, 4.0, 2.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'icicle', p: [14.8, 28.6, -13.2], s: [0.45, 1.3, 0.45], mat: 'ice', tint: ICE, count: 6, spread: 1.1, jitter: 0.4 },

    /* --- THE SHRINE. A plinth on the cap inside a ring of four prayer wheels.
     *     `style:'bar'` rotors with no `kill` are rideable solids — they nudge,
     *     they never execute, because a crest you have climbed 35 m for should
     *     not be guarded by a coin flip. The crest floats 1.90 m over the
     *     plinth's top at 36.00. */
    { kind: 'platform', p: [0, 35.60, -4], s: [5.0, 0.8, 5.0], mat: 'marble', tint: 0xdce8f4, stripe: true, edge: SAFE_EDGE },
    { kind: 'pedestal', p: [0, 36.00, -4], mat: 'marble', tint: 0xdce8f4, glow: GOLD },
    { kind: 'rotor', p: [4.6, SUMMIT_Y + 0.9, -8.6], style: 'bar', arms: 3, len: 1.4, thick: 0.26, height: 0.7, period: 5.0, axis: 'y', mat: 'copper', tint: 0xc4d0cc },
    { kind: 'rotor', p: [-4.6, SUMMIT_Y + 0.9, -8.6], style: 'bar', arms: 3, len: 1.4, thick: 0.26, height: 0.7, period: 5.0, phase: 0.25, axis: 'y', mat: 'copper', tint: 0xc4d0cc },
    { kind: 'rotor', p: [4.6, SUMMIT_Y + 0.9, 0.6], style: 'bar', arms: 3, len: 1.4, thick: 0.26, height: 0.7, period: 5.0, phase: 0.5, axis: 'y', mat: 'copper', tint: 0xc4d0cc },
    { kind: 'rotor', p: [-4.6, SUMMIT_Y + 0.9, 0.6], style: 'bar', arms: 3, len: 1.4, thick: 0.26, height: 0.7, period: 5.0, phase: 0.75, axis: 'y', mat: 'copper', tint: 0xc4d0cc },
    { kind: 'deco', kindOf: 'monolith', p: [-7.4, SUMMIT_Y + 1.7, -0.6], s: [1.1, 3.4, 0.9], mat: 'stone', tint: 0x8fa0b4 },
    { kind: 'deco', kindOf: 'monolith', p: [-7.4, SUMMIT_Y + 1.6, -8.0], s: [1.0, 3.2, 0.9], mat: 'stone', tint: 0x8fa0b4 },
    { kind: 'deco', kindOf: 'banner', p: [0, SUMMIT_Y + 3.0, 2.4], s: [0.10, 2.8, 1.4], mat: 'cloth', tint: 0x7a3a52 },
    { kind: 'light', p: [0, SUMMIT_Y + 3.4, -4], color: GOLD, intensity: 10, distance: 26 },

    // --- OPTIONAL: the ice pinnacle over the shrine. 2.40 m straight up off
    //     the cap, which is a double's business, and sigil 8 is 1.40 m over it.
    { kind: 'platform', p: [-6.0, 36.40, -9.0], s: [2.2, 2.4, 2.2], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },

    // BEAT 8 — the race finish pad, on the gate landing.
    { kind: 'platform', p: [10.4, 35.16, -4.2], s: [3.0, 0.2, 3.0], mat: 'stone', tint: 0xd6e4f2 },

    /* ========================================================================
     * BEAT 8 — THE RINGS  (the wing overlay across the whole mountain)
     * Take the hat on the cap and thread fourteen rings that spiral one full
     * turn around the mountain, falling 40.0 -> 6.2 m as the radius opens 10 ->
     * 48 m, and land back at the base-camp pedestal. It is the only time the
     * course lets you look at itself from the outside, and it is the reason the
     * silhouette was worth building.
     * ===================================================================== */
    {
      kind: 'rings', r: 2.8, tint: AURORA, mat: 'gold',
      pts: Array.from({ length: 14 }, (_, i) => {
        const a = (90 + i * (360 / 13)) * Math.PI / 180;   // one full turn over 14 rings
        const rad = 10 + i * (38 / 13);
        return [r2(Math.cos(a) * rad), r2(40 - i * (33.8 / 13)), r2(-4 + Math.sin(a) * rad)];
      }),
    },

    /* ========================================================================
     * DRESSING — drifts, icicles, crystals, rocks and stumps. Every scatter is
     * seeded by `ihash`, so the mountain dresses itself identically on every
     * load and `reset()` never moves a drift (hard rule 3). Every point inside
     * a KEEPOUT is dropped, so nothing can land in a mill's sweep, on the
     * bridge, in the chimney or on the shrine cap. Six kinds, repeated: a kind
     * repeated is one instanced draw, a new kind is another one.
     * ===================================================================== */

    // Snowdrifts: the wide, low silhouette that makes a white slope read as
    // a slope. Never landable-looking — props build no colliders.
    ...scatter(0, 40, 10, 34, 14, 51001, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'snowdrift', p: on(x, z, 0.05), s: [1.6 + rnd * 1.6, 0.55 + rnd * 0.4, 1.4 + rnd * 1.3], mat: 'snow', tint: SNOW, count: 4, spread: 3.4, jitter: 0.35 }
    )),
    ...scatter(-28, 8, 8, 26, 12, 51002, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'snowdrift', p: on(x, z, 0.05), s: [1.4 + rnd * 1.5, 0.5 + rnd * 0.4, 1.3 + rnd * 1.2], mat: 'snow', tint: SNOW, count: 4, spread: 3.2, jitter: 0.35 }
    )),
    ...scatter(2, -38, 10, 30, 12, 51003, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'snowdrift', p: on(x, z, 0.05), s: [1.5 + rnd * 1.5, 0.5 + rnd * 0.4, 1.4 + rnd * 1.2], mat: 'snow', tint: SNOW, count: 4, spread: 3.2, jitter: 0.35 }
    )),
    ...scatter(34, -4, 8, 26, 10, 51004, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'snowdrift', p: on(x, z, 0.05), s: [1.4 + rnd * 1.4, 0.5 + rnd * 0.4, 1.3 + rnd * 1.2], mat: 'snow', tint: SNOW, count: 4, spread: 3.0, jitter: 0.35 }
    )),

    // Wind-blasted rock: the dark counterpoint, or the whole mountain is one
    // value and nothing in it reads at distance.
    ...scatter(-20, 20, 8, 28, 10, 51101, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'rock', p: on(x, z, -0.15), s: [0.9 + rnd * 1.0, 0.7 + rnd * 0.8, 0.9 + rnd * 1.0], mat: 'stone', tint: 0x8fa0b4, count: 3, spread: 2.6, jitter: 0.35 }
    )),
    ...scatter(14, -26, 8, 26, 10, 51102, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'rock', p: on(x, z, -0.15), s: [0.9 + rnd * 1.1, 0.7 + rnd * 0.8, 0.9 + rnd * 1.0], mat: 'stone', tint: 0x8fa0b4, count: 3, spread: 2.6, jitter: 0.35 }
    )),
    ...scatter(-44, -22, 8, 24, 8, 51103, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'rock', p: on(x, z, -0.15), s: [1.0 + rnd * 1.2, 0.8 + rnd * 0.9, 1.0 + rnd * 1.1], mat: 'stone', tint: 0x8fa0b4, count: 3, spread: 2.8, jitter: 0.35 }
    )),

    // Icicle fringes along the gorge's rim and the cliff bands.
    ...scatter(-30, -22, 12, 24, 9, 51201, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'icicle', p: on(x, z, 1.6 + rnd * 0.8), s: [0.4, 1.0 + rnd * 0.8, 0.4], mat: 'ice', tint: ICE, count: 6, spread: 1.6, jitter: 0.4 }
    )),
    ...scatter(0, -4, 15, 22, 10, 51202, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'icicle', p: on(x, z, 1.4 + rnd * 0.9), s: [0.4, 1.0 + rnd * 0.9, 0.4], mat: 'ice', tint: ICE, count: 6, spread: 1.5, jitter: 0.4 }
    )),

    // Aurora-lit crystal, only up high where the sky can be seen through it.
    ...scatter(0, -4, 16, 26, 8, 51301, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'crystal', p: on(x, z, 0.2), s: [0.5 + rnd * 0.4, 0.9 + rnd * 0.9, 0.5 + rnd * 0.4], mat: 'crystal', tint: 0x8fe8ff, count: 3, spread: 1.9, jitter: 0.4 }
    )),

    // Dead pines at the tree line, so the bottom of the mountain has a scale
    // reference and the top visibly has none.
    ...scatter(-6, 42, 12, 30, 7, 51401, (x, z, rnd) => (
      gy(x, z) > 6.0 ? null
        : { kind: 'tree', p: on(x, z, -0.3), h: 5.5 + rnd * 3.0, r: 1.7 + rnd * 0.9, mat: 'bark', tint: 0x6a6058, leafTint: 0x7a9a88, seed: 51401 + (x | 0) }
    )),
    ...scatter(38, 26, 8, 22, 6, 51402, (x, z, rnd) => (
      gy(x, z) > 6.0 ? null
        : { kind: 'tree', p: on(x, z, -0.3), h: 5.0 + rnd * 3.0, r: 1.6 + rnd * 0.9, mat: 'bark', tint: 0x6a6058, leafTint: 0x7a9a88, seed: 51402 + (x | 0) }
    )),
    ...scatter(-44, 6, 8, 22, 6, 51403, (x, z, rnd) => (
      gy(x, z) > 6.0 ? null
        : { kind: 'tree', p: on(x, z, -0.3), h: 5.0 + rnd * 3.2, r: 1.6 + rnd * 0.9, mat: 'bark', tint: 0x6a6058, leafTint: 0x7a9a88, seed: 51403 + (x | 0) }
    )),

    ...scatter(-10, 34, 10, 30, 8, 51501, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'stump', p: on(x, z, 0.24), s: [1.0, 0.6, 1.0], mat: 'wood', tint: 0x6a5c50, count: 3, spread: 3.6, jitter: 0.3 }
    )),
  ],

  /* ------------------------------------------------------------------------
   * CRITTERS
   * --------------------------------------------------------------------- */
  critters: [
    // THE GNASHER at the cave mouth (contract §23: chained, telegraphs with a
    // 0.5 s crouch before every lunge). Chain 5.5 m off a post 3 m inside the
    // chamber, so its reach is a disc you can pace out from the terrace before
    // you commit — and the coin line through the cave runs right through it.
    {
      kind: 'gnasher', p: [24.0, TERRACE_Y, -2.0], chain: 5.5,
      post: [21.0, TERRACE_Y, -2.0], postHits: 3,
      telegraph: 0.5, tint: 0x3a4a5c,
    },
    // BUMBLERS. Side contact is knockback plus a 0.4 s stun, never a death —
    // which on a 35 deg slope in a 12 m/s^2 gale is quite enough.
    { kind: 'bumbler', path: [on(-6, 40), on(6, 38), on(2, 45), on(-6, 40)], speed: 1.5 },
    { kind: 'bumbler', path: [on(-12, -33), on(0, -36), on(10, -33), on(0, -36), on(-12, -33)], speed: 1.7 },
    { kind: 'bumbler', path: [[20.5, TERRACE_Y, 5.0], [16.0, TERRACE_Y, 4.0], [15.5, TERRACE_Y, 0.0], [16.0, TERRACE_Y, 4.0], [20.5, TERRACE_Y, 5.0]], speed: 1.6 },
    // SKITTERS — storm birds. One works the west face (it swoops at anyone on
    // a shelf), one patrols the gorge, one circles the cap.
    { kind: 'skitter', p: [-33, 12.0, 18], path: [[-30, 11.0, 26], [-38, 14.0, 6]], amp: 2.0, speed: 3.6 },
    { kind: 'skitter', p: [-29, 12.0, -22], path: [[-36, 11.0, -14], [-22, 14.0, -30]], amp: 2.4, speed: 4.0 },
    { kind: 'skitter', p: [0, 42.0, -4], path: [[10, 41.0, 4], [-10, 44.0, -12]], amp: 2.2, speed: 4.2 },
    // THE WARDEN of the shrine gate. Three hits, on the flattest 14 m of the
    // cap (EXACTLY 35.20). Its charge needs something to break itself on — the
    // shrine plinth and the two monoliths are that something.
    { kind: 'warden', p: [0, SUMMIT_Y, -9.0], arena: { c: [0, -4], r: 7.0 }, hp: 3, tint: 0x7a8ea4 },
  ],
};
