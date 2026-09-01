/**
 * ASCENDANT — LAVA FOUNDRY 3 : "CRUCIBLE"
 * runtime/data/stages/foundry-3.js
 *
 * Three acts, three different SHAPES of space.
 *   ACT 1  THE TAP FLOOR   x -6..67, y 6.  A flat hall. No clock, no pour. Belts,
 *          stamping heads and one sunk saw, each taught alone.
 *   ACT 2  THE SHAFT       x 68..202, y 6 -> 31.  A helix. The required route swings
 *          out to z +7.8, back across to z -10.3 and out again to z +14.5 (the
 *          optional launder spur reaches z -14.1), and then RUNS BACKWARD 10.6 m in
 *          x while climbing, so you finish the act standing seven metres above the
 *          slag beds you crossed thirty seconds earlier, looking down at them. One
 *          rising front is in the shaft with you.
 *   ACT 3  THE CRUCIBLE RIM x 205..250, y 32 -> 50.  A RING. You lap the crucible
 *          on its outer rim through +Z, lap it again on the inner rim through -Z
 *          five metres higher, then cross the open mouth on a catwalk that passes
 *          directly over both laps. The crucible itself stands in the middle of the
 *          ring at z 0 — inside the play space, not behind a fence.
 *
 * SHAPE  245.2 m of travel, 70 gameplay objects, 51 landable decks (56 landing
 *        rectangles once both ends of the charging car and the four crusher heads
 *        are counted), 8 checkpoints, 30 hazards from 14 families, 4 orbs.
 *
 * WIDTH  The furthest edge of a landable surface here is at |z| 16.1. The same
 *        measurement is 11.0 on foundry-1, 11.2 on foundry-2, 9.5 on neon-1 and
 *        10.7 on neon-2. This is the widest stage in the world, and the width is
 *        used three separate times: the launder spur at z -14.1, the back-leg at
 *        z +14.5, and the rim balcony at z +16.1.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RHYTHM — the numbers, because "it varies" is not a claim, it is a measurement.
 * ─────────────────────────────────────────────────────────────────────────────
 * The required path is 45 hops (BFS over the reach graph, spawn -> cp0 -> ... ->
 * finish). Its rises, in order:
 *   0.00  0.40  0.50 -0.50  0.00 -0.40  0.00  0.14  1.26  1.50  1.10  1.90  0.70
 *   0.70 -0.40  0.00  1.50  0.40  0.00  1.40  2.00  0.50  1.60  1.50  1.50  2.00
 *   1.50  1.50  1.54  1.36  1.40  1.30  0.60  1.90  1.00  1.50  1.20  0.80  1.70
 *   1.10  1.40  0.90  1.60  0.80  1.60
 * Eight of the 45 are flats or drops. The 37 climbing rises spread 0.14 .. 2.00,
 * and the two 2.00s sit nine hundredths under the ceiling that
 * APEX = jumpV^2 / (2 * gravRise) = 2.089 m puts on any jump at all.
 *
 * Its gaps, edge to edge, sorted:
 *   0.00 · 0.80 · 0.90 · 1.00 · 1.00 · 1.00 · 1.03 · 1.22 · 1.30 · 1.30 · 1.30
 *   1.40 · 1.80 · 1.80 · 1.90 · 2.01 · 2.02 · 2.04 · 2.10 · 2.10 · 2.15 · 2.30
 *   2.30 · 2.30 · 2.40 · 2.40 · 2.40 · 2.50 · 2.50 · 2.50 · 2.60 · 2.60 · 2.69
 *   2.79 · 2.87 · 2.90 · 3.00 · 3.11 · 3.20 · 3.30 · 3.40 · 3.40 · 3.90 · 4.00
 *   5.50
 * Six gaps are over 3.2 m; two are 3.9 m and 4.0 m; one is the 5.5 m sprint gap,
 * which is past the 5.24 m absolute run jump. On top of those, the two pad hops
 * fly 5.3-12.3 m of real horizontal distance each. The envelope is tested in five
 * separate places, at five different speeds.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PADS — both are DISTANCE tools, and both landings are visible on take-off.
 * ─────────────────────────────────────────────────────────────────────────────
 * A pad you cannot see over is a pad you cannot read, so neither pad throws you at
 * a deck above your eyeline. Eye height is 1.62 m (TUNE.eye):
 *
 *   pad        stands on  lands on  rise  deck vs EYE at take-off
 *   x  64.8     6.14       7.40     1.26  0.36 m BELOW the eye
 *   x 190.8    29.84      31.20     1.36  0.26 m BELOW the eye
 *
 * You look slightly DOWN at both landing decks before you touch either pad, and the
 * deck stays in frame the whole flight.
 *
 * AND BOTH LANDING DECKS SPAN THE WHOLE SCATTER. A bounce arc is FIXED — the pad
 * writes vel.y only, so the arc's length is entirely the speed you carried onto it,
 * and both halves integrate at gravFall (controller.js `_bounceRise`). Holding jump
 * on the contact frame multiplies the apex by 1.25. The pad fires on first contact,
 * one player radius short of its trailing edge:
 *
 *   pad       apex  launch x  walk-on lands  held sprint lands  deck spans
 *   x  64.8   6.0     63.15      68.49            75.45         68.4 .. 76.4
 *   x 190.8   6.0    189.15     194.47           201.40        194.4 ..201.6
 *
 * Every entry speed from a 6 m/s stroll to a held 12.2 m/s sprint lands on deck,
 * with nothing lethal inside either window. Both decks are also a plain 1.9 m and
 * 2.3 m hop from the platform the pad stands on, so neither pad is load-bearing:
 * they are the fast line down a long gallery, not the only way onto it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE POUR — one rising front, and why dying at it is always a LOSS
 * ─────────────────────────────────────────────────────────────────────────────
 * risinglava surface y = from + clamp((t - delay) * speed, 0, to - from)
 * (hazards/lava.js:421). Here: from 4.0, to 23.5, speed 0.16, delay 55, footprint
 * x 68..200 — the shaft and nothing else. It tops out at t = 176.9 at the launder
 * line, y 23.5. Every deck above 23.5 — bl4 at 25.3 and everything after it — is a
 * deck the pour can NEVER reach. There is no state in this stage where a player
 * stands on solid floor with the front above them and no route out.
 *
 * resetFrom (stage.js:2892) rewinds the clock to the checkpoint's clockOffset, so a
 * respawn hands back a fixed front height. Every offset here is set ABOVE the
 * clean-run arrival at that checkpoint, which is what makes suicide a strictly
 * losing move: a player who is on pace and jumps in gets a HIGHER front, not a
 * lower one.
 *
 *   cp  x       deck y  hops  clockOffset  front  head-room  s. to eat  leg est.
 *   0    40.4     6.40    5       26       4.00   (unarmed)   n/a       ~13 s
 *   1    63.7     6.00    3       46       4.00   (unarmed)*  n/a       ~10 s
 *   2    97.0    12.60    5       70       6.40    6.20 m     38.8 s    ~15 s
 *   3   148.2    14.80    5       84       8.64    6.16 m     38.5 s    ~16 s
 *   4   176.6    18.70    4      100      11.20    7.50 m     46.9 s    ~13 s
 *   5   184.2    28.30    6      120      14.40   above cap   never     ~16 s
 *   6   207.2    32.60    3      140      17.60   above cap   never     ~11 s
 *   7   239.5    40.10    6      160      20.80   above cap   never     ~15 s
 *   fin 246.2    50.00    8        —         —    above cap   never     ~18 s
 *
 *   * cp0 and cp1 sit at x 40.4 and x 63.7, outside the front's x 68..200
 *     footprint, so those two decks never flood at all. Their offsets exist only so
 *     that dying in Act 1 cannot hand back a fresh pour schedule.
 *
 * Head-room is 2.4x to 3.6x the leg it has to pay for. That is a deadline, not a
 * knife: it takes a player who stops and it does not take one who is merely
 * careful. Estimated clean arrivals are ~13 / ~23 / ~38 / ~54 / ~67 / ~83 / ~94 /
 * ~109 s, every one of them 13-51 s under its own offset — so at every checkpoint
 * on the stage, for a player who is anywhere near pace, dying moves the front UP.
 *
 * The longest leg is 8 hops (cp7 -> finish, the diameter catwalk); no leg is longer
 * than ~18 s of clean traverse, which is what the eight checkpoints are for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TEACHES -> TWISTS -> COMBINES
 *   BEAT 2   conveyors alone: one with you at 6.5, one against you at 4.8
 *   BEAT 3   crushers alone: three heads WIDER than the catwalk, so there is no
 *            sidestep and no bail-out bay — the slots between the heads are the
 *            only floor there is — then a saw sunk into the exit gap
 *   BEAT 5   a pad that decides where along an 8 m gallery you land, then the
 *            stage's only vanish passage, spiralled into a helix
 *   BEAT 6   the launder beam under a crosswind: width, not timing
 *   BEAT 7   COMBINE — a charging car (mover) that carries you UNDER a stamping
 *            head. Belt verb plus crusher verb, on a floor that is going somewhere.
 *   BEAT 8   the quench plate: ice, two slag reefs that leave a 2.8 m lane so the
 *            answer is steering and not braking, then THE SPRINT GAP
 *   BEAT 9   slag beds that ARM instead of vanishing — each bed narrower than its
 *            plate, so the answer is a step sideways, not a wait
 *   BEAT 10  the sweeper bar, then the BACK-LEG: 10.6 m travelled the WRONG way
 *            down the x axis while climbing 6.6 m out of the pour
 *   BEAT 12  SET-PIECE: THE CRUCIBLE RIM — a ring, lapped twice at two radii and
 *            then crossed on its own diameter, with tap-hole lasers cutting chords
 *            of the mouth and stopper rods swinging over the catwalk. cp7 sits at
 *            the halfway mark so a death among the rods replays the diameter and
 *            not the whole circle. Laser and pendulum appear nowhere else in this
 *            stage, and the ring is the only place in the world where the floor
 *            plan is a circle instead of a lane.
 *
 * CONVENTIONS (full list in runtime/data/index.js):
 *   p = CENTRE, s = FULL size. A top surface is p[1] + s[1]/2; a platform spans x
 *   from p[0]-s[0]/2 to p[0]+s[0]/2. Every gap quoted is EDGE TO EDGE.
 *   PHASE UNITS DIFFER AND THE ENGINE IS THE AUTHORITY:
 *     vanish + rotor + crusher `phase` = FRACTION of one cycle (0..1).
 *     spikes + laser `phase` = SECONDS, added straight to t (lasers.js:616).
 *     pendulum `amp`/`phase` = RADIANS; `ampDeg` is the degrees convenience
 *     (pendulum.js:295).
 *   A `saw` occupies its ENTIRE disc at every instant (rotors.js:298, :700-703), so
 *   its `period` is tempo and never a timing window. The one saw here is a spatial
 *   problem: a disc in a gap you must clear.
 *
 * DECO IS IN THE ROOM, NOT BEHIND A FENCE. The crucible stands at z 0 in the middle
 * of the Act 3 ring and you lap it twice, then walk over it. The stopper-rod hoists
 * hang over the catwalk at z 0. The quench tank, the ladle, the slag pots, the tap
 * hole, the braziers, the rails and the chains all sit at |z| 1..8, beside or under
 * decks you stand on. What is kept clear of the play space is only what could be
 * MISREAD as floor: the shaft walls at |z| 11.6+, the structural pillars at |z| 18.5
 * and the monoliths at |z| 26+.
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
// nothing else on the stage may wear it. Orb markers use EDGE, path lights use EMBER.

export default {
  id: 'foundry-3',
  world: 'foundry',
  name: 'CRUCIBLE',
  subtitle: 'The pour has started and the only way out is up',
  par: 175000,
  difficulty: 8,

  spawn: { p: [-2.5, 6.1, 0], yaw: 0 },
  killY: -25,

  checkpoints: [
    // Tap floor, past both belts. The offset exists so that a death in Act 1 cannot
    // hand back a fresh pour schedule — see THE POUR above.
    { p: [40.4, 6.5, 0], yaw: 0, clockOffset: 26 },
    // The shaft mouth, x 63.7 — outside the front's x 68..200 footprint.
    { p: [63.7, 6.1, 0], yaw: 0, clockOffset: 46 },
    // Top of the vanish helix. Front at 6.40, 6.20 m under the deck.
    { p: [97.0, 12.7, -4.4], yaw: 0, clockOffset: 70 },
    // The catch gantry, across the sprint gap. Front at 8.64.
    { p: [148.2, 14.5, -6.0], yaw: 0, clockOffset: 84 },
    // Under the sweeper bar, at the foot of the back-leg. Front at 11.20.
    { p: [176.6, 18.4, 5.4], yaw: 0, clockOffset: 100 },
    // Out of the shaft: 28.3 is 4.8 m above the front's 23.5 ceiling, forever.
    { p: [184.2, 28.0, 0], yaw: 0, clockOffset: 120 },
    // The rim approach, before the ring.
    { p: [207.2, 32.3, 0.6], yaw: 0, clockOffset: 140 },
    // End of lap 1, at the far rim. Halves the ring so a death among the stopper
    // rods replays the diameter, not the whole circle.
    { p: [239.5, 40.3, 0.8], yaw: 0, clockOffset: 160 },
  ],

  finish: { p: [246.2, 50.1, 0], yaw: 0 },

  // Four orbs, four different ideas, four OUT-AND-BACK detours. Every one hangs off
  // a dead end with a legal return jump, and no required route passes through any
  // of them: the finish is reachable having collected zero.
  coins: [
    { p: [19.6, 7.0, 9.0] },     // ORB 1 — a spur belt that runs out over the melt
    { p: [65.4, 5.4, 8.5] },     // ORB 2 — below the deck plane, level with the saw
    { p: [100.0, 13.6, -12.6] }, // ORB 3 — the far launder spur, z -14, widest point
    { p: [225.1, 35.9, 15.2] },  // ORB 4 — a rim balcony hung outside the ring
  ],

  objects: [
    /* ============================================================================ */
    /* BEAT 1 — THE TAP FLOOR                                                       */
    /* A wide charging deck six metres over a standing melt. Nothing on it moves:    */
    /* the stage spends its first ten seconds proving that orange-and-self-lit means */
    /* dead and cold steel with a cyan lip means safe. The tap hole, the launder      */
    /* channel and the braziers all sit INSIDE the hall at |z| <= 6, because this is  */
    /* the one place with room to walk around foundry furniture and look at it.       */
    /* ============================================================================ */

    { kind: 'platform', p: [1, 5.5, 0], s: [13, 1, 12], mat: 'metal', glow: SOOT },     // top 6.00

    // The standing melt under the whole tap floor. Static: this one never rises. Top
    // sits at y 0.5, so the deck reads as a gantry and not as ground.
    { kind: 'lava', p: [28, -1.0, 0], s: [80, 3, 30] },

    { kind: 'text', p: [-5.8, 8.7, 0], rot: [0, -Math.PI / 2, 0], text: 'CRUCIBLE', size: 0.82, color: EMBER },
    { kind: 'text', p: [-5.8, 8.05, 0], rot: [0, -Math.PI / 2, 0], text: 'LAVA FOUNDRY  ·  III', size: 0.28, color: 0xa8785c },
    { kind: 'text', p: [-5.8, 7.5, 0], rot: [0, -Math.PI / 2, 0], text: 'the pour is scheduled  ·  you are not', size: 0.24, color: HOT },

    { kind: 'deco', kindOf: 'taphole', p: [4.4, 5.9, -4.2], s: [2.2, 0.5, 2.2], scale: 1.5, mat: 'obsidian', tint: HOT },
    { kind: 'deco', kindOf: 'launder', p: [3.0, 4.6, 5.2], s: [11.0, 0.9, 1.6], scale: 1.1, count: 4, spread: 4.4, seed: 2201, mat: 'obsidian', tint: GLOW },
    { kind: 'deco', kindOf: 'girders', p: [1.0, 10.8, 0], scale: 1.6, count: 5, spread: 5.2, seed: 2202, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'arch', p: [7.6, 11.4, 0], s: [1.2, 1.0, 16.0], scale: 2.2, mat: 'obsidian', tint: EMBER },
    { kind: 'deco', kindOf: 'brazier', p: [-3.4, 6.9, 4.4], s: [1.0, 1.4, 1.0], mat: 'metal', tint: GLOW },
    { kind: 'deco', kindOf: 'brazier', p: [-3.4, 6.9, -4.4], s: [1.0, 1.4, 1.0], mat: 'metal', tint: GLOW },
    { kind: 'light', p: [-3.4, 8.0, 4.4], color: GLOW, intensity: 7, distance: 15, flicker: 0.34 },
    { kind: 'light', p: [-3.4, 8.0, -4.4], color: GLOW, intensity: 7, distance: 15, flicker: 0.34 },
    { kind: 'light', p: [1, 9.6, 0], color: 0xcfe2ff, intensity: 9, distance: 24 },

    /* ============================================================================ */
    /* BEAT 2 — THE TAP LINE  (conveyors, in isolation)                             */
    /* Belt one runs WITH you at 6.5 and turns a 1.3 m hop into a gift. Belt two runs */
    /* AGAINST you at 4.8 and turns a 2.3 m hop into a decision. Between them a step  */
    /* out to z +3.2 and a step back across to z -3.0, so the belts are never the     */
    /* only problem and the hall is used across its width, not down a lane.           */
    /*                                                                              */
    /* ORB 1 is a spur belt running OUTWARD, +Z, over the melt. Standing still on it  */
    /* feeds you off the end. It is a DEAD END: the nearest thing forward is the next */
    /* platform's corner at 8.16 m diagonal, past the 6.78 m sprint reach at that     */
    /* rise, so the only way off the spur is back the way you came, across the belt.  */
    /* Out and back, one orb, no shortcut.                                            */
    /* ============================================================================ */

    { kind: 'conveyor', p: [12.0, 5.65, 0], s: [6.4, 0.7, 4.4], dir: [1, 0, 0], power: 6.5, mat: 'conveyor' },   // top 6.00, gap 1.3

    { kind: 'platform', p: [19.6, 5.9, 3.2], s: [3.0, 1, 3.0], mat: 'panel', glow: EDGE, stripe: true },         // top 6.40, gap 2.9 at +0.4

    { kind: 'conveyor', p: [19.6, 5.55, 9.0], s: [3.0, 0.7, 4.6], dir: [0, 0, 1], power: 3.6, mat: 'conveyor' }, // ORB 1 spur, top 5.90, gap 2.0 at -0.5
    { kind: 'deco', kindOf: 'rail', p: [18.0, 6.7, 9.0], s: [0.07, 0.07, 4.6], mat: 'metal', tint: EDGE },
    { kind: 'deco', kindOf: 'lantern', p: [21.3, 7.0, 9.0], s: [0.7, 1.0, 0.7], mat: 'emissive', tint: EDGE },
    { kind: 'light', p: [19.6, 7.6, 9.0], color: EDGE, intensity: 5, distance: 12 },

    { kind: 'platform', p: [24.4, 6.4, -3.0], s: [3.4, 1, 3.4], mat: 'grate', glow: EDGE, stripe: true },        // top 6.90, diagonal 3.4 at +0.5

    { kind: 'conveyor', p: [32.0, 6.05, 0], s: [7.0, 0.7, 4.6], dir: [-1, 0, 0], power: 4.8, mat: 'conveyor' },  // top 6.40, gap 2.4, and it shoves back

    { kind: 'platform', p: [40.4, 5.9, 0], s: [5.2, 1, 7.0], mat: 'panel', glow: IRON, stripe: true },           // CP0, top 6.40, gap 2.3 fighting the belt

    { kind: 'text', p: [9.6, 8.4, 3.6], rot: [0, -Math.PI / 2, 0], text: 'MIND THE BELTS', size: 0.42, color: EMBER },
    { kind: 'text', p: [28.4, 8.4, 3.6], rot: [0, -Math.PI / 2, 0], text: 'this one runs the wrong way', size: 0.24, color: 0xa8785c },
    { kind: 'deco', kindOf: 'ladle', p: [29.6, 8.2, -5.4], s: [2.4, 2.6, 2.4], scale: 2.0, mat: 'metal', tint: GLOW },
    { kind: 'deco', kindOf: 'chain', p: [29.6, 11.6, -5.4], s: [0.3, 4.4, 0.3], scale: 2.0, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'lantern', p: [24.4, 8.6, -5.6], s: [0.7, 1.0, 0.7], mat: 'emissive', tint: GLOW },
    { kind: 'deco', kindOf: 'vent', p: [14.0, 3.4, -6.4], s: [2.0, 1.6, 2.0], scale: 1.4, mat: 'metal' },
    { kind: 'deco', kindOf: 'pipes', p: [20, 10.4, 9.6], scale: 2.4, count: 7, spread: 14.0, seed: 2211, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'pipes', p: [20, 11.2, -9.6], scale: 2.4, count: 7, spread: 14.0, seed: 2212, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'girders', p: [26.0, 9.4, 0], scale: 1.9, count: 4, spread: 8.0, seed: 2213, mat: 'metal', tint: SOOT },
    { kind: 'light', p: [20, 8.2, 0], color: GLOW, intensity: 8, distance: 26, flicker: 0.12 },
    { kind: 'light', p: [34.0, 8.4, -4.0], color: EMBER, intensity: 6, distance: 16 },

    /* ============================================================================ */
    /* BEAT 3 — THE CRUSHER CATWALK  (crushers, in isolation, then a saw)           */
    /* Thirteen metres of 3.6 m walkway with three stamping heads across it. THE     */
    /* HEADS ARE 4.4 m DEEP AGAINST A 3.6 m DECK: every head overhangs the walkway   */
    /* by 0.4 m on both shoulders, so there is no lateral escape anywhere on this    */
    /* beat and no bail-out bay beside it. The slots between the heads are the only  */
    /* floor there is: 1.4 m and 1.8 m of real standing room against a 0.7 m         */
    /* capsule. The three heads differ in width, in mass and in tempo (3.6 / 2.9 /   */
    /* 2.3 s) so the pattern never resolves into one straight run-through — you      */
    /* STEP, READ, STEP. Each head is flush with the deck at the bottom of its       */
    /* travel: p.y - s.y/2 - travel = 6.00 for all three.                            */
    /*                                                                              */
    /* The exit is a saw sunk into the gap with its HUB ON THE DECK LINE: the disc   */
    /* breaks the walkway plane by 1.2 m, so the 3.9 m gap cannot be walked or       */
    /* short-hopped. It must be jumped from the lip, and 3.9 m is 90% of the 4.35 m  */
    /* safe run-jump budget at a flat landing.                                       */
    /* ============================================================================ */

    { kind: 'platform', p: [50.5, 5.5, 0], s: [13, 1, 3.6], mat: 'grate', glow: EDGE, stripe: true },  // top 6.00, gap 1.0, x 44.0..57.0

    { kind: 'crusher', p: [46.6, 11.7, 0], s: [2.2, 1.4, 4.4], axis: [0, -1, 0], travel: 5.0, period: 3.6, phase: 0.00, dwell: 0.9 },
    { kind: 'crusher', p: [50.6, 11.9, 0], s: [3.0, 1.8, 4.4], axis: [0, -1, 0], travel: 5.0, period: 2.9, phase: 0.34, dwell: 0.7 },
    { kind: 'crusher', p: [54.8, 11.5, 0], s: [1.8, 1.0, 4.4], axis: [0, -1, 0], travel: 5.0, period: 2.3, phase: 0.66, dwell: 0.55 },

    // ORB 2 — the only downward line in Act 1, and it hangs off the MOUTH deck, not
    // the catwalk: 3.2 m out and 1.4 m down on the far side of the saw, so it cannot
    // be used to bypass the 3.9 m gap. From the catwalk it is 8.56 m away against an
    // 8.43 m absolute sprint reach at that fall — out of range by 0.13 m. You pay the
    // saw first, then you pay 3.2 m down and 3.2 m back up for the orb.
    { kind: 'platform', p: [65.4, 4.1, 8.5], s: [3.2, 1, 3.0], mat: 'grate', glow: EDGE, stripe: true },  // top 4.60
    { kind: 'deco', kindOf: 'cage', p: [65.4, 5.6, 10.1], s: [1.6, 2.0, 0.4], scale: 1.3, mat: 'metal', tint: IRON },
    { kind: 'light', p: [65.4, 6.2, 8.5], color: EDGE, intensity: 5, distance: 12 },

    // Hub ON the deck line (6.0) with a 1.2 m blade: the disc spans y 4.63..7.37 and
    // x 57.75..60.15, inside a 3.9 m gap. period is tempo only — see the header.
    { kind: 'rotor', p: [58.95, 6.0, 0], style: 'saw', arms: 1, len: 1.2, thick: 0.34, period: 1.6, phase: 0, axis: [0, 0, 1] },

    { kind: 'platform', p: [63.7, 5.5, 0], s: [5.6, 1, 7.6], mat: 'stone', glow: EDGE, stripe: true },  // CP1 shaft mouth, top 6.00, gap 3.9 over the blade

    { kind: 'text', p: [43.4, 9.0, 0], rot: [0, -Math.PI / 2, 0], text: 'THREE HEADS  ·  THREE CLOCKS', size: 0.40, color: HOT },
    { kind: 'text', p: [43.4, 8.4, 0], rot: [0, -Math.PI / 2, 0], text: 'the slots are the only floor', size: 0.22, color: 0xa8785c },
    { kind: 'text', p: [56.2, 8.2, 2.4], rot: [0, -Math.PI / 2, 0], text: 'THE BLADE IS IN THE GAP', size: 0.44, color: HOT },
    { kind: 'deco', kindOf: 'buttress', p: [46.6, 13.8, 3.2], s: [1.6, 2.6, 1.6], scale: 1.5, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [50.6, 14.0, -3.2], s: [1.6, 2.6, 1.6], scale: 1.5, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [54.8, 13.6, 3.2], s: [1.6, 2.6, 1.6], scale: 1.5, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'girders', p: [50.5, 14.6, 0], scale: 2.1, count: 6, spread: 6.0, seed: 3301, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'grate', p: [58.95, 4.4, 0], s: [4.4, 0.16, 3.0], scale: 1.2, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'fins', p: [58.95, 3.0, -5.0], scale: 1.4, count: 5, spread: 2.6, seed: 3302, mat: 'metal', tint: SOOT },
    { kind: 'light', p: [50.5, 9.4, 0], color: EMBER, intensity: 10, distance: 24 },
    { kind: 'light', p: [58.95, 7.4, 0], color: HOT, intensity: 8, distance: 14, flicker: 0.2 },

    /* ============================================================================ */
    /* BEAT 4 — THE POUR  (the spine of Act 2)                                      */
    /* ONE rising front, x 68..200, z -20..20. It sits at y 4.0 until t = 55, climbs  */
    /* at 0.16 m/s and STOPS at y 23.5 — the launder line — at t = 176.9. It reaches  */
    /* the first gallery (7.40) at t = 76.3, CP2 (12.60) at 108.8, the quench plate    */
    /* (14.40) at 120.0 and CP4 (18.70) at 146.9. Above 23.5 it cannot go: the shaft   */
    /* drains sideways into the launder there, and bl4 at 25.3 is the first deck that  */
    /* is permanently out of its reach.                                                */
    /*                                                                              */
    /* The front closes on you the whole way up the shaft, and every checkpoint hands  */
    /* back 6.2-7.5 m of head-room against legs that cost 16-22 s. Stop for forty      */
    /* seconds anywhere under 23.5 and it takes you; keep taking rungs and it never    */
    /* gets closer than it was at the last checkpoint.                                 */
    /* ============================================================================ */

    { kind: 'risinglava', p: [134, 2.0, 0], s: [132, 4, 40], rising: { from: 4.0, to: 23.5, speed: 0.16, delay: 55 } },

    { kind: 'text', p: [61.0, 9.4, 0], rot: [0, -Math.PI / 2, 0], text: 'POUR SHAFT', size: 0.66, color: HOT },
    { kind: 'text', p: [61.0, 8.7, 0], rot: [0, -Math.PI / 2, 0], text: 'it stops at the launder line  ·  be above it', size: 0.24, color: 0xa8785c },
    { kind: 'deco', kindOf: 'spout', p: [68.0, 10.4, 0], s: [3.0, 2.4, 3.0], scale: 2.6, mat: 'obsidian', tint: HOT },
    { kind: 'deco', kindOf: 'arch', p: [68.0, 13.0, 0], s: [1.4, 1.2, 20.0], scale: 2.4, mat: 'obsidian', tint: HOT },
    { kind: 'deco', kindOf: 'banner', p: [68.0, 15.6, 5.6], s: [0.1, 4.2, 2.2], scale: 1.6, mat: 'panel', tint: HOT },
    { kind: 'deco', kindOf: 'banner', p: [68.0, 15.6, -5.6], s: [0.1, 4.2, 2.2], scale: 1.6, mat: 'panel', tint: HOT },
    { kind: 'light', p: [68.0, 11.0, 0], color: HOT, intensity: 14, distance: 30, flicker: 0.16 },

    /* ============================================================================ */
    /* BEAT 5 — THE FIRST LEAP AND THE HELIX  (a pad, then the one vanish passage)  */
    /* The gallery is a 1.9 m hop off the mouth, and it is eight metres long. The pad */
    /* is not the way ON to it — it is the way DOWN it: hit the pad at a sprint with   */
    /* jump held and you land at x 75.45, at the far end, seven metres of gallery       */
    /* saved. Stroll on and you land at 68.49, at the near end, having saved nothing.   */
    /* Both are on deck (see THE PADS) and the deck top is 0.36 m BELOW your eye when   */
    /* you touch the pad, so you read the whole flight.                                 */
    /*                                                                              */
    /* Then the helix. Three vanish grates spiral the route out to z +7.8 and back      */
    /* across to z -3.0 while climbing 1.5 / 1.1 / 1.9 m, and all three tiles are       */
    /* different shapes: 2.4 x 2.8, 3.8 x 2.0, 2.0 x 3.2. The last is a 1.9 m rise      */
    /* onto a tile only 2.0 m wide across a 2.69 m gap — 91% of the run budget at that  */
    /* rise, and the only place in Act 2 that asks for precision instead of nerve.      */
    /* This is the stage's ONLY vanish passage: the verb is taught here, once.          */
    /* ============================================================================ */

    { kind: 'jumppad', p: [64.8, 6.07, -1.6], s: [2.6, 0.14, 3.4], power: 6.0, dir: [0, 1, 0] },  // top 6.14, sits on the mouth deck
    { kind: 'text', p: [62.2, 8.0, -2.8], rot: [0, -Math.PI / 2, 0], text: 'CARRY SPEED ONTO IT', size: 0.36, color: EMBER },

    // THE CATCH GALLERY spans the WHOLE bounce scatter. A bounce arc is fixed — the
    // pad adds nothing horizontal — so the only variable is the speed you carried on:
    // 5.34 m out at a walk, 12.30 m out at a held sprint (both halves of the arc run
    // at gravFall, controller.js `_bounceRise`). Launch is one player radius short of
    // the pad's trailing edge, at x 63.15, so the four natural landings fall between
    // x 68.49 and x 75.45 and the gallery runs 68.4..76.4. Every entry speed lands on
    // deck. The gallery is also a plain 1.9 m hop off the mouth: the pad is the fast
    // line down it, never the only way onto it.
    { kind: 'platform', p: [72.4, 6.9, 0], s: [8.0, 1, 5.6], mat: 'metal', glow: EDGE, stripe: true },   // catch gallery, top 7.40, x 68.4..76.4

    { kind: 'vanish', p: [79.8, 8.4, 6.4], s: [2.4, 1, 2.8], mat: 'grate', cycle: { on: 2.6, off: 1.5, warn: 0.6, phase: 0.00 } },  // top 8.90, diagonal 3.11 at +1.5
    { kind: 'vanish', p: [85.4, 9.5, 2.6], s: [3.8, 1, 2.0], mat: 'grate', cycle: { on: 2.2, off: 1.7, warn: 0.5, phase: 0.41 } },  // top 10.00, diagonal 2.87 at +1.1
    { kind: 'vanish', p: [90.6, 11.4, -1.4], s: [2.0, 1, 3.2], mat: 'grate', cycle: { on: 2.8, off: 1.3, warn: 0.7, phase: 0.73 } },// top 11.90, diagonal 2.69 at +1.9

    { kind: 'platform', p: [97.0, 12.1, -4.4], s: [5.8, 1, 6.8], mat: 'stone', glow: EDGE, stripe: true },  // CP2, top 12.60, gap 2.5 at +0.7

    { kind: 'deco', kindOf: 'ring', p: [72.4, 12.2, 0], s: [0.16, 9.0, 9.0], rot: [0, Math.PI / 2, 0], scale: 2.6, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'chain', p: [79.8, 12.6, 6.4], s: [0.3, 5.6, 0.3], scale: 2.0, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'chain', p: [90.6, 15.6, -1.4], s: [0.3, 5.6, 0.3], scale: 2.0, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'brazier', p: [97.0, 13.3, -1.2], s: [1.0, 1.4, 1.0], mat: 'metal', tint: GLOW },
    { kind: 'deco', kindOf: 'shaftwall', p: [80.0, 12.0, 12.4], s: [12.0, 9.0, 0.8], scale: 2.2, count: 4, spread: 7.0, seed: 5501, mat: 'obsidian', tint: 0x241713 },
    { kind: 'deco', kindOf: 'shaftwall', p: [80.0, 12.0, -12.4], s: [12.0, 9.0, 0.8], scale: 2.2, count: 4, spread: 7.0, seed: 5502, mat: 'obsidian', tint: 0x241713 },
    { kind: 'deco', kindOf: 'girders', p: [86.0, 15.8, 0], scale: 1.7, count: 5, spread: 6.4, seed: 5504, mat: 'metal', tint: SOOT },
    { kind: 'light', p: [72.4, 10.6, 0], color: EMBER, intensity: 8, distance: 22 },
    { kind: 'light', p: [88.0, 14.4, 1.0], color: EMBER, intensity: 8, distance: 22 },

    /* ============================================================================ */
    /* BEAT 6 — THE LAUNDER BEAM  (wind, in isolation)                              */
    /* Nine and a half metres of 1.8 m-wide channel at z -9.4, the far side of the    */
    /* shaft, with a crosswind blowing +Z across it — off the beam, toward the pour.  */
    /* No timing, no gap, no hazard on the beam itself: only width against a force    */
    /* that never stops. The wind is the one hazard in the stage you cannot wait out  */
    /* and cannot jump over.                                                          */
    /*                                                                              */
    /* ORB 3 hangs off the shaft's far wall at z -12.6, reachable from the checkpoint */
    /* deck (3.3 m) or from the head of the beam (1.36 m) and connected to NOTHING     */
    /* else: the charging car's nearest corner is 13.3 m away. It is a two-jump        */
    /* out-and-back that buys no progress, and the required route (cp2 straight to the */
    /* beam, 2.79 m) never touches it.                                                 */
    /* ============================================================================ */

    { kind: 'beam', p: [107.4, 13.0, -9.4], s: [9.6, 0.6, 1.8], mat: 'metal' },   // top 13.30, gap 2.79 at +0.7
    { kind: 'wind', p: [107.4, 15.4, -9.4], s: [10.0, 5.0, 8.0], dir: [0, 0, 1], power: 11, color: EDGE },

    { kind: 'platform', p: [100.0, 12.0, -12.6], s: [3.0, 1, 3.0], mat: 'grate', glow: EDGE, stripe: true },  // ORB 3 spur, top 12.50, 1.36 m off the beam / 3.30 m off cp2

    { kind: 'text', p: [102.0, 15.4, -12.0], rot: [0, -Math.PI / 2, 0], text: 'THE DRAUGHT DOES NOT STOP', size: 0.34, color: EDGE },
    { kind: 'deco', kindOf: 'rail', p: [107.4, 13.7, -8.4], s: [9.6, 0.08, 0.08], mat: 'metal', tint: EDGE },
    { kind: 'deco', kindOf: 'pipes', p: [107.4, 10.0, -11.4], scale: 2.0, count: 5, spread: 9.0, seed: 5505, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'lantern', p: [100.0, 13.6, -14.4], s: [0.7, 1.0, 0.7], mat: 'emissive', tint: EDGE },
    { kind: 'light', p: [100.0, 14.2, -12.6], color: EDGE, intensity: 5, distance: 12 },
    { kind: 'light', p: [107.4, 16.0, -9.4], color: EDGE, intensity: 7, distance: 18 },

    /* ============================================================================ */
    /* BEAT 7 — THE CHARGING CAR  (COMBINE: mover + crusher)                        */
    /* A skip on rails that shuttles 5.8 m diagonally across the shaft on a 5.4 s     */
    /* round trip, and a stamping head planted over the middle of its run. The belt   */
    /* verb from BEAT 2 (a floor that is going somewhere without asking you) and the  */
    /* crusher verb from BEAT 3 (a head that will not let you walk through) in the    */
    /* same three seconds — except this floor is 3.6 m square with nothing beside it. */
    /* The head is flush with the car's deck at the bottom of its travel:             */
    /* 18.5 - 0.6 - 5.0 = 12.90, exactly the car's top.                              */
    /*                                                                              */
    /* Both ends of the car's run are landable and 1.4 m apart, so a player who       */
    /* mistimes the head can ride the car back out and try again. It is a ferry, not  */
    /* a trap.                                                                        */
    /* ============================================================================ */

    {
      kind: 'mover',
      p: [116.6, 12.4, -9.0],
      s: [3.6, 1, 3.6],
      mat: 'metal',
      surface: 'normal',
      motion: { type: 'linear', to: [121.6, 12.4, -6.0], period: 5.4, phase: 0.0, ease: true, dwell: 0.8 },
    },  // top 12.90, gap 2.6 off the beam at -0.4

    { kind: 'crusher', p: [119.1, 18.5, -7.5], s: [2.6, 1.2, 3.4], axis: [0, -1, 0], travel: 5.0, period: 3.1, phase: 0.28, dwell: 0.6 },

    { kind: 'text', p: [114.0, 16.8, -4.0], rot: [0, -Math.PI / 2, 0], text: 'THE CAR GOES UNDER THE STAMP', size: 0.36, color: HOT },
    { kind: 'deco', kindOf: 'cable', p: [119.1, 22.6, -7.5], s: [0.10, 0.10, 12.0], scale: 1.2, mat: 'metal', tint: 0x120b08 },
    { kind: 'deco', kindOf: 'buttress', p: [119.1, 20.6, -4.2], s: [1.8, 2.8, 1.8], scale: 1.6, mat: 'obsidian' },
    { kind: 'light', p: [119.1, 15.4, -7.5], color: EMBER, intensity: 9, distance: 20 },

    /* ============================================================================ */
    /* BEAT 8 — THE QUENCH RUN  (ice + two slag reefs + THE SPRINT GAP)             */
    /* A quenched steel plate, 11.6 m of it, five metres deep and slick. This is the  */
    /* one place on the stage where a speed pad is not decoration: ground friction is */
    /* 13 on steel and a boost is gone in about 50 ms, but ICE runs friction 1.4, so  */
    /* the same boost survives about 0.3 s and roughly five metres.                   */
    /*                                                                              */
    /* THE REEFS ARE A STEERING PROBLEM, NOT A BRAKING ONE. Each slag reef is 2.2 m   */
    /* deep on a 5.0 m plate and they alternate sides, so there is a 2.8 m lane past  */
    /* every one of them against a 0.7 m capsule — you weave, and you never have to   */
    /* stop, which is the only honest thing to ask of a player on ice. Nothing on the */
    /* slick spans its full width; nothing on the slick has to be braked for.         */
    /*                                                                              */
    /* THE GAP is 5.5 m at +0.4: past the 5.24 m absolute run jump, 93% of the safe   */
    /* sprint budget, and legal without the pad — the pad is 2.4 m back from the lip  */
    /* so the boost is still on you when you leave, and it turns a committed sprint   */
    /* into a comfortable one. A moving surface is never the only way across.         */
    /* ============================================================================ */

    { kind: 'ice', p: [131.8, 13.9, -6.0], s: [11.6, 1, 5.0] },   // quench plate, top 14.40, gap 2.6 at +1.5

    { kind: 'spikes', p: [129.0, 14.8, -7.4], s: [2.2, 0.8, 2.2], dir: [0, 1, 0] },   // reef 1: z -8.5..-6.3, lane z -6.3..-3.5
    { kind: 'spikes', p: [133.0, 14.8, -4.6], s: [2.2, 0.8, 2.2], dir: [0, 1, 0] },   // reef 2: z -5.7..-3.5, lane z -8.5..-5.7

    { kind: 'speedpad', p: [134.0, 14.4, -6.0], s: [2.4, 0.14, 3.2], dir: [1, 0, 0], power: 6.5, glow: 0.4 },  // 2.4 m back from the lip.
    // glow 0.4 (round-3 readability): at full glow the pad's core+ring+shaft all
    // crossed the 0.85 bloom threshold and, seen from cp4 44.8 m away as "the
    // next walked top", the whole pad measured as one cream blob — (207,177,174)
    // vs (189,83,65) haze = 2.29:1 (contrastcheck foundry-3 c4). At 0.4 nothing
    // on it blooms: the top face median reads its dark disc, and up close (the
    // player boards it from 2.4 m) the cyan core still pulses visibly.

    { kind: 'platform', p: [148.2, 14.3, -6.0], s: [10.2, 1, 5.0], mat: 'metal', glow: EDGE, stripe: true },  // CP3 catch gantry, top 14.80, THE GAP 5.5 m

    { kind: 'text', p: [126.0, 18.0, -2.6], rot: [0, -Math.PI / 2, 0], text: 'QUENCH PLATE  ·  NO BRAKES', size: 0.52, color: EMBER },
    { kind: 'text', p: [126.0, 17.3, -2.6], rot: [0, -Math.PI / 2, 0], text: 'steer past the slag  ·  do not stop on it', size: 0.24, color: 0xa8785c },
    { kind: 'text', p: [141.0, 18.4, -2.8], rot: [0, -Math.PI / 2, 0], text: 'FIVE AND A HALF METRES', size: 0.40, color: HOT },
    { kind: 'deco', kindOf: 'quenchtank', p: [131.8, 11.6, -1.4], s: [8.0, 2.6, 3.0], scale: 2.4, mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'rail', p: [131.8, 15.1, -8.6], s: [11.6, 0.08, 0.08], mat: 'metal', tint: EDGE },
    { kind: 'deco', kindOf: 'pipes', p: [131.8, 18.6, -6.0], scale: 1.8, count: 6, spread: 6.0, seed: 7701, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'girders', p: [148.2, 11.4, -6.0], scale: 2.0, count: 5, spread: 5.2, seed: 7703, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'screen', p: [138.0, 19.0, -11.4], s: [0.4, 5.0, 8.0], scale: 2.2, mat: 'emissive', tint: 0xff6a1a },
    { kind: 'deco', kindOf: 'shaftwall', p: [136.0, 14.0, 11.6], s: [16.0, 12.0, 0.8], scale: 2.6, count: 4, spread: 9.0, seed: 7704, mat: 'obsidian', tint: 0x241713 },
    { kind: 'light', p: [131.8, 17.4, -6.0], color: EDGE, intensity: 8, distance: 20 },
    { kind: 'light', p: [148.2, 18.0, -6.0], color: EMBER, intensity: 8, distance: 20 },

    /* ============================================================================ */
    /* BEAT 9 — THE SLAG BEDS  (plates that ARM instead of plates that vanish)      */
    /* Off the gantry, a 4.0 m FLAT leap — the longest pure run jump on the stage at  */
    /* 92% of the safe budget — onto the first bed. Then 2.4 m at +1.4, then 1.0 m at */
    /* +2.0: the gap shrinks as the rise grows, so the three hops feel nothing alike. */
    /*                                                                              */
    /* Each bed is NARROWER THAN ITS PLATE and offset to one side, so waiting is      */
    /* never the answer: bed 1 covers z -3.2..-1.6 of a plate that runs z -4.4..-1.6  */
    /* (1.2 m of live floor beside it), bed 3 covers z 2.4..4.4 of a plate that runs  */
    /* z 0.8..4.4 (1.6 m beside it). You step around a bed the way you step around a  */
    /* reef; the middle plate carries nothing at all and is the beat's breath.        */
    /* Their phases are 0.0 and 0.9 SECONDS — spikes read cycle.phase in seconds      */
    /* (lasers.js:616), not as a fraction like a vanish tile.                         */
    /* ============================================================================ */

    { kind: 'platform', p: [158.6, 14.3, -3.0], s: [2.6, 1, 2.8], mat: 'grate', glow: EDGE, stripe: true },  // top 14.80, gap 4.0 FLAT
    { kind: 'spikes', p: [158.6, 15.1, -2.4], s: [2.4, 0.6, 1.6], dir: [0, 1, 0], mode: 'retract', cycle: { on: 1.2, off: 2.0, warn: 0.6, phase: 0.00 } },

    { kind: 'platform', p: [164.6, 15.7, -0.4], s: [4.6, 1, 2.4], mat: 'panel', glow: EDGE, stripe: true },  // top 16.20, gap 2.4 at +1.4 — no bed

    { kind: 'platform', p: [169.4, 17.7, 2.6], s: [3.0, 1, 3.6], mat: 'grate', glow: EDGE, stripe: true },   // top 18.20, gap 1.0 at +2.0
    { kind: 'spikes', p: [169.4, 18.5, 3.4], s: [2.0, 0.6, 2.0], dir: [0, 1, 0], mode: 'retract', cycle: { on: 1.8, off: 1.4, warn: 0.5, phase: 0.90 } },

    { kind: 'text', p: [155.0, 17.4, -6.4], rot: [0, -Math.PI / 2, 0], text: 'SLAG BEDS  ·  STEP AROUND THEM', size: 0.38, color: HOT },
    { kind: 'deco', kindOf: 'slagpot', p: [161.6, 14.4, 4.6], s: [2.6, 2.8, 2.6], scale: 2.2, mat: 'metal', tint: GLOW },
    { kind: 'deco', kindOf: 'slagpot', p: [166.4, 15.6, -4.4], s: [2.6, 2.8, 2.6], scale: 2.0, mat: 'metal', tint: GLOW },
    { kind: 'deco', kindOf: 'launder', p: [163.0, 12.4, -7.4], s: [12.0, 0.8, 1.4], scale: 1.4, count: 3, spread: 5.0, seed: 8804, mat: 'obsidian', tint: GLOW },
    { kind: 'light', p: [164.6, 19.4, 0], color: EMBER, intensity: 9, distance: 22 },

    /* ============================================================================ */
    /* BEAT 10 — THE SWEEPER AND THE BACK-LEG                                       */
    /* A two-armed bar on a 3.0 s revolution at shin height across a 6.4 m deck. It   */
    /* is SOLID, not lethal — it does not cut you, it puts you in the pour. Unlike a  */
    /* saw, a bar leaves the lane open half the time: this is the one rotor on the    */
    /* stage that is a timing input. Its underside sits at 18.88, 0.18 m clear of the */
    /* deck it sweeps.                                                                */
    /*                                                                              */
    /* THE BACK-LEG. From the sweeper deck the route turns out to z +12.1, then runs  */
    /* the WRONG WAY down the x axis — 182.2 -> 177.6 -> 172.6 -> 171.6 — climbing    */
    /* 1.6 / 1.5 / 1.5 / 2.0 as it goes, out to z +14.5 and back in to z +6.0. By the */
    /* top of it you are standing at x 171.6 on a deck at 25.3, seven metres directly */
    /* above the last slag bed you crossed twenty seconds ago, watching the           */
    /* front eat them. 10.6 m of travel that makes no forward progress at all, and   */
    /* the reason the shaft reads as a place instead of a corridor.                   */
    /* ============================================================================ */

    { kind: 'platform', p: [176.6, 18.2, 5.4], s: [6.4, 1, 4.6], mat: 'stone', glow: EDGE, stripe: true },  // CP4, top 18.70, gap 2.5 at +0.5
    { kind: 'rotor', p: [176.6, 19.05, 5.4], style: 'bar', arms: 2, len: 3.0, thick: 0.34, period: 3.0, phase: 0.0, axis: [0, 1, 0] },

    { kind: 'platform', p: [182.2, 19.8, 10.4], s: [3.4, 1, 3.4], mat: 'panel', glow: EDGE, stripe: true },  // top 20.30, diagonal 1.22 at +1.6
    { kind: 'platform', p: [177.6, 21.3, 13.0], s: [4.0, 1, 3.0], mat: 'grate', glow: EDGE, stripe: true },  // top 21.80, BACK 0.9 at +1.5
    { kind: 'platform', p: [172.6, 22.8, 11.0], s: [4.4, 1, 3.4], mat: 'panel', glow: EDGE, stripe: true },  // top 23.30, BACK 0.8 at +1.5
    { kind: 'platform', p: [171.6, 24.8, 6.0], s: [3.6, 1, 4.0], mat: 'stone', glow: EDGE, stripe: true },   // top 25.30, in 1.3 at +2.0 — first deck above the pour's ceiling

    { kind: 'text', p: [180.0, 23.0, 8.0], rot: [0, -Math.PI / 2, 0], text: 'THE LANE OPENS  ·  THEN IT DOES NOT', size: 0.36, color: HOT },
    { kind: 'text', p: [174.0, 27.4, 9.0], rot: [0, -Math.PI / 2, 0], text: 'LOOK DOWN  ·  THAT WAS THIRTY SECONDS AGO', size: 0.30, color: EMBER },
    { kind: 'deco', kindOf: 'buttress', p: [176.6, 21.6, 2.4], s: [1.4, 2.4, 1.4], scale: 1.4, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'chain', p: [177.6, 26.0, 13.0], s: [0.3, 8.0, 0.3], scale: 2.6, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'hoist', p: [177.6, 30.4, 13.0], s: [4.0, 1.2, 4.0], scale: 1.8, mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'brazier', p: [171.6, 25.9, 3.6], s: [1.1, 1.5, 1.1], mat: 'metal', tint: GLOW },
    { kind: 'deco', kindOf: 'girders', p: [176.0, 27.6, 9.0], scale: 1.8, count: 6, spread: 7.0, seed: 8801, mat: 'metal', tint: SOOT },
    { kind: 'light', p: [177.6, 24.6, 11.0], color: EMBER, intensity: 9, distance: 22 },

    /* ============================================================================ */
    /* BEAT 11 — OUT OF THE SHAFT  (the second pad)                                 */
    /* Two rungs off the top of the back-leg and you are on CP5 at 28.3, 4.8 m clear  */
    /* of everything the pour will ever be. Then the second pad, working the same way  */
    /* as the first: the deck it feeds is a plain 2.3 m hop away and 7.2 m long, and   */
    /* the pad decides WHERE on it you arrive — 194.47 at a walk, 201.40 at a held     */
    /* sprint. The deck top is 0.26 m under your eyeline when you take it.             */
    /* ============================================================================ */

    { kind: 'platform', p: [178.0, 26.3, 3.2], s: [4.2, 1, 4.4], mat: 'panel', glow: EDGE, stripe: true },  // top 26.80, gap 2.5 at +1.5
    { kind: 'platform', p: [184.2, 27.8, 0], s: [4.0, 1, 5.0], mat: 'stone', glow: EDGE, stripe: true },    // CP5, top 28.30, gap 2.1 at +1.5
    { kind: 'platform', p: [189.8, 29.2, -3.4], s: [4.6, 1, 4.2], mat: 'metal', glow: EDGE, stripe: true }, // top 29.70, gap 1.3 at +1.4
    { kind: 'jumppad', p: [190.8, 29.77, -3.4], s: [2.6, 0.14, 3.4], power: 6.0, dir: [0, 1, 0] },          // top 29.84, launch x 189.15
    { kind: 'platform', p: [198.0, 30.7, -3.4], s: [7.2, 1, 5.0], mat: 'metal', glow: EDGE, stripe: true }, // top 31.20, x 194.4..201.6 — spans the whole 5.32..12.25 m scatter
    { kind: 'platform', p: [207.2, 32.1, 0.6], s: [4.4, 1, 5.2], mat: 'stone', glow: EDGE, stripe: true },  // CP6, top 32.60, gap 3.4 at +1.4

    { kind: 'text', p: [186.0, 31.6, 2.6], rot: [0, -Math.PI / 2, 0], text: 'ABOVE THE LAUNDER LINE', size: 0.44, color: EMBER },
    { kind: 'text', p: [196.0, 33.0, -3.4], rot: [0, -Math.PI / 2, 0], text: 'it cannot follow you up here', size: 0.24, color: 0xa8785c },
    { kind: 'deco', kindOf: 'launder', p: [196.0, 24.4, 5.6], s: [22.0, 0.9, 1.6], scale: 1.6, count: 4, spread: 7.0, seed: 9901, mat: 'obsidian', tint: GLOW },
    { kind: 'deco', kindOf: 'spout', p: [200.0, 24.0, 5.6], s: [3.4, 3.0, 3.4], scale: 2.6, mat: 'obsidian', tint: HOT },
    { kind: 'deco', kindOf: 'rail', p: [202.2, 31.9, -5.6], s: [6.0, 0.09, 0.09], mat: 'metal', tint: EMBER },
    { kind: 'deco', kindOf: 'buttress', p: [206.0, 29.0, -2.0], s: [1.8, 3.4, 1.8], scale: 1.6, mat: 'obsidian' },
    { kind: 'light', p: [190.8, 32.4, -3.4], color: EMBER, intensity: 9, distance: 22 },
    { kind: 'light', p: [200.0, 26.0, 5.6], color: HOT, intensity: 12, distance: 26, flicker: 0.14 },

    /* ============================================================================ */
    /* BEAT 12 — SET-PIECE : THE CRUCIBLE RIM                                       */
    /* Every other beat in this stage — and in foundry-1 and foundry-2 — is a        */
    /* corridor: a lane you cross once, with the scenery on the far side of a rail.   */
    /* This one is a RING. The crucible stands at (228.5, z 0), twenty-two metres     */
    /* across, and the route goes AROUND it. Twice.                                   */
    /*                                                                              */
    /*   LAP 1  the outer rim, radius 11.0 about the crucible's axis at x 228.5,      */
    /*          entered from a ramp at x 215.2 and run through +Z. Six plates,         */
    /*          33.9 -> 40.1, with cp7 at the far end of it.                           */
    /*   LAP 2  the inner rim, radius 6.5, through -Z.   Four plates, 40.9 -> 45.1,   */
    /*          five metres directly above lap 1 and inside it, so you spend the      */
    /*          whole lap looking down at the plates you were standing on.            */
    /*   THE DIAMETER  a catwalk straight across the open mouth, 46.0 -> 48.4, which  */
    /*          passes over BOTH laps with 5.7-7.3 m of clearance and ends at the     */
    /*          finish gate on the far rim.                                            */
    /*                                                                              */
    /* The hazards are the two families that appear nowhere else in the stage, and    */
    /* both of them exist because the space is round. Three TAP-HOLE LASERS cut        */
    /* chords of the mouth: because the walking line is curved, each beam crosses it   */
    /* at a different angle and none of them can be read from the last one. Two        */
    /* STOPPER RODS swing across the diameter catwalk on 2.6 s and 3.2 s, and there    */
    /* is no width to dodge into out there — the catwalk is 2.4 m and 3.0 m wide with  */
    /* forty-six metres of air under it.                                               */
    /*                                                                              */
    /* ORB 4 hangs off the outer rim at z +14.6, a balcony 1.6 m BELOW lap 1 with     */
    /* nothing else within reach of it. Down 1.6, up 1.6, and back on the rim.        */
    /* ============================================================================ */

    { kind: 'lava', p: [230, -1.5, 0], s: [56, 3, 40] },   // the tundish under the rim: a 45 m fall reads as molten, not as void

    // ── LAP 1 : the outer rim, radius 11.0 from (228.5, 0), anticlockwise through +Z
    { kind: 'platform', p: [215.2, 33.4, 0], s: [5.2, 1, 5.6], mat: 'stone', glow: EDGE, stripe: true },   // top 33.90, gap 3.2 at +1.3
    { kind: 'platform', p: [219.6, 34.0, 6.5], s: [3.0, 1, 3.4], mat: 'metal', glow: EDGE, stripe: true }, // top 34.50, gap 2.0 at +0.6
    { kind: 'platform', p: [225.1, 35.9, 10.5], s: [4.4, 1, 2.8], mat: 'panel', glow: EDGE, stripe: true },// top 36.40, gap 2.0 at +1.9
    { kind: 'platform', p: [231.9, 36.9, 10.5], s: [3.2, 1, 4.0], mat: 'grate', glow: EDGE, stripe: true },// top 37.40, gap 3.0 at +1.0
    { kind: 'platform', p: [237.4, 38.4, 6.5], s: [3.8, 1, 3.2], mat: 'metal', glow: EDGE, stripe: true }, // top 38.90, gap 2.0 at +1.5
    { kind: 'platform', p: [239.5, 39.6, 0.8], s: [2.8, 1, 4.6], mat: 'stone', glow: EDGE, stripe: true }, // top 40.10, gap 1.8 at +1.2

    // ORB 4 — the balcony, hung outside the rim and below it. Dead end both ways.
    { kind: 'platform', p: [225.1, 34.3, 14.6], s: [3.0, 1, 3.0], mat: 'grate', glow: EDGE, stripe: true },// top 34.80, down 1.6 / back up 1.6 over 1.2 m
    { kind: 'deco', kindOf: 'beacon', p: [225.1, 36.4, 16.6], s: [0.7, 2.4, 0.7], scale: 1.3, mat: 'emissive', tint: EDGE },
    { kind: 'light', p: [225.1, 36.0, 14.6], color: EDGE, intensity: 5, distance: 12 },

    // ── LAP 2 : the inner rim, radius 6.5, back through -Z, five metres higher
    { kind: 'platform', p: [234.6, 40.4, -2.2], s: [3.4, 1, 3.0], mat: 'panel', glow: EDGE, stripe: true },// top 40.90, gap 1.8 at +0.8
    { kind: 'platform', p: [230.7, 42.1, -6.1], s: [2.6, 1, 3.8], mat: 'grate', glow: EDGE, stripe: true },// top 42.60, gap 1.03 at +1.7
    { kind: 'platform', p: [225.25, 43.2, -5.6], s: [4.0, 1, 2.6], mat: 'metal', glow: EDGE, stripe: true },// top 43.70, gap 2.15 at +1.1
    { kind: 'platform', p: [222.1, 44.6, -1.1], s: [3.2, 1, 4.4], mat: 'stone', glow: EDGE, stripe: true },// top 45.10, gap 1.0 at +1.4

    // ── THE DIAMETER : straight across the open mouth, over both laps
    { kind: 'platform', p: [227.3, 45.5, 0], s: [4.6, 1, 2.4], mat: 'metal', glow: EDGE, stripe: true },   // top 46.00, gap 1.3 at +0.9
    { kind: 'platform', p: [233.5, 47.1, 0], s: [3.0, 1, 2.0], mat: 'grate', glow: EDGE, stripe: true },   // top 47.60, gap 2.4 at +1.6
    { kind: 'platform', p: [238.7, 47.9, 0], s: [3.6, 1, 3.0], mat: 'panel', glow: EDGE, stripe: true },   // top 48.40, gap 1.9 at +0.8
    { kind: 'platform', p: [246.2, 49.5, 0], s: [7.2, 1, 8.4], mat: 'obsidian', glow: VIOLET, stripe: true }, // FINISH, top 50.00, gap 2.1 at +1.6

    // Tap-hole lasers: three chords of the mouth, each crossing the curved walking
    // line at a different angle. phase is SECONDS (lasers.js:616).
    { kind: 'laser', a: [222.0, 35.2, 3.0], b: [222.0, 35.2, 10.2], radius: 0.14, color: HOT, cycle: { on: 1.4, off: 1.8, warn: 0.6, phase: 0.0 } },
    { kind: 'laser', a: [228.5, 38.2, 7.6], b: [228.5, 38.2, 13.4], radius: 0.14, color: HOT, cycle: { on: 1.6, off: 1.5, warn: 0.5, phase: 0.8 } },
    { kind: 'laser', a: [236.8, 41.7, -4.6], b: [236.8, 41.7, 2.4], radius: 0.14, color: HOT, cycle: { on: 1.2, off: 2.0, warn: 0.6, phase: 1.7 } },

    // Stopper rods over the diameter catwalk. ampDeg is the degrees convenience
    // (pendulum.js:295); each rod's lowest point clears the deck it sweeps by 0.10 m
    // and its footprint covers exactly one catwalk plate.
    { kind: 'pendulum', p: [227.3, 48.75, 0], len: 2.2, ampDeg: 40, period: 2.6, phase: 0, blade: { w: 2.6, h: 0.9, d: 0.35 }, axis: [0, 0, 1] },
    { kind: 'pendulum', p: [238.7, 51.55, 0], len: 2.6, ampDeg: 46, period: 3.2, phase: 0.9, blade: { w: 2.4, h: 0.9, d: 0.35 }, axis: [0, 0, 1] },

    { kind: 'text', p: [214.0, 36.4, 0], rot: [0, -Math.PI / 2, 0], text: 'THE CRUCIBLE  ·  GO AROUND IT', size: 0.52, color: EMBER },
    { kind: 'text', p: [232.0, 44.0, -6.4], rot: [0, -Math.PI / 2, 0], text: 'you were down there a moment ago', size: 0.26, color: 0xa8785c },
    { kind: 'text', p: [230.0, 50.2, 2.4], rot: [0, -Math.PI / 2, 0], text: 'ACROSS THE MOUTH', size: 0.44, color: VIOLET },

    // The crucible itself: dead centre of the ring, at z 0, inside the play space.
    // You lap it twice and then walk over it.
    { kind: 'deco', kindOf: 'crucible', p: [228.5, 31.0, 0], s: [19.0, 16.0, 19.0], scale: 7.0, mat: 'obsidian', tint: GLOW },
    { kind: 'deco', kindOf: 'ring', p: [228.5, 40.6, 0], s: [0.4, 22.0, 22.0], scale: 3.0, mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'hoist', p: [227.3, 50.4, 0], s: [3.4, 1.2, 3.4], scale: 1.6, mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'hoist', p: [238.7, 53.2, 0], s: [3.4, 1.2, 3.4], scale: 1.6, mat: 'metal', tint: IRON },
    { kind: 'deco', kindOf: 'chain', p: [222.1, 49.4, -1.1], s: [0.3, 8.0, 0.3], scale: 2.4, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'chain', p: [234.6, 45.6, -2.2], s: [0.3, 8.0, 0.3], scale: 2.4, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'brazier', p: [217.2, 34.9, 2.2], s: [1.1, 1.5, 1.1], mat: 'metal', tint: GLOW },
    { kind: 'deco', kindOf: 'brazier', p: [239.5, 41.1, 2.4], s: [1.1, 1.5, 1.1], mat: 'metal', tint: GLOW },
    { kind: 'deco', kindOf: 'arch', p: [246.2, 55.0, 0], s: [1.4, 1.1, 10.0], scale: 2.4, mat: 'obsidian', tint: VIOLET },
    { kind: 'deco', kindOf: 'emblem', p: [246.2, 57.2, 0], s: [0.3, 2.6, 2.6], rot: [0, Math.PI / 2, 0], scale: 1.6, mat: 'emissive', tint: VIOLET },
    { kind: 'deco', kindOf: 'beacon', p: [250.0, 52.4, 0], s: [0.7, 3.0, 0.7], scale: 1.5, mat: 'emissive', tint: VIOLET },
    { kind: 'text', p: [243.4, 51.2, 0], rot: [0, -Math.PI / 2, 0], text: 'CRUCIBLE', size: 0.44, color: VIOLET },
    { kind: 'light', p: [228.5, 38.0, 0], color: HOT, intensity: 16, distance: 34, flicker: 0.12 },
    { kind: 'light', p: [246.2, 53.0, 0], color: VIOLET, intensity: 22, distance: 34 },
    { kind: 'light', p: [231.9, 39.4, 10.5], color: EMBER, intensity: 8, distance: 20 },
    { kind: 'light', p: [225.25, 45.6, -5.6], color: EMBER, intensity: 8, distance: 20 },

    /* ============================================================================ */
    /* THE FOUNDRY — the structure the shaft is cut through.                        */
    /* Only the things that could be MISREAD as floor are fenced out to |z| >= 12:    */
    /* the shaft walls, the monoliths, the structural pillars and the cable runs.     */
    /* Everything a player is meant to read as furniture — the crucible, the ladles,  */
    /* the braziers, the hoists, the tap hole, the rails, the chains — is placed in    */
    /* the beats above, inside the play space, beside decks you stand on.             */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'monolith', p: [60, -6, 26], s: [10, 30, 10], scale: 3.4, count: 7, spread: 130, seed: 3311, mat: 'obsidian', tint: 0x1a1210 },
    { kind: 'deco', kindOf: 'monolith', p: [60, -8, -26], s: [10, 30, 10], scale: 3.4, count: 7, spread: 130, seed: 4422, mat: 'obsidian', tint: 0x1a1210 },
    { kind: 'deco', kindOf: 'monolith', p: [196, 6, 30], s: [12, 52, 12], scale: 4.0, count: 6, spread: 110, seed: 5533, mat: 'obsidian', tint: 0x201512 },
    { kind: 'deco', kindOf: 'monolith', p: [196, 4, -30], s: [12, 52, 12], scale: 4.0, count: 6, spread: 110, seed: 6644, mat: 'obsidian', tint: 0x201512 },

    { kind: 'deco', kindOf: 'pillar', p: [140, 18, 18.5], s: [2.2, 62, 2.2], scale: 3.0, count: 9, spread: 170, seed: 7755, mat: 'obsidian', tint: SOOT },
    { kind: 'deco', kindOf: 'pillar', p: [140, 18, -18.5], s: [2.2, 62, 2.2], scale: 3.0, count: 9, spread: 170, seed: 8866, mat: 'obsidian', tint: SOOT },
    { kind: 'deco', kindOf: 'pipes', p: [140, 30, 16.6], scale: 3.0, count: 10, spread: 80, seed: 7756, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'pipes', p: [140, 36, -16.6], scale: 3.0, count: 10, spread: 80, seed: 8867, mat: 'metal', tint: SOOT },
    { kind: 'deco', kindOf: 'cable', p: [140, 50, 14.0], s: [180, 0.10, 0.10], scale: 1.2, mat: 'metal', tint: 0x120b08 },
    { kind: 'deco', kindOf: 'shard', p: [120, -12, 0], s: [3, 6, 3], scale: 2.0, count: 16, spread: 200, seed: 9977, mat: 'obsidian', tint: 0x2a1008 },

    // Path lights, one per act, so the route reads as a rising line from the floor.
    { kind: 'light', p: [40.4, 9.0, 0], color: EMBER, intensity: 7, distance: 22 },
    { kind: 'light', p: [63.7, 9.0, 0], color: HOT, intensity: 8, distance: 22 },
    { kind: 'light', p: [97.0, 15.4, -4.4], color: EMBER, intensity: 8, distance: 22 },
    { kind: 'light', p: [158.6, 17.6, -3.0], color: EMBER, intensity: 8, distance: 22 },
    { kind: 'light', p: [184.2, 31.0, 0], color: EMBER, intensity: 8, distance: 22 },
    { kind: 'light', p: [217.2, 36.6, 0], color: EMBER, intensity: 8, distance: 22 },
  ],
};
