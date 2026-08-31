/**
 * ASCENDANT — FROZEN SPIRE 3 : "WHITEOUT"
 * runtime/data/stages/spire-3.js
 *
 * The world's finale. The last ridge of a mountain that is coming apart: it opens with
 * the collapse already at your heels and finishes on two great wheels of turning ice
 * above a 26 m drop.
 *
 * BEATS      1 LANDFALL       ice drift, a crack-step, one sprint leap   (the wall arms)
 *            2 THE CORNICE    vanishing ice, a blade and a saw in the gaps
 *            3 THE THROAT     a crouch crawl out along a 0.9 m beam      (CROUCH + BEAM)
 *            4 THE UPDRAFT    the pad that throws you onto the shelf
 *            5 THE HANGING SHELF  the long descent-and-climb
 *            6 THE LEE        a roofed gallery you go INSIDE: bench, rotor, laser
 *            7 SERAC ALLEY    belt + two seracs that slam into the gaps
 *            8 THE CHIMNEY    a shaft you climb from the inside          (WALL-JUMP)
 *            9 WINDWARD CLIMB a static spine under two opposed gusts, machines in the gaps
 *           10 THE CROWN      two great wheels, each the only way across
 *
 * ---------------------------------------------------------------------------------
 * HOW THE NUMBERS IN THIS FILE WERE OBTAINED — read this before trusting any of them.
 * ---------------------------------------------------------------------------------
 * There is no `routecheck.mjs` in this repo. An earlier revision of this header cited
 * one and quoted a "MEASURED RHYTHM" from it — 40 hops, gap mean 2.16, sd 1.24, 23
 * distinct surface heights. The tool did not exist and none of those numbers had a
 * source. Everything quoted below comes from one of exactly three places, and every
 * claim says which:
 *
 *   [T]  runtime/core/tuning.js — the TUNE constants, quoted verbatim.
 *   [H]  `node _harness/reachcheck.mjs spire-3` and `node _harness/geomcheck.mjs
 *        spire-3` — harness output, pasted, not paraphrased.
 *   [A]  arithmetic done here from [T], with the formula shown so it can be re-run.
 *
 * [H] The current harness lines, in full:
 *
 *   id            len   obj  haz  cp  surf  orph  status
 *   spire-3       299.4   68   34   9    80     0  PASS      (reachcheck, no warnings)
 *   spire-3        162     29.1     47   0.71    2   PASS    (geomcheck, 2 warnings)
 *
 * `tightEdges: 0` in the reachcheck JSON is the one worth staring at: across all 80
 * landable surfaces there is not a single pair, in either direction, whose distance
 * falls in a full-stretch band — no `run-tight`, no `sprint-tight`, anywhere, not just
 * on the routed line. `orphanSurfaces: 0`: every surface on the stage, including both
 * roofs, all three walls of the Lee and both chimney walls, is reachable.
 *
 * A GREEN HARNESS LINE IS NOT A QUALITY CLAIM, and this file no longer pretends
 * otherwise. reachcheck models a jump as a point mass under an open sky: `rectsFor()`
 * builds surfaces from TOP FACES ONLY, `edge()` looks at horizontal gap and dy, and
 * every edge is evaluated at speedRun or speedSprint — never speedCrouch. It has no
 * head and no ceiling. So a PASS says nothing at all about a roofed beat.
 *
 * THE CEILING MATHS, from runtime/player/controller.js:1032 (`if (vel.y > 0) vel.y = 0`
 * on the frame `res.ceiling` is set) and :1282 `_resolveStance` (an airborne crouch
 * sets `wantTuck = FOOT_LIFT`, which lifts the FEET and pins the capsule top, so
 * ducking in the air buys no head clearance — and the grow-guard refuses the tuck
 * under a ceiling anyway): a jump taken with a ceiling `h` metres above the feet stops
 * rising after `h - 1.05` m when crouched and `h - 1.80` m when standing, and a player
 * who does not fit standing is moving at speedCrouch 4.2, not speedRun 8.6 [T].
 *
 *   [A] Under a 1.45 m roof: rise 0.40 m, vy zeroed at t = 0.0334 s, fall 0.1054 s,
 *       airtime 0.1388 s, reach 4.2 * 0.1388 = 0.58 m. A step, not a jump.
 *
 * THE RULE THIS STAGE FOLLOWS: no jump anywhere on it is taken from under a ceiling.
 * Under a roof you WALK, and the roof always ends before the edge you jump from.
 * `_harness/geomcheck.mjs` now measures this directly — the ROOFED JUMP check was
 * added with this revision, because the defect that motivated it (below) passed both
 * gates. spire-3 raises neither a problem nor a warning from it.
 *
 * ---------------------------------------------------------------------------------
 * AND NEITHER GATE LOADS THE STAGE. Both harnesses `import` this module and read the
 * object array; neither one calls `Stage.validate`. Running the stage in the engine
 * (`__dev.goto('spire-3')` against the dev server) is what found the defect that
 * mattered most: `stage.js:776` rejected `chase.axis: 'x'`, so `Stage.load` threw
 * "[Stage.validate spire-3] objects[6] (kind \"chase\"): \"axis\" must be \"y\" or \"z\",
 * got x" and THIS STAGE HAD NEVER LOADED. The previous revision carried the same
 * `axis: 'x'`, passed reachcheck and geomcheck, and was unplayable.
 *
 * chase.js implements 'x' end to end — axis resolution at :120, face size at :137,
 * front point at :175, kill half-extents at :328, the inside test at :417 — and its
 * own factory doc at :502 advertises `axis:'x'|'y'|'z'`. The validator, not the stage,
 * was wrong, so the validator was fixed (and CONTRACT section 18 with it) rather than
 * the collapse being bent onto an axis the stage does not run along. Live state after
 * the fix: `state: "playing", stageId: "spire-3", hazards: 34, colliders: 67,
 * checkpoints: 9, coins: 7`, zero console errors, zero page errors.
 *
 * The lesson is the same one as the ceiling: a gate that reads the data is not a gate
 * that runs the game. Load the stage before believing a PASS.
 *
 * ---------------------------------------------------------------------------------
 * CONVENTIONS (full list in runtime/data/index.js)
 * ---------------------------------------------------------------------------------
 *   p = CENTRE, s = FULL size, so a top surface is p[1] + s[1]/2 and an object spans
 *   x from p[0] - s[0]/2 to p[0] + s[0]/2. Every gap quoted below is EDGE TO EDGE.
 *   rot/yaw are radians; yaw 0 faces +X. `stripe: true` = "you must jump to get here".
 *   A mover's `p` is its HOME pose and `motion.to` its far pose — EXCEPT motion.type
 *   'circle', where `p` is the ORBIT CENTRE and the slab rides at `radius` from it.
 *
 *   NO OBJECT-INDEX LABELS. A previous revision carried per-object index comments and
 *   a ROUTE list built from them. The array had grown since they were written and
 *   every index was wrong by up to 26, so the "route" ran through text objects, lights
 *   and a laser. Indices rot the moment anything is inserted. Objects here are located
 *   by BEAT and by X, which do not. Both harnesses print real indices; read them there.
 *
 * ---------------------------------------------------------------------------------
 * THE THREE PHASE CONVENTIONS THE ENGINE ACTUALLY USES — checked, not remembered.
 * ---------------------------------------------------------------------------------
 * Three hazard families read `phase` and NONE of them agree. Getting it wrong does not
 * error; it silently ships a different stage.
 *
 *   FRACTION OF ONE CYCLE (0..1), wraps:
 *     vanish   — vanish.js:528   `fract(t / period + phase) * period`
 *     crusher  — crushers.js:326 `fract(t / period + phase)`
 *     mover 'circle' — movers.js:432 `TAU * (t / period + phase)` (fraction of a TURN)
 *   SECONDS:
 *     laser and spikes — lasers.js:617 `cycleState`: `shifted = t + phase`
 *     (spikes.js:258 calls that same shared `cycleState`)
 *   RADIANS:
 *     pendulum — pendulum.js:298 `num(def.phase, 0)` (`phaseCycles` is the /TAU form)
 *
 * The previous revision authored vanish phases of 1.1 / 2.3 / 1.5 believing they were
 * seconds. They shipped as 0.1 / 0.3 / 0.5, so the "ladder" of three offsets it
 * described was two tiles opening a third of a second apart. Every `phase` below is in
 * the unit its own family uses, and says so inline.
 *
 * ---------------------------------------------------------------------------------
 * THE COLLAPSE — what it measures, and what it deliberately does NOT.
 * ---------------------------------------------------------------------------------
 * A `chase` is a pure function of the stage clock (CONTRACT section 16), so the only
 * point where every player's clock and position agree is the spawn. Hence it runs the
 * opening. Per chase.js:168, `frontAt(t) = from + clamp((t - delay) * speed, 0, travel)`:
 *
 *   front(t) = 3 + clamp((t - 4.0) * 5.4, 0, 47)      // parks for good at x = 50.0
 *
 *   [A] It parks at t = 4.0 + 47/5.4 = 12.70 s, so the survival pace is 50.0/12.70 =
 *   3.94 m/s of X including airtime and aiming. TUNE.speedRun is 8.6 [T]. Paces of
 *   8.0 / 6.0 / 5.0 / 4.5 / 4.0 m/s are all at x 101.6 / 76.2 / 63.5 / 57.2 / 50.8 when
 *   it parks. It punishes dawdling and nothing else.
 *
 *   IT STOPS BEFORE THE CROUCH. The throat (BEAT 3) starts at x 55 and the wall parks
 *   at 50.0. An earlier revision ran the wall THROUGH the crouch crawl, where
 *   speedCrouch 4.2 [T] costs about 0.7 s over 5.6 m of roofed ledge — the whole of
 *   that revision's own stated survival margin, spent on a mechanic the stage forces on
 *   you, on a 0.8 m beam, with the nearest checkpoint 66 m back. A clock that punishes
 *   precision is not difficulty; it is a tax on the one thing the beat is teaching.
 *   Here the clock owns beats 1-2, which are open, wide and fast, and it is dead before
 *   the stage asks anyone to be careful.
 *
 *   THE Y BAND. p[1] 9 with s[1] 28 makes the lethal band y -5 .. 23, which covers
 *   every surface in beats 1-2 (y 0.5 .. 3.1). Nothing to duck under, nothing to climb.
 *
 * ---------------------------------------------------------------------------------
 * CHECKPOINTS — measured, and front-loaded onto the hard half.
 * ---------------------------------------------------------------------------------
 * [H] cpSpacing from reachcheck: 26.4 / 30.0 / 29.6 / 28.9 / 28.5 / 34.9 / 40.2 / 27.0 m,
 * with 31.6 m from the spawn to CP0 and 23.8 m from CP8 to the finish. Nine checkpoints
 * over 299.4 m.
 *
 * The previous revision left the hardest leg on the stage — spawn to CP0, 66.2 m and
 * 9 hops, containing the chase AND the vanish gauntlet AND the crouch beam — entirely
 * unchecked, and then spent a checkpoint 11.8 m from the finish, three 0.28 m hops out.
 * Here CP0 is on the far side of the opening sprint leap, CP1 is at the mouth of the
 * throat so the crouch beam costs 3 m of ground rather than a re-run of the collapse,
 * and CP8 sits on the crown's mid ridge so a missed second wheel costs the second wheel.
 *
 * clockOffset: CP0 opens at t = 6.0 with the wall at x 13.8, 17.8 m behind [A]. Every
 * later checkpoint opens at t = 13.0 — 0.30 s after the wall has parked for good, so it
 * is scenery grinding at x 50 and nothing past it is ever threatened again.
 *
 * ---------------------------------------------------------------------------------
 * TWO LAWS EVERY LANDING ON THIS STAGE OBEYS
 * ---------------------------------------------------------------------------------
 *   a) a landing onto a MOVING surface rises at most +0.5 m, so its face is under your
 *      eye (TUNE.eye 1.62 [T]) when you commit. Any landing that rises more than +1.4 m
 *      is onto a STATIC platform whose silhouette reads from the take-off.
 *   b) NO CEILING WITHIN 2.2 m OF A SURFACE YOU JUMP FROM. Where a roof is lower than
 *      that — the throat, at 1.45 m — the ground under it is CONTINUOUS: you crouch-walk
 *      it end to end and never jump. Where you jump from inside a building — the Lee —
 *      the roof stops 4.6 m short of the lip you leave from. This is the law neither
 *      gate could check until this revision; see the ceiling maths above.
 *
 * ICE + WIND LAW (controller.js frictionXZ floors the control term at STOP_SPEED 4.0,
 * so a STATIONARY player on ice decelerates at only 4.0 * TUNE.iceFriction 1.4 =
 * 5.6 m/s^2 [T][A]): the only wind a standing player can be inside is BEAT 9's low band
 * at power 4.6, under that 5.6. `WindHazard.apply` tests
 * `hz.box.containsPoint(state.pos)` (surfaces.js:1002) and `state.pos` is the capsule
 * BOTTOM, so a band whose floor is above a deck top cannot touch anyone standing on it.
 * Measured: BEAT 1's crosswind floors at y 2.00, which is 0.40 m over the highest ice
 * top under it (1.60); BEAT 9's 12 m/s^2 gust floors at y 23.40, 1.00 m over the highest
 * deck under it (22.40). Both own the air and neither owns the footing.
 */

