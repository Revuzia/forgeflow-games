/**
 * CRESTBOUND — EMBER FOUNDRY 2 : "PISTON HALLS"
 * runtime/data/courses/ember-2.js                                   CONTRACT §25
 * ===========================================================================
 *
 * The foundry's ENGINE. An open diorama 140 x 140 m across three parallel
 * decks, all of them visible from the spawn apron:
 *
 *   UPPER   the maintenance gantry — the piston hall's roof deck at 20.30 and a
 *           catwalk of vanishing grates and a seesaw running 60 m north.
 *   MID     the piston hall floor (6.00) and the conveyor sorter (6.00).
 *   LOWER   the coolant channel (water surface 2.70, floor 0.50) with a current
 *           that runs west to the pump jetty.
 *
 * Everything in here moves on a beat. The course teaches the beat, then makes
 * you keep it while it takes the floor away.
 *
 *   BEAT 1  THE APPROACH      spawn apron, the hall's south door, coin trail
 *   BEAT 2  THE PISTON HALL   12 crushers, 3 rows, 3 periods, 3 lanes
 *   BEAT 3  THE SEVENTH WALL  the secret: a breakable panel behind row 2
 *   BEAT 4  THE SORTER        crossing conveyors, crates, a sweep bar, a gnasher
 *   BEAT 5  THE GANTRY        east stairs, roof beams, the trolley, the catwalk
 *   BEAT 6  THE CHANNEL       plates + a vanishing grate, current, the metal hat
 *   BEAT 7  THE CANNON        a shot to a floating grate that closes after 25 s
 *   BEAT 8  THE CORE          drum, stair, piston lift, THE FLYWHEEL, the crest
 *   BEAT 9  RACE / WARDEN     two overlays on the whole machine
 *
 * ---------------------------------------------------------------------------
 * ROUTES TO THE OPEN CREST  (crest deck top 34.90, crest at 36.50)
 * ---------------------------------------------------------------------------
 *  A  THE FLOOR    spawn -> hall south door -> the 12 pistons -> north door ->
 *                  sorter belts -> channel plates (one 3.10 m gap onto a
 *                  vanishing grate, one 3.10 m gap off it) -> north bank ->
 *                  core yard 10.00.
 *  B  THE GANTRY   spawn -> walk AROUND the hall's east flank -> switchback
 *                  stairs (6.35 -> 13.00 -> 20.00) -> catwalk -> roof deck
 *                  20.30 (pulse beams) -> north catwalk: 3 vanishing grates
 *                  (3.60 / 3.60 m gaps) + the seesaw + 2 more grates -> the
 *                  stepped gantry E1/E2 -> core yard 10.00. Skips every piston.
 *  C  THE COOLANT  from the sorter, drop into the channel -> the current
 *                  carries you WEST at 3.2 m/s -> surface at the pump jetty
 *                  (cp4, top 3.50) -> up the west shore -> core yard 10.00.
 *
 *  All three converge on the CORE YARD, and the last climb has three ways of
 *  its own — the east access STAIR (10.35 -> 20.50), the PISTON LIFT
 *  (20.15 -> 34.90) and the FLYWHEEL gondolas (21.25 -> 35.05). The lift and
 *  the stair are the static line the reach gate walks; the flywheel is the one
 *  you will tell people about.
 *
 * ---------------------------------------------------------------------------
 * THE TERRAIN SAMPLER
 * ---------------------------------------------------------------------------
 * `terrainHeightAt(x, z)` below is a VERBATIM transliteration of
 * `runtime/world/terrain.js sampleHeights()` — the same integer hash, the same
 * quintic fade, the same 4-octave fbm, the same cosine `bump`, the same
 * evaluation order:
 *
 *     base -> + hills (bump then smoothstep) -> + ridges (HALF width!)
 *          -> + fbm noise -> flats blend over the lot (core fixed at 0.55 r)
 *
 * Two traps are transliterated on purpose because getting them wrong moves
 * every placement in this file:
 *   · a ridge's `w` is a FULL width — terrain.js halves it before the falloff.
 *   · a flat's dead-level core is HARD-CODED at 0.55 * r; terrain.js does not
 *     read a per-flat `core` key, so this file never authors one.
 *
 * Every `p` below is either `on()/seat()` (resolved against this sampler) or a
 * named platform top (p[1] + s[1]/2) quoted in the comment beside it.
 *
 * ---------------------------------------------------------------------------
 * THE REACH BUDGET ACTUALLY USED
 * (safe limits from core/tuning.js: single 4.52 flat / 3.88 at +1.0 / 3.28 at
 *  +1.6; double 5.24 needs 4 m of run-up; triple 6.11 needs 6 m; bestRise is
 *  the backflip at 3.22 apex, so any vertical step under 2.87 m is legal)
 * ---------------------------------------------------------------------------
 *   longest REQUIRED gap      3.10 m at dy 0.00   BEAT 6, plate -> grate -> plate
 *                             (single-safe 4.52; approach is a 3.20 m plate)
 *   longest REQUIRED gantry   3.60 m at dy 0.00   BEAT 5, grate to grate
 *                             (single-safe 4.52; approach is a 2.40 m grate,
 *                              so no double/triple is on offer and none is
 *                              needed)
 *   tallest REQUIRED step     1.35 m              BEAT 8, roof -> piston lift
 *   longest OPTIONAL gap      3.70 m at dy -0.15  BEAT 8, flywheel gondola at
 *                             the top of its sweep -> the crown deck
 *   riskiest OPTIONAL line    sigil 5, swimming EAST against a 3.0 m/s intake
 *                             current on a 4.5 m/s stroke
 * Nothing here REQUIRES a long jump, a triple or a dive.
 *
 * CONTENT LEDGER: 8 sigils · 7 crests · 112 coins · 5 checkpoints ·
 * hazard families: crusher, conveyor, breakable, speedpad, beam, vanish,
 * seesaw, current, mover, cannon, rotor + critters gnasher, bumbler x3,
 * skitter x2, warden.
 */

/* ===========================================================================
 * 0. Palette — EMBER FOUNDRY
 * ======================================================================== */

const IRON = 0x6d7078;       // structural steel, catwalks, gantry
const FIREBRICK = 0x9a5f45;  // the hall's brick shell
const COPPER = 0xc08344;     // pipework, trim, the flywheel hub
const SLAG = 0x4a4038;       // cold slag, floor plate
const EMBER = 0xff8a3c;      // furnace light
const HOT = 0xffc44d;        // glowing metal
const COOLANT = 0x3fb7c8;    // the channel water, coolant glow
const GOLD = 0xffd257;       // coin / sigil / crest glow
const SAFE_EDGE = 0xffe9a8;  // leading-edge stripe
const WARN = 0xff5533;       // hazard paint

/* ===========================================================================
 * 1. THE HEIGHTFIELD — every `p` in this file is justified against it
 * ======================================================================== */

