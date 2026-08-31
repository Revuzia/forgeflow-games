/**
 * ASCENDANT — SKY TEMPLE 2 : "THE HOLLOW COLUMN"
 * runtime/data/stages/temple-2.js
 *
 * A colossal broken drum standing out of a sea of cloud. You climb its OUTER shell on
 * ledges that wrap around it, you drop THROUGH the shell at the top, and you climb back
 * out up the inside of the breach. The drum is real geometry, not a caption: fourteen
 * stone staves stand on an ellipse 64 m by 27 m around the whole descent, a broken rim
 * hangs 24 m over it, and the climb-out runs up the inside of that same wall. Both ends
 * of the ellipse are open, because both ends are the breaches you go in and out through.
 *
 * TEACHES / TESTS, in order:
 *   BEAT 1  threshold — static, five warm-up hops, no hazard of any kind
 *   BEAT 2  the SPIRAL — the stage's grammar: forward + sideways + up, all at once
 *   BEAT 3  THE GLAZED FACE — ICE. Nothing in SKY TEMPLE has taken your brakes away
 *           before. One gust, and it sits in the AIR between two slabs, never over one.
 *   BEAT 4  THE SCOURING GALLERY — CONVEYORS. The floor itself moves: with you, across
 *           you, against you. Laser bars gate the belts so standing still is not an out.
 *   BEAT 5  THE OLD TREADS — vanishing stone, five different cycles on five different
 *           footprints, and the fourth one steps DOWN. Two sun-shafts cut the line.
 *   BEAT 6  THE MILL — three windmills over three narrow planks. Timing, not width.
 *   BEAT 7  breather: the gate stone, the censer, the last coin on the main line
 *   BEAT 8  SET-PIECE — down the inside of the drum through three turning wheels, then
 *           the CLIMB OUT: ten hops up the inside of the breach. No lift. No held key.
 *
 * ── WHY THIS FILE LOOKS THE WAY IT DOES ─────────────────────────────────────────
 * A design pass rejected the previous revision on eighteen counts. Every fix is
 * arithmetic against the hazard factories, not against intuition, and the traps that
 * produced those defects are written down here so the next author does not repeat them.
 *
 * TRAP 1 — A WINDMILL'S KILL CAPSULE IS LONGER THAN `len` AND WIDER THAN THE ART.
 *   rotors.js translates every blade out by `innerR = max(0.20, thick*0.9)` BEFORE
 *   extending `len`, and gives each arm a capsule of radius `max(thick, rootC*0.30)`
 *   where `rootC = max(0.45, height*2.6)` and `height` defaults to `thick`. The real
 *   lethal reach from the hub is  innerR + len + killR,  not `len`, and the lethal slab
 *   is 2*killR thick about the rotation plane, not the blade's drawn thickness. Every
 *   windmill hub height on this stage is solved from that formula, not eyeballed.
 * TRAP 2 — A PENDULUM'S `blade.d` IS ITS THICKNESS, AND THICKNESS SETS THE KILL RADIUS.
 *   pendulum.js reads `blade.d` as `th` and then builds capsules of radius
 *   `max(th*1.7, ...)` and `max(th*1.15, ...)`. Writing `{w:0.34, h:1.8, d:2.8}` for
 *   "a thin blade 2.8 m across" produces a 4.76 m INVISIBLE kill sphere. `w` is the
 *   SPAN, `h` is the DROP, `d` is the THICKNESS. The censer below is
 *   {w:2.4, h:1.3, d:0.30}: kill radii 0.51 and 0.39 m, about what it looks like.
 * TRAP 3 — `vanish.cycle.phase` IS A FRACTION OF ONE CYCLE (vanish.js: `fract(t/period
 *   + phase) * period`), and `period = on + warn + off`. A phase of 1.8 is
 *   `fract(1.8) = 0.8`, not "1.8 seconds late". Every phase below is written as a
 *   fraction with the seconds it actually comes to spelled out beside it.
 * TRAP 4 — A `style:'bar'` ROTOR IS SOLID AND, WITHOUT `kill`, ONLY *PUSHES*.
 *   rotors.js pushes a Collider per arm and only pushes a KillVolume `if (def.kill)`.
 *   An unkilled bar over a ledge does not read as a hazard — it shoves a standing
 *   player off. The three wheels in the shaft are `style:'windmill'` with `mount: 0`
 *   precisely because that combination has NO solid collider at all (a windmill
 *   contributes no moving solids, and `mount: 0` skips the pedestal), so nothing in
 *   the well can ever push anybody anywhere. The one bar on the stage is lethal on
 *   purpose and sits on a 9.6 m floor with a checkpoint outside its sweep.
 *
 * ── THE HOUSE RULES, APPLIED (see neon-1's header for the full statement) ─────
 * 1. THE ENVELOPE IS LAW, AND IT IS PER-DROP, NOT PER-STAGE. The safe budget is 83% of
 *    `maxJumpDist(speed, dy)` for that jump's own dy — 4.35 m flat, but 5.81 m at
 *    -4.2 m and only 2.78 m at +2.0 m. Every jump below is quoted as a distance AND as
 *    a percentage of its own budget. Nothing anywhere on this stage, required or
 *    optional, exceeds 81%.
 * 2. MIND THE SURFACE YOU DID NOT MEAN TO OFFER. The validator graphs EVERY pair of
 *    landable surfaces and takes the cheapest route, so skip-one distances matter as
 *    much as skip-none. The forbidden band is 83%..100% of a jump's OWN envelope: a
 *    jump the player can just make and will fail half the time. Every skip-one crossing
 *    on this stage was measured and pushed clear of it — in the well, lip -> shelf 2 is
 *    13.30 m against a sprint envelope of 11.32, shelf 1 -> shelf 3 is 12.85 against
 *    11.90 and shelf 2 -> floor is 12.20 against 11.50, so the only way down is through
 *    the wheels, one at a time. On the mill, plank 1 -> plank 2 is 8.00 m against 7.27,
 *    so both piers are mandatory.
 *
 *    WRITE A CIRCLE MOVER'S AXIS AS THE STRING 'y', NEVER AS [0,1,0] — the validator
 *    tests `axis === 'y'` before it samples the ring. (No circle movers survive on this
 *    stage; the note stays because the next author will reach for one.)
 * 3. EVERY LINK MUST BE JUMPABLE. There is no lift and no elevator: the 17.5 m climb
 *    out of the drum is ten jumps, every one inside the envelope for its own rise. The
 *    vent is a SHORTCUT, not a bridge — the same balcony is reachable without it.
 * 4. HAZARDS ARE PURE FUNCTIONS OF THE STAGE CLOCK (CONTRACT section 16).
 * 5. VARY EVERYTHING. The five vanish treads run five different cycles (4.70 / 4.60 /
 *    5.00 / 4.30 / 4.60 s) on five different footprints, and the fourth steps DOWN. The
 *    three wheels in the well gate three different leaps — 4.70 m at -4.2, 4.31 m at
 *    -3.3, 4.75 m at -5.8 — onto three different shelves (4.6x4.6, 3.4x3.4, 3.8x2.6),
 *    and the last wheel is set CROOKED in the shaft so its plane is canted.
 * 6. EVERY LANDING IS VISIBLE FROM ITS TAKE-OFF, and "visible" means lit FROM ABOVE.
 *    A lamp under a shelf lights its underside and nothing else. Each shelf in the well
 *    gets a lamp 2.7 m ABOVE its deck — the readable one — plus a dim rim light beneath
 *    it for the silhouette, in that order of importance.
 *
 * THE HIDDEN PATH. It is genuinely hidden: it starts by jumping the WRONG WAY, 3.40 m
 * due south and 1.5 m DOWN off the back of the CP3 landing into the drum's shadow, and
 * the buttress at z -6.2 stands between it and the landing so it is not in line of sight
 * from the main line at all. Every light on it is intensity 4 at distance 12 in DUSK;
 * the main line runs 8 to 12 in GOLD and MINT. Nothing on it is emissive and nothing on
 * it glows HOT. It carries COINS 2 and 3, it skips all five treads and both sun-shafts,
 * and it commits you over open cloud with no bail-out. Its longest jump is 2.90 m at
 * +0.4 (70%); its riskiest is the 2.42 m spur at -0.4 (53%) with nothing underneath.
 * Those are measured numbers: the previous revision quoted a 4.30 m jump as "3.90 m"
 * and hid a 99%-of-budget stretch behind the typo.
 *
 * CONVENTIONS (full list in runtime/data/index.js):
 *   p = CENTRE, s = FULL size, a top surface is p[1] + s[1]/2. Every gap quoted below
 *   is measured EDGE TO EDGE between landable tops. rot/yaw in radians, yaw 0 faces +X.
 *   `stripe: true` = "you had to jump to get here"; walk-on floors do not get one.
 *   A mover's `p` is its HOME pose and `motion.to` its far pose.
 *
 * HEIGHT LADDER: 6.0 (threshold) -> 8.7 (CP0) -> 12.1 (the first capital) -> 15.2 (off
 *                the glazed face) -> 17.4 (the gallery) -> 19.1 (the treads) -> 17.2
 *                (the mill planks, which step 17.2/18.6/17.4/19.0/17.8) -> 18.4 (the
 *                flat mill) -> 17.9 (the antechamber and the shaft lip) -> 13.7 -> 10.4
 *                -> 4.6 -> 2.4 (the drum floor, three and a half metres BELOW where you
 *                started) -> 7.5 (the balcony) -> 19.9 (the summit terrace).
 *
 * VALIDATED     node _harness/modulecheck.mjs
 *               node _harness/reachcheck.mjs temple-2
 *               node _harness/geomcheck.mjs temple-2
 */

