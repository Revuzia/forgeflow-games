/**
 * CRESTBOUND — EMBER FOUNDRY 4 : "SUNSCAR NECROPOLIS"
 * runtime/data/courses/ember-4.js                                   CONTRACT §25
 * ===========================================================================
 *
 * The fourth Ember course and the realm's last: a desert of dunes around a
 * stepped PYRAMID drowned in sand, with quicksand pools in the dunes, a cannon
 * between two pylons, sandboard chutes poured down the faces, a mastaba TOMB
 * dug into the north court, and a sunken PLAZA where a Warden waits.
 *
 * An OPEN DIORAMA about 130 x 130 m across a 144 x 144 m heightfield. Nothing
 * here is a corridor: the pyramid is visible from spawn, every route to its
 * capstone is legible from the sand, and the tomb, the plaza and the obelisk
 * are all side-trips you choose.
 *
 *   BEAT 1  THE DUNES        analog run over rolling sand, two QUICKSAND pools
 *                            with a stone you POUND to drain them
 *   BEAT 2  THE PYLONS       a CANNON between two stepped pylons, a BEAM gate
 *                            across the terrace — the shot skips half the climb
 *   BEAT 3  THE FACES        the south ceremonial STAIRWAY (four flights) and
 *                            the east corner scramble up the fallen blocks
 *   BEAT 4  THE TOMB         a mastaba: BEAM tripwires, a scarab ROTOR, a
 *                            CRUSHER lid, VANISH floor glyphs over quicksand,
 *                            and a BREAKABLE glyph wall at the back of it
 *   BEAT 5  THE APEX         tier 4, the capstone, the open crest
 *   BEAT 6  THE DESCENT      the SANDBOARD chute down the west face — the set
 *                            piece — through eight RINGS to the plaza
 *   BEAT 7  THE PLAZA        the sunken arena and the Warden
 *   BEAT 8  THE OBELISK      wing hat on the capstone, eight rings east
 *
 * ---------------------------------------------------------------------------
 * ROUTES TO THE OPEN CREST (capstone, crest at 23.50 over the apex at 22.10)
 * ---------------------------------------------------------------------------
 *   A  THE STAIRWAY   ground 4.00 -> T1 8.00 -> T2 12.00 -> T3 16.00 -> T4
 *                     19.60 -> capstone 22.10. Four `stairs` flights of ten
 *                     0.40 m risers up the south face. Always works, and needs
 *                     no move harder than a walk plus two 1.10/1.40 m hops.
 *   B  THE CANNON     the pylon terrace (cp pad 5.16, the cannon's breech pad
 *                     5.03) -> `cannon` -> tier 2's deck at (5.50, 12.00,
 *                     -9.50). Skips flights 1 and 2; rejoins A at flight 3.
 *   C  THE FALLEN     the east corner: nine toppled casing blocks, apron 3.65
 *      BLOCKS         -> 5.50 -> 6.70 -> 7.90 (step onto T1 8.00) -> 9.50 ->
 *                     10.75 -> 12.05 (step onto T2 12.00) -> 13.40 -> 14.70 ->
 *                     15.95 (step onto T3 16.00). Every rise 1.20 .. 1.60 m,
 *                     inside the single-jump safe rise; rejoins A at flight 4.
 *                     This is the route that never enters the tomb.
 *
 * A fourth line exists and is deliberately OPTIONAL: the 2.60 m kick shaft
 * between the mastaba's east wall and the stela, which lifts you to the tomb
 * roof at 9.60 without the three forecourt blocks.
 *
 * ---------------------------------------------------------------------------
 * THE REACH BUDGET ACTUALLY USED  (safe limits, core/tuning.js REACH_TABLE:
 * single 4.52 flat / 3.88 at +1.0 / 3.28 at +1.6, safe rise 1.60; double 5.24,
 * rise 2.19, needs 4 m; triple 6.11, rise 3.00, needs 6 m; longjump 6.42)
 * ---------------------------------------------------------------------------
 *   longest REQUIRED gap    0 m. Every required link is a stair, a step or a
 *                           straight-up hop — this course spends its difficulty
 *                           on TIMING (crushers, beams, vanish, a rotor), not
 *                           on distance.
 *   tallest REQUIRED rise   1.60 m  (route C's first block off the apron) and
 *                           1.40 m  (tier 4 -> the capstone), both inside the
 *                           1.60 m single-jump safe rise with no run-up needed.
 *   ONE measured exception  T4 top -> capstone is authored as TWO hops
 *                           (1.10 + 1.40 m) rather than one 2.50 m rise, even
 *                           though tier 4 is 13 m square and a triple (safe
 *                           rise 3.00 m, needs 6 m of straight approach) would
 *                           legally have covered it in one.
 *   longest OPTIONAL gap    1.80 m between the tomb's vanish glyphs (they are
 *                           vanishing, which is the whole difficulty), and the
 *                           1.55 m hop from the pole top to the obelisk crown.
 *   riskiest OPTIONAL line  the sandboard chute: 41.6 deg at its steepest, no
 *                           rail, quicksand and a Warden at the bottom.
 *
 * CONTENT LEDGER: 8 sigils · 7 crests · 112 coins · 5 checkpoints ·
 * hazard families quicksand, breakable, beam, cannon, vanish, rotor, crusher,
 * sandboard, rings, jumppad + critters gnasher, bumbler x3, skitter x2, warden.
 *
 * ---------------------------------------------------------------------------
 * THE TERRAIN SAMPLER — a VERBATIM transliteration of world/terrain.js
 * `sampleHeights` (ihash / fade / vnoise / fbm / bump / segDist), so every `p`
 * in this file is justified against the number the PHYSICS and
 * `_harness/reachcheck.mjs` will actually produce, not against an
 * approximation of it. Evaluation order, exactly as that module:
 *
 *     base -> + hills -> + ridges -> + fbm noise -> flats BLEND over the lot
 *
 * with a hill weighted `k*k*(3-2k)` for k = bump(d/r), a ridge weighted
 * bump(d / (w/2)) off the SEGMENT a..b, and a flat dragging the surface to its
 * `h` by weight 1 inside 0.55 r, easing to 0 at the rim. NOTE: terrain.js
 * HARDCODES that 0.55 — it does not read a per-flat `core` key (verdant-1
 * authors one and it is silently ignored), so no flat here declares one and
 * every "dead level" radius below is 0.55 r.
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS (contract §25 + runtime/data/index.js)
 * ---------------------------------------------------------------------------
 *   p            CENTRE, [x, y, z].  s = FULL size, [sx, sy, sz].
 *                => a platform's walkable top is p[1] + s[1]/2.
 *   yaw          RADIANS. yaw 0 faces -Z. +yaw is counter-clockwise from above.
 *   rot          Euler XYZ radians.
 *   stripe:true  "you had to jump to get here" — earns the bright leading edge.
 *                Walk-on ground and every decorative mesh never gets one.
 *   text         built in the local XY plane facing local +Z, so rot [0,0,0]
 *                faces a player walking north (-Z) — which is every sign here.
 *   clockOffset  the course-clock phase a respawn at that pad rewinds to, so a
 *                timed gauntlet presents the same phase on every attempt.
 */

/* ===========================================================================
 * 0. Palette — SUNSCAR NECROPOLIS (a low sun over ochre limestone)
 * ======================================================================== */

const SAND = 0xd9b978;       // open dune sand
const CASING = 0xc9a06a;     // the pyramid's warm limestone casing
const CORE_ST = 0xa8825a;    // the darker core blocks the casing has lost
const BONE = 0xe8dcc0;       // bleached stelae, statues, signage
const GOLD = 0xffd257;       // coin / sigil / crest glow, the gilded capstone
const LAPIS = 0x2f5fbf;      // tomb inlay, banners
const EMBER = 0xff8a3c;      // torch flame, brazier
const GLYPH = 0x59e0c8;      // the vanish glyphs and the tomb's cold light
const SAFE_EDGE = 0xffe9a8;  // leading-edge stripe
const DUSK = 0xff6f3c;       // the beams, and the sun they were lit from

/* ===========================================================================
 * 1. THE HEIGHTFIELD — every `p` in this file is justified against it
 * ======================================================================== */

