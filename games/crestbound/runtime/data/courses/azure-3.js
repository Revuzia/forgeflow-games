/**
 * CRESTBOUND — AZURE SANCTUM 3 : "PRISM RIDE"
 * runtime/data/courses/azure-3.js                                   CONTRACT §25
 * ===========================================================================
 *
 * The FINALE. An open sky diorama ~122 x 160 m across and 38 m of verticality
 * (walkable y 21.0 -> 59.0), hung over nothing: a rail station on a cloud
 * anchor in the south-east, two prism sleepers across the first void, the
 * PRISM GARDENS in the middle, a wing flight west over a cloud shelf, a chain
 * of cannon isles east, and THE GAUNTLET — a 99 m rainbow road under the
 * sanctum arc, ending at the Grand Pedestal.
 *
 * There is NO TERRAIN. `verdant-1` is a heightfield course and every `p` in it
 * is justified against `terrainHeightAt`; this one is a PURE PLATFORM course
 * (the COURSES.md brief says so in as many words: "floating islands ... no —
 * pure platforms"), so the authority for every `p` here is a NAMED PLATFORM
 * TOP instead. `slab(x, top, z, sx, sz)` below takes the walkable TOP as its
 * argument and solves `p`/`s` for it, so a comment that says "top 34.00" is
 * the number the collider publishes, not a number that had to be added up.
 *
 *   BEAT 1  THE RAIL STATION   spawn, the carts, the coin crest, and a secret
 *                              8.00 m below-and-behind you
 *   BEAT 2  THE VOID CROSSING  two prism sleepers; the mover carts run beside
 *                              them for anyone who would rather ride
 *   BEAT 3  THE PRISM GARDENS  the HUB. Pendulum prisms, pulse beams, and the
 *                              first vanish tiles — taught here, demanded in
 *                              the gauntlet
 *   BEAT 4  THE WING RUN       wings + 16 rings through three air currents,
 *                              over a cloud shelf that catches every miss
 *   BEAT 5  THE CANNON ISLES   three isles joined by cannons, rotor spokes,
 *                              and the WARDEN on the last one
 *   BEAT 6  THE CAUSEWAY       one 30 m prism ramp, 24.9 deg, up to the road
 *   BEAT 7  THE GAUNTLET       99 m of road in four decks: vanish tiles, prism
 *                              hammers, a rotor, wind, and the cloud closing
 *                              underneath the whole thing
 *   BEAT 8  THE SANCTUM        the Grand Pedestal and the open crest
 *
 * ---------------------------------------------------------------------------
 * ROUTES TO THE OPEN CREST (contract §25 "multiple routes", critic rubric 3)
 * ---------------------------------------------------------------------------
 *  A  THE RIDE      station -> sleepers -> GARDENS -> wing pier -> RINGS ->
 *                   wing landing -> the causeway ramp -> the four road decks
 *                   -> sanctum. The intended line, and the shortest: eleven
 *                   surfaces from spawn to the pedestal.
 *  B  THE BLUFF     station -> sleepers -> GARDENS -> DROP off the west lip
 *                   onto the cloud shelf -> the sky mast (a climbable pole) ->
 *                   wing landing -> the causeway. Identical from the ramp on,
 *                   but it never asks you to fly: the entire wing run is
 *                   optional, which is what makes the rings a crest and not a
 *                   toll booth. It is also what happens to you automatically
 *                   if you miss three rings, so a failed flight is a detour.
 *  C  THE CANNON    station -> sleepers -> GARDENS -> jump pad -> isle 1 ->
 *                   cannon -> isle 2 -> cannon -> isle 3 (the Warden) ->
 *                   cannon -> straight onto the GAUNTLET MID DECK, skipping
 *                   the causeway and the first 22 m of road. The fast line,
 *                   and the only one that walks past the boss.
 *
 * Every route is STATIC-LEGAL: nothing required is reachable only by riding a
 * mover. The carts in BEAT 2 duplicate the sleepers, the rings in BEAT 4
 * duplicate the shelf + mast, and the cannons in BEAT 5 are a shortcut past a
 * road that is walkable end to end.
 *
 * ---------------------------------------------------------------------------
 * THE REACH BUDGET ACTUALLY USED (safe limits printed by core/tuning.js:
 * single 4.52 flat / 3.88 at +1.0 / 3.68 at +1.2 / 3.38 at +1.5 · triple 6.11
 * flat, 5.20 at +2.0, 4.46 at +3.0 · longjump 6.42 flat, 9.82 on a -9.0 drop.
 * Every RISE up to 2.87 m is legal from any approach — the backflip needs no
 * run-up and no landings.)
 * ---------------------------------------------------------------------------
 *   REQUIRED, single-jump-safe (no run-up needed anywhere):
 *     station lip -> sleeper 1        2.40 m at +1.50 m   (safe 3.38)
 *     sleeper 1 -> sleeper 2          2.80 m at +1.30 m   (safe 3.58)
 *     sleeper 2 -> the gardens        2.40 m at +1.20 m   (safe 3.68)
 *     gardens -> the wing pier        3.00 m at +1.40 m   (safe 3.48)
 *     wing pier -> the wing landing   2.00 m at +1.60 m   (safe 3.28)
 *     sky mast top -> wing landing    1.08 m at  0.00 m   (safe 4.52)
 *   REQUIRED, run-up-backed (the last column of the CONTRACT §0 table; each
 *   one is a TRIPLE and each take-off deck is stated with its straight chord):
 *     road start -> road mid          2.00 m at +3.00 m   (20 m of deck; 4.46)
 *     road mid   -> road east         2.00 m at +3.00 m   (28 m of deck; 4.46)
 *     road east  -> the sanctum       3.00 m at +3.00 m   (24 m of deck; 4.46)
 *   OPTIONAL, the risky lines:
 *     station -> the sunken isle      8.00 m at -9.00 m   long jump, safe 9.82
 *                                     off 20 m of straight deck
 *     wing pier -> the sigil perch    3.30 m at +2.00 m   triple, 10 m chord
 *     the three gauntlet tiles        1.98 / 2.80 / 2.80 m at +1.00 m, on a
 *                                     2.2 s solid / 1.5 s gone cycle
 *
 * CONTENT LEDGER: 8 sigils · 7 crests · 112 coins · 6 checkpoints ·
 * hazard families: mover, vanish, rotor, pendulum, crusher, beam, rings,
 * current, cannon, wind, chase, jumppad, breakable
 * + critters gnasher, bumbler x2, skitter x2, warden.
 *
 * ---------------------------------------------------------------------------
 * THREE THINGS THIS FILE DOES ON PURPOSE, WRITTEN DOWN SO THEY ARE NOT "BUGS"
 * ---------------------------------------------------------------------------
 * 1. THE COURSE IS HUB-AND-SPOKE, NOT A CHAIN. `_harness/reachcheck.mjs`
 *    floods the surface graph for a FIXED twelve passes, i.e. twelve hops from
 *    spawn — and a sky course, unlike a heightfield one, has no single "walk
 *    anywhere" terrain node to collapse the distance. The first draft of this
 *    course was a fourteen-link chain and the gate correctly reported the last
 *    four surfaces as unreachable. The fix was not to shorten the course but
 *    to widen it: the GARDENS are a hub three hops from spawn, every beat is a
 *    short spoke off it, and the 99 m road is FOUR long decks with the hazards
 *    ON them rather than a dozen stepping stones with the hazards between.
 *    That is what an SM64-scale diorama is supposed to look like anyway.
 * 2. THE RISING CLOUD STOPS BELOW THE ROAD. `chase` is PURE IN t and, once
 *    armed, everything behind its front stays lethal FOREVER (chase.js:
 *    `kill.active = enabled && armed`, and `armed = t >= delay` never goes
 *    back to false). In a linear course that is the point; in an open diorama
 *    it would quietly delete the gauntlet 69 s into every run. So the cloud
 *    rises from y 22.0 to y 47.5 and PARKS there — 2.5 m under the lowest
 *    walkable metre of the road (50.0) and clear in z of everything else (its
 *    face spans z -72..-58 only). It is the floor of the world closing, which
 *    is what the brief asked for; it is not a thing that can catch you on the
 *    road, which is the only fair way to spend a permanently-armed hazard in a
 *    course you are meant to explore.
 * 3. THE BEAMS PUBLISH NO `p`/`s`. A `beam` in mode 'single' is authored a->b
 *    and beams.js never reads `p`. `_harness/reachcheck.mjs` lists 'beam' as
 *    LANDABLE (it was a structural beam in Ascendant) and will therefore build
 *    a 1 x 1 m phantom rectangle at the origin for each one. Those two rects
 *    are ORPHANS — unreachable, 20 m below killY's neighbourhood and 40 m from
 *    anything — and are reported as orphan surfaces, not as problems. Giving
 *    the beams a fake `p`/`s` to silence that would author a landable surface
 *    where there is no floor, which is worse.
 *
 * ---------------------------------------------------------------------------
 * CONVENTIONS (contract §25 + runtime/data/index.js) — as verdant-1
 * ---------------------------------------------------------------------------
 *   p            CENTRE, [x, y, z].  s = FULL size, [sx, sy, sz].
 *                => a platform's walkable top is p[1] + s[1]/2.
 *   yaw          RADIANS. yaw 0 faces -Z. +yaw is counter-clockwise from above.
 *   rot          Euler XYZ radians.  colours are hex NUMBERS.
 *   stripe:true  "you had to jump to get here". In a sky course that is every
 *                landable surface, including the one you spawn on: the edge of
 *                a cloud anchor over 22 m of nothing has to read. The only
 *                unstriped platforms here are the two flush race pads, which
 *                are inlays and not jump targets.
 *   text         built in the local XY plane facing local +Z, so rot [0,0,0]
 *                faces a player walking north (-Z).
 */

