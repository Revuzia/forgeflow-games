/**
 * CRESTBOUND — AZURE SANCTUM 2 : "GEARHEART TOWER"
 * runtime/data/courses/azure-2.js                                   CONTRACT §25
 * ===========================================================================
 *
 * Difficulty 8, gate 42 crests. A clockwork tower standing alone on a walled
 * precinct above the sanctum sea: a 76 x 76 m GEAR YARD at y 0, a 21.6 m
 * square tower rising to a CLOCK FACE DECK at y 40, and a PENDULUM WELL cut
 * 12 m into the rock under the tower's north bay. Total verticality
 * -12.00 .. +41.60 = 53.6 m; the diorama is 76 m across. It is an SM64-scale
 * open box, not a corridor: from the spawn you can see the yard cogs, the
 * portal, the clock face, the hour hand turning, and the crest on top of it.
 *
 * NO TERRAIN (per the brief). Every `p` in this file is justified against a
 * NAMED, EXACT deck height (a platform's walkable top is `p[1] + s[1]/2`), and
 * the level constants below are the only heights anything is measured from.
 * The helper `deck(x, topY, z, s)` seats a slab so its TOP lands exactly on the
 * height you name, so no placement here is a guess.
 *
 * ---------------------------------------------------------------------------
 * THE LEVELS — the only heights in this file
 * ---------------------------------------------------------------------------
 *   WELL   -12.00   the pendulum well floor (the secret; behind a pounded grate)
 *   YARD     0.00   the gear yard, the precinct, the tower's ground floor
 *   G1       9.00   GALLERY 1 — the gear room      (ring floor, open heart)
 *   G2      17.00   GALLERY 2 — the turning room   (ring floor, open heart)
 *   G3      25.00   GALLERY 3 — the escapement     (ring floor, open heart)
 *   BELL    33.00   the bell deck                  (solid, caps the heart)
 *   FACE    40.00   the clock face deck            (outside, the roof)
 *   crest   41.60   on the hour hand's bracket at the XII numeral
 *
 * The tower's interior is x,z in [-9, 9]; its walls stand at +-9.90, 1.8 m
 * thick, from y 0 to y 34. Galleries 1-3 are RING floors with a 6 x 6 open
 * heart (x,z in [-3, 3]) so the master pendulum can swing the whole height of
 * the tower and so the tower reads as one shaft from the yard to the bell.
 * Each gallery also carries a 6 x 6 CLIMB HOLE in a different corner, so the
 * static route spirals: SE -> NE -> SW -> SE.
 *
 * ---------------------------------------------------------------------------
 * ROUTES TO THE OPEN CREST  (three, and they only share the last 6.70 m)
 * ---------------------------------------------------------------------------
 *  A  THE MILLWRIGHT'S LADDER  (required-safe, always works)
 *     yard -> CLIMB A (5 brackets, +1.50 m each, gaps 1.40 m) -> G1
 *          -> CLIMB B (4 brackets, +1.60 m) -> G2 -> CLIMB C (4) -> G3
 *          -> CLIMB D (4) -> BELL -> the winding shaft -> FACE -> crest.
 *     EVERY leg is inside the single-jump-safe envelope: the largest gap on it
 *     is 1.40 m at +1.50 m (single-safe there is 3.38 m, 41 % of budget) and the rise
 *     is 1.60 m with the take-off directly under the ledge.
 *
 *  B  THE COG LIFT  (moving geometry; the fast way)
 *     yard -> ride the great yard cog -> the east-face COG CART (`mover`,
 *     22 s round trip) up the outside of the tower -> the belfry louvre
 *     balcony at 33.00 -> BELL -> the winding shaft -> FACE.
 *     The cart is a ride, so ROUTE A's static ladder exists for the gate AND
 *     for the player who mistimes it: nothing here is reachable ONLY by riding.
 *
 *  C  THE WELL CANNON  (the secret's reward)
 *     pound the yard grate -> fall 12 m into the PENDULUM WELL -> take the
 *     secret crest -> the maintenance CANNON fires you back up into GALLERY 1,
 *     skipping CLIMB A entirely. The COUNTERWEIGHT (`mover`, 16 s) is the slow
 *     way out for anyone who would rather not be fired anywhere.
 *
 *  The last leg is shared on purpose: BELL 33.00 -> FACE 40.00 is a 3.30 m
 *  clear, 7.00 m tall WINDING SHAFT — one jump (1.91 m) plus three wall kicks
 *  (2.00 m each) clears the 6.70 m to the cap ledge, with 1.21 m to spare.
 *
 * ---------------------------------------------------------------------------
 * THE REACH BUDGET ACTUALLY USED (safe limits, core/tuning.js REACH_TABLE:
 * single 4.52 flat / 3.88 at +1.0 / 3.38 at +1.5 / 3.28 at +1.6; double 5.24;
 * triple 6.11 with 6 m of straight approach; vertical-from-rest 2.87)
 * ---------------------------------------------------------------------------
 *   longest REQUIRED gap     1.40 m at +1.50 m   CLIMB A, every bracket
 *                            (single-safe there is 3.38 m — 41 % of budget)
 *   tallest REQUIRED rise    1.60 m              CLIMBS B/C/D, every bracket
 *   winding shaft            3.30 m clear, 7.00 m tall (limit 3.4 m wide,
 *                            2.00 m per kick -> 1 jump + 3 kicks)
 *   longest OPTIONAL gap     1.80 m at +0.60 m   ring walk -> the vanish tooth
 *   riskiest OPTIONAL line   the four `vanish` cog-teeth over the open heart
 *                            (a 9 / 17 / 25 m drop under every one of them)
 * Nothing REQUIRED here uses a triple, a long jump or a dive. The race, the
 * ring run and the sigil lines use all three.
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS (contract §25, identical to verdant-1.js)
 * ---------------------------------------------------------------------------
 *   p            CENTRE, [x, y, z].  s = FULL size, [sx, sy, sz].
 *                => a platform's walkable top is p[1] + s[1]/2.
 *   yaw          RADIANS. yaw 0 faces -Z. +yaw is counter-clockwise from above.
 *   rot          Euler XYZ radians.
 *   colours      hex NUMBERS.
 *   stripe:true  "you had to jump to get here" — earns the bright leading edge.
 *                Walk-on floor never gets one.
 *   text         built in the local XY plane facing local +Z, so rot [0,0,0]
 *                faces a player walking north (-Z) — which is the approach to
 *                the tower.
 *
 * CONTENT LEDGER: 8 sigils · 7 crests · 112 coins · 5 checkpoints ·
 * families: rotor, conveyor, mover, pendulum, crusher, seesaw, beam, vanish,
 * breakable, cannon, rings + critters gnasher, bumbler x3, skitter x2, warden.
 */

/* ===========================================================================
 * 0. Palette — GEARHEART (azure sanctum, warm brass in a cold sky)
 * ======================================================================== */

const BRASS = 0xd9a441;      // cog teeth, brackets, the hour hand
const COPPER = 0xb87333;     // roofs, drums, the bell
const IRON = 0x6e7a86;       // frames, walls of the well, hazard bodies
const LIME = 0xe4d0a8;       // the tower's limestone (azure materialOverride)
const PATINA = 0x3fe0d8;     // the theme's accent — things you act on
const GOLD = 0xffcf4a;       // crest / sigil / coin glow
const GLASS = 0xdcf6ff;      // the clock face dial
const DANGER = 0xff2a4a;     // crusher heads, beam emitters
const SAFE_EDGE = 0xffd166;  // leading-edge stripe (azure palette.safeEdge)

/* ===========================================================================
 * 1. THE LEVELS — every `p` below is measured from one of these
 * ======================================================================== */

const WELL = -12.00;   // pendulum well floor
const YARD = 0.00;     // gear yard / tower ground floor
const G1 = 9.00;       // gallery 1 — the gear room
const G2 = 17.00;      // gallery 2 — the turning room
const G3 = 25.00;      // gallery 3 — the escapement
const BELL = 33.00;    // the bell deck
const FACE = 40.00;    // the clock face deck (the roof)

const WALL_TOP = 34.00;      // the tower's four walls stop here
const SHAFT_C = [6.6, -6.6]; // the winding shaft's centre (east-north corner)
const SHAFT_PAD = 33.30;     // its floor pad — a 0.30 m step off the bell deck
const HAND_Y = 41.40;        // the hour hand's axle height above the face deck

/* ===========================================================================
 * 2. Authoring helpers — everything here resolves against a NAMED deck height,
 *    so nothing in this file is eyeballed.
 * ======================================================================== */

const r2 = (v) => Math.round(v * 100) / 100;

/** Centre of a slab of full size `s` whose TOP sits exactly at `topY`. */
function deck(x, topY, z, s) { return [r2(x), r2(topY - s[1] / 2), r2(z)]; }

