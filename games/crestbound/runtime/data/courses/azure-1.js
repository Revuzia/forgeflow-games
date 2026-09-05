/**
 * CRESTBOUND — AZURE SANCTUM 1 : "TIDEWELL TEMPLE"
 * runtime/data/courses/azure-1.js                                   CONTRACT §25
 * ===========================================================================
 *
 * Difficulty 7. The first AZURE course and the game's swimming course: a
 * sunlit lagoon inside a reef ring, with a half-drowned sea-temple standing on
 * a limestone shelf in the north of it. The diorama is 104 x 116 m and runs
 * from the tidewell floor at -6.40 to the sanctum crest at +16.45 — 22.85 m of
 * verticality, most of it read from the water.
 *
 * The realm's verb is BUOYANCY: everything here is about giving the floor away
 * and taking it back. You swim to the temple, you climb out of the sea onto its
 * steps, and every optional line goes back UNDER.
 *
 *   BEAT 1  THE SHORE        the beach, the wading shelf, the first dive
 *   BEAT 2  THE LAGOON       currents, sinking coral pads, the shoal (cp2)
 *   BEAT 3  THE FORECOURT    a 5.60 m dive into the drowned forecourt: the eel,
 *                            the sunken colonnade, the first underwater sigil
 *   BEAT 4  THE GREAT STAIR  the SET PIECE — 35 steps climbing straight out of
 *                            the sea onto the temple terrace (cp3)
 *   BEAT 5  THE TERRACE      beam tripwires, urns, the temple itself
 *   BEAT 6  THE TIDE SWITCH  pound the pedestal, the sluice gates answer (cp4)
 *   BEAT 7  THE INNER COURT  water wheels, vanish grates, the Warden (cp5)
 *   BEAT 8  THE CISTERN      a 3.20 m wall-kick shaft to the temple roof
 *   BEAT 9  THE SANCTUM      the open crest on the shrine dais
 *   BEAT 10 THE TIDEWELL     the deep well, the metal hat and the coral wall
 *   BEAT 11 STONES / RACE    two optional overlays across the whole lagoon
 *
 * ---------------------------------------------------------------------------
 * ROUTES TO THE OPEN CREST  (all three are STATIC — nothing here is reachable
 * only by riding a mover, which is the rule the Bailey Meadow build paid for)
 * ---------------------------------------------------------------------------
 *   shared spine   spawn 3.00 -> wading shelf 0.55 -> swim the lagoon ->
 *                  shoal 0.60 (cp2) -> dive the forecourt -5.60 ->
 *                  THE GREAT STAIR -> terrace 5.00 (cp3)
 *
 *   ROUTE A  THE CEREMONIAL STAIR   terrace 5.00 -> east flight 1 (15 x 0.30)
 *            -> the pier landing 9.50 -> east flight 2 (16 x 0.30) -> 14.30,
 *            then a 0.09 m step onto the roof deck at 14.21. Always works, and
 *            it is the line the stone causeways and the coin trail both draw.
 *
 *   ROUTE B  THE BROKEN COLONNADE   terrace 5.00 -> six fallen capital drums up
 *            the temple's WEST flank, tops 6.55 / 8.05 / 9.55 / 11.05 / 12.55 /
 *            14.05. Every hop is +1.50 m across a measured 0.50-0.60 m gap —
 *            single-safe there is 3.38 m — then a 0.40 m step onto the roof.
 *            Sigil 7 sits on drum three.
 *
 *   ROUTE C  THE CISTERN SHAFT      terrace 5.00 -> in at the cistern door on
 *            the temple's north face -> a 3.20 m clear shaft, 9.60 m tall: one
 *            jump (apex 1.91) plus FOUR wall kicks at 2.00 m each onto the exit
 *            ledge at 14.60, a 0.39 m step down onto the roof. Sigil 6 is on
 *            the ledge, and it is the only sigil ROUTE C alone can reach.
 *
 *   then     roof 14.21 -> shrine dais 15.11 (a 0.90 m hop) -> CREST 16.45.
 *
 * ---------------------------------------------------------------------------
 * THE TERRAIN SAMPLER — an EXACT replica of runtime/world/terrain.js
 * `sampleHeights()` (the recipe branch), so this file, the built collider and
 * `_harness/reachcheck.mjs` (which imports terrain.js) agree to the millimetre.
 * ---------------------------------------------------------------------------
 * Verified this session over 2000 random (x, z) across the whole footprint:
 * max |terrain.js - this file| = 0.00 m.  Evaluation order, and it MATTERS:
 *
 *   1. y = base
 *   2. HILLS    for each {p:[hx,hz], r, h}: d = hypot(x-hx, z-hz); if d < r,
 *               k = bump(d/r) and y += h * k*k*(3-2k)   (a DOME, not a cone)
 *   3. RIDGES   for each {a, b, w, h}: d = distance to the SEGMENT a..b;
 *               the HALF-WIDTH is w/2 — if d < w/2, y += h * bump(2d/w)
 *   4. NOISE    y += fbm(x*freq, z*freq, seed, 4) * amp     (fbm in [-1, 1])
 *   5. FLATS    for each {p:[fx,fz], r, h} IN ARRAY ORDER: t = d/r; if t < 1,
 *               k = (t <= 0.55 ? 1 : bump((t - 0.55)/0.45));
 *               y += (h - y) * k
 *               => the inner 55 % of a flat is EXACTLY h, and a later flat wins
 *                  over an earlier one wherever the two overlap.
 *
 *   bump(t) = 0.5 * (1 + cos(PI * t)) on 0..1, 1 at or below 0, 0 at or above 1.
 *
 * NOTE FOR ANYONE PORTING verdant-1's HEADER: that file documents a `core`
 * field on a flat and an S()-interpolated value noise. terrain.js reads
 * NEITHER — the flat core is hard-wired at 0.55 and the noise is quintic fbm —
 * so a `core` written here would be silently ignored and every placement made
 * against it would be wrong by up to a metre. This file therefore uses no
 * `core` at all, and its sampler is the shipped one, not an approximation.
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS (contract §25)
 * ---------------------------------------------------------------------------
 *   p            CENTRE, [x, y, z].  s = FULL size => a platform's walkable top
 *                is p[1] + s[1]/2.  A `building`'s FLOOR is p[1] - s[1]/2.
 *   yaw / rot    RADIANS. yaw 0 faces -Z. `stairs` climb toward their LOCAL +Z,
 *                so rot [0, PI, 0] climbs north (-Z) and [0, 0, 0] climbs south.
 *   stripe:true  "you had to jump to get here" — earns the bright leading edge.
 *                Walk-on ground never gets one; no `deco` here is ever flat and
 *                horizontal at knee height, so nothing decorative reads as a
 *                platform.
 *   text         built in the local XY plane facing local +Z, so rot [0,0,0]
 *                faces a player walking north (-Z).
 *
 * ---------------------------------------------------------------------------
 * THE REACH BUDGET ACTUALLY USED  (safe limits from core/tuning.js REACH_TABLE:
 * single 4.52 flat / 3.88 at +1.0 / 3.38 at +1.5 / 3.28 at +1.6; double 5.24;
 * triple 6.11 with 6 m of approach; a straight-up rise of 2.87 m needs no
 * run-up at all)
 * ---------------------------------------------------------------------------
 *   longest REQUIRED gap     0.60 m at +1.50 m   BEAT 9, ROUTE B drum to drum
 *                            (single-safe at +1.50 is 3.38 m: 5.6x the ask)
 *   tallest REQUIRED step    1.50 m              the same hop; a single jump
 *                            apexes at 1.91 m from a standing start
 *   wall-kick shaft          3.20 m clear, 9.60 m tall — 1 jump + 4 kicks
 *   deepest REQUIRED dive    5.60 m              BEAT 3, into the forecourt
 *   longest OPTIONAL gap     4.20 m centre-to-centre (1.80 m edge to edge)
 *                            BEAT 11, tide stone to tide stone
 *   riskiest OPTIONAL line   the tide stones: four `vanish` tiles 0.60 m above
 *                            the sea on a 3.2 s window, over 3 m of water
 * Nothing on a required line needs a triple, a long jump, a dive or a run-up.
 *
 * CONTENT LEDGER: 8 sigils · 7 crests · 114 coins · 5 checkpoints ·
 * families: current, mover, beam, sinker, rotor, vanish, breakable, rings,
 * jumppad + critters gnasher, bumbler x3, skitter x2, warden  (13 families).
 *
 * DEVIATIONS FROM THE BRIEF (recorded, not hidden):
 *  · There is no `tide` hazard family and no way to animate a water volume's
 *    surface from a trigger: hazards/index.js HAZARD_META has no such kind and
 *    fluids.js has no 'tide' behaviour. THE DRAIN IS BUILT INSTEAD OUT OF
 *    `mover` SLUICE GATES — pounding the tide pedestal fires 'tide-drawn', the
 *    three gates in the channel are the visible machinery, and the inner court
 *    is authored ALREADY drained at 1.60 (above the sea at 0.00) so the fiction
 *    and the geometry agree without a mechanic the runtime cannot honour.
 *  · The brief's seventh crest is 'timed' (beat the tide back to the sanctum).
 *    `timed` is not one of the contract's seven crest types (open, sigils,
 *    coins, secret, boss, race, power), so this course ships the `power` crest
 *    instead — 'metal', the hat the brief's own secret already required — and
 *    the tide pressure is carried by the race crest's 60 s limit.
 */

/* ===========================================================================
 * 0. Palette — AZURE SANCTUM
 * ======================================================================== */

const LIME = 0xcfc4a8;       // warm temple limestone, sunlit
const LIME_D = 0x9a8f78;     // wet, shaded limestone below the tide line
const GOLD = 0xffcf4a;       // crest / sigil / coin glow, temple trim
const CORAL = 0xff8a6b;      // coral heads, anemones
const KELP = 0x3f8f6a;       // weed and the green under the water
const WATER_C = 0x3fd2c8;    // the lagoon
const SAFE_EDGE = 0xffd166;  // leading-edge stripe (theme palette safeEdge)
const BEAM_C = 0x7fe8ff;     // the light tripwires
const BANNER = 0x2f7fd0;     // sanctum cloth
const TIMBER = 0x6b5236;     // the wreck

