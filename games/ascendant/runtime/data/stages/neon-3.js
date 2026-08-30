/**
 * ASCENDANT — NEON DOJO 3 : "OVERCLOCK"
 * runtime/data/stages/neon-3.js
 *
 * The finale of the dojo. A holographic test rig hung in the rain above the city:
 * magenta key light, cyan rim, wireframe architecture that is drawn rather than built,
 * and 286 m of nothing underneath it. neon-1 taught you where your feet go and neon-2
 * taught you when. This one asks for both at once and then turns the room on.
 *
 * SHAPE      287.3 m of travel, 66 gameplay objects, 5 checkpoints never more than
 *            60.8 m apart, 5 coins, and 28 dynamic hazards drawn from nine families
 *            (speedpad, laser, lasergrid, lasersweep, mover, vanish, rotor, pendulum,
 *            jumppad). Measured by `node _harness/reachcheck.mjs neon-3`, not counted
 *            by hand — and note that the harness's own hazard tally does not know
 *            about `lasergrid`/`lasersweep`, so the six racks and the two drum sweeps
 *            are real hazards it scores as zero.
 *
 * INTRODUCES three things, each in isolation before it is ever combined:
 *   SPEED PADS      BEAT 3  — a pad on a 16.6 m runway, then a gap you cannot walk.
 *   LASER CORRIDOR  BEAT 4  — one beam, a rolling rack, a duck rack, a fast pair.
 *   ROTOR + VANISH  BEAT 7  — mill blades sweeping the tiles you are standing on.
 * and then spends them: BEAT 5 rides a shuttle through a beam gate onto timed tiles,
 * BEAT 8 threads pendulums and a beam rack down a 3.4 m bridge, and BEAT 9 is THE DRUM.
 *
 * DETERMINISM: every timed object is phase-locked to the stage clock (CONTRACT §16).
 *
 * PHASE UNITS — FOUR HAZARD FAMILIES, THREE DIFFERENT UNITS. Read the factory, not
 * the neighbouring object:
 *   vanish    `cycle.phase`   FRACTION of one cycle, 0..1   (vanish.js: `fract(t/period + phase)`)
 *   mover     `motion.phase`  FRACTION of one cycle, 0..1   (movers.js: `fract(t/period + phase)`)
 *   rotor     `phase`         FRACTION of one revolution    (rotors.js: `theta = TAU*(t/period + phase)*dir`)
 *   pendulum  `phase`         RADIANS                       (pendulum.js: `arg = TAU*t/period + phase`)
 *   laser     `cycle.phase`   SECONDS, added to t           (lasers.js `cycleState`: shifted = t + phase)
 * Every phase below is written in the unit its own factory reads, and the pendulum ones
 * are written as expressions of Math.PI so the unit cannot be misread. Do NOT "tidy" the
 * vanish or rotor fractions into seconds — they wrap, and the drum falls apart.
 *
 * CONVENTIONS (full list in runtime/data/index.js):
 *   p = CENTRE, s = FULL size, top surface = p[1] + s[1]/2. Gaps in the comments are
 *   EDGE TO EDGE. rot/yaw in radians, yaw 0 faces +X. `stripe: true` = must jump to reach.
 *   A mover's `p` is its HOME pose, `motion.to` its far pose; both are landable.
 *
 * REACH BUDGET USED. The numbers below are the harness's MEASURED envelope from
 * runtime/core/tuning.js (apex 2.089 m, airtime 0.610 s), not the rounded table in
 * CONTRACT §0 — they are slightly tighter, and the tighter one is the one that binds:
 *
 *      run 8.6 m/s     flat 5.244 max / 4.352 SAFE      at +0.9 m  4.657 / 3.866
 *      sprint 12.2     flat 7.439 max / 6.174 SAFE      at -1.0 m  8.172 / 6.783
 *
 *   longest run-speed gap on the main line   3.90 m flat        (BEAT 9, off the drum)
 *   longest run-speed rise                   0.90 m over 2.00 m (BEAT 4, into CP2)
 *   sprint gap 1                             5.60 m flat  (BEAT 3, 16.6 m of runway + a pad)
 *   sprint gap 2                             5.70 m flat  (BEAT 3, 8.6 m of deck + a pad)
 *   sprint gap 3, the last jump in the world 6.80 m at -2.0 m
 *                                                        (BEAT 9, 9.2 m of runway + a pad)
 *   riskiest optional line                   5.55 m flat  (BEAT 9, the drum outrigger,
 *                                                          taken from the wrong panel)
 * Every jump on every route is a `run`, `sprint`, `walkoff`, `step` or `pad` edge inside
 * the safe envelope; the stage contains no run-tight or sprint-tight edge that a forward
 * route can use.
 *
 * HEIGHT LADDER: 0.5 (boot) -> 1.9 (the grid, the runway, corridor A) -> 2.35 (corridor B)
 *                -> 3.25 (the ride) -> 4.6 (gallery, cog, mills) -> 5.05 (the bridge)
 *                -> 5.95 (the drum) -> 3.95 (the finish: two metres BELOW the launch,
 *                so the last thing this world does is drop you into the gate).
 */

const CYAN = 0x7ef0ff; // rim light, safe edges, the path lights
const MAG = 0xff3df0; // the key light of this stage — holograms, gates, the drum
const HOT = 0xff2f5f; // lethal, and nothing else in this stage is this colour
const AMBER = 0xffb347; // vanish tiles and their warnings
const DIM = 0x2b6f9e; // structural stone, unlit deck
const DEEP = 0x142a44; // the city, thirty storeys down

