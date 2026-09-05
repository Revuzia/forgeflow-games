/**
 * CRESTBOUND — RIME SPIRE 2 : "GLACIER SLIDE"
 * runtime/data/courses/rime-2.js                                    CONTRACT §25
 * ===========================================================================
 *
 * An OPEN DIORAMA about 130 x 130 m across a 140 x 140 m heightfield, and the
 * only course in the game whose set piece is a piece of ENGINEERING: a carved
 * ice FLUME — a luge chute on serac pylons — that leaves the summit shelf, sails
 * out over the east glacier fourteen metres above the snow, wraps the east mesa,
 * and comes back down onto a frozen lake. Everything else in the course is the
 * way back UP.
 *
 *   BEAT 1  THE SUMMIT SHELF   spawn, the chute mouth, the race start
 *   BEAT 2  THE FLUME          ~120 m of ice: 6 banked turns, 3 gaps, an ice
 *                              wheel, two hanging icicles, and a wall you can
 *                              break if you notice it is the wrong colour
 *   BEAT 3  THE FROZEN LAKE    the run-out, a melt pool you dive, heaving floes
 *   BEAT 4  THE WEST ICE FACE  the climb: ice-block lifts and static seracs
 *   BEAT 5  THE CRYSTAL CAVERN beams, a Warden, and a vanish stair to the roof
 *   BEAT 6  THE CREVASSE       a wall-kick shaft out of the west hollow
 *   BEAT 7  THE EAST SERACS    the other way home — a spiral stair off the mesa
 *   BEAT 8  THE PEAK           three routes, one crest
 *
 * ---------------------------------------------------------------------------
 * ROUTES TO THE OPEN CREST (the peak cap at 45.60, crest at 46.75)
 * ---------------------------------------------------------------------------
 *   A  THE SERAC SPIRAL   eight static ice blocks winding round the peak plinth
 *                         from the shelf's north ground (34.2) to the cap.
 *                         1.45 m of rise per step, 3.90 m centre-to-centre and
 *                         ~1.1 m edge-to-edge. Always works, never needs a
 *                         moving platform, and is the line the gate walks.
 *   B  THE ICE LIFT       a `mover` elevator on the peak's east face, shelf lip
 *                         30.40 -> shoulder ledge 41.00, then two static hops.
 *                         A shortcut, not a dependency: ROUTE A reaches every
 *                         surface B reaches, statically. (Lesson from the Keep:
 *                         the reach gate has NO moving-platform edge worth
 *                         trusting, so nothing REQUIRED may hang off a mover.)
 *   C  THE NORTH SPUR     five seracs up the cirque face behind the peak from
 *                         the ridge at 33.9, ending on the spur that carries
 *                         sigil 8. Static end to end.
 *
 * ---------------------------------------------------------------------------
 * THE TERRAIN SAMPLER
 * ---------------------------------------------------------------------------
 * `terrainHeightAt(x, z)` below is a TRANSLITERATION of `sampleHeights()` in
 * runtime/world/terrain.js — the same order, the same falloffs, the same hash —
 * so every `p` in this file was solved against the field the game actually
 * builds AND the field `_harness/reachcheck.mjs` measures. Evaluation order:
 *
 *   1. y  = base
 *   2. HILLS    d = hypot(x-hx, z-hz); if d < r:  k = bump(d/r)
 *               y += h * k*k*(3-2k)                       (a dome, not a cone)
 *   3. RIDGES   half-width w/2; d = distance to the SEGMENT a..b
 *               if d < w/2:  y += h * bump(d/(w/2))
 *   4. NOISE    y += amp * fbm(x*freq, z*freq, seed, 4)   (gain .5, lacunarity 2.03)
 *   5. FLATS    t = d/r; if t < 1: k = (t <= 0.55) ? 1 : bump((t-0.55)/0.45)
 *               y += (flat.h - y) * k
 *               => EXACTLY flat.h inside 55 % of the radius; later flats win.
 *
 *   bump(t) = 0.5 * (1 + cos(PI*t))    for 0 < t < 1, 1 at t<=0, 0 at t>=1
 *
 * Because the hill falloff is squared-smoothstepped, every summit is domed and
 * every skirt meets the surrounding snow at zero slope — no creases. The SPIRE
 * is deliberately steep (its steepest face is ~54 deg, far past the 38 deg slide
 * threshold): a glacier that you could walk straight up would not need a flume,
 * a crevasse or a serac stair, and this course is made of all three. Every
 * REQUIRED walk is on a flat or on authored geometry; the measured worst case on
 * a required line is the east ridge at 33 deg, between the mesa and the seracs.
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS (contract §25 + runtime/data/index.js)
 * ---------------------------------------------------------------------------
 *   p            CENTRE, [x, y, z].  s = FULL size, [sx, sy, sz].
 *                => a platform's walkable top is p[1] + s[1]/2.
 *   yaw          RADIANS. yaw 0 faces -Z. +yaw is counter-clockwise from above.
 *   rot          Euler XYZ radians (three.js order; `rampSeg` below solves it).
 *   stripe:true  "you had to jump to get here". Walk-on ground never gets one.
 *   text         local XY facing local +Z, so rot [0,0,0] faces a player walking
 *                north (-Z) — the sign is read from its +Z side.
 *
 * ---------------------------------------------------------------------------
 * THE REACH BUDGET ACTUALLY USED (safe limits from core/tuning.js REACH_TABLE:
 * single 4.52 flat / 4.99 at -1.0 / 5.39 at -2.0 / 3.88 at +1.0 / 3.28 at +1.6;
 * double 5.24; triple 6.11; longjump 6.42)
 * ---------------------------------------------------------------------------
 *   longest REQUIRED gap     3.90 m centre-to-centre (~1.10 m edge-to-edge) at
 *                            +1.45 m — BEAT 8, the serac spiral. Single-safe at
 *                            +1.45 m is 3.42 m, so the spiral is inside the
 *                            envelope twice over on the number the gate measures.
 *   tallest REQUIRED step    1.60 m — BEAT 5, the vanish crystal stair
 *                            (single-jump apex is 1.91 m).
 *   wall-kick shaft          3.20 m clear, 8.60 m tall (limit 3.4 m wide;
 *                            1 jump + 4 kicks = feet 14.80 -> 24.31, clearing
 *                            the 23.00 exit ledge) — BEAT 6.
 *   longest OPTIONAL gap     4.84 m at -0.90 m — the flume's GAP A. Single-safe
 *                            at -0.90 m is 4.94 m. GAP B is 4.82 m at -1.00 m
 *                            (safe 4.99) and GAP C 4.49 m at -0.90 m.
 *   riskiest OPTIONAL line   the flume itself: a 14 m drop off either berm onto
 *                            open snow. There is no fall damage in this engine —
 *                            the punishment is the climb, which is the course.
 *
 * CONTENT LEDGER: 8 sigils · 7 crests · 112 coins · 5 checkpoints ·
 * hazard families: ice, mover, vanish, rotor, pendulum, beam, breakable,
 * jumppad (8) + critters bumbler, skitter, warden (3) = 11.
 */

/* ===========================================================================
 * 0. Palette — RIME SPIRE
 * ======================================================================== */

const SNOW = 0xe6f2ff;       // lit snow
const ICE = 0x9fdcf5;        // the flume, the seracs, the lake
const ICE_DEEP = 0x4a8fb8;   // shadowed ice / crevasse walls
const ROCK = 0x6b7484;       // the spire's exposed schist
const CRYSTAL = 0xbfeeff;    // the cavern
const AURORA = 0x4affc8;     // the sky's green band, used sparingly on trims
const GOLD = 0xffd257;       // coin / sigil / crest glow
const WARM = 0xffb07a;       // the only warm light on the mountain
const SAFE_EDGE = 0xffe9a8;  // leading-edge stripe

/* ===========================================================================
 * 1. THE HEIGHTFIELD — every `p` in this file is justified against it
 * ======================================================================== */

/** Heightfield definition. Consumed verbatim by world/terrain.js (contract §18). */
const HEIGHTS = {
  seed: 20260903,
  base: 1.4,
  hills: [
    // --- THE SPIRE. One dominant cone: 33 m over a 46 m radius, so its steepest
    //     face is ~54 deg. Nothing REQUIRED walks it; it is what the flume flies
    //     off and what the seracs climb back up. ---
    { p: [0, -40], r: 46, h: 33 },
    // --- the two shoulders that give the course its two mesas ---
    { p: [32, -12], r: 24, h: 12 },     // EAST MESA (the flume's mid station)
    { p: [-34, -6], r: 26, h: 11 },     // WEST SHOULDER (the crystal cavern)
    // --- the moraines that close the diorama east, west and south ---
    { p: [-54, 28], r: 22, h: 4.5 },
    { p: [52, 30], r: 22, h: 4.0 },
    { p: [0, 62], r: 26, h: 3.5 },
  ],
  ridges: [
    // THE CIRQUE WALL. Wide (30 m => 15 m half-width) so its inner face stays
    // near 20 deg and the walk in behind the peak is a walk, not a slide.
    { a: [-60, -60], b: [60, -62], w: 30.0, h: 5.0 },
  ],
  flats: [
    { p: [0, -30], r: 13, h: 30.0 },     // SUMMIT SHELF   (spawn + cp1)
    { p: [36, -6], r: 10, h: 17.0 },     // EAST MESA TOP  (cp2, the mid station)
    { p: [-30, 6], r: 11, h: 12.0 },     // CAVERN APRON   (cp4)
    { p: [2, 36], r: 20, h: 1.0 },       // THE FROZEN LAKE (cp3)
    { p: [-13, 42], r: 7.5, h: -2.6 },   // THE MELT POOL (a later flat wins)
  ],
  noise: { amp: 0.34, freq: 0.05 },
};

/* --- the sampler (formula in the header) --------------------------------- */

