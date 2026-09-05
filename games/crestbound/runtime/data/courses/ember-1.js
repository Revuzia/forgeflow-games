/**
 * CRESTBOUND — EMBER FOUNDRY 1 : "MAGMA WORKS"
 * runtime/data/courses/ember-1.js                                   CONTRACT §25
 * ===========================================================================
 *
 * The fourth course, and the first one that can kill you for standing still.
 * An OPEN DIORAMA about 130 x 120 m across a foundry cavern: an obsidian
 * SHORE in the south, a LAVA LAKE filling the middle and the north, iron
 * CATWALKS on piles over it, a field of sinking SLAG RAFTS, a SMELTER on the
 * east bank, a WARDEN's slag pit in the west, and the CRUCIBLE — a square iron
 * vessel with two long flights wound round it and a crane over its mouth.
 *
 * Difficulty 4 (COURSES.md ramp). Verdant taught the moveset on ground that
 * forgave you; this course keeps the same reach envelope and takes the ground
 * away. Nothing here demands a new verb. It demands TIMING: a vent cycle, a
 * raft that sinks under you, a crusher's beat, and a crucible that pours.
 *
 *   BEAT 1  THE SHORE        obsidian yard, the lake, the first vent cycle
 *   BEAT 2  THE CATWALK      a grate spine over the lake with three flame vents
 *   BEAT 3  THE RAFT FIELD   nine sinking slag rafts across the open lake
 *   BEAT 4  THE SMELTER      a belt that runs against you under a crusher
 *   BEAT 5  THE EAST GANTRY  the other way in — fifty metres and two pulse beams
 *   BEAT 6  THE CRUCIBLE     base yard, the wall-kick flue, the long east flight
 *   BEAT 7  THE POUR         the set piece: a lava curtain every 30 s
 *   BEAT 8  THE CROWN        the west flight, the crane gantry, the open crest
 *   BEAT 9  THE SLAG PIT     the Warden, over a chain bridge, ringed by lava
 *   BEAT 10 SECRETS          the cool cave, the iron hat, the race
 *
 * ---------------------------------------------------------------------------
 * ROUTES TO THE OPEN CREST  (the hook on the crane gantry, y 26.60)
 * ---------------------------------------------------------------------------
 *   A  THE RAFTS      shore -> quay -> flame catwalk -> junction -> nine slag
 *                     rafts -> smelter landing -> smelter deck -> the crossing
 *                     catwalk -> crucible base yard -> EAST FLIGHT -> the
 *                     level-3 walk (under the pour) -> WEST FLIGHT -> the crane
 *                     gantry. The taught line, and the only one that crosses
 *                     the lake at lake level.
 *   B  THE EAST GANTRY  shore -> east quay -> fifty metres of gantry at deck
 *                     height under two pulse beams -> smelter deck (joins A
 *                     there). Longer, drier, no sinking — the coward's road,
 *                     and the only one that reaches the smelter without rafts.
 *   C  THE FLUE       crucible base yard -> the wall-kick flue against the
 *                     vessel's west face (3.00 m clear, 9.00 m of climb: one
 *                     jump plus four kicks at +2.00 m) -> the flue ledge at
 *                     15.40, which steps straight down on to the level-3 walk.
 *                     Skips the whole east flight, and it is the fast line in
 *                     the race.
 * All three are STATIC geometry end to end. The bucket orbit (BEAT 8) and the
 * rafts' own sinking are the only moving things any route touches, and NOTHING
 * required is reachable only by riding something.
 *
 * ---------------------------------------------------------------------------
 * THE TERRAIN SAMPLER — a transliteration of world/terrain.js `sampleHeights`
 * ---------------------------------------------------------------------------
 * IMPROVEMENT ON verdant-1.js, and deliberate. That file carries its own
 * APPROXIMATE sampler (smoothstep falloff, single-octave value noise, the FULL
 * ridge width, a per-flat `core`). `_harness/reachcheck.mjs` does not use it:
 * it imports runtime/world/terrain.js and reports
 * `terrain sampler: terrain.js:sampleHeights`, so the numbers a course author
 * writes down and the numbers the gate measures can differ. The sampler below
 * is terrain.js's recipe branch, function for function:
 *
 *   1. h = base
 *   2. HILLS   k = bump(d / r);  h += hill.h * (k*k*(3 - 2k))   (`sharp` -> k)
 *   3. RIDGES  h += ridge.h * bump(d_segment / (ridge.w * 0.5))  <- HALF WIDTH
 *   4. NOISE   h += noise.amp * fbm(x*freq, z*freq, seed, 4)     (gain 0.5,
 *              lacunarity 2.03, normalised, quintic `fade` interpolant)
 *   5. FLATS   t = d / r;  k = t <= 0.55 ? 1 : bump((t - 0.55) / 0.45)
 *              h += (flat.h - h) * k        (a later flat wins where they meet)
 *
 *   bump(t) = 0.5 * (1 + cos(PI * t)) on 0..1, 1 below, 0 above — C1 at both
 *   ends, so no hill here has a crease and every flat's core is dead level.
 *   `core` is NOT a terrain.js key: a flat's core is always 55 %. This file
 *   never writes one.
 *
 * The terrain FOOTPRINT is the southern shore only — origin [-70, 16], size
 * [140, 54], i.e. z 16 .. 70. There is deliberately NO heightfield under the
 * lake: a heightfield under lava is ground the collider and the reach gate
 * would both happily walk the player across. North of z = 16 the floor is lava
 * and authored iron, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * THE REACH BUDGET ACTUALLY USED (safe limits from core/tuning.js REACH_TABLE:
 * single 4.52 flat / 3.88 at +1.0 / 3.28 at +1.6; double 5.24 (4 m run-up);
 * triple 6.11 and long jump 6.42 (6 m run-up); backflip +2.87 from rest)
 * ---------------------------------------------------------------------------
 *   longest REQUIRED gap      1.90 m at  0.00 m   BEAT 3, raft R4 -> R5
 *   longest REQUIRED rising   1.30 m at +0.75 m   BEAT 3, raft R9 -> landing
 *     gap, and the tallest required step in the course
 *   every other required climb is a STAIR FLIGHT (the landing stair, the east
 *     flight, the west flight) — no required jump in this course is bigger
 *     than a single from a standstill, because the difficulty is the CLOCK.
 *   flue (ROUTE C)            3.00 m clear, 9.00 m of climb: 1 jump + 4 kicks
 *                             at +2.00 m each (limits: 3.40 m wide, 5 kicks)
 *   longest OPTIONAL gap      3.55 m at +4.85 m   the smelter jump pad, whose
 *                             6.50 m apex carries 6.50 m of ground
 *   riskiest OPTIONAL line    the rim of the crucible (a one-way drop off the
 *                             gantry, with the level-3 walk to step down to)
 *                             and the bucket orbit at 23.20 over open lava
 * Nothing here REQUIRES a long jump, a triple or a dive.
 *
 * ---------------------------------------------------------------------------
 * ROUTE DEPTH — why the ascent is two long flights and not a four-corner spiral
 * ---------------------------------------------------------------------------
 * `_harness/reachcheck.mjs` floods the surface graph for at most 12 passes and
 * each pass advances exactly ONE edge, so anything more than twelve edges from
 * the spawn reads as UNREACHABLE however legal it is. A four-flight spiral with
 * a catwalk leg between each pair of flights costs sixteen. Measured chain to
 * the crest, as the gate walks it:
 *     terrain 0 -> gantry 1 -> smelter deck 2 -> crossing 3 -> base yard 4
 *     -> east flight foot 5 -> head 6 -> level-3 walk 7 -> west flight foot 8
 *     -> head 9 -> crane gantry 10
 * Ten, with two passes of margin. The rim, the flue ledge, the bucket orbit
 * and the raft field all hang off that spine at depth 5..11.
 *
 * CONTENT LEDGER: 8 sigils · 7 crests · 113 coins · 5 checkpoints ·
 * hazard families: lava, flame, sinker, conveyor, crusher, rotor, mover,
 * breakable, jumppad, beam  + critters bumbler x3, skitter x2, warden.
 *
 * NOTES / DEVIATIONS from the COURSES.md brief are at the foot of this file.
 */

/* ===========================================================================
 * 0. Palette — EMBER FOUNDRY
 * ======================================================================== */

const OBSIDIAN = 0x3a3540;   // cold slag, and the shore
const IRON = 0x6b6f76;       // catwalk frames, piles, the vessel
const RUST = 0x9c5a30;       // weathered plate, the smelter
const BRASS = 0xc9913f;      // trim, valves, the crane
const MAGMA = 0xff6a1e;      // lava, vents, the pour
const CINDER = 0xff9c3c;     // torch and brazier flame
const GOLD = 0xffd257;       // coin / sigil / crest glow
const SAFE_EDGE = 0xffe9a8;  // leading-edge stripe
const COOL = 0x7fd8ff;       // the cool cave — the one blue thing in the works

/* ===========================================================================
 * 1. THE HEIGHTFIELD — the southern shore only. Every `p` in this file that
 *    touches the ground is justified against it.
 * ======================================================================== */