/** Heightfield definition. Consumed verbatim by world/terrain.js (contract §18). */
const HEIGHTS = {
  seed: 20260903,
  base: 6.0,
  hills: [
    // --- the rim: five slag banks that close the diorama without a wall ---
    { p: [0, 62], r: 26, h: 5.5 },      // south bank, behind spawn
    { p: [54, 16], r: 26, h: 6.5 },     // east bank
    { p: [-54, 16], r: 26, h: 6.5 },    // west bank
    { p: [50, -52], r: 26, h: 8.0 },    // north-east bank
    { p: [-50, -52], r: 26, h: 8.0 },   // north-west bank
    // --- two cold slag heaps that break up the yard ---
    { p: [30, -2], r: 13, h: 2.4 },
    { p: [-32, 8], r: 13, h: 2.0 },
    // --- the core mound: the engine sits on its own spoil ---
    { p: [0, -50], r: 26, h: 4.0 },
  ],
  ridges: [
    // THE COOLANT CHANNEL. `w` is a FULL width — terrain.js uses w/2 = 15 m, so
    // the trench is 30 m rim-to-rim, 5.5 m deep, and its steepest face is
    // 5.5 * (pi/2) / 15 = 0.576 m/m = 29.9 deg: steep, walkable, never a slide.
    { a: [-40, -14], b: [34, -14], w: 30, h: -5.5 },
  ],
  flats: [
    { p: [0, 52], r: 12, h: 6.0 },      // spawn apron            (cp1)
    { p: [0, 28], r: 19, h: 6.0 },      // the piston hall floor
    { p: [0, 6], r: 11, h: 6.0 },       // the sorter floor       (cp2)
    { p: [0, -50], r: 24, h: 9.0 },     // the core yard skirt
    { p: [0, -50], r: 16, h: 10.0 },    // the engine pad         (cp5)
  ],
  noise: { amp: 0.22, freq: 0.052 },
};

/* --- the sampler: a transliteration of terrain.js sampleHeights ----------- */

/** Integer hash in [0,1). Math.imul so the 32-bit wrap is engine-identical. */
function ihash(ix, iz, seed) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Quintic smoothstep — the fbm interpolant (C2, so no normal creases). */
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

/** Fractal value noise, 4 octaves, gain 0.5, lacunarity 2.03 (terrain.js defaults). */
function fbm(x, z, seed) {
  let v = 0, a = 1, f = 1, norm = 0;
  for (let i = 0; i < 4; i++) {
    v += vnoise(x * f, z * f, seed + i * 131) * a;
    norm += a;
    a *= 0.5; f *= 2.03;
  }
  return norm > 0 ? v / norm : 0;
}