/**
 * A striped jump bracket: a 2.00 x 2.00 m cog-tooth ledge whose TOP is `topY`.
 * Every bracket on a REQUIRED climb is one of these, so the gate and the eye
 * agree about where the floor is.
 */
function bracket(x, topY, z, tint) {
  return {
    kind: 'platform', p: deck(x, topY, z, [2.0, 0.4, 2.0]), s: [2.0, 0.4, 2.0],
    mat: 'metal', tint: tint === undefined ? BRASS : tint,
    stripe: true, edge: SAFE_EDGE,
  };
}

/**
 * Coins along a jump ARC from a to b, peaking `h` above the chord. Expanded to
 * explicit {p} entries here (the same choice verdant-1.js made) so an arc can
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
 * A coin over every bracket of a climb, 1.10 m up, plus one on each jump
 * between them: the breadcrumb that says "this corner is the way up".
 */
function climbCoins(steps, lift) {
  const up = lift === undefined ? 1.10 : lift;
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    out.push({ p: [r2(s[0]), r2(s[1] + up), r2(s[2])] });
  }
  return out;
}

/**
 * A deterministic ring of decor around a hub — the yard's cog teeth, the
 * gallery's rivet posts. ONE deco kind repeated (perf: a repeated kind
 * instances; a new kind costs a draw call), never n one-off props.
 */
function decoRing(kindOf, cx, cy, cz, r, n, s, mat, tint, from) {
  const out = [];
  const a0 = from === undefined ? 0 : from;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    out.push({
      kind: 'deco', kindOf,
      p: [r2(cx + Math.cos(a) * r), r2(cy), r2(cz + Math.sin(a) * r)],
      s, rot: [0, r2(-a), 0], mat, tint,
    });
  }
  return out;
}

/* ===========================================================================
 * 3. THE COURSE
 * ======================================================================== */