/** Heightfield definition. Consumed verbatim by world/terrain.js (contract §18). */
const HEIGHTS = {
  seed: 20260903,
  base: 4.4,
  hills: [
    // The cavern's walls: they close the diorama without being scenery you
    // could mistake for a route.
    { p: [0, 74], r: 34, h: 9.5 },      // south wall, behind the spawn
    { p: [-62, 32], r: 24, h: 8.5 },    // west wall
    { p: [62, 34], r: 24, h: 8.5 },     // east wall
    // Slag heaps: silhouette, and the only two swells on the shore.
    { p: [-40, 52], r: 24, h: 6.0 },
    { p: [46, 34], r: 20, h: 3.0 },     // the raised east ore bank (ROUTE B)
    { p: [-16, 40], r: 14, h: 1.8 },    // the swell the first coin arc crosses
  ],
  ridges: [
    // THE BEACH. A negative ridge is a channel: the shore falls from the yard
    // into the lake and vanishes under the lava at the footprint's north edge,
    // so the terrain never ends in a visible cliff.
    // NOTE the half-width rule — terrain.js divides `w` by 2, so this is a
    // 17 m falloff either side of the z = 13 line, not 34.
    { a: [-70, 13], b: [70, 13], w: 34, h: -6.4 },
  ],
  flats: [
    { p: [0, 30], r: 19, h: 3.0 },      // THE QUAY FRONT — level with the quay
    { p: [0, 45], r: 13, h: 4.6 },      // SPAWN YARD                      (cp1)
    { p: [40, 26], r: 11, h: 6.0 },     // EAST ORE BANK, deck height (ROUTE B)
    { p: [-34, 34], r: 9, h: 4.6 },     // the cool-cave apron         (secret)
  ],
  noise: { amp: 0.28, freq: 0.05 },
};

/* --- the sampler: world/terrain.js `sampleHeights`, transliterated --------- */

/** Integer hash in [0, 1). Math.imul only, so the 32-bit wrap is engine-identical. */
function ihash(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Quintic smoothstep — C2 continuous, so the noise band has no normal creases. */
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

/** Fractal value noise: gain 0.5, lacunarity 2.03, normalised. */
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

/** Distance from (px,pz) to the SEGMENT a..b (clamped at both ends). */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = ax + dx * t - px, cz = az + dz * t - pz;
  return Math.sqrt(cx * cx + cz * cz);
}

/**
 * Ground height at (x, z) on the SHORE. THE authority for every ground
 * placement in this file, and byte-for-byte the arithmetic world/terrain.js
 * `sampleHeights` performs on `HEIGHTS`.
 *
 * Outside the terrain footprint (z < 16) it still returns a number; the course
 * never uses it there, because there is no ground there — only lava.
 */
