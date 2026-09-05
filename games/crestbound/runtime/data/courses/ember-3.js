/**
 * CRESTBOUND — EMBER FOUNDRY 3 : "CINDER CHASE"
 * runtime/data/courses/ember-3.js                                   CONTRACT §25
 * ===========================================================================
 *
 * Difficulty 6, gate 12 crests. An OPEN DIORAMA about 130 x 130 m on a
 * 140 x 140 m heightfield, with 39 m of verticality between the ash plain
 * (y 1.2) and the caldera lip (y 37.6).
 *
 * The mountain is a spent foundry stack that the mountain grew around: a broad
 * cinder mound with a square DRUM of basalt walls standing on it, split down
 * the south face by a 6 m CRACK and belted at mid-height by a 6 m CLERESTORY
 * SLOT (the old tap-holes). Inside the drum is THE SHAFT. Under the shaft, on
 * a clock, is the lava.
 *
 *   BEAT 1  THE ASH PLAIN     spawn, coin trail, bumblers, two lava pools
 *   BEAT 2  THE GEYSER FIELD  jump-pad geysers and basalt pillars       (cp2)
 *   BEAT 3  THE CANNON BLUFF  a crag, a pad, and the cannon             (cp3)
 *   BEAT 4  THE SHAFT COURT   the crack, the pedestal, the chase begins (cp4)
 *   BEAT 5  THE SLAG STEPS    the first spiral, floor 6.0 -> gallery 14 (cp5)
 *   BEAT 6  THE PLATES        elevator movers, rotor bars, the mid deck
 *   BEAT 7  THE LAVA TUBE     the secret: a long jump east, a crust to pound
 *   BEAT 8  THE UPPER SPIRAL  vanish ledges + a wall-kick chimney
 *   BEAT 9  THE CALDERA       deck, Warden, and the crest on the lip    (cp6)
 *   BEAT 10 RACE / RINGS      two optional overlays across the whole map
 *
 * ---------------------------------------------------------------------------
 * ROUTES TO THE OPEN CREST  (CREST ON THE CALDERA LIP, [0, 38.8, -37])
 * ---------------------------------------------------------------------------
 * | # | route            | from                | how                                    | lava? |
 * |---|------------------|---------------------|----------------------------------------|-------|
 * | A | THE GANTRY STAIR | shaft court y 6.00  | 3 stair flights + 2 landings up the    | never |
 * |   |                  |                     | OUTSIDE of the west wall, 6.0 -> 36.0. |       |
 * |   |                  |                     | Entirely static, entirely outside the  |       |
 * |   |                  |                     | chase's kill box (x <= -15). Slow.     |       |
 * | B | THE SHAFT        | shaft court y 6.00  | slag steps -> gallery 14 -> elevator   | yes   |
 * |   |                  |                     | plate -> mid deck 22.1 -> vanish       |       |
 * |   |                  |                     | spiral -> exit ledge 34.9 -> deck 36.  |       |
 * |   |                  |                     | The fast line, and where the crests    |       |
 * |   |                  |                     | and five of the eight sigils live.     |       |
 * | C | THE CANNON       | cannon bluff y 5.60 | one shot over the east wall onto the   | yes   |
 * |   |                  |                     | balcony at 14.8 — skips ROUTE B's      |       |
 * |   |                  |                     | whole first spiral, then joins B at    |       |
 * |   |                  |                     | the gallery.                           |       |
 *
 * The wall-kick chimney (BEAT 8) is a fourth, optional line INSIDE route B: it
 * climbs 22.2 -> 30.7 in one ladder and rejoins the spiral at U6.
 *
 * ---------------------------------------------------------------------------
 * THE TERRAIN SAMPLER
 * ---------------------------------------------------------------------------
 * `terrainHeightAt(x, z)` below is an EXACT transliteration of the recipe branch
 * of `sampleHeights()` in runtime/world/terrain.js — same `ihash`, same quintic
 * `fade`, same 4-octave `fbm` (gain 0.5, lacunarity 2.03), same cosine `bump`
 * falloff, same evaluation order:
 *
 *     base -> + hills -> + ridges -> + fbm noise -> flats BLEND OVER the lot
 *
 * with hills using `k*k*(3-2k)` over `k = bump(d/r)`, ridges taking `R.w` as a
 * FULL width (half-width `w/2`), and flats dead level inside 0.55r then melting
 * to the natural surface at the rim. It touches nothing but `Math`, so the
 * mesh, the Heightfield collider, `_harness/reachcheck.mjs` and this file all
 * agree to the millimetre — no `p` in this file is a guess.
 *
 * SLOPE BUDGET. A hill's steepest face is `2.356 * h / r` (the maximum of
 * d/dt of `smoothstep(bump(t))` is 2.356, at t = 0.5) and a flat's skirt is
 * `1.571 * dh / (0.45 r)`. Every hill and flat here is sized against those two
 * numbers. Measured worst case on each REQUIRED walk (0.5 m central differences):
 *     spawn -> plaza edge          1.2 deg
 *     plaza -> shaft court        28.4 deg
 *     plaza -> geyser terrace     29.5 deg   (along the ash path: 30.0)
 *     plaza -> cannon bluff       31.3 deg   (along the ash path: 30.6)
 *     geyser terrace -> court     23.2 deg
 *     cannon bluff -> court        8.5 deg
 *     court -> gantry foot         8.7 deg
 *     shaft floor, both diagonals  0.0 deg   (it is a flat)
 * The only slide surfaces on the map are the two lava-pool banks (61 deg on the
 * east, 43 deg on the west). Nothing required crosses either; they are how you
 * fall in.
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS (contract §25)
 * ---------------------------------------------------------------------------
 *   p            CENTRE, [x, y, z].  s = FULL size  => a top is p[1] + s[1]/2.
 *   yaw          RADIANS, yaw 0 faces -Z. +yaw is counter-clockwise from above.
 *                (-Z is north, +Z is south — the spawn plaza is in the SOUTH.)
 *   stripe:true  "you had to jump to get here" — the bright leading edge.
 *                Walk-on ground and decor never get one.
 *   text         built in the local XY plane facing local +Z; rot [0,0,0] faces
 *                a player walking north (-Z), which is the way in from spawn.
 *
 * ---------------------------------------------------------------------------
 * THE REACH BUDGET ACTUALLY USED
 * (safe limits from core/tuning.js REACH_TABLE, printed by reachBanner():
 *  single 4.52 flat / 3.88 at +1.0 / 3.28 at +1.6; double 5.24 (1 landing,
 *  4 m run-up); triple 6.11 (2 landings, 6 m run-up); longjump 6.42 (6 m
 *  run-up); wall kick +2.0 per kick in a shaft <= 3.4 m wide)
 * ---------------------------------------------------------------------------
 *   longest REQUIRED gap     2.60 m at +1.60 m  BEAT 8, U2 -> U3 and U6 -> U7
 *                            (single-safe at +1.6 is 3.28 m: 0.68 m of slack)
 *   longest REQUIRED rise    1.60 m             every step of both spirals
 *   REQUIRED gaps, in full   floor->S1 0.00 @ +1.60 · S1->S2 2.00 @ +1.50 ·
 *                            S2->S3 2.00 @ +1.50 · S3->S4 2.00 @ +1.50 ·
 *                            S4->S5 2.00 @ +1.50 · S5->sill 1.50 @ +0.40 ·
 *                            sill->M1 0.30 @ +1.05 · M1->mid 1.13 @ +0.45 ·
 *                            mid->U1 0.50 @ +1.60 · U1->U2 2.10 @ +1.60 ·
 *                            U2->U3 2.60 @ +1.60 · U3->U4 2.60 @ +1.60 ·
 *                            U4->U5 2.10 @ +1.60 · U5->U6 2.10 @ +1.60 ·
 *                            U6->U7 2.60 @ +1.60 · U7->exit 2.50 @ +1.60 ·
 *                            exit->deck 1.00 @ +1.10 · deck->lip 0.00 @ +1.60
 *                            — every one inside the single jump's 3.28 m at
 *                            +1.6 m, so ROUTE B never asks for a chained jump.
 *   the SECRET's jump        5.50 m at +0.50 m from the mid deck, which offers
 *                            13.0 m of straight deck along +X: a long jump
 *                            (safe 6.42) or a triple (safe 6.11); a double
 *                            (5.24) will NOT do it. BEAT 7.
 *   wall-kick chimney        2.80 m clear (limit 3.4), 8.50 m of climb =
 *                            1 jump + 4 kicks at +2.0. BEAT 8.
 *   cannon shot              30.8 m out, +9.0 m up; it crosses the east wall
 *                            face (x = 15) at y ~16.8 m, i.e. through the
 *                            14.0 - 20.0 clerestory slot. BEAT 3.
 *   riskiest OPTIONAL line   the east lava pool: 3.20 m off a 37 deg bank onto
 *                            a stepping stone with lava on all four sides.
 *
 * CONTENT LEDGER: 8 sigils · 7 crests · 115 coins · 6 checkpoints ·
 * hazard families lava, chase, jumppad, cannon, rotor, mover, vanish, flame,
 * rings, breakable + critters bumbler x3, skitter x3, warden.
 */

