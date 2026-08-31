/**
 * ASCENDANT — FROZEN SPIRE 2 : "GLASS TEETH"
 * runtime/data/stages/spire-2.js
 *
 * A cathedral someone started cutting into a glacier and never finished. You climb
 * it from the cornice at y 0.5 to the belfry at y 17.55, through two rooms you enter
 * and leave (the nave and the lamp room), a chimney you climb with your feet off the
 * floor, and a chandelier that is still turning.
 *
 * SHAPE      Every number below is one a harness printed for THIS file, this session.
 *            `node _harness/reachcheck.mjs spire-2`:
 *                len 384.6 · obj 70 · haz 41 · cp 9 · surf 54 · orph 0 · PASS,
 *                zero problems and zero warnings, and tightEdges 0.
 *            `node _harness/geomcheck.mjs spire-2`:
 *                obj 228 · flatRun 36.9 · sizes 46 · gapCv 0.43 · rep 1 · PASS,
 *                zero problems and zero warnings.
 *            `node _harness/modulecheck.mjs`: links.
 *            Checkpoint x: 52.7 / 99.4 / 134.6 / 158.8 / 196.2 / 236.6 / 274.0 /
 *            296.8 / 341.4, i.e. spacings 46.7 / 35.2 / 24.2 / 37.4 / 40.4 / 37.4 /
 *            22.8 / 44.6, with 52.7 m of easy ground before the first and 45.2 m of
 *            finale after the last. 4 coins. 14 signs. 41 hazards from 11 families
 *            (ice, spikes, rotor, laser, crusher, saw, pendulum, wind, mover,
 *            vanish, jumppad). The stage runs x -4 -> 390.6, climbing 0.5 -> 17.55.
 *
 *            AND EVERY CHECKPOINT IS SWEPT AGAINST EVERY KILL VOLUME over a full
 *            period, capsule against capsule, before it is written down. The
 *            tightest clearance on the stage is 1.15 m (cp6 against the pad's bed).
 *            The last draft shipped a checkpoint 0.45 m INSIDE a swinging blade.
 *
 * THE ONE RULE THIS FILE IS BUILT AROUND (neon-1 House Rule 2)
 *   The reach envelope has two bands a jump must never land in, because a jump inside
 *   them is one a player can *just barely* make and will therefore fail half the time:
 *   4.36-5.24 m and 6.18-7.44 m flat, and the equivalents at every dy. `reachcheck`
 *   calls an edge inside them `run-tight` / `sprint-tight`.
 *
 *   Those bands are not only about the jump you intend. The checker measures EVERY
 *   pair of landable surfaces within 30 m, in BOTH directions, so a two-platform skip
 *   or a look backwards down the stage can land in the band even when the line you
 *   drew does not. The whole layout below therefore obeys one arithmetic rule:
 *
 *       NEIGHBOURS <= 4.0 m apart.  EVERYTHING ELSE >= 9.0 m apart.
 *
 *   With tiles >= 2.8 m across and gaps >= 2.2 m, a one-platform skip is 9+ m — past
 *   the far edge of the sprint band at every dy this stage uses. Where a gap has to
 *   be short (a lip, a step), the pieces either side are wide enough to keep the skip
 *   over 9. The result is measured, not asserted: 0 tight edges, the same as neon-1,
 *   neon-2 and spire-1.
 *
 * TEACHES / TESTS, in order:
 *   ICE          BEAT 1  eight metres of ice over the void with a bed 4.3 m in
 *   RHYTHM       BEAT 2  four shrinking islands, and a capstan on the first one
 *   PRECISION    BEAT 3  glass beams: the problem is width, not distance
 *   THE NAVE     BEAT 4  a room with two lanes — the floor (teeth, a wall piston, a
 *                        floor saw) or the north aisle (lasers). Both cross it.
 *   COMBINE      BEAT 5  ice, a laser you jump, one bed at the far end
 *   BLADES       BEAT 6  one blade you WAIT for, one you CROUCH under
 *   WIND         BEAT 7  three spans, three fields, reversing over two of the gaps
 *   WALL-JUMP    BEAT 8  the chimney — the new verb, and the only way to COIN 3
 *   TRAM         BEAT 9  a shuttle on a 3.4 s cycle, or the old south road
 *   SET-PIECE    BEAT 10 plank -> glass bridge under head-on blades -> ice bridge
 *                        under the turning ring -> the lamp room's piston door ->
 *                        the shelf, which crumbles and climbs
 *
 * WALL-JUMP IS NEVER MANDATORY, AND NEVER POINTLESS. Both halves of that sentence
 * are load-bearing, because the last draft got the second half backwards: it made
 * the alternative route SAFER and its hardest jump HARDER than the chimney, so the
 * headline mechanic was the one nobody had a reason to learn.
 *
 *   POINTLESS is fixed by COIN 3. It hangs at y 12.80, on the centre line of the
 *   shaft, 3.30 m over the floor — 1.21 m above the 2.09 m standing apex. Nothing in
 *   the movement set reaches it except the second wall bounce (11.09 -> 12.68 m).
 *   MANDATORY is fixed by the masons' hoist on the shaft's south face, which lifts
 *   the same 6.10 m on a 5.0 s cycle. Getting on it is a 1.20 m sidestep and getting
 *   off is a 1.73 m sidestep — the two easiest moves on the stage, and nowhere near
 *   the hardest thing the main line already asked for (4.00 m on the shelf).
 *   So the hoist is strictly slower (about eight seconds against two) and strictly
 *   easier, and it does not pass the coin. That is the whole bargain.
 *
 * ── HAZARD SEMANTICS, verified against the runtime (do not "tidy" these) ─────
 *   spikes / laser `cycle`   phase is in SECONDS, period = on + off, and `warn` is the
 *                            TAIL of `off`. lasers.js:609 `const period = on + off`,
 *                            :616 `const shifted = t + phase`. A LARGER phase therefore
 *                            fires EARLIER: a bed rises at t = (period - phase) % period.
 *   vanish `cycle`           phase is a FRACTION OF THE CYCLE (0..1) and the period is
 *                            on + warn + off (vanish.js:220, :233).
 *   vanish mode 'crumble'    ignores `cycle` ENTIRELY (vanish.js:509) — only crackDelay
 *                            and chunkLife do anything, so no crumble tile carries one.
 *   mover 'oscillate'        pos = lerp(p, to, 0.5 + 0.5*sin(TAU*(t/period + phase)))
 *                            (movers.js:437) and `phase` is a FRACTION of a cycle. The
 *                            two tram cars carry 0.75 and 0.25, so one of them is at
 *                            the near end at t = 0 and the other at t = period/2.
 *   pendulum                 phase is in RADIANS: angle(t) = amp*sin(TAU*t/period+phase).
 *                            phase = PI negates the angle but does NOT move its zeros,
 *                            so two "antiphase" blades cross the line together. Every
 *                            pair below is offset by an irrational fraction and no two
 *                            neighbours share a period.
 *   pendulum geometry        pendulum.js:534/539: the kill capsule axis hangs
 *                            armLen + 0.52h under the pivot with radius max(1.15d,0.30h);
 *                            the painted tip reaches armLen + (h-0.798d)*1.0025 + 0.42d.
 *                            EVERY pivot below is placed from those two numbers, and
 *                            every checkpoint is placed OUTSIDE every capsule's reach —
 *                            see the note on cp8.
 *   crusher                  `p` is the RETRACTED head; `axis` is the direction it
 *                            punches; its top face is a landable surface at p[1]+s[1]/2.
 *
 * CONVENTIONS: p = CENTRE, s = FULL size, top surface = p[1] + s[1]/2. Gaps in the
 * comments are EDGE TO EDGE and measured. rot/yaw in radians, yaw 0 faces +X.
 * `stripe: true` = you must jump from here. A spike bed's p[1] is deckTop + s[1]/2.
 *
 * HEIGHT LADDER: 0.5 (cornice) -> 1.0/1.65/2.35/3.05 (islands) -> 3.85 (the deck,
 *                level with the first beam) -> 3.85/4.05/4.25/4.75 (glass) ->
 *                4.75/5.45/6.25 (the nave, three stepped floors) -> 6.65 (the ice) ->
 *                7.15 (blade walk) -> 7.75 -> 8.55 (past the blades) ->
 *                8.55/8.95/9.40/9.70 (the wind) -> 9.50 (shaft floor) ->
 *                15.60 (the mouth, by four wall bounces or one hoist ride) ->
 *                16.60 (antechamber and tram) -> 17.40 (the terrace) ->
 *                15.50 (the plank — the finale drops before it climbs) ->
 *                15.80/16.10 (the two bridges) -> 16.25 (lamp room) ->
 *                16.35/15.05/15.55/16.75/17.55 (the shelf, which drops once on the
 *                way up) -> 17.55 (the belfry, level with the last tile).
 */

const ICE = 0x9fe8ff;    // crystal emissive — the "you can stand on this" glow
const GOLD = 0xffc94a;   // palette.safeEdge — leading edges and signage
const HOT = 0xff5a3c;    // palette.killGlow — teeth, blades, optional lines
const DEEP = 0x2f74b0;   // crystal attenuation — structure that is NOT landable