const GOLD = 0xffc35c; // theme accent — signage, edge trim, safe lanterns
const EDGE = 0xfff8e6; // theme safeEdge — the brightest thing on a landable surface
const HOT = 0xff1044; // theme kill — nothing wears this that is not lethal
const MINT = 0x18d69a; // theme checkpointOn
const VIOLET = 0xd9b6ff; // theme finish — used for nothing else in any world
const DUSK = 0x7a6042; // deep shadow tone for background masonry AND the hidden path
const RIME = 0x9fdcff; // the frost on the glazed face
const SKYB = 0x6f93c4; // the cold blue that reads as "very far away"

export default {
  id: 'temple-2',
  world: 'temple',
  name: 'THE HOLLOW COLUMN',
  subtitle: 'Around the shell, down the middle, up the inside',
  par: 276000,
  difficulty: 7,

  spawn: { p: [0, 6.1, 0], yaw: 0 },
  killY: -26,

  // NINE checkpoints on 355 m. The guide says three to five; this stage earns more, and
  // the previous revision was rejected for exactly this arithmetic. BOTH END LEGS ARE
  // COUNTED HERE, which is the sum the last header dodged by quoting only the middle:
  //   spawn->cp0 30.2 · 33.4 · 36.4 · 45.4 · 42.0 · 48.2 · 30.6 · 36.8 · 30.8 ·
  //   cp8->finish 21.7
  // Longest leg 48.2 m (the mill), shortest 21.7 m (the last four hops of the climb).
  // The old file ran 58.9 m from the shaft lip to the finish through the entire
  // set-piece, which cost 35-50 s a death against a ~25 s budget.
  checkpoints: [
    // End of the threshold. Everything before this is a hop you can take twice.
    { p: [30.2, 8.8, 2.0], yaw: 0, clockOffset: 0 },
    // The first capital, at the top of the spiral. The ice starts 6 m past this.
    { p: [63.6, 12.2, 1.2], yaw: 0, clockOffset: 0 },
    // Off the glazed face, on stone you can actually stop on.
    { p: [100.0, 15.3, 1.6], yaw: 0, clockOffset: 0 },
    // The gallery landing. The treads start here and the hidden path starts behind you.
    { p: [145.4, 17.5, 1.2], yaw: 0, clockOffset: 0 },
    // Where the two routes meet, one hop short of the first mill plank. clockOffset 3.2
    // rather than 0: mill one is 3 arms on 6.4 s, i.e. a blade across the plank every
    // 2.13 s, and at t = 3.2 the gap is at the bottom of its sweep. You respawn into the
    // open half of the cycle instead of into a blade you could not have seen coming.
    { p: [187.4, 19.2, 1.6], yaw: 0, clockOffset: 3.2 },
    // The west strip of the flat mill's floor — 0.69 m outside the bar's sweep, which
    // is the only reason a checkpoint can live on a floor with a lethal sweeper on it.
    { p: [235.6, 18.5, 0.6], yaw: 0, clockOffset: 0 },
    // The shaft lip. The set-piece opens with a 4.70 m dive through a turning wheel, so
    // this is the last flat stone in the sky.
    { p: [266.2, 18.0, 0.6], yaw: 0, clockOffset: 0 },
    // THE DRUM FLOOR, three and a half metres below the stage's own start line.
    { p: [303.0, 2.5, 0.6], yaw: 0, clockOffset: 0 },
    // Half way up the inside of the breach, on the one wide shelf in the climb.
    { p: [333.8, 12.6, 0.0], yaw: 0, clockOffset: 0 },
  ],

  finish: { p: [355.5, 20.0, 0.6], yaw: 0 },

  coins: [
    { p: [86.4, 15.1, -5.6] }, // BEAT 3 — an ice spur you cannot brake on
    { p: [163.4, 17.4, -10.6] }, // HIDDEN — mid-span on the shadow gallery
    { p: [178.4, 17.9, -16.2] }, // HIDDEN — a spur off the gallery, over open cloud
    { p: [258.8, 19.1, -7.8] }, // BEAT 7 — under the censer's swing
    { p: [316.8, 7.1, 5.6] }, // BEAT 8 — on the climb's vanishing shelf
  ],

  objects: [
    /* ============================================================================ */
    /* BEAT 1 — THE THRESHOLD                                                       */
    /* A cracked processional floor at the drum's foot. Two risers to remind you what */
    /* a standing hop feels like, a gate, then three hops that step DOWN, sideways    */
    /* and back up, so the very first thing this stage teaches is that height is not  */
    /* monotonic. Fifteen seconds of nothing trying to hurt you.                     */
    /* ============================================================================ */

    { kind: 'platform', p: [2, 5.5, 0], s: [15, 1, 13], mat: 'stone', glow: DUSK }, // top 6.0

    { kind: 'platform', p: [4.0, 6.3, 4.6], s: [2.4, 0.6, 2.4], mat: 'panel', glow: GOLD, stripe: true }, // top 6.6 — a step up
    { kind: 'platform', p: [7.0, 6.75, 4.6], s: [2.2, 1.5, 2.2], mat: 'panel', glow: GOLD, stripe: true }, // top 7.5, gap 0.60 at +0.9

    { kind: 'text', p: [-3.2, 8.4, 0], rot: [0, -Math.PI / 2, 0], text: 'THE HOLLOW COLUMN', size: 0.72, color: GOLD },
    { kind: 'text', p: [-3.2, 7.75, 0], rot: [0, -Math.PI / 2, 0], text: 'SKY TEMPLE  ·  II', size: 0.28, color: 0x9c8460 },
    { kind: 'text', p: [-3.2, 7.2, 0], rot: [0, -Math.PI / 2, 0], text: 'it is hollow all the way down', size: 0.24, color: EDGE },
    { kind: 'text', p: [5.6, 8.8, 4.6], rot: [0, -Math.PI / 2, 0], text: 'warm up', size: 0.24, color: GOLD },

    // The gate. Its pillars stand at |z| = 6.6 and are 5.6 m tall, so their tops sit
    // 4.6 m above the floor — far past any apex reachable from it, and unmistakably
    // architecture rather than a foothold.
    { kind: 'deco', kindOf: 'arch', p: [9.6, 10.2, 0], s: [1.2, 1.0, 15.0], mat: 'obsidian', tint: GOLD },
    { kind: 'deco', kindOf: 'pillar', p: [9.6, 8.0, 6.6], s: [1.3, 5.6, 1.3], mat: 'stone' },
    { kind: 'deco', kindOf: 'pillar', p: [9.6, 8.0, -6.6], s: [1.3, 5.6, 1.3], mat: 'stone' },
    { kind: 'deco', kindOf: 'emblem', p: [9.6, 10.2, 0], s: [0.3, 1.8, 1.8], mat: 'emissive', tint: GOLD },
    { kind: 'deco', kindOf: 'brazier', p: [6.2, 6.6, -4.4], s: [0.9, 1.2, 0.9], mat: 'metal', tint: GOLD },
    { kind: 'deco', kindOf: 'rubble', p: [0.5, 6.2, -4.8], s: [2.6, 0.5, 2.2], mat: 'stone', tint: DUSK },
    { kind: 'light', p: [9.6, 9.0, 0], color: GOLD, intensity: 11, distance: 26 },
    { kind: 'light', p: [1.0, 8.6, 0], color: 0xffe6bf, intensity: 8, distance: 20 },

    { kind: 'platform', p: [13.8, 5.6, 0.6], s: [3.6, 1, 5.2], mat: 'panel', glow: GOLD, stripe: true }, // top 6.1, gap 2.50 at +0.1 (57%)
    { kind: 'platform', p: [19.6, 6.4, -3.2], s: [3.2, 1, 4.2], mat: 'panel', glow: GOLD, stripe: true }, // top 6.9, gap 2.40 at +0.8 (61%)
    { kind: 'platform', p: [24.6, 7.6, 0.4], s: [3.0, 1, 3.4], mat: 'stone', glow: GOLD, stripe: true }, // top 8.1, gap 1.90 at +1.2 (52%)
    { kind: 'platform', p: [30.2, 8.2, 2.0], s: [5.6, 1, 6.4], mat: 'stone', glow: DUSK, stripe: true }, // CP0, top 8.7, gap 1.30 at +0.6 (32%)

    { kind: 'deco', kindOf: 'statue', p: [30.2, 11.6, 5.6], s: [1.2, 5.0, 1.2], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'statue', p: [30.2, 11.6, -1.6], s: [1.2, 5.0, 1.2], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [16.0, 1.0, 7.6], s: [2.0, 9.0, 2.0], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [24.0, 1.4, -8.0], s: [2.0, 9.4, 2.0], mat: 'stone', tint: DUSK },
    { kind: 'light', p: [30.2, 11.4, 2.0], color: MINT, intensity: 9, distance: 20 },
    { kind: 'light', p: [20, 9.4, 0], color: GOLD, intensity: 7, distance: 24 },

    /* ============================================================================ */
    /* BEAT 2 — THE SPIRAL                                                          */
    /* The verb the whole stage is built on: every hop moves you forward, sideways   */
    /* AND up, so none of them can be solved by aiming straight ahead. The lateral   */
    /* swing runs +2.0 -> +5.6 -> +8.6 -> +8.6 -> +5.4 -> +1.2, wrapping the shell,  */
    /* and the climb is +0.8, +0.9, 0.0, +1.2, +0.5 — deliberately uneven, so the    */
    /* rhythm never becomes a count you can run blind.                              */
    /*                                                                              */
    /* The cornice breaks the pattern in the middle: a 1.1 m beam, nine metres long, */
    /* no gap at all, just width. It makes you slow down immediately before the two  */
    /* hardest wraps on the beat.                                                   */
    /* ============================================================================ */

    { kind: 'platform', p: [36.4, 9.0, 5.6], s: [3.2, 1, 3.4], mat: 'stone', glow: GOLD, stripe: true }, // top 9.5, gap 1.80 at +0.8 (46%)
    { kind: 'platform', p: [41.8, 9.9, 8.6], s: [3.0, 1, 3.0], mat: 'stone', glow: GOLD, stripe: true }, // top 10.4, gap 2.30 at +0.9 (60%)

    { kind: 'beam', p: [49.6, 10.15, 8.6], s: [9.0, 0.5, 1.1], mat: 'stone' }, // the cornice — gap 1.80 flat (41%), then walk it
    { kind: 'text', p: [45.4, 12.0, 8.6], rot: [0, -Math.PI / 2, 0], text: 'narrow', size: 0.26, color: EDGE },

    { kind: 'platform', p: [57.2, 11.1, 5.4], s: [3.2, 1, 3.6], mat: 'stone', glow: GOLD, stripe: true }, // top 11.6, diag 1.72 at +1.2 (47%)
    { kind: 'platform', p: [63.6, 11.6, 1.2], s: [7.6, 1, 8.6], mat: 'stone', glow: DUSK, stripe: true }, // CP1 — the first capital, top 12.1, gap 1.00 at +0.5 (24%)

    { kind: 'deco', kindOf: 'buttress', p: [34.0, 3.6, 10.4], s: [2.0, 10.0, 2.0], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [44.0, 4.0, 11.4], s: [2.0, 11.0, 2.0], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [54.0, 4.4, 10.6], s: [2.0, 11.4, 2.0], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [46.0, 3.0, -9.4], s: [2.0, 10.0, 2.0], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [63.6, 16.0, 5.0], s: [1.4, 8.0, 1.4], mat: 'stone' },
    { kind: 'deco', kindOf: 'pillar', p: [63.6, 16.0, -2.6], s: [1.4, 8.0, 1.4], mat: 'stone' },
    { kind: 'deco', kindOf: 'banner', p: [63.6, 16.8, 5.0], s: [0.12, 3.0, 1.8], mat: 'panel', tint: GOLD },
    { kind: 'deco', kindOf: 'banner', p: [63.6, 16.8, -2.6], s: [0.12, 3.0, 1.8], mat: 'panel', tint: GOLD },
    { kind: 'deco', kindOf: 'brazier', p: [60.4, 12.9, 4.2], s: [0.9, 1.2, 0.9], mat: 'metal', tint: GOLD },
    { kind: 'light', p: [60.4, 13.9, 4.2], color: GOLD, intensity: 7, distance: 15, flicker: 0.3 },
    { kind: 'light', p: [49.6, 13.4, 8.6], color: 0xffe6bf, intensity: 7, distance: 22 },
    { kind: 'light', p: [63.6, 14.8, 1.2], color: MINT, intensity: 9, distance: 20 },
    { kind: 'light', p: [45, 12.8, 7.0], color: GOLD, intensity: 7, distance: 22 },

    /* ============================================================================ */
    /* BEAT 3 — THE GLAZED FACE  (new verb: ICE)                                    */
    /* Five kilometres up, the shell is rimed over, and every landable surface in    */
    /* this beat is ice. TUNE.iceFriction is 1.4 against 13 on stone and iceAccel is */
    /* 26 against 95: you keep your top speed and you lose your brakes. SKY TEMPLE 1 */
    /* taught wind and orbits and never once took the friction away — which is why   */
    /* this beat exists, and why it is NOT temple-1 BEAT 5 with the numbers changed. */
    /*                                                                              */
    /* The slabs get SMALLER as you go — 5.6 -> 4.6 -> 3.6 -> 2.8 m square — so the  */
    /* overrun you got away with on the first one is the death on the fourth.        */
    /*                                                                              */
    /* THE GUST is 2.6 m wide and lives ENTIRELY IN THE AIR between slabs three and  */
    /* four: x 88.4 .. 91.0, against slab 3 ending at 88.2 and slab 4 starting at    */
    /* 91.2. temple-1's own rule is that no wind volume overlaps a surface you stand */
    /* still on, and this is the only wind on the stage. You cross it in about 0.30 s */
    /* at run speed, so it is worth roughly half a metre of drift: enough to make you */
    /* aim upwind, not enough to hand you the drop. It is not a route and not a wall. */
    /*                                                                              */
    /* COIN 1 is a 2.80 m hop north onto a 2.4 m ice spur — 64% of that jump's budget */
    /* in distance and all of it in stopping distance. Skip it and lose nothing.      */
    /* ============================================================================ */

    { kind: 'ice', p: [72.0, 12.1, 1.2], s: [5.6, 1, 5.6] }, // top 12.6, gap 1.80 flat (41%) — the big one, learn the slide
    { kind: 'ice', p: [79.6, 12.7, 4.4], s: [4.6, 1, 4.6] }, // top 13.2, gap 2.50 at +0.6 (62%)
    { kind: 'ice', p: [86.4, 13.4, 0.2], s: [3.6, 1, 3.6] }, // top 13.9, diag 2.70 at +0.7 (68%)
    { kind: 'ice', p: [86.4, 13.4, -5.6], s: [2.4, 1, 2.4] }, // COIN 1 spur — 2.80 m due north, flat (64%)
    { kind: 'ice', p: [92.6, 14.2, 3.0], s: [2.8, 1, 2.8] }, // top 14.7, gap 3.00 at +0.8 (76%)

    { kind: 'wind', p: [89.7, 16.4, 3.0], s: [2.6, 5.0, 6.0], dir: [0, 0, -1], power: 12, color: EDGE },

    { kind: 'platform', p: [100.0, 14.7, 1.6], s: [6.4, 1, 7.6], mat: 'stone', glow: DUSK, stripe: true }, // CP2, top 15.2, gap 2.80 at +0.5 (68%)

    { kind: 'text', p: [67.4, 14.6, 1.2], rot: [0, -Math.PI / 2, 0], text: 'THE FACE IS GLAZED', size: 0.46, color: GOLD },
    { kind: 'text', p: [67.4, 14.05, 1.2], rot: [0, -Math.PI / 2, 0], text: 'you keep the speed  ·  you lose the brakes', size: 0.24, color: EDGE },
    { kind: 'text', p: [88.0, 17.8, 6.6], rot: [0, -Math.PI / 2, 0], text: 'gust', size: 0.24, color: EDGE },
    { kind: 'deco', kindOf: 'buttress', p: [74.0, 5.6, 11.2], s: [2.2, 12.0, 2.2], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [84.0, 5.6, 10.2], s: [2.2, 12.4, 2.2], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [94.0, 5.6, 9.0], s: [2.2, 13.0, 2.2], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [80.0, 5.0, -10.6], s: [2.2, 12.0, 2.2], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'lantern', p: [76.0, 16.4, -7.4], s: [0.7, 1.1, 0.7], mat: 'emissive', tint: GOLD },
    { kind: 'deco', kindOf: 'lantern', p: [90.0, 16.8, 8.0], s: [0.7, 1.1, 0.7], mat: 'emissive', tint: GOLD },
    { kind: 'deco', kindOf: 'icicle', p: [79.6, 11.6, 4.4], s: [3.6, 1.6, 3.6], mat: 'crystal', tint: RIME },
    { kind: 'deco', kindOf: 'icicle', p: [92.6, 13.0, 3.0], s: [2.2, 1.4, 2.2], mat: 'crystal', tint: RIME },
    { kind: 'deco', kindOf: 'icicle', p: [72.0, 11.0, 1.2], s: [4.4, 1.8, 4.4], mat: 'crystal', tint: RIME },
    { kind: 'light', p: [76.0, 16.0, 1.2], color: RIME, intensity: 9, distance: 26 },
    { kind: 'light', p: [90.0, 16.4, 1.6], color: RIME, intensity: 9, distance: 26 },
    { kind: 'light', p: [86.4, 16.0, -5.6], color: GOLD, intensity: 6, distance: 14 },
    { kind: 'light', p: [100, 18.0, 1.6], color: MINT, intensity: 9, distance: 22 },

    /* ============================================================================ */
    /* BEAT 4 — THE SCOURING GALLERY  (new verb: CONVEYOR)                          */
    /* The processional floor of the gallery is a river of wind-driven grit, and it  */
    /* still runs. Three belts, and the beat is about the three RELATIONS a moving   */
    /* floor can have with you:                                                     */
    /*   BELT 1  runs WITH you at 6.0 m/s over 11 m. The danger is the far edge.     */
    /*   BELT 2  runs ACROSS you at 5.0 m/s over a 6 m square. Walk the diagonal.    */
    /*   BELT 3  runs AGAINST you at 5.5 and then 6.5 m/s — but it is cut in two by  */
    /*           a stone island, so it is two short pushes and a jump, never a held  */
    /*           key. Run speed is 8.6, so the worse half nets 2.1 m/s for about two */
    /*           seconds: long enough to feel, far too short to be a corridor.       */
    /* LASER 1 crosses BELT 1 at 0.8 m above the deck — chest height on a 1.8 m      */
    /* player — while the belt is pushing you INTO it, so holding back is a real     */
    /* input rather than the absence of one. 1.2 s lit, 2.2 s dark, 0.5 s of warning. */
    /* LASER 2 is slanted across the gap between the island and belt 3b, on a         */
    /* different cycle (1.0 / 2.4 / 0.5) so the two never open together for long.     */
    /*                                                                              */
    /* Belt 3a -> belt 3b measures 7.90 m against a sprint envelope of 6.71 at +0.8,  */
    /* so the island cannot be skipped.                                              */
    /* ============================================================================ */

    { kind: 'conveyor', p: [110.0, 14.7, 1.6], s: [11.0, 1, 4.4], dir: [1, 0, 0], power: 6.0, mat: 'stone' }, // top 15.2, gap 1.30 flat (30%)
    { kind: 'laser', a: [113.2, 16.0, -1.6], b: [113.2, 16.0, 4.8], radius: 0.26, cycle: { on: 1.2, off: 2.2, warn: 0.5, phase: 0.0 }, color: HOT },

    { kind: 'conveyor', p: [120.2, 15.1, 1.6], s: [6.0, 1, 6.0], dir: [0, 0, -1], power: 5.0, mat: 'stone' }, // top 15.6, gap 1.70 at +0.4 (41%)

    { kind: 'conveyor', p: [127.2, 15.5, 0.4], s: [4.2, 1, 4.0], dir: [-1, 0, 0], power: 5.5, mat: 'stone' }, // top 16.0, gap 2.20 at +0.4 (53%)
    { kind: 'platform', p: [133.4, 15.9, 2.2], s: [2.6, 1, 3.0], mat: 'stone', glow: GOLD, stripe: true }, // the island, top 16.4, gap 2.80 at +0.4 (67%)
    { kind: 'laser', a: [136.0, 20.4, 3.0], b: [136.0, 15.6, -2.4], radius: 0.26, cycle: { on: 1.0, off: 2.4, warn: 0.5, phase: 0.55 }, color: HOT },
    { kind: 'conveyor', p: [139.2, 16.3, -0.4], s: [4.0, 1, 3.6], dir: [-1, 0, 0], power: 6.5, mat: 'stone' }, // top 16.8, gap 2.50 at +0.4 (60%)

    { kind: 'platform', p: [145.4, 16.9, 1.2], s: [6.0, 1, 7.2], mat: 'stone', glow: DUSK, stripe: true }, // CP3, top 17.4, gap 1.20 at +0.6 (30%)

    { kind: 'text', p: [104.0, 17.6, -2.0], rot: [0, -Math.PI / 2, 0], text: 'THE GALLERY STILL RUNS', size: 0.44, color: GOLD },
    { kind: 'text', p: [104.0, 17.05, -2.0], rot: [0, -Math.PI / 2, 0], text: 'with you  ·  across you  ·  against you', size: 0.24, color: EDGE },
    { kind: 'deco', kindOf: 'arch', p: [113.2, 19.4, 1.6], s: [1.2, 1.0, 9.0], mat: 'obsidian', tint: HOT },
    { kind: 'deco', kindOf: 'arch', p: [136.0, 21.0, 0.6], s: [1.2, 1.0, 8.0], mat: 'obsidian', tint: HOT },
    { kind: 'deco', kindOf: 'pillar', p: [110.0, 10.0, 5.4], s: [1.6, 9.0, 1.6], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [110.0, 10.0, -2.2], s: [1.6, 9.0, 1.6], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [127.2, 10.4, -3.4], s: [1.6, 9.4, 1.6], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [104.0, 6.0, 9.4], s: [2.2, 14.0, 2.2], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [120.0, 6.0, 9.0], s: [2.2, 14.4, 2.2], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [136.0, 6.0, 8.4], s: [2.2, 15.0, 2.2], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [112.0, 5.0, -9.8], s: [2.2, 14.0, 2.2], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'grate', p: [120.2, 19.6, 1.6], s: [5.0, 0.2, 5.0], mat: 'grate', tint: DUSK },
    { kind: 'light', p: [110.0, 18.4, 1.6], color: GOLD, intensity: 10, distance: 24 },
    { kind: 'light', p: [124.0, 18.6, 1.6], color: GOLD, intensity: 10, distance: 24 },
    { kind: 'light', p: [131, 19.2, 1.4], color: GOLD, intensity: 8, distance: 24 },
    { kind: 'light', p: [139.2, 19.0, -0.4], color: 0xffe6bf, intensity: 9, distance: 22 },
    { kind: 'light', p: [145.4, 20.2, 1.2], color: MINT, intensity: 9, distance: 20 },

    /* ============================================================================ */
    /* BEAT 5 — THE OLD TREADS                                                      */
    /* Vanishing stone. The previous revision put five treads on ONE cycle at gaps of */
    /* 3.00 / 2.90 / 2.86 / 2.79 / 2.86 / 2.83 — a 0.21 m spread across six jumps —   */
    /* with a metronome lateral swing and a +0.4 m step every single time. That is    */
    /* one obstacle with the x coordinate changed six times. These five share nothing: */
    /*                                                                              */
    /*   T1  3.4 x 3.8   on 2.8 / warn 0.7 / off 1.2   period 4.70   phase 0.00       */
    /*   T2  3.0 x 3.0   on 2.4 / warn 0.6 / off 1.6   period 4.60   phase 0.19 (0.87s)*/
    /*   T3  2.6 x 3.4   on 3.2 / warn 0.8 / off 1.0   period 5.00   phase 0.42 (2.10s)*/
    /*   T4  2.8 x 2.6   on 2.0 / warn 0.5 / off 1.8   period 4.30   phase 0.63 (2.71s)*/
    /*   T5  3.2 x 2.8   on 2.6 / warn 0.6 / off 1.4   period 4.60   phase 0.85 (3.91s)*/
    /*                                                                              */
    /* `cycle.phase` is a FRACTION of the cycle, which is why each one is written     */
    /* above as a fraction AND as the seconds it actually comes to. The last revision */
    /* wrote 1.8 / 2.7 / 3.6 meaning seconds and got fract() of them instead, so its  */
    /* documented 0.9 s ladder was really 0.47 s and the comment was arithmetically   */
    /* false. Read TRAP 3 in the header before touching any of these.                 */
    /*                                                                              */
    /* The steps are +0.8 / +0.5 / +0.4 / -1.2 / +0.6: THE FOURTH TREAD DROPS, which  */
    /* is the one thing five ascending treads can never teach. Gaps run 1.90 / 2.40 / */
    /* 2.42 / 2.62 / 2.10 / 3.28 / 3.00 and the lateral swing is +1.2 / +4.6 / +0.4 / */
    /* +4.2 / +1.0 / +4.4 — never the same interval twice.                            */
    /*                                                                              */
    /* Both sun-shafts sit IN THE GAPS (x 160.2 and x 171.0), never over a tread, so  */
    /* no tread is ever both gone and lethal at the same instant. Their cycles are    */
    /* 4.5 s and 4.7 s against tread periods of 4.30 - 5.00: everything drifts against */
    /* everything else on purpose. There is no count to memorise, only a thing to read.*/
    /* ============================================================================ */

    { kind: 'vanish', p: [152.0, 16.9, 1.2], s: [3.4, 1, 3.8], mat: 'stone', cycle: { on: 2.8, off: 1.2, warn: 0.7, phase: 0.0 } }, // top 17.4, gap 1.90 flat (44%)
    { kind: 'vanish', p: [157.6, 17.7, 4.6], s: [3.0, 1, 3.0], mat: 'stone', cycle: { on: 2.4, off: 1.6, warn: 0.6, phase: 0.19 } }, // top 18.2, gap 2.40 at +0.8 (61%)
    { kind: 'laser', a: [160.2, 24.0, 3.4], b: [160.2, 17.4, 3.4], radius: 0.26, cycle: { on: 1.5, off: 2.4, warn: 0.6, phase: 0.10 }, color: HOT },
    { kind: 'vanish', p: [162.6, 18.2, 0.4], s: [2.6, 1, 3.4], mat: 'stone', cycle: { on: 3.2, off: 1.0, warn: 0.8, phase: 0.42 } }, // top 18.7, diag 2.42 at +0.5 (59%)

    { kind: 'platform', p: [168.2, 18.6, 4.2], s: [3.4, 1, 3.6], mat: 'stone', glow: MINT, stripe: true }, // the stone that held — top 19.1, diag 2.62 at +0.4 (63%)

    { kind: 'laser', a: [171.0, 24.4, 0.8], b: [171.0, 17.0, 0.8], radius: 0.26, cycle: { on: 1.2, off: 3.0, warn: 0.5, phase: 0.62 }, color: HOT },
    { kind: 'vanish', p: [173.4, 17.4, 1.0], s: [2.8, 1, 2.6], mat: 'stone', cycle: { on: 2.0, off: 1.8, warn: 0.5, phase: 0.63 } }, // top 17.9 — DOWN 1.2, gap 2.10 (43%)
    { kind: 'vanish', p: [179.6, 18.0, 4.4], s: [3.2, 1, 2.8], mat: 'stone', cycle: { on: 2.6, off: 1.4, warn: 0.6, phase: 0.85 } }, // top 18.5, diag 3.28 at +0.6 (81%)

    { kind: 'platform', p: [187.4, 18.6, 1.6], s: [6.4, 1, 8.0], mat: 'stone', glow: DUSK, stripe: true }, // CP4, top 19.1, gap 3.00 at +0.6 (74%)

    { kind: 'text', p: [148.8, 19.6, 1.2], rot: [0, -Math.PI / 2, 0], text: 'THE STEPS ARE OLD', size: 0.46, color: GOLD },
    { kind: 'text', p: [148.8, 19.05, 1.2], rot: [0, -Math.PI / 2, 0], text: 'one of them held  ·  one of them falls', size: 0.24, color: MINT },
    { kind: 'deco', kindOf: 'grate', p: [160.2, 24.6, 3.4], s: [2.2, 0.2, 2.2], mat: 'grate', tint: DUSK }, // the crack each shaft falls through
    { kind: 'deco', kindOf: 'grate', p: [171.0, 25.0, 0.8], s: [2.2, 0.2, 2.2], mat: 'grate', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [154.0, 8.0, 7.8], s: [2.2, 18.0, 2.2], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [166.0, 8.0, 8.2], s: [2.2, 18.4, 2.2], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [178.0, 8.0, 8.6], s: [2.2, 19.0, 2.2], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [187.4, 23.4, 5.2], s: [1.4, 8.0, 1.4], mat: 'stone' },
    { kind: 'deco', kindOf: 'pillar', p: [187.4, 23.4, -2.0], s: [1.4, 8.0, 1.4], mat: 'stone' },
    { kind: 'light', p: [160.2, 22.2, 3.4], color: HOT, intensity: 7, distance: 16, flicker: 0.14 },
    { kind: 'light', p: [171.0, 22.6, 0.8], color: HOT, intensity: 7, distance: 16, flicker: 0.14 },
    { kind: 'light', p: [157.0, 21.4, 2.4], color: 0xffe6bf, intensity: 9, distance: 24 },
    { kind: 'light', p: [168.2, 21.8, 4.2], color: MINT, intensity: 8, distance: 20 },
    { kind: 'light', p: [187.4, 22.2, 1.6], color: MINT, intensity: 9, distance: 22 },

    /* ============================================================================ */
    /* THE SHADOW GALLERY — the hidden path.                                        */
    /* There is no glowing panel here and no beacon. The way in is a hole in the     */
    /* SHADOW under the south lip of the CP3 landing, and you find it by jumping the */
    /* wrong way: 3.40 m due south and 1.5 m DOWN, off the back of a checkpoint,     */
    /* into a niche that the buttress at z -6.2 hides from the landing completely.   */
    /*                                                                              */
    /* Every light on this route is intensity 4 at distance 12 in DUSK. The main     */
    /* line runs 8 to 12 in GOLD and MINT. Standing on the main line, the gallery is */
    /* the darkest thing in view, which is the only reason it stays hidden — the     */
    /* previous revision lit its entrance with an emissive panel and an intensity-14 */
    /* lamp in direct line of sight of the checkpoint, and called it unsignposted.   */
    /*                                                                              */
    /* Longest jump 2.90 m at +0.4 (70%); riskiest 2.42 m at -0.4 (53%) with nothing */
    /* whatsoever underneath it. It skips all five treads and both sun-shafts.       */
    /* ============================================================================ */

    { kind: 'platform', p: [146.8, 15.4, -7.4], s: [3.2, 1, 3.2], mat: 'obsidian', glow: DUSK, stripe: true }, // the niche — 3.40 m at -1.5 (68%)
    { kind: 'platform', p: [152.8, 15.8, -10.6], s: [3.0, 1, 3.0], mat: 'obsidian', glow: DUSK, stripe: true }, // gap 2.90 at +0.4 (70%)

    { kind: 'beam', p: [163.4, 16.05, -10.6], s: [13.6, 0.5, 1.2], mat: 'stone' }, // the gallery ledge — COIN 2 mid-span, gap 2.30 flat (53%)

    { kind: 'platform', p: [173.8, 16.6, -12.4], s: [3.0, 1, 3.2], mat: 'obsidian', glow: DUSK, stripe: true }, // gap 2.10 at +0.8 (53%)
    { kind: 'platform', p: [178.4, 16.2, -16.2], s: [2.0, 1, 2.0], mat: 'obsidian', glow: DUSK, stripe: true }, // COIN 3 spur — 2.42 m at -0.4 (53%) out, 2.42 at +0.4 (58%) back
    { kind: 'platform', p: [179.6, 17.6, -8.4], s: [3.4, 1, 3.6], mat: 'obsidian', glow: DUSK, stripe: true }, // gap 2.67 at +1.0 (70%)
    { kind: 'platform', p: [183.8, 18.0, -4.8], s: [3.0, 1, 3.2], mat: 'obsidian', glow: DUSK, stripe: true }, // gap 1.02 at +0.4 (25%), then 0.80 onto CP4 (20%)

    { kind: 'light', p: [152.8, 17.6, -10.6], color: DUSK, intensity: 4, distance: 12 },
    { kind: 'light', p: [168.0, 17.8, -10.6], color: DUSK, intensity: 4, distance: 12 },
    { kind: 'light', p: [178.4, 18.0, -16.2], color: DUSK, intensity: 4, distance: 12 },
    { kind: 'deco', kindOf: 'buttress', p: [147.8, 8.0, -6.2], s: [2.6, 16.0, 2.6], mat: 'stone', tint: DUSK }, // this is what hides the way in
    { kind: 'deco', kindOf: 'buttress', p: [160.0, 7.0, -14.2], s: [2.4, 16.0, 2.4], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [174.0, 7.0, -15.8], s: [2.4, 16.0, 2.4], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'arch', p: [163.4, 19.0, -10.6], s: [1.2, 0.9, 5.0], mat: 'stone', tint: DUSK },

    /* ============================================================================ */
    /* BEAT 6 — THE MILL                                                            */
    /* Three windmills on axis [0,0,1], so the blades come DOWN across the walkway   */
    /* instead of round it. One mill per plank, because two co-planar windmills of    */
    /* this size on one plank would sweep through each other.                        */
    /*                                                                              */
    /* THE PLANKS ARE 2.0 m WIDE, AND THAT IS ARITHMETIC. A windmill's kill capsule  */
    /* has radius max(thick, rootC*0.30) about the rotation plane — 0.42 / 0.46 /     */
    /* 0.40 m here — and the player is a 0.35 m radius cylinder, so the three mills   */
    /* own bands of z 1.54 / 1.62 / 1.50 m wide. A 2.0 m plank leaves 1.30 m of       */
    /* standable centres. 1.30 is inside all three: there is no lane on any plank.    */
    /* The previous revision used a 3.8 m plank, left                                 */
    /* 1.2 m of clear air on EACH side of the sweep, and put its own deco rails on    */
    /* both of them — the stage's named centrepiece could be walked round without     */
    /* ever looking up.                                                              */
    /*                                                                              */
    /* AND YOU CANNOT DUCK OR JUMP IT EITHER, WHICH IS ALSO ARITHMETIC. Real blade    */
    /* reach is innerR + len + killR = 0.378 + 4.6 + 0.42 = 5.398 m, not `len`. Mill  */
    /* one hangs at 22.75 over a deck at 17.20, so its lowest lethal point is 17.352  */
    /* — fifteen centimetres over the plank. Crouched you are 1.05 m tall and still   */
    /* inside it; jumping only puts you further inside it. The previous revision      */
    /* claimed "a blade takes your shins and a jump clears it", was out by the innerR */
    /* term and the kill radius, and actually swept half a metre INTO its own deck.   */
    /* The answer here is horizontal timing and nothing else: you wait on the near    */
    /* side, you watch the gap come down, and you run through behind it.              */
    /*                                                                              */
    /* Tempos: 3 arms on 6.4 s (a blade every 2.13 s), 2 on 5.2 (2.60 s), 4 on 8.4    */
    /* (2.10 s). No two share a factor. `mount: 0` on all three: a windmill's default */
    /* mount is a 1.9 m strut hanging BELOW the hub, which on these decks would put a */
    /* solid pole about a hand's width over a standing player's head.                 */
    /*                                                                              */
    /* Every mill also has to CLEAR THE PIERS, which is the check a 5 m sweep radius */
    /* makes easy to forget — a mill that is fair over its own plank can still be an  */
    /* invisible kill sphere over the stone you wait on. Measured against a standing  */
    /* 1.8 m player, nearest point to nearest point: mill 1 stops 1.09 m short of     */
    /* pier A and 1.51 m short of the CP4 landing, mill 2 stops 1.20 m short of pier  */
    /* A and 0.78 m short of pier B, mill 3 stops 0.55 m short of pier B and 0.92 m   */
    /* short of the flat mill's floor. Only its own plank is ever inside a sweep.     */
    /*                                                                              */
    /* And the walk is not flat: 17.2 -> 18.6 -> 17.4 -> 19.0 -> 17.8 -> 18.4 in      */
    /* 45 metres. The previous revision ran 53 m at exactly 15.80 throughout.         */
    /*                                                                              */
    /* Then the same machine laid flat: one LETHAL bar on a vertical axis sweeping a  */
    /* 9.5 m disc at 4.2 s, its underside 0.8 m over the floor. Same reading problem, */
    /* rotated ninety degrees, and this time the answer IS a jump — you need 1.06 m   */
    /* of rise against a standing apex of 2.09 (its underside runs 0.54 m over the    */
    /* deck and its kill capsule tops out at 19.46). CP5 sits on the west strip of     */
    /* that floor, 0.59 m outside the sweep, so respawning is never instant death.     */
    /* ============================================================================ */

    { kind: 'platform', p: [197.6, 16.7, 0.6], s: [8.0, 1, 2.0], mat: 'stone', glow: GOLD, stripe: true }, // plank 1, top 17.2, gap 3.00 at -1.9 (59%)
    { kind: 'rotor', p: [197.6, 22.75, 0.6], style: 'windmill', arms: 3, len: 4.6, thick: 0.42, period: 6.4, phase: 0, axis: [0, 0, 1], mount: 0 },

    { kind: 'platform', p: [205.6, 18.1, 0.6], s: [3.2, 1, 3.0], mat: 'stone', glow: GOLD, stripe: true }, // pier A, top 18.6, gap 2.40 at +1.4 (68%)

    { kind: 'platform', p: [213.4, 16.9, 0.6], s: [7.6, 1, 2.0], mat: 'stone', glow: GOLD, stripe: true }, // plank 2, top 17.4, gap 2.40 at -1.2 (49%)
    { kind: 'rotor', p: [213.4, 22.67, 0.6], style: 'windmill', arms: 2, len: 4.2, thick: 0.46, period: 5.2, phase: 0.35, axis: [0, 0, 1], mount: 0 },

    { kind: 'platform', p: [221.0, 18.5, 0.6], s: [3.4, 1, 3.0], mat: 'stone', glow: GOLD, stripe: true }, // pier B, top 19.0, gap 2.10 at +1.6 (63%)

    { kind: 'platform', p: [228.6, 17.3, 0.6], s: [7.2, 1, 2.0], mat: 'stone', glow: GOLD, stripe: true }, // plank 3, top 17.8, gap 2.30 at -1.2 (47%)
    { kind: 'rotor', p: [228.6, 23.58, 0.6], style: 'windmill', arms: 4, len: 4.9, thick: 0.40, period: 8.4, phase: 0.6, axis: [0, 0, 1], mount: 0 },

    { kind: 'platform', p: [240.4, 17.9, 0.6], s: [11.6, 1, 9.6], mat: 'stone', glow: DUSK, stripe: true }, // the flat mill's floor + CP5, top 18.4, gap 2.80 at +0.6 (69%)
    { kind: 'rotor', p: [241.4, 19.2, 0.6], style: 'bar', arms: 2, len: 4.2, thick: 0.44, period: 4.2, phase: 0.25, axis: [0, 1, 0], kill: 'spike' },

    { kind: 'text', p: [190.6, 21.4, -2.6], rot: [0, -Math.PI / 2, 0], text: 'THE MILL', size: 0.58, color: GOLD },
    { kind: 'text', p: [190.6, 20.8, -2.6], rot: [0, -Math.PI / 2, 0], text: 'no lane  ·  no duck  ·  wait for the gap', size: 0.24, color: EDGE },
    { kind: 'text', p: [235.6, 21.6, 4.6], rot: [0, -Math.PI / 2, 0], text: 'this one you jump', size: 0.28, color: GOLD },
    { kind: 'deco', kindOf: 'buttress', p: [197.6, 8.0, 8.8], s: [2.4, 18.0, 2.4], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [197.6, 8.0, -7.6], s: [2.4, 18.0, 2.4], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [213.4, 8.0, 8.8], s: [2.4, 19.0, 2.4], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [213.4, 8.0, -7.6], s: [2.4, 19.0, 2.4], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [228.6, 8.0, 8.8], s: [2.4, 19.4, 2.4], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [228.6, 8.0, -7.6], s: [2.4, 19.4, 2.4], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [197.6, 22.75, 3.6], s: [1.1, 1.1, 3.4], mat: 'metal', tint: DUSK }, // the axle housings the mills turn in
    { kind: 'deco', kindOf: 'pillar', p: [213.4, 22.67, -2.4], s: [1.1, 1.1, 3.4], mat: 'metal', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [228.6, 23.58, 3.6], s: [1.1, 1.1, 3.4], mat: 'metal', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [240.4, 9.0, 0.6], s: [3.0, 16.0, 3.0], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'ring', p: [241.4, 24.0, 0.6], s: [10.0, 0.24, 10.0], mat: 'emissive', tint: GOLD },
    { kind: 'light', p: [197.6, 20.0, 0.6], color: HOT, intensity: 11, distance: 26, flicker: 0.08 },
    { kind: 'light', p: [213.4, 20.2, 0.6], color: HOT, intensity: 11, distance: 26, flicker: 0.08 },
    { kind: 'light', p: [228.6, 20.6, 0.6], color: HOT, intensity: 11, distance: 26, flicker: 0.08 },
    { kind: 'light', p: [205, 21.6, 0.6], color: GOLD, intensity: 8, distance: 24 },
    { kind: 'light', p: [235.6, 21.0, 0.6], color: MINT, intensity: 9, distance: 20 },
    { kind: 'light', p: [243.0, 21.4, 0.6], color: GOLD, intensity: 12, distance: 24 },

    /* ============================================================================ */
    /* BEAT 7 — THE ANTECHAMBER                                                     */
    /* An actual breather this time. The gate stone is a crusher on a 5.4 s cycle    */
    /* with a 1.9 s dwell: dwellFrac = 1.9/5.4 = 0.352, which leaves a 0.32 s slam,  */
    /* a 1.9 s raised dwell and a 1.28 s return, so the doorway stands open about    */
    /* 2.3 s in every 5.4 and 1.9 s of that is dead still. The previous revision ran */
    /* 0.7 s of dwell on 4.6 s — roughly 1.4 s of window — and then asked for a      */
    /* 3.9 m jump off it at 90% of the flat budget. The exit here is 2.70 m at -0.3, */
    /* which is 60%.                                                                */
    /*                                                                              */
    /* COIN 4 hangs off a spur 3.20 m south with a censer swinging over the gap.     */
    /* Read TRAP 2 in the header before touching its `blade`: `d` is THICKNESS, and  */
    /* thickness is what sets the kill radius. At {w:2.4, h:1.3, d:0.30} the capsules */
    /* are 0.51 and 0.39 m — the thing kills you where it looks like it kills you.   */
    /* It hangs at z -5.2, dead centre of the 3.2 m gap, and swings +/- 1.65 m, so   */
    /* it never passes over either deck: its lowest LETHAL point (blade centre 18.72  */
    /* minus the 0.39 m capsule) is 18.33, which is 0.43 m above the antechamber      */
    /* floor and 0.43 m above the spur. Standing at either lip                        */
    /* at the top of its swing will still take your head off, and all of that is     */
    /* visible: a 2.4 m stone blade on a chain in an empty doorway. The old censer   */
    /* was a 9.5 m invisible kill sphere over the breather deck.                     */
    /* ============================================================================ */

    { kind: 'crusher', p: [251.2, 17.4, 0.6], s: [3.4, 1.6, 4.8], axis: 'y', travel: 3.0, period: 5.4, phase: 0.15, dwell: 1.9 }, // the gate stone, home top 18.2, gap 3.30 at -0.2 (74%)

    { kind: 'platform', p: [258.8, 17.4, 0.6], s: [6.4, 1, 8.0], mat: 'stone', glow: DUSK, stripe: true }, // the antechamber, top 17.9, gap 2.70 at -0.3 (60%)
    { kind: 'platform', p: [258.8, 17.4, -7.8], s: [2.4, 1, 2.4], mat: 'obsidian', glow: HOT, stripe: true }, // COIN 4 spur, 3.20 m south, flat (74%)

    { kind: 'pendulum', p: [258.8, 22.8, -5.2], len: 3.4, ampDeg: 29, period: 3.0, phase: 0, blade: { w: 2.4, h: 1.3, d: 0.30 }, axis: [1, 0, 0] },

    { kind: 'platform', p: [266.2, 17.4, 0.6], s: [4.8, 1, 5.6], mat: 'stone', glow: MINT, stripe: true }, // CP6 — the shaft lip, top 17.9, gap 1.80 flat (41%)

    { kind: 'text', p: [246.0, 21.0, 4.2], rot: [0, -Math.PI / 2, 0], text: 'WAIT FOR IT', size: 0.44, color: GOLD },
    { kind: 'text', p: [246.0, 20.45, 4.2], rot: [0, -Math.PI / 2, 0], text: 'it stands open longer than it stands shut', size: 0.22, color: EDGE },
    { kind: 'text', p: [263.4, 20.6, 0.6], rot: [0, -Math.PI / 2, 0], text: 'DOWN', size: 0.72, color: HOT },
    { kind: 'text', p: [263.4, 20.0, 0.6], rot: [0, -Math.PI / 2, 0], text: 'through the gaps, not over them', size: 0.24, color: EDGE },
    { kind: 'deco', kindOf: 'arch', p: [251.2, 22.2, 0.6], s: [1.4, 1.2, 7.4], mat: 'obsidian', tint: GOLD }, // the lintel the gate stone closes against
    { kind: 'deco', kindOf: 'pillar', p: [251.2, 19.8, 3.8], s: [1.2, 5.0, 1.2], mat: 'stone' },
    { kind: 'deco', kindOf: 'pillar', p: [251.2, 19.8, -2.6], s: [1.2, 5.0, 1.2], mat: 'stone' },
    { kind: 'deco', kindOf: 'arch', p: [258.8, 23.4, -5.2], s: [1.0, 0.9, 5.6], mat: 'obsidian', tint: DUSK }, // the beam the censer hangs from
    { kind: 'deco', kindOf: 'statue', p: [258.8, 20.1, 3.6], s: [1.2, 4.4, 1.2], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'ring', p: [258.8, 19.1, -7.8], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: HOT },
    { kind: 'light', p: [254.0, 21.0, 0.6], color: GOLD, intensity: 10, distance: 22 },
    { kind: 'light', p: [258.8, 19.6, -7.8], color: HOT, intensity: 7, distance: 15 },
    { kind: 'light', p: [266.2, 21.4, 0.6], color: MINT, intensity: 10, distance: 22 },

    /* ============================================================================ */
    /* BEAT 8 — SET-PIECE : INSIDE THE COLUMN                                       */
    /*                                                                              */
    /* PART ONE — THE WELL. Three leaps down the inside of the drum, and they are    */
    /* three DIFFERENT leaps, which is the entire point:                            */
    /*     4.70 m out, 4.2 m down, onto a 4.6 x 4.6 shelf   (81% of its own budget)  */
    /*     4.31 m out, 3.3 m down, onto a 3.4 x 3.4 shelf   (78%)                    */
    /*     4.75 m out, 5.8 m down, onto a 3.8 x 2.6 shelf   (76%)                    */
    /* The drop grows, the shelf shrinks, and the wheel you leave through changes    */
    /* every time: 3 blades on 5.4 s (a gap every 1.80 s), 5 on 9.5 (1.90 s), 4 on   */
    /* 8.8 (2.20 s), on radii of 5.20 / 5.77 / 5.96 m — and the last one is set      */
    /* CROOKED, axis [1, 0, 0.16], so its plane is canted and its gap arrives at an  */
    /* angle. The previous revision's three leaps were 4.00 / 4.39 / 4.24 m onto     */
    /* three identical 4.2 m squares through rings whose only difference was a spoke */
    /* count: the player felt the same jump three times and the header called that a */
    /* heartbeat.                                                                    */
    /*                                                                              */
    /* WHY THEY ARE WINDMILLS AND WHY EVERY ONE SAYS `mount: 0` — see TRAP 4. A bar  */
    /* rotor is SOLID and, unkilled, only pushes; the old file hung four of them in  */
    /* this well with their sweeps 0.87 / 0.44 / 0.47 m over the shelves, so tapping */
    /* jump while standing still shoved you off a 4 m ledge into a bottomless drum.  */
    /* A windmill contributes no moving solids at all and `mount: 0` removes even    */
    /* the pedestal, so these three are pure lethal geometry: nothing in the well    */
    /* can push anybody anywhere. They also hang in the AIR BETWEEN the shelves —    */
    /* the widest occupies x 286.66 .. 288.54 against a shelf ending at 285.3 and    */
    /* the next starting at 290.05 — so no wheel is ever over a surface you stand on. */
    /*                                                                              */
    /* Each wheel's disc is wider than the corridor it gates (5.20 m radius against  */
    /* a 4.70 m crossing, 5.77 against 4.31, 5.96 against 4.75), so unlike the old   */
    /* mill there is no lane around the outside of one.                              */
    /*                                                                              */
    /* LIGHTING. Every shelf gets a lamp 2.7 m ABOVE its deck — that is the one that */
    /* makes it read as a bright shelf on a dark wall before you commit — plus a     */
    /* dimmer rim light beneath for the silhouette. The old file had only the lamps  */
    /* underneath, so the first leap, the committed one straight off the checkpoint,  */
    /* was into an unlit hole.                                                       */
    /*                                                                              */
    /* PART TWO — THE CLIMB OUT. The drum floor sits at 2.4, three and a half metres */
    /* BELOW where the stage started, and the summit terrace is at 19.9. There is no */
    /* lift and no wind. The previous climax was an 18 m elevator ride inside a       */
    /* 9 m/s^2 crosswind — one strafe key held for 5.6 seconds — with a jump pad      */
    /* beside it as the alternative, so the finale was "hold A" or "touch pad". This  */
    /* is TEN jumps up the inside of the breach, rising +1.8 / +1.7 / +1.6 / +1.4 /   */
    /* +1.8 / +1.8 / +1.8 / +1.8 / +1.8 / +2.0 against a standing apex of 2.09 — the  */
    /* last one is 96% of the height you have. Two shelves vanish and one is a        */
    /* shuttle, so three of the ten are timed as well as aimed.                       */
    /*                                                                              */
    /* THE VENT is a shortcut and its sign is TRUE. It sits on the floor at x 307.2   */
    /* and throws a 9.0 m apex. The balcony's near lip is 5.05 m out and its far lip  */
    /* 15.05 m out; a 9.0 m bounce carries between 5.89 m (walked on) and 13.93 m     */
    /* (sprinted on, jump held), so the WHOLE entry-speed band lands on the deck —    */
    /* which is the test reachcheck actually runs on a pad, and the reason the        */
    /* balcony is 10 m long rather than a ledge. The balcony is 4.6 m above the pad   */
    /* and directly ahead of it in open view the whole way. It skips two hops. The    */
    /* old vent fired you 18 m up at a terrace hidden behind its own underside and    */
    /* warned you not to walk onto it, which was the one thing that worked fine.      */
    /* ============================================================================ */

    { kind: 'rotor', p: [271.2, 15.6, 1.6], style: 'windmill', arms: 3, len: 4.4, thick: 0.42, period: 5.4, phase: 0, axis: [1, 0, 0], mount: 0 },
    { kind: 'platform', p: [275.6, 13.2, 3.6], s: [4.6, 1, 4.6], mat: 'stone', glow: GOLD, stripe: true }, // shelf 1 — 4.70 m out, 4.2 m down, top 13.7

    { kind: 'rotor', p: [280.1, 12.0, 0.8], style: 'windmill', arms: 5, len: 4.9, thick: 0.46, period: 9.5, phase: 0.35, axis: [1, 0, 0], mount: 0 },
    { kind: 'platform', p: [283.6, 9.9, -2.0], s: [3.4, 1, 3.4], mat: 'stone', glow: GOLD, stripe: true }, // shelf 2 — 4.31 m out, 3.3 m down, top 10.4

    { kind: 'rotor', p: [287.6, 8.4, -2.6], style: 'windmill', arms: 4, len: 5.2, thick: 0.40, period: 8.8, phase: 0.2, axis: [1, 0, 0.16], mount: 0 },
    { kind: 'platform', p: [291.95, 4.1, -4.2], s: [3.8, 1, 2.6], mat: 'stone', glow: GOLD, stripe: true }, // shelf 3 — 4.75 m out, 5.8 m down, top 4.6

    { kind: 'platform', p: [303.0, 1.9, 0.6], s: [11.0, 1, 11.0], mat: 'stone', glow: DUSK, stripe: true }, // CP7 — the drum floor, top 2.4, gap 3.65 at -2.2 (70%)
    { kind: 'spikes', p: [297.0, 2.7, 4.4], s: [2.6, 0.6, 2.6], dir: [0, 1, 0] }, // shards of the drum that came down before you did
    { kind: 'spikes', p: [304.0, 2.7, -3.4], s: [2.4, 0.6, 2.4], dir: [0, 1, 0] },
    { kind: 'spikes', p: [299.2, 2.7, -3.8], s: [2.0, 0.6, 2.0], dir: [0, 1, 0] },

    { kind: 'jumppad', p: [307.2, 2.65, 0.6], s: [2.6, 0.5, 2.6], power: 9.0, dir: [0, 1, 0] }, // THE VENT — 9 m apex onto the balcony

    { kind: 'platform', p: [311.4, 3.7, 5.0], s: [3.2, 1, 3.4], mat: 'stone', glow: GOLD, stripe: true }, // C1, top 4.2, gap 1.30 at +1.8 (42%)
    { kind: 'vanish', p: [316.8, 5.4, 5.6], s: [3.0, 1, 3.2], mat: 'stone', cycle: { on: 2.6, off: 1.4, warn: 0.6, phase: 0.0 } }, // C2 — COIN 5, top 5.9, gap 2.30 at +1.7 (71%)
    { kind: 'platform', p: [315.6, 7.0, 0.6], s: [10.0, 1, 3.2], mat: 'stone', glow: GOLD, stripe: true }, // C3 — THE BALCONY, top 7.5, 1.80 at +1.6 off C2 (54%), or the vent
    {
      kind: 'mover',
      p: [324.6, 8.4, -1.6],
      s: [3.0, 1, 3.0],
      mat: 'stone',
      motion: { type: 'linear', to: [324.6, 8.4, 4.4], period: 4.4, ease: 'sine' },
    }, // C4 — a 6 m z-shuttle on a 4.4 s round trip, top 8.9, gap 2.50 at +1.4 (71%)
    { kind: 'platform', p: [329.4, 10.2, -4.0], s: [3.2, 1, 3.2], mat: 'stone', glow: GOLD, stripe: true }, // C5, top 10.7, gap 1.70 at +1.8 (55%)
    { kind: 'platform', p: [333.8, 12.0, 0.0], s: [3.4, 1, 3.4], mat: 'stone', glow: MINT, stripe: true }, // C6 + CP8, top 12.5, diag 1.30 at +1.8 (42%)
    { kind: 'vanish', p: [338.2, 13.8, 4.4], s: [2.8, 1, 3.0], mat: 'stone', cycle: { on: 2.2, off: 1.5, warn: 0.5, phase: 0.30 } }, // C7, top 14.3, diag 1.77 at +1.8 (57%)
    { kind: 'platform', p: [342.6, 15.6, 0.8], s: [3.2, 1, 3.4], mat: 'stone', glow: GOLD, stripe: true }, // C8, top 16.1, diag 1.46 at +1.8 (47%)
    { kind: 'platform', p: [347.0, 17.4, -3.6], s: [3.0, 1, 3.2], mat: 'stone', glow: GOLD, stripe: true }, // C9, top 17.9, diag 1.70 at +1.8 (55%)
    { kind: 'platform', p: [355.5, 19.4, 0.6], s: [10.0, 1, 13.0], mat: 'obsidian', glow: GOLD, stripe: true }, // the summit terrace, top 19.9, gap 2.00 at +2.0 (72%)

    { kind: 'text', p: [304.8, 5.4, 0.6], rot: [0, -Math.PI / 2, 0], text: 'IT BREATHES OUT', size: 0.36, color: HOT },
    { kind: 'text', p: [304.8, 4.9, 0.6], rot: [0, -Math.PI / 2, 0], text: 'walk on or run on  ·  it lands you on the balcony', size: 0.22, color: EDGE },
    { kind: 'text', p: [309.2, 7.8, 6.0], rot: [0, -Math.PI / 2, 0], text: 'or climb it', size: 0.28, color: GOLD },
    { kind: 'text', p: [297.0, 6.6, -6.4], rot: [0, -Math.PI / 2, 0], text: 'THE FLOOR OF THE COLUMN', size: 0.34, color: GOLD },

    // Shaft lighting. The lamp ABOVE the shelf is the one that makes it readable
    // before you commit; the rim light beneath is only there for the silhouette.
    { kind: 'light', p: [275.6, 16.4, 3.6], color: GOLD, intensity: 12, distance: 20 },
    { kind: 'light', p: [275.6, 12.6, 3.6], color: 0xffe6bf, intensity: 5, distance: 10 },
    { kind: 'light', p: [283.6, 13.1, -2.0], color: GOLD, intensity: 12, distance: 20 },
    { kind: 'light', p: [283.6, 9.3, -2.0], color: 0xffe6bf, intensity: 5, distance: 10 },
    { kind: 'light', p: [291.95, 7.3, -4.2], color: GOLD, intensity: 12, distance: 20 },
    { kind: 'light', p: [291.95, 3.5, -4.2], color: 0xffe6bf, intensity: 5, distance: 10 },
    { kind: 'light', p: [303.0, 5.6, 0.6], color: 0xffe6bf, intensity: 12, distance: 26 },
    { kind: 'light', p: [311.4, 6.4, 5.0], color: GOLD, intensity: 9, distance: 18 },
    { kind: 'light', p: [315.6, 10.2, 0.6], color: GOLD, intensity: 10, distance: 22 },
    { kind: 'light', p: [329.4, 12.9, -4.0], color: GOLD, intensity: 9, distance: 18 },
    { kind: 'light', p: [333.8, 15.2, 0.0], color: MINT, intensity: 10, distance: 22 },
    { kind: 'light', p: [342.6, 18.3, 0.8], color: GOLD, intensity: 9, distance: 18 },
    { kind: 'light', p: [347.0, 20.6, -3.6], color: GOLD, intensity: 9, distance: 20 },

    /* ============================================================================ */
    /* THE DRUM ITSELF — the thing the stage is named after.                        */
    /* The previous revision was rejected for selling a column it never built: 286 m */
    /* of monotone +X with z pinned between -2 and +4, four pillars and one ring for */
    /* the whole interior. This file carries 110 deco pieces against temple-3's 107  */
    /* and temple-1's 53. The drum is fourteen 40 m staves on an                     */
    /* ellipse of semi-axes 32 m (along the run) and 13.5 m (across it) centred on   */
    /* x 287 — the exact middle of the descent — with a broken rim 24 m overhead and */
    /* a grate floor 6 m under the drum floor. Both ENDS of the ellipse are missing, */
    /* because both ends are the breaches: the one you drop in through at x 266 and  */
    /* the one you climb out of past x 320. You land in the middle of it and the     */
    /* wall curves away from you on both sides.                                      */
    /*                                                                              */
    /* Nothing here is landable and nothing is in a play corridor: the nearest stave */
    /* stands 5.0 m clear of the widest shelf in the well and 2.0 m clear of the     */
    /* first shelf of the climb.                                                    */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'pillar', p: [309.63, 9.0, 10.15], s: [2.8, 40.0, 2.8], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [303.0, 9.0, 12.29], s: [2.8, 40.0, 2.8], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [295.28, 9.0, 13.64], s: [2.8, 40.0, 2.8], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [287.0, 9.0, 14.1], s: [3.0, 40.0, 3.0], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [278.72, 9.0, 13.64], s: [2.8, 40.0, 2.8], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [271.0, 9.0, 12.29], s: [2.8, 40.0, 2.8], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [264.37, 9.0, 10.15], s: [2.8, 40.0, 2.8], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [309.63, 9.0, -8.95], s: [2.8, 40.0, 2.8], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [303.0, 9.0, -11.09], s: [2.8, 40.0, 2.8], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [295.28, 9.0, -12.44], s: [2.8, 40.0, 2.8], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [287.0, 9.0, -12.9], s: [3.0, 40.0, 3.0], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [278.72, 9.0, -12.44], s: [2.8, 40.0, 2.8], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [271.0, 9.0, -11.09], s: [2.8, 40.0, 2.8], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [264.37, 9.0, -8.95], s: [2.8, 40.0, 2.8], mat: 'stone', tint: DUSK },

    { kind: 'deco', kindOf: 'ring', p: [287.0, 26.0, 0.6], s: [68.0, 0.9, 30.0], mat: 'stone', tint: DUSK }, // the broken rim, far overhead
    { kind: 'deco', kindOf: 'ring', p: [287.0, 22.4, 0.6], s: [64.0, 0.5, 27.0], mat: 'stone', tint: 0x8d7350 },
    { kind: 'deco', kindOf: 'arch', p: [287.0, 24.6, 0.6], s: [1.6, 1.4, 26.0], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'grate', p: [289.0, -4.4, 0.6], s: [56.0, 0.4, 24.0], mat: 'grate', tint: DUSK },
    { kind: 'deco', kindOf: 'banner', p: [271.0, 14.0, 11.4], s: [0.12, 8.0, 2.4], mat: 'panel', tint: GOLD },
    { kind: 'deco', kindOf: 'banner', p: [295.28, 14.0, -11.6], s: [0.12, 8.0, 2.4], mat: 'panel', tint: GOLD },

    // The inside face of the breach, behind the climb.
    { kind: 'deco', kindOf: 'buttress', p: [322.0, 12.0, 9.6], s: [2.6, 24.0, 2.6], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [332.0, 14.0, -9.0], s: [2.6, 26.0, 2.6], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [342.0, 16.0, 9.2], s: [2.6, 28.0, 2.6], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'buttress', p: [350.0, 17.0, -8.6], s: [2.6, 30.0, 2.6], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'banner', p: [315.6, 11.0, 6.8], s: [0.12, 4.0, 2.0], mat: 'panel', tint: GOLD },
    { kind: 'deco', kindOf: 'banner', p: [338.2, 17.8, 6.8], s: [0.12, 4.0, 2.0], mat: 'panel', tint: GOLD },
    { kind: 'deco', kindOf: 'lantern', p: [324.6, 13.6, 6.6], s: [0.7, 1.1, 0.7], mat: 'emissive', tint: GOLD },
    { kind: 'deco', kindOf: 'lantern', p: [333.8, 15.6, -5.6], s: [0.7, 1.1, 0.7], mat: 'emissive', tint: GOLD },

    // The finish gate, framed so the last hop lands straight into it.
    { kind: 'deco', kindOf: 'arch', p: [355.5, 25.4, 0.6], s: [1.4, 1.2, 11.0], mat: 'obsidian', tint: VIOLET },
    { kind: 'deco', kindOf: 'pillar', p: [355.5, 22.8, 5.2], s: [1.4, 5.6, 1.4], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [355.5, 22.8, -4.0], s: [1.4, 5.6, 1.4], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'beacon', p: [359.2, 22.2, 0.6], s: [0.7, 3.0, 0.7], mat: 'emissive', tint: VIOLET },
    { kind: 'text', p: [352.4, 22.0, 0.6], rot: [0, -Math.PI / 2, 0], text: 'THE HOLLOW COLUMN', size: 0.42, color: VIOLET },
    { kind: 'light', p: [355.5, 23.4, 0.6], color: VIOLET, intensity: 20, distance: 34 },

    /* ============================================================================ */
    /* THE TEMPLE — everything that is not the course.                              */
    /* All of it is at |z| >= 26, or below y = -8, or above y = 28: outside every    */
    /* play corridor on the stage, including the shadow gallery's, which reaches     */
    /* z = -17.2, and the drum's, which reaches z = +15.5.                          */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'monolith', p: [60, -6, 32], s: [8, 30, 8], count: 8, spread: [150, 18, 20], seed: 4411, tint: DUSK },
    { kind: 'deco', kindOf: 'monolith', p: [60, -8, -34], s: [8, 30, 8], count: 8, spread: [150, 18, 20], seed: 5522, tint: DUSK },
    { kind: 'deco', kindOf: 'monolith', p: [230, -4, 38], s: [10, 40, 10], count: 7, spread: [200, 22, 22], seed: 6633, tint: 0x8d7350 },
    { kind: 'deco', kindOf: 'monolith', p: [230, -6, -38], s: [10, 40, 10], count: 7, spread: [200, 22, 22], seed: 7744, tint: 0x8d7350 },
    { kind: 'deco', kindOf: 'arch', p: [120, 30.0, 28], s: [1.6, 1.4, 16.0], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'arch', p: [196, 32.0, -28], s: [1.6, 1.4, 16.0], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'arch', p: [330, 34.0, 30], s: [1.6, 1.4, 16.0], mat: 'stone', tint: DUSK },
    { kind: 'deco', kindOf: 'statue', p: [40, 20.0, -27], s: [3.0, 12.0, 3.0], mat: 'stone', tint: 0x8d7350 },
    { kind: 'deco', kindOf: 'statue', p: [178, 22.0, 29], s: [3.0, 12.0, 3.0], mat: 'stone', tint: 0x8d7350 },
    { kind: 'deco', kindOf: 'statue', p: [345, 24.0, -28], s: [3.0, 12.0, 3.0], mat: 'stone', tint: 0x8d7350 },
    { kind: 'deco', kindOf: 'cloud', p: [175, -16, 0], s: [26, 4, 26], count: 18, spread: [370, 10, 130], seed: 8855, scale: 2.2, tint: 0xffffff },
    { kind: 'deco', kindOf: 'cloud', p: [175, -24, 0], s: [30, 4, 30], count: 14, spread: [390, 8, 160], seed: 9966, scale: 2.6, tint: SKYB },
  ],
};