/* ===========================================================================
 * 1. THE HEIGHTFIELD — every `p` in this file is justified against it
 * ======================================================================== */

/** Heightfield definition. Consumed VERBATIM by world/terrain.js (contract §18). */
const HEIGHTS = {
  seed: 20260903,
  base: -3.2,
  hills: [
    // --- the island that closes the diorama on every side. Measured: the
    //     lowest point anywhere on the terrain's perimeter is +0.60 m, so the
    //     player can never swim off the edge of the world. ---
    { p: [0, 56], r: 38, h: 10.2 },     // SOUTH SHORE mound (spawn sits on it)
    { p: [-52, 34], r: 24, h: 8.0 },    // west spit
    { p: [52, 34], r: 24, h: 8.0 },     // east spit
    { p: [-56, -6], r: 26, h: 9.0 },    // west bluff
    { p: [56, -8], r: 26, h: 9.4 },     // east bluff
    { p: [-66, 62], r: 34, h: 11.0 },   // the four corner reefs
    { p: [66, 62], r: 34, h: 11.0 },
    { p: [-66, -62], r: 34, h: 13.0 },
    { p: [66, -62], r: 34, h: 13.0 },
    { p: [-70, 14], r: 26, h: 10.0 },   // the four side reefs
    { p: [70, 14], r: 26, h: 10.0 },
    { p: [-70, -26], r: 26, h: 11.0 },
    { p: [70, -26], r: 26, h: 11.0 },
    // --- the lagoon's own furniture ---
    { p: [0, -26], r: 34, h: 8.6 },     // the limestone shelf the temple stands on
    { p: [0, -66], r: 42, h: 17.0 },    // the north cliff behind the inner court
    { p: [-24, 12], r: 10, h: 3.4 },    // south-west reef knuckle
    { p: [26, 10], r: 10, h: 3.6 },     // south-east reef knuckle
    { p: [-32, -6], r: 12, h: -3.6 },   // THE TIDEWELL — a negative hill is a bowl
  ],
  ridges: [
    // The reef ring. `w` is the FULL width; terrain.js uses w/2 as the falloff
    // radius, so each of these reaches w/2 metres either side of its line.
    { a: [-50, 42], b: [50, 42], w: 20, h: 7.0 },     // south bar, behind the beach
    { a: [-52, -58], b: [52, -58], w: 26, h: 11.0 },  // the north cliff wall
    { a: [-52, 50], b: [52, 50], w: 26, h: 9.0 },     // the south wall
    { a: [-44, -34], b: [-44, 42], w: 26, h: 7.5 },   // west reef wall
    { a: [44, -34], b: [44, 42], w: 26, h: 7.5 },     // east reef wall
    { a: [-50, -34], b: [50, -34], w: 20, h: 7.0 },   // the inner bar under the court
    { a: [-34, 24], b: [34, 24], w: 22, h: 2.4 },     // the shallow outer reef bar
    { a: [-26, -40], b: [26, -40], w: 20, h: 3.0 },   // the court's own bar
  ],
  flats: [
    // ORDER MATTERS: a later flat wins wherever two overlap.
    { p: [0, 46], r: 16, h: 3.00 },     // THE SHORE             (spawn, cp1)
    { p: [0, 33], r: 9, h: 0.55 },      // the wading shelf      (the first dive)
    { p: [-26, 24], r: 8, h: 0.80 },    // west reef pad
    { p: [26, 22], r: 8, h: 0.80 },     // east reef pad
    { p: [0, 12], r: 9, h: 0.60 },      // THE SHOAL             (cp2)
    { p: [0, -24], r: 24, h: 5.00 },    // THE TEMPLE TERRACE    (cp3, cp4)
    { p: [0, 0], r: 10, h: -5.60 },     // THE DROWNED FORECOURT
    { p: [0, -46], r: 13, h: 1.60 },    // THE INNER COURT       (cp5)
    { p: [-32, -6], r: 7, h: -6.40 },   // THE TIDEWELL floor
  ],
  noise: { amp: 0.35, freq: 0.05 },
};

/* --- the sampler (formula in the header; byte-for-byte terrain.js) -------- */

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

/** Fractal value noise in roughly [-1, 1]. Gain 0.5, lacunarity 2.03. */
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

