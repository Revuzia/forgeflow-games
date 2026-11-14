/**
 * ASCENDANT — LAVA FOUNDRY 1 : "DESCENT"
 * runtime/data/stages/foundry-1.js
 *
 * A smelting works, entered from the charging floor at the top of the building and
 * walked all the way down to the pour. The melt never moves; you keep getting closer
 * to it. The route down is a stair, not a ramp — it climbs onto the mould block, the
 * tap plate, the boost roller, the first anvil bed and landing 3 of the crucible
 * stair, and it is thrown up out of the pot at the end by a tuyere blast. Net travel
 * is 14.0 m down to 1.0 m above the melt, and five of the thirty steps on the way are
 * jumps you have to look UP for. A descent that only ever falls is a slide.
 *
 * SHAPE      251.7 m of travel, 64 gameplay objects, 30 hazard-kind objects drawn from
 *            SEVEN families (lava, conveyor, crusher, vanish, spikes, speedpad,
 *            jumppad), 6 checkpoints (spacing 36.8 / 57.2 / 45.5 / 24.0 / 15.6 m),
 *            4 coins. Objects that are genuine functions of the stage clock: NINE
 *            (6 crushers + 3 cooling plates), not five of one kind.
 *            par 126 s over 251.7 m = 0.50 s/m, the same density as neon-2, the game's
 *            other difficulty-3 stage.
 *
 * TEACHES the world, in this order and never two things at once:
 *   LAVA        BEAT 1-2  five hops over five tapping channels. Nothing moves, but two
 *                         of the five climb and three of them step sideways.
 *   CONVEYOR    BEAT 3    one belt with you, one belt against you, and a boost roller
 *                         that sits 0.8 m ABOVE the belt that feeds it.
 *   CRUSHER     BEAT 5    three anvil bays, six jumps, three ceiling rams on ONE shared
 *                         4.8 s bar. Ram 1 owns the whole lane; rams 2 and 3 own one
 *                         half of it each, so the lesson is "read the footprint".
 *   COMBINED    BEAT 6    a belt that carries you under a ram, then a belt that pushes
 *                         you sideways off the launder into slag teeth.
 *   SET-PIECE   BEAT 8    the crucible stair: six landings, a cooling plate on the main
 *                         line that gives way under you, two more out over the pot with
 *                         a coin on the far one, a ram over the widest landing, a
 *                         checkpoint halfway down it, and the gate.
 *   LAUNCH      BEAT 9    one tuyere blast, straight up out of the pot.
 *
 * DELIBERATELY ABSENT: movers, pendulums, rotors, lasers, rising lava. foundry-2 owns
 * the sinker, the wrecking ball and the tide by name and this stage does not touch any
 * of them. Vanish plates and the pad are shared vocabulary (neon-1 teaches both at
 * difficulty 1); three plates and one pad is a seasoning, not a theme.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOUSE RULE 2 (neon-1) — THE TWO FORBIDDEN BANDS. THIS FILE OBEYS IT.
 * ─────────────────────────────────────────────────────────────────────────────
 * `_harness/reachcheck.mjs` graphs EVERY pair of landable surfaces in BOTH directions
 * — coin ledges, crusher heads, and the jump back down off a ledge you only ever meant
 * people to climb. Two distance bands are forbidden, because a jump inside them is one
 * a player can *just barely* make and will therefore fail half the time:
 *       0.83·R .. R          (a run jump at full stretch)
 *       1.177·R .. 1.419·R   (a sprint jump at full stretch)
 * where R = 8.6·(0.3316 + sqrt(2·(2.0889 − dy)/54)) is the run-jump reach at that dy.
 * Flat that is 4.36..5.24 m and 6.18..7.44 m; at dy −5.0 m — a parked ram head looking
 * down at the deck it sits over — it is 6.03..7.26 m and 8.56..10.30 m, which is why a
 * parked head is the most productive way there is to grow a full-stretch jump that
 * nobody designed.
 *
 * The BACKWARD direction is the one that bites on a descent, and it is the one the
 * previous build of this file did not check. Off a 3.6 m gap the return jump is only
 * inside the safe line while the drop is under about 1.1 m; a 2.8 m gap survives a
 * 2.0 m drop; and past a 2.11 m drop the return does not exist at all, because the apex
 * is 2.0889 m. Every down-step here is sized against its own return, and the two places
 * the stage deliberately closes the door behind you — the BEAT 5 -> 6 commit at -2.30 m
 * and the lip -> stair entry at -2.20 m — are past that line on purpose.
 *
 * The previous build carried FIFTEEN edges inside those bands. This one carries ZERO
 * across all 49 surfaces, and that is a measured fact — see BUILT NUMBERS.
 *
 * HOW THE RAM BAYS ARE SHAPED, AND WHY. A crusher's head is a landable rectangle in the
 * graph at its RETRACTED home (reachcheck.mjs only ever models that one position) and a
 * real standable platform in the game (crushers.js header: "a parked crusher — extended
 * or retracted — is a safe platform you can stand on"). Both facts are designed for
 * here rather than dismissed as a validator quirk:
 *   1. Every head on this stage is 2.2 m thick and every one of them slams until its
 *      underside touches the deck, so at full extension its TOP stands 2.2 m proud of
 *      that deck — above the 2.0889 m apex. You cannot get onto a foundry-1 ram from
 *      anywhere, in the graph or in the game. It is a ceiling, not a mezzanine, and the
 *      harness agrees: `orph 6`, all six heads unreachable from spawn.
 *   2. Even so, every head is placed so the surfaces around it are either inside the
 *      safe run distance FROM it (its own deck at 0.00 m; the plate before or after
 *      it, and COIN 3 bollard, at 2.4-5.9 m) or past the point where a sprint cannot
 *      reach (the previous bay at 10.4-12.9 m). Nothing sits in between. That is what sets the anvil bays' shapes
 *      — 6.4 / 4.8 / 5.8 m of bed, 3.0-3.4 m gaps — not a taste in slabs.
 *
 * CONVENTIONS (full list in runtime/data/index.js):
 *   p = CENTRE, s = FULL size, so a top surface is p[1] + s[1]/2 and a platform spans x
 *   from p[0] - s[0]/2 to p[0] + s[0]/2. Every gap quoted below is measured EDGE TO EDGE
 *   between landable tops. rot/yaw are radians; yaw 0 faces +X. `stripe: true` = "you
 *   had to jump to get here". A crusher's `p` is the head's RETRACTED home and `travel`
 *   is how far it slams.
 *
 * COLOUR LAW (CONTRACT Hard Rule 2). Enforced object by object in this file:
 *   HOT   0xff4a10 (palette.kill)         lava, ram faces, slag teeth, the scorch mark
 *                                         under ram 2, warning text. NOTHING you can
 *                                         stand on is this colour — including the four
 *                                         coin ledges, which the previous build painted
 *                                         kill-orange under a sign that read "everything
 *                                         orange is the floor of this building".
 *   COLD  0xa8e6ff (palette.safeEdge)     every landable surface you must jump to.
 *   IRON  0x8b94a4 (palette.safe)         landable surfaces you merely walk onto.
 *   MINT  0x56ffd0 (palette.checkpointOn) the six checkpoint decks, nothing else.
 *   LILAC 0xc9a6ff (palette.finish)       the casting floor, nothing else.
 *   EMBER 0xffb44a (palette.accent)       machinery, signage and the coin rings.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BUILT NUMBERS — recomputed from THIS object list against runtime/core/tuning.js and
 * the real hazard code. Percentages are of the SAFE budget (0.83·R), not of R.
 * ─────────────────────────────────────────────────────────────────────────────
 *   tight edges in the whole graph        0    (run-tight + sprint-tight, both
 *                                               directions, all 49 surfaces)
 *   longest main-line gap                 4.20 m at -2.30 m  (BEAT 5 -> 6, the commit; 80%)
 *   longest flat main-line gap            3.35 m             (bay 3 entry -> anvil bed 3)
 *   largest single rise                   0.90 m over 3.20 m (BEAT 2, the mould block)
 *   worst budget used, FORWARD            83%  (BEAT 2, onto the mould block)
 *   worst budget used, BACKWARD           88%  (three edges: belt A -> P6, P7 -> the lip,
 *                                               and landing 1 -> the cooling plate)
 *   longest optional line                 5.10 m at -3.40 m (91%, one-way): the early
 *                                               line straight off the lip onto COIN 4's
 *                                               first cooling plate
 *   COIN 2's return, the tightest climb   2.90 m at +1.00 m  (76%)
 *   NO jump on this stage requires a sprint. The one place sprinting matters is the
 *   reversed belt in BEAT 3, which is what the boost roller is there for.
 *
 * MAIN-LINE STEP TALLY (31 landings, 30 steps): 10 flat, 14 down, 5 UP, 1 launch.
 * Height ladder: 14.0 (charging floor) -> 14.9 (mould block) -> 13.7 -> 14.4 (tap plate)
 *   -> 13.1 (belt gallery) -> 13.9 (roller) -> 12.9 -> 13.7 (anvil bed 1) -> 12.9 -> 12.6
 *   -> 10.3 (the launder) -> 9.4 -> 8.5 -> 7.6 (the lip) -> 5.4 -> 4.2 -> 4.7 -> 2.9
 *   -> 1.8 -> 1.0 (the gate) -> 6.1 (the casting floor, off the blast).
 * 24 distinct landable top heights, 27 distinct z centres and 37 distinct footprints
 * across 43 landable surfaces. The route crosses the centre line thirteen times and no
 * height is held for more than two landings.
 *
 * DETERMINISM: every ram and every plate is a pure function of the stage clock (CONTRACT
 * section 16). Crusher `phase` and vanish `cycle.phase` are FRACTIONS of the cycle.
 * Every checkpoint carries clockOffset 0, and every phase is chosen so the machine ahead
 * of that checkpoint is PARKED OPEN at clock 0 — with the measured arrival time written
 * into each checkpoint's comment.
 */