const ICE = 0xa8e4ff; // world accent — safe ice, path lighting
const GLACIER = 0x5ac8f0; // theme accent — trim and signage
const HOT = 0xff5a3c; // killGlow — anything that ends the run
const GOLD = 0xffc94a; // safeEdge — every optional / coin line is gold, never blue
const DEEP = 0x2f74b0; // structural stone, background rock
const MINT = 0x00e59c; // checkpointOn

export default {
  id: 'spire-3',
  world: 'spire',
  name: 'WHITEOUT',
  subtitle: 'The mountain is leaving. Be ahead of it.',
  par: 208000,
  difficulty: 8,

  spawn: { p: [0, 0.6, 0], yaw: 0 },
  killY: -40,

  checkpoints: [
    // CP0 — the far side of the opening sprint leap. The wall is still moving here and
    // the offset re-opens it 17.8 m behind you, so a retry replays the leap, not the run.
    { p: [31.6, 1.5, 0], yaw: 0, clockOffset: 6 },
    // CP1 — the mouth of the throat. The crouch crawl and the beam are behind THIS.
    { p: [58.0, 2.7, 0], yaw: 0, clockOffset: 13 },
    // CP2 — the landing shelf. The pad launch is paid for once.
    { p: [88.0, 8.6, 0], yaw: 0, clockOffset: 13 },
    // CP3 — mid hanging shelf, before the vanish tile and the ferry.
    { p: [117.6, 9.1, 0], yaw: 0, clockOffset: 13 },
    // CP4 — the west porch of the Lee, before the rotor and the laser.
    { p: [146.5, 10.0, 0], yaw: 0, clockOffset: 13 },
    // CP5 — the head of serac alley, between the two seracs.
    { p: [175.0, 11.3, 0], yaw: 0, clockOffset: 13 },
    // CP6 — the chimney mouth, whichever of the two ways you climbed it.
    { p: [209.9, 18.9, 0], yaw: 0, clockOffset: 13 },
    // CP7 — the col, and the last thing on the stage that is not the crown.
    { p: [250.1, 23.1, 0], yaw: 0, clockOffset: 13 },
    // CP8 — the crown's mid ridge, between the two wheels. A missed second ride costs
    // the second ride: 18.9 m of open air and one wheel, not the whole finale.
    { p: [277.1, 24.7, 0], yaw: 0, clockOffset: 13 },
  ],

  finish: { p: [300.9, 25.9, 0], yaw: 0 },

  coins: [
    { p: [51.4, 4.0, 10.0] }, // 1 — BEAT 2, on the cornice tile hung out over nothing
    { p: [64.5, 5.5, 0] }, // 2 — BEAT 3, on TOP of the throat roof: the slow line
    { p: [134.6, 11.0, -9.6] }, // 3 — BEAT 5, a spur out over the drop
    { p: [150.2, 14.2, 0] }, // 4 — BEAT 6, on the Lee's roof, out of the shelter
    { p: [161.4, 11.9, -7.5] }, // 5 — BEAT 7, across the belt, and the belt pushes back
    { p: [223.3, 21.8, -3.6] }, // 6 — BEAT 9, over the sliding bridge's south pose
    { p: [262.9, 24.6, 6.0] }, // 7 — BEAT 10, ride wheel A's north quarter to get it
  ],

  objects: [
    /* ============================================================================ */
    /* BEAT 1 — LANDFALL                                       x -5 .. 34.4         */
    /* Five surfaces, five heights, four different jumps: a 0.60 m crack-step, a     */
    /* 2.80 m climb, a 2.62 m diagonal drop, then a 5.70 m SPRINT leap at +0.5.      */
    /* [A] The skip-one pairs are 6.60 / 7.90 / 11.00 m against sprint maxima of     */
    /* 6.38 / 7.10 / 6.38 m at their own dy, so none of them is an edge at all. The  */
    /* previous revision's opening pair (deck to the third tile, 5.90 m at +1.10,    */
    /* dead centre of the shifted run band) is gone: the tile moved 0.6 m out and    */
    /* the skip stopped existing.                                                    */
    /* ============================================================================ */

    { kind: 'platform', p: [1.5, 0, 0], s: [13, 1, 12], mat: 'stone', glow: DEEP }, // start deck, top 0.5

    { kind: 'ice', p: [10.2, 0, 0], s: [3.2, 1, 5.2] }, // gap 0.60 flat — a crack, not a jump
    { kind: 'ice', p: [16.2, 1.1, -3.0], s: [3.2, 1, 3.6] }, // gap 2.80 at +1.10, top 1.6
    { kind: 'ice', p: [21.4, 0.4, 2.6], s: [3.4, 1, 4.0] }, // gap 2.62 diagonal at -0.70, top 0.9
    { kind: 'platform', p: [31.6, 0.9, 0], s: [5.6, 1, 7.2], mat: 'stone', glow: MINT, stripe: true }, // gap 5.70 at +0.50 — SPRINT (CP0)

    { kind: 'wind', p: [19.0, 4.0, 0], s: [18, 4.0, 16], dir: [0, 0, -1], power: 9, color: ICE }, // floor y 2.0, above every ice top under it

    {
      kind: 'chase',
      axis: 'x',
      from: 3,
      to: 50,
      speed: 5.4,
      delay: 4.0,
      mat: 'void',
      p: [0, 9, 0],
      s: [2, 28, 44],
      color: HOT,
    },

    { kind: 'text', p: [-3.2, 2.9, 0], rot: [0, -Math.PI / 2, 0], text: 'WHITEOUT', size: 0.82, color: ICE },
    { kind: 'text', p: [-3.2, 2.25, 0], rot: [0, -Math.PI / 2, 0], text: 'FROZEN SPIRE  ·  III', size: 0.28, color: 0x6f93ac },
    { kind: 'text', p: [-3.2, 1.7, 0], rot: [0, -Math.PI / 2, 0], text: 'it is already behind you  ·  do not look', size: 0.24, color: HOT },
    { kind: 'text', p: [25.4, 2.6, -3.4], rot: [0, -Math.PI / 2, 0], text: 'SPRINT', size: 0.62, color: GOLD },
    { kind: 'text', p: [25.4, 2.0, -3.4], rot: [0, -Math.PI / 2, 0], text: '5.7 m  ·  a run tops out at 5.00', size: 0.22, color: 0x6f93ac },

    { kind: 'deco', kindOf: 'spires', p: [8.4, -3.4, 6.4], count: 9, spread: 3.4, scale: 3.2, seed: 3101, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [8.4, -3.4, -6.4], count: 9, spread: 3.4, scale: 3.2, seed: 3102, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'crystals', p: [15.0, -1.6, -5.6], count: 9, spread: 4.2, scale: 1.5, seed: 3103, mat: 'crystal' },
    { kind: 'deco', kindOf: 'crystals', p: [22.0, -1.6, 5.6], count: 9, spread: 4.2, scale: 1.5, seed: 3104, mat: 'crystal' },
    { kind: 'deco', kindOf: 'girders', p: [27.0, 7.4, 0], count: 5, spread: 4.6, scale: 2.6, seed: 3105, mat: 'metal' }, // gantry overhead, 6 m clear
    { kind: 'light', p: [8.4, 4.2, 0], color: ICE, intensity: 9, distance: 24 },
    { kind: 'light', p: [25.4, 3.6, 0], color: ICE, intensity: 7, distance: 26 },

    /* ============================================================================ */
    /* BEAT 2 — THE CORNICE                                    x 37.4 .. 52.8       */
    /* Three vanishing tiles on three periods — 3.9 / 3.6 / 4.1 s — and two machines */
    /* that own the GAPS rather than the tiles: a blade swinging across the corridor */
    /* at x 42.4 and a saw wheel spinning across it at x 48.1. Both use axis 'x', so */
    /* geomcheck's hazardSweep gives them rx 0.36 and 0.40 m — they are pinned       */
    /* inside a gap and cannot be inside a deck. The previous revision swung a blade */
    /* to y 1.50 over a tile topping at 1.60 and geomcheck called it: "the hazard is */
    /* inside the floor".                                                            */
    /*                                                                              */
    /* `phase` here is a FRACTION OF ONE CYCLE (vanish.js:528). The previous         */
    /* revision authored 1.1 / 2.3 / 1.5 believing they were seconds; they shipped   */
    /* as 0.1 / 0.3 / 0.5, so its "three tiles each on its own cycle" was two tiles  */
    /* opening within a third of a second of each other.                             */
    /* ============================================================================ */

    { kind: 'vanish', p: [39.2, 1.1, 0], s: [3.6, 1, 4.4], mat: 'ice', cycle: { on: 2.6, off: 1.3, warn: 0.6, phase: 0.0 } }, // gap 3.00 at +0.20, top 1.6
    { kind: 'pendulum', p: [42.4, 6.6, 0], len: 4.6, amp: 0.95, period: 3.0, phase: 0, axis: 'x', blade: { w: 2.6, h: 1.7, d: 0.32 } }, // `phase` RADIANS. Sweeps y 1.15 .. 4.77, filling the gap
    { kind: 'vanish', p: [45.3, 1.6, -2.9], s: [3.0, 1, 3.4], mat: 'ice', cycle: { on: 2.0, off: 1.6, warn: 0.45, phase: 0.37 } }, // gap 2.80 at +0.50, top 2.1
    { kind: 'rotor', p: [48.1, 4.4, 0.6], style: 'saw', arms: 3, len: 2.6, thick: 0.4, period: 2.2, phase: 0.6, axis: 'x' }, // lowest sweep y 1.60 — it eats the low half of the arc
    { kind: 'vanish', p: [51.0, 2.1, 2.6], s: [3.2, 1, 3.6], mat: 'ice', cycle: { on: 3.0, off: 1.1, warn: 0.7, phase: 0.72 } }, // gap 3.28 diagonal at +0.50, top 2.6

    // -- COIN 1: the optional cornice — 4.20 m north off the third tile and back.
    // A dead-end on a 4.0 s cycle: the coin is ON the tile, so the detour is priced
    // in the only currency this beat has. It also rejoins the throat ledge directly
    // (5.55 m, sprint) if you would rather not go back the way you came.
    { kind: 'vanish', p: [51.4, 2.1, 10.0], s: [2.8, 1, 2.8], mat: 'ice', cycle: { on: 1.7, off: 2.3, warn: 0.45, phase: 0.55 } },

    { kind: 'text', p: [35.4, 3.0, 0], rot: [0, -Math.PI / 2, 0], text: 'IT CRACKS UNDER YOU', size: 0.44, color: GLACIER },
    { kind: 'deco', kindOf: 'fins', p: [42.0, -2.6, -6.2], count: 9, spread: 5.0, scale: 2.6, seed: 3202, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'girders', p: [45.0, 9.4, 0], count: 6, spread: 5.5, scale: 2.4, seed: 3203, mat: 'metal' },
    { kind: 'deco', kindOf: 'crystals', p: [50.6, 1.4, 12.4], count: 5, spread: 1.6, scale: 1.1, seed: 3204, mat: 'crystal' },
    { kind: 'light', p: [45.3, 5.4, 0], color: HOT, intensity: 8, distance: 20, flicker: 0.14 },
    { kind: 'light', p: [52.4, 4.6, 10.0], color: GOLD, intensity: 8, distance: 16 },

    /* ============================================================================ */
    /* BEAT 3 — THE THROAT                                     x 55 .. 81           */
    /* The one place you must CROUCH and the one place you must walk a beam, and    */
    /* they are the same stretch of ground — with NO JUMP inside them. The ledge   */
    /* (x 55.00 .. 61.00) and the beam (x 61.00 .. 69.00) are CONTIGUOUS, edge to   */
    /* edge 0.00 m, both topping at 2.60, so the harness calls it a `step` and a    */
    /* player calls it a walk. The roof covers x 61.60 .. 67.40 — 5.80 m of crouch  */
    /* along the beam — and the beam then runs 1.60 m further in open sky before    */
    /* the 2.50 m jump to the launch deck.                                          */
    /*                                                                              */
    /* THIS IS THE DEFECT THIS BEAT EXISTS TO NOT HAVE. The previous revision put a */
    /* 1.80 m gap between ledge and beam and roofed the whole thing at 1.45 m. [A]  */
    /* Under a 1.45 m ceiling the head hits after 0.40 m of rise: controller.js:1032 */
    /* zeroes vy at t = 0.0334 s, the fall to the beam takes 0.1054 s, total airtime */
    /* 0.1388 s, and at speedCrouch 4.2 that is 0.58 m of reach against 1.80 m of   */
    /* gap. Not "hard" — arithmetically impossible at every speed the engine can    */
    /* produce, including speedAirCap 12.6 (1.75 m). Neither gate models a ceiling, */
    /* so both said PASS. Contiguous ground is the fix that cannot regress.         */
    /*                                                                              */
    /* COIN 2 is the roof itself: 0.5 m thick, top 1.95 m above the ledge, inside   */
    /* the 2.09 m apex [T][A]. Climb it and walk over the throat instead of         */
    /* crawling through it — it costs the climb and the drop off the far end. That  */
    /* is the trade, and it is why the roof is not an orphan surface.               */
    /* ============================================================================ */

    { kind: 'platform', p: [58.0, 2.1, 0], s: [6.0, 1, 7.0], mat: 'stone', glow: MINT, stripe: true }, // the throat ledge, top 2.6 (CP1)
    { kind: 'beam', p: [65.0, 2.45, 0], s: [8.0, 0.3, 0.9], mat: 'metal' }, // 0.9 m wide, top 2.6, CONTIGUOUS with the ledge
    { kind: 'platform', p: [64.5, 4.3, 0], s: [5.8, 0.5, 6.0], mat: 'obsidian', glow: DEEP }, // the roof: x 61.6 .. 67.4, underside 4.05, top 4.55 — COIN 2
    { kind: 'platform', p: [76.25, 1.5, 0], s: [9.5, 1, 8.0], mat: 'stone', glow: DEEP, stripe: true }, // the launch deck, gap 2.50 at -0.60, top 2.0

    { kind: 'text', p: [55.6, 3.9, 0], rot: [0, -Math.PI / 2, 0], text: 'D U C K', size: 0.66, color: GOLD },
    { kind: 'text', p: [55.6, 3.35, 0], rot: [0, -Math.PI / 2, 0], text: 'hold crouch and WALK  ·  the beam is 0.9 m wide', size: 0.22, color: 0x6f93ac },
    { kind: 'text', p: [59.0, 5.6, 0], rot: [0, -Math.PI / 2, 0], text: 'or climb over  ·  slower  ·  a coin up here', size: 0.2, color: GOLD },
    { kind: 'deco', kindOf: 'pipes', p: [64.5, 5.4, 2.4], count: 5, spread: 3.2, scale: 1.6, seed: 3301, mat: 'metal' },
    { kind: 'deco', kindOf: 'rocks', p: [65.0, -1.2, 0], count: 9, spread: 4.0, scale: 1.4, seed: 3302, mat: 'stone' },
    { kind: 'light', p: [64.5, 3.4, 0], color: HOT, intensity: 8, distance: 16, flicker: 0.18 },
    { kind: 'light', p: [74.0, 4.4, 0], color: ICE, intensity: 8, distance: 20 },

    /* ============================================================================ */
    /* BEAT 4 — THE UPDRAFT                                    x 77.4 .. 94          */
    /* A PAD IS NOT A JUMP: it adds nothing horizontal, so the arc is fixed and the  */
    /* only variable is the speed you carried on. reachcheck.mjs models exactly that */
    /* (`padSpan` / WALK 6.0 / HELD 1.25) and warns if the deck fails to swallow the */
    /* whole entry-speed band. [A] From this pad the band is 5.39 m (a walked entry) */
    /* to 13.14 m (a sprint entry with jump held), from a launch point one player    */
    /* radius inside the pad's trailing edge at x 77.05. The shelf spans 4.95 ..     */
    /* 16.95 m from there, so it swallows both ends with 0.44 m and 3.81 m to spare. */
    /* A first pass at this beat had the pad 4.6 m further west and the gate said    */
    /* so: "pad apex 9 lands a walk-speed entry 1.56 m SHORT of the deck".           */
    /* `phase` on spikes is SECONDS (lasers.js:617 cycleState, called by spikes.js). */
    /* ============================================================================ */

    { kind: 'jumppad', p: [79.0, 2.14, 0], s: [3.2, 0.28, 3.2], power: 9.0, dir: [0, 1, 0] },
    { kind: 'platform', p: [88.0, 8.0, 0], s: [12.0, 1, 10], mat: 'stone', glow: MINT, stripe: true }, // the landing shelf, top 8.5 (CP2)
    { kind: 'spikes', p: [84.6, 9.35, 2.4], s: [2.4, 0.7, 3.0], dir: [0, 1, 0], mode: 'retract', cycle: { on: 1.3, off: 1.7, warn: 0.5, phase: 0 } },
    { kind: 'spikes', p: [91.2, 9.35, -2.4], s: [2.0, 0.7, 3.4], dir: [0, 1, 0], mode: 'retract', cycle: { on: 1.1, off: 1.9, warn: 0.45, phase: 1.4 } },

    { kind: 'text', p: [75.0, 4.4, 0], rot: [0, -Math.PI / 2, 0], text: 'UP  ·  AND KEEP GOING', size: 0.5, color: ICE },
    { kind: 'deco', kindOf: 'antennae', p: [82.0, 2.0, -5.4], count: 3, spread: 1.2, scale: 1.4, seed: 3401, mat: 'metal' },
    { kind: 'deco', kindOf: 'rocks', p: [88.0, 5.4, 0], count: 12, spread: 5.6, scale: 2.0, seed: 3402, mat: 'stone' }, // the shelf's underside
    { kind: 'light', p: [79.0, 5.4, 0], color: ICE, intensity: 14, distance: 26 },

    /* ============================================================================ */
    /* BEAT 5 — THE HANGING SHELF                              x 99.6 .. 141.8       */
    /* Six surfaces on the line at six heights — 8.5, 7.4, 9.0, 6.4, 6.6, 8.2 — plus */
    /* a coin spur at 9.6, so the line falls as far as it climbs and every jump is    */
    /* read against a different horizon. It opens on the longest jump in the game    */
    /* (5.60 m flat, sprint; a run tops out at 5.24 [T][A]).                          */
    /*                                                                              */
    /* The previous revision's worst pair lived here: shelf to the far platform,     */
    /* 8.71 m at -2.40, skipping the vanish tile entirely and sitting inside the     */
    /* drop-extended sprint band (safe 7.49, max 9.02). The skip-one distances here  */
    /* are 13.60 / 11.00 / 11.20 / 9.90 / 9.60 m, every one past what a sprint       */
    /* reaches at its own dy.                                                        */
    /* ============================================================================ */

    { kind: 'platform', p: [101.9, 8.0, 0], s: [4.6, 1, 7.0], mat: 'stone', glow: DEEP, stripe: true }, // gap 5.60 FLAT — SPRINT, top 8.5
    { kind: 'ice', p: [109.8, 6.9, -2.5], s: [4.4, 1, 5.4] }, // gap 3.40 at -1.10, top 7.4
    { kind: 'platform', p: [117.6, 8.5, 2.0], s: [4.8, 1, 6.0], mat: 'stone', glow: MINT, stripe: true }, // gap 3.20 at +1.60, top 9.0 (CP3)
    { kind: 'vanish', p: [125.2, 5.9, -1.2], s: [4.0, 1, 5.0], mat: 'ice', cycle: { on: 2.8, off: 1.2, warn: 0.6, phase: 0.15 } }, // gap 3.20 at -2.60, top 6.4
    {
      kind: 'mover',
      p: [131.8, 6.1, -3.2],
      s: [3.8, 1, 3.8],
      mat: 'ice',
      surface: 'ice',
      motion: { type: 'oscillate', to: [131.8, 6.1, 3.2], period: 3.6, phase: 0, ease: 'sine' },
    }, // gap 2.70 at +0.20, top 6.6 — a moving landing, so the rise stays under half a metre
    { kind: 'platform', p: [139.3, 7.7, 0], s: [5.0, 1, 7.0], mat: 'stone', glow: DEEP, stripe: true }, // gap 3.10 at +1.60, top 8.2

    // -- COIN 3: the spur, 4.65 m out and up over the drop — SPRINT ----------------
    { kind: 'platform', p: [134.6, 9.1, -9.6], s: [3.0, 1, 3.0], mat: 'ice', surface: 'ice', glow: GOLD, stripe: true }, // 4.65 m out at +1.40 — SPRINT, top 9.6

    { kind: 'text', p: [96.4, 11.4, 0], rot: [0, -Math.PI / 2, 0], text: 'SPRINT  ·  5.6 m', size: 0.44, color: GOLD },
    { kind: 'text', p: [96.4, 10.8, 0], rot: [0, -Math.PI / 2, 0], text: 'THE HANGING SHELF', size: 0.3, color: GLACIER },
    { kind: 'deco', kindOf: 'crystals', p: [105.0, 3.4, -6.4], count: 8, spread: 5.0, scale: 1.6, seed: 3502, mat: 'crystal' },
    { kind: 'deco', kindOf: 'slabs', p: [119.0, 1.0, 7.4], count: 10, spread: 6.0, scale: 2.2, seed: 3503, mat: 'stone' },
    { kind: 'deco', kindOf: 'girders', p: [111.0, 13.6, 0], count: 6, spread: 6.0, scale: 2.6, seed: 3504, mat: 'metal' }, // gantry, 4.6 m over the deck
    { kind: 'deco', kindOf: 'crystals', p: [134.6, 7.8, -9.6], count: 4, spread: 1.2, scale: 1.0, seed: 3501, mat: 'crystal' },
    { kind: 'light', p: [101.9, 11.6, 0], color: MINT, intensity: 10, distance: 26 },
    { kind: 'light', p: [125.2, 9.6, 0], color: ICE, intensity: 9, distance: 24 },
    { kind: 'light', p: [134.6, 12.0, -9.6], color: GOLD, intensity: 8, distance: 16 },

    /* ============================================================================ */
    /* BEAT 6 — THE LEE                                        x 144.4 .. 157.9      */
    /* Not a breather with a sign on it: a building. Thirteen metres of gallery with */
    /* two walls, a roofed middle, a stone bench you use to clear the sweeper, a bar */
    /* rotor turning at shin height and a laser across the east arch.                */
    /*                                                                              */
    /* THE ROOF STOPS SHORT AT BOTH ENDS, and that is the whole reason it is safe.   */
    /* Floor x 144.40 .. 157.40, roof x 147.60 .. 152.80: 3.20 m of open porch to    */
    /* walk in under, and 4.60 m of open sky at the east lip you jump from. [A] Even */
    /* at 2.60 m of clearance a standing player rises only 0.80 m before the ceiling */
    /* takes vy, which is 1.52 m of horizontal reach against the 2.20 m jump out —   */
    /* so if the roof reached that edge the exit would be uncrossable. It does not.  */
    /* The previous revision put a lintel 1.30 m over the ENTRY and the entry jump's */
    /* head passed 0.67 m through it over a 9.8 m fall, unsignposted, and neither    */
    /* harness could see it. There is no lintel now; the west face is an open porch. */
    /*                                                                              */
    /* COIN 4 is on the roof: out through the north door, up the bench, over the     */
    /* top. The joke stands — the coin costs you the shelter.                        */
    /* ============================================================================ */

    { kind: 'platform', p: [150.9, 9.4, 0], s: [13.0, 1, 10.0], mat: 'stone', glow: MINT, stripe: true }, // the gallery floor, gap 2.60 at +1.70, top 9.9 (CP4)
    { kind: 'platform', p: [145.6, 10.85, -3.0], s: [2.4, 1.9, 3.0], mat: 'stone', glow: DEEP }, // the bench, top 11.8 — the way onto the roof and over the rotor. Its east lip stops 0.80 m short of the roof's, more than TUNE.radius, so nobody jumps from under it
    { kind: 'platform', p: [150.2, 12.75, 0], s: [5.2, 0.5, 10.6], mat: 'obsidian', glow: DEEP }, // the roof: x 147.6 .. 152.8, underside 12.5, 2.60 m of headroom, top 13.0 — COIN 4
    { kind: 'platform', p: [151.0, 11.45, -5.5], s: [9.6, 3.1, 1.0], mat: 'obsidian', glow: DEEP }, // south wall, head flush with the roof at 13.0
    { kind: 'platform', p: [147.0, 11.45, 5.5], s: [4.0, 3.1, 1.0], mat: 'obsidian', glow: DEEP }, // north wall, west half
    { kind: 'platform', p: [154.0, 11.45, 5.5], s: [2.0, 3.1, 1.0], mat: 'obsidian', glow: DEEP }, // north wall, east half — the 4.0 m door between them

    { kind: 'rotor', p: [152.0, 10.3, 0], style: 'bar', arms: 2, len: 4.0, thick: 0.36, period: 2.6, phase: 0 }, // shin-height sweeper: underside 10.12 over a floor of 9.90
    { kind: 'laser', a: [157.9, 10.9, -4.6], b: [157.9, 10.9, 4.6], radius: 0.16, cycle: { on: 1.3, off: 1.5, warn: 0.45, phase: 0 }, color: HOT }, // `phase` SECONDS

    { kind: 'text', p: [142.0, 11.4, 0], rot: [0, -Math.PI / 2, 0], text: 'THE LEE', size: 0.5, color: MINT },
    { kind: 'text', p: [142.0, 10.8, 0], rot: [0, -Math.PI / 2, 0], text: 'it is not finished with you', size: 0.22, color: 0x6f93ac },
    { kind: 'deco', kindOf: 'girders', p: [150.2, 13.8, 0], count: 8, spread: 4.4, scale: 1.8, seed: 3601, mat: 'metal' },
    { kind: 'deco', kindOf: 'rocks', p: [150.9, 8.4, 0], count: 9, spread: 5.4, scale: 1.6, seed: 3602, mat: 'stone' },
    { kind: 'deco', kindOf: 'pipes', p: [150.9, 11.6, -4.6], count: 5, spread: 4.0, scale: 1.2, seed: 3603, mat: 'metal' },
    { kind: 'light', p: [147.0, 11.8, 0], color: 0xffb066, intensity: 8, distance: 16, flicker: 0.3 },
    { kind: 'light', p: [157.4, 12.2, 0], color: HOT, intensity: 8, distance: 18, flicker: 0.1 },
    { kind: 'light', p: [150.2, 15.4, 0], color: GOLD, intensity: 8, distance: 18 },

    /* ============================================================================ */
    /* BEAT 7 — SERAC ALLEY                                    x 159.6 .. 194.5      */
    /* A 9 m glacier belt drags you north at 4.2 m/s, and two seracs slam INTO THE   */
    /* GAPS you have to jump — not onto the decks. That placement is the fix for the */
    /* clipping geomcheck reported against the previous revision (a crusher head     */
    /* sweeping to y 10.90 through a belt topping at 11.10 — the hazard buried in    */
    /* the floor). Over a gap a serac can fall as far as it likes: the first drops   */
    /* 3.6 m to y 7.20 and the second 3.0 m to y 9.20, and neither has a deck under  */
    /* it. `phase` on a crusher is a FRACTION of the cycle (crushers.js:326).        */
    /*                                                                              */
    /* Then a calving serac that RISES 1.8 m as it ferries you across — and a static */
    /* ice shoulder to its south that makes the same crossing in two jumps, so the   */
    /* ferry is a ride and not the only link (neon-1 house rule 3).                  */
    /* ============================================================================ */

    { kind: 'conveyor', p: [164.1, 9.9, 0], s: [9.0, 1, 5.2], dir: [0, 0, 1], power: 4.2, mat: 'ice' }, // gap 2.20 at +0.50, belt top 10.4
    { kind: 'platform', p: [161.4, 9.9, -7.5], s: [3.2, 1, 2.8], mat: 'ice', surface: 'ice', glow: GOLD, stripe: true }, // COIN 5, 3.50 m ACROSS the belt

    { kind: 'crusher', p: [170.4, 11.6, 0], s: [2.6, 1.6, 4.4], axis: [0, -1, 0], travel: 3.6, period: 3.2, phase: 0.0, dwell: 0.5 }, // slams into the 3.80 m gap, head top 12.4
    { kind: 'platform', p: [175.0, 10.7, 0], s: [5.2, 1, 7.4], mat: 'stone', glow: MINT, stripe: true }, // top 11.2 (CP5)
    { kind: 'crusher', p: [179.6, 12.9, 0], s: [2.2, 1.4, 4.0], axis: [0, -1, 0], travel: 3.0, period: 3.8, phase: 0.45, dwell: 0.35 }, // slams into the 3.50 m gap, head top 13.6

    {
      kind: 'mover',
      p: [183.0, 11.7, -2.8],
      s: [3.8, 1, 3.8],
      mat: 'ice',
      surface: 'ice',
      motion: { type: 'linear', to: [183.0, 13.5, 2.8], period: 5.0, phase: 0, ease: 'sine', dwell: 0.6 },
    }, // the calving serac: board at +0.50 while it is low and south; it lifts 1.8 m as it crosses
    { kind: 'platform', p: [182.6, 12.1, -7.0], s: [4.0, 1, 3.4], mat: 'ice', surface: 'ice', glow: DEEP, stripe: true }, // the shoulder: the static way across, top 12.6
    { kind: 'platform', p: [191.7, 13.5, 0], s: [5.6, 1, 8.0], mat: 'stone', glow: DEEP, stripe: true }, // top 14.0

    { kind: 'text', p: [158.0, 13.0, 0], rot: [0, -Math.PI / 2, 0], text: 'THE ICE IS MOVING TOO', size: 0.42, color: GLACIER },
    { kind: 'text', p: [158.0, 12.4, 0], rot: [0, -Math.PI / 2, 0], text: 'the belt runs north  ·  the seracs run down', size: 0.22, color: 0x6f93ac },
    { kind: 'deco', kindOf: 'pipes', p: [164.1, 16.4, 0], count: 6, spread: 3.6, scale: 2.2, seed: 3701, mat: 'metal' },
    { kind: 'deco', kindOf: 'fins', p: [173.0, 6.0, 8.0], count: 8, spread: 5.0, scale: 2.8, seed: 3702, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'rocks', p: [175.0, 9.2, 0], count: 8, spread: 4.6, scale: 1.6, seed: 3703, mat: 'stone' },
    { kind: 'light', p: [164.1, 13.6, 0], color: HOT, intensity: 11, distance: 22, flicker: 0.12 },
    { kind: 'light', p: [161.4, 12.4, -7.5], color: GOLD, intensity: 8, distance: 16 },
    { kind: 'light', p: [183.0, 15.4, 0], color: ICE, intensity: 8, distance: 22 },

    /* ============================================================================ */
    /* BEAT 8 — THE CHIMNEY                                    x 194.4 .. 213.4      */
    /* A shaft with 3.2 m of clear air between two ice walls, floor 14.0, mouth      */
    /* 18.8. TUNE.wallJumpV is [7.4 away, 11.0 up] [T] — about 1.5 m of climb a      */
    /* bounce, so the shaft is three bounces if you read it. Fall and you land on    */
    /* the floor you started from: the chimney costs time, never a life.             */
    /*                                                                              */
    /* THE FORK IS REAL and reachcheck routes the SLOW half of it, because a wall    */
    /* jump is not something a top-face graph can model — it graphs top faces. The    */
    /* stair round the outside always works and always costs about three seconds     */
    /* more; the shaft is the fast line and the only one that is a skill.             */
    /*                                                                              */
    /* A frost shelf used to hang inside the shaft. It came out: it was a fourth     */
    /* surface inside a six-surface volume, and every position that cleared one       */
    /* neighbour's stretch band put it inside another's. Two walls, a floor and a     */
    /* mouth is the whole chimney, and the wall-jump is uninterrupted.                */
    /* ============================================================================ */

    { kind: 'platform', p: [199.4, 13.5, 0], s: [10.0, 1, 7.4], mat: 'stone', glow: DEEP }, // the shaft floor, top 14.0, contiguous with the deck before it
    { kind: 'platform', p: [201.4, 17.0, -2.2], s: [6.0, 6.0, 1.2], mat: 'ice', glow: ICE }, // south wall — `platform` with an ice SKIN, not kind:'ice': it is vertical, so its top face must not carry ice friction
    { kind: 'platform', p: [201.4, 17.0, 2.2], s: [6.0, 6.0, 1.2], mat: 'ice', glow: ICE }, // north wall

    // -- the stair: the slow line that always works, no two rungs alike ------------
    { kind: 'platform', p: [198.0, 15.4, 7.2], s: [3.0, 1, 3.0], mat: 'panel', glow: ICE, stripe: true }, // 2.62 m at +1.90
    { kind: 'platform', p: [202.7, 16.9, 7.6], s: [2.6, 1, 3.4], mat: 'panel', glow: ICE, stripe: true }, // 1.90 m at +1.50
    { kind: 'platform', p: [206.5, 18.1, 6.4], s: [3.4, 1, 2.8], mat: 'panel', glow: ICE, stripe: true }, // 0.80 m at +1.20

    { kind: 'platform', p: [209.9, 18.3, 0], s: [7.0, 1, 8.0], mat: 'stone', glow: MINT, stripe: true }, // the mouth, top 18.8 (CP6)

    { kind: 'text', p: [196.0, 16.4, 0], rot: [0, -Math.PI / 2, 0], text: 'JUMP AT THE WALL', size: 0.52, color: GOLD },
    { kind: 'text', p: [196.0, 15.85, 0], rot: [0, -Math.PI / 2, 0], text: 'hold toward it, then SPACE  ·  again on the far wall', size: 0.22, color: 0x6f93ac },
    { kind: 'text', p: [196.0, 15.3, 4.8], rot: [0, -Math.PI / 2, 0], text: 'or take the stair  ·  slower, always works', size: 0.22, color: ICE },
    { kind: 'deco', kindOf: 'crystals', p: [201.4, 21.6, 0], count: 6, spread: 2.2, scale: 1.1, seed: 3801, mat: 'crystal' },
    { kind: 'deco', kindOf: 'rocks', p: [199.4, 12.4, 0], count: 8, spread: 4.4, scale: 1.6, seed: 3802, mat: 'stone' },
    { kind: 'light', p: [201.4, 19.4, 0], color: ICE, intensity: 9, distance: 18 },
    { kind: 'light', p: [209.9, 21.4, 0], color: MINT, intensity: 10, distance: 24 },

    /* ============================================================================ */
    /* BEAT 9 — THE WINDWARD CLIMB                             x 216.4 .. 254.1      */
    /* A STATIC SPINE, and that is the point. neon-2's rule 3 exists because an      */
    /* earlier draft of that file had only a lift and the whole finale was           */
    /* unreachable geometry; the previous revision of THIS beat reproduced the bug — */
    /* 21.7 m of stage in which the only landable things were three movers and two   */
    /* wind fields. Here the spine is four static platforms at 19.6 / 21.2 / 22.4 /  */
    /* 23.0 joined by 3.00 / 3.20 / 3.20 / 5.70 m jumps at +0.80 / +1.60 / +1.20 /   */
    /* +0.60 — the first three inside the run-safe line and the last a signposted     */
    /* sprint onto the col, and the beat is completable with the machines switched    */
    /* off.                                                                          */
    /*                                                                              */
    /* The two machines LIVE IN THE GAPS instead of replacing them, which is also    */
    /* why they generate no mid-range diagonal edges: a sliding bridge that sweeps   */
    /* north-south through the first gap, and a riser that bobs 1.6 m in the second. */
    /* Take the machine and the gap is a step; miss it and the gap is a jump. Two    */
    /* different machines — the previous revision put the same z-oscillating ice     */
    /* slab in this beat twice and called it "three different machines".             */
    /*                                                                              */
    /* THE WIND IS TWO STACKED BANDS. LOW (y 19.0 .. 23.4, power 4.6, +Z) covers the */
    /* decks, and 4.6 is under the 5.6 m/s^2 that friction gives a motionless player */
    /* on ice [T][A], so you can stand on every slab here and think. HIGH (y 23.4 .. */
    /* 27.0, power 12, -Z) starts 0.4 m above the highest deck under it and `apply`  */
    /* tests the capsule bottom, so it only ever reaches you in the air: your arc is */
    /* pushed north on the way up and south at the apex.                             */
    /* ============================================================================ */

    { kind: 'platform', p: [218.9, 19.1, 0], s: [5.0, 1, 6.8], mat: 'stone', glow: DEEP, stripe: true }, // gap 3.60 at +0.80, top 19.6
    {
      kind: 'mover',
      p: [223.3, 19.9, -3.6],
      s: [2.2, 1, 3.6],
      mat: 'ice',
      surface: 'ice',
      motion: { type: 'oscillate', to: [223.3, 19.9, 3.6], period: 3.6, phase: 0, ease: 'sine' },
    }, // the sliding bridge: sweeps through the first gap, top 20.4 — COIN 6 over its south pose
    { kind: 'platform', p: [228.9, 20.7, 0], s: [8.6, 1, 6.0], mat: 'stone', glow: DEEP, stripe: true }, // gap 3.20 at +1.60, top 21.2
    {
      kind: 'mover',
      p: [234.8, 20.1, 0],
      s: [2.8, 1, 4.0],
      mat: 'ice',
      surface: 'ice',
      motion: { type: 'linear', to: [234.8, 21.7, 0], period: 4.0, phase: 0, ease: 'sine', dwell: 0.5 },
    }, // the riser: bobs 1.6 m in the second gap, tops 20.6 / 22.2
    { kind: 'platform', p: [238.4, 21.9, 0], s: [4.0, 1, 5.6], mat: 'stone', glow: DEEP, stripe: true }, // gap 3.20 at +1.20, top 22.4

    { kind: 'wind', p: [230.0, 21.2, 0], s: [28, 4.4, 18], dir: [0, 0, 1], power: 4.6, color: ICE }, // LOW: y 19.0 .. 23.4, standable on ice
    { kind: 'wind', p: [230.0, 25.2, 0], s: [28, 3.6, 18], dir: [0, 0, -1], power: 12, color: GLACIER }, // HIGH: y 23.4 .. 27.0, air only

    { kind: 'platform', p: [250.1, 22.5, 0], s: [8.0, 1, 8.0], mat: 'stone', glow: MINT, stripe: true }, // the col, gap 5.70 at +0.60 — SPRINT (a run tops out at 4.87 for that rise), top 23.0 (CP7)

    { kind: 'text', p: [213.4, 21.6, 0], rot: [0, -Math.PI / 2, 0], text: 'THE WIND TURNS ABOVE YOU', size: 0.4, color: GLACIER },
    { kind: 'text', p: [213.4, 21.0, 0], rot: [0, -Math.PI / 2, 0], text: 'the floor is calm  ·  the air is not', size: 0.22, color: 0x6f93ac },
    { kind: 'deco', kindOf: 'antennae', p: [218.0, 14.0, -9.0], count: 4, spread: 3.0, scale: 3.4, seed: 3901, mat: 'metal' },
    { kind: 'deco', kindOf: 'antennae', p: [236.0, 15.0, 9.6], count: 4, spread: 3.0, scale: 3.4, seed: 3902, mat: 'metal' },
    { kind: 'deco', kindOf: 'slabs', p: [230.0, 15.4, 0], count: 12, spread: 8.0, scale: 2.6, seed: 3903, mat: 'stone' }, // the buttressing under the spine
    { kind: 'light', p: [230.0, 24.6, 0], color: ICE, intensity: 10, distance: 26 },
    { kind: 'light', p: [250.1, 25.4, 0], color: MINT, intensity: 12, distance: 28 },

    /* ============================================================================ */
    /* BEAT 10 — THE CROWN                                     x 255.9 .. 303.4      */
    /* TWO GREAT WHEELS ON THE SUMMIT RIDGE, AND EACH ONE IS THE ONLY WAY ACROSS.    */
    /* That is the fix for the previous revision's finale, in which three wheels     */
    /* turned beside a spiral of four ledges bolted to a pillar with 0.28 m between  */
    /* them: boarding a wheel cost +0.50 and getting off cost +1.20, against a free  */
    /* 28 cm step right next to it, so the seven bars were scenery and the climax's  */
    /* hardest hop was `run 0.28`.                                                   */
    /*                                                                              */
    /* Here the ridge is broken by two spans no jump can cross:                      */
    /*   col x1 254.10  ->  R2 x0 274.70      = 20.60 m  (sprint max 7.44 [T][A])   */
    /*   R2  x1 279.50  ->  summit x0 298.40  = 18.90 m                              */
    /* Nothing spans them but the bars. You board off the ridge, you ride, you step  */
    /* off on the far side, twice.                                                   */
    /*                                                                              */
    /* WHY THIS IS NOT THE STRANDING neon-1 rule 3 FORBIDS. Rule 3 is about being    */
    /* left with nothing to stand on. [A] Wheel A is 3 bars on a 6.6 s turn, so a    */
    /* bar passes any given angle every 2.2 s; wheel B is 2 bars on 5.0 s, every     */
    /* 2.5 s. Neither wheel is ever gone longer than it takes to line up the next    */
    /* one, and both come back for ever. You cannot be stranded on a wheel; you can  */
    /* only be late.                                                                 */
    /*                                                                              */
    /* THE CLEARANCES, because a bar is a `mover` and carries a real collider.       */
    /* Wheel A rides the annulus r 5.0 .. 7.0 about x 262.9, i.e. x 255.90 .. 269.90; */
    /* wheel B the annulus r 4.8 .. 7.2 about x 289.7, i.e. x 282.50 .. 296.90. The   */
    /* two sweeps are 12.60 m apart and never share air. Measured against the ridge:  */
    /* the col ends at 254.10, 1.80 m short of wheel A; R2 spans 274.70 .. 279.50,    */
    /* 4.80 m clear of A and 3.00 m clear of B; the summit starts at 298.40, 1.50 m   */
    /* clear of B — all with TUNE.radius 0.35 [T] counted, and all of them measured   */
    /* on the ANNULUS the bar sweeps, not on the bar's authored pose. The previous    */
    /* revision measured at a ledge's face centre and missed that its far CORNERS sat */
    /* at r 4.717 against bars sweeping from r 5.0: a player standing there reached   */
    /* 0.067 m INSIDE the sweep, with 0.5 m of vertical overlap.                      */
    /*                                                                              */
    /* Two machines guard the ride rather than decorate it: a blade in the gap       */
    /* before the col whose lowest sweep is 23.30 — deck height in that gap — and a  */
    /* windmill over the last jump whose lowest sweep is 26.70, which is 2.30 m over */
    /* wheel B's deck (so it never touches a rider) and squarely in the arc of the   */
    /* jump to the summit, which puts your head at 28.29.                            */
    /* ============================================================================ */

    { kind: 'pendulum', p: [243.25, 29.4, 0], len: 5.2, amp: 1.05, period: 2.8, phase: 0.4, axis: 'x', blade: { w: 3.0, h: 1.8, d: 0.32 } }, // `phase` RADIANS

    // ---- WHEEL A : r 6.0, three bars 2.2 s apart, 6.6 s clockwise, deck top 23.20.
    //      `phase` is a FRACTION OF A TURN (movers.js:432).
    { kind: 'mover', p: [262.9, 22.9, 0], s: [6.0, 0.6, 2.0], mat: 'ice', surface: 'ice', glow: ICE, motion: { type: 'circle', radius: 6.0, axis: 'y', period: 6.6, phase: 0.0, dir: 1 } },
    { kind: 'mover', p: [262.9, 22.9, 0], s: [6.0, 0.6, 2.0], mat: 'ice', surface: 'ice', glow: ICE, motion: { type: 'circle', radius: 6.0, axis: 'y', period: 6.6, phase: 0.334, dir: 1 } },
    { kind: 'mover', p: [262.9, 22.9, 0], s: [6.0, 0.6, 2.0], mat: 'ice', surface: 'ice', glow: ICE, motion: { type: 'circle', radius: 6.0, axis: 'y', period: 6.6, phase: 0.667, dir: 1 } },

    { kind: 'platform', p: [277.1, 24.1, 0], s: [4.8, 1, 8.0], mat: 'stone', glow: DEEP, stripe: true }, // R2, the mid ridge, top 24.6

    // ---- WHEEL B : r 6.0, two bars, 5.0 s ANTI-clockwise, deck top 24.40. Shorter
    //      bars on a deeper tread, so it reads as a different machine at a glance.
    { kind: 'mover', p: [289.7, 24.1, 0], s: [4.4, 0.6, 2.4], mat: 'ice', surface: 'ice', glow: ICE, motion: { type: 'circle', radius: 6.0, axis: 'y', period: 5.0, phase: 0.0, dir: -1 } },
    { kind: 'mover', p: [289.7, 24.1, 0], s: [4.4, 0.6, 2.4], mat: 'ice', surface: 'ice', glow: ICE, motion: { type: 'circle', radius: 6.0, axis: 'y', period: 5.0, phase: 0.5, dir: -1 } },

    { kind: 'rotor', p: [295.1, 29.3, 0], style: 'windmill', arms: 4, len: 2.4, thick: 0.4, period: 4.2, phase: 0.2, axis: 'z' }, // lowest sweep 26.70

    { kind: 'platform', p: [300.9, 25.3, 0], s: [5.0, 1, 4.8], mat: 'ice', surface: 'ice', glow: MINT, stripe: true }, // THE SUMMIT — the finish, top 25.8

    { kind: 'text', p: [255.1, 25.4, 0], rot: [0, -Math.PI / 2, 0], text: 'THE CROWN', size: 0.6, color: ICE },
    { kind: 'text', p: [255.1, 24.7, 0], rot: [0, -Math.PI / 2, 0], text: 'ride it round  ·  there is no other way over', size: 0.24, color: 0x6f93ac },
    { kind: 'text', p: [262.9, 25.2, 7.4], rot: [0, -Math.PI, 0], text: 'COIN  ·  STAY ON FOR THE NORTH QUARTER', size: 0.26, color: GOLD },
    { kind: 'deco', kindOf: 'crystals', p: [262.9, 16.0, 0], count: 12, spread: 6.0, scale: 2.4, seed: 4001, mat: 'crystal' },
    { kind: 'deco', kindOf: 'crystals', p: [289.7, 17.0, 0], count: 12, spread: 6.0, scale: 2.4, seed: 4002, mat: 'crystal' },
    { kind: 'deco', kindOf: 'spires', p: [300.9, 22.6, 0], count: 5, spread: 1.4, scale: 1.6, seed: 4003, mat: 'obsidian' },
    { kind: 'light', p: [300.9, 27.8, 0], color: MINT, intensity: 22, distance: 36 },
    { kind: 'light', p: [262.9, 24.6, 0], color: ICE, intensity: 12, distance: 28 },
    { kind: 'light', p: [289.7, 25.8, 0], color: ICE, intensity: 10, distance: 26 },

    /* ============================================================================ */
    /* THE MOUNTAIN — dressing only, and authored so it actually renders.           */
    /* `buildDeco` reads kindOf from DECO_KINDS (rocks/spires/fins/pipes/slabs/     */
    /* crystals/antennae/girders) and sizes a cluster from NUMERIC count/spread/    */
    /* scale — it ignores `s` entirely. The clusters above live INSIDE the corridor */
    /* (gantries overhead, buttresses beneath, ice hanging off the ledge undersides) */
    /* because the previous revision put all thirty of its deco objects at |z| >=   */
    /* 6.6 or below y 0 and left the playfield an empty ribbon. Nothing decorative  */
    /* sits at deck height inside |z| <= 6, so none of it can be misread as a       */
    /* landing. Everything below is the far scenery.                                */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'spires', p: [40, -6, 26], count: 14, spread: 16, scale: 9.0, seed: 4101, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [40, -8, -26], count: 14, spread: 16, scale: 9.0, seed: 4102, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [140, -4, 30], count: 14, spread: 18, scale: 11.0, seed: 4103, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [140, -6, -30], count: 14, spread: 18, scale: 11.0, seed: 4104, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [272, 2, 34], count: 12, spread: 16, scale: 12.0, seed: 4105, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [272, 0, -34], count: 12, spread: 16, scale: 12.0, seed: 4106, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'slabs', p: [110, -12, 16], count: 16, spread: 24, scale: 6.0, seed: 4107, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [110, -14, -16], count: 16, spread: 24, scale: 6.0, seed: 4108, mat: 'stone' },
    { kind: 'deco', kindOf: 'rocks', p: [60, -18, 0], count: 20, spread: 30, scale: 8.0, seed: 4109, mat: 'stone' },
    { kind: 'deco', kindOf: 'rocks', p: [200, -20, 0], count: 20, spread: 30, scale: 8.0, seed: 4110, mat: 'stone' },

    // Path lights, one per beat, so the route reads as a line through the whiteout.
    { kind: 'light', p: [1.5, 3.4, 0], color: ICE, intensity: 7, distance: 24 },
    { kind: 'light', p: [39.2, 4.6, 0], color: ICE, intensity: 7, distance: 22 },
    { kind: 'light', p: [58.0, 4.0, 0], color: ICE, intensity: 6, distance: 20 },
    { kind: 'light', p: [88.0, 11.6, 0], color: ICE, intensity: 9, distance: 26 },
    { kind: 'light', p: [139.3, 11.0, 0], color: ICE, intensity: 8, distance: 24 },
    { kind: 'light', p: [175.0, 14.6, 0], color: MINT, intensity: 10, distance: 24 },
    { kind: 'light', p: [218.9, 22.4, 0], color: ICE, intensity: 9, distance: 24 },
  ],
};