/** Heightfield definition. Consumed verbatim by world/terrain.js (contract §18). */
const HEIGHTS = {
  seed: 20260903,
  base: 2.0,
  hills: [
    // --- the corner dunes: they close the diorama without a wall ---
    { p: [-48, 42], r: 26, h: 6.0 },    // south-west dune
    { p: [46, 46], r: 24, h: 5.0 },     // south-east dune
    { p: [-58, -46], r: 30, h: 6.0 },   // north-west dune
    { p: [56, -44], r: 28, h: 6.0 },    // north-east dune
    { p: [-66, 6], r: 20, h: 5.0 },     // west dune
    { p: [64, 2], r: 20, h: 5.0 },      // east dune
    { p: [0, 72], r: 34, h: 4.0 },      // the dune wall behind spawn
    { p: [0, -96], r: 38, h: 9.0 },     // the skyline dune, BEYOND bounds
    // --- the ground the beats stand on ---
    { p: [0, 28], r: 24, h: 2.4 },      // the saddle between spawn and the pylons
    { p: [0, 10], r: 18, h: 2.4 },      // the pylon rise
    { p: [0, -22], r: 40, h: 2.0 },     // the necropolis mound under the pyramid
  ],
  ridges: [
    // The east dune crest — the far wall of the obelisk terrace. h 2.6 over an
    // 8.0 m half-width is 28.7 deg at its steepest, under the 38 deg slide.
    { a: [28, 34], b: [42, -4], w: 16, h: 2.6 },
  ],
  flats: [
    { p: [0, 50], r: 15, h: 2.0 },      // spawn camp                     (cp1)
    { p: [-20, 34], r: 11, h: 1.2 },    // west quicksand basin
    { p: [18, 28], r: 11, h: 1.2 },     // east quicksand basin
    { p: [0, 10], r: 20, h: 5.2 },      // the pylon terrace              (cp2)
    { p: [0, -22], r: 38, h: 4.0 },     // the necropolis apron: 0.55 r = 20.9 m
                                        //   dead level, which covers the whole
                                        //   40 m footprint of tier 1
    { p: [0, -58], r: 26, h: 4.0 },     // the tomb court                 (cp3)
    { p: [-40, -14], r: 15, h: 1.6 },   // the sunken plaza               (cp5)
    { p: [40, 6], r: 12, h: 4.4 },      // the obelisk terrace
  ],
  noise: { amp: 2.4, freq: 0.038, octaves: 2 },
};

/* --- the sampler (formula in the header) ---------------------------------
 * MEASURED over the whole 141 x 141 m walkable grid with this def:
 *   worst slope anywhere        41.3 deg at (26, 33) — the east pool's rim,
 *                               which is a DELIBERATE slip face into the sand
 *   samples at or over 38 deg   18 of 19 881 (0.09 %), every one a pool rim or
 *                               a corner-dune crest; nothing required.
 *   worst slope on each REQUIRED walk
 *     spawn -> pylons             20.1 deg
 *     pylons -> the pyramid foot    6.3 deg
 *     apron -> the fallen blocks    9.4 deg
 *     apron -> the tomb forecourt   9.3 deg
 *     apron -> the plaza           25.2 deg
 *     apron -> the obelisk         28.3 deg
 * ------------------------------------------------------------------------ */

/** Integer hash in [0, 1). Math.imul only, so the 32-bit wrap is engine-identical. */
function ihash(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Quintic smoothstep — C2 continuous, so the dunes have no normal creases. */
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

/** Fractal value noise in roughly [-1, 1]. Defaults match terrain.js exactly. */
function fbm(x, z, seed, octaves, gain, lacunarity) {
  const O = octaves || 4;
  const G = gain === undefined ? 0.5 : gain;
  const L = lacunarity === undefined ? 2.03 : lacunarity;
  let v = 0, a = 1, f = 1, norm = 0;
  for (let i = 0; i < O; i++) {
    v += vnoise(x * f, z * f, seed + i * 131) * a;
    norm += a;
    a *= G; f *= L;
  }
  return norm > 0 ? v / norm : 0;
}

/** Smooth radial falloff: 1 at the centre, 0 at (and past) the rim. */
function bump(t) {
  if (t >= 1) return 0;
  if (t <= 0) return 1;
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

/** Distance from (px,pz) to the SEGMENT a..b in the XZ plane (clamped). */
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
 * a line-for-line transliteration of world/terrain.js `sampleHeights` case (c).
 * Exported so terrain.js can assert its baked field matches and the Node
 * validators can walk the surface without building a mesh.
 */
export function terrainHeightAt(x, z) {
  let y = HEIGHTS.base;

  for (let i = 0; i < HEIGHTS.hills.length; i++) {
    const H = HEIGHTS.hills[i];
    const dx = x - H.p[0], dz = z - H.p[1];
    const dd = Math.sqrt(dx * dx + dz * dz);
    if (dd < H.r) {
      const k = bump(dd / H.r);
      y += H.h * (k * k * (3 - 2 * k));      // squared falloff => a dome, not a cone
    }
  }

  for (let i = 0; i < HEIGHTS.ridges.length; i++) {
    const R = HEIGHTS.ridges[i];
    const w = R.w * 0.5;
    const dd = segDist(x, z, R.a[0], R.a[1], R.b[0], R.b[1]);
    if (dd < w) y += R.h * bump(dd / w);
  }

  y += fbm(x * HEIGHTS.noise.freq, z * HEIGHTS.noise.freq,
           HEIGHTS.seed, HEIGHTS.noise.octaves) * HEIGHTS.noise.amp;

  for (let i = 0; i < HEIGHTS.flats.length; i++) {
    const F = HEIGHTS.flats[i];
    const dx = x - F.p[0], dz = z - F.p[1];
    const dd = Math.sqrt(dx * dx + dz * dz);
    if (dd < F.r) {
      const t = dd / F.r;
      const k = t <= 0.55 ? 1 : bump((t - 0.55) / 0.45);   // terrain.js hardcodes 0.55
      y += (F.h - y) * k;
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
 * a trail in dunes this lumpy; this cannot.
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

/** Coins strung along a 3D polyline (a chute, a ring run) — no ground lookup. */
function pathCoins(pts, n, up) {
  const lift = up === undefined ? 1.2 : up;
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    seg.push(Math.hypot(pts[i][0] - pts[i - 1][0],
                        pts[i][1] - pts[i - 1][1],
                        pts[i][2] - pts[i - 1][2]));
    total += seg[seg.length - 1];
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    let want = total * (i + 0.5) / n, k = 0;
    while (k < seg.length - 1 && want > seg[k]) { want -= seg[k]; k++; }
    const t = seg[k] > 0 ? want / seg[k] : 0;
    const a = pts[k], b = pts[k + 1];
    out.push({ p: [r2(a[0] + (b[0] - a[0]) * t),
                   r2(a[1] + (b[1] - a[1]) * t + lift),
                   r2(a[2] + (b[2] - a[2]) * t)] });
  }
  return out;
}

/** A rope-and-post ring on the ground with one gap (the way in). */
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
      mat: 'rope', tint: BONE,
    });
  }
  return out;
}

/**
 * KEEP-OUT VOLUMES. The dressing block at the bottom says "nothing scatters
 * into the pyramid, the tomb, the chute, a pool or the arena" — this is what
 * makes that TRUE rather than a hopeful comment. (verdant-1 learned this the
 * expensive way: one scattered tree landed inside its wall-kick shaft and made
 * a shipped route unplayable.) The margins are generous because a rock's or a
 * cactus's collider is its radius, not its point.
 *
 * Rects are [x0, x1, z0, z1] in world metres, already margined.
 */