/** Smooth radial falloff: 1 at the centre, 0 at the rim, C1 at both. */
function bump(t) {
  if (t >= 1) return 0;
  if (t <= 0) return 1;
  return 0.5 * (1 + Math.cos(Math.PI * t));
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
 * bit-for-bit what `terrain.js sampleHeights(HEIGHTS)` returns — which is what
 * `_harness/reachcheck.mjs` walks.
 */
export function terrainHeightAt(x, z) {
  let y = HEIGHTS.base;

  for (let i = 0; i < HEIGHTS.hills.length; i++) {
    const H = HEIGHTS.hills[i];
    const dx = x - H.p[0], dz = z - H.p[1];
    const dd = Math.sqrt(dx * dx + dz * dz);
    if (dd < H.r) {
      const k = bump(dd / H.r);
      y += H.h * (k * k * (3 - 2 * k));     // domed, not conical
    }
  }

  for (let i = 0; i < HEIGHTS.ridges.length; i++) {
    const R = HEIGHTS.ridges[i];
    const w = R.w * 0.5;                    // TRAP: `w` is the FULL width
    const dd = segDist(x, z, R.a, R.b);
    if (dd < w) y += R.h * bump(dd / w);
  }

  y += fbm(x * HEIGHTS.noise.freq, z * HEIGHTS.noise.freq, HEIGHTS.seed) * HEIGHTS.noise.amp;

  for (let i = 0; i < HEIGHTS.flats.length; i++) {
    const F = HEIGHTS.flats[i];
    const dx = x - F.p[0], dz = z - F.p[1];
    const dd = Math.sqrt(dx * dx + dz * dz);
    if (dd < F.r) {
      const t = dd / F.r;
      const k = t <= 0.55 ? 1 : bump((t - 0.55) / 0.45);   // TRAP: core is FIXED
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
 * explicit {p} entries so an arc can never be dropped by a Collectibles build
 * that only knows the contract's {p} / {ring} / {line} forms.
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
 * a trail in a yard this lumpy; this cannot.
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
 * ONE piston. Twelve of these is one hazard KIND repeated, which the course
 * builder batches — cheap. Twelve hand-authored variants would not be.
 *
 * `p` is the RETRACTED centre; the head is 1.4 m thick, so parked its underside
 * is at 12.40 - 0.70 = 11.70 and at full extension 11.70 - 5.20 = 6.50, i.e.
 * 0.50 m over the hall floor. A crusher is lethal ONLY on the driving face and
 * ONLY while it drives, so the parked head is a ceiling, not a threat.
 */
function piston(x, z, period, phase) {
  return {
    kind: 'crusher', p: [x, 12.40, z], s: [4.8, 1.4, 4.0],
    axis: [0, -1, 0], travel: 5.20, period, phase, dwell: 0.55,
    mode: 'single', mat: 'metal', tint: IRON, glow: HOT,
  };
}

/* ===========================================================================
 * 3. Measured constants the beats below refer to by name
 * ======================================================================== */

const HALL_Y = 6.00;         // hall floor / sorter floor / spawn apron
const HALL_TOP = 20.00;      // hall shell top; the roof DECK stands on it
const GANTRY_Y = 20.30;      // the maintenance deck the player walks (deck top)
const WATER_Y = 2.70;        // coolant surface. Channel floor 0.50 => 2.20 deep.
const PLATE_Y = 3.40;        // the channel crossing plates (top)
const CORE_Y = 10.00;        // the core yard / drum interior floor
const ROOF_Y = 20.30;        // the drum's roof deck (the flywheel deck)
const CREST_Y = 34.90;       // the crown deck the open crest stands on

// BEAT 2 — the hall. Shell x +-15, z 12..44; walls 1.65 m thick, so the clear
// interior is x -13.35..13.35, z 13.65..42.35.
const HALL_Z0 = 12, HALL_Z1 = 44;
// Piston columns. Heads are 4.8 wide, so they occupy
//   [-12.9,-8.1] [-5.9,-1.1] [1.1,5.9] [8.1,12.9]
// and leave THREE lanes 2.20 m wide at x -7.0 / 0.0 / +7.0. Rows are 4.0 m
// deep at z 37 / 29 / 21, leaving 4 m breather bands at z 31..35 and 23..27.
const LANE = [-7.0, 0.0, 7.0];
const PIS_X = [-10.5, -3.5, 3.5, 10.5];
const ROW_Z = [37, 29, 21];

// BEAT 8 — the core. Drum p [0,15,-50] s [16,10,16]: floor 10.00, shell top
// 20.00, foundry roof deck top 20.30. The flywheel hub stands at [-10.5, 27.90,
// -50] and its gondolas ride a 6.90 m vertical circle in the plane z = -50, so
// a gondola deck passes 21.25 at the bottom (0.45 m clear of the roof) and
// 35.05 at the top, 3.70 m out from the crown deck's west edge.
const FLY_HUB = [-10.5, 27.90, -50];
const FLY_R = 6.90;

/* ===========================================================================
 * 4. THE COURSE
 * ======================================================================== */

export default {
  id: 'ember-2',
  realm: 'ember',
  theme: 'ember',
  name: 'PISTON HALLS',
  subtitle: 'Crushers, pistons and conveyors',
  order: 2,
  difficulty: 5,
  music: 'ember',

  /* Par times per crest id (ms). The HUD shows them; nothing gates on them. */
  par: {
    open: 95000, sigils: 240000, coins: 280000,
    secret: 130000, boss: 150000, race: 55000, metal: 140000,
  },

  /* Spawn on the apron flat (EXACTLY 6.00), yaw 0 => facing -Z, straight down
     the loading ramp at the hall's south door. From here you can see all three
     decks at once: the pistons through the door, the gantry stair on the right,
     and the coolant steam rising past the core beyond. cp1 is 7 m ahead, so
     neither beam sits on the hero. */
  spawn: { p: [0, 6.0, 54], yaw: 0 },
  killY: -12,
  bounds: { min: [-70, -16, -70], max: [70, 46, 70] },
  /* Static-merge chunk ceiling (course.js _computeChunkGrid; default 2 -> this
   * 144 m course collapsed to ONE chunk, so the 36 m sun-shadow frustum drew the
   * whole static merge every frame). 4 = 2 x 2 quadrants: measured 2026-09-04,
   * group-1 validator, see the note in course.js. */
  chunks: 9,

  intro: {
    text: 'The engine never stopped. Twelve pistons keep three different counts, the belts feed a sorter nobody watches, and the flywheel at the far end is still turning fast enough to carry you.',
    cam: [
      { p: [0, 24, 66], look: [0, 12, 20], t: 0 },
      { p: [30, 26, 8], look: [0, 14, -14], t: 2.8 },
      { p: [4, 10, 60], look: [0, 8, 30], t: 5.6 },
    ],
  },

  ambience: { wind: 0.20, machine: 0.75, water: 0.30 },

  /* ------------------------------------------------------------------------
   * TERRAIN + WATER
   * --------------------------------------------------------------------- */

  terrain: {
    kind: 'terrain',
    origin: [-70, -70],
    size: [140, 140],
    res: 1.0,
    surface: 'sand',                       // hot ash and slag, not soil
    heights: HEIGHTS,
    grass: false,                          // a foundry floor grows nothing
    // Worn service tracks: the routes the coins follow, carved into the ash so
    // an open yard still reads as a place with directions in it.
    paths: [
      { pts: [[0, 55], [0, 45]], w: 3.6 },                       // spawn -> hall door
      { pts: [[0, 12], [0, 6], [0, -2]], w: 3.4 },               // hall -> sorter
      { pts: [[-6, -2], [-6, -22]], w: 3.0 },                    // sorter -> the plates
      { pts: [[16, 30], [19, 24], [22, 20]], w: 2.6 },           // -> the gantry stair
      { pts: [[-44, -20], [-40, -30], [-24, -40], [-6, -44]], w: 2.8 },  // jetty -> core
    ],
  },

  waters: [
    {
      // THE COOLANT CHANNEL. Surface 2.70, box floor -1.50, so the plane is
      // buried at every rim: the trench only rises above 2.70 outside the box.
      kind: 'water', kind2: 'lake',
      p: [-3, 0.6, -14], s: [90, 4.2, 17],
      flow: [-1.0, 0], tint: COOLANT,
    },
  ],

  /* ------------------------------------------------------------------------
   * CHECKPOINTS — 5, every one BEFORE its spike, never after, and every one
   * carrying a `clockOffset` so the pistons, grates and beams present the same
   * phase on the respawn as they did the first time you arrived. Four sit on
   * flats (EXACT heights); cp3 is authored gantry deck and flat by construction.
   * --------------------------------------------------------------------- */
  checkpoints: [
    { id: 'cp-apron', p: [0, 6.0, 47], yaw: 0, clockOffset: 0 },        // flat 6.00, before the pistons
    { id: 'cp-sorter', p: [0, 6.0, 8.5], yaw: 0, clockOffset: 14 },     // flat 6.00, after the pistons, before the belts
    { id: 'cp-gantry', p: [19.5, 20.3, 26.0], yaw: Math.PI, clockOffset: 26 }, // stair head, before the beams
    { id: 'cp-channel', p: [-43, 3.5, -14], yaw: -0.95, clockOffset: 40 },     // the pump jetty, route C
    { id: 'cp-core', p: [0, 10.0, -44], yaw: 0, clockOffset: 54 },      // flat 10.00, before the flywheel
  ],

  /* ------------------------------------------------------------------------
   * CRESTS — 7, one of each type in the contract.
   * --------------------------------------------------------------------- */
  crests: [
    {
      id: 'open', type: 'open', name: 'CREST OF THE ENGINE CORE',
      hint: 'The crown over the drum. Stair, lift or flywheel — pick one.',
      p: [0, 36.5, -50],                       // 1.60 over the crown deck (34.90)
    },
    {
      id: 'sigils', type: 'sigils', name: 'EIGHT SIGILS OF THE HALLS',
      hint: 'Hall, trolley, belt, channel floor, intake, grate, cannon, flywheel.',
      spawnAt: [6, 7.45, 6],                   // the sorter pedestal, flat 6.00
    },
    {
      id: 'coins', type: 'coins', name: 'A HUNDRED COINS', threshold: 100,
      hint: '112 are lying about the works. You can miss twelve.',
      spawnAt: [-5, 7.45, 51],                 // the apron pedestal, flat 6.00
    },
    {
      id: 'secret', type: 'secret', name: 'WHAT THE SEVENTH PISTON HIDES',
      trigger: 'piston-seven-wall',
      hint: 'Row two, west wall. The panel is newer than the brick.',
      spawnAt: [-23.5, 13.4, 29],              // in the cage on the shaft ledge (12.30)
    },
    {
      id: 'boss', type: 'boss', name: 'THE WARDEN OF THE FLYWHEEL DECK',
      hint: 'Jump the shockwave, sidestep the charge, let the crown column stop it.',
      spawnAt: [-4, 21.9, -50],                // the drum roof deck (20.30)
    },
    {
      id: 'race', type: 'race', name: 'SHIFT CHANGE',
      hint: 'Hall floor to the flywheel deck. Fifty-five seconds.',
      start: [0, 6.1, 15], finish: [4, 20.4, -50], limitMs: 55000,
      spawnAt: [4.5, 21.9, -46],
    },
    {
      id: 'metal', type: 'power', name: 'THE COLD LINE', power: 'metal',
      hint: 'The hat is heavy enough to walk the bottom. Twenty-five seconds of it.',
      p: [-16, 1.6, -14],                      // the channel floor (0.50), 2.20 m under
    },
  ],

  /* ------------------------------------------------------------------------
   * SIGILS — 8, one per beat, every one on a line you can decline. Each is
   * verified against the surface it belongs to.
   * --------------------------------------------------------------------- */
  sigils: [
    { p: [11.8, 9.0, 33.0], note: '1 — hall, over the slag ingot between rows 1 and 2 (top 7.80)' },
    { p: [-9.0, 22.1, 9.0], note: '2 — over the gantry trolley at the far end of its throw (deck 20.75)' },
    { p: [0.0, 8.2, -6.0], note: '3 — over the crossing belt, which is carrying you at the channel (belt 6.60)' },
    { p: [10.0, 1.5, -14.0], note: '4 — the coolant channel floor (0.50), 2.20 m under the surface' },
    { p: [30.0, 1.5, -14.0], note: '5 — the east intake: swim INTO a 3.0 m/s current on a 4.5 m/s stroke' },
    { p: [8.0, 21.4, -4.5], note: '6 — over the second vanishing grate on the north catwalk (20.30)' },
    { p: [6.0, 26.3, -14.0], note: '7 — the floating grate, 25 s after the cannon fires (25.00)' },
    { p: [-10.5, 36.2, -50.0], note: '8 — the flywheel gondola at the top of its sweep (35.05)' },
  ],

  /* ------------------------------------------------------------------------
   * COINS — 112 placed, 100 needed. Every group pays for a line you chose;
   * only the trail out of the apron is unmissable.
   * --------------------------------------------------------------------- */
  coins: [
    // BEAT 1 — the loading ramp out of the apron. (10)
    // Data lane 2026-09-04: the game boots at checkpoints[0], not `spawn`, so
    // this trail used to start BEHIND the player, between hero and camera
    // (metre-wide pancakes in the first frame). It now enters from the side
    // and joins the path at the pad.
    ...trailCoins([[-7, 52], [-4, 49], [-1.5, 46.5], [0, 43]], 10, 1.1),
    // BEAT 2 — one line down each of the three piston lanes. Take a lane and
    // commit; the coins are the only thing telling you where the lane IS. (18)
    { line: { a: [LANE[0], 7.1, 40], b: [LANE[0], 7.1, 16], n: 6 } },
    { line: { a: [LANE[1], 7.1, 40], b: [LANE[1], 7.1, 16], n: 6 } },
    { line: { a: [LANE[2], 7.1, 40], b: [LANE[2], 7.1, 16], n: 6 } },
    // BEAT 4 — along both sorter belts, against the direction of travel. (12)
    { line: { a: [-13, 7.4, 3], b: [-1, 7.4, 3], n: 6 } },
    { line: { a: [13, 7.4, -1], b: [1, 7.4, -1], n: 6 } },
    // BEAT 6 — the arc across the channel, over the vanishing grate. (8)
    ...arcCoins([-6, 3.9, -9.4], [-6, 3.9, -19.6], 1.5, 8),
    // BEAT 6 — a ring on the coolant floor around sigil 4. Underwater coins are
    // the reason anyone learns to swim DOWN instead of paddling. (10)
    { ring: { c: [10, -14], r: 5.0, n: 10, y: 1.5 } },
    // BEAT 5 — up both flights of the gantry switchback. (10)
    { line: { a: [18.5, 7.4, 25.5], b: [18.5, 13.5, 18.5], n: 5 } },
    { line: { a: [23, 14.5, 18.5], b: [23, 20.8, 25.5], n: 5 } },
    // BEAT 5 — across the roof deck, straight through a pulse beam. (8)
    { line: { a: [-12, 21.4, 36], b: [12, 21.4, 36], n: 8 } },
    // BEAT 5 — the north catwalk, over the grates. (8)
    { line: { a: [8, 21.4, 11], b: [8, 21.4, -9], n: 8 } },
    // BEAT 7 — the run-in to the floating grate, on the cannon's arc. (6)
    { line: { a: [6, 26.2, -8], b: [6, 26.2, -15], n: 6 } },
    // BEAT 8 — a ring on the core yard, under the whole machine. (10)
    { ring: { c: [0, -42], r: 6.0, n: 10, y: 11.1 } },
    // BEAT 8 — a ring on the flywheel deck: the Warden's arena, paid for. (8)
    { ring: { c: [0, -50], r: 6.0, n: 8, y: 21.4 } },
    // BEAT 8 — four on the crown, beside the crest. (4)
    { ring: { c: [0, -50], r: 3.5, n: 4, y: 36.0 } },
  ],

  /* ------------------------------------------------------------------------
   * POWERS — one metal hat, on the channel's south lip where you can see the
   * crest glowing under the water before you decide to pick it up.
   * --------------------------------------------------------------------- */
  powers: [
    { kind: 'metal', p: on(-30, -4, 1.0), duration: 25 },
  ],

  /* ------------------------------------------------------------------------
   * OBJECTS — the built world, beat by beat.
   * --------------------------------------------------------------------- */
  objects: [

    /* ========================================================================
     * BEAT 1 — THE APPROACH
     * Fifteen seconds where nothing is trying to hurt you, spent looking at the
     * thing that is. The apron is EXACTLY 6.00 for 6.6 m around (0,52); the
     * hall's south door is dead ahead and the pistons are audible before they
     * are visible.
     * ===================================================================== */

    { kind: 'deco', kindOf: 'girders', p: on(3.4, 49, 0), s: [0.2, 2.0, 1.4], count: 3, spread: 1.6, jitter: 0.2, mat: 'metal', tint: IRON },
    { kind: 'text', p: on(3.4, 49, 2.35), rot: [0, 0, 0], text: 'PISTON HALLS', size: 0.60, color: HOT },
    { kind: 'text', p: on(3.4, 49, 1.85), rot: [0, 0, 0], text: 'EVERY PISTON KEEPS ITS OWN COUNT', size: 0.22, color: EMBER },
    { kind: 'text', p: on(3.4, 49, 1.50), rot: [0, 0, 0], text: 'WATCH ONE  ·  THEN MOVE', size: 0.22, color: EMBER },

    // The pedestal the HUNDRED COINS crest lands on.
    { kind: 'pedestal', p: on(-5, 51, 0), mat: 'metal', tint: IRON, glow: GOLD },

    /* ========================================================================
     * BEAT 2 — THE PISTON HALL  (12 crushers, 3 rows, 3 periods)
     * The shell is one `building` (style 'foundry'): interior floor EXACTLY at
     * the terrain's 6.00, shell top 20.00, roof deck top 20.30 — which is the
     * maintenance gantry of BEAT 5, so the hall's ceiling and the upper deck are
     * literally the same slab, and the two decks read as one machine.
     *
     * The rhythm: row 1 is a slow 3.6 s, row 2 an awkward 4.4 s, row 3 a fast
     * 2.6 s, and the four heads in each row are a quarter-cycle apart, so no
     * lane is ever safe twice in a row and no lane is ever unsafe forever. The
     * heads leave 2.20 m lanes at x -7 / 0 / +7 and 4 m breather bands between
     * the rows. Nothing here needs a jump; it needs a count.
     * ===================================================================== */

    {
      kind: 'building', style: 'foundry', p: [0, 13.0, 28], s: [30, 14, 32],
      mat: 'brick', tint: FIREBRICK, footing: 2.5,
      doors: [
        { side: '+z', w: 6.0, h: 5.0, p: [0, HALL_Y, 44.5] },
        { side: '-z', w: 6.0, h: 5.0, p: [0, HALL_Y, 11.5] },
      ],
    },

    // --- ROW 1 (slow, 3.6 s): the row that teaches the read.
    piston(PIS_X[0], ROW_Z[0], 3.6, 0.00),
    piston(PIS_X[1], ROW_Z[0], 3.6, 0.25),
    piston(PIS_X[2], ROW_Z[0], 3.6, 0.50),
    piston(PIS_X[3], ROW_Z[0], 3.6, 0.75),
    // --- ROW 2 (awkward, 4.4 s): a period that never lines up with row 1.
    piston(PIS_X[0], ROW_Z[1], 4.4, 0.60),
    piston(PIS_X[1], ROW_Z[1], 4.4, 0.10),
    piston(PIS_X[2], ROW_Z[1], 4.4, 0.85),
    piston(PIS_X[3], ROW_Z[1], 4.4, 0.35),
    // --- ROW 3 (fast, 2.6 s): the one you run, not the one you walk.
    piston(PIS_X[0], ROW_Z[2], 2.6, 0.15),
    piston(PIS_X[1], ROW_Z[2], 2.6, 0.65),
    piston(PIS_X[2], ROW_Z[2], 2.6, 0.40),
    piston(PIS_X[3], ROW_Z[2], 2.6, 0.90),

    // The slag ingot between rows 1 and 2, in the east margin where no head
    // falls (heads occupy x 8.1..12.9 at z 35..39 and 27..31; this sits at
    // x 10.5..13.1, z 31.7..34.3). Top 7.80; sigil 1 floats 1.20 above it.
    { kind: 'platform', p: [11.8, 6.9, 33.0], s: [2.6, 1.8, 2.6], mat: 'metal', tint: SLAG, stripe: true, edge: SAFE_EDGE },

    { kind: 'text', p: [-6.6, 8.4, 41.5], rot: [0, 0, 0], text: 'THREE LANES  ·  THREE COUNTS', size: 0.26, color: WARN },
    { kind: 'light', p: [0, 15.5, 37], color: EMBER, intensity: 9, distance: 26 },
    { kind: 'light', p: [0, 15.5, 25], color: EMBER, intensity: 9, distance: 26 },
    { kind: 'light', p: [0, 12.5, 15], color: HOT, intensity: 7, distance: 20 },
    // Pipework along the inner walls, so the hall is a machine and not a room.
    { kind: 'deco', kindOf: 'pipes', p: [-12.8, 10.5, 30], s: [1, 1, 1], count: 8, spread: [0.6, 6.0, 9.0], scale: 1.6, mat: 'metal', tint: COPPER },
    { kind: 'deco', kindOf: 'pipes', p: [12.8, 10.5, 24], s: [1, 1, 1], count: 8, spread: [0.6, 6.0, 9.0], scale: 1.6, mat: 'metal', tint: COPPER },

    /* ========================================================================
     * BEAT 3 — THE SEVENTH WALL  (the secret)
     * Row 2's west head is the seventh piston you meet. The brick behind it has
     * a steel panel in it that is newer than everything else in the hall — the
     * only clue, and it is a materials clue, not a sign. Pound it and the
     * maintenance shaft opens: a lift plate to a grate ledge at 12.30 and a cage
     * that unlocks on the same trigger.
     * ===================================================================== */

    { kind: 'breakable', p: [-14.2, 8.2, 29], s: [1.8, 4.0, 4.0], mat: 'metal', tint: IRON, drop: 'none', trigger: 'piston-seven-wall' },
    // The shaft itself. Interior floor sits EXACTLY on the yard at 6.00.
    { kind: 'building', style: 'foundry', p: [-20.5, 10.5, 29], s: [11, 9, 10], mat: 'metal', tint: SLAG, footing: 2.0, doors: [{ side: '+x', w: 2.4, h: 3.4, p: [-15.0, HALL_Y, 29] }] },
    // The lift plate: 6.80 -> 12.30, 7 s up and down with a 1.2 s dwell at each end.
    {
      kind: 'mover', p: [-20.5, 6.5, 29], s: [3.0, 0.6, 3.0], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'linear', to: [-20.5, 12.0, 29], period: 7.0, ease: 'inout', dwell: 1.2 },
    },
    // The ledge the lift meets (top 12.30) and the cage standing on it.
    { kind: 'platform', p: [-23.5, 12.0, 29], s: [4.0, 0.6, 5.0], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'breakable', p: [-23.5, 13.4, 29], s: [2.0, 2.0, 2.0], mat: 'metal', shape: 'cage', tint: COPPER, drop: 'crest', openOn: 'piston-seven-wall' },
    { kind: 'light', p: [-22.0, 12.6, 29], color: GOLD, intensity: 7, distance: 13 },
    { kind: 'text', p: [-16.6, 8.9, 29], rot: [0, -Math.PI / 2, 0], text: 'POUND WHAT DOES NOT MATCH', size: 0.24, color: HOT },

    /* ========================================================================
     * BEAT 4 — THE CONVEYOR SORTER
     * Out of the hall's north door onto the sorter floor (flat, EXACTLY 6.00).
     * Two belts run opposite ways at 5.0 m/s and a third crosses them at 4.0 m/s
     * heading NORTH — straight at the coolant channel. The crates are breakable
     * and full of coins; the sweep bar is solid, waist high and slow, so it
     * pushes rather than kills; the gnasher is chained where you would naturally
     * stand to read the belts.
     * ===================================================================== */

    { kind: 'conveyor', p: [-7, 6.3, 3], s: [16, 0.6, 4], dir: [1, 0, 0], power: 5.0, mat: 'conveyor', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'conveyor', p: [7, 6.3, -1], s: [16, 0.6, 4], dir: [-1, 0, 0], power: 5.0, mat: 'conveyor', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'conveyor', p: [0, 6.3, -1], s: [4, 0.6, 14], dir: [0, 0, -1], power: 4.0, mat: 'conveyor', tint: COPPER, stripe: true, edge: SAFE_EDGE },

    // Crates riding the belts. Bases sit on the belt tops (6.60).
    { kind: 'breakable', p: [-9, 7.5, 3], s: [1.8, 1.8, 1.8], mat: 'metal', tint: SLAG, drop: 'coins', dropCount: 4 },
    { kind: 'breakable', p: [8, 7.5, -1], s: [1.8, 1.8, 1.8], mat: 'metal', tint: SLAG, drop: 'coins', dropCount: 4 },
    { kind: 'breakable', p: [0, 7.5, -6], s: [1.8, 1.8, 1.8], mat: 'metal', tint: SLAG, drop: 'coins', dropCount: 4 },

    // The sorter sweep: a solid two-armed bar at knee height, one turn per 5 s.
    { kind: 'rotor', p: [-12, 7.6, -3], style: 'bar', arms: 2, len: 5.0, thick: 0.45, height: 0.6, period: 5.0, axis: 'y', mat: 'metal', tint: COPPER, stripe: true, edge: SAFE_EDGE },

    // The plate that does the running for you, aimed north at the channel.
    { kind: 'speedpad', p: seat(-6, -3, 0.3), s: [3.4, 0.3, 3.4], dir: [0, 0, -1], power: 12.0, mat: 'rubber', tint: HOT },
    { kind: 'speedpad', p: seat(0, 12, 0.3), s: [3.0, 0.3, 3.0], dir: [0, 0, -1], power: 11.0, mat: 'rubber', tint: HOT },

    { kind: 'pedestal', p: on(6, 6, 0), mat: 'metal', tint: IRON, glow: GOLD },
    { kind: 'text', p: on(-4.2, 8.6, 1.6), rot: [0, 0, 0], text: 'THE BELT DECIDES YOUR SPEED', size: 0.24, color: HOT },
    { kind: 'text', p: on(-4.2, 8.6, 1.25), rot: [0, 0, 0], text: 'RUN AGAINST IT TO STAND STILL', size: 0.22, color: EMBER },
    { kind: 'text', p: on(-6, -6, 1.3), rot: [0, 0, 0], text: 'STAND ON THE PLATE', size: 0.24, color: WARN },
    { kind: 'light', p: on(0, 0, 6.5), color: EMBER, intensity: 8, distance: 22 },
    { kind: 'deco', kindOf: 'girders', p: on(-16, 4, 1.2), s: [1, 1, 1], count: 5, spread: 3.2, scale: 1.5, mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'slabs', p: on(16, 2, 0.2), s: [1, 1, 1], count: 7, spread: 5.0, scale: 1.3, mat: 'metal', tint: SLAG },

    /* ========================================================================
     * BEAT 5 — THE GANTRY  (ROUTE B, and it skips every piston)
     * The switchback stairs climb the hall's east flank: 6.35 -> 13.00 on the
     * first flight, 13.35 -> 20.00 on the second, both 20 treads of 0.35 m.
     * The catwalk at the head steps onto the roof deck (20.30). Up here four
     * pulse beams sweep the deck on a 1.2 s / 2.4 s cycle with a 0.7 s warn, and
     * the maintenance trolley throws 9 m out over the sorter and back.
     *
     * Then the north catwalk: five vanishing grates and a seesaw carry you 60 m
     * over the sorter, the channel and the core bank. Measured gaps, all at
     * dy 0.00 against a single-jump-safe 4.52 m:
     *     catwalk A -> grate 1   2.30 m
     *     grate 1 -> grate 2     3.60 m
     *     grate 2 -> grate 3     3.60 m
     *     grate 3 -> seesaw      3.20 m
     *     seesaw -> platform C   1.90 m
     *     C -> grate 4           2.70 m
     *     grate 4 -> platform D  1.70 m
     * ===================================================================== */

    { kind: 'stairs', p: [18.5, 6.0, 22], n: 20, rise: 0.35, run: 0.40, w: 3.0, rot: [0, Math.PI, 0], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [21.0, 12.7, 17.0], s: [8.0, 0.6, 4.0], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'stairs', p: [23.0, 13.0, 22], n: 20, rise: 0.35, run: 0.40, w: 3.0, rot: [0, 0, 0], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    // The stair head, and cp3: 3.50 m clear of the top tread, so no beam on the hero.
    { kind: 'platform', p: [18.0, 20.0, 26.0], s: [8.0, 0.6, 3.2], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },

    // Pulse beams across the roof deck, 1.00 m over it — too low to walk, too
    // high to ignore. Each is 0.9 s out of phase with the last.
    { kind: 'beam', a: [-15, 21.3, 34], b: [15, 21.3, 34], cycle: { on: 1.2, off: 2.4, warn: 0.7, phase: 0 }, color: WARN, radius: 0.22 },
    { kind: 'beam', a: [-15, 21.3, 26], b: [15, 21.3, 26], cycle: { on: 1.2, off: 2.4, warn: 0.7, phase: 0.9 }, color: WARN, radius: 0.22 },
    { kind: 'beam', a: [-15, 21.3, 18], b: [15, 21.3, 18], cycle: { on: 1.2, off: 2.4, warn: 0.7, phase: 1.8 }, color: WARN, radius: 0.22 },
    { kind: 'beam', a: [-15, 21.3, 14], b: [15, 21.3, 14], cycle: { on: 1.2, off: 2.4, warn: 0.7, phase: 2.7 }, color: WARN, radius: 0.22 },

    // The maintenance trolley: 9 m out over the sorter and back every 9 s. Its
    // near pose (x 7.5..10.5) overlaps catwalk A, so boarding is a step; its far
    // pose is 20 m of nothing under sigil 2.
    {
      kind: 'mover', p: [0, 20.5, 9], s: [3.0, 0.5, 3.0], mat: 'grate', tint: COPPER, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'oscillate', axis: [1, 0, 0], amp: 9.0, period: 9.0, ease: 'sine' },
    },

    // --- the north catwalk ---
    { kind: 'platform', p: [8, 20.0, 9.0], s: [4.0, 0.6, 8.0], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [8, 20.1, 1.5], s: [4.0, 0.4, 2.4], mode: 'cycle', cycle: { on: 2.6, off: 1.6, warn: 0.5, phase: 0 }, mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [8, 20.1, -4.5], s: [4.0, 0.4, 2.4], mode: 'cycle', cycle: { on: 2.6, off: 1.6, warn: 0.5, phase: 1.4 }, mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [8, 20.1, -10.5], s: [4.0, 0.4, 2.4], mode: 'cycle', cycle: { on: 2.6, off: 1.6, warn: 0.5, phase: 2.8 }, mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    // The seesaw runs ACROSS the line (length along x, tilting about z), so the
    // catwalk jogs west over it: you walk the plank and it tips as you pass centre.
    { kind: 'seesaw', p: [8, 20.05, -16.5], s: [9.0, 0.5, 3.2], axis: 'z', maxDeg: 18, spring: 5, mat: 'grate', tint: COPPER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [2, 20.0, -22.5], s: [5.0, 0.6, 5.0], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [2, 20.1, -29.0], s: [4.0, 0.4, 2.6], mode: 'cycle', cycle: { on: 2.6, off: 1.6, warn: 0.5, phase: 0.7 }, mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [2, 20.0, -35.0], s: [6.0, 0.6, 6.0], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    // The stepped gantry down to the core yard: 20.30 -> 16.70 -> 13.50 -> 10.00,
    // three walk-offs of 3.60 / 3.20 / 3.50 m onto overlapping decks.
    { kind: 'platform', p: [2, 16.4, -38.5], s: [5.0, 0.6, 5.0], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [2, 13.2, -43.0], s: [5.0, 0.6, 5.0], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },

    { kind: 'text', p: [18.0, 21.6, 24.0], rot: [0, 0, 0], text: 'THE LIGHT BLINKS BEFORE IT BITES', size: 0.24, color: WARN },
    { kind: 'text', p: [8.0, 21.6, 5.6], rot: [0, 0, 0], text: 'GRATES REMEMBER YOUR WEIGHT', size: 0.22, color: HOT },
    { kind: 'light', p: [8, 23.5, -6], color: HOT, intensity: 7, distance: 20 },
    { kind: 'deco', kindOf: 'antennae', p: [-13.5, 21.6, 40.0], s: [1, 1, 1], count: 4, spread: 2.4, scale: 1.4, mat: 'metal', tint: IRON },

    /* ========================================================================
     * BEAT 6 — THE COOLANT CHANNEL  (ROUTE A crosses it, ROUTE C rides it)
     * A 30 m trench, 5.5 m deep, with 2.20 m of coolant in the bottom of it and
     * a current running WEST at 3.2 m/s — slower than the 4.5 m/s stroke, so it
     * is a conveyor, not a drowning. MEASURED at x = -6, the ground crosses the
     * 2.70 water line at z -7.6 and z -20.7, so the plates are seated on those
     * two lips and the vanishing grate spans the middle:
     *     south plate (top 3.40, z -9.70..-6.50; ground at its lip 3.30)
     *       -> 3.10 m -> the grate (top 3.40, z -15.20..-12.80)
     *       -> 3.10 m -> north plate (top 3.40, z -21.50..-18.30)
     * Both gaps are dy 0.00 against a single-jump-safe 4.52 m, and the approach
     * on each plate is its own 3.20 m of deck.
     * Miss and you are not dead, you are downstream, which is BEAT 6's other
     * half: the current delivers you to the pump jetty (cp4) and the walk up
     * the west shore is ROUTE C.
     * ===================================================================== */

    { kind: 'platform', p: [-6, 3.10, -8.1], s: [7.0, 0.6, 3.2], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [-6, 3.20, -14.0], s: [7.0, 0.4, 2.4], mode: 'cycle', cycle: { on: 2.4, off: 1.8, warn: 0.6, phase: 0 }, mat: 'grate', tint: COPPER, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [-6, 3.10, -19.9], s: [7.0, 0.6, 3.2], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },

    // The flow. Two bands: the long west drift you ride, and the east intake you
    // have to fight for sigil 5 (3.0 m/s against a 4.5 m/s stroke).
    { kind: 'current', p: [-8, 1.6, -14], s: [64, 2.2, 13], dir: [-1, 0, 0], power: 3.2 },
    { kind: 'current', p: [26, 1.6, -14], s: [26, 2.2, 11], dir: [-1, 0, 0], power: 3.0 },

    // The sluice grate: pound it for coins on the way past.
    { kind: 'breakable', p: [-24, 1.8, -14], s: [0.6, 2.6, 4.0], mat: 'grate', tint: COPPER, drop: 'coins', dropCount: 5 },

    // THE PUMP JETTY (cp4). Top 3.50, base 2.70 — it sits exactly on the water
    // line, so surfacing beside it is a stroke and a step, not a climb.
    { kind: 'platform', p: [-43, 3.10, -14], s: [10.0, 0.8, 9.0], mat: 'metal', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'deco', kindOf: 'pipes', p: [-45.5, 4.4, -14], s: [1, 1, 1], count: 5, spread: [1.0, 1.6, 3.4], scale: 1.7, mat: 'metal', tint: COPPER },
    { kind: 'light', p: [-43, 6.2, -14], color: COOLANT, intensity: 8, distance: 20 },
    { kind: 'light', p: [4, 5.0, -14], color: COOLANT, intensity: 7, distance: 26 },
    { kind: 'text', p: on(-6, 0.5, 1.3), rot: [0, 0, 0], text: 'JUMP TO STROKE  ·  CROUCH TO SINK', size: 0.22, color: COOLANT },
    { kind: 'text', p: on(-30, -4, 1.9), rot: [0, 0.5, 0], text: 'HEAVY ENOUGH TO WALK THE BOTTOM', size: 0.22, color: COOLANT },

    /* ========================================================================
     * BEAT 7 — THE CANNON AND THE FLOATING GRATE
     * A charging cannon on the sorter's west side, solved against a target 19 m
     * up and 12 m out: the grate hangs over the middle of the channel at 25.00,
     * open for 25 s at a time and gone for 8 with a 2 s warn. Sigil 7 and six
     * coins are on it, and there is no other way up there.
     * ===================================================================== */

    { kind: 'cannon', p: on(-14, -2, 0.9), pitchDeg: 52, target: [6, 25.6, -14], r: 1.1, len: 3.2, cooldown: 2.0, mat: 'metal', tint: COPPER, glow: HOT },
    { kind: 'vanish', p: [6, 24.8, -14], s: [6.0, 0.4, 6.0], mode: 'cycle', cycle: { on: 25, off: 8, warn: 2.0, phase: 0 }, mat: 'grate', tint: COPPER, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: on(-14, 0.6, 1.4), rot: [0, 0, 0], text: 'PRESS INTO THE BREECH', size: 0.24, color: HOT },
    { kind: 'light', p: [6, 27.0, -14], color: HOT, intensity: 7, distance: 16 },

    /* ========================================================================
     * BEAT 8 — THE ENGINE CORE  (the set piece)
     * The drum stands on the engine pad (flat, EXACTLY 10.00 for 8.8 m around
     * (0,-50)); its foundry roof deck is the FLYWHEEL DECK at 20.30. Three ways
     * up the last 24.90 m, and all three are real:
     *
     *   THE STAIR    an external access flight on the drum's east flank,
     *                10.35 -> 20.50, 30 treads. Always works.
     *   THE LIFT     a single great piston, 20.15 -> 34.90 on an 11 s cycle
     *                with a 1.6 s dwell, landing you ON the crown deck.
     *   THE FLYWHEEL two gondolas half a turn apart on a 6.90 m vertical circle
     *                about [-11.5, 27.90, -50], one revolution every 6 s. Board
     *                at the bottom (deck 21.25, a 1.10 m step off the roof),
     *                ride to the top (35.05) and step 3.70 m across onto the
     *                crown — the longest OPTIONAL gap in the course, at dy
     *                -0.15, against a single-jump-safe 4.52 m.
     *
     * The rotor spokes are the wheel you SEE; the gondolas are the wheel you
     * RIDE. Both turn on the same 6 s period, so they read as one machine.
     * ===================================================================== */

    { kind: 'building', style: 'foundry', p: [0, 15, -50], s: [16, 10, 16], mat: 'metal', tint: IRON, footing: 2.5, doors: [{ side: '+z', w: 5.0, h: 4.5, p: [0, CORE_Y, -41.5] }] },

    // THE STAIR. Bottom tread 10.35 at z -43.9, top 20.50 at z -56.1, both at
    // x 12 — outside the drum (x +-8), landing 2.20 m short of the roof edge.
    { kind: 'stairs', p: [12, 10.0, -50], n: 30, rise: 0.35, run: 0.42, w: 3.0, rot: [0, Math.PI, 0], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE },

    // THE CROWN. A 12 m deck on a single column, top 34.90; the open crest
    // stands 1.60 m above it. The column is what the Warden's charge breaks on.
    { kind: 'pillar', p: [0, 27.35, -50], s: [3.0, 14.1, 3.0], mat: 'metal', tint: COPPER, glow: HOT },
    { kind: 'platform', p: [0, 34.4, -50], s: [10.0, 1.0, 10.0], mat: 'metal', tint: IRON, stripe: true, edge: SAFE_EDGE },

    // THE LIFT. 20.90 -> 34.30 centre, i.e. deck 21.50 -> 34.90 — level with the
    // crown and 0.50 m off its north edge, so the last move is a step across. It
    // rides at z -57.50, clear of the crown deck (z -55.00 .. -45.00): a lift that
    // drove its plate through the deck would be a lift into a lid.
    {
      kind: 'mover', p: [0, 20.9, -57.5], s: [4.0, 1.2, 4.0], mat: 'metal', tint: COPPER, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'linear', to: [0, 34.3, -57.5], period: 11.0, ease: 'inout', dwell: 1.6 },
    },

    // THE FLYWHEEL. Spokes first (what you see), then the two gondolas (what you
    // ride), all on the same 6 s revolution.
    // Spokes stop at 4.60 m so they never share space with the gondola ring at
    // 6.90 - 1.80 = 5.10; style 'bar' because a 'windmill' rotor is LETHAL and
    // this is the wheel you are meant to board.
    { kind: 'rotor', p: FLY_HUB, style: 'bar', arms: 4, len: 4.6, thick: 0.42, height: 0.9, period: 6.0, axis: [0, 0, 1], mat: 'metal', tint: COPPER, glow: HOT },
    {
      kind: 'mover', p: FLY_HUB, s: [3.6, 0.5, 3.6], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'orbit', axis: 'z', radius: FLY_R, period: 6.0, phase: 0 },
    },
    {
      kind: 'mover', p: FLY_HUB, s: [3.6, 0.5, 3.6], mat: 'grate', tint: IRON, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'orbit', axis: 'z', radius: FLY_R, period: 6.0, phase: 0.5 },
    },

    { kind: 'text', p: [0, 21.9, -42.6], rot: [0, 0, 0], text: 'RIDE THE WHEEL  ·  OR TAKE THE STAIR', size: 0.26, color: HOT },
    { kind: 'text', p: on(0, -40, 1.4), rot: [0, 0, 0], text: 'JUMP THE WAVE  ·  SIDESTEP THE CHARGE  ·  POUND ITS BACK', size: 0.22, color: WARN },
    { kind: 'light', p: [0, 24.0, -50], color: HOT, intensity: 11, distance: 34 },
    { kind: 'light', p: [0, 37.5, -50], color: GOLD, intensity: 9, distance: 24 },
    { kind: 'light', p: on(0, -44, 4.0), color: EMBER, intensity: 8, distance: 26 },
    { kind: 'pedestal', p: on(-6, -44, 0), mat: 'metal', tint: IRON, glow: GOLD },
    { kind: 'deco', kindOf: 'pipes', p: [-9, 12.0, -42], s: [1, 1, 1], count: 6, spread: [1.2, 3.0, 3.0], scale: 1.8, mat: 'metal', tint: COPPER },
    { kind: 'deco', kindOf: 'antennae', p: [0, 35.4, -54.5], s: [1, 1, 1], count: 4, spread: 2.6, scale: 1.3, mat: 'metal', tint: IRON },

    /* ========================================================================
     * BEAT 9 — THE RACE  (an overlay on the whole machine)
     * Hall floor to the flywheel deck in 55 s. It is exactly the route the
     * service tracks already draw, which is why the tracks are there: down the
     * lanes, over the belts, across the plates, and up the stair without
     * waiting for the lift.
     * ===================================================================== */

    { kind: 'platform', p: [0, 5.96, 15], s: [3.8, 0.2, 3.8], mat: 'metal', tint: HOT },
    { kind: 'platform', p: [4, 20.26, -50], s: [3.4, 0.2, 3.4], mat: 'metal', tint: HOT },
    { kind: 'text', p: [0, 7.4, 15], rot: [0, 0, 0], text: 'SHIFT CHANGE  ·  55s', size: 0.26, color: HOT },

    /* ========================================================================
     * DRESSING — cold slag, spoil pipes and stack antennae around the rim.
     * Every cluster is a repeated deco KIND with a `count`, so the whole yard is
     * dressed out of five instanced buckets rather than fifty one-off meshes,
     * and nothing in it has a flat top a player could mistake for a platform.
     * ===================================================================== */

    { kind: 'deco', kindOf: 'slabs', p: on(-26, 34, 0.2), s: [1, 1, 1], count: 9, spread: 7.0, scale: 1.4, mat: 'metal', tint: SLAG },
    { kind: 'deco', kindOf: 'slabs', p: on(28, 40, 0.2), s: [1, 1, 1], count: 9, spread: 7.5, scale: 1.4, mat: 'metal', tint: SLAG },
    { kind: 'deco', kindOf: 'slabs', p: on(-34, -34, 0.2), s: [1, 1, 1], count: 8, spread: 7.0, scale: 1.5, mat: 'metal', tint: SLAG },
    { kind: 'deco', kindOf: 'fins', p: on(38, -34, 0.4), s: [1, 1, 1], count: 10, spread: 8.0, scale: 1.5, mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'fins', p: on(-40, 30, 0.4), s: [1, 1, 1], count: 8, spread: 7.0, scale: 1.4, mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'pipes', p: on(34, 14, 0.5), s: [1, 1, 1], count: 8, spread: 6.0, scale: 1.7, mat: 'metal', tint: COPPER },
    { kind: 'deco', kindOf: 'pipes', p: on(-38, -2, 0.5), s: [1, 1, 1], count: 8, spread: 6.0, scale: 1.7, mat: 'metal', tint: COPPER },
    { kind: 'deco', kindOf: 'antennae', p: on(20, -46, 1.0), s: [1, 1, 1], count: 6, spread: 6.0, scale: 1.6, mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'antennae', p: on(-22, -50, 1.0), s: [1, 1, 1], count: 6, spread: 6.0, scale: 1.6, mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'girders', p: on(-20, 46, 0.8), s: [1, 1, 1], count: 7, spread: 6.0, scale: 1.5, mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'girders', p: on(24, 52, 0.8), s: [1, 1, 1], count: 7, spread: 6.0, scale: 1.5, mat: 'metal', tint: IRON },
  ],

  /* ------------------------------------------------------------------------
   * CRITTERS
   * --------------------------------------------------------------------- */
  critters: [
    // THE GNASHER. Chained to a post on the sorter floor exactly where you would
    // stand to read the belts. Chain 5.5 m: a disc you can pace out from safety.
    {
      kind: 'gnasher', p: on(-10, -1, 0), chain: 5.5,
      post: on(-10, 3, 0), postHits: 3, telegraph: 0.5, tint: 0x3a3f47,
    },
    // BUMBLERS. Side contact is knockback, not death (contract §23) — which on a
    // conveyor over a channel is quite enough.
    { kind: 'bumbler', path: [on(-11, 3), on(-1, 3), on(-11, 3)], speed: 1.6 },
    { kind: 'bumbler', path: [on(11, -1), on(1, -1), on(11, -1)], speed: 1.6 },
    { kind: 'bumbler', path: [[-11, 6.05, 33], [-11, 6.05, 25], [11, 6.05, 25], [-11, 6.05, 33]], speed: 1.8 },
    // SKITTERS. One works the channel and swoops at anyone on the plates; one
    // circles the flywheel deck.
    { kind: 'skitter', p: [-6, 6.0, -14], path: [[-22, 6.4, -14], [12, 7.6, -14]], amp: 1.8, speed: 3.6 },
    { kind: 'skitter', p: [0, 24.5, -50], path: [[-14, 24.5, -50], [14, 26.5, -46]], amp: 2.2, speed: 4.0 },
    // THE WARDEN. On the flywheel deck, offset from the crown column, because
    // the column is the wall its charge has to break itself on.
    { kind: 'warden', p: [4, 20.3, -50], arena: { c: [0, -50], r: 7.5 }, hp: 3, tint: 0x7a6a5a },
  ],
};