/** terrain.js `bump`: 1 at the centre, 0 at the rim, C1 at both ends. */
function bump(t) {
  if (t >= 1) return 0;
  if (t <= 0) return 1;
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

/** terrain.js `fade`: quintic, C2 — so the noise band has no normal creases. */
function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

/** terrain.js `ihash` — Math.imul only, so the 32-bit wrap is engine-identical. */
function ihash(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** terrain.js `vnoise` — 2D value noise in [-1, 1]. */
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = fade(x - ix), fz = fade(z - iz);
  const a = ihash(ix, iz, seed), b = ihash(ix + 1, iz, seed);
  const c = ihash(ix, iz + 1, seed), d = ihash(ix + 1, iz + 1, seed);
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return (ab + (cd - ab) * fz) * 2 - 1;
}

/** terrain.js `fbm` — 4 octaves, gain 0.5, lacunarity 2.03. */
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

/** Distance from (x,z) to the SEGMENT a..b (clamped at both ends). */
function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz;
  let t = L2 > 1e-9 ? ((x - a[0]) * dx + (z - a[1]) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}

/**
 * Ground height at (x, z). THE authority for every placement in this file, and
 * bit-identical to `sampleHeights(def)` in world/terrain.js, which is what
 * `_harness/reachcheck.mjs` samples. Exported so the harness and the terrain
 * builder can assert against it.
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
  if (HEIGHTS.noise.amp !== 0) {
    y += fbm(x * HEIGHTS.noise.freq, z * HEIGHTS.noise.freq, HEIGHTS.seed, 4) * HEIGHTS.noise.amp;
  }
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
 * 2. Authoring helpers — every one resolves against the heightfield or against
 *    a named deck point, so no placement in this file is a guess.
 * ======================================================================== */

const gy = terrainHeightAt;
const r2 = (v) => Math.round(v * 100) / 100;

/** A point ON the ground at (x, z), lifted `up` metres. */
function on(x, z, up) { return [r2(x), r2(gy(x, z) + (up || 0)), r2(z)]; }

/** Centre of a box of full height `sy` whose base sits on the ground, sunk `sink` m. */
function seat(x, z, sy, sink) { return [r2(x), r2(gy(x, z) - (sink || 0) + sy / 2), r2(z)]; }

/** Lift a deck point (or any [x,y,z]) straight up. */
function up(p, dy) { return [p[0], r2(p[1] + dy), p[2]]; }

/**
 * ONE SEGMENT OF THE FLUME.
 *
 * `a` and `b` are the DECK-TOP endpoints of the run; the slab is solved back
 * from them, so the surface the player rides passes exactly through the two
 * numbers quoted in the beat comments.
 *
 * Solved against `builders.js buildRamp` + the three.js XYZ Euler basis:
 *   local +X (world) = ( cos(ry)cos(rz),  sin(rz), -cos(rz)sin(ry) )   the RUN
 *   local +Y (world) = (-cos(ry)sin(rz),  cos(rz),  sin(rz)sin(ry) )   the DECK NORMAL
 *   local +Z (world) = ( sin(ry),         0,        cos(ry)        )   the WIDTH
 * so `ry = atan2(-dz, dx)` aims the run and `rz = atan2(dy, horizontal)` pitches
 * it. `p` is pushed half a deck thickness DOWN the normal, which is what puts
 * the top face on a..b. `_harness/reachcheck.mjs` reads the same basis, so its
 * two end rectangles land on the same two points this comment names.
 */
function rampSeg(a, b, w, extra) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const Lh = Math.hypot(dx, dz);
  const L = Math.hypot(Lh, dy);
  const ry = Math.atan2(-dz, dx);
  const rz = Math.atan2(dy, Lh);
  const t = (extra && extra.deck) || 0.70;
  const nx = -Math.cos(ry) * Math.sin(rz);
  const ny = Math.cos(rz);
  const nz = Math.sin(rz) * Math.sin(ry);
  const def = {
    kind: 'ramp',
    p: [r2((a[0] + b[0]) / 2 - nx * t / 2), r2((a[1] + b[1]) / 2 - ny * t / 2), r2((a[2] + b[2]) / 2 - nz * t / 2)],
    s: [r2(L), t, w],
    rot: [0, r2(ry), r2(rz)],
    surface: 'ice', mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE,
  };
  if (extra) for (const k in extra) if (k !== 'deck') def[k] = extra[k];
  return def;
}

/** A run of flume segments through consecutive deck points (no gaps inside). */
function flume(pts, w, extra) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) out.push(rampSeg(pts[i], pts[i + 1], w, extra));
  return out;
}

/** Horizontal distance between two deck points — quoted in every GAP comment. */
function gapOf(a, b) { return r2(Math.hypot(b[0] - a[0], b[2] - a[2])); }

/**
 * A BANKED WALL on the OUTSIDE of a flume turn, solved from the three deck
 * points that make the turn rather than eyeballed — the first draft of this
 * course put all six berms on the INSIDE, which is the wall a luge does not
 * need and cannot see over.
 *
 * The change in heading through a corner IS the centripetal direction, so
 * `outward = normalise(hin - hout)` points away from the turn centre; the wall
 * stands one deck half-width plus 0.30 m out along it, runs along the bisector
 * of the two headings, and sits with its base on the deck (p.y = deck + h/2).
 * `off` slides it along that bisector, which is what lets TURN 5 be two short
 * berms with a breakable panel between them.
 */
function bermAt(prev, at, next, len, h, off, kind) {
  const nrm = (a) => { const L = Math.hypot(a[0], a[1]) || 1; return [a[0] / L, a[1] / L]; };
  const hin = nrm([at[0] - prev[0], at[2] - prev[2]]);
  const hout = nrm([next[0] - at[0], next[2] - at[2]]);
  const outw = nrm([hin[0] - hout[0], hin[1] - hout[1]]);
  const bis = nrm([hin[0] + hout[0], hin[1] + hout[1]]);
  const d = CHUTE_W / 2 + 0.30;
  const o = off || 0;
  return {
    kind: kind || 'ice',
    p: [r2(at[0] + outw[0] * d + bis[0] * o), r2(at[1] + h / 2), r2(at[2] + outw[1] * d + bis[1] * o)],
    s: [len, h, 0.6],
    rot: [0, r2(Math.atan2(-bis[1], bis[0])), 0],
  };
}

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
 * spaced by arc length, floating `lift` metres. A straight {line} would bury
 * half a trail in snow this lumpy; this cannot.
 */
function trailCoins(pts, n, lift) {
  const L = lift === undefined ? 1.1 : lift;
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(d); total += d;
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    let want = total * (i + 0.5) / n, k = 0;
    while (k < seg.length - 1 && want > seg[k]) { want -= seg[k]; k++; }
    const t = seg[k] > 0 ? want / seg[k] : 0;
    out.push({ p: on(pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t,
                     pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t, L) });
  }
  return out;
}

/** Coins strung down a stretch of flume, `h` metres over the deck. */
function deckLine(a, b, n, h) {
  return { line: { a: up(a, h), b: up(b, h), n } };
}

/**
 * KEEP-OUT VOLUMES. The dressing block at the bottom scatters snowdrifts and
 * seracs over the whole diorama; these rectangles are the places a decorative
 * prop must never land, because a prop's collider (rocks) or its silhouette
 * (drifts under a landing) turns a readable jump into a guess.
 *
 * Rects are [x0, x1, z0, z1] in world metres, already margined.
 */