const KEEPOUT = [
  [-24.0, 24.0, -46.0, 5.0],     // the pyramid, its plinth and the south stairway
  [-15.0, 15.0, -74.0, -44.0],   // the mastaba, the secret chamber and the kick shaft
  [-54.0, -26.0, -30.0, -1.0],   // the sunken plaza, the arena and the chute runout
  [-14.0, 14.0, 1.0, 19.0],      // the pylon terrace and the cannon
  [-28.0, -12.0, 26.0, 42.0],    // the west quicksand pool
  [10.0, 26.0, 20.0, 36.0],      // the east quicksand pool
  [33.0, 48.0, -1.0, 13.0],      // the obelisk terrace
  [-10.0, 10.0, 42.0, 58.0],     // spawn: never dress over the first ten seconds
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
 * Seeded by `ihash`, so the desert dresses itself identically every load and
 * `reset()` never moves a cactus (contract hard rule 3). Points inside a
 * KEEPOUT are dropped HERE rather than in each `make`, so no call site can
 * forget to check.
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

/* --- BEAT 3/5: THE PYRAMID. Four tiers of solid casing standing on the apron
 *     at 4.00. Tops 8.00 / 12.00 / 16.00 / 19.60, then 20.70 and 22.10. A tier
 *     step is 4.00 m — far past anything in the envelope — which is exactly why
 *     the stairways, the cannon and the fallen blocks are the ONLY ways up, and
 *     why choosing between them is a decision rather than a formality. ------- */
const APRON = 4.00;
const T1 = 8.00, T2 = 12.00, T3 = 16.00, T4 = 19.60;
const CAP_LOW = 20.70, CAP_TOP = 22.10;

/* --- BEAT 4: THE MASTABA. Walls 4.00 .. 9.60 and the roof deck FLUSH with them
 *     at 9.60 — a roof standing proud of its walls would have turned the east
 *     kick shaft into a lidded box. Interior clear x -7 .. 7, z -64 .. -48.
 *     The quicksand floor's surface is 4.20 and the vanish glyphs' tops are
 *     4.60, i.e. 0.40 m of dry stone above the sand. ------------------------- */
const TOMB_FLOOR = 4.00;
const TOMB_TOP = 9.60;
const SAND_TOP = 4.20;
const GLYPH_TOP = 4.60;

/* --- BEAT 6: THE CHUTE. Poured down the WEST face, hugging each tier's face by
 *     1.0 .. 1.5 m so it never floats over a step. Steepest segment 41.6 deg
 *     (tier 3's face), gentlest 13.7 deg (the runout onto the plaza at 1.60). */
const CHUTE = [
  [-6.5, 19.70, -22.0],    // the head, on tier 4's west lip
  [-11.5, 16.10, -22.0],   // clear of tier 3's face (x -10.5)    35.8 deg
  [-16.0, 12.10, -22.0],   // clear of tier 2's face (x -15.0)    41.6 deg
  [-21.0, 8.10, -22.0],    // clear of tier 1's face (x -20.0)    38.7 deg
  [-30.0, 4.30, -20.0],    // out across the apron                22.4 deg
  [-38.0, 2.00, -15.0],    // the runout onto the plaza            13.7 deg
];

/* ===========================================================================
 * 4. THE COURSE
 * ======================================================================== */

export default {
  id: 'ember-4',
  realm: 'ember',
  theme: 'ember',
  name: 'SUNSCAR NECROPOLIS',
  subtitle: 'A pyramid drowned in sand',
  order: 4,
  /* 7, matching runtime/data/index.js COURSE_META — the Keep's card, the gate
     sign and the realm ladder all read that table. _spec/COURSES.md says 6;
     the registry is the number the player is shown, so the registry wins. */
  difficulty: 7,
  music: 'ember',

  /* Par times per crest id (ms) — the HUD shows them, nothing gates on them. */
  par: {
    open: 150000, sigils: 330000, coins: 360000,
    secret: 210000, boss: 190000, race: 40000, wing: 150000,
  },

  /* Spawn on the camp flat (EXACTLY 2.00), yaw 0 => facing -Z: the dunes, both
     quicksand pools, the pylons and the whole pyramid are on screen before the
     first input, with the low sun behind the capstone. The first checkpoint pad
     is 5 m ahead, so neither its ring nor its pillar of light stands on the
     hero at t = 0. */
  spawn: { p: [0, 2.0, 52], yaw: 0 },
  killY: -14,
  bounds: { min: [-72, -16, -72], max: [72, 46, 72] },

  intro: {
    /* One sentence. game.js already prints "EMBER FOUNDRY · SUNSCAR
       NECROPOLIS" as the lockup above this line; repeating the name here reads
       as a duplicate. */
    text: 'The sand has been eating this place for a thousand years. Four faces, one capstone — and everything worth taking is under something that moves.',
    cam: [
      { p: [0, 30, 62], look: [0, 14, -22], t: 0 },      // the whole necropolis
      { p: [-34, 22, -2], look: [0, 16, -22], t: 3.0 },  // down the west face and the chute
      { p: [2, 5, 48], look: [0, 12, -20], t: 6.0 },     // settle behind the hero at spawn
    ],
  },

  ambience: { wind: 0.65, sand: 0.55, birds: 0.05 },

  /* ------------------------------------------------------------------------
   * TERRAIN — there is no water in a desert. The pools are `quicksand`
   * volumes and the ground runs on underneath them, which is precisely what
   * lets you pound the drain stone at the centre of one.
   * --------------------------------------------------------------------- */

  terrain: {
    kind: 'terrain',
    origin: [-72, -72],
    size: [144, 144],
    res: 1.0,
    surface: 'sand',
    heights: HEIGHTS,
    /* A desert has no turf. The blade field is the camera-local ring
       terrain.js builds; at this density it reads as dry scrub caught in the
       lee of the dunes rather than as a lawn, and `cross: false` keeps it at
       two triangles per blade on a course that already carries a pyramid. */
    grass: { count: 5200, density: 12, height: 0.16, cross: false, color: 0xa89058 },
    /* Carved tracks: the caravan road from the camp to the pylons, the
       processional way to the pyramid, the path round the west face to the
       plaza, and the tomb approach. These do NOT change height (contract §18) —
       they carve the look, and they are the lines the coins follow. */
    paths: [
      { pts: [[0, 54], [0, 40], [-6, 30], [0, 18], [0, 12]], w: 4.0 },   // camp -> pylons
      { pts: [[0, 8], [0, 2], [0, -2]], w: 4.6 },                        // pylons -> the stairway
      { pts: [[16, -2], [22, -14], [24, -30]], w: 3.0 },                 // -> the fallen blocks
      { pts: [[-22, -6], [-28, -20], [-38, -16]], w: 3.2 },              // -> the plaza
      { pts: [[-14, -40], [-4, -44], [0, -46]], w: 3.2 },                // -> the tomb forecourt
      { pts: [[24, -4], [32, 2], [40, 6]], w: 2.6 },                     // -> the obelisk
    ],
  },

  /* ------------------------------------------------------------------------
   * CHECKPOINTS — 5, every one BEFORE its difficulty spike and never after,
   * every one on ground that is dead level (four sit inside a flat's 0.55 r
   * core; cp-tier3 is authored geometry and flat by construction), and every
   * one at least 2 m clear of anything the hero stands on, so no ring or pillar
   * of light is ever drawn through him.
   *
   * `clockOffset` rewinds the course clock on every respawn at that pad, so a
   * crusher, a beam and a vanish glyph present the SAME phase on attempt nine
   * as on attempt one. That is the difference between a course you learn and a
   * course you get lucky on, and it is why the tomb can afford five timed
   * things in fifteen metres.
   * --------------------------------------------------------------------- */
  checkpoints: [
    // flat 2.00 — before the quicksand pools
    { id: 'cp-dunes', p: on(0, 47, 0), yaw: 0, clockOffset: 0 },
    // flat 5.16 — before the beam gate and the cannon
    { id: 'cp-pylons', p: on(0, 14, 0), yaw: 0, clockOffset: 0 },
    // flat 4.00 — the tomb forecourt, before the gnasher and the whole gauntlet
    { id: 'cp-tomb', p: on(0, -45, 0), yaw: 0, clockOffset: 0 },
    // tier 3's deck — before the last flight, the capstone and the chute head
    { id: 'cp-tier3', p: [-6.0, T3, -22.0], yaw: Math.PI, clockOffset: 3.0 },
    // flat 1.60 — the plaza's east lip, before the Warden
    { id: 'cp-plaza', p: on(-34, -12, 0), yaw: -1.95, clockOffset: 0 },
  ],

  /* ------------------------------------------------------------------------
   * CRESTS — 7, one of each type in the contract.
   *
   * The brief also asks for a "timed" crest (a sun-dial vanish bridge). There
   * is no `timed` type in CONTRACT §22 — the seven are open / sigils / coins /
   * secret / boss / race / power — so that idea is carried instead by the RACE
   * (the chute slalom, 40 s) and by the vanish glyphs' own windows, and the
   * seventh slot goes to `power`, which the contract does have.
   * --------------------------------------------------------------------- */
  crests: [
    {
      id: 'open', type: 'open', name: 'CREST ON THE CAPSTONE',
      hint: 'Four faces. Stairs, cannon or the fallen blocks — pick one.',
      p: [0, CAP_TOP + 1.40, -22],
    },
    {
      id: 'sigils', type: 'sigils', name: 'EIGHT SIGILS OF THE SUNSCAR',
      hint: 'Two pools, four tiers, two in the tomb.',
      spawnAt: [4.5, TOMB_FLOOR + 1.45, -44.5],   // the forecourt pedestal
    },
    {
      id: 'coins', type: 'coins', name: 'A HUNDRED COINS', threshold: 100,
      hint: '112 are lying about. You can miss twelve.',
      spawnAt: [-6, 3.45, 46],                    // the camp pedestal, flat 2.00
    },
    {
      id: 'secret', type: 'secret', name: 'WHAT THE GLYPH WALL KEEPS',
      trigger: 'glyph-wall',
      hint: 'The back of the tomb is not the back of the tomb. Pound it.',
      spawnAt: [0, TOMB_FLOOR + 1.50, -68],       // the deepest chamber
    },
    {
      id: 'boss', type: 'boss', name: 'THE WARDEN OF THE SUNKEN PLAZA',
      hint: 'Jump the shockwave, sidestep the charge, pound its back.',
      spawnAt: [-42, 1.6 + 1.60, -18],            // the arena centre, flat 1.60
    },
    {
      id: 'race', type: 'race', name: 'THE SANDBOARD SLALOM',
      hint: 'Off the fourth tier, through all eight rings, into the plaza. 40 seconds.',
      start: [-4.0, T4, -22.0], finish: [-42.0, 1.6, -10.0], limitMs: 40000,
      spawnAt: [-42.0, 3.2, -10.0],
    },
    {
      id: 'wing', type: 'power', name: 'THE WIND OFF THE CAPSTONE', power: 'wing',
      hint: 'Take the hat at the apex and thread all eight rings before it wears off.',
      p: [40, 14.30, 6],                          // the obelisk crown
    },
  ],

  /* ------------------------------------------------------------------------
   * SIGILS — 8, every one on an OPTIONAL line that costs something: two are
   * under quicksand, four are on tiers you have to be up the pyramid to stand
   * on, and two are past the tomb's gauntlet. Each is verified against the
   * exact surface it belongs to and the rise a jump from that surface covers.
   * --------------------------------------------------------------------- */
  sigils: [
    { p: [-20.0, 3.65, 34.0], note: '1 — west pool: over the drain stone (top 2.35), rise 1.30' },
    { p: [18.0, 3.65, 28.0], note: '2 — east pool: over the drain stone (top 2.35), rise 1.30' },
    { p: [-16.0, T1 + 1.40, -38.0], note: '3 — tier 1, the north-west corner (top 8.00)' },
    { p: [12.5, T2 + 1.40, -10.0], note: '4 — tier 2, the south-east deck (top 12.00)' },
    { p: [0.0, T3 + 1.40, -30.0], note: '5 — tier 3, the north edge (top 16.00)' },
    { p: [-4.0, T4 + 1.40, -26.0], note: '6 — tier 4, behind the last flight (top 19.60)' },
    { p: [0.0, GLYPH_TOP + 1.05, -56.0], note: '7 — the tomb, over the middle vanish glyph (top 4.60)' },
    { p: [0.0, TOMB_TOP + 1.30, -56.0], note: '8 — the mastaba roof (top 9.60)' },
  ],

  /* ------------------------------------------------------------------------
   * COINS — 112 placed, 100 needed. Every group rewards a line the player
   * chose; the trail out of the camp is the only one you cannot miss, because
   * the first thirty seconds of a course teach with breadcrumbs, not signs.
   * --------------------------------------------------------------------- */
  coins: [
    // BEAT 1 — the caravan road out of the camp, over the saddle. (10)
    // Data lane 2026-09-04: the game boots at checkpoints[0], not `spawn`, so
    // this trail used to start BEHIND the player, between hero and camera
    // (metre-wide pancakes in the first frame). It now enters from the side
    // and joins the path at the pad.
    ...trailCoins([[-3, 46.4], [-6, 43], [-10, 39], [-14, 36]], 10, 1.1),
    // BEAT 1 — an ARC straight across the west pool: the price of sigil 1. (6)
    ...arcCoins([-25.0, 2.3, 34.0], [-15.0, 2.3, 34.0], 1.8, 6),
    // BEAT 1 — the same over the east pool, so the lesson lands twice. (6)
    ...arcCoins([13.0, 2.3, 28.0], [23.0, 2.3, 28.0], 1.8, 6),
    // BEAT 1 — a ring round the camp pedestal, where the coin crest lands. (8)
    { ring: { c: [-6, 46], r: 3.4, n: 8, y: 3.1 } },
    // BEAT 2 — the road down the saddle onto the pylon terrace. (8)
    ...trailCoins([[-10, 30], [-4, 22], [0, 16], [0, 12]], 8, 1.1),
    // BEAT 2 — a ring on the terrace, under the beam gate. (8)
    { ring: { c: [0, 8], r: 4.6, n: 8, y: 6.1 } },
    // BEAT 3 — up the south ceremonial stairway, one line per flight. (12)
    { line: { a: [-1.4, 5.0, 0.4], b: [-1.4, 8.8, -4.6], n: 4 } },
    { line: { a: [1.4, 9.0, -4.6], b: [1.4, 12.8, -9.6], n: 4 } },
    { line: { a: [-1.4, 13.0, -9.1], b: [-1.4, 16.8, -14.1], n: 4 } },
    // BEAT 3 — one on each of route C's fallen blocks. (8)
    { p: [24.0, 6.6, -30.0] }, { p: [22.6, 7.8, -26.6] }, { p: [21.4, 9.0, -23.0] },
    { p: [18.0, 10.6, -19.0] }, { p: [16.4, 11.9, -16.0] }, { p: [15.6, 13.2, -13.0] },
    { p: [12.0, 14.5, -12.0] }, { p: [11.0, 15.8, -14.6] },
    // BEAT 4 — the forecourt, threading the gnasher's disc. (6)
    ...trailCoins([[-12, -40], [-6, -43], [0, -45], [5, -44]], 6, 1.2),
    // BEAT 4 — over the tomb's vanish glyphs, one coin per hop. (6)
    { line: { a: [0, 5.5, -52.2], b: [0, 5.5, -59.8], n: 6 } },
    // BEAT 4 — a ring on the mastaba roof, round sigil 8. (6)
    { ring: { c: [0, -56], r: 4.2, n: 6, y: 10.7 } },
    // BEAT 5 — a ring round the capstone, at the top of the world. (8)
    { ring: { c: [0, -22], r: 3.2, n: 8, y: CAP_TOP + 1.1 } },
    // BEAT 6 — down the chute; you take these at speed or not at all. (10)
    ...pathCoins(CHUTE, 10, 1.3),
    // BEAT 7 — a ring in the sunken plaza, inside the Warden's reach. (10)
    { ring: { c: [-42, -18], r: 5.4, n: 10, y: 2.7 } },
  ],

  /* ------------------------------------------------------------------------
   * POWERS — two wing hats. One is the reward for standing on the capstone;
   * the other is in the plaza, because a ring run that begins with a seventy
   * metre walk back up the pyramid is not a ring run, it is a commute.
   * --------------------------------------------------------------------- */
  powers: [
    { kind: 'wing', p: [-1.6, CAP_TOP + 0.80, -22.0], duration: 30 },
    { kind: 'wing', p: [-34.0, 2.40, -18.0], duration: 30 },
  ],

  /* ------------------------------------------------------------------------
   * OBJECTS — the built world, beat by beat.
   * --------------------------------------------------------------------- */
  objects: [

    /* ========================================================================
     * BEAT 1 — THE DUNES AND THE QUICKSAND
     * Twenty seconds of open sand, then the course's first idea: two pools that
     * swallow you. Each has a drain stone at its centre with a sigil floating
     * over it; the stone's top is 1.15 m above the sand line, a straight-up hop
     * (single-jump safe rise 1.60 m) from the pool floor, and POUNDING it
     * breaks it. The coin arcs run flat across each pool at 2.30 m, so you can
     * price the risk from the rim before you take it.
     * ===================================================================== */

    { kind: 'deco', kindOf: 'sign', p: on(3.2, 43, 1.15), s: [0.14, 1.7, 1.2], mat: 'wood', tint: 0x8a6a3c },
    { kind: 'deco', kindOf: 'post', p: on(3.2, 43, 0.65), s: [0.16, 1.3, 0.16], mat: 'wood', tint: 0x6b4a28 },
    { kind: 'text', p: on(3.2, 43, 1.95), rot: [0, 0, 0], text: 'SUNSCAR NECROPOLIS', size: 0.58, color: 0x5c4326 },
    { kind: 'text', p: on(3.2, 43, 1.42), rot: [0, 0, 0], text: 'THE SAND DRINKS  ·  KEEP MOVING, THEN JUMP OUT', size: 0.22, color: 0x6f5533 },
    { kind: 'text', p: on(3.2, 43, 1.05), rot: [0, 0, 0], text: 'POUND THE STONE AT ITS HEART TO DRAIN A POOL', size: 0.22, color: 0x6f5533 },

    // The pedestal the HUNDRED COINS crest rises from when you finally hit 100.
    { kind: 'pedestal', p: on(-6, 46, 0), mat: 'stone', tint: BONE, glow: GOLD },

    // --- the WEST pool. Sand surface 1.20 (the flat), depth 2.20.
    { kind: 'quicksand', p: [-20, 0.10, 34], s: [11.0, 2.20, 11.0], sink: 1.1, color: 0xcaa869 },
    // The drain stone: base 0.75, top 2.35 — 1.15 m of dry stone above the sand.
    { kind: 'breakable', p: [-20, 1.55, 34], s: [2.4, 1.6, 2.4], mat: 'stone', tint: CORE_ST, drop: 'coins', stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'emblem', p: [-20, 2.55, 34], s: [1.1, 0.12, 1.1], mat: 'gold', tint: GOLD },

    // --- the EAST pool, the same shape at a different scale of nerve.
    { kind: 'quicksand', p: [18, 0.10, 28], s: [11.0, 2.20, 11.0], sink: 1.1, color: 0xcaa869 },
    { kind: 'breakable', p: [18, 1.55, 28], s: [2.4, 1.6, 2.4], mat: 'stone', tint: CORE_ST, drop: 'coins', stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'emblem', p: [18, 2.55, 28], s: [1.1, 0.12, 1.1], mat: 'gold', tint: GOLD },

    // Half-buried stelae mark both pools from 40 m, so nobody walks in blind.
    { kind: 'deco', kindOf: 'monolith', p: on(-26.5, 30.0, 1.2), s: [0.9, 3.0, 0.7], rot: [0.10, 0.5, 0.06], mat: 'stone', tint: BONE },
    { kind: 'deco', kindOf: 'monolith', p: on(-13.8, 38.4, 1.1), s: [0.8, 2.8, 0.7], rot: [-0.08, -0.4, 0.10], mat: 'stone', tint: BONE },
    { kind: 'deco', kindOf: 'monolith', p: on(24.4, 32.4, 1.2), s: [0.9, 3.0, 0.7], rot: [0.09, 1.1, -0.07], mat: 'stone', tint: BONE },
    { kind: 'deco', kindOf: 'monolith', p: on(11.8, 23.6, 1.1), s: [0.8, 2.8, 0.7], rot: [-0.07, -0.9, 0.08], mat: 'stone', tint: BONE },

    /* ========================================================================
     * BEAT 2 — THE PYLONS, THE BEAM GATE AND THE CANNON   (ROUTE B)
     * You climb the saddle onto the terrace, read the sign, cross the beam gate
     * between the two stepped pylons — the course's first `beam` — and find the
     * cannon on the terrace's north lip at 5.03, aimed over the sand at tier 2.
     * Its `target` is [5.50, 12.60, -9.50]: the shot lands on
     * the open south-east deck of tier 2 at 12.00, clear of tier 3's footprint
     * (which starts at z -11.50) and clear of the stairway (x within 2.50).
     * hazards/launch.js SOLVES the launch speed from that target against the
     * asymmetric gravity, so the ghost arc is where you actually land.
     * ===================================================================== */

    // --- the two pylons: three shrinking blocks each, all striped, so the pair
    //     reads as climbable and the terrace ring reads as a reward for it.
    { kind: 'platform', p: [8.0, 5.95, 12.0], s: [3.4, 1.5, 3.4], mat: 'stone', tint: CASING, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [8.0, 7.45, 9.6], s: [3.0, 1.5, 3.0], mat: 'stone', tint: CASING, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [8.0, 8.95, 7.4], s: [2.6, 1.5, 2.6], mat: 'stone', tint: CASING, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-8.0, 5.95, 12.0], s: [3.4, 1.5, 3.4], mat: 'stone', tint: CASING, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-8.0, 7.45, 9.6], s: [3.0, 1.5, 3.0], mat: 'stone', tint: CASING, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-8.0, 8.95, 7.4], s: [2.6, 1.5, 2.6], mat: 'stone', tint: CASING, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'statue', p: [8.0, 9.70, 7.4], s: [1.6, 2.4, 1.6], rot: [0, Math.PI, 0], mat: 'stone', tint: BONE },
    { kind: 'deco', kindOf: 'statue', p: [-8.0, 9.70, 7.4], s: [1.6, 2.4, 1.6], rot: [0, Math.PI, 0], mat: 'stone', tint: BONE },

    // --- THE BEAM GATE. On 1.5 s, off 2.3 s, with a 0.6 s telegraph on the TAIL
    //     of the off window — a kill volume never arms during `warn`
    //     (hazards/index.js, the cycle law), so the warning is always survivable.
    { kind: 'beam', a: [-7.4, 6.4, 10.4], b: [7.4, 6.4, 10.4], cycle: { on: 1.5, off: 2.3, warn: 0.6, phase: 0 }, radius: 0.20, color: DUSK },
    { kind: 'text', p: on(-3.2, 16.2, 1.5), rot: [0, 0, 0], text: 'THE LIGHT BURNS  ·  CROSS ON THE DARK', size: 0.24, color: 0x6f5533 },

    // --- THE CANNON. Breech seated on the terrace between the pylons.
    { kind: 'cannon', p: on(0, 6.4, 0.55), yaw: 0, target: [5.5, 12.6, -9.5], r: 1.1, len: 3.4, cooldown: 1.2, mat: 'copper', tint: 0xb07a3c, id: 'pylon-cannon' },
    { kind: 'text', p: on(3.2, 12.4, 1.5), rot: [0, 0, 0], text: 'STEP IN  ·  THE PYLONS DO THE AIMING', size: 0.24, color: 0x6f5533 },
    { kind: 'deco', kindOf: 'brazier', p: on(-3.4, 5.6, 1.0), s: [0.7, 1.6, 0.7], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'brazier', p: on(3.4, 5.6, 1.0), s: [0.7, 1.6, 0.7], mat: 'metal', tint: EMBER },
    { kind: 'light', p: on(0, 8, 3.2), color: EMBER, intensity: 9, distance: 22 },

    /* ========================================================================
     * BEAT 3 — THE FOUR FACES   (ROUTE A and ROUTE C)
     * The pyramid: four solid tiers on the apron at 4.00, tops 8.00 / 12.00 /
     * 16.00 / 19.60, then the capstone in two hops of 1.10 and 1.40 m to 22.10.
     * A tier step is 4.00 m and nothing in the envelope covers it — which is
     * the point. The stairway, the cannon and the fallen blocks are the ways
     * up; the sandboard chutes are the ways down.
     *
     * ROUTE A — the south ceremonial STAIRWAY. Four flights, each ten 0.40 m
     * risers on a 0.55 m run, 5.00 m wide. builders.js CENTRES a flight on `p`
     * and climbs toward LOCAL +Z, so every flight carries rot [0, PI, 0] to
     * face it north (-Z). Measured, flight by flight:
     *   F1  foot (0, 4.40, 0.95) on sand at 4.04   -> top (0, 8.00, -4.01) on tier 1
     *   F2  foot (0, 8.40, -4.06) on tier 1        -> top (0, 12.00, -9.01) on tier 2
     *   F3  foot (0, 12.40, -8.56) on tier 2       -> top (0, 16.00, -13.51) on tier 3
     *   F4  foot (0, 16.40, -14.10) on tier 3      -> top (0, 19.60, -18.50) on tier 4
     * Every foot is a 0.36 .. 0.40 m step up, inside TUNE.stepUp (0.45), so a
     * flight is entered at a walk and never with a jump.
     * ===================================================================== */

    { kind: 'platform', p: [0, 6.00, -22], s: [40, 4.0, 40], mat: 'stone', tint: CASING, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [0, 10.00, -22], s: [30, 4.0, 30], mat: 'stone', tint: CASING, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [0, 14.00, -22], s: [21, 4.0, 21], mat: 'stone', tint: CASING, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [0, 17.80, -22], s: [13, 3.6, 13], mat: 'stone', tint: CASING, stripe: true, edge: SAFE_EDGE },
    // The capstone, in two hops rather than one 2.50 m rise (see the header).
    { kind: 'platform', p: [0, 20.15, -22], s: [7.6, 1.1, 7.6], mat: 'marble', tint: BONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [0, 21.40, -22], s: [5.0, 1.4, 5.0], mat: 'gold', tint: GOLD, stripe: true, edge: SAFE_EDGE },

    { kind: 'stairs', p: [0, 4.00, -1.53], w: 5.0, rise: 0.40, run: 0.55, n: 10, rot: [0, Math.PI, 0], mat: 'stone', tint: CORE_ST },
    { kind: 'stairs', p: [0, 8.00, -6.53], w: 5.0, rise: 0.40, run: 0.55, n: 10, rot: [0, Math.PI, 0], mat: 'stone', tint: CORE_ST },
    { kind: 'stairs', p: [0, 12.00, -11.03], w: 5.0, rise: 0.40, run: 0.55, n: 10, rot: [0, Math.PI, 0], mat: 'stone', tint: CORE_ST },
    { kind: 'stairs', p: [0, 16.00, -16.30], w: 5.0, rise: 0.40, run: 0.55, n: 9, rot: [0, Math.PI, 0], mat: 'stone', tint: CORE_ST },

    /* ROUTE C — THE FALLEN CASING BLOCKS, on the east corner. Nine toppled
     * blocks, every rise between 1.20 and 1.60 m and every horizontal gap zero
     * or a hand's width, so the whole scramble is single-jump-safe (safe rise
     * 1.60 m, no run-up needed) and can be done without ever entering the tomb:
     *   apron 3.65 -> 5.50 -> 6.70 -> 7.90  [step onto tier 1 at 8.00]
     *   tier 1     -> 9.50 -> 10.75 -> 12.05 [step onto tier 2 at 12.00]
     *   tier 2     -> 13.40 -> 14.70 -> 15.95 [step onto tier 3 at 16.00]
     * The first block's rise is measured off the SAMPLED apron at (24, -30),
     * which is 3.65, not the round 4.00 the flat's core carries 20 m away — a
     * block seated at a round number would have asked for 1.85 m.
     */
    { kind: 'platform', p: [24.0, 4.75, -30.0], s: [3.4, 1.5, 3.4], mat: 'stone', tint: CORE_ST, rot: [0, 0.16, 0], stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [22.6, 5.90, -26.6], s: [3.2, 1.6, 3.2], mat: 'stone', tint: CORE_ST, rot: [0, -0.12, 0], stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [21.4, 7.15, -23.0], s: [3.0, 1.5, 3.0], mat: 'stone', tint: CORE_ST, rot: [0, 0.09, 0], stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [18.0, 8.75, -19.0], s: [3.0, 1.5, 3.0], mat: 'stone', tint: CORE_ST, rot: [0, -0.14, 0], stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [16.4, 10.05, -16.0], s: [2.8, 1.4, 2.8], mat: 'stone', tint: CORE_ST, rot: [0, 0.11, 0], stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [15.6, 11.35, -13.0], s: [2.6, 1.4, 2.6], mat: 'stone', tint: CORE_ST, rot: [0, -0.08, 0], stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [12.0, 12.70, -12.0], s: [2.8, 1.4, 2.8], mat: 'stone', tint: CORE_ST, rot: [0, 0.13, 0], stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [11.0, 14.00, -14.6], s: [2.6, 1.4, 2.6], mat: 'stone', tint: CORE_ST, rot: [0, -0.10, 0], stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [10.4, 15.25, -17.2], s: [2.4, 1.4, 2.4], mat: 'stone', tint: CORE_ST, rot: [0, 0.07, 0], stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: on(24.0, -34.0, 1.4), rot: [0, 0, 0], text: 'THE CASING FELL  ·  CLIMB WHAT IT LEFT', size: 0.22, color: 0x6f5533 },

    // Processional dressing at the pyramid's foot. Nothing here has a flat top
    // a player could mistake for a platform.
    { kind: 'deco', kindOf: 'monolith', p: on(-6.0, 2.0, 2.2), s: [1.0, 5.0, 1.0], mat: 'stone', tint: BONE },
    { kind: 'deco', kindOf: 'monolith', p: on(6.0, 2.0, 2.2), s: [1.0, 5.0, 1.0], mat: 'stone', tint: BONE },
    { kind: 'deco', kindOf: 'brazier', p: [-3.6, APRON + 0.9, -1.6], s: [0.7, 1.6, 0.7], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'brazier', p: [3.6, APRON + 0.9, -1.6], s: [0.7, 1.6, 0.7], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'banner', p: [-2.9, T1 + 1.9, -3.4], s: [0.08, 3.0, 1.3], mat: 'cloth', tint: LAPIS },
    { kind: 'deco', kindOf: 'banner', p: [2.9, T1 + 1.9, -3.4], s: [0.08, 3.0, 1.3], mat: 'cloth', tint: LAPIS },
    { kind: 'light', p: [0, APRON + 3.2, -1.0], color: EMBER, intensity: 8, distance: 20 },
    { kind: 'light', p: [0, CAP_TOP + 2.4, -22], color: GOLD, intensity: 10, distance: 22 },

    /* ========================================================================
     * BEAT 4 — THE TOMB   (the mastaba, and the course's gauntlet)
     * A stone mastaba on the tomb court at 4.00, walls 4.00 .. 9.60 with the
     * roof deck FLUSH at 9.60. Interior clear x -7 .. 7, z -64 .. -48.
     *
     * Inside, in order: a BEAM tripwire just past the door, then a floor of
     * QUICKSAND (surface 4.20) crossed on three VANISH glyphs whose tops are
     * 4.60. The gaps between the glyphs are 1.80 m — trivial as geometry, hard
     * as timing, which is the whole design. Over gap one hangs a scarab ROTOR
     * (three arms, 4.4 s, lethal); over gap two a CRUSHER lid that drives to
     * 3.90, i.e. through the sand line, so there is no standing under it. A
     * second BEAM guards the BREAKABLE glyph wall at the back, and behind that
     * is the secret chamber nobody finds by accident.
     *
     * Every one of those is a pure function of the course clock, and cp-tomb
     * carries clockOffset 0, so the whole rhythm is identical on every attempt.
     * ===================================================================== */

    // --- the shell. Walls and roof top are both 9.60 (see TOMB_TOP).
    { kind: 'platform', p: [-5.2, 6.80, -47.5], s: [5.6, 5.6, 1.0], mat: 'stone', tint: CASING },
    { kind: 'platform', p: [5.2, 6.80, -47.5], s: [5.6, 5.6, 1.0], mat: 'stone', tint: CASING },
    { kind: 'platform', p: [0, 8.50, -47.5], s: [4.8, 2.2, 1.0], mat: 'stone', tint: CASING },   // lintel: door 4.00 .. 7.40
    { kind: 'platform', p: [-7.5, 6.80, -56.0], s: [1.0, 5.6, 18.0], mat: 'stone', tint: CASING },
    { kind: 'platform', p: [7.5, 6.80, -56.0], s: [1.0, 5.6, 18.0], mat: 'stone', tint: CASING },
    { kind: 'platform', p: [0, 9.30, -56.0], s: [16.0, 0.6, 18.0], mat: 'stone', tint: CORE_ST, stripe: true, edge: SAFE_EDGE },

    // --- the glyph wall at the back: two jambs, a lintel and the panel you break.
    { kind: 'platform', p: [-5.4, 6.80, -64.5], s: [5.2, 5.6, 1.0], mat: 'stone', tint: CASING },
    { kind: 'platform', p: [5.4, 6.80, -64.5], s: [5.2, 5.6, 1.0], mat: 'stone', tint: CASING },
    { kind: 'platform', p: [0, 8.30, -64.5], s: [5.6, 2.6, 1.0], mat: 'stone', tint: CASING },
    { kind: 'breakable', p: [0, 5.50, -64.5], s: [5.6, 3.0, 0.9], mat: 'stone', tint: CORE_ST, drop: 'crest', trigger: 'glyph-wall' },

    // --- the secret chamber behind it.
    { kind: 'platform', p: [-4.8, 6.00, -68.0], s: [1.0, 4.0, 7.0], mat: 'stone', tint: CASING },
    { kind: 'platform', p: [4.8, 6.00, -68.0], s: [1.0, 4.0, 7.0], mat: 'stone', tint: CASING },
    { kind: 'platform', p: [0, 6.00, -71.0], s: [10.6, 4.0, 1.0], mat: 'stone', tint: CASING },
    { kind: 'platform', p: [0, 8.30, -68.0], s: [10.6, 0.6, 7.0], mat: 'stone', tint: CORE_ST },
    { kind: 'pedestal', p: [0, TOMB_FLOOR, -68.0], mat: 'marble', tint: BONE, glow: GLYPH },
    { kind: 'light', p: [0, TOMB_FLOOR + 2.6, -68.0], color: GLYPH, intensity: 7, distance: 12 },

    // --- the floor that is not a floor. Surface 4.20, depth 2.20.
    { kind: 'quicksand', p: [0, 3.10, -56.0], s: [13.0, 2.20, 9.5], sink: 1.2, color: 0xc8a465 },

    // --- three vanish glyphs, tops 4.60, phase-staggered by 1.4 s so the
    //     rhythm is a phrase and not a metronome. `warn` is the tail of `off`.
    { kind: 'vanish', p: [0, 4.35, -52.2], s: [3.2, 0.5, 2.0], mode: 'cycle', cycle: { on: 2.6, off: 1.5, warn: 0.55, phase: 0 }, mat: 'stone', tint: GLYPH, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [0, 4.35, -56.0], s: [3.2, 0.5, 2.0], mode: 'cycle', cycle: { on: 2.6, off: 1.5, warn: 0.55, phase: 1.4 }, mat: 'stone', tint: GLYPH, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [0, 4.35, -59.8], s: [3.2, 0.5, 2.0], mode: 'cycle', cycle: { on: 2.6, off: 1.5, warn: 0.55, phase: 2.8 }, mat: 'stone', tint: GLYPH, stripe: true, edge: SAFE_EDGE },

    // --- the two tripwires and the two slammers.
    { kind: 'beam', a: [-6.6, 5.0, -49.4], b: [6.6, 5.0, -49.4], cycle: { on: 1.2, off: 2.0, warn: 0.5, phase: 0 }, radius: 0.18, color: DUSK },
    { kind: 'beam', a: [-6.6, 5.0, -62.4], b: [6.6, 5.0, -62.4], cycle: { on: 1.0, off: 2.2, warn: 0.45, phase: 1.1 }, radius: 0.18, color: DUSK },
    // The scarab wheel over gap one: axis 'x', so three arms sweep DOWN the
    // corridor in the YZ plane. Radius 2.40 off a hub at 7.00 reaches 4.60 —
    // exactly the glyph tops — and clears the roof underside at 9.00.
    { kind: 'rotor', p: [0, 7.00, -54.1], style: 'windmill', arms: 3, len: 2.4, thick: 0.32, period: 4.4, axis: 'x', kill: true, mat: 'copper', tint: 0xb07a3c },
    // The sarcophagus lid over gap two: retracted 6.90 .. 7.90, driving to a
    // face at 3.90, which is under the sand line.
    { kind: 'crusher', p: [0, 7.40, -57.9], s: [6.6, 1.0, 2.2], axis: [0, -1, 0], travel: 3.0, period: 3.6, phase: 0.25, dwell: 0.45, mode: 'single', mat: 'stone', tint: CORE_ST },

    // --- teaching signs, each at the FIRST use of its mechanic.
    { kind: 'text', p: [0, 5.9, -48.6], rot: [0, 0, 0], text: 'THE GLYPHS HOLD  ·  THEN THEY DO NOT', size: 0.22, color: GLYPH },
    { kind: 'text', p: [0, 5.5, -48.6], rot: [0, 0, 0], text: 'watch one blink before you trust it', size: 0.18, color: 0x7fc4b6 },
    { kind: 'text', p: on(-4.8, -43.0, 1.5), rot: [0, 0, 0], text: 'THE TOMB IS AWAKE', size: 0.26, color: 0x8c3a2a },
    { kind: 'light', p: [0, 8.2, -52.0], color: GLYPH, intensity: 6, distance: 14 },
    { kind: 'light', p: [0, 8.2, -60.0], color: EMBER, intensity: 5, distance: 14 },
    { kind: 'deco', kindOf: 'torch', p: [-6.6, 6.6, -51.0], s: [0.3, 1.2, 0.3], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'torch', p: [6.6, 6.6, -51.0], s: [0.3, 1.2, 0.3], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'torch', p: [-6.6, 6.6, -61.0], s: [0.3, 1.2, 0.3], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'torch', p: [6.6, 6.6, -61.0], s: [0.3, 1.2, 0.3], mat: 'metal', tint: EMBER },

    /* --- THE FORECOURT: the three fallen blocks that carry you onto the tomb
     *     roof at 9.60 without a kick, and the pedestal the SIGIL crest rises
     *     from. Measured: apron 4.00 -> 5.50 -> 6.80 -> 8.10, then a 1.50 m
     *     rise onto the roof across a 0.50 m gap (single-safe rise 1.60 m).
     */
    { kind: 'platform', p: [-9.8, 4.75, -49.0], s: [3.0, 1.5, 3.0], mat: 'stone', tint: CORE_ST, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-9.8, 6.15, -51.8], s: [2.8, 1.3, 2.8], mat: 'stone', tint: CORE_ST, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-9.8, 7.45, -54.6], s: [2.6, 1.3, 2.6], mat: 'stone', tint: CORE_ST, stripe: true, edge: SAFE_EDGE },
    { kind: 'pedestal', p: [4.5, TOMB_FLOOR, -44.5], mat: 'stone', tint: BONE, glow: GOLD },

    /* --- THE KICK SHAFT (optional). A stela stands 2.60 m off the mastaba's
     *     east wall, both faces running 4.00 .. 9.60: a 2.60 m chimney, inside
     *     the contract's 3.40 m limit, that lifts you to the roof in one jump
     *     and two kicks (+2.00 m each) instead of three blocks. Nothing needs
     *     it; it is there for the player who reads walls.
     */
    { kind: 'platform', p: [11.1, 6.80, -55.0], s: [1.0, 5.6, 10.0], mat: 'stone', tint: CASING },
    { kind: 'text', p: [9.55, 6.0, -50.6], rot: [0, -1.35, 0], text: 'KICK ONE WALL, THEN THE OTHER', size: 0.20, color: 0xd8c79a },

    /* ========================================================================
     * BEAT 6 — THE SANDBOARD DESCENT   (the set piece, and the race)
     * A chute of poured sand down the WEST face, authored as ONE object of five
     * segments — a chute written as one `pts` run instead of five objects is
     * worth tens of draw calls (see keep.js WYRM_CHUTE). It hugs each tier's
     * face by 1.0 .. 1.5 m so it never floats over a step, steepens to 41.6 deg
     * over tier 3's face, and runs out at 13.7 deg onto the plaza. Eight rings
     * hang in it: that is the RACE, 40 s from tier 4 to the plaza floor.
     * A shorter second chute drops off tier 2's south-east corner for anyone
     * who wants a taste of it without the commitment.
     * ===================================================================== */

    { kind: 'sandboard', pts: CHUTE, w: 6.0, h: 0.5, minSpeed: 7.6, friction: 0.6, berm: 0.7, mat: 'sand', tint: SAND, id: 'west-chute' },
    /* The short east chute, off tier 2's south-east corner. Its nodes are set
     * by the SETBACKS, not by taste: a chute that drops 4 m over a 4 m step has
     * to hug the face or it re-enters the block it is falling past. Measured at
     * each face — x 15.0 (tier 2's): 12.10, exactly its top; x 20.0 (tier 1's):
     * 8.32, 0.32 m proud of its top; foot (26, -4): 3.30 over sand at 2.95. */
    { kind: 'sandboard', pts: [[15.2, 12.10, -8.0], [20.4, 8.10, -6.4], [26.0, 3.30, -4.0]], w: 5.0, h: 0.5, minSpeed: 7.0, friction: 0.6, berm: 0.6, mat: 'sand', tint: SAND, id: 'east-chute' },
    { kind: 'text', p: [-4.0, T4 + 1.5, -19.6], rot: [0, 0, 0], text: 'LEAN INTO IT  ·  THE SAND WILL NOT LET YOU STOP', size: 0.22, color: 0x6f5533 },

    // The race pads: start on tier 4 at the chute head, finish on the plaza.
    { kind: 'platform', p: [-4.0, T4 - 0.10, -22.0], s: [3.8, 0.2, 3.8], mat: 'marble', tint: 0xd8c79a },
    { kind: 'platform', p: [-42.0, 1.50, -10.0], s: [3.8, 0.2, 3.8], mat: 'marble', tint: 0xd8c79a },
    { kind: 'text', p: [-4.0, T4 + 1.1, -22.0], rot: [0, 0, 0], text: 'SANDBOARD SLALOM  ·  40s', size: 0.26, color: 0x7a5a2a },

    // THE SLALOM RINGS. Eight hoops threaded down the chute; hazards/launch.js
    // detects an ordered PLANE crossing, so a hoop cannot be tunnelled however
    // fast the sand is carrying you. Every hoop's centre is solved against the
    // chute polyline and set 1.07 .. 1.09 m above the deck at its own x, so a
    // rider passes through the middle of it rather than clipping the rim — the
    // deck heights are, in order: 18.33 / 15.12 / 12.81 / 10.82 / 8.58 / 6.83 /
    // 4.51 / 3.01. The z values weave +-0.6 m across the 6 m deck: that is the
    // slalom.
    {
      kind: 'rings', r: 2.7, tint: GOLD, mat: 'gold', id: 'slalom',
      pts: [
        [-8.4, 19.40, -22.0], [-12.6, 16.20, -21.6], [-15.2, 13.90, -22.4],
        [-17.6, 11.90, -21.4], [-20.4, 9.65, -22.4], [-24.0, 7.90, -21.0],
        [-29.5, 5.60, -20.0], [-34.5, 4.10, -17.4],
      ],
    },

    /* ========================================================================
     * BEAT 7 — THE SUNKEN PLAZA AND THE WARDEN
     * The chute empties here. The plaza floor is EXACTLY 1.60 for 8.25 m around
     * (-40, -14) — the flattest ground in the course — and the arena is a roped
     * ring 8.00 m across centred on (-42, -18): the Warden's charge needs a
     * wall to break itself on, and the ropes and their posts are it. A last
     * quicksand pool sits on the plaza's north-west lip so the fight has a
     * corner you must not let yourself be backed into.
     * ===================================================================== */

    ...fenceRing(-42, -18, 8.0, 12, Math.PI * 1.45, Math.PI * 1.95),
    { kind: 'quicksand', p: [-44, 0.50, -26], s: [9.0, 2.20, 7.0], sink: 1.1, color: 0xcaa869 },
    { kind: 'deco', kindOf: 'monolith', p: on(-49.0, -23.0, 1.6), s: [1.1, 3.6, 0.9], mat: 'stone', tint: 0x9a8f7c },
    { kind: 'deco', kindOf: 'monolith', p: on(-35.0, -23.6, 1.5), s: [1.0, 3.2, 0.9], mat: 'stone', tint: 0x9a8f7c },
    { kind: 'deco', kindOf: 'banner', p: [-42, 5.0, -24.6], s: [0.08, 2.6, 1.3], mat: 'cloth', tint: 0x8c3a2a },
    { kind: 'light', p: [-42, 5.2, -18], color: 0xffc490, intensity: 8, distance: 26 },
    { kind: 'text', p: on(-33.4, -14.6, 1.5), rot: [0, 0.9, 0], text: 'JUMP THE WAVE  ·  SIDESTEP THE CHARGE  ·  POUND ITS BACK', size: 0.22, color: 0x8c5a3a },
    // A jump pad on the plaza floor: 6.60 m of apex, which puts the plaza's
    // lip and the chute's runout back in reach without the long walk round.
    { kind: 'jumppad', p: on(-33.0, -20.0, 0.14), s: [2.8, 0.28, 2.8], power: 6.6, dir: [0, 1, 0], mat: 'rubber', tint: 0xd8a24a },

    /* ========================================================================
     * BEAT 8 — THE OBELISK AND THE WING
     * The power crest. Take the wing hat off the capstone and thread eight
     * rings that fall east across the necropolis to the obelisk crown at 12.90.
     * There is ALSO a legal STATIC line to that crown — a climbable pole beside
     * it, then a 1.55 m hop across at dy -0.50 — because a collectible only a
     * flight can reach is a collectible half the players never see.
     * ===================================================================== */

    { kind: 'platform', p: [40, 5.15, 6], s: [5.0, 1.5, 5.0], mat: 'stone', tint: CASING, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [40, 9.40, 6], s: [3.0, 7.0, 3.0], mat: 'stone', tint: BONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'pole', p: on(43.4, 6, 0), h: 9.0, r: 0.35, mat: 'copper', tint: 0xb07a3c },
    { kind: 'text', p: on(40, 1.0, 1.4), rot: [0, 0, 0], text: 'CLIMB THE POLE  ·  OR TAKE THE HAT AND FLY', size: 0.22, color: 0x6f5533 },
    { kind: 'light', p: [40, 14.6, 6], color: GOLD, intensity: 8, distance: 18 },
    {
      kind: 'rings', r: 2.9, tint: 0xa8e4ff, mat: 'gold', id: 'wing-run',
      pts: [
        [3.6, 24.60, -20.4], [9.8, 23.20, -16.0], [16.4, 21.40, -11.0],
        [22.6, 19.60, -6.0], [28.4, 17.80, -1.6], [33.4, 16.40, 1.8],
        [37.2, 15.20, 4.2], [40.0, 14.30, 6.0],
      ],
    },

    /* ========================================================================
     * DRESSING — cacti, sandstone knuckles, half-buried debris, rocks.
     * Every scatter is seeded by `ihash`, so the desert dresses itself
     * identically on every load and `reset()` never moves a cactus (hard rule
     * 3), and every one is filtered through KEEPOUT so nothing can land inside
     * the pyramid, the tomb, the chute, a pool or the arena. Each def carries
     * `count`/`spread`, so props.js plants a seeded CLUSTER per def and the
     * decor budget buys many small instances rather than a few lonely objects
     * — the same triangles, spread over a place instead of a diorama.
     * ===================================================================== */

    ...scatter(-4, 34, 10, 40, 12, 41001, (x, z, rnd) => (
      gy(x, z) < 0.6 ? null
        : { kind: 'deco', kindOf: 'cactus', p: on(x, z, 0.2), s: [0.8 + rnd * 0.6, 1.6 + rnd * 1.5, 0.8 + rnd * 0.6], mat: 'leaves', tint: 0x5f7a44, count: 3, spread: 3.2, jitter: 0.36 }
    )),
    ...scatter(26, 6, 8, 34, 10, 41002, (x, z, rnd) => (
      gy(x, z) < 0.6 ? null
        : { kind: 'deco', kindOf: 'cactus', p: on(x, z, 0.2), s: [0.7 + rnd * 0.6, 1.4 + rnd * 1.4, 0.7 + rnd * 0.6], mat: 'leaves', tint: 0x67804a, count: 3, spread: 3.0, jitter: 0.36 }
    )),
    ...scatter(-34, 22, 8, 30, 9, 41003, (x, z, rnd) => (
      gy(x, z) < 0.6 ? null
        : { kind: 'deco', kindOf: 'sandstone', p: on(x, z, -0.25), s: [1.4 + rnd * 1.3, 1.0 + rnd * 0.9, 1.3 + rnd * 1.2], mat: 'stone', tint: 0xc2a173, count: 3, spread: 3.6, jitter: 0.34 }
    )),
    ...scatter(30, -26, 8, 30, 9, 41004, (x, z, rnd) => (
      gy(x, z) < 0.6 ? null
        : { kind: 'deco', kindOf: 'sandstone', p: on(x, z, -0.25), s: [1.5 + rnd * 1.4, 1.1 + rnd * 0.9, 1.4 + rnd * 1.2], mat: 'stone', tint: 0xb8996b, count: 3, spread: 3.8, jitter: 0.34 }
    )),
    ...scatter(-30, -44, 8, 26, 8, 41005, (x, z, rnd) => (
      gy(x, z) < 0.6 ? null
        : { kind: 'deco', kindOf: 'sandstone', p: on(x, z, -0.3), s: [1.6 + rnd * 1.4, 1.2 + rnd, 1.5 + rnd * 1.2], mat: 'stone', tint: 0xb8996b, count: 3, spread: 3.8, jitter: 0.34 }
    )),
    ...scatter(0, 4, 24, 56, 12, 41006, (x, z, rnd) => (
      gy(x, z) < 0.6 ? null
        : { kind: 'deco', kindOf: 'debris', p: on(x, z, 0.1), s: [1.2 + rnd, 0.5 + rnd * 0.5, 1.2 + rnd], mat: 'stone', tint: 0xa8917a, count: 4, spread: 3.4, jitter: 0.4 }
    )),
    ...scatter(-14, -12, 14, 44, 10, 41007, (x, z, rnd) => (
      gy(x, z) < 0.6 ? null : { kind: 'rock', p: on(x, z, -0.4), r: 0.9 + rnd * 1.6, seed: 41007 + Math.round(x), mat: 'stone' }
    )),
    ...scatter(22, 20, 10, 34, 8, 41008, (x, z, rnd) => (
      gy(x, z) < 0.6 ? null : { kind: 'rock', p: on(x, z, -0.4), r: 0.8 + rnd * 1.5, seed: 41008 + Math.round(x), mat: 'stone' }
    )),
    ...scatter(-46, -8, 10, 26, 7, 41009, (x, z, rnd) => (
      gy(x, z) < 0.6 ? null : { kind: 'rock', p: on(x, z, -0.45), r: 1.0 + rnd * 1.7, seed: 41009 + Math.round(x), mat: 'stone' }
    )),

    // A caravan camp behind spawn, so the diorama has a human edge and the
    // first thing the camera sees is not empty sand.
    { kind: 'fence', a: on(-13, 57, 0), b: on(-5, 58, 0), mat: 'rope', tint: BONE },
    { kind: 'fence', a: on(-5, 58, 0), b: on(4, 57, 0), mat: 'rope', tint: BONE },
    { kind: 'fence', a: on(4, 57, 0), b: on(12, 54, 0), mat: 'rope', tint: BONE },
    { kind: 'deco', kindOf: 'bench', p: on(-8.4, 54.0, 0.3), s: [1.8, 0.7, 0.9], rot: [0, 0.4, 0], mat: 'wood', tint: 0x8a6a3c },
    { kind: 'deco', kindOf: 'barrel', p: on(-6.2, 55.2, 0.5), s: [0.9, 1.0, 0.9], mat: 'wood', tint: 0x8a6a3c, count: 3, spread: 2.2, jitter: 0.3 },
    { kind: 'deco', kindOf: 'banner', p: on(6.0, 55.0, 2.6), s: [0.08, 2.4, 1.2], mat: 'cloth', tint: LAPIS },
    { kind: 'light', p: on(-6, 50, 3.0), color: EMBER, intensity: 6, distance: 16 },
  ],

  /* ------------------------------------------------------------------------
   * CRITTERS
   * --------------------------------------------------------------------- */
  critters: [
    // THE GNASHER at the tomb door. Post on the forecourt at 4.00, chain 5.00,
    // so its reach is a disc you can pace out from outside it — and that disc
    // just touches the WEST jamb of the door, which is the whole puzzle: the
    // door is enterable, but only on the east half of it.
    {
      kind: 'gnasher', p: [-4.5, TOMB_FLOOR, -46.5], chain: 5.0,
      post: [-4.5, TOMB_FLOOR, -43.5], postHits: 3, trigger: 'gnasher-freed',
      telegraph: 0.5, tint: 0x4a3a30,
    },
    // BUMBLERS (mummified). Side contact is knockback, never death (§23).
    { kind: 'bumbler', path: [on(-10, 40), on(2, 42), on(6, 36), on(-10, 40)], speed: 1.5 },
    { kind: 'bumbler', path: [[-14, T1, -34], [10, T1, -34], [10, T1, -12], [-14, T1, -12], [-14, T1, -34]], speed: 1.8 },
    { kind: 'bumbler', path: [on(-36, -22), on(-46, -24), on(-48, -12), on(-36, -22)], speed: 1.6 },
    // SKITTERS (scarabs). One patrols between the pools, one circles the pyramid.
    { kind: 'skitter', p: [-4, 5.0, 32], path: [[-20, 4.6, 34], [16, 5.4, 28]], amp: 1.8, speed: 3.6 },
    { kind: 'skitter', p: [16, 15.0, -12], path: [[16, 15.0, -12], [-16, 18.0, -34]], amp: 2.2, speed: 4.0 },
    // THE WARDEN, in the roped ring on the plaza's flattest ground (1.60).
    { kind: 'warden', p: [-42, 1.6, -18], arena: { c: [-42, -18], r: 7.0 }, hp: 3, tint: 0x8a6a4a },
  ],
};