/* ===========================================================================
 * 0. Palette — AZURE SANCTUM (every colour is a themes.js `azure.palette` key,
 *    so the course never invents a hue the readability law has not budgeted)
 * ======================================================================== */

const PRISM = 0xc07bff;      // palette.sigil   — the sanctum's violet glass
const GOLD = 0xffcf4a;       // palette.crest   — crest / coin glow
const RAINBOW = 0x3fe0d8;    // palette.accent  — the road's teal
const SAFE_EDGE = 0xffd166;  // palette.safeEdge— leading-edge stripe
const WARN = 0xff2a4a;       // palette.kill    — beams and hammers

/* ===========================================================================
 * 1. Authoring helpers — a sky course has no heightfield, so the authority for
 *    every placement is a NAMED PLATFORM TOP. `slab()` takes the top.
 * ======================================================================== */

const r2 = (v) => Math.round(v * 100) / 100;

/** Default deck thickness. Thick enough to read from below, thin enough to jump past. */
const TH = 0.9;

/**
 * A deck whose WALKABLE TOP is exactly `top`. Returns a §25 `platform` def, so
 * `p[1] + s[1]/2 === top` by construction and no comment in this file has to
 * add half a thickness in its head.
 */
function slab(x, top, z, sx, sz, o) {
  const t = (o && o.t) || TH;
  const def = {
    kind: 'platform',
    p: [r2(x), r2(top - t / 2), r2(z)],
    s: [r2(sx), r2(t), r2(sz)],
    mat: (o && o.mat) || 'marble',
    stripe: (o && o.stripe) === false ? false : true,
    edge: SAFE_EDGE,
  };
  if (o && o.surface) def.surface = o.surface;
  if (o && o.glow) def.glow = o.glow;
  return def;
}

/**
 * Coins along a jump ARC from a to b, peaking `h` above the chord. Expanded to
 * explicit {p} entries (verdant-1's helper, verbatim) rather than shipped as a
 * new def kind, so an arc can never be silently dropped by a Collectibles build
 * that only knows the contract's {p} / {ring} / {line} / {arc} forms.
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
 * Coins evenly spaced by GROUND distance along a polyline of [x,y,z] way
 * points. A straight {line} between two points at different heights buries
 * half a run inside a rising road; this follows the road.
 */
function pathCoins(pts, n) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
    seg.push(L); total += L;
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    let want = total * (i + 0.5) / n, k = 0;
    while (k < seg.length - 1 && want > seg[k]) { want -= seg[k]; k++; }
    const t = seg[k] > 0 ? want / seg[k] : 0;
    out.push({ p: [r2(pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t),
                   r2(pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t),
                   r2(pts[k][2] + (pts[k + 1][2] - pts[k][2]) * t)] });
  }
  return out;
}

/* ===========================================================================
 * 2. Measured constants the beats below refer to by name
 * ======================================================================== */

// BEAT 1 — the station. One cloud anchor 28 x 20 m plus two arms, top EXACTLY
// 30.00, and 20 m of straight deck behind the south lip for the long jump.
const STATION_Y = 30.0;
const SECRET_Y = 21.0;        // the isle under it: an 8.00 m gap on a -9.00 m drop

// BEAT 2 — two sleepers, 3.2 m square, tops 31.50 / 32.80. A 3.2 m deck only
// affords a 3.2 m run-up, so ONLY a single jump is offered from one; every gap
// here is therefore authored under the single's safe limit at its own rise.
const SLEEP = [
  { z: 30, y: 31.5 },
  { z: 24, y: 32.8 },
];

// BEAT 3 — the gardens (the HUB). 36 x 28 m, top EXACTLY 34.00, so the
// pendulum heads at 35.00 sweep exactly one metre over the deck: chest height
// on a 1.5 m hero, which is the only height at which a swinging blade is a
// decision rather than a surprise.
const GARDEN_Y = 34.0;
const PEND_PIVOT_Y = 41.0;    // len 6.0 => head 35.00 at rest
const PEND_LEN = 6.0;
// ampDeg 44 => a head sweeps 6.0 * sin(44 deg) = 4.17 m either side of its
// pivot and rises to 41.0 - 6.0 * cos(44 deg) = 36.68 m at the extremes. The
// third pivot is at x = 9, so nothing swings past x = 13.17 — which is why the
// prism perch at x = 15 (its slab spans 13.3..16.7) is never struck.
const PEND_REACH = 4.17;

// BEAT 4 — the wing run. Pier 35.40 -> landing 37.00, with the cloud shelf at
// 26.00 directly under the pier, so a missed flight is a 9.40 m fall onto
// something soft rather than a death.
const PIER_Y = 35.4;
const SHELF_Y = 26.0;
const WING_Y = 37.0;

// BEAT 5 — the cannon isles. 38 -> 44 -> 52, each pair joined by a cannon that
// SOLVES its own launch speed against `target` (hazards/launch.js).
const ISLE1_Y = 38.0, ISLE2_Y = 44.0, ISLE3_Y = 52.0;

// BEAT 6 — THE CAUSEWAY. One prism ramp from the wing landing's north lip
// (z -29, y 37.00) to the road's south lip (z -57, y 50.00): a 28.00 m run and
// a 13.00 m rise, i.e. 24.9 deg — well under TUNE.slope.slideDeg (38), so it
// is a walk and never a slide. Its slab is the hypotenuse:
//   len   = hypot(28, 13) = 30.87 m      half 15.44
//   pitch = asin(13 / 30.87) = 0.4348 rad
// and the centre is the midpoint of the two lips.
const RAMP_LEN = r2(Math.hypot(28, 13));
const RAMP_PITCH = r2(Math.asin(13 / Math.hypot(28, 13)) * 1000) / 1000;

// BEAT 7 — the road. Four decks, all 10 m deep about z = -62, tops climbing
// 50 -> 53 -> 56 -> 59 across 99 m of x. NOTHING WALKABLE IN THE CHASE'S
// Z-BAND SITS BELOW 50.00 (see the header note): the cloud parks at 47.50.
const ROAD = [
  { name: 'start', x: -37, sx: 20, y: 50.0 },   // x -47..-27
  { name: 'mid', x: -11, sx: 28, y: 53.0 },     // x -25..  3   gap 2.00 at +3.00
  { name: 'east', x: 17, sx: 24, y: 56.0 },     // x   5.. 29   gap 2.00 at +3.00
];
const SANCTUM_Y = 59.0;                          // x  32.. 52   gap 3.00 at +3.00
const CLOUD_TOP = 47.5;

// BEAT 7 — the three gauntlet vanish tiles, on a line 8 m NORTH of the road so
// they are a parallel shortcut and never the road itself. Centres 6.0 m apart,
// 3.2 m square => 2.80 m gaps at +1.00 m (single-safe there is 3.88 m).
const GTILE = [
  { x: -24, y: 51.0 },
  { x: -18, y: 52.0 },
  { x: -12, y: 53.0 },
];
const GTILE_Z = -70;

/* ===========================================================================
 * 3. THE COURSE
 * ======================================================================== */