const KEEPOUT = [
  [-8.0, 52.0, -28.0, -4.0],    // BEAT 2: the whole upper flume corridor
  [-8.0, 40.0, -4.0, 26.0],     // BEAT 2/3: the lower flume + its run-out
  [-40.0, -18.0, -4.0, 16.0],   // BEAT 5: the crystal cavern and its apron
  [-20.0, -6.0, -26.0, -12.0],  // BEAT 6: the crevasse and its snow bridges
  [4.0, 20.0, -26.0, -14.0],    // BEAT 7: the east serac spiral
  [-12.0, 12.0, -58.0, -36.0],  // BEAT 8: the peak, its spiral and the spur
  [-26.0, -2.0, 30.0, 52.0],    // BEAT 3: the melt pool and its floes
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
 * `reset()` never moves a serac (contract hard rule 3). Points inside a KEEPOUT
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

const SHELF_Y = 30.00;     // summit shelf flat — EXACTLY 30.00 inside 7.15 m of (0,-30)
const MESA_Y = 17.00;      // east mesa top   — EXACTLY 17.00 inside 5.50 m of (36,-6)
const APRON_Y = 12.00;     // cavern apron    — EXACTLY 12.00 inside 6.05 m of (-30,6)
const LAKE_Y = 1.00;       // frozen lake     — EXACTLY  1.00 inside 11.00 m of (2,36)
const POOL_FLOOR = -2.60;  // melt pool floor — EXACTLY -2.60 inside 4.13 m of (-13,42)
const WATER_Y = 0.90;      // melt-pool surface: 0.10 m under the ice lip, 3.50 m deep
const PEAK_TOP = 45.60;    // the peak cap's walkable top
const CHUTE_W = 5.20;      // flume deck width (berms stand on the outside of it)
const DECK_T = 0.70;       // flume deck thickness

/* --- BEAT 2: THE FLUME, deck-top points, with the ground under each ------- */
/*  point          deck      ground   clearance   note                        */
const U0 = [4.00, 29.40, -22.00];   // 28.96  0.44  cut into the shelf lip
const U1 = [11.00, 26.60, -18.00];  // 15.07 11.53  TURN 1 (left)
const U2 = [20.00, 23.80, -19.50];  // 12.54 11.26  TURN 2 (right) — GAP A follows
const U3 = [24.20, 22.90, -21.90];  // 12.21 10.69  landing
const U4 = [33.00, 20.60, -24.50];  //  7.76 12.84  TURN 3 (left)
const U5 = [42.00, 19.00, -21.00];  //  5.82 13.18  the high span
const U6 = [47.00, 18.20, -14.50];  //  3.98 14.22  TURN 4 (left) — the outside wall
const U7 = [43.50, 17.60, -8.50];   // 11.71  5.89  coming back in over the mesa skirt
const U8 = [38.00, 17.30, -6.50];   // 17.00  0.30  the mid station, on the mesa
/*  segment slopes: 19.15 / 17.05 / [GAP A] / 14.06 / 9.41 / 5.57 / 4.94 / 2.94 deg
    GAP A: U2 -> U3 = 4.84 m at dy -0.90 (single-safe there is 4.94 m)          */

const L0 = [34.00, 17.20, -2.00];   // 17.00  0.20  launch off the mesa's south lip
const L1 = [33.00, 14.60, 4.50];    //  3.01 11.59  TURN 5 (right)
const L2 = [36.50, 12.00, 10.50];   //  1.46 10.54  — GAP B follows
const L3 = [32.90, 11.00, 13.70];   //  1.36  9.64  landing
const L4 = [26.00, 8.60, 17.50];    //  1.33  7.27  TURN 6 (right)
const L5 = [18.50, 6.60, 18.60];    //  1.26  5.34  — GAP C follows
const L6 = [14.10, 5.70, 19.50];    //  1.27  4.43  landing
const L7 = [7.00, 4.00, 19.00];     //  1.17  2.83  dropping onto the lake
const L8 = [0.50, 2.60, 21.50];     //  1.09  1.51
const L9 = [-4.50, 2.20, 24.00];    //  1.06  1.14  THE MOUTH, over the lake ice
/*  segment slopes: 21.57 / 20.51 / [GAP B] / 16.94 / 14.78 / [GAP C] / 13.44 /
    11.37 / 4.09 deg.  GAP B: L2 -> L3 = 4.82 m at dy -1.00 (safe 4.99 m).
    GAP C: L5 -> L6 = 4.49 m at dy -0.90 (safe 4.94 m).
    Upper flume 61.9 m + lower flume 58.0 m = about 120 m of ice.               */

/* --- BEAT 6: the crevasse. Floor 14.40, exit ledge 23.00, 3.20 m clear ---- */
const CREV = [-13.0, -21.0];
const CREV_FLOOR = 14.40;
const CREV_LEDGE = 23.00;

/* --- BEAT 8: the peak. Plinth 34.00 -> 45.60; ROUTE A winds round it ------ */
const PEAK = [0, -46];

/* ===========================================================================
 * 4. THE COURSE
 * ======================================================================== */

export default {
  id: 'rime-2',
  realm: 'rime',
  theme: 'rime',
  name: 'GLACIER SLIDE',
  subtitle: 'The long ice race',
  order: 2,
  difficulty: 6,
  music: 'rime',

  /* Par times per crest id (ms) — the HUD shows them, nothing gates on them. */
  par: {
    open: 95000, sigils: 285000, coins: 320000,
    secret: 150000, boss: 175000, race: 45000, wing: 140000,
  },

  /* Spawn on the summit shelf (EXACTLY 30.00), facing south-east down the chute
     mouth: heading (0.530, 0.848) => yaw -2.58. From here the whole course is
     one read — the flume falling away to the east mesa, the lake glittering
     under it, the cavern's blue mouth on the right and the peak behind you. */
  spawn: { p: [0, SHELF_Y, -30], yaw: -2.58 },
  killY: -16,
  bounds: { min: [-72, -20, -72], max: [72, 62, 72] },

  intro: {
    /* One sentence. game.js already prints "RIME SPIRE · GLACIER SLIDE" above
       this line, so repeating the name here would read as a duplicate. */
    text: 'Somebody carved a road out of this glacier and then let it freeze. It only goes one way — the climb back is your problem.',
    cam: [
      { p: [-6, 52, 6], look: [6, 26, -18], t: 0 },
      { p: [46, 30, -34], look: [30, 19, -20], t: 2.8 },
      { p: [4, 33, -16], look: [0, 30, -30], t: 5.6 },
    ],
  },

  ambience: { wind: 0.72, water: 0.18, birds: 0.10 },

  /* ------------------------------------------------------------------------
   * TERRAIN + WATER
   * --------------------------------------------------------------------- */

  terrain: {
    kind: 'terrain',
    origin: [-70, -70],
    size: [140, 140],
    res: 1.0,
    surface: 'snow',
    heights: HEIGHTS,
    /* Snow, not grass: a camera-local blade ring at low density reads as
       spindrift over the crust rather than as a lawn. `cross: false` keeps the
       field at one triangle per blade on a course whose flume is already the
       most expensive static geometry in the game. */
    grass: { count: 9000, density: 22, height: 0.14, cross: false, color: 0xd8e8f6 },
    // Trodden paths: the two ways home, plus the shore. These do NOT change
    // height (terrain.js `samplePaths` only carves the look) — they exist so an
    // open diorama still tells you where people walk.
    paths: [
      { pts: [[-6, 24], [-14, 20], [-22, 16], [-28, 12], [-30, 6]], w: 2.8 },   // lake -> cavern
      { pts: [[-30, 2], [-27, -8], [-22, -14], [-17, -18]], w: 2.6 },           // cavern -> crevasse
      { pts: [[36, -8], [30, -13], [24, -18], [18, -20]], w: 2.8 },             // mesa -> east seracs
      { pts: [[0, -34], [0, -40], [0, -46]], w: 3.0 },                          // shelf -> the peak
    ],
  },

  waters: [
    {
      // THE MELT POOL. Surface 0.90, floor -2.60 => 3.50 m deep, which is a real
      // dive and a real surfacing. The box is buried on every edge: the lake ice
      // stands at 1.00 all round the basin's 7.5 m rim, 0.10 m above the water
      // line, so the plane is hidden by the lip rather than clipped by it.
      kind: 'water', kind2: 'lake',
      p: [-13, r2(WATER_Y - 1.75), 42], s: [15, 3.5, 15],
      tint: 0x2f7ea8,
    },
  ],

  /* ------------------------------------------------------------------------
   * CHECKPOINTS — 5, every one on a FLAT (exact heights, no slope under the
   * respawn) and every one BEFORE its difficulty spike, never after.
   * `clockOffset` is the course-clock phase a respawn rewinds to, so the
   * vanish bridges, the ice wheel and the beams are always met at the same,
   * fair, start-of-cycle phase however many times you die.
   * --------------------------------------------------------------------- */
  checkpoints: [
    // flat 30.00 — 4 m clear of the spawn beam, before the chute mouth
    { id: 'cp-summit', p: [0, SHELF_Y, -26], yaw: -2.58, clockOffset: 0 },
    // flat 17.00 — the mid station, before the lower flume and its two gaps
    { id: 'cp-mesa', p: [36, MESA_Y, -4], yaw: 0.35, clockOffset: 0 },
    // flat 1.00 — the lake, before the melt-pool dive and the west ice face
    { id: 'cp-lake', p: [4, LAKE_Y, 28], yaw: 2.30, clockOffset: 0 },
    // flat 12.00 — the cavern apron, before the beams and the Warden
    { id: 'cp-cavern', p: [-30, APRON_Y, 11.5], yaw: 0, clockOffset: 1.2 },
    // authored ledge, flat by construction — before the crevasse and the peak
    { id: 'cp-crevasse', p: [CREV[0] + 4.2, CREV_LEDGE, CREV[1] + 1.0], yaw: -0.7, clockOffset: 2.4 },
  ],

  /* ------------------------------------------------------------------------
   * CRESTS — 7, one of each type the contract knows.
   * --------------------------------------------------------------------- */
  crests: [
    {
      id: 'open', type: 'open', name: 'THE CREST ON THE PEAK',
      hint: 'Three ways up the plinth. The spiral always works.',
      p: [PEAK[0], r2(PEAK_TOP + 1.15), PEAK[1]],
    },
    {
      id: 'sigils', type: 'sigils', name: 'EIGHT SIGILS OF THE GLACIER',
      hint: 'Flume, secret chute, pool floor, ice fall, cavern, crevasse, spur.',
      spawnAt: [0, r2(SHELF_Y + 1.45), -34],       // the shelf pedestal
    },
    {
      id: 'coins', type: 'coins', name: 'A HUNDRED COINS', threshold: 100,
      hint: '112 are out on the ice. You can miss twelve.',
      spawnAt: [-6, r2(SHELF_Y + 1.45), -28],      // the second shelf pedestal
    },
    {
      id: 'secret', type: 'secret', name: 'WHAT THE WRONG-COLOURED WALL HID',
      trigger: 'ice-wall-broken',
      hint: 'The outside of turn five is a shade too blue. Hit it.',
      spawnAt: [15.2, 11.65, 5.6],                 // the pinnacle cap, top 10.35
    },
    {
      id: 'boss', type: 'boss', name: 'THE WARDEN OF THE CRYSTAL CAVERN',
      hint: 'Jump the shockwave, dodge the charge, pound its back.',
      spawnAt: [-30, r2(APRON_Y + 1.6), 4],
    },
    {
      id: 'race', type: 'race', name: 'THE LUGE',
      hint: 'Summit to the lake, the whole flume, 45 seconds.',
      start: [4, SHELF_Y, -23], finish: [-4.5, LAKE_Y, 27], limitMs: 45000,
      spawnAt: [-4.5, r2(LAKE_Y + 1.45), 27],
    },
    {
      id: 'wing', type: 'power', name: 'THE LONG GLIDE', power: 'wing',
      hint: 'Take the hat off the cavern roof and go west, downhill, all of it.',
      p: [-48.0, 15.60, 14.0],
    },
  ],

  /* ------------------------------------------------------------------------
   * SIGILS — 8, all on OPTIONAL lines you have to choose to take: three of them
   * are on the flume itself, which means slowing down on a course that is about
   * not slowing down. Each is verified against the surface it hangs over.
   * --------------------------------------------------------------------- */
  sigils: [
    { p: up(U2, 1.40), note: '1 — over the flume at TURN 2, 1.40 m above the deck (23.80)' },
    { p: [36.5, 21.80, -26.0], note: '2 — the serac beside TURN 3 (platform top 20.55, +1.25)' },
    { p: [15.2, 11.65, 5.6], note: '3 — the pinnacle cap behind the broken wall (top 10.35, +1.30)' },
    { p: [-13.0, -1.40, 42.0], note: '4 — the floor of the melt pool (-2.60, +1.20, 2.30 m under water)' },
    { p: [-8.0, 8.65, 20.0], note: '5 — the top of the ice fall on the lake shore (top 7.40, +1.25)' },
    { p: [-30.0, 13.40, 1.0], note: '6 — the crystal cavern, over the beam lane (floor 12.00, +1.40)' },
    { p: [-8.8, 24.30, -20.0], note: '7 — the crevasse exit ledge (top 23.00, +1.30)' },
    { p: [0.0, 43.90, -52.0], note: '8 — the north spur behind the peak (top 42.60, +1.30)' },
  ],

  /* ------------------------------------------------------------------------
   * COINS — 112 placed, 100 needed. The flume lines are the ones you cannot
   * help collecting; everything else is a line you chose.
   * --------------------------------------------------------------------- */
  coins: [
    // BEAT 1 — out of spawn, past the pedestals, to the chute mouth. (10)
    // Data lane 2026-09-04: the game boots at checkpoints[0], not `spawn`, so
    // this trail used to start BEHIND the player, between hero and camera
    // (metre-wide pancakes in the first frame). It now enters from the side
    // and joins the path at the pad.
    // 2026-09-05: re-routed round the pad's south side — two of these coins
    // hung between the camera and the board's last line.
    ...trailCoins([[-3.2, -27.5], [-0.5, -28.6], [2.6, -27.2], [5.5, -23.5]], 10, 1.1),
    // BEAT 2 — the upper flume, then the arc across GAP A. (6 + 5 + 6)
    deckLine(U0, U2, 6, 1.15),
    ...arcCoins(up(U2, 1.0), up(U3, 1.0), 1.3, 5),
    deckLine(U3, U6, 6, 1.15),
    // BEAT 2 — a ring on the mid station, the last easy money before the drop. (6)
    { ring: { c: [36, -6], r: 3.6, n: 6, y: r2(MESA_Y + 1.1) } },
    // BEAT 2 — the lower flume, with an arc over each of its two gaps. (6+5+5+5+6)
    deckLine(L0, L2, 6, 1.15),
    ...arcCoins(up(L2, 1.0), up(L3, 1.0), 1.3, 5),
    deckLine(L3, L5, 5, 1.15),
    ...arcCoins(up(L5, 1.0), up(L6, 1.0), 1.2, 5),
    deckLine(L6, L9, 6, 1.15),
    // BEAT 3 — a ring on the lake around the finish pad. (8)
    { ring: { c: [-4.5, 27], r: 4.4, n: 8, y: r2(LAKE_Y + 1.1) } },
    // BEAT 3 — down through the melt pool: six under the surface, where you
    // have to hold the dive and come back up on purpose. (6)
    { ring: { c: [-13, 42], r: 3.2, n: 6, y: -1.9 } },
    // BEAT 3 — up the ice fall to sigil 5. (4)
    { p: [-13.6, 3.05, 22.4] }, { p: [-11.8, 4.55, 21.3] },
    { p: [-10.0, 6.05, 20.6] }, { p: [-8.0, 7.55, 20.0] },
    // BEAT 4 — the west ice face, hugging the static seracs. (5)
    ...trailCoins([[-26, 22], [-27.5, 19], [-29, 16.5], [-30, 14]], 5, 2.4),
    // BEAT 5 — a ring round the cavern's crystal. (6)
    { ring: { c: [-30, 4], r: 3.8, n: 6, y: r2(APRON_Y + 1.2) } },
    // BEAT 5 — up the vanish crystal stair to the roof hole. (4)
    { p: [-30.0, 14.80, 0.6] }, { p: [-30.0, 16.60, -1.0] },
    { p: [-30.0, 18.40, 0.6] }, { p: [-30.0, 20.20, -1.0] },
    // BEAT 6 — the snow bridges and out of the crevasse. (5)
    ...arcCoins([-23.0, 18.60, -10.0], [-16.5, 20.20, -18.0], 1.4, 5),
    // BEAT 8 — round the peak on ROUTE A. (6)
    { p: [6.4, 36.05, -46.0] }, { p: [4.6, 37.50, -50.5] },
    { p: [0.0, 38.95, -52.4] }, { p: [-4.6, 40.40, -50.5] },
    { p: [-6.4, 41.85, -46.0] }, { p: [-4.6, 43.30, -41.5] },
    // BEAT 2 (secret) — down the hidden chute to the pinnacle. (4)
    { p: [27.02, 14.77, 4.74] }, { p: [25.00, 13.85, 4.03] },
    { p: [21.98, 12.74, 3.95] }, { p: [19.64, 12.02, 4.40] },
    // BEAT 7 — the east serac spiral, the other way home. (4)
    { p: [15.3, 19.10, -20.0] }, { p: [12.6, 22.10, -17.2] },
    { p: [8.4, 25.10, -19.0] }, { p: [9.4, 28.10, -22.8] },
  ],

  /* ------------------------------------------------------------------------
   * POWERS — one wing hat, on the crystal cavern's roof, because a glide that
   * starts 40 m from the only thing worth gliding to is a commute.
   * --------------------------------------------------------------------- */
  powers: [
    { kind: 'wing', p: [-30.0, 21.00, 4.0], duration: 30 },
  ],

  /* ------------------------------------------------------------------------
   * OBJECTS — the built world, beat by beat.
   * --------------------------------------------------------------------- */
  objects: [

    /* ========================================================================
     * BEAT 1 — THE SUMMIT SHELF
     * A flat, EXACTLY 30.00 for 7.15 m around (0,-30), with the mountain behind
     * it and nothing in front of it. Twenty seconds of safety in which the
     * course explains its one new verb — you go DOWN on purpose — and shows you
     * both pedestals, the race pad and the peak you will come back for.
     * ===================================================================== */

    /* Data lane 2026-09-04. The game boots at cp-summit [0, 30, -26] facing yaw
       -2.58 (south-east, down the chute), so a board at (2.6, -28.4) with rot 0
       stood BEHIND the player showing the camera its blank back (12-course
       validation shot). Now 2.8 m ahead on the right kerb, yawed to face the
       spawn: a `text` with rot y = θ faces (sin θ, cos θ), so θ = the spawn
       yaw points it straight back at the pad. */
    { kind: 'deco', kindOf: 'sign', p: on(-0.2, -22.6, 1.15), s: [0.14, 1.7, 1.2], rot: [0, -2.58, 0], mat: 'wood', tint: ROCK },
    { kind: 'deco', kindOf: 'post', p: on(0.04, -22.22, 0.65), s: [0.16, 1.3, 0.16], mat: 'wood', tint: 0x4c5462 },   // 0.45 m behind the plate
    { kind: 'text', p: [-0.2, r2(SHELF_Y + 1.95), -22.6], rot: [0, -2.58, 0], text: 'GLACIER SLIDE', size: 0.58, color: 0x123049 },
    { kind: 'text', p: [-0.2, r2(SHELF_Y + 1.42), -22.6], rot: [0, -2.58, 0], text: 'CROUCH AT SPEED TO TUCK  ·  THE ICE KEEPS THE REST', size: 0.22, color: 0x2c5878 },
    { kind: 'text', p: [-0.2, r2(SHELF_Y + 1.05), -22.6], rot: [0, -2.58, 0], text: 'THE CHUTE ONLY GOES DOWN. EVERYTHING ELSE GOES UP.', size: 0.22, color: 0x2c5878 },

    // The two pedestals the SIGILS and HUNDRED COINS crests rise from.
    { kind: 'pedestal', p: on(0, -34, 0), mat: 'ice', tint: ICE, glow: GOLD },
    { kind: 'pedestal', p: on(-6, -28, 0), mat: 'ice', tint: ICE, glow: GOLD },

    // The race start pad — deliberately flush, so it is a marking and not a step.
    { kind: 'platform', p: [4, r2(SHELF_Y - 0.04), -23], s: [3.8, 0.2, 3.8], mat: 'ice', tint: 0xd8ecff },
    { kind: 'text', p: [4, r2(SHELF_Y + 1.3), -23], rot: [0, 0, 0], text: 'THE LUGE  ·  45s', size: 0.26, color: 0x2c5878 },

    // A weather mast, so the shelf has a human edge and the wind has something
    // to move. Props build no colliders (props.js) — nothing here is in the way.
    { kind: 'deco', kindOf: 'flagpole', p: on(-8.4, -33.0, 0), s: [0.12, 4.4, 0.12], mat: 'metal', tint: 0x8fa8c0 },
    { kind: 'deco', kindOf: 'banner', p: on(-8.4, -33.0, 2.6), s: [0.08, 2.4, 1.3], mat: 'cloth', tint: 0x2b4c72 },
    { kind: 'deco', kindOf: 'crate', p: on(-4.2, -22.6, 0.5), s: [0.9, 0.9, 0.9], mat: 'wood', tint: 0x6b5a48, count: 3, spread: 2.2, jitter: 0.22 },
    { kind: 'deco', kindOf: 'lantern', p: on(-4.2, -22.6, 2.0), s: [0.5, 0.7, 0.5], mat: 'metal', tint: WARM },
    { kind: 'light', p: on(-4.2, -22.6, 2.2), color: WARM, intensity: 6, distance: 14 },

    /* ========================================================================
     * BEAT 2 — THE FLUME  (the set piece, and the race)
     *
     * About 120 m of carved ice in two runs, six banked turns and three gaps.
     * Every deck point, the ground under it and the clearance between them are
     * tabulated at the top of this file. The flume is a BUILT structure, not a
     * carved hillside: it stands on serac pylons up to 14.2 m over the east
     * glacier, which is why falling off it is a fall onto snow and a long walk
     * rather than a death. There is no fall damage in this engine; the
     * punishment for missing a turn is BEAT 7.
     *
     * Slopes run 21.6 deg at the steepest to 2.9 deg in the station run-out.
     * TUNE.slope.iceSlideDeg is 20, so the two 20+ deg pitches at the head of the
     * lower run are the only places the ice takes the decision away from you.
     * ===================================================================== */

    // --- the upper run: mouth -> TURN 1 -> TURN 2 (GAP A) -> landing ->
    //     TURN 3 -> the high span -> TURN 4 -> the mid station.
    ...flume([U0, U1, U2], CHUTE_W),
    // GAP A: 4.84 m at dy -0.90. Single-jump-safe at -0.90 m is 4.94 m, and the
    // approach is 9.5 m of straight deck, so this is a jump you take at speed
    // with the run-up already paid for.
    ...flume([U3, U4, U5, U6, U7, U8], CHUTE_W),

    // --- the lower run: mesa lip -> TURN 5 (GAP B) -> TURN 6 (GAP C) -> mouth.
    ...flume([L0, L1, L2], CHUTE_W),
    // GAP B: 4.82 m at dy -1.00 (safe 4.99 m), approach 6.95 m of deck.
    ...flume([L3, L4, L5], CHUTE_W),
    // GAP C: 4.49 m at dy -0.90 (safe 4.94 m), approach 7.58 m of deck.
    ...flume([L6, L7, L8, L9], CHUTE_W),

    // --- THE BERMS. Six banked walls on the OUTSIDE of the six turns, solved by
    //     `bermAt` from the deck points themselves so they can never drift onto
    //     the inside. They are `ice` (slick to brush along), stand 1.9 m over
    //     the deck — a hero is 1.5 m, so you can see over one but not walk it —
    //     and their base sits on the ice. Solved centres, for the record:
    //     TURN 1 (10.49, 27.55, -15.15) · TURN 2 (20.97, 24.75, -16.77) ·
    //     TURN 3 (33.12, 21.55, -27.40) · TURN 4 (49.89, 19.15, -14.68) ·
    //     TURN 6 (26.92,  9.55,  20.25).
    { ...bermAt(U0, U1, U2, 6.0, 1.9), color: ICE_DEEP },
    { ...bermAt(U1, U2, U3, 6.0, 1.9), color: ICE_DEEP },
    { ...bermAt(U3, U4, U5, 8.0, 1.9), color: ICE_DEEP },
    { ...bermAt(U5, U6, U7, 9.0, 1.9), color: ICE_DEEP },
    { ...bermAt(L3, L4, L5, 6.0, 1.9), color: ICE_DEEP },
    // TURN 5 is the odd one: two short berms with a 3.8 m panel between them.
    { ...bermAt(L0, L1, L2, 2.6, 1.9, 3.0), color: ICE_DEEP },
    { ...bermAt(L0, L1, L2, 2.6, 1.9, -3.0), color: ICE_DEEP },

    // --- THE PYLONS. Ice legs under the two highest spans, so the flume reads
    //     as engineering rather than as a floating ribbon. Each is seated on the
    //     ground and rises to just under the deck it carries.
    { kind: 'platform', p: [20.0, r2((gy(20, -19.5) + 23.1) / 2), -19.5], s: [1.6, r2(23.1 - gy(20, -19.5)), 1.6], mat: 'ice', tint: ICE_DEEP },
    { kind: 'platform', p: [33.0, r2((gy(33, -24.5) + 19.9) / 2), -24.5], s: [1.6, r2(19.9 - gy(33, -24.5)), 1.6], mat: 'ice', tint: ICE_DEEP },
    { kind: 'platform', p: [42.0, r2((gy(42, -21) + 18.3) / 2), -21.0], s: [1.6, r2(18.3 - gy(42, -21)), 1.6], mat: 'ice', tint: ICE_DEEP },
    { kind: 'platform', p: [47.0, r2((gy(47, -14.5) + 17.5) / 2), -14.5], s: [1.6, r2(17.5 - gy(47, -14.5)), 1.6], mat: 'ice', tint: ICE_DEEP },
    { kind: 'platform', p: [33.0, r2((gy(33, 4.5) + 13.9) / 2), 4.5], s: [1.6, r2(13.9 - gy(33, 4.5)), 1.6], mat: 'ice', tint: ICE_DEEP },
    { kind: 'platform', p: [36.5, r2((gy(36.5, 10.5) + 11.3) / 2), 10.5], s: [1.6, r2(11.3 - gy(36.5, 10.5)), 1.6], mat: 'ice', tint: ICE_DEEP },
    { kind: 'platform', p: [26.0, r2((gy(26, 17.5) + 7.9) / 2), 17.5], s: [1.4, r2(7.9 - gy(26, 17.5)), 1.4], mat: 'ice', tint: ICE_DEEP },
    { kind: 'platform', p: [18.5, r2((gy(18.5, 18.6) + 5.9) / 2), 18.6], s: [1.4, r2(5.9 - gy(18.5, 18.6)), 1.4], mat: 'ice', tint: ICE_DEEP },

    // --- THE ICE WHEEL. A two-armed `bar` rotor turning in the deck plane at
    //     TURN 3, 1.30 m over the ice: a bar is a RIDEABLE solid, so this is a
    //     timing puzzle, not a trap — you jump it or you ride it a quarter turn.
    { kind: 'rotor', p: [33.0, 21.90, -24.5], style: 'bar', arms: 2, len: 4.2, thick: 0.34, height: 0.5, period: 4.4, axis: 'y', mat: 'ice', tint: CRYSTAL },
    { kind: 'text', p: [30.0, 22.4, -21.6], rot: [0, -0.30, 0], text: 'JUMP IT OR RIDE IT', size: 0.24, color: 0x2c5878 },

    // --- TWO HANGING ICICLES over the lower run, swinging across the racing
    //     line. Only the head kills; the chain is safe (hazards/pendulum.js).
    { kind: 'pendulum', p: [34.6, 19.60, 2.0], len: 4.0, ampDeg: 44, period: 3.1, mode: 'axe', axis: 'z', mat: 'ice', tint: CRYSTAL },
    { kind: 'pendulum', p: [22.0, 13.60, 18.1], len: 4.2, ampDeg: 40, period: 2.7, phaseCycles: 0.5, mode: 'axe', axis: 'x', mat: 'ice', tint: CRYSTAL },

    // --- THE SERAC BESIDE TURN 3. Sigil 2 stands on it: a 3.81 m hop off the
    //     outside of the turn at dy -0.05, which is a step across for anyone who
    //     is willing to give up the racing line.
    { kind: 'platform', p: [36.5, 19.95, -26.0], s: [3.4, 1.2, 3.4], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },

    // --- THE WRONG-COLOURED WALL. The gap in TURN 5's berm, filled with a panel
    //     one shade too blue. Solved by the same `bermAt` frame as the berms
    //     either side of it, so it sits flush in the wall line at (30.15, 15.90,
    //     5.04) with its base on the deck at 14.60. Breaking it fires
    //     'ice-wall-broken', which is what the secret crest is wired to.
    {
      ...bermAt(L0, L1, L2, 3.8, 2.6, 0, 'breakable'),
      mat: 'ice', tint: 0x6fb8d8, drop: 'coins', trigger: 'ice-wall-broken',
    },
    { kind: 'light', p: [30.15, 16.4, 5.04], color: CRYSTAL, intensity: 5, distance: 10 },

    // --- THE SECRET CHUTE AND THE PINNACLE. The outside of TURN 5 faces WEST
    //     (outward (-0.98, 0.19), solved by `bermAt`), so the hidden branch
    //     peels off over the open glacier — two shallow segments at 23.4 and
    //     16.8 deg, nine metres above the snow the whole way — and ends on the
    //     cap of a free-standing serac at 10.35. There is no static line to that
    //     cap and there is not meant to be: you can only ARRIVE there, and the
    //     way off is to jump and take the nine metres.
    ...flume([[28.60, 14.40, 5.30], [23.80, 12.20, 3.60], [18.60, 10.60, 4.60]], 3.6),
    { kind: 'platform', p: [15.20, 4.90, 5.60], s: [3.2, 7.8, 3.2], mat: 'ice', tint: ICE_DEEP },
    { kind: 'platform', p: [15.20, 9.55, 5.60], s: [5.4, 1.6, 5.4], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'crystal', p: [16.6, 10.9, 7.2], s: [1.0, 1.6, 1.0], mat: 'crystal', tint: CRYSTAL, count: 3, spread: 1.4, jitter: 0.3 },
    { kind: 'light', p: [15.20, 12.6, 5.60], color: GOLD, intensity: 8, distance: 16 },

    // --- THE MID STATION on the east mesa (flat 17.00). A pedestal for the
    //     race split, a brazier, and the lip the lower run launches from.
    { kind: 'pedestal', p: [36, MESA_Y, -6], mat: 'ice', tint: ICE, glow: AURORA },
    { kind: 'deco', kindOf: 'torch', p: [39.4, r2(MESA_Y + 0.9), -6.6], s: [0.5, 1.4, 0.5], mat: 'metal', tint: WARM, count: 2, spread: 1.6, jitter: 0.15 },
    { kind: 'light', p: [37.4, r2(MESA_Y + 2.6), -5.0], color: WARM, intensity: 8, distance: 20 },
    { kind: 'text', p: [35.0, r2(MESA_Y + 1.3), -1.2], rot: [0, 3.14, 0], text: 'HALF WAY  ·  THE SECOND HALF IS FASTER', size: 0.24, color: 0x2c5878 },

    /* ========================================================================
     * BEAT 3 — THE FROZEN LAKE
     * The flume's run-out and the course's floor. The lake is the terrain (a
     * flat, EXACTLY 1.00 for 11 m around (2,36)) with three sheets of authored
     * `ice` laid flush on it at 1.00, so the last thirty metres of the luge are
     * genuinely slick and stopping is a decision. In the west corner the ice
     * gives out over a melt pool 3.50 m deep with the fourth sigil on its floor;
     * two heaving floes cross it for anyone who would rather not get wet.
     * ===================================================================== */

    { kind: 'ice', p: [-2.0, r2(LAKE_Y - 0.15), 26.0], s: [16, 0.3, 12], color: 0xcfeaff },
    { kind: 'ice', p: [6.0, r2(LAKE_Y - 0.15), 38.0], s: [20, 0.3, 16], color: 0xcfeaff },
    { kind: 'ice', p: [-18.0, r2(LAKE_Y - 0.15), 32.0], s: [14, 0.3, 12], color: 0xcfeaff },

    // The race finish, flush like the start pad.
    { kind: 'platform', p: [-4.5, r2(LAKE_Y - 0.04), 27], s: [3.8, 0.2, 3.8], mat: 'ice', tint: 0xd8ecff },
    { kind: 'text', p: [-4.5, r2(LAKE_Y + 1.3), 27], rot: [0, 3.14, 0], text: 'FINISH', size: 0.30, color: 0x2c5878 },

    // TWO HEAVING FLOES over the melt pool. `mover` oscillate on Y: a pure
    // function of the course clock, so `reset(t)` puts them exactly where
    // `update(t)` would. Amplitude 0.7 m about a mean 0.30 m over the water.
    {
      kind: 'mover', p: [-13.0, 1.05, 47.0], s: [3.4, 0.5, 3.4],
      motion: { type: 'oscillate', axis: 'y', amp: 0.70, period: 3.4, phase: 0, ease: 'sine' },
      mat: 'ice', tint: 0xbfe4f8, stripe: true, edge: SAFE_EDGE,
    },
    {
      kind: 'mover', p: [-13.0, 1.05, 42.0], s: [3.4, 0.5, 3.4],
      motion: { type: 'oscillate', axis: 'y', amp: 0.70, period: 3.4, phase: 0.5, ease: 'sine' },
      mat: 'ice', tint: 0xbfe4f8, stripe: true, edge: SAFE_EDGE,
    },
    { kind: 'text', p: [-13.0, 2.6, 51.0], rot: [0, 3.14, 0], text: 'CROUCH TO SINK  ·  JUMP TO STROKE', size: 0.22, color: 0x2c5878 },
    { kind: 'light', p: [-13.0, 3.4, 42.0], color: 0x8fd8ff, intensity: 6, distance: 18 },

    // A GEYSER on the lake: the way back onto the lower flume for anyone who
    // fell off it, and the course's one jump pad. Apex 6.0 m off the ice at
    // 1.00 puts the top of the arc at 7.00, level with the flume at L6 (5.70)
    // plus a metre of margin.
    { kind: 'jumppad', p: [13.4, r2(LAKE_Y + 0.14), 21.6], s: [2.8, 0.28, 2.8], power: 6.0, dir: [0, 1, 0], mat: 'rubber', tint: 0x54c4d8 },
    { kind: 'text', p: [13.4, r2(LAKE_Y + 1.3), 24.4], rot: [0, 3.14, 0], text: 'STAND ON IT', size: 0.24, color: 0x2c5878 },

    // THE ICE FALL on the north shore: four frozen steps, 1.50 m of rise each
    // and about 1.0 m edge-to-edge, carrying sigil 5. Every one is striped
    // because every one is a jump.
    { kind: 'platform', p: [-13.6, 2.20, 22.4], s: [2.6, 1.4, 2.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-11.8, 3.70, 21.3], s: [2.6, 1.4, 2.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-10.0, 5.20, 20.6], s: [2.6, 1.4, 2.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-8.0, 6.70, 20.0], s: [3.0, 1.4, 3.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'light', p: [-8.0, 9.4, 20.0], color: GOLD, intensity: 7, distance: 15 },

    /* ========================================================================
     * BEAT 4 — THE WEST ICE FACE
     * The lake shore stands at 1.42 and the cavern apron at 12.00, four metres
     * apart in plan: a 60 deg wall of blue ice. Two `mover` blocks ride it, and
     * FOUR STATIC SERACS climb it beside them — the movers are the quick way,
     * never the only way. (Measured lesson from the Keep: nothing REQUIRED may
     * hang off a moving platform, because the reach gate has no ride edge worth
     * trusting and neither does a player who has just fallen off one.)
     * ===================================================================== */

    { kind: 'platform', p: [-26.4, 2.60, 21.6], s: [3.0, 1.4, 3.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-27.6, 5.00, 19.0], s: [3.0, 1.4, 3.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-28.8, 7.40, 16.6], s: [3.0, 1.4, 3.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-29.8, 9.80, 14.4], s: [3.4, 1.4, 3.4], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    // tops 3.30 / 5.70 / 8.10 / 10.50, then a 1.50 m step onto the apron at
    // 12.00; gaps 2.87 / 2.68 / 2.42 m centre-to-centre at +2.40 m of rise.
    // A single jump apexes at 1.91 m, so each of these is a DOUBLE — which is
    // why there is a mover next to them and why the coins mark the seracs, not
    // the lift: this is the course's one deliberate "learn the double" wall.
    {
      kind: 'mover', p: [-24.0, 2.60, 20.0], s: [3.2, 0.6, 3.2],
      motion: { type: 'linear', to: [-24.0, 12.40, 20.0], period: 7.0, phase: 0, ease: 'inout', dwell: 1.0 },
      mat: 'ice', tint: 0xbfe4f8, stripe: true, edge: SAFE_EDGE,
    },
    { kind: 'platform', p: [-25.6, 11.70, 16.8], s: [4.4, 0.6, 3.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [-24.6, 3.9, 23.4], rot: [0, 3.14, 0], text: 'LAND AND JUMP AGAIN  ·  DOUBLE JUMP', size: 0.22, color: 0x2c5878 },
    { kind: 'deco', kindOf: 'icicle', p: [-30.6, 11.4, 15.4], s: [0.6, 1.4, 0.6], mat: 'ice', tint: CRYSTAL, count: 6, spread: 3.0, jitter: 0.3 },

    /* ========================================================================
     * BEAT 5 — THE CRYSTAL CAVERN  (cp4, the Warden, the vanish stair)
     * Built ABOVE the heightfield, not inside it: a heightfield has no overhangs,
     * so a cave that was really a hole in the terrain would push the player back
     * out of it. Floor slab top EXACTLY 12.00 (the apron's own height), walls
     * 7.0 m, roof deck 20.00 with a 4 x 4 m hole over the middle. Three `beam`
     * lanes cross the floor on a slow cycle; the Warden owns the room; four
     * `vanish` crystal steps climb out through the roof hole to the wing hat.
     * ===================================================================== */

    { kind: 'platform', p: [-30, 11.60, 4], s: [17, 0.8, 14], mat: 'ice', tint: 0xa8cfe4 },
    { kind: 'platform', p: [-30, 15.60, -3.4], s: [17, 8.0, 0.8], mat: 'stone', tint: ROCK },   // north wall
    { kind: 'platform', p: [-38.6, 15.60, 4], s: [0.8, 8.0, 14], mat: 'stone', tint: ROCK },    // west wall
    { kind: 'platform', p: [-21.4, 15.60, 4], s: [0.8, 8.0, 14], mat: 'stone', tint: ROCK },    // east wall
    // the south face, with a 5.2 m mouth: two piers and a lintel
    { kind: 'platform', p: [-36.0, 15.60, 11.4], s: [5.8, 8.0, 0.8], mat: 'stone', tint: ROCK },
    { kind: 'platform', p: [-24.0, 15.60, 11.4], s: [5.8, 8.0, 0.8], mat: 'stone', tint: ROCK },
    { kind: 'platform', p: [-30.0, 18.10, 11.4], s: [6.4, 3.0, 0.8], mat: 'stone', tint: ROCK },
    // the roof, in four bands around a 4 x 4 m hole at (-30, 0). Top 20.00.
    { kind: 'platform', p: [-30.0, 19.60, -1.7], s: [17.8, 0.8, 6.6], mat: 'stone', tint: ROCK, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-30.0, 19.60, 7.4], s: [17.8, 0.8, 8.8], mat: 'stone', tint: ROCK, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-35.4, 19.60, 1.0], s: [7.0, 0.8, 4.0], mat: 'stone', tint: ROCK, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-24.6, 19.60, 1.0], s: [7.0, 0.8, 4.0], mat: 'stone', tint: ROCK, stripe: true, edge: SAFE_EDGE },

    // THREE BEAM LANES. `warn` is the tail of the OFF window, so the telegraph
    // is always survivable and the kill capsule never arms during it.
    { kind: 'beam', a: [-37.8, 13.10, 0.0], b: [-22.2, 13.10, 0.0], cycle: { on: 1.6, off: 2.4, warn: 0.7, phase: 0.0 }, radius: 0.16, color: 0xff5a7a },
    { kind: 'beam', a: [-37.8, 13.10, 4.0], b: [-22.2, 13.10, 4.0], cycle: { on: 1.6, off: 2.4, warn: 0.7, phase: 1.3 }, radius: 0.16, color: 0xff5a7a },
    { kind: 'beam', a: [-37.8, 13.10, 8.0], b: [-22.2, 13.10, 8.0], cycle: { on: 1.6, off: 2.4, warn: 0.7, phase: 2.6 }, radius: 0.16, color: 0xff5a7a },
    { kind: 'text', p: [-27.4, 13.6, 10.2], rot: [0, 3.14, 0], text: 'THE LIGHT COUNTS TO FOUR', size: 0.24, color: 0x9fd8ff },   // 2026-09-05: off cp-cavern's axis

    // THE CRYSTAL, and the vanish stair it lights. Pound the crystal and the
    // four steps come up; they run on the course clock, so cp4's clockOffset
    // (1.2 s) always hands you the same phase.
    { kind: 'deco', kindOf: 'crystal', p: [-30.0, 13.20, 4.0], s: [1.4, 2.6, 1.4], mat: 'crystal', tint: CRYSTAL },
    { kind: 'light', p: [-30.0, 14.6, 4.0], color: CRYSTAL, intensity: 9, distance: 20 },
    { kind: 'vanish', p: [-30.0, 13.30, 0.6], s: [2.6, 0.5, 2.6], mode: 'cycle', cycle: { on: 4.0, off: 2.0, warn: 0.8, phase: 0.0 }, mat: 'crystal', tint: CRYSTAL },
    { kind: 'vanish', p: [-30.0, 15.10, -1.0], s: [2.6, 0.5, 2.6], mode: 'cycle', cycle: { on: 4.0, off: 2.0, warn: 0.8, phase: 0.6 }, mat: 'crystal', tint: CRYSTAL },
    { kind: 'vanish', p: [-30.0, 16.90, 0.6], s: [2.6, 0.5, 2.6], mode: 'cycle', cycle: { on: 4.0, off: 2.0, warn: 0.8, phase: 1.2 }, mat: 'crystal', tint: CRYSTAL },
    { kind: 'vanish', p: [-30.0, 18.70, -1.0], s: [2.6, 0.5, 2.6], mode: 'cycle', cycle: { on: 4.0, off: 2.0, warn: 0.8, phase: 1.8 }, mat: 'crystal', tint: CRYSTAL },
    // tops 13.55 / 15.35 / 17.15 / 18.95, four steps of 1.80 m rise and 1.60 m
    // of lateral offset, then a 1.05 m step onto the roof at 20.00. A single
    // jump apexes at 1.91 m, so every one of these is inside the single.

    // The cavern's own light — a room this deep needs a key or the aurora just
    // makes a bright mouth with a black hole behind it.
    { kind: 'deco', kindOf: 'torch', p: [-35.4, 13.0, 9.0], s: [0.5, 1.4, 0.5], mat: 'metal', tint: WARM },
    { kind: 'deco', kindOf: 'torch', p: [-24.6, 13.0, 9.0], s: [0.5, 1.4, 0.5], mat: 'metal', tint: WARM },
    { kind: 'light', p: [-30.0, 16.0, 8.0], color: WARM, intensity: 10, distance: 24 },
    { kind: 'deco', kindOf: 'crystal', p: [-35.8, 12.8, 0.0], s: [0.9, 1.8, 0.9], mat: 'crystal', tint: CRYSTAL, count: 5, spread: 2.6, jitter: 0.35 },
    { kind: 'deco', kindOf: 'crystal', p: [-24.4, 12.8, 1.6], s: [0.9, 1.8, 0.9], mat: 'crystal', tint: CRYSTAL, count: 5, spread: 2.6, jitter: 0.35 },
    { kind: 'deco', kindOf: 'icicle', p: [-30.0, 18.6, 6.4], s: [0.7, 1.6, 0.7], mat: 'ice', tint: CRYSTAL, count: 8, spread: 5.4, jitter: 0.32 },

    // THE WING SPIRE. The wing hat sits on the roof at 21.00 and this is the
    // only thing west of it: a floating serac 18 m out and 5.4 m DOWN, which is
    // exactly what a gentle glide is for. The crest stands on its cap at 15.60.
    { kind: 'platform', p: [-48.0, 13.70, 14.0], s: [5.0, 1.4, 5.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'crystal', p: [-49.6, 15.2, 15.6], s: [0.9, 1.7, 0.9], mat: 'crystal', tint: CRYSTAL, count: 3, spread: 1.6, jitter: 0.3 },
    { kind: 'light', p: [-48.0, 17.4, 14.0], color: GOLD, intensity: 8, distance: 18 },
    { kind: 'text', p: [-33.6, 21.4, 6.6], rot: [0, 3.14, 0], text: 'TAKE THE HAT  ·  GO WEST AND DOWN', size: 0.24, color: 0x9fd8ff },

    /* ========================================================================
     * BEAT 6 — THE CREVASSE  (cp5)
     * Behind the cavern the west shoulder falls into a hollow at 7.70 and the
     * spire's flank goes up out of it at 55 deg. Two ideas, in order: four
     * `vanish` SNOW BRIDGES across the hollow (an 11 m drop under them, onto
     * snow), then a WALL-KICK SHAFT — 3.20 m clear against the 3.4 m limit,
     * floor 14.40, exit ledge 23.00. From the floor that is one jump (apex
     * 1.91 -> feet 16.31) plus four kicks at +2.00 m each -> feet 24.31, so the
     * ledge is cleared with 1.31 m to spare and no ceiling to bonk.
     * ===================================================================== */

    { kind: 'vanish', p: [-23.0, 17.55, -10.0], s: [2.8, 0.5, 2.8], mode: 'cycle', cycle: { on: 3.2, off: 1.8, warn: 0.7, phase: 0.0 }, mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [-21.2, 18.15, -12.6], s: [2.8, 0.5, 2.8], mode: 'cycle', cycle: { on: 3.2, off: 1.8, warn: 0.7, phase: 0.5 }, mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [-19.4, 18.75, -15.2], s: [2.8, 0.5, 2.8], mode: 'cycle', cycle: { on: 3.2, off: 1.8, warn: 0.7, phase: 1.0 }, mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [-17.6, 19.35, -17.8], s: [2.8, 0.5, 2.8], mode: 'cycle', cycle: { on: 3.2, off: 1.8, warn: 0.7, phase: 1.5 }, mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    // tops 17.80 / 18.40 / 19.00 / 19.60; 3.16 m centre-to-centre at +0.60 m of
    // rise, which is 0.36 m edge-to-edge and inside a walk-off, let alone a jump.
    // The approach ledge that feeds them:
    { kind: 'platform', p: [-25.4, 16.90, -7.8], s: [4.6, 1.4, 4.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'pendulum', p: [-20.2, 23.20, -13.8], len: 4.0, ampDeg: 38, period: 2.9, mode: 'axe', axis: 'x', mat: 'ice', tint: CRYSTAL },
    { kind: 'text', p: [-25.4, 18.9, -5.0], rot: [0, 3.14, 0], text: 'THE SNOW REMEMBERS HOW LONG YOU STOOD ON IT', size: 0.22, color: 0x2c5878 },

    // --- THE SHAFT. Four slabs leaving a 3.20 x 3.20 m clear well from 14.40
    //     to 23.20. The south face carries a 1.30 x 2.40 m doorway under a
    //     lintel, so you can only get in at the bottom and out at the top.
    { kind: 'platform', p: [CREV[0], 18.80, r2(CREV[1] - 1.95)], s: [4.0, 8.8, 0.7], mat: 'ice', tint: ICE_DEEP },
    { kind: 'platform', p: [r2(CREV[0] - 1.95), 18.80, CREV[1]], s: [0.7, 8.8, 3.2], mat: 'ice', tint: ICE_DEEP },
    { kind: 'platform', p: [r2(CREV[0] + 1.95), 18.80, CREV[1]], s: [0.7, 8.8, 3.2], mat: 'ice', tint: ICE_DEEP },
    { kind: 'platform', p: [CREV[0], 18.80, r2(CREV[1] + 1.95)], s: [4.0, 8.8, 0.7], mat: 'ice', tint: ICE_DEEP },
    // the shaft floor, top EXACTLY 14.40
    { kind: 'platform', p: [CREV[0], 13.70, CREV[1]], s: [3.2, 1.4, 3.2], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    // the exit ledge over the hollow, top EXACTLY 23.00 — the reward for four
    // clean kicks, and where cp5 and sigil 7 live.
    { kind: 'platform', p: [r2(CREV[0] + 3.4), 22.65, r2(CREV[1] + 1.0)], s: [7.6, 0.7, 5.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [r2(CREV[0] + 1.5), 16.2, r2(CREV[1] + 1.6)], rot: [0, 0, 0], text: 'KICK ONE WALL, THEN THE OTHER', size: 0.20, color: 0xd8ecff },
    { kind: 'light', p: [CREV[0], 19.0, CREV[1]], color: 0x9fd8ff, intensity: 6, distance: 12 },
    // and out: three seracs from the ledge (23.00) up onto the shelf (30.00),
    // 1.55 m of rise and about 0.9 m edge-to-edge each.
    { kind: 'platform', p: [-8.2, 23.85, -22.4], s: [3.2, 1.4, 3.2], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-6.6, 25.40, -25.0], s: [3.2, 1.4, 3.2], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-5.4, 26.95, -27.4], s: [3.4, 1.4, 3.4], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    // top 28.65, then a 1.35 m step onto the shelf at 30.00.

    /* ========================================================================
     * BEAT 7 — THE EAST SERACS
     * The other way home, and the one you find by falling off the flume. The
     * ridge from the mesa back toward the shelf is walkable the whole way (worst
     * measured slope 33 deg, at (20,-19.5) -> (16,-21)) until the last eleven
     * metres, which are a 57 deg wall. THIS is that wall: eight ice blocks
     * spiralling round a 3.80 m radius about (11.5,-20), 1.50 m of rise and 3.14 m
     * centre-to-centre per step — about 0.54 m edge-to-edge, comfortably inside
     * the 3.38 m a single jump covers at +1.50 m.
     * ===================================================================== */

    { kind: 'platform', p: [15.30, 17.10, -20.00], s: [2.6, 1.4, 2.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [14.01, 18.60, -17.14], s: [2.6, 1.4, 2.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [11.10, 20.10, -15.99], s: [2.6, 1.4, 2.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [8.19, 21.60, -17.14], s: [2.6, 1.4, 2.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [6.90, 23.10, -20.00], s: [2.6, 1.4, 2.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [8.19, 24.60, -22.86], s: [2.6, 1.4, 2.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [11.10, 26.10, -24.01], s: [2.6, 1.4, 2.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [14.01, 27.60, -22.86], s: [3.0, 1.4, 3.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    // tops 17.80 .. 28.30; the last one is 4.4 m from the shelf lip at (10,-21),
    // whose ground is 20.27 — so the exit is a walk-off north onto the flat at
    // (5,-22), ground 28.27, a 0.03 m step.
    { kind: 'text', p: [16.6, 18.5, -22.4], rot: [0, -0.8, 0], text: 'THE OTHER WAY HOME', size: 0.24, color: 0x2c5878 },
    { kind: 'deco', kindOf: 'icicle', p: [12.4, 21.0, -19.4], s: [0.6, 1.4, 0.6], mat: 'ice', tint: CRYSTAL, count: 6, spread: 4.2, jitter: 0.3 },

    /* ========================================================================
     * BEAT 8 — THE PEAK  (the open crest)
     * The plinth stands on the spire's cap (ground 34.27 at (0,-46)) and rises
     * to 45.60. Three routes, listed in the header:
     *   A  the serac spiral (static, eight blocks, the line the gate walks)
     *   B  the ice lift on the east face (a `mover` shortcut, never a dependency)
     *   C  the north spur (static, five blocks, carrying sigil 8)
     * ===================================================================== */

    // --- the plinth: 34.00 -> 45.60, a solid ice tower with a corbelled cap.
    { kind: 'platform', p: [PEAK[0], 39.80, PEAK[1]], s: [7.0, 11.6, 7.0], mat: 'ice', tint: ICE_DEEP },
    { kind: 'platform', p: [PEAK[0], 45.20, PEAK[1]], s: [8.4, 0.8, 8.4], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'flagpole', p: [PEAK[0] + 2.6, r2(PEAK_TOP + 2.2), PEAK[1] + 2.6], s: [0.12, 4.4, 0.12], mat: 'metal', tint: 0x8fa8c0 },
    { kind: 'light', p: [PEAK[0], r2(PEAK_TOP + 2.4), PEAK[1]], color: GOLD, intensity: 10, distance: 22 },

    // --- ROUTE A: the serac spiral. Radius 6.40 about (0,-46), 0.62 rad per
    //     step: 3.90 m centre-to-centre, ~1.10 m edge-to-edge, +1.45 m of rise.
    //     Single-jump-safe at +1.45 m is 3.42 m centre-to-centre, so this is
    //     inside the envelope on the number the gate measures and then some.
    { kind: 'platform', p: [6.40, 34.65, -46.00], s: [2.8, 1.4, 2.8], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [5.20, 36.10, -49.72], s: [2.8, 1.4, 2.8], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [1.87, 37.55, -52.12], s: [2.8, 1.4, 2.8], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-2.13, 39.00, -52.03], s: [2.8, 1.4, 2.8], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-5.35, 40.45, -49.51], s: [2.8, 1.4, 2.8], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-6.39, 41.90, -45.73], s: [2.8, 1.4, 2.8], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-4.99, 43.35, -42.07], s: [2.8, 1.4, 2.8], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-1.58, 44.80, -39.82], s: [3.2, 1.4, 3.2], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    // tops 35.35 .. 45.50, and the last one stands 3.02 m from the cap at 45.60
    // (a 0.10 m step across), which is the whole point of the eighth block.

    // --- ROUTE B: the ice lift on the east face. Shelf ground 30.4 at (8,-38)
    //     up to the shoulder ledge at 41.00. A shortcut only: everything it
    //     reaches, ROUTE A reaches statically.
    {
      kind: 'mover', p: [9.60, 31.10, -38.00], s: [3.2, 0.6, 3.2],
      motion: { type: 'linear', to: [9.60, 40.70, -38.00], period: 9.0, phase: 0, ease: 'inout', dwell: 1.2 },
      mat: 'ice', tint: 0xbfe4f8, stripe: true, edge: SAFE_EDGE,
    },
    { kind: 'platform', p: [7.20, 40.30, -41.20], s: [4.6, 0.8, 4.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [4.40, 42.50, -43.20], s: [3.0, 1.2, 3.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    // ledge top 40.70, then 43.10, then a 2.50 m step to the cap: a backflip
    // (apex 3.22 m) or one more hop off ROUTE A's eighth block.

    // --- ROUTE C: the north spur. Five blocks up the cirque face from the ridge
    //     ground at (0,-58) = 30.61, ending on the spur that carries sigil 8.
    { kind: 'platform', p: [0.00, 31.90, -57.00], s: [3.0, 1.4, 3.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [0.00, 33.45, -55.00], s: [3.0, 1.4, 3.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [1.80, 35.00, -53.20], s: [3.0, 1.4, 3.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-1.80, 36.55, -53.20], s: [3.0, 1.4, 3.0], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [0.00, 41.90, -52.00], s: [4.6, 1.4, 4.6], mat: 'ice', tint: ICE, stripe: true, edge: SAFE_EDGE },
    // tops 32.60 / 34.15 / 35.70 / 37.25, then the spur at 42.60 — which the
    // ROUTE A blocks at 37.55 (1.87,-52.12) and 39.00 (-2.13,-52.03) step onto,
    // so the spur has a static approach from both sides.
    { kind: 'deco', kindOf: 'monolith', p: on(-9.4, -56.0, 1.4), s: [1.2, 3.4, 1.0], mat: 'stone', tint: ROCK },
    { kind: 'deco', kindOf: 'monolith', p: on(8.6, -57.2, 1.2), s: [1.1, 3.0, 0.9], mat: 'stone', tint: ROCK },
    { kind: 'text', p: [0, 44.4, -49.6], rot: [0, 3.14, 0], text: 'THE TOP OF THE RIME SPIRE', size: 0.34, color: 0xd8ecff },

    /* ========================================================================
     * DRESSING — snowdrifts, seracs, icicles and crystals.
     * Every scatter is seeded by `ihash`, so the mountain dresses itself
     * identically on every load and `reset()` never moves a drift (hard rule 3).
     * Nothing scatters onto the lake ice (y < 1.6), and nothing lands inside a
     * KEEPOUT — the flume corridor, the cavern, the crevasse or the peak.
     * Each def asks for a `count`, so one def is one instanced draw of many
     * props rather than one prop: the SAME triangles spent over more, smaller
     * pieces, which is the trade a snowfield wants.
     * ===================================================================== */

    ...scatter(-16, -34, 8, 30, 12, 5101, (x, z, rnd) => (
      gy(x, z) < 2.0 ? null
        : { kind: 'deco', kindOf: 'snowdrift', p: on(x, z, 0.1), s: [2.2 + rnd * 1.6, 0.9 + rnd * 0.7, 2.0 + rnd * 1.4], mat: 'snow', tint: SNOW, count: 3, spread: 4.0, jitter: 0.3 }
    )),
    ...scatter(22, -36, 8, 28, 10, 5102, (x, z, rnd) => (
      gy(x, z) < 2.0 ? null
        : { kind: 'deco', kindOf: 'snowdrift', p: on(x, z, 0.1), s: [2.0 + rnd * 1.5, 0.8 + rnd * 0.6, 1.9 + rnd * 1.3], mat: 'snow', tint: SNOW, count: 3, spread: 3.6, jitter: 0.3 }
    )),
    ...scatter(-44, 14, 8, 26, 10, 5103, (x, z, rnd) => (
      gy(x, z) < 1.8 ? null
        : { kind: 'deco', kindOf: 'snowdrift', p: on(x, z, 0.1), s: [2.0 + rnd * 1.4, 0.8 + rnd * 0.6, 1.8 + rnd * 1.2], mat: 'snow', tint: SNOW, count: 3, spread: 3.6, jitter: 0.3 }
    )),
    ...scatter(44, 16, 8, 24, 8, 5104, (x, z, rnd) => (
      gy(x, z) < 1.8 ? null
        : { kind: 'deco', kindOf: 'snowdrift', p: on(x, z, 0.1), s: [1.9 + rnd * 1.3, 0.8 + rnd * 0.5, 1.8 + rnd * 1.2], mat: 'snow', tint: SNOW, count: 3, spread: 3.4, jitter: 0.3 }
    )),

    ...scatter(-30, -30, 8, 24, 8, 5201, (x, z, rnd) => (
      gy(x, z) < 2.0 ? null : { kind: 'rock', p: on(x, z, -0.4), r: 1.0 + rnd * 1.7, seed: 5201 + (x | 0), mat: 'stone' }
    )),
    ...scatter(30, -40, 8, 24, 7, 5202, (x, z, rnd) => (
      gy(x, z) < 2.0 ? null : { kind: 'rock', p: on(x, z, -0.4), r: 1.1 + rnd * 1.8, seed: 5202 + (x | 0), mat: 'stone' }
    )),
    ...scatter(-48, -18, 8, 22, 6, 5203, (x, z, rnd) => (
      gy(x, z) < 2.0 ? null : { kind: 'rock', p: on(x, z, -0.45), r: 1.0 + rnd * 1.6, seed: 5203 + (x | 0), mat: 'stone' }
    )),
    ...scatter(52, -22, 8, 20, 5, 5204, (x, z, rnd) => (
      gy(x, z) < 2.0 ? null : { kind: 'rock', p: on(x, z, -0.45), r: 1.0 + rnd * 1.5, seed: 5204 + (x | 0), mat: 'stone' }
    )),

    ...scatter(0, 44, 14, 34, 12, 5301, (x, z, rnd) => (
      gy(x, z) < 1.6 ? null
        : { kind: 'deco', kindOf: 'icicle', p: on(x, z, 0.5 + rnd * 0.4), s: [0.5 + rnd * 0.3, 1.0 + rnd * 0.9, 0.5 + rnd * 0.3], mat: 'ice', tint: CRYSTAL, count: 5, spread: 2.6, jitter: 0.34 }
    )),
    ...scatter(-6, -8, 12, 34, 10, 5302, (x, z, rnd) => (
      gy(x, z) < 2.2 ? null
        : { kind: 'deco', kindOf: 'crystal', p: on(x, z, 0.3), s: [0.8 + rnd * 0.5, 1.4 + rnd * 1.0, 0.8 + rnd * 0.5], mat: 'crystal', tint: CRYSTAL, count: 3, spread: 2.8, jitter: 0.36 }
    )),
    ...scatter(-34, 40, 10, 26, 8, 5303, (x, z, rnd) => (
      gy(x, z) < 1.6 ? null
        : { kind: 'deco', kindOf: 'crystal', p: on(x, z, 0.3), s: [0.7 + rnd * 0.5, 1.2 + rnd * 0.9, 0.7 + rnd * 0.5], mat: 'crystal', tint: 0x9fd8f0, count: 3, spread: 2.6, jitter: 0.36 }
    )),
  ],

  /* ------------------------------------------------------------------------
   * CRITTERS
   * --------------------------------------------------------------------- */
  critters: [
    // WADDLERS on the summit shelf and the mesa. Side contact is knockback and
    // a 0.4 s stun, never death (contract §23) — which on a shelf with a 14 m
    // flume off the end of it is quite enough consequence.
    // Data lane 2026-09-04: this loop ran THROUGH cp-summit [0, -26] — the
    // validation shot caught the hero already shoved 2.2 m off the pad at
    // 2.7 m/s, three seconds after boot. Now it circles the shelf pedestal.
    { kind: 'bumbler', path: [on(-4, -31), on(4, -31), on(4, -36), on(-4, -36), on(-4, -31)], speed: 1.5, tint: 0x2b4c72 },
    { kind: 'bumbler', path: [on(32, -4), on(39, -5), on(39, -10), on(32, -8), on(32, -4)], speed: 1.6, tint: 0x2b4c72 },
    { kind: 'bumbler', path: [on(-2, 30), on(8, 31), on(9, 24), on(-2, 25), on(-2, 30)], speed: 1.4, tint: 0x2b4c72 },
    // SNOW OWLS. One patrols the high span of the flume and swoops at anyone
    // standing still on it; one works the lake.
    { kind: 'skitter', p: [42, 22.0, -21], path: [[36, 21.5, -25], [50, 23.5, -14]], amp: 1.8, speed: 3.6, tint: 0xd8ecff },
    { kind: 'skitter', p: [-4, 6.0, 30], path: [[-14, 5.4, 26], [8, 7.2, 34]], amp: 1.6, speed: 3.2, tint: 0xd8ecff },
    // THE WARDEN. Three hits, in the crystal cavern, on a floor that is EXACTLY
    // 12.00 for its whole arena. Its charge needs a wall to break itself on —
    // the cavern has four.
    { kind: 'warden', p: [-30, APRON_Y, 4], arena: { c: [-30, 4], r: 6.0 }, hp: 3, tint: 0x8fa8c0 },
  ],
};