/** Smooth radial falloff: 1 at the centre, 0 at (and past) the rim. */
function bump(t) {
  if (t >= 1) return 0;
  if (t <= 0) return 1;
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

/** Distance from (px,pz) to the SEGMENT a->b in the XZ plane (clamped). */
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
 * numerically identical to `sampleHeights(HEIGHTS)` from world/terrain.js.
 * Exported so terrain.js can assert its baked field matches and the reach
 * harness can walk the surface without building a mesh.
 */
export function terrainHeightAt(x, z) {
  let y = HEIGHTS.base;
  for (let i = 0; i < HEIGHTS.hills.length; i++) {
    const H = HEIGHTS.hills[i];
    const dd = Math.hypot(x - H.p[0], z - H.p[1]);
    if (dd < H.r) { const k = bump(dd / H.r); y += H.h * (k * k * (3 - 2 * k)); }
  }
  for (let i = 0; i < HEIGHTS.ridges.length; i++) {
    const R = HEIGHTS.ridges[i];
    const w = R.w * 0.5;
    const dd = segDist(x, z, R.a[0], R.a[1], R.b[0], R.b[1]);
    if (dd < w) y += R.h * bump(dd / w);
  }
  y += fbm(x * HEIGHTS.noise.freq, z * HEIGHTS.noise.freq, HEIGHTS.seed, 4) * HEIGHTS.noise.amp;
  for (let i = 0; i < HEIGHTS.flats.length; i++) {
    const F = HEIGHTS.flats[i];
    const dd = Math.hypot(x - F.p[0], z - F.p[1]);
    if (dd < F.r) {
      const t = dd / F.r;
      const k = t <= 0.55 ? 1 : bump((t - 0.55) / 0.45);
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
 * a trail in a lagoon this lumpy; this cannot.
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
 * KEEP-OUT VOLUMES. The dressing blocks below scatter coral, kelp and fallen
 * masonry over the whole lagoon; these rectangles are what stops a scatter
 * planting a 2 m coral head inside the cistern shaft, on the great stair, or in
 * the Warden's ring. That is not a hypothetical: verdant-1's wall-kick shaft
 * was unplayable for a whole round because one scattered tree landed in it, and
 * dropping the candidates HERE rather than inside each `make` is what stops a
 * call site forgetting. Rects are [x0, x1, z0, z1] in metres, already margined.
 */
const KEEPOUT = [
  [-16.0, 16.0, -38.5, -13.0],   // BEATS 4-9: the temple, its terrace walk, the
                                 //            colonnade, the east stair, the cistern
  [-7.0, 7.0, -12.0, 8.0],       // BEAT 4: the great stair and both its landings
  [-9.5, 9.5, -55.0, -38.0],     // BEAT 7: the inner court and the Warden's ring
  [-38.0, -25.0, -16.0, 2.0],    // BEAT 10: the tidewell and its chamber
  [-4.0, 8.0, 8.0, 17.0],        // BEAT 2: the shoal, cp2 and the geyser
  [-6.0, 6.0, 38.0, 52.0],       // BEAT 1: spawn and cp1
  [-36.0, -14.0, -23.0, -17.0],  // BEAT 11: the tide stones' flight line
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
 * Seeded by `ihash`, so the lagoon dresses itself identically on every load and
 * `reset()` never moves a coral head (contract hard rule 3).
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

const SEA = 0.00;             // the lagoon surface. Everything reads off this.
const SHORE_Y = 3.00;         // flat 1 — spawn + cp1
const SHOAL_Y = 0.60;         // flat 5 — cp2, an islet 0.60 m proud of the sea
const TERRACE_Y = 5.00;       // flat 6 — cp3 + cp4
const COURT_Y = 1.60;         // flat 8 — cp5, the drained inner court
const WELL_Y = -6.40;         // flat 9 — the tidewell floor, 6.40 m under

// BEAT 4 — THE GREAT STAIR. 35 treads of 0.312 x 0.368 m (40.3 deg), running
// from (0, -5.00, 2.00) up to (0, 5.61, -10.50). The terrain wall it climbs
// rises from -5.35 at z -6 to 4.56 at z -9.5, i.e. 70 deg — a SLIDE, not a
// walk — so this flight IS the way up the temple's south face, which is why it
// is the set piece. Measured clearance against the seabed under it: +0.60 m at
// the foot, +2.96 m over the forecourt at z -8, and the head lands 0.61 m above
// the terrace at 5.00, which is a walk-off and not a drop.
const STAIR_P = [0, -5.31, -4.25];
const STAIR_N = 35, STAIR_RISE = 0.312, STAIR_RUN = 0.368, STAIR_W = 10;
const STAIR_TOP_Y = 5.61;

// BEATS 5-9 — THE TEMPLE. `p` is the CENTRE of the s box, so the interior floor
// is 9.50 - 4.50 = 5.00 (exactly the terrace flat) and the roof deck is
// 9.50 + 4.50 + 0.21 = 14.21 (builders.js roofTemple lays a 0.42 m deck whose
// centre is that +0.21). The deck OVERHANGS the shell by 0.80 m all round, so
// the landable roof is x -10.80 .. 10.80, z -31.80 .. -16.20.
const TEMPLE_P = [0, 9.50, -24];
const TEMPLE_S = [20, 9, 14];
const ROOF_Y = 14.21;
const DAIS_TOP = 15.11;       // the shrine dais — a 0.90 m hop off the deck
const CREST_Y = 16.45;        // 1.34 m above the dais

// BEAT 8 — THE CISTERN SHAFT. Clear interior 3.20 x 3.20 m (the limit is 3.40),
// floor 5.00, exit ledge 14.60 => 9.60 m of climb = one jump (1.91 m apex) plus
// FOUR kicks at 2.00 m each, feet 5.00 -> 14.91, clearing the ledge with no
// ceiling to bonk. Centred on the temple's north face at (0, -34.5).
const SHAFT_C = [0, -34.5];
const SHAFT_TOP = 14.60;

// BEAT 11 — THE TIDE STONES. Four `vanish` tiles 0.60 m proud of the sea,
// stepping west off the terrace over 3 m of water. Centres 4.20 m apart, tiles
// 2.40 m square => a 1.80 m edge-to-edge gap, flat: trivial for the jump and
// entirely about the 3.20 s window.
const STONE_TOP = 0.60;
const STONE_Z = -20;
const STONE_X = [-21, -25.2, -29.4, -33.6];

/* ===========================================================================
 * 4. THE COURSE
 * ======================================================================== */

export default {
  id: 'azure-1',
  realm: 'azure',
  theme: 'azure',
  name: 'TIDEWELL TEMPLE',
  subtitle: 'Swim the tunnels, ride the currents, climb out of the sea',
  order: 1,
  difficulty: 7,
  music: 'azure',

  /* Par times per crest id (ms) — the HUD shows them, nothing gates on them. */
  par: {
    open: 130000, sigils: 300000, coins: 340000,
    secret: 180000, boss: 200000, race: 60000, metal: 210000,
  },

  /* Spawn on the shore flat (EXACTLY 3.00), yaw 0 => facing -Z, straight down
     the lagoon at the temple, with the reef bar, the shoal and the sanctum roof
     stacked on the sight line and the tidewell's dark water off to the left.
     cp1 stands 4 m ahead, so neither beam ever sits on the hero. */
  spawn: { p: [0, SHORE_Y, 46], yaw: 0 },
  killY: -22,
  bounds: { min: [-52, -24, -64], max: [52, 42, 52] },

  intro: {
    /* PROSE, not the title — game.js already prints "AZURE SANCTUM · TIDEWELL
       TEMPLE" as the lockup above this line. One sentence that says where you
       are and what the course wants from you. */
    text: 'The tide went out of this temple a long time ago and never came all the way back. Everything worth having is under the water, on top of it, or behind it.',
    cam: [
      { p: [0, 26, 56], look: [0, 4, -18], t: 0 },
      { p: [-26, 9, 6], look: [0, 8, -24], t: 2.8 },
      { p: [2, 5, 40], look: [0, 1, 12], t: 5.6 },
    ],
  },

  ambience: { wind: 0.22, gulls: 0.5, water: 0.85, caustics: 1.0 },

  /* ------------------------------------------------------------------------
   * TERRAIN + WATER
   * --------------------------------------------------------------------- */

  terrain: {
    kind: 'terrain',
    origin: [-52, -64],
    size: [104, 116],
    res: 1.0,
    surface: 'sand',
    heights: HEIGHTS,
    /* No grass on a sand island. `count: 0` spends that budget on the water
       plane and the coral instead; the lagoon's read comes from caustics and
       the vertex slope blend, not from blades. */
    grass: { count: 0, density: 0, height: 0, cross: false, color: KELP },
    /* Worn stone causeways — darker, no scatter — so the eye is led even though
       the course is open. These are the lines the coins follow. */
    paths: [
      { pts: [[0, 48], [0, 38]], w: 3.6 },                   // spawn -> the wading shelf
      { pts: [[0, 14], [0, 8]], w: 3.2 },                    // the shoal -> the drop
      { pts: [[0, -11], [0, -16], [4, -20]], w: 3.4 },       // stair head -> the terrace
      { pts: [[6, -20], [12, -22], [12, -30]], w: 2.8 },     // ROUTE A, the east stair
      { pts: [[-6, -20], [-12, -22], [-12, -30]], w: 2.6 },  // ROUTE B, the colonnade
      { pts: [[0, -33], [0, -38], [0, -44]], w: 3.0 },       // the sluice -> the court
    ],
  },

  waters: [
    {
      /* THE LAGOON. Surface EXACTLY 0.00 (p.y + s.y/2 = -6.5 + 6.5), floor at
         -13.00, which is below the tidewell's -6.40 so nothing pokes through
         the bottom. Every edge of the box is BURIED: sampled at 2 m spacing all
         the way round its perimeter, the lowest terrain height is above
         +0.25 m, so the plane is hidden by the reef and the shore rather than
         clipped by them. */
      kind: 'water', kind2: 'lake',
      p: [0, -6.5, 4], s: [80, 13, 68],
      res: 1.4, tint: WATER_C, fade: 5.0,
    },
  ],

  /* ------------------------------------------------------------------------
   * CHECKPOINTS — 5. Every one sits on a flat with an EXACT height (no slope
   * under the respawn), every one sits BEFORE its spike and never after, and
   * every one carries a `clockOffset` so the beams, the sluice gates and the
   * tide stones come back in the same readable phase they were in on the
   * approach — a respawn into a beam that is already ON is not a difficulty,
   * it is a bug.
   * --------------------------------------------------------------------- */
  checkpoints: [
    // flat 3.00 — the shore, before the first dive.
    { id: 'cp-shore', p: [0, SHORE_Y, 42], yaw: 0, clockOffset: 0 },
    // flat 0.60 — the shoal, before the 5.60 m dive, the beams and the eel.
    { id: 'cp-shoal', p: [0, SHOAL_Y, 12], yaw: 0, clockOffset: 0 },
    // flat 5.00 — the terrace, at the head of the great stair, before the
    // terrace beams. Offset 4.0 s puts the first beam mid-OFF on arrival.
    { id: 'cp-terrace', p: [0, TERRACE_Y, -16], yaw: 0, clockOffset: 4.0 },
    // flat 5.00 — the tide switch, before the sluice gates and the descent.
    { id: 'cp-tide', p: [6, TERRACE_Y, -34], yaw: Math.PI, clockOffset: 3.0 },
    // flat 1.60 — the inner court, 8 m short of the Warden's ring.
    { id: 'cp-court', p: [0, COURT_Y, -40], yaw: Math.PI, clockOffset: 0 },
  ],

  /* ------------------------------------------------------------------------
   * CRESTS — 7, one of each type the contract knows.
   * --------------------------------------------------------------------- */
  crests: [
    {
      id: 'open', type: 'open', name: 'THE CREST OF THE TIDEWELL',
      hint: 'The sanctum on the roof. Stairs, drums or the cistern — pick one.',
      p: [0, CREST_Y, -24],
    },
    {
      id: 'sigils', type: 'sigils', name: 'EIGHT SIGILS OF THE DROWNED TEMPLE',
      hint: 'Reef, wreck, forecourt, well, stones, cistern, colonnade, wheel.',
      spawnAt: [0, TERRACE_Y + 1.45, -24],       // on the temple's inner pedestal
    },
    {
      id: 'coins', type: 'coins', name: 'A HUNDRED COINS', threshold: 100,
      hint: '114 are down there. You can miss fourteen.',
      spawnAt: [-5.5, SHORE_Y + 1.45, 42],       // on the shore pedestal, flat 3.00
    },
    {
      id: 'secret', type: 'secret', name: 'WHAT THE CORAL KEPT',
      trigger: 'coral-broken',
      hint: 'Wear the metal hat, walk the bottom of the well, pound the coral.',
      spawnAt: [-32, -4.90, -12.5],              // inside the chamber, floor -6.25
    },
    {
      id: 'boss', type: 'boss', name: 'THE WARDEN OF THE DRAINED COURT',
      hint: 'Jump the shockwave, dodge the charge, pound its back.',
      spawnAt: [0, COURT_Y + 1.60, -48],         // the ring centre, flat 1.60
    },
    {
      id: 'race', type: 'race', name: 'THE TIDE GAUNTLET',
      hint: 'Shoal to the head of the great stair through ten rings. 60 seconds.',
      start: [0, SHOAL_Y, 12], finish: [0, STAIR_TOP_Y, -10.5], limitMs: 60000,
      spawnAt: [0, TERRACE_Y + 1.45, -13.0],
    },
    {
      id: 'metal', type: 'power', name: 'THE WEIGHT OF THE SEA', power: 'metal',
      hint: 'Take the hat on the reef and walk the sea floor before it wears off.',
      p: [22, -0.55, 6],
    },
  ],

  /* ------------------------------------------------------------------------
   * SIGILS — 8: four under the water, four on the temple. Every one sits on an
   * OPTIONAL line, and every one is verified against the surface it belongs to
   * (the note names that surface and the height it stands at).
   * --------------------------------------------------------------------- */
  sigils: [
    { p: [-29.5, 4.95, 26], note: '1 — the coral arch on the west reef (arch pillar top 3.60, +1.35)' },
    { p: [-6.0, -0.26, 20], note: '2 — the sunken wreck on the lagoon floor (hull top -1.61, +1.35)' },
    { p: [-7.0, -4.25, 2.0], note: '3 — the drowned forecourt, inside the eel chain (floor -5.60)' },
    { p: [-32.0, -5.05, -6.0], note: '4 — the bottom of the tidewell (floor -6.40, 6.40 m under)' },
    { p: [-33.6, 1.95, -20], note: '5 — the LAST tide stone, on a 3.2 s window (tile top 0.60)' },
    { p: [0, 15.95, -32.4], note: '6 — the cistern exit ledge, ROUTE C only (ledge 14.60)' },
    { p: [-12.4, 10.90, -23.0], note: '7 — colonnade drum three, ROUTE B only (drum top 9.55)' },
    { p: [-6.5, 5.35, -48.0], note: '8 — the water-wheel pier in the court (pier top 4.00)' },
  ],

  /* ------------------------------------------------------------------------
   * COINS — 114 placed, 100 needed. Everything under the water is worth more
   * than everything on it, because this is the course that teaches diving.
   * --------------------------------------------------------------------- */
  coins: [
    // BEAT 1 — the causeway off the shore to the wading shelf. (10)
    // Data lane 2026-09-04: the game boots at checkpoints[0], not `spawn`, so
    // this trail used to start BEHIND the player, between hero and camera
    // (metre-wide pancakes in the first frame). It now enters from the side
    // and joins the path at the pad.
    ...trailCoins([[-4.5, 44], [-1.5, 42], [1, 38], [0, 34]], 10, 1.1),
    // BEAT 1 — the arc off the shelf into the water: the first dive. (6)
    ...arcCoins(on(0, 32, 1.0), [0, -0.6, 26], 1.4, 6),
    // BEAT 2 — a ring on the outer reef bar, just under the surface. (8)
    { ring: { c: [0, 24], r: 5.0, n: 8, y: -0.30 } },
    // BEAT 2 — one over each sinking coral pad and one between. (8)
    ...trailCoins([[-4.5, 28], [-1.5, 24], [2.0, 20.5], [4.5, 17]], 8, 1.3),
    // BEAT 2 — a ring around the shoal's geyser. (8)
    { ring: { c: [3.5, 13], r: 3.0, n: 8, y: SHOAL_Y + 1.15 } },
    // BEAT 3 — a ring on the forecourt floor around sigil 3. Underwater coins
    // are the reason anyone learns to swim DOWN instead of paddling. (10)
    { ring: { c: [-7, 2], r: 4.2, n: 10, y: -4.60 } },
    // BEAT 3 — five inside the eel's chain. You can price the risk from the
    // sunken colonnade before you dive into it. (5)
    { p: [-6.0, -4.30, -0.5] }, { p: [-3.6, -4.30, 1.2] }, { p: [-8.6, -4.30, 3.0] },
    { p: [-4.2, -4.30, 4.4] }, { p: [-9.0, -4.30, -1.6] },
    // BEAT 4 — up the great stair, one per three treads. (10)
    { line: { a: [0, -3.60, 0.4], b: [0, 5.10, -9.4], n: 10 } },
    // BEAT 5 — a ring round the terrace pedestal, between the beams. (8)
    { ring: { c: [0, -18], r: 4.4, n: 8, y: TERRACE_Y + 1.15 } },
    // BEAT 9 (ROUTE B) — an arc up the broken colonnade. (6)
    ...arcCoins([-12.4, 7.0, -17.6], [-12.4, 13.6, -30.4], 1.2, 6),
    // BEAT 9 (ROUTE A) — the ceremonial stair and its pier landing. (8)
    { line: { a: [12, 5.90, -17.4], b: [12, 14.0, -31.6], n: 8 } },
    // BEAT 9 — a ring on the sanctum roof, round the dais. (8)
    { ring: { c: [0, -24], r: 6.6, n: 8, y: ROOF_Y + 1.15 } },
    // BEAT 7 — a ring in the inner court, inside the Warden's ring. (8)
    { ring: { c: [0, -48], r: 4.6, n: 8, y: COURT_Y + 1.15 } },
    // BEAT 11 — the tide stones, one over each and one between. (6)
    { line: { a: [-21, STONE_TOP + 1.2, STONE_Z], b: [-33.6, STONE_TOP + 1.2, STONE_Z], n: 6 } },
    // BEAT 10 — a ring on the floor of the tidewell around sigil 4. (5)
    { ring: { c: [-32, -6], r: 3.2, n: 5, y: WELL_Y + 1.20 } },
  ],

  /* ------------------------------------------------------------------------
   * POWERS — two metal hats, both on reef pads at the mouth of the lagoon, so
   * the 20 s walk to the bottom of the tidewell is a real decision and not a
   * commute. `metal` is also what makes the well's coral wall poundable: a
   * swimmer is buoyant, and a pound needs weight.
   * --------------------------------------------------------------------- */
  powers: [
    { kind: 'metal', p: [-26, 1.85, 24], duration: 20 },
    { kind: 'metal', p: [26, 1.85, 22], duration: 20 },
  ],

  /* ------------------------------------------------------------------------
   * OBJECTS — the built world, beat by beat.
   * --------------------------------------------------------------------- */
  objects: [

    /* ========================================================================
     * BEAT 1 — THE SHORE
     * Twenty seconds of nothing trying to hurt you, and the only two signs in
     * the course that teach a verb instead of a threat. The shore is EXACTLY
     * 3.00 for 8.80 m around (0, 46); the wading shelf beyond it is EXACTLY
     * 0.55, and between them the ground falls at 34 deg — steep enough to read
     * as a beach, shallow enough that walking down it is a walk.
     * ===================================================================== */

    { kind: 'deco', kindOf: 'sign', p: on(3.4, 44, 1.15), s: [0.14, 1.7, 1.2], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'post', p: on(3.4, 44, 0.65), s: [0.16, 1.3, 0.16], mat: 'stone', tint: LIME_D },
    { kind: 'text', p: [3.4, 4.95, 44], rot: [0, 0, 0], text: 'TIDEWELL TEMPLE', size: 0.58, color: 0x1c4a58 },
    { kind: 'text', p: [3.4, 4.42, 44], rot: [0, 0, 0], text: 'JUMP AT THE SURFACE TO STROKE  ·  CROUCH TO SINK', size: 0.22, color: 0x2e6a78 },
    { kind: 'text', p: [3.4, 4.05, 44], rot: [0, 0, 0], text: 'THE AIR RUNS OUT. THE COURSE DOES NOT.', size: 0.22, color: 0x2e6a78 },

    // The pedestal the HUNDRED COINS crest lands on when you finally hit 100.
    { kind: 'pedestal', p: on(-5.5, 42, 0), mat: 'stone', tint: LIME, glow: GOLD },

    // The old landing stage. One block you can hop for the view down the lagoon,
    // and two piers under it so it reads as built rather than dropped.
    { kind: 'platform', p: seat(-3.0, 36.5, 1.2), s: [3.0, 1.2, 3.0], mat: 'stone', tint: LIME, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'pillar', p: on(-5.2, 35.0, 0.9), s: [0.7, 2.0, 0.7], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'pillar', p: on(-1.0, 34.6, 0.9), s: [0.7, 2.0, 0.7], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'rail', p: on(4.6, 36.0, 0.6), s: [4.0, 0.9, 0.2], rot: [0, 0.2, 0], mat: 'stone', tint: LIME_D },
    { kind: 'text', p: [0, 2.0, 30.5], rot: [0, 0, 0], text: 'THE REEF IS SHALLOW  ·  THE TEMPLE IS NOT', size: 0.24, color: 0x2e6a78 },

    /* ========================================================================
     * BEAT 2 — THE LAGOON
     * The swimming lesson, taught by taking the floor away in stages: a wading
     * shelf at 0.55, a reef bar at -0.90, then open water. Two `current`
     * volumes cross it — one running EAST along the bar (3.2 m/s against a
     * 4.5 m/s swim, so it steers you and never traps you) and one running NORTH
     * into the forecourt, which is the ride the course wants you to take. Four
     * `sinker` coral pads give anyone who would rather not swim a line across,
     * and take it away 1.2 s after they stand on it.
     * ===================================================================== */

    { kind: 'current', p: [0, -1.4, 24], s: [46, 3.4, 9.0], dir: [1, 0, 0], power: 3.2 },
    { kind: 'current', p: [0, -2.6, 8], s: [16, 5.6, 14], dir: [0, 0, -1], power: 3.4 },

    // The coral pads. Tops at 0.35 — a hand's breadth of dry rock. Centres are
    // 3.50 m apart and the pads are 3.00 m square, so the gaps are 0.50 m flat:
    // this line is about the SINK, not the jump.
    { kind: 'sinker', p: [-4.5, 0.10, 28.0], s: [3.0, 0.5, 3.0], delay: 1.2, speed: 0.9, depth: 4, mat: 'stone', tint: 0x9fc2a8, stripe: true, edge: SAFE_EDGE },
    { kind: 'sinker', p: [-1.5, 0.10, 24.5], s: [3.0, 0.5, 3.0], delay: 1.2, speed: 0.9, depth: 4, mat: 'stone', tint: 0x9fc2a8, stripe: true, edge: SAFE_EDGE },
    { kind: 'sinker', p: [2.0, 0.10, 21.0], s: [3.0, 0.5, 3.0], delay: 1.1, speed: 1.0, depth: 4, mat: 'stone', tint: 0x9fc2a8, stripe: true, edge: SAFE_EDGE },
    { kind: 'sinker', p: [4.5, 0.10, 17.5], s: [3.0, 0.5, 3.0], delay: 1.1, speed: 1.0, depth: 4, mat: 'stone', tint: 0x9fc2a8, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [-4.5, 1.9, 29.6], rot: [0, 0, 0], text: 'THEY ONLY HOLD FOR A MOMENT', size: 0.22, color: 0x2e6a78 },

    // THE SUNKEN WRECK. Sigil 2 floats 1.35 m over the hull, whose top sits at
    // -1.61 on the lagoon floor: deep enough that you have to hold the dive,
    // shallow enough that you get back up without thinking about it.
    { kind: 'platform', p: seat(-6.0, 20.0, 1.4, 0.35), s: [5.6, 1.4, 2.4], rot: [0, 0.35, 0], mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'debris', p: on(-8.4, 21.6, 0.4), s: [1.6, 1.0, 1.6], mat: 'wood', tint: TIMBER, count: 4, spread: 3.0, jitter: 0.32 },
    { kind: 'deco', kindOf: 'panel', p: on(-3.4, 18.6, 0.9), s: [0.18, 2.2, 1.4], rot: [0.5, 0.4, 0], mat: 'wood', tint: TIMBER },

    // THE WEST REEF and its coral arch — sigil 1, on a pillar top at 3.60 above
    // a 0.80 m pad. That is a 2.80 m rise across ~1.4 m of gap: inside the
    // 2.87 m straight-up envelope with no run-up at all, and the pad affords
    // eight metres of run-up anyway.
    { kind: 'platform', p: [-29.5, 2.05, 26], s: [2.6, 3.1, 2.6], mat: 'stone', tint: LIME, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'arch', p: [-29.5, 6.1, 26], s: [0.9, 0.8, 4.4], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'crystal', p: on(-27.4, 27.6, 0.3), s: [0.9, 1.3, 0.9], mat: 'stone', tint: CORAL, count: 5, spread: 2.6, jitter: 0.34 },
    { kind: 'deco', kindOf: 'crystal', p: on(24.0, 24.4, 0.3), s: [0.9, 1.3, 0.9], mat: 'stone', tint: CORAL, count: 5, spread: 2.8, jitter: 0.34 },

    // THE SHOAL (cp2). A geyser throws you 7 m — the only launcher in the
    // course, and the quickest way back onto the reef bar after a bad dive.
    { kind: 'jumppad', p: [3.5, SHOAL_Y + 0.14, 13], s: [2.6, 0.28, 2.6], power: 7.0, dir: [0, 1, 0], mat: 'stone', tint: 0x6fd8c8 },
    { kind: 'platform', p: [5.0, 1.90, 15.0], s: [2.2, 4.4, 2.2], mat: 'stone', tint: LIME, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'monolith', p: on(-3.6, 14.4, 1.2), s: [1.0, 2.6, 0.9], mat: 'stone', tint: LIME_D },
    { kind: 'text', p: [0, 2.0, 9.0], rot: [0, 0, 0], text: 'STAND ON IT', size: 0.24, color: 0x2e6a78 },
    { kind: 'text', p: [0, 1.6, 9.0], rot: [0, 0, 0], text: 'the current below runs north whether you do or not', size: 0.19, color: 0x2e6a78 },

    /* ========================================================================
     * BEAT 3 — THE DROWNED FORECOURT
     * The floor drops from 0.60 to -5.60 in six metres. Down there: a sunken
     * colonnade, a chained eel, sigil 3, ten coins in a ring, and the foot of
     * the great stair. This is the course's real teaching moment — the dive is
     * 5.60 m and the swim back up is the same, so the ring of coins is laid out
     * as exactly one breath's worth and the light shaft over it is where the
     * surface is.
     * ===================================================================== */

    { kind: 'deco', kindOf: 'pillar', p: [-9.5, -3.6, 4.5], s: [1.0, 4.0, 1.0], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'pillar', p: [-9.5, -3.6, -1.0], s: [1.0, 4.0, 1.0], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'pillar', p: [9.5, -3.6, 4.5], s: [1.0, 4.0, 1.0], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'pillar', p: [9.5, -3.6, -1.0], s: [1.0, 4.0, 1.0], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'panel', p: [8.2, -1.4, 1.8], s: [0.24, 1.8, 4.6], rot: [0.3, 0, 0.1], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'godray', p: [0, -1.4, 2.0], s: [6.0, 8.0, 6.0], mat: 'glass', tint: 0xbfeaff },
    { kind: 'light', p: [-6, -2.4, 2], color: 0x7fe0ff, intensity: 7, distance: 20 },

    // Two beams sweep the forecourt at knee height on a 4.4 s cycle with a
    // 0.9 s telegraph. Under water they are the only thing here that kills, and
    // both are readable from the surface before you commit to the dive.
    { kind: 'beam', a: [-9.0, -4.2, 6.0], b: [9.0, -4.2, 6.0], cycle: { on: 1.6, off: 2.8, warn: 0.9, phase: 0 }, radius: 0.22, color: BEAM_C },
    { kind: 'beam', a: [-9.0, -4.2, -2.0], b: [9.0, -4.2, -2.0], cycle: { on: 1.6, off: 2.8, warn: 0.9, phase: 1.4 }, radius: 0.22, color: BEAM_C },

    /* ========================================================================
     * BEAT 4 — THE GREAT STAIR  (the set piece)
     * Thirty-five treads climbing straight out of the sea. The terrain wall
     * behind them is 70 deg — a slide, not a walk — so this flight IS the way
     * up the temple's south face, and the whole front of the course is built
     * around it: two flanking cheek walls that are 1.1 m proud of the treads
     * (so nothing about them reads as a place to land), two lanterns above the
     * tide line, and the sea pouring off the lowest six steps.
     * ===================================================================== */

    {
      kind: 'stairs', p: STAIR_P, n: STAIR_N, rise: STAIR_RISE, run: STAIR_RUN,
      w: STAIR_W, rot: [0, Math.PI, 0], mat: 'stone', tint: LIME,
      stripe: true, edge: SAFE_EDGE,
    },
    { kind: 'deco', kindOf: 'rail', p: [-5.6, -1.2, -4.0], s: [0.5, 1.2, 13.0], rot: [-0.70, 0, 0], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'rail', p: [5.6, -1.2, -4.0], s: [0.5, 1.2, 13.0], rot: [-0.70, 0, 0], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'lantern', p: [-5.6, 5.9, -10.2], s: [0.6, 0.9, 0.6], mat: 'metal', tint: GOLD },
    { kind: 'deco', kindOf: 'lantern', p: [5.6, 5.9, -10.2], s: [0.6, 0.9, 0.6], mat: 'metal', tint: GOLD },
    { kind: 'light', p: [0, 7.4, -11.0], color: 0xffe2b0, intensity: 9, distance: 22 },
    { kind: 'text', p: [0, 6.9, -11.6], rot: [0, 0, 0], text: 'THE SEA GAVE THESE STEPS BACK', size: 0.26, color: 0xe6dcc2 },

    /* ========================================================================
     * BEAT 5 — THE TERRACE AND THE TEMPLE
     * The terrace is EXACTLY 5.00 for 13.20 m around (0, -24). The temple's
     * interior floor is that same 5.00 and its roof deck is 14.21 — 9.21 m of
     * climb, which is the whole reason there are three routes up it.
     *
     * Three `beam` tripwires cross the terrace walk on staggered phases. They
     * are this course's difficulty-7 tax: the gaps between them are generous,
     * the telegraph is 0.9 s, and cp3 stands BEFORE the first of them.
     * ===================================================================== */

    {
      kind: 'building', style: 'temple', p: TEMPLE_P, s: TEMPLE_S,
      mat: 'marble', tint: LIME, footing: 2.5,
      doors: [
        { side: 'south', p: [0, TERRACE_Y, -17.0], w: 4.2, h: 5.4 },
        { side: 'north', p: [0, TERRACE_Y, -31.0], w: 3.0, h: 4.4 },
      ],
    },

    // The pedestal the EIGHT SIGILS crest rises from, on the temple floor.
    { kind: 'pedestal', p: [0, TERRACE_Y, -24], mat: 'stone', tint: LIME, glow: GOLD },
    { kind: 'deco', kindOf: 'emblem', p: [0, TERRACE_Y + 2.6, -30.4], s: [2.2, 2.2, 0.2], mat: 'metal', tint: GOLD },
    { kind: 'light', p: [0, TERRACE_Y + 3.4, -24], color: GOLD, intensity: 8, distance: 20 },

    { kind: 'beam', a: [-10.5, TERRACE_Y + 0.9, -14.0], b: [10.5, TERRACE_Y + 0.9, -14.0], cycle: { on: 1.4, off: 3.0, warn: 0.9, phase: 0 }, radius: 0.20, color: BEAM_C },
    { kind: 'beam', a: [-13.0, TERRACE_Y + 0.9, -20.0], b: [-6.0, TERRACE_Y + 0.9, -20.0], cycle: { on: 1.4, off: 3.0, warn: 0.9, phase: 1.5 }, radius: 0.20, color: BEAM_C },
    { kind: 'beam', a: [6.0, TERRACE_Y + 0.9, -20.0], b: [13.0, TERRACE_Y + 0.9, -20.0], cycle: { on: 1.4, off: 3.0, warn: 0.9, phase: 2.9 }, radius: 0.20, color: BEAM_C },
    { kind: 'text', p: [0, TERRACE_Y + 1.5, -12.6], rot: [0, 0, 0], text: 'THE LIGHT LINES BLINK BEFORE THEY BURN', size: 0.24, color: 0xe6dcc2 },

    // The terrace's furniture: three urns you can smash for coins, braziers
    // that give this deep colonnade a key of its own, and the sanctum banners.
    { kind: 'breakable', p: [-7.6, TERRACE_Y + 0.55, -15.4], s: [1.0, 1.1, 1.0], mat: 'stone', shape: 'barrel', tint: LIME_D, drop: 'coins' },
    { kind: 'breakable', p: [7.6, TERRACE_Y + 0.55, -15.4], s: [1.0, 1.1, 1.0], mat: 'stone', shape: 'barrel', tint: LIME_D, drop: 'coins' },
    { kind: 'breakable', p: [-9.0, TERRACE_Y + 0.55, -29.0], s: [1.0, 1.1, 1.0], mat: 'stone', shape: 'barrel', tint: LIME_D, drop: 'coins' },
    { kind: 'deco', kindOf: 'brazier', p: [-6.4, TERRACE_Y + 1.1, -17.4], s: [0.7, 1.6, 0.7], mat: 'metal', tint: GOLD },
    { kind: 'deco', kindOf: 'brazier', p: [6.4, TERRACE_Y + 1.1, -17.4], s: [0.7, 1.6, 0.7], mat: 'metal', tint: GOLD },
    { kind: 'deco', kindOf: 'banner', p: [-3.2, TERRACE_Y + 3.2, -17.2], s: [0.08, 2.8, 1.4], mat: 'cloth', tint: BANNER },
    { kind: 'deco', kindOf: 'banner', p: [3.2, TERRACE_Y + 3.2, -17.2], s: [0.08, 2.8, 1.4], mat: 'cloth', tint: BANNER },
    { kind: 'light', p: [0, TERRACE_Y + 2.6, -17.0], color: 0xffe2b0, intensity: 7, distance: 16 },

    /* ========================================================================
     * BEAT 9a — ROUTE A : THE CEREMONIAL STAIR  (terrace -> roof)
     * Two flights and a pier landing up the temple's EAST flank, entirely
     * outside the shell so the camera never has to see through a wall.
     *   flight 1  15 x 0.30 : foot (12.00, 5.30, -17.35) -> head (12.00, 9.50, -23.65)
     *   landing   top 9.50, overlapping flight 1's head => a 0.00 m STEP
     *   flight 2  16 x 0.30 : foot (12.00, 9.80, -26.45) -> head (12.00, 14.30, -32.75)
     *   head -> roof deck 14.21 : the rectangles touch at x = 10.80, so it is a
     *                             0.09 m STEP and not a jump at all.
     * ===================================================================== */

    { kind: 'stairs', p: [12.0, TERRACE_Y, -20.5], n: 15, rise: 0.30, run: 0.42, w: 3.2, rot: [0, Math.PI, 0], mat: 'stone', tint: LIME, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [12.0, 9.20, -26.4], s: [3.6, 0.6, 4.0], mat: 'stone', tint: LIME, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'pillar', p: [12.0, 7.1, -26.4], s: [1.0, 4.2, 1.0], mat: 'stone', tint: LIME_D },
    { kind: 'stairs', p: [12.0, 9.50, -29.6], n: 16, rise: 0.30, run: 0.42, w: 3.2, rot: [0, Math.PI, 0], mat: 'stone', tint: LIME, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'rail', p: [13.9, 8.0, -24.0], s: [0.24, 1.0, 9.0], rot: [-0.62, 0, 0], mat: 'stone', tint: LIME_D },
    { kind: 'text', p: [12.0, 6.4, -16.6], rot: [0, 0, 0], text: 'ROUTE A  ·  THE CEREMONIAL STAIR', size: 0.22, color: 0xe6dcc2 },

    /* ========================================================================
     * BEAT 9b — ROUTE B : THE BROKEN COLONNADE  (terrace -> roof)
     * Six fallen capital drums up the WEST flank. Every drum is a column that
     * still stands in its own socket, so every one is BEDDED in the terrace and
     * none of them floats. Measured, drum to drum:
     *   D1 6.55 -> D2 8.05     gap 0.50 m at +1.50 m
     *   D2 8.05 -> D3 9.55     gap 0.60 m at +1.50 m   (sigil 7 on D3)
     *   D3 9.55 -> D4 11.05    gap 0.60 m at +1.50 m
     *   D4 11.05 -> D5 12.55   gap 0.60 m at +1.50 m
     *   D5 12.55 -> D6 14.05   gap 0.60 m at +1.50 m
     *   D6 14.05 -> roof 14.21 gap 0.40 m at +0.16 m
     * A single jump apexes at 1.91 m and covers 3.38 m of gap at +1.50, so
     * every one of these is inside the SAFE column five times over. The line is
     * risky because it is nine metres above a stone terrace, not because it is
     * tight — which is the right kind of risk for an optional line.
     * ===================================================================== */

    { kind: 'platform', p: [-12.4, 4.95, -17.0], s: [2.6, 3.2, 2.6], mat: 'stone', tint: LIME, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-12.4, 6.05, -20.0], s: [2.4, 4.0, 2.4], mat: 'stone', tint: LIME, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-12.4, 6.55, -23.0], s: [2.4, 6.0, 2.4], mat: 'stone', tint: LIME, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-12.4, 7.30, -26.0], s: [2.4, 7.5, 2.4], mat: 'stone', tint: LIME, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-12.4, 8.05, -29.0], s: [2.4, 9.0, 2.4], mat: 'stone', tint: LIME, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-12.4, 8.30, -31.6], s: [2.4, 11.5, 2.4], mat: 'stone', tint: LIME, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'panel', p: [-15.0, 5.6, -21.4], s: [0.3, 1.0, 4.0], rot: [0, 0, 0.4], mat: 'stone', tint: LIME_D },
    { kind: 'text', p: [-12.4, 6.4, -15.4], rot: [0, 0, 0], text: 'ROUTE B  ·  SIX DRUMS, ONE JUMP EACH', size: 0.22, color: 0xe6dcc2 },

    /* ========================================================================
     * BEAT 8 / ROUTE C — THE CISTERN SHAFT  (terrace -> roof)
     * A 3.20 x 3.20 m open shaft on the temple's north face, floor 5.00, walls
     * to 14.60. One jump (apex 1.91 m) plus FOUR kicks at 2.00 m each carries
     * the feet 5.00 -> 14.91, clearing the 14.60 exit ledge with no ceiling to
     * bonk. The only way IN is the 2.00 m door at the bottom and the only way
     * OUT is the ledge at the top, which is what makes it a route and not a
     * hole. Sigil 6 sits on the ledge and no other route reaches it.
     * ===================================================================== */

    // The floor slab. Terrain here is 4.48, so this stands 0.52 m proud of it.
    { kind: 'platform', p: [SHAFT_C[0], 4.70, SHAFT_C[1]], s: [3.4, 0.6, 3.4], mat: 'stone', tint: LIME_D },
    { kind: 'platform', p: [-1.8, 9.80, SHAFT_C[1]], s: [0.4, 9.6, 4.0], mat: 'stone', tint: LIME },
    { kind: 'platform', p: [1.8, 9.80, SHAFT_C[1]], s: [0.4, 9.6, 4.0], mat: 'stone', tint: LIME },
    { kind: 'platform', p: [0, 9.80, -36.3], s: [4.0, 9.6, 0.4], mat: 'stone', tint: LIME },
    // The south wall, split into two jambs and a lintel: a 2.00 m doorway.
    { kind: 'platform', p: [-1.6, 9.80, -32.7], s: [1.2, 9.6, 0.4], mat: 'stone', tint: LIME },
    { kind: 'platform', p: [1.6, 9.80, -32.7], s: [1.2, 9.6, 0.4], mat: 'stone', tint: LIME },
    { kind: 'platform', p: [0, 11.00, -32.7], s: [2.0, 7.2, 0.4], mat: 'stone', tint: LIME },
    // The exit ledge — 14.60, a 0.39 m step down onto the roof deck at 14.21.
    { kind: 'platform', p: [0, 14.45, -32.4], s: [4.4, 0.3, 2.6], mat: 'stone', tint: LIME, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'chain', p: [0, 10.0, -35.9], s: [0.16, 9.0, 0.16], mat: 'metal', tint: 0x8fa8b4 },
    { kind: 'light', p: [0, 11.0, -34.5], color: 0xbcd8f5, intensity: 6, distance: 12 },
    { kind: 'text', p: [0, 6.6, -32.5], rot: [0, Math.PI, 0], text: 'ROUTE C  ·  KICK ONE WALL, THEN THE OTHER', size: 0.20, color: 0xd8e7ee },

    /* ========================================================================
     * BEAT 9c — THE SANCTUM
     * The roof deck is 14.21 and overhangs the shell by 0.80 m all round, so it
     * is a real walk with a real edge. The shrine dais is a 0.90 m hop onto
     * 15.11, and the crest floats 1.34 m over that — inside a standing jump,
     * because the last thing a course this long should ask for is precision.
     * ===================================================================== */

    { kind: 'platform', p: [0, 14.66, -24], s: [8.4, 0.9, 8.4], mat: 'marble', tint: LIME, stripe: true, edge: SAFE_EDGE },
    { kind: 'pedestal', p: [0, DAIS_TOP, -24], mat: 'stone', tint: LIME, glow: GOLD },
    { kind: 'deco', kindOf: 'pillar', p: [-3.4, DAIS_TOP + 1.3, -27.4], s: [0.8, 2.6, 0.8], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'pillar', p: [3.4, DAIS_TOP + 1.3, -27.4], s: [0.8, 2.6, 0.8], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'pillar', p: [-3.4, DAIS_TOP + 1.3, -20.6], s: [0.8, 2.6, 0.8], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'pillar', p: [3.4, DAIS_TOP + 1.3, -20.6], s: [0.8, 2.6, 0.8], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'flags', p: [0, DAIS_TOP + 2.8, -28.6], s: [1.4, 2.4, 0.2], mat: 'cloth', tint: BANNER },
    { kind: 'light', p: [0, CREST_Y + 1.4, -24], color: GOLD, intensity: 10, distance: 22 },
    { kind: 'text', p: [0, DAIS_TOP + 0.6, -20.2], rot: [0, 0, 0], text: 'THE SANCTUM', size: 0.34, color: 0xe6dcc2 },

    /* ========================================================================
     * BEAT 6 — THE TIDE SWITCH AND THE SLUICE  (cp4)
     * Pound the pedestal on the north terrace and 'tide-drawn' fires: the three
     * sluice gates in the channel below start their cycle and the way into the
     * court reads as open. The gates are `mover` slabs on a 6 s vertical
     * oscillation, a third of a cycle out of phase with each other, and they
     * are a RIDE and never a requirement — the ground beside them falls from
     * 4.76 at z -34 to 1.60 at z -40 at 28 deg, which is a walk.
     *
     * (The brief asks for the lagoon's water volume to LOWER on this trigger.
     *  There is no `tide` hazard kind and no animated `surfaceY` anywhere in
     *  the runtime, so the court is authored already drained at 1.60 and the
     *  sluice gates carry the fiction. Recorded in the header too.)
     * ===================================================================== */

    { kind: 'breakable', p: [-4.5, TERRACE_Y + 0.65, -33.4], s: [1.8, 1.3, 1.8], mat: 'stone', shape: 'crate', tint: GOLD, trigger: 'tide-drawn', drop: 'coins' },
    { kind: 'deco', kindOf: 'emblem', p: [-4.5, TERRACE_Y + 1.9, -33.4], s: [1.2, 1.2, 0.16], mat: 'metal', tint: GOLD },
    { kind: 'text', p: [-4.5, TERRACE_Y + 2.7, -33.4], rot: [0, Math.PI, 0], text: 'POUND THE PEDESTAL  ·  THE SLUICE ANSWERS', size: 0.23, color: 0xe6dcc2 },

    { kind: 'mover', p: [-6.0, 4.20, -37.0], s: [3.2, 0.5, 3.0], mat: 'stone', surface: 'normal', stripe: true, edge: SAFE_EDGE, motion: { type: 'oscillate', axis: 'y', amp: 2.0, period: 6.0, phase: 0 } },
    { kind: 'mover', p: [0.0, 4.20, -37.6], s: [3.2, 0.5, 3.0], mat: 'stone', surface: 'normal', stripe: true, edge: SAFE_EDGE, motion: { type: 'oscillate', axis: 'y', amp: 2.0, period: 6.0, phase: 0.33 } },
    { kind: 'mover', p: [6.0, 4.20, -37.0], s: [3.2, 0.5, 3.0], mat: 'stone', surface: 'normal', stripe: true, edge: SAFE_EDGE, motion: { type: 'oscillate', axis: 'y', amp: 2.0, period: 6.0, phase: 0.66 } },
    { kind: 'deco', kindOf: 'buttress', p: on(-8.6, -37.0, 1.4), s: [1.0, 3.0, 0.6], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'buttress', p: on(8.6, -37.0, 1.4), s: [1.0, 3.0, 0.6], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'godray', p: [0, 4.0, -38.0], s: [10.0, 5.0, 4.0], mat: 'glass', tint: 0xbfeaff },

    /* ========================================================================
     * BEAT 7 — THE INNER COURT  (cp5)
     * EXACTLY 1.60 for 7.15 m around (0, -46), rimmed by 40 deg walls that the
     * Warden's charge can break itself on, with a 24 m cliff closing the north.
     * Two `rotor` water wheels turn on horizontal axles at the court's flanks —
     * three rideable bars each, 8 s a revolution, no kill — and sigil 8 stands
     * on the pier between them.
     * ===================================================================== */

    { kind: 'rotor', p: [-9.0, 4.4, -44.0], style: 'bar', arms: 3, len: 3.4, thick: 0.42, period: 8.0, axis: 'x', dir: 1, mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'rotor', p: [9.0, 4.4, -44.0], style: 'bar', arms: 3, len: 3.4, thick: 0.42, period: 8.0, axis: 'x', dir: -1, mat: 'wood', tint: TIMBER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-6.5, 2.35, -48.0], s: [2.4, 3.3, 2.4], mat: 'stone', tint: LIME, stripe: true, edge: SAFE_EDGE },

    // Three `vanish` grates over the court's spillway — a 2.4 s window each,
    // staggered, and the short way from the wheels into the Warden's ring.
    { kind: 'vanish', p: [3.0, COURT_Y + 0.25, -42.0], s: [2.4, 0.4, 2.4], mode: 'cycle', cycle: { on: 2.4, off: 2.0, warn: 0.7, phase: 0 }, mat: 'stone', stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [6.0, COURT_Y + 0.25, -45.0], s: [2.4, 0.4, 2.4], mode: 'cycle', cycle: { on: 2.4, off: 2.0, warn: 0.7, phase: 1.1 }, mat: 'stone', stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [4.0, COURT_Y + 0.25, -48.0], s: [2.4, 0.4, 2.4], mode: 'cycle', cycle: { on: 2.4, off: 2.0, warn: 0.7, phase: 2.2 }, mat: 'stone', stripe: true, edge: SAFE_EDGE },

    { kind: 'deco', kindOf: 'monolith', p: on(-8.4, -52.4, 1.5), s: [1.2, 3.4, 1.0], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'monolith', p: on(8.4, -52.4, 1.4), s: [1.1, 3.0, 0.9], mat: 'stone', tint: LIME_D },
    { kind: 'deco', kindOf: 'statue', p: on(-3.0, -52.8, 1.2), s: [1.2, 2.6, 1.2], mat: 'stone', tint: LIME },
    { kind: 'deco', kindOf: 'statue', p: on(3.0, -52.8, 1.2), s: [1.2, 2.6, 1.2], mat: 'stone', tint: LIME },
    { kind: 'light', p: [0, COURT_Y + 5.0, -48], color: 0xffe0b0, intensity: 8, distance: 26 },
    { kind: 'text', p: [-8.2, COURT_Y + 2.4, -42.6], rot: [0, 0.85, 0], text: 'JUMP THE WAVE  ·  DODGE THE CHARGE  ·  POUND ITS BACK', size: 0.22, color: 0xc98a6a },

    /* ========================================================================
     * BEAT 10 — THE TIDEWELL
     * A bowl in the lagoon floor 6.40 m under the surface, dark enough that the
     * sanctum sky does not reach the bottom of it. Sigil 4 and five coins sit
     * on the floor; the coral wall on its north side needs the METAL hat,
     * because a swimmer is buoyant and a pound needs weight. Behind that wall:
     * the chamber, and the secret crest.
     *
     * Built ABOVE the heightfield rather than carved into it — a heightfield
     * has no overhangs, so a "chamber" cut into the terrain would push the
     * player straight back out of it (the lesson verdant-1's cave records).
     * ===================================================================== */

    { kind: 'platform', p: [-32.0, -6.85, -12.5], s: [5.0, 0.6, 5.0], mat: 'stone', tint: LIME_D },
    { kind: 'platform', p: [-34.7, -4.85, -12.5], s: [0.6, 3.4, 5.0], mat: 'stone', tint: LIME_D },
    { kind: 'platform', p: [-29.3, -4.85, -12.5], s: [0.6, 3.4, 5.0], mat: 'stone', tint: LIME_D },
    { kind: 'platform', p: [-32.0, -4.85, -14.7], s: [5.0, 3.4, 0.6], mat: 'stone', tint: LIME_D },
    { kind: 'platform', p: [-32.0, -2.85, -12.5], s: [5.0, 0.6, 5.0], mat: 'stone', tint: LIME_D },
    // The wall you pound. It fills the 3.00 x 2.60 m doorway exactly.
    { kind: 'breakable', p: [-32.0, -5.25, -10.2], s: [3.0, 2.6, 0.6], mat: 'moss', tint: KELP, trigger: 'coral-broken', drop: 'crest' },
    { kind: 'deco', kindOf: 'crystal', p: [-30.4, -5.4, -9.6], s: [0.8, 1.2, 0.8], mat: 'stone', tint: CORAL, count: 4, spread: 1.6, jitter: 0.34 },
    { kind: 'deco', kindOf: 'crystal', p: [-33.6, -5.4, -9.6], s: [0.8, 1.2, 0.8], mat: 'stone', tint: CORAL, count: 4, spread: 1.6, jitter: 0.34 },
    { kind: 'light', p: [-32.0, -4.4, -12.4], color: 0x7fe0ff, intensity: 7, distance: 14 },
    { kind: 'text', p: [-32.0, -3.6, -8.8], rot: [0, Math.PI, 0], text: 'TOO HEAVY TO FLOAT  ·  HEAVY ENOUGH TO POUND', size: 0.21, color: 0x9fe8ff },

    /* ========================================================================
     * BEAT 11 — THE TIDE STONES AND THE RACE  (two overlays on the whole map)
     * The stones: four `vanish` tiles 0.60 m proud of the sea, stepping west off
     * the terrace's edge over three metres of water toward the west bluff, and
     * carrying sigil 5. Entry is a 2.00 m walk-off at -3.65 m from the launch
     * block — a plain run-off covers 3.01 m at that drop, so it is a step and
     * not a leap — and the way back is the water, which is the joke.
     *
     * The race: shoal -> ten rings -> the head of the great stair, 60 s. It is
     * exactly the line the two currents already push you along, which is why
     * the currents are where they are.
     * ===================================================================== */

    { kind: 'platform', p: [-16.0, 3.65, -20], s: [3.6, 1.2, 3.6], mat: 'stone', tint: LIME, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [STONE_X[0], STONE_TOP - 0.2, STONE_Z], s: [2.4, 0.4, 2.4], mode: 'cycle', cycle: { on: 3.2, off: 2.4, warn: 0.8, phase: 0 }, mat: 'stone', stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [STONE_X[1], STONE_TOP - 0.2, STONE_Z], s: [2.4, 0.4, 2.4], mode: 'cycle', cycle: { on: 3.2, off: 2.4, warn: 0.8, phase: 1.4 }, mat: 'stone', stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [STONE_X[2], STONE_TOP - 0.2, STONE_Z], s: [2.4, 0.4, 2.4], mode: 'cycle', cycle: { on: 3.2, off: 2.4, warn: 0.8, phase: 2.8 }, mat: 'stone', stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [STONE_X[3], STONE_TOP - 0.2, STONE_Z], s: [2.4, 0.4, 2.4], mode: 'cycle', cycle: { on: 3.2, off: 2.4, warn: 0.8, phase: 4.2 }, mat: 'stone', stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [-16.0, 5.4, -18.4], rot: [0, 0, 0], text: 'THEY COME BACK  ·  NOT SOON', size: 0.22, color: 0xe6dcc2 },

    // The race pad and the ring chain. The rings sit 1.6 - 4.6 m under the
    // surface, so the whole gauntlet is one long held breath with two places
    // near the shoal to steal another.
    { kind: 'platform', p: [0, SHOAL_Y - 0.04, 12], s: [3.4, 0.2, 3.4], mat: 'stone', tint: 0xd8c79a },
    { kind: 'text', p: [0, SHOAL_Y + 1.3, 12], rot: [0, 0, 0], text: 'THE TIDE GAUNTLET  ·  60s', size: 0.26, color: 0x2e6a78 },
    {
      kind: 'rings', r: 2.4, tint: GOLD, mat: 'gold', id: 'tide-gauntlet', limitMs: 60000,
      pts: [
        [0, -1.6, 8.5], [-3.5, -2.6, 4.5], [-6.5, -3.6, 0.5], [-6.0, -4.4, -3.0],
        [-2.0, -4.6, -4.5], [2.5, -4.4, -3.5], [5.5, -3.6, 0.0], [3.5, -2.6, 4.0],
        [0.5, -3.2, 0.5], [0, -3.0, -4.0],
      ],
    },

    /* ========================================================================
     * DRESSING — coral, kelp, fallen masonry, wreckage.
     * Every scatter is seeded by `ihash`, so the lagoon dresses itself
     * identically on every load and `reset()` never moves a coral head (hard
     * rule 3). Every generator here is a procedural kind props.js already
     * ships, and every def carries a `count`, so a hundred coral heads is one
     * instanced draw call rather than a hundred — which is the only way a
     * course this open stays inside the low-tier budget.
     * ===================================================================== */

    // KELP on the lagoon floor: four beds, all strictly below the waterline.
    ...scatter(-12, 16, 4, 16, 9, 5101, (x, z, rnd) => (
      gy(x, z) > -0.3 ? null
        : { kind: 'deco', kindOf: 'plant', p: on(x, z, 0.3), s: [0.8 + rnd * 0.5, 1.6 + rnd * 1.4, 0.8 + rnd * 0.5], mat: 'leaves', tint: KELP, count: 5, spread: 2.6, jitter: 0.38 }
    )),
    ...scatter(14, 14, 4, 16, 9, 5102, (x, z, rnd) => (
      gy(x, z) > -0.3 ? null
        : { kind: 'deco', kindOf: 'plant', p: on(x, z, 0.3), s: [0.8 + rnd * 0.5, 1.4 + rnd * 1.4, 0.8 + rnd * 0.5], mat: 'leaves', tint: 0x35805f, count: 5, spread: 2.6, jitter: 0.38 }
    )),
    ...scatter(-24, -10, 5, 14, 8, 5103, (x, z, rnd) => (
      gy(x, z) > -0.5 ? null
        : { kind: 'deco', kindOf: 'plant', p: on(x, z, 0.3), s: [0.7 + rnd * 0.5, 1.5 + rnd * 1.5, 0.7 + rnd * 0.5], mat: 'leaves', tint: KELP, count: 5, spread: 2.8, jitter: 0.38 }
    )),
    ...scatter(24, -10, 5, 14, 8, 5104, (x, z, rnd) => (
      gy(x, z) > -0.5 ? null
        : { kind: 'deco', kindOf: 'plant', p: on(x, z, 0.3), s: [0.7 + rnd * 0.5, 1.5 + rnd * 1.5, 0.7 + rnd * 0.5], mat: 'leaves', tint: 0x35805f, count: 5, spread: 2.8, jitter: 0.38 }
    )),

    // CORAL HEADS: the lagoon's colour, and the only warm hue under the water.
    ...scatter(-8, 22, 4, 18, 10, 5201, (x, z, rnd) => (
      gy(x, z) > 0.2 ? null
        : { kind: 'deco', kindOf: 'crystal', p: on(x, z, 0.25), s: [0.7 + rnd * 0.7, 0.9 + rnd * 0.9, 0.7 + rnd * 0.7], mat: 'stone', tint: rnd > 0.55 ? CORAL : 0xd86a9c, count: 4, spread: 2.4, jitter: 0.36 }
    )),
    ...scatter(10, 4, 5, 18, 10, 5202, (x, z, rnd) => (
      gy(x, z) > 0.2 ? null
        : { kind: 'deco', kindOf: 'crystal', p: on(x, z, 0.25), s: [0.7 + rnd * 0.7, 0.9 + rnd * 0.9, 0.7 + rnd * 0.7], mat: 'stone', tint: rnd > 0.55 ? CORAL : 0xffb26b, count: 4, spread: 2.4, jitter: 0.36 }
    )),
    ...scatter(-20, 4, 5, 16, 8, 5203, (x, z, rnd) => (
      gy(x, z) > 0.2 ? null
        : { kind: 'deco', kindOf: 'mushroom', p: on(x, z, 0.16), s: [0.5 + rnd * 0.5, 0.5 + rnd * 0.5, 0.5 + rnd * 0.5], mat: 'plaster', tint: 0xe6c9a8, count: 6, spread: 2.0, jitter: 0.4 }
    )),

    // ROCKS on the reef and the bluffs. `rock` is LANDABLE, so every one of
    // these is sized and seated as something a player may stand on rather than
    // as scenery that lies about being solid.
    ...scatter(-30, 18, 5, 14, 5, 5301, (x, z, rnd) => (
      gy(x, z) < -1.4 ? null : { kind: 'rock', p: on(x, z, -0.4), r: 0.9 + rnd * 1.3, seed: 5301 + (x | 0), mat: 'stone' }
    )),
    ...scatter(30, 16, 5, 14, 5, 5302, (x, z, rnd) => (
      gy(x, z) < -1.4 ? null : { kind: 'rock', p: on(x, z, -0.4), r: 0.9 + rnd * 1.3, seed: 5302 + (x | 0), mat: 'stone' }
    )),
    ...scatter(0, 46, 12, 22, 6, 5303, (x, z, rnd) => (
      gy(x, z) < 0.9 ? null : { kind: 'rock', p: on(x, z, -0.45), r: 1.0 + rnd * 1.5, seed: 5303 + (x | 0), mat: 'stone' }
    )),
    ...scatter(-34, -24, 6, 16, 5, 5304, (x, z, rnd) => (
      gy(x, z) < -1.6 ? null : { kind: 'rock', p: on(x, z, -0.45), r: 1.0 + rnd * 1.4, seed: 5304 + (x | 0), mat: 'stone' }
    )),
    ...scatter(34, -24, 6, 16, 5, 5305, (x, z, rnd) => (
      gy(x, z) < -1.6 ? null : { kind: 'rock', p: on(x, z, -0.45), r: 1.0 + rnd * 1.4, seed: 5305 + (x | 0), mat: 'stone' }
    )),

    // FALLEN MASONRY around the temple's skirt and the court, so the shelf
    // reads as a ruin rather than as a plinth someone dropped a building on.
    ...scatter(0, -24, 16, 24, 10, 5401, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'debris', p: on(x, z, 0.3), s: [1.2 + rnd, 0.8 + rnd * 0.6, 1.2 + rnd], mat: 'stone', tint: LIME_D, count: 3, spread: 2.6, jitter: 0.34 }
    )),
    ...scatter(0, -46, 9, 15, 7, 5402, (x, z, rnd) => (
      { kind: 'deco', kindOf: 'debris', p: on(x, z, 0.3), s: [1.0 + rnd, 0.7 + rnd * 0.6, 1.0 + rnd], mat: 'stone', tint: LIME_D, count: 3, spread: 2.4, jitter: 0.34 }
    )),

    // The shore's own dressing: sea grass above the tide line only.
    ...scatter(0, 44, 9, 20, 8, 5501, (x, z, rnd) => (
      gy(x, z) < 1.2 ? null
        : { kind: 'deco', kindOf: 'bush', p: on(x, z, 0.3), s: [0.9 + rnd, 0.6 + rnd * 0.5, 0.9 + rnd], mat: 'leaves', tint: 0x7fa86a, count: 4, spread: 2.8, jitter: 0.34 }
    )),
    { kind: 'deco', kindOf: 'flowerbed', p: on(-8.6, 44.6, 0.1), s: [3.0, 0.25, 2.2], mat: 'leaves', tint: 0xf0d24e, count: 5, spread: 3.4, jitter: 0.34 },
    { kind: 'deco', kindOf: 'flowerbed', p: on(9.4, 43.0, 0.1), s: [2.6, 0.25, 2.6], mat: 'leaves', tint: CORAL, count: 5, spread: 3.4, jitter: 0.34 },
  ],

  /* ------------------------------------------------------------------------
   * CRITTERS
   * --------------------------------------------------------------------- */
  critters: [
    // THE EEL. A gnasher on a 6 m chain at the bottom of the drowned forecourt,
    // its post on the floor at EXACTLY -5.60. Its reach is a disc you can pace
    // out from the sunken colonnade before you dive into it; sigil 3 and five
    // coins sit inside that disc, which is the whole decision.
    {
      kind: 'gnasher', p: [-6.0, -5.60, 1.5], chain: 6.0,
      post: [-6.0, -5.60, -2.0], postHits: 3, trigger: 'eel-freed',
      telegraph: 0.5, tint: 0x2f5a5e,
    },
    // CLICKERS. Bumblers in crab shells. Side contact is knockback, never death
    // (contract §23). Three, all on ground flat enough that the waddle reads
    // from forty metres.
    { kind: 'bumbler', path: [on(-7, 44), on(6, 42), on(2, 47), on(-7, 44)], speed: 1.5 },
    { kind: 'bumbler', path: [[-7, TERRACE_Y, -19], [7, TERRACE_Y, -19], [7, TERRACE_Y, -29], [-7, TERRACE_Y, -29], [-7, TERRACE_Y, -19]], speed: 1.8 },
    { kind: 'bumbler', path: [[-5, COURT_Y, -43], [5, COURT_Y, -43], [5, COURT_Y, -50], [-5, COURT_Y, -50], [-5, COURT_Y, -43]], speed: 1.6 },
    // GULLS. Skitters on sine paths — one working the reef bar, one quartering
    // the temple roof, which is what makes the sanctum feel high.
    { kind: 'skitter', p: [-10, 3.6, 22], path: [[-10, 3.6, 22], [12, 5.0, 28]], amp: 1.8, speed: 3.6 },
    { kind: 'skitter', p: [0, 18.5, -24], path: [[-12, 18.0, -18], [12, 20.0, -30]], amp: 2.2, speed: 4.0 },
    // THE WARDEN. Three hits, in the drained court on EXACTLY 1.60. The court's
    // own 40 deg rim is the wall its charge breaks itself on.
    { kind: 'warden', p: [0, COURT_Y, -48], arena: { c: [0, -48], r: 7.0 }, hp: 3, tint: 0x5f7a86 },
  ],
};
