/**
 * ASCENDANT — SKY TEMPLE 3 : "THE LAST STEP"
 * runtime/data/stages/temple-3.js
 *
 * The finale of the whole game. Everything the four worlds taught, remixed and asked
 * for at once, in five movements, and then a deadline.
 *
 * SHAPE      400.6 m of travel, 104 gameplay objects, 61 dynamic hazards drawn from
 *            16 families, 12 checkpoints, 6 coins — measured by
 *            `node _harness/reachcheck.mjs temple-3`, not estimated. Five movements:
 *
 *   I    THE SHATTERING STAIR   x  -4 – 113   vanish sky-steps, a beam, an orbit tile
 *   II   THE LANTERN BRIDGE     x 115 – 185   laser racks, a sweep, rotors, windmills
 *   III  THE CATHEDRAL RIM      x 186 – 260   ice + wind + a censer ring, out and back
 *   IV   THE UNDERSTONE         x 259 – 325   presses, belts, saws, lava, a piston
 *   V    THE ASCENT             x 325 – 407   pad, lift, sprint, a sinking bridge
 *
 * CHECKPOINT SPACING  42.8 / 41.0 / 35.2 / 35.8 / 24.8 / 30.8 / 20.4 / 37.8 / 17.4 /
 *            18.0 / 27.4 m. No leg is longer than 43 m and none of the hard ones is
 *            longer than 31 m: a death on the ice arc, in the machine deck or on the
 *            ascent costs well under half a minute of replay.
 *
 * DESIGN LAW FOR THIS STAGE: difficulty 10, but every death is the player's fault and
 * every death is CHEAP. Nothing here is blind, nothing kills from off-screen, and no
 * hazard can reach a movement the player has already left.
 *
 * CONVENTIONS (full list in runtime/data/index.js):
 *   p = CENTRE, s = FULL size, so a top surface is p[1] + s[1]/2 and an object spans
 *   x from p[0] - s[0]/2 to p[0] + s[0]/2. Every gap quoted below is EDGE TO EDGE.
 *   rot/yaw are radians, yaw 0 faces +X. `stripe: true` = "you have to jump to reach
 *   this". A mover's `p` is its HOME pose, `motion.to` its far pose; for a circle or
 *   orbit mover `p` is the ORBIT CENTRE and the reachable edges are at p +/- radius.
 *   A vanish `cycle.phase` is a FRACTION OF THE CYCLE (0..1), not seconds; a rotor
 *   `phase` is a FRACTION OF A REVOLUTION; a pendulum `amp` is RADIANS.
 *
 * RHYTHM — the numbers, not the intention. Sorted by x, the forward gaps on the main
 *   line run 0.1 / 0.4 / 0.6 / 1.0 / 1.2 / 1.3 / 1.4 / 1.5 / 1.6 / 1.7 / 1.9 / 2.0 /
 *   2.1 / 2.2 / 2.4 / 2.5 / 2.6 / 2.9 / 3.0 / 3.1 / 3.2 / 3.3 / 3.4 / 3.5 / 3.8 /
 *   4.1 / 4.3 / 4.4 / 5.6 / 5.8 — a genuine spread from a step to a sprint, not one
 *   stride repeated. The height ladder is not a ramp either: the stage falls -2.0 m
 *   off the shattering stair (BEAT 4), -1.6 m onto the second beam approach, -1.4 m
 *   onto the rim's buttress head, -1.7 then -2.0 m into the machine deck, -1.6 m into
 *   the grate pit and -2.5 m into the maintenance gallery, against rises of +0.9,
 *   +1.2, +1.6 and two launch pads. Fourteen distinct drops of 1.0 m or more.
 *
 * REACH BUDGET USED (safe limits from CONTRACT section 0, SAFE = 0.83 of the true
 *                    envelope: run 4.35 flat / 3.80 at +1.0 / 3.11 at +1.8 /
 *                    5.15 at -2.0, sprint 6.17 flat):
 *   longest run-speed flat gap on the main line   3.5 m   (BEAT 7, onto the shuttle)
 *   longest gap with a rise                       3.4 m at +0.9  (BEAT 2)
 *   longest gap with a drop                       4.4 m at -2.0  (BEAT 4 — the plunge)
 *   the TWO sprint gaps                           5.8 m over the grate pit (BEAT 19,
 *                                                 optional: the grate is the other
 *                                                 way through) and 5.6 m on the
 *                                                 ascent runway (BEAT 26, required)
 *   biggest single step up                        1.6 m over 1.6 m (the sinking bridge)
 *
 * HEIGHT LADDER: 0.5 (threshold) -> 1.8 (first beam) -> -0.2 (the plunge) -> 2.9
 *                (stair landing) -> 4.7 (bridge set-piece) -> 3.1 (rim buttress head)
 *                -> 7.0 (the updraft ledge) -> 5.7 (bell floor) -> -0.6 (the gallery,
 *                the lowest floor in the game) -> 3.8 (launch court) -> 24.2 (gate).
 *
 * THE COLLAPSE (BEAT 24) — read this before touching object indices. It is a
 *   `chase` on the **Y axis**: a void deck that rises out of the cloud sea and eats
 *   the ascent from underneath. That axis choice is load-bearing, not cosmetic:
 *   chase.js `_buildKill()` sizes the kill volume as `killDepth = max(travel+40, 60)`
 *   BEHIND the front, so an X-axis collapse anywhere near the gate would put a 90 m
 *   deep lethal box back over MOVEMENT III and IV whatever the clock said. On the Y
 *   axis the box is bounded laterally by the front's own face — `p:[369,0,0]`,
 *   `s:[88,4,44]` — so it occupies x 325..413 and NOTHING outside it. The last
 *   surface of MOVEMENT IV ends at x 324.8. The collapse is therefore incapable of
 *   killing anyone who has not already reached the launch court, at any clock value.
 *
 *   It is also visible for its whole life: it arms at t = 176 at y = -26, 29.8 m
 *   below the court, and climbs at 1.6 m/s through the cloud deck the player has been
 *   looking down into since BEAT 23. It reaches the court at t = 194.6, the first
 *   terrace at 197.9, the runway at 200.2 and the last terrace at 204.9, and parks at
 *   y = 23.4 — 0.8 m under the gate floor, which is the one surface in x 325..413 it
 *   never takes. Par is 205 s: a player at pace meets it on the climb, which is the
 *   point of it, and a player who beats it to the gate wins the race it exists to be.
 *
 * CHECKPOINT CLOCKS: every checkpoint pins a rising `clockOffset` (12 / 32 / 52 / 68 /
 *   86 / 100 / 114 / 126 / 146 / 158 / 168 / 186), the median clock at that deck.
 *   `Stage.resetFrom()` rewinds to it, so every respawn hands back the SAME hazard
 *   phase AND the same race against the collapse: from CP10 the court gives 8 s
 *   before the front arms and 26.6 s before it takes the deck; from CP11 the runway
 *   gives 14.2 s before the front reaches it, against a ~11 s climb. No checkpoint
 *   leaves the clock free-running under an armed hazard.
 *
 * DETERMINISM: every timed object is a pure function of the stage clock (CONTRACT
 * section 16).
 */

const GOLD = 0xffc35c; // theme accent — signage, lit trim, jump-critical edges
const IVORY = 0xfff8e6; // palette.safeEdge — the brightest thing on a landing
const HOT = 0xff1044; // palette.kill — reserved for things that end the run
const MINT = 0x18d69a; // palette.checkpointOn
const VIOLET = 0xd9b6ff; // palette.finish — used for nothing else in any theme
const STONE = 0xa88f66; // palette.deco
const DUSK = 0x6a5844; // shadowed temple masonry, for text that must recede
const EMBER = 0xff8a3c; // the understone's furnace light — the one foundry colour here
const FROST = 0xdff0ff; // rim ice and the wind that comes off it

