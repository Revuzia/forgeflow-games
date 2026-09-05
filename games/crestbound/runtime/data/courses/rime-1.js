/**
 * CRESTBOUND — RIME SPIRE 1 : "FROST COTTAGE"
 * runtime/data/courses/rime-1.js                                    CONTRACT §25
 * ===========================================================================
 *
 * The first snow course: a village snowed in on a long hillside. An OPEN
 * DIORAMA about 120 x 150 m across a 150 x 175 m heightfield: a FROZEN LAKE
 * in the south (spawn), a terraced VILLAGE of four cottages and a barn on the
 * first bench, a steep snow bank climbed by a switchback of packed-snow ramps,
 * a HILLSIDE LEDGE, a GORGE torn down the east flank with a vanishing ice
 * bridge across it, the CHAPEL on its green with a bell tower you wall-kick
 * up, and above everything THE CREST FACE — a 40 m snow slope you ride on
 * purpose, from a shelf at 40.5 down to a sleigh-jump aimed at the belfry.
 *
 * Difficulty 5. Two new verbs, both taught by the ground and never by a wall
 * of text: ICE (the lake: drift, learn to stop before the hole) and the SLOPE
 * SLIDE (snow steeper than 38 deg carries you down; jump off it to catch a
 * ledge). Everything else the Bailey taught is here, colder.
 *
 *   BEAT 1  THE FROZEN LAKE   ice drift, the hole, a dive to the lake bed
 *   BEAT 2  THE NORTH SHORE   the trodden track up to the village
 *   BEAT 3  THE VILLAGE       rooftop hopping across four snow-capped ridges,
 *                             two bells swinging across the gap, the old pine
 *   BEAT 4  THE BARN          a chained Gnasher, a hay wall, the loft secret
 *   BEAT 5  THE DRIFT         the slope lesson: a cornice, a 41 deg packed
 *                             drift you slide down, and the CATCH LEDGE you
 *                             jump onto at the lip. Beside it, the trodden
 *                             track up the hillside (30 deg, a walk).
 *   BEAT 6  THE LEDGE + GORGE the hillside ledge (cp), a 40 deg chute into
 *                             the gorge, the jump ledge, sinking snow pads,
 *                             the vanishing ice bridge to the east knoll
 *   BEAT 7  THE CHAPEL TRACK  the track round the green's bank (<= 34 deg),
 *                             a bell swinging across it, the green (cp)
 *   BEAT 8  THE CHAPEL        the nave, the bell tower (3.2 m wall-kick shaft),
 *                             the belfry and the crest, the sleigh lift
 *   BEAT 9  THE CREST FACE    the set piece: ride the sleigh lift up, slide
 *                             the face through coin gates, hit the kicker,
 *                             land on the belfry
 *   BEAT 10 RACES / WINGS     three optional overlays across the whole map
 *
 * ---------------------------------------------------------------------------
 * ROUTES TO THE OPEN CREST (the belfry, 28.50)
 * ---------------------------------------------------------------------------
 *   A  THE WALK      lake -> north shore -> square -> the hillside track ->
 *                    ledge -> the chapel track -> green -> tower door ->
 *                    WALL-KICK SHAFT (3.20 m, 15.10 -> 23.10: one jump + four
 *                    kicks) -> belfry. Fully STATIC: every required surface is
 *                    walkable ground (<= 34 deg, measured) or authored
 *                    geometry. No mover is ridden, no ramp is required.
 *   B  THE SLEIGH    green -> board the sleigh lift at the foot of the face ->
 *                    ride 25 m up to the crest shelf -> SLIDE the face ->
 *                    the kicker -> the belfry deck. Optional, and the whole
 *                    reason the course exists.
 *   C  THE ROOFS     square -> snow blocks -> lean-to -> four ridge caps ->
 *                    (sigil 2) — a village-sized detour, not a climb.
 *
 * ---------------------------------------------------------------------------
 * THE TERRAIN SAMPLER — a transliteration of world/terrain.js `sampleHeights`
 * ---------------------------------------------------------------------------
 * `terrainHeightAt(x, z)` below is the RECIPE branch of terrain.js's own
 * sampler, copied operation for operation, because that function is what the
 * heightfield collider AND `_harness/reachcheck.mjs` evaluate. (verdant-1.js
 * carries an OLDER formula that agrees with the game only on its flats; this
 * file follows rime-3.js, which agrees everywhere.) It runs, in this order:
 *
 *   1. y = base
 *   2. HILLS   for each {p:[hx,hz], r, h}: d = hypot(x-hx, z-hz)
 *              if d < r:  k = bump(d/r);  y += h * (k*k*(3-2k))
 *   3. RIDGES  for each {a, b, w, h}: HALF-WIDTH is w/2 (`w` is the FULL
 *              width), d = distance to the SEGMENT a..b;
 *              if d < w/2:  y += h * bump(d / (w/2))
 *   4. NOISE   y += fbm(x*freq, z*freq, seed, 4 octaves) * amp
 *   5. FLATS   for each {p, r, h} IN ARRAY ORDER: d = hypot(x-fx, z-fz)
 *              if d < r:  t = d/r;  k = t <= 0.55 ? 1 : bump((t-0.55)/0.45)
 *              y += (h - y) * k
 *              (dead level inside 0.55*r, melting into the hill at the rim)
 *
 *   bump(t) = 0.5 * (1 + cos(PI * t))         — 1 at the centre, 0 at the rim
 *
 * THE SHAPE, and why: the whole hillside is ONE ridge (a 26 m crest 130 m
 * north of the lake, half-width 190) so the ground climbs 0.5 -> 22 at no
 * more than 12.1 deg anywhere on open snow, and a 22 m CREST hill on top of
 * it makes the face. Every bench is a FLAT, and a flat cut into a hill of
 * slope s is ringed by a rim of about 2.9 s (the level core is 55 % of the
 * radius; the 45 % skirt has to make up the difference, and a cosine skirt
 * peaks at pi/2 times its mean) — on 12 deg that is 31-34 deg, a walk; on the
 * 15-18 deg an earlier draft had, it was 40-56 deg, a cliff, and every ramp
 * that tried to climb one went under the snow half-way. So the hill is gentle
 * where the benches are and the steep snow is AUTHORED where the course wants
 * it: the drift, the chute, the gorge walls, the crest face.
 *
 * MEASURED SLOPES (probe step 0.5 m, `slideDeg` is 38), _rime1verify.mjs:
 *     spawn -> lake ice -> north shore    <= 3 deg on the walked line (the ice
 *                                          hides the 39 deg bed bank)
 *     north shore -> square              <= 29 deg
 *     square -> barn yard                <=  8 deg
 *     square -> hillside -> ledge        <= 31 deg  walk
 *     ledge -> chapel track -> green     <= 34 deg  walk
 *     THE DRIFT (authored ramp)          41 deg     SLIDE — the lesson
 *     THE CHUTE (authored ramp)          40 deg     SLIDE, into the gorge
 *     THE CREST FACE z -56 .. -76        43 - 52 deg  SLIDE (deliberate)
 *     the crest shelf                    <=  1 deg (its own rim 59-75 deg:
 *                                          you drop in, that is the point)
 *     the gorge walls                    66 - 71 deg  SLIDE into snow, 4-8 m
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS (contract §25 + runtime/data/index.js) — same as verdant-1.js
 * ---------------------------------------------------------------------------
 *   p            CENTRE, [x, y, z].  s = FULL size, [sx, sy, sz].
 *                => a platform's walkable top is p[1] + s[1]/2.
 *   yaw          RADIANS. yaw 0 faces -Z. +yaw is counter-clockwise from above.
 *   rot          Euler XYZ radians. A ramp is a slab along its local X, tilted
 *                about Z, then yawed (see snowRamp()). Every ramp here is a
 *                SLIDE (> 38 deg) or the kicker, and every one is optional.
 *   stripe:true  "you had to jump to get here" — earns the bright leading edge.
 *   cycle {}     SECONDS.  mover `phase` is a FRACTION 0..1.
 *   jumppad.power is METRES of apex.
 *
 * ---------------------------------------------------------------------------
 * THE REACH BUDGET ACTUALLY USED (safe limits from core/tuning.js REACH_TABLE:
 * single 4.52 flat / 3.88 at +1.0 / 3.28 at +1.6; double 5.24; triple 6.11,
 * +3.0 up on 6 m of run-up; long jump 6.42; wall kick +2.12 per kick in a
 * shaft <= 3.40 m wide)
 * ---------------------------------------------------------------------------
 *   steepest REQUIRED ground  33.5 deg   the green's south rim, on the track
 *   longest REQUIRED gap      0 m        everything required is a walk
 *   REQUIRED wall kicks       THE BELL TOWER, 3.20 m clear, 15.10 -> 23.10:
 *                             one jump (1.91) + four kicks (2.12) = 10.4 m of
 *                             reach for 8.0 m of shaft
 *   longest OPTIONAL gap      3.0 m at +0.6    BEAT 3, the last two ridge caps
 *   tallest OPTIONAL rise     +1.6 m           BEAT 5, square -> catch ledge;
 *                                              BEAT 6, pad -> pad on the way
 *                                              up to the knoll
 *   riskiest OPTIONAL line    the belfry wall-tops: 0.40 m wide, 8 m up, to
 *                             the nave's ridge cap and sigil 7
 * Nothing here REQUIRES a triple, a long jump or a dive.
 *
 * CONTENT LEDGER: 8 sigils · 7 crests · 116 coins · 5 checkpoints ·
 * hazard families: ice, ramp, pendulum, mover, sinker, breakable, vanish,
 * water, tree(climb), jumppad, rings  + critters gnasher, bumbler x3,
 * skitter x2.
 */

/* ===========================================================================
 * 0. Palette — RIME SPIRE at dusk
 * ======================================================================== */