/* ===========================================================================
 * 0. Palette — EMBER FOUNDRY
 * ======================================================================== */

const BASALT = 0x4a4550;     // the drum, the ledges, the pillars
const BASALT_HI = 0x6c6474;  // lit basalt (the surfaces you land on)
const IRON = 0x8a8079;       // foundry steel: gantry, balcony, plates
const EMBER = 0xff7a2a;      // flame, vent glow, lava crust
const LAVA_C = 0xff4a12;     // the pools and the front
const GOLD = 0xffd257;       // coin / sigil / crest glow
const SAFE_EDGE = 0xffc46a;  // leading-edge stripe (warm, reads on basalt)
const SLAG = 0x2e2a33;       // dead slag: chimney fin, crust, stepping stones

/* ===========================================================================
 * 1. THE HEIGHTFIELD — every `p` in this file is justified against it
 * ======================================================================== */

/** Heightfield definition. Consumed verbatim by world/terrain.js (contract §18). */
const HEIGHTS = {
  seed: 20260903,
  base: 1.2,
  hills: [
    // THE CINDER MOUND. The drum stands on it. 2.356*5.2/40 = 0.31 => 17.2 deg.
    { p: [0, -20], r: 40, h: 5.2 },
    // The two lava basins. A negative hill is a bowl; their banks are the only
    // slide surfaces on the map and nothing required crosses either.
    { p: [32, 30], r: 14, h: -2.6 },
    { p: [-30, 33], r: 12, h: -2.2 },
    // THE GEYSER TERRACE mound.       2.356*3.4/22 = 0.36 => 20.0 deg.
    { p: [-34, 4], r: 22, h: 3.4 },
    // THE CANNON BLUFF.               2.356*4.6/34 = 0.32 => 17.7 deg.
    { p: [34, 2], r: 34, h: 4.6 },
    // Rim swells that close the diorama on three sides.
    { p: [6, 52], r: 22, h: 2.4 },
    { p: [-56, -16], r: 20, h: 4.2 },
    { p: [56, -20], r: 20, h: 4.6 },
  ],
  ridges: [
    // THE NORTH CINDER RIDGE. `w` is a FULL width in terrain.js (half-width
    // w/2 = 15), so its face is 6.0 * 1.571 / 15 = 0.63 => 32 deg: a wall you
    // read as a wall, standing behind the caldera.
    { a: [-60, -54], b: [58, -56], w: 30, h: 6.0 },
  ],
  noise: { amp: 0.32, freq: 0.055 },
  flats: [
    { p: [0, 42], r: 14, h: 1.6 },      // SPAWN PLAZA            (spawn + cp1)
    { p: [32, 30], r: 9, h: -1.8 },     // east lava pan (pool floor)
    { p: [-30, 33], r: 8, h: -1.4 },    // west lava pan (pool floor)
    { p: [-34, 4], r: 20, h: 4.4 },     // GEYSER TERRACE                 (cp2)
    { p: [34, 2], r: 22, h: 5.6 },      // CANNON BLUFF                   (cp3)
    { p: [0, -20], r: 32, h: 6.0 },     // SHAFT COURT + shaft floor (cp4, cp5)
  ],
};

/* --- the sampler: an exact transliteration of terrain.js sampleHeights ---- */