export default {
  id: 'temple-3',
  world: 'temple',
  name: 'THE LAST STEP',
  subtitle: 'Everything, all at once, and then the sky',
  par: 205000,
  difficulty: 10,

  spawn: { p: [-1.0, 0.6, 0], yaw: 0 },
  killY: -70,

  /* Twelve checkpoints, every one immediately before the spike it protects, every one
     pinning a rising clockOffset so a respawn is a rerun and never a new lottery. */
  checkpoints: [
    { p: [25.6, 1.5, 0], yaw: 0, clockOffset: 12 }, //  0 threshold deck, facing the stair
    { p: [68.4, 2.0, 1.8], yaw: 0, clockOffset: 32 }, //  1 the rest, half way down the stair
    { p: [109.4, 3.0, 0], yaw: 0, clockOffset: 52 }, //  2 stair landing — MOVEMENT II
    { p: [144.6, 4.3, -2.6], yaw: 0, clockOffset: 68 }, //  3 the rotor deck, mid bridge
    { p: [180.4, 4.0, 0], yaw: 0, clockOffset: 86 }, //  4 the plaza — MOVEMENT III
    { p: [205.2, 3.2, 9.6], yaw: 0, clockOffset: 100 }, //  5 the buttress head, out on the rim
    { p: [236.0, 6.2, 1.8], yaw: 0, clockOffset: 114 }, //  6 the bell approach
    { p: [256.4, 5.8, 0.8], yaw: 0, clockOffset: 126 }, //  7 the bell floor — MOVEMENT IV
    { p: [294.2, 0.4, -1.0], yaw: 0, clockOffset: 146 }, //  8 past the grate pit
    { p: [311.6, 1.6, 2.4], yaw: 0, clockOffset: 158 }, //  9 off the fast belt, before the piston
    { p: [329.6, 3.9, 0], yaw: 0, clockOffset: 168 }, // 10 the launch court — MOVEMENT V
    { p: [357.0, 12.7, -3.4], yaw: 0, clockOffset: 186 }, // 11 the ascent runway, above the front
  ],

  finish: { p: [402.6, 24.8, 0], yaw: 0 },

  /* Six coins, and not one of them is a hop-out-hop-back tile. Every one is an
     ALTERNATE LINE through a beat: it leaves the main route, costs time and risk, and
     rejoins further on. Four of the six are strictly harder than the main line. */
  coins: [
    { p: [61.0, 4.6, 12.4] }, // I   — ride the orbit tile out over the void and back
    { p: [127.2, 4.7, 7.6] }, // II  — the low catwalk under the sweeping laser
    { p: [222.0, 6.7, 13.2] }, // III — two ledges further out into the crosswind
    { p: [291.6, 2.2, -6.6] }, // IV  — the maintenance gallery under the presses
    { p: [303.0, 3.6, 4.4] }, // IV  — the high catwalk over the saw gauntlet
    { p: [348.0, 15.4, -9.4] }, // V   — the pillar top off the lift, under a blade
  ],

  objects: [
    /* ============================================================================ */
    /* MOVEMENT I — THE SHATTERING STAIR                                            */
    /* ============================================================================ */

    /* ---------------------------------------------------------------------------- */
    /* BEAT 1 — THE THRESHOLD                                                       */
    /* Solid ground, the name of the place, and a view down the stair so the player  */
    /* can watch a full vanish cycle before committing to anything.                  */
    /* ---------------------------------------------------------------------------- */

    { kind: 'platform', p: [2, 0, 0], s: [12, 1, 13], mat: 'stone', glow: STONE },

    { kind: 'text', p: [-3.6, 3.1, 0], rot: [0, -Math.PI / 2, 0], text: 'THE LAST STEP', size: 0.86, color: GOLD },
    { kind: 'text', p: [-3.6, 2.4, 0], rot: [0, -Math.PI / 2, 0], text: 'SKY TEMPLE  ·  III', size: 0.28, color: DUSK },
    { kind: 'text', p: [-3.6, 1.85, 0], rot: [0, -Math.PI / 2, 0], text: 'five movements  ·  no shortcuts', size: 0.24, color: HOT },

    { kind: 'deco', kindOf: 'arch', p: [7.4, 5.4, 0], s: [1.4, 1.1, 15.0], mat: 'obsidian', tint: GOLD },
    { kind: 'deco', kindOf: 'pillar', p: [7.4, 3.0, 6.6], s: [1.3, 6.0, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [7.4, 3.0, -6.6], s: [1.3, 6.0, 1.3], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'statue', p: [2.0, 2.6, 5.2], s: [1.6, 4.2, 1.6], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'statue', p: [2.0, 2.6, -5.2], s: [1.6, 4.2, 1.6], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'brazier', p: [5.0, 1.4, 3.4], s: [1.0, 1.3, 1.0], mat: 'metal', tint: GOLD },
    { kind: 'deco', kindOf: 'brazier', p: [5.0, 1.4, -3.4], s: [1.0, 1.3, 1.0], mat: 'metal', tint: GOLD },
    { kind: 'light', p: [5.0, 2.6, 3.4], color: GOLD, intensity: 8, distance: 16, flicker: 0.28 },
    { kind: 'light', p: [5.0, 2.6, -3.4], color: GOLD, intensity: 8, distance: 16, flicker: 0.28 },
    { kind: 'light', p: [2.0, 5.0, 0], color: 0xfff0d0, intensity: 10, distance: 26 },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 2 — THREE STONES, THREE DIFFERENT JUMPS                                 */
    /* 1.3 m flat, 3.4 m at +0.9 and off-axis, 3.3 m flat. A stride, a stretch and a */
    /* commit, in ten seconds, before anything is dangerous — so the player has met  */
    /* all three of the stage's jump lengths before the floor starts leaving.        */
    /* ---------------------------------------------------------------------------- */

    { kind: 'platform', p: [11.0, 0, 0], s: [3.4, 1, 5.0], mat: 'panel', glow: GOLD, stripe: true }, // gap 1.30, flat
    { kind: 'platform', p: [17.7, 0.9, 1.8], s: [3.2, 1, 4.6], mat: 'panel', glow: GOLD, stripe: true }, // gap 3.40, +0.9, off-axis
    { kind: 'platform', p: [25.6, 0.9, 0], s: [6.0, 1, 7.2], mat: 'stone', glow: STONE, stripe: true }, // gap 3.30 — CP0

    { kind: 'text', p: [22.4, 3.4, 0], rot: [0, -Math.PI / 2, 0], text: 'THE STAIR IS FALLING', size: 0.44, color: GOLD },
    { kind: 'text', p: [22.4, 2.85, 0], rot: [0, -Math.PI / 2, 0], text: 'watch one full cycle · then never stop', size: 0.24, color: DUSK },
    { kind: 'deco', kindOf: 'banner', p: [25.6, 5.1, 3.4], s: [0.1, 3.2, 1.8], mat: 'panel', tint: GOLD },
    { kind: 'deco', kindOf: 'banner', p: [25.6, 5.1, -3.4], s: [0.1, 3.2, 1.8], mat: 'panel', tint: GOLD },
    { kind: 'light', p: [25.6, 4.5, 0], color: MINT, intensity: 9, distance: 18 },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 3 — THE STAIR, FIRST HALF                                               */
    /* Four tiles on a 4.5 s cycle (2.6 solid / 0.5 warning / 1.4 gone) with phases  */
    /* 0.18 of a cycle apart. Gaps 2.2 / 3.3 / 4.4 / 3.0 and heights +0.4 / 0 / -2.0 */
    /* / +1.2 — the stair does not descend evenly, it FALLS, and the third tile is   */
    /* two metres below the second with a four-metre gap in front of it.             */
    /* ---------------------------------------------------------------------------- */

    { kind: 'vanish', p: [32.4, 1.3, -1.4], s: [3.2, 1, 3.6], mat: 'panel', cycle: { on: 2.6, off: 1.4, warn: 0.5, phase: 0.00 } }, // gap 2.20, +0.4
    { kind: 'vanish', p: [38.6, 1.3, 2.2], s: [2.6, 1, 3.0], mat: 'panel', cycle: { on: 2.6, off: 1.4, warn: 0.5, phase: 0.18 } }, // gap 3.31, flat, narrowest tile

    /* ---------------------------------------------------------------------------- */
    /* BEAT 4 — THE PLUNGE                                                          */
    /* The one place the stage spends the full -2.0 m / 5.15 m safe drop that        */
    /* CONTRACT section 0 licenses: a 4.4 m gap onto a tile two metres BELOW you,    */
    /* off-axis, on a cycle. You have to look down and go, and the spikes under it   */
    /* are lit so the fall reads before you take it.                                 */
    /* ---------------------------------------------------------------------------- */

    { kind: 'vanish', p: [46.0, -0.7, -2.0], s: [3.6, 1, 3.4], mat: 'panel', cycle: { on: 2.6, off: 1.4, warn: 0.5, phase: 0.36 } }, // gap 4.42, -2.0 ★
    { kind: 'spikes', p: [46.0, -4.4, -2.0], s: [6.0, 0.8, 5.4], dir: [0, 1, 0] }, // 3.9 m under the tile, purely so the drop has a floor to read against
    { kind: 'vanish', p: [52.2, 0.5, 0.6], s: [2.8, 1, 3.2], mat: 'panel', cycle: { on: 2.6, off: 1.4, warn: 0.5, phase: 0.54 } }, // gap 3.00, +1.2 back up

    { kind: 'text', p: [42.0, 3.2, -2.0], rot: [0, -Math.PI / 2, 0], text: 'DOWN', size: 0.5, color: HOT },
    { kind: 'deco', kindOf: 'pillar', p: [36.0, -6.0, 7.2], s: [1.6, 16.0, 1.6], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'pillar', p: [48.0, -7.0, -7.4], s: [1.6, 18.0, 1.6], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'lantern', p: [41.0, 4.4, 6.4], s: [0.7, 1.1, 0.7], mat: 'emissive', tint: GOLD },
    { kind: 'light', p: [46.0, 1.6, -2.0], color: HOT, intensity: 8, distance: 18, flicker: 0.1 },
    { kind: 'light', p: [42.0, 3.6, 0], color: GOLD, intensity: 7, distance: 24 },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 5 — THE BEAM, AND THE COIN THAT IS A ROUTE                              */
    /* A 6.4 m beam 1.1 m wide with a SLANTED laser over it — not the usual crossbar */
    /* at a fixed height, a bar that is 1.7 m up at one rail and 0.8 m up at the     */
    /* other, so the answer changes depending on which side of the beam you walk.    */
    /*                                                                              */
    /* COIN 1 is the stage's first alternate line, and it is a proper one: step off  */
    /* the beam onto a tile ORBITING its own hub out over the void (4.0 s, radius    */
    /* 2.4), ride it round to the far side, take the sky shelf, ride back, and drop  */
    /* onto the rest from the orbit's near sweep. A hammer turns over the whole      */
    /* thing at head height. Main line: the beam, and nothing else.                   */
    /* ---------------------------------------------------------------------------- */

    { kind: 'beam', p: [59.4, 1.4, 1.8], s: [6.4, 0.8, 1.1], mat: 'metal' }, // gap 2.60, +0.8, top 1.80
    { kind: 'laser', a: [56.6, 3.50, 1.25], b: [62.2, 2.60, 2.35], radius: 0.12, color: HOT, cycle: { on: 1.9, off: 0.8, warn: 0.5, phase: 0.25 } }, // slanted, long-on/short-off

    {
      kind: 'mover',
      p: [61.0, 1.8, 6.6],
      s: [2.6, 1, 2.6],
      mat: 'metal',
      motion: { type: 'orbit', radius: 2.4, axis: 'y', period: 4.0, phase: 0 },
    }, // ORBIT CENTRE — the tile passes x 58.6..63.4 and z 4.2..9.0, top 2.30

    { kind: 'platform', p: [61.0, 2.9, 12.4], s: [2.8, 1, 2.8], mat: 'panel', glow: HOT, stripe: true }, // COIN 1 shelf, off the orbit's far sweep
    { kind: 'rotor', p: [61.0, 4.0, 6.6], style: 'hammer', arms: 1, len: 2.6, thick: 0.5, period: 2.8, phase: 0.00, axis: [0, 1, 0] }, // 1.7 m over the orbiting tile: it takes your head, not your feet

    { kind: 'platform', p: [68.4, 1.4, 1.8], s: [5.2, 1, 5.6], mat: 'stone', glow: STONE, stripe: true }, // gap 3.20 — CP1

    { kind: 'deco', kindOf: 'ring', p: [61.0, 4.6, 12.4], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: HOT },
    { kind: 'deco', kindOf: 'ring', p: [61.0, 1.9, 6.6], s: [5.4, 0.14, 5.4], mat: 'emissive', tint: GOLD }, // the orbit track, lit, so the ride is legible from the beam
    { kind: 'deco', kindOf: 'pillar', p: [61.0, -2.6, 6.6], s: [1.0, 8.0, 1.0], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'rail', p: [59.4, 2.9, 2.6], s: [6.8, 0.07, 0.07], mat: 'metal', tint: GOLD },
    { kind: 'text', p: [55.4, 3.4, 1.8], rot: [0, -Math.PI / 2, 0], text: 'WALK', size: 0.4, color: DUSK },
    { kind: 'deco', kindOf: 'brazier', p: [68.4, 2.6, -1.4], s: [0.9, 1.2, 0.9], mat: 'metal', tint: GOLD },
    { kind: 'light', p: [61.0, 5.0, 12.4], color: HOT, intensity: 7, distance: 14 },
    { kind: 'light', p: [68.4, 3.6, -1.4], color: GOLD, intensity: 7, distance: 16, flicker: 0.3 },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 6 — THE STAIR, SECOND HALF                                              */
    /* Tighter cycle (1.8 solid / 0.35 warning / 1.2 gone) and phases 0.22 apart.    */
    /* Gaps 3.1 / 2.5 / 3.2 / 2.9 and heights +0.5 / 0 / +1.1 / -1.6: the second     */
    /* half climbs to its highest tile and then drops off the back of it, which is   */
    /* the last thing a player expects from a staircase.                             */
    /* ---------------------------------------------------------------------------- */

    { kind: 'vanish', p: [75.6, 1.9, 0.6], s: [3.0, 1, 3.2], mat: 'panel', cycle: { on: 1.8, off: 1.2, warn: 0.35, phase: 0.00 } }, // gap 3.10, +0.5
    { kind: 'vanish', p: [80.8, 1.9, -1.8], s: [2.4, 1, 2.8], mat: 'panel', cycle: { on: 1.8, off: 1.2, warn: 0.35, phase: 0.22 } }, // gap 2.50, flat
    { kind: 'vanish', p: [86.8, 3.0, 1.6], s: [3.2, 1, 3.0], mat: 'panel', cycle: { on: 1.8, off: 1.2, warn: 0.35, phase: 0.44 } }, // gap 3.24, +1.1 — the high tile
    { kind: 'vanish', p: [93.0, 1.4, -0.6], s: [3.4, 1, 3.4], mat: 'panel', cycle: { on: 1.8, off: 1.2, warn: 0.35, phase: 0.66 } }, // gap 2.90, -1.6 off the back

    { kind: 'beam', p: [100.2, 2.4, 0], s: [6.8, 0.6, 1.0], mat: 'metal' }, // gap 2.10, +0.8, top 2.70
    // A censer over the beam, swinging ACROSS it rather than along it — the first
    // pendulum in the game whose arc crosses your line instead of running down it.
    { kind: 'pendulum', p: [100.2, 7.0, 0], len: 3.4, amp: 0.75, period: 2.4, phase: 0.00, axis: [0, 0, 1], blade: { w: 0.44, h: 1.4, d: 3.0 } },
    { kind: 'platform', p: [109.4, 2.4, 0], s: [6.4, 1, 7.2], mat: 'stone', glow: STONE, stripe: true }, // gap 2.60 — CP2

    { kind: 'deco', kindOf: 'monolith', p: [84.0, -12.0, 12.0], s: [5.0, 22.0, 5.0], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'buttress', p: [100.2, 9.4, 3.6], s: [1.4, 2.6, 1.4], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [100.2, 9.4, -3.6], s: [1.4, 2.6, 1.4], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'cable', p: [100.2, 9.0, 0], s: [0.06, 4.0, 0.06], mat: 'metal', tint: DUSK },
    { kind: 'light', p: [88.0, 5.0, 0], color: GOLD, intensity: 7, distance: 24 },
    { kind: 'light', p: [109.4, 5.4, 0], color: MINT, intensity: 9, distance: 20 },

    /* ============================================================================ */
    /* MOVEMENT II — THE LANTERN BRIDGE                                             */
    /* A span hung between the stair and the cathedral, and it does NOT run straight:*/
    /* the deck sits at z +1.4, the shuttle carries you diagonally to z -2.6, the    */
    /* rotor deck stays out there, the set-piece comes back to the axis and the      */
    /* censer ledge steps off it again. Nothing in this movement is a corridor.      */
    /* ============================================================================ */

    /* ---------------------------------------------------------------------------- */
    /* BEAT 7 — THREE KINDS OF LIGHT                                                */
    /* One beam to jump, a RACK of two to crouch under (2.2 s on / 0.9 off, so the   */
    /* window is short and the wall is long — the opposite duty of everything else   */
    /* on the stage), and a SWEEP: a bar rotating flat at 0.15 m over the deck on a  */
    /* 3.4 s revolution, which you hop as it comes round. Three different readings,  */
    /* never two at once.                                                            */
    /* ---------------------------------------------------------------------------- */

    { kind: 'platform', p: [120.0, 2.9, 1.4], s: [10.0, 1, 4.2], mat: 'stone', glow: STONE, stripe: true }, // gap 2.40, +0.5, top 3.40

    { kind: 'laser', a: [117.0, 3.92, -0.9], b: [117.0, 3.92, 3.7], radius: 0.14, color: HOT, cycle: { on: 1.3, off: 1.5, warn: 0.45, phase: 0.00 } }, // 0.52 up — jump
    {
      kind: 'lasergrid',
      a: [121.4, 5.12, -0.9],
      b: [121.4, 5.12, 3.7],
      count: 2,
      spacing: 2.2,
      offset: [1, 0, 0], // beams at x 120.3 and 122.5, both 1.72 m up — crouch
      stagger: 0.55,
      radius: 0.12,
      color: HOT,
      cycle: { on: 2.2, off: 0.9, warn: 0.35, phase: 0.40 },
    },
    {
      kind: 'lasersweep',
      p: [124.0, 3.55, 1.4], // the axle, 0.15 m over the deck
      len: 3.2,
      axis: [0, 1, 0],
      dir: [1, 0, 0],
      arc: Math.PI * 2,
      period: 3.4,
      phase: 0,
      radius: 0.1,
      color: HOT,
      cycle: { on: 4.4, off: 1.0, warn: 0.4, phase: 0 },
    },

    /* COIN 2 — the low catwalk. Drop 1.6 m off the deck's north rail onto a beam
       that runs UNDER the sweep's arc, take the shelf at its far end, and rejoin at
       the shuttle's home pose. It is faster than the main line if you read the
       censer over it and slower every other time. */
    { kind: 'beam', p: [121.0, 1.5, 7.6], s: [5.0, 0.6, 1.2], mat: 'metal' }, // 3.50 m out, -1.6
    { kind: 'pendulum', p: [121.0, 5.4, 7.6], len: 2.8, amp: 1.15, period: 2.2, phase: 0.30, axis: [0, 0, 1], blade: { w: 0.5, h: 1.2, d: 2.4 } }, // sweeps ACROSS the catwalk
    { kind: 'platform', p: [127.2, 2.6, 7.6], s: [3.0, 1, 3.0], mat: 'panel', glow: HOT, stripe: true }, // gap 2.20, +1.3 — COIN 2

    { kind: 'text', p: [113.6, 5.0, 0], rot: [0, -Math.PI / 2, 0], text: 'THE LANTERN BRIDGE', size: 0.5, color: GOLD },
    { kind: 'deco', kindOf: 'ring', p: [127.2, 4.7, 7.6], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: HOT },
    { kind: 'deco', kindOf: 'lantern', p: [117.0, 5.8, 4.4], s: [0.7, 1.1, 0.7], mat: 'emissive', tint: GOLD },
    { kind: 'deco', kindOf: 'lantern', p: [124.4, 5.8, -1.6], s: [0.7, 1.1, 0.7], mat: 'emissive', tint: GOLD },
    { kind: 'deco', kindOf: 'cable', p: [145.0, 8.6, 0], s: [66.0, 0.08, 0.08], mat: 'metal', tint: DUSK },
    { kind: 'light', p: [127.2, 4.9, 7.6], color: HOT, intensity: 7, distance: 14 },
    { kind: 'light', p: [120.0, 6.4, 1.4], color: GOLD, intensity: 9, distance: 22 },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 8 — THE SHUTTLE                                                          */
    /* A slab that runs DIAGONALLY across the span — 5.4 m along it and 5.8 m across */
    /* it — on a 5.0 s round trip with half a second of dwell at each end. It is the */
    /* only forgiving thing in the movement: miss it and it comes back. It is also   */
    /* the only way the route gets from z +1.4 to z -2.6.                            */
    /* ---------------------------------------------------------------------------- */

    {
      kind: 'mover',
      p: [130.2, 2.9, 3.2],
      s: [3.4, 1, 3.6],
      mat: 'metal',
      motion: { type: 'linear', to: [135.6, 2.9, -2.6], period: 5.0, phase: 0, ease: 'sine', dwell: 0.5 },
    }, // gap 3.50 off the deck, top 3.40

    // A blade across the shuttle's own lane. The shuttle waits for you; this does not.
    { kind: 'rotor', p: [133.0, 8.30, 0.4], style: 'windmill', arms: 2, len: 4.6, thick: 0.40, period: 4.6, phase: 0.25, axis: [0, 0, 1] },

    { kind: 'deco', kindOf: 'rail', p: [133.0, 4.6, 3.2], s: [11.0, 0.08, 0.08], mat: 'metal', tint: GOLD },
    { kind: 'deco', kindOf: 'rail', p: [133.0, 4.6, -3.2], s: [11.0, 0.08, 0.08], mat: 'metal', tint: GOLD },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 9 — ROTOR SCHOOL, AT TEMPO                                              */
    /* A two-arm prayer bar and a single-arm HAMMER on the same deck: same axis,     */
    /* completely different silhouettes and completely different tells — the bar     */
    /* gives you two evenly spaced windows a revolution, the hammer gives you one    */
    /* long one and a heavy head you can hear coming. Between them a laser hung on   */
    /* the DIAGONAL, low at the outer rail and high at the inner one.                */
    /* ---------------------------------------------------------------------------- */

    { kind: 'platform', p: [144.6, 3.7, -2.6], s: [10.6, 1, 4.2], mat: 'stone', glow: STONE, stripe: true }, // gap 2.00 off the shuttle's far pose, +0.8 — CP3

    { kind: 'rotor', p: [141.4, 5.30, -2.6], style: 'bar', arms: 2, len: 2.4, thick: 0.42, period: 3.4, phase: 0.00, axis: [0, 1, 0] },
    { kind: 'laser', a: [144.6, 5.60, -4.6], b: [144.6, 4.35, -0.5], radius: 0.13, color: HOT, cycle: { on: 0.9, off: 1.7, warn: 0.30, phase: 0.55 } }, // diagonal, short-on
    { kind: 'rotor', p: [147.8, 5.20, -2.6], style: 'hammer', arms: 1, len: 2.2, thick: 0.55, period: 2.6, phase: 0.40, axis: [0, 1, 0] },

    { kind: 'deco', kindOf: 'pillar', p: [141.4, 8.6, -2.6], s: [1.1, 6.0, 1.1], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [147.8, 8.6, -2.6], s: [1.1, 6.0, 1.1], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'emblem', p: [144.6, 6.8, -2.6], s: [0.3, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: MINT },
    { kind: 'light', p: [144.6, 9.2, -2.6], color: MINT, intensity: 11, distance: 22 },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 10 — SET-PIECE OF THE MOVEMENT : THE PRAYER WHEELS                      */
    /* Four things at once on one 11.4 m span, and deliberately four DIFFERENT       */
    /* shapes: a three-blade windmill of 4.4 m radius, a saw coming up through a     */
    /* slot in the flagstones, a laser on a 0.7 s duty (the shortest window in the   */
    /* game) and a two-blade windmill of 5.4 m on a period that shares nothing with  */
    /* the first. Cross it one blade at a time; there is no rhythm to memorise.      */
    /* ---------------------------------------------------------------------------- */

    { kind: 'platform', p: [158.6, 4.2, 0], s: [11.4, 1, 4.0], mat: 'metal', glow: GOLD, stripe: true }, // gap 3.00, +0.5, top 4.70

    { kind: 'rotor', p: [155.4, 9.50, 0], style: 'windmill', arms: 3, len: 4.4, thick: 0.42, period: 5.0, phase: 0.00, axis: [0, 0, 1] },
    { kind: 'saw', p: [158.8, 3.40, 0], style: 'saw', len: 1.9, thick: 0.26, period: 1.4, phase: 0.00, axis: [0, 0, 1], mount: 0 }, // 0.6 m of tooth over the deck
    { kind: 'laser', a: [160.4, 5.30, -2.2], b: [160.4, 5.30, 2.2], radius: 0.13, color: HOT, cycle: { on: 0.7, off: 1.9, warn: 0.30, phase: 0.50 } },
    { kind: 'rotor', p: [162.2, 10.60, 0], style: 'windmill', arms: 2, len: 5.4, thick: 0.36, period: 4.2, phase: 0.50, axis: [0, 0, 1] },

    { kind: 'deco', kindOf: 'buttress', p: [155.4, 11.2, 3.4], s: [1.4, 2.6, 1.4], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [162.2, 12.2, 3.4], s: [1.4, 2.6, 1.4], mat: 'obsidian' },
    { kind: 'text', p: [152.6, 6.4, -2.6], rot: [0, -Math.PI / 2, 0], text: 'ONE BLADE AT A TIME', size: 0.36, color: HOT },
    { kind: 'light', p: [158.6, 7.0, 0], color: HOT, intensity: 12, distance: 24, flicker: 0.08 },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 11 — THE CENSER, AND THE LONGEST JUMP ON THE BRIDGE                      */
    /* 4.3 m out and 1.3 m DOWN, off-axis, with a censer on a 3.2 s arc swinging     */
    /* over the landing. It is the only gap in the movement you take falling, and    */
    /* the landing ledge is the smallest surface in it.                              */
    /* ---------------------------------------------------------------------------- */

    { kind: 'pendulum', p: [167.0, 9.40, 0], len: 4.6, amp: 1.00, period: 3.2, phase: 0.00, axis: [1, 0, 0], blade: { w: 0.40, h: 1.6, d: 3.4 } },
    { kind: 'platform', p: [170.8, 2.9, -1.8], s: [4.4, 1, 3.4], mat: 'panel', glow: GOLD, stripe: true }, // gap 4.30, -1.3, top 3.40
    { kind: 'platform', p: [180.4, 3.4, 0], s: [8.4, 1, 8.6], mat: 'stone', glow: STONE, stripe: true }, // gap 3.20, +0.5 — CP4

    { kind: 'deco', kindOf: 'emblem', p: [180.4, 6.4, 0], s: [0.3, 2.6, 2.6], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: MINT },
    { kind: 'deco', kindOf: 'brazier', p: [178.0, 4.6, 3.4], s: [1.0, 1.3, 1.0], mat: 'metal', tint: GOLD },
    { kind: 'deco', kindOf: 'brazier', p: [178.0, 4.6, -3.4], s: [1.0, 1.3, 1.0], mat: 'metal', tint: GOLD },
    { kind: 'light', p: [180.4, 5.8, 0], color: MINT, intensity: 10, distance: 20 },

    /* ============================================================================ */
    /* MOVEMENT III — THE CATHEDRAL RIM                                             */
    /* The bridge lands on the shoulder of a nave hanging in the cloud sea, and the  */
    /* route goes AROUND THE OUTSIDE of it. Nothing is built over this movement —    */
    /* the sky above the rim is empty all the way to the cloud deck, which is the    */
    /* whole point of putting the route on the outside of the building.              */
    /*                                                                              */
    /* The ledges are NOT a sequence of one ledge: spacings 1.6 / 3.5 / 2.9 / 2.2 /  */
    /* 3.2 m, tops 3.9 / 4.5 / 3.1 / 4.0 / 4.9 / 6.1 / 7.0 / 5.5 — it climbs, drops  */
    /* 1.4 m onto the buttress head, climbs again and then falls 1.5 m onto the bell */
    /* approach. Sizes run 3.2 to 5.6 m. Ice takes your brakes (iceAccel 26,         */
    /* iceFriction 1.4) and wind takes your line, and they never arrive together     */
    /* until BEAT 14.                                                                */
    /* ============================================================================ */

    /* ---------------------------------------------------------------------------- */
    /* BEAT 12 — FIRST ICE, GENUINELY NO WIND                                       */
    /* The widest ice on the stage, 5.6 m, one short hop from solid ground, and the  */
    /* nearest wind field starts at x 194.5 — 2.7 m clear of this ledge's far edge.  */
    /* Nothing else happens here. The only new thing to learn is how long it takes   */
    /* to stop.                                                                      */
    /* ---------------------------------------------------------------------------- */

    { kind: 'ice', p: [189.0, 3.4, 3.0], s: [5.6, 1, 4.6] }, // gap 1.60, flat, top 3.90
    { kind: 'text', p: [185.4, 5.8, 3.0], rot: [0, -Math.PI / 2, 0], text: 'GLAZED', size: 0.42, color: FROST },
    { kind: 'text', p: [185.4, 5.25, 3.0], rot: [0, -Math.PI / 2, 0], text: 'you do not stop where you decide to', size: 0.24, color: DUSK },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 13 — WIND, OUTBOUND, AND A DROP ONTO STONE                              */
    /* A 10 m field pushing at +Z, i.e. straight OFF the rim, at 12 m/s^2 — and the  */
    /* ledge under its far half is 1.4 m BELOW the one you leave, so the wind gets a */
    /* whole extra beat of your fall to work with. The landing is stone, not ice,    */
    /* and it is CP5: the one place on the rim you can stand still.                  */
    /* ---------------------------------------------------------------------------- */

    { kind: 'ice', p: [197.4, 4.0, 6.8], s: [4.2, 1, 4.0] }, // gap 3.50, +0.6, top 4.50
    { kind: 'wind', p: [199.5, 6.4, 7.4], s: [10, 6, 11], dir: [0, 0, 1], power: 12, color: FROST }, // x 194.5..204.5 — clear of BEAT 12
    { kind: 'platform', p: [205.2, 2.6, 9.6], s: [5.6, 1, 5.0], mat: 'stone', glow: STONE, stripe: true }, // gap 2.90, -1.4, top 3.10 — CP5

    { kind: 'deco', kindOf: 'buttress', p: [197.0, 1.6, 1.4], s: [2.2, 5.0, 2.2], rot: [0, 0, 0.22], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'buttress', p: [205.2, -0.6, 5.0], s: [2.6, 6.0, 2.6], rot: [0, 0, 0.26], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'lantern', p: [201.0, 7.2, 12.4], s: [0.7, 1.1, 0.7], mat: 'emissive', tint: GOLD },
    { kind: 'light', p: [200.0, 7.0, 7.6], color: FROST, intensity: 9, distance: 24 },
    { kind: 'light', p: [205.2, 5.0, 9.6], color: MINT, intensity: 9, distance: 18 },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 14 — THE SPIKE : A BAR ON ICE AND THE WIND REVERSED                     */
    /* A prayer bar sweeping a 3.6 m ledge you cannot brake on, inside a field that  */
    /* now blows at -Z (14 m/s^2) — inward, toward the nave wall, which is the       */
    /* direction that hurts because the landing is at the ledge's OUTER lip. CP5 is  */
    /* 6.4 m behind it, which is why CP5 exists.                                     */
    /*                                                                              */
    /* COIN 3 goes the wrong way on purpose: two ledges FURTHER OUT into the         */
    /* crosswind at z 14, then a 3.0 m jump back to the main line at BEAT 15.        */
    /* ---------------------------------------------------------------------------- */

    { kind: 'ice', p: [212.0, 3.5, 9.6], s: [3.6, 1, 4.0] }, // gap 2.20, +0.9, top 4.00 — the narrowest ice
    { kind: 'wind', p: [214.6, 6.6, 9.6], s: [12, 6, 12], dir: [0, 0, -1], power: 14, color: FROST },
    { kind: 'rotor', p: [212.0, 5.20, 9.6], style: 'bar', arms: 2, len: 2.2, thick: 0.36, period: 3.4, phase: 0.00, axis: [0, 1, 0] },
    { kind: 'laser', a: [213.4, 5.60, 7.4], b: [213.4, 5.60, 11.8], radius: 0.13, color: HOT, cycle: { on: 1.3, off: 1.3, warn: 0.40, phase: 0.10 } },

    { kind: 'ice', p: [217.4, 3.4, 13.6], s: [3.4, 1, 3.2] }, // COIN 3 line — 1.94 m out, -0.1, into the wind
    { kind: 'platform', p: [222.0, 4.6, 13.2], s: [2.8, 1, 2.8], mat: 'panel', glow: HOT, stripe: true }, // gap 1.50, +1.2 — COIN 3

    { kind: 'text', p: [208.6, 7.4, 9.6], rot: [0, -Math.PI / 2, 0], text: 'IT CHANGES', size: 0.38, color: HOT },
    { kind: 'deco', kindOf: 'ring', p: [222.0, 6.7, 13.2], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: HOT },
    { kind: 'deco', kindOf: 'pillar', p: [212.0, 12.0, 17.6], s: [1.2, 8.0, 1.2], mat: 'stone', tint: STONE },
    { kind: 'light', p: [212.0, 7.6, 9.6], color: HOT, intensity: 8, distance: 18, flicker: 0.1 },
    { kind: 'light', p: [222.0, 6.9, 13.2], color: HOT, intensity: 7, distance: 14 },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 15 — THE CENSER RING                                                    */
    /* The gap the buttresses left is 9 m of nothing, and the way across it is a     */
    /* stone censer orbiting its own hub on a 4.6 s revolution — half an orbit is    */
    /* 2.3 s, so the wait is a beat and not a coffee break. Board it on its inner    */
    /* sweep, leave it on its outer one, and a counterweight swings the whole time.  */
    /* ---------------------------------------------------------------------------- */

    { kind: 'ice', p: [218.6, 4.4, 7.0], s: [3.2, 1, 3.6] }, // gap 3.20, +0.9, top 4.90

    {
      kind: 'mover',
      p: [227.0, 4.4, 4.4],
      s: [3.4, 1, 3.4],
      mat: 'stone',
      motion: { type: 'circle', radius: 3.2, axis: 'y', period: 4.6, phase: 0 },
    }, // ORBIT CENTRE — boardable at x 223.8 / 230.2 and z 1.2 / 7.6, top 4.90

    { kind: 'pendulum', p: [227.0, 10.20, 4.4], len: 3.8, amp: 0.60, period: 3.6, phase: 0.30, axis: [1, 0, 0], blade: { w: 0.34, h: 1.3, d: 2.8 } },
    { kind: 'deco', kindOf: 'ring', p: [227.0, 4.5, 4.4], s: [7.0, 0.14, 7.0], mat: 'emissive', tint: GOLD },
    { kind: 'deco', kindOf: 'cable', p: [227.0, 8.6, 4.4], s: [0.06, 5.6, 0.06], mat: 'metal', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [227.0, -1.0, 4.4], s: [1.2, 10.0, 1.2], mat: 'stone', tint: STONE },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 16 — THE UPDRAFT, AND THE FALL ONTO THE BELL FLOOR                       */
    /* Back onto the axis and up two ledges, the second of them venting heat: a +Y   */
    /* field at 9 m/s^2 that lengthens every jump made inside it, with a three-arm   */
    /* bar turning in it. Then the rim's last move is DOWNWARD — 1.5 m onto the      */
    /* last ice and 0.2 m up onto stone — because the stage stops climbing here.     */
    /* ---------------------------------------------------------------------------- */

    { kind: 'platform', p: [236.0, 5.6, 1.8], s: [5.4, 1, 5.0], mat: 'stone', glow: STONE, stripe: true }, // gap 1.40 off the ring, +1.2 — CP6
    { kind: 'ice', p: [242.4, 6.5, -1.4], s: [4.4, 1, 4.2] }, // gap 1.50, +0.9, top 7.00 — the high point of the rim
    { kind: 'wind', p: [243.0, 9.4, -1.4], s: [10, 5, 9], dir: [0, 1, 0], power: 9, color: GOLD },
    { kind: 'rotor', p: [242.4, 8.20, -1.4], style: 'bar', arms: 3, len: 2.0, thick: 0.32, period: 3.8, phase: 0.20, axis: [0, 1, 0] },
    { kind: 'ice', p: [249.6, 5.0, 1.2], s: [5.0, 1, 4.6] }, // gap 2.50, -1.5, top 5.50
    { kind: 'platform', p: [256.4, 5.2, 0.8], s: [6.6, 1, 8.0], mat: 'stone', glow: STONE, stripe: true }, // gap 1.00, +0.2, top 5.70 — CP7

    { kind: 'deco', kindOf: 'vent', p: [243.0, 4.4, -1.4], s: [2.6, 0.6, 2.6], mat: 'grate', tint: GOLD },
    { kind: 'deco', kindOf: 'buttress', p: [238.0, 2.0, 6.4], s: [2.2, 5.2, 2.2], rot: [0, 0, -0.24], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'ring', p: [256.4, 11.4, 0.8], s: [3.4, 4.0, 3.4], mat: 'metal', tint: GOLD }, // the bell
    { kind: 'deco', kindOf: 'arch', p: [256.4, 14.0, 0.8], s: [1.6, 1.2, 12.0], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'pillar', p: [256.4, 10.6, 6.2], s: [1.4, 9.8, 1.4], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'pillar', p: [256.4, 10.6, -4.6], s: [1.4, 9.8, 1.4], mat: 'stone', tint: STONE },
    { kind: 'light', p: [243.0, 8.2, -1.4], color: GOLD, intensity: 10, distance: 22, flicker: 0.14 },
    { kind: 'light', p: [256.4, 9.0, 0.8], color: MINT, intensity: 11, distance: 22 },

    /* ============================================================================ */
    /* MOVEMENT IV — THE UNDERSTONE                                                 */
    /* Down into the machine deck that turns the temple. The ceiling slab starts at  */
    /* x 259 — 1.9 m past the bell's last pillar and 67 m past the rim — so nothing  */
    /* in MOVEMENT III has a roof over it, and everything in here does.              */
    /*                                                                              */
    /* This is the loudest, densest dressing on the stage (20 deco objects in 66 m,  */
    /* 3.0 per 10 m, against 2.0 on the rim): gear trains, a flywheel, a drive       */
    /* chain, condenser drums, a slag chute and a furnace door — MACHINERY, none of  */
    /* it lethal, so that the four things in here that ARE lethal read instantly.    */
    /* It is also the only place in the Sky Temple that has lava in it, which is the */
    /* joke: the foundry is what the temple stands on.                               */
    /* ============================================================================ */

    /* ---------------------------------------------------------------------------- */
    /* BEAT 17 — THE DESCENT                                                        */
    /* -1.7 m and then -2.0 m over 4.1 m, swinging from z -3.2 to z +2.6. The floor  */
    /* comes up at you twice and the corridor changes side underneath you.           */
    /* ---------------------------------------------------------------------------- */

    { kind: 'platform', p: [263.2, 3.5, -3.2], s: [5.0, 1, 4.0], mat: 'stone', glow: STONE, stripe: true }, // gap 1.00, -1.7, top 4.00
    { kind: 'platform', p: [271.8, 1.5, 2.6], s: [4.6, 1, 4.4], mat: 'stone', glow: STONE, stripe: true }, // gap 4.12, -2.0, top 2.00 ★

    { kind: 'text', p: [259.6, 7.0, 0], rot: [0, -Math.PI / 2, 0], text: 'THE UNDERSTONE', size: 0.52, color: GOLD },
    { kind: 'text', p: [259.6, 6.45, 0], rot: [0, -Math.PI / 2, 0], text: 'the machinery that turns the temple', size: 0.24, color: DUSK },

    { kind: 'deco', kindOf: 'panel', p: [292.0, 8.2, 0], s: [66.0, 0.8, 15.0], mat: 'stone', tint: 0x8b7454 }, // the ceiling slab: x 259..325 ONLY
    { kind: 'deco', kindOf: 'pipe', p: [292.0, 7.2, 6.4], s: [62.0, 0.6, 0.6], mat: 'metal', tint: 0x8b7454 },
    { kind: 'deco', kindOf: 'pipe', p: [292.0, 6.6, -6.4], s: [62.0, 0.5, 0.5], mat: 'metal', tint: 0x8b7454 },
    { kind: 'deco', kindOf: 'vent', p: [276.0, 6.0, -6.4], s: [1.2, 1.6, 1.2], mat: 'metal', tint: STONE },
    { kind: 'deco', kindOf: 'pillar', p: [264.6, 3.0, 6.6], s: [2.2, 5.0, 2.2], mat: 'metal', tint: 0x8b7454 }, // condenser drum
    { kind: 'deco', kindOf: 'ring', p: [268.0, 3.4, -7.4], s: [0.4, 6.0, 6.0], rot: [0, Math.PI / 2, 0], mat: 'metal', tint: STONE }, // the big gear
    { kind: 'deco', kindOf: 'ring', p: [272.6, 2.2, -7.4], s: [0.4, 3.6, 3.6], rot: [0, Math.PI / 2, 0], mat: 'metal', tint: STONE }, // its pinion
    { kind: 'deco', kindOf: 'rail', p: [270.4, 4.2, -7.4], s: [0.2, 0.2, 4.4], mat: 'metal', tint: GOLD }, // the crank arm between them
    { kind: 'deco', kindOf: 'grate', p: [266.0, 0.4, 0], s: [8.0, 0.3, 8.0], mat: 'grate', tint: DUSK },
    { kind: 'light', p: [266.0, 5.4, 0], color: GOLD, intensity: 9, distance: 20 },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 18 — THE BACKWARD BELT, UNDER TWO PRESSES                                */
    /* An 8.4 m belt running at 4.5 m/s AGAINST you (conveyorMax is 9, so this is    */
    /* half authority — you still walk forward, at about half pace). Two presses on  */
    /* the same 3.6 s period half a cycle apart, so there is never a moment when     */
    /* both are up; both stop 0.1 m over the belt, which is the whole margin you get.*/
    /* Off the outboard rail, 6 m down, the tap runs: lava, in a temple.             */
    /* ---------------------------------------------------------------------------- */

    { kind: 'conveyor', p: [281.4, 1.4, 2.6], s: [8.4, 1, 4.4], dir: [-1, 0, 0], power: 4.5, mat: 'conveyor' }, // gap 3.10, -0.1, top 1.90

    { kind: 'crusher', p: [279.4, 5.9, 2.6], s: [3.6, 1.4, 4.2], axis: [0, -1, 0], travel: 3.2, period: 3.6, phase: 0.00, dwell: 0.7, mat: 'metal' },
    { kind: 'crusher', p: [284.0, 6.1, 2.6], s: [2.8, 1.2, 4.2], axis: [0, -1, 0], travel: 3.5, period: 3.6, phase: 0.50, dwell: 0.6, mat: 'metal' },

    { kind: 'lava', p: [281.4, -4.6, 9.6], s: [14, 1.4, 6] }, // the tap, well off the route and only ever seen
    { kind: 'text', p: [275.0, 5.0, -2.6], rot: [0, -Math.PI / 2, 0], text: 'THE BELT IS NOT ON YOUR SIDE', size: 0.30, color: HOT },
    { kind: 'deco', kindOf: 'rail', p: [281.4, 2.8, 5.0], s: [9.0, 0.08, 0.08], mat: 'metal', tint: GOLD },
    { kind: 'deco', kindOf: 'rail', p: [281.4, 2.8, 0.2], s: [9.0, 0.08, 0.08], mat: 'metal', tint: GOLD },
    { kind: 'deco', kindOf: 'ring', p: [280.0, 4.6, -7.8], s: [0.5, 5.4, 5.4], rot: [0, Math.PI / 2, 0], mat: 'metal', tint: STONE }, // the flywheel
    { kind: 'deco', kindOf: 'cable', p: [275.0, 3.4, -7.6], s: [16.0, 0.12, 0.12], mat: 'metal', tint: DUSK }, // the drive chain
    { kind: 'deco', kindOf: 'vent', p: [281.4, 1.2, 8.0], s: [2.4, 1.6, 2.4], mat: 'metal', tint: EMBER }, // the slag chute over the tap
    { kind: 'light', p: [281.4, 4.4, 2.6], color: GOLD, intensity: 10, distance: 18, flicker: 0.18 },
    { kind: 'light', p: [281.4, -2.4, 9.6], color: EMBER, intensity: 14, distance: 26, flicker: 0.2 },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 19 — THE GRATE PIT, AND THE GALLERY UNDER IT                            */
    /* A spiked well with one iron grate over it on a 3.8 s cycle. The grate is a    */
    /* convenience, not the route: the far side is 5.8 m from the belt's lip and     */
    /* 1.6 m below it, which is inside the SPRINT envelope, so a player who refuses  */
    /* the grate can simply clear the whole pit. Two ways through, one fast and      */
    /* conditional, one committed and always true.                                   */
    /*                                                                              */
    /* COIN 4 is a third way: drop 2.5 m off the belt's south rail into the          */
    /* maintenance gallery — the lowest floor in the game — climb it and come up     */
    /* beside the checkpoint. A blade swings the length of it.                       */
    /* ---------------------------------------------------------------------------- */

    { kind: 'spikes', p: [288.4, -0.6, 2.6], s: [4.8, 0.8, 4.6], dir: [0, 1, 0] },
    { kind: 'vanish', p: [288.4, 1.4, 2.6], s: [2.8, 1, 3.4], mat: 'grate', cycle: { on: 2.0, off: 1.4, warn: 0.4, phase: 0.25 } }, // gap 1.40 off the belt
    { kind: 'platform', p: [294.2, -0.2, -1.0], s: [5.6, 1, 5.2], mat: 'stone', glow: STONE, stripe: true }, // gap 5.80 SPRINT over the pit, -1.6 — CP8

    { kind: 'platform', p: [287.0, -1.1, -5.4], s: [3.2, 1, 3.4], mat: 'metal', glow: EMBER, stripe: true }, // COIN 4 gallery, 4.10 m out and -2.5 ★
    { kind: 'platform', p: [291.6, 0.1, -6.6], s: [3.0, 1, 3.0], mat: 'metal', glow: EMBER, stripe: true }, // gap 1.50, +1.2 — COIN 4
    { kind: 'pendulum', p: [291.6, 4.60, -6.6], len: 2.6, amp: 1.20, period: 2.0, phase: 0.15, axis: [0, 0, 1], blade: { w: 0.46, h: 1.1, d: 2.2 } }, // the fastest blade on the stage, over the greedy line

    { kind: 'deco', kindOf: 'ring', p: [291.6, 2.2, -6.6], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: HOT },
    { kind: 'deco', kindOf: 'grate', p: [288.4, -1.4, 2.6], s: [6.0, 0.3, 6.0], mat: 'grate', tint: DUSK },
    { kind: 'deco', kindOf: 'banner', p: [294.2, 2.8, -4.2], s: [0.1, 1.6, 1.4], mat: 'panel', tint: HOT },
    { kind: 'light', p: [291.6, 2.4, -6.6], color: HOT, intensity: 8, distance: 15 },
    { kind: 'light', p: [294.2, 3.4, -1.0], color: MINT, intensity: 10, distance: 20 },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 20 — THE SAW GAUNTLET ON THE FAST BELT                                  */
    /* The companion to BEAT 18: the same belt at 8 m/s running WITH you, into three */
    /* blades that are not the same problem. Two come UP through slots with 0.4 m of */
    /* tooth showing — those are jumps. The third is a rotor mounted overhead with   */
    /* its lowest tooth at 1.95 m, which is 0.15 m under the top of your head, so    */
    /* the answer on that one is DO NOT JUMP.                                        */
    /*                                                                              */
    /* COIN 5 is the high catwalk: 1.7 m UP off the checkpoint onto a beam that runs */
    /* the whole gauntlet above the belt, with its own gate on it, rejoining at the  */
    /* far end. It skips the belt entirely and costs you the belt's free speed.       */
    /* ---------------------------------------------------------------------------- */

    { kind: 'conveyor', p: [302.6, -0.2, -1.0], s: [8.8, 1, 4.6], dir: [1, 0, 0], power: 8, mat: 'conveyor' }, // gap 1.20, flat, top 0.30

    { kind: 'saw', p: [299.4, -1.20, -1.0], style: 'saw', len: 1.9, thick: 0.26, period: 1.4, phase: 0.00, axis: [0, 0, 1], mount: 0 },
    { kind: 'saw', p: [303.8, -1.20, -1.0], style: 'saw', len: 1.9, thick: 0.26, period: 1.1, phase: 0.40, axis: [0, 0, 1], mount: 0 },
    { kind: 'rotor', p: [305.8, 3.60, -1.0], style: 'saw', len: 1.5, thick: 0.30, period: 1.6, phase: 0.00, axis: [0, 0, 1] }, // lowest tooth 1.95 — duck

    { kind: 'beam', p: [301.0, 1.75, 4.4], s: [8.0, 0.5, 1.2], mat: 'metal' }, // COIN 5 catwalk, 2.20 m out and +1.7
    { kind: 'laser', a: [301.0, 3.00, 3.8], b: [301.0, 3.00, 5.0], radius: 0.11, color: HOT, cycle: { on: 1.6, off: 1.0, warn: 0.35, phase: 0.60 } },

    { kind: 'text', p: [296.6, 4.0, 2.0], rot: [0, -Math.PI / 2, 0], text: 'DUCK THE LAST ONE', size: 0.32, color: HOT },
    { kind: 'deco', kindOf: 'ring', p: [303.0, 3.6, 4.4], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: HOT },
    { kind: 'deco', kindOf: 'screen', p: [300.0, 3.4, -8.0], s: [0.5, 4.0, 5.0], mat: 'emissive', tint: EMBER }, // the furnace door
    { kind: 'deco', kindOf: 'cable', p: [300.0, 7.4, 3.0], s: [46.0, 0.06, 0.06], mat: 'metal', tint: DUSK },
    { kind: 'deco', kindOf: 'pillar', p: [309.0, 2.6, -7.0], s: [2.0, 4.6, 2.0], mat: 'metal', tint: 0x8b7454 },
    { kind: 'light', p: [303.0, 3.8, 4.4], color: HOT, intensity: 7, distance: 14 },
    { kind: 'light', p: [302.6, 4.2, -1.0], color: HOT, intensity: 11, distance: 20, flicker: 0.22 },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 21 — THE PISTON, AND THE FLOOD                                          */
    /* A crusher inverted: it lives in the floor and fires UPWARD on a 3.4 s cycle   */
    /* with 0.8 s parked. Parked, its cap is an ordinary stepping stone flush with   */
    /* the deck. Firing, its cap is the lethal face. It is the last machine because  */
    /* it needs the other three to read.                                             */
    /*                                                                              */
    /* And under it the sump fills: a `risinglava` bay that arms at t = 132 and      */
    /* climbs to -1.0 m at 0.1 m/s, which is 1.3 m below the piston deck and 0.4 m   */
    /* below the gallery floor — it never touches the route, it takes the FALL. Miss */
    /* the piston after CP9's clock and you do not land in the dark, you land in it.  */
    /* ---------------------------------------------------------------------------- */

    { kind: 'platform', p: [311.6, 1.0, 2.4], s: [5.0, 1, 4.8], mat: 'stone', glow: STONE, stripe: true }, // gap 2.10 off the belt, +1.2 — CP9
    { kind: 'crusher', p: [317.4, 1.0, 2.4], s: [3.4, 1, 4.2], axis: [0, 1, 0], travel: 3.0, period: 3.4, phase: 0.00, dwell: 0.8, mat: 'metal' }, // gap 1.60, cap 1.50 parked
    { kind: 'pendulum', p: [321.2, 6.60, 1.4], len: 2.9, amp: 0.90, period: 2.8, phase: 0.50, axis: [1, 0, 0], blade: { w: 0.42, h: 1.5, d: 3.2 } },
    { kind: 'platform', p: [322.0, 2.4, 0.6], s: [5.6, 1, 4.8], mat: 'stone', glow: STONE, stripe: true }, // gap 0.10 off the piston cap, +1.4, top 2.90

    { kind: 'risinglava', p: [305.0, -6.0, 0], s: [42, 3, 22], rising: { from: -7.0, to: -1.0, speed: 0.10, delay: 132 } }, // x 284..326, always below every surface

    { kind: 'deco', kindOf: 'post', p: [317.4, -0.5, 4.8], s: [0.5, 2.0, 0.5], mat: 'metal', tint: GOLD },
    { kind: 'deco', kindOf: 'post', p: [317.4, -0.5, 0.0], s: [0.5, 2.0, 0.5], mat: 'metal', tint: GOLD },
    { kind: 'light', p: [317.4, 4.4, 2.4], color: GOLD, intensity: 10, distance: 18, flicker: 0.16 },
    { kind: 'light', p: [310.0, -3.4, 0], color: EMBER, intensity: 12, distance: 30, flicker: 0.24 },
    { kind: 'light', p: [322.4, 5.0, 0.6], color: 0xfff0d0, intensity: 9, distance: 20 },

    /* ============================================================================ */
    /* MOVEMENT V — THE ASCENT                                                      */
    /* Out of the machine deck into open sky and then straight up: 3.8 m to 24.2 m   */
    /* in eighty metres of ground, and the ground goes with it. The route crosses    */
    /* the centre line five times on the way (z 0 -> +1.6 -> +4.6 -> -3.4 -> +2.2 -> */
    /* -4.6 -> +3.0 -> 0): there is no straight corridor in this movement either.    */
    /* ============================================================================ */

    /* ---------------------------------------------------------------------------- */
    /* BEAT 22 — THE LAUNCH COURT                                                   */
    /* Wide, solid, and the last flat ground in the game. CP10. From here the gate   */
    /* is visible at 24 m and seventy out, and so is the cloud deck below the court  */
    /* — which is where the collapse comes from, and it is worth looking at.          */
    /* ---------------------------------------------------------------------------- */

    { kind: 'platform', p: [329.6, 3.3, 0], s: [8.4, 1, 8.4], mat: 'stone', glow: STONE, stripe: true }, // gap 0.60, +0.9, top 3.80 — CP10

    { kind: 'text', p: [325.4, 6.8, 0], rot: [0, -Math.PI / 2, 0], text: 'THE ASCENT', size: 0.62, color: GOLD },
    { kind: 'text', p: [325.4, 6.2, 0], rot: [0, -Math.PI / 2, 0], text: 'the floor is going  ·  climb', size: 0.26, color: HOT },
    { kind: 'deco', kindOf: 'emblem', p: [329.6, 7.4, 0], s: [0.3, 2.4, 2.4], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: MINT },
    { kind: 'light', p: [329.6, 6.4, 0], color: MINT, intensity: 12, distance: 22 },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 23 — THE COLLAPSE                                                       */
    /* A void deck that rises out of the cloud sea and takes the ascent from         */
    /* underneath. It is on the Y AXIS on purpose: chase.js sizes its kill volume    */
    /* `killDepth = max(travel + 40, 60)` BEHIND the front, and on the Y axis that   */
    /* depth points straight DOWN into empty sky, while the lateral bound is the     */
    /* front's own face — p [369,0,0] with s [88,4,44] is x 325..413, z -22..22, and */
    /* nothing else, ever. MOVEMENT IV's last surface ends at x 324.8.               */
    /*                                                                              */
    /* Arms at t = 176 at y -26 and climbs at 1.6 m/s: court deck (3.8) at t 194.6,  */
    /* first terrace (8.6) at 197.9, runway (12.6) at 200.2, last terrace (19.9) at  */
    /* 204.9. It parks at 23.4 — under the gate floor at 24.2, the single surface in */
    /* its whole footprint that it never takes. Par is 205 s.                        */
    /* ---------------------------------------------------------------------------- */

    {
      kind: 'chase',
      axis: 'y',
      from: -26,
      to: 23.4,
      speed: 1.6,
      delay: 176,
      mat: 'void',
      p: [369, 0, 0],
      s: [88, 4, 44],
      color: HOT,
    },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 24 — PAD, RACK, LIFT                                                     */
    /* A 7 m pad clears the 4.65 m to the first terrace with room to spare, so it is */
    /* a launch and not a test. On the terrace, a two-beam rack — the NEON DOJO's    */
    /* own hazard, brought to the temple for the finale — sitting on the terrace     */
    /* BODY, 2.9 m clear of its launch lip, because a coin-flip gate on a take-off   */
    /* edge is not difficulty.                                                       */
    /*                                                                              */
    /* Then the lift: a triggered elevator that rises 4 m and crosses 8 m of z while */
    /* it does it. You step on and it goes — there is no orbit to wait for and no    */
    /* pass to miss. It is 2.4 s of ride, against 6.8 s of average boarding wait for */
    /* the ring it replaces.                                                         */
    /* ---------------------------------------------------------------------------- */

    { kind: 'jumppad', p: [331.8, 3.87, 0], s: [3.2, 0.16, 3.2], power: 7.0, dir: [0, 1, 0] },
    { kind: 'platform', p: [338.1, 8.1, 1.2], s: [7.0, 1, 6.0], mat: 'panel', glow: GOLD, stripe: true }, // pad landing, x 334.6..341.6, top 8.60

    {
      kind: 'lasergrid',
      a: [337.6, 9.35, -1.8],
      b: [337.6, 9.35, 4.4],
      count: 2,
      spacing: 2.4,
      offset: [1, 0, 0], // beams at x 336.4 and 338.8 — both clear of the launch lip at 341.6
      stagger: 0.8,
      radius: 0.11,
      color: HOT,
      cycle: { on: 1.1, off: 1.5, warn: 0.40, phase: 0.20 },
    },

    {
      kind: 'mover',
      p: [347.0, 8.1, 4.6],
      s: [4.2, 1, 4.2],
      mat: 'metal',
      motion: { type: 'elevator', to: [347.0, 12.1, -3.4], speed: 3.4, dwell: 0.3, hold: 2.2, ease: 'sine' },
    }, // gap 3.30 flat to board, then 4 m up and 8 m across, top 8.60 -> 12.60

    /* COIN 6 — the pillar top off the lift's upper pose, 2.6 m out over the drop and
       under a blade, then 3.55 m back to the runway. Taken well it costs four
       seconds; taken badly it costs the checkpoint. */
    { kind: 'platform', p: [348.0, 13.3, -9.4], s: [2.6, 1, 2.6], mat: 'panel', glow: HOT, stripe: true },
    { kind: 'pendulum', p: [348.0, 17.20, -9.4], len: 2.6, amp: 0.80, period: 2.6, phase: 0.10, axis: [1, 0, 0], blade: { w: 0.38, h: 1.2, d: 2.6 } },

    { kind: 'deco', kindOf: 'ring', p: [348.0, 15.4, -9.4], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: HOT },
    { kind: 'deco', kindOf: 'pillar', p: [348.0, 7.4, -9.4], s: [1.2, 11.0, 1.2], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'pillar', p: [347.0, 3.4, 4.6], s: [1.2, 8.4, 1.2], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'cloud', p: [345.0, -6.0, 12.0], s: [14, 2.4, 14], count: 5, spread: [70, 8, 16], seed: 4411, scale: 1.5, tint: 0xffffff },
    { kind: 'light', p: [338.1, 11.0, 1.2], color: GOLD, intensity: 11, distance: 24 },
    { kind: 'light', p: [348.0, 15.6, -9.4], color: HOT, intensity: 7, distance: 14 },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 25 — THE ONE SPRINT ON THE STAGE                                        */
    /* 8.8 m of straight, level, unobstructed runway with a 5.6 m gap at the end of  */
    /* it. Run speed clears 5.24 m at absolute best, so this gap cannot be walked:   */
    /* it is the only place in 400 m where the stage requires the sprint key.        */
    /*                                                                              */
    /* The speed pad is 4 m/s of BONUS, not the mechanism — 8.6 + 4 = 12.6 m/s,      */
    /* which is one tenth over sprint speed and exactly `speedAirCap`, so it cannot  */
    /* over-throw you into the void the way a 16 m/s pad would (controller.js        */
    /* `_applySpeedPad` is additive and uncapped; the air cap preserves whatever it  */
    /* gave you). It occupies the last 2.4 m of the runway, flush with the lip,      */
    /* because a pad that ends before the take-off has already been undone by ground */
    /* friction. The landing is 6.0 m deep: the pad's absolute best throw is 7.7 m   */
    /* from a 5.6 m gap, which lands 2.1 m onto a 6 m slab.                          */
    /*                                                                              */
    /* The gate is at the runway's NEAR end, 7.6 m before the lip, so it decides     */
    /* whether you START the run and never whether you finish it.                    */
    /* ---------------------------------------------------------------------------- */

    { kind: 'platform', p: [357.0, 12.1, -3.4], s: [8.8, 1, 4.8], mat: 'stone', glow: STONE, stripe: true }, // gap 2.90 off the lift, top 12.60 — CP11
    { kind: 'laser', a: [353.8, 13.60, -5.8], b: [353.8, 13.60, -1.0], radius: 0.12, color: HOT, cycle: { on: 1.0, off: 1.6, warn: 0.40, phase: 0.35 } },
    { kind: 'speedpad', p: [360.2, 12.67, -3.4], s: [2.4, 0.16, 4.0], dir: [1, 0, 0], power: 4 },

    { kind: 'text', p: [353.0, 15.4, -3.4], rot: [0, -Math.PI / 2, 0], text: 'HOLD SHIFT', size: 0.62, color: GOLD },
    { kind: 'text', p: [353.0, 14.7, -3.4], rot: [0, -Math.PI / 2, 0], text: '5.6 m  ·  the pad only helps', size: 0.26, color: DUSK },
    { kind: 'deco', kindOf: 'rail', p: [357.0, 13.9, -1.0], s: [8.8, 0.08, 0.08], mat: 'metal', tint: GOLD },
    { kind: 'deco', kindOf: 'rail', p: [357.0, 13.9, -5.8], s: [8.8, 0.08, 0.08], mat: 'metal', tint: GOLD },

    { kind: 'platform', p: [370.0, 12.1, -3.4], s: [6.0, 1, 5.0], mat: 'panel', glow: GOLD, stripe: true }, // gap 5.60 — SPRINT, top 12.60

    /* ---------------------------------------------------------------------------- */
    /* BEAT 26 — SET-PIECE : THE SINKING BRIDGE                                     */
    /* Three tiles that drop the moment you stand on them (0.5 s of grace, then 6    */
    /* m/s straight down, back after 3.4 s), climbing +1.3 / +1.6 / +1.6 and         */
    /* zig-zagging z -1.4 / +2.2 / -1.4 as they go, with a bar turning over the      */
    /* middle one. It shares nothing with BEAT 24: no pad, no ring, no wait — the    */
    /* only thing it asks is that you never stop, with a void deck rising underneath */
    /* the whole staircase.                                                          */
    /* ---------------------------------------------------------------------------- */

    {
      kind: 'mover',
      p: [376.4, 13.4, -1.4],
      s: [3.0, 1, 3.4],
      mat: 'panel',
      motion: { type: 'sink', sinkDelay: 0.5, sinkSpeed: 6.0, sinkDepth: 14, respawnAfter: 3.4 },
    }, // gap 1.90, +1.3, top 13.90
    {
      kind: 'mover',
      p: [381.0, 15.0, 2.2],
      s: [2.8, 1, 3.2],
      mat: 'panel',
      motion: { type: 'sink', sinkDelay: 0.45, sinkSpeed: 6.5, sinkDepth: 14, respawnAfter: 3.2 },
    }, // gap 1.73, +1.6, top 15.50
    { kind: 'rotor', p: [381.0, 17.30, 2.2], style: 'bar', arms: 2, len: 2.6, thick: 0.34, period: 3.0, phase: 0.00, axis: [0, 1, 0] },
    {
      kind: 'mover',
      p: [385.4, 16.6, -1.4],
      s: [2.8, 1, 3.2],
      mat: 'panel',
      motion: { type: 'sink', sinkDelay: 0.4, sinkSpeed: 7.0, sinkDepth: 14, respawnAfter: 3.0 },
    }, // gap 1.65, +1.6, top 17.10

    /* ---------------------------------------------------------------------------- */
    /* BEAT 27 — THE SUMMIT GATE                                                    */
    /* A carriage that oscillates diagonally — 7.6 m across and 1.5 m up on a 4.6 s  */
    /* sine, so it is never stationary and never has a dwell to wait out — carries   */
    /* the route back across the centre line onto the last terrace. Then a 5.5 m pad */
    /* under a censer, and the gate: the only violet object in the game and the only */
    /* surface above x 325 that the collapse never reaches.                          */
    /* ---------------------------------------------------------------------------- */

    {
      kind: 'mover',
      p: [390.4, 17.9, -4.6],
      s: [4.0, 1, 4.0],
      mat: 'metal',
      motion: { type: 'oscillate', to: [390.4, 19.4, 3.0], period: 4.6, phase: 0, ease: 'sine' },
    }, // gap 1.60, +1.3 to board, top 18.40 at the near pose

    { kind: 'platform', p: [395.6, 19.4, 3.0], s: [5.6, 1, 5.6], mat: 'panel', glow: GOLD, stripe: true }, // gap 2.83, +1.5, top 19.90
    { kind: 'jumppad', p: [396.2, 19.98, 3.0], s: [3.0, 0.16, 3.0], power: 5.5, dir: [0, 1, 0] },
    { kind: 'pendulum', p: [396.2, 23.90, 3.0], len: 2.8, amp: 0.70, period: 2.8, phase: 0.40, axis: [1, 0, 0], blade: { w: 0.40, h: 1.4, d: 3.0 } }, // guards the last pad; lowest 20.40, clear of the pad's 20.06 cap

    { kind: 'platform', p: [402.6, 23.7, 0], s: [8.0, 1, 10.0], mat: 'obsidian', glow: VIOLET, stripe: true }, // top 24.20 — FINISH

    { kind: 'deco', kindOf: 'arch', p: [402.6, 29.9, 0], s: [1.8, 1.4, 11.0], mat: 'obsidian', tint: VIOLET },
    { kind: 'deco', kindOf: 'pillar', p: [402.6, 27.1, 5.2], s: [1.5, 6.8, 1.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [402.6, 27.1, -5.2], s: [1.5, 6.8, 1.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'beacon', p: [406.4, 26.5, 0], s: [0.7, 3.4, 0.7], mat: 'emissive', tint: VIOLET },
    { kind: 'deco', kindOf: 'banner', p: [402.6, 27.7, 3.6], s: [0.1, 4.0, 2.0], mat: 'panel', tint: VIOLET },
    { kind: 'deco', kindOf: 'banner', p: [402.6, 27.7, -3.6], s: [0.1, 4.0, 2.0], mat: 'panel', tint: VIOLET },
    { kind: 'text', p: [399.2, 26.7, 0], rot: [0, -Math.PI / 2, 0], text: 'THE LAST STEP', size: 0.5, color: VIOLET },
    { kind: 'light', p: [402.6, 27.5, 0], color: VIOLET, intensity: 24, distance: 40 },
    { kind: 'light', p: [390.4, 21.4, -1.0], color: GOLD, intensity: 13, distance: 26 },
    { kind: 'light', p: [370.0, 15.4, -3.4], color: GOLD, intensity: 9, distance: 20 },

    /* ============================================================================ */
    /* THE SKY TEMPLE — dressing.                                                   */
    /* Every item below sits at |z| >= 12, above y = 26, or below y = -10, i.e. out  */
    /* of every play corridor on the stage. None of them has a flat lit top edge, so */
    /* none can be misread as a landing.                                             */
    /* ============================================================================ */

    // The nave itself — the mass MOVEMENT III runs around the outside of. Sited at
    // z -18 so the rim's outward arc (to z +15.6 on the coin line) always has it on
    // the inside shoulder, and it stops at y 22 so nothing of it is over the rim.
    { kind: 'deco', kindOf: 'monolith', p: [216.0, 2.0, -18.0], s: [64.0, 40.0, 14.0], mat: 'stone', tint: 0xbfa273 },
    { kind: 'deco', kindOf: 'buttress', p: [196.0, 6.0, -11.0], s: [2.6, 14.0, 2.6], rot: [0, 0, 0.30], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'buttress', p: [212.0, 6.0, -11.0], s: [2.6, 14.0, 2.6], rot: [0, 0, 0.30], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'buttress', p: [228.0, 6.0, -11.0], s: [2.6, 14.0, 2.6], rot: [0, 0, 0.30], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'arch', p: [216.0, 24.0, -14.0], s: [40.0, 2.0, 2.0], mat: 'stone', tint: STONE },
    { kind: 'deco', kindOf: 'screen', p: [204.0, 16.0, -13.0], s: [0.5, 9.0, 6.0], mat: 'emissive', tint: 0xffd08a },
    { kind: 'deco', kindOf: 'screen', p: [230.0, 16.0, -13.0], s: [0.5, 9.0, 6.0], mat: 'emissive', tint: 0xffd08a },

    // Far architecture along the whole run, scattered deterministically.
    { kind: 'deco', kindOf: 'monolith', p: [80, -22, 34], s: [10, 40, 10], count: 8, spread: [190, 26, 26], seed: 1301, tint: 0x9a8261 },
    { kind: 'deco', kindOf: 'monolith', p: [300, -24, -36], s: [12, 44, 12], count: 8, spread: [200, 30, 28], seed: 1409, tint: 0x8f7a5c },
    { kind: 'deco', kindOf: 'pillar', p: [150, -14, 22], s: [2.0, 26.0, 2.0], count: 9, spread: [280, 14, 10], seed: 1517, tint: STONE },
    { kind: 'deco', kindOf: 'shard', p: [345, 2, 26], s: [3.0, 9.0, 3.0], count: 7, spread: [120, 22, 18], seed: 1621, tint: 0xffd08a },
    { kind: 'deco', kindOf: 'banner', p: [120, 12.0, 13.0], s: [0.1, 5.0, 2.4], count: 6, spread: [140, 3, 2], seed: 1733, tint: GOLD },

    // The cloud sea. Two decks of it, both far below anything the player stands on —
    // and the upper deck is what the collapse comes up through, so it is lit.
    { kind: 'deco', kindOf: 'cloud', p: [200, -34, 0], s: [26, 3.4, 26], count: 16, spread: [420, 12, 130], seed: 1847, scale: 2.2, tint: 0xffffff },
    { kind: 'deco', kindOf: 'cloud', p: [200, -52, 0], s: [34, 4.0, 34], count: 12, spread: [420, 14, 160], seed: 1951, scale: 2.8, tint: 0xdfe8f6 },

    // Path lights, one per movement, so the whole route reads as a single climbing
    // line from the threshold and from the gate looking back.
    { kind: 'light', p: [45, 5.4, 0], color: GOLD, intensity: 7, distance: 26 },
    { kind: 'light', p: [86, 6.0, 0], color: GOLD, intensity: 7, distance: 26 },
    { kind: 'light', p: [132, 6.4, 0], color: GOLD, intensity: 8, distance: 26 },
    { kind: 'light', p: [222, 8.6, 7.0], color: FROST, intensity: 9, distance: 26 },
    { kind: 'light', p: [249, 8.6, 1.2], color: GOLD, intensity: 8, distance: 24 },
    { kind: 'light', p: [288, 4.6, 0], color: HOT, intensity: 9, distance: 20, flicker: 0.2 },
    { kind: 'light', p: [340, 12.6, 0], color: GOLD, intensity: 10, distance: 24 },
    { kind: 'light', p: [394, 22.6, 0], color: VIOLET, intensity: 12, distance: 26 },
  ],
};