const SNOW = 0xeef5ff;       // lit snow
const ICE = 0xa9dcf2;        // lake ice
const ICE_DEEP = 0x6fb4d8;   // the hole, thick ice
const STONE = 0xb4bfcc;      // cold granite
const TIMBER = 0x8a6a4a;     // cottage beams, sleigh, gantry
const PLASTER = 0xe8e2d6;    // cottage walls
const WARM = 0xffb464;       // window light, lanterns — the only warm thing
const AURORA = 0x7dffd4;     // the sky's own green, on the vanish ice
const GOLD = 0xffd257;       // coin / crest glow
const BELL = 0xd9a441;       // bronze
const SAFE_EDGE = 0xffe9a8;  // leading-edge stripe (theme palette.safeEdge)

/* ===========================================================================
 * 1. THE HEIGHTFIELD — every `p` in this file is justified against it
 * ======================================================================== */

/** Heightfield definition. Consumed verbatim by world/terrain.js (contract §18). */
const HEIGHTS = {
  seed: 20260904,
  base: 0.0,
  hills: [
    // THE CREST. Stacked on the ridge it makes a 43-52 deg face between
    // z -56 and z -76 with a 24 deg run-in above the green; its rim (r 48)
    // stops short of the green at z -46, so the green's own ground keeps the
    // ridge's 12 deg and its rim stays a walk.
    { p: [0, -94], r: 48, h: 22.0 },
    // Shoulders that close the diorama on both sides.
    { p: [-62, 0], r: 26, h: 9.0 },
    { p: [62, 0], r: 26, h: 9.0 },
    { p: [-58, 44], r: 22, h: 5.0 },
    { p: [58, 44], r: 22, h: 5.0 },
  ],
  ridges: [
    // THE HILLSIDE. One crest, far north, half-width 190: the ground climbs
    // 0.5 -> 22 over the diorama at a maximum of 12.1 deg on open snow.
    { a: [-110, -130], b: [110, -130], w: 380, h: 26.0 },
    // THE GORGE. A negative ridge is a channel: `w` is the FULL width, so
    // this is 14 m across and 8 m deep at its centre line, torn diagonally
    // down the east flank. Floor 3.6 at the near end, 5.7 further down.
    { a: [22, -26], b: [44, -58], w: 14, h: -8.0 },
  ],
  noise: { amp: 0.35, freq: 0.05 },
  flats: [
    { p: [0, 46], r: 27, h: 1.4 },     // THE LAKE TERRACE — spawn, cp1, cp2
    { p: [0, 44], r: 13, h: -1.6 },    // THE LAKE BED (under the ice)
    // Every bench's h is the natural ground at its centre (measured), so the
    // rims only have the hill's own gradient to absorb.
    { p: [0, 8], r: 22, h: 4.7 },      // THE VILLAGE SQUARE      (cp3)  nat 4.67
    { p: [-21, 4], r: 8, h: 5.0 },     // THE BARN YARD                  nat 4.98
    { p: [14, -22], r: 9, h: 10.2 },   // THE HILLSIDE LEDGE      (cp4)  nat 10.17
    { p: [0, -46], r: 13, h: 15.1 },   // THE CHAPEL GREEN        (cp5)  nat 15.29
    { p: [0, -78], r: 8, h: 40.1 },    // THE CREST SHELF (slide start)  nat 40.05
    { p: [38, -34], r: 7, h: 12.8 },   // THE EAST KNOLL (across the gorge) nat 12.77
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
 * spaced by arc length, floating `up` metres. A straight {line} would bury
 * half a trail on a hillside; this cannot.
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
 * A packed-snow RAMP whose top face runs exactly from a to b (both [x,y,z]),
 * `w` wide and `t` thick. The slab lies along its local X; `rz` tilts it,
 * `ry` yaws it (Euler XYZ, which is what builders.js buildRamp and the reach
 * gate's eulerBasis both apply). The centre is pushed down the face normal by
 * half the thickness so the TOP passes through a and b, not the mid-plane.
 * Returns the def; `extra` overrides.
 */
function snowRamp(a, b, w, t, extra) {
  const dx = b[0] - a[0], dz = b[2] - a[2], dy = b[1] - a[1];
  const Lh = Math.hypot(dx, dz);
  const L = Math.hypot(Lh, dy);
  const ry = Math.atan2(-dz, dx);
  const rz = Math.atan2(dy, Lh);
  // face normal = the slab's local +Y under [0, ry, rz]
  const nx = -Math.cos(ry) * Math.sin(rz), ny = Math.cos(rz), nz = Math.sin(rz) * Math.sin(ry);
  const def = {
    kind: 'ramp',
    p: [r2((a[0] + b[0]) / 2 - nx * t / 2), r2((a[1] + b[1]) / 2 - ny * t / 2), r2((a[2] + b[2]) / 2 - nz * t / 2)],
    s: [r2(L), t, w],
    rot: [0, r2(ry), r2(rz)],
    surface: 'snow', mat: 'snow', tint: SNOW,
  };
  if (extra) for (const k in extra) def[k] = extra[k];
  return def;
}

/** A fence run on the ground between [x,z] waypoints. */
function fenceRun(pts) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    out.push({ kind: 'fence', a: on(pts[i - 1][0], pts[i - 1][1], 0), b: on(pts[i][0], pts[i][1], 0), mat: 'wood', tint: TIMBER });
  }
  return out;
}

/**
 * KEEP-OUT VOLUMES. Every scattered prop is dropped if it lands inside one, so
 * no seeded pine or drift ever ends up in the wall-kick shaft, on a roof line,
 * on the slide, on a ramp or in the gorge crossing. Rects are
 * [x0, x1, z0, z1] in world metres, already margined.
 */
const KEEPOUT = [
  [-16, 16, 30, 60],       // BEAT 1: the lake ice and its hole
  [-18, 20, -0.5, 24],     // BEAT 3: the square, the cottages, the bell gantry, the pine
  [-30, -12, -4, 12],      // BEAT 4: the barn and its yard
  [-8, 14, -20, -0.5],     // BEAT 5: the snow bank, both ramps, the catch ledge, the sinkers
  [4, 45, -42, -20],       // BEAT 6: the ledge, the chute, the gorge crossing, the knoll
  [-8, 12, -60, -24],      // BEATS 7-8: the chapel path, the green, the tower, the sleigh foot
  [-6, 8, -84, -56],       // BEAT 9: the crest face, the kicker, the shelf
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
 * Seeded by `ihash`, so the hillside dresses itself identically every load and
 * `reset()` never moves a pine (contract hard rule 3).
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

// BEAT 1 — the lake. Terrace EXACTLY 1.40 inside r 14.85 of (0,46); the bed
// EXACTLY -1.60 inside r 7.15 of (0,44), banking up at 39 deg to meet the
// terrace at r 13. The ICE lies at 1.30 — 0.10 under the terrace lip, so its
// edge vanishes into the snow bank rather than floating over it — and covers
// the bed out to r 13, where the bank has risen to 1.30 on its own.
const TERRACE_Y = 1.40;
const ICE_TOP = 1.30;
const WATER_TOP = 1.00;      // 0.30 under the ice: dry feet on the sheet
const LAKE_BED = -1.60;      // 2.60 m of water under the hole: a real dive
const HOLE = [5.0, 42.0];    // the hole's centre, 3 x 3 m, inside the bed core

// BEAT 3 — the village. Square EXACTLY 4.40 inside r 12.1 of (0,8). A cottage
// here is 6 x 3.2 x 5 (W x H x D): builders.js roofPitched gives it a ridge
// `H + min(D*0.42, 2.8)` = 5.30 above its base, so the SNOW CAP slab that
// makes the ridge a platform sits with its top at base + 5.85.
const VILLAGE_Y = 4.70;
const COT_H = 3.2, COT_D = 5.0;
const RIDGE_UP = COT_H + Math.min(COT_D * 0.42, 2.8);   // 5.30
const CAP_TOP = r2(VILLAGE_Y + RIDGE_UP + 0.55);          // 10.55

// BEAT 4 — the barn yard, EXACTLY 5.00 inside r 4.4 of (-21,4).
const BARN_Y = 5.00;

// BEAT 5 — THE DRIFT. The square's north rim climbs 4.7 -> 8.6 over z -3..-14
// at 30 deg (a walk). West of the track a CORNICE (top 9.60, 1.0 over the
// hill behind it) launches a 41 deg packed drift down to a lip at 6.60, 0.1 m
// over the snow, and the CATCH LEDGE (top 5.90) waits 2.3 m past the lip.
const DRIFT_TOP = [-6.0, 9.60, -12.3];
const DRIFT_LIP = [-6.0, 6.60, -8.9];                         // 3.00 down / 3.40 = 41.4 deg
const CATCH_TOP = 5.90;

// BEAT 6 — the hillside ledge, EXACTLY 10.20 inside r 4.95 of (14,-22); the
// knoll EXACTLY 12.80 inside r 3.85 of (38,-34). The chute launches from a
// snow block on the ledge's rim (top 11.40, a 1.2 m step) — it has to, because
// the rim is dead level for its first metre and a 40 deg slab that started
// flush would run under it — and drops 5.6 m over 6.2 m (42.1 deg) to a lip
// 1.2 m over the gorge floor; the jump ledge (top 7.00) is 1.9 m on, 1.2 up.
const LEDGE_Y = 10.20;
const KNOLL_Y = 12.80;
const CHUTE_TOP = [18.0, r2(LEDGE_Y + 1.20), -24.5];
const CHUTE_LIP = [22.2, 5.80, -29.0];
const JUMP_LEDGE = [26.4, 7.00, -32.4];

// BEAT 8 — the chapel. Green EXACTLY 15.10 inside r 7.15 of (0,-46). The
// tower's shaft is 3.20 m clear, walls 15.10 -> 23.10; the belfry deck is at
// 23.10 on the tower's north face. One jump (1.91) + four kicks (2.12 each)
// = 10.4 m of reach for 8.0 m of shaft (contract: 3.4 m max width).
const GREEN_Y = 15.10;
const TOWER = [0.0, -47.0];
const WALL_TOP = r2(GREEN_Y + 8.0);                          // 23.10
const DECK_TOP = WALL_TOP;
const NAVE_RIDGE = r2(GREEN_Y + 5.5 + 2.8);                  // 23.40 (W 12, H 5.5, D 8)
const NAVE_CAP_TOP = r2(NAVE_RIDGE + 0.45);                  // 23.85

// BEAT 9 — the crest face and the sleigh lift. Shelf EXACTLY 40.10 inside
// r 4.4 of (0,-78). The lift rises 25 m in 18 s. The kicker's foot sits on
// the face at z -61.5 and its lip is 2.2 m up and 4 m on — measured 0.6 m
// above the belfry deck, which is 4.8 m past the lip.
const SHELF_Y = 40.10;
const LIFT_BOT = [5.0, r2(GREEN_Y + 0.30), -50.0];           // top 15.65, on the green
const LIFT_TOP = [3.0, r2(SHELF_Y + 0.30), -76.0];           // top 40.65, on the shelf
const KICK_FOOT = [0, r2(gy(0, -61.5)), -61.5];
const KICK_LIP = [0, r2(gy(0, -61.5) + 2.20), -57.5];

/* ===========================================================================
 * 4. THE COURSE
 * ======================================================================== */

export default {
  id: 'rime-1',
  realm: 'rime',
  theme: 'rime',
  name: 'FROST COTTAGE',
  subtitle: 'Snow slopes and a frozen pond',
  order: 1,
  difficulty: 5,
  music: 'rime',

  /* Par times per crest id (ms) — the HUD shows them, nothing gates on them. */
  par: {
    open: 120000, sigils: 300000, coins: 330000,
    secret: 150000, race: 60000, bell: 20000, wing: 160000,
  },

  /* Spawn on the lake terrace (EXACTLY 1.40), yaw 0 => facing -Z: the whole
     lake, the village lights on the bench above it, the chapel tower on the
     green and the crest face behind that are all in frame before the first
     input. cp1 is 2.5 m ahead. */
  spawn: { p: [0, TERRACE_Y, 61], yaw: 0 },
  killY: -30,
  bounds: { min: [-75, -12, -100], max: [75, 62, 75] },

  intro: {
    text: 'The lake is frozen, the village is snowed in, and the chapel bell has not rung in years. Mind the ice — it does not stop when you do.',
    cam: [
      { p: [0, 26, 78], look: [0, 6, 20], t: 0 },
      { p: [30, 26, 10], look: [0, 18, -46], t: 2.8 },
      { p: [4, 6, 70], look: [0, 3, 40], t: 5.6 },
    ],
  },

  ambience: { wind: 0.55, snow: 0.65, birds: 0.10 },

  /* ------------------------------------------------------------------------
   * TERRAIN + WATER
   * --------------------------------------------------------------------- */

  terrain: {
    kind: 'terrain',
    origin: [-75, -100],
    size: [150, 175],
    res: 1.0,
    surface: 'snow',
    heights: HEIGHTS,
    grass: { count: 0 },
    // Trodden snow tracks: packed, darker, no drift. These are the lines the
    // coins follow, and on open snow they are how the eye is led.
    paths: [
      { pts: [[0, 60], [0, 57]], w: 3.2 },                                   // spawn -> the ice
      { pts: [[0, 31], [0, 24], [-1, 16], [0, 8]], w: 3.4 },                 // north shore -> square
      { pts: [[-6, 6], [-14, 5], [-20, 4]], w: 2.6 },                        // square -> barn
      { pts: [[0, 6], [2, -1], [6, -8], [10, -14], [13, -19]], w: 2.8 },    // square -> the hillside track -> ledge
      { pts: [[12, -25], [8, -29], [4, -33], [0, -37], [2, -42], [2.8, -46.5]], w: 2.8 }, // ledge -> chapel track -> tower door
      { pts: [[18, -23], [26, -28], [35, -33]], w: 2.4 },                    // under the ice bridge
    ],
  },

  waters: [
    {
      // THE LAKE. Surface 1.00 under a 0.30 m ice sheet; floor -1.60 in the
      // bed core => 2.60 m of water under the hole, deep enough to dive to
      // sigil 1 and have to come back up on purpose. The box is buried on
      // every edge: at r 13 the bank stands at 1.30, at the corners at 1.40.
      kind: 'water', kind2: 'lake',
      p: [0, r2(WATER_TOP - 1.4), 44], s: [26, 2.8, 26],
      tint: 0x3a7ea8,
    },
  ],

  /* ------------------------------------------------------------------------
   * CHECKPOINTS — 5, every one on an EXACT flat, every one BEFORE its spike:
   * the ice, the climb to the square, the snow bank, the chapel path, the
   * bell tower. cp1 is 2.5 m from spawn.
   * --------------------------------------------------------------------- */
  checkpoints: [
    { id: 'cp-shore', p: [0, TERRACE_Y, 58.5], yaw: 0 },            // flat 1.40 — before the ice
    { id: 'cp-northshore', p: [0, TERRACE_Y, 30.0], yaw: 0 },       // flat 1.40 — off the ice, before the climb
    // G2 validation 2026-09-04: was [0, VILLAGE_Y, 8.0] — the SAME point as the
    // EIGHT SIGILS pedestal (r 0.95, h 1.05), so the station pad, ring and light
    // pillar were built inside the stone and a respawn landed on the pedestal top.
    // Now on the trodden track 3.5 m south of it, clear of the square bumbler's
    // patrol box (z 6..11) and under nothing (the pendulum bobs stay > 6 m up).
    { id: 'cp-square', p: [0, VILLAGE_Y, 14.5], yaw: 0 },           // flat 4.70 — before the hillside
    { id: 'cp-ledge', p: [14, LEDGE_Y, -22.0], yaw: 0.53 },         // flat 10.20 — before the gorge and the chapel track
    { id: 'cp-green', p: [0, GREEN_Y, -40.5], yaw: 0 },             // flat 15.10 — before the tower
  ],

  /* ------------------------------------------------------------------------
   * CRESTS — 7. The brief's "timed" bridge crest is a `race` (the only timed
   * crest type the contract has; verdant-3 did the same), and its "vanish"
   * hat is a `wing` hat + rings, because the runtime's `player.power` has no
   * ghost-wall behaviour yet (collide.js reads no power) and the vanish
   * family has no trigger mode — a crest that pretended otherwise would be
   * collectable by walking.
   * --------------------------------------------------------------------- */
  crests: [
    {
      id: 'open', type: 'open', name: 'CREST IN THE BELFRY',
      hint: 'The bell tower is hollow. Kick one wall, then the other.',
      p: [0.8, r2(DECK_TOP + 1.30), -50.9],
    },
    {
      id: 'sigils', type: 'sigils', name: 'EIGHT SIGILS OF THE SNOW',
      hint: 'Lake bed, a roof, a pine, the bells, the bank, the gorge, the nave, the crest.',
      spawnAt: [0, r2(VILLAGE_Y + 1.45), 8],           // on the square's pedestal
    },
    {
      id: 'coins', type: 'coins', name: 'A HUNDRED COINS', threshold: 100,
      hint: '116 are lying about. You can miss sixteen.',
      spawnAt: [-6, r2(TERRACE_Y + 1.45), 58],         // on the shore pedestal
    },
    {
      id: 'secret', type: 'secret', name: 'WHAT THE BARN KEEPS',
      trigger: 'hay-wall-broken',
      hint: 'Past the Gnasher, up the barn steps, pound the hay.',
      spawnAt: [-27.2, r2(BARN_Y + 3.40 + 1.30), 0.5],  // the loft gantry, past the wall
    },
    {
      id: 'race', type: 'race', name: 'THE LAKE RUN',
      hint: 'Shore to belfry. Sixty seconds. The sleigh does not count.',
      start: [0, TERRACE_Y, 55.0], finish: [-1.5, DECK_TOP, -50.9], limitMs: 60000,
      spawnAt: [-1.5, r2(DECK_TOP + 1.30), -50.9],
    },
    {
      id: 'bell', type: 'race', name: 'THE BELL RUN',
      hint: 'Ring the bell, then the ice bridge: twenty seconds to the knoll.',
      start: [6.2, GREEN_Y, -43.0], finish: [38, KNOLL_Y, -34.0], limitMs: 20000,
      spawnAt: [38, r2(KNOLL_Y + 1.45), -34.0],
    },
    {
      id: 'wing', type: 'power', name: 'THE OWL\'S ROAD', power: 'wing',
      hint: 'Take the hat in the belfry, thread ten rings down to the lake.',
      p: [0, 9.5, 44.0],                                // 8.2 m over the ice: wings only
    },
  ],

  /* ------------------------------------------------------------------------
   * SIGILS — 8, every one on an OPTIONAL line, every one verified against
   * the authored surface it hangs 1.2-1.35 m over (never bare terrain, so
   * the reach gate measures the rise against a real top face).
   * --------------------------------------------------------------------- */
  sigils: [
    { p: [HOLE[0], r2(LAKE_BED + 1.20), HOLE[1]], note: '1 — the lake bed under the hole (floor -1.60, 2.60 m down)' },
    { p: [13.0, r2(CAP_TOP + 1.30), 12.0], note: '2 — the fourth ridge cap, end of the rooftop line (10.55)' },
    { p: [-16.0, r2(gy(-16, 20) + 9.0 + 1.30), 20.0], note: '3 — the crow\'s nest in the old pine (nest top gy + 9.0)' },
    { p: [2.2, r2(CAP_TOP + 1.35), 16.5], note: '4 — between the bells, over the gap onto cap 3' },
    { p: [-6.0, r2(CATCH_TOP + 1.30), -5.5], note: '5 — the CATCH LEDGE under the drift (top 5.90): slide, jump, land' },
    { p: [JUMP_LEDGE[0], r2(JUMP_LEDGE[1] + 1.30), JUMP_LEDGE[2]], note: '6 — the jump ledge in the gorge, off the chute (top 7.00)' },
    { p: [0.0, r2(NAVE_CAP_TOP + 1.25), -41.0], note: '7 — the nave\'s ridge cap, along the tower\'s wall-tops (23.85)' },
    { p: [0.0, r2(SHELF_Y + 0.30 + 1.30), -79.0], note: '8 — the crest shelf, top of the slide (platform 40.40)' },
  ],

  /* ------------------------------------------------------------------------
   * COINS — 116 placed, 100 needed. The track off spawn and across the ice
   * is the only line you cannot miss; everything else pays for a choice.
   * --------------------------------------------------------------------- */
  coins: [
    // BEAT 1 — spawn to the ice, then a ring round the hole so you circle it
    // instead of skating into it. (6 + 8)
    ...trailCoins([[0, 60], [0, 57]], 3, 1.1),
    { line: { a: [0, ICE_TOP + 1.0, 55], b: [0, ICE_TOP + 1.0, 49], n: 3 } },
    { ring: { c: [HOLE[0], 0, HOLE[1]], r: 3.4, n: 8, y: ICE_TOP + 1.0 } },
    // BEAT 1 — the lake bed ring round sigil 1: the reason anyone learns to
    // swim down. (6)
    { ring: { c: [HOLE[0], 0, HOLE[1]], r: 2.4, n: 6, y: LAKE_BED + 0.5 } },
    // BEAT 2 — the trodden track up to the square. (8)
    ...trailCoins([[0, 31], [0, 24], [-1, 16], [0, 10]], 8, 1.1),
    // BEAT 3 — a ring round the square's pedestal. (8)
    { ring: { c: [0, 0, 8], r: 3.8, n: 8, y: VILLAGE_Y + 1.1 } },
    // BEAT 3 — the rooftop line, cap to cap. (6)
    { line: { a: [-9.0, CAP_TOP + 1.0, 16.0], b: [6.0, CAP_TOP + 1.0, 16.0], n: 4 } },
    { p: [9.5, r2(CAP_TOP + 1.2), 14.0] }, { p: [13.0, r2(CAP_TOP + 1.0), 13.0] },
    // BEAT 3 — up the old pine. (5)
    { p: [-17.4, r2(gy(-16, 20) + 2.6), 20.0] }, { p: [-16.0, r2(gy(-16, 20) + 4.0), 21.4] },
    { p: [-14.6, r2(gy(-16, 20) + 5.4), 20.0] }, { p: [-16.0, r2(gy(-16, 20) + 6.8), 18.6] },
    { p: [-17.4, r2(gy(-16, 20) + 8.2), 20.0] },
    // BEAT 4 — five inside the Gnasher's reach, priced from the fence. (5)
    { p: [-19.0, r2(BARN_Y + 1.1), 7.0] }, { p: [-22.0, r2(BARN_Y + 1.1), 8.5] }, { p: [-25.0, r2(BARN_Y + 1.1), 7.0] },
    { p: [-20.5, r2(BARN_Y + 1.1), 4.0] }, { p: [-24.0, r2(BARN_Y + 1.1), 4.5] },
    // BEAT 5 — the hillside track from the square to the ledge. (8)
    ...trailCoins([[2, -1], [6, -8], [10, -14], [13, -19]], 8, 1.1),
    // BEAT 5 — down the drift and over the gap onto the CATCH LEDGE: the shape
    // of the jump you are being asked for. (5)
    ...arcCoins([DRIFT_TOP[0], DRIFT_TOP[1] + 1.0, DRIFT_TOP[2]], [DRIFT_LIP[0], DRIFT_LIP[1] + 1.0, DRIFT_LIP[2]], 0.2, 3),
    ...arcCoins([DRIFT_LIP[0], DRIFT_LIP[1] + 1.0, DRIFT_LIP[2]], [-6.0, CATCH_TOP + 1.0, -5.5], 1.0, 2),
    // BEAT 6 — down the chute and over the gap to the jump ledge. (5)
    ...arcCoins([CHUTE_TOP[0], CHUTE_TOP[1] + 1.0, CHUTE_TOP[2]], [CHUTE_LIP[0], CHUTE_LIP[1] + 1.0, CHUTE_LIP[2]], 0.2, 3),
    ...arcCoins([CHUTE_LIP[0], CHUTE_LIP[1] + 1.0, CHUTE_LIP[2]], [JUMP_LEDGE[0], JUMP_LEDGE[1] + 1.0, JUMP_LEDGE[2]], 1.0, 2),
    // BEAT 6 — a line up the sinking snow pads. (4)
    { p: [28.3, 9.7, -34.3] }, { p: [30.3, 11.2, -35.9] }, { p: [31.6, 12.7, -38.4] }, { p: [33.2, 14.2, -39.4] },
    // BEAT 6 — a ring on the gorge floor round the geyser pad. (6)
    { ring: { c: [23.3, 0, -27.9], r: 2.6, n: 6, y: 6.0 } },
    // BEAT 6 — a line straight across the vanishing ice bridge. (6)
    { line: { a: [19.5, LEDGE_Y + 1.1, -24.8], b: [33.5, KNOLL_Y + 1.0, -32.6], n: 6 } },
    // BEAT 7 — the chapel track, under the bell and up onto the green. (8)
    ...trailCoins([[12, -25], [8, -29], [4, -33], [0, -37]], 8, 1.1),
    // BEAT 8 — a ring round the green's bell frame. (8)
    { ring: { c: [6.2, 0, -43], r: 2.8, n: 8, y: GREEN_Y + 1.1 } },
    // BEAT 8 — up the shaft, for anyone who kicks. (4)
    { line: { a: [0, GREEN_Y + 2.6, TOWER[1]], b: [0, WALL_TOP - 0.4, TOWER[1]], n: 4 } },
    // BEAT 9 — the coin GATES down the crest face, and three on the shelf. (8 + 3)
    ...trailCoins([[0, -75], [1.2, -70], [-1.2, -66], [0.8, -62], [0, -59]], 8, 1.4),
    { line: { a: [-1.6, SHELF_Y + 1.3, -80.5], b: [1.6, SHELF_Y + 1.3, -80.5], n: 3 } },
  ],

  /* ------------------------------------------------------------------------
   * POWERS — one wing hat in the belfry (after the crest, at the top of the
   * ring road) and one on the knoll, because a ring run that starts 60 m
   * from its first ring is a commute.
   * --------------------------------------------------------------------- */
  powers: [
    { kind: 'wing', p: [-1.8, r2(DECK_TOP + 0.9), -49.6], duration: 30 },
    { kind: 'wing', p: [40.0, r2(KNOLL_Y + 0.9), -32.0], duration: 30 },
  ],

  /* ------------------------------------------------------------------------
   * OBJECTS — the built world, beat by beat.
   * --------------------------------------------------------------------- */
  objects: [

    /* ========================================================================
     * BEAT 1 — THE FROZEN LAKE
     * The terrace is EXACTLY 1.40; the ice EXACTLY 1.30 covers the bed out to
     * r 13, where the bank has climbed back to 1.30 on its own, so the sheet
     * simply runs under the snow. Ice is slick (TUNE.ice: accel 9, friction
     * 1.6): the first thing it teaches is that you keep going. The HOLE is a
     * 3 x 3 m plug of thicker ice that only a pound breaks — under it, 2.60 m
     * of water, six coins and sigil 1. Four slabs make the sheet so the hole
     * is a hole and not a decal.
     * ===================================================================== */

    { kind: 'deco', kindOf: 'sign', p: on(3.0, 58, 1.15), s: [0.14, 1.7, 1.2], mat: 'wood', tint: TIMBER },
    { kind: 'deco', kindOf: 'post', p: on(3.0, 58, 0.65), s: [0.16, 1.3, 0.16], mat: 'wood', tint: 0x5c4630 },
    { kind: 'text', p: [3.0, r2(TERRACE_Y + 1.95), 58], rot: [0, 0, 0], text: 'FROST COTTAGE', size: 0.60, color: 0x1f2f45 },
    { kind: 'text', p: [3.0, r2(TERRACE_Y + 1.42), 58], rot: [0, 0, 0], text: 'ICE DOES NOT STOP WHEN YOU DO  ·  LET GO EARLY', size: 0.22, color: 0x3a5270 },
    { kind: 'text', p: [3.0, r2(TERRACE_Y + 1.05), 58], rot: [0, 0, 0], text: 'POUND THE DARK PATCH  ·  CROUCH TO SINK', size: 0.22, color: 0x3a5270 },

    // The sheet: west slab, east slab, and the two strips north and south of
    // the hole. Slab tops all EXACTLY 1.30.
    { kind: 'ice', p: [-4.75, r2(ICE_TOP - 0.15), 44], s: [16.5, 0.3, 26], color: ICE },
    { kind: 'ice', p: [9.75, r2(ICE_TOP - 0.15), 44], s: [6.5, 0.3, 26], color: ICE },
    { kind: 'ice', p: [HOLE[0], r2(ICE_TOP - 0.15), 36.75], s: [3.0, 0.3, 11.5], color: ICE },
    { kind: 'ice', p: [HOLE[0], r2(ICE_TOP - 0.15), 49.75], s: [3.0, 0.3, 14.5], color: ICE },
    // The plug. Darker ice, flush with the sheet; pound it and it is gone.
    { kind: 'breakable', p: [HOLE[0], r2(ICE_TOP - 0.15), HOLE[1]], s: [3.0, 0.3, 3.0], mat: 'ice', tint: ICE_DEEP, drop: 'coins', dropCount: 4, trigger: 'ice-hole-open' },
    { kind: 'text', p: [HOLE[0], r2(ICE_TOP + 1.4), HOLE[1] + 3.6], rot: [0, 0, 0], text: 'THIN ICE', size: 0.24, color: 0x2c5878 },

    // The pedestal the HUNDRED COINS crest lands on, and the north-shore
    // pedestal for the OWL'S ROAD (the wing crest floats over the ice; this
    // is where it is celebrated).
    { kind: 'pedestal', p: [-6, TERRACE_Y, 58], mat: 'stone', tint: STONE, glow: GOLD },
    // The Lake Run start pad, flush with the terrace.
    { kind: 'platform', p: [0, r2(TERRACE_Y - 0.04), 55.0], s: [3.6, 0.2, 3.6], mat: 'stone', tint: 0xc8d4e2 },
    { kind: 'text', p: [0, r2(TERRACE_Y + 1.3), 55.0], rot: [0, 0, 0], text: 'THE LAKE RUN  ·  60s', size: 0.26, color: 0x3a5270 },
    { kind: 'light', p: [0, 4.5, 44], color: 0x8fd8ff, intensity: 5, distance: 24 },

    // Lantern posts along the shore path, both banks.
    { kind: 'deco', kindOf: 'lantern', p: on(-3.2, 56, 2.2), s: [0.5, 0.7, 0.5], mat: 'metal', tint: WARM, count: 2, spread: 2.0, jitter: 0.2 },
    { kind: 'deco', kindOf: 'post', p: on(-3.2, 56, 0.9), s: [0.16, 1.8, 0.16], mat: 'wood', tint: 0x5c4630, count: 2, spread: 2.0, jitter: 0.2 },
    { kind: 'light', p: on(-3.2, 56, 2.2), color: WARM, intensity: 5, distance: 12 },

    /* ========================================================================
     * BEAT 2 — THE NORTH SHORE
     * Off the ice at r 13 (the bank is back to 1.30 there), across the last
     * of the terrace (cp2 at 33), then the trodden track up 3 m of hillside
     * to the square: 19 deg, never more. A fence keeps the line.
     * ===================================================================== */

    ...fenceRun([[-6, 30], [-6, 24], [-7, 18]]),
    ...fenceRun([[6, 30], [6, 24], [7, 18]]),
    { kind: 'pedestal', p: [6, TERRACE_Y, 34], mat: 'stone', tint: STONE, glow: AURORA },
    { kind: 'text', p: [6, r2(TERRACE_Y + 1.6), 34], rot: [0, 0, 0], text: 'THE OWL\'S ROAD ENDS HERE', size: 0.22, color: 0x3a5270 },

    /* ========================================================================
     * BEAT 3 — THE VILLAGE
     * The square is EXACTLY 4.40. Four cottages stand in a row along its
     * north side, and every one carries a SNOW CAP on its ridge: a 0.5 m slab,
     * top at 10.25, that turns a roof into a platform and reads as the snow it
     * is. The rooftop line is a detour, not a climb: three snow blocks and a
     * lean-to make a 1.35-1.5 m staircase up to cap 1, the caps are 0.7-2.4 m
     * apart, and between caps 2 and 3 two BELLS swing across the gap on a
     * 2.4 s period, with sigil 4 hanging in the middle of it.
     * ===================================================================== */

    { kind: 'building', style: 'cottage', p: seat(-9, 16, COT_H, 0.25), s: [6.0, COT_H, COT_D], mat: 'plaster', tint: PLASTER, footing: 1.5 },
    { kind: 'building', style: 'cottage', p: seat(-1.5, 18, COT_H, 0.25), s: [6.0, COT_H, COT_D], mat: 'plaster', tint: PLASTER, footing: 1.5 },
    { kind: 'building', style: 'cottage', p: seat(6, 16, COT_H, 0.25), s: [6.0, COT_H, COT_D], mat: 'plaster', tint: PLASTER, footing: 1.5 },
    { kind: 'building', style: 'cottage', p: seat(13, 12, COT_H, 0.25), s: [6.0, COT_H, COT_D], mat: 'plaster', tint: PLASTER, footing: 1.5 },
    // The four snow caps, tops EXACTLY 10.25.
    { kind: 'platform', p: [-9, r2(CAP_TOP - 0.25), 16], s: [6.8, 0.5, 1.6], mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-1.5, r2(CAP_TOP - 0.25), 18], s: [6.8, 0.5, 1.6], mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [6, r2(CAP_TOP - 0.25), 16], s: [6.8, 0.5, 1.6], mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [13, r2(CAP_TOP - 0.25), 12], s: [6.8, 0.5, 1.6], mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    // The way up: two snow blocks (5.90, 7.40), the lean-to (8.90), cap 1
    // (10.25). Every riser <= 1.5 m, every gap under a metre.
    { kind: 'platform', p: [-14.6, r2(VILLAGE_Y + 0.75), 11.8], s: [1.7, 1.5, 1.7], mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-14.6, r2(VILLAGE_Y + 2.25), 13.6], s: [1.7, 1.5, 1.7], mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-13.4, r2(VILLAGE_Y + 4.30), 15.6], s: [2.6, 0.4, 2.4], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'post', p: on(-14.5, 16.6, 2.1), s: [0.18, 4.2, 0.18], mat: 'wood', tint: 0x5c4630, count: 2, spread: 1.8, jitter: 0.1 },
    { kind: 'text', p: [-14.6, r2(VILLAGE_Y + 2.0), 10.4], rot: [0, 0, 0], text: 'THE ROOFS ARE A ROAD', size: 0.22, color: 0x3a5270 },

    // THE BELL GANTRY between caps 2 and 3: two posts, a beam, two bells on
    // 2.6 m arms, axis z so they swing ALONG x — straight across the gap you
    // jump. Ball bottom 10.10 at rest: at cap height (10.25) it takes your
    // legs; on the square (4.40) it never comes near you.
    { kind: 'deco', kindOf: 'post', p: [2.2, r2(VILLAGE_Y + 4.55), 12.4], s: [0.34, 9.1, 0.34], mat: 'wood', tint: TIMBER },
    { kind: 'deco', kindOf: 'post', p: [2.2, r2(VILLAGE_Y + 4.55), 20.6], s: [0.34, 9.1, 0.34], mat: 'wood', tint: TIMBER },
    { kind: 'deco', kindOf: 'panel', p: [2.2, r2(VILLAGE_Y + 9.2), 16.5], s: [0.4, 0.3, 8.6], mat: 'wood', tint: TIMBER },
    { kind: 'pendulum', p: [2.2, r2(VILLAGE_Y + 8.9), 15.0], len: 2.6, ampDeg: 50, period: 2.4, mode: 'ball', radius: 0.6, axis: 'z', mat: 'metal', tint: BELL },
    { kind: 'pendulum', p: [2.2, r2(VILLAGE_Y + 8.9), 18.0], len: 2.6, ampDeg: 50, period: 2.4, phaseCycles: 0.5, mode: 'ball', radius: 0.6, axis: 'z', mat: 'metal', tint: BELL },

    // The square: the EIGHT SIGILS pedestal, the well, a sledge, lanterns.
    { kind: 'pedestal', p: [0, VILLAGE_Y, 8], mat: 'stone', tint: STONE, glow: GOLD },
    { kind: 'deco', kindOf: 'barrel', p: [-3.4, r2(VILLAGE_Y + 0.55), 5.0], s: [1.3, 1.1, 1.3], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'cart', p: [4.6, r2(VILLAGE_Y + 0.45), 4.4], s: [2.2, 0.9, 1.1], rot: [0, 0.4, 0], mat: 'wood', tint: TIMBER },
    { kind: 'deco', kindOf: 'crate', p: [8.5, r2(VILLAGE_Y + 0.4), 8.4], s: [0.86, 0.8, 0.86], rot: [0, 0.3, 0], mat: 'wood', tint: TIMBER, count: 3, spread: 2.0, jitter: 0.3 },
    { kind: 'deco', kindOf: 'lantern', p: [-6.0, r2(VILLAGE_Y + 2.3), 3.0], s: [0.5, 0.7, 0.5], mat: 'metal', tint: WARM, count: 4, spread: 9.0, jitter: 0.3 },
    { kind: 'deco', kindOf: 'post', p: [-6.0, r2(VILLAGE_Y + 0.95), 3.0], s: [0.16, 1.9, 0.16], mat: 'wood', tint: 0x5c4630, count: 4, spread: 9.0, jitter: 0.3 },
    { kind: 'light', p: [0, r2(VILLAGE_Y + 3.2), 10], color: WARM, intensity: 9, distance: 26 },
    { kind: 'light', p: [2.2, r2(VILLAGE_Y + 7.5), 16.5], color: 0xbcd8f5, intensity: 5, distance: 12 },
    { kind: 'text', p: [0, r2(VILLAGE_Y + 2.2), 12.6], rot: [0, 0, 0], text: 'FROST COTTAGE  ·  pop. 4 and a gnasher', size: 0.30, color: 0x1f2f45 },

    // THE OLD PINE at the square's west edge: climbable, with a crow's nest
    // and sigil 3 at the crown.
    { kind: 'tree', p: on(-16, 20, -0.3), h: 9.0, r: 2.6, climbable: true, mat: 'bark', tint: 0x6a5a4a, leafTint: 0x5c7f70, seed: 771 },
    { kind: 'platform', p: [-16, r2(gy(-16, 20) + 8.8), 20], s: [2.4, 0.4, 2.4], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [-13.4, r2(gy(-13.4, 22) + 1.7), 22.0], rot: [0, 0.6, 0], text: 'PRESS INTO THE TRUNK TO CLIMB', size: 0.22, color: 0x3a5270 },

    /* ========================================================================
     * BEAT 4 — THE BARN
     * The yard is EXACTLY 4.90. A chained Gnasher (chain 5.5 m) guards the
     * barn door; a stair up the south wall reaches the LOFT GANTRY on the
     * west gable, and a wall of hay blocks it half-way along. Pound the hay:
     * the secret crest spawns on the far end of the gantry.
     * ===================================================================== */

    { kind: 'building', style: 'cottage', p: seat(-21, 2, 4.4, 0.3), s: [9.0, 4.4, 7.0], mat: 'wood', tint: 0x7a5a40, footing: 1.8 },
    // The stair: 10 risers of 0.34 m up the barn's south face, climbing WEST
    // (ascent direction (-1, 0) => rot.y = atan2(-1, 0) = -PI/2), foot at
    // x -17.9, top at x -21.5, then a step onto the gantry.
    { kind: 'stairs', p: [-19.7, BARN_Y, 6.4], w: 1.6, rise: 0.34, run: 0.40, n: 10, rot: [0, -1.5708, 0], mat: 'wood', tint: TIMBER },
    // The eaves walk along the south face (top 8.40) from the stair head to
    // the corner, then the loft gantry along the west gable, 1.8 m wide, 7 m.
    { kind: 'platform', p: [-24.0, r2(BARN_Y + 3.20), 6.4], s: [5.0, 0.4, 1.6], mat: 'wood', tint: TIMBER },
    { kind: 'platform', p: [-27.2, r2(BARN_Y + 3.20), 3.0], s: [1.8, 0.4, 7.0], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'post', p: [-27.6, r2(BARN_Y + 1.5), 6.2], s: [0.22, 3.0, 0.22], mat: 'wood', tint: 0x5c4630, count: 3, spread: 6.0, jitter: 0.1 },
    // The hay wall. Fills the gantry across its width.
    { kind: 'breakable', p: [-27.2, r2(BARN_Y + 3.40 + 1.05), 2.9], s: [1.8, 2.1, 1.0], mat: 'cloth', tint: 0xd9b95c, drop: 'crest', trigger: 'hay-wall-broken' },
    { kind: 'deco', kindOf: 'panel', p: [-25.6, r2(BARN_Y + 4.4), 0.8], s: [0.12, 1.6, 1.4], mat: 'wood', tint: 0x3a2a1c },
    { kind: 'text', p: [-16.0, r2(BARN_Y + 1.7), 10.4], rot: [0, 0, 0], text: 'POUND THE POST  ·  THREE TIMES', size: 0.26, color: 0x7a2f2f },
    { kind: 'text', p: [-16.0, r2(BARN_Y + 1.3), 10.4], rot: [0, 0, 0], text: 'it can only reach so far', size: 0.20, color: 0x3a5270 },
    ...fenceRun([[-13, 11], [-17, 12], [-22, 12], [-27, 11]]),
    { kind: 'deco', kindOf: 'crate', p: [-15.0, r2(BARN_Y + 0.45), 3.2], s: [0.9, 0.9, 0.9], mat: 'wood', tint: TIMBER, count: 3, spread: 1.6, jitter: 0.3 },
    { kind: 'light', p: [-21, r2(BARN_Y + 3.6), 8.0], color: WARM, intensity: 7, distance: 16 },

    /* ========================================================================
     * BEAT 5 — THE DRIFT  (the slope lesson)
     * The track up the hillside is a 30 deg walk with marker posts. West of it
     * a CORNICE of packed snow (top 9.60, a 1.0 m step up from the hill behind
     * it) launches a 41 deg DRIFT: step on and the snow takes you, 3.4 m down
     * to a lip 0.1 m over the bank. The CATCH LEDGE (top 5.90) is 2.3 m past
     * the lip and 0.7 m lower: jump at the lip and land. Miss and you are on
     * the square with nothing hurt. From the square the ledge is a single
     * jump (+1.2) — the sigil is for doing it the other way. The drift stays
     * 0.1-1.4 m above the snow along its whole length (verified).
     * ===================================================================== */

    { kind: 'deco', kindOf: 'post', p: [3.9, r2(gy(3.9, -5.5) + 1.2), -5.5], s: [0.2, 2.4, 0.2], mat: 'wood', tint: 0x5c4630, count: 6, spread: [10.0, 0, 14.0], jitter: 0.15 },
    { kind: 'text', p: [0, r2(VILLAGE_Y + 2.0), -0.8], rot: [0, 0, 0], text: 'SNOW THIS STEEP SLIDES  ·  JUMP AT THE LIP TO CATCH THE LEDGE', size: 0.24, color: 0x3a5270 },
    { kind: 'text', p: [0, r2(VILLAGE_Y + 1.6), -0.8], rot: [0, 0, 0], text: 'the track is packed — walk it', size: 0.20, color: 0x3a5270 },
    // THE CORNICE. A snow block on the hillside's lip, 3.0 x 2.2, top 9.60.
    { kind: 'platform', p: [-6.0, r2(DRIFT_TOP[1] - 0.6), -13.4], s: [3.0, 1.2, 2.2], mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [-6.0, r2(DRIFT_TOP[1] + 1.5), -14.6], rot: [0, 3.1416, 0], text: 'THE DRIFT  ·  ride it', size: 0.22, color: 0x3a5270 },
    // THE DRIFT itself: 41.4 deg, a slide by construction (slideDeg 38).
    snowRamp(DRIFT_TOP, DRIFT_LIP, 3.0, 0.5, { surface: 'snow' }),
    // THE CATCH LEDGE: top 5.90, 3.2 x 2.2, a 1.2 m face over the square.
    { kind: 'platform', p: [-6.0, r2(CATCH_TOP - 0.5), -5.5], s: [3.2, 1.0, 2.2], mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'snowdrift', p: [-9.8, r2(gy(-9.8, -7.0) + 0.1), -7.0], s: [2.2, 0.7, 1.8], mat: 'snow', tint: SNOW, count: 3, spread: 3.0, jitter: 0.3 },

    /* ========================================================================
     * BEAT 6 — THE HILLSIDE LEDGE, THE CHUTE AND THE GORGE
     * The ledge is EXACTLY 10.20 (cp4). Off its east rim, from a snow block
     * on the lip, a CHUTE of 42 deg snow drops 5.6 m into the gorge to a lip
     * 1.2 m over the floor. The JUMP LEDGE (top 7.00) is 1.9 m on and 1.2 m
     * up: slide the chute, jump at the lip, land. Miss and you are on the
     * gorge floor (3.6-4.6, snow), where a geyser pad on a snow block (apex
     * 8.5, 5.3 m of rise to the ledge) throws you straight back up.
     * From the jump ledge four SINKING SNOW PADS climb 1.5 m at a time to
     * the knoll — or take the VANISHING ICE BRIDGE from the ledge's south-east
     * corner: six tiles, up for 20 s, gone for 8, all on one clock. The Bell
     * Run ends on the knoll.
     * ===================================================================== */

    { kind: 'text', p: [14, r2(LEDGE_Y + 1.9), -18.8], rot: [0, 0, 0], text: 'THE CHUTE  ·  slide, then jump at the lip', size: 0.22, color: 0x3a5270 },
    { kind: 'deco', kindOf: 'snowdrift', p: [10.0, r2(LEDGE_Y + 0.15), -25.0], s: [2.6, 0.8, 2.0], mat: 'snow', tint: SNOW, count: 3, spread: 4.0, jitter: 0.3 },
    // THE LAUNCH BLOCK on the rim (top 11.40), then THE CHUTE: 42.1 deg, a
    // slide by construction (slideDeg 38). The gorge wall (66-71 deg) falls
    // away faster than the slab, so it is in the air the whole way (verified).
    { kind: 'platform', p: [17.0, r2(LEDGE_Y + 0.60), -23.8], s: [2.4, 1.2, 2.4], mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    snowRamp(CHUTE_TOP, CHUTE_LIP, 3.0, 0.5, { surface: 'snow' }),
    // THE JUMP LEDGE over the gorge floor: top 7.00, sigil 6 over it.
    { kind: 'platform', p: [JUMP_LEDGE[0], r2(JUMP_LEDGE[1] - 0.5), JUMP_LEDGE[2]], s: [3.0, 1.0, 3.0], mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    // The geyser pad at the head of the gorge, on a snow block (top 4.90) so
    // its corners clear the 66 deg walls: apex 8.5 m, straight up, 4.9 m from
    // the ledge's core (the pad's reach at a 5.3 m rise is 8.2 m).
    { kind: 'platform', p: [23.3, 4.40, -27.9], s: [2.4, 1.0, 2.4], mat: 'snow', tint: SNOW },
    { kind: 'jumppad', p: [23.3, 5.04, -27.9], s: [2.4, 0.28, 2.4], power: 8.5, dir: [0, 1, 0], mat: 'rubber', tint: 0x54c4d8 },
    { kind: 'text', p: [23.3, 6.6, -25.4], rot: [0, 0, 0], text: 'STAND ON IT', size: 0.24, color: 0x3a5270 },
    // Four sinking snow pads up to the knoll: tops 8.50 / 10.00 / 11.50 /
    // 13.00, then the knoll at 12.80 — 1.5 m risers, gaps under a metre,
    // each pad clear of the gorge wall at every corner (verified).
    { kind: 'sinker', p: [28.3, 8.20, -34.3], s: [2.4, 0.6, 2.4], delay: 0.9, speed: 1.1, rise: 1.6, depth: 4.0, mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    { kind: 'sinker', p: [30.3, 9.70, -35.9], s: [2.4, 0.6, 2.4], delay: 0.9, speed: 1.1, rise: 1.6, depth: 4.0, mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    { kind: 'sinker', p: [31.6, 11.20, -38.4], s: [2.4, 0.6, 2.4], delay: 0.9, speed: 1.1, rise: 1.6, depth: 4.0, mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    { kind: 'sinker', p: [33.2, 12.70, -39.4], s: [2.4, 0.6, 2.4], delay: 0.9, speed: 1.1, rise: 1.6, depth: 4.0, mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    // THE VANISHING ICE BRIDGE: six tiles from (19,-24.5) to (34,-33),
    // rising 10.4 -> 12.8, each a 0.4 m step from the last.
    ...Array.from({ length: 6 }, (_, i) => {
      const t = (i + 0.5) / 6;
      return {
        kind: 'vanish', p: [r2(19.0 + 15.0 * t), r2(LEDGE_Y + 0.2 + (KNOLL_Y - LEDGE_Y) * t), r2(-24.5 - 8.5 * t)], s: [2.8, 0.4, 2.8],
        mode: 'cycle', cycle: { on: 20.0, off: 8.0, warn: 1.2, phase: 0 }, mat: 'ice', tint: AURORA, stripe: true, edge: SAFE_EDGE,
      };
    }),
    { kind: 'text', p: [18.6, r2(LEDGE_Y + 1.7), -22.6], rot: [0, -0.9, 0], text: 'THE ICE BRIDGE HOLDS FOR TWENTY SECONDS', size: 0.22, color: 0x3a5270 },
    // The knoll: the Bell Run finish, a pedestal, a cairn.
    { kind: 'platform', p: [38, r2(KNOLL_Y - 0.04), -34], s: [3.6, 0.2, 3.6], mat: 'stone', tint: 0xc8d4e2 },
    { kind: 'text', p: [38, r2(KNOLL_Y + 1.3), -34], rot: [0, 0, 0], text: 'FINISH', size: 0.30, color: 0x3a5270 },
    { kind: 'deco', kindOf: 'monolith', p: [41.5, r2(KNOLL_Y + 1.3), -36.5], s: [1.0, 2.6, 0.9], mat: 'stone', tint: STONE },
    { kind: 'light', p: [27, 9.5, -32], color: 0x8fd8ff, intensity: 6, distance: 16 },
    { kind: 'light', p: [38, r2(KNOLL_Y + 3.0), -34], color: AURORA, intensity: 6, distance: 16 },

    /* ========================================================================
     * BEAT 7 — THE CHAPEL TRACK
     * From the ledge the track climbs north-west round the green's south rim
     * (34 deg at the steepest, a walk) with marker posts, under a BELL FRAME
     * straddling it at (6,-31): a bell on a 2.6 m arm, axis z, swinging along
     * x — straight across the track. Ball bottom 1.05 m over the snow: time it
     * or take it in the legs.
     * ===================================================================== */

    { kind: 'deco', kindOf: 'post', p: [11.0, r2(gy(11, -26) + 1.2), -26.0], s: [0.2, 2.4, 0.2], mat: 'wood', tint: 0x5c4630, count: 5, spread: [10.0, 0, 10.0], jitter: 0.15 },
    { kind: 'deco', kindOf: 'post', p: [6.0, r2(gy(6, -31) + 2.1), -33.2], s: [0.3, 4.2, 0.3], mat: 'wood', tint: TIMBER, count: 2, spread: [0, 0, 4.4], jitter: 0 },
    { kind: 'deco', kindOf: 'panel', p: [6.0, r2(gy(6, -31) + 4.3), -31.0], s: [0.36, 0.3, 4.8], mat: 'wood', tint: TIMBER },
    { kind: 'pendulum', p: [6.0, r2(gy(6, -31) + 4.2), -31.0], len: 2.6, ampDeg: 48, period: 2.6, mode: 'ball', radius: 0.55, axis: 'z', mat: 'metal', tint: BELL },
    { kind: 'text', p: [9.0, r2(LEDGE_Y + 1.5), -26.4], rot: [0, 0.9, 0], text: 'MIND THE BELL', size: 0.22, color: 0x3a5270 },
    { kind: 'deco', kindOf: 'lantern', p: [-1.0, r2(gy(-1, -36) + 2.2), -36.0], s: [0.5, 0.7, 0.5], mat: 'metal', tint: WARM },
    { kind: 'deco', kindOf: 'post', p: [-1.0, r2(gy(-1, -36) + 0.9), -36.0], s: [0.16, 1.8, 0.16], mat: 'wood', tint: 0x5c4630 },

    /* ========================================================================
     * BEAT 8 — THE CHAPEL
     * Green EXACTLY 15.10 (cp5). The NAVE (a stone cottage 12 x 5.5 x 8,
     * pitched roof) with a snow cap on its ridge at 23.85; hard against its
     * north wall THE BELL TOWER: four slabs 0.4 thick leaving a 3.20 x 3.20 m
     * shaft, walls 15.10 -> 23.10, a 1.10 x 2.40 m doorway in the EAST face.
     * One jump plus four wall kicks and you come out over the north wall
     * onto the BELFRY DECK (23.10), where the crest waits and a wing hat sits
     * beside it. The wall-tops (0.40 wide) run back to the nave's cap and
     * sigil 7 — the riskiest line on the course, and entirely optional.
     * The SLEIGH LIFT boards at the foot of the crest face east of the tower.
     * ===================================================================== */

    { kind: 'building', style: 'cottage', p: [-2, r2(GREEN_Y + 5.5 / 2 - 0.2), -41.0], s: [12.0, 5.5, 8.0], mat: 'stone', tint: STONE, footing: 1.8 },
    { kind: 'platform', p: [-2, r2(NAVE_CAP_TOP - 0.25), -41.0], s: [12.8, 0.5, 1.6], mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    // The tower. West and east faces run 0.4 past the north face so the
    // north wall is boxed in; the east face is split round the doorway.
    { kind: 'platform', p: [-1.8, r2(GREEN_Y + 4.0), -47.2], s: [0.4, 8.0, 4.4], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [0, r2(GREEN_Y + 4.0), -48.8], s: [3.2, 8.0, 0.4], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [0, r2(GREEN_Y + 4.0), -45.2], s: [3.2, 8.0, 0.4], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [1.8, r2(GREEN_Y + 4.0), -48.35], s: [0.4, 8.0, 2.1], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [1.8, r2(GREEN_Y + 4.0), -45.75], s: [0.4, 8.0, 1.0], mat: 'stone', tint: STONE },
    { kind: 'platform', p: [1.8, r2(GREEN_Y + 2.4 + 5.6 / 2), -46.75], s: [0.4, 5.6, 1.1], mat: 'stone', tint: STONE },
    // The shaft floor, flush with the green (a real rect for the reach gate).
    { kind: 'platform', p: [0, r2(GREEN_Y - 0.25), -47.0], s: [3.2, 0.5, 3.2], mat: 'stone', tint: 0xa8b4c2 },
    // THE BELFRY DECK on the north face, top 23.10.
    { kind: 'platform', p: [0, r2(DECK_TOP - 0.2), -50.9], s: [5.0, 0.4, 3.6], mat: 'stone', tint: STONE, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'pillar', p: [-2.2, r2(DECK_TOP + 1.4), -52.5], s: [0.4, 2.8, 0.4], mat: 'stone', tint: STONE, count: 2, spread: [4.4, 0, 0], jitter: 0 },
    { kind: 'deco', kindOf: 'panel', p: [0, r2(DECK_TOP + 3.05), -50.9], s: [5.6, 0.3, 4.2], mat: 'copper', tint: 0x7a9a8a },
    { kind: 'deco', kindOf: 'banner', p: [-2.6, r2(GREEN_Y + 4.8), -47.0], s: [0.08, 2.6, 1.3], mat: 'cloth', tint: 0x6a5fa8 },
    { kind: 'text', p: [3.1, r2(GREEN_Y + 2.9), -47.0], rot: [0, 1.5708, 0], text: 'KICK ONE WALL, THEN THE OTHER', size: 0.20, color: 0xd8c79a },
    { kind: 'light', p: [0, r2(GREEN_Y + 6.0), -47.0], color: 0xbcd8f5, intensity: 5, distance: 10 },
    { kind: 'light', p: [0, r2(DECK_TOP + 2.2), -50.9], color: GOLD, intensity: 9, distance: 18 },
    { kind: 'light', p: [-2, r2(GREEN_Y + 4.0), -36.0], color: WARM, intensity: 8, distance: 22 },
    { kind: 'deco', kindOf: 'lantern', p: [4.2, r2(GREEN_Y + 2.3), -44.0], s: [0.5, 0.7, 0.5], mat: 'metal', tint: WARM, count: 2, spread: 4.0, jitter: 0.2 },
    { kind: 'deco', kindOf: 'post', p: [4.2, r2(GREEN_Y + 0.95), -44.0], s: [0.16, 1.9, 0.16], mat: 'wood', tint: 0x5c4630, count: 2, spread: 4.0, jitter: 0.2 },

    // THE GREEN'S BELL and the Bell Run start pad, flush with the green,
    // east of the nave inside the level core.
    { kind: 'platform', p: [6.2, r2(GREEN_Y - 0.04), -43.0], s: [3.4, 0.2, 3.4], mat: 'stone', tint: 0xc8d4e2 },
    { kind: 'text', p: [6.2, r2(GREEN_Y + 1.3), -43.0], rot: [0, 0, 0], text: 'THE BELL RUN  ·  20s', size: 0.26, color: 0x3a5270 },
    { kind: 'deco', kindOf: 'post', p: [8.4, r2(GREEN_Y + 1.6), -43.0], s: [0.3, 3.2, 0.3], mat: 'wood', tint: TIMBER },
    { kind: 'deco', kindOf: 'lantern', p: [8.4, r2(GREEN_Y + 3.4), -43.0], s: [0.8, 0.9, 0.8], mat: 'metal', tint: BELL },

    // THE SLEIGH LIFT: a timber sleigh on a cable, 15.40 -> 40.40 in 18 s
    // with a 3 s dwell at each end. Board on the green, step off on the shelf.
    {
      kind: 'mover', p: LIFT_BOT, s: [3.2, 0.5, 2.4],
      motion: { type: 'linear', to: LIFT_TOP, period: 18.0, phase: 0, ease: 'inout', dwell: 3.0 },
      mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE,
    },
    { kind: 'deco', kindOf: 'post', p: [8.2, r2(GREEN_Y + 3.0), -50.0], s: [0.5, 6.0, 0.5], mat: 'wood', tint: TIMBER },
    { kind: 'deco', kindOf: 'post', p: [6.2, r2(SHELF_Y + 3.0), -76.0], s: [0.5, 6.0, 0.5], mat: 'wood', tint: TIMBER },
    { kind: 'text', p: [5, r2(GREEN_Y + 1.7), -47.6], rot: [0, 3.1416, 0], text: 'THE SLEIGH  ·  ride it to the top of the face', size: 0.22, color: 0x3a5270 },

    /* ========================================================================
     * BEAT 9 — THE CREST FACE  (the set piece)
     * The shelf is EXACTLY 40.10; south of it the face falls 43-52 deg for 20 m
     * to a 24 deg run-in above the green's north rim. Coin gates mark the line.
     * At the run-in THE KICKER: a 29 deg timber ramp, foot on the snow at
     * z -61.5, lip 2.2 m up and 4 m on — 3.2 m above the ground that has fallen
     * away under it. Hit it at speed, jump at the lip, and 4.8 m on the BELFRY
     * DECK (23.10) is 0.6 m below you. Overshoot and it is the green (15.10).
     * Sigil 8 is on the shelf, for anyone who rides up and looks around.
     * ===================================================================== */

    { kind: 'platform', p: [0, r2(SHELF_Y + 0.10), -79.0], s: [3.0, 0.4, 3.0], mat: 'snow', tint: SNOW, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [0, r2(SHELF_Y + 2.1), -75.2], rot: [0, 3.1416, 0], text: 'THE CREST FACE', size: 0.44, color: 0x1f2f45 },
    { kind: 'text', p: [0, r2(SHELF_Y + 1.6), -75.2], rot: [0, 3.1416, 0], text: 'RIDE IT DOWN  ·  JUMP AT THE LIP OF THE KICKER', size: 0.22, color: 0x3a5270 },
    { kind: 'deco', kindOf: 'flagpole', p: [-3.0, r2(SHELF_Y + 1.9), -80.0], s: [0.12, 3.8, 0.12], mat: 'wood', tint: TIMBER, count: 2, spread: [6.0, 0, 0], jitter: 0 },
    { kind: 'deco', kindOf: 'banner', p: [-3.0, r2(SHELF_Y + 3.0), -80.0], s: [0.08, 1.4, 1.0], mat: 'cloth', tint: 0x6a5fa8, count: 2, spread: [6.0, 0, 0], jitter: 0 },
    // Gate poles down the face, either side of the coin line.
    { kind: 'deco', kindOf: 'flagpole', p: [-2.6, r2(gy(-2.6, -68) + 1.3), -68.0], s: [0.1, 2.6, 0.1], mat: 'wood', tint: 0xd94b4b, count: 4, spread: [0, 0, 12.0], jitter: 0.1 },
    { kind: 'deco', kindOf: 'flagpole', p: [2.6, r2(gy(2.6, -68) + 1.3), -68.0], s: [0.1, 2.6, 0.1], mat: 'wood', tint: 0x4b7ad9, count: 4, spread: [0, 0, 12.0], jitter: 0.1 },
    // THE KICKER.
    snowRamp(KICK_FOOT, KICK_LIP, 3.4, 0.5, { mat: 'wood', tint: TIMBER, surface: 'wood', stripe: true, edge: SAFE_EDGE }),
    { kind: 'deco', kindOf: 'buttress', p: [0, r2((gy(0, -58.2) + KICK_LIP[1] - 0.6) / 2), -58.2], s: [3.0, r2(KICK_LIP[1] - 0.6 - gy(0, -58.2)), 1.4], mat: 'wood', tint: 0x6a4e34 },
    { kind: 'light', p: [0, r2(SHELF_Y + 3.0), -79.0], color: AURORA, intensity: 6, distance: 18 },

    /* ========================================================================
     * BEAT 10 — THE OWL'S ROAD  (the ring overlay)
     * Take the hat in the belfry and thread ten rings that descend the
     * hillside in a wide S from 27 to 7, over the lake, to the crest floating
     * 8 m above the ice. The only time the course lets you see its own shape.
     * ===================================================================== */

    {
      kind: 'rings', r: 2.6, tint: AURORA, mat: 'gold',
      pts: Array.from({ length: 10 }, (_, i) => {
        const t = i / 9;
        const x = Math.sin(t * Math.PI * 2.2) * 22;              // a wide S across the hill
        const z = -48 + t * 86;                                 // green -> lake
        return [r2(x), r2(27 - t * 20 + Math.sin(t * Math.PI) * 4), r2(z)];
      }),
    },

    /* ========================================================================
     * DRESSING — pines, drifts, rocks, fences.
     * Every scatter is seeded by ihash, so the hillside dresses itself
     * identically on every load. Nothing lands on the lake, in the square, on
     * a ramp, in the gorge crossing, in the shaft or on the slide (KEEPOUT).
     * ===================================================================== */

    ...scatter(-30, 38, 6, 20, 6, 9101, (x, z, rnd) => (
      gy(x, z) < 1.5 ? null
        : { kind: 'tree', p: on(x, z, -0.3), h: 6.5 + rnd * 4.0, r: 2.0 + rnd * 1.0, mat: 'bark', tint: 0x6a5a4a, leafTint: 0x5c7f70, seed: 9101 + Math.round(x) }
    )),
    ...scatter(32, 36, 6, 20, 6, 9102, (x, z, rnd) => (
      gy(x, z) < 1.5 ? null
        : { kind: 'tree', p: on(x, z, -0.3), h: 6.0 + rnd * 4.0, r: 1.9 + rnd * 1.0, mat: 'bark', tint: 0x6a5a4a, leafTint: 0x5c7f70, seed: 9102 + Math.round(x) }
    )),
    ...scatter(-28, -20, 6, 18, 5, 9103, (x, z, rnd) => (
      { kind: 'tree', p: on(x, z, -0.3), h: 6.0 + rnd * 4.0, r: 1.9 + rnd * 1.0, mat: 'bark', tint: 0x6a5a4a, leafTint: 0x5c7f70, seed: 9103 + Math.round(x) }
    )),
    ...scatter(30, -6, 6, 16, 4, 9104, (x, z, rnd) => (
      { kind: 'tree', p: on(x, z, -0.3), h: 5.5 + rnd * 3.5, r: 1.8 + rnd * 0.9, mat: 'bark', tint: 0x6a5a4a, leafTint: 0x5c7f70, seed: 9104 + Math.round(x) }
    )),
    ...scatter(-22, -50, 6, 18, 4, 9105, (x, z, rnd) => (
      { kind: 'tree', p: on(x, z, -0.3), h: 5.0 + rnd * 3.0, r: 1.7 + rnd * 0.8, mat: 'bark', tint: 0x6a5a4a, leafTint: 0x5c7f70, seed: 9105 + Math.round(x) }
    )),

    ...scatter(0, 40, 14, 24, 8, 9201, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'snowdrift', p: on(x, z, 0.05), s: [1.6 + rnd * 1.6, 0.5 + rnd * 0.4, 1.4 + rnd * 1.3], mat: 'snow', tint: SNOW, count: 4, spread: 3.2, jitter: 0.35 }
    )),
    ...scatter(0, 8, 13, 26, 8, 9202, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'snowdrift', p: on(x, z, 0.05), s: [1.5 + rnd * 1.5, 0.5 + rnd * 0.4, 1.3 + rnd * 1.2], mat: 'snow', tint: SNOW, count: 4, spread: 3.2, jitter: 0.35 }
    )),
    ...scatter(0, -46, 14, 30, 8, 9203, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'snowdrift', p: on(x, z, 0.05), s: [1.5 + rnd * 1.5, 0.5 + rnd * 0.4, 1.3 + rnd * 1.2], mat: 'snow', tint: SNOW, count: 4, spread: 3.0, jitter: 0.35 }
    )),
    ...scatter(-40, 0, 6, 22, 6, 9204, (x, z, rnd) => (
      { kind: 'rock', p: on(x, z, -0.35), r: 0.9 + rnd * 1.4, seed: 9204 + Math.round(x), mat: 'stone' }
    )),
    ...scatter(44, 0, 6, 22, 6, 9205, (x, z, rnd) => (
      { kind: 'rock', p: on(x, z, -0.35), r: 0.9 + rnd * 1.4, seed: 9205 + Math.round(x), mat: 'stone' }
    )),
    ...scatter(24, -50, 3, 12, 5, 9206, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'icicle', p: on(x, z, 1.0 + rnd), s: [0.4, 1.2 + rnd, 0.4], mat: 'ice', tint: ICE, count: 5, spread: 2.4, jitter: 0.3 }
    )),

    // A paddock fence behind spawn, so the shore has a human edge.
    ...fenceRun([[-12, 66], [-5, 67], [5, 67], [12, 66]]),
  ],

  /* ------------------------------------------------------------------------
   * CRITTERS
   * --------------------------------------------------------------------- */
  critters: [
    // THE GNASHER at the barn door. Post 4 m in front of the door, chain 5.5:
    // its reach covers the door and the foot of the stair, not the fence.
    {
      kind: 'gnasher', p: [-19.0, BARN_Y, 8.0], chain: 5.5,
      post: [-19.0, BARN_Y, 8.6], postHits: 3, trigger: 'gnasher-freed',
      telegraph: 0.5, tint: 0x3a4a5c,
    },
    // BUMBLERS in scarves. Side contact = knockback, not death (contract §23).
    // Data lane 2026-09-04: this loop ran 1.5-6.5 m BEHIND cp-shore, i.e. through
    // the spawn camera's corridor — the validation shot has it filling the
    // bottom-right of the first frame. Same shore, now east of the pad.
    { kind: 'bumbler', path: [[7, TERRACE_Y, 60], [12, TERRACE_Y, 62], [11, TERRACE_Y, 66], [6, TERRACE_Y, 65], [7, TERRACE_Y, 60]], speed: 1.4 },
    { kind: 'bumbler', path: [[-5, VILLAGE_Y, 6], [5, VILLAGE_Y, 6], [5, VILLAGE_Y, 11], [-5, VILLAGE_Y, 11], [-5, VILLAGE_Y, 6]], speed: 1.6 },
    { kind: 'bumbler', path: [[-5, GREEN_Y, -47], [-3, GREEN_Y, -51], [-6, GREEN_Y, -50], [-5, GREEN_Y, -47]], speed: 1.5 },
    // SNOW OWLS. One over the lake (it swoops at anyone on the ice), one
    // patrolling the gorge crossing.
    { kind: 'skitter', p: [0, 5.5, 44], path: [[-8, 5.0, 50], [8, 6.4, 38]], amp: 1.6, speed: 3.2 },
    { kind: 'skitter', p: [26, 17.0, -29], path: [[18, 16.5, -25], [36, 19.0, -34]], amp: 2.0, speed: 3.6 },
  ],
};
