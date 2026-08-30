/**
 * ASCENDANT — LAVA FOUNDRY 3 : "CRUCIBLE"
 * runtime/data/stages/foundry-3.js
 *
 * You cross the tap floor, drop into the pour shaft, and then the crucible lets go.
 * From the shaft mouth on, one rising front climbs the shaft at 0.45 m/s and the
 * course climbs with it: every landable surface in Act 2 sits 1.2–1.8 m above the
 * one before it, so the race is decided by whether you keep taking rungs.
 *
 * SHAPE      ~230 m of travel, 59 gameplay objects, 6 checkpoints, 4 orbs.
 *            Ladder: 6.0 (tap floor) -> 9.9 -> 11.3 -> 12.8 -> 14.4 -> 15.9 -> 17.4
 *            -> 19.0 -> 20.6 -> 22.0 -> 23.2 (quench plate, the sprint gap is flat)
 *            -> 24.8 -> 26.3 -> 27.9 -> 29.3 -> 31.0 -> 32.4 -> 34.0 (spout island)
 *            -> 35.5 -> 37.2 -> 42.0 -> 43.5 -> 45.1 -> 46.9 (finish).
 *            No rise repeats more than twice in a row and the last three ramp
 *            1.5 -> 1.6 -> 1.8.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PAD LAW  (the arithmetic that governs every pad and every pad landing here)
 * ─────────────────────────────────────────────────────────────────────────────
 * A bounce is NOT a jump. controller.js:903 rises a bounce at `gravFall` (54), not
 * gravRise, and `_applyBounce` writes vel.y only — horizontal speed is untouched and
 * speedAirCap (12.6) bleeds neither 8.6 nor 12.2. Holding jump on the contact frame
 * multiplies the APEX by 1.25 (BOUNCE_HELD_BONUS). So a pad of apex P launched from
 * a top y0 onto a top y1 has
 *     t = sqrt(2P/54) + sqrt(2(P - (y1-y0))/54)
 * and FOUR natural landings: run/sprint x hold/no-hold. The landing deck of every
 * pad in this file spans that whole scatter with >= 0.6 m of margin at both ends,
 * and nothing lethal is inside it. Measured, per pad:
 *
 *   pad          P    y0     y1    t(no-hold)  t(hold)   landing window     deck
 *   x 64.2      4.8   6.14   9.9    0.618 s    0.760 s   68.11 .. 74.87   67.5 .. 75.5
 *   x 203.6     6.2  37.34  42.0    0.718 s    0.874 s  208.48 ..215.57  207.6 ..216.4
 *
 * (window = nearest edge of the pad + run*t_noHold  ..  far edge + sprint*t_hold)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SPINE  — one `risinglava` front, x 66..238, from y 4.0 to y 58.0 at 0.45 m/s,
 * armed at t = 120 on the stage clock. `resetFrom()` (stage.js:2892) rewinds the
 * clock to the checkpoint's clockOffset, so every respawn hands back the SAME race:
 *
 *   cp  x       deck y  clockOffset  front y  head-room  s. to eat  leg  leg needs
 *   0    39.6     6.0       40         4.0     (off-map)   n/a      —      —
 *   1    61.0     6.0      116         4.0      2.0*      4.4*     20 s   17 s
 *   2    88.6    14.4      133         9.85     4.55     10.1      22 s   20 s
 *   3   112.3    20.6      145        15.25     5.35     11.9      20 s   19 s
 *   4   150.5    24.8      156        20.20     4.60     10.2      26 s   21 s
 *   5   187.6    34.0      178        30.10     3.90      8.7      30 s   23 s
 *
 *   * CP1's deck is the shaft mouth at x 59.9..65.7 — OUTSIDE the front's footprint
 *     (which starts at x 66), so the mouth itself never floods. What the CP1 number
 *     means is 4 s of quiet before the pour arms and 17 s before it eats the first
 *     gallery at 9.9. "leg needs" is the clean-run traverse; the front eats the far
 *     end of every leg 1–7 s after that, so hesitation — not the route — is the killer.
 *
 * FIRST RUN vs RESPAWN (why CP0 carries an offset). A fresh run starts at clock 0,
 * and nothing rewinds the clock until you die, so with delay 96 the old build
 * punished the careful, deathless, SLOW player and handed the player who died in
 * Act 1 a fresh 96 s. Two changes fix that: the pour now arms at t = 120 (past any
 * plausible careful Act-1 traverse of the 63.5 m tap floor), and CP0 carries
 * clockOffset 40 — the median fresh-run clock at that deck — so dying in Act 1 buys
 * you the median schedule back, never a fresh one. The ordering is now the right way
 * round: playing well is never worse than dying.
 *
 * TEACHES -> TWISTS -> COMBINES
 *   BEAT 2  conveyors, one with you and one against you (isolation)
 *   BEAT 3  three crushers on a 3.6 m catwalk, 1.4 m of real standing room between
 *           the heads, and a saw sunk in the exit gap that breaks the deck plane
 *   BEAT 5  jump pad + the two vanish grates — the only vanish passage on the stage
 *   BEAT 6  a one-plate beam, then conveyor UNDER crusher (combine 2 + 3)
 *   BEAT 7  a quench plate: ICE, where a speed pad's boost actually survives
 *           (friction 1.4 vs 13), a slag hurdle taken while sliding, and the one
 *           sprint gap — then a sweeping bar whose lane opens and closes
 *   BEAT 8  slag beds: plates that ARM instead of vanishing (retracting spikes)
 *   BEAT 9  SET-PIECE: THE POUR SPOUT — 16 m of moving belt under four rams, the
 *           second belt running against you, with a checkpoint island in the middle
 *   BEAT 10 a skip hoist, two rungs and the crucible rim
 *
 * CONVENTIONS (full list in runtime/data/index.js):
 *   p = CENTRE, s = FULL size, a top surface is p[1] + s[1]/2 and a platform spans
 *   x from p[0]-s[0]/2 to p[0]+s[0]/2. Every gap quoted below is EDGE TO EDGE.
 *   rot/yaw in radians, yaw 0 faces +X. `stripe: true` = "you must jump to get here".
 *   PHASE UNITS DIFFER AND THE ENGINE IS THE AUTHORITY:
 *     vanish + rotor + crusher `phase` = FRACTION of one cycle (vanish.js:528,
 *     crushers.js:326) — 0..1.
 *     spikes + laser `phase` = SECONDS, added straight to t (lasers.js:616).
 *   A `saw` is arms=1 and its kill volume is three nested inscribed boxes that its
 *   own spin sweeps across the whole disc (rotors.js:298, :700-703): a saw occupies
 *   its ENTIRE disc at every instant, so `period` is tempo, never a timing window.
 *   Both saws here are therefore spatial problems — a disc in your way that you must
 *   clear — and nothing in this file pretends a saw can be timed.
 *
 * REACH BUDGET USED (CONTRACT section 0 safe limits: run 4.35 flat, 3.51 at +1.4,
 * 3.33 at +1.6, 3.10 at +1.8; sprint 6.22 flat):
 *   longest run-speed flat gap      3.9 m   (BEAT 3, over the sunken saw)
 *   longest run-speed rise          1.8 m over 1.7 m   (BEAT 6, off the belt)
 *   the ONE sprint gap              5.4 m   (BEAT 7, off the quench plate)
 *   riskiest optional line          3.5 m off the catwalk, down 1.6 m   (ORB 2)
 */