const EMBER = 0xffb44a; // palette.accent — machinery, signage, coin rings
const HOT = 0xff4a10; // palette.kill — lava, ram faces, slag teeth, ram scorch marks. Nothing safe is this colour.
const COLD = 0xa8e6ff; // palette.safeEdge — the cyan stripe that means "you can land here"
const IRON = 0x8b94a4; // palette.safe — walk-on steel
const MINT = 0x56ffd0; // palette.checkpointOn
const LILAC = 0xc9a6ff; // palette.finish
const RUST = 0x6b4230; // background ironwork
const SOOT = 0x2a2320; // theme deco

export default {
  id: 'foundry-1',
  world: 'foundry',
  name: 'DESCENT',
  subtitle: 'The floor is molten and you are walking down to meet it',
  // 251.7 m at 0.50 s/m, the same density as neon-2, the other difficulty-3 stage.
  // The previous build asked 0.60 s/m for 220 m — the loosest par in the game, on
  // the stage with the least timing content in it.
  par: 126000,
  difficulty: 3,

  spawn: { p: [0, 14.1, 0], yaw: 0 },
  killY: -14,

  checkpoints: [
    // 0 — the landing deck at the bottom of the tap channels, looking straight down
    // the first belt. Everything before this is static; everything after it moves.
    { p: [42.6, 13.2, 0], yaw: 0, clockOffset: 0 },
    // 1 — the charging bay, one hop short of the first anvil bed, with the parked
    // ladle you climb for COIN 1 on your left. Nothing here is timed.
    { p: [79.4, 13.0, 0], yaw: 0, clockOffset: 0 },
    // 2 — the launder deck, before belts and rams are used in the same sentence.
    // The belt ram (period 4.6, dwell 1.8, phase 0) is parked UP for the first
    // 1.80 s of clock. A committed run leaves this deck at 0.36 s, lands on the belt
    // at 0.97 s, enters the head's footprint at 1.02 s and is out the far side by
    // 1.22 s (the belt adds 5.0 m/s under you): 0.58 s of margin.
    { p: [136.6, 10.4, 0], yaw: 0, clockOffset: 0 },
    // 3 — the lip of the crucible, before the stair. The cooling plate two landings
    // in (on 3.4 / warn 1.0 / off 1.6, phase 0) reads solid for the first 4.40 s;
    // the measured traverse from here onto it and off again is 3.0 s.
    { p: [182.1, 7.7, 0], yaw: 0, clockOffset: 0 },
    // 4 — INSIDE the set-piece, on landing 3, so a death on the stair no longer
    // replays four already-proven jumps. The stair ram (period 4.8, dwell 1.8,
    // phase 0) is parked UP for 1.80 s; you enter its footprint at 0.78 s and clear
    // it at 1.12 s.
    { p: [206.1, 4.8, 0], yaw: 0, clockOffset: 0 },
    // 5 — landing 5, in front of the gate. clockOffset 0, and the arithmetic is the
    // whole reason this stage exists in this shape, so it is written out:
    //   the gate is period 5.6, dwell 2.2, phase 0. profile() in crushers.js gives
    //   dwellFrac 0.393, slam 0.24 s, down-dwell 2.20 s, retract 0.96 s — the head
    //   is FULLY UP from t = 0.00 s to t = 2.20 s.
    //   run-up on this landing: 2.20 m from here to the edge at x 223.9 = 0.30 s
    //   (accelGround 95 up to speedRun 8.6). The 3.20 m gap at -0.80 m is 0.659 s of
    //   airtime and 5.66 m of travel at 8.6 m/s, so you touch down at x 229.6 —
    //   INSIDE the head's 228.3..231.7 footprint, not at its near edge. You enter
    //   that footprint at 0.81 s and leave it at 1.21 s. The gate shuts 0.99 s
    //   behind you.
    //   (The previous build set clockOffset 2.3 here, solved against an imagined
    //   2.5 s walk. At 2.3 the player reached the head at cycle position 3.11 s —
    //   u = 1.000, a solid block. Every single respawn presented a closed gate.)
    { p: [221.7, 1.9, 0], yaw: 0, clockOffset: 0 },
  ],

  finish: { p: [255.0, 6.2, 0], yaw: 0 },

  coins: [
    // Four coins, four different verbs. The previous build had two verbs shared
    // across four near-identical ledges, all hung on the -z side, all kill-orange.
    { p: [74.3, 17.3, -0.8] }, // 1 CLIMB — three rungs up a parked ladle
    { p: [185.4, 7.7, -7.6] }, // 2 DROP  — off the rim of the lip and back up onto it
    { p: [114.0, 15.9, -2.2] }, // 3 STAND — a bollard inside a live ram bay, jumped from standing
    { p: [195.4, 5.3, 9.6] }, // 4 TIME  — two cooling plates out over the widest part of the pot
  ],

  objects: [
    /* ============================================================================ */
    /* BEAT 1 — THE CHARGING FLOOR                                                  */
    /* A steel deck you cannot fall off, a scrap pile you climb in two rungs so the  */
    /* first thing the stage teaches is that UP is a direction here, and a view      */
    /* straight down a fourteen-metre drop onto the melt.                           */
    /* ============================================================================ */

    { kind: 'platform', p: [3, 13.5, 0], s: [16, 1, 14], mat: 'metal', glow: IRON }, // top 14.0, x -5..11

    { kind: 'platform', p: [0.4, 14.4, 4.6], s: [2.4, 0.8, 2.4], mat: 'grate', glow: COLD, stripe: true }, // rung 1, top 14.8 (+0.8)
    { kind: 'platform', p: [2.5, 15.1, 4.4], s: [2.0, 2.2, 2.0], mat: 'grate', glow: COLD, stripe: true }, // rung 2, top 16.2 (+1.4). 2.2 m above the deck, so rung 1 is the only way up.

    { kind: 'text', p: [-3.4, 16.6, 0], rot: [0, -Math.PI / 2, 0], text: 'DESCENT', size: 0.82, color: EMBER },
    { kind: 'text', p: [-3.4, 15.95, 0], rot: [0, -Math.PI / 2, 0], text: 'LAVA FOUNDRY  ·  I', size: 0.28, color: 0xb08464 },
    { kind: 'text', p: [-3.4, 15.4, 0], rot: [0, -Math.PI / 2, 0], text: 'orange that glows and moves is the floor of this building', size: 0.24, color: HOT },
    { kind: 'text', p: [4.0, 15.0, -5.2], rot: [0, -Math.PI / 2, 0], text: 'W A S D   ·   SPACE', size: 0.32, color: 0xd8c2ae },
    { kind: 'text', p: [4.0, 14.5, -5.2], rot: [0, -Math.PI / 2, 0], text: 'SHIFT to sprint  ·  you will want it later', size: 0.22, color: 0xb08464 },
    { kind: 'text', p: [2.5, 17.5, 4.4], rot: [0, -Math.PI / 2, 0], text: 'two rungs up', size: 0.24, color: COLD },

    // The charge door: a threshold you walk out of, so the stage has a mouth.
    { kind: 'deco', kindOf: 'chargedoor', p: [10.4, 19.0, 0], s: [1.2, 1.0, 16.0], mat: 'obsidian', tint: EMBER },
    { kind: 'deco', kindOf: 'chargebucket', p: [8.6, 17.2, 6.4], s: [2.6, 2.8, 2.6], mat: 'metal', tint: RUST },
    { kind: 'deco', kindOf: 'chargebucket', p: [8.6, 17.0, -6.6], s: [2.4, 2.6, 2.4], mat: 'metal', tint: RUST },
    { kind: 'deco', kindOf: 'gantry', p: [10.4, 16.6, 7.2], s: [1.3, 5.4, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'gantry', p: [10.4, 16.6, -7.2], s: [1.3, 5.4, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pipes', p: [1.0, 18.2, -6.4], count: 5, spread: 3.2, scale: 1.4, seed: 1201, mat: 'metal', tint: RUST },
    { kind: 'light', p: [3.0, 18.2, 0], color: 0xcfe2ff, intensity: 11, distance: 26 }, // the cold furnace key
    { kind: 'light', p: [10.4, 16.0, 0], color: EMBER, intensity: 8, distance: 20 },

    /* ============================================================================ */
    /* BEAT 2 — THE TAP CHANNELS                                                    */
    /* Five hops over five tapping channels, and the beat changes TWO variables at   */
    /* once on purpose so it is not neon-1's growing-gap ladder wearing a different  */
    /* palette: 2.40 flat / 3.20 up 0.9 / 2.72 down 1.2 and 1.6 sideways / 2.97 up   */
    /* 0.7 and 2.1 sideways / 3.30 down 1.3. Every channel is exactly as wide as the */
    /* gap it fills — the hazard IS the measurement — and every channel top sits     */
    /* below the BOTTOM of both slabs it separates, so nothing here reads as a ledge.*/
    /* ============================================================================ */

    { kind: 'platform', p: [15.4, 13.5, 0], s: [4.0, 1, 5.0], mat: 'metal', glow: COLD, stripe: true }, // top 14.0, gap 2.40 flat
    { kind: 'platform', p: [22.3, 14.4, -1.8], s: [3.4, 1, 4.0], mat: 'stone', glow: COLD, stripe: true }, // MOULD BLOCK, top 14.9, gap 3.20 at +0.90 (83% of the 3.87 m budget)
    { kind: 'platform', p: [28.4, 13.2, 3.6], s: [4.4, 1, 3.6], mat: 'metal', glow: COLD, stripe: true }, // top 13.7, gap 2.72 diagonal at -1.20
    { kind: 'platform', p: [34.6, 13.9, -2.4], s: [3.8, 1, 4.2], mat: 'stone', glow: COLD, stripe: true }, // TAP PLATE, top 14.4, gap 2.97 diagonal at +0.70
    { kind: 'platform', p: [42.6, 12.6, 0], s: [6.0, 1, 7.0], mat: 'grate', glow: MINT, stripe: true }, // CP0, top 13.1, gap 3.10 at -1.30

    { kind: 'lava', p: [12.2, 12.3, 0], s: [2.4, 1.2, 16] }, // surface 12.9
    { kind: 'lava', p: [19.0, 12.3, 0], s: [3.2, 1.2, 16] }, // surface 12.9
    { kind: 'lava', p: [25.1, 12.0, 0], s: [2.2, 1.2, 16] }, // surface 12.6
    { kind: 'lava', p: [31.65, 12.0, 0], s: [2.1, 1.2, 16] }, // surface 12.6
    { kind: 'lava', p: [37.95, 11.4, 0], s: [3.3, 1.2, 16] }, // surface 12.0

    { kind: 'text', p: [13.0, 15.6, 3.6], rot: [0, -Math.PI / 2, 0], text: 'MIND THE TAPS', size: 0.34, color: HOT },
    { kind: 'text', p: [22.3, 16.3, -1.8], rot: [0, -Math.PI / 2, 0], text: 'up is a direction here', size: 0.22, color: COLD },
    { kind: 'deco', kindOf: 'launder', p: [24.0, 15.0, 6.4], s: [30, 0.4, 0.6], mat: 'metal', tint: RUST },
    { kind: 'deco', kindOf: 'launder', p: [24.0, 15.0, -6.4], s: [30, 0.4, 0.6], mat: 'metal', tint: RUST },
    { kind: 'deco', kindOf: 'ingot', p: [21.0, 14.2, -5.6], s: [1.6, 0.5, 0.8], count: 7, spread: 3.0, seed: 2211, mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'ingot', p: [33.0, 14.2, 5.6], s: [1.6, 0.5, 0.8], count: 6, spread: 2.8, seed: 2212, mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'taphole', p: [19.0, 13.4, -7.8], s: [1.4, 1.4, 1.0], mat: 'obsidian', tint: HOT },
    { kind: 'light', p: [21.0, 16.2, -6.0], color: EMBER, intensity: 7, distance: 15, flicker: 0.32 },
    { kind: 'light', p: [24.0, 11.6, 0], color: HOT, intensity: 12, distance: 30, flicker: 0.14 }, // uplight from the taps

    /* ============================================================================ */
    /* BEAT 3 — THE BELT GALLERY                       ( CP0 sits at its mouth )     */
    /* Conveyors, taught in the only order that works: one that agrees with you,     */
    /* then one that does not. Belt 1 runs +X at 4.5 m/s and simply makes you fast.  */
    /* The roller pad is a STEP UP of 0.8 m off the end of it and 2.4 m off the      */
    /* centre line, so the belt's speed is what buys the climb. Belt 2 runs -X at    */
    /* 3.0 m/s and is 1.0 m lower again — the first time this world takes something  */
    /* away from you.                                                                */
    /* ============================================================================ */

    { kind: 'conveyor', p: [51.6, 12.6, 0], s: [7.0, 1, 4.2], dir: [1, 0, 0], power: 4.5, mat: 'conveyor' }, // top 13.1, gap 2.50
    { kind: 'platform', p: [59.9, 13.4, 2.4], s: [3.6, 1, 3.4], mat: 'metal', glow: COLD, stripe: true }, // ROLLER PAD, top 13.9, gap 3.00 at +0.80
    { kind: 'speedpad', p: [59.9, 13.75, 2.4], s: [3.4, 0.3, 3.2], dir: [1, 0, 0], power: 12.2 }, // flush with the pad top, so it is a step and never a jump
    { kind: 'conveyor', p: [68.4, 12.4, 1.6], s: [7.0, 1, 4.2], dir: [-1, 0, 0], power: 3.0, mat: 'conveyor' }, // top 12.9, gap 3.20 at -1.00, runs AGAINST you
    { kind: 'platform', p: [79.4, 12.4, 0], s: [8.4, 1, 9.0], mat: 'grate', glow: MINT, stripe: true }, // CP1 charging bay, top 12.9, gap 3.30

    { kind: 'text', p: [50.0, 15.0, 0], rot: [0, -Math.PI / 2, 0], text: 'THE BELTS', size: 0.52, color: EMBER },
    { kind: 'text', p: [50.0, 14.45, 0], rot: [0, -Math.PI / 2, 0], text: 'the chevrons point the way it will carry you', size: 0.22, color: 0xb08464 },
    { kind: 'text', p: [64.8, 15.2, 0], rot: [0, -Math.PI / 2, 0], text: 'THIS ONE FIGHTS BACK', size: 0.4, color: HOT },
    { kind: 'deco', kindOf: 'crane', p: [58.0, 19.4, 0], s: [3.0, 1.6, 22.0], mat: 'metal', tint: RUST }, // the charging crane, on its rail above the gallery
    { kind: 'deco', kindOf: 'cranerail', p: [64.0, 20.6, 5.6], s: [46, 0.5, 0.5], mat: 'metal', tint: RUST },
    { kind: 'deco', kindOf: 'cranerail', p: [64.0, 20.6, -5.6], s: [46, 0.5, 0.5], mat: 'metal', tint: RUST },
    { kind: 'deco', kindOf: 'panel', p: [56.0, 15.6, -6.2], s: [0.4, 2.6, 3.4], mat: 'emissive', tint: EMBER },
    { kind: 'deco', kindOf: 'girders', p: [51.6, 11.6, 0], count: 6, spread: 3.4, scale: 1.2, seed: 3301, mat: 'metal', tint: SOOT }, // belt underside, well below the walk line
    { kind: 'deco', kindOf: 'girders', p: [68.4, 11.4, 1.6], count: 6, spread: 3.4, scale: 1.2, seed: 3302, mat: 'metal', tint: SOOT },
    { kind: 'light', p: [51.6, 15.4, 0], color: EMBER, intensity: 8, distance: 22 },
    { kind: 'light', p: [68.4, 15.4, 0], color: EMBER, intensity: 8, distance: 22 },

    /* ============================================================================ */
    /* BEAT 4 — THE PARKED LADLE  ( COIN 1, and the only climb that is optional )    */
    /* A ladle sits in its cradle at the back-left of the charging bay with three    */
    /* rungs welded up its side: +1.0, +1.2, +1.1 m. From the bay floor the second   */
    /* rung is 2.2 m up — past the 2.0889 m apex — so the rungs have to be taken in  */
    /* order, and the way back down is a walk-off, not a jump.                        */
    /* The whole assembly ends 11.0 m short of the first anvil bed: past the point    */
    /* where a sprint jump can reach, so a 3.3 m-high perch cannot become a shortcut. */
    /* ============================================================================ */

    { kind: 'platform', p: [74.6, 13.4, -3.2], s: [2.4, 1, 2.4], mat: 'metal', glow: COLD, stripe: true }, // rung 1, top 13.9
    { kind: 'platform', p: [74.0, 14.6, -2.0], s: [1.8, 1, 1.8], mat: 'metal', glow: COLD, stripe: true }, // rung 2, top 15.1
    { kind: 'platform', p: [74.3, 15.7, -0.8], s: [1.6, 1, 1.6], mat: 'metal', glow: COLD, stripe: true }, // rung 3, top 16.2, coin on top
    { kind: 'deco', kindOf: 'ring', p: [74.3, 17.3, -0.8], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: EMBER },
    { kind: 'deco', kindOf: 'ladle', p: [72.6, 14.0, -5.4], s: [3.4, 3.2, 3.4], mat: 'metal', tint: RUST },
    { kind: 'deco', kindOf: 'hoist', p: [73.4, 18.6, -3.0], s: [0.6, 4.0, 0.6], mat: 'metal', tint: SOOT },
    { kind: 'text', p: [76.6, 15.4, -4.4], rot: [0, -Math.PI / 2, 0], text: 'LADLE 3  ·  COLD', size: 0.24, color: EMBER },
    { kind: 'light', p: [74.0, 17.4, -2.6], color: EMBER, intensity: 8, distance: 16 },

    /* ============================================================================ */
    /* BEAT 5 — THE ANVIL BEDS                                                      */
    /* Three bays, six jumps, three ceiling rams. Every bay is a narrow entry plate   */
    /* and a wide anvil bed with the ram over it, and the route swings z +3.0 -> -1.6 */
    /* -> -3.4 -> +0.2 -> +2.8 -> -2.7 while stepping 13.7 -> 12.9 -> 12.6, so you    */
    /* are turning on every one of the six jumps. The entry into bay 1 is a STEP UP   */
    /* of 0.8 m. The previous build made this beat one 15 m corridor and one jump off */
    /* the end of it — no gap, no lateral movement, no elevation change.              */
    /*                                                                                */
    /* THE BAR. All three rams share a 4.8 s period and a 1.4 s parked-up dwell, with */
    /* phases 0 / 1/3 / 2/3. profile() puts the slam onset at (dwell - phase·period)  */
    /* mod period, so the three onsets are 1.4 s, 4.6 s and 3.0 s — sorted, that is   */
    /* 1.4 / 3.0 / 4.6, exactly 1.6 s apart, and because the periods are IDENTICAL    */
    /* that spacing never drifts. The bay plays the same three-beat bar forever.      */
    /* (The previous build used 3.6 / 4.2 / 3.4 s and claimed "phases 1.4 s apart so  */
    /* they never all fire together". Those periods are incommensurate: rams 1 and 3  */
    /* fired 0.05 s apart at t = 15.30 s, and the rhythm changed under the player for */
    /* reasons nothing in the stage explained.)                                       */
    /*                                                                                */
    /* THE FOOTPRINTS. Ram 1 is 4.0 m deep over a 4.4 m bed: it owns the whole lane   */
    /* and the answer is "wait". Ram 2 is 2.4 m deep on the +z half of a 5.6 m bed,   */
    /* leaving a 3.0 m lane on the -z side. Ram 3 is 2.4 m deep on the -z half of a   */
    /* 4.6 m bed, leaving 2.1 m on the +z side. So the beat gets easier in the middle */
    /* and the lesson is to READ THE FOOTPRINT rather than count beats.               */
    /* ============================================================================ */

    { kind: 'platform', p: [88.5, 13.2, 3.0], s: [3.4, 1, 3.6], mat: 'grate', glow: COLD, stripe: true }, // bay 1 entry, top 13.7, gap 3.20 at +0.80
    { kind: 'platform', p: [96.2, 13.2, -1.6], s: [6.4, 1, 4.4], mat: 'metal', glow: COLD, stripe: true }, // ANVIL BED 1, top 13.7, gap 2.86 diagonal
    { kind: 'crusher', p: [97.0, 17.6, -1.6], s: [3.6, 2.2, 4.0], axis: [0, -1, 0], travel: 2.8, period: 4.8, phase: 0, dwell: 1.4, mat: 'metal' }, // full-lane. Parks 2.8 m over the bed; extended it stands 2.2 m proud of it, so it can never be climbed.

    { kind: 'platform', p: [104.9, 12.4, -3.4], s: [4.2, 1, 3.8], mat: 'grate', glow: COLD, stripe: true }, // bay 2 entry, top 12.9, gap 3.40 at -0.80
    { kind: 'platform', p: [112.4, 12.4, 0.2], s: [4.8, 1, 6.4], mat: 'metal', glow: COLD, stripe: true }, // ANVIL BED 2, top 12.9, gap 3.00
    { kind: 'crusher', p: [111.4, 16.8, 2.0], s: [2.8, 2.2, 2.4], axis: [0, -1, 0], travel: 2.8, period: 4.8, phase: 1 / 3, dwell: 1.4, mat: 'metal' }, // +z half only; the walking lane is z -2.2..0.8

    // COIN 3 — a bollard standing on the -z shoulder of anvil bed 2, on the far side
    // of the bed from ram 2. The ram's crushing footprint is z 0.8..3.2; the bollard
    // spans z -2.9..-1.5, so a player standing on its far edge reaches z -1.15
    // (TUNE.radius 0.35) and there is 1.95 m of daylight between them and the face.
    // The scorched anvil plate below is painted exactly where the head lands, in
    // kill-orange, so which half of the bed is survivable is READABLE rather than
    // something you learn by dying on it.
    // (The previous build put COIN 3's bollard 0.30 m from a crushing face — less
    // than the player's own radius — with nothing marking the safe half.)
    { kind: 'platform', p: [114.0, 13.6, -2.2], s: [1.4, 1.6, 1.4], mat: 'obsidian', glow: COLD, stripe: true }, // top 14.4, a standing +1.5 m hop off the bed
    { kind: 'deco', kindOf: 'ring', p: [114.0, 15.9, -2.2], s: [0.1, 1.7, 1.7], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: EMBER },
    { kind: 'deco', kindOf: 'anvilface', p: [111.4, 12.95, 2.0], s: [2.8, 0.1, 2.4], mat: 'emissive', tint: HOT }, // the scorch mark under ram 2 — where it lands, painted where it lands

    { kind: 'platform', p: [119.3, 12.1, 2.8], s: [3.0, 1, 3.4], mat: 'grate', glow: COLD, stripe: true }, // bay 3 entry, top 12.6, gap 3.00 at -0.30
    { kind: 'platform', p: [126.7, 12.1, -2.7], s: [5.8, 1, 4.6], mat: 'metal', glow: COLD, stripe: true }, // ANVIL BED 3, top 12.6, gap 3.35 diagonal (3.00 in x, 1.50 in z)
    { kind: 'crusher', p: [126.8, 16.5, -3.6], s: [3.2, 2.2, 2.4], axis: [0, -1, 0], travel: 2.8, period: 4.8, phase: 2 / 3, dwell: 1.4, mat: 'metal' }, // -z half only; the walking lane is z -2.4..-0.4

    { kind: 'text', p: [85.0, 15.6, 0], rot: [0, -Math.PI / 2, 0], text: 'ANVIL BEDS', size: 0.56, color: EMBER },
    { kind: 'text', p: [85.0, 15.0, 0], rot: [0, -Math.PI / 2, 0], text: 'they warn you before they drop  ·  watch WHERE each one lands', size: 0.22, color: 0xb08464 },
    { kind: 'text', p: [110.6, 14.8, -4.8], rot: [0, -Math.PI / 2, 0], text: 'HALF A LANE', size: 0.3, color: HOT },
    { kind: 'deco', kindOf: 'anvil', p: [96.2, 12.0, -5.6], s: [1.6, 0.8, 1.0], count: 4, spread: 2.6, seed: 4401, mat: 'metal', tint: RUST },
    { kind: 'deco', kindOf: 'gantry', p: [96.2, 19.4, 5.0], s: [1.6, 3.0, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'gantry', p: [112.3, 18.6, -5.4], s: [1.6, 3.0, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'gantry', p: [126.7, 18.2, 3.2], s: [1.6, 3.0, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'cables', p: [110.0, 20.6, 0], count: 4, spread: 8.0, scale: 1.6, seed: 4402, mat: 'metal', tint: SOOT },
    { kind: 'light', p: [96.2, 18.8, 0], color: 0xcfe2ff, intensity: 10, distance: 22 },
    { kind: 'light', p: [112.3, 17.8, 0], color: 0xcfe2ff, intensity: 9, distance: 20 },
    { kind: 'light', p: [126.7, 17.4, -2.0], color: 0xcfe2ff, intensity: 9, distance: 20 },

    /* ============================================================================ */
    /* BEAT 6 — THE LAUNDER CROSSING                 ( CP2 sits on the drop deck )   */
    /* First the commit: a 4.20 m gap that also drops 2.3 m off the end of a bed you  */
    /* have been dodging a ram on. It is the longest jump on the main line at 80% of  */
    /* budget, and 2.3 m is past the jump apex, so it is the one place on this stage  */
    /* you cannot change your mind and climb back. Then the two combinations this     */
    /* stage exists to teach.                                                         */
    /*                                                                                */
    /*   BELT INTO RAM   belt A runs +X at 5.0 m/s and a ram hangs over the MIDDLE of  */
    /*                   it on a 4.6 s cycle with a 3.4 m throw. You cannot stroll it  */
    /*                   and you cannot sprint it blind; you step on when it goes UP.  */
    /*   BELT ACROSS     belt B pushes +Z at 2.8 m/s across a 3.6 m launder, with a    */
    /*                   bed of slag teeth on the side it pushes you towards. The belt */
    /*                   is not the hazard. Standing still on it is.                   */
    /* ============================================================================ */

    { kind: 'platform', p: [136.6, 9.8, 0], s: [5.6, 1, 6.0], mat: 'grate', glow: MINT, stripe: true }, // CP2, top 10.3, gap 4.20 at -2.30
    { kind: 'lava', p: [131.8, 8.4, 0], s: [4.0, 1.2, 14] }, // surface 9.0, the channel under the commit

    { kind: 'conveyor', p: [146.6, 9.8, 0], s: [8.0, 1, 4.0], dir: [1, 0, 0], power: 5.0, mat: 'conveyor' }, // top 10.3, gap 3.20
    { kind: 'crusher', p: [146.6, 14.8, 0], s: [3.0, 2.2, 4.4], axis: [0, -1, 0], travel: 3.4, period: 4.6, phase: 0, dwell: 1.8, mat: 'metal' }, // over the belt's middle; the long throw is what makes it readable from the deck

    { kind: 'lava', p: [152.3, 7.7, 0], s: [3.4, 1.2, 14] }, // surface 8.3
    { kind: 'platform', p: [156.2, 8.9, -1.2], s: [4.4, 1, 4.4], mat: 'metal', glow: COLD, stripe: true }, // top 9.4, gap 3.40 at -0.90

    { kind: 'lava', p: [159.7, 7.7, 0], s: [2.6, 1.2, 14] }, // surface 8.3
    { kind: 'conveyor', p: [164.5, 8.9, 0], s: [7.0, 1, 3.6], dir: [0, 0, 1], power: 2.8, mat: 'conveyor' }, // top 9.4, gap 2.60, pushes SIDEWAYS
    { kind: 'spikes', p: [164.5, 9.55, 2.7], s: [6.0, 0.5, 1.2], dir: [0, 1, 0] }, // the side it pushes you towards

    { kind: 'lava', p: [169.45, 6.8, 0], s: [2.9, 1.2, 14] }, // surface 7.4
    { kind: 'platform', p: [173.2, 8.0, -1.6], s: [4.6, 1, 5.0], mat: 'metal', glow: COLD, stripe: true }, // top 8.5, gap 2.90 at -0.90
    { kind: 'spikes', p: [173.2, 8.65, 0.3], s: [3.4, 0.5, 1.0], dir: [0, 1, 0] }, // lands you on the -z half, deliberately

    { kind: 'text', p: [141.0, 13.2, 0], rot: [0, -Math.PI / 2, 0], text: 'BELT INTO RAM', size: 0.44, color: HOT },
    { kind: 'text', p: [160.0, 12.4, -2.6], rot: [0, -Math.PI / 2, 0], text: 'IT PUSHES SIDEWAYS', size: 0.36, color: HOT },
    { kind: 'deco', kindOf: 'gantry', p: [146.6, 17.0, 3.6], s: [1.4, 2.6, 1.4], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'gantry', p: [146.6, 17.0, -3.6], s: [1.4, 2.6, 1.4], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'launder', p: [158.0, 12.0, 7.0], s: [40, 0.5, 0.7], mat: 'metal', tint: RUST },
    { kind: 'deco', kindOf: 'quenchtank', p: [168.0, 11.4, -7.4], s: [3.2, 2.0, 3.2], mat: 'metal', tint: RUST },
    { kind: 'deco', kindOf: 'slagpot', p: [176.0, 10.6, 6.6], s: [2.6, 2.4, 2.6], mat: 'metal', tint: HOT },
    { kind: 'light', p: [146.6, 13.4, 0], color: EMBER, intensity: 9, distance: 22 },
    { kind: 'light', p: [164.5, 12.6, 0], color: HOT, intensity: 8, distance: 20, flicker: 0.1 },

    /* ============================================================================ */
    /* BEAT 7 — THE LIP                                ( CP3 sits on it )           */
    /* A wide plate on the rim of the crucible, nothing on it, and the first time you */
    /* can see the whole set-piece laid out below you.                                */
    /*                                                                                */
    /* COIN 2 is the DROP: two maintenance ledges bolted to the rim below it, the     */
    /* first 1.2 m down and the second 1.0 m down. Committing is a step down; the part */
    /* you have to think about is the 2.90 m back UP at +1.0 m, which is 76% of budget */
    /* and the tightest optional return on the stage. Both ledges are cold steel with  */
    /* a cyan edge, like every other landable surface in this building — the previous  */
    /* build painted them, and the other two coin ledges, in the lava's own colour.    */
    /* ============================================================================ */

    { kind: 'platform', p: [182.1, 7.1, 0], s: [6.4, 1, 7.0], mat: 'stone', glow: MINT, stripe: true }, // CP3, top 7.6, gap 3.40 at -0.90

    { kind: 'platform', p: [180.3, 5.9, -5.4], s: [2.6, 1, 2.6], mat: 'metal', glow: COLD, stripe: true }, // ledge 1, top 6.4, a 0.60 m step off the rim at -1.20
    { kind: 'platform', p: [185.4, 6.1, -7.6], s: [2.4, 1, 2.4], mat: 'metal', glow: COLD, stripe: true }, // ledge 2, top 6.6, 2.60 along at +0.20, coin on top
    { kind: 'deco', kindOf: 'ring', p: [185.4, 7.7, -7.6], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: EMBER },
    { kind: 'deco', kindOf: 'rail', p: [182.4, 7.4, -4.0], s: [8.0, 0.08, 0.08], mat: 'metal', tint: RUST },
    { kind: 'light', p: [183.0, 8.8, -6.4], color: EMBER, intensity: 8, distance: 16 },

    { kind: 'text', p: [179.0, 11.0, 0], rot: [0, -Math.PI / 2, 0], text: 'THE CRUCIBLE', size: 0.62, color: EMBER },
    { kind: 'text', p: [179.0, 10.4, 0], rot: [0, -Math.PI / 2, 0], text: 'six landings down  ·  one of them will not hold you', size: 0.22, color: 0xb08464 },
    { kind: 'deco', kindOf: 'crucible', p: [182.1, 12.4, 4.6], s: [3.4, 4.0, 3.4], mat: 'obsidian', tint: HOT },
    { kind: 'deco', kindOf: 'gantry', p: [182.1, 12.4, -4.6], s: [1.4, 6.4, 1.4], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'banner', p: [182.1, 13.2, 4.6], s: [0.12, 3.0, 1.8], mat: 'panel', tint: EMBER },
    { kind: 'light', p: [182.1, 12.0, 0], color: 0xcfe2ff, intensity: 10, distance: 24 },

    /* ============================================================================ */
    /* BEAT 8 — SET-PIECE : THE CRUCIBLE STAIR                                      */
    /* Six landings over 45 m of open pot, and not one dimension of them is an        */
    /* arithmetic sequence. Footprints 4.6x3.4 / 4.8x4.0 / 4.4x3.6 / 5.6x4.2 /        */
    /* 4.4x3.8 / 5.8x4.6 — every one different. Height steps -2.2 / -1.2 / +0.5 /     */
    /* -1.8 / -1.1 / -0.8: one of them CLIMBS and no two are equal. Gaps 3.60 / 3.22  */
    /* / 3.00 / 2.60 / 3.00 / 3.20 — down, down, down, up, up, and two of them are    */
    /* diagonals rather than straight-ahead hops. z centres +3.8 / -1.8 / +1.0 /      */
    /* -3.0 / +0.6 / 0, which is not an alternation of anything. (The previous build's*/
    /* climax was four byte-identical 4.2x3.2 slabs at a constant -1.50 with gaps     */
    /* stepping 3.20 / 3.40 / 3.60 / 3.80 — a literal +0.20 progression — and its only*/
    /* hazard across the whole 43 m was the static pool underneath.)                  */
    /*                                                                                */
    /* And this one is not quiet. Landing 2 is a COOLING PLATE on the MAIN LINE that  */
    /* gives way under you (3.4 s solid, 1.0 s of cracking warning, 1.6 s gone).      */
    /* Landing 4 — the widest, the one you are most tempted to stand on — has a RAM   */
    /* over it on a 4.8 s cycle. COIN 4 hangs two more cooling plates off landing 1,  */
    /* out over the widest part of the pot, on a shorter 5.2 s cycle and phased 0.42  */
    /* apart from each other so the way back is never the way you came. That is five  */
    /* clock-driven machines inside the set-piece. The crucible surface is at y 0.0,  */
    /* so the drop under landing 1 is 5.4 m and the drop under the gate is 1.0 m: the */
    /* safety net runs out exactly as the machines get slower and heavier.            */
    /*                                                                                */
    /* THE GATE (CP5 in front of it): one ram, 5.6 s, 2.2 s of dwell — the slowest    */
    /* machine in the foundry — dropping across a 5.8 m plate with slag teeth down    */
    /* its -z side. The clear lane is 3.5 m wide and you have to be walking through it*/
    /* while the head is up. That is the whole exam, and the checkpoint in front of it*/
    /* hands you 2.20 s of open gate on every single respawn.                          */
    /* ============================================================================ */

    { kind: 'platform', p: [191.2, 4.9, 3.8], s: [4.6, 1, 3.4], mat: 'metal', glow: COLD, stripe: true }, // landing 1, top 5.4, gap 3.60 at -2.20 (one-way: 2.2 m is past the apex)
    { kind: 'vanish', p: [198.5, 3.7, -1.8], s: [4.8, 1, 4.0], mat: 'panel', cycle: { on: 3.4, off: 1.6, warn: 1.0, phase: 0 } }, // COOLING PLATE, top 4.2, gap 3.22 diagonal (2.60 x, 1.90 z) at -1.20
    { kind: 'platform', p: [206.1, 4.2, 1.0], s: [4.4, 1, 3.6], mat: 'metal', glow: MINT, stripe: true }, // landing 3 = CP4, top 4.7, gap 3.00 at +0.50 — a CLIMB, mid-stair
    { kind: 'platform', p: [213.7, 2.4, -3.0], s: [5.6, 1, 4.2], mat: 'metal', glow: COLD, stripe: true }, // landing 4, top 2.9, gap 2.60 at -1.80
    { kind: 'crusher', p: [213.7, 6.8, -3.0], s: [3.0, 2.2, 3.8], axis: [0, -1, 0], travel: 2.8, period: 4.8, phase: 0, dwell: 1.8, mat: 'metal' }, // the stair ram, over the widest landing
    { kind: 'platform', p: [221.7, 1.3, 0.6], s: [4.4, 1, 3.8], mat: 'metal', glow: MINT, stripe: true }, // landing 5 = CP5, top 1.8, gap 3.00 at -1.10
    { kind: 'platform', p: [230.0, 0.5, 0], s: [5.8, 1, 4.6], mat: 'grate', glow: COLD, stripe: true }, // the gate plate, top 1.0, gap 3.20 at -0.80
    { kind: 'crusher', p: [230.0, 6.3, 0], s: [3.4, 2.2, 4.0], axis: [0, -1, 0], travel: 4.2, period: 5.6, phase: 0, dwell: 2.2, mat: 'metal' }, // THE GATE
    { kind: 'spikes', p: [230.0, 1.35, -1.7], s: [3.0, 0.5, 1.0], dir: [0, 1, 0] }, // teeth down the -z side, so the lane is on +z

    // COIN 4 — two cooling plates hung off landing 1 on the +z side, out over the
    // widest part of the pot. Two ways on: a 1.40 m step off landing 1 onto plate A,
    // or a 5.10 m run jump straight off the lip at -3.4 m (91% of budget, the longest
    // optional line on the stage) for anyone who reads the pot early. Plate A to
    // plate B is 1.90 m flat; the way out is 2.75 m back onto landing 1 at +1.2 m
    // (75%). Both plates are solid only 3.4 s in 5.2 and they are phased 0.42 apart,
    // so the plate you crossed on is not the plate you come back on. The verb here is
    // TIMING — the one coin on this stage that can run out the clock on you instead
    // of simply dropping you.
    { kind: 'vanish', p: [190.6, 3.7, 8.4], s: [3.0, 1, 3.0], mat: 'panel', cycle: { on: 2.6, off: 1.8, warn: 0.8, phase: 0 } }, // plate A, top 4.2
    { kind: 'vanish', p: [195.4, 3.7, 9.6], s: [2.8, 1, 2.8], mat: 'panel', cycle: { on: 2.6, off: 1.8, warn: 0.8, phase: 0.42 } }, // plate B, top 4.2, coin on top, 1.90 along
    { kind: 'deco', kindOf: 'ring', p: [195.4, 5.3, 9.6], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: EMBER },

    { kind: 'deco', kindOf: 'mould', p: [199.0, 1.6, 8.6], s: [2.2, 1.2, 2.2], count: 6, spread: 5.0, seed: 5501, mat: 'stone', tint: RUST },
    { kind: 'deco', kindOf: 'mould', p: [222.0, 1.4, -8.0], s: [2.2, 1.2, 2.2], count: 5, spread: 4.4, seed: 5502, mat: 'stone', tint: RUST },
    { kind: 'deco', kindOf: 'spout', p: [206.0, 9.4, -8.6], s: [1.6, 2.6, 1.6], mat: 'metal', tint: HOT },
    { kind: 'deco', kindOf: 'crane', p: [214.0, 13.6, 0], s: [3.0, 1.4, 20.0], mat: 'metal', tint: RUST }, // the pour crane, riding above the pot
    { kind: 'deco', kindOf: 'cranerail', p: [212.0, 14.6, 9.4], s: [56, 0.5, 0.5], mat: 'metal', tint: RUST },
    { kind: 'deco', kindOf: 'cranerail', p: [212.0, 14.6, -9.4], s: [56, 0.5, 0.5], mat: 'metal', tint: RUST },
    { kind: 'deco', kindOf: 'gantry', p: [230.0, 9.2, 3.8], s: [1.6, 3.6, 1.6], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'gantry', p: [230.0, 9.2, -3.8], s: [1.6, 3.6, 1.6], mat: 'obsidian' },
    { kind: 'text', p: [226.0, 3.8, 0], rot: [0, -Math.PI / 2, 0], text: 'GATE', size: 0.5, color: HOT },
    { kind: 'text', p: [195.0, 7.6, -1.8], rot: [0, -Math.PI / 2, 0], text: 'THIS PLATE IS STILL COOLING', size: 0.3, color: HOT },
    { kind: 'light', p: [194.0, 9.4, 0], color: EMBER, intensity: 9, distance: 24 },
    { kind: 'light', p: [212.0, 7.0, 0], color: EMBER, intensity: 9, distance: 24 },
    { kind: 'light', p: [230.0, 8.0, 0], color: 0xcfe2ff, intensity: 11, distance: 22 },

    /* ============================================================================ */
    /* BEAT 9 — THE POUR                                                            */
    /* You are 1.0 m above live metal and the only way out is up. A tuyere on the pot */
    /* floor throws you 7.6 m; the casting floor is 4.8 m above the pad's face. It is */
    /* the stage's only launch, and the only place the main line gains more than a    */
    /* metre of height in one move.                                                   */
    /*                                                                                */
    /* THE PAD LAW (foundry-3's, applied here). controller.js rises a bounce at       */
    /* gravFall (54), not gravRise, and holding jump on the contact frame multiplies  */
    /* the apex by 1.25 (BOUNCE_HELD_BONUS). With P = 7.6 and a rise of 4.80 m:       */
    /*   walk (6.0) / no hold   t 0.853 s -> 5.12 m    sprint / no hold  -> 10.40 m   */
    /*   walk (6.0) / hold      t 1.010 s -> 6.06 m    sprint / hold     -> 12.33 m   */
    /* reachcheck.mjs fires the bounce one player radius before the pad's near edge,  */
    /* i.e. from x 243.25, so the whole entry-speed band lands between x 248.37 and    */
    /* x 255.58. The casting floor spans 247.8..256.4 — 0.57 m of margin under the     */
    /* slowest arc, 0.82 m past the fastest, and nothing lethal inside it.            */
    /*                                                                                */
    /* A pad arc is omnidirectional in the graph, so the BACKWARD bounce is checked   */
    /* too. The gate ram's parked head sits 14.75 m behind the pad's far lip along    */
    /* that line, and the longest arc this pad can throw at a target 6.10 m above it  */
    /* is 11.57 m. It cannot reach. That is the whole reason BEAT 9 puts a pour floor */
    /* between the gate and the blast plate rather than standing the pad straight off */
    /* the gate: at 4.8 m of throw and 4.6 m of separation the harness reported that  */
    /* head as REACHABLE, and a parked ram you can bounce onto is a perch with three  */
    /* full-stretch exits, which is exactly the defect this rebuild exists to remove. */
    /* ============================================================================ */

    { kind: 'platform', p: [238.0, 0.5, 0], s: [4.2, 1, 4.6], mat: 'grate', glow: COLD, stripe: true }, // pour floor, top 1.0, gap 3.00 flat
    { kind: 'platform', p: [245.2, 0.5, 0], s: [3.8, 1, 4.2], mat: 'grate', glow: COLD, stripe: true }, // blast plate, top 1.0, gap 3.20 flat
    { kind: 'jumppad', p: [245.2, 1.15, 0], s: [3.2, 0.3, 3.2], power: 7.6 }, // THE TUYERE — apex 7.6 m
    { kind: 'platform', p: [252.1, 5.6, 0], s: [8.6, 1, 8.0], mat: 'obsidian', glow: LILAC, stripe: true }, // the casting floor, top 6.1

    { kind: 'deco', kindOf: 'tuyere', p: [245.2, 2.2, -3.2], s: [1.2, 1.6, 1.2], mat: 'metal', tint: HOT },
    { kind: 'deco', kindOf: 'archway', p: [257.4, 9.0, 0], count: 1, scale: 3.4, seed: 6601, mat: 'obsidian', tint: EMBER },
    { kind: 'deco', kindOf: 'ingot', p: [253.4, 6.4, 3.0], s: [1.6, 0.5, 0.8], count: 8, spread: 2.4, seed: 6602, mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'ingot', p: [251.0, 6.4, -3.2], s: [1.6, 0.5, 0.8], count: 7, spread: 2.2, seed: 6603, mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'beacon', p: [260.0, 8.4, 0], s: [0.6, 2.8, 0.6], mat: 'emissive', tint: LILAC },
    { kind: 'text', p: [243.0, 5.0, 0], rot: [0, -Math.PI / 2, 0], text: 'STAND ON THE TUYERE', size: 0.34, color: COLD },
    { kind: 'text', p: [250.0, 8.6, 0], rot: [0, -Math.PI / 2, 0], text: 'DESCENT', size: 0.42, color: EMBER },
    { kind: 'light', p: [245.2, 3.6, 0], color: COLD, intensity: 10, distance: 18 },
    { kind: 'light', p: [252.1, 9.0, 0], color: LILAC, intensity: 18, distance: 30 },

    /* ============================================================================ */
    /* THE MELT — the floor of the building, and the reason the stage is called what  */
    /* it is called. `lava` takes its surface from the TOP of its box (lava.js:247,   */
    /* staticY = p.y + s.y/2), so every pool below is p.y -4 with s.y 8 and its       */
    /* surface is exactly y 0.0. Nothing on the route is landable below y 1.0.        */
    /* ============================================================================ */

    { kind: 'lava', p: [43, -4, 0], s: [118, 8, 64] }, // x -16..102, surface 0.0
    { kind: 'lava', p: [140, -4, 0], s: [80, 8, 64] }, // x 100..180, surface 0.0
    { kind: 'lava', p: [221, -4, 0], s: [88, 8, 52] }, // the crucible, x 177..265, surface 0.0

    /* ============================================================================ */
    /* THE WORKS — background architecture, all of it at |z| >= 9 or below the melt   */
    /* line, i.e. nowhere a player could read it as a landing. Two ladle cranes ride   */
    /* their rails above head height (BEAT 3 and BEAT 8); the stacks sink as the stage */
    /* descends, so the roof appears to rise as you go down.                           */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'stack', p: [50, 6, 30], s: [10, 30, 10], count: 7, spread: 18, seed: 3311, tint: 0x1a0f0a },
    { kind: 'deco', kindOf: 'stack', p: [160, 2, -32], s: [11, 34, 11], count: 7, spread: 20, seed: 4422, tint: 0x1a0f0a },
    { kind: 'deco', kindOf: 'launder', p: [110, 21.0, 11.5], s: [200, 0.6, 0.9], mat: 'metal', tint: RUST },
    { kind: 'deco', kindOf: 'launder', p: [110, 22.4, -11.5], s: [200, 0.6, 0.9], mat: 'metal', tint: RUST },
    { kind: 'deco', kindOf: 'cables', p: [110, 24.4, 0], count: 6, spread: 30, scale: 2.2, seed: 7701, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'cokebin', p: [60, 22.0, 14], s: [4.0, 6.0, 4.0], count: 6, spread: 12, seed: 5533, tint: RUST },
    { kind: 'deco', kindOf: 'screen', p: [100, 18.0, 12.0], s: [0.4, 5.0, 8.0], mat: 'emissive', tint: EMBER },
    { kind: 'deco', kindOf: 'slagpot', p: [200, 3.4, 14.0], s: [2.4, 2.2, 2.4], count: 5, spread: 8, seed: 6644, tint: HOT },
    { kind: 'deco', kindOf: 'rocks', p: [120, -1.0, 22], count: 12, spread: 20, scale: 2.4, seed: 7755, tint: 0x1c1210 },
    { kind: 'deco', kindOf: 'rocks', p: [180, -1.0, -22], count: 12, spread: 20, scale: 2.4, seed: 8866, tint: 0x1c1210 },
    { kind: 'deco', kindOf: 'slabs', p: [30, -1.2, -20], count: 10, spread: 14, scale: 2.0, seed: 8867, tint: 0x1c1210 },

    // Uplights on the melt, one per beat, so the route always reads as a dark line
    // drawn on top of something bright.
    { kind: 'light', p: [24, 1.4, 0], color: HOT, intensity: 14, distance: 40, flicker: 0.16 },
    { kind: 'light', p: [64, 1.4, 0], color: HOT, intensity: 14, distance: 40, flicker: 0.16 },
    { kind: 'light', p: [108, 1.4, 0], color: HOT, intensity: 14, distance: 40, flicker: 0.16 },
    { kind: 'light', p: [152, 1.4, 0], color: HOT, intensity: 14, distance: 40, flicker: 0.16 },
    { kind: 'light', p: [196, 1.2, 0], color: HOT, intensity: 16, distance: 44, flicker: 0.2 },
    { kind: 'light', p: [238, 1.2, 0], color: HOT, intensity: 12, distance: 34, flicker: 0.18 },
  ],
};