export default {
  id: 'azure-2',
  realm: 'azure',
  theme: 'azure',
  name: 'GEARHEART TOWER',
  subtitle: 'Clockwork rooms that turn',
  order: 2,
  difficulty: 8,
  music: 'azure',

  /* Par times per crest id (ms). The HUD shows them; nothing gates on them. */
  par: {
    open: 150000, sigils: 300000, coins: 330000,
    secret: 120000, boss: 190000, race: 80000, wing: 165000,
  },

  /* Spawn on the precinct's south walk, yaw 0 => facing -Z, straight up the
     causeway at the tower's portal with the clock face, the hour hand and the
     crest stacked on the skyline above it. The yard cogs turn on the left, the
     cog cart climbs the east wall on the right. Two seconds, the whole course. */
  spawn: { p: [0, YARD, 30], yaw: 0 },
  killY: -22,
  bounds: { min: [-42, -26, -42], max: [42, 52, 42] },

  intro: {
    text: 'The tower keeps time by turning. Ride what turns, cross what ticks, and take the crest off the hour hand.',
    cam: [
      { p: [0, 8, 40], look: [0, 20, 0], t: 0 },
      { p: [26, 30, 22], look: [0, 26, -2], t: 2.8 },
      { p: [3, 3, 34], look: [0, 12, 0], t: 5.6 },
    ],
  },

  ambience: { wind: 0.45, machinery: 0.70, water: 0.20 },

  /* ------------------------------------------------------------------------
   * CHECKPOINTS — 5, each on an EXACT deck height with 2 m of clear floor
   * around it, each placed BEFORE its spike, never after. `clockOffset` is the
   * course-clock phase a respawn here rewinds to, chosen so the chase/timed
   * geometry at that station is at the START of its safe window (contract §24
   * checkpoints[].clockOffset).
   * --------------------------------------------------------------------- */
  checkpoints: [
    // Before the gear yard's belts and cogs. Grate, cannon and climb A all
    // start within 20 m of it.
    { id: 'cp-yard', p: [0, YARD, 20], yaw: 0, clockOffset: 0.0 },
    // Gallery 1, east walk. Before the vanish teeth over the open heart.
    // G2 validation 2026-09-04 (measured live, _harness/_g2_cpprobe.py): this pad
    // sat ON the gallery-1 beam line (a [-8.6, G1+0.9, -6] -> b [8.6, G1+0.9, -6]),
    // so every respawn was cut by the beam 1.6 s later, for ever. Now 6 m south
    // on the same east walk, before the beam.
    { id: 'cp-gearroom', p: [6.0, G1, 0.0], yaw: Math.PI, clockOffset: 2.0 },
    // Gallery 2, east walk. Before the turning room and the seesaw.
    // G2 validation 2026-09-04 (measured live): at x 6 the pad was 7.5 m from the
    // gallery-2 rotor hub (len 7.4, reach ~7.7 m) — the bar shoved a fresh respawn
    // into the side of the vanish block at [4.6, G2, 7] and CRUSHED him at clock
    // 1.2, nine times in five seconds. Now x 8, 9.2 m from the hub, still on the walk.
    { id: 'cp-turning', p: [8.0, G2, 4.5], yaw: 0, clockOffset: 1.0 },
    // Gallery 3, west walk. Before the escapement's crushers and beams.
    // G2 validation 2026-09-04: [-6, G3, -6] was the gallery-3 rotor's own hub.
    // Now the south end of the west walk, where the gallery-2 stairs land — 8 m
    // from the hub, 2 m south of the G3 beam (z 0), clear of the crusher footprints.
    { id: 'cp-escapement', p: [-6.0, G3, 2.0], yaw: Math.PI, clockOffset: 3.5 },
    // The bell deck's north-west corner — OUTSIDE the Warden's 6.5 m ring
    // (9.90 m from its centre) and 4.7 m from the sigil pedestal.
    { id: 'cp-bell', p: [-6.5, BELL, -7.5], yaw: Math.PI, clockOffset: 0.5 },
  ],

  /* ------------------------------------------------------------------------
   * CRESTS — 7, one of each type in the contract.
   * --------------------------------------------------------------------- */
  crests: [
    {
      // THE HOUR HAND. The hand itself is a slow `rotor` and a rotor is a ride,
      // never a floor, so the crest sits on the STATIC XII bracket the hand
      // sweeps to — 1.60 m over the face deck at 40.00, 1.10 m over the
      // pedestal under it. You can also ride the hand round to it.
      id: 'open', type: 'open', name: 'CREST ON THE HOUR HAND',
      hint: 'The clock face. Ladder, cog cart or cannon — pick one, then kick the shaft.',
      p: [0, 41.60, -7.4],
    },
    {
      id: 'sigils', type: 'sigils', name: 'EIGHT SIGILS OF THE GEARHEART',
      hint: 'Belt, tooth, plank, hammer, tooth, well, rope, numeral.',
      spawnAt: [-4.0, BELL + 1.50, -6.0],     // the bell deck pedestal
    },
    {
      id: 'coins', type: 'coins', name: 'A HUNDRED COINS', threshold: 100,
      hint: '112 are wound into the works. You can miss twelve.',
      spawnAt: [-8.0, YARD + 1.45, 20.0],     // the yard pedestal
    },
    {
      id: 'secret', type: 'secret', name: 'WHAT THE COUNTERWEIGHT HIDES',
      trigger: 'well-grate',
      hint: 'The yard has a grate in it. Grates are for pounding.',
      spawnAt: [0, WELL + 1.40, -5.0],
    },
    {
      id: 'boss', type: 'boss', name: 'THE WARDEN OF THE BELL',
      hint: 'Jump the shockwave, dodge the charge, pound its back.',
      spawnAt: [0, BELL + 1.60, 0],
    },
    {
      id: 'race', type: 'race', name: 'THE HOUR RUN',
      hint: 'Causeway to the clock face in eighty seconds. Take the cog cart.',
      start: [4.0, YARD, 18.0], finish: [-3.0, FACE, -6.0], limitMs: 80000,
      spawnAt: [-3.0, FACE + 1.40, -6.0],
    },
    {
      // The wing hat is on the bell deck; the ten rings spiral DOWN the
      // outside of the tower and back to the face deck, which is the only way
      // to see the whole machine from outside it.
      id: 'wing', type: 'power', name: 'ROUND THE OUTSIDE', power: 'wing',
      hint: 'Take the hat off the bell frame, thread all ten rings before it winds down.',
      p: [0, 30.0, 0],
    },
  ],

  /* ------------------------------------------------------------------------
   * SIGILS — 8, every one on an OPTIONAL risky line, every one hanging 1.40 m
   * (1.45 m on two of them) over a REAL landable top, named beside each one.
   * --------------------------------------------------------------------- */
  sigils: [
    { p: [12.0, 1.45, 6.0], note: '1 — over the yard chain belt (conveyor top 0.00), which runs you off it' },
    { p: [-16.0, 3.35, 14.0], note: '2 — over the great yard cog hub cap (platform top 1.90)' },
    { p: [0, G1 + 2.00, 0], note: '3 — over the vanish cog-tooth in the gear room (top 9.60); a 9 m drop under it' },
    { p: [3.0, G2 + 2.00, 0], note: '4 — over the high end of the turning-room seesaw (top 17.60)' },
    { p: [6.0, G3 + 2.90, 6.0], note: '5 — over the escapement hammer head at rest (crusher top 26.50)' },
    { p: [-5.0, WELL + 2.40, -8.5], note: '6 — over the cannon platform in the pendulum well (top -11.00)' },
    { p: [0, 38.00, 0], note: '7 — over the bell rope platform at the top of its stroke (top 36.60)' },
    { p: [-7.5, 42.00, -7.5], note: '8 — over the XI numeral bracket on the clock face deck (top 40.60)' },
  ],

  /* ------------------------------------------------------------------------
   * COINS — 112 placed, 100 needed. Every group pays for a line the player
   * chose; the causeway trail is the only one you cannot miss.
   * --------------------------------------------------------------------- */
  coins: [
    // BEAT 1 — the causeway from spawn to the portal. (10)
    // Data lane 2026-09-04: the game boots at cp-yard (z 20), not `spawn` (z 30);
    // half this line hung between hero and camera. Now from the pad to the yard.
    { line: { a: [0, 1.20, 17.5], b: [0, 1.20, 4.5], n: 10 } },
    // BEAT 1 — a ring around the great yard cog. (8)
    { ring: { c: [-16, 0, 14], r: 4.0, n: 8, y: 1.60 } },
    // BEAT 1 — down the chain belt, against the belt. (6)
    { line: { a: [8, 1.35, 6], b: [16, 1.35, 6], n: 6 } },
    // BEAT 2 — the pendulum well floor, around the secret pedestal. (10)
    { ring: { c: [0, 0, -5], r: 4.5, n: 10, y: WELL + 1.40 } },
    // BEAT 3 — CLIMB A, one over every bracket and one on every jump. (8)
    ...climbCoins([[7.7, 1.50, 7.7], [4.3, 3.00, 7.7], [7.7, 4.50, 6.0],
                   [4.3, 6.00, 4.3], [7.7, 7.50, 4.3]]),
    ...arcCoins([6.0, 3.60, 7.7], [6.0, 5.10, 6.9], 0.8, 3),
    // BEAT 4 — the gear room ring walk. (8)
    { ring: { c: [0, 0, 0], r: 6.4, n: 8, y: G1 + 1.20 } },
    // BEAT 5 — CLIMB B. (6)
    ...climbCoins([[7.7, 10.60, -7.7], [4.3, 12.20, -7.7], [7.7, 13.80, -6.0], [4.3, 15.40, -4.3]]),
    ...arcCoins([6.0, 11.30, -7.7], [6.0, 14.60, -5.2], 0.7, 2),
    // BEAT 6 — the turning room ring walk. (8)
    { ring: { c: [0, 0, 0], r: 6.4, n: 8, y: G2 + 1.20 } },
    // BEAT 6 — the vanish plank line across the south of the turning room. (6)
    { line: { a: [-6.5, G2 + 1.40, 7.0], b: [6.5, G2 + 1.40, 7.0], n: 6 } },
    // BEAT 7 — CLIMB C. (6)
    ...climbCoins([[-7.7, 18.60, 7.7], [-4.3, 20.20, 7.7], [-7.7, 21.80, 6.0], [-4.3, 23.40, 4.3]]),
    ...arcCoins([-6.0, 19.30, 7.7], [-6.0, 22.60, 5.2], 0.7, 2),
    // BEAT 8 — the escapement ring walk. (8)
    { ring: { c: [0, 0, 0], r: 6.4, n: 8, y: G3 + 1.20 } },
    // BEAT 9 — CLIMB D. (6)
    ...climbCoins([[7.7, 26.60, 7.7], [4.3, 28.20, 7.7], [7.7, 29.80, 6.0], [4.3, 31.40, 4.3]]),
    ...arcCoins([6.0, 27.30, 7.7], [6.0, 30.60, 5.2], 0.7, 2),
    // BEAT 10 — the bell deck, around the bell. (8)
    { ring: { c: [0, 0, -2], r: 6.0, n: 8, y: BELL + 1.40 } },
    // BEAT 11 — up the winding shaft, one per kick. (5)
    { line: { a: [6.6, 34.40, -6.6], b: [6.6, 39.00, -6.6], n: 5 } },
    // BEAT 12 — the clock face deck. (9)
    { ring: { c: [0, 0, 0], r: 6.0, n: 9, y: FACE + 1.20 } },
  ],

  /* ------------------------------------------------------------------------
   * POWERS — one wing hat, on the bell frame, 6 m from the ring run's first
   * hoop. A ring run that begins 40 m from ring one is a commute, not a run.
   * --------------------------------------------------------------------- */
  powers: [
    { kind: 'wing', p: [4.0, BELL + 1.10, -4.0], duration: 30 },
  ],

  /* ------------------------------------------------------------------------
   * OBJECTS — the built world, beat by beat.
   * --------------------------------------------------------------------- */
  objects: [

    /* ========================================================================
     * BEAT 0 — THE PRECINCT
     * The ground the whole course stands on: a 76 x 76 m walled deck at EXACTLY
     * 0.00 with a 6 x 6 m hole cut in the tower's north bay (x -3..3, z -8..-2)
     * for the pendulum well. Four slabs, not one, because the hole has to be a
     * real hole — a slab with a grate painted on it is a lie the pound button
     * finds out about. The parapet is walkable (top 1.40) so the edge of the
     * world is somewhere you stand, not somewhere you fall off by accident.
     * ===================================================================== */

    { kind: 'platform', p: deck(0, YARD, 18, [76, 2, 40]), s: [76, 2, 40], mat: 'stone', tint: LIME },        // z -2 .. 38
    { kind: 'platform', p: deck(0, YARD, -23, [76, 2, 30]), s: [76, 2, 30], mat: 'stone', tint: LIME },       // z -38 .. -8
    { kind: 'platform', p: deck(-20.5, YARD, -5, [35, 2, 6]), s: [35, 2, 6], mat: 'stone', tint: LIME },      // west of the hole
    { kind: 'platform', p: deck(20.5, YARD, -5, [35, 2, 6]), s: [35, 2, 6], mat: 'stone', tint: LIME },       // east of the hole

    { kind: 'platform', p: deck(0, 1.40, 37.4, [76, 1.4, 1.2]), s: [76, 1.4, 1.2], mat: 'stone', tint: LIME },
    { kind: 'platform', p: deck(0, 1.40, -37.4, [76, 1.4, 1.2]), s: [76, 1.4, 1.2], mat: 'stone', tint: LIME },
    { kind: 'platform', p: deck(-37.4, 1.40, 0, [1.2, 1.4, 76]), s: [1.2, 1.4, 76], mat: 'stone', tint: LIME },
    { kind: 'platform', p: deck(37.4, 1.40, 0, [1.2, 1.4, 76]), s: [1.2, 1.4, 76], mat: 'stone', tint: LIME },

    /* The spawn signs. The game boots at checkpoints[0] (game.js _spawnFor(0)),
       which is cp-yard at z 20, not `spawn` at z 30 — so at z 28 this board
       stood 8 m BEHIND the player's back on the first frame (data lane,
       _harness/_data_spawnscan.mjs, 2026-09-04: "signs<=6m: NONE"). Now 2.6 m
       ahead of cp-yard on the causeway's right kerb, facing the spawn. */
    { kind: 'text', p: [3.4, 2.70, 17.4], rot: [0, 0, 0], text: 'GEARHEART TOWER', size: 0.60, color: 0x2b4c5c },
    { kind: 'text', p: [3.4, 2.16, 17.4], rot: [0, 0, 0], text: 'EASE THE STICK TO WALK  ·  ALL THE WAY TO RUN', size: 0.22, color: 0x3f6f80 },
    { kind: 'text', p: [3.4, 1.80, 17.4], rot: [0, 0, 0], text: 'THE TOWER TURNS ON A BEAT  ·  SO DO YOU', size: 0.22, color: 0x3f6f80 },
    { kind: 'deco', kindOf: 'sign', p: [3.4, 1.15, 17.4], s: [0.14, 1.7, 1.2], mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'post', p: [3.4, 0.65, 17.4], s: [0.16, 1.3, 0.16], mat: 'metal', tint: IRON },

    // The pedestal the HUNDRED COINS crest rises from.
    { kind: 'pedestal', p: [-8.0, YARD, 20.0], mat: 'stone', tint: LIME, glow: GOLD },

    /* ========================================================================
     * BEAT 1 — THE GEAR YARD  (families: rotor, conveyor, mover, breakable)
     * Everything the tower will do later, at ground level where falling costs
     * nothing. A great cog turns flat on the deck and you can ride a tooth. A
     * chain belt runs EAST at 5.2 m/s and you have to run west along it to
     * reach the sigil above it — the course's one and only lesson about
     * fighting a surface, taught 30 m from the spawn and never repeated.
     * The COG CART on the east wall is ROUTE B's first rung.
     * ===================================================================== */

    // THE GREAT COG. `rotor` style 'bar' about a VERTICAL axle: four teeth,
    // 5.5 m long, one turn every 9 s, sweeping x -21.5..-10.5, z 8.5..19.5 —
    // clear of the parapet (x -37.4) and of the causeway lane (x -3..3).
    { kind: 'rotor', p: [-16, 1.60, 14], style: 'bar', arms: 4, len: 5.5, thick: 0.55, height: 0.5,
      period: 9.0, axis: 'y', mat: 'metal', tint: BRASS, stripe: true, edge: SAFE_EDGE },
    // Its hub cap: a STATIC top, so sigil 2 hangs over a floor and not over a ride.
    { kind: 'platform', p: deck(-16, 1.90, 14, [3.2, 0.6, 3.2]), s: [3.2, 0.6, 3.2], mat: 'metal', tint: COPPER, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [-16, 3.30, 19.6], rot: [0, 0, 0], text: 'RIDE A TOOTH  ·  STEP OFF BEFORE IT TURNS UNDER YOU', size: 0.22, color: 0x3f6f80 },

    // THE CHAIN BELT. `conveyor` running EAST at 5.2 m/s (TUNE.conveyorMax is
    // 8.0, so this is fast enough to lose to and slow enough to beat).
    { kind: 'conveyor', p: deck(12, YARD, 6, [10, 0.8, 3]), s: [10, 0.8, 3], dir: [1, 0, 0], power: 5.2, mat: 'metal', tint: IRON },
    { kind: 'conveyor', p: deck(-12, YARD, -14, [3, 0.8, 10]), s: [3, 0.8, 10], dir: [0, 0, 1], power: 4.4, mat: 'metal', tint: IRON },
    { kind: 'text', p: [17.8, 1.40, 6], rot: [0, -1.5708, 0], text: 'RUN AGAINST THE BELT', size: 0.24, color: 0x3f6f80 },

    // THE COG CART — ROUTE B. A `mover` counterweighted cage that climbs the
    // OUTSIDE of the east wall, 1.30 -> 32.70, one round trip every 22 s.
    // MEASURED at the top: the cart's west edge stands at x 11.90 and the
    // belfry balcony's east edge at x 11.50 — a 0.40 m step across at +0.30 m.
    { kind: 'mover', p: deck(13.5, 1.30, 0, [3.2, 0.6, 3.2]), s: [3.2, 0.6, 3.2],
      mat: 'metal', tint: BRASS, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'linear', to: [13.5, 32.40, 0], period: 22.0, ease: 'sine', dwell: 1.6 } },
    { kind: 'deco', kindOf: 'cables', p: [13.5, 17.0, 1.9], s: [0.3, 32.0, 0.3], mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'cables', p: [13.5, 17.0, -1.9], s: [0.3, 32.0, 0.3], mat: 'metal', tint: IRON },

    // The gnasher's crate: pounding its post three times springs the crate open.
    { kind: 'breakable', p: deck(-24, 1.10, -4, [1.6, 1.6, 1.6]), s: [1.6, 1.6, 1.6], mat: 'wood',
      shape: 'crate', tint: COPPER, drop: 'coins', dropCount: 6, openOn: 'gnasher-freed' },

    // Yard dressing: cog teeth propped against the parapet, pipes, a toolbench.
    ...decoRing('gear', -16, 0.55, 14, 8.4, 7, [1.5, 0.35, 1.5], 'metal', BRASS),
    ...decoRing('pipe', 0, 1.10, 0, 16.5, 8, [0.45, 2.2, 0.45], 'metal', IRON, 0.39),
    { kind: 'deco', kindOf: 'anvil', p: [-6.4, 0.42, 12.0], s: [1.2, 0.85, 0.7], mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'tool', p: [-5.0, 0.45, 13.2], s: [0.8, 0.9, 0.8], rot: [0, 0.5, 0], mat: 'metal', tint: IRON, count: 4, spread: 3.0, jitter: 0.3 },
    { kind: 'deco', kindOf: 'barrel', p: [7.4, 0.45, 14.6], s: [0.85, 0.9, 0.85], mat: 'metal', tint: COPPER, count: 5, spread: 4.4, jitter: 0.35 },
    { kind: 'deco', kindOf: 'crate', p: [9.2, 0.40, -18.0], s: [0.9, 0.8, 0.9], rot: [0, 0.3, 0], mat: 'wood', tint: COPPER, count: 5, spread: 5.0, jitter: 0.4 },
    { kind: 'deco', kindOf: 'monolith', p: [-28, 1.70, 24], s: [1.2, 3.4, 1.0], mat: 'stone', tint: LIME, count: 3, spread: 9.0, jitter: 0.5 },
    { kind: 'deco', kindOf: 'monolith', p: [28, 1.70, -24], s: [1.2, 3.4, 1.0], mat: 'stone', tint: LIME, count: 3, spread: 9.0, jitter: 0.5 },

    /* ========================================================================
     * BEAT 2 — THE PENDULUM WELL  (the SECRET; families: breakable, mover, cannon)
     * A 16 x 16 m rock chamber 12 m under the yard's north bay. Its lid is a
     * `breakable` iron grate filling the hole EXACTLY (x -3..3, z -8..-2);
     * nothing points at it except that the yard's paving stops being paving
     * there. Pound it, drop 12.10 m, and the well pays three times: the secret
     * crest, sigil 6, and the maintenance CANNON that fires you back up into
     * GALLERY 1 — ROUTE C, and the only shortcut past CLIMB A.
     *
     * Getting out without the cannon: the COUNTERWEIGHT, a `mover` that rides
     * -11.00 -> 1.00 every 16 s and steps off onto the grate lip (0.90 m drop
     * to the yard, walk-off distance there is 1.41 m).
     * ===================================================================== */

    { kind: 'breakable', p: deck(0, 0.10, -5, [6, 0.4, 6]), s: [6, 0.4, 6], mat: 'grate', tint: IRON,
      drop: 'none', trigger: 'well-grate', respawn: 0 },
    { kind: 'text', p: [0, 1.30, -1.2], rot: [0, 3.1416, 0], text: 'POUND THE GRATE', size: 0.26, color: 0x8c5a3a },

    { kind: 'platform', p: deck(0, WELL, -5, [16, 1.4, 16]), s: [16, 1.4, 16], mat: 'stone', tint: 0x9aa4a8 },
    { kind: 'platform', p: [-7.7, -6, -5], s: [1.4, 12, 16], mat: 'stone', tint: 0x9aa4a8 },
    { kind: 'platform', p: [7.7, -6, -5], s: [1.4, 12, 16], mat: 'stone', tint: 0x9aa4a8 },
    { kind: 'platform', p: [0, -6, -12.7], s: [16, 12, 1.4], mat: 'stone', tint: 0x9aa4a8 },
    { kind: 'platform', p: [0, -6, 2.7], s: [16, 12, 1.4], mat: 'stone', tint: 0x9aa4a8 },

    // THE COUNTERWEIGHT. 3.2 m square, so it clears the 6 m hole with 1.4 m of
    // margin on every side and can never jam against the lip.
    { kind: 'mover', p: deck(0, WELL + 1.00, -5, [3.2, 1.0, 3.2]), s: [3.2, 1.0, 3.2],
      mat: 'metal', tint: IRON, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'linear', to: [0, 0.50, -5], period: 16.0, ease: 'sine', dwell: 2.2 } },

    // THE CANNON — ROUTE C. It solves its own launch speed against the target,
    // which is 0.60 m over GALLERY 1's west walk (top 9.00), i.e. a 21.6 m
    // rise onto a 6 m wide ring floor.
    { kind: 'platform', p: deck(-5.0, WELL + 1.00, -8.5, [3.0, 1.0, 3.0]), s: [3.0, 1.0, 3.0], mat: 'metal', tint: COPPER, stripe: true, edge: SAFE_EDGE },
    { kind: 'cannon', p: [-5.0, WELL + 1.60, -8.5], yaw: 2.36, pitchDeg: 64, power: 26,
      target: [-6.0, G1 + 0.60, 0], r: 1.1, len: 3.0, mat: 'metal', tint: COPPER },
    { kind: 'text', p: [-5.0, WELL + 3.30, -6.4], rot: [0, 2.36, 0], text: 'CLIMB IN', size: 0.24, color: 0xd8c79a },

    { kind: 'pedestal', p: [0, WELL, -5.0], mat: 'stone', tint: LIME, glow: PATINA },
    { kind: 'light', p: [0, WELL + 3.6, -5], color: PATINA, intensity: 9, distance: 20 },
    { kind: 'deco', kindOf: 'chain', p: [4.6, -6.0, -9.4], s: [0.22, 11.0, 0.22], mat: 'metal', tint: IRON, count: 3, spread: 3.6, jitter: 0.2 },
    { kind: 'deco', kindOf: 'debris', p: [3.4, WELL + 0.35, -1.0], s: [1.0, 0.6, 1.0], mat: 'stone', tint: 0x8a949a, count: 6, spread: 6.0, jitter: 0.5 },

    /* ========================================================================
     * THE TOWER SHELL
     * Four walls, 1.8 m thick, y 0 -> 34, standing at +-9.90 so the interior is
     * EXACTLY 18 x 18 m. Three apertures, all of them load-bearing for a route:
     *   · the SOUTH PORTAL, x -2..2, full height — the way in;
     *   · the EAST LOUVRE, z -2..2, y 29..34 — where ROUTE B's cog cart lands;
     *   · the open sky above y 34, where the belfry stage carries the roof.
     * The walls are also what makes the winding shaft a shaft: see BEAT 11.
     * ===================================================================== */

    { kind: 'platform', p: [0, 17, -9.9], s: [21.6, 34, 1.8], mat: 'brick', tint: LIME },                    // north
    { kind: 'platform', p: [-9.9, 17, 0], s: [1.8, 34, 18], mat: 'brick', tint: LIME },                      // west
    { kind: 'platform', p: [-6.4, 17, 9.9], s: [8.8, 34, 1.8], mat: 'brick', tint: LIME },                   // south, west of the portal
    { kind: 'platform', p: [6.4, 17, 9.9], s: [8.8, 34, 1.8], mat: 'brick', tint: LIME },                    // south, east of the portal
    { kind: 'platform', p: [9.9, 17, -5.5], s: [1.8, 34, 7], mat: 'brick', tint: LIME },                     // east, north of the louvre
    { kind: 'platform', p: [9.9, 17, 5.5], s: [1.8, 34, 7], mat: 'brick', tint: LIME },                      // east, south of the louvre
    { kind: 'platform', p: [9.9, 14.5, 0], s: [1.8, 29, 4], mat: 'brick', tint: LIME },                      // east, under the louvre (y 0..29)

    { kind: 'text', p: [0, 6.2, 8.6], rot: [0, 0, 0], text: 'GEARHEART', size: 0.50, color: 0xe9dcbd },
    { kind: 'deco', kindOf: 'archway', p: [0, 3.0, 9.9], s: [1.2, 1.0, 5.2], mat: 'stone', tint: LIME },
    { kind: 'deco', kindOf: 'emblem', p: [0, 7.4, 8.9], s: [2.6, 2.6, 0.2], mat: 'copper', tint: COPPER },
    { kind: 'deco', kindOf: 'banner', p: [-3.2, 5.2, 8.8], s: [0.08, 3.4, 1.4], mat: 'cloth', tint: PATINA },
    { kind: 'deco', kindOf: 'banner', p: [3.2, 5.2, 8.8], s: [0.08, 3.4, 1.4], mat: 'cloth', tint: PATINA },

    /* ========================================================================
     * BEAT 3 — CLIMB A : yard 0.00 -> GALLERY 1 at 9.00
     * Five brass cog-tooth brackets spiralling up the tower's south-east
     * corner, inside the 6 x 6 m climb hole cut in gallery 1's floor.
     * MEASURED, bracket to bracket (each ledge is 2.00 x 2.00 m, so the gap is
     * centre-distance minus 2.00 — every one of them is 1.40 m):
     *   yard -> A1   dy +1.50, take-off directly under it (vertical-safe 2.87)
     *   A1 -> A2     gap 1.40 m at +1.50 m   (single-safe there 3.38 m)
     *   A2 -> A3     gap 1.40 m at +1.50 m
     *   A3 -> A4     gap 1.40 m at +1.50 m
     *   A4 -> A5     gap 1.40 m at +1.50 m
     *   A5 -> G1     gap 0.30 m at +1.50 m   (onto the east ring walk)
     * Every one is half the single-jump budget, because this is the route the
     * gate walks and the route a player falls back to at difficulty 8.
     * ===================================================================== */

    bracket(7.7, 1.50, 7.7),
    bracket(4.3, 3.00, 7.7),
    bracket(7.7, 4.50, 6.0),
    bracket(4.3, 6.00, 4.3),
    bracket(7.7, 7.50, 4.3),
    { kind: 'text', p: [7.7, 2.90, 5.4], rot: [0, 1.5708, 0], text: 'LAND AND JUMP AGAIN TO CHAIN A HIGHER ONE', size: 0.20, color: 0xd8c79a },

    /* ========================================================================
     * BEAT 4 — GALLERY 1, THE GEAR ROOM  (families: rotor, vanish, beam, conveyor)
     * A RING floor at EXACTLY 9.00: four slabs around a 6 x 6 open heart, with
     * the south-east 6 x 6 left open as CLIMB A's hole. Inside it a great
     * horizontal cog turns every 8 s, a `beam` tripwire ticks across the north
     * walk, and four `vanish` cog-teeth bridge the open heart — sigil 3 hangs
     * over the middle one with a 9 m drop under it. Nothing here is required
     * except the walk from CLIMB A's top to CLIMB B's foot.
     * ===================================================================== */

    { kind: 'platform', p: deck(-6, G1, 0, [6, 0.6, 18]), s: [6, 0.6, 18], mat: 'panel', tint: LIME },       // west walk
    { kind: 'platform', p: deck(0, G1, 6, [6, 0.6, 6]), s: [6, 0.6, 6], mat: 'panel', tint: LIME },          // south walk
    { kind: 'platform', p: deck(0, G1, -6, [6, 0.6, 6]), s: [6, 0.6, 6], mat: 'panel', tint: LIME },         // north walk
    { kind: 'platform', p: deck(6, G1, -3, [6, 0.6, 12]), s: [6, 0.6, 12], mat: 'panel', tint: LIME },       // east walk

    { kind: 'rotor', p: [-6, G1 + 0.75, 0], style: 'bar', arms: 3, len: 4.2, thick: 0.5, height: 0.5,
      period: 8.0, axis: 'y', mat: 'metal', tint: BRASS, stripe: true, edge: SAFE_EDGE },

    // The four vanish cog-teeth over the heart. Cycle 2.6 s solid / 1.9 s gone
    // with a 0.7 s warn tail, staggered a quarter cycle apart so the crossing
    // is a rhythm and not a coin flip.
    { kind: 'vanish', p: deck(0, G1 + 0.60, 0, [2.4, 0.4, 2.4]), s: [2.4, 0.4, 2.4], mode: 'cycle',
      cycle: { on: 2.6, off: 1.9, warn: 0.7, phase: 0.0 }, mat: 'metal', tint: PATINA, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: deck(-2.4, G1 + 0.60, 2.4, [1.8, 0.4, 1.8]), s: [1.8, 0.4, 1.8], mode: 'cycle',
      cycle: { on: 2.6, off: 1.9, warn: 0.7, phase: 1.1 }, mat: 'metal', tint: PATINA, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: deck(2.4, G1 + 0.60, -2.4, [1.8, 0.4, 1.8]), s: [1.8, 0.4, 1.8], mode: 'cycle',
      cycle: { on: 2.6, off: 1.9, warn: 0.7, phase: 2.2 }, mat: 'metal', tint: PATINA, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: deck(2.4, G1 + 0.60, 2.4, [1.8, 0.4, 1.8]), s: [1.8, 0.4, 1.8], mode: 'cycle',
      cycle: { on: 2.6, off: 1.9, warn: 0.7, phase: 3.3 }, mat: 'metal', tint: PATINA, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [0, G1 + 1.9, 8.4], rot: [0, 3.1416, 0], text: 'THEY COME BACK  ·  WAIT FOR THE FLICKER', size: 0.22, color: 0xd8c79a },

    // The tripwire across the north walk. Armed 1.4 s, dark 2.2 s, with a
    // 0.8 s telegraph: a kill volume NEVER arms during the warn (hazards §21).
    { kind: 'beam', a: [-8.6, G1 + 0.9, -6.0], b: [8.6, G1 + 0.9, -6.0], mode: 'single', radius: 0.16,
      cycle: { on: 1.4, off: 2.2, warn: 0.8, phase: 0.0 }, color: DANGER },
    { kind: 'text', p: [0, G1 + 2.1, -8.4], rot: [0, 0, 0], text: 'THE LIGHT TICKS  ·  CROSS ON THE DARK', size: 0.22, color: 0xd8c79a },

    { kind: 'conveyor', p: deck(-6, G1, -6.0, [4, 0.6, 4]), s: [4, 0.6, 4], dir: [0, 0, 1], power: 3.6, mat: 'metal', tint: IRON },
    { kind: 'light', p: [0, G1 + 4.0, 0], color: 0xffe2b0, intensity: 10, distance: 22 },
    ...decoRing('gear', 0, G1 + 1.6, 0, 8.2, 6, [1.6, 0.4, 1.6], 'metal', BRASS, 0.52),
    { kind: 'deco', kindOf: 'rail', p: [-8.4, G1 + 0.6, 0], s: [0.12, 1.0, 17.0], mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'rail', p: [8.4, G1 + 0.6, -3], s: [0.12, 1.0, 11.0], mat: 'metal', tint: IRON },

    /* ========================================================================
     * BEAT 5 — CLIMB B : GALLERY 1 at 9.00 -> GALLERY 2 at 17.00
     * Four brackets up the NORTH-EAST corner, inside gallery 2's climb hole.
     * MEASURED: G1 -> B1 is +1.60 m straight up off the east walk; B1->B2,
     * B2->B3 and B3->B4 are each a 1.40 m gap at +1.60 m (single-safe 3.28 m);
     * B4 -> G2's north walk is a 0.30 m gap at +1.60 m.
     * ===================================================================== */

    bracket(7.7, 10.60, -7.7),
    bracket(4.3, 12.20, -7.7),
    bracket(7.7, 13.80, -6.0),
    bracket(4.3, 15.40, -4.3),

    // Two escapement pallets swing across this corner — the first taste of the
    // thing the whole tower is built around. `mode:'ball'` is solid and only
    // lethal above a threshold tip speed, so a pallet is a moving wall, not a
    // guillotine (contract §21 pendulum).
    { kind: 'pendulum', p: [8.4, 15.4, -2.6], len: 3.4, ampDeg: 34, period: 3.2, axis: 'x', mode: 'ball', radius: 0.7, tint: IRON },
    { kind: 'pendulum', p: [2.6, 12.6, -8.4], len: 3.0, ampDeg: 30, period: 2.6, phaseCycles: 0.5, axis: 'z', mode: 'ball', radius: 0.6, tint: IRON },

    /* ========================================================================
     * BEAT 6 — GALLERY 2, THE TURNING ROOM  (families: rotor, mover, seesaw, vanish)
     * The brief's "rooms that rotate". The loader has no `style:'room'` rotor,
     * so the room turns the way a clock room actually would: a four-armed
     * `rotor` FLOOR-BAR 7.4 m long sweeping the whole ring at knee height on an
     * 11 s period, with two `mover` DOOR panels that only line up with the
     * gallery's walks on the beat. Ride an arm across the heart or wait for a
     * door — either way the static ring walk is still there underneath, which
     * is why this room is fun and not a coin flip.
     * ===================================================================== */

    { kind: 'platform', p: deck(-6, G2, 0, [6, 0.6, 18]), s: [6, 0.6, 18], mat: 'panel', tint: LIME },       // west walk
    { kind: 'platform', p: deck(0, G2, 6, [6, 0.6, 6]), s: [6, 0.6, 6], mat: 'panel', tint: LIME },          // south walk
    { kind: 'platform', p: deck(0, G2, -6, [6, 0.6, 6]), s: [6, 0.6, 6], mat: 'panel', tint: LIME },         // north walk
    { kind: 'platform', p: deck(6, G2, 3, [6, 0.6, 12]), s: [6, 0.6, 12], mat: 'panel', tint: LIME },        // east walk

    { kind: 'rotor', p: [0, G2 + 0.70, 0], style: 'bar', arms: 4, len: 7.4, thick: 0.55, height: 0.55,
      period: 11.0, axis: 'y', dir: -1, mat: 'metal', tint: BRASS, stripe: true, edge: SAFE_EDGE },

    // THE DOORS. Two 3.2 m panels sliding on the same 11 s beat as the room, a
    // half-cycle apart, so exactly one of them is open at any moment.
    { kind: 'mover', p: deck(-6.0, G2 + 0.30, 8.6, [3.2, 0.5, 3.2]), s: [3.2, 0.5, 3.2],
      mat: 'metal', tint: COPPER, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'linear', to: [-6.0, G2 + 0.30 - 0.25, 3.4], period: 11.0, ease: 'inout', dwell: 2.4 } },
    { kind: 'mover', p: deck(6.0, G2 + 0.30, -8.6, [3.2, 0.5, 3.2]), s: [3.2, 0.5, 3.2],
      mat: 'metal', tint: COPPER, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'linear', to: [6.0, G2 + 0.30 - 0.25, -3.4], period: 11.0, phase: 0.5, ease: 'inout', dwell: 2.4 } },

    // THE SEESAW. Pivoted on the heart's south edge, 7 m long, tilting about
    // its own long axis' perpendicular: walk to the low end and it lifts you.
    { kind: 'seesaw', p: [0, G2 + 0.40, 0], s: [7.0, 0.4, 2.2], axis: 'z', maxDeg: 20, spring: 5,
      mat: 'wood', tint: COPPER, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [0, G2 + 2.0, 8.4], rot: [0, 3.1416, 0], text: 'WALK TO THE LOW END', size: 0.22, color: 0xd8c79a },

    // The vanish plank line along the south walk — sigil-line and coin-line.
    { kind: 'vanish', p: deck(-4.6, G2 + 0.20, 7.0, [2.2, 0.4, 2.2]), s: [2.2, 0.4, 2.2], mode: 'cycle',
      cycle: { on: 2.2, off: 1.6, warn: 0.6, phase: 0.0 }, mat: 'metal', tint: PATINA, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: deck(4.6, G2 + 0.20, 7.0, [2.2, 0.4, 2.2]), s: [2.2, 0.4, 2.2], mode: 'cycle',
      cycle: { on: 2.2, off: 1.6, warn: 0.6, phase: 1.9 }, mat: 'metal', tint: PATINA, stripe: true, edge: SAFE_EDGE },

    { kind: 'light', p: [0, G2 + 4.0, 0], color: 0xffe2b0, intensity: 10, distance: 22 },
    ...decoRing('gear', 0, G2 + 1.6, 0, 8.2, 6, [1.6, 0.4, 1.6], 'metal', BRASS),
    { kind: 'deco', kindOf: 'rail', p: [-8.4, G2 + 0.6, 0], s: [0.12, 1.0, 17.0], mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'panel', p: [0, G2 + 2.6, -8.9], s: [5.0, 2.4, 0.2], mat: 'panel', tint: COPPER },

    /* ========================================================================
     * BEAT 7 — CLIMB C : GALLERY 2 at 17.00 -> GALLERY 3 at 25.00
     * Four brackets up the SOUTH-WEST corner (the spiral changes hands, so the
     * tower is read from every side). Identical budget to CLIMB B: three 1.40 m
     * gaps at +1.60 m, then a 0.30 m step at +1.60 m onto the west walk.
     * A `beam` grid ticks across the corner at 21 m — the first time the light
     * and the jump have to be timed together.
     * ===================================================================== */

    bracket(-7.7, 18.60, 7.7),
    bracket(-4.3, 20.20, 7.7),
    bracket(-7.7, 21.80, 6.0),
    bracket(-4.3, 23.40, 4.3),

    { kind: 'beam', a: [-8.6, 21.3, 8.4], b: [-1.4, 21.3, 8.4], mode: 'single', radius: 0.16,
      cycle: { on: 1.2, off: 2.4, warn: 0.8, phase: 0.6 }, color: DANGER },
    { kind: 'beam', a: [-8.6, 19.8, 4.6], b: [-1.4, 19.8, 4.6], mode: 'single', radius: 0.16,
      cycle: { on: 1.2, off: 2.4, warn: 0.8, phase: 1.8 }, color: DANGER },

    /* ========================================================================
     * BEAT 8 — GALLERY 3, THE ESCAPEMENT  (SET-PIECE)
     * (families: pendulum, crusher, beam, rotor)
     *
     * THE GREAT ESCAPEMENT. A 13 m pendulum hangs from an axle at y 32.00, just
     * under the bell deck, and swings down the tower's whole open heart to a
     * bob at y 19.00 — through gallery 3 AND gallery 2, so it is the one thing
     * you can see from every floor and the reason the galleries are rings.
     * MEASURED: ampDeg 10 puts the bob 2.26 m off centre and the rod 1.22 m off
     * centre where it crosses gallery 3's floor plane, so it never touches the
     * ring walk (nearest edge 3.00 m) and clears the turning room's seesaw
     * (top 17.60) by 0.50 m at the bottom of every stroke.
     *
     * Around it, the escapement proper: two `crusher` pallet hammers dropping
     * on the tick, and the tripwires between them. The hammers are LETHAL only
     * on the driving face — parked, a crusher is a platform that carries you,
     * which is why sigil 5 sits on one.
     * ===================================================================== */

    { kind: 'platform', p: deck(6, G3, 0, [6, 0.6, 18]), s: [6, 0.6, 18], mat: 'panel', tint: LIME },        // east walk
    { kind: 'platform', p: deck(0, G3, 6, [6, 0.6, 6]), s: [6, 0.6, 6], mat: 'panel', tint: LIME },          // south walk
    { kind: 'platform', p: deck(0, G3, -6, [6, 0.6, 6]), s: [6, 0.6, 6], mat: 'panel', tint: LIME },         // north walk
    { kind: 'platform', p: deck(-6, G3, -3, [6, 0.6, 12]), s: [6, 0.6, 12], mat: 'panel', tint: LIME },      // west walk

    { kind: 'pendulum', p: [0, 32.0, 0], len: 13.0, ampDeg: 10, period: 7.0, axis: 'z', mode: 'ball',
      radius: 0.9, tint: COPPER },

    { kind: 'crusher', p: deck(6.0, G3 + 1.50, 6.0, [2.4, 1.2, 2.4]), s: [2.4, 1.2, 2.4],
      axis: [0, -1, 0], travel: 3.2, period: 4.5, dwell: 0.9, mode: 'single', mat: 'metal', tint: DANGER },
    { kind: 'crusher', p: deck(-6.0, G3 + 1.50, 6.0, [2.4, 1.2, 2.4]), s: [2.4, 1.2, 2.4],
      axis: [0, -1, 0], travel: 3.2, period: 4.5, phase: 0.5, dwell: 0.9, mode: 'single', mat: 'metal', tint: DANGER },
    { kind: 'crusher', p: deck(0, G3 + 1.50, -6.0, [2.4, 1.2, 2.4]), s: [2.4, 1.2, 2.4],
      axis: [0, -1, 0], travel: 3.2, period: 4.5, phase: 0.25, dwell: 0.9, mode: 'single', mat: 'metal', tint: DANGER },

    { kind: 'beam', a: [-8.6, G3 + 1.0, 0], b: [-3.4, G3 + 1.0, 0], mode: 'single', radius: 0.16,
      cycle: { on: 1.6, off: 2.0, warn: 0.7, phase: 0.9 }, color: DANGER },

    { kind: 'rotor', p: [-6, G3 + 0.70, -6.0], style: 'bar', arms: 3, len: 3.6, thick: 0.45, height: 0.45,
      period: 6.0, axis: 'y', mat: 'metal', tint: BRASS, stripe: true, edge: SAFE_EDGE },

    { kind: 'text', p: [-6.0, G3 + 2.2, -8.4], rot: [0, 0, 0], text: 'THE HAMMERS REST ON THE TICK  ·  STAND ON THEM', size: 0.22, color: 0xd8c79a },
    { kind: 'light', p: [0, G3 + 4.5, 0], color: PATINA, intensity: 11, distance: 24 },
    ...decoRing('gear', 0, G3 + 1.6, 0, 8.2, 6, [1.6, 0.4, 1.6], 'metal', BRASS, 0.26),
    { kind: 'deco', kindOf: 'chandelier', p: [0, G3 + 5.4, 0], s: [2.6, 1.4, 2.6], mat: 'metal', tint: BRASS },

    /* ========================================================================
     * BEAT 9 — CLIMB D : GALLERY 3 at 25.00 -> the BELL DECK at 33.00
     * Four brackets back up the SOUTH-EAST corner. Same measured budget as
     * B and C: three 1.40 m gaps at +1.60 m, then 0.30 m at +1.60 m onto the
     * bell deck. The great pendulum's axle is 1.00 m off your shoulder on the
     * last bracket, which is the point.
     * ===================================================================== */

    bracket(7.7, 26.60, 7.7),
    bracket(4.3, 28.20, 7.7),
    bracket(7.7, 29.80, 6.0),
    bracket(4.3, 31.40, 4.3),

    /* ========================================================================
     * BEAT 10 — THE BELL CHAMBER  (families: seesaw, beam, mover; the WARDEN)
     * A solid deck at 33.00 capping the tower's heart, with the south-east
     * 6 x 6 left open as CLIMB D's hole. The bell hangs in the middle on a
     * `mover` rope that rides 34.60 <-> 36.60 every 5 s (sigil 7 rides the top
     * of the stroke), two `seesaw` sounding beams span the north half, and the
     * WARDEN patrols a 6.5 m ring around the bell. Its charge needs a wall to
     * break itself on: the tower's own parapet is that wall.
     * ===================================================================== */

    { kind: 'platform', p: deck(0, BELL, -3, [18, 0.6, 12]), s: [18, 0.6, 12], mat: 'panel', tint: LIME },   // z -9..3
    { kind: 'platform', p: deck(-3, BELL, 6, [12, 0.6, 6]), s: [12, 0.6, 6], mat: 'panel', tint: LIME },     // x -9..3, z 3..9

    // THE BELL ROPE. `oscillate` about +Y, landable at 34.60 at the bottom of
    // the stroke (a 1.60 m step off the bell deck) and 36.60 at the top, joined
    // by the ride; the player sees a bell breathing on a five-second stroke.
    // AMPLITUDE IS 1.00 AND NOT 1.60 ON PURPOSE: at 1.60 the top pose sat
    // 2.80 m under the clock face deck, which is inside the 2.87 m backflip
    // envelope, so the reach gate credited a route that a player cannot
    // perform — the deck is DIRECTLY overhead and the flip bonks its underside.
    // At 1.00 the gap is 3.40 m, the false route is gone, and the winding
    // shaft is what it is written to be: the last leg of every route.
    { kind: 'mover', p: deck(0, 35.60, 0, [2.4, 0.4, 2.4]), s: [2.4, 0.4, 2.4],
      mat: 'metal', tint: COPPER, stripe: true, edge: SAFE_EDGE,
      motion: { type: 'oscillate', axis: [0, 1, 0], amp: 1.0, period: 5.0, ease: 'sine' } },
    { kind: 'deco', kindOf: 'chain', p: [0, 38.6, 0], s: [0.22, 3.4, 0.22], mat: 'metal', tint: IRON },

    { kind: 'seesaw', p: [-4.5, BELL + 0.40, -5.5], s: [6.0, 0.4, 2.0], axis: 'z', maxDeg: 18, spring: 5,
      mat: 'wood', tint: COPPER, stripe: true, edge: SAFE_EDGE },
    { kind: 'seesaw', p: [4.5, BELL + 0.40, -5.5], s: [6.0, 0.4, 2.0], axis: 'z', maxDeg: 18, spring: 5,
      mat: 'wood', tint: COPPER, stripe: true, edge: SAFE_EDGE },

    { kind: 'beam', a: [-8.6, BELL + 1.0, 1.6], b: [8.6, BELL + 1.0, 1.6], mode: 'single', radius: 0.16,
      cycle: { on: 1.3, off: 2.5, warn: 0.9, phase: 1.4 }, color: DANGER },

    // The pedestal the EIGHT SIGILS crest rises from — 4.70 m from cp-bell and
    // 7.21 m from the Warden's centre, so neither one stands in the other.
    { kind: 'pedestal', p: [-4.0, BELL, -6.0], mat: 'stone', tint: LIME, glow: GOLD },
    { kind: 'text', p: [-4.0, BELL + 2.3, -8.4], rot: [0, 0, 0], text: 'JUMP THE WAVE  ·  DODGE THE CHARGE  ·  POUND ITS BACK', size: 0.22, color: 0x8c5a3a },
    { kind: 'light', p: [0, BELL + 4.0, 0], color: 0xffe2b0, intensity: 9, distance: 20 },
    ...decoRing('pillar', 0, BELL + 1.6, -3, 8.0, 6, [0.7, 2.6, 0.7], 'stone', LIME, 0.4),
    { kind: 'deco', kindOf: 'rail', p: [0, BELL + 0.6, -8.6], s: [17.0, 1.0, 0.12], mat: 'metal', tint: IRON },

    /* ========================================================================
     * BEAT 11 — THE WINDING SHAFT  (the last leg of every route)
     * A 3.30 x 3.30 m chimney in the east-north corner of the bell deck, four
     * slabs, running 33.00 -> 40.00 — 3.30 m clear against the contract's
     * 3.4 m limit. From the pad at 33.30 the cap ledge at 40.00 is 6.70 m up:
     * one jump (apex 1.91 m) plus three wall kicks at 2.00 m each = 7.91 m of
     * lift, 1.21 m of margin, and no ceiling to bonk on because the face deck
     * carries a 4.0 x 4.0 hole directly over the shaft.
     * ===================================================================== */

    { kind: 'platform', p: deck(SHAFT_C[0], SHAFT_PAD, SHAFT_C[1], [3.3, 0.3, 3.3]), s: [3.3, 0.3, 3.3], mat: 'metal', tint: IRON, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: [SHAFT_C[0], 36.5, -8.65], s: [4.1, 7.0, 0.8], mat: 'brick', tint: LIME },
    { kind: 'platform', p: [SHAFT_C[0], 36.5, -4.55], s: [4.1, 7.0, 0.8], mat: 'brick', tint: LIME },
    { kind: 'platform', p: [4.55, 36.5, SHAFT_C[1]], s: [0.8, 7.0, 3.3], mat: 'brick', tint: LIME },
    { kind: 'platform', p: [8.65, 36.5, SHAFT_C[1]], s: [0.8, 7.0, 3.3], mat: 'brick', tint: LIME },
    // The cap ledge: 0.80 m of deck ON TOP of the shaft's south wall, at
    // EXACTLY 40.00, so the last kick lands on a lip and not on a lid.
    { kind: 'platform', p: deck(SHAFT_C[0], FACE, -4.55, [4.1, 0.3, 0.8]), s: [4.1, 0.3, 0.8], mat: 'metal', tint: BRASS, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [4.9, 34.6, -6.6], rot: [0, -1.5708, 0], text: 'KICK ONE WALL, THEN THE OTHER', size: 0.20, color: 0xd8c79a },

    /* ========================================================================
     * BEAT 12 — THE CLOCK FACE  (families: rotor, rings; the OPEN CREST)
     * The roof, at EXACTLY 40.00, in two slabs so the winding shaft comes up
     * through a 4.0 x 4.0 hole in its east-north corner. Three limestone
     * columns and the shaft turret carry it off the wall head at 34.00.
     * The HOUR HAND is a `rotor` with a 90 s period sweeping 1.40 m over the
     * deck; the crest sits on the STATIC XII bracket its tip reaches, because a
     * rotor is a ride and a crest has to hang over a floor.
     * ===================================================================== */

    { kind: 'platform', p: [-6.6, 37.0, -6.6], s: [2.4, 6.0, 2.4], mat: 'brick', tint: LIME },
    { kind: 'platform', p: [-6.6, 37.0, 6.6], s: [2.4, 6.0, 2.4], mat: 'brick', tint: LIME },
    { kind: 'platform', p: [6.6, 37.0, 6.6], s: [2.4, 6.0, 2.4], mat: 'brick', tint: LIME },

    { kind: 'platform', p: deck(-2.0, FACE, 0, [13.2, 0.6, 17.2]), s: [13.2, 0.6, 17.2], mat: 'marble', tint: LIME, stripe: true, edge: SAFE_EDGE },
    { kind: 'platform', p: deck(6.6, FACE, 2.225, [4.0, 0.6, 12.75]), s: [4.0, 0.6, 12.75], mat: 'marble', tint: LIME, stripe: true, edge: SAFE_EDGE },

    // THE HOUR HAND — one turn every 90 s, tips sweeping a 7 m circle.
    { kind: 'rotor', p: [0, HAND_Y, 0], style: 'bar', arms: 2, len: 7.0, thick: 0.34, height: 0.36,
      period: 90.0, axis: 'y', mat: 'metal', tint: BRASS, stripe: true, edge: SAFE_EDGE },

    // The XII bracket the crest stands on, and the XI bracket sigil 8 hangs over.
    { kind: 'pedestal', p: [0, FACE, -7.4], mat: 'marble', tint: LIME, glow: GOLD },
    { kind: 'platform', p: deck(-7.5, 40.60, -7.5, [2.4, 0.4, 2.4]), s: [2.4, 0.4, 2.4], mat: 'metal', tint: BRASS, stripe: true, edge: SAFE_EDGE },
    // The race finish plate.
    { kind: 'platform', p: deck(-3.0, FACE, -6.0, [3.4, 0.2, 3.4]), s: [3.4, 0.2, 3.4], mat: 'metal', tint: PATINA },
    { kind: 'text', p: [-3.0, FACE + 1.3, -6.0], rot: [0, 0, 0], text: 'THE HOUR RUN  ·  80s', size: 0.26, color: 0x2b6a7a },

    { kind: 'light', p: [0, FACE + 3.2, -6.0], color: GOLD, intensity: 11, distance: 22 },
    { kind: 'deco', kindOf: 'emblem', p: [0, 24.0, 10.9], s: [11.0, 11.0, 0.4], mat: 'glass', tint: GLASS },
    { kind: 'deco', kindOf: 'statue', p: [-6.0, FACE + 1.3, 6.0], s: [1.2, 2.6, 1.2], mat: 'marble', tint: LIME, count: 3, spread: 7.0, jitter: 0.3 },
    ...decoRing('gear', 0, FACE + 0.5, 0, 7.6, 8, [1.3, 0.35, 1.3], 'metal', BRASS, 0.2),

    /* ========================================================================
     * BEAT 13 — ROUND THE OUTSIDE  (the `wing` power overlay)
     * Ten rings spiralling DOWN the outside of the tower from the bell frame
     * and back up to the clock face — the only time the course lets you look at
     * the machine from outside it, and the reason the east face was worth
     * building. Take the hat off the bell frame first; a pass refreshes flight.
     * ===================================================================== */

    {
      kind: 'rings', r: 2.6, tint: GOLD, mat: 'gold', flyRefresh: 4,
      pts: Array.from({ length: 10 }, (_, i) => {
        const a = -1.2 + i * (Math.PI * 2 / 10) * 1.35;   // 1.35 turns over ten rings
        const rad = 15.5 - i * 0.35;
        return [r2(Math.cos(a) * rad), r2(31.5 - i * 1.15 + (i > 6 ? (i - 6) * 3.6 : 0)), r2(Math.sin(a) * rad)];
      }),
    },

    // The belfry louvre balcony — ROUTE B's landing. MEASURED: the cog cart's
    // west edge stops at x 11.90 and this deck's east edge is x 11.50, a
    // 0.40 m step at +0.30 m; its west edge overlaps the bell deck, so the
    // step inland is a walk.
    { kind: 'platform', p: deck(10.0, BELL, 0, [3.0, 0.3, 4.0]), s: [3.0, 0.3, 4.0], mat: 'metal', tint: BRASS, stripe: true, edge: SAFE_EDGE },
    { kind: 'text', p: [11.4, BELL + 1.3, 0], rot: [0, -1.5708, 0], text: 'THE CART RUNS EVERY 22 SECONDS', size: 0.20, color: 0xd8c79a },
  ],

  /* ------------------------------------------------------------------------
   * CRITTERS — clockwork, all of them, because the tower has no weather.
   * --------------------------------------------------------------------- */
  critters: [
    // THE SPRING-LOADED GNASHER. Chained to a post on the yard's west bay,
    // 6 m of chain, so its reach is a disc you can pace out from outside it.
    // The crate it guards is 5.60 m from the post — INSIDE the disc.
    {
      kind: 'gnasher', p: [-24.0, YARD, -8.0], chain: 6.0,
      post: [-24.0, YARD, -9.6], postHits: 3, trigger: 'gnasher-freed',
      telegraph: 0.5, tint: IRON,
    },
    // WIND-UP BUMBLERS. Side contact is knockback, not death (contract §23).
    { kind: 'bumbler', path: [[8, YARD, 20], [20, YARD, 16], [16, YARD, 26], [8, YARD, 20]], speed: 1.6 },
    { kind: 'bumbler', path: [[-6, G1, 6], [-6, G1, -6], [6, G1, -6], [-6, G1, 6]], speed: 1.8 },
    { kind: 'bumbler', path: [[6, G3, 6], [6, G3, -6], [0, G3, -6], [6, G3, 6]], speed: 1.7 },
    // CLOCKWORK MOTHS. One inside the tower's heart, one round the clock face.
    { kind: 'skitter', p: [0, 21.0, 0], path: [[0, 20.0, 0], [0, 30.0, 0]], amp: 2.2, speed: 3.6 },
    { kind: 'skitter', p: [0, 44.0, 0], path: [[-9, 43.5, -9], [9, 45.5, 9]], amp: 1.8, speed: 4.0 },
    // THE WARDEN OF THE BELL. Three hits, on the flat of the bell deck, its
    // ring 6.50 m about the bell — the tower's own parapet is the wall its
    // charge breaks itself on.
    { kind: 'warden', p: [0, BELL, 0], arena: { c: [0, 0], r: 6.5 }, hp: 3, tint: IRON },
  ],
};