export default {
  id: 'neon-3',
  world: 'neon',
  name: 'OVERCLOCK',
  subtitle: 'The dojo runs the whole program at once',
  par: 178000,
  difficulty: 5,

  spawn: { p: [0, 0.6, 0], yaw: 0 },
  killY: -40,

  checkpoints: [
    // On the grid deck, looking down 16.6 m of empty runway. Everything before this is
    // neon-1 revision; everything after it is new.
    { p: [44.2, 2.0, 0], yaw: 0, clockOffset: 0 },
    // The corridor mouth. The next 27 m are beams and there is no way round them.
    { p: [80.9, 2.0, 0], yaw: 0, clockOffset: 0 },
    // Off the corridor, before the shuttle-through-a-beam-gate. clockOffset 0.6: the
    // shuttle is 0.6 s into its outbound leg, i.e. still close and still coming back,
    // which is the only phase of that ride you can read from a standing start.
    { p: [115.9, 3.35, 0], yaw: 0, clockOffset: 0.6 },
    // The gallery, before the cog and the mills. The longest leg on the stage ends here.
    { p: [176.7, 4.7, 0], yaw: 0, clockOffset: 0 },
    // The drum gantry. clockOffset 1.85: at t = 1.85 the entry panel A is 1.85 s into its
    // 2.6 s solid window and the leading sweep has just crossed the entry spoke. You land
    // looking at a drum you can step onto, not one mid-blink.
    { p: [234.1, 5.6, 0], yaw: 0, clockOffset: 1.85 },
  ],

  finish: { p: [288.5, 4.05, 0], yaw: 0 },

  coins: [
    { p: [25.4, 2.4, -7.6] }, // BEAT 2 — a spur over the void that rejoins at the beam
    { p: [58.6, 3.0, 11.4] }, // BEAT 3 — out and back, and it costs you your run-up
    { p: [90.5, 3.5, 6.6] }, // BEAT 4 — an alcove with a beam firing across its mouth
    { p: [180.1, 8.3, 7.6] }, // BEAT 6 — pad-only: 2.6 m up, and a jump apexes at 2.09
    { p: [259.3, 7.55, 12.8] }, // BEAT 9 — an outrigger hanging off the turning drum
  ],

  objects: [
    /* ============================================================================ */
    /* BEAT 1 — BOOT SECTOR                                                         */
    /* A wide deck, two risers, and the stage telling you what it is about to do.     */
    /* Nothing here is on a timer. Almost everything after BEAT 2 is.                 */
    /* ============================================================================ */

    { kind: 'platform', p: [2, 0, 0], s: [13, 1, 12], mat: 'stone', glow: DIM },

    { kind: 'platform', p: [1.2, 0.75, 4.4], s: [2.4, 0.5, 2.4], mat: 'panel', glow: CYAN, stripe: true }, // top 1.0, a step
    { kind: 'platform', p: [6.2, 1.0, 4.4], s: [2.2, 1.0, 2.2], mat: 'panel', glow: CYAN, stripe: true }, // top 1.5, a 2.7 m hop at +0.5

    { kind: 'text', p: [-4.4, 2.8, 0], rot: [0, -Math.PI / 2, 0], text: 'OVERCLOCK', size: 0.82, color: MAG },
    { kind: 'text', p: [-4.4, 2.15, 0], rot: [0, -Math.PI / 2, 0], text: 'NEON DOJO  ·  III', size: 0.28, color: 0x6f8dac },
    { kind: 'text', p: [-4.4, 1.6, 0], rot: [0, -Math.PI / 2, 0], text: 'everything at once, and faster', size: 0.24, color: HOT },
    { kind: 'text', p: [6.2, 3.0, 4.4], rot: [0, -Math.PI / 2, 0], text: 'warm up', size: 0.24, color: CYAN },

    // The threshold gate, drawn in light rather than built in stone — the first hint that
    // this floor is a projection of a dojo and not a dojo.
    { kind: 'deco', kindOf: 'arch', p: [8.0, 4.8, 0], s: [1.0, 0.9, 15.0], mat: 'emissive', tint: MAG },
    { kind: 'deco', kindOf: 'pillar', p: [8.0, 2.7, 6.8], s: [1.1, 5.4, 1.1], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [8.0, 2.7, -6.8], s: [1.1, 5.4, 1.1], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'emblem', p: [8.0, 3.4, 0], s: [0.2, 1.6, 1.6], mat: 'emissive', tint: CYAN },
    { kind: 'light', p: [8.0, 4.2, 0], color: MAG, intensity: 11, distance: 24 },
    { kind: 'light', p: [1.0, 3.6, 0], color: 0xbcd8f5, intensity: 7, distance: 20 },

    /* ============================================================================ */
    /* BEAT 2 — GRID RECALL                                                         */
    /* neon-1's whole vocabulary in twenty seconds: a straight hop, a lateral step-up, */
    /* a diagonal, a narrow beam walk, a rise, a landing. Six obstacles and six        */
    /* different problems — gaps 2.20 / 2.90 / 3.06 / 2.00 / 2.58 / 3.30 and rises      */
    /* 0 / +0.45 / 0 / 0 / +0.70 / +0.25 — so no jump here is the jump you just made.   */
    /*                                                                              */
    /* COIN 1 is a spur: drop south off the diagonal pad onto a ledge over open air,    */
    /* then take a 3.96 m diagonal DOWN 0.5 m onto the near end of the beam. Skip it     */
    /* and you lose nothing but the coin.                                              */
    /* ============================================================================ */

    { kind: 'platform', p: [12.3, 0, 0], s: [3.2, 1, 4.6], mat: 'panel', glow: CYAN, stripe: true }, // gap 2.20, top 0.5
    { kind: 'platform', p: [18.1, 0.45, 2.0], s: [2.6, 1, 3.2], mat: 'panel', glow: CYAN, stripe: true }, // gap 2.90, +0.45
    { kind: 'platform', p: [23.9, 0.45, -1.7], s: [3.0, 1, 3.0], mat: 'panel', glow: CYAN, stripe: true }, // diagonal 3.06

    // -- the optional line -------------------------------------------------------
    { kind: 'platform', p: [25.4, 0.95, -7.6], s: [2.6, 1, 2.6], mat: 'panel', glow: MAG, stripe: true }, // 3.10 m south at +0.5
    { kind: 'deco', kindOf: 'ring', p: [25.4, 2.4, -7.6], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: MAG },
    { kind: 'light', p: [25.4, 2.7, -7.6], color: MAG, intensity: 7, distance: 14 },

    { kind: 'beam', p: [30.2, 0.7, -1.9], s: [5.6, 0.5, 1.0], mat: 'metal' }, // gap 2.00, 1.0 m wide, top 0.95
    { kind: 'platform', p: [36.6, 1.15, 1.8], s: [3.0, 1, 3.4], mat: 'panel', glow: CYAN, stripe: true }, // diagonal 2.58, +0.70
    { kind: 'platform', p: [44.2, 1.4, 0], s: [5.6, 1, 6.4], mat: 'stone', glow: DIM, stripe: true }, // gap 3.30, +0.25, top 1.9 — CP0

    { kind: 'text', p: [10.4, 2.4, 3.6], rot: [0, -Math.PI / 2, 0], text: 'you know this part', size: 0.26, color: 0x6f8dac },
    { kind: 'deco', kindOf: 'cable', p: [26.0, 4.8, 0], s: [34.0, 0.06, 0.06], mat: 'metal', tint: 0x14283f },
    { kind: 'deco', kindOf: 'antenna', p: [20.0, 6.4, -12.4], s: [0.5, 13.0, 0.5], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'screen', p: [33.0, 6.4, 11.0], s: [0.35, 5.0, 7.2], mat: 'emissive', tint: 0x8a3fa8 },
    { kind: 'light', p: [22.0, 3.4, 0], color: CYAN, intensity: 6, distance: 26 },

    /* ============================================================================ */
    /* BEAT 3 — OVERCLOCK : THE SPEED PAD                                           */
    /* NEW MECHANIC, taught with nothing else in the room. The CP0 deck and the runway */
    /* are flush, so there are 16.6 m of dead-straight unobstructed approach before the */
    /* first gap, and the landing deck is 8.6 m long before the second — both well past */
    /* the 8 m of run-up a sprint-required jump is allowed to ask for.                  */
    /*                                                                              */
    /*   pad 1 (13.2 m/s) -> 5.60 m flat   run tops out at 5.244; sprint is safe to 6.17 */
    /*   pad 2 (14.0 m/s) -> 5.70 m flat   same again, ten metres further and unfenced   */
    /*                                                                              */
    /* Neither gap is landable at run speed and both are landable off the pad without    */
    /* ever touching SHIFT. That is the whole lesson: the pad IS the sprint.             */
    /*                                                                              */
    /* COIN 2 is a two-hop spur north off the RUNWAY, which means taking it costs you    */
    /* the run-up you were building. There is no faster line; there is a slower one.      */
    /* ============================================================================ */

    { kind: 'platform', p: [52.5, 1.4, 0], s: [11.0, 1, 5.2], mat: 'metal', glow: DIM }, // flush with the CP0 deck, top 1.9
    { kind: 'speedpad', p: [50.0, 1.97, 0], s: [3.4, 0.14, 4.4], dir: [1, 0, 0], power: 13.2 },

    { kind: 'text', p: [46.4, 4.0, 0], rot: [0, -Math.PI / 2, 0], text: 'OVERCLOCK', size: 0.62, color: MAG },
    { kind: 'text', p: [46.4, 3.35, 0], rot: [0, -Math.PI / 2, 0], text: 'the pad is the sprint  ·  run straight', size: 0.24, color: 0x6f8dac },

    // -- the optional line: off the runway, out over the city, and back ----------
    { kind: 'platform', p: [53.2, 1.4, 6.6], s: [2.4, 1, 2.4], mat: 'panel', glow: MAG, stripe: true }, // 2.80 m north off the runway
    { kind: 'platform', p: [58.6, 1.4, 11.4], s: [2.2, 1, 2.2], mat: 'panel', glow: MAG, stripe: true }, // 3.98 m further out — and no way back except the way in
    { kind: 'deco', kindOf: 'ring', p: [58.6, 3.0, 11.4], s: [0.12, 2.0, 2.0], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: MAG },
    { kind: 'light', p: [56.4, 3.4, 9.2], color: MAG, intensity: 7, distance: 16 },

    { kind: 'platform', p: [67.9, 1.4, 0], s: [8.6, 1, 5.2], mat: 'panel', glow: CYAN, stripe: true }, // gap 5.60, top 1.9, 8.6 m of deck
    { kind: 'speedpad', p: [67.5, 1.97, 0], s: [2.6, 0.14, 5.2], dir: [1, 0, 0], power: 14.0 },

    { kind: 'platform', p: [80.9, 1.4, 0], s: [6.0, 1, 6.4], mat: 'stone', glow: DIM, stripe: true }, // gap 5.70, top 1.9 — CP1

    { kind: 'deco', kindOf: 'rail', p: [52.5, 3.2, 3.4], s: [11.0, 0.08, 0.08], mat: 'metal', tint: MAG },
    { kind: 'deco', kindOf: 'rail', p: [52.5, 3.2, -3.4], s: [11.0, 0.08, 0.08], mat: 'metal', tint: MAG },
    { kind: 'deco', kindOf: 'post', p: [60.0, 2.9, -3.4], s: [0.2, 2.0, 0.2], count: 5, spread: [22, 0, 0], seed: 3101, tint: DIM },
    { kind: 'deco', kindOf: 'sign', p: [63.0, 4.2, -4.8], s: [0.25, 1.8, 3.4], mat: 'emissive', tint: HOT },
    { kind: 'light', p: [52.5, 4.4, 0], color: MAG, intensity: 10, distance: 26 },
    { kind: 'light', p: [67.9, 4.0, 0], color: CYAN, intensity: 8, distance: 22 },

    /* ============================================================================ */
    /* BEAT 4 — THE LASER CORRIDOR                                                  */
    /* NEW MECHANIC. Twenty-seven metres of walkway 4.6 m wide with a drop on both     */
    /* sides, and four beam installations that each escalate in exactly one dimension:  */
    /*                                                                              */
    /*   1. ONE beam at ankle height, 1.5 s on / 2.4 s off with a 0.8 s warning. Stand  */
    /*      and watch it. It is the most generous cycle in the world.                   */
    /*   2. THREE ankle beams 2.6 m apart, staggered 0.9 s: a wave rolling toward you.   */
    /*      Same skill, now with a tempo.                                               */
    /*   3. THREE beams at 1.55 m, staggered 0.85 s. Ankle beams are jumped; these are   */
    /*      ducked. CTRL, not SPACE. Different verb, identical read.                     */
    /*   4. TWO ankle beams, 0.9 s on / 1.5 s off, staggered 0.75 s — the same tempo at   */
    /*      the speed the rest of the stage is going to use.                             */
    /*                                                                              */
    /* Laser `cycle.phase` is SECONDS and `warn` is carved off the END of `off`, so the  */
    /* emitter you see strobing is always the one about to fire, never one that stopped. */
    /*                                                                              */
    /* COIN 3 sits in an alcove 3.0 m off the corridor's north edge with its own beam    */
    /* firing across the mouth on a 3.0 s cycle: two hops, both through the same gate.    */
    /* ============================================================================ */

    { kind: 'platform', p: [90.7, 1.4, 0], s: [13.6, 1, 4.6], mat: 'metal', glow: DIM }, // flush with the CP1 deck, top 1.9

    { kind: 'laser', a: [87.1, 2.25, -2.6], b: [87.1, 2.25, 2.6], radius: 0.1, color: HOT, cycle: { on: 1.5, off: 2.4, warn: 0.8, phase: 0 } },

    {
      kind: 'lasergrid',
      a: [92.9, 2.25, -2.6],
      b: [92.9, 2.25, 2.6],
      count: 3,
      spacing: 2.6,
      offset: [1, 0, 0], // the rack marches ALONG the corridor: beams at x 90.3 / 92.9 / 95.5
      stagger: 0.9,
      radius: 0.1,
      color: HOT,
      cycle: { on: 1.0, off: 2.0, warn: 0.5, phase: 0.5 },
    },

    // -- the alcove --------------------------------------------------------------
    { kind: 'platform', p: [90.5, 1.4, 6.6], s: [2.6, 1, 2.6], mat: 'panel', glow: MAG, stripe: true }, // 3.00 m north of the corridor
    { kind: 'laser', a: [90.5, 2.4, 2.5], b: [90.5, 2.4, 5.6], radius: 0.09, color: MAG, cycle: { on: 1.7, off: 1.3, warn: 0.45, phase: 0.3 } },
    { kind: 'deco', kindOf: 'ring', p: [90.5, 3.5, 6.6], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: MAG },
    { kind: 'light', p: [90.5, 3.9, 6.6], color: MAG, intensity: 7, distance: 14 },

    { kind: 'platform', p: [105.2, 1.85, 0], s: [11.4, 1, 4.6], mat: 'metal', glow: DIM, stripe: true }, // gap 2.00, +0.45, top 2.35

    {
      kind: 'lasergrid',
      a: [102.9, 3.9, -2.6],
      b: [102.9, 3.9, 2.6], // 1.55 m over the deck: standing (1.8) clips it, crouching (1.05) does not
      count: 3,
      spacing: 2.4,
      offset: [1, 0, 0], // beams at x 100.5 / 102.9 / 105.3
      stagger: 0.85,
      radius: 0.1,
      color: HOT,
      cycle: { on: 1.2, off: 1.9, warn: 0.5, phase: 0 },
    },
    {
      kind: 'lasergrid',
      a: [108.3, 2.7, -2.6],
      b: [108.3, 2.7, 2.6],
      count: 2,
      spacing: 3.2,
      offset: [1, 0, 0], // beams at x 106.7 / 109.9
      stagger: 0.75,
      radius: 0.1,
      color: HOT,
      cycle: { on: 0.9, off: 1.5, warn: 0.4, phase: 0.6 },
    },

    { kind: 'platform', p: [115.9, 2.75, 0], s: [6.0, 1, 6.4], mat: 'stone', glow: DIM, stripe: true }, // gap 2.00 at +0.90, top 3.25 — CP2

    { kind: 'text', p: [84.4, 4.2, 0], rot: [0, -Math.PI / 2, 0], text: 'CUTTING FLOOR', size: 0.52, color: HOT },
    { kind: 'text', p: [84.4, 3.65, 0], rot: [0, -Math.PI / 2, 0], text: 'the strobe is the one about to fire', size: 0.24, color: 0x6f8dac },
    { kind: 'text', p: [98.6, 4.4, -2.9], rot: [0, -Math.PI / 2, 0], text: 'CROUCH', size: 0.42, color: AMBER },
    { kind: 'deco', kindOf: 'grate', p: [90.7, 0.6, 0], s: [13.6, 0.12, 4.4], mat: 'grate', tint: DIM }, // under the walk line
    { kind: 'deco', kindOf: 'grate', p: [105.2, 1.05, 0], s: [11.4, 0.12, 4.4], mat: 'grate', tint: DIM },
    { kind: 'deco', kindOf: 'pipe', p: [97.0, 7.6, 7.6], s: [30.0, 0.6, 0.6], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'pipe', p: [97.0, 8.2, -7.6], s: [30.0, 0.6, 0.6], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'buttress', p: [83.9, 6.0, 4.2], s: [1.2, 3.2, 1.2], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [97.5, 6.0, -4.2], s: [1.2, 3.2, 1.2], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [110.9, 6.4, 4.2], s: [1.2, 3.2, 1.2], mat: 'obsidian' },
    { kind: 'light', p: [90.5, 4.6, 0], color: HOT, intensity: 9, distance: 22, flicker: 0.09 },
    { kind: 'light', p: [105.2, 5.0, 0], color: HOT, intensity: 9, distance: 22, flicker: 0.09 },

    /* ============================================================================ */
    /* BEAT 5 — THE RIDE  (mover + laser + vanish, combined)                        */
    /* The first passage that asks for two clocks at once. A 7.2 s shuttle carries you */
    /* 6.2 m east THROUGH a beam gate on a 3.3 s cycle: you cannot outrun the gate and  */
    /* you cannot get off, so the only answer is to jump it from a floor that is moving. */
    /*                                                                              */
    /* Then three vanish tiles, each with its own beam skimming 0.35 m above it, phased  */
    /* so a beam fires while its tile is still solid. The tile says go, the beam says     */
    /* wait, and exactly one of them is lying at any given moment.                        */
    /*                                                                              */
    /* Tile phases are FRACTIONS (0 / 0.30 / 0.60 of a 4.4 s cycle = 1.32 s apart); beam  */
    /* phases are SECONDS (0 / 1.1 / 2.2). Both drift against the 7.2 s shuttle, so there */
    /* is no count to memorise. There is only looking.                                    */
    /* ============================================================================ */

    {
      kind: 'mover',
      p: [123.3, 2.75, 0],
      s: [3.8, 1, 4.2],
      mat: 'metal',
      motion: { type: 'linear', to: [129.5, 2.75, 0], period: 7.2, phase: 0, ease: 'sine', dwell: 0.9 },
    }, // board at 2.50 m off CP2's deck; 6.2 m of travel; tops 3.25 at both poses

    { kind: 'laser', a: [126.4, 3.6, -3.6], b: [126.4, 3.6, 3.6], radius: 0.1, color: HOT, cycle: { on: 1.4, off: 1.9, warn: 0.6, phase: 0 } }, // the gate, 0.35 m over the shuttle deck

    { kind: 'platform', p: [135.9, 2.75, 0], s: [3.6, 1, 4.8], mat: 'panel', glow: CYAN, stripe: true }, // gap 2.70 off the shuttle's far pose

    { kind: 'vanish', p: [141.3, 2.75, 0], s: [4.0, 1, 3.6], mat: 'panel', cycle: { on: 2.4, off: 1.4, warn: 0.6, phase: 0.0 } }, // gap 1.60
    { kind: 'vanish', p: [147.9, 2.75, 2.0], s: [3.6, 1, 3.6], mat: 'panel', cycle: { on: 2.4, off: 1.4, warn: 0.6, phase: 0.3 } }, // gap 2.80, +2.0 on z
    { kind: 'vanish', p: [153.5, 2.75, -2.0], s: [3.6, 1, 3.6], mat: 'panel', cycle: { on: 2.4, off: 1.4, warn: 0.6, phase: 0.6 } }, // diagonal 2.04

    { kind: 'laser', a: [141.3, 3.6, -2.8], b: [141.3, 3.6, 2.8], radius: 0.09, color: HOT, cycle: { on: 1.2, off: 2.1, warn: 0.5, phase: 0.0 } },
    { kind: 'laser', a: [147.9, 3.6, -0.8], b: [147.9, 3.6, 4.8], radius: 0.09, color: HOT, cycle: { on: 1.2, off: 2.1, warn: 0.5, phase: 1.1 } },
    { kind: 'laser', a: [153.5, 3.6, -4.8], b: [153.5, 3.6, 0.8], radius: 0.09, color: HOT, cycle: { on: 1.2, off: 2.1, warn: 0.5, phase: 2.2 } },

    { kind: 'platform', p: [161.1, 3.2, 0], s: [5.6, 1, 6.2], mat: 'stone', glow: DIM, stripe: true }, // gap 3.00, +0.45, top 3.7

    { kind: 'text', p: [119.0, 5.2, 0], rot: [0, -Math.PI / 2, 0], text: 'RIDE IT ANYWAY', size: 0.46, color: MAG },
    { kind: 'deco', kindOf: 'rail', p: [126.0, 3.0, 6.4], s: [22.0, 0.08, 0.08], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'monolith', p: [144.0, 9.0, 14.0], s: [6.0, 16.0, 6.0], mat: 'obsidian', tint: 0x16304e },
    { kind: 'deco', kindOf: 'screen', p: [144.0, 9.4, 10.6], s: [0.35, 5.4, 7.4], mat: 'emissive', tint: 0x8a3fa8 },
    { kind: 'deco', kindOf: 'antenna', p: [135.0, 8.0, -12.6], s: [0.5, 15.0, 0.5], mat: 'metal', tint: DIM },
    { kind: 'light', p: [126.4, 5.4, 0], color: HOT, intensity: 10, distance: 22 },
    { kind: 'light', p: [147.5, 5.0, 0], color: AMBER, intensity: 9, distance: 26, flicker: 0.1 },

    /* ============================================================================ */
    /* BEAT 6 — BREATHER : THE GALLERY                                              */
    /* Fifteen metres where nothing is on a timer. BEAT 5 was two clocks and BEAT 7 is  */
    /* a third; those two must not touch. This is also the stage's one view — the city   */
    /* is below you on both sides and there is a rail to stand at.                       */
    /*                                                                              */
    /* COIN 4 is pad-only, and that is a fact about the maths rather than an opinion:     */
    /* the perch is 2.60 m above the plaza and a standing jump apexes at 2.089, so there  */
    /* is no route up that is not the pad. The pad is also placed EAST of the perch, so   */
    /* you have to turn in the air to land on it.                                         */
    /* ============================================================================ */

    { kind: 'platform', p: [168.1, 3.65, 0], s: [3.4, 1, 4.4], mat: 'panel', glow: CYAN, stripe: true }, // gap 2.50, +0.45
    { kind: 'platform', p: [176.7, 4.1, 0], s: [8.4, 1, 8.4], mat: 'stone', glow: DIM, stripe: true }, // gap 2.70, +0.45, top 4.6 — CP3

    { kind: 'jumppad', p: [178.3, 4.67, 2.2], s: [2.6, 0.14, 2.6], power: 3.6, dir: [0, 1, 0] }, // apex 3.6 m over the pad
    { kind: 'platform', p: [180.1, 6.7, 7.6], s: [2.8, 1, 2.8], mat: 'panel', glow: MAG, stripe: true }, // the perch, top 7.2 — 2.60 m over the plaza

    { kind: 'deco', kindOf: 'ring', p: [180.1, 8.3, 7.6], s: [0.12, 2.4, 2.4], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: MAG },
    { kind: 'deco', kindOf: 'rail', p: [176.7, 5.2, -4.0], s: [8.0, 0.09, 0.09], mat: 'metal', tint: CYAN },
    { kind: 'deco', kindOf: 'brazier', p: [173.5, 5.5, -3.2], s: [0.9, 1.2, 0.9], mat: 'metal', tint: AMBER },
    { kind: 'deco', kindOf: 'banner', p: [179.8, 7.4, -3.8], s: [0.1, 3.0, 1.8], mat: 'panel', tint: MAG },
    { kind: 'text', p: [172.2, 6.4, -3.9], rot: [0, -Math.PI / 2, 0], text: 'BREATHE', size: 0.4, color: CYAN },
    { kind: 'light', p: [173.5, 6.4, -3.2], color: AMBER, intensity: 7, distance: 15, flicker: 0.3 },
    { kind: 'light', p: [180.1, 9.0, 7.6], color: MAG, intensity: 8, distance: 16 },

    /* ============================================================================ */
    /* BEAT 7 — THE COG, THEN THE MILLS  (rotor alone -> rotor OVER vanish)         */
    /* Two halves, deliberately separated.                                           */
    /*                                                                              */
    /* THE COG is a 9.6 m disc with a three-armed bar sweeping the whole of it every    */
    /* 4.2 s — a blade past your shins every 1.4 s, on solid ground, with nothing else    */
    /* in the room. neon-2's discs each had a safe island to stand on and count from;     */
    /* this one deliberately does not. The disc is 9.6 m wide and the bar is slow, so the */
    /* refuge is timing rather than terrain, and that is the whole point of the beat.     */
    /*                                                                              */
    /* THE MILLS are the combination the world has been building toward: three vanish    */
    /* tiles with windmill rotors hung over the FIRST and the THIRD. Hubs at y 9.4 with  */
    /* 4.6 m arms put the lowest blade tip at 4.8 — 0.2 m above a tile top of 4.6, so     */
    /* the blade sweeps the tile you are standing on and the jump that clears it is a     */
    /* jump made from a floor that is already counting down. The middle tile is clean:     */
    /* the beat is blade, breath, blade, and that rest is what makes it learnable          */
    /* instead of merely survivable.                                                      */
    /* ============================================================================ */

    { kind: 'platform', p: [187.7, 4.1, 0], s: [9.6, 1, 9.6], mat: 'stone', glow: DIM, stripe: true }, // gap 2.00, top 4.6
    { kind: 'rotor', p: [187.7, 5.2, 0], style: 'bar', arms: 3, len: 4.4, thick: 0.44, period: 4.2, phase: 0.35, axis: [0, 1, 0] }, // arms reach r 4.80 — the rim, so there is no walk-around

    { kind: 'vanish', p: [196.7, 4.1, 0], s: [3.4, 1, 3.8], mat: 'panel', cycle: { on: 2.2, off: 1.4, warn: 0.6, phase: 0.0 } }, // gap 2.50 — under mill 1
    { kind: 'vanish', p: [202.5, 4.1, 0], s: [3.4, 1, 3.8], mat: 'panel', cycle: { on: 2.2, off: 1.4, warn: 0.6, phase: 0.34 } }, // gap 2.40 — the rest
    { kind: 'vanish', p: [208.1, 4.1, 0], s: [3.4, 1, 3.8], mat: 'panel', cycle: { on: 2.2, off: 1.4, warn: 0.6, phase: 0.68 } }, // gap 2.20 — under mill 2

    { kind: 'rotor', p: [196.7, 9.4, 0], style: 'windmill', arms: 3, len: 4.6, thick: 0.4, period: 5.6, phase: 0, axis: [0, 0, 1] }, // a blade every 1.87 s
    { kind: 'rotor', p: [208.1, 9.4, 0], style: 'windmill', arms: 2, len: 4.6, thick: 0.4, period: 4.4, phase: 0.4, axis: [0, 0, 1] }, // a blade every 2.20 s, 0.4 of a turn out of step

    { kind: 'platform', p: [214.9, 4.55, 0], s: [5.6, 1, 6.2], mat: 'stone', glow: DIM, stripe: true }, // gap 2.30, +0.45, top 5.05

    { kind: 'text', p: [181.6, 7.2, -4.6], rot: [0, -Math.PI / 2, 0], text: 'THE COG', size: 0.5, color: AMBER },
    { kind: 'text', p: [192.8, 7.4, 0], rot: [0, -Math.PI / 2, 0], text: 'and now the floor goes too', size: 0.26, color: HOT },
    { kind: 'deco', kindOf: 'pillar', p: [187.7, 9.4, 0], s: [1.2, 6.4, 1.2], mat: 'obsidian' }, // the cog's axle
    { kind: 'deco', kindOf: 'ring', p: [187.7, 4.72, 0], s: [9.6, 0.06, 9.6], mat: 'emissive', tint: AMBER }, // the bar's reach, painted flat on the deck so you can read it before you step on
    { kind: 'deco', kindOf: 'buttress', p: [196.7, 11.2, 3.6], s: [1.4, 2.6, 1.4], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [208.1, 11.2, 3.6], s: [1.4, 2.6, 1.4], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'cable', p: [202.4, 12.4, 0], s: [26.0, 0.08, 0.08], mat: 'metal', tint: 0x14283f },
    { kind: 'light', p: [187.7, 8.2, 0], color: AMBER, intensity: 11, distance: 22 },
    { kind: 'light', p: [202.5, 7.6, 0], color: AMBER, intensity: 10, distance: 24, flicker: 0.08 },

    /* ============================================================================ */
    /* BEAT 8 — CROSSFIRE                                                           */
    /* A 3.4 m bridge with no way round anything on it. Two pendulums swing ALONG the  */
    /* stage axis (axis [0,0,1] runs the blade span across the bridge) on 3.2 s and      */
    /* 2.6 s, and two ankle beams sit under their arcs on a 2.6 s cycle staggered 0.7 s. */
    /* Pivots at y 9.8 with 3.2 m arms and a 1.5 m blade put the lowest lethal point at   */
    /* 5.35 — 0.30 m over a deck at 5.05, so a blade takes your legs and a jump does not. */
    /* Three timers, one lane, eleven metres, and then the drum gantry.                   */
    /* ============================================================================ */

    { kind: 'platform', p: [223.1, 4.55, 0], s: [10.8, 1, 3.4], mat: 'metal', glow: CYAN }, // flush with BEAT 7's landing, top 5.05

    { kind: 'pendulum', p: [220.7, 9.8, 0], len: 3.2, amp: 1.05, period: 3.2, phase: 0, blade: { w: 3.0, h: 1.5, d: 0.28 }, axis: [0, 0, 1] },
    { kind: 'pendulum', p: [226.1, 9.8, 0], len: 3.2, amp: 1.05, period: 2.6, phase: Math.PI * 0.5, blade: { w: 3.0, h: 1.5, d: 0.28 }, axis: [0, 0, 1] }, // a quarter-turn out of step, in RADIANS

    {
      kind: 'lasergrid',
      a: [223.4, 5.4, -1.8],
      b: [223.4, 5.4, 1.8],
      count: 2,
      spacing: 2.8,
      offset: [1, 0, 0], // beams at x 222.0 / 224.8 — one under each pendulum's arc
      stagger: 0.7,
      radius: 0.09,
      color: HOT,
      cycle: { on: 1.0, off: 1.6, warn: 0.4, phase: 0.25 },
    },

    { kind: 'platform', p: [234.1, 5.0, 0], s: [7.2, 1, 7.6], mat: 'stone', glow: DIM, stripe: true }, // gap 2.00, +0.45, top 5.5 — CP4

    { kind: 'text', p: [216.4, 7.4, -2.2], rot: [0, -Math.PI / 2, 0], text: 'CROSSFIRE', size: 0.46, color: HOT },
    { kind: 'deco', kindOf: 'arch', p: [220.7, 10.6, 0], s: [0.8, 0.7, 7.0], mat: 'metal', tint: DIM }, // the gantry the blades hang from
    { kind: 'deco', kindOf: 'arch', p: [226.1, 10.6, 0], s: [0.8, 0.7, 7.0], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'pillar', p: [220.7, 8.0, 3.5], s: [0.7, 5.2, 0.7], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [220.7, 8.0, -3.5], s: [0.7, 5.2, 0.7], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [226.1, 8.0, 3.5], s: [0.7, 5.2, 0.7], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [226.1, 8.0, -3.5], s: [0.7, 5.2, 0.7], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'rail', p: [223.1, 5.6, 1.8], s: [10.8, 0.08, 0.08], mat: 'metal', tint: HOT },
    { kind: 'deco', kindOf: 'rail', p: [223.1, 5.6, -1.8], s: [10.8, 0.08, 0.08], mat: 'metal', tint: HOT },
    { kind: 'light', p: [223.4, 7.0, 0], color: HOT, intensity: 12, distance: 22, flicker: 0.12 },

    /* ============================================================================ */
    /* BEAT 9 — SET-PIECE : THE DRUM                                                */
    /* ---------------------------------------------------------------------------- */
    /* A hexagonal drum 18.4 m across, hung on an axle over the city and built from six */
    /* vanish panels at the vertices of a hexagon of radius 7.4 — with nothing whatever  */
    /* in the middle. The panel phases advance by exactly 1/6 of a cycle going round the */
    /* ring (0.00, 0.17, 0.34, 0.50, 0.66, 0.83), so the solid arc SWEEPS around the      */
    /* drum at one panel every 0.74 s. It is not a floor that blinks. It is a wheel that  */
    /* turns, and you ride it round.                                                     */
    /*                                                                              */
    /* Two beams sweep the deck from the axle at 0.35 m above the panels, one clockwise   */
    /* on 6.6 s and one anticlockwise on 5.4 s. They cross twice a cycle and never twice  */
    /* in the same place, so there is no safe spoke — only a safe moment.                 */
    /*                                                                              */
    /* THE ROUTE. You enter on panel A at the west vertex and leave on panel D at the      */
    /* east. Three hops either way, and the ring's own timing decides which:               */
    /*   SOUTH  A -> B -> C -> D  runs WITH the sweep: each panel goes solid 0.74 s after   */
    /*          the one before, so walking off A as it warns lands you on a fresh B.        */
    /*   NORTH  A -> F -> E -> D  runs AGAINST it. Every hop lands on a panel that is       */
    /*          further through its window than the one you left.                          */
    /* COIN 5 hangs off the NORTH arc: an outrigger gantry 3.39 m off panel E, out over     */
    /* the drop, with no way back except the way you came. It is the only reason to go the  */
    /* wrong way round a wheel, which is exactly what a coin is for.                        */
    /*                                                                              */
    /* Then: a 9.2 m runway, a 14.2 m/s pad, and a 6.80 m jump that DROPS TWO metres into  */
    /* the gate. Run tops out at 6.199 m over a 2 m drop and sprint is safe to 7.299, so it  */
    /* is the pad or it is the city. You do not walk to the end of NEON DOJO.                */
    /* ============================================================================ */

    { kind: 'platform', p: [241.1, 5.45, 0], s: [3.6, 1, 4.0], mat: 'metal', glow: CYAN, stripe: true }, // gap 1.60 at +0.45, top 5.95 — the gantry lip, flush with the drum

    // -- the drum. centre x 255.6, radius 7.4, panels 3.6 m square, every top at 5.95 --
    { kind: 'vanish', p: [248.2, 5.45, 0.0], s: [3.6, 1, 3.6], mat: 'panel', cycle: { on: 2.6, off: 1.3, warn: 0.55, phase: 0.0 } }, // A  west       · the entry, flat gap 3.50
    { kind: 'vanish', p: [251.9, 5.45, -6.41], s: [3.6, 1, 3.6], mat: 'panel', cycle: { on: 2.6, off: 1.3, warn: 0.55, phase: 0.17 } }, // B  south-west · 2.81 m diagonal
    { kind: 'vanish', p: [259.3, 5.45, -6.41], s: [3.6, 1, 3.6], mat: 'panel', cycle: { on: 2.6, off: 1.3, warn: 0.55, phase: 0.34 } }, // C  south-east · 3.80 m straight
    { kind: 'vanish', p: [263.0, 5.45, 0.0], s: [3.6, 1, 3.6], mat: 'panel', cycle: { on: 2.6, off: 1.3, warn: 0.55, phase: 0.5 } }, // D  east       · the exit
    { kind: 'vanish', p: [259.3, 5.45, 6.41], s: [3.6, 1, 3.6], mat: 'panel', cycle: { on: 2.6, off: 1.3, warn: 0.55, phase: 0.66 } }, // E  north-east · the coin panel
    { kind: 'vanish', p: [251.9, 5.45, 6.41], s: [3.6, 1, 3.6], mat: 'panel', cycle: { on: 2.6, off: 1.3, warn: 0.55, phase: 0.83 } }, // F  north-west

    { kind: 'platform', p: [259.3, 5.45, 12.8], s: [2.4, 1, 2.4], mat: 'obsidian', glow: MAG, stripe: true }, // COIN 5 outrigger: 3.39 m off E, 5.55 m off F, top 5.95

    {
      kind: 'lasersweep',
      p: [255.6, 6.3, 0], // the axle, 0.35 m over the panels
      len: 9.4, // just past the far corner of every panel
      axis: [0, 1, 0],
      dir: [1, 0, 0],
      arc: Math.PI * 1.15,
      period: 6.6,
      phase: 0,
      radius: 0.1,
      color: HOT,
      cycle: { on: 5.4, off: 1.2, warn: 0.5, phase: 0 },
    },
    {
      kind: 'lasersweep',
      p: [255.6, 6.3, 0],
      len: 9.4,
      axis: [0, 1, 0],
      dir: [-1, 0, 0], // starts opposite and sweeps the other way
      arc: Math.PI * 1.15,
      period: 5.4,
      phase: 1.7,
      radius: 0.1,
      color: MAG,
      cycle: { on: 4.6, off: 1.4, warn: 0.5, phase: 0.7 },
    },

    // The drum's structure: the axle, the two rim rings and the cradle. Every piece of it
    // is above head height, below the walk line, or beyond |z| = 15, so nothing here can
    // be mistaken for a panel.
    { kind: 'deco', kindOf: 'pillar', p: [255.6, 10.4, 0], s: [1.4, 7.0, 1.4], mat: 'obsidian' }, // the axle
    { kind: 'deco', kindOf: 'ring', p: [255.6, 9.2, 0], s: [18.4, 0.24, 18.4], mat: 'emissive', tint: MAG }, // the rim, overhead
    { kind: 'deco', kindOf: 'ring', p: [255.6, 3.0, 0], s: [18.4, 0.24, 18.4], mat: 'emissive', tint: CYAN }, // and its twin, well under the panels
    { kind: 'deco', kindOf: 'arch', p: [255.6, 13.4, 0], s: [1.2, 1.0, 21.0], mat: 'metal', tint: DIM }, // the cradle
    { kind: 'deco', kindOf: 'pillar', p: [255.6, 11.4, 16.0], s: [1.3, 9.0, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [255.6, 11.4, -16.0], s: [1.3, 9.0, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'ring', p: [259.3, 7.55, 12.8], s: [0.12, 2.0, 2.0], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: MAG },
    { kind: 'text', p: [238.4, 7.6, 0], rot: [0, -Math.PI / 2, 0], text: 'THE DRUM', size: 0.62, color: MAG },
    { kind: 'text', p: [238.4, 6.95, 0], rot: [0, -Math.PI / 2, 0], text: 'south goes with it  ·  north does not', size: 0.24, color: 0x6f8dac },
    { kind: 'light', p: [255.6, 8.0, 0], color: MAG, intensity: 16, distance: 30 },
    { kind: 'light', p: [249.0, 7.2, -4.4], color: HOT, intensity: 8, distance: 18, flicker: 0.1 },
    { kind: 'light', p: [262.0, 7.2, 4.4], color: CYAN, intensity: 8, distance: 18 },

    // -- the launch ---------------------------------------------------------------
    { kind: 'platform', p: [273.3, 5.45, 0], s: [9.2, 1, 5.2], mat: 'metal', glow: CYAN, stripe: true }, // gap 3.90 off panel D, top 5.95, 9.2 m of runway
    { kind: 'speedpad', p: [270.7, 6.02, 0], s: [3.4, 0.14, 4.4], dir: [1, 0, 0], power: 14.2 },
    { kind: 'text', p: [267.0, 8.0, 0], rot: [0, -Math.PI / 2, 0], text: 'DO NOT STOP', size: 0.54, color: MAG },

    { kind: 'platform', p: [288.5, 3.45, 0], s: [7.6, 1, 8.4], mat: 'obsidian', glow: MAG, stripe: true }, // gap 6.80 at -2.0, top 3.95

    // The gate is built low and wide so all of it is inside your view for the whole flight:
    // you should be able to see where you are going to land the instant you leave the pad.
    { kind: 'deco', kindOf: 'arch', p: [288.5, 9.4, 0], s: [1.4, 1.1, 9.6], mat: 'obsidian', tint: MAG },
    { kind: 'deco', kindOf: 'pillar', p: [288.5, 6.9, 4.6], s: [1.3, 5.9, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [288.5, 6.9, -4.6], s: [1.3, 5.9, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'beacon', p: [292.1, 6.2, 0], s: [0.7, 3.0, 0.7], mat: 'emissive', tint: MAG },
    { kind: 'deco', kindOf: 'emblem', p: [288.5, 7.6, 0], s: [0.2, 2.0, 2.0], mat: 'emissive', tint: CYAN },
    { kind: 'text', p: [285.7, 6.4, 0], rot: [0, -Math.PI / 2, 0], text: 'OVERCLOCK', size: 0.44, color: MAG },
    { kind: 'light', p: [288.5, 7.8, 0], color: MAG, intensity: 22, distance: 34 },

    /* ============================================================================ */
    /* THE CITY — every piece of it is at |z| >= 17 or below y = -4, i.e. outside every */
    /* play corridor on the stage, the drum's 18.4 m span and the two coin spurs that    */
    /* reach out to z 12.8 included. Towers grow taller as the course runs east so the    */
    /* skyline keeps pace with the difficulty, and the holo-panels are the only saturated */
    /* magenta that is not trying to kill you — which is why every lethal thing in this    */
    /* stage is HOT and nothing else in it is.                                             */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'monolith', p: [50, -14, 34], s: [10, 34, 10], count: 8, spread: [110, 24, 20], seed: 9101, tint: DEEP },
    { kind: 'deco', kindOf: 'monolith', p: [50, -16, -34], s: [10, 34, 10], count: 8, spread: [110, 24, 20], seed: 9102, tint: DEEP },
    { kind: 'deco', kindOf: 'monolith', p: [175, -10, 36], s: [12, 44, 12], count: 8, spread: [130, 30, 22], seed: 9103, tint: 0x16304e },
    { kind: 'deco', kindOf: 'monolith', p: [175, -12, -36], s: [12, 44, 12], count: 8, spread: [130, 30, 22], seed: 9104, tint: 0x16304e },
    { kind: 'deco', kindOf: 'monolith', p: [272, -8, 40], s: [13, 50, 13], count: 5, spread: [70, 30, 20], seed: 9105, tint: 0x1a3a5c },
    { kind: 'deco', kindOf: 'monolith', p: [272, -10, -40], s: [13, 50, 13], count: 5, spread: [70, 30, 20], seed: 9106, tint: 0x1a3a5c },

    { kind: 'deco', kindOf: 'antenna', p: [150, 2, 30], s: [0.6, 22, 0.6], count: 7, spread: [260, 10, 14], seed: 9201, tint: DIM },
    { kind: 'deco', kindOf: 'antenna', p: [150, 0, -30], s: [0.6, 22, 0.6], count: 7, spread: [260, 10, 14], seed: 9202, tint: DIM },
    { kind: 'deco', kindOf: 'panel', p: [62, 15, 17.0], s: [0.3, 6.0, 9.0], mat: 'emissive', tint: MAG }, // holo-billboards, all far above head height
    { kind: 'deco', kindOf: 'panel', p: [122, 16, -17.0], s: [0.3, 7.0, 10.0], mat: 'emissive', tint: 0x8a3fa8 },
    { kind: 'deco', kindOf: 'panel', p: [210, 17, 18.0], s: [0.3, 7.0, 11.0], mat: 'emissive', tint: MAG },
    { kind: 'deco', kindOf: 'panel', p: [278, 18, -19.0], s: [0.3, 8.0, 12.0], mat: 'emissive', tint: 0x8a3fa8 },
    { kind: 'deco', kindOf: 'cable', p: [148, 20.0, 13.0], s: [280, 0.09, 0.09], mat: 'metal', tint: 0x0e1e33 },
    { kind: 'deco', kindOf: 'cable', p: [148, 23.0, -14.0], s: [280, 0.09, 0.09], mat: 'metal', tint: 0x0e1e33 },
    { kind: 'deco', kindOf: 'cloud', p: [148, -26, 0], s: [22, 3, 22], count: 16, spread: [300, 12, 110], seed: 9301, scale: 2.0, tint: 0x1b3c5e },

    // Path lights, roughly one per beat, so the whole course reads as a single line of
    // light from the boot deck. You can see the drum turning from two hundred metres away.
    { kind: 'light', p: [30, 3.4, 0], color: CYAN, intensity: 6, distance: 24 },
    { kind: 'light', p: [80, 4.0, 0], color: CYAN, intensity: 7, distance: 22 },
    { kind: 'light', p: [116, 5.0, 0], color: CYAN, intensity: 7, distance: 22 },
    { kind: 'light', p: [161, 5.6, 0], color: CYAN, intensity: 7, distance: 24 },
    { kind: 'light', p: [215, 7.0, 0], color: CYAN, intensity: 8, distance: 24 },
    { kind: 'light', p: [241, 7.4, 0], color: CYAN, intensity: 9, distance: 24 },
    { kind: 'light', p: [273, 8.2, 0], color: CYAN, intensity: 9, distance: 26 },
  ],
};