export function terrainHeightAt(x, z) {
  let y = HEIGHTS.base;

  for (let i = 0; i < HEIGHTS.hills.length; i++) {
    const H = HEIGHTS.hills[i];
    const r = H.r || 1;
    const dx = x - H.p[0], dz = z - H.p[1];
    const dd = Math.sqrt(dx * dx + dz * dz);
    if (dd < r) {
      const k = bump(dd / r);
      y += (H.h || 0) * (H.sharp ? k : k * k * (3 - 2 * k));
    }
  }

  for (let i = 0; i < HEIGHTS.ridges.length; i++) {
    const R = HEIGHTS.ridges[i];
    const w = (R.w || 1) * 0.5;
    const dd = segDist(x, z, R.a[0], R.a[1], R.b[0], R.b[1]);
    if (dd < w) y += (R.h || 0) * bump(dd / w);
  }

  const n = HEIGHTS.noise;
  if (n && n.amp) y += fbm(x * n.freq, z * n.freq, (HEIGHTS.seed | 0) || 1337, n.octaves || 4) * n.amp;

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
 * 2. Authoring helpers — every one resolves against the heightfield or a named
 *    platform top, so no placement in this file is a guess.
 * ======================================================================== */

const gy = terrainHeightAt;
const r2 = (v) => Math.round(v * 100) / 100;

/** A point ON the shore at (x, z), lifted `up` metres. */
function on(x, z, up) { return [r2(x), r2(gy(x, z) + (up || 0)), r2(z)]; }

/** Centre of a box of full height `sy` whose base sits on the shore, sunk `sink` m. */
function seat(x, z, sy, sink) { return [r2(x), r2(gy(x, z) - (sink || 0) + sy / 2), r2(z)]; }

/**
 * Coins along a jump ARC from a to b, peaking `h` above the chord. Expanded to
 * explicit {p} entries here rather than shipped as a def kind, so an arc can
 * never be silently dropped by a Collectibles build.
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
 * Coins that FOLLOW THE SHORE along a polyline of [x,z] waypoints, evenly
 * spaced by arc length, floating `up` metres. A straight {line} would bury half
 * a trail in a beach this lumpy; this cannot.
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
 * A coin RING, authored with a full [x, y, z] centre and NO separate `y`.
 *
 * This matters and it is the second correction to verdant-1's conventions.
 * entities/collectibles.js `readCentre` accepts a 2-element `c:[x,z]` plus a
 * `y`, and verdant-1 writes that form — but `_harness/reachcheck.mjs` expands
 * the same entry through `v3()`, which reads a 2-element array as [x, y, 0] and
 * puts the whole ring on the z = 0 line. Both readers agree on a 3-vector
 * centre with the `y` folded into it, so that is the form used everywhere
 * below and the gate measures the ring the game actually builds.
 */
function ringCoins(x, y, z, r, n) { return { ring: { c: [r2(x), r2(y), r2(z)], r, n } }; }

/**
 * KEEP-OUT VOLUMES for the seeded shore scatter. Rects are [x0, x1, z0, z1] in
 * world metres, already margined — a scattered prop's collider is its base
 * radius, not its point. verdant-1's round-4 bug (a scattered tree planted
 * inside its own wall-kick shaft, which made that course's ROUTE B
 * unperformable) is the reason this exists at all.
 */
const KEEPOUT = [
  [-16.0, 16.0, 16.0, 24.0],    // the quay head and the walk on to it
  [30.0, 50.0, 16.0, 30.0],     // the east ore bank and the gantry head (ROUTE B)
  [-42.0, -26.0, 27.0, 42.0],   // the cool cave and its apron            (secret)
  [-9.0, 9.0, 36.0, 52.0],      // the spawn yard: nothing in the first shot
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
 * Seeded by `ihash`, so the shore dresses itself identically on every load and
 * `reset()` never moves a rock (contract hard rule 3). Points inside a KEEPOUT
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
 * 3. Measured constants the beats below refer to BY NAME. Every one of these
 *    is a walkable TOP (p[1] + s[1]/2), never a centre.
 * ======================================================================== */

const LAVA_Y = 0.00;      // the lake surface. Pool floor -6.00 => 6.00 m deep.
const QUAY_TOP = 3.00;    // the obsidian quay, level with the shore flat behind it
const CAT_TOP = 3.00;     // the flame catwalk, its spur, and the junction deck
const RAFT_TOP = 2.85;    // every slag raft (p 2.60 + s.y 0.50 / 2)
const LAND_TOP = 3.60;    // the smelter landing at the end of the raft field
const DECK_TOP = 6.00;    // smelter deck, east gantry, crossing, base yard, pit
const BELT_TOP = 6.30;    // any conveyor deck (DECK_TOP + 0.30)
const FLUE_FLOOR = 6.40;  // the wall-kick flue's own floor pad
const WALK3 = 15.00;      // the level-3 walk: head of the east flight, and the
                          // deck the pour falls across
const FLUE_LEDGE = 15.40; // the flue's exit ledge, 0.40 m over the level-3 walk
const RIM = 21.60;        // the crucible's rim
const BUCKET_Y = 23.20;   // the bucket orbit's deck tops
const CROWN = 25.20;      // the crane gantry

// BEAT 3 — the raft field. Nine rafts, 3.40 m square, tops at RAFT_TOP. The
// centres below are spaced so the EDGE-TO-EDGE gap (which is what the reach
// gate measures, and what the player's feet cross) never exceeds 1.90 m —
// because the danger here is the CLOCK, not the distance: `delay 0.6` starts
// the raft down 0.6 s after your feet land, and `speed 1.9` has its deck under
// the lava about 1.5 s after that. A pound skips the delay entirely.
const RAFTS = [
  [4.4, -16.0],   // R1  gap 0.90 from the junction deck
  [8.8, -18.9],   // R2  gap 1.00
  [13.4, -21.5],  // R3  gap 1.20
  [17.2, -25.1],  // R4  gap 0.45
  [16.4, -30.4],  // R5  gap 1.90  <- the longest required gap in the course
  [20.4, -32.6],  // R6  gap 0.60
  [25.6, -32.8],  // R7  gap 1.80
  [27.6, -28.0],  // R8  gap 1.40
  [25.0, -23.4],  // R9  gap 1.20, then 1.30 at +0.75 on to the landing
];

// BEAT 6 — the flue (ROUTE C). Clear interior x -9.50 .. -6.50, z -35.50 ..
// -32.50: 3.00 m square, inside the contract's 3.40 m wall-kick limit. Floor
// FLUE_FLOOR, ledge FLUE_LEDGE => 9.00 m of climb = one jump (1.91 m apex)
// plus four kicks at +2.00 m. The west face carries the door (a 1.40 m gap
// between two piers, under a lintel at 8.20); the south face stops at 13.00,
// so the top 2.60 m of it is the window you come out through. The east face is
// 0.10 m off the crucible's own wall, which is why the door is not on it.
const FLUE_C = [-8.0, -34.0];

// BEAT 8 — the crucible. A square iron vessel, walls 1.60 m thick, standing on
// the base yard: outer x -6.00 .. 6.00, z -44.00 .. -32.00, rim RIM.
const VESSEL_C = [0, -38];

/* ===========================================================================
 * 4. THE COURSE
 * ======================================================================== */

export default {
  id: 'ember-1',
  realm: 'ember',
  theme: 'ember',
  name: 'MAGMA WORKS',
  subtitle: 'A lake of fire with iron laid over it',
  order: 4,
  difficulty: 4,
  music: 'ember',

  /* Par times per crest id (ms) — the HUD shows them, nothing gates on them. */
  par: {
    open: 130000, sigils: 300000, coins: 330000,
    secret: 150000, boss: 180000, race: 60000, metal: 150000,
  },

  /* Spawn on the yard flat (EXACTLY 4.60), yaw 0 => facing -Z: the quay, the
     catwalk, the raft field, the crucible and the crane are one straight read
     from here, with the smelter's stacks on the right and the Warden's pit
     glowing away on the left. */
  spawn: { p: [0, 4.6, 45], yaw: 0 },
  killY: -12,
  bounds: { min: [-72, -16, -58], max: [72, 40, 72] },

  intro: {
    text: 'The works still run, and nobody is running them. Iron over fire, all the way to the crane — and the crucible pours on its own clock.',
    cam: [
      { p: [0, 30, 64], look: [0, 10, -20], t: 0 },
      { p: [30, 16, 4], look: [0, 14, -38], t: 2.8 },
      { p: [2, 8, 54], look: [0, 5, 20], t: 5.6 },
    ],
  },

  ambience: { wind: 0.20, fire: 0.65, machinery: 0.45 },

  /* ------------------------------------------------------------------------
   * TERRAIN — THE SHORE ONLY (z 16 .. 70).
   * --------------------------------------------------------------------- */

  terrain: {
    kind: 'terrain',
    origin: [-70, 16],
    size: [140, 54],
    res: 1.0,
    surface: 'sand',            // scorched grit; materials.js blends to dirt on slope
    heights: HEIGHTS,
    // No grass in a foundry. `count: 0` keeps terrain.js from building the
    // blade InstancedMesh at all — one draw call and ~8k triangles saved
    // against verdant-1's footprint, spent on the ironwork instead.
    grass: { count: 0, density: 0, height: 0, cross: false, color: 0x4a4048 },
    // Swept cart tracks. These carve the surface look only (a path never
    // changes height, or it would break every authored jump), and they are the
    // lines the coins take.
    paths: [
      { pts: [[0, 46], [0, 22]], w: 3.6 },                 // yard -> quay
      { pts: [[6, 40], [24, 34], [38, 28]], w: 3.0 },      // yard -> east ore bank
      { pts: [[-6, 38], [-22, 36], [-33, 36]], w: 2.4 },   // yard -> cave apron
    ],
  },

  /* ------------------------------------------------------------------------
   * CHECKPOINTS — 5, every one BEFORE its spike and never after, and every one
   * on a dead-level surface: cp1 on the spawn flat (EXACTLY 4.60), the other
   * four on authored decks, which are flat by construction. Each sits at least
   * 2 m clear of anything the hero would stand inside.
   *
   * `clockOffset` is the course-clock phase every respawn here rewinds to, and
   * it is what makes a timed hazard FAIR on the retry: you come back at the
   * top of a safe window instead of wherever the clock happened to be when you
   * died.
   * --------------------------------------------------------------------- */
  checkpoints: [
    // The yard. Nothing is trying to kill you yet; this pad is here so the
    // walk back from a shore death is four seconds, not forty.
    { id: 'cp-yard', p: [0, 4.6, 41], yaw: 0, clockOffset: 0 },
    // The quay head, BEFORE the flame catwalk. The vents run on 1.4 / 2.6
    // (period 4.0); offset 2.0 puts every retry at the top of an off window.
    { id: 'cp-quay', p: [0, QUAY_TOP, 15], yaw: 0, clockOffset: 2.0 },
    // The junction deck, BEFORE the raft field.
    { id: 'cp-junction', p: [0, CAT_TOP, -7.5], yaw: 0, clockOffset: 2.0 },
    // The smelter deck, BEFORE the belt and the crusher (period 4.2).
    { id: 'cp-smelter', p: [31, DECK_TOP, -34], yaw: -1.57, clockOffset: 1.2 },
    // The crucible base yard, BEFORE the flue, the flights and the pour. The
    // pour runs on 30 s (on 6 / off 24, warn 3); offset 9.0 lands every retry
    // three seconds after a pour ends, with 21 s of clear air to climb in.
    { id: 'cp-crucible', p: [-12, DECK_TOP, -30], yaw: -1.2, clockOffset: 9.0 },
  ],

  /* ------------------------------------------------------------------------
   * CRESTS — 7, one of each type in the contract.
   * --------------------------------------------------------------------- */
  crests: [
    {
      id: 'open', type: 'open', name: 'CREST ON THE CRANE HOOK',
      hint: 'The gantry over the crucible. Rafts, gantry or the flue — pick one.',
      p: [-4.0, CROWN + 1.4, -40.6],           // 1.40 m over the crane gantry
    },
    {
      id: 'sigils', type: 'sigils', name: 'EIGHT SIGILS OF THE WORKS',
      hint: 'Catwalk spur, raft spur, belt, flue ledge, crane, pit, roof, gantry.',
      spawnAt: [-6.0, QUAY_TOP + 1.45, 16.0],  // the quay pedestal
    },
    {
      id: 'coins', type: 'coins', name: 'A HUNDRED COINS', threshold: 100,
      hint: '113 are lying about the works. You can miss thirteen.',
      spawnAt: [-6.0, 6.05, 41.0],             // the yard pedestal, flat 4.60
    },
    {
      id: 'secret', type: 'secret', name: 'WHAT THE SLAG CRUST HIDES',
      trigger: 'slag-crust',
      hint: 'One face of the west scree is too flat to be scree. Pound it.',
      spawnAt: [-34.0, 5.9, 34.0],             // inside the cool cave, floor 4.60
    },
    {
      id: 'boss', type: 'boss', name: 'THE WARDEN OF THE SLAG PIT',
      hint: 'Jump the shockwave, dodge the charge, pound its back.',
      spawnAt: [-32.0, 7.6, -34.0],            // the pit floor, top 6.00
    },
    {
      id: 'race', type: 'race', name: 'THE POUR RUN',
      hint: 'Quay to the crane hook in sixty seconds. The flue is the fast way.',
      start: [0, QUAY_TOP, 18.0], finish: [1.5, CROWN, -40.6], limitMs: 60000,
      spawnAt: [1.5, CROWN + 1.4, -40.6],
    },
    {
      id: 'metal', type: 'power', name: 'THE IRON HAT', power: 'metal',
      hint: 'Twenty seconds of walking on fire. The island is the only reason.',
      p: [-26.0, 1.9, -14.0],                  // the islet, top 0.55
    },
  ],

  /* ------------------------------------------------------------------------
   * SIGILS — 8, every one on an OPTIONAL line you had to choose to take.
   * Each is verified against the surface it belongs to.
   * --------------------------------------------------------------------- */
  sigils: [
    { p: [-5.0, CAT_TOP + 1.30, 4.0], note: '1 — the catwalk spur, hung out over the lava beside vent 2 (spur top 3.00)' },
    { p: [13.0, RAFT_TOP + 1.30, -25.6], note: '2 — the spur raft, one hop off the main line, and it sinks too (raft top 2.85)' },
    { p: [32.0, BELT_TOP + 1.30, -31.5], note: '3 — mid-belt under the crusher, on a belt running against you (belt top 6.30)' },
    { p: [-9.5, FLUE_LEDGE + 1.20, -30.6], note: '4 — the flue ledge: the first thing you see after four clean kicks (ledge 15.40)' },
    { p: [-8.0, CROWN + 1.40, -40.6], note: '5 — the crane gantry, out at the winch end (gantry top 25.20)' },
    { p: [-38.0, DECK_TOP + 1.40, -40.0], note: '6 — the far corner of the slag pit, inside the Warden charge lane (pit top 6.00)' },
    { p: [41.0, 12.50, -37.0], note: '7 — the smelter house roof, reached only by the jump pad (roof deck 11.15)' },
    { p: [44.5, DECK_TOP + 1.40, -3.0], note: '8 — the gantry pylon spur, past the second pulse beam (spur top 6.00)' },
  ],

  /* ------------------------------------------------------------------------
   * COINS — 113 placed, 100 needed. Every group rewards a line the player
   * chose. Only the trail out of the yard is unmissable, because the first
   * twenty seconds of a course teach with breadcrumbs, not with signs.
   * --------------------------------------------------------------------- */
  coins: [
    // BEAT 1 — the swept track out of the yard to the quay. (8)
    ...trailCoins([[0, 45], [-1, 38], [1, 30], [0, 23]], 8, 1.1),
    // BEAT 1 — an arc over the shore swell: the first thing that asks for a jump. (5)
    ...arcCoins(on(-19, 40, 1.0), on(-13, 40, 1.0), 1.6, 5),
    // BEAT 2 — down the flame catwalk, between the vents. (6)
    { line: { a: [0, CAT_TOP + 1.2, 9.0], b: [0, CAT_TOP + 1.2, -5.0], n: 6 } },
    // BEAT 2 — a ring on the junction deck: the last easy money before the lake. (8)
    ringCoins(0, CAT_TOP + 1.1, -9, 3.4, 8),
    // BEAT 3 — one over every raft, so the line reads from the junction. (9)
    ...RAFTS.map(([x, z]) => ({ p: [x, r2(RAFT_TOP + 1.15), z] })),
    // BEAT 3 — arcs across the two widest raft gaps. (5 + 5)
    ...arcCoins([17.2, RAFT_TOP + 1.0, -25.1], [16.4, RAFT_TOP + 1.0, -30.4], 1.3, 5),
    ...arcCoins([20.4, RAFT_TOP + 1.0, -32.6], [25.6, RAFT_TOP + 1.0, -32.8], 1.3, 5),
    // BEAT 4 — a ring on the smelter deck beside the belt. (8)
    ringCoins(32, DECK_TOP + 1.4, -31.5, 3.0, 8),
    // BEAT 5 — the gantry run, straight through both pulse beams. (6)
    { line: { a: [40, DECK_TOP + 1.2, 13.0], b: [40, DECK_TOP + 1.2, -9.0], n: 6 } },
    // BEAT 6 — a ring in the base yard's north-west corner. (8)
    ringCoins(-12.5, DECK_TOP + 1.1, -42, 2.5, 8),
    // BEAT 6 — along the crossing catwalk, under the first chain. (5)
    { line: { a: [11, DECK_TOP + 1.1, -37], b: [26, DECK_TOP + 1.1, -37], n: 5 } },
    // BEAT 6 — across the north of the base yard, behind the crucible. (5)
    { line: { a: [-12, DECK_TOP + 1.1, -44], b: [6, DECK_TOP + 1.1, -44], n: 5 } },
    // BEAT 7 — the level-3 walk, straight through where the pour lands. Between
    // pours this is the easiest money in the course, which is the joke. (5)
    { line: { a: [-10, WALK3 + 1.1, -30.4], b: [10, WALK3 + 1.1, -30.4], n: 5 } },
    // BEAT 8 — the rim walk, both long sides, for anyone who drops off the
    // gantry on purpose. (4 + 4)
    { line: { a: [-5.2, RIM + 1.1, -42.5], b: [-5.2, RIM + 1.1, -33.5], n: 4 } },
    { line: { a: [5.2, RIM + 1.1, -42.5], b: [5.2, RIM + 1.1, -33.5], n: 4 } },
    // BEAT 8 — an arc along the bucket orbit: the only coins in the course with
    // nothing at all underneath them. (5)
    ...arcCoins([-9.6, BUCKET_Y + 1.2, -38.0], [0, BUCKET_Y + 1.2, -28.4], 1.2, 5),
    // BEAT 9 — over the chain bridge into the pit. (4)
    ...arcCoins([-16.0, DECK_TOP + 1.0, -34.0], [-21.0, DECK_TOP + 1.0, -34.0], 1.1, 4),
    // BEAT 9 — a ring round the Warden, inside its charge lane. (5)
    ringCoins(-32, DECK_TOP + 1.1, -34, 5.0, 5),
    // BEAT 10 — the cool cave. (5)
    ringCoins(-34, 5.7, 34, 2.2, 5),
    // BEAT 10 — three on the islet, for the iron hat. Nothing else in the
    // course can reach these, and three is inside the reach gate's stranded-
    // coin tolerance ON PURPOSE: they are the point of the power. (3)
    { p: [-26.0, 1.55, -16.0] }, { p: [-27.6, 1.55, -14.0] }, { p: [-24.4, 1.55, -14.0] },
  ],

  /* ------------------------------------------------------------------------
   * POWERS — one iron hat, on the junction deck, in plain sight of the islet
   * it is for. Twenty seconds: about eight seconds of walking each way, with a
   * margin for changing your mind.
   * --------------------------------------------------------------------- */
  powers: [
    { kind: 'metal', p: [-4.0, CAT_TOP + 0.9, -9.0], duration: 20 },
  ],

  /* ------------------------------------------------------------------------
   * OBJECTS — the built world, beat by beat.
   * --------------------------------------------------------------------- */
  objects: [

    /* ========================================================================
     * THE LAKE ITSELF
     * One pool, 130 x 65 m, surface LAVA_Y = 0.00, floor -6.00. Everything
     * north of the shore stands in it. It is ONE hazard object and not forty:
     * a repeated hazard KIND batches, but a second pool would not have made
     * the lake any bigger and would have cost a draw call and a seam.
     * ===================================================================== */

    { kind: 'lava', p: [0, -3.0, -16.5], s: [130, 6.0, 65], color: MAGMA, bubble: 0.7 },

    /* ========================================================================
     * BEAT 1 — THE SHORE
     * Twenty seconds where the only thing that can hurt you is the lake, and
     * the lake is thirty metres away and lit like a warning. The yard is a
     * flat at EXACTLY 4.60, the track runs north, the coins go where the track
     * goes, and the whole course is legible from the first frame.
     * ===================================================================== */

    /* Data lane 2026-09-05 (S4): the game boots at checkpoints[0], 2-4 m
       AHEAD of `spawn`, so a board authored 3 m to the pad's right and level
       with it stood nearer the camera than the hero and filled 40 % of the
       first frame with its header running off the right edge. Every spawn
       board now stands ~3 m ahead of the pad and ~4.5 m to its right — over
       5 m from the hero, inside the frame, a third the size — and its post
       stands 0.45 m BEHIND the text plate instead of through it. */
    { kind: 'deco', kindOf: 'sign', p: on(4.4, 38.5, 1.15), s: [0.14, 1.7, 1.3], mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'post', p: on(4.4, 38.05, 0.65), s: [0.16, 1.3, 0.16], mat: 'metal', tint: IRON },
    { kind: 'text', p: [4.4, r2(gy(4.4, 38.5) + 1.95), 38.5], rot: [0, 0, 0], text: 'MAGMA WORKS', size: 0.60, color: 0xf6cfa0 },
    { kind: 'text', p: [4.4, r2(gy(4.4, 38.5) + 1.42), 38.5], rot: [0, 0, 0], text: 'THE VENTS FIRE ON A CYCLE  ·  WATCH ONE, THEN WALK', size: 0.22, color: 0xd8a878 },
    { kind: 'text', p: [4.4, r2(gy(4.4, 38.5) + 1.05), 38.5], rot: [0, 0, 0], text: 'EVERY DECK IS IRON  ·  EVERYTHING ELSE IS FIRE', size: 0.22, color: 0xd8a878 },

    // The pedestal the HUNDRED COINS crest rises from when you finally hit 100.
    { kind: 'pedestal', p: on(-6, 41, 0), mat: 'metal', tint: IRON, glow: GOLD },

    // The slag block the first jump is for: ground 6.37, top 7.67.
    { kind: 'platform', p: seat(-16, 40, 1.3), s: [2.8, 1.3, 2.6], mat: 'obsidian', tint: OBSIDIAN, stripe: true, edge: SAFE_EDGE },

    /* ========================================================================
     * BEAT 2 — THE QUAY AND THE FLAME CATWALK
     * The quay is one obsidian block bedded 2.00 m into the lava so no seam
     * shows; its top is EXACTLY QUAY_TOP, the same as the shore flat behind
     * it, so walking on to it is a walk. Then the catwalk: 4.00 m of grate on
     * piles, 3.00 m over the lake, with three FLAME vents cut into the deck on
     * a 4.0 s cycle at phases 0.00 / 1.35 / 2.70. `warn` is 0.7 s of glow
     * before every jet and a kill volume NEVER arms during a warn, so the
     * telegraph is always survivable — which is the whole lesson.
     * ===================================================================== */

    { kind: 'platform', p: [0, 0.5, 15], s: [28, 5.0, 10], mat: 'obsidian', tint: OBSIDIAN, stripe: true, edge: SAFE_EDGE },
    { kind: 'pedestal', p: [-6, QUAY_TOP, 16], mat: 'metal', tint: IRON, glow: GOLD },
    { kind: 'platform', p: [0, QUAY_TOP - 0.04, 18], s: [3.8, 0.2, 3.8], mat: 'panel', tint: BRASS },   // race start pad
    // Data lane 2026-09-05 (S4): on the axis at z 18 this plate sat between
    // the follow camera and cp-quay's pad (z 15) and hid Nim. Beside the
    // start pad instead.
    { kind: 'text', p: [3.4, QUAY_TOP + 1.3, 17.0], rot: [0, 0, 0], text: 'THE POUR RUN  ·  60s', size: 0.26, color: BRASS },

    // The catwalk spine, z -7 .. 11, 4.00 m wide.
    { kind: 'platform', p: [0, 2.85, 2], s: [4.0, 0.3, 18], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    // Its piles and rails, so it reads as built rather than floating. Props
    // build no colliders, so none of this is ever in the player's way.
    { kind: 'deco', kindOf: 'pipe', p: [1.7, 1.4, 8.0], s: [0.5, 3.2, 0.5], mat: 'metal', tint: IRON, count: 4, spread: 14, jitter: 0.2 },
    { kind: 'deco', kindOf: 'rail', p: [2.1, 3.5, 2.0], s: [0.12, 1.0, 17.0], mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'rail', p: [-2.1, 3.5, 2.0], s: [0.12, 1.0, 17.0], mat: 'metal', tint: IRON },

    // The three vents. The same KIND three times over — a repeated hazard kind
    // batches, so this costs one family and very little else.
    { kind: 'flame', p: [0, CAT_TOP + 0.05, 8.0], dir: [0, 1, 0], len: 5.0, radius: 0.9, color: MAGMA, cycle: { on: 1.4, off: 2.6, warn: 0.7, phase: 0.0 } },
    { kind: 'flame', p: [0, CAT_TOP + 0.05, 2.0], dir: [0, 1, 0], len: 5.0, radius: 0.9, color: MAGMA, cycle: { on: 1.4, off: 2.6, warn: 0.7, phase: 1.35 } },
    { kind: 'flame', p: [0, CAT_TOP + 0.05, -4.0], dir: [0, 1, 0], len: 5.0, radius: 0.9, color: MAGMA, cycle: { on: 1.4, off: 2.6, warn: 0.7, phase: 2.70 } },
    { kind: 'text', p: [2.6, CAT_TOP + 1.6, 11.0], rot: [0, -0.5, 0], text: 'IT GLOWS BEFORE IT BLOWS', size: 0.22, color: 0xd8a878 },

    // SIGIL 1's spur — hung off the west side of the catwalk over open lava,
    // beside vent 2. Gap from the spine 1.50 m at dy 0: a hop out and a single
    // back, entirely optional and entirely exposed.
    { kind: 'platform', p: [-5.0, 2.85, 4.0], s: [3.0, 0.3, 3.0], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },

    // THE JUNCTION. Twelve metres of deck where three things start: the raft
    // field north-east, the iron hat, and the drop into the lake if you want
    // to use it. cp3 lives here.
    { kind: 'platform', p: [0, 2.85, -9], s: [12, 0.3, 8], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'holosign', p: [-4.0, CAT_TOP + 2.2, -12.6], s: [2.4, 1.0, 0.1], mat: 'emissive', tint: COOL },
    { kind: 'text', p: [0, CAT_TOP + 1.7, -12.8], rot: [0, 0, 0], text: 'THE RAFTS SINK WHEN YOU STAND ON THEM', size: 0.24, color: 0xd8a878 },
    { kind: 'text', p: [0, CAT_TOP + 1.3, -12.8], rot: [0, 0, 0], text: 'so do not stand on them', size: 0.20, color: 0xb08a68 },
    { kind: 'light', p: [0, CAT_TOP + 3.2, -9], color: CINDER, intensity: 7, distance: 18 },

    /* ========================================================================
     * BEAT 3 — THE RAFT FIELD  (nine sinkers, and the reason for the clock)
     * Nine slag rafts, tops at RAFT_TOP, edge-to-edge gaps 0.45 .. 1.90 m —
     * trivially inside a single jump, ON PURPOSE. The distance is not the
     * problem. The field is crossed by never stopping.
     *
     * The tenth raft is the SPUR: one hop off the line, carrying sigil 2, and
     * it sinks like the rest.
     * ===================================================================== */

    ...RAFTS.map(([x, z], i) => ({
      kind: 'sinker', p: [x, 2.6, z], s: [3.4, 0.5, 3.4],
      delay: 0.6, speed: 1.9, depth: 5.0, rise: 1.4,
      mat: 'obsidian', tint: i % 2 ? 0x46404c : OBSIDIAN, stripe: true, edge: SAFE_EDGE,
    })),
    { kind: 'sinker', p: [13.0, 2.6, -25.6], s: [3.4, 0.5, 3.4], delay: 0.6, speed: 1.9, depth: 5.0, rise: 1.4, mat: 'obsidian', tint: 0x46404c, stripe: true, edge: SAFE_EDGE },

    // THE LANDING. Top LAND_TOP, 1.30 m and +0.75 m from R9 — the last hop of
    // the field, and the only rising one.
    { kind: 'platform', p: [31, 3.0, -21], s: [6, 1.2, 6], mat: 'obsidian', tint: OBSIDIAN, stripe: true, edge: SAFE_EDGE },
    // ... and the stair off it, because a 2.40 m climb on a REQUIRED line is a
    // stair, not a backflip. Eight risers of 0.30: foot 3.90 at z -23.43, head
    // 6.00 at z -26.58, which lands on the smelter deck's south edge.
    { kind: 'stairs', p: [31, LAND_TOP, -25.0], w: 3.0, rise: 0.30, run: 0.45, n: 8, yaw: Math.PI, mat: 'metal', tint: IRON },

    /* ========================================================================
     * BEAT 4 — THE SMELTER
     * A 20 x 13 m grate deck at DECK_TOP with a belt across it running WEST at
     * 4.5 m/s — against you, so the walk to the crusher is a run. The crusher
     * sits over the belt on a 4.2 s beat with a 0.8 s dwell: parked it is a
     * safe platform that carries you, driving it is lethal only on its face
     * (hazards/crushers.js). Two ingot crates ride the belt and both drop coins.
     *
     * The house is a sealed foundry shell — its ROOF is what the jump pad is
     * for, and sigil 7 is on it. NOTE: NO `doors` are authored on any building
     * in this course. buildBuilding takes `{side, x, w, h}` with no position,
     * so `_harness/reachcheck.mjs` synthesises the door pad at the WORLD
     * ORIGIN — which, in a course whose origin is open lava at y 0, would be a
     * phantom stepping stone wired to the interior by a free edge. The shells
     * stay sealed and only their roofs are used.
     * ===================================================================== */

    { kind: 'platform', p: [38, 5.7, -34.5], s: [20, 0.6, 13], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'building', style: 'foundry', p: [41, 8.5, -37], s: [10, 5.0, 8], mat: 'metal', tint: RUST, footing: 2.0 },
    { kind: 'conveyor', p: [38, 6.15, -31.5], s: [16, 0.3, 3], dir: [-1, 0, 0], power: 4.5, mat: 'conveyor', tint: 0x59503f },
    { kind: 'crusher', p: [38, 9.0, -31.5], s: [3.6, 2.0, 3.0], axis: [0, -1, 0], travel: 3.6, period: 4.2, dwell: 0.8, phase: 0.0, mode: 'single', mat: 'metal', tint: IRON },
    { kind: 'breakable', p: [34.6, 6.85, -31.5], s: [1.1, 1.1, 1.1], mat: 'metal', shape: 'crate', tint: RUST, drop: 'coins' },
    { kind: 'breakable', p: [43.0, 6.85, -31.5], s: [1.1, 1.1, 1.1], mat: 'metal', shape: 'crate', tint: RUST, drop: 'coins' },
    // The pad to the roof: an apex of 6.50 m carries 6.50 m of ground, and the
    // roof deck sits 4.85 m up and 3.55 m away. Optional, and the only way up.
    { kind: 'jumppad', p: [31, 6.15, -30], s: [2.8, 0.3, 2.8], power: 6.5, dir: [0, 1, 0], mat: 'rubber', tint: 0x3f9a6a },
    { kind: 'text', p: [31, DECK_TOP + 1.5, -27.4], rot: [0, 0, 0], text: 'THE BELT RUNS AGAINST YOU  ·  JUMP THE INGOTS', size: 0.24, color: 0xd8a878 },
    { kind: 'text', p: [31, DECK_TOP + 1.1, -27.4], rot: [0, 0, 0], text: 'STAND ON THE GREEN ONE', size: 0.20, color: 0x8fd8a0 },
    { kind: 'light', p: [38, DECK_TOP + 3.4, -31.5], color: CINDER, intensity: 9, distance: 22 },
    { kind: 'deco', kindOf: 'gear', p: [46.4, DECK_TOP + 1.6, -30.2], s: [2.2, 2.2, 0.4], rot: [0, 1.57, 0], mat: 'metal', tint: BRASS, count: 2, spread: 3.0, jitter: 0.2 },
    { kind: 'deco', kindOf: 'pipe', p: [33.0, DECK_TOP + 1.2, -40.0], s: [0.6, 2.4, 0.6], mat: 'metal', tint: RUST, count: 5, spread: 8.0, jitter: 0.3 },
    { kind: 'deco', kindOf: 'cables', p: [41.0, 12.0, -33.0], s: [8.0, 1.2, 0.3], mat: 'metal', tint: 0x2e2a2e },
    { kind: 'deco', kindOf: 'anvil', p: [29.0, DECK_TOP + 0.4, -38.0], s: [1.2, 0.8, 0.6], mat: 'metal', tint: 0x4c4a48 },

    /* ========================================================================
     * BEAT 5 — THE EAST GANTRY  (ROUTE B — the whole course without a raft)
     * The east bank is an ore bank at deck height (a flat at EXACTLY 6.00), so
     * the gantry runs FIFTY METRES from the shore to the smelter deck without
     * a single step in it — one platform, one draw call, and one edge in the
     * reach graph, which is what buys the ascent its depth budget.
     *
     * Two pulse BEAMS cross it on a 3.6 s cycle, 1.8 s apart, so the run is a
     * rhythm rather than a walk. The pylon spur past the second one carries
     * sigil 8.
     * ===================================================================== */

    { kind: 'platform', p: [40, 2.5, 20], s: [8, 7.0, 10], mat: 'obsidian', tint: OBSIDIAN, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [40, 5.7, -4], s: [3.6, 0.6, 50], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'rail', p: [41.7, DECK_TOP + 0.5, -4.0], s: [0.12, 1.0, 48.0], mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'rail', p: [38.3, DECK_TOP + 0.5, -4.0], s: [0.12, 1.0, 48.0], mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'pipe', p: [41.9, 3.0, 6.0], s: [0.5, 6.0, 0.5], mat: 'metal', tint: IRON, count: 6, spread: 34, jitter: 0.25 },
    { kind: 'beam', a: [37.6, DECK_TOP + 1.3, 8.0], b: [42.4, DECK_TOP + 1.3, 8.0], radius: 0.22, color: MAGMA, cycle: { on: 1.2, off: 2.4, warn: 0.6, phase: 0.0 } },
    { kind: 'beam', a: [37.6, DECK_TOP + 1.3, -6.0], b: [42.4, DECK_TOP + 1.3, -6.0], radius: 0.22, color: MAGMA, cycle: { on: 1.2, off: 2.4, warn: 0.6, phase: 1.8 } },
    { kind: 'text', p: [40, DECK_TOP + 1.6, 13.6], rot: [0, 0, 0], text: 'THE LONG WAY  ·  NO RAFTS, TWO BEAMS', size: 0.22, color: 0xd8a878 },
    { kind: 'platform', p: [44.5, 5.7, -3.0], s: [3.0, 0.6, 3.0], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'light', p: [40, DECK_TOP + 3.0, 2.0], color: CINDER, intensity: 6, distance: 20 },

    /* ========================================================================
     * BEAT 6 — THE CRUCIBLE: THE CROSSING, THE BASE YARD, THE FLUE
     * The crossing catwalk runs 19 m west from the smelter deck to the base
     * yard, both at DECK_TOP, so the two halves of the works are one walk —
     * with the first chain sweeping it.
     *
     * The base yard is 25 x 18 m of grate at DECK_TOP with the vessel standing
     * on it. A slag belt runs east across it at 5 m/s directly under the pour,
     * which is the joke: the belt carries the spill away.
     *
     * THE FLUE is ROUTE C. Four faces around a 3.00 m square (limit 3.40),
     * floor FLUE_FLOOR, ledge FLUE_LEDGE: 9.00 m, one jump plus four kicks at
     * +2.00 m each, feet 6.40 -> 16.31, clearing the 15.40 ledge with nothing
     * to bonk because the south face stops at 13.00 and the top of it is the
     * window you come out through. The ledge then STEPS DOWN 0.40 m on to the
     * level-3 walk — inside `TUNE.stepUp`, so it is not even a hop.
     * ===================================================================== */

    { kind: 'platform', p: [18.5, 5.7, -37], s: [19, 0.6, 3.6], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'pipe', p: [18.5, 4.2, -38.8], s: [0.5, 3.0, 0.5], mat: 'metal', tint: IRON, count: 4, spread: 15, jitter: 0.25 },
    { kind: 'platform', p: [-2.5, 5.7, -37], s: [25, 0.6, 18], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'conveyor', p: [-2, 6.15, -30], s: [14, 0.3, 3], dir: [1, 0, 0], power: 5.0, mat: 'conveyor', tint: 0x59503f },

    // --- THE VESSEL. Four walls, 1.60 m thick, y 6.00 .. RIM. Open topped:
    //     what is inside it is what pours.
    { kind: 'platform', p: [-5.2, 13.8, -38], s: [1.6, 15.6, 12.0], mat: 'metal', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [5.2, 13.8, -38], s: [1.6, 15.6, 12.0], mat: 'metal', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [0, 13.8, -43.2], s: [8.8, 15.6, 1.6], mat: 'metal', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [0, 13.8, -32.8], s: [8.8, 15.6, 1.6], mat: 'metal', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'panel', p: [0, 12.0, -31.9], s: [7.0, 6.0, 0.2], mat: 'metal', tint: RUST },
    { kind: 'deco', kindOf: 'emblem', p: [0, 16.4, -31.85], s: [2.2, 2.2, 0.1], mat: 'metal', tint: BRASS },
    { kind: 'deco', kindOf: 'chain', p: [-6.6, 12.0, -35.0], s: [0.2, 8.0, 0.2], mat: 'metal', tint: 0x3c3f45, count: 3, spread: 7.0, jitter: 0.2 },

    // --- THE FLUE (ROUTE C), stood against the vessel's west face.
    { kind: 'platform', p: [FLUE_C[0], 6.2, FLUE_C[1]], s: [3.0, 0.4, 3.0], mat: 'metal', tint: 0x565b62, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-9.7, 10.8, -35.3], s: [0.4, 9.6, 1.2], mat: 'metal', tint: 0x565b62 },   // west pier, north of the door
    { kind: 'platform', p: [-9.7, 10.8, -32.7], s: [0.4, 9.6, 1.2], mat: 'metal', tint: 0x565b62 },   // west pier, south of the door
    { kind: 'platform', p: [-9.7, 11.9, -34.0], s: [0.4, 7.4, 1.4], mat: 'metal', tint: 0x565b62 },   // the lintel over the door
    { kind: 'platform', p: [-6.3, 10.8, -34.0], s: [0.4, 9.6, 3.8], mat: 'metal', tint: 0x565b62 },   // east face, against the vessel
    { kind: 'platform', p: [-8.0, 10.8, -35.7], s: [3.8, 9.6, 0.4], mat: 'metal', tint: 0x565b62 },   // north face
    { kind: 'platform', p: [-8.0, 9.5, -32.3], s: [3.8, 7.0, 0.4], mat: 'metal', tint: 0x565b62 },    // south face, stops at 13.00
    { kind: 'platform', p: [-9.5, 15.25, -30.6], s: [4.4, 0.3, 3.4], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [-10.1, 8.6, -33.4], rot: [0, 1.35, 0], text: 'KICK ONE WALL, THEN THE OTHER', size: 0.20, color: 0xd8c79a },
    { kind: 'light', p: [FLUE_C[0], 11.0, FLUE_C[1]], color: MAGMA, intensity: 6, distance: 12 },

    /* ========================================================================
     * BEAT 6 (cont.) — THE EAST FLIGHT
     * Thirty risers of 0.30 up the crucible's east face: base yard 6.00 to the
     * level-3 walk at 15.00, over 12.60 m of run. A `stairs` is a stair link
     * in the reach graph, so no part of the required ascent is a jump at all —
     * what is on it is the CHAIN sweeping the crossing below and the pour
     * waiting at the head of it.
     * ===================================================================== */

    { kind: 'stairs', p: [11, DECK_TOP, -37], w: 3.0, rise: 0.30, run: 0.42, n: 30, yaw: 0, mat: 'metal', tint: IRON },
    { kind: 'platform', p: [0, 14.7, -30.4], s: [25, 0.6, 3.0], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'rail', p: [0, WALK3 + 0.5, -28.9], s: [24.0, 1.0, 0.12], mat: 'metal', tint: IRON },

    // The two chain bars. `style:'bar'` with `kill` is a sweeping chain, not a
    // ride: len 2.4 on a 3.60 m catwalk leaves nowhere to hide, so you read the
    // beat and walk through it — the same lesson as the vents, three storeys up.
    { kind: 'rotor', p: [18.5, DECK_TOP + 0.7, -37], style: 'bar', arms: 2, len: 2.4, thick: 0.26, period: 4.6, phase: 0.0, axis: 'y', kill: true, mat: 'metal', tint: 0x3c3f45 },
    { kind: 'rotor', p: [9.0, WALK3 + 0.7, -30.4], style: 'bar', arms: 2, len: 2.2, thick: 0.24, period: 3.8, phase: 0.5, axis: 'y', kill: true, mat: 'metal', tint: 0x3c3f45 },

    /* ========================================================================
     * BEAT 7 — THE POUR  (the set piece)
     * Every 30 s the crucible spills: three jets at the south spout, x -3 / 0 /
     * +3, radius 1.4, falling 16 m from just under the rim, through the
     * level-3 walk and on to the base yard. `on 6 / off 24 / warn 3` — three
     * seconds of glow and rumble, then six seconds of curtain. The blocked band
     * is x -4.4 .. 4.4; the walk runs x -12.5 .. 12.5, so there is a lane at
     * each end — and the second chain sweeps the east one, so the honest
     * answer is the west lane and the honest question is whether you will make
     * it there in three seconds.
     *
     * DEVIATION, recorded: COURSES.md asks for "a huge `mover` rotate" tipping
     * the vessel. There is no rotate — hazards/index.js `mover` accepts
     * motion.type linear | circle | orbit | oscillate | sink | elevator, all of
     * which TRANSLATE a collider; none spins one. The nearest existing kind
     * that produces the AUTHORED EFFECT (a telegraphed lava curtain across the
     * catwalk on a 30 s clock) is `flame`, which is what this is. The vessel is
     * dressed to read as tipping; it does not move.
     * ===================================================================== */

    { kind: 'flame', p: [-3.0, 21.0, -30.4], dir: [0, -1, 0], len: 16.0, radius: 1.4, color: MAGMA, cycle: { on: 6.0, off: 24.0, warn: 3.0, phase: 0.0 } },
    { kind: 'flame', p: [0.0, 21.0, -30.4], dir: [0, -1, 0], len: 16.0, radius: 1.4, color: MAGMA, cycle: { on: 6.0, off: 24.0, warn: 3.0, phase: 0.0 } },
    { kind: 'flame', p: [3.0, 21.0, -30.4], dir: [0, -1, 0], len: 16.0, radius: 1.4, color: MAGMA, cycle: { on: 6.0, off: 24.0, warn: 3.0, phase: 0.0 } },
    { kind: 'deco', kindOf: 'pipe', p: [0, 21.4, -31.2], s: [6.4, 0.9, 0.9], rot: [0, 0, 1.57], mat: 'metal', tint: RUST },
    { kind: 'text', p: [-9.4, WALK3 + 1.7, -29.0], rot: [0, 0.7, 0], text: 'SHE POURS EVERY THIRTY SECONDS', size: 0.24, color: 0xd8a878 },
    { kind: 'text', p: [-9.4, WALK3 + 1.3, -29.0], rot: [0, 0.7, 0], text: 'the ends of this walk are dry', size: 0.20, color: 0xb08a68 },
    { kind: 'light', p: [0, 20.0, -30.0], color: MAGMA, intensity: 12, distance: 26 },

    /* ========================================================================
     * BEAT 8 — THE CROWN
     * The west flight is the long one: thirty-four risers of 0.30 from the
     * level-3 walk at 15.00 to CROWN at 25.20, up the crucible's west face and
     * out on to the crane gantry, which crosses the vessel's open mouth with
     * the hook — and the crest — hanging off it.
     *
     * THE RIM is the optional branch: step off the gantry and you drop 3.60 m
     * on to the vessel's own wall top, which carries the rim coins and boards
     * the BUCKET ORBIT (gap 2.40 m at +1.60 m — a single). It is a one-way
     * drop by design, and it is not a trap: the rim's south wall steps off on
     * to the level-3 walk, and a bucket will carry you there too.
     *
     * The buckets are three gimballed skips circling the vessel at BUCKET_Y on
     * a 22 s turn, carrying a coin arc. NOTHING required is on them.
     * ===================================================================== */

    { kind: 'stairs', p: [-11.5, WALK3, -36], w: 3.0, rise: 0.30, run: 0.42, n: 34, yaw: Math.PI, mat: 'metal', tint: IRON },
    { kind: 'platform', p: [-3.5, 24.9, -40.6], s: [13, 0.6, 3.6], mat: 'metal', tint: BRASS, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'chain', p: [-4.0, 26.1, -40.6], s: [0.2, 2.2, 0.2], mat: 'metal', tint: 0x3c3f45 },
    { kind: 'deco', kindOf: 'gear', p: [-9.4, CROWN + 1.2, -40.6], s: [2.0, 2.0, 0.4], rot: [0, 1.57, 0], mat: 'metal', tint: BRASS },
    { kind: 'deco', kindOf: 'cables', p: [-3.5, CROWN + 1.6, -40.6], s: [10.0, 0.8, 0.3], mat: 'metal', tint: 0x2e2a2e },
    { kind: 'light', p: [-4.0, CROWN + 2.6, -40.6], color: GOLD, intensity: 10, distance: 20 },
    { kind: 'text', p: [-9.4, CROWN + 1.9, -39.0], rot: [0, 0.6, 0], text: 'STEP OFF FOR THE RIM  ·  YOU CANNOT STEP BACK', size: 0.20, color: 0xd8a878 },

    { kind: 'mover', p: [0, 23.0, -38], s: [2.4, 0.4, 2.4], mat: 'metal', tint: RUST, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'circle', radius: 9.6, axis: 'y', period: 22.0, phase: 0.0, ease: 'linear' } },
    { kind: 'mover', p: [0, 23.0, -38], s: [2.4, 0.4, 2.4], mat: 'metal', tint: RUST, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'circle', radius: 9.6, axis: 'y', period: 22.0, phase: 0.333, ease: 'linear' } },
    { kind: 'mover', p: [0, 23.0, -38], s: [2.4, 0.4, 2.4], mat: 'metal', tint: RUST, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'circle', radius: 9.6, axis: 'y', period: 22.0, phase: 0.667, ease: 'linear' } },

    /* ========================================================================
     * BEAT 9 — THE SLAG PIT  (the Warden)
     * A 22 m square of cooled slag at DECK_TOP standing alone in the lake, west
     * of the crucible, joined to the base yard by a 5 m chain bridge — so the
     * arena is off the required path and the walk in is a walk. The pit's own
     * edge is the wall the Warden's charge has to break itself on: the lava is
     * the fence, and it did not need building.
     * ===================================================================== */

    { kind: 'platform', p: [-32, 5.5, -34], s: [22, 1.0, 22], mat: 'obsidian', tint: OBSIDIAN, stripe: true, edge: SAFE_EDGE },
    { kind: 'bridge', a: [-16, DECK_TOP, -34], b: [-21, DECK_TOP, -34], w: 3.4, sag: 0.25, mat: 'metal', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'monolith', p: [-40.0, DECK_TOP + 1.7, -27.0], s: [1.2, 3.4, 1.0], mat: 'obsidian', tint: 0x2e2a33 },
    { kind: 'deco', kindOf: 'monolith', p: [-25.0, DECK_TOP + 1.5, -43.0], s: [1.1, 3.0, 0.9], mat: 'obsidian', tint: 0x2e2a33 },
    { kind: 'deco', kindOf: 'lavaRock', p: [-36.0, DECK_TOP + 0.4, -37.0], s: [1.4, 0.8, 1.4], mat: 'obsidian', tint: 0x3a3038, count: 6, spread: 12.0, jitter: 0.4 },
    { kind: 'text', p: [-23.0, DECK_TOP + 1.7, -31.0], rot: [0, -0.9, 0], text: 'JUMP THE WAVE  ·  DODGE THE CHARGE  ·  POUND ITS BACK', size: 0.22, color: 0xd8a878 },
    { kind: 'light', p: [-32, DECK_TOP + 4.0, -34], color: MAGMA, intensity: 8, distance: 26 },

    /* ========================================================================
     * BEAT 10 — THE COOL CAVE  (the secret)
     * On the west shore apron (a flat at EXACTLY 4.60), behind a scree of lava
     * rock, one face is a `breakable` slag crust that fills its doorway
     * exactly. Pound it and the chamber behind is the only cold, blue place in
     * the works. Nothing points at it; the only clue is that the scree is too
     * regular, and that one panel of it is flat.
     *
     * Built ABOVE the heightfield, not cut into it: a heightfield has no
     * overhangs, so a cave that was a hole in the terrain would push the player
     * straight back out of it.
     * ===================================================================== */

    { kind: 'platform', p: [-34.0, 6.40, 30.2], s: [7.4, 3.6, 0.6], mat: 'obsidian', tint: 0x4a4450 },
    { kind: 'platform', p: [-37.7, 6.40, 34.0], s: [0.6, 3.6, 8.0], mat: 'obsidian', tint: 0x4a4450 },
    { kind: 'platform', p: [-30.3, 6.40, 34.0], s: [0.6, 3.6, 8.0], mat: 'obsidian', tint: 0x4a4450 },
    { kind: 'platform', p: [-34.0, 8.55, 34.0], s: [8.0, 0.7, 8.0], mat: 'obsidian', tint: 0x4a4450 },
    { kind: 'platform', p: [-36.6, 6.40, 37.8], s: [2.2, 3.6, 0.6], mat: 'obsidian', tint: 0x4a4450 },
    { kind: 'platform', p: [-31.4, 6.40, 37.8], s: [2.2, 3.6, 0.6], mat: 'obsidian', tint: 0x4a4450 },
    { kind: 'breakable', p: [-34.0, 6.00, 37.8], s: [3.0, 2.8, 0.6], mat: 'obsidian', tint: 0x39424a, drop: 'crest', trigger: 'slag-crust' },
    { kind: 'light', p: [-34.0, 6.6, 33.6], color: COOL, intensity: 8, distance: 13 },
    { kind: 'deco', kindOf: 'crystal', p: [-36.4, 5.2, 35.6], s: [0.5, 1.1, 0.5], mat: 'crystal', tint: COOL, count: 5, spread: 4.0, jitter: 0.4 },
    { kind: 'rock', p: on(-37.6, 40.4, -0.4), r: 2.1, seed: 7201, mat: 'obsidian' },
    { kind: 'rock', p: on(-30.6, 40.6, -0.4), r: 2.3, seed: 7202, mat: 'obsidian' },
    { kind: 'rock', p: on(-34.4, 41.4, -0.5), r: 1.8, seed: 7203, mat: 'obsidian' },
    { kind: 'rock', p: on(-39.6, 37.0, -0.6), r: 2.0, seed: 7204, mat: 'obsidian' },
    { kind: 'rock', p: on(-28.4, 36.6, -0.6), r: 1.7, seed: 7205, mat: 'obsidian' },

    /* ========================================================================
     * BEAT 10 (cont.) — THE ISLET AND THE IRON HAT
     * One obsidian stub, top 0.55, standing 17 m out in open lava with three
     * coins and the POWER crest on it. There is no jump to it and there is not
     * meant to be: the iron hat on the junction deck makes lava non-lethal for
     * twenty seconds (player.power === 'metal' ignores kind 'lava'), and this
     * is the only thing in the works that asks for it.
     *
     * The reach gate reports this stub as an ORPHAN SURFACE and its coins as
     * stranded. Both are correct, and both are the design: an orphan is
     * information, not a failure, and three coins is inside the tolerance.
     * ===================================================================== */

    { kind: 'platform', p: [-26, 0.05, -14], s: [5, 1.0, 5], mat: 'obsidian', tint: OBSIDIAN, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'lavavent', p: [-26, 0.9, -16.6], s: [0.9, 0.7, 0.9], mat: 'obsidian', tint: MAGMA },
    { kind: 'light', p: [-26, 2.4, -14], color: GOLD, intensity: 7, distance: 14 },

    /* ========================================================================
     * DRESSING — the shore. Every scatter is seeded by `ihash`, so the beach
     * dresses itself identically on every load and `reset()` never moves a rock
     * (hard rule 3). Nothing scatters below y = 1.4 (that is lava) or inside a
     * KEEPOUT. Every def carries `count`/`spread`, so props.js places each as a
     * seeded instanced cluster: more props for the same triangles, which is the
     * trade an open shore wants, and course.js thins the buckets to the decor
     * budget if they ever exceed it.
     * ===================================================================== */

    ...scatter(-30, 44, 6, 22, 9, 4101, (x, z, rnd) => (
      gy(x, z) < 1.4 ? null
        : { kind: 'deco', kindOf: 'lavaRock', p: on(x, z, 0.18),
            s: [1.0 + rnd * 1.2, 0.7 + rnd * 0.7, 1.0 + rnd * 1.2], mat: 'obsidian',
            tint: rnd > 0.6 ? 0x453d48 : 0x332e38, count: 4, spread: 3.4, jitter: 0.35 }
    )),
    ...scatter(28, 46, 6, 20, 9, 4102, (x, z, rnd) => (
      gy(x, z) < 1.4 ? null
        : { kind: 'deco', kindOf: 'lavaRock', p: on(x, z, 0.18),
            s: [1.0 + rnd * 1.2, 0.7 + rnd * 0.7, 1.0 + rnd * 1.2], mat: 'obsidian',
            tint: rnd > 0.6 ? 0x453d48 : 0x332e38, count: 4, spread: 3.4, jitter: 0.35 }
    )),
    ...scatter(0, 34, 12, 46, 12, 4103, (x, z, rnd) => (
      gy(x, z) < 1.6 ? null
        : { kind: 'deco', kindOf: 'debris', p: on(x, z, 0.14),
            s: [0.8 + rnd * 0.9, 0.4 + rnd * 0.4, 0.8 + rnd * 0.9], mat: 'metal',
            tint: rnd > 0.5 ? RUST : 0x4c4a48, count: 4, spread: 3.0, jitter: 0.4 }
    )),
    ...scatter(-4, 30, 14, 44, 8, 4104, (x, z, rnd) => (
      gy(x, z) < 1.8 ? null : { kind: 'rock', p: on(x, z, -0.35), r: 0.9 + rnd * 1.5, seed: 4104 + Math.round(x), mat: 'obsidian' }
    )),
    // Braziers along the swept track: the shore's only warm light, and the
    // thing that makes the walk to the quay read as a walk to somewhere.
    { kind: 'deco', kindOf: 'brazier', p: on(-3.0, 36.0, 0.9), s: [0.7, 1.6, 0.7], mat: 'metal', tint: CINDER, count: 3, spread: 9.0, jitter: 0.2 },
    { kind: 'deco', kindOf: 'brazier', p: on(3.0, 26.0, 0.9), s: [0.7, 1.6, 0.7], mat: 'metal', tint: CINDER, count: 3, spread: 8.0, jitter: 0.2 },
    { kind: 'deco', kindOf: 'torch', p: on(30.0, 30.0, 1.2), s: [0.3, 1.3, 0.3], mat: 'metal', tint: CINDER, count: 4, spread: 10.0, jitter: 0.25 },
    { kind: 'light', p: on(0, 32, 5.0), color: CINDER, intensity: 6, distance: 26 },
    { kind: 'light', p: on(0, 46, 5.0), color: CINDER, intensity: 5, distance: 22 },
  ],

  /* ------------------------------------------------------------------------
   * CRITTERS — three families, and not one of them is a wall of the same
   * thing. Every path point is on an authored deck, never on the lava.
   * --------------------------------------------------------------------- */
  critters: [
    // BUMBLERS in iron helmets: heat-proof, so they can waddle where you cannot
    // stand still. Side contact is knockback, not death (contract §23) — which
    // on a catwalk over a lava lake is quite bad enough.
    { kind: 'bumbler', path: [[-4, CAT_TOP, 3], [4, CAT_TOP, 3], [4, CAT_TOP, -6], [-4, CAT_TOP, -6], [-4, CAT_TOP, 3]], speed: 1.5, tint: IRON },
    { kind: 'bumbler', path: [[31, DECK_TOP, -30], [45, DECK_TOP, -30], [45, DECK_TOP, -38], [31, DECK_TOP, -38], [31, DECK_TOP, -30]], speed: 1.7, tint: RUST },
    // This one patrols the POUR's west lane — the safe half of the level-3
    // walk, which is exactly the half you were planning to run down.
    { kind: 'bumbler', path: [[-11, WALK3, -30.4], [-5, WALK3, -30.4], [-11, WALK3, -30.4]], speed: 1.4, tint: IRON },
    // SKITTERS: fire flies over the raft field and the crucible's mouth.
    { kind: 'skitter', p: [14, 6.4, -24], path: [[6, 6.0, -18], [26, 8.0, -32]], amp: 1.8, speed: 3.6, tint: MAGMA },
    { kind: 'skitter', p: [0, 24.0, -38], path: [[-8, 23.4, -34], [8, 25.4, -42]], amp: 2.0, speed: 3.9, tint: MAGMA },
    // THE WARDEN, in the slag pit. Three hits, and the pit's edge is the wall
    // its charge has to break itself on.
    { kind: 'warden', p: [-32, DECK_TOP, -34], arena: { c: [-32, -34], r: 9.0 }, hp: 3, tint: 0x7a4a3a },
  ],
};