export default {
  id: 'azure-3',
  realm: 'azure',
  theme: 'azure',
  name: 'PRISM RIDE',
  subtitle: 'Sky rails, wing rings, and a road that is only there when it wants to be',
  order: 3,
  difficulty: 10,
  music: 'azure',

  /* Par times per crest id (ms) — the HUD shows them, nothing gates on them. */
  par: {
    open: 180000, sigils: 420000, coins: 480000,
    secret: 90000, boss: 240000, race: 120000, wing: 200000,
  },

  /* Spawn on the station anchor, yaw 0 => facing -Z: the two sleepers, the
     gardens beyond them, the cannon isles climbing away on the right and the
     sanctum arc over the whole thing. The finale has to be legible from the
     first frame or its 99 m of road reads as a corridor. The nearest
     checkpoint pad is 8 m up the deck, so its beam never lands on the hero. */
  spawn: { p: [0, STATION_Y, 48], yaw: 0 },
  killY: 8,
  bounds: { min: [-60, 0, -88], max: [64, 96, 84] },

  intro: {
    /* One sentence: where you are, and that there is more than one way on.
       game.js already prints "AZURE SANCTUM · PRISM RIDE" above this line. */
    text: 'Everything here is a bridge that has not decided yet. Take the rails, take the wings, or take the cannon — the pedestal does not care which.',
    cam: [
      { p: [0, 54, 78], look: [0, 40, 12], t: 0 },
      { p: [-54, 56, -6], look: [-20, 40, -30], t: 3.0 },
      { p: [26, 72, -92], look: [42, 60, -64], t: 6.2 },
    ],
  },

  ambience: { wind: 0.72, birds: 0.18, water: 0.0 },

  /* ------------------------------------------------------------------------
   * CHECKPOINTS — 6, every one on an authored deck (flat by construction) and
   * every one BEFORE its spike, never after. `clockOffset` is the course-clock
   * phase a respawn rewinds to, which is what makes the chase, the beams, the
   * hammers and the vanish tiles present the SAME phase on every attempt.
   *
   *   cp-station      0   before the void crossing
   *   cp-gardens      0   before the pendulums and the beams
   *   cp-wing         0   before the wing run and the causeway
   *   cp-isle         0   before the Warden and the last cannon
   *   cp-gauntlet    10   the cloud has not left y 22 yet and the whole road
   *                       is clear: a respawn here starts the gauntlet with
   *                       the same clean road the first attempt had
   *   cp-gauntlet-mid 40  the cloud is 12.6 m up — where it is when a clean
   *                       run arrives — so the second half never replays the
   *                       first half's light or its sound
   *
   * None sits under a beam, a hammer or a pendulum; cp-isle is 9.0 m from the
   * Warden's arena centre (r 7.0), so a respawn never drops you inside the
   * fight; and every pad has at least 6 m of clear deck around it.
   * --------------------------------------------------------------------- */
  checkpoints: [
    { id: 'cp-station', p: [0, STATION_Y, 40], yaw: 0, clockOffset: 0 },
    { id: 'cp-gardens', p: [0, GARDEN_Y, 14], yaw: 0, clockOffset: 0 },
    { id: 'cp-wing', p: [-40, WING_Y, -22], yaw: -0.6, clockOffset: 0 },
    { id: 'cp-isle', p: [30, ISLE3_Y, -43], yaw: 0, clockOffset: 0 },
    { id: 'cp-gauntlet', p: [-37, ROAD[0].y, -62], yaw: -Math.PI / 2, clockOffset: 10 },
    { id: 'cp-gauntlet-mid', p: [-11, ROAD[1].y, -62], yaw: -Math.PI / 2, clockOffset: 40 },
  ],

  /* ------------------------------------------------------------------------
   * CRESTS — 7, one of each type in the contract.
   * --------------------------------------------------------------------- */
  crests: [
    {
      id: 'open', type: 'open', name: 'CREST OF THE PRISM SANCTUM',
      hint: 'The road, the cannon or the causeway. All three end here.',
      p: [42, SANCTUM_Y + 1.6, -64],
    },
    {
      id: 'sigils', type: 'sigils', name: 'EIGHT SIGILS OF THE SKY',
      hint: 'Cart, cloud, pier, vault, isle, garden, hammer, tile.',
      spawnAt: [0, GARDEN_Y + 1.5, 6],
    },
    {
      id: 'coins', type: 'coins', name: 'A HUNDRED COINS', threshold: 100,
      hint: '112 are strung along the ride. You can miss twelve.',
      spawnAt: [0, STATION_Y + 1.5, 44],
    },
    {
      id: 'secret', type: 'secret', name: 'WHAT FELL BELOW THE STATION',
      trigger: 'sunken-vault',
      hint: 'Off the south lip, and keep going. Dive if you have to.',
      spawnAt: [0, SECRET_Y + 1.6, 68],
    },
    {
      id: 'boss', type: 'boss', name: 'THE WARDEN OF THE LAST ISLE',
      hint: 'Jump the shockwave, sidestep the charge, pound its back.',
      spawnAt: [30, ISLE3_Y + 1.6, -34],
    },
    {
      id: 'race', type: 'race', name: 'PRISM RIDE',
      hint: 'Station to pedestal. Two minutes. The cannons are not cheating.',
      start: [0, STATION_Y, 44], finish: [42, SANCTUM_Y, -64], limitMs: 120000,
      spawnAt: [37, SANCTUM_Y + 1.6, -60],
    },
    {
      id: 'wing', type: 'power', name: 'THE LONG GLIDE', power: 'wing',
      hint: 'Take the wings on the pier and thread all sixteen rings.',
      p: [-40, WING_Y + 1.6, -22],
    },
  ],

  /* ------------------------------------------------------------------------
   * SIGILS — 8, every one on an OPTIONAL line you have to decide to take.
   * Each is verified against the surface it hangs over: the worst vertical
   * envelope anywhere in this game is the backflip's 2.87 m safe rise, so a
   * 1.4-1.6 m float is a walk-up on the perch itself and a real jump from the
   * deck under it.
   * --------------------------------------------------------------------- */
  sigils: [
    { p: [-11, 35.4, 22], note: '1 — over cart A at the north end of its run (deck top 34.00)' },
    { p: [-34, 27.5, -6], note: '2 — the cloud shelf, 4.00 m from the Gnasher post on a 6 m chain (top 26.00)' },
    { p: [-36, 38.9, -10], note: '3 — the prism perch off the wing pier (top 37.40)' },
    { p: [4, 22.4, 71], note: '4 — the sunken isle under the station (top 21.00)' },
    { p: [56, 46.9, -16], note: '5 — the perch off cannon isle 2 (top 45.40)' },
    { p: [15, 37.5, 0], note: '6 — the garden prism, 1.83 m outside the third blade (top 36.00)' },
    { p: [12.5, 57.6, -62], note: '7 — between the two prism hammers (road east deck, top 56.00)' },
    { p: [-12, 54.4, -70], note: '8 — over the last gauntlet vanish tile (top 53.00)' },
  ],

  /* ------------------------------------------------------------------------
   * COINS — 112 placed, 100 needed. Every group is on a line the player chose;
   * the station run is the only one you cannot miss.
   * --------------------------------------------------------------------- */
  coins: [
    // BEAT 1 — the run out of spawn to the north lip, and a ring round the
    // coin pedestal. (6 + 6)
    // Data lane 2026-09-04: the game boots at cp-station (z 40), not `spawn`
    // (z 48); the line and the pedestal ring sat around the CAMERA. The line
    // now runs from the pad to the north lip; the ring moved to the east arm.
    { line: { a: [0, STATION_Y + 1.1, 39], b: [0, STATION_Y + 1.1, 33.5], n: 6 } },
    { ring: { c: [21, 0, 42], r: 4.0, n: 6, y: STATION_Y + 1.1 } },
    // BEAT 1 — the sunken isle: the secret pays in coins as well as a crest. (5)
    { ring: { c: [0, 0, 68], r: 3.6, n: 5, y: SECRET_Y + 1.1 } },
    // BEAT 2 — an arc over each sleeper gap: 1.30 m peaks, which is where a
    // held single jump actually puts you. (4 + 4 + 4)
    ...arcCoins([0, 31.1, 33.2], [0, 32.6, 27.0], 1.3, 4),
    ...arcCoins([0, 32.6, 27.0], [0, 33.9, 21.2], 1.3, 4),
    ...arcCoins([0, 33.9, 21.2], [0, 35.1, 18.6], 1.1, 4),
    // BEAT 2 — the cart line, for anyone who rides instead of hops. Both ends
    // are cart poses, so none of these hangs in open space. (4)
    ...pathCoins([[-11, 32.6, 29], [-11, 35.1, 23]], 4),
    // BEAT 3 — a ring round the sigil pedestal, and the pendulum corridor
    // straight through all three swings. (8 + 5)
    { ring: { c: [0, 0, 6], r: 5.0, n: 8, y: GARDEN_Y + 1.1 } },
    { line: { a: [-14, GARDEN_Y + 1.1, 5], b: [14, GARDEN_Y + 1.1, 5], n: 5 } },
    // BEAT 3 — the two teaching vanish tiles. (3)
    ...arcCoins([-8, 37.4, 16], [-8, 38.4, 10], 1.0, 3),
    // BEAT 4 — down the pier and out toward the first rings. (4)
    ...pathCoins([[-26, 36.5, -6], [-26, 36.5, -13], [-30, 37.5, -15]], 4),
    // BEAT 4 — the cloud shelf, a ring at the edge of the Gnasher's reach,
    // and the wing landing. (6 + 5)
    { ring: { c: [-34, 0, -6], r: 5.4, n: 6, y: SHELF_Y + 1.1 } },
    { ring: { c: [-40, 0, -22], r: 4.2, n: 5, y: WING_Y + 1.1 } },
    // BEAT 5 — isle 1, the run past isle 2's spoke, and the Warden's ring.
    // (6 + 5 + 6)
    { ring: { c: [28, 0, 0], r: 4.6, n: 6, y: ISLE1_Y + 1.1 } },
    { line: { a: [41, ISLE2_Y + 1.1, -16], b: [51, ISLE2_Y + 1.1, -16], n: 5 } },
    { ring: { c: [30, 0, -34], r: 6.0, n: 6, y: ISLE3_Y + 1.1 } },
    // BEAT 6 — the foot of the causeway. Every one of these sits over the
    // ramp's own lower third, which is a reached surface. (5)
    ...pathCoins([[-40, 38.3, -30], [-40, 42.1, -38]], 5),
    // BEAT 7 — the road. A run down the start deck, the tile shortcut, then
    // the mid and east decks. (5 + 5 + 6 + 5)
    { line: { a: [-45, 51.1, -62], b: [-29, 51.1, -62], n: 5 } },
    ...pathCoins([[-24, 52.1, GTILE_Z], [-12, 54.1, GTILE_Z]], 5),
    { line: { a: [-23, 54.1, -62], b: [1, 54.1, -62], n: 6 } },
    { line: { a: [7, 57.1, -62], b: [27, 57.1, -62], n: 5 } },
    // BEAT 8 — a ring round the Grand Pedestal. (5)
    { ring: { c: [42, 0, -64], r: 5.0, n: 5, y: SANCTUM_Y + 1.1 } },
  ],

  /* ------------------------------------------------------------------------
   * POWERS — two wing hats. The pier one starts the ring run; the second sits
   * on the wing landing so a failed run can be retried without walking the
   * whole west flank again.
   * --------------------------------------------------------------------- */
  powers: [
    { kind: 'wing', p: [-26, PIER_Y + 1.1, -10], duration: 30 },
    { kind: 'wing', p: [-44, WING_Y + 1.1, -20], duration: 30 },
  ],

  /* ------------------------------------------------------------------------
   * OBJECTS — the built world, beat by beat.
   * --------------------------------------------------------------------- */
  objects: [

    /* ========================================================================
     * BEAT 1 — THE RAIL STATION
     * A cloud anchor 28 x 20 m with two arms, top EXACTLY 30.00, and the whole
     * course laid out in front of it. Twenty seconds of nothing trying to hurt
     * you, because the next hundred are the finale.
     * ===================================================================== */

    slab(0, STATION_Y, 44, 28, 20, { mat: 'marble' }),          // x -14..14, z 34..54
    slab(-21, STATION_Y, 42, 14, 10, { mat: 'marble' }),        // west arm, x -28..-14
    slab(21, STATION_Y, 42, 14, 10, { mat: 'marble' }),         // east arm, x  14..28

    { kind: 'pedestal', p: [0, STATION_Y, 44], mat: 'marble', tint: GOLD, glow: GOLD },

    { kind: 'deco', kindOf: 'sign', p: [3.4, STATION_Y + 1.1, 41], s: [0.14, 1.9, 1.3], mat: 'metal' },
    { kind: 'text', p: [3.4, STATION_Y + 3.9, 41], rot: [0, 0, 0], text: 'PRISM LINE', size: 0.62, color: 0xe6f6ff },
    { kind: 'text', p: [3.4, STATION_Y + 3.35, 41], rot: [0, 0, 0], text: 'TWO STONES ACROSS  ·  OR RIDE A CART', size: 0.22, color: 0xbfe4ee },
    { kind: 'text', p: [3.4, STATION_Y + 2.98, 41], rot: [0, 0, 0], text: 'THE CARTS KEEP THEIR OWN CLOCK  ·  WAIT FOR ONE', size: 0.22, color: 0xbfe4ee },
    { kind: 'text', p: [-6.0, STATION_Y + 1.5, 53.4], rot: [0, Math.PI, 0], text: 'NOTHING BELOW THE SOUTH LIP', size: 0.24, color: 0xa8d8ea },
    { kind: 'text', p: [-6.0, STATION_Y + 1.1, 53.4], rot: [0, Math.PI, 0], text: 'which is not the same as nothing there', size: 0.19, color: 0x8fb8c8 },

    // Station furniture. Every def is INSTANCED (count/spread), so the whole
    // anchor costs a handful of draws and still reads as somewhere trains stop.
    { kind: 'deco', kindOf: 'pillar', p: [-12, STATION_Y + 1.4, 36.5], s: [0.9, 2.8, 0.9], mat: 'marble', count: 4, spread: 3.2, jitter: 0.10 },
    { kind: 'deco', kindOf: 'pillar', p: [12, STATION_Y + 1.4, 36.5], s: [0.9, 2.8, 0.9], mat: 'marble', count: 4, spread: 3.2, jitter: 0.10 },
    { kind: 'deco', kindOf: 'arch', p: [0, STATION_Y + 3.2, 34.4], s: [1.0, 0.9, 8.0], rot: [0, Math.PI / 2, 0], mat: 'marble' },
    { kind: 'deco', kindOf: 'rail', p: [-21, STATION_Y + 0.6, 37.4], s: [12.0, 1.1, 0.2], mat: 'metal', count: 2, spread: 2.0, jitter: 0.05 },
    { kind: 'deco', kindOf: 'rail', p: [21, STATION_Y + 0.6, 37.4], s: [12.0, 1.1, 0.2], mat: 'metal', count: 2, spread: 2.0, jitter: 0.05 },
    { kind: 'deco', kindOf: 'holosign', p: [-8.4, STATION_Y + 2.2, 46], s: [2.2, 2.2, 0.2], mat: 'glass' },
    { kind: 'deco', kindOf: 'banner', p: [8.4, STATION_Y + 2.6, 46], s: [0.1, 3.0, 1.5], mat: 'cloth' },
    { kind: 'deco', kindOf: 'crystal', p: [-24, STATION_Y + 0.7, 44], s: [1.2, 1.9, 1.2], mat: 'crystal', count: 5, spread: 3.0, jitter: 0.34 },
    { kind: 'deco', kindOf: 'crystal', p: [24, STATION_Y + 0.7, 44], s: [1.2, 1.9, 1.2], mat: 'crystal', count: 5, spread: 3.0, jitter: 0.34 },
    { kind: 'light', p: [0, STATION_Y + 4.6, 42], color: 0xdff2ff, intensity: 9, distance: 30 },

    // Two crates on the west arm: a pound target, and coins for anyone who
    // learns what the pound button does before the gauntlet demands it.
    { kind: 'breakable', p: [-22, STATION_Y + 0.6, 44.6], s: [1.2, 1.2, 1.2], mat: 'wood', shape: 'crate', drop: 'coins' },
    { kind: 'breakable', p: [-23.4, STATION_Y + 0.6, 43.2], s: [1.2, 1.2, 1.2], mat: 'wood', shape: 'crate', drop: 'coins' },

    /* --- THE SECRET: the sunken isle -------------------------------------
     * The station's south lip is at z = 54 and the isle's north edge at z = 62,
     * with the deck 9.00 m above it: a MEASURED 8.00 m gap on a -9.00 m drop.
     * A long jump is safe to 9.82 m at that drop (tuning.js REACH_TABLE) and
     * the station gives 20 m of straight run-up, so it goes; a dive off the
     * peak of an ordinary jump does it too — which is the brief's "long jump +
     * dive" exactly. Nothing points at it. The only clues are a sign saying
     * there is nothing below the lip, and a lantern you can see over the edge.
     */
    slab(0, SECRET_Y, 68, 12, 12, { mat: 'cloud' }),            // x -6..6, z 62..74
    {
      kind: 'breakable', p: [0, SECRET_Y + 1.2, 68], s: [2.4, 2.4, 2.4],
      mat: 'glass', shape: 'cage', drop: 'crest',
      trigger: 'sunken-vault', openOn: 'sunken-vault',
    },
    { kind: 'deco', kindOf: 'lantern', p: [0, SECRET_Y + 3.0, 68], s: [0.6, 0.8, 0.6], mat: 'metal' },
    { kind: 'deco', kindOf: 'crystal', p: [-3.4, SECRET_Y + 0.6, 71.4], s: [1.0, 1.5, 1.0], mat: 'crystal', count: 4, spread: 2.4, jitter: 0.36 },
    { kind: 'light', p: [0, SECRET_Y + 2.6, 68], color: GOLD, intensity: 7, distance: 14 },

    /* ========================================================================
     * BEAT 2 — THE VOID CROSSING
     * Two prism sleepers, 3.2 m square, tops 31.50 / 32.80:
     *   station lip (z 34) -> sleeper 1 (z 28.4..31.6):  2.40 m at +1.50 m
     *   sleeper 1 -> sleeper 2 (centres 6 m apart):      2.80 m at +1.30 m
     *   sleeper 2 (z 22.4..25.6) -> gardens (z 20):      2.40 m at +1.20 m
     * A 3.2 m deck affords only a 3.2 m run-up, so the gate offers ONLY the
     * single jump from a sleeper: safe there is 3.38 / 3.58 / 3.68 m at those
     * three rises, and every gap is authored a metre inside it. This is the
     * finale's one easy minute.
     *
     * Beside them, two `mover` carts on the long linear run the brief asks for
     * (14 s a lap, opposite phases). They are a DUPLICATE of the sleepers,
     * never a substitute: ROUTE A works with both carts parked forever.
     * ===================================================================== */

    ...SLEEP.map((s) => slab(0, s.y, s.z, 3.2, 3.2, { mat: 'crystal', glow: PRISM })),

    {
      kind: 'mover', p: [-11, 31.15, 30], s: [4.4, 0.7, 3.2], mat: 'metal',
      motion: { type: 'linear', to: [-11, 33.65, 22], period: 14, ease: 'sine', dwell: 1.6 },
      stripe: true, edge: SAFE_EDGE,
    },
    {
      kind: 'mover', p: [11, 31.15, 30], s: [4.4, 0.7, 3.2], mat: 'metal',
      motion: { type: 'linear', to: [11, 33.65, 22], period: 14, phase: 0.5, ease: 'sine', dwell: 1.6 },
      stripe: true, edge: SAFE_EDGE,
    },
    { kind: 'text', p: [-11, 33.1, 31.6], rot: [0, 0, 0], text: 'STAND STILL AND IT CARRIES YOU', size: 0.22, color: 0xbfe4ee },

    // Rail pylons under the crossing, so the sleepers read as a structure and
    // not as two floating dice. Decor builds no colliders (props.js).
    { kind: 'deco', kindOf: 'pipe', p: [0, 28.0, 27], s: [0.5, 4.4, 0.5], mat: 'metal', count: 3, spread: 5.2, jitter: 0.22 },

    /* ========================================================================
     * BEAT 3 — THE PRISM GARDENS  (the HUB)
     * 36 x 28 m, top EXACTLY 34.00, and every other beat is a short spoke off
     * it: the pier west, the jump pad east, the shelf straight down off the
     * west lip. Three things live here and the course teaches all three before
     * the gauntlet asks for them at once:
     *
     *   PENDULUMS  heads at 35.00 — one metre over the deck, chest height on a
     *              1.5 m hero. Each sweeps 4.17 m either side of its pivot, so
     *              the lane at x > 13.17 is always clear and the prism perch at
     *              x = 15 is a place to stand and watch a blade go past.
     *   BEAMS      two pulse beams at 35.60 on opposite phases — head height,
     *              so you crouch or you time them. They are the "light bridges"
     *              of the fiction and they are NOT bridges; the sign says so
     *              where you first meet one.
     *   VANISH     two tiles climbing to nowhere in particular. They cost you
     *              three coins if you read the cycle wrong, and they run the
     *              same cycle the gauntlet demands 90 m later.
     * ===================================================================== */

    slab(0, GARDEN_Y, 6, 36, 28, { mat: 'marble' }),            // x -18..18, z -8..20
    { kind: 'pedestal', p: [0, GARDEN_Y, 6], mat: 'marble', tint: PRISM, glow: PRISM },

    // --- the prism perch. 2.00 m over the deck (inside the vertical envelope
    //     from any approach) and 1.83 m clear of the third blade's furthest
    //     reach at x = 13.17.
    slab(15, 36.0, 0, 3.4, 3.4, { mat: 'crystal', glow: PRISM }),

    {
      kind: 'pendulum', p: [-9, PEND_PIVOT_Y, 8], len: PEND_LEN, ampDeg: 44, period: 3.0,
      axis: 'z', mode: 'blade', blade: { w: 3.0, h: 0.5, d: 1.1 },
    },
    {
      kind: 'pendulum', p: [0, PEND_PIVOT_Y, 2], len: PEND_LEN, ampDeg: 44, period: 3.4,
      phaseCycles: 0.33, axis: 'z', mode: 'blade', blade: { w: 3.0, h: 0.5, d: 1.1 },
    },
    {
      kind: 'pendulum', p: [9, PEND_PIVOT_Y, 8], len: PEND_LEN, ampDeg: 44, period: 2.8,
      phaseCycles: 0.66, axis: 'z', mode: 'blade', blade: { w: 3.0, h: 0.5, d: 1.1 },
    },

    // 35.60: 0.35 m above the blades' 35.25 ceiling, so a beam and a prism
    // never occupy the same metre of air.
    {
      kind: 'beam', mode: 'single', a: [-17.4, 35.6, 3], b: [17.4, 35.6, 3],
      radius: 0.14, color: WARN, cycle: { on: 1.4, off: 2.0, warn: 0.7, phase: 0 },
    },
    {
      kind: 'beam', mode: 'single', a: [-17.4, 35.6, 12], b: [17.4, 35.6, 12],
      radius: 0.14, color: WARN, cycle: { on: 1.4, off: 2.0, warn: 0.7, phase: 1.7 },
    },

    // The two teaching tiles, on the way to nothing you need — which is the
    // point: you learn the cycle on a line that only costs coins.
    { kind: 'vanish', p: [-8, 36.3, 16], s: [3.0, 0.6, 3.0], mat: 'glass', cycle: { on: 2.4, off: 1.6, warn: 0.6, phase: 0 }, stripe: true, edge: SAFE_EDGE },
    { kind: 'vanish', p: [-8, 37.3, 10], s: [3.0, 0.6, 3.0], mat: 'glass', cycle: { on: 2.4, off: 1.6, warn: 0.6, phase: 0.8 }, stripe: true, edge: SAFE_EDGE },

    { kind: 'text', p: [0, GARDEN_Y + 1.6, 18.4], rot: [0, 0, 0], text: 'THE LIGHT IS NOT A BRIDGE', size: 0.30, color: 0xffb0bd },
    { kind: 'text', p: [0, GARDEN_Y + 1.2, 18.4], rot: [0, 0, 0], text: 'PRISMS SWING ON THEIR OWN COUNT  ·  WATCH ONE FULL PASS', size: 0.21, color: 0xbfe4ee },
    { kind: 'text', p: [-8, GARDEN_Y + 1.2, 19.4], rot: [0, -0.5, 0], text: 'A TILE REMEMBERS YOUR WEIGHT', size: 0.21, color: 0xbfe4ee },
    { kind: 'text', p: [16.8, GARDEN_Y + 1.3, 12], rot: [0, -1.2, 0], text: 'PAD  ·  ISLES  ·  CANNONS', size: 0.24, color: 0xbfe4ee },
    { kind: 'text', p: [-17.0, GARDEN_Y + 1.3, -4], rot: [0, 0.9, 0], text: 'PIER  ·  WINGS  ·  THE CLOUD BELOW', size: 0.24, color: 0xbfe4ee },

    { kind: 'deco', kindOf: 'crystal', p: [-15, GARDEN_Y + 0.8, -4], s: [1.3, 2.1, 1.3], mat: 'crystal', count: 6, spread: 3.4, jitter: 0.34 },
    { kind: 'deco', kindOf: 'crystal', p: [15, GARDEN_Y + 0.8, 16], s: [1.3, 2.1, 1.3], mat: 'crystal', count: 6, spread: 3.4, jitter: 0.34 },
    { kind: 'deco', kindOf: 'arch', p: [0, GARDEN_Y + 6.4, -7.2], s: [1.0, 0.9, 9.0], rot: [0, Math.PI / 2, 0], mat: 'marble' },
    { kind: 'deco', kindOf: 'monolith', p: [-16.4, GARDEN_Y + 1.6, 17], s: [1.2, 3.2, 1.0], mat: 'marble', count: 2, spread: 2.4, jitter: 0.14 },
    { kind: 'light', p: [0, GARDEN_Y + 5.0, 6], color: 0xdff2ff, intensity: 9, distance: 30 },

    /* --- ROUTE C's front door: the jump pad on the east lip.
     *     Pad top 34.30 (it sits ON the garden deck: a 0.30 m step). `power` is
     *     the TARGET APEX IN METRES (hazards/index.js TRAP 3), so 6.0 puts the
     *     apex 6.00 m up and isle 1 at +3.70 m is comfortably inside the arc:
     *     the pad's own reach at that rise is 6.80 m and the gap is 3.50 m.
     *     It sits at z = 8 so it never overlaps the prism perch at z = 0. */
    { kind: 'jumppad', p: [16, 34.15, 8], s: [3.0, 0.3, 3.0], power: 6.0, dir: [0, 1, 0], mat: 'rubber' },

    /* ========================================================================
     * BEAT 4 — THE WING RUN  (and the shelf that catches every miss)
     * The pier is 3.00 m off the gardens' west lip at +1.40 m (single-safe
     * there is 3.48 m). Take the wings and thread sixteen rings through three
     * air currents; miss three of them and you drop 9.40 m onto the CLOUD
     * SHELF, which sits directly under the pier for exactly that reason.
     *
     * THE SHELF IS ALSO ROUTE B. From it, the sky mast (a climbable `pole`,
     * CONTRACT §11 CLIMB) runs 11 m up to a top pad level with the wing
     * landing and 1.08 m off its south lip, so a player who never flies at all
     * still reaches every checkpoint and every required surface on foot. The
     * rings buy a crest, not a passage.
     * ===================================================================== */

    slab(-26, PIER_Y, -10, 10, 10, { mat: 'marble' }),          // pier,    x -31..-21, z -15..-5
    // sigil-3 perch: a MEASURED 3.30 m at +2.00 m off the pier, which is a
    // triple — legal because the pier gives a 10 m straight chord toward it.
    slab(-36, 37.4, -10, 3.4, 3.4, { mat: 'crystal', glow: PRISM }),
    slab(-34, SHELF_Y, -6, 22, 20, { mat: 'cloud' }),           // shelf,   x -45..-23, z -16..4
    slab(-40, WING_Y, -22, 14, 14, { mat: 'marble' }),          // landing, x -47..-33, z -29..-15

    // THE SKY MAST. Base on the shelf at 26.00, 11 m tall, so its top pad is
    // level with the landing and 1.08 m short of it.
    { kind: 'pole', p: [-41, SHELF_Y, -13.5], h: 11.0, r: 0.42, mat: 'copper' },
    { kind: 'text', p: [-38.6, SHELF_Y + 1.4, -10.4], rot: [0, -0.9, 0], text: 'PRESS INTO THE MAST TO CLIMB', size: 0.22, color: 0xbfe4ee },

    /* THE RINGS. Sixteen hoops on a closing spiral that starts over the pier
     * and ends over the wing landing, generated from one expression so the
     * path in this comment is the path in the data:
     *   ring i:  a = 0.60 - i * 0.4817 rad about the LANDING at (-40, -22)
     *            r = 16.5 - i * 0.95      y = 38.6 + 3.6 * sin(i * 0.40)
     * i = 0 lands the first hoop at (-26.4, 38.6, -12.7), which is 3.2 m over
     * the pier deck; i = 15 puts the last at (-37.9, 37.6, -22.8), 0.6 m over
     * the landing — which is where the flight has to end for the crest to fire
     * while you still have wings. */
    {
      kind: 'rings', r: 2.6, id: 'prism-rings', trigger: 'prism-rings',
      pts: Array.from({ length: 16 }, (_, i) => {
        const a = 0.60 - i * 0.4817;
        const rad = 16.5 - i * 0.95;
        return [r2(-40 + Math.cos(a) * rad), r2(38.6 + 3.6 * Math.sin(i * 0.40)), r2(-22 + Math.sin(a) * rad)];
      }),
    },

    // Three air currents along the flight. `power` is m/s (TRAP 3): they push
    // you along the spiral, so a glide that would have died short of hoop 9
    // gets there — and a glide that fights them does not.
    { kind: 'current', p: [-30, 40.0, -8], s: [16, 8, 14], dir: [-0.62, 0.35, -0.70], power: 5.0 },
    { kind: 'current', p: [-48, 42.0, -22], s: [14, 9, 16], dir: [0.35, 0.28, -0.89], power: 5.6 },
    { kind: 'current', p: [-38, 41.0, -34], s: [18, 8, 12], dir: [0.32, 0.14, 0.94], power: 4.8 },

    { kind: 'text', p: [-26, PIER_Y + 1.7, -5.4], rot: [0, 0, 0], text: 'TAKE THE WINGS  ·  HOLD JUMP TO GLIDE', size: 0.26, color: 0xe6f6ff },
    { kind: 'text', p: [-26, PIER_Y + 1.3, -5.4], rot: [0, 0, 0], text: 'EVERY RING BUYS YOU FIVE MORE SECONDS', size: 0.21, color: 0xbfe4ee },
    { kind: 'text', p: [-26, PIER_Y + 0.95, -5.4], rot: [0, 0, 0], text: 'and the cloud below is soft', size: 0.19, color: 0x8fb8c8 },

    { kind: 'deco', kindOf: 'pillar', p: [-30, PIER_Y + 1.3, -13.4], s: [0.8, 2.6, 0.8], mat: 'marble', count: 3, spread: 2.2, jitter: 0.10 },
    { kind: 'deco', kindOf: 'crystal', p: [-40, SHELF_Y + 0.7, -2], s: [1.2, 1.8, 1.2], mat: 'crystal', count: 6, spread: 4.0, jitter: 0.34 },
    { kind: 'deco', kindOf: 'flagpole', p: [-45.4, WING_Y + 2.3, -26], s: [0.12, 4.6, 0.12], mat: 'copper' },
    { kind: 'deco', kindOf: 'banner', p: [-45.4, WING_Y + 3.0, -25.4], s: [0.08, 2.6, 1.4], mat: 'cloth' },
    { kind: 'light', p: [-40, WING_Y + 3.4, -22], color: 0x7fffd8, intensity: 8, distance: 24 },

    /* ========================================================================
     * BEAT 5 — THE CANNON ISLES  (and the Warden)
     * Three isles at 38.00 / 44.00 / 52.00, joined by cannons that SOLVE their
     * own launch speed against `target` (hazards/launch.js: a target overrides
     * yaw AND power). Rotor spokes sweep isles 2 and 3, so a cannon that lands
     * you badly still has to be walked off.
     *
     * Isle 3 is the Warden's ring: 18 x 18 m, arena r 7.00 about (30, -34).
     * The checkpoint is 9.0 m from that centre and the last cannon 10.0 m, so
     * neither a respawn nor the exit sits inside the fight.
     * ===================================================================== */

    slab(28, ISLE1_Y, 0, 14, 14, { mat: 'marble' }),            // isle 1, x 21..35,  z  -7..7
    slab(46, ISLE2_Y, -16, 12, 12, { mat: 'marble' }),          // isle 2, x 40..52,  z -22..-10
    slab(56, 45.4, -16, 4, 4, { mat: 'crystal', glow: PRISM }), // sigil-5 perch: 2.00 m at +1.40 m
    slab(30, ISLE3_Y, -36, 18, 18, { mat: 'marble' }),          // isle 3, x 21..39,  z -45..-27

    { kind: 'cannon', p: [30, ISLE1_Y + 1.0, -3], target: [46, ISLE2_Y + 0.6, -16], r: 1.1, len: 3.0, cooldown: 1.2, id: 'isle-1-2' },
    { kind: 'cannon', p: [46, ISLE2_Y + 1.0, -19], target: [30, ISLE3_Y + 0.6, -38], r: 1.1, len: 3.0, cooldown: 1.2, id: 'isle-2-3' },
    // ROUTE C's payoff: straight onto the gauntlet's mid deck.
    { kind: 'cannon', p: [24, ISLE3_Y + 1.0, -42], target: [-8, ROAD[1].y + 0.6, -62], r: 1.1, len: 3.2, cooldown: 1.2, id: 'isle-3-road' },

    { kind: 'rotor', p: [46, ISLE2_Y + 0.55, -16], style: 'bar', arms: 2, len: 5.0, thick: 0.34, period: 6.0, axis: 'y' },
    { kind: 'rotor', p: [30, ISLE3_Y + 0.9, -34], style: 'windmill', arms: 3, len: 3.4, period: 4.6, axis: 'y', phase: 0.25 },

    { kind: 'text', p: [28, ISLE1_Y + 1.5, 5.6], rot: [0, Math.PI, 0], text: 'STEP IN THE BARREL  ·  IT AIMS ITSELF', size: 0.26, color: 0xe6f6ff },
    { kind: 'text', p: [28, ISLE1_Y + 1.1, 5.6], rot: [0, Math.PI, 0], text: 'THE SPOKES DO NOT STOP FOR A LANDING', size: 0.21, color: 0xbfe4ee },
    { kind: 'text', p: [30, ISLE3_Y + 1.5, -44.4], rot: [0, Math.PI, 0], text: 'JUMP THE WAVE  ·  SIDESTEP THE CHARGE  ·  POUND ITS BACK', size: 0.22, color: 0xffb0bd },

    { kind: 'deco', kindOf: 'crystal', p: [22.6, ISLE1_Y + 0.7, -5], s: [1.1, 1.7, 1.1], mat: 'crystal', count: 5, spread: 3.0, jitter: 0.34 },
    { kind: 'deco', kindOf: 'crystal', p: [50, ISLE2_Y + 0.7, -20], s: [1.1, 1.7, 1.1], mat: 'crystal', count: 5, spread: 3.0, jitter: 0.34 },
    { kind: 'deco', kindOf: 'monolith', p: [23.6, ISLE3_Y + 1.6, -41], s: [1.2, 3.2, 1.0], mat: 'marble', count: 3, spread: 3.6, jitter: 0.14 },
    { kind: 'deco', kindOf: 'gear', p: [37, ISLE3_Y + 0.9, -30], s: [1.8, 1.8, 0.3], mat: 'copper', count: 3, spread: 2.6, jitter: 0.22 },
    { kind: 'light', p: [30, ISLE3_Y + 4.0, -34], color: 0xffe2b0, intensity: 8, distance: 26 },

    /* ========================================================================
     * BEAT 6 — THE CAUSEWAY
     * One prism ramp, 28.00 m of run and 13.00 m of rise = 24.9 deg, from the
     * wing landing's north lip (z -29, y 37.00) to the road's south lip
     * (z -57, y 50.00). It is a WALK, not a slide: the slide threshold is
     * TUNE.slope.slideDeg = 38 deg. `rot` tilts about X, so the slab's local
     * +Z axis is the one that carries the pitch — which is what makes this a
     * single object instead of eight stepping stones, and eight hops of graph
     * depth is exactly what the first draft of this course could not afford.
     * ===================================================================== */

    {
      kind: 'ramp',
      p: [-40, 43.5, -43],
      s: [6.0, 0.6, RAMP_LEN],
      rot: [RAMP_PITCH, 0, 0],
      mat: 'crystal', glow: RAINBOW, stripe: true, edge: SAFE_EDGE,
    },
    { kind: 'deco', kindOf: 'crystal', p: [-44.5, 41.0, -36], s: [1.0, 1.6, 1.0], mat: 'crystal', count: 6, spread: 4.4, jitter: 0.36, yJitter: 3.0 },
    { kind: 'deco', kindOf: 'crystal', p: [-35.5, 46.0, -50], s: [1.0, 1.6, 1.0], mat: 'crystal', count: 6, spread: 4.4, jitter: 0.36, yJitter: 3.0 },
    { kind: 'text', p: [-40, 38.6, -29.6], rot: [0, 0, 0], text: 'THE CAUSEWAY  ·  NOTHING IS TIMED HERE', size: 0.24, color: 0xbfe4ee },

    /* ========================================================================
     * BEAT 7 — THE GAUNTLET  (the set piece)
     * 99 m of rainbow road in FOUR long decks, all 10 m deep about z = -62,
     * tops 50 -> 53 -> 56 -> 59. The hazards live ON the decks; the decks
     * themselves are joined by three measured triples, each with tens of
     * metres of straight approach behind it:
     *
     *   start (x -47..-27) -> mid  (x -25..3)   2.00 m at +3.00 m, 20 m chord
     *   mid   (x -25..3)   -> east (x 5..29)    2.00 m at +3.00 m, 28 m chord
     *   east  (x 5..29)    -> sanctum (x 32..)  3.00 m at +3.00 m, 24 m chord
     *
     * Triple-safe at +3.00 m is 4.46 m, so all three sit at least 1.4 m inside
     * the envelope; the CONTRACT §0 run-up column wants >= 6 m of straight
     * approach for a triple and the shortest deck here gives twenty.
     *
     * What makes it a finale is that five families are live at once on every
     * metre: vanish tiles on the parallel line, hammers on a 3 s count, a
     * rotor at ankle height, wind bending every jump, and the cloud rising.
     * The jump pad at x = 27 is the friendly way onto the sanctum for anyone
     * who does not want to land a triple with a rotor behind them.
     * ===================================================================== */

    ...ROAD.map((d) => slab(d.x, d.y, -62, d.sx, 10, { mat: 'marble' })),
    slab(42, SANCTUM_Y, -64, 20, 16, { mat: 'gold' }),          // sanctum, x 32..52, z -72..-56

    /* THE TILE SHORTCUT. Three vanish tiles on a line 8 m north of the road:
     *   start deck -> tile 1   1.98 m at +1.00 m
     *   tile -> tile           2.80 m at +1.00 m   (single-safe 3.88 m)
     *   tile 3 -> mid deck     1.40 m at  0.00 m
     * It saves nothing but a second, which is the point: it is where sigil 8
     * lives and where a player who has learned the garden tiles gets to prove
     * it over a 30 m drop. */
    ...GTILE.map((g, i) => ({
      kind: 'vanish', p: [g.x, r2(g.y - 0.3), GTILE_Z], s: [3.2, 0.6, 3.2], mat: 'glass',
      cycle: { on: 2.2, off: 1.5, warn: 0.6, phase: r2(i * 0.7) },
      stripe: true, edge: SAFE_EDGE,
    })),

    /* PRISM HAMMERS on the east deck. `p` is the RETRACTED centre and a
     * crusher is lethal ONLY on the driving face while it drives
     * (hazards/index.js), so a parked hammer is a shelf. Retracted centre
     * 61.20 with a 2.40 m body puts the face 4.00 m over the deck; `travel`
     * 4.00 brings it down to EXACTLY the deck top at 56.00, so it slams the
     * floor and never clips through it. Opposite phases on a 3 s period: the
     * deck is never fully covered, and the count is audible before it is
     * visible — which is why sigil 7 can live between them. */
    { kind: 'crusher', p: [10, 61.2, -62], s: [3.4, 2.4, 5.0], axis: [0, -1, 0], travel: 4.0, period: 3.0, phase: 0, dwell: 0.5, mat: 'crystal' },
    { kind: 'crusher', p: [15, 61.2, -62], s: [3.4, 2.4, 5.0], axis: [0, -1, 0], travel: 4.0, period: 3.0, phase: 0.5, dwell: 0.5, mat: 'crystal' },

    // The rotor: len 3.0 about x = 21 on a deck spanning x 5..29, so the lanes
    // at x 5..18 and x 24..29 are always clear. You can wait it out; the cloud
    // in your peripheral vision says do not.
    { kind: 'rotor', p: [21, 56.4, -62], style: 'windmill', arms: 3, len: 3.0, period: 4.2, axis: 'y' },

    // The friendly line onto the sanctum. `power` is TARGET APEX IN METRES:
    // 5.5 clears the +2.70 m rise with 6.94 m of reach against a 3.50 m gap.
    { kind: 'jumppad', p: [27, 56.15, -62], s: [3.0, 0.3, 3.0], power: 5.5, dir: [0, 1, 0], mat: 'rubber' },

    // Wind across the road's lips: `power` is m/s^2 (TRAP 3). It never pushes
    // you off a deck you are standing still on; it bends every jump you make.
    { kind: 'wind', p: [-20, 53.5, -62], s: [54, 8, 9], dir: [0, 0, 1], power: 5.5 },
    { kind: 'wind', p: [20, 58.5, -62], s: [34, 8, 9], dir: [0, 0, -1], power: 5.0 },

    /* THE RISING CLOUD. axis 'y', from 22.00 to 47.50 at 0.45 m/s after 12 s,
     * so it is level with the road's underside 68.7 s in and then PARKS. Its
     * face is 110 x 14 m centred on (0, -, -65), i.e. x -55..55 and z -72..-58:
     * the road and nothing else. Everything walkable inside that band sits at
     * or above 50.00, which is 2.50 m clear of the parked front — see the
     * header note on why that clearance is the whole design. */
    {
      kind: 'chase', axis: 'y', from: 22.0, to: CLOUD_TOP, speed: 0.45, delay: 12,
      mat: 'void', p: [0, 0, -65], s: [110, 1, 14], color: 0x7f3fd8,
    },

    { kind: 'text', p: [-40, ROAD[0].y + 1.7, -57.4], rot: [0, -Math.PI / 2, 0], text: 'THE GAUNTLET', size: 0.52, color: 0xe6f6ff },
    { kind: 'text', p: [-40, ROAD[0].y + 1.25, -57.4], rot: [0, -Math.PI / 2, 0], text: 'TILES  ·  HAMMERS  ·  SPOKES  ·  WIND', size: 0.22, color: 0xbfe4ee },
    { kind: 'text', p: [-40, ROAD[0].y + 0.9, -57.4], rot: [0, -Math.PI / 2, 0], text: 'THE CLOUD ONLY RISES', size: 0.21, color: 0xffb0bd },
    { kind: 'text', p: [12.5, 58.4, -57.4], rot: [0, 0, 0], text: 'HAMMERS KEEP TIME  ·  SO CAN YOU', size: 0.22, color: 0xbfe4ee },
    { kind: 'text', p: [27, 57.7, -57.4], rot: [0, 0, 0], text: 'STAND ON IT', size: 0.24, color: 0xbfe4ee },

    { kind: 'deco', kindOf: 'crystal', p: [-34, 50.4, -66.4], s: [1.1, 1.7, 1.1], mat: 'crystal', count: 6, spread: 5.0, jitter: 0.34, yJitter: 1.4 },
    { kind: 'deco', kindOf: 'crystal', p: [-4, 53.4, -57.6], s: [1.1, 1.7, 1.1], mat: 'crystal', count: 6, spread: 5.0, jitter: 0.34, yJitter: 1.4 },
    { kind: 'deco', kindOf: 'arch', p: [-11, 60.0, -62], s: [1.2, 1.0, 11.0], rot: [0, Math.PI / 2, 0], mat: 'marble' },
    { kind: 'deco', kindOf: 'rail', p: [-37, 51.4, -58.6], s: [10.0, 1.0, 0.2], mat: 'copper', count: 2, spread: 3.0, jitter: 0.06 },
    { kind: 'light', p: [-11, 58.4, -62], color: 0x7fffd8, intensity: 9, distance: 28 },

    /* ========================================================================
     * BEAT 8 — THE SANCTUM
     * The Grand Pedestal on a gold deck at 59.00, under a colonnade and two
     * god-rays. The open crest floats 1.60 m over it — a walk-up, because the
     * last thing a 99 m gauntlet should ask for is a precise jump.
     * ===================================================================== */

    { kind: 'pedestal', p: [42, SANCTUM_Y, -64], mat: 'gold', tint: GOLD, glow: GOLD },
    { kind: 'deco', kindOf: 'pillar', p: [36, SANCTUM_Y + 1.6, -64], s: [1.0, 3.2, 1.0], mat: 'marble', count: 3, spread: 3.4, jitter: 0.10 },
    { kind: 'deco', kindOf: 'pillar', p: [48, SANCTUM_Y + 1.6, -64], s: [1.0, 3.2, 1.0], mat: 'marble', count: 3, spread: 3.4, jitter: 0.10 },
    { kind: 'deco', kindOf: 'arch', p: [42, SANCTUM_Y + 4.4, -71.2], s: [1.2, 1.0, 12.0], rot: [0, Math.PI / 2, 0], mat: 'marble' },
    { kind: 'deco', kindOf: 'statue', p: [36, SANCTUM_Y + 1.1, -69], s: [1.4, 2.2, 1.4], mat: 'marble', count: 2, spread: 3.0, jitter: 0.10 },
    { kind: 'deco', kindOf: 'godray', p: [42, SANCTUM_Y + 3.2, -64], s: [4.0, 6.0, 4.0], mat: 'glass', count: 2, spread: 4.0, jitter: 0.20 },
    { kind: 'deco', kindOf: 'banner', p: [42, SANCTUM_Y + 3.0, -71.0], s: [0.1, 3.2, 1.7], mat: 'cloth' },
    { kind: 'light', p: [42, SANCTUM_Y + 3.6, -64], color: GOLD, intensity: 12, distance: 32 },

    // The race pads: the run starts on the station anchor and ends here. Both
    // are 0.20 m inlays flush with their decks, so neither is a jump target
    // and neither wears a stripe.
    { kind: 'platform', p: [0, r2(STATION_Y - 0.04), 44.0], s: [3.8, 0.2, 3.8], mat: 'panel', stripe: false },
    { kind: 'platform', p: [42, r2(SANCTUM_Y - 0.04), -64], s: [3.8, 0.2, 3.8], mat: 'panel', stripe: false },
    { kind: 'text', p: [0, STATION_Y + 1.3, 47.6], rot: [0, Math.PI, 0], text: 'PRISM RIDE  ·  120s', size: 0.26, color: GOLD },
  ],

  /* ------------------------------------------------------------------------
   * CRITTERS
   * --------------------------------------------------------------------- */
  critters: [
    // THE GNASHER on the cloud shelf. Chain 6.00 m from a post at (-34, -2),
    // and sigil 2 sits at (-34, -6) — 4.00 m from the post, INSIDE the disc.
    // The coin ring at r 5.40 is the fence you can pace out from outside it.
    {
      kind: 'gnasher', p: [-34, SHELF_Y, -6], chain: 6.0,
      post: [-34, SHELF_Y, -2], postHits: 3, telegraph: 0.5, color: 0x3f5a74,
    },
    // BUMBLERS. Side contact is knockback, not death (contract §23) — which on
    // a road with no railings is quite enough.
    { kind: 'bumbler', path: [[-12, GARDEN_Y, 12], [10, GARDEN_Y, 12], [10, GARDEN_Y, -2], [-12, GARDEN_Y, -2], [-12, GARDEN_Y, 12]], speed: 1.7, color: 0x6fb3d8 },
    { kind: 'bumbler', path: [[-20, 53.0, -60], [0, 53.0, -60], [0, 53.0, -64], [-20, 53.0, -64], [-20, 53.0, -60]], speed: 1.9, color: 0x6fb3d8 },
    // SKITTERS — the prism birds. One works the void crossing, one the rings.
    { kind: 'skitter', p: [0, 36.6, 26], path: [[-8, 36.6, 30], [8, 38.4, 20]], amp: 1.8, speed: 3.6, color: 0x9f7fe0 },
    { kind: 'skitter', p: [-38, 43.0, -18], path: [[-28, 42.0, -8], [-50, 45.0, -28]], amp: 2.2, speed: 4.0, color: 0x9f7fe0 },
    // THE WARDEN on the last isle. Three hits, arena r 7.00 about (30, -34) on
    // an 18 m deck; the rotor spokes above it are the wall its charge breaks on.
    { kind: 'warden', p: [30, ISLE3_Y, -34], arena: { c: [30, -34], r: 7.0 }, color: 0x6f8fbf },
  ],
};