// Wind is colour-coded by strength and by nothing else, so a glance reads the push:
// nearly white = 10, mid = 12, deep = 14 m/s^2. The boundaries where it reverses
// carry a physical mast, because an invisible boundary is not a test, it is a guess.
const AIR10 = 0xdff2fb;
const AIR12 = 0x8fd0f2;
const AIR14 = 0x4c9fe0;

export default {
  id: 'spire-2',
  world: 'spire',
  name: 'GLASS TEETH',
  subtitle: 'The mountain has opinions about your footing',
  par: 236000,
  difficulty: 6,

  spawn: { p: [0, 0.6, 0], yaw: 0 },
  killY: -32,

  checkpoints: [
    // 0 — the deck at the end of the islands, looking down the first glass beam.
    { p: [52.7, 3.95, 0], yaw: 0, clockOffset: 0 },
    // 1 — one hop short of the nave. clockOffset 1.05: the teeth of the nave floor
    // rise 1.0 s apart, and a runner who leaves the instant they respawn arrives at
    // the first bed inside its down window instead of under its rise.
    { p: [99.4, 4.85, 0], yaw: 0, clockOffset: 1.05 },
    // 2 — the far floor of the nave, past the piston, before the ice. At x 134.6,
    // not 132.0: the floor saw at x 131.0 has a 1.6 m disc, so a checkpoint on the
    // slab's centre line would have respawned the player 0.95 m INSIDE it.
    { p: [134.6, 6.35, 0], yaw: 0, clockOffset: 0 },
    // 3 — the ramp at the mouth of the blade walk. Solved for ARRIVAL: at accel 95
    // to speedRun 8.6 the player enters the first blade's band ~1.0 s after respawn,
    // so the clock puts that blade at the far end of its arc THEN.
    { p: [158.8, 7.25, 0], yaw: 0, clockOffset: 0.55 },
    // 4 — past the blades, before the wind. No wind field reaches this deck: field 1
    // starts at x 202.0 and this deck ends at 199.7.
    { p: [196.2, 8.65, 0], yaw: 0, clockOffset: 0 },
    // 5 — the deck at the foot of the shaft, before the chimney AND before the hoist.
    // Field 3 stops at x 232.9, which is this deck's near edge: you respawn in still
    // air and step into the wind, never the other way round.
    { p: [236.6, 9.80, 0], yaw: 0, clockOffset: 0 },
    // 6 — the ice pad, one step past the ledge both routes out of the shaft arrive
    // on, and one step short of the tram. Put here rather than on the ledge so a
    // death on the tram does not replay the chimney. The bed at x 276.2 is 1.15 m
    // clear of this point; clockOffset 0.30 lands the respawn in its down window.
    { p: [274.0, 16.70, 0], yaw: 0, clockOffset: 0.30 },
    // 7 — the terrace. Everything past here is the finale.
    { p: [296.8, 17.50, 0], yaw: 0, clockOffset: 1.35 },
    // 8 — the lamp room. THE KILL-VOLUME CHECK, because a checkpoint inside a swing
    // is the defect that ruined the last draft (its last checkpoint sat in a blade's
    // capsule and re-killed the player 0.108 s after every respawn). Swept over full
    // periods against the player's own capsule, the three nearest kill volumes clear
    // this point by:
    //     chandelier blade at pivot [319.6, 21.70], amp 0.50  ->  reaches x 322.55,
    //                                                            18.85 m short
    //     the ring bar, radius 2.76 m about x 328.4           ->  reaches x 331.16,
    //                                                            10.2 m short
    //     the lamp-room piston, head 2.4 m of x on 337.4      ->  2.45 m of daylight
    //                                                            at full extension
    // Nothing on this stage can touch a player standing here, at any phase. Every
    // other checkpoint is swept the same way and the tightest of them is cp6 at
    // 1.15 m. clockOffset 0 also re-arms every crumble tile behind you.
    { p: [341.4, 16.35, 0], yaw: 0, clockOffset: 0 },
  ],

  finish: { p: [386.6, 18.0, 0], yaw: 0 },

  coins: [
    { p: [79.6, 5.55, 8.0] },    // BEAT 3  — 3.50 m off the side of the second beam
    { p: [167.6, 8.90, 0] },     // BEAT 6  — 1.75 m up, inside the first blade's arc
    { p: [247.0, 12.80, 0] },    // BEAT 8  — 3.30 m over the shaft floor: WALL-JUMP ONLY
    { p: [332.0, 14.80, 5.6] },  // BEAT 10 — under the corridor; a pad brings you back
  ],

  objects: [
    /* ============================================================================ */
    /* BEAT 1 — THE CORNICE                                                         */
    /* A stone porch, then eight and a half metres of ice 4.4 m wide with no margin. */
    /* The ice starts at x 9.10 and the bed's near tooth is at x 12.70 — 3.60 m —    */
    /* against the 1.42 m it takes to brake from speedRun on ice. Enough, but only   */
    /* if you start braking when you land instead of when you see the plate. The     */
    /* first way to die on this stage is at x 13, not at x 84.                       */
    /* ============================================================================ */

    /* 0 */ { kind: 'platform', p: [2, 0, 0], s: [12, 1, 10], mat: 'stone', glow: DEEP },   // x[-4,8] top 0.5
    /* 1 */ { kind: 'ice', p: [13.4, 0, 0], s: [8.6, 1, 4.4] },                             // gap 1.10, x[9.1,17.7] top 0.5
    /* 2 */ { kind: 'spikes', p: [13.4, 0.85, 0], s: [1.4, 0.7, 4.6], dir: [0, 1, 0], mode: 'retract', cycle: { on: 1.2, off: 2.6, warn: 0.8, phase: 0 } },

    { kind: 'text', p: [-3.6, 2.8, 0], rot: [0, -Math.PI / 2, 0], text: 'GLASS TEETH', size: 0.78, color: DEEP },
    { kind: 'text', p: [-3.6, 2.15, 0], rot: [0, -Math.PI / 2, 0], text: 'FROZEN SPIRE  ·  II  ·  nothing up here holds still', size: 0.26, color: 0x5d7f96 },
    { kind: 'text', p: [7.6, 2.3, -2.9], rot: [0, -Math.PI / 2, 0], text: 'ICE  ·  you do not stop where you let go', size: 0.28, color: GOLD },

    // The unfinished porch: a scaffold bay, a brick stack nobody came back for, and
    // the torches that still burn. Placed, not scattered — count 1 where one is what
    // the building would have.
    { kind: 'deco', model: 'spire/torch', p: [-3.2, 0.78, 4.4], count: 1, spread: 0, scale: 1.6, seed: 9101 },
    { kind: 'deco', model: 'spire/torch', p: [-3.2, 0.78, -4.4], count: 1, spread: 0, scale: 1.6, seed: 9102 },
    { kind: 'deco', model: 'spire/torch', p: [6.4, 0.78, 4.4], count: 1, spread: 0, scale: 1.6, seed: 9103 },
    { kind: 'deco', model: 'spire/brick_a', p: [5.4, 0.61, 3.8], count: 9, spread: 1.2, scale: 1.0, seed: 9104 },
    { kind: 'deco', model: 'spire/crate', p: [1.2, 0.55, -4.2], count: 3, spread: 1.5, scale: 1.1, seed: 9105 },
    // the porch's back wall: an arcade of three squat piers, one placement each
    { kind: 'deco', kindOf: 'slabs', p: [-1.0, 0.5, 5.9], count: 1, spread: 0, scale: 3.4, seed: 9106, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [2.6, 0.5, 5.9], count: 1, spread: 0, scale: 3.4, seed: 9107, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [6.2, 0.5, 5.9], count: 1, spread: 0, scale: 3.4, seed: 9108, mat: 'stone' },
    { kind: 'deco', kindOf: 'girders', p: [3.0, 3.4, 5.6], count: 5, spread: 3.2, scale: 1.6, seed: 9109, mat: 'metal' },
    { kind: 'light', p: [1.0, 3.4, 0], color: 0xdcf0ff, intensity: 9, distance: 22 },
    { kind: 'light', p: [13.4, 2.6, 0], color: HOT, intensity: 8, distance: 16, flicker: 0.12 },

    /* ============================================================================ */
    /* BEAT 2 — THE ISLANDS AND THE CAPSTAN                                         */
    /* Four ice islands that SHRINK (5.8 -> 3.6 -> 3.2 -> 2.8 m across), CLIMB and   */
    /* walk their z line 0 -> +4.4 -> -1.0 -> +2.4, so you cannot hold W.            */
    /*                                                                              */
    /* THE LANDING IS NOT INSIDE THE CAPSTAN. The bar is 2.0 m long and 0.34 thick,  */
    /* so it sweeps a 2.17 m radius; its pivot is at x 24.9, which puts the near edge */
    /* of the arc at x 22.73 — 2.13 m past the island's leading edge at 20.60. You    */
    /* land off a 2.90 m jump with 2.13 m of clear ice ahead of you and 1.42 m is all */
    /* you need to stop. The bar is not lethal, it shoves; there is nothing under the */
    /* island to be shoved onto, which is the whole point.                           */
    /* ============================================================================ */

    /* 3 */ { kind: 'ice', p: [23.5, 0.5, 0], s: [5.8, 1, 5.2] },      // gap 2.90, dy +0.5, x[20.6,26.4] top 1.0
    /* 4 */ { kind: 'rotor', p: [24.9, 1.315, 0], style: 'bar', arms: 2, len: 2.0, thick: 0.34, period: 5.0, phase: 0, axis: [0, 1, 0] },

    /* 5 */ { kind: 'ice', p: [31.8, 1.15, 4.4], s: [3.6, 1, 4.0] },   // gap 3.60, dy +0.65, top 1.65
    /* 6 */ { kind: 'ice', p: [38.6, 1.85, -1.0], s: [3.2, 1, 4.4] },  // diagonal 3.61, dy +0.70, top 2.35
    /* 7 */ { kind: 'ice', p: [44.6, 2.55, 2.4], s: [2.8, 1, 3.6] },   // gap 3.00, dy +0.70, top 3.05
    /* 8 */ { kind: 'platform', p: [52.7, 2.85, 0], s: [7.4, 2, 8], mat: 'stone', glow: DEEP, stripe: true }, // gap 3.00, dy +0.80, top 3.85 — level with the first glass beam, so the walk onto it is a step, not a hop

    { kind: 'text', p: [18.4, 2.6, -3.2], rot: [0, -Math.PI / 2, 0], text: 'THE CAPSTAN TURNS  ·  it will not kill you, the drop will', size: 0.30, color: GOLD },

    { kind: 'deco', model: 'spire/rope', p: [23.5, 1.02, -2.0], count: 1, spread: 0, scale: 1.3, seed: 9110 },
    { kind: 'deco', model: 'spire/torch', p: [31.8, 1.88, 6.0], count: 1, spread: 0, scale: 1.5, seed: 9111 },
    { kind: 'deco', model: 'spire/rubble', p: [52.7, 3.85, 3.4], count: 5, spread: 2.2, scale: 1.2, seed: 9112 },
    { kind: 'deco', kindOf: 'spires', p: [30.0, 0.6, 9.4], count: 7, spread: 4.2, scale: 2.4, seed: 9113, mat: 'crystal' },
    { kind: 'deco', kindOf: 'crystals', p: [26.0, 0.0, -8.0], count: 7, spread: 4.0, scale: 2.0, seed: 9114, mat: 'crystal' },
    { kind: 'light', p: [27.0, 3.2, 0], color: ICE, intensity: 8, distance: 26 },

    /* ============================================================================ */
    /* BEAT 3 — GLASS BEAMS                                                         */
    /* One metre wide and nothing either side. The distances are small on purpose    */
    /* (1.20 / 2.70 / 3.54 / 3.55 / 2.50) because the problem has changed: this is   */
    /* the first place on the stage that asks you to WALK.                          */
    /*                                                                              */
    /* COIN 1 is a stub 3.50 m off the side of the second beam, and it is a genuine  */
    /* out-and-back: the ONLY surface it connects to is the beam you left. The third */
    /* beam is 7.94 m away — past the 7.44 m sprint envelope — and the ice square is */
    /* 9.04 m away, also past it. So there is no forward line off the perch to be    */
    /* tempted by, and no flat sightline between two lit ledges at one height. (The  */
    /* last draft put this perch at exactly the ice square's height, 7.11 m away —   */
    /* dead centre of the forbidden 6.18-7.44 m band, with a lit prize on the far    */
    /* end of it.)                                                                    */
    /* ============================================================================ */

    /* 9 */  { kind: 'beam', p: [61.4, 3.6, 0], s: [7.6, 0.5, 1.0], mat: 'glass' },      // gap 1.20, dy +0.70, x[57.6,65.2] top 3.85
    /* 10 */ { kind: 'ice', p: [69.4, 3.35, 0], s: [3.0, 1, 3.0] },                       // gap 2.70 flat, top 3.85
    /* 11 */ { kind: 'beam', p: [78.6, 3.8, 2.6], s: [8.4, 0.5, 1.2], mat: 'glass' },     // diagonal 3.54, dy +0.20, top 4.05

    // -- the optional line -------------------------------------------------------
    /* 12 */ { kind: 'platform', p: [79.6, 3.75, 8.0], s: [2.6, 1, 2.6], mat: 'obsidian', glow: HOT, stripe: true }, // 3.50 m lateral, dy +0.20, top 4.25
    { kind: 'deco', kindOf: 'crystals', p: [79.6, 4.25, 8.0], count: 5, spread: 0.7, scale: 1.4, seed: 9115, mat: 'emissive', glow: 3 },
    { kind: 'light', p: [79.6, 5.9, 8.0], color: HOT, intensity: 8, distance: 15 },

    /* 13 */ { kind: 'beam', p: [89.6, 4.0, 0], s: [7.0, 0.5, 1.4], mat: 'glass' },       // diagonal 3.55, dy +0.20, top 4.25
    /* 14 */ { kind: 'platform', p: [99.4, 4.0, 0], s: [7.6, 1.5, 9], mat: 'stone', glow: DEEP, stripe: true }, // gap 2.50, dy +0.50, top 4.75

    { kind: 'deco', model: 'spire/torch', p: [61.4, 3.02, -2.6], count: 1, spread: 0, scale: 1.5, seed: 9116 },
    { kind: 'deco', model: 'spire/torch', p: [89.6, 3.42, -2.6], count: 1, spread: 0, scale: 1.5, seed: 9117 },
    { kind: 'deco', model: 'spire/cage', p: [69.4, 3.64, -5.6], count: 1, spread: 0, scale: 1.6, seed: 9118 },
    { kind: 'deco', model: 'spire/banner', p: [70.0, 9.2, -4.6], count: 2, spread: 4.4, scale: 1.7, seed: 9119 },
    // the ribs the glass is strung between: two pairs, on the beam centres
    { kind: 'deco', kindOf: 'girders', p: [61.4, 7.6, 3.6], count: 3, spread: 1.4, scale: 2.2, seed: 9120, mat: 'metal' },
    { kind: 'deco', kindOf: 'girders', p: [89.6, 8.0, -3.6], count: 3, spread: 1.4, scale: 2.2, seed: 9121, mat: 'metal' },
    { kind: 'deco', kindOf: 'fins', p: [76.0, 1.4, -7.6], count: 6, spread: 4.2, scale: 2.2, seed: 9122, mat: 'crystal' },
    { kind: 'light', p: [69.4, 5.6, 0], color: ICE, intensity: 9, distance: 24 },
    { kind: 'light', p: [99.4, 6.2, 0], color: ICE, intensity: 9, distance: 22 },

    /* ============================================================================ */
    /* BEAT 4 — THE NAVE   (a room, with two ways across it)                        */
    /*                                                                              */
    /* The floor is THREE slabs at three heights (4.75 / 5.45 / 6.25) and three      */
    /* sizes (9.6x7.4 / 8.8x6.6 / 7.4x5.8), so the hall narrows and climbs as you    */
    /* cross it instead of being one nineteen-metre table. Each slab carries a       */
    /* DIFFERENT machine:                                                           */
    /*                                                                              */
    /*   floor 1   two retracting beds, 1.6 m and 2.8 m thick, 5.0 m apart, rising   */
    /*             1.0 s apart — a wave, but a two-beat one you read in a glance     */
    /*   floor 2   a WALL PISTON that punches across the lane from the north arcade  */
    /*             and pulls back. Nothing rises out of this floor.                  */
    /*   floor 3   a FLOOR SAW whose disc tops out 0.5 m over the boards. You hop it.*/
    /*                                                                              */
    /* AND THERE IS A NORTH AISLE. A 15 m glass gallery at z +8.4, reachable off the */
    /* checkpoint deck and off both of the first two floors (3.00 / 3.50 / 3.90 m of */
    /* clear air, and you can drop back into the nave anywhere along it). It buys    */
    /* you past the two beds and the piston and charges two lasers for the trip.     */
    /* It runs out at x 119.5, so the saw on floor 3 is on BOTH lanes — the room     */
    /* offers you a choice and then makes you finish it the same way.                */
    /* ============================================================================ */

    /* 15 */ { kind: 'platform', p: [110.0, 4.0, 0], s: [9.6, 1.5, 7.4], mat: 'stone', glow: DEEP, stripe: true },  // gap 2.00 flat, x[105.2,114.8] top 4.75
    /* 16 */ { kind: 'platform', p: [121.4, 4.7, 0], s: [8.8, 1.5, 6.6], mat: 'stone', glow: DEEP, stripe: true },  // gap 2.20, dy +0.70, top 5.45
    /* 17 */ { kind: 'platform', p: [132.0, 5.5, 0], s: [7.4, 1.5, 5.8], mat: 'stone', glow: GOLD, stripe: true },  // gap 2.50, dy +0.80, top 6.25

    // the north aisle — the other lane
    /* 18 */ { kind: 'beam', p: [112.0, 4.9, 8.4], s: [15.0, 0.5, 2.4], mat: 'glass' },   // x[104.5,119.5] top 5.15
    /* 19 */ { kind: 'laser', a: [108.6, 5.75, 6.9], b: [108.6, 5.75, 9.9], radius: 0.09, color: HOT, cycle: { on: 1.2, off: 1.8, warn: 0.5, phase: 0.0 } },
    /* 20 */ { kind: 'laser', a: [115.2, 5.75, 6.9], b: [115.2, 5.75, 9.9], radius: 0.09, color: HOT, cycle: { on: 1.2, off: 1.8, warn: 0.5, phase: 0.9 } },

    // the nave floor's machines
    /* 21 */ { kind: 'spikes', p: [107.4, 5.10, 0], s: [1.6, 0.7, 7.6], dir: [0, 1, 0], mode: 'retract', cycle: { on: 1.5, off: 2.1, warn: 0.6, phase: 0.0 } }, // rises t = 0.0
    /* 22 */ { kind: 'spikes', p: [112.4, 5.10, 0], s: [2.8, 0.7, 7.6], dir: [0, 1, 0], mode: 'retract', cycle: { on: 1.5, off: 2.1, warn: 0.6, phase: 2.6 } }, // rises t = 1.0
    /* 23 */ { kind: 'crusher', p: [117.8, 5.85, 4.8], s: [2.4, 1.6, 2.0], axis: [0, 0, -1], travel: 4.2, period: 3.9, phase: 0.35, dwell: 0.9, mat: 'metal' },
    /* 24 */ { kind: 'saw', p: [131.0, 5.15, 0], style: 'saw', len: 1.6, thick: 0.26, period: 1.4, phase: 0.0, axis: [0, 0, 1], mount: 0 },

    { kind: 'text', p: [102.0, 6.4, 0], rot: [0, -Math.PI / 2, 0], text: 'THEY COME BACK UP  ·  or take the north aisle', size: 0.44, color: HOT },

    // The nave itself: an arcade of piers down both sides on the bay spacing, a
    // clerestory over the aisle, and the vault. Every pier is one placement at a
    // named x, not a cloud.
    { kind: 'deco', kindOf: 'slabs', p: [106.0, 4.8, 5.2], count: 1, spread: 0, scale: 4.2, seed: 9123, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [112.0, 4.8, 5.2], count: 1, spread: 0, scale: 4.2, seed: 9124, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [118.0, 5.5, 5.0], count: 1, spread: 0, scale: 4.2, seed: 9125, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [124.0, 5.5, 4.6], count: 1, spread: 0, scale: 4.2, seed: 9126, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [130.0, 6.3, 4.2], count: 1, spread: 0, scale: 4.2, seed: 9127, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [106.0, 4.8, -5.2], count: 1, spread: 0, scale: 4.2, seed: 9128, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [112.0, 4.8, -5.2], count: 1, spread: 0, scale: 4.2, seed: 9129, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [118.0, 5.5, -5.0], count: 1, spread: 0, scale: 4.2, seed: 9130, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [124.0, 5.5, -4.6], count: 1, spread: 0, scale: 4.2, seed: 9131, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [130.0, 6.3, -4.2], count: 1, spread: 0, scale: 4.2, seed: 9132, mat: 'stone' },
    { kind: 'deco', model: 'spire/torch', p: [106.0, 6.3, 5.0], count: 1, spread: 0, scale: 1.6, seed: 9133 },
    { kind: 'deco', model: 'spire/torch', p: [118.0, 7.0, -4.8], count: 1, spread: 0, scale: 1.6, seed: 9134 },
    { kind: 'deco', model: 'spire/torch', p: [130.0, 7.8, 4.0], count: 1, spread: 0, scale: 1.6, seed: 9135 },
    { kind: 'deco', model: 'spire/banner', p: [110.0, 12.4, 4.6], count: 3, spread: 5.4, scale: 1.8, seed: 9136 },
    { kind: 'deco', model: 'spire/cage', p: [121.4, 11.2, 0], count: 1, spread: 0, scale: 2.0, seed: 9137 },
    { kind: 'deco', model: 'spire/crate', p: [104.0, 4.85, -3.2], count: 2, spread: 1.4, scale: 1.1, seed: 9138 },
    // the vault: two rib bands, one over each bay, not one cloud
    { kind: 'deco', kindOf: 'girders', p: [110.0, 13.6, 0], count: 6, spread: 4.6, scale: 2.6, seed: 9139, mat: 'metal' },
    { kind: 'deco', kindOf: 'girders', p: [126.0, 14.2, 0], count: 6, spread: 4.6, scale: 2.6, seed: 9140, mat: 'metal' },
    // the clerestory wall behind the aisle
    { kind: 'deco', kindOf: 'fins', p: [112.0, 6.4, 11.6], count: 9, spread: 6.2, scale: 2.6, seed: 9141, mat: 'crystal' },
    { kind: 'light', p: [110.0, 7.4, 0], color: HOT, intensity: 10, distance: 22, flicker: 0.1 },
    { kind: 'light', p: [112.0, 7.0, 8.4], color: ICE, intensity: 9, distance: 20 },
    { kind: 'light', p: [130.0, 8.4, 0], color: GOLD, intensity: 9, distance: 22, flicker: 0.06 },

    /* ============================================================================ */
    /* BEAT 5 — COMBINE : ICE, A LASER YOU JUMP, ONE BED                            */
    /* Eight metres of ice 3.6 m wide. A laser sits 0.40 m over the sheet, 1.60 m    */
    /* past the lip — low enough to hop, and 0.18 m more than the 1.42 m it takes to */
    /* stop, so trying to stop and trying to jump are the same decision made in the  */
    /* same tenth of a second. One bed at the far end, on the fast cycle. This is    */
    /* the only place on the stage that asks for two verbs inside one second.        */
    /* ============================================================================ */

    /* 25 */ { kind: 'ice', p: [142.0, 6.05, 0], s: [8.0, 1.2, 3.6] },   // gap 2.30, dy +0.40, x[138.0,146.0] top 6.65
    /* 26 */ { kind: 'laser', a: [139.6, 7.05, -2.4], b: [139.6, 7.05, 2.4], radius: 0.10, color: HOT, cycle: { on: 1.3, off: 1.9, warn: 0.55, phase: 0.0 } },
    /* 27 */ { kind: 'spikes', p: [144.6, 7.00, 0], s: [1.2, 0.7, 3.8], dir: [0, 1, 0], mode: 'retract', cycle: { on: 1.1, off: 1.6, warn: 0.5, phase: 0.0 } },

    /* 28 */ { kind: 'ice', p: [151.4, 6.05, -2.0], s: [3.2, 1.2, 3.2] },  // gap 3.80 flat, top 6.65
    /* 29 */ { kind: 'platform', p: [158.8, 5.55, 0], s: [7.2, 3.2, 7.0], mat: 'stone', glow: DEEP, stripe: true }, // gap 2.20, dy +0.50, top 7.15

    { kind: 'deco', model: 'spire/coil', p: [151.4, 6.65, -3.4], count: 1, spread: 0, scale: 1.3, seed: 9142 },
    { kind: 'deco', model: 'spire/rope', p: [142.0, 6.65, 2.4], count: 1, spread: 0, scale: 1.3, seed: 9143 },
    { kind: 'deco', kindOf: 'crystals', p: [146.0, 1.6, -8.4], count: 7, spread: 4.4, scale: 2.2, seed: 9144, mat: 'crystal' },
    { kind: 'light', p: [140.0, 8.4, 0], color: HOT, intensity: 9, distance: 20, flicker: 0.12 },

    /* ============================================================================ */
    /* BEAT 6 — THE BLADE WALK                                                      */
    /* An 11.6 m walkway 2.8 m wide with two ice blades over it, placed from the     */
    /* runtime's own numbers (pendulum.js:534/539) for blade {w 2.8, h 2.6, d 0.26}, */
    /* len 3.6:  painted tip = pivot - 6.108,  kill capsule bottom = pivot - 5.732.  */
    /*                                                                              */
    /*   BLADE 1  pivot 13.41 over boards at 7.15: the tip clears them by 0.152 m    */
    /*            and the capsule by 0.528. It scythes over the deck, never through  */
    /*            it — you WAIT. amp 0.54 holds it on the walk line 28% of a period. */
    /*   BLADE 2  pivot 14.47: the capsule bottom sits at 8.738, which is 0.212 m    */
    /*            INSIDE a standing player (head 8.95) and 0.538 above a crouched    */
    /*            one (head 8.20); the painted tip at 8.362 passes 0.162 over the    */
    /*            crouched head. CROUCH AND WALK — the second verb on this stage     */
    /*            that is not "wait".                                               */
    /*                                                                              */
    /* COIN 2 needs no platform: it hangs 1.75 m over the boards at x 167.6, dead    */
    /* under blade 1's pivot. You jump for it inside the window you were going to    */
    /* wait out anyway, which is a decision rather than a detour.                    */
    /* ============================================================================ */

    /* 30 */ { kind: 'platform', p: [170.2, 6.35, 0], s: [11.6, 1.6, 2.8], mat: 'stone', glow: DEEP, stripe: true }, // gap 2.00 flat, x[164.4,176.0] top 7.15
    /* 31 */ { kind: 'pendulum', p: [167.6, 13.41, 0], len: 3.6, amp: 0.54, period: 3.0, phase: 0, axis: [1, 0, 0], blade: { w: 2.8, h: 2.6, d: 0.26 } },
    /* 32 */ { kind: 'pendulum', p: [174.0, 14.47, 0], len: 3.6, amp: 0.46, period: 2.4, phase: Math.PI / 2, axis: [1, 0, 0], blade: { w: 2.8, h: 2.6, d: 0.26 } },

    /* 33 */ { kind: 'ice', p: [184.0, 7.05, 0], s: [10.4, 1.4, 3.0] },   // gap 2.80, dy +0.60, x[178.8,189.2] top 7.75
    /* 34 */ { kind: 'platform', p: [196.2, 7.35, 0], s: [7.0, 2.4, 7.0], mat: 'stone', glow: GOLD, stripe: true }, // gap 3.50, dy +0.80, top 8.55

    { kind: 'text', p: [165.0, 9.0, -1.9], rot: [0, -Math.PI / 2, 0], text: 'TIME THE SWING', size: 0.46, color: GOLD },
    { kind: 'text', p: [172.4, 9.6, -1.9], rot: [0, -Math.PI / 2, 0], text: 'CROUCH  ·  this one hangs high', size: 0.34, color: ICE },

    { kind: 'deco', model: 'spire/rope', p: [167.6, 13.0, 0], count: 1, spread: 0, scale: 1.5, seed: 9145 },
    { kind: 'deco', model: 'spire/rope', p: [174.0, 14.1, 0], count: 1, spread: 0, scale: 1.5, seed: 9146 },
    { kind: 'deco', model: 'spire/banner', p: [170.2, 15.6, 3.0], count: 2, spread: 3.6, scale: 1.8, seed: 9147 },
    { kind: 'deco', model: 'spire/torch', p: [170.2, 7.43, -2.6], count: 1, spread: 0, scale: 1.5, seed: 9148 },
    // the truss the two blades hang from, directly over their pivots
    { kind: 'deco', kindOf: 'girders', p: [170.8, 15.6, 0], count: 6, spread: 4.0, scale: 2.4, seed: 9149, mat: 'metal' },
    { kind: 'deco', kindOf: 'spires', p: [180.0, 0.6, 8.8], count: 6, spread: 4.4, scale: 3.0, seed: 9150, mat: 'crystal' },
    { kind: 'light', p: [167.6, 10.0, 0], color: ICE, intensity: 12, distance: 22 },
    { kind: 'light', p: [174.0, 11.0, 0], color: GOLD, intensity: 11, distance: 20 },
    { kind: 'light', p: [186.0, 9.6, 0], color: HOT, intensity: 9, distance: 22, flicker: 0.08 },

    /* ============================================================================ */
    /* BEAT 7 — WIND OVER GLASS, AND OVER ICE                                       */
    /* Three spans, three fields. The fields abut at x 211.65 and 221.55, which are  */
    /* the MIDPOINTS of the first two gaps, so the push reverses while you are in    */
    /* the air. The third gap is deliberately inside one steady field: after two     */
    /* reversals you get one span you can lean into, and that contrast is the beat.  */
    /*                                                                              */
    /* THE PUSH IS COLOUR-CODED AND THE BOUNDARIES ARE BUILT. 12 -> AIR12, 14 ->     */
    /* AIR14 (visibly deeper), 10 -> AIR10 (nearly white). A mast stands at x 211.65 */
    /* and at x 221.55 with a streamer on it, so the two places the wind changes     */
    /* side are objects you can see from the take-off, not invisible planes.         */
    /*                                                                              */
    /* The 14 field is the middle one and the middle span is ICE 1.6 m wide: 54% of  */
    /* iceAccel, on 0.9 m of usable footing. That is the hardest three seconds here. */
    /* NO FIELD TOUCHES A CHECKPOINT: field 1 starts at x 202.0 (cp4's deck ends at  */
    /* 199.7) and field 3 stops at x 232.9 (cp5's deck starts at 232.9).             */
    /* ============================================================================ */

    /* 35 */ { kind: 'beam', p: [206.0, 8.3, 0], s: [8.0, 0.5, 1.2], mat: 'glass' },   // gap 2.30 flat, x[202.0,210.0] top 8.55
    /* 36 */ { kind: 'wind', p: [206.825, 10.55, 0], s: [9.65, 6, 13], dir: [0, 0, -1], power: 12, color: AIR12 },

    /* 37 */ { kind: 'ice', p: [216.6, 8.45, 3.0], s: [6.6, 1.0, 1.6] },               // diagonal 3.67, dy +0.40, top 8.95
    /* 38 */ { kind: 'wind', p: [216.6, 10.95, 1.6], s: [9.9, 6, 13], dir: [0, 0, 1], power: 14, color: AIR14 },

    /* 39 */ { kind: 'beam', p: [226.4, 9.15, 0], s: [6.4, 0.5, 1.4], mat: 'glass' },  // diagonal 3.62, dy +0.45, top 9.40
    /* 40 */ { kind: 'wind', p: [227.225, 11.4, 0], s: [11.35, 6, 13], dir: [0, 0, -1], power: 10, color: AIR10 },

    /* 41 */ { kind: 'platform', p: [236.6, 9.0, 0], s: [7.4, 1.4, 7.4], mat: 'stone', glow: GOLD, stripe: true }, // gap 3.30, dy +0.30, top 9.70

    { kind: 'text', p: [200.0, 10.2, 1.9], rot: [0, -Math.PI / 2, 0], text: 'WIND  ·  deeper air shoves harder  ·  the masts are where it turns', size: 0.30, color: GOLD },

    // the two reversal masts — the boundary made physical
    { kind: 'deco', kindOf: 'antennae', p: [211.65, 9.0, 4.6], count: 1, spread: 0, scale: 2.6, seed: 9151, mat: 'metal' },
    { kind: 'deco', kindOf: 'antennae', p: [211.65, 9.0, -4.6], count: 1, spread: 0, scale: 2.6, seed: 9152, mat: 'metal' },
    { kind: 'deco', model: 'spire/banner', p: [211.65, 11.6, 4.6], count: 1, spread: 0, scale: 1.6, seed: 9153 },
    { kind: 'deco', kindOf: 'antennae', p: [221.55, 9.4, 4.6], count: 1, spread: 0, scale: 2.6, seed: 9154, mat: 'metal' },
    { kind: 'deco', kindOf: 'antennae', p: [221.55, 9.4, -4.6], count: 1, spread: 0, scale: 2.6, seed: 9155, mat: 'metal' },
    { kind: 'deco', model: 'spire/banner', p: [221.55, 12.0, -4.6], count: 1, spread: 0, scale: 1.6, seed: 9156 },
    { kind: 'deco', model: 'spire/rope', p: [216.6, 8.95, -2.6], count: 1, spread: 0, scale: 1.3, seed: 9157 },
    { kind: 'deco', kindOf: 'fins', p: [214.0, 1.4, -9.6], count: 7, spread: 4.8, scale: 2.6, seed: 9158, mat: 'crystal' },
    { kind: 'light', p: [211.65, 11.4, 0], color: ICE, intensity: 9, distance: 26 },
    { kind: 'light', p: [226.4, 11.8, 0], color: ICE, intensity: 9, distance: 24 },

    /* ============================================================================ */
    /* BEAT 8 — THE CHIMNEY   (NEW VERB : WALL-SLIDE / WALL-JUMP)                   */
    /*                                                                              */
    /* A built stack, not two boxes: a shaft floor at 9.50, two brick-and-ice walls  */
    /* that are NOT mirror images (the north one is 8.8 m long and starts at y 9.1,  */
    /* the south one 8.0 m and starts at 8.7, and only the north one carries the     */
    /* torch ladder). Both stop FLUSH with the mouth at 15.60, so the rim you land   */
    /* on after the fourth bounce is a real ledge and not geometry hanging over the  */
    /* climb; the cap the smoke never came out of sits 1.8 m higher again, out of    */
    /* reach and out of the way.                                                     */
    /*                                                                              */
    /* THE CLIMB, from tuning.js: 2.8 m of clear air between the walls, 2.1 m of it  */
    /* usable after the player's radius. wallJumpV [7.4, 11.0] crosses that in       */
    /* 0.284 s against an apex at 0.289 s, so each bounce is worth 1.592 m and the   */
    /* bounces land at 11.09 / 12.68 / 14.27 / 15.86. FOUR BOUNCES CLEAR THE MOUTH   */
    /* AT 15.60.                                                                    */
    /*                                                                              */
    /* WHY ANYONE WOULD BOTHER: COIN 3 hangs at y 12.80, dead centre of the shaft.   */
    /* That is 3.30 m over the floor and the standing apex is 2.09 m, so the second  */
    /* bounce is the only thing in the movement set that reaches it. (You can dive    */
    /* back down the shaft from the rim to clip it, and then you are on the floor     */
    /* again with the climb still to do — which is not a shortcut, it is a lap.)      */
    /* Nothing forces you up the chimney. The stage just makes sure the new verb      */
    /* is the fast one AND the paid one, which is the way round the last draft had    */
    /* it backwards.                                                                  */
    /* ============================================================================ */

    /* 42 */ { kind: 'platform', p: [246.6, 8.9, 0], s: [9.0, 1.2, 6.0], mat: 'stone', glow: DEEP, stripe: true }, // gap 1.80, dy -0.20, x[242.1,251.1] z[-3,3] top 9.50

    // The two walls. `platform` with an ice SKIN, not kind:'ice' — they are vertical,
    // so their faces are never stood on and must not carry ice friction. Their tops
    // are flush with the mouth at 15.60, which makes the rim you land on after the
    // fourth bounce a real surface instead of geometry hanging over the climb.
    /* 43 */ { kind: 'platform', p: [247.2, 12.35, -2.1], s: [8.8, 6.5, 1.4], mat: 'ice', glow: ICE },  // x[242.8,251.6] z[-2.8,-1.4], base 9.10, top 15.60
    /* 44 */ { kind: 'platform', p: [246.4, 12.15, 2.1], s: [8.0, 6.9, 1.4], mat: 'ice', glow: ICE },   // x[242.4,250.4] z[1.4,2.8],  base 8.70, top 15.60

    /* 45 */ { kind: 'platform', p: [255.8, 15.1, 0], s: [7.4, 1.0, 5.0], mat: 'stone', glow: GOLD, stripe: true }, // the mouth, x[252.1,259.5] z[-2.5,2.5] top 15.60

    { kind: 'text', p: [240.8, 11.6, 0], rot: [0, -Math.PI / 2, 0], text: 'JUMP AT THE WALL  ·  hold toward it, then SPACE, then the far wall', size: 0.36, color: GOLD },
    { kind: 'text', p: [242.4, 10.3, 4.4], rot: [0, -Math.PI / 2, 0], text: 'OR RIDE THE HOIST  ·  slower, and it does not pass the coin', size: 0.28, color: ICE },

    // the stack: brick courses on the outside faces, a torch ladder up the north
    // wall, a debris cone on the floor, and the cap the smoke never came out of
    { kind: 'deco', model: 'spire/brick_b', p: [247.2, 9.6, -3.1], count: 7, spread: 2.6, scale: 1.0, seed: 9159 },
    { kind: 'deco', model: 'spire/brick_a', p: [246.4, 9.2, 3.1], count: 7, spread: 2.4, scale: 1.0, seed: 9160 },
    { kind: 'deco', model: 'spire/torch', p: [244.4, 11.3, -3.0], count: 1, spread: 0, scale: 1.5, seed: 9161 },
    { kind: 'deco', model: 'spire/torch', p: [247.6, 13.4, -3.0], count: 1, spread: 0, scale: 1.5, seed: 9162 },
    { kind: 'deco', model: 'spire/torch', p: [250.4, 15.5, -3.0], count: 1, spread: 0, scale: 1.5, seed: 9163 },
    { kind: 'deco', model: 'spire/rubble', p: [244.0, 9.5, 2.0], count: 5, spread: 1.8, scale: 1.2, seed: 9164 },
    { kind: 'deco', model: 'spire/coil', p: [249.6, 9.5, -2.0], count: 1, spread: 0, scale: 1.3, seed: 9165 },
    { kind: 'deco', kindOf: 'girders', p: [246.8, 17.4, 0], count: 6, spread: 2.8, scale: 2.2, seed: 9166, mat: 'metal' },
    { kind: 'deco', kindOf: 'crystals', p: [246.8, 17.9, 0], count: 5, spread: 2.2, scale: 1.8, seed: 9167, mat: 'crystal' },
    { kind: 'light', p: [247.0, 12.8, 0], color: ICE, intensity: 13, distance: 20 },
    { kind: 'light', p: [255.0, 17.2, 0], color: GOLD, intensity: 11, distance: 24 },

    /* ---------------------------------------------------------------------------- */
    /* BEAT 8b — THE MASONS' HOIST  (the slow way up, for anyone who does not        */
    /* wall-jump). A counterweighted platform in a timber frame on the shaft's south */
    /* face, running the same 6.10 m the chimney does, on a 5.0 s cycle: it is at    */
    /* the bottom at t = 0 and every 5 s after, so you wait up to five seconds and   */
    /* then ride two and a half. Call it eight seconds against the chimney's two.    */
    /*                                                                              */
    /* IT IS SLOW, NEVER HARDER — stepping on is a 1.20 m sidestep off the shaft     */
    /* floor and stepping off is a 1.73 m diagonal onto the mouth. Both are inside   */
    /* the run-jump safe budget twice over, and both are easier than anything the    */
    /* main line has asked for since BEAT 2. And the hoist does not pass COIN 3.     */
    /* ---------------------------------------------------------------------------- */

    /* 46 */ {
      kind: 'mover', p: [250.2, 9.0, 5.8], s: [3.2, 1, 3.2], mat: 'metal',
      motion: { type: 'oscillate', to: [250.2, 15.1, 5.8], period: 5.0, phase: 0.75, ease: 'sine' },
    }, // x[248.6,251.8] z[4.2,7.4]; deck at 9.50 at the bottom and 15.60 at the top

    { kind: 'deco', kindOf: 'girders', p: [250.2, 12.6, 7.8], count: 6, spread: 1.6, scale: 2.6, seed: 9168, mat: 'metal' }, // the hoist frame
    { kind: 'deco', model: 'spire/rope', p: [250.2, 16.0, 5.8], count: 1, spread: 0, scale: 1.6, seed: 9169 },
    { kind: 'deco', model: 'spire/coil', p: [252.4, 15.7, 5.8], count: 1, spread: 0, scale: 1.4, seed: 9170 },
    { kind: 'deco', model: 'spire/crate', p: [247.6, 9.55, 5.4], count: 2, spread: 1.2, scale: 1.1, seed: 9171 },
    { kind: 'deco', kindOf: 'crystals', p: [252.0, 7.4, 10.2], count: 7, spread: 4.0, scale: 2.2, seed: 9172, mat: 'crystal' },

    /* ============================================================================ */
    /* BEAT 9 — THE ANTECHAMBER AND THE TRAM                                        */
    /* Both routes out of the shaft land on the same ledge at 15.60, and then the    */
    /* floor steps UP 1.00 m onto the ice pad — the beat's own height break, and the  */
    /* reason the antechamber does not read as more of the corridor you just left.    */
    /* The pad is 7.4 m long with its bed at the FAR end: 5.2 m of landing strip      */
    /* after a 1.10 m step, against the 1.42 m it takes to brake on ice.              */
    /*                                                                              */
    /* THE TRAM RUNS ON A 3.4 s CYCLE, NOT 6.4. `phase` is a FRACTION (movers.js:437 */
    /* -> pos = lerp(p, to, 0.5 + 0.5*sin(TAU*(t/period + phase)))), and 0.75 puts   */
    /* the car at the NEAR end at t = 0 and every 3.4 s after. So the worst wait is  */
    /* 3.4 s, the average 1.7, and the ride is 1.7 — about three and a half seconds  */
    /* of tram against the ten the last draft charged for the same eight metres.     */
    /* cp6 sits on the pad with clockOffset 0.30, which is where the car is already  */
    /* pulling in, so a death here does not also buy you a wait.                     */
    /*                                                                              */
    /* AND A MOVING PLATFORM IS STILL NEVER THE ONLY WAY ACROSS: the walkway the     */
    /* tram replaced runs down the SOUTH side of the track, two stones at 16.30 and  */
    /* 16.80, BESIDE the rails and never under them. (A car passing 0.30 m over your */
    /* head is not an alternative route, and that is exactly what a low road under   */
    /* this track measured — geomcheck called it as a hard headroom failure.)        */
    /* ============================================================================ */

    /* 47 */ { kind: 'platform', p: [266.0, 15.1, 0], s: [6.4, 1.0, 6.0], mat: 'stone', glow: DEEP, stripe: true }, // gap 3.30 from the mouth, x[262.8,269.2] top 15.60
    /* 48 */ { kind: 'ice', p: [274.0, 16.05, 0], s: [7.4, 1.1, 5.4] },   // gap 1.10, dy +1.00, x[270.3,277.7] top 16.60
    /* 49 */ { kind: 'spikes', p: [276.2, 16.95, 0], s: [1.4, 0.7, 5.6], dir: [0, 1, 0], mode: 'retract', cycle: { on: 1.0, off: 1.6, warn: 0.45, phase: 0.5 } },

    /* 50 */ {
      kind: 'mover', p: [280.4, 16.1, 0], s: [3.6, 1, 3.6], mat: 'metal',
      motion: { type: 'oscillate', to: [288.0, 16.1, 0], period: 3.4, phase: 0.75, ease: 'sine' },
    }, // at the NEAR end at t = 0 and every 3.4 s after; boards x[278.6,282.2], lands x[286.2,289.8]

    // The old walkway the tram replaced, two stones down the SOUTH side of the
    // track — beside it, never under it, so nothing ever passes over your head.
    /* 51 */ { kind: 'platform', p: [280.6, 15.8, -7.6], s: [3.6, 1, 3.4], mat: 'panel', glow: ICE, stripe: true },  // diagonal 3.38 off the pad, dy -0.30, x[278.8,282.4] z[-9.3,-5.9] top 16.30
    /* 52 */ { kind: 'platform', p: [287.6, 16.3, -7.6], s: [3.6, 1, 3.4], mat: 'panel', glow: ICE, stripe: true },  // gap 3.40, dy +0.50, x[285.8,289.4] z[-9.3,-5.9] top 16.80

    /* 53 */ { kind: 'platform', p: [296.8, 16.7, 0], s: [8.0, 1.4, 7.6], mat: 'stone', glow: DEEP, stripe: true }, // the terrace, diagonal 4.00 off the old road (dy +0.60), gap 3.00 off the tram (dy +0.80), x[292.8,300.8] top 17.40

    { kind: 'text', p: [279.0, 16.9, -3.4], rot: [0, -Math.PI / 2, 0], text: 'it comes back every 3.4 s  ·  or walk the old road', size: 0.26, color: ICE },

    // the altar the masons did finish, and the gantry the tram runs under
    { kind: 'deco', kindOf: 'slabs', p: [296.8, 15.7, 3.2], count: 5, spread: 2.2, scale: 2.2, seed: 9171, mat: 'stone' },
    { kind: 'deco', model: 'spire/torch', p: [296.8, 15.98, 2.8], count: 1, spread: 0, scale: 1.6, seed: 9172 },
    { kind: 'deco', model: 'spire/crate', p: [274.0, 15.75, -3.2], count: 2, spread: 1.4, scale: 1.1, seed: 9173 },
    { kind: 'deco', kindOf: 'girders', p: [284.8, 19.4, 0], count: 7, spread: 5.0, scale: 2.2, seed: 9174, mat: 'metal' },
    { kind: 'deco', model: 'spire/rope', p: [281.0, 18.6, 0], count: 1, spread: 0, scale: 1.4, seed: 9175 },
    { kind: 'deco', model: 'spire/rope', p: [288.6, 18.6, 0], count: 1, spread: 0, scale: 1.4, seed: 9176 },
    { kind: 'light', p: [276.2, 17.4, 0], color: HOT, intensity: 9, distance: 18, flicker: 0.1 },
    { kind: 'light', p: [285.0, 18.0, 0], color: ICE, intensity: 10, distance: 26 },

    /* ============================================================================ */
    /* BEAT 10 — THE CHANDELIER, THE LAMP ROOM, AND THE SHELF                       */
    /*                                                                              */
    /* Five verbs, and no two of them are the same machine:                         */
    /*   1  A TIMED PLANK. A cycling vanish tile (on 2.6 / warn 0.6 / off 1.6,       */
    /*      period 4.8; `phase` is a FRACTION per vanish.js). IT IS NOT OPTIONAL,     */
    /*      and this is measured, not asserted: the terrace ends at x 300.8 and the   */
    /*      glass bridge starts at x 310.3, a 9.50 m gap at a 1.60 m drop, against a  */
    /*      SPRINT reach of 8.55 m at that drop. There is no jump that deletes beat   */
    /*      one of the finale. (The last draft left a 6.10 m sprint straight over it, */
    /*      inside the forbidden band — a coin-flip shortcut past its own content.)   */
    /*   2  A GLASS BRIDGE 1.4 m wide under two blades swinging ALONG the corridor   */
    /*      (axis +Z), so they come at you head-on and their 3.0 m span covers the   */
    /*      whole width. No sidestep exists. You read a window and you run it.       */
    /*   3  AN ICE BRIDGE 4.6 m wide under the chandelier's COUNTERWEIGHT RING — a   */
    /*      three-armed bar turning at ankle height, one arm past you every 1.2 s.   */
    /*      Opposite problem: nothing to time, everything to keep doing, on a floor  */
    /*      you cannot stop on. Wide and slippery reads nothing like narrow and      */
    /*      still, which is what made the last draft's second bridge a wash.         */
    /*   4  THE LAMP ROOM, and the piston in its north wall. One clean gate, taken   */
    /*      standing still, after ninety seconds of not standing still.              */
    /*   5  THE SHELF: five crumbling tiles that are five different jumps — a 4.00 m */
    /*      REACH (92% of the run budget, the longest jump on the stage), a 1.30 m   */
    /*      DROP onto a tile BELOW you, a 6.4 m PLANK you must commit to end to end, */
    /*      a +1.20 CLIMB and a +0.80 finish onto the belfry. Gaps 4.00 / 3.09 /     */
    /*      3.10 / 2.81 / 3.55 / 2.50, rises +0.10 / -1.30 / +0.50 / +1.20 / +0.80 / */
    /*      0.00. The last draft's shelf was five hops of 2.14-2.90 m at +0.35-+0.50 */
    /*      — one jump five times, wearing decimal noise, at the moment the stage    */
    /*      should peak.                                                            */
    /*                                                                              */
    /* THE CHANDELIER IS BUILT. Both blades hang off a corona at y 21.4 (a cage 3.4  */
    /* m across) centred between their pivots; the corona hangs on four chains from  */
    /* the rib band at 22.9; a ring of candle crystals sits on it at 21.9; and the   */
    /* counterweight ring over the ice bridge has its own gantry at 20.4 with a      */
    /* chain down to the hub. Nothing on this stage swings out of empty air any      */
    /* more — the last draft hung four blades off pivots with 1.0 m of nothing       */
    /* between them and the nearest scatter cloud.                                   */
    /* Blade geometry for {w 3.0, h 2.4, d 0.24}, len 3.4: painted tip = pivot-5.715 */
    /* and kill capsule bottom = pivot-5.368. Both pivots are at 21.70 over a bridge */
    /* at 15.80: tip clearance 0.185 m, kill capsule clearance 0.532 m.              */
    /*                                                                              */
    /* COIN 4 is BELOW the corridor — you step off the ice bridge onto a ledge at    */
    /* 13.50 and a launch pad throws you back up. The only place on the stage that   */
    /* goes down on purpose.                                                        */
    /* ============================================================================ */

    /* 54 */ { kind: 'vanish', p: [305.4, 15.25, 0], s: [4.0, 0.5, 2.0], mat: 'ice', mode: 'cycle', cycle: { on: 2.6, warn: 0.6, off: 1.6, phase: 0 } }, // gap 2.60 and DOWN 1.90 off the terrace, x[303.4,307.4] top 15.50

    /* 55 */ { kind: 'beam', p: [316.0, 15.55, 0], s: [11.4, 0.5, 1.4], mat: 'glass' },  // gap 2.90, dy +0.30, x[310.3,321.7] top 15.80
    /* 56 */ { kind: 'pendulum', p: [313.0, 21.70, 0], len: 3.4, amp: 0.55, period: 2.8, phase: 0, axis: [0, 0, 1], blade: { w: 3.0, h: 2.4, d: 0.24 } },
    /* 57 */ { kind: 'pendulum', p: [319.6, 21.70, 0], len: 3.4, amp: 0.50, period: 3.4, phase: 1.05, axis: [0, 0, 1], blade: { w: 3.0, h: 2.4, d: 0.24 } },

    /* 58 */ { kind: 'ice', p: [328.4, 15.7, 0], s: [9.6, 0.8, 4.6] },   // gap 1.90, dy +0.30, x[323.6,333.2] top 16.10
    /* 59 */ { kind: 'rotor', p: [328.4, 16.55, 0], style: 'bar', arms: 3, len: 2.6, thick: 0.32, period: 3.6, phase: 0, axis: [0, 1, 0] },

    // -- the optional line: off the bridge, down, and a pad back up ----------------
    /* 60 */ { kind: 'platform', p: [332.0, 13.0, 5.6], s: [3.6, 1, 3.4], mat: 'obsidian', glow: HOT, stripe: true }, // 1.60 m lateral and 2.60 DOWN, x[330.2,333.8] z[3.9,7.3] top 13.50
    /* 61 */ { kind: 'jumppad', p: [332.0, 13.57, 5.6], s: [3.0, 0.14, 3.0], power: 4.6, dir: [0, 1, 0] },
    { kind: 'deco', kindOf: 'crystals', p: [332.0, 13.5, 7.4], count: 4, spread: 0.7, scale: 1.3, seed: 9177, mat: 'emissive', glow: 3 },
    { kind: 'light', p: [332.0, 15.2, 5.6], color: HOT, intensity: 8, distance: 16 },

    /* 62 */ { kind: 'platform', p: [340.0, 15.55, 0], s: [8.4, 1.4, 7.0], mat: 'obsidian', glow: GOLD, stripe: true }, // the lamp room, gap 2.60, dy +0.15, x[335.8,344.2] top 16.25
    /* 63 */ { kind: 'crusher', p: [337.4, 17.35, 4.4], s: [2.4, 1.8, 2.2], axis: [0, 0, -1], travel: 4.0, period: 4.0, phase: 0.0, dwell: 1.0, mat: 'metal' },

    // The chandelier, built: corona, chains, candle ring, and the rib band it hangs on.
    { kind: 'deco', model: 'spire/cage', p: [316.3, 21.4, 0], count: 1, spread: 0, scale: 3.4, seed: 9178 },
    { kind: 'deco', kindOf: 'crystals', p: [316.3, 21.9, 0], count: 8, spread: 1.7, scale: 1.5, seed: 9179, mat: 'crystal' },
    { kind: 'deco', model: 'spire/rope', p: [313.0, 22.2, 0], count: 1, spread: 0, scale: 1.6, seed: 9180 },
    { kind: 'deco', model: 'spire/rope', p: [319.6, 22.2, 0], count: 1, spread: 0, scale: 1.6, seed: 9181 },
    { kind: 'deco', model: 'spire/rope', p: [316.3, 22.2, 2.4], count: 1, spread: 0, scale: 1.6, seed: 9182 },
    { kind: 'deco', model: 'spire/rope', p: [316.3, 22.2, -2.4], count: 1, spread: 0, scale: 1.6, seed: 9183 },
    { kind: 'deco', kindOf: 'girders', p: [316.3, 22.9, 0], count: 8, spread: 4.6, scale: 2.6, seed: 9184, mat: 'metal' },
    // the ring's own gantry over the ice bridge
    { kind: 'deco', kindOf: 'girders', p: [328.4, 20.4, 0], count: 5, spread: 3.0, scale: 2.2, seed: 9185, mat: 'metal' },
    { kind: 'deco', model: 'spire/rope', p: [328.4, 18.6, 0], count: 1, spread: 0, scale: 1.5, seed: 9186 },
    { kind: 'deco', model: 'spire/banner', p: [322.0, 20.4, -4.2], count: 2, spread: 4.0, scale: 1.9, seed: 9187 },

    // the lamp room's four corner piers and its lantern
    { kind: 'deco', kindOf: 'slabs', p: [336.4, 16.3, 4.2], count: 1, spread: 0, scale: 4.4, seed: 9188, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [343.6, 16.3, 4.2], count: 1, spread: 0, scale: 4.4, seed: 9189, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [336.4, 16.3, -4.2], count: 1, spread: 0, scale: 4.4, seed: 9190, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [343.6, 16.3, -4.2], count: 1, spread: 0, scale: 4.4, seed: 9191, mat: 'stone' },
    { kind: 'deco', model: 'spire/torch', p: [336.4, 16.53, -3.2], count: 1, spread: 0, scale: 1.6, seed: 9192 },
    { kind: 'deco', model: 'spire/torch', p: [343.6, 16.53, -3.2], count: 1, spread: 0, scale: 1.6, seed: 9193 },
    { kind: 'deco', model: 'spire/cage', p: [340.0, 19.6, 0], count: 1, spread: 0, scale: 2.4, seed: 9194 },
    { kind: 'deco', kindOf: 'girders', p: [340.0, 20.8, 0], count: 6, spread: 3.6, scale: 2.2, seed: 9195, mat: 'metal' },

    { kind: 'text', p: [300.0, 18.0, 0], rot: [0, -Math.PI / 2, 0], text: 'THE CHANDELIER  ·  they swing along the bridge, not across it', size: 0.40, color: GOLD },
    { kind: 'light', p: [316.3, 19.4, 0], color: ICE, intensity: 15, distance: 28 },
    { kind: 'light', p: [328.4, 19.4, 0], color: HOT, intensity: 13, distance: 26, flicker: 0.07 },
    { kind: 'light', p: [340.0, 18.8, 0], color: GOLD, intensity: 12, distance: 22 },

    // -- the shelf ---------------------------------------------------------------
    { kind: 'text', p: [346.4, 18.4, 0], rot: [0, -Math.PI / 2, 0], text: 'DO NOT STOP  ·  the second tile is BELOW you', size: 0.42, color: HOT },

    /* 64 */ { kind: 'vanish', p: [350.2, 15.85, -2.2], s: [4.0, 1, 3.2], mat: 'ice', mode: 'crumble', crackDelay: 0.42, chunkLife: 2.4 }, // THE REACH: gap 4.00, dy +0.10, top 16.35 — 92% of the 4.35 m run budget
    /* 65 */ { kind: 'vanish', p: [356.6, 14.55, 2.4], s: [3.4, 1, 3.0], mat: 'ice', mode: 'crumble', crackDelay: 0.34, chunkLife: 2.2 },  // THE DROP: 3.09 diagonal, dy -1.30, top 15.05
    /* 66 */ { kind: 'vanish', p: [364.6, 15.05, 0], s: [6.4, 1, 1.8], mat: 'ice', mode: 'crumble', crackDelay: 0.30, chunkLife: 2.0 },    // THE PLANK: 6.4 long, 1.8 wide, top 15.55
    /* 67 */ { kind: 'vanish', p: [372.2, 16.25, -2.6], s: [3.2, 1, 3.0], mat: 'ice', mode: 'crumble', crackDelay: 0.26, chunkLife: 1.8 }, // THE CLIMB: 2.81, dy +1.20, top 16.75
    /* 68 */ { kind: 'vanish', p: [378.6, 17.05, 1.6], s: [3.0, 1, 2.8], mat: 'ice', mode: 'crumble', crackDelay: 0.22, chunkLife: 1.6 },  // 3.55 diagonal, dy +0.80, top 17.55

    /* 69 */ { kind: 'platform', p: [386.6, 17.05, 0], s: [8, 1, 9], mat: 'obsidian', glow: GOLD, stripe: true }, // the belfry, gap 2.50 flat, top 17.55

    // Finish architecture — the bell the cathedral never got, in the cage they hung for it.
    { kind: 'deco', model: 'spire/cage', p: [386.6, 22.6, 0], count: 1, spread: 0, scale: 3.4, seed: 9196 },
    { kind: 'deco', model: 'spire/rope', p: [386.6, 20.4, 0], count: 1, spread: 0, scale: 1.6, seed: 9197 },
    { kind: 'deco', model: 'spire/torch', p: [383.4, 17.83, -3.6], count: 1, spread: 0, scale: 1.7, seed: 9198 },
    { kind: 'deco', model: 'spire/torch', p: [389.8, 17.83, -3.6], count: 1, spread: 0, scale: 1.7, seed: 9199 },
    { kind: 'deco', model: 'spire/banner', p: [386.6, 24.0, 0], count: 3, spread: 4.0, scale: 2.0, seed: 9200 },
    { kind: 'deco', kindOf: 'girders', p: [386.6, 21.4, 0], count: 8, spread: 4.6, scale: 2.4, seed: 9201, mat: 'metal' },
    { kind: 'deco', kindOf: 'slabs', p: [386.6, 17.6, 5.4], count: 5, spread: 2.4, scale: 2.2, seed: 9202, mat: 'stone' },
    { kind: 'text', p: [383.0, 20.0, 0], rot: [0, -Math.PI / 2, 0], text: 'GLASS TEETH', size: 0.42, color: GOLD },
    { kind: 'light', p: [386.6, 21.0, 0], color: GOLD, intensity: 24, distance: 36 },
    { kind: 'light', p: [366.0, 19.2, 0], color: HOT, intensity: 10, distance: 28, flicker: 0.09 },

    /* ============================================================================ */
    /* THE GLACIER — everything below and beside the course. All of it is at |z| >=  */
    /* 13 or below y = -3, i.e. nowhere a player could read it as a landing. Seracs  */
    /* rise as the route rises so the horizon climbs with you.                       */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'spires', p: [60, -14, 32], count: 9, spread: 26, scale: 9, seed: 1201, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [60, -16, -32], count: 9, spread: 26, scale: 9, seed: 1302, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [180, -6, 36], count: 9, spread: 28, scale: 11, seed: 1403, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [230, -8, -36], count: 9, spread: 28, scale: 11, seed: 1504, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [330, 2, 34], count: 8, spread: 26, scale: 10, seed: 1806, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [360, 0, -34], count: 8, spread: 26, scale: 10, seed: 1809, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'crystals', p: [150, 2, 24], count: 12, spread: 16, scale: 5, seed: 1605, mat: 'crystal' },
    { kind: 'deco', kindOf: 'crystals', p: [290, 8, -26], count: 12, spread: 16, scale: 5, seed: 1706, mat: 'crystal' },
    { kind: 'deco', kindOf: 'rocks', p: [180, -26, 0], count: 16, spread: 60, scale: 8, seed: 1807, mat: 'obsidian' },

    // Route lights, one per beat, so the line reads from the far end of the glacier.
    { kind: 'light', p: [22, 3.4, 0], color: ICE, intensity: 7, distance: 24 },
    { kind: 'light', p: [61, 5.6, 0], color: ICE, intensity: 7, distance: 22 },
    { kind: 'light', p: [158, 9.2, 0], color: GOLD, intensity: 9, distance: 24 },
    { kind: 'light', p: [196, 11.0, 0], color: GOLD, intensity: 10, distance: 26 },
    { kind: 'light', p: [236, 12.4, 0], color: GOLD, intensity: 10, distance: 26 },
    { kind: 'light', p: [296, 18.4, 0], color: GOLD, intensity: 10, distance: 26 },
  ],
};