/* ===========================================================================
 * NOTES — deviations from the COURSES.md brief, and what the loader lacked
 * ===========================================================================
 * 1. "the crucible tips on a 30 s cycle (a huge `mover` rotate)". There is no
 *    rotate: hazards/index.js `mover` accepts motion.type linear | circle |
 *    orbit | oscillate | sink | elevator, all of which TRANSLATE a collider.
 *    The authored effect — a telegraphed lava curtain across the catwalk on a
 *    30 s clock — is built from the nearest existing kind, three `flame`s
 *    aimed straight down from the spout with `on 6 / off 24 / warn 3`.
 * 2. "9 sinker slag rafts (delay 0.6 s)" — nine on the line plus a tenth SPUR
 *    raft carrying sigil 2, because the brief also asks for a sigil on the
 *    rafts and a sigil on the required line is not optional.
 * 3. The brief says "No terrain (cavern floor is lava/obsidian platforms)".
 *    There IS a heightfield, but only over the SOUTHERN SHORE (z 16..70) — the
 *    lake has none, deliberately, because a heightfield under lava is walkable
 *    ground to the collider and to the reach gate alike. The shore exists so
 *    the spawn, cp1, the cool cave and both quays sit on real ground.
 * 4. "the crucible tower: SPIRAL catwalk" is built as TWO long stair flights
 *    (east face 6.00->15.00, west face 15.00->25.20) with the level-3 walk
 *    between them and the rim as an optional branch, rather than a
 *    four-corner spiral. Reason, measured: `_harness/reachcheck.mjs` floods the
 *    surface graph for 12 passes and each pass advances exactly one edge; a
 *    four-flight spiral with a leg between each pair put the crest sixteen
 *    edges from the spawn and the gate reported the CREST AND THE CRANE
 *    UNREACHABLE. The two-flight form is ten edges, with two of margin.
 * 5. `mill` appears in the brief's family list for other ember courses but not
 *    for this one. The families here are lava, flame, sinker, conveyor,
 *    crusher, rotor, mover, breakable, jumppad, beam + bumbler, skitter,
 *    warden — thirteen.
 * 6. No `doors` are authored on any building. buildBuilding's door entries
 *    carry no position ({side, x, w, h}), so reachcheck.mjs builds the door pad
 *    at v3(door) === [0, p.y, 0] — the world origin, which in this course is
 *    open lava. Both shells are sealed and only their roofs are used. The
 *    smelter house's interior floor rect still reads as adjacent to the deck,
 *    which is a harmless optimism: nothing required is inside it.
 * 7. Coin rings are authored as `ring:{c:[x,y,z], r, n}` with NO separate `y`.
 *    collectibles.js `readCentre` accepts verdant-1's `c:[x,z]` + `y` form, but
 *    reachcheck.mjs expands the same entry through `v3()`, which reads a
 *    2-element array as [x, y, 0] and puts the ring on the z = 0 line. The
 *    3-vector form is read identically by both.
 * 8. The islet and its three coins are intentionally unreachable without the
 *    iron hat: the gate reports one orphan surface and three stranded coins,
 *    both inside tolerance and both the design.
 */