const HOT = 0xff4a10;      // palette.kill      — molten, always moving
const GLOW = 0xffb04a;     // palette.killGlow
const EMBER = 0xffb44a;    // palette.accent
const EDGE = 0xa8e6ff;     // palette.safeEdge  — every landable surface wears this
const VIOLET = 0xc9a6ff;   // palette.finish    — the finish gate and nothing else
const SOOT = 0x2a2320;     // palette.deco
const IRON = 0x8b94a4;     // palette.safe
// palette.checkpointOn (0x56ffd0, themes.js:192) is DELIBERATELY not a constant in
// this file. CONTRACT hard rule 2 reserves it: checkpoints pulse a unique colour and
// nothing else on the stage may wear it. Orb markers use EDGE, bail-out bays use
// EDGE, path lights use EMBER.

export default {
  id: 'foundry-3',
  world: 'foundry',
  name: 'CRUCIBLE',
  subtitle: 'The pour has started and the only way out is up',
  par: 210000,
  difficulty: 8,

  spawn: { p: [-2.5, 6.1, 0], yaw: 0 },
  killY: -25,

  checkpoints: [
    // On the tap floor, looking down the crusher catwalk. clockOffset 40 is the
    // median fresh-run clock here: dying in Act 1 hands back the median pour
    // schedule instead of a free reset (see FIRST RUN vs RESPAWN above).
    { p: [39.6, 6.1, 0], yaw: 0, clockOffset: 40 },
    // The shaft mouth. THE POUR ARMS FOUR SECONDS AFTER YOU RESPAWN HERE.
    { p: [61.0, 6.1, 0], yaw: 0, clockOffset: 116 },
    // Top of the vanish pair. Front at 9.85 — 4.55 m under the deck, 10 s to eat it.
    { p: [88.6, 14.5, 0], yaw: 0, clockOffset: 133 },
    // Off the belt-under-ram, before the quench plate. Front at 15.25.
    { p: [112.3, 19.3, 2.6], yaw: 0, clockOffset: 145 },
    // Past the sweeper, before the slag beds. Front at 20.20.
    { p: [150.5, 23.3, 0], yaw: 0, clockOffset: 156 },
    // THE SPOUT ISLAND — halfway across the belt bridge, so a death at the far
    // rams replays 23 s of bridge instead of the whole 49 m leg. Front at 30.10
    // and visibly eating the belt you just crossed.
    { p: [187.6, 32.6, 0], yaw: 0, clockOffset: 178 },
  ],

  finish: { p: [231.6, 45.3, 0], yaw: 0 },

  // Four orbs, four different ideas. None of them is a ring-plus-light on a grate.
  coins: [
    { p: [17.6, 7.2, 7.0] },   // BEAT 2 — on a belt that runs OUT over the melt
    { p: [57.9, 5.6, 6.8] },   // BEAT 3 — down past the saw teeth and back up
    { p: [95.4, 17.1, 9.6] },  // BEAT 6 — ride the ladle carousel round the shaft
    { p: [195.2, 35.2, 6.2] }, // BEAT 9 — a one-shot crumble line beside the rams
  ],

  objects: [
    /* ============================================================================ */
    /* BEAT 1 — THE TAP FLOOR                                                       */
    /* A wide charging deck six metres over a standing melt. You cannot fall off it  */
    /* and nothing on it moves: the stage spends its first ten seconds proving that  */
    /* orange-and-self-lit means dead and cold steel with a cyan lip means safe.     */
    /* ============================================================================ */

    { kind: 'platform', p: [1, 5.5, 0], s: [13, 1, 12], mat: 'metal', glow: SOOT },

    // The standing melt under the whole tap floor. Static: this one never rises. Its
    // top sits at y 0.5, so the deck reads as a gantry and not as ground.
    { kind: 'lava', p: [28, -1.0, 0], s: [80, 3, 30] },

    { kind: 'text', p: [-5.8, 8.7, 0], rot: [0, -Math.PI / 2, 0], text: 'CRUCIBLE', size: 0.82, color: EMBER },
    { kind: 'text', p: [-5.8, 8.05, 0], rot: [0, -Math.PI / 2, 0], text: 'LAVA FOUNDRY  ·  III', size: 0.28, color: 0xa8785c },
    { kind: 'text', p: [-5.8, 7.5, 0], rot: [0, -Math.PI / 2, 0], text: 'the pour is scheduled  ·  you are not', size: 0.24, color: HOT },

    // The charging floor's own furniture: the tap hole you are standing beside, the
    // launder channel that carries the melt away, and the stopper rod over it.
    { kind: 'deco', kindOf: 'taphole', p: [4.4, 5.9, -4.2], s: [2.2, 0.5, 2.2], scale: 1.5, mat: 'obsidian', tint: HOT },
    { kind: 'deco', kindOf: 'launder', p: [3.0, 4.6, 5.6], s: [11.0, 0.9, 1.6], scale: 1.1, count: 4, spread: 4.4, seed: 2201, mat: 'obsidian', tint: GLOW },
    { kind: 'deco', kindOf: 'girders', p: [1.0, 10.8, 0], scale: 1.6, count: 5, spread: 5.2, seed: 2202, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'arch', p: [7.6, 11.4, 0], s: [1.2, 1.0, 16.0], scale: 2.2, mat: 'obsidian', tint: EMBER },
    { kind: 'deco', kindOf: 'pillar', p: [7.6, 8.6, 7.4], s: [1.3, 6.2, 1.3], scale: 1.8, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [7.6, 8.6, -7.4], s: [1.3, 6.2, 1.3], scale: 1.8, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'brazier', p: [-3.4, 6.9, 4.8], s: [1.0, 1.4, 1.0], mat: 'metal', tint: GLOW },
    { kind: 'deco', kindOf: 'brazier', p: [-3.4, 6.9, -4.8], s: [1.0, 1.4, 1.0], mat: 'metal', tint: GLOW },
    { kind: 'light', p: [-3.4, 8.0, 4.8], color: GLOW, intensity: 7, distance: 15, flicker: 0.34 },
    { kind: 'light', p: [-3.4, 8.0, -4.8], color: GLOW, intensity: 7, distance: 15, flicker: 0.34 },
    { kind: 'light', p: [1, 9.6, 0], color: 0xcfe2ff, intensity: 9, distance: 24 },

    /* ============================================================================ */
    /* BEAT 2 — THE TAP LINE  (conveyors, in isolation)                             */
    /* Belt one runs WITH you at 6.5 and turns a 2.8 m hop into a gift. Belt two runs */
    /* AGAINST you at 4.8 and turns a 1.9 m hop into a decision. Between them, two    */
    /* pads of different size and material that alternate across the axis so the      */
    /* belts are never the only problem. One fall from the melt, nothing timed.       */
    /*                                                                              */
    /* ORB 1 is a spur belt that runs OUTWARD, +Z, over the melt. Standing still on   */
    /* it feeds you off the end; the orb is over its inboard half, so the beat is     */
    /* "step on, take it, turn round before the belt spends you". No vanish tile, no  */
    /* ring, no timing — the only orb on the stage that is a surface problem.         */
    /* ============================================================================ */

    { kind: 'conveyor', p: [12.0, 5.65, 0], s: [6.0, 0.7, 4.4], dir: [1, 0, 0], power: 6.5, mat: 'conveyor' }, // top 6.0, gap 1.5

    { kind: 'conveyor', p: [17.6, 5.65, 7.0], s: [3.4, 0.7, 3.4], dir: [0, 0, 1], power: 3.6, mat: 'conveyor' }, // 3.23 m diagonal off belt one
    { kind: 'deco', kindOf: 'rail', p: [17.6, 6.7, 5.3], s: [3.4, 0.07, 0.07], mat: 'metal', tint: EDGE },
    { kind: 'deco', kindOf: 'lantern', p: [19.3, 7.0, 8.7], s: [0.7, 1.0, 0.7], mat: 'emissive', tint: EDGE },
    { kind: 'light', p: [17.6, 7.6, 7.0], color: EDGE, intensity: 5, distance: 12 },

    { kind: 'platform', p: [19.4, 5.5, 2.0], s: [3.2, 1, 3.2], mat: 'panel', glow: EDGE, stripe: true }, // gap 2.8 off the belt, 1.7 off the spur
    { kind: 'platform', p: [24.4, 5.5, -2.2], s: [2.8, 1, 3.6], mat: 'grate', glow: EDGE, stripe: true }, // diagonal 2.15

    { kind: 'conveyor', p: [32.2, 5.65, 0], s: [6.4, 0.7, 4.2], dir: [-1, 0, 0], power: 4.8, mat: 'conveyor' }, // gap 3.2, and it shoves back

    { kind: 'platform', p: [39.6, 5.5, 0], s: [4.6, 1, 6.4], mat: 'panel', glow: IRON, stripe: true }, // CP0, gap 1.9 fighting the belt

    { kind: 'text', p: [9.6, 8.4, 3.6], rot: [0, -Math.PI / 2, 0], text: 'MIND THE BELTS', size: 0.42, color: EMBER },
    { kind: 'text', p: [28.4, 8.4, 3.6], rot: [0, -Math.PI / 2, 0], text: 'this one runs the wrong way', size: 0.24, color: 0xa8785c },
    { kind: 'deco', kindOf: 'pipes', p: [20, 10.4, 8.6], scale: 2.4, count: 7, spread: 14.0, seed: 2211, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'pipes', p: [20, 11.2, -8.6], scale: 2.4, count: 7, spread: 14.0, seed: 2212, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'girders', p: [26.0, 9.4, 0], scale: 1.9, count: 4, spread: 8.0, seed: 2213, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'vent', p: [14.0, 3.4, -7.6], s: [2.0, 1.6, 2.0], scale: 1.4, mat: 'metal' },
    { kind: 'deco', kindOf: 'ladle', p: [30.0, 8.2, -7.0], s: [2.4, 2.6, 2.4], scale: 2.0, mat: 'metal', tint: GLOW },
    { kind: 'deco', kindOf: 'lantern', p: [24.0, 8.6, -6.4], s: [0.7, 1.0, 0.7], mat: 'emissive', tint: GLOW },
    { kind: 'light', p: [20, 8.2, 0], color: GLOW, intensity: 8, distance: 26, flicker: 0.12 },
    { kind: 'light', p: [34.0, 8.4, -4.0], color: EMBER, intensity: 6, distance: 16 },

    /* ============================================================================ */
    /* BEAT 3 — THE CRUSHER CATWALK  (crushers, in isolation, then a saw)           */
    /* Twelve metres of 3.6 m walkway with three stamping heads across it. The heads  */
    /* span the full width, so there is no sidestep — only timing.                    */
    /*                                                                              */
    /* THE HEADS ARE 2.4 m WIDE AND 3.8 m APART, so the slots between them are 1.4 m  */
    /* of real floor against a 0.7 m capsule: 0.35 m of clearance on each shoulder.   */
    /* A head is passable while its bottom is at or above 7.8 (crushers.js:326-334),  */
    /* i.e. while u <= 0.64, and with dwells of 0.9 / 0.8 / 0.7 s on periods of       */
    /* 3.6 / 3.0 / 2.4 the slot in front of every head is open 45–52% of the time.    */
    /* You are meant to STEP, READ, STEP — not to find the one straight run-through.  */
    /*                                                                              */
    /* Two bail-out bays hang off the walkway at z +/-3.4, beside the slots and       */
    /* outside every head's footprint. They wear EDGE, not the checkpoint colour:     */
    /* nothing on this stage puts a false checkpoint tell in a panicked three seconds.*/
    /*                                                                              */
    /* The exit is a saw sunk into the gap with its HUB ON THE DECK LINE: the disc    */
    /* breaks the walkway plane by 1.2 m, so the gap cannot be walked or short-hopped */
    /* — it must be jumped, and the jump has to be started from the lip. Measured     */
    /* against the disc's high point at x 57.9 (top 7.14 after the inscribed-box      */
    /* under-cover): a run jump from 56.0 is at 7.86 there (clears by 0.72), a sprint */
    /* jump is at 7.50 (clears by 0.36), a walk-off is at 6.0 and is cut in half.     */
    /* ============================================================================ */

    { kind: 'platform', p: [50.0, 5.5, 0], s: [12, 1, 3.6], mat: 'grate', glow: EDGE, stripe: true }, // gap 2.1, top 6.0

    { kind: 'crusher', p: [46.2, 11.7, 0], s: [2.4, 1.4, 3.6], axis: [0, -1, 0], travel: 5.0, period: 3.6, phase: 0.00, dwell: 0.9 }, // 45.0..47.4
    { kind: 'crusher', p: [50.0, 11.7, 0], s: [2.4, 1.4, 3.6], axis: [0, -1, 0], travel: 5.0, period: 3.0, phase: 0.37, dwell: 0.8 }, // 48.8..51.2
    { kind: 'crusher', p: [53.8, 11.7, 0], s: [2.4, 1.4, 3.6], axis: [0, -1, 0], travel: 5.0, period: 2.4, phase: 0.71, dwell: 0.7 }, // 52.6..55.0

    { kind: 'platform', p: [47.8, 5.5, 3.4], s: [2.4, 1, 2.4], mat: 'panel', glow: EDGE, stripe: true }, // bail-out bay beside slot 1
    { kind: 'platform', p: [52.0, 5.5, -3.4], s: [2.4, 1, 2.4], mat: 'panel', glow: EDGE, stripe: true }, // bail-out bay beside slot 2

    // ORB 2 — the only downward line on the stage. Drop 1.6 m off the catwalk's
    // shoulder (3.51 m diagonal, 70% of the run budget at that fall), take the orb
    // level with the saw's teeth, and climb 1.84 m back onto the mouth deck.
    { kind: 'platform', p: [57.9, 3.9, 6.8], s: [3.2, 1, 3.0], mat: 'grate', glow: EDGE, stripe: true }, // top 4.4
    { kind: 'deco', kindOf: 'cage', p: [57.9, 5.4, 8.3], s: [1.6, 2.0, 0.4], scale: 1.3, mat: 'metal', tint: IRON },
    { kind: 'light', p: [57.9, 6.0, 6.8], color: EDGE, intensity: 5, distance: 12 },

    // Hub ON the deck line (6.0) with a 1.2 m blade: the disc spans y 4.8..7.2 and
    // x 56.7..59.1 in a 3.9 m gap. period is tempo only — see the header note.
    { kind: 'rotor', p: [57.9, 6.0, 0], style: 'saw', len: 1.2, thick: 0.34, period: 1.6, phase: 0, axis: [0, 0, 1] },

    { kind: 'platform', p: [62.8, 5.5, 0], s: [5.8, 1, 7], mat: 'stone', glow: EDGE, stripe: true }, // gap 3.9 over the blade, top 6.0

    { kind: 'text', p: [43.4, 9.0, 0], rot: [0, -Math.PI / 2, 0], text: 'THREE HEADS  ·  THREE CLOCKS', size: 0.40, color: HOT },
    { kind: 'text', p: [43.4, 8.4, 0], rot: [0, -Math.PI / 2, 0], text: 'the slots are floor  ·  stand in one', size: 0.22, color: 0xa8785c },
    { kind: 'text', p: [56.2, 8.2, 2.6], rot: [0, -Math.PI / 2, 0], text: 'THE BLADE IS IN THE GAP', size: 0.44, color: HOT },
    { kind: 'deco', kindOf: 'buttress', p: [46.2, 13.6, 3.4], s: [1.6, 2.6, 1.6], scale: 1.5, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [50.0, 13.6, -3.4], s: [1.6, 2.6, 1.6], scale: 1.5, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [53.8, 13.6, 3.4], s: [1.6, 2.6, 1.6], scale: 1.5, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'girders', p: [50.0, 14.4, 0], scale: 2.1, count: 6, spread: 6.0, seed: 3301, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'grate', p: [57.9, 4.4, 0], s: [4.4, 0.16, 3.0], scale: 1.2, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'fins', p: [57.9, 3.0, -5.4], scale: 1.4, count: 5, spread: 2.6, seed: 3302, mat: 'metal', tint: SOOT },
    { kind: 'light', p: [50.0, 9.4, 0], color: EMBER, intensity: 10, distance: 24 },
    { kind: 'light', p: [57.9, 7.2, 0], color: HOT, intensity: 8, distance: 14, flicker: 0.2 },

    /* ============================================================================ */
    /* BEAT 4 — THE POUR  (the spine of the stage)                                  */
    /* ONE rising front, x 66..238, z -18..18. It sits at y 4.0 until t = 120, then    */
    /* climbs at 0.45 m/s to y 58 — eleven metres over the finish deck. It reaches     */
    /* the first gallery (9.9) at t = 133.1, the quench plate (23.2) at 162.7, the     */
    /* spout island (34.0) at 186.7 and the finish deck (46.9) at 215.3.               */
    /*                                                                              */
    /* 0.45 m/s against an Act-2 climb rate of ~0.34 m/s means the front CLOSES on     */
    /* you the whole way: every checkpoint hands back 3.9–5.35 m of head-room and      */
    /* every leg spends 1–7 s of it. Stop moving for eight seconds anywhere above the  */
    /* mouth and it takes you. The footprint starts at x 66 so the shaft mouth is the  */
    /* one deck in Act 2 the pour cannot reach.                                        */
    /* ============================================================================ */

    { kind: 'risinglava', p: [152, 2.0, 0], s: [172, 4, 36], rising: { from: 4.0, to: 58.0, speed: 0.45, delay: 120 } },

    { kind: 'text', p: [59.4, 9.4, 0], rot: [0, -Math.PI / 2, 0], text: 'POUR SHAFT', size: 0.66, color: HOT },
    { kind: 'text', p: [59.4, 8.7, 0], rot: [0, -Math.PI / 2, 0], text: 'it starts when you do  ·  do not stop', size: 0.24, color: 0xa8785c },
    { kind: 'deco', kindOf: 'spout', p: [66.0, 10.4, 0], s: [3.0, 2.4, 3.0], scale: 2.6, mat: 'obsidian', tint: HOT },
    { kind: 'deco', kindOf: 'arch', p: [66.0, 13.0, 0], s: [1.4, 1.2, 20.0], scale: 2.4, mat: 'obsidian', tint: HOT },
    { kind: 'deco', kindOf: 'pillar', p: [66.0, 9.4, 9.6], s: [1.6, 8.0, 1.6], scale: 2.0, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [66.0, 9.4, -9.6], s: [1.6, 8.0, 1.6], scale: 2.0, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'banner', p: [66.0, 15.6, 6.4], s: [0.1, 4.2, 2.2], scale: 1.6, mat: 'panel', tint: HOT },
    { kind: 'deco', kindOf: 'banner', p: [66.0, 15.6, -6.4], s: [0.1, 4.2, 2.2], scale: 1.6, mat: 'panel', tint: HOT },
    { kind: 'light', p: [66.0, 11.0, 0], color: HOT, intensity: 14, distance: 30, flicker: 0.16 },

    /* ============================================================================ */
    /* BEAT 5 — THE FIRST LIFT  (jump pad + the stage's ONE vanish passage)          */
    /* The pad is the only way off the mouth: the gallery is 3.9 m up, which is 1.8 m  */
    /* above a standing jump's apex. Apex 4.8 puts you 0.618 s in the air with no      */
    /* hold and 0.760 s holding, so the four natural lines land between x 68.11 and    */
    /* 74.87 — and the gallery is EIGHT METRES LONG (67.5..75.5) so all four land on   */
    /* deck with 0.6 m to spare at each end. That is the pad law, not generosity.      */
    /*                                                                              */
    /* Then the two vanish grates. This is the only vanish passage on the stage: the   */
    /* verb is taught here, once, while the front is still 17 s below, and every other */
    /* rung-passage in the file is a different machine.                                */
    /* ============================================================================ */

    { kind: 'jumppad', p: [64.2, 6.07, 0], s: [2.8, 0.14, 3.2], power: 4.8, dir: [0, 1, 0] },
    { kind: 'text', p: [62.0, 8.0, -2.8], rot: [0, -Math.PI / 2, 0], text: 'THE PAD IS THE STAIRCASE', size: 0.36, color: EMBER },

    { kind: 'platform', p: [71.5, 9.4, 0], s: [8.0, 1, 5.6], mat: 'metal', glow: EDGE, stripe: true }, // the catch gallery, top 9.9

    { kind: 'vanish', p: [78.4, 10.8, 2.6], s: [3.2, 1, 3.4], mat: 'grate', cycle: { on: 2.6, off: 1.5, warn: 0.6, phase: 0.00 } }, // gap 1.3 at +1.4
    { kind: 'vanish', p: [83.2, 12.3, -2.4], s: [3.2, 1, 3.6], mat: 'grate', cycle: { on: 2.6, off: 1.5, warn: 0.6, phase: 0.36 } }, // diagonal 2.19 at +1.5

    { kind: 'platform', p: [88.6, 13.9, 0], s: [5.0, 1, 6.0], mat: 'stone', glow: EDGE, stripe: true }, // CP2, gap 1.3 at +1.6, top 14.4

    { kind: 'deco', kindOf: 'ring', p: [71.5, 14.6, 0], s: [0.16, 9.0, 9.0], rot: [0, Math.PI / 2, 0], scale: 2.6, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'shaftwall', p: [74.0, 12.0, 9.2], s: [12.0, 9.0, 0.8], scale: 2.2, count: 4, spread: 7.0, seed: 5501, mat: 'obsidian', tint: 0x241713 },
    { kind: 'deco', kindOf: 'shaftwall', p: [74.0, 12.0, -9.2], s: [12.0, 9.0, 0.8], scale: 2.2, count: 4, spread: 7.0, seed: 5502, mat: 'obsidian', tint: 0x241713 },
    { kind: 'deco', kindOf: 'launder', p: [80.0, 8.6, 6.6], s: [10.0, 0.8, 1.4], scale: 1.3, count: 3, spread: 5.0, seed: 5503, mat: 'obsidian', tint: GLOW },
    { kind: 'deco', kindOf: 'girders', p: [78.4, 15.6, 0], scale: 1.7, count: 5, spread: 6.4, seed: 5504, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'pipes', p: [84.0, 17.4, -8.4], scale: 2.0, count: 5, spread: 9.0, seed: 5505, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'lantern', p: [78.4, 13.2, -6.0], s: [0.7, 1.0, 0.7], mat: 'emissive', tint: GLOW },
    { kind: 'light', p: [76.0, 12.6, 0], color: EMBER, intensity: 8, distance: 22 },
    { kind: 'light', p: [88.0, 16.4, 0], color: EMBER, intensity: 8, distance: 22 },

    /* ============================================================================ */
    /* BEAT 6 — THE FEED LINE  (a beam, then conveyor UNDER crusher: 2 combined w/ 3)*/
    /* Six metres of one-plate beam with nothing under it but the front. No timing,    */
    /* no gap — only width. Then the combination the stage has been building to: a 7 m */
    /* belt that pushes you +X AND toward the outer wall (dir [1,0,0.35]) with a       */
    /* stamping head planted in the middle of it on a 2.6 s period. The belt will not  */
    /* let you stand still and the head will not let you walk through. Off the far end */
    /* is a 1.7 m hop at +1.6, then a 1.5 m hop at +1.6 onto CP3.                      */
    /*                                                                              */
    /* ORB 3 — THE LADLE CAROUSEL. A bucket on a 3.2 m turntable circling the shaft's  */
    /* throat on a 7 s revolution. It swings within 1.4 m of the beam once a lap; you  */
    /* step on, ride a quarter turn out over the pour, take the orb at the far arc and */
    /* ride back. Nothing else on the stage asks you to stand still and be carried.    */
    /* ============================================================================ */

    { kind: 'beam', p: [95.4, 15.6, 0], s: [6.4, 0.6, 1.0], mat: 'metal' }, // top 15.9, gap 1.1 at +1.5

    {
      kind: 'mover',
      p: [95.4, 15.4, 6.4],
      s: [2.6, 1, 2.6],
      mat: 'metal',
      motion: { type: 'circle', radius: 3.2, axis: 'y', period: 7.0, phase: 0.0 },
    }, // top 15.9; nearest arc sits 1.4 m off the beam, far arc carries the orb

    { kind: 'conveyor', p: [104.0, 17.05, 2.6], s: [7.0, 0.7, 3.4], dir: [1, 0, 0.35], power: 6.0, mat: 'conveyor' }, // top 17.4, gap 1.9 at +1.5
    { kind: 'crusher', p: [104.0, 22.6, 2.6], s: [2.6, 1.2, 3.8], axis: [0, -1, 0], travel: 4.6, period: 2.6, phase: 0.15, dwell: 0.4 }, // passable while u <= 0.61

    { kind: 'platform', p: [109.6, 18.5, 5.2], s: [3.6, 1, 3.4], mat: 'panel', glow: EDGE, stripe: true }, // ledge, gap 1.7 at +1.6, top 19.0
    { kind: 'platform', p: [112.3, 18.7, 2.6], s: [6.2, 1, 5.2], mat: 'stone', glow: EDGE, stripe: true }, // CP3, gap 1.5 at +1.6, top 19.2

    { kind: 'text', p: [91.0, 17.4, -3.4], rot: [0, -Math.PI / 2, 0], text: 'ONE PLATE WIDE', size: 0.34, color: 0xa8785c },
    { kind: 'text', p: [99.8, 20.4, -2.6], rot: [0, -Math.PI / 2, 0], text: 'THE BELT WILL NOT WAIT', size: 0.34, color: HOT },
    { kind: 'deco', kindOf: 'rail', p: [95.4, 16.4, 0.9], s: [6.4, 0.07, 0.07], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'rail', p: [95.4, 16.4, -0.9], s: [6.4, 0.07, 0.07], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'chain', p: [95.4, 20.2, 6.4], s: [0.3, 5.0, 0.3], scale: 2.2, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'hoist', p: [95.4, 22.4, 6.4], s: [4.0, 1.2, 4.0], scale: 1.8, mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'buttress', p: [104.0, 24.6, 2.6], s: [1.8, 2.8, 1.8], scale: 1.6, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'shaftwall', p: [102.0, 15.6, -8.8], s: [14.0, 10.0, 0.8], scale: 2.4, count: 4, spread: 8.0, seed: 6601, mat: 'obsidian', tint: 0x241713 },
    { kind: 'deco', kindOf: 'fins', p: [108.0, 21.6, -7.4], scale: 1.6, count: 6, spread: 3.4, seed: 6602, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'vent', p: [98.0, 12.4, 8.4], s: [2.2, 1.8, 2.2], scale: 1.5, mat: 'metal' },
    { kind: 'light', p: [95.4, 18.2, 4.0], color: EDGE, intensity: 5, distance: 13 },
    { kind: 'light', p: [104.0, 20.2, 2.6], color: EMBER, intensity: 9, distance: 22 },

    /* ============================================================================ */
    /* BEAT 7 — THE QUENCH RUN  (ice + speed pad + hurdle + the one sprint gap)      */
    /* A quenched steel plate, ten metres of it, slick with condensate. This is the    */
    /* one place on the stage where a speed pad is not decoration: ground friction is  */
    /* 13 on steel and a boost is gone in about 50 ms (controller.js:116-140, the      */
    /* accelerate early-out means the friction it removed is never handed back above   */
    /* target), but ICE runs friction 1.4, so the same boost survives ~0.3 s and about */
    /* five metres. Pad at x 128.9, lip at 130.6: the boost is still on you when you   */
    /* leave. The 0.6 m slag hurdle sits at 126.2, BEFORE the pad, so it is taken      */
    /* while sliding and costs nothing if you take it early.                           */
    /*                                                                              */
    /* THE GAP is 5.4 m flat: 102% of a run jump, 87% of a sprint one, and the pad     */
    /* makes it comfortable rather than possible — the gap is sprint-legal without it,  */
    /* because a moving surface is never the only way across. The catch gantry is       */
    /* 10.4 m long for exactly that reason: an unboosted sprint lands at 136.0..137.9   */
    /* and a fully boosted one at ~141, both on deck.                                   */
    /*                                                                              */
    /* Then the sweeper: a two-armed bar on a 3.0 s revolution at shin height across a  */
    /* 4.0 m gantry. It is SOLID, not lethal — it does not cut you, it puts you in the  */
    /* pour. Unlike a saw, a bar's arms leave the lane open half the time: that is the  */
    /* rotor on this stage that is actually a timing input.                             */
    /* ============================================================================ */

    { kind: 'platform', p: [118.3, 21.5, 1.0], s: [3.0, 1, 4.0], mat: 'metal', glow: EDGE, stripe: true }, // step, gap 1.4 at +1.4, top 22.0
    { kind: 'ice', p: [125.6, 22.7, 0], s: [10.0, 1, 3.8] },                                               // quench plate, gap 0.8 at +1.2, top 23.2
    { kind: 'spikes', p: [126.2, 23.5, 0], s: [1.2, 0.6, 3.8], dir: [0, 1, 0] },                           // slag hurdle, 0.6 m, on the slick
    { kind: 'speedpad', p: [128.9, 23.27, 0], s: [2.6, 0.14, 3.2], dir: [1, 0, 0], power: 6.5 },           // 1.7 m before the lip

    { kind: 'platform', p: [141.2, 22.7, 0], s: [10.4, 1, 4.0], mat: 'metal', glow: EDGE, stripe: true },  // catch gantry, THE GAP: 5.4 m flat, top 23.2
    { kind: 'rotor', p: [143.8, 23.55, 0], style: 'bar', arms: 2, len: 3.0, thick: 0.34, period: 3.0, phase: 0.0, axis: [0, 1, 0] },

    { kind: 'platform', p: [150.5, 24.3, 0], s: [4.6, 1, 5.2], mat: 'stone', glow: EDGE, stripe: true },   // CP4, gap 1.8 at +1.6, top 24.8

    { kind: 'text', p: [121.0, 26.6, -2.6], rot: [0, -Math.PI / 2, 0], text: 'QUENCH PLATE  ·  NO BRAKES', size: 0.52, color: EMBER },
    { kind: 'text', p: [121.0, 25.9, -2.6], rot: [0, -Math.PI / 2, 0], text: 'the boost only lives on the slick', size: 0.24, color: 0xa8785c },
    { kind: 'text', p: [138.0, 27.0, -2.8], rot: [0, -Math.PI / 2, 0], text: 'THE LANE OPENS  ·  THEN IT DOES NOT', size: 0.40, color: HOT },
    { kind: 'deco', kindOf: 'quenchtank', p: [125.6, 20.4, 7.2], s: [8.0, 2.6, 3.0], scale: 2.4, mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'pipes', p: [125.6, 26.6, 6.0], scale: 1.8, count: 6, spread: 6.0, seed: 7701, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'pipes', p: [131.0, 25.0, -6.4], scale: 1.8, count: 5, spread: 5.0, seed: 7702, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'rail', p: [125.6, 23.9, 1.9], s: [10.0, 0.08, 0.08], mat: 'metal', tint: EDGE },
    { kind: 'deco', kindOf: 'rail', p: [125.6, 23.9, -1.9], s: [10.0, 0.08, 0.08], mat: 'metal', tint: EDGE },
    { kind: 'deco', kindOf: 'girders', p: [141.2, 20.4, 0], scale: 2.0, count: 5, spread: 5.2, seed: 7703, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'shaftwall', p: [140.0, 20.6, 9.6], s: [16.0, 12.0, 0.8], scale: 2.6, count: 4, spread: 9.0, seed: 7704, mat: 'obsidian', tint: 0x241713 },
    { kind: 'deco', kindOf: 'screen', p: [133.0, 28.0, -9.4], s: [0.4, 5.0, 8.0], scale: 2.2, mat: 'emissive', tint: 0xff6a1a },
    { kind: 'deco', kindOf: 'buttress', p: [143.8, 25.6, 2.6], s: [1.4, 2.4, 1.4], scale: 1.4, mat: 'obsidian' },
    { kind: 'light', p: [125.6, 26.0, 0], color: EDGE, intensity: 8, distance: 20 },
    { kind: 'light', p: [143.8, 26.4, 0], color: HOT, intensity: 9, distance: 18, flicker: 0.18 },

    /* ============================================================================ */
    /* BEAT 8 — THE SLAG BEDS  (plates that ARM, instead of plates that vanish)      */
    /* Three plates climbing 1.5 / 1.6 / 1.4 m and alternating across the axis. They   */
    /* never disappear — they grow teeth. Each carries a retracting bed on a 3.8 s     */
    /* cycle: 2.4 s down (the last 0.7 s of it shuddering as a telegraph) then 1.4 s   */
    /* up, and the kill only arms past 34% extension. Their phases are 0 / 1.27 / 2.53 */
    /* SECONDS — spikes read `cycle.phase` in seconds (lasers.js:616), not as a        */
    /* fraction like a vanish tile — so the three beds are a third of a cycle apart.   */
    /*                                                                              */
    /* The difference from BEAT 5 is the failure mode. A vanish tile punishes standing */
    /* still by removing the floor; a slag bed leaves the floor and punishes you for   */
    /* being on it. You can wait out a bed. You cannot wait out the pour.              */
    /* ============================================================================ */

    { kind: 'platform', p: [156.0, 25.8, 2.6], s: [3.2, 1, 3.4], mat: 'grate', glow: EDGE, stripe: true }, // gap 1.6 at +1.5, top 26.3
    { kind: 'spikes', p: [156.0, 26.6, 2.6], s: [3.0, 0.6, 3.2], dir: [0, 1, 0], mode: 'retract', cycle: { on: 1.4, off: 2.4, warn: 0.7, phase: 0.00 } },

    { kind: 'platform', p: [160.8, 27.4, -2.4], s: [3.2, 1, 3.6], mat: 'grate', glow: EDGE, stripe: true }, // diagonal 2.19 at +1.6, top 27.9
    { kind: 'spikes', p: [160.8, 28.2, -2.4], s: [3.0, 0.6, 3.4], dir: [0, 1, 0], mode: 'retract', cycle: { on: 1.4, off: 2.4, warn: 0.7, phase: 1.27 } },

    { kind: 'platform', p: [165.6, 28.8, 2.2], s: [3.2, 1, 3.4], mat: 'grate', glow: EDGE, stripe: true }, // diagonal 1.94 at +1.4, top 29.3
    { kind: 'spikes', p: [165.6, 29.6, 2.2], s: [3.0, 0.6, 3.2], dir: [0, 1, 0], mode: 'retract', cycle: { on: 1.4, off: 2.4, warn: 0.7, phase: 2.53 } },

    { kind: 'platform', p: [171.5, 30.5, 0], s: [5.0, 1, 6.0], mat: 'panel', glow: EDGE, stripe: true }, // approach deck, gap 1.8 at +1.7, top 31.0

    { kind: 'text', p: [153.0, 28.4, -2.8], rot: [0, -Math.PI / 2, 0], text: 'SLAG BEDS  ·  WATCH THE SHUDDER', size: 0.38, color: HOT },
    { kind: 'deco', kindOf: 'slagpot', p: [158.4, 24.6, 6.8], s: [2.6, 2.8, 2.6], scale: 2.2, mat: 'metal', tint: GLOW },
    { kind: 'deco', kindOf: 'slagpot', p: [164.0, 25.8, -7.2], s: [2.6, 2.8, 2.6], scale: 2.0, mat: 'metal', tint: GLOW },
    { kind: 'deco', kindOf: 'girders', p: [161.0, 32.4, 0], scale: 1.8, count: 6, spread: 7.0, seed: 8801, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'shaftwall', p: [162.0, 26.4, 9.8], s: [16.0, 12.0, 0.8], scale: 2.6, count: 4, spread: 9.0, seed: 8802, mat: 'obsidian', tint: 0x241713 },
    { kind: 'deco', kindOf: 'shaftwall', p: [162.0, 26.4, -9.8], s: [16.0, 12.0, 0.8], scale: 2.6, count: 4, spread: 9.0, seed: 8803, mat: 'obsidian', tint: 0x241713 },
    { kind: 'deco', kindOf: 'launder', p: [168.0, 24.0, 6.2], s: [12.0, 0.8, 1.4], scale: 1.4, count: 3, spread: 5.0, seed: 8804, mat: 'obsidian', tint: GLOW },
    { kind: 'deco', kindOf: 'brazier', p: [171.5, 31.9, -3.4], s: [1.1, 1.5, 1.1], mat: 'metal', tint: GLOW },
    { kind: 'light', p: [160.8, 30.4, 0], color: EMBER, intensity: 9, distance: 22 },

    /* ============================================================================ */
    /* BEAT 9 — SET-PIECE : THE POUR SPOUT                                          */
    /* The crucible's spout hangs over this bridge and the bridge is a BELT. Sixteen   */
    /* metres of moving floor under four rams, in two spans:                          */
    /*                                                                              */
    /*   span 1 (8 m) runs WITH you at 5.0 under rams on 3.4 s and 2.7 s. The belt      */
    /*      carries you into the heads whether you decided to go or not — the read is   */
    /*      "walk back against it and let the head pass", which is the belt verb from    */
    /*      BEAT 2 and the crusher verb from BEAT 3 in the same second.                  */
    /*   THE SPOUT ISLAND — 4 m of dead-still floor between the spans, carrying CP5.     */
    /*      It halves the leg: a death at the far rams used to replay 49 m.               */
    /*   span 2 (8 m) runs AGAINST you at 4.0 under rams on 2.2 s and 3.0 s. Net 4.6 m/s */
    /*      forward, so the same 8 m takes twice as long and the fast head is on the      */
    /*      slow half. That is the twist the beat exists for.                             */
    /*                                                                              */
    /* Every ram is 4.4 m deep against a 4.2 m belt: no sidestep, only timing. Each is   */
    /* flush at the bottom of its travel and passable while u <= 0.61.                    */
    /*                                                                              */
    /* ORB 4 — the crumble line. Two plates in `crumble` mode hang off the island at     */
    /* z +6: they hold once, crack, and are gone until you die. They run OUTSIDE the      */
    /* rams' footprint and rejoin span 2 at its far end, so the trade is explicit —       */
    /* skip two rams, but you get exactly one attempt at the line per life.               */
    /* ============================================================================ */

    { kind: 'conveyor', p: [180.0, 32.05, 0], s: [8.0, 0.7, 4.2], dir: [1, 0, 0], power: 5.0, mat: 'conveyor' }, // span 1, gap 2.0 at +1.4, top 32.4
    { kind: 'crusher', p: [179.2, 37.65, 0], s: [2.6, 1.3, 4.4], axis: [0, -1, 0], travel: 4.6, period: 3.4, phase: 0.00, dwell: 0.9 },
    { kind: 'crusher', p: [182.6, 37.65, 0], s: [2.6, 1.3, 4.4], axis: [0, -1, 0], travel: 4.6, period: 2.7, phase: 0.42, dwell: 0.7 },

    { kind: 'platform', p: [187.6, 32.0, 0], s: [4.0, 1, 5.0], mat: 'stone', glow: EDGE, stripe: true }, // CP5 island, gap 1.6 at +1.6, top 32.5

    { kind: 'vanish', p: [190.6, 32.7, 5.8], s: [3.0, 1, 3.0], mat: 'grate', mode: 'crumble', cycle: { on: 2.0, off: 1.4, warn: 0.5, phase: 0 } }, // orb line, gap 1.8 at +0.7
    { kind: 'vanish', p: [195.2, 33.5, 6.2], s: [3.0, 1, 3.0], mat: 'grate', mode: 'crumble', cycle: { on: 2.0, off: 1.4, warn: 0.5, phase: 0 } }, // gap 1.6 at +0.8, rejoins span 2 (2.6 m)

    { kind: 'conveyor', p: [195.6, 35.15, 0], s: [8.0, 0.7, 4.2], dir: [-1, 0, 0], power: 4.0, mat: 'conveyor' }, // span 2, against you, gap 2.0 at +1.5, top 35.5
    { kind: 'crusher', p: [194.4, 40.75, 0], s: [2.6, 1.3, 4.4], axis: [0, -1, 0], travel: 4.6, period: 2.2, phase: 0.20, dwell: 0.5 },
    { kind: 'crusher', p: [197.8, 40.75, 0], s: [2.6, 1.3, 4.4], axis: [0, -1, 0], travel: 4.6, period: 3.0, phase: 0.63, dwell: 0.8 },

    { kind: 'platform', p: [203.6, 36.7, 0], s: [4.4, 1, 5.2], mat: 'metal', glow: EDGE, stripe: true }, // pad deck, gap 1.8 at +1.7, top 37.2
    { kind: 'jumppad', p: [203.6, 37.27, 0], s: [2.6, 0.14, 3.2], power: 6.2, dir: [0, 1, 0] },
    { kind: 'platform', p: [212.0, 41.5, 0], s: [8.8, 1, 5.6], mat: 'metal', glow: EDGE, stripe: true }, // catch deck 207.6..216.4, top 42.0

    { kind: 'text', p: [176.0, 35.4, -2.8], rot: [0, -Math.PI / 2, 0], text: 'THE SPOUT FEEDS THE RAMS', size: 0.46, color: HOT },
    { kind: 'text', p: [191.0, 38.2, -2.6], rot: [0, -Math.PI / 2, 0], text: 'this half runs the wrong way', size: 0.24, color: 0xa8785c },
    { kind: 'text', p: [201.0, 40.6, -2.6], rot: [0, -Math.PI / 2, 0], text: 'THE POUR IS UNDER YOU', size: 0.44, color: EMBER },
    { kind: 'deco', kindOf: 'crucible', p: [190.0, 52.0, 0], s: [16.0, 14.0, 16.0], scale: 6.5, mat: 'obsidian', tint: GLOW },
    { kind: 'deco', kindOf: 'spout', p: [190.0, 43.6, 0], s: [4.0, 3.4, 4.0], scale: 3.0, mat: 'obsidian', tint: HOT },
    { kind: 'deco', kindOf: 'launder', p: [186.0, 30.0, 7.4], s: [18.0, 0.9, 1.6], scale: 1.6, count: 4, spread: 7.0, seed: 9901, mat: 'obsidian', tint: GLOW },
    { kind: 'deco', kindOf: 'rail', p: [180.0, 33.4, 2.1], s: [8.0, 0.09, 0.09], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'rail', p: [195.6, 36.5, -2.1], s: [8.0, 0.09, 0.09], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'girders', p: [187.6, 38.6, 0], scale: 2.2, count: 6, spread: 8.0, seed: 9902, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'shaftwall', p: [190.0, 33.0, 10.4], s: [22.0, 14.0, 0.8], scale: 3.0, count: 4, spread: 11.0, seed: 9903, mat: 'obsidian', tint: 0x241713 },
    { kind: 'deco', kindOf: 'shaftwall', p: [190.0, 33.0, -10.4], s: [22.0, 14.0, 0.8], scale: 3.0, count: 4, spread: 11.0, seed: 9904, mat: 'obsidian', tint: 0x241713 },
    { kind: 'deco', kindOf: 'beacon', p: [195.2, 36.8, 7.6], s: [0.7, 2.4, 0.7], scale: 1.3, mat: 'emissive', tint: EDGE },
    { kind: 'deco', kindOf: 'chain', p: [186.0, 44.0, 6.2], s: [0.3, 9.0, 0.3], scale: 3.0, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'chain', p: [194.0, 44.0, -6.2], s: [0.3, 9.0, 0.3], scale: 3.0, mat: 'metal', tint: SOOT },
    { kind: 'light', p: [195.2, 36.4, 6.2], color: EDGE, intensity: 5, distance: 12 },
    { kind: 'light', p: [187.6, 36.0, 0], color: HOT, intensity: 13, distance: 26, flicker: 0.12 },
    { kind: 'light', p: [212.0, 45.0, 0], color: EMBER, intensity: 10, distance: 22 },

    /* ============================================================================ */
    /* BEAT 10 — THE RIM                                                            */
    /* A skip hoist, two rungs and the crucible's rim. The hoist lifts 1.6 m when you  */
    /* stand on it and holds for 1.6 s — it is a RIDE, never the route: the rung above */
    /* it is 2.82 m out at +1.6 from the hoist's parked height, inside the run budget,  */
    /* so the ladder is legal with the machine switched off. The last three rises ramp  */
    /* 1.5 -> 1.6 -> 1.8, the only place on the stage where the ladder gets steeper     */
    /* as it ends, and the front reaches this deck at t = 215.3.                        */
    /* ============================================================================ */

    {
      kind: 'mover',
      p: [219.4, 43.0, 2.6],
      s: [3.4, 1, 3.4],
      mat: 'metal',
      motion: { type: 'elevator', travel: 1.6, speed: 1.5, hold: 1.6 },
    }, // skip hoist, gap 1.3 at +1.5, parked top 43.5

    { kind: 'platform', p: [225.3, 44.6, -2.2], s: [3.4, 1, 3.6], mat: 'panel', glow: EDGE, stripe: true }, // diagonal 2.82 at +1.6, top 45.1
    { kind: 'platform', p: [231.6, 46.4, 0], s: [7.0, 1, 8.0], mat: 'obsidian', glow: VIOLET, stripe: true }, // finish deck, gap 1.1 at +1.8, top 46.9

    { kind: 'deco', kindOf: 'ladle', p: [219.4, 47.4, 2.6], s: [3.0, 3.0, 3.0], scale: 2.4, mat: 'metal', tint: GLOW },
    { kind: 'deco', kindOf: 'chain', p: [219.4, 51.0, 2.6], s: [0.3, 8.0, 0.3], scale: 2.8, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'crucible', p: [228.0, 56.0, 0], s: [14.0, 12.0, 14.0], scale: 5.5, mat: 'obsidian', tint: 0x30160c },
    { kind: 'deco', kindOf: 'girders', p: [225.3, 47.6, 0], scale: 1.9, count: 5, spread: 6.0, seed: 9911, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'arch', p: [231.6, 52.6, 0], s: [1.4, 1.1, 10.0], scale: 2.4, mat: 'obsidian', tint: VIOLET },
    { kind: 'deco', kindOf: 'pillar', p: [231.6, 50.0, 4.8], s: [1.3, 6.2, 1.3], scale: 1.8, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [231.6, 50.0, -4.8], s: [1.3, 6.2, 1.3], scale: 1.8, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'beacon', p: [235.0, 49.2, 0], s: [0.7, 3.0, 0.7], scale: 1.5, mat: 'emissive', tint: VIOLET },
    { kind: 'deco', kindOf: 'emblem', p: [231.6, 55.0, 0], s: [0.3, 2.6, 2.6], rot: [0, Math.PI / 2, 0], scale: 1.6, mat: 'emissive', tint: VIOLET },
    { kind: 'text', p: [228.6, 49.2, 0], rot: [0, -Math.PI / 2, 0], text: 'CRUCIBLE', size: 0.44, color: VIOLET },
    { kind: 'light', p: [231.6, 50.8, 0], color: VIOLET, intensity: 22, distance: 34 },

    /* ============================================================================ */
    /* THE FOUNDRY — everything beside and behind the course.                       */
    /* All of it sits at |z| >= 9, above head height, or below y = 0: nowhere a       */
    /* player could read it as a landing. The shaft wall is real geometry now — the   */
    /* `shaftwall` plates above are placed per beat and climb with the course — and    */
    /* the far structure below is what the shaft is cut through.                       */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'monolith', p: [60, -6, 22], s: [10, 30, 10], scale: 3.4, count: 7, spread: 130, seed: 3311, mat: 'obsidian', tint: 0x1a1210 },
    { kind: 'deco', kindOf: 'monolith', p: [60, -8, -22], s: [10, 30, 10], scale: 3.4, count: 7, spread: 130, seed: 4422, mat: 'obsidian', tint: 0x1a1210 },
    { kind: 'deco', kindOf: 'monolith', p: [186, 6, 26], s: [12, 52, 12], scale: 4.0, count: 6, spread: 110, seed: 5533, mat: 'obsidian', tint: 0x201512 },
    { kind: 'deco', kindOf: 'monolith', p: [186, 4, -26], s: [12, 52, 12], scale: 4.0, count: 6, spread: 110, seed: 6644, mat: 'obsidian', tint: 0x201512 },

    { kind: 'deco', kindOf: 'pillar', p: [150, 18, 14.5], s: [2.2, 62, 2.2], scale: 3.0, count: 9, spread: 170, seed: 7755, mat: 'obsidian', tint: SOOT },
    { kind: 'deco', kindOf: 'pillar', p: [150, 18, -14.5], s: [2.2, 62, 2.2], scale: 3.0, count: 9, spread: 170, seed: 8866, mat: 'obsidian', tint: SOOT },
    { kind: 'deco', kindOf: 'pipes', p: [150, 30, 12.6], scale: 3.0, count: 10, spread: 80, seed: 7756, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'pipes', p: [150, 36, -12.6], scale: 3.0, count: 10, spread: 80, seed: 8867, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'cable', p: [150, 48, 0], s: [180, 0.10, 0.10], scale: 1.2, mat: 'metal', tint: 0x120b08 },

    { kind: 'deco', kindOf: 'brazier', p: [122, 27.0, -9.4], s: [1.1, 1.5, 1.1], mat: 'metal', tint: GLOW },
    { kind: 'deco', kindOf: 'brazier', p: [176, 33.0, 9.4], s: [1.1, 1.5, 1.1], mat: 'metal', tint: GLOW },
    { kind: 'deco', kindOf: 'shard', p: [110, -12, 0], s: [3, 6, 3], scale: 2.0, count: 16, spread: 200, seed: 9977, mat: 'obsidian', tint: 0x2a1008 },

    // Path lights, one per beat, so the route reads as a rising line from the floor.
    { kind: 'light', p: [39.6, 9.0, 0], color: EMBER, intensity: 7, distance: 22 },
    { kind: 'light', p: [62.8, 9.0, 0], color: HOT, intensity: 8, distance: 22 },
    { kind: 'light', p: [112.3, 22.4, 2.6], color: EMBER, intensity: 8, distance: 22 },
    { kind: 'light', p: [150.5, 28.0, 0], color: EMBER, intensity: 8, distance: 22 },
    { kind: 'light', p: [171.5, 34.2, 0], color: EMBER, intensity: 8, distance: 22 },
    { kind: 'light', p: [225.3, 48.4, 0], color: EMBER, intensity: 8, distance: 22 },
  ],
};
