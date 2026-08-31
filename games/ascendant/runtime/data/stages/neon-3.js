/**
 * ASCENDANT — NEON DOJO 3 : "OVERCLOCK"
 * runtime/data/stages/neon-3.js
 *
 * The finale of the dojo. A holographic test rig hung in the rain above the city:
 * magenta key light, cyan rim, wireframe architecture that is drawn rather than built,
 * and three hundred metres of nothing underneath it. neon-1 taught you where your feet
 * go and neon-2 taught you when. This one asks for both at once, then spins the room.
 *
 * SHAPE      ~315 m of travel, 9 checkpoints never more than 41.3 m apart, 5 coins,
 *            and a hazard mix drawn from nine families (speedpad, jumppad, laser,
 *            lasergrid, lasersweep, mover, vanish, rotor, pendulum). Every number in
 *            these comments is emitted by `_harness/reachcheck.mjs` / `geomcheck.mjs`
 *            or computed from the factory the object is built by — see MEASUREMENT.
 *
 * IT IS NOT A CORRIDOR. The route turns twice inside the laser dog-leg (east, north,
 * east again), rides a shuttle diagonally back to the centre line, climbs a pavilion
 * from a terrace BELOW the walk line to a roof ABOVE it, crosses a cog you cannot
 * stand still on, and finishes on a wheel that actually turns.
 *
 * INTRODUCES three things, each in isolation before it is ever combined:
 *   RAMP PADS       BEAT 3 — a pad you cannot walk past, on a gap you cannot jump.
 *   LASER CORRIDOR  BEAT 4 — one beam, a rolling rack, a curtain you must CROUCH under.
 *   ROTOR + VANISH  BEAT 7 — mill blades that cover the whole width of the tile.
 * and then spends them: BEAT 5 rides a diagonal shuttle through a beam gate onto timed
 * tiles, BEAT 8 threads pendulums and a beam rack down a 3.4 m bridge, BEAT 9 is THE DRUM.
 *
 * ────────────────────────────────────────────────────────────────────────────────────
 * MEASUREMENT — how the numbers below were obtained, so they can be re-checked
 * ────────────────────────────────────────────────────────────────────────────────────
 * REACH ENVELOPE, measured from runtime/core/tuning.js (apex 2.089 m, airtime 0.610 s):
 *
 *      run 8.6 m/s     flat 5.244 max / 4.352 SAFE     at +0.80 m  4.731 / 3.927
 *      sprint 12.2     flat 7.439 max / 6.174 SAFE     at +1.05 m  4.539 / 3.767
 *                                                      at -2.00 m  8.793 / 7.299 (sprint)
 *
 * THE RAMP PADS ARE NOT DECORATION, AND THE MATHS SAYS SO TWICE.
 *   1. A FLAT speed pad cannot extend a jump in this engine. `_applySpeedPad`
 *      (controller.js:1137) ADDS `power` to the horizontal velocity, and ground
 *      friction (TUNE.friction 13) then bleeds everything above the movement target
 *      at 13/s: a 13 m/s boost is gone in 0.042 s and buys 0.73 m of ground. That is
 *      why every pad here is a RAMP — `dir` with a real +Y component, which trips
 *      `if (_dir.y > 0.2)` and puts the player in the air on the frame of contact,
 *      where the only bleed is airDrag 0.35/s. (Contact also leaves coyoteT at 0, so
 *      the launch cannot be re-jumped: the arc is the pad's, and it is deterministic.)
 *   2. THE PAD FIRES AT ITS WEST FACE, NOT AT THE LIP — and the first revision of this
 *      stage had that backwards, which cost all three landings. `_readContacts` applies
 *      the 'speed' surface on the FIRST substep the player is grounded on it
 *      (controller.js:1070-1078), and `_applySpeedPad` un-grounds them on that same
 *      frame because `dir.y > 0.2` (controller.js:1154-1158). The launch therefore
 *      happens ONE PLAYER RADIUS BEFORE the pad's leading face — 3.15 m short of the
 *      lip for a 2.8 m pad. reachcheck's own `padSpan` comment says exactly this
 *      ("the first face their capsule touches — one radius before it, not at the
 *      centre and certainly not at the far lip"). Measured from the lip, PAD 1's old
 *      6.60 m gap looked crossed with 1.11 m to spare; measured from the real launch
 *      point, a walk-on entry landed 1.44 m SHORT of the deck and a full run entry
 *      0.46 m short. Only a sprint lived. Every window below is measured FROM THE
 *      LAUNCH POINT, and every deck below catches the WHOLE entry band.
 *   3. Each pad still fills the LAST 2.8 m of its runway, full deck width, so there is
 *      no lip to stand on and no way to walk past it: whatever speed you arrive with,
 *      the ramp is what puts you in the air. What changed is that the deck it throws
 *      you at now sits where the arc actually ends. The pad is generous, not lethal.
 *   Windows below replay the controller's own integration (1/120 s substeps, half a
 *   step of gravity either side of the sweep, gravRise on the way UP because a speed
 *   pad never sets `_bounceRise`, airDrag 0.35/s only above speedAirCap 12.6), at
 *   crouch 4.2 / walk 6.0 / run 8.6 / sprint 12.2 entry.
 *
 *      PAD 1  dir[2,1,0]   power 20   launch x 56.45 y 1.44   apex y 2.49
 *             lands 64.72 / 65.39 / 66.36 / 68.86 — the first three on the 1.75 m
 *             terrace (63.50..66.20), the sprint on the 1.30 m deck flush behind it.
 *             Worst margin past the terrace lip 1.22 m.  Gap 3.90 at +0.45.
 *      PAD 2  dir[1.6,1,0] power 19   launch x 71.45 y 1.44   apex y 2.77
 *             lands 79.43 / 80.14 / 81.16 / 84.40 — three on the 2.10 m terrace
 *             (78.20..82.20), the sprint on CP1's deck.  Worst margin 1.23 m.
 *             Gap 3.60 at +0.80.
 *      PAD 3  dir[2,1,0]   power 17   launch x 301.05 y 6.44  apex y 7.20
 *             lands 310.41 / 311.27 / 312.53 / 314.26 on the gate apron (309.00..
 *             312.40) and the finish deck it is flush with, both topping at 4.30.
 *             Worst margin 1.41 m.  Gap 4.80 at -2.00.
 *
 *   All three geometric gaps now sit inside the RUN-SAFE envelope (3.90 <= 4.13 at
 *   +0.45, 3.60 <= 3.93 at +0.80, 4.80 <= 5.14 at -2.00), so reachcheck — which has no
 *   speed-pad term in `edge()`, it populates `pad` only for `jumppad` — scores them as
 *   ordinary run jumps, and this stage carries NO tight-jump warning on its forward
 *   route. The ramp is the flourish; the gap underneath it is honest.
 *
 * PHASE UNITS — FOUR HAZARD FAMILIES, THREE DIFFERENT UNITS. Read the factory, not
 * the neighbouring object:
 *   vanish    `cycle.phase`   FRACTION of one cycle, 0..1   (vanish.js:233 `period = on+warn+off`)
 *   mover     `motion.phase`  FRACTION of one cycle, 0..1   (movers.js:432 `TAU*(t/period+phase)`)
 *   rotor     `phase`         FRACTION of one revolution    (rotors.js:751)
 *   pendulum  `phase`         RADIANS                       (pendulum.js `arg = TAU*t/period + phase`)
 *   laser     `cycle.phase`   SECONDS, added to t           (lasers.js:604 `shifted = t + phase`)
 * Every phase below is written in the unit its own factory reads, and the pendulum ones
 * are written as expressions of Math.PI so the unit cannot be misread.
 *
 * CONVENTIONS (full list in runtime/data/index.js):
 *   p = CENTRE, s = FULL size, top surface = p[1] + s[1]/2. Gaps in the comments are
 *   EDGE TO EDGE and include the lateral (z) separation where there is one. rot/yaw in
 *   radians, yaw 0 faces +X. `stripe: true` = must jump to reach. A mover's `p` is its
 *   HOME pose and `motion.to` its far pose; for `type:'circle'` the `p` is the CENTRE
 *   OF THE ORBIT and the panel is landable everywhere on the circle.
 *
 * HEIGHT LADDER: 0.5 (boot) -> 1.30 (the launch runway, 0.80 m BELOW the gate deck it
 *                starts from) -> 1.75 then 2.10 (the two ramp terraces: each pad
 *                throws you UP onto a terrace and each terrace steps back DOWN onto
 *                the next runway) -> 2.35/3.30 (the dog-leg) -> 2.40..3.05 (the ride)
 *                -> 3.40 (gallery) -> 2.60 (the terrace, BELOW it) -> 5.70 (the roof,
 *                ABOVE it) -> 4.05 (the cog) -> 4.50 (the bridge) -> 6.20 (the gantry
 *                lip) -> 5.35 (the wheel, which you DROP onto) -> 6.30 (the launch)
 *                -> 4.30 (the gate apron and the finish deck flush behind it: two
 *                metres BELOW the launch, so the last thing this world does is drop
 *                you into the gate).
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
  par: 196000,
  difficulty: 6,

  spawn: { p: [0, 0.6, 0], yaw: 0 },
  killY: -40,

  checkpoints: [
    // CP0 — on the gate deck, looking down at a runway that is 0.80 m BELOW you and
    // ends in a ramp. Everything before this is neon-1 revision.
    { p: [44.6, 2.2, 0], yaw: 0, clockOffset: 0 },
    // CP1 — off the second ramp. The corridor starts 2.00 m away and 1.05 m up.
    { p: [85.9, 1.4, 0], yaw: 0, clockOffset: 0 },
    // CP2 — the far end of the dog-leg, 8.6 m north of the centre line, facing the
    // shuttle that takes you back to it. clockOffset 0.6: the shuttle is 0.6 s into
    // its outbound leg — close, still coming back, the only phase you can read cold.
    { p: [126.7, 3.4, 8.6], yaw: 0, clockOffset: 0.6 },
    // CP3 — ON THE FAR SIDE OF THE SHUTTLE. Dying on the vanish tiles used to cost a
    // 7.2 s wait for the ride plus the ride itself; from here the tiles are four
    // seconds away.
    { p: [147.5, 2.5, 0], yaw: 0, clockOffset: 0 },
    // CP4 — the gallery floor, before the pavilion climb.
    { p: [176.4, 3.5, 0], yaw: 0, clockOffset: 0 },
    // CP5 — off the pavilion roof, at the mouth of the cog.
    { p: [192.8, 4.15, 0], yaw: 0, clockOffset: 0 },
    // CP6 — past the mills, before the bridge.
    { p: [230.8, 4.6, 0], yaw: 0, clockOffset: 0 },
    // CP7 — ON THE GANTRY LIP, at the mouth of the drum rather than three seconds
    // short of it. clockOffset 14.0: the drum's period is 15.0 s and a panel sits at
    // the west vertex at t = 15k, so a second after you stand up the entry panel is
    // there. You never respawn looking at a wheel you cannot read.
    { p: [258.6, 6.3, 0], yaw: 0, clockOffset: 14.0 },
    // CP8 — OFF THE DRUM, on the launch runway. The last jump in the world is a ramp
    // over a two-metre drop; failing it costs one runway, not one drum.
    { p: [297.0, 6.4, 0], yaw: 0, clockOffset: 0 },
  ],

  finish: { p: [316.2, 4.4, 0], yaw: 0 },

  coins: [
    { p: [25.2, 2.45, -8.0] }, // BEAT 2 — a spur south, and a landing deck back onto the beam
    { p: [55.6, 3.85, 10.4] }, // BEAT 3 — two hops north off the runway; it costs you the pad approach
    { p: [97.0, 3.35, -6.8] }, // BEAT 4 — an alcove with a beam firing across its mouth
    { p: [187.2, 9.1, 9.8] }, // BEAT 6 — pad-only: 2.40 m up, and a standing jump apexes at 2.089
    { p: [272.0, 6.35, 12.8] }, // BEAT 9 — an outrigger you can only reach as the wheel brings a panel north
  ],

  objects: [
    /* ============================================================================ */
    /* BEAT 1 — BOOT SECTOR                                                          */
    /* A wide deck, two steps, and the stage telling you what it is about to do.      */
    /* Nothing here is on a timer. Almost everything after BEAT 2 is.                 */
    /* ============================================================================ */

    { kind: 'platform', p: [2, 0, 0], s: [13, 1, 12], mat: 'stone', glow: DIM }, // top 0.50

    { kind: 'platform', p: [1.2, 0.75, 4.4], s: [2.4, 0.5, 2.4], mat: 'panel', glow: CYAN, stripe: true }, // top 1.00, a step
    { kind: 'platform', p: [6.2, 1.0, 4.4], s: [2.2, 1, 2.2], mat: 'panel', glow: CYAN, stripe: true }, // top 1.50, a 2.70 m hop at +0.50

    { kind: 'text', p: [-4.4, 2.8, 0], rot: [0, -Math.PI / 2, 0], text: 'OVERCLOCK', size: 0.82, color: MAG },
    { kind: 'text', p: [-4.4, 2.15, 0], rot: [0, -Math.PI / 2, 0], text: 'NEON DOJO  ·  III', size: 0.28, color: 0x6f8dac },
    { kind: 'text', p: [-4.4, 1.6, 0], rot: [0, -Math.PI / 2, 0], text: 'everything at once, and faster', size: 0.24, color: HOT },
    { kind: 'text', p: [6.2, 3.0, 4.4], rot: [0, -Math.PI / 2, 0], text: 'warm up', size: 0.24, color: CYAN },

    // The threshold gate, drawn in light rather than built in stone — the first hint
    // that this floor is a projection of a dojo and not a dojo.
    { kind: 'deco', kindOf: 'arch', p: [8.0, 4.8, 0], s: [1.0, 0.9, 15.0], mat: 'emissive', tint: MAG },
    { kind: 'deco', kindOf: 'pillar', p: [8.0, 2.7, 6.8], s: [1.1, 5.4, 1.1], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [8.0, 2.7, -6.8], s: [1.1, 5.4, 1.1], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'emblem', p: [8.0, 3.4, 0], s: [0.2, 1.6, 1.6], mat: 'emissive', tint: CYAN },
    { kind: 'light', p: [8.0, 4.2, 0], color: MAG, intensity: 11, distance: 24 },
    { kind: 'light', p: [1.0, 3.6, 0], color: 0xbcd8f5, intensity: 7, distance: 20 },

    /* ============================================================================ */
    /* BEAT 2 — GRID RECALL                                                          */
    /* neon-1's whole vocabulary in twenty seconds, and NO TWO JUMPS ARE THE SAME     */
    /* SHAPE. Gaps 2.20 / 2.95 / 3.59 / 1.40 / 2.02 / 2.40 against rises              */
    /* 0 / +0.80 / -0.30 / 0 / +0.95 / +0.15 — a straight hop, a lateral step-up, a   */
    /* diagonal DOWN, a short drop onto a narrow beam, a high step, a landing.        */
    /*                                                                               */
    /* COIN 1 IS A LOOP, NOT AN OUT-AND-BACK, and it does not end on the beam. The    */
    /* ledge is a step UP from the diagonal (1.00 -> 1.45), and the way home is a     */
    /* 2.90 m hop onto a 2.8 x 2.8 m deck that then steps 1.30 m sideways onto the    */
    /* beam — so nothing on this route lands across a 1.2 m rail at run speed.        */
    /* ============================================================================ */

    { kind: 'platform', p: [12.3, 0, 0], s: [3.2, 1, 4.6], mat: 'panel', glow: CYAN, stripe: true }, // gap 2.20, top 0.50
    { kind: 'platform', p: [18.15, 0.8, 2.1], s: [2.6, 1, 3.0], mat: 'panel', glow: CYAN, stripe: true }, // gap 2.95, +0.80, top 1.30
    { kind: 'platform', p: [24.6, 0.5, -1.9], s: [3.4, 1, 3.0], mat: 'panel', glow: CYAN, stripe: true }, // diagonal 3.59, -0.30, top 1.00

    // -- the optional loop -------------------------------------------------------
    { kind: 'platform', p: [25.2, 0.95, -8.0], s: [3.0, 1, 3.0], mat: 'panel', glow: MAG, stripe: true }, // 3.10 m south, +0.45, top 1.45
    { kind: 'platform', p: [31.0, 0.6, -5.2], s: [2.8, 1, 2.8], mat: 'panel', glow: MAG, stripe: true }, // 2.90 m back east, -0.35, top 1.10
    { kind: 'deco', kindOf: 'ring', p: [25.2, 2.45, -8.0], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: MAG },
    { kind: 'light', p: [25.2, 2.7, -8.0], color: MAG, intensity: 7, distance: 14 },

    { kind: 'beam', p: [30.9, 0.75, -1.9], s: [6.4, 0.5, 1.2], mat: 'metal' }, // gap 1.40 off the diagonal, 1.30 off the loop deck, top 1.00
    { kind: 'platform', p: [37.6, 1.45, 1.2], s: [3.2, 1, 3.6], mat: 'panel', glow: CYAN, stripe: true }, // diagonal 2.02, +0.95, top 1.95
    { kind: 'platform', p: [44.6, 1.6, 0], s: [6.0, 1, 6.4], mat: 'stone', glow: DIM, stripe: true }, // gap 2.40, +0.15, top 2.10 — CP0

    { kind: 'text', p: [10.4, 2.4, 3.6], rot: [0, -Math.PI / 2, 0], text: 'you know this part', size: 0.26, color: 0x6f8dac },
    { kind: 'deco', kindOf: 'cable', p: [26.0, 4.8, 0], s: [34.0, 0.06, 0.06], mat: 'metal', tint: 0x14283f },
    { kind: 'deco', kindOf: 'antenna', p: [20.0, 6.4, -12.4], s: [0.5, 13.0, 0.5], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'screen', p: [33.0, 6.4, 11.0], s: [0.35, 5.0, 7.2], mat: 'emissive', tint: 0x8a3fa8 },
    { kind: 'light', p: [22.0, 3.4, 0], color: CYAN, intensity: 6, distance: 26 },

    /* ============================================================================ */
    /* BEAT 3 — OVERCLOCK : THE RAMP PADS                                            */
    /* NEW MECHANIC, taught with nothing else in the room.                           */
    /*                                                                               */
    /* You WALK OFF the CP0 deck onto a runway 0.80 m below it — the stage's first    */
    /* deliberate drop — and that runway ends in a ramp that fills its last 2.8 m,    */
    /* wall to wall. There is no lip to stand on and no way past the pad, so the ramp */
    /* fires whatever you do:                                                        */
    /*   crouch onto it -> launched at 4.2, lands 1.22 m onto the terrace             */
    /*   walk onto it   -> launched at 6.0, lands 1.89 m onto it                      */
    /*   run onto it    -> 2.86 m onto it                                             */
    /*   sprint onto it -> clean over the terrace, onto the 1.30 m deck behind it     */
    /* THE PAD FIRES AT ITS WEST FACE (MEASUREMENT §2), 3.15 m before the lip, so the */
    /* arc ends far earlier than a lip-relative reading suggests — which is why the   */
    /* terrace starts 3.90 m out and not 6.60 m out. Every entry speed the controller */
    /* can produce lands on solid floor; none of them lands in the city.              */
    /*                                                                               */
    /* THE TERRACE IS A STEP UP, and that is the point of it: you are thrown 0.45 m   */
    /* ABOVE the runway you left, then walk back down 0.45 m onto the runway that     */
    /* feeds PAD 2. Two pads, two terraces, and the height ladder moves under you the */
    /* whole way instead of thirty-eight metres of one flat deck.                     */
    /*                                                                               */
    /* PAD 2 is the same lesson with a different arc: dir[1.6,1] is steeper, so it    */
    /* throws you higher (apex 1.47 m over its runway against pad 1's 1.19 m) onto a  */
    /* terrace 0.80 m up rather than 0.45 m. Same button, different shape in the air. */
    /*                                                                               */
    /* COIN 2 is a two-hop climb north off the runway — 2.40 m at +0.75, then 1.86 m  */
    /* at +0.80 — which means taking it drops you back onto the runway from a height  */
    /* with no approach left. There is no faster line; there is a slower one.         */
    /* ============================================================================ */

    { kind: 'platform', p: [53.6, 0.8, 0], s: [12.0, 1, 5.4], mat: 'metal', glow: DIM }, // flush with CP0's east edge, 0.80 m BELOW it, top 1.30
    { kind: 'speedpad', p: [58.2, 1.37, 0], s: [2.8, 0.14, 5.4], dir: [2, 1, 0], power: 20 }, // fills x 56.8..59.6 — the whole lip; fires at x 56.45

    { kind: 'text', p: [48.4, 3.4, 0], rot: [0, -Math.PI / 2, 0], text: 'OVERCLOCK', size: 0.62, color: MAG },
    { kind: 'text', p: [48.4, 2.75, 0], rot: [0, -Math.PI / 2, 0], text: 'the ramp is the jump  ·  do not press SPACE', size: 0.24, color: HOT },

    // -- the optional line: off the runway, out over the city, and back ----------
    { kind: 'platform', p: [52.0, 1.55, 6.4], s: [2.6, 1, 2.6], mat: 'panel', glow: MAG, stripe: true }, // 2.40 m north, +0.75, top 2.05
    { kind: 'platform', p: [55.6, 2.35, 10.4], s: [2.4, 1, 2.4], mat: 'panel', glow: MAG, stripe: true }, // 1.86 m diagonal, +0.80, top 2.85
    { kind: 'deco', kindOf: 'ring', p: [55.6, 3.85, 10.4], s: [0.12, 2.0, 2.0], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: MAG },
    { kind: 'light', p: [54.0, 3.6, 8.4], color: MAG, intensity: 7, distance: 16 },

    // TERRACE 1 — where PAD 1 actually puts you. x 63.50..66.20, top 1.75: a step UP
    // off the ramp, and it catches crouch 64.72 / walk 65.39 / run 66.36 with 1.22 m
    // of margin at the worst entry. Gap off the lip 3.90 at +0.45 (run-safe 4.13).
    // CYAN, not MAG: in this stage magenta means an optional spur, and this is the path.
    { kind: 'platform', p: [64.85, 1.25, 0], s: [2.7, 1, 5.6], mat: 'panel', glow: CYAN, stripe: true },

    { kind: 'platform', p: [70.4, 0.8, 0], s: [8.4, 1, 5.6], mat: 'panel', glow: CYAN, stripe: true }, // flush at 66.20, 0.45 m DOWN — top 1.30; catches the sprint entry at 68.86
    { kind: 'speedpad', p: [73.2, 1.37, 0], s: [2.8, 0.14, 5.6], dir: [1.6, 1, 0], power: 19 }, // fills x 71.8..74.6; fires at x 71.45

    // TERRACE 2 — steeper ramp, higher step. x 78.20..82.20, top 2.10: crouch 79.43 /
    // walk 80.14 / run 81.16, worst margin 1.23 m. Gap 3.60 at +0.80 (run-safe 3.93).
    { kind: 'platform', p: [80.2, 1.6, 0], s: [4.0, 1, 5.2], mat: 'panel', glow: CYAN, stripe: true },

    { kind: 'platform', p: [86.15, 0.8, 0], s: [7.9, 1, 6.4], mat: 'stone', glow: DIM, stripe: true }, // flush at 82.20, 0.80 m DOWN — top 1.30, CP1; catches the sprint entry at 84.40

    { kind: 'deco', kindOf: 'rail', p: [53.6, 2.6, 3.0], s: [12.0, 0.08, 0.08], mat: 'metal', tint: MAG },
    { kind: 'deco', kindOf: 'rail', p: [53.6, 2.6, -3.0], s: [12.0, 0.08, 0.08], mat: 'metal', tint: MAG },
    { kind: 'deco', kindOf: 'post', p: [62.0, 2.3, -3.0], s: [0.2, 2.0, 0.2], count: 5, spread: [22, 0, 0], seed: 3101, tint: DIM },
    { kind: 'deco', kindOf: 'sign', p: [64.0, 3.6, -4.8], s: [0.25, 1.8, 3.4], mat: 'emissive', tint: HOT },
    { kind: 'light', p: [53.6, 3.8, 0], color: MAG, intensity: 10, distance: 26 },
    { kind: 'light', p: [70.4, 3.4, 0], color: CYAN, intensity: 8, distance: 22 },

    /* ============================================================================ */
    /* BEAT 4 — THE LASER CORRIDOR  (and the stage's first turn)                     */
    /* NEW MECHANIC. Thirty-five metres of walkway with a drop on both sides — but    */
    /* it does not run straight. It goes EAST 13 m, turns NORTH 8.6 m through a       */
    /* corner deck, then turns EAST again for another 13.4 m, 0.95 m higher up.       */
    /* Four beam installations, each escalating in exactly one dimension:             */
    /*                                                                               */
    /*   1. ONE beam at ankle height, 1.5 s on / 2.4 s off with a 0.8 s warning.      */
    /*      Stand and watch it. It is the most generous cycle in the world.           */
    /*   2. THREE ankle beams 2.6 m apart, staggered 0.9 s: a wave rolling at you.    */
    /*   3. THE CURTAIN, twice. Each is a lasergrid whose `offset` is [0,1,0], so its */
    /*      three beams stack VERTICALLY at 4.60 / 5.20 / 5.80 over a deck topping at */
    /*      3.30 — a wall of light from 1.20 m to 2.60 m above the floor, all three   */
    /*      beams on the same cycle (stagger 0) so it never opens a hole. Standing    */
    /*      head height is 5.10 and is inside it. Crouched head height is 4.35 and    */
    /*      clears the bottom beam by 0.15 m. Jumping needs your FEET above 5.90, i.e.*/
    /*      2.60 m over the deck, against an apex of 2.089 — and a crouch-jump only   */
    /*      shortens the body, it does not lift it. CTRL is not a suggestion here;    */
    /*      it is the only solution the geometry admits.                              */
    /*   4. TWO ankle beams, 0.9 s on / 1.5 s off, staggered 0.75 s — the tempo the   */
    /*      rest of the stage is going to use.                                        */
    /*                                                                               */
    /* Every beam's a/b span exceeds the deck it crosses (±2.7 over a ±2.3 deck; the  */
    /* corner beams run x 100.5..105.7 over a deck spanning 101.3..105.1; the north   */
    /* leg's beams run z 6.0..11.2 over a deck spanning 6.4..10.8), so no beam in     */
    /* this corridor has a walk-around.                                               */
    /* ============================================================================ */

    { kind: 'platform', p: [98.6, 1.85, 0], s: [13.0, 1, 4.6], mat: 'metal', glow: DIM, stripe: true }, // gap 2.00 at +1.05, top 2.35

    { kind: 'laser', a: [94.6, 2.6, -2.7], b: [94.6, 2.6, 2.7], radius: 0.1, color: HOT, cycle: { on: 1.5, off: 2.4, warn: 0.8, phase: 0 } },

    {
      kind: 'lasergrid',
      a: [99.8, 2.6, -2.7],
      b: [99.8, 2.6, 2.7],
      count: 3,
      spacing: 2.6,
      offset: [1, 0, 0], // the rack marches ALONG the corridor: beams at x 97.2 / 99.8 / 102.4
      stagger: 0.9,
      radius: 0.1,
      color: HOT,
      cycle: { on: 1.0, off: 2.0, warn: 0.5, phase: 0.5 },
    },

    // -- the alcove (COIN 3), south side --------------------------------------
    { kind: 'platform', p: [97.0, 1.85, -6.8], s: [2.8, 1, 2.8], mat: 'panel', glow: MAG, stripe: true }, // 3.10 m south of the corridor, level
    { kind: 'laser', a: [97.0, 2.65, -2.6], b: [97.0, 2.65, -5.6], radius: 0.09, color: MAG, cycle: { on: 1.7, off: 1.3, warn: 0.45, phase: 0.3 } },
    { kind: 'deco', kindOf: 'ring', p: [97.0, 3.35, -6.8], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: MAG },
    { kind: 'light', p: [97.0, 3.9, -6.8], color: MAG, intensity: 7, distance: 14 },

    // -- the corner: the route turns north -------------------------------------
    { kind: 'platform', p: [103.2, 1.85, 6.6], s: [3.8, 1, 8.6], mat: 'metal', glow: DIM }, // flush with the east leg at z 2.3, top 2.35
    { kind: 'laser', a: [100.5, 2.6, 4.4], b: [105.7, 2.6, 4.4], radius: 0.1, color: HOT, cycle: { on: 1.1, off: 1.6, warn: 0.5, phase: 0.85 } },
    { kind: 'laser', a: [100.5, 2.6, 9.0], b: [105.7, 2.6, 9.0], radius: 0.1, color: HOT, cycle: { on: 1.1, off: 1.6, warn: 0.5, phase: 2.15 } },

    // -- the north leg: the curtains -------------------------------------------
    { kind: 'platform', p: [113.4, 2.8, 8.6], s: [13.4, 1, 4.4], mat: 'metal', glow: DIM, stripe: true }, // gap 1.60, +0.95, top 3.30

    {
      kind: 'lasergrid',
      a: [110.0, 5.2, 6.0],
      b: [110.0, 5.2, 11.2],
      count: 3,
      spacing: 0.6,
      offset: [0, 1, 0], // STACKED VERTICALLY: beams at y 4.05 / 4.65 / 5.25 — a curtain, not a rack
      stagger: 0, // all three fire together; the wall never opens a gap
      radius: 0.1,
      color: HOT,
      cycle: { on: 1.6, off: 2.2, warn: 0.6, phase: 0 },
    },
    {
      kind: 'lasergrid',
      a: [114.8, 5.2, 6.0],
      b: [114.8, 5.2, 11.2],
      count: 3,
      spacing: 0.6,
      offset: [0, 1, 0],
      stagger: 0,
      radius: 0.1,
      color: HOT,
      cycle: { on: 1.6, off: 2.2, warn: 0.6, phase: 1.9 }, // 1.9 s out of phase: they alternate, and crouch speed 4.2 m/s covers the 4.8 m between them in 1.14 s
    },
    {
      kind: 'lasergrid',
      a: [118.4, 3.6, 6.0],
      b: [118.4, 3.6, 11.2],
      count: 2,
      spacing: 3.0,
      offset: [1, 0, 0], // beams at x 116.9 / 119.9 — stand up again, and run
      stagger: 0.75,
      radius: 0.1,
      color: HOT,
      cycle: { on: 0.9, off: 1.5, warn: 0.4, phase: 0.6 },
    },

    { kind: 'platform', p: [126.7, 2.8, 8.6], s: [6.4, 1, 6.6], mat: 'stone', glow: DIM, stripe: true }, // gap 3.40, top 3.30 — CP2

    { kind: 'text', p: [90.6, 4.0, 0], rot: [0, -Math.PI / 2, 0], text: 'CUTTING FLOOR', size: 0.52, color: HOT },
    { kind: 'text', p: [90.6, 3.45, 0], rot: [0, -Math.PI / 2, 0], text: 'the strobe is the one about to fire', size: 0.24, color: 0x6f8dac },
    { kind: 'text', p: [107.6, 4.4, 5.2], rot: [0, -Math.PI / 2, 0], text: 'CROUCH', size: 0.42, color: AMBER },
    { kind: 'text', p: [107.6, 3.9, 5.2], rot: [0, -Math.PI / 2, 0], text: 'you cannot jump a curtain', size: 0.22, color: 0x6f8dac },
    { kind: 'deco', kindOf: 'grate', p: [98.6, 1.05, 0], s: [13.0, 0.12, 4.4], mat: 'grate', tint: DIM },
    { kind: 'deco', kindOf: 'grate', p: [113.4, 2.0, 8.6], s: [13.4, 0.12, 4.2], mat: 'grate', tint: DIM },
    { kind: 'deco', kindOf: 'pipe', p: [104.0, 7.6, -7.6], s: [30.0, 0.6, 0.6], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'pipe', p: [112.0, 8.2, 15.4], s: [26.0, 0.6, 0.6], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'buttress', p: [92.6, 6.0, 4.2], s: [1.2, 3.2, 1.2], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [104.4, 6.2, -4.2], s: [1.2, 3.2, 1.2], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [119.0, 6.4, 12.6], s: [1.2, 3.2, 1.2], mat: 'obsidian' },
    { kind: 'light', p: [98.6, 4.6, 0], color: HOT, intensity: 9, distance: 22, flicker: 0.09 },
    { kind: 'light', p: [112.4, 5.4, 8.6], color: HOT, intensity: 9, distance: 22, flicker: 0.09 },

    /* ============================================================================ */
    /* BEAT 5 — THE RIDE  (mover + laser + vanish, combined)                         */
    /* The shuttle is not a lift, it is the way home: it carries you 6.2 m east AND   */
    /* 8.6 m south, off the dog-leg and back onto the centre line, on a 7.2 s cycle   */
    /* with a 0.9 s dwell at each end. A beam gate crosses the middle of that run at  */
    /* 2.2 s on / 1.0 s off — safe 31% of the time, so waiting it out on a deck that  */
    /* is going to arrive anyway is not an option: you jump the gate from a floor     */
    /* that is moving diagonally. The gate is 9.16 m long, laid perpendicular to the  */
    /* run (its direction dotted with the travel direction is -0.006), across a       */
    /* platform whose diagonal is 6.23 m — there is no corner of the shuttle it does  */
    /* not cover.                                                                     */
    /*                                                                               */
    /* Then three vanish tiles — different size, different height, different lateral  */
    /* offset, different cycle — each with its own beam skimming 0.35 m above it,     */
    /* phased so a beam fires while its tile is still solid. The tile says go, the    */
    /* beam says wait, and exactly one of them is lying at any given moment.          */
    /* ============================================================================ */

    {
      kind: 'mover',
      p: [133.8, 2.8, 8.6],
      s: [4.2, 1, 4.6],
      mat: 'metal',
      motion: { type: 'linear', to: [140.0, 2.8, 0.0], period: 7.2, phase: 0, ease: 'sine', dwell: 0.9 },
    }, // board 1.80 m off CP2; 10.6 m of diagonal travel; top 3.30 at both poses

    // the gate: perpendicular to the shuttle's diagonal, at its midpoint, 0.35 m up
    { kind: 'laser', a: [132.4, 3.65, 1.6], b: [139.8, 3.65, 7.0], radius: 0.1, color: HOT, cycle: { on: 2.2, off: 1.0, warn: 0.45, phase: 0 } },

    { kind: 'platform', p: [147.5, 1.9, 0], s: [5.6, 1, 5.6], mat: 'stone', glow: DIM, stripe: true }, // gap 2.60 off the shuttle's far pose, -0.90, top 2.40 — CP3

    { kind: 'vanish', p: [155.4, 1.9, 0], s: [4.4, 1, 3.4], mat: 'panel', cycle: { on: 1.9, off: 1.7, warn: 0.55, phase: 0.0 } }, // gap 2.90, level — solid 59%
    { kind: 'vanish', p: [162.0, 2.55, 2.2], s: [3.6, 1, 3.2], mat: 'panel', cycle: { on: 1.7, off: 1.9, warn: 0.5, phase: 0.34 } }, // gap 2.60, +0.65, 2.2 m north — solid 54%
    { kind: 'vanish', p: [168.4, 2.1, -1.8], s: [3.2, 1, 3.6], mat: 'panel', cycle: { on: 1.6, off: 1.9, warn: 0.5, phase: 0.67 } }, // diagonal 3.06, -0.45 — solid 53%

    { kind: 'laser', a: [155.4, 2.75, -2.6], b: [155.4, 2.75, 2.6], radius: 0.09, color: HOT, cycle: { on: 1.2, off: 2.1, warn: 0.5, phase: 0.0 } },
    { kind: 'laser', a: [162.0, 3.4, -0.6], b: [162.0, 3.4, 5.0], radius: 0.09, color: HOT, cycle: { on: 1.2, off: 2.1, warn: 0.5, phase: 1.1 } },
    { kind: 'laser', a: [168.4, 2.95, -4.6], b: [168.4, 2.95, 1.0], radius: 0.09, color: HOT, cycle: { on: 1.2, off: 2.1, warn: 0.5, phase: 2.2 } },

    { kind: 'platform', p: [176.4, 2.9, 0], s: [5.6, 1, 6.0], mat: 'stone', glow: DIM, stripe: true }, // gap 3.60, +0.80, top 3.40 — CP4

    { kind: 'text', p: [122.0, 4.9, 8.6], rot: [0, -Math.PI / 2, 0], text: 'RIDE IT ANYWAY', size: 0.46, color: MAG },
    { kind: 'deco', kindOf: 'rail', p: [136.0, 3.0, 12.0], s: [16.0, 0.08, 0.08], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'monolith', p: [158.0, 9.0, 14.0], s: [6.0, 16.0, 6.0], mat: 'obsidian', tint: 0x16304e },
    { kind: 'deco', kindOf: 'screen', p: [158.0, 9.4, 10.6], s: [0.35, 5.4, 7.4], mat: 'emissive', tint: 0x8a3fa8 },
    { kind: 'deco', kindOf: 'antenna', p: [149.0, 8.0, -12.6], s: [0.5, 15.0, 0.5], mat: 'metal', tint: DIM },
    { kind: 'light', p: [136.1, 5.4, 4.3], color: HOT, intensity: 10, distance: 22 },
    { kind: 'light', p: [162.0, 5.0, 0], color: AMBER, intensity: 9, distance: 26, flicker: 0.1 },

    /* ============================================================================ */
    /* BEAT 6 — THE LANTERN PAVILION  (breather, and the only architecture)          */
    /* Nothing here is on a timer — BEAT 5 was two clocks and BEAT 7 is a third, and  */
    /* those two must not touch. But this is not fifteen metres of the same deck with */
    /* a rail and the word BREATHE on it. There is no straight line through it: the   */
    /* gallery floor at 3.40 does not reach the cog mouth at 4.05, because they are   */
    /* 11.4 m apart. THE ONLY ROUTE IS THROUGH THE BUILDING.                          */
    /*                                                                               */
    /*   walk OFF the gallery, 0.80 m DOWN onto the south terrace (2.60) — the view,  */
    /*     out over thirty storeys of rain, with a rail to stand at                   */
    /*   climb the stair that wraps the lantern column: 3.15, then 4.10               */
    /*   cross the ROOF at 5.70 — 2.30 m ABOVE the floor you came in on               */
    /*   step off the roof's east edge and drop 1.65 m to the cog mouth               */
    /*                                                                               */
    /* Down, around, up, over and down again: 3.40 -> 2.60 -> 5.70 -> 4.05, inside    */
    /* 21 m. It is the one place in the stage you can look back at.                   */
    /*                                                                               */
    /* COIN 4 is pad-only, and that is arithmetic rather than opinion: the perch is   */
    /* 2.40 m above the roof and a standing jump apexes at 2.089, so `reachcheck`     */
    /* itself can only reach it through the pad's `pad` edge. The pad throws you      */
    /* straight up and the perch is 3.40 m NORTH of the pad, so you turn in the air.  */
    /* ============================================================================ */

    { kind: 'platform', p: [178.0, 2.1, -6.6], s: [8.4, 1, 5.2], mat: 'stone', glow: DIM }, // the terrace: 1.00 m south, 0.80 m DOWN, top 2.60
    { kind: 'platform', p: [184.9, 2.65, -6.0], s: [2.6, 1, 2.6], mat: 'panel', glow: CYAN, stripe: true }, // stair 1: gap 1.40, +0.55, top 3.15
    { kind: 'platform', p: [187.4, 3.6, -0.8], s: [2.6, 1, 2.6], mat: 'panel', glow: CYAN, stripe: true }, // stair 2: gap 2.60 north, +0.95, top 4.10
    { kind: 'platform', p: [186.6, 5.2, 4.0], s: [4.4, 1, 4.0], mat: 'stone', glow: DIM, stripe: true }, // the roof: gap 1.50 north, +1.60, top 5.70

    { kind: 'jumppad', p: [186.6, 5.77, 4.0], s: [2.4, 0.14, 2.4], power: 3.4, dir: [0, 1, 0] }, // apex 3.4 m over the roof
    { kind: 'platform', p: [187.2, 7.6, 9.8], s: [2.4, 1, 2.4], mat: 'panel', glow: MAG, stripe: true }, // the perch: 3.40 m north of the pad, +2.40 over the roof — top 8.10

    { kind: 'platform', p: [192.8, 3.55, 0], s: [4.4, 1, 5.0], mat: 'stone', glow: DIM, stripe: true }, // off the roof: gap 1.80, -1.65, top 4.05 — CP5

    { kind: 'deco', kindOf: 'pillar', p: [186.6, 4.0, 0.4], s: [1.6, 8.0, 1.6], mat: 'obsidian' }, // the lantern column the stair wraps
    { kind: 'deco', kindOf: 'arch', p: [186.6, 8.2, 4.0], s: [1.0, 0.8, 6.0], mat: 'metal', tint: DIM }, // the pavilion's roof beam, 2.5 m over the roof deck
    { kind: 'deco', kindOf: 'emblem', p: [186.6, 9.2, 0.4], s: [0.2, 1.8, 1.8], mat: 'emissive', tint: AMBER }, // the lantern itself
    { kind: 'deco', kindOf: 'ring', p: [187.2, 9.1, 9.8], s: [0.12, 2.4, 2.4], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: MAG },
    { kind: 'deco', kindOf: 'rail', p: [178.0, 3.2, -9.0], s: [8.0, 0.09, 0.09], mat: 'metal', tint: CYAN },
    { kind: 'deco', kindOf: 'brazier', p: [174.6, 3.5, -8.2], s: [0.9, 1.2, 0.9], mat: 'metal', tint: AMBER },
    { kind: 'deco', kindOf: 'banner', p: [182.0, 4.6, -8.8], s: [0.1, 3.0, 1.8], mat: 'panel', tint: MAG },
    { kind: 'text', p: [175.4, 4.4, -8.9], rot: [0, -Math.PI / 2, 0], text: 'BREATHE', size: 0.4, color: CYAN },
    { kind: 'text', p: [181.0, 4.0, -4.4], rot: [0, -Math.PI / 2, 0], text: 'the only way on is up', size: 0.22, color: 0x6f8dac },
    { kind: 'light', p: [174.6, 4.4, -8.2], color: AMBER, intensity: 7, distance: 15, flicker: 0.3 },
    { kind: 'light', p: [186.6, 9.6, 0.4], color: AMBER, intensity: 10, distance: 20 },
    { kind: 'light', p: [187.2, 10.0, 9.8], color: MAG, intensity: 8, distance: 16 },

    /* ============================================================================ */
    /* BEAT 7 — THE COG, THEN THE MILLS  (rotor alone -> rotor OVER vanish)          */
    /* Two halves, deliberately separated.                                           */
    /*                                                                               */
    /* THE COG is not a square. It is two overlapping slabs — 9.6 x 6.0 crossed with  */
    /* 6.0 x 9.6 — which makes an octagonal deck whose furthest point from the axle   */
    /* is a corner at r = 5.657. The three-armed bar reaches innerR 0.396 + len 5.0   */
    /* + 0.16 = r 5.556, and a player is 0.35 m wide, so the bar's solid arm covers   */
    /* every point out to r 5.906. THERE IS NO SAFE CORNER: the old 9.6 m square put  */
    /* its corners at r 6.788 and handed you four places to stand and watch. Now the  */
    /* refuge really is timing — a bar past your shins every 1.4 s, jumpable (the arm */
    /* tops out 0.93 m over the deck against an apex of 2.089) but never dodgeable.   */
    /* The bar is SOLID, not lethal (rotors.js:310 — a 'bar' without `kill` is a      */
    /* sweeper): it does not cut you, it puts you in the city.                        */
    /*                                                                               */
    /* THE MILLS are the combination the world has been building toward, and this     */
    /* time the blade covers the tile. A windmill's kill volume is one capsule per    */
    /* arm of radius max(thick, rootC*0.30) where rootC = max(0.45, height*2.6) and   */
    /* height defaults to `thick` (rotors.js:578, 621). At thick 0.4 that radius is   */
    /* 0.40 m and a 3.8 m tile has a 1.15 m safe lane down BOTH edges. At thick 0.9   */
    /* it is 0.90 m: lethal to |z| = 0.90 + 0.35 = 1.25, against tiles that are 2.4   */
    /* m wide (half 1.20). No lane, either side, on either mill — the same            */
    /* calculation BEAT 8's pendulums already passed.                                 */
    /*   M1 hub y 10.4: kill floor = 10.4 - (0.81 + 4.6) - 0.90 = 4.09, which is      */
    /*      0.04 m over a tile topping at 4.05.                                       */
    /*   M2 hub y  9.8: kill floor =  9.8 - (0.81 + 4.2) - 0.90 = 3.89, 0.04 m over   */
    /*      a tile topping at 3.85. It also turns the other way (`dir: -1`).          */
    /*                                                                               */
    /* AND THE THREE TILES ARE THREE DIFFERENT OBJECTS. 3.6x2.4 at 4.05 on a 3.20 m   */
    /* gap; 2.8x3.2 at 4.95, 1.9 m NORTH and 0.90 m UP, on a 3.00 m gap; 4.2x2.4 at   */
    /* 3.85, back south and 1.10 m DOWN, on a 2.10 m gap. Sizes, heights, offsets and */
    /* cycles all                                                                     */
    /* differ; the middle one is the rest between the blades.                         */
    /* ============================================================================ */

    { kind: 'platform', p: [201.8, 3.55, 0], s: [9.6, 1, 6.0], mat: 'stone', glow: DIM, stripe: true }, // the cog, long axis: gap 2.00, top 4.05
    { kind: 'platform', p: [201.8, 3.55, 0], s: [6.0, 1, 9.6], mat: 'stone', glow: DIM }, // the cog, cross axis — together an octagon, max r 5.657
    { kind: 'rotor', p: [201.8, 4.65, 0], style: 'bar', arms: 3, len: 5.0, thick: 0.44, period: 4.2, phase: 0.35, axis: [0, 1, 0] }, // solid arm to r 5.556; covers the deck to r 5.906

    { kind: 'vanish', p: [211.6, 3.55, 0], s: [3.6, 1, 2.4], mat: 'panel', cycle: { on: 1.7, off: 1.65, warn: 0.55, phase: 0.0 } }, // gap 3.20, top 4.05 — under mill 1, solid 58%
    { kind: 'vanish', p: [217.8, 4.45, 1.9], s: [2.8, 1, 3.2], mat: 'panel', cycle: { on: 2.0, off: 1.4, warn: 0.5, phase: 0.42 } }, // gap 3.00, +0.90, 1.9 m north — the rest, solid 64%
    { kind: 'vanish', p: [223.4, 3.35, -0.6], s: [4.2, 1, 2.4], mat: 'panel', cycle: { on: 1.5, off: 1.8, warn: 0.45, phase: 0.71 } }, // gap 2.10, -1.10 — under mill 2, solid 52%

    { kind: 'rotor', p: [211.6, 10.4, 0], style: 'windmill', arms: 3, len: 4.6, thick: 0.9, period: 5.6, phase: 0, axis: [0, 0, 1] }, // a blade every 1.87 s, lethal to |z| 1.25
    { kind: 'rotor', p: [223.4, 9.8, -0.6], style: 'windmill', arms: 2, len: 4.2, thick: 0.9, period: 4.4, phase: 0.4, dir: -1, axis: [0, 0, 1] }, // a blade every 2.20 s, turning the other way

    { kind: 'platform', p: [230.8, 4.0, 0], s: [5.6, 1, 6.2], mat: 'stone', glow: DIM, stripe: true }, // gap 2.50, +0.65, top 4.50 — CP6

    { kind: 'text', p: [195.6, 6.4, -4.6], rot: [0, -Math.PI / 2, 0], text: 'THE COG', size: 0.5, color: AMBER },
    { kind: 'text', p: [195.6, 5.9, -4.6], rot: [0, -Math.PI / 2, 0], text: 'nowhere on it is safe', size: 0.22, color: HOT },
    { kind: 'text', p: [207.0, 7.4, 0], rot: [0, -Math.PI / 2, 0], text: 'and now the floor goes too', size: 0.26, color: HOT },
    { kind: 'deco', kindOf: 'pillar', p: [201.8, 8.6, 0], s: [1.2, 6.4, 1.2], mat: 'obsidian' }, // the cog's axle
    { kind: 'deco', kindOf: 'ring', p: [201.8, 4.14, 0], s: [11.2, 0.06, 11.2], mat: 'emissive', tint: AMBER }, // the bar's reach, painted flat on the deck
    { kind: 'deco', kindOf: 'buttress', p: [211.6, 12.4, 3.6], s: [1.4, 2.6, 1.4], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [223.4, 11.8, 3.6], s: [1.4, 2.6, 1.4], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'cable', p: [217.0, 13.6, 0], s: [26.0, 0.08, 0.08], mat: 'metal', tint: 0x14283f },
    { kind: 'light', p: [201.8, 7.6, 0], color: AMBER, intensity: 11, distance: 22 },
    { kind: 'light', p: [217.8, 7.6, 0], color: AMBER, intensity: 10, distance: 24, flicker: 0.08 },

    /* ============================================================================ */
    /* BEAT 8 — CROSSFIRE                                                            */
    /* A 3.4 m bridge with no way round anything on it. Two pendulums swing ALONG the */
    /* stage axis (axis [0,0,1] runs the blade span across the bridge) on 3.2 s and   */
    /* 2.6 s, and two ankle beams sit under their arcs on a 2.6 s cycle staggered     */
    /* 0.7 s. Pivots at y 8.75 with 3.2 m arms and a 1.5 m blade put the lowest       */
    /* lethal point at 4.80 — 0.30 m over a deck at 4.50, so a blade takes your legs  */
    /* and a jump does not. The blade's kill box spans w*0.34 = 1.02 m along the      */
    /* swing axis with radius max(0.322, 0.45) = 0.45, i.e. lethal out to |z| = 1.47  */
    /* on a bridge that only reaches 1.70: to stand clear you would have to be at     */
    /* |z| >= 1.82 and there is no such place. Three timers, one lane, eleven metres. */
    /* ============================================================================ */

    { kind: 'platform', p: [239.0, 4.0, 0], s: [10.8, 1, 3.4], mat: 'metal', glow: CYAN }, // flush with CP6's deck, top 4.50

    { kind: 'pendulum', p: [236.6, 8.75, 0], len: 3.2, amp: 1.05, period: 3.2, phase: 0, blade: { w: 3.0, h: 1.5, d: 0.28 }, axis: [0, 0, 1] },
    { kind: 'pendulum', p: [242.0, 8.75, 0], len: 3.2, amp: 1.05, period: 2.6, phase: Math.PI * 0.5, blade: { w: 3.0, h: 1.5, d: 0.28 }, axis: [0, 0, 1] }, // a quarter-turn out of step, in RADIANS

    {
      kind: 'lasergrid',
      a: [239.3, 4.9, -1.8],
      b: [239.3, 4.9, 1.8],
      count: 2,
      spacing: 2.8,
      offset: [1, 0, 0], // beams at x 237.9 / 240.7 — one under each pendulum's arc
      stagger: 0.7,
      radius: 0.09,
      color: HOT,
      cycle: { on: 1.0, off: 1.6, warn: 0.4, phase: 0.25 },
    },

    { kind: 'platform', p: [250.8, 4.4, 0], s: [7.2, 1, 7.6], mat: 'stone', glow: DIM, stripe: true }, // gap 2.80, +0.40, top 4.90

    { kind: 'text', p: [233.0, 6.9, -2.2], rot: [0, -Math.PI / 2, 0], text: 'CROSSFIRE', size: 0.46, color: HOT },
    { kind: 'deco', kindOf: 'arch', p: [236.6, 9.6, 0], s: [0.8, 0.7, 7.0], mat: 'metal', tint: DIM }, // the gantry the blades hang from
    { kind: 'deco', kindOf: 'arch', p: [242.0, 9.6, 0], s: [0.8, 0.7, 7.0], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'pillar', p: [236.6, 7.0, 3.5], s: [0.7, 5.2, 0.7], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [236.6, 7.0, -3.5], s: [0.7, 5.2, 0.7], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [242.0, 7.0, 3.5], s: [0.7, 5.2, 0.7], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [242.0, 7.0, -3.5], s: [0.7, 5.2, 0.7], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'rail', p: [239.0, 5.1, 1.8], s: [10.8, 0.08, 0.08], mat: 'metal', tint: HOT },
    { kind: 'deco', kindOf: 'rail', p: [239.0, 5.1, -1.8], s: [10.8, 0.08, 0.08], mat: 'metal', tint: HOT },
    { kind: 'light', p: [239.3, 6.6, 0], color: HOT, intensity: 12, distance: 22, flicker: 0.12 },

    /* ============================================================================ */
    /* BEAT 9 — SET-PIECE : THE DRUM                                                 */
    /* ---------------------------------------------------------------------------- */
    /* THE DRUM TURNS. Six panels ride a 7.4 m circle about an axle at x 272.0 on a   */
    /* 15.0 s revolution — `mover` / `motion.type:'circle'`, so the panels are        */
    /* landable everywhere on that circle, they yaw as they go, and they carry the    */
    /* player's facing round with them (controller.js:826, `_platformYawRate`). At    */
    /* t = 15k a panel sits at the west vertex, and the wheel runs WEST -> NORTH ->   */
    /* EAST. This is the only rotating floor in the world and it is the last thing    */
    /* in it.                                                                        */
    /*                                                                               */
    /* TWO LINES OFF IT, and the wheel decides which is faster:                       */
    /*   RIDE   stand still and let the panel carry you half a revolution to the east */
    /*          vertex: 7.5 s of doing nothing except surviving the sweeps.           */
    /*   HOP    jump forward station to station with the rotation — 60 degrees a hop, */
    /*          7.4 m centre to centre. Each panel's local X is TANGENTIAL and its    */
    /*          local Z is RADIAL (movers.js `sampleQuat` yaws a circle mover with    */
    /*          its own orbit angle), and the chord meets both at 30 degrees, so the  */
    /*          real edge-to-edge gap is 7.4 - 2*(0.866*w/2 + 0.5*d/2) = 2.5 m — well */
    /*          inside the 4.35 m run-safe envelope. Three hops and the wheel does    */
    /*          the rest: roughly half the time, and three chances to miss a deck     */
    /*          that is moving under you.                                             */
    /*                                                                               */
    /* THE SWEEPS ARE WAGS AND THIS BEAT IS DESIGNED FOR WAGS. lasers.js:1380 is      */
    /* `ang = sin(((t+phase)/period)*TAU) * arc*0.5` — a sinusoid, not a revolution:  */
    /* each beam is FASTEST through the middle of its arc and STALLS at the ends, and */
    /* that is the read the player is given. Each covers 207 degrees, so sweep 1      */
    /* (dir +X) owns the eastern two-thirds and sweep 2 (dir -X) owns the western     */
    /* two-thirds; between them nothing on the wheel is unswept, and the entry (west) */
    /* and exit (east) vertices each answer to exactly one beam.                      */
    /* THE DARK WINDOW NEVER SITS STILL. Sweep 1 swings on 6.6 s and fires on a       */
    /* 4.55 + 1.35 = 5.90 s cycle; sweep 2 swings on 5.4 s and fires on 4.70 + 1.35 = */
    /* 6.05 s. Neither ratio is 1:1 — a 6.6 s swing against a 6.6 s cycle at phase 0  */
    /* would park its blind spot on the same spoke for ever. These two beat against   */
    /* their own swing every 389 s and 653 s: there is no safe spoke, only a safe     */
    /* moment.                                                                       */
    /*                                                                               */
    /* THE EXIT IS A BLINK. Two static plates bridge the wheel to the launch runway   */
    /* and they are the most hostile vanish in the stage: solid 45.6% and 51.5% of    */
    /* the time (vanish.js:233 — `period = on + warn + off`, and the tile is solid    */
    /* through `on` AND `warn`). You come off a turning wheel onto a floor that is    */
    /* absent more than half the time.                                               */
    /*                                                                               */
    /* COIN 5 hangs 2.40 m north of the wheel's north vertex, over the drop, and the  */
    /* only way to it is to be standing on a panel at the moment that panel is north. */
    /* Take it and the wheel keeps turning without you.                               */
    /*                                                                               */
    /* Then: a 9.6 m runway, a ramp filling its last 2.8 m, and a 4.80 m drop-gap at  */
    /* -2.00 m onto the gate apron. The ramp fires at x 301.05 — 3.15 m before the    */
    /* lip — and throws crouch 310.41 / walk 311.27 / run 312.53 / sprint 314.26 onto */
    /* an apron that starts at 309.00, so the slowest entry the controller can make   */
    /* still lands 1.41 m inside it and the fastest is still 5.74 m short of the far  */
    /* rail. The gap under the arc is run-safe (4.80 <= 5.14 at -2.00), so nothing    */
    /* here needs a sprint — but you cannot reach the lip on foot to try one anyway.  */
    /* You do not walk to the end of NEON DOJO.                                      */
    /* ============================================================================ */

    { kind: 'platform', p: [258.6, 5.7, 0], s: [3.6, 1, 4.0], mat: 'metal', glow: CYAN, stripe: true }, // the gantry lip: gap 2.40, +1.30, top 6.20 — you DROP 0.85 m onto the wheel

    // -- the wheel. axle x 272.0, orbit radius 7.4, revolution 15.0 s, phases 1/6 apart --
    // phase is a FRACTION of a revolution; 0.75 puts a panel at the west vertex at t = 0.
    // DO NOT "tidy" `axis: 'y'` into `[0, 1, 0]`. movers.js reads it through readVec, which
    // ignores a string and falls back to (0,1,0) — identical at runtime — but reachcheck's
    // `rectsFor` tests `axis === 'y'` literally, and with an array it models the orbit as a
    // VERTICAL oscillation of +/-7.4 m and stops seeing the drum's four cardinal poses.
    // Six panels, six different footprints: the sizes vary so the ring never reads as one
    // stamped tile repeated (and so geomcheck's identical-obstacle run stays at 1).
    { kind: 'mover', p: [272.0, 4.85, 0], s: [3.8, 1, 3.4], mat: 'panel', motion: { type: 'circle', radius: 7.4, axis: 'y', period: 15.0, phase: 0.75 } }, // A — west at t=0, the entry
    { kind: 'mover', p: [272.0, 4.85, 0], s: [3.4, 1, 3.8], mat: 'panel', motion: { type: 'circle', radius: 7.4, axis: 'y', period: 15.0, phase: 0.9167 } }, // B — north-west
    { kind: 'mover', p: [272.0, 4.85, 0], s: [3.6, 1, 3.6], mat: 'panel', motion: { type: 'circle', radius: 7.4, axis: 'y', period: 15.0, phase: 0.0833 } }, // C — north-east
    { kind: 'mover', p: [272.0, 4.85, 0], s: [4.0, 1, 3.2], mat: 'panel', motion: { type: 'circle', radius: 7.4, axis: 'y', period: 15.0, phase: 0.25 } }, // D — east, the exit side
    { kind: 'mover', p: [272.0, 4.85, 0], s: [3.2, 1, 4.0], mat: 'panel', motion: { type: 'circle', radius: 7.4, axis: 'y', period: 15.0, phase: 0.4167 } }, // E — south-east
    { kind: 'mover', p: [272.0, 4.85, 0], s: [3.5, 1, 3.5], mat: 'panel', motion: { type: 'circle', radius: 7.4, axis: 'y', period: 15.0, phase: 0.5833 } }, // F — south-west

    { kind: 'platform', p: [272.0, 4.85, 12.8], s: [2.6, 1, 2.6], mat: 'obsidian', glow: MAG, stripe: true }, // COIN 5 outrigger: 2.40 m off the north vertex, top 5.35

    { kind: 'vanish', p: [285.0, 4.85, 0], s: [3.2, 1, 3.6], mat: 'panel', cycle: { on: 1.1, off: 1.85, warn: 0.45, phase: 0.0 } }, // gap 2.00 off the east vertex — solid 45.6%
    { kind: 'vanish', p: [290.4, 4.85, 0], s: [2.8, 1, 3.2], mat: 'panel', cycle: { on: 1.3, off: 1.6, warn: 0.4, phase: 0.45 } }, // gap 2.40 — solid 51.5%

    {
      kind: 'lasersweep',
      p: [272.0, 5.7, 0], // the axle, 0.35 m over the panels
      len: 9.6, // past the far corner of every panel: 7.4 + 2.0 of half-panel
      axis: [0, 1, 0],
      dir: [1, 0, 0], // centred on the EAST vertex
      arc: Math.PI * 1.15,
      period: 6.6,
      phase: 0,
      radius: 0.1,
      color: HOT,
      cycle: { on: 4.55, off: 1.35, warn: 0.45, phase: 0 }, // 5.90 s against a 6.6 s swing
    },
    {
      kind: 'lasersweep',
      p: [272.0, 5.7, 0],
      len: 9.6,
      axis: [0, 1, 0],
      dir: [-1, 0, 0], // centred on the WEST vertex, so the entry is covered too
      arc: Math.PI * 1.15,
      period: 5.4,
      phase: 1.7,
      radius: 0.1,
      color: MAG,
      cycle: { on: 4.7, off: 1.35, warn: 0.45, phase: 0.7 }, // 6.05 s against a 5.4 s swing
    },

    // The drum's structure: the axle, the two rim rings and the cradle. Every piece of
    // it is above head height, below the walk line, or beyond |z| = 15, so nothing here
    // can be mistaken for a panel.
    { kind: 'deco', kindOf: 'pillar', p: [272.0, 9.9, 0], s: [1.4, 7.0, 1.4], mat: 'obsidian' }, // the axle
    { kind: 'deco', kindOf: 'ring', p: [272.0, 8.7, 0], s: [18.4, 0.24, 18.4], mat: 'emissive', tint: MAG }, // the rim, overhead
    { kind: 'deco', kindOf: 'ring', p: [272.0, 2.5, 0], s: [18.4, 0.24, 18.4], mat: 'emissive', tint: CYAN }, // and its twin, well under the panels
    { kind: 'deco', kindOf: 'arch', p: [272.0, 12.9, 0], s: [1.2, 1.0, 21.0], mat: 'metal', tint: DIM }, // the cradle
    { kind: 'deco', kindOf: 'pillar', p: [272.0, 10.9, 16.0], s: [1.3, 9.0, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [272.0, 10.9, -16.0], s: [1.3, 9.0, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'ring', p: [272.0, 6.35, 12.8], s: [0.12, 2.0, 2.0], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: MAG },
    { kind: 'text', p: [254.8, 7.4, 0], rot: [0, -Math.PI / 2, 0], text: 'THE DRUM', size: 0.62, color: MAG },
    { kind: 'text', p: [254.8, 6.75, 0], rot: [0, -Math.PI / 2, 0], text: 'ride it, or beat it round', size: 0.24, color: 0x6f8dac },
    { kind: 'light', p: [272.0, 7.6, 0], color: MAG, intensity: 16, distance: 30 },
    { kind: 'light', p: [265.6, 7.0, -4.4], color: HOT, intensity: 8, distance: 18, flicker: 0.1 },
    { kind: 'light', p: [278.4, 7.0, 4.4], color: CYAN, intensity: 8, distance: 18 },

    // -- the launch ---------------------------------------------------------------
    { kind: 'platform', p: [299.4, 5.8, 0], s: [9.6, 1, 5.2], mat: 'metal', glow: CYAN, stripe: true }, // gap 2.80 off the second plate, +0.95, top 6.30 — CP8
    { kind: 'speedpad', p: [302.8, 6.37, 0], s: [2.8, 0.14, 5.2], dir: [2, 1, 0], power: 17 }, // fills x 301.4..304.2 — the whole lip; fires at x 301.05
    { kind: 'text', p: [295.0, 8.35, 0], rot: [0, -Math.PI / 2, 0], text: 'DO NOT STOP', size: 0.54, color: MAG },
    { kind: 'text', p: [295.0, 7.85, 0], rot: [0, -Math.PI / 2, 0], text: 'and do not jump', size: 0.24, color: HOT },

    // THE GATE APRON — x 309.00..312.40, top 4.30, narrower in z than the deck behind
    // it so the flight reads as landing INTO the gate rather than onto another slab.
    // It catches crouch 310.41 / walk 311.27 / run 312.53; the sprint carries through
    // to 314.26 on the finish deck, which is flush with it at the same 4.30.
    { kind: 'platform', p: [310.7, 3.8, 0], s: [3.4, 1, 6.0], mat: 'metal', glow: CYAN, stripe: true },

    { kind: 'platform', p: [316.2, 3.8, 0], s: [7.6, 1, 8.4], mat: 'obsidian', glow: MAG, stripe: true }, // flush at 312.40, top 4.30 — the finish deck

    // The gate is built low and wide so all of it is inside your view for the whole
    // flight: you should be able to see where you are going to land the instant the
    // ramp lets go of you.
    { kind: 'deco', kindOf: 'arch', p: [316.2, 9.75, 0], s: [1.4, 1.1, 9.6], mat: 'obsidian', tint: MAG },
    { kind: 'deco', kindOf: 'pillar', p: [316.2, 7.25, 4.6], s: [1.3, 5.9, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [316.2, 7.25, -4.6], s: [1.3, 5.9, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'beacon', p: [319.8, 6.55, 0], s: [0.7, 3.0, 0.7], mat: 'emissive', tint: MAG },
    { kind: 'deco', kindOf: 'emblem', p: [316.2, 7.95, 0], s: [0.2, 2.0, 2.0], mat: 'emissive', tint: CYAN },
    { kind: 'text', p: [313.4, 6.75, 0], rot: [0, -Math.PI / 2, 0], text: 'OVERCLOCK', size: 0.44, color: MAG },
    { kind: 'light', p: [316.2, 8.15, 0], color: MAG, intensity: 22, distance: 34 },

    /* ============================================================================ */
    /* THE CITY — every piece of it is at |z| >= 17 or below y = -4, i.e. outside     */
    /* every play corridor on the stage: the dog-leg's north leg at z 10.8, the drum's*/
    /* 18.4 m span and the two coin spurs that reach out to z 12.8 included. Towers   */
    /* grow taller as the course runs east so the skyline keeps pace with the         */
    /* difficulty, and the holo-panels are the only saturated magenta that is not     */
    /* trying to kill you — which is why every lethal thing in this stage is HOT and  */
    /* nothing else in it is.                                                         */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'monolith', p: [50, -14, 34], s: [10, 34, 10], count: 8, spread: [110, 24, 20], seed: 9101, tint: DEEP },
    { kind: 'deco', kindOf: 'monolith', p: [50, -16, -34], s: [10, 34, 10], count: 8, spread: [110, 24, 20], seed: 9102, tint: DEEP },
    { kind: 'deco', kindOf: 'monolith', p: [185, -10, 36], s: [12, 44, 12], count: 8, spread: [130, 30, 22], seed: 9103, tint: 0x16304e },
    { kind: 'deco', kindOf: 'monolith', p: [185, -12, -36], s: [12, 44, 12], count: 8, spread: [130, 30, 22], seed: 9104, tint: 0x16304e },
    { kind: 'deco', kindOf: 'monolith', p: [296, -8, 40], s: [13, 50, 13], count: 5, spread: [70, 30, 20], seed: 9105, tint: 0x1a3a5c },
    { kind: 'deco', kindOf: 'monolith', p: [296, -10, -40], s: [13, 50, 13], count: 5, spread: [70, 30, 20], seed: 9106, tint: 0x1a3a5c },

    { kind: 'deco', kindOf: 'antenna', p: [160, 2, 30], s: [0.6, 22, 0.6], count: 7, spread: [280, 10, 14], seed: 9201, tint: DIM },
    { kind: 'deco', kindOf: 'antenna', p: [160, 0, -30], s: [0.6, 22, 0.6], count: 7, spread: [280, 10, 14], seed: 9202, tint: DIM },
    { kind: 'deco', kindOf: 'panel', p: [62, 15, 17.0], s: [0.3, 6.0, 9.0], mat: 'emissive', tint: MAG }, // holo-billboards, all far above head height
    { kind: 'deco', kindOf: 'panel', p: [130, 16, -17.0], s: [0.3, 7.0, 10.0], mat: 'emissive', tint: 0x8a3fa8 },
    { kind: 'deco', kindOf: 'panel', p: [222, 17, 18.0], s: [0.3, 7.0, 11.0], mat: 'emissive', tint: MAG },
    { kind: 'deco', kindOf: 'panel', p: [302, 18, -19.0], s: [0.3, 8.0, 12.0], mat: 'emissive', tint: 0x8a3fa8 },
    { kind: 'deco', kindOf: 'cable', p: [158, 20.0, 13.0], s: [300, 0.09, 0.09], mat: 'metal', tint: 0x0e1e33 },
    { kind: 'deco', kindOf: 'cable', p: [158, 23.0, -14.0], s: [300, 0.09, 0.09], mat: 'metal', tint: 0x0e1e33 },
    { kind: 'deco', kindOf: 'cloud', p: [158, -26, 0], s: [22, 3, 22], count: 16, spread: [320, 12, 110], seed: 9301, scale: 2.0, tint: 0x1b3c5e },

    // Path lights, roughly one per beat, so the whole course reads as a single line of
    // light from the boot deck. You can see the drum turning from two hundred metres away.
    { kind: 'light', p: [30, 3.4, 0], color: CYAN, intensity: 6, distance: 24 },
    { kind: 'light', p: [86, 3.4, 0], color: CYAN, intensity: 7, distance: 22 },
    { kind: 'light', p: [126, 5.0, 8.6], color: CYAN, intensity: 7, distance: 22 },
    { kind: 'light', p: [176, 5.4, 0], color: CYAN, intensity: 7, distance: 24 },
    { kind: 'light', p: [231, 6.6, 0], color: CYAN, intensity: 8, distance: 24 },
    { kind: 'light', p: [258, 7.4, 0], color: CYAN, intensity: 9, distance: 24 },
    { kind: 'light', p: [299, 8.95, 0], color: CYAN, intensity: 9, distance: 26 },
  ],
};