/** Integer hash in [0, 1). Math.imul only, so the 32-bit wrap is engine-identical. */
function ihash(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Quintic smoothstep — C2 continuous, so the fbm band has no normal creases. */
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

/** Fractal value noise: 4 octaves, gain 0.5, lacunarity 2.03. */
function fbm(x, z, seed, octaves) {
  const O = octaves || 4;
  let v = 0, a = 1, f = 1, norm = 0;
  for (let i = 0; i < O; i++) {
    v += vnoise(x * f, z * f, seed + i * 131) * a;
    norm += a; a *= 0.5; f *= 2.03;
  }
  return norm > 0 ? v / norm : 0;
}

/** Smooth radial falloff: 1 at the centre, 0 at (and past) the rim. */
function bump(t) { if (t >= 1) return 0; if (t <= 0) return 1; return 0.5 * (1 + Math.cos(Math.PI * t)); }

/** Distance from (px,pz) to segment a->b in the XZ plane. */
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
 * bit-for-bit what world/terrain.js bakes and what reachcheck.mjs walks.
 */
export function terrainHeightAt(x, z) {
  let y = HEIGHTS.base;
  for (let i = 0; i < HEIGHTS.hills.length; i++) {
    const Hh = HEIGHTS.hills[i];
    const r = Hh.r || 1;
    const dx = x - Hh.p[0], dz = z - Hh.p[1];
    const dd = Math.sqrt(dx * dx + dz * dz);
    if (dd < r) { const k = bump(dd / r); y += (Hh.h || 0) * (Hh.sharp ? k : k * k * (3 - 2 * k)); }
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
 * 2. Authoring helpers — every one resolves against the heightfield, so no
 *    placement in this file is a guess.
 * ======================================================================== */

const gy = terrainHeightAt;
const r2 = (v) => Math.round(v * 100) / 100;

/** A point ON the ground at (x, z), lifted `up` metres. */
function on(x, z, up) { return [r2(x), r2(gy(x, z) + (up || 0)), r2(z)]; }

/**
 * Coins along a jump ARC from a to b, peaking `h` above the chord. Expanded to
 * explicit {p} entries here rather than shipped as a new def kind, so an arc can
 * never be silently dropped by a Collectibles build that only knows the
 * contract's {p} / {ring} / {line} / {arc} forms.
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
 * a trail on a mound this shape; this cannot.
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
 * KEEP-OUT VOLUMES. "Nothing lands in the drum, on the gantry, in a pool or on
 * a pad" is a comment until something enforces it — verdant-1 learned that when
 * a scattered tree grew straight through its own wall-kick shaft and made a
 * whole route unperformable. Rects are [x0, x1, z0, z1] in world metres,
 * already margined.
 */
const KEEPOUT = [
  [-21.0, 22.0, -41.0, -1.0],   // the drum, the gantry stair, the caldera deck, the lava tube
  [26.0, 40.0, 22.0, 38.0],     // the east lava pool
  [-38.0, -22.0, 25.0, 41.0],   // the west lava pool
  [-48.0, -26.0, -12.0, 14.0],  // the geyser field's pads and pillars
  [38.0, 48.0, 0.0, 12.0],      // the bluff crag and its pad
  [-8.0, 8.0, 34.0, 50.0],      // the spawn plaza itself
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
 * Seeded by `ihash`, so the plain dresses itself identically on every load and
 * `reset()` never moves a boulder (contract hard rule 3). Points inside a
 * KEEPOUT are dropped HERE rather than in each `make`, so no call site can
 * forget.
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

/* THE COURT / SHAFT FLOOR. The flat at (0,-20) r 32 is EXACTLY 6.00 inside
   17.6 m, which covers the whole 24 x 24 m shaft interior and both feet of the
   gantry stair; measured corners (-12,-32) 6.00, (12,-32) 6.00, (-12,-8) 6.00,
   (12,-8) 6.00. Nothing in BEAT 4-5 stands on a guess. */
const COURT_Y = 6.00;

/* THE DRUM. Outer footprint x -15..15, z -35..-5; walls 3.0 m thick; interior
   x -12..12, z -32..-8 (24 x 24 m — wide enough that the camera never has to
   tilt up a chimney to see the hero, which is what a narrow shaft costs).
   Three bands:
     BASE   y  5.0 .. 14.0   (bedded 1 m into the 6.00 court)
     SLOT   y 14.0 .. 20.0   the clerestory — daylight in, cannon through
     UPPER  y 20.0 .. 34.4   carries the caldera deck
   The TOPS of the base band are the y-14 gallery walk (3 m wide, north and
   east), which is why the slot exists at all. */
const DRUM_BASE_TOP = 14.00;
const DECK_TOP = 36.00;      // the caldera deck (4 slabs, 34.4 .. 36.0)
const LIP_TOP = 37.60;       // the caldera lip block on the deck's north edge

/* THE CHASE. front(t) = 4.5 + clamp((t - 40) * 0.8, 0, 27.5), so:
     t =  40 s   the front leaves the floor (6.00)
     t =  51.9   it takes the y-14 gallery
     t =  61.9   it takes the mid deck (22.1)
     t =  74.4   it STOPS at 32.0 — 1.3 m under U7, 2.9 m under the exit ledge
   The RACE is 70 s for exactly this reason: the race and the chase are the same
   clock. `to: 32.0` is load-bearing — it keeps the exit ledge, the caldera and
   the whole of ROUTE A permanently dry, so the course can never seal itself —
   and the lateral cross-section is pinned to the drum footprint (x -15..15,
   z -35..-5) so the rim, the gantry stair and the outer half of the lava tube
   are never touched. */
const CHASE_FROM = 4.5, CHASE_TO = 32.0, CHASE_SPEED = 0.8, CHASE_DELAY = 40;

/* THE MID DECK. 13 x 10 m at 22.10 — the one platform in the shaft big enough
   to host a long jump's run-up (13.0 m along +X), which is BEAT 7's secret. */
const MID_TOP = 22.10;

/* ===========================================================================
 * 4. THE COURSE
 * ======================================================================== */

export default {
  id: 'ember-3',
  realm: 'ember',
  theme: 'ember',
  name: 'CINDER CHASE',
  subtitle: 'The mountain is hollow, and it is filling up',
  order: 3,
  difficulty: 6,
  music: 'ember',

  /* Par times per crest id (ms) — the HUD shows them, nothing gates on them. */
  par: {
    open: 105000, sigils: 300000, coins: 330000,
    secret: 150000, boss: 165000, race: 70000, wing: 150000,
  },

  /* Spawn on the plaza flat (EXACTLY 1.60), yaw 0 => facing -Z: the ash path
     runs north between the two lava pools and the drum fills the skyline with
     the crack down its face. Six metres of clear ground between the spawn beam
     and cp1's ring, so neither pillar of light ever stands on the hero. */
  spawn: { p: [0, 1.6, 46], yaw: 0 },
  killY: -20,
  bounds: { min: [-70, -12, -70], max: [70, 52, 70] },

  intro: {
    /* One sentence: where you are and what is about to happen. game.js already
       prints "EMBER FOUNDRY · CINDER CHASE" as the lockup above this line. */
    text: 'The old stack still stands, and the crack in its south face is the only door. Whatever is underneath it is coming up.',
    cam: [
      { p: [0, 30, 58], look: [0, 16, -20], t: 0 },
      { p: [34, 24, 10], look: [0, 22, -22], t: 2.8 },
      { p: [2, 5, 52], look: [0, 12, -6], t: 5.6 },
    ],
  },

  ambience: { wind: 0.42, ember: 0.7, rumble: 0.35 },

  /* ------------------------------------------------------------------------
   * TERRAIN
   * --------------------------------------------------------------------- */

  terrain: {
    kind: 'terrain',
    origin: [-70, -70],
    size: [140, 140],
    res: 1.0,
    surface: 'sand',                       // ash: the sand family, tinted cold
    heights: HEIGHTS,
    /* Cinder tufts, not meadow grass: short, sparse, dark, and a camera-local
       ring rather than a field smeared over 19 600 m2 (terrain.js buildGrass).
       `cross: false` keeps it at 2 triangles a blade on a course that already
       spends its triangle budget on the drum. */
    grass: { count: 9000, density: 22, height: 0.14, cross: false, color: 0x3b332e },
    /* Ash paths: the routes the coins follow, and the routes the slope budget
       in the header was measured along. Paths do not change height (terrain.js
       samplePaths) — they only carve the surface look, which is what leads the
       eye across a diorama this open. */
    paths: [
      { pts: [[0, 46], [0, 30], [0, 12], [0, -4]], w: 3.6 },        // plaza -> the crack
      { pts: [[0, 38], [-18, 24], [-30, 12], [-34, 4]], w: 3.0 },   // plaza -> geyser terrace
      { pts: [[0, 38], [16, 26], [30, 12], [34, 2]], w: 3.0 },      // plaza -> cannon bluff
      { pts: [[-34, 4], [-18, -4], [-2, -6]], w: 2.8 },             // geyser -> court
      { pts: [[34, 2], [18, -2], [2, -6]], w: 2.8 },                // bluff  -> court
      { pts: [[-6, -6], [-14, -8], [-18, -10]], w: 2.4 },           // court  -> gantry foot
    ],
  },

  /* ------------------------------------------------------------------------
   * CHECKPOINTS — 6, every one on ground that is EXACTLY flat (four on
   * heightfield flats, two on authored decks), every one BEFORE its spike, and
   * every one carrying the `clockOffset` that makes the chase fair on a retry.
   * --------------------------------------------------------------------- */
  checkpoints: [
    // Rim checkpoints rewind the chase to zero: a death out here costs you
    // nothing but the walk back.
    { id: 'cp-plaza', p: [0, 1.6, 40], yaw: 0, clockOffset: 0 },
    { id: 'cp-geyser', p: [-34, 4.4, 4], yaw: 1.15, clockOffset: 0 },
    { id: 'cp-bluff', p: [34, 5.6, 2], yaw: -1.05, clockOffset: 0 },
    // The shaft entrance, on the 6.00 flat just inside the crack. clockOffset 0
    // gives 40 s of grace before the front leaves the floor — the whole of
    // BEAT 5 at a walk.
    { id: 'cp-court', p: [0, COURT_Y, -6], yaw: 0, clockOffset: 0 },
    // The gallery, 8 m up. Rewinding to 30 s puts the front back on the floor
    // and gives 21.9 s before it takes this walk and 44.4 s before it stops:
    // enough to climb the 22 m above it without ever being generous.
    { id: 'cp-gallery', p: [0, DRUM_BASE_TOP, -33.5], yaw: Math.PI, clockOffset: 30 },
    // The caldera deck, where you come out of the hole — before the Warden, and
    // 4 m above the highest the front can ever reach.
    { id: 'cp-deck', p: [-10, DECK_TOP, -20], yaw: Math.PI, clockOffset: 0 },
  ],

  /* ------------------------------------------------------------------------
   * CRESTS — 7, one of each type in the contract.
   * --------------------------------------------------------------------- */
  crests: [
    {
      id: 'open', type: 'open', name: 'CREST ON THE CALDERA LIP',
      hint: 'The stair outside, the shaft inside, or the cannon. Pick one.',
      p: [0, LIP_TOP + 1.2, -37],
    },
    {
      id: 'sigils', type: 'sigils', name: 'EIGHT SIGILS OF THE FOUNDRY',
      hint: 'Two pools, a pillar, a crag, the floor, the balcony, the tube, the chimney, the lip.',
      spawnAt: [-6, COURT_Y + 1.45, -8],        // the court pedestal
    },
    {
      id: 'coins', type: 'coins', name: 'A HUNDRED COINS', threshold: 100,
      hint: '115 are lying about. You can miss fifteen.',
      spawnAt: [-6, 3.05, 41],                  // the plaza pedestal, flat 1.60
    },
    {
      id: 'secret', type: 'secret', name: 'WHAT THE CRUST KEPT',
      trigger: 'cinder-vault',
      hint: 'Something broke out of the east flank once. Pound whatever plugged it.',
      spawnAt: [19.0, 23.6, -20],               // inside the lava tube
    },
    {
      id: 'boss', type: 'boss', name: 'THE WARDEN OF THE CALDERA',
      hint: 'Jump the shockwave, dodge the charge, pound its back.',
      spawnAt: [0, DECK_TOP + 1.6, -31],
    },
    {
      id: 'race', type: 'race', name: 'CINDER CHASE',
      hint: 'Plaza to the caldera in seventy seconds. That is how long the lava takes.',
      start: [5, 1.6, 40], finish: [0, DECK_TOP, -10], limitMs: 70000,
      spawnAt: [0, DECK_TOP + 1.4, -10],
    },
    {
      id: 'wing', type: 'power', name: 'THE LONG WAY DOWN', power: 'wing',
      hint: 'Take the hat on the deck and thread all twelve rings on the way down.',
      p: [0, 9.6, 34],
    },
  ],

  /* ------------------------------------------------------------------------
   * SIGILS — 8, on optional risky lines. Every one is verified against the
   * surface it hangs over, and every rise is 1.30 m: inside a plain single
   * jump's 1.91 m apex from a ledge too small to host anything bigger.
   * --------------------------------------------------------------------- */
  sigils: [
    { p: [32.0, 2.8, 30.5], note: '1 — the basalt plug in the east lava pool (top 1.50)' },
    { p: [-44.0, 13.3, 6.0], note: '2 — the tall geyser pillar, jump-pad only (top 12.00)' },
    { p: [44.0, 10.1, 6.0], note: '3 — the bluff crag, out over the drop (top 8.80)' },
    { p: [-6.0, 7.50, -28.0], note: '4 — the slag block on the shaft floor behind the vents (top 6.50)' },
    { p: [16.0, 16.1, -20.0], note: '5 — the outer tip of the cannon balcony (top 14.80)' },
    { p: [15.0, 23.9, -20.0], note: '6 — the lava tube, past the crust (floor 22.60)' },
    { p: [-10.5, 32.0, -12.0], note: '7 — the head of the wall-kick chimney (top 30.70)' },
    { p: [17.0, 38.5, -20.0], note: '8 — the east crag off the caldera deck (top 37.20)' },
  ],

  /* ------------------------------------------------------------------------
   * COINS — 115 placed, 100 needed. The plaza trail is the only one you cannot
   * miss; everything else pays for a line you chose.
   * --------------------------------------------------------------------- */
  coins: [
    // BEAT 1 — the ash path out of the plaza to the crack. (12)
    ...trailCoins([[0, 45], [0, 34], [0, 20], [0, 6], [0, -4]], 12, 1.15),
    // BEAT 1 — the west pool: an arc over its three stepping stones. (6)
    ...arcCoins([-30, 1.9, 25.5], [-30, 1.9, 31.5], 1.3, 6),
    // BEAT 1 — a ring on the plaza pedestal, so 100 is visibly in reach. (8)
    { ring: { c: [-6, 41], r: 3.4, n: 8, y: 2.7 } },
    // BEAT 2 — the path west, then a ring on the geyser terrace. (8 + 8)
    ...trailCoins([[0, 38], [-18, 24], [-30, 12], [-34, 4]], 8, 1.15),
    { ring: { c: [-36, 2], r: 5.0, n: 8, y: 5.5 } },
    // BEAT 2 — pad 1's arc onto the tall pillar: the shape of the launch. (6)
    ...arcCoins([-40.0, 6.0, 2.0], [-44.0, 13.0, 6.0], 2.2, 6),
    // BEAT 3 — the path east, then the arc off the bluff pad onto the crag. (8 + 5)
    ...trailCoins([[0, 38], [16, 26], [30, 12], [34, 2]], 8, 1.15),
    ...arcCoins([40.0, 7.0, 6.0], [44.0, 10.0, 6.0], 1.3, 5),
    // BEAT 1 — the east pool: the rim ring you can price from safety. (8)
    { ring: { c: [32, 30], r: 11.0, n: 8, y: 2.0 } },
    // BEAT 1 — four on the pool stones themselves. (4)
    { p: [32.0, 2.4, 24.2] }, { p: [32.0, 2.5, 30.5] },
    { p: [-30.0, 1.9, 27.4] }, { p: [-30.0, 1.9, 30.6] },
    // BEAT 4 — a ring round the court pedestal, under the crack. (8)
    { ring: { c: [-6, -8], r: 3.6, n: 8, y: COURT_Y + 1.1 } },
    // BEAT 5 — the slag steps, one over each ledge. (5)
    { p: [0.0, 8.8, -11.5] }, { p: [6.0, 10.3, -14.0] }, { p: [8.5, 11.8, -20.0] },
    { p: [6.0, 13.3, -26.0] }, { p: [0.0, 14.8, -28.5] },
    // BEAT 5 — five on the shaft floor: the ones you take before the clock
    // starts to matter. (5)
    { ring: { c: [0, -20], r: 6.5, n: 5, y: 7.3 } },
    // BEAT 6 — the y-14 gallery walk, north side. (8)
    { line: { a: [-9.0, 15.1, -33.5], b: [9.0, 15.1, -33.5], n: 8 } },
    // BEAT 6 — a ring on the mid deck: the breather before the vanish spiral. (6)
    { ring: { c: [0, -20], r: 4.2, n: 6, y: MID_TOP + 1.1 } },
    // BEAT 7 — the long jump into the lava tube, drawn as an arc. (5)
    ...arcCoins([7.0, 23.1, -20.0], [13.0, 23.6, -20.0], 1.1, 5),
    // BEAT 8 — the upper spiral, one over each ledge. (7)
    { p: [9.0, 24.8, -20.0] }, { p: [6.5, 26.4, -26.0] }, { p: [0.0, 27.9, -28.5] },
    { p: [-6.5, 29.5, -26.0] }, { p: [-9.0, 31.1, -20.0] }, { p: [-6.5, 32.8, -14.0] },
    { p: [0.0, 34.4, -11.5] },
    // BEAT 9 — a ring on the caldera deck, round the mouth of the shaft. (8)
    { ring: { c: [0, -20], r: 8.4, n: 8, y: DECK_TOP + 1.1 } },
  ],

  /* ------------------------------------------------------------------------
   * POWERS — one wing hat, on the caldera deck, 10.05 m from the centre of the
   * Warden's arena (radius 6.0) so it is never inside the fight. A ring run
   * that starts 60 m from the first ring is a commute, so it starts at the top
   * of the spiral.
   * --------------------------------------------------------------------- */
  powers: [
    { kind: 'wing', p: [10.0, DECK_TOP + 1.4, -30.0], duration: 34 },
  ],

  /* ------------------------------------------------------------------------
   * OBJECTS — the built world, beat by beat.
   * --------------------------------------------------------------------- */
  objects: [

    /* ========================================================================
     * BEAT 1 — THE ASH PLAIN
     * Thirty seconds in which the only thing that can hurt you is standing in
     * the wrong place. Spawn faces -Z: the ash path, the two pools flanking it
     * and the drum with the crack down its face are all on screen before the
     * first input. The east pool teaches what `lava` looks like from safety;
     * the west pool, with three stones across it, teaches that you are allowed
     * to go over one.
     * ===================================================================== */

    { kind: 'deco', kindOf: 'sign', p: on(3.2, 38, 1.15), s: [0.14, 1.7, 1.2], mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'post', p: on(3.2, 38, 0.65), s: [0.16, 1.3, 0.16], mat: 'metal', tint: 0x5a534c },
    { kind: 'text', p: [3.2, 3.95, 38], rot: [0, 0, 0], text: 'CINDER CHASE', size: 0.60, color: 0xf0d0a8 },
    { kind: 'text', p: [3.2, 3.42, 38], rot: [0, 0, 0], text: 'THE MOUNTAIN IS HOLLOW  ·  THE CRACK IS THE DOOR', size: 0.22, color: 0xc79a72 },

    // The pedestal the HUNDRED COINS crest rises from.
    { kind: 'pedestal', p: on(-6, 41, 0), mat: 'obsidian', tint: BASALT, glow: GOLD },

    /* THE EAST LAVA POOL. Box 22 x 22 centred on the basin, surface at 0.60 and
       box floor at -2.60 against a pan floor of -1.80. The perimeter ground
       never drops below 1.07 (measured every 0.5 m round the box), so the pool
       has a shoreline instead of a visible box edge. Its bank is 61 deg — a
       deliberate slide, and the only one on the required half of the map. */
    { kind: 'lava', p: [32, -1.0, 30], s: [22, 3.2, 22], tint: LAVA_C },
    /* The stepping stone and the plug. Walkable ground ends at z ~ 20 (h 3.75,
       slope 37 deg): 3.20 m from there onto the stone at +1.40, then 3.10 m at
       +0.10 to the plug — both inside a single jump, both with lava on four
       sides. Sigil 1 is 1.30 m over the plug. */
    { kind: 'platform', p: [32, 0.0, 24.2], s: [3.0, 2.8, 3.0], mat: 'obsidian', tint: SLAG, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [32, 0.1, 30.5], s: [3.4, 2.8, 3.4], mat: 'obsidian', tint: SLAG, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'lavaRock', p: [35.6, 0.2, 27.0], s: [1.4, 1.2, 1.4], mat: 'obsidian', tint: SLAG, count: 4, spread: 5.0, jitter: 0.4 },
    { kind: 'light', p: [32, 3.2, 30], color: EMBER, intensity: 9, distance: 26 },
    { kind: 'text', p: [32, r2(gy(32, 18) + 1.4), 18], rot: [0, 0, 0], text: 'IT IS NOT ONLY WATER', size: 0.22, color: 0xc79a72 },

    /* THE WEST LAVA POOL. Smaller, gentler banks (43 deg), three stones across
       it and a vent on the middle one: the pool you are meant to cross, where
       the east one is the pool you are meant to respect. */
    { kind: 'lava', p: [-30, -1.0, 33], s: [18, 3.2, 18], tint: LAVA_C },
    { kind: 'platform', p: [-30, 0.3, 27.4], s: [2.8, 2.6, 2.8], mat: 'obsidian', tint: SLAG, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-30, 0.3, 30.6], s: [2.8, 2.6, 2.8], mat: 'obsidian', tint: SLAG, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-30, 0.3, 33.8], s: [2.8, 2.6, 2.8], mat: 'obsidian', tint: SLAG, stripe: true, edge: SAFE_EDGE },
    { kind: 'flame', p: [-30, 1.7, 30.6], dir: [0, 1, 0], len: 4.2, radius: 0.85, cycle: { on: 1.6, off: 2.6, warn: 0.9, phase: 0 }, color: EMBER },
    { kind: 'light', p: [-30, 3.0, 33], color: EMBER, intensity: 7, distance: 22 },

    /* ========================================================================
     * BEAT 2 — THE GEYSER FIELD  (cp2)
     * The terrace west of the path is EXACTLY 4.40 for 11 m around (-34, 4).
     * Three `jumppad` geysers stand on it, each aimed at a basalt pillar; the
     * pads are the course's first "the ground throws you", and the tallest
     * pillar carries sigil 2 where no jump can reach it.
     *   pad 1  apex 9.0 m -> pillar A top 12.00  (rise 7.32, gap 3.25; the
     *          pad's own horizontal reach at that rise is 7.54 m)
     *   pad 2  apex 6.0 m -> pillar B top  9.60  (rise 4.92, gap 4.42;
     *          reach 6.13 m)
     *   pad 3  apex 8.0 m -> the coin arc back over the terrace
     * ===================================================================== */

    { kind: 'jumppad', p: [-40, 4.54, 2], s: [3, 0.28, 3], power: 9.0, dir: [0, 1, 0], mat: 'rubber', tint: 0xff9c4a },
    { kind: 'jumppad', p: [-36, 4.54, -2], s: [3, 0.28, 3], power: 6.0, dir: [0, 1, 0], mat: 'rubber', tint: 0xff9c4a },
    { kind: 'jumppad', p: [-34, 4.54, 10], s: [3, 0.28, 3], power: 8.0, dir: [0, 1, 0], mat: 'rubber', tint: 0xff9c4a },

    { kind: 'platform', p: [-44, 8.2, 6], s: [3.4, 7.6, 3.4], mat: 'obsidian', tint: BASALT, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-42, 7.0, -4], s: [3.2, 5.2, 3.2], mat: 'obsidian', tint: BASALT, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-30, 6.2, -8], s: [3.0, 4.0, 3.0], mat: 'obsidian', tint: BASALT, stripe: true, edge: SAFE_EDGE },

    // Vents that are only weather: they say the ground is alive here before a
    // pad ever throws you.
    { kind: 'flame', p: [-38, 4.5, 6], dir: [0, 1, 0], len: 3.4, radius: 0.7, cycle: { on: 1.2, off: 3.0, warn: 0.9, phase: 0.4 }, color: EMBER },
    { kind: 'flame', p: [-32, 4.5, -6], dir: [0, 1, 0], len: 3.4, radius: 0.7, cycle: { on: 1.2, off: 3.0, warn: 0.9, phase: 1.9 }, color: EMBER },

    { kind: 'text', p: [-34, 5.7, 8], rot: [0, 0.5, 0], text: 'STAND ON IT', size: 0.26, color: 0xc79a72 },
    { kind: 'deco', kindOf: 'lavavent', p: on(-38, 0, 0.1), s: [1.1, 0.5, 1.1], mat: 'obsidian', tint: EMBER, count: 6, spread: 9.0, jitter: 0.45 },
    { kind: 'light', p: [-38, 7.0, 2], color: EMBER, intensity: 6, distance: 18 },

    /* ========================================================================
     * BEAT 3 — THE CANNON BLUFF  (cp3)
     * The bluff flat is EXACTLY 5.60 for 12 m around (34, 2). A fourth jump pad
     * throws you 2.92 m up onto the crag (sigil 3) over a real drop, and then
     * the cannon: ROUTE C.
     *
     * THE SHOT. Breech (30, 6.6, 6) -> target (13.5, 15.6, -20): 30.8 m out and
     * 9.0 m up. Solved against the asymmetric gravity at the default 45 deg
     * that is ~39 m/s with an apex ~11.2 m over the breech, and it crosses the
     * east wall's outer face (x = 15) at y ~16.8 m — inside the 14.0 - 20.0
     * CLERESTORY SLOT, which is why the slot is 6 m tall. It lands on the
     * balcony (7 x 12 m, top 14.80) hanging over the y-14 gallery.
     * ===================================================================== */

    { kind: 'jumppad', p: [40, 5.74, 6], s: [3, 0.28, 3], power: 5.0, dir: [0, 1, 0], mat: 'rubber', tint: 0xff9c4a },
    { kind: 'platform', p: [44, 7.2, 6], s: [4.2, 3.2, 4.2], mat: 'obsidian', tint: BASALT, stripe: true, edge: SAFE_EDGE },

    {
      kind: 'cannon', id: 'shaft-gun',
      p: [30, 5.6, 6], yaw: 0.5651, pitchDeg: 45, power: 39,
      target: [13.5, 15.6, -20], r: 1.5, len: 4.2, cooldown: 1.4,
      mat: 'metal', tint: IRON,
    },
    { kind: 'text', p: [30, 7.4, 9.2], rot: [0, 0, 0], text: 'CLIMB IN AND IT FIRES', size: 0.26, color: 0xc79a72 },
    { kind: 'text', p: [30, 6.9, 9.2], rot: [0, 0, 0], text: 'it aims through the tap-holes', size: 0.20, color: 0xa8825f },
    { kind: 'deco', kindOf: 'pipe', p: on(27, 2, 0.9), s: [0.6, 1.8, 0.6], mat: 'metal', tint: IRON, count: 5, spread: 7.0, jitter: 0.4 },
    { kind: 'deco', kindOf: 'anvil', p: on(36, 8, 0.3), s: [1.0, 0.8, 0.7], mat: 'metal', tint: IRON, count: 3, spread: 5.5, jitter: 0.35 },
    { kind: 'light', p: [30, 8.4, 4], color: 0xffc077, intensity: 6, distance: 18 },

    /* ========================================================================
     * BEAT 4 — THE SHAFT COURT AND THE DRUM  (cp4)
     * The court is the 6.00 flat. The drum standing on it is the whole course:
     * outer footprint x -15..15, z -35..-5, walls 3.0 m thick, three bands with
     * a 6 m CLERESTORY SLOT between the lower two.
     *
     * The slot is not decoration. It does four jobs:
     *   1. the TOPS of the base band are the y-14 GALLERY, a 3 m walk along the
     *      north and east faces that BEAT 6 starts from (the two sills meet at
     *      the corner with a 0.00 m gap, so they are one surface);
     *   2. it lets the cannon shot in (BEAT 3);
     *   3. it lets daylight in, so a 24 x 24 x 29 m room is lit from the side
     *      as well as from the rising lava underneath it;
     *   4. it lets the camera see the hero against sky from outside the drum.
     * The SOUTH CRACK (x -3..3, full height) is the way in on foot.
     * ===================================================================== */

    // --- base band, y 5.0 .. 14.0 (bedded 1 m into the 6.00 court) ---------
    { kind: 'platform', p: [0, 9.5, -33.5], s: [30, 9, 3], mat: 'obsidian', tint: BASALT },
    { kind: 'platform', p: [13.5, 9.5, -20], s: [3, 9, 24], mat: 'obsidian', tint: BASALT },
    // --- the west and south walls are FULL height: the west face carries
    //     ROUTE A on its outside and the wall-kick chimney on its inside, and
    //     neither wants a hole through the middle of it.
    { kind: 'platform', p: [-13.5, 19.7, -20], s: [3, 29.4, 24], mat: 'obsidian', tint: BASALT },
    { kind: 'platform', p: [-9, 19.7, -6.5], s: [12, 29.4, 3], mat: 'obsidian', tint: BASALT },
    { kind: 'platform', p: [9, 19.7, -6.5], s: [12, 29.4, 3], mat: 'obsidian', tint: BASALT },
    // --- slot mullions and corner piers, y 14.0 .. 20.0. Without these the
    //     north and east clerestories are 30 m and 24 m of unsupported lintel.
    //     The two east mullions sit at z -27 and z -13 so they clear the cannon
    //     balcony (z -26..-14) by 0.50 m on both sides.
    { kind: 'platform', p: [-13.5, 17, -33.5], s: [3, 6, 3], mat: 'obsidian', tint: BASALT_HI },
    { kind: 'platform', p: [13.5, 17, -33.5], s: [3, 6, 3], mat: 'obsidian', tint: BASALT_HI },
    { kind: 'platform', p: [13.5, 17, -27], s: [3, 6, 3], mat: 'obsidian', tint: BASALT_HI },
    { kind: 'platform', p: [13.5, 17, -13], s: [3, 6, 3], mat: 'obsidian', tint: BASALT_HI },
    { kind: 'platform', p: [13.5, 17, -6.5], s: [3, 6, 3], mat: 'obsidian', tint: BASALT_HI },
    // --- upper band, y 20.0 .. 34.4. The east face is split for the LAVA
    //     TUBE's mouth (x 12..15, z -23..-17, y 20..27) under a 7.4 m lintel.
    { kind: 'platform', p: [0, 27.2, -33.5], s: [30, 14.4, 3], mat: 'obsidian', tint: BASALT },
    { kind: 'platform', p: [13.5, 27.2, -27.5], s: [3, 14.4, 9], mat: 'obsidian', tint: BASALT },
    { kind: 'platform', p: [13.5, 27.2, -12.5], s: [3, 14.4, 9], mat: 'obsidian', tint: BASALT },
    { kind: 'platform', p: [13.5, 30.7, -20], s: [3, 7.4, 6], mat: 'obsidian', tint: BASALT },

    // --- the court: the pedestal the EIGHT SIGILS crest rises from, and the
    //     sign that teaches the one mechanic this course is built on.
    { kind: 'pedestal', p: [-6, COURT_Y, -8], mat: 'obsidian', tint: BASALT, glow: GOLD },
    { kind: 'text', p: [3.4, COURT_Y + 2.0, -4], rot: [0, 0, 0], text: 'WHEN THE LAVA RISES  ·  PRESS  T', size: 0.28, color: 0xffb060 },
    { kind: 'text', p: [3.4, COURT_Y + 1.5, -4], rot: [0, 0, 0], text: 'it only falls when you go back to the pad', size: 0.20, color: 0xc79a72 },
    { kind: 'deco', kindOf: 'brazier', p: [-3.4, COURT_Y + 1.1, -5.4], s: [0.8, 1.8, 0.8], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'brazier', p: [3.4, COURT_Y + 1.1, -5.4], s: [0.8, 1.8, 0.8], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'buttress', p: [-15.8, COURT_Y + 1.4, -14], s: [1.0, 2.8, 4.4], mat: 'obsidian', tint: BASALT, count: 3, spread: 12.0, jitter: 0.0 },
    { kind: 'deco', kindOf: 'emblem', p: [0, 22.0, -3.4], s: [3.4, 3.4, 0.3], mat: 'metal', tint: EMBER },

    /* THE CHASE — the set piece, and the reason the course is called what it is.
       Its cross-section is pinned to the drum (faceW 30 x faceH 30 about
       (0, -20) => x -15..15, z -35..-5), so the rim never floods, the gantry
       stair at x -19.5..-15.5 never floods, and the outer half of the lava tube
       (x > 15) is a genuine refuge. `to: 32.0` stops the front 2.90 m under the
       exit ledge for good. */
    {
      kind: 'chase', axis: 'y', mat: 'lava',
      from: CHASE_FROM, to: CHASE_TO, speed: CHASE_SPEED, delay: CHASE_DELAY,
      p: [0, 0, -20], s: [30, 2, 30], color: LAVA_C,
    },

    /* ========================================================================
     * BEAT 5 — THE SLAG STEPS  (cp5 at the top of them)
     * The first spiral: five ledges at r 8.5 about (0, -20), 1.50 m apart in
     * height and 2.00 m apart edge to edge — a single jump at +1.5 m is safe to
     * 3.28 m, so this is a rhythm, not a test. It exists to be climbed with the
     * lava coming up behind it, which is a different thing entirely.
     * Sigil 4 sits on the floor behind the vents: you have to spend the clock
     * to take it, and the clock is the hazard.
     * ===================================================================== */

    { kind: 'platform', p: [0, 7.3, -11.5], s: [4, 0.6, 4], mat: 'obsidian', tint: BASALT_HI, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [6.0, 8.8, -14.0], s: [4, 0.6, 4], mat: 'obsidian', tint: BASALT_HI, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [8.5, 10.3, -20.0], s: [4, 0.6, 4], mat: 'obsidian', tint: BASALT_HI, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [6.0, 11.8, -26.0], s: [4, 0.6, 4], mat: 'obsidian', tint: BASALT_HI, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [0, 13.3, -28.5], s: [4, 0.6, 4], mat: 'obsidian', tint: BASALT_HI, stripe: true, edge: SAFE_EDGE },

    // Floor vents. The cycles are staggered so the floor is a pattern to read
    // and not a coin flip; the kill capsule only arms past 22 % of the jet.
    { kind: 'flame', p: [-6, COURT_Y, -22], dir: [0, 1, 0], len: 5.0, radius: 0.9, cycle: { on: 1.5, off: 2.5, warn: 0.9, phase: 0 }, color: EMBER },
    { kind: 'flame', p: [-9, COURT_Y, -28], dir: [0, 1, 0], len: 5.0, radius: 0.9, cycle: { on: 1.5, off: 2.5, warn: 0.9, phase: 1.3 }, color: EMBER },
    { kind: 'flame', p: [-3, COURT_Y, -30], dir: [0, 1, 0], len: 5.0, radius: 0.9, cycle: { on: 1.5, off: 2.5, warn: 0.9, phase: 2.6 }, color: EMBER },
    // THE SLAG BLOCK sigil 4 stands over (top 6.50, a 0.5 m step off the floor,
    // 2.2 m clear of every vent's 0.9 m jet). It is here because the reach gate
    // anchors a target with no authored surface under it to the terrain NODE and
    // measures its rise against the field's MEAN height (reachcheck.mjs
    // surfaceUnder / `rise: p[1] - s.y`), which reported the sigil 4.85 m over a
    // floor it is 1.50 m over; a real top face under it is what the gate reads.
    { kind: 'platform', p: [-6.0, COURT_Y + 0.25, -28.0], s: [1.6, 0.5, 1.6], mat: 'obsidian', tint: BASALT_HI, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'lavaRock', p: [-9.5, COURT_Y + 0.4, -18], s: [1.5, 1.1, 1.5], mat: 'obsidian', tint: SLAG, count: 6, spread: 11.0, jitter: 0.45 },
    { kind: 'deco', kindOf: 'debris', p: [7.5, COURT_Y + 0.3, -30], s: [1.2, 0.7, 1.2], mat: 'metal', tint: 0x554b45, count: 5, spread: 8.0, jitter: 0.5 },
    { kind: 'light', p: [0, 10.0, -20], color: EMBER, intensity: 10, distance: 30 },

    /* ========================================================================
     * BEAT 6 — THE PLATES AND THE BARS
     * The y-14 gallery is the drum's own masonry, so it is flat by
     * construction. From it, two `mover` elevator plates lift you to the MID
     * DECK at 22.10 while two `rotor` bar rings sweep the space between them:
     * solid, rideable, and perfectly capable of walking you off a plate.
     *
     *   east sill  14.00 -> M1 low  15.05   gap 0.30 @ +1.05
     *   M1 high    21.65 -> mid     22.10   gap 1.13 @ +0.45
     *   north sill 14.00 -> M2 low  15.40   gap 1.80 @ +1.40
     *   M2 high    22.60 -> mid     22.10   gap 1.13, a step down
     * Both plates carry a rider (contract §10) and the reach gate joins each
     * plate's two poses with its `ride` edge — but ROUTE A bypasses the whole
     * of BEAT 6, so nothing REQUIRED depends on catching one.
     * ===================================================================== */

    {
      kind: 'mover', p: [9.5, 14.8, -12.0], s: [4.4, 0.5, 4.4],
      motion: { type: 'linear', to: [9.5, 21.4, -12.0], period: 9, ease: 'sine', dwell: 1.4 },
      mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE,
    },
    {
      kind: 'mover', p: [-9.5, 15.15, -28.0], s: [4.4, 0.5, 4.4],
      motion: { type: 'linear', to: [-9.5, 22.35, -28.0], period: 11, ease: 'sine', dwell: 1.4, phase: 0.35 },
      mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE,
    },

    // THE BARS. Rideable solids (no `kill`), because a 10 m bar sweeping a 24 m
    // room at head height is already the hazard — making it lethal would turn a
    // readable shove into a coin flip.
    { kind: 'rotor', style: 'bar', p: [0, 17.6, -20], arms: 3, len: 10.5, thick: 0.7, height: 0.7, period: 9, axis: 'y', dir: 1, mat: 'metal', tint: IRON },
    { kind: 'rotor', style: 'bar', p: [0, 26.0, -20], arms: 2, len: 11.0, thick: 0.7, height: 0.7, period: 7, axis: 'y', dir: -1, phase: 0.25, mat: 'metal', tint: IRON },

    // THE CANNON BALCONY — ROUTE C's landing, and sigil 5 on its outer tip.
    { kind: 'platform', p: [13.5, 14.4, -20], s: [7, 0.8, 12], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },

    // THE MID DECK. 13 x 10 m, and the 13 m along +X is what makes BEAT 7 legal.
    { kind: 'platform', p: [0, 21.7, -20], s: [13, 0.8, 10], mat: 'panel', tint: IRON, stripe: true, edge: SAFE_EDGE },

    { kind: 'text', p: [0, 15.6, -32.4], rot: [0, Math.PI, 0], text: 'RIDE THE PLATE  ·  MIND THE BARS', size: 0.26, color: 0xffb060 },
    { kind: 'light', p: [0, 19.0, -20], color: 0xffc077, intensity: 8, distance: 26 },
    { kind: 'light', p: [0, 29.0, -20], color: 0xffd9a0, intensity: 7, distance: 24 },
    { kind: 'deco', kindOf: 'cables', p: [-11.5, 24.0, -14], s: [0.3, 6.0, 0.3], mat: 'metal', tint: 0x4a423c, count: 4, spread: 9.0, jitter: 0.3 },
    { kind: 'deco', kindOf: 'gear', p: [12.0, 20.6, -30], s: [1.8, 0.4, 1.8], mat: 'metal', tint: IRON, count: 3, spread: 6.0, jitter: 0.3 },

    /* ========================================================================
     * BEAT 7 — THE LAVA TUBE  (the secret)
     * A spent tube that broke out of the east flank once, and got plugged. Its
     * mouth is the gap in the drum's upper band (x 12..15, z -23..-17,
     * y 20..27); the tube runs out past the wall to x 21, which is why its far
     * half sits OUTSIDE the chase's kill box and is the only dry ground inside
     * the drum once the front is up.
     *
     * THE JUMP: mid deck (x -6.5..6.5) -> tube floor (x 12..21), MEASURED
     * 5.50 m at +0.50 m, with 13.0 m of straight deck along +X behind it. Long
     * jump safe is 6.42 m and triple safe is 6.11 m; a double (5.24) will not
     * do it, which is exactly the discrimination this crest is worth.
     * Pound the plug at the far end and the vault opens.
     * ===================================================================== */

    { kind: 'platform', p: [16.5, 22.3, -20], s: [9, 0.6, 6], mat: 'obsidian', tint: SLAG, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [16.5, 26.9, -20], s: [9, 0.6, 6], mat: 'obsidian', tint: SLAG },
    { kind: 'platform', p: [20.7, 24.7, -20], s: [0.6, 4.2, 6], mat: 'obsidian', tint: SLAG },
    { kind: 'platform', p: [16.5, 24.7, -22.7], s: [9, 4.2, 0.6], mat: 'obsidian', tint: SLAG },
    { kind: 'platform', p: [16.5, 24.7, -17.3], s: [9, 4.2, 0.6], mat: 'obsidian', tint: SLAG },
    // The plug. Pounding it fires `cinder-vault` and drops the secret crest.
    { kind: 'breakable', p: [19.0, 23.7, -20], s: [2.6, 2.2, 3.2], mat: 'obsidian', tint: SLAG, drop: 'crest', trigger: 'cinder-vault' },
    // The tube hangs 16.6 m over the flank; these are what it hangs on.
    { kind: 'deco', kindOf: 'buttress', p: [18.5, 18.0, -20], s: [1.2, 8.0, 5.0], mat: 'obsidian', tint: BASALT },
    { kind: 'deco', kindOf: 'lavaRock', p: [19.5, 13.0, -20], s: [2.4, 2.0, 2.4], mat: 'obsidian', tint: SLAG, count: 4, spread: 6.0, jitter: 0.5 },
    { kind: 'light', p: [17.5, 24.4, -20], color: EMBER, intensity: 6, distance: 14 },

    /* ========================================================================
     * BEAT 8 — THE UPPER SPIRAL AND THE CHIMNEY
     * Seven ledges at r 8.5 about (0, -20), alternating solid basalt and
     * `vanish` slag, 1.60 m apart in height and 2.10 - 2.60 m apart edge to
     * edge: the same rhythm as BEAT 5, with the floor now optional. Every
     * vanish ledge runs the SAME cycle (on 3.4 / off 1.7 / warn 0.8) at a
     * different phase, so the spiral is a wave you climb the crest of.
     *
     * THE CHIMNEY is the optional fast line off the mid deck: a 2.80 m slot
     * between the west wall's inner face (x = -12) and a slag fin (x = -9.2),
     * climbing 22.20 -> 30.70 = 8.50 m, which is one jump (apex 1.91) plus four
     * kicks at +2.0 inside the contract's 3.4 m shaft limit. Sigil 7 is at the
     * top of it and it rejoins the spiral at U6 (0.80 m gap, +1.00 m).
     * ===================================================================== */

    { kind: 'platform', p: [9.0, 23.4, -20.0], s: [4, 0.6, 4], mat: 'obsidian', tint: BASALT_HI, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [6.5, 25.05, -26.0], s: [3.8, 0.5, 3.8], mode: 'cycle', cycle: { on: 3.4, off: 1.7, warn: 0.8, phase: 0 }, mat: 'obsidian', tint: SLAG, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [0, 26.6, -28.5], s: [4, 0.6, 4], mat: 'obsidian', tint: BASALT_HI, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [-6.5, 28.25, -26.0], s: [3.8, 0.5, 3.8], mode: 'cycle', cycle: { on: 3.4, off: 1.7, warn: 0.8, phase: 1.7 }, mat: 'obsidian', tint: SLAG, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-9.0, 29.8, -20.0], s: [4, 0.6, 4], mat: 'obsidian', tint: BASALT_HI, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [-6.5, 31.45, -14.0], s: [3.8, 0.5, 3.8], mode: 'cycle', cycle: { on: 3.4, off: 1.7, warn: 0.8, phase: 3.4 }, mat: 'obsidian', tint: SLAG, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [0, 33.0, -11.5], s: [4, 0.6, 4], mat: 'obsidian', tint: BASALT_HI, stripe: true, edge: SAFE_EDGE },
    // THE EXIT LEDGE, top 34.90, sitting under the deck's 10 x 10 m mouth with
    // 1.00 m of clearance all round: 1.00 m across and 1.10 m up onto the deck.
    { kind: 'platform', p: [0, 34.6, -20], s: [8, 0.6, 8], mat: 'panel', tint: IRON, stripe: true, edge: SAFE_EDGE },

    // THE CHIMNEY: foot, fin, head.
    { kind: 'platform', p: [-10.5, 21.9, -12.0], s: [2.6, 0.6, 4.0], mat: 'obsidian', tint: BASALT_HI, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-8.8, 26.5, -12.0], s: [0.8, 13.0, 4.4], mat: 'obsidian', tint: SLAG },
    { kind: 'platform', p: [-10.5, 30.4, -12.0], s: [2.6, 0.6, 4.0], mat: 'obsidian', tint: BASALT_HI, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [-11.6, 24.0, -12.0], rot: [0, 1.5708, 0], text: 'KICK ONE WALL, THEN THE OTHER', size: 0.20, color: 0xffb060 },
    { kind: 'text', p: [6.6, 26.6, -25.9], rot: [0, -0.9, 0], text: 'THEY GO WHEN THEY GLOW', size: 0.20, color: 0xffb060 },

    /* ========================================================================
     * BEAT 9 — THE CALDERA  (cp6)
     * Four slabs make a square annulus at 34.4 .. 36.0 with a 10 x 10 m mouth
     * over the shaft; they touch at z = -25 and z = -15, so the deck is one
     * connected ring. The north slab is the Warden's floor (arena r 6.0 about
     * (0, -31), which sits inside z -37..-25 with a metre to spare), the lip
     * block on its north edge is 1.60 m up — a plain step — and the crest sits
     * 1.20 m over the lip where you can see it from the plaza.
     * ===================================================================== */

    { kind: 'platform', p: [0, 35.2, -31.5], s: [30, 1.6, 13], mat: 'obsidian', tint: BASALT_HI, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [0, 35.2, -10], s: [30, 1.6, 10], mat: 'obsidian', tint: BASALT_HI, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-10, 35.2, -20], s: [10, 1.6, 10], mat: 'obsidian', tint: BASALT_HI, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [10, 35.2, -20], s: [10, 1.6, 10], mat: 'obsidian', tint: BASALT_HI, stripe: true, edge: SAFE_EDGE },

    // The lip, and the two crags that frame it.
    { kind: 'platform', p: [0, 36.6, -37], s: [16, 2.0, 2.0], mat: 'obsidian', tint: BASALT, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-11, 36.4, -36.5], s: [5, 1.6, 3], mat: 'obsidian', tint: BASALT },
    { kind: 'platform', p: [11, 36.4, -36.5], s: [5, 1.6, 3], mat: 'obsidian', tint: BASALT },
    // The east crag: sigil 8, hanging over 30 m of nothing.
    { kind: 'platform', p: [17.0, 36.6, -20], s: [4, 1.2, 6], mat: 'obsidian', tint: BASALT, stripe: true, edge: SAFE_EDGE },

    { kind: 'text', p: [0, DECK_TOP + 1.9, -26.6], rot: [0, Math.PI, 0], text: 'JUMP THE WAVE  ·  DODGE THE CHARGE  ·  POUND ITS BACK', size: 0.22, color: 0xffb060 },
    { kind: 'deco', kindOf: 'monolith', p: [-13.0, DECK_TOP + 1.7, -34.0], s: [1.2, 3.4, 1.0], mat: 'obsidian', tint: BASALT },
    { kind: 'deco', kindOf: 'monolith', p: [13.0, DECK_TOP + 1.5, -34.0], s: [1.1, 3.0, 0.9], mat: 'obsidian', tint: BASALT },
    { kind: 'deco', kindOf: 'brazier', p: [-6.0, DECK_TOP + 1.1, -26.0], s: [0.8, 1.8, 0.8], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'brazier', p: [6.0, DECK_TOP + 1.1, -26.0], s: [0.8, 1.8, 0.8], mat: 'metal', tint: EMBER },
    { kind: 'light', p: [0, LIP_TOP + 2.6, -37], color: GOLD, intensity: 10, distance: 22 },
    { kind: 'light', p: [0, DECK_TOP + 4.0, -30], color: 0xffd9a0, intensity: 7, distance: 26 },

    /* ========================================================================
     * ROUTE A — THE GANTRY STAIR
     * Three flights and two landings up the OUTSIDE of the west wall, court
     * 6.00 -> deck 36.00, every metre of it at x -19.5 .. -15.5 and therefore
     * outside the chase's kill box (x <= -15). It is the reason this course can
     * never seal itself, and it is deliberately the slowest way up.
     *   F1  n 45, rise 0.30, run 0.40, ascending -Z:  6.00 -> 19.20 over 18.0 m
     *   L1  landing 19.20
     *   F2  n 44, rise 0.30, run 0.40, ascending +Z: 19.20 -> 32.40 over 17.6 m
     *   L2  landing 32.40
     *   F3  n 12, rise 0.30, run 0.40, ascending +Z: 32.40 -> 36.00, then
     *       0.50 m across onto the deck's south slab.
     * buildStairs raises a solid block from `p.y` to each tread, so every flight
     * is its own buttress against the drum: this reads as a gantry, not as a
     * staircase floating in the air. (buildStairs reads `rot`, not `yaw`, so
     * the yaw is written as an Euler here — reachcheck accepts either.)
     * ===================================================================== */

    { kind: 'stairs', p: [-17.5, 5.7, -19], rot: [0, Math.PI, 0], w: 4.0, rise: 0.30, run: 0.40, n: 45, mat: 'metal', tint: IRON, surface: 'metal' },
    { kind: 'platform', p: [-17.5, 18.9, -30.5], s: [5, 0.6, 5], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'stairs', p: [-17.5, 19.2, -21.5], rot: [0, 0, 0], w: 4.0, rise: 0.30, run: 0.40, n: 44, mat: 'metal', tint: IRON, surface: 'metal' },
    { kind: 'platform', p: [-17.5, 32.1, -9.5], s: [5, 0.6, 5], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'stairs', p: [-17.5, 32.4, -6.0], rot: [0, 0, 0], w: 4.0, rise: 0.30, run: 0.40, n: 12, mat: 'metal', tint: IRON, surface: 'metal' },
    { kind: 'text', p: [-16.4, COURT_Y + 1.6, -9.0], rot: [0, -1.5708, 0], text: 'THE LONG WAY IS THE DRY WAY', size: 0.22, color: 0xc79a72 },
    { kind: 'deco', kindOf: 'rail', p: [-19.6, 12.0, -20], s: [0.1, 1.0, 6.0], mat: 'metal', tint: IRON, count: 5, spread: 16.0, jitter: 0.0 },

    /* ========================================================================
     * BEAT 10 — THE RACE AND THE RINGS  (two overlays on the whole map)
     * The race is the chase written down: plaza pad -> caldera deck in 70 s,
     * 4.4 s less than the front takes to stop at 32.0. It is exactly the route
     * the ash paths already draw, which is why the paths exist.
     * The rings spiral DOWN the outside of the mountain from the deck to the
     * plaza — the only time the course lets you look at the drum from outside
     * and above, and the reason the drum has a silhouette worth building.
     * ===================================================================== */

    { kind: 'platform', p: [5, 1.5, 40], s: [3.6, 0.2, 3.6], mat: 'panel', tint: 0xd8b078 },
    { kind: 'platform', p: [0, 35.9, -10], s: [3.6, 0.2, 3.6], mat: 'panel', tint: 0xd8b078 },
    { kind: 'text', p: [5, 2.6, 40], rot: [0, 0, 0], text: 'CINDER CHASE  ·  70s', size: 0.26, color: 0xffb060 },

    {
      kind: 'rings', id: 'cinder-rings', r: 2.6, tint: GOLD, mat: 'gold',
      pts: Array.from({ length: 12 }, (_, i) => {
        const a = -1.5708 + i * (Math.PI * 2 / 12) * 1.6;   // 1.6 turns over twelve rings
        const rad = 19 + i * 2.1;                           // spiralling OUT as it drops
        return [r2(Math.cos(a) * rad), r2(37 - i * 2.4), r2(-20 - Math.sin(a) * rad)];
      }),
    },

    /* ========================================================================
     * DRESSING — slag boulders, foundry wreckage, vents, standing stones.
     * Every scatter is seeded by `ihash`, so the plain dresses itself
     * identically on every load and `reset()` never moves a boulder (hard rule
     * 3), and every one is filtered through the same KEEPOUT list, so nothing
     * can land in the drum, on the gantry, in a pool or on a pad. Six kinds
     * only, each repeated with per-def `count`/`spread` so props.js instances
     * them: asking for more spends the SAME triangle budget across more,
     * smaller instances rather than adding draw calls, and course.js thins
     * every bucket uniformly to fit its decor budget.
     * ===================================================================== */

    ...scatter(0, 30, 14, 44, 9, 41001, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'lavaRock', p: on(x, z, -0.15),
        s: [1.2 + rnd * 1.5, 0.9 + rnd * 1.0, 1.2 + rnd * 1.5], mat: 'obsidian',
        tint: SLAG, count: 4, spread: 5.5, jitter: 0.42 }
    )),
    ...scatter(-20, -6, 12, 40, 8, 41002, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'lavaRock', p: on(x, z, -0.15),
        s: [1.0 + rnd * 1.4, 0.8 + rnd * 0.9, 1.0 + rnd * 1.4], mat: 'obsidian',
        tint: 0x3a353f, count: 4, spread: 5.0, jitter: 0.42 }
    )),
    ...scatter(24, -14, 12, 38, 7, 41003, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'debris', p: on(x, z, 0.1),
        s: [0.9 + rnd, 0.6 + rnd * 0.5, 0.9 + rnd], mat: 'metal',
        tint: 0x554b45, count: 4, spread: 5.5, jitter: 0.45 }
    )),
    ...scatter(-6, 16, 16, 48, 7, 41004, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'lavavent', p: on(x, z, 0.08),
        s: [0.9 + rnd * 0.7, 0.45, 0.9 + rnd * 0.7], mat: 'obsidian',
        tint: EMBER, count: 5, spread: 6.5, jitter: 0.45 }
    )),
    ...scatter(10, -36, 10, 30, 6, 41005, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'pipe', p: on(x, z, 0.85),
        s: [0.5 + rnd * 0.3, 1.6 + rnd * 0.9, 0.5 + rnd * 0.3], mat: 'metal',
        tint: IRON, count: 3, spread: 5.0, jitter: 0.35 }
    )),
    ...scatter(-40, -30, 8, 26, 6, 41006, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'monolith', p: on(x, z, 0.9),
        s: [0.9 + rnd * 0.5, 2.2 + rnd * 1.4, 0.8 + rnd * 0.4], mat: 'obsidian',
        tint: BASALT, count: 2, spread: 6.0, jitter: 0.4 }
    )),

    // A guard rail along the top of the east pool's bank, so the one place the
    // ground will slide you into lava says so before it does it.
    { kind: 'fence', a: on(24, 19, 0), b: on(30, 18, 0), mat: 'metal', tint: IRON },
    { kind: 'fence', a: on(30, 18, 0), b: on(36, 19, 0), mat: 'metal', tint: IRON },
    { kind: 'fence', a: on(36, 19, 0), b: on(41, 23, 0), mat: 'metal', tint: IRON },
  ],

  /* ------------------------------------------------------------------------
   * CRITTERS
   * --------------------------------------------------------------------- */
  critters: [
    // BUMBLERS on the rim. Side contact is knockback, not death (contract §23),
    // which on a plain with two lava pools is still a real threat.
    { kind: 'bumbler', path: [on(-10, 30), on(4, 27), on(0, 34), on(-10, 30)], speed: 1.5, tint: 0x6b3a22 },
    { kind: 'bumbler', path: [on(14, 22), on(24, 16), on(30, 10), on(24, 16), on(14, 22)], speed: 1.6, tint: 0x6b3a22 },
    { kind: 'bumbler', path: [on(-12, -2), on(-4, -4), on(4, -4), on(-4, -4), on(-12, -2)], speed: 1.7, tint: 0x6b3a22 },
    // SKITTERS. One over the east pool, two inside the shaft where a swoop can
    // take you off a plate or a vanish ledge.
    { kind: 'skitter', p: [32, 5.0, 24], path: [[26, 5.4, 20], [38, 6.6, 34]], amp: 1.8, speed: 3.4, color: 0x8a3a24 },
    { kind: 'skitter', p: [-6, 18.0, -16], path: [[-8, 17.0, -12], [8, 20.0, -28]], amp: 2.0, speed: 3.8, color: 0x8a3a24 },
    { kind: 'skitter', p: [6, 28.0, -26], path: [[8, 27.0, -28], [-8, 30.5, -14]], amp: 2.2, speed: 4.0, color: 0x8a3a24 },
    // THE WARDEN, on the caldera's north slab. Its charge needs a wall to break
    // itself on; the lip block and the two crags along the north edge are it.
    { kind: 'warden', p: [0, DECK_TOP, -31], arena: { c: [0, -31], r: 6.0 }, hp: 3, tint: 0x7a4030 },
  ],
};
