/**
 * ASCENDANT — FROZEN SPIRE 1 : "FIRST FROST"
 * runtime/data/stages/spire-1.js
 *
 * The opener of the ice world. A glacial tower with terraces cut into its outside
 * face, a low orange sun grazing every ice edge, and snow going sideways past you.
 * The whole stage exists to rewrite one number you have already learned: friction.
 *
 * SHAPE      ~283 m of travel, 56 gameplay objects, 36 dynamic hazards,
 *            5 checkpoints (never more than 62 m apart), 3 coins.
 *
 * THE WORLD MECHANIC IS ICE (TUNE.iceFriction 1.4 against 13, iceAccel 26 against 95).
 * Every jump the DOJO taught still works — you just cannot start one, stop one or
 * cancel one the way you used to. So ice is taught by adding ONE consequence at a
 * time, in this order, and never two of them on the same slab:
 *
 *   BEAT 2   ice, walled in       — you slide, and it costs you nothing
 *   BEAT 3   ice with a drop      — the slab ends over the void; brake or wear it
 *   BEAT 4   ice with a gap       — take off FROM ice and land ON ice
 *   BEAT 5   ice on a mover       — the slab is sliding too, and in another direction
 *   BEAT 6   wind, alone          — on a deck 14 m wide, so the push is information
 *   BEAT 7   wind over a drop     — same push, no deck. Stone underfoot on purpose.
 *   BEAT 8   ice AND wind         — the first time both are true at once
 *   BEAT 10  the spiral, where both are true for thirty-three unbroken metres
 *
 * WIDTH IS THE DIFFICULTY DIAL AND IT IS TURNED DOWN. Narrow ice is not hard, it is
 * arbitrary: the player loses to a surface they cannot read instead of to a decision
 * they made. Every ice slab on the main line here is 7–10 m across, every ice gap is
 * under 3.4 m, and the punishment for over-carrying is always a fall you can SEE from
 * the slab you are standing on. Difficulty 4 lives in the combinations, not the widths.
 *
 * —— THE HOUSE RULES (stated in full at the top of neon-1.js) ————————————
 * 1. The reach envelope is law (CONTRACT section 0). Nothing on the main line of this
 *    stage requires a sprint; the longest flat gap is 3.3 m against a 4.35 m budget.
 * 2. Mind the surface you did not mean to offer. The validator graphs EVERY pair of
 *    landable surfaces, so N to N+2 matters as much as N to N+1, and two bands are
 *    forbidden because a jump inside them is one a player can *just barely* make:
 *    4.36-5.24 m flat and 6.18-7.44 m flat (both widen as the landing drops). Every
 *    pair in this file was measured: `_harness/reachcheck.mjs` reports tightEdges 0.
 *    This rule is what shaped BEAT 10 — see the note there, it is the whole reason the
 *    ice plates OVERLAP instead of merely abutting.
 * 3. Every link must be jumpable. The two ice shuttles in BEAT 5 are rides, not the
 *    only way across: both are boarded and left over gaps under 3.3 m, and the launch
 *    pad in BEAT 8 has a 5.4 m sprint line beside it for anyone who steps off the pad.
 * 4. Timed hazards are pure functions of the stage clock (CONTRACT section 16), and
 *    `phase` is a FRACTION OF ONE CYCLE (0..1) for vanish tiles and rotors alike —
 *    never seconds. The two thin-ice tiles step by 0.2 of a 6.1 s cycle.
 * 5. Vary gap, height and width constantly. The only place this file repeats itself is
 *    BEAT 8, where two 9 m ice slabs sit 2.4 m apart with the wind reversed between
 *    them — the repetition IS the lesson, and it is stated in that beat's comment.
 * 6. Every landing is visible from its take-off.
 *
 * CONVENTIONS (full list in runtime/data/index.js):
 *   p = CENTRE, s = FULL size, top surface = p[1] + s[1]/2. Gaps in the comments are
 *   EDGE TO EDGE. rot/yaw in radians, yaw 0 faces +X. `stripe: true` = must jump here.
 *   A mover's `p` is its HOME pose, `motion.to` its far pose; the validator treats BOTH
 *   as landable, and boarding gaps below are quoted at the pose you actually board.
 *   A `wind` volume is not solid and never becomes an accidental wall. Its box is
 *   centred about 2.5 m ABOVE the walk line and stands 6–8 m tall, because WindHazard
 *   tapers its force to zero at the box faces: centre it ON the deck and the player's
 *   feet sit in the dead zone and feel nothing.
 *
 * REACH BUDGET USED (safe limits: run 4.35 flat / 3.86 at +0.9 / 3.77 at +1.05):
 *   longest flat gap on the main line   3.3 m   (BEAT 4, ice slab 1 to ice slab 2)
 *   longest rise                        1.05 m over 2.5 m   (BEAT 3, out of the bowl)
 *   longest diagonal                    3.25 m  (BEAT 5, boarding the crossing shuttle)
 *   the one jump that wants a sprint    5.4 m   (BEAT 8) and it is NOT the route: a
 *                                       launch pad sits on the same lip and clears the
 *                                       same slab with 7.7 m of throw. 15 m of straight
 *                                       run-up either way, so a sprinter is rewarded
 *                                       and a walker is never stranded.
 *   riskiest optional line              3.6 m onto a 3 m ICE pad hung over the drop
 *                                       (COIN 1) — landing is easy, stopping is the price
 *
 * CHECKPOINTS. Five, at 40.5 / 76.4 / 108.6 / 170.0 / 204.6, each on the last solid
 * thing before a new consequence appears, and never more than 62 m apart. The run from
 * the last one to the finish is the longest at 78 m (~30 s), because BEAT 8 and the
 * spiral are one sentence and a respawn in the middle of it would break the set-piece.
 *
 * HEIGHT LADDER: 0.5 (the ledge) -> 0.8 -> 1.55 (the bowl rim) -> 2.45 (the shuttles)
 *                -> 2.95 (the wind deck) -> 3.45 (the catwalk and the bottom tread)
 *                -> 3.95 .. 6.45 (the spiral) -> 6.95 (the summit).
 */

const ICE = 0xa8e4ff;   // world accent — the main line reads in this colour
const SUN = 0xffc94a;   // theme safeEdge — the low sun on every ice lip; optional lines
const HAZE = 0x5f8caa;  // dim structural blue — floors you merely walk on
const COLD = 0x2f74b0;  // deep glacier blue — background architecture

export default {
  id: 'spire-1',
  world: 'spire',
  name: 'FIRST FROST',
  subtitle: 'Everything you know about stopping is wrong',
  par: 148000,
  difficulty: 4,

  spawn: { p: [0, 0.6, 0], yaw: 0 },
  killY: -40,

  checkpoints: [
    // On the terrace at the far end of the walled ice, looking at the first slab that
    // ends over nothing. Everything before this point is un-loseable.
    { p: [40.5, 0.6, 0], yaw: 0, clockOffset: 0 },
    // The bowl rim, before ice has to be jumped OFF as well as landed ON.
    { p: [76.4, 1.65, 0], yaw: 0, clockOffset: 0 },
    // The shuttle apron, before the ice starts moving underneath you.
    { p: [108.6, 2.55, 0], yaw: 0, clockOffset: 0 },
    // The downwind lip of the wind deck, before the deck runs out. clockOffset stays 0
    // like every other checkpoint here: the vane on the catwalk is 25 m further on, a
    // three-second walk, and it drops a blade every 2.0 s — so a respawn always shows
    // you at least one full pass before you are anywhere near it. Rewinding the clock
    // would buy nothing and cost the phase-lock with the two ice shuttles behind you.
    { p: [170.0, 3.05, 0], yaw: 0, clockOffset: 0 },
    // The launch lip. The last flat, still, un-slippery thing on the stage.
    { p: [204.6, 3.55, 0], yaw: 0, clockOffset: 0 },
  ],

  finish: { p: [282.5, 7.05, -4.0], yaw: 0 },

  coins: [
    { p: [96.0, 2.6, 10.9] },  // BEAT 4 — a 3 m ice pad hung out over the drop
    { p: [163.0, 4.1, 10.4] }, // BEAT 6 — a ledge downwind of the wind deck
    { p: [224.0, 4.5, 9.4] },  // BEAT 8 — ice, in a crosswind, on the wrong side
  ],

  objects: [
    /* ============================================================================ */
    /* BEAT 1 — THE LEDGE                                                           */
    /* Bare rimed stone, a gate, and three risers. No ice anywhere: the first twenty */
    /* seconds of an ice world should confirm that the controls still work.          */
    /* ============================================================================ */

    { kind: 'platform', p: [1.5, 0, 0], s: [13, 1, 14], mat: 'stone', glow: HAZE },

    // Three risers, 0.7 / 0.4 / 0.4 m up. Standing on the deck, so they are hops, not
    // jumps — the cheapest possible place to find out that SPACE is held for height.
    { kind: 'platform', p: [-0.4, 0.85, 4.4], s: [2.4, 0.7, 2.4], mat: 'panel', glow: ICE, stripe: true },
    { kind: 'platform', p: [2.1, 1.05, 4.4], s: [2.2, 1.1, 2.2], mat: 'panel', glow: ICE, stripe: true },
    { kind: 'platform', p: [4.4, 1.25, 4.4], s: [2.0, 1.5, 2.0], mat: 'panel', glow: ICE, stripe: true },

    { kind: 'text', p: [-6.2, 2.8, 0], rot: [0, -Math.PI / 2, 0], text: 'FIRST FROST', size: 0.8, color: 0x123244 },
    { kind: 'text', p: [-6.2, 2.15, 0], rot: [0, -Math.PI / 2, 0], text: 'FROZEN SPIRE  ·  I', size: 0.28, color: 0x3d6076 },
    { kind: 'text', p: [3.4, 1.5, -4.6], rot: [0, -Math.PI / 2, 0], text: 'W A S D  ·  S P A C E', size: 0.32, color: 0x1d4257 },
    { kind: 'text', p: [3.4, 1.0, -4.6], rot: [0, -Math.PI / 2, 0], text: 'the stone still behaves. enjoy it.', size: 0.24, color: 0x4a7290 },
    { kind: 'text', p: [4.4, 2.9, 4.4], rot: [0, -Math.PI / 2, 0], text: 'warm up', size: 0.24, color: SUN },

    // The threshold arch. Two buttresses and a lintel, so the stage has a front door.
    { kind: 'deco', kindOf: 'arch', p: [10.3, 4.6, 0], s: [1.0, 0.9, 15.0], mat: 'obsidian', tint: ICE },
    { kind: 'deco', kindOf: 'pillar', p: [10.3, 2.6, 6.4], s: [1.2, 5.2, 1.2], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'pillar', p: [10.3, 2.6, -6.4], s: [1.2, 5.2, 1.2], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'brazier', p: [5.4, 1.2, -5.4], s: [0.9, 1.3, 0.9], mat: 'metal', tint: SUN },
    { kind: 'light', p: [5.4, 2.2, -5.4], color: SUN, intensity: 7, distance: 14, flicker: 0.28 },
    { kind: 'light', p: [10.3, 4.0, 0], color: ICE, intensity: 9, distance: 22 },

    // gap 3.6 m, flat. The last jump on this stage that asks nothing of you.
    { kind: 'platform', p: [14.3, 0, 0], s: [5.4, 1, 6], mat: 'stone', glow: ICE, stripe: true },

    /* ============================================================================ */
    /* BEAT 2 — FIRST FROST : ICE YOU CANNOT FALL OFF                               */
    /* Nineteen metres of ice, ten metres wide, walled on both sides by a stone kerb */
    /* and terminating in more stone. There is no gap, no hazard and no drop in this  */
    /* beat, and that is the whole design: the ONLY new information is that you keep  */
    /* travelling after you let go of W, and it should cost exactly nothing to learn. */
    /* Walk on at 0.5, walk off at 0.5, discover you cannot walk off when you meant.  */
    /* ============================================================================ */

    { kind: 'ice', p: [26.5, 0.15, 0], s: [19, 0.7, 10], color: ICE }, // top 0.5, flush with the landing

    // The kerbs. 1.8 m of stone balustrade, deliberately readable as ARCHITECTURE and
    // not as a route: they are 0.7 m thick and 1.45 m above the ice, i.e. climbable if
    // you insist, and pointless if you do.
    { kind: 'platform', p: [26.5, 1.05, 5.35], s: [19, 1.8, 0.7], mat: 'stone', glow: HAZE },
    { kind: 'platform', p: [26.5, 1.05, -5.35], s: [19, 1.8, 0.7], mat: 'stone', glow: HAZE },

    { kind: 'platform', p: [39.7, 0, 0], s: [7.4, 1, 9], mat: 'stone', glow: HAZE }, // top 0.5, flush again

    { kind: 'text', p: [18.4, 2.9, 0], rot: [0, -Math.PI / 2, 0], text: 'I C E', size: 0.72, color: 0x184a63 },
    { kind: 'text', p: [18.4, 2.25, 0], rot: [0, -Math.PI / 2, 0], text: 'you arrive some time after you stop', size: 0.26, color: 0x4a7290 },
    { kind: 'text', p: [36.0, 2.6, -4.2], rot: [0, -Math.PI / 2, 0], text: 'the walls end here', size: 0.26, color: SUN },

    { kind: 'deco', kindOf: 'crystal', p: [27, 0.4, 9.6], s: [0.8, 1.6, 0.8], count: 9, spread: [22, 1, 4], seed: 411, tint: 0x9fe8ff },
    { kind: 'deco', kindOf: 'crystal', p: [27, 0.4, -9.6], s: [0.8, 1.6, 0.8], count: 9, spread: [22, 1, 4], seed: 512, tint: 0x9fe8ff },
    { kind: 'deco', kindOf: 'banner', p: [22.0, 3.4, 6.2], s: [0.1, 2.4, 1.4], mat: 'panel', tint: SUN },
    { kind: 'deco', kindOf: 'banner', p: [32.0, 3.4, -6.2], s: [0.1, 2.4, 1.4], mat: 'panel', tint: SUN },
    { kind: 'light', p: [27, 3.6, 0], color: ICE, intensity: 8, distance: 26 },

    /* ============================================================================ */
    /* BEAT 3 — THE OVERRUN : ICE WITH A DROP                                       */
    /* Same surface, walls removed. Two ice shelves that simply stop, each with an    */
    /* icicle rail along ONE lip so the safe corridor swaps sides between them — you   */
    /* cannot solve both by drifting the same way. Shelf 1 exits UP over a 3.0 m gap,  */
    /* shelf 2 exits UP 1.05 m over 2.5 m, which is 66% of the safe budget for that    */
    /* rise: the maths is easy, arriving at the lip with the right speed is not.       */
    /* ============================================================================ */

    { kind: 'ice', p: [48.6, 0.45, 0], s: [8, 0.7, 8], color: ICE }, // top 0.8, gap 1.2 in, +0.3
    { kind: 'spikes', p: [48.6, 1.2, 3.4], s: [8, 0.8, 1.4], dir: [0, 1, 0] }, // north lip; 6.7 m of clear ice left

    { kind: 'platform', p: [57.4, 0.45, 0], s: [3.6, 1, 6], mat: 'stone', glow: ICE, stripe: true }, // gap 3.0, top 0.95

    { kind: 'ice', p: [66.4, 0.15, 0], s: [9, 0.7, 9], color: ICE }, // gap 2.7 at -0.45, top 0.5, 9 m wide
    { kind: 'spikes', p: [66.4, 0.9, -3.8], s: [9, 0.8, 1.4], dir: [0, 1, 0] }, // SOUTH lip this time; 7.6 m of clear ice

    { kind: 'platform', p: [76.4, 1.05, 0], s: [6, 1, 9], mat: 'stone', glow: HAZE, stripe: true }, // gap 2.5, +1.05, top 1.55

    { kind: 'text', p: [44.8, 2.9, 0], rot: [0, -Math.PI / 2, 0], text: 'IT ENDS', size: 0.56, color: 0xb03020 },
    { kind: 'text', p: [44.8, 2.35, 0], rot: [0, -Math.PI / 2, 0], text: 'let go early. much earlier than that.', size: 0.24, color: 0x4a7290 },
    { kind: 'deco', kindOf: 'shard', p: [62, -3.0, 8.0], s: [1.4, 5.0, 1.4], count: 7, spread: [26, 6, 5], seed: 733, tint: 0x7fc4e8 },
    { kind: 'deco', kindOf: 'shard', p: [62, -4.0, -8.4], s: [1.4, 5.0, 1.4], count: 7, spread: [26, 6, 5], seed: 818, tint: 0x7fc4e8 },
    { kind: 'deco', kindOf: 'buttress', p: [66.4, -2.6, 0], s: [7.0, 6.0, 9.0], mat: 'obsidian', tint: COLD },
    { kind: 'light', p: [57.4, 3.0, 0], color: SUN, intensity: 8, distance: 18 },
    { kind: 'light', p: [76.4, 4.0, 0], color: ICE, intensity: 9, distance: 20 },

    /* ============================================================================ */
    /* BEAT 4 — ICE WITH A GAP                                                      */
    /* The twist that actually changes your hands: until now every takeoff was from   */
    /* stone. Three ice pads, none of them adjacent, offset +2.8 / -2.6 on Z so the   */
    /* drift you build up is never pointing at the next one. Gaps 2.5 / 3.3 / 2.4,     */
    /* the middle one flat and the last one climbing 0.9 m — deliberately not a ramp   */
    /* of equal hops, because the whole skill is re-measuring from a surface that      */
    /* refuses to hold still.                                                          */
    /*                                                                              */
    /* COIN 1 is the honest expression of the beat: a 3 x 3 ICE pad, 3.6 m off the   */
    /* second slab, hung over open air with nothing beyond it. Landing is easy.        */
    /* Stopping is the price.                                                          */
    /* ============================================================================ */

    { kind: 'ice', p: [84.6, 1.05, 0], s: [5.4, 0.7, 8], color: ICE }, // gap 2.5 at -0.15, top 1.4
    { kind: 'ice', p: [92.9, 1.05, 2.8], s: [4.6, 0.7, 6], color: ICE }, // gap 3.3 flat, shifted +2.8 z
    { kind: 'ice', p: [100.6, 1.95, -2.6], s: [6, 0.7, 7], color: ICE }, // gap 2.4 at +0.9, back across

    // -- the optional line --------------------------------------------------------
    { kind: 'ice', p: [96.0, 1.05, 10.9], s: [3, 0.7, 3], color: SUN }, // 3.6 m out over nothing, 3.6 m back
    { kind: 'deco', kindOf: 'ring', p: [96.0, 3.2, 10.9], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: SUN },
    { kind: 'light', p: [96.0, 3.4, 10.9], color: SUN, intensity: 7, distance: 15 },

    { kind: 'platform', p: [108.6, 1.95, 0], s: [6, 1, 9], mat: 'stone', glow: HAZE, stripe: true }, // gap 2.0, top 2.45

    { kind: 'text', p: [80.4, 3.4, 0], rot: [0, -Math.PI / 2, 0], text: 'NOW JUMP OFF IT', size: 0.46, color: 0x184a63 },
    { kind: 'deco', kindOf: 'monolith', p: [96, -14, 22], s: [8, 26, 8], count: 5, spread: [40, 10, 12], seed: 921, tint: 0x8fb4cc },
    { kind: 'deco', kindOf: 'crystal', p: [104, 2.2, -8.6], s: [0.9, 2.2, 0.9], count: 6, spread: [10, 1, 3], seed: 1044, tint: 0x9fe8ff },
    { kind: 'light', p: [92.9, 4.2, 0], color: ICE, intensity: 7, distance: 24 },

    /* ============================================================================ */
    /* BEAT 5 — ICE ON A MOVER                                                      */
    /* Both shuttles carry `surface: 'ice'`, so the deck under you is slippery AND     */
    /* travelling. Shuttle 1 runs down the stage axis with a 0.9 s dwell at each end,  */
    /* which is the forgiving version: your drift and its travel point the same way.   */
    /* Shuttle 2 crosses your path, so your drift and its travel are perpendicular and */
    /* you have to leave it while pointing somewhere it is not going.                  */
    /*                                                                              */
    /* Between them, THIN ICE: two vanish tiles on a 3.4 s solid / 0.9 s warning /    */
    /* 1.8 s gone cycle, staggered 0.2 of a turn apart — 1.22 s on that 6.1 s period,  */
    /* because `cycle.phase` is a FRACTION of the cycle and never a count of seconds. */
    /* Generous numbers on purpose: a vanish tile you cannot brake on is already a    */
    /* harder tile than any the DOJO ever asked for.                                  */
    /* ============================================================================ */

    {
      kind: 'mover',
      p: [115.6, 1.95, 0],
      s: [4.4, 1, 4.8],
      mat: 'ice',
      surface: 'ice',
      motion: { type: 'linear', to: [122.6, 1.95, 0], period: 7.0, phase: 0, ease: 'sine', dwell: 0.9 },
    }, // board at 1.8 m while home; tops 2.45; far edge sits at x 124.8

    { kind: 'vanish', p: [129.4, 1.95, 0], s: [3.6, 1, 5.6], mat: 'ice', surface: 'ice', cycle: { on: 3.4, off: 1.8, warn: 0.9, phase: 0.0 } }, // gap 2.8 off the shuttle
    { kind: 'vanish', p: [135.2, 1.95, 2.4], s: [3.6, 1, 5.6], mat: 'ice', surface: 'ice', cycle: { on: 3.4, off: 1.8, warn: 0.9, phase: 0.2 } }, // gap 2.2, stepped +2.4 z

    {
      kind: 'mover',
      p: [141.4, 1.95, -4.8],
      s: [4.2, 1, 4.2],
      mat: 'ice',
      surface: 'ice',
      motion: { type: 'oscillate', to: [141.4, 1.95, 4.8], period: 5.6, phase: 0, ease: 'sine' },
    }, // crosses z; board on a 3.25 m diagonal as it swings to the near side

    { kind: 'platform', p: [149.6, 2.45, 0], s: [6, 1, 9], mat: 'stone', glow: HAZE, stripe: true }, // gap 3.1 at +0.5, top 2.95

    { kind: 'text', p: [112.0, 4.0, 0], rot: [0, -Math.PI / 2, 0], text: 'IT MOVES. SO DO YOU.', size: 0.42, color: 0x184a63 },
    { kind: 'text', p: [126.4, 4.0, -3.6], rot: [0, -Math.PI / 2, 0], text: 'THIN ICE', size: 0.46, color: 0xb03020 },
    { kind: 'deco', kindOf: 'rail', p: [130, 5.2, 7.4], s: [34, 0.09, 0.09], mat: 'metal', tint: COLD },
    { kind: 'deco', kindOf: 'antenna', p: [120, 8.0, -9.2], s: [0.5, 12.0, 0.5], mat: 'metal', tint: COLD },
    { kind: 'deco', kindOf: 'shard', p: [136, -6.0, 10.0], s: [1.6, 6.0, 1.6], count: 6, spread: [24, 8, 5], seed: 1188, tint: 0x7fc4e8 },
    { kind: 'light', p: [129.4, 5.0, 0], color: ICE, intensity: 9, distance: 24 },
    { kind: 'light', p: [149.6, 5.0, 0], color: SUN, intensity: 8, distance: 20 },

    /* ============================================================================ */
    /* BEAT 6 — WIND, IN ISOLATION                                                  */
    /* No ice on this deck at all — stone, 18 x 14 m, and you cannot fall off it       */
    /* without trying. Two volumes push +Z then -Z at 11 m/s^2, so crossing the deck   */
    /* in a straight line means leaning into a shove, feeling it stop, and being       */
    /* thrown the other way. Same contract as BEAT 2: learn the force where the force  */
    /* is free.                                                                        */
    /*                                                                              */
    /* COIN 2 is the first time it is not free: a 3 m ledge 1.9 m off the north edge,  */
    /* sitting in its own 13 m/s^2 volume that blows OUTWARD, away from the deck.      */
    /* ============================================================================ */

    { kind: 'platform', p: [163.0, 2.45, 0], s: [18, 1, 14], mat: 'stone', glow: HAZE, stripe: true }, // gap 1.4, top 2.95

    { kind: 'wind', p: [160.0, 4.95, 0], s: [10, 6, 14], dir: [0, 0, 1], power: 11, color: 0xd8f2ff },
    { kind: 'wind', p: [169.0, 4.95, 0], s: [8, 6, 14], dir: [0, 0, -1], power: 11, color: 0xd8f2ff },

    // -- the optional line: downwind, and the wind is the thing pushing you off it --
    { kind: 'platform', p: [163.0, 2.45, 10.4], s: [3, 1, 3], mat: 'stone', glow: SUN, stripe: true }, // 1.9 m lateral
    { kind: 'wind', p: [163.0, 4.95, 9.5], s: [8, 6, 7], dir: [0, 0, 1], power: 13, color: 0xd8f2ff },
    { kind: 'deco', kindOf: 'ring', p: [163.0, 4.7, 10.4], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: SUN },
    { kind: 'light', p: [163.0, 4.9, 10.4], color: SUN, intensity: 7, distance: 14 },

    { kind: 'text', p: [155.2, 5.4, 0], rot: [0, -Math.PI / 2, 0], text: 'W I N D', size: 0.66, color: 0x184a63 },
    { kind: 'text', p: [155.2, 4.75, 0], rot: [0, -Math.PI / 2, 0], text: 'it changes its mind halfway across', size: 0.24, color: 0x4a7290 },
    { kind: 'deco', kindOf: 'fence', p: [163.0, 3.9, -6.4], s: [16.0, 1.6, 0.14], mat: 'metal', tint: COLD },
    { kind: 'deco', kindOf: 'banner', p: [156.0, 5.6, -6.4], s: [0.1, 2.6, 1.8], mat: 'panel', tint: SUN },
    { kind: 'deco', kindOf: 'banner', p: [170.0, 5.6, -6.4], s: [0.1, 2.6, 1.8], mat: 'panel', tint: SUN },
    { kind: 'deco', kindOf: 'brazier', p: [166.4, 3.7, -5.2], s: [0.9, 1.3, 0.9], mat: 'metal', tint: SUN },
    { kind: 'light', p: [166.4, 4.7, -5.2], color: SUN, intensity: 8, distance: 15, flicker: 0.3 },

    /* ============================================================================ */
    /* BEAT 7 — WIND OVER A DROP                                                    */
    /* The deck is gone; the push is not. Everything underfoot here is STONE and every */
    /* jump is under 2.1 m, because the only question this beat asks is "can you hold  */
    /* a line". Three volumes: +Z at 13 across the first catwalk, -Z at 13 across the  */
    /* stagger, then +Z at only 10 on the last span — because the last span also has   */
    /* the windmill on it, and two maximums in one place is a coin flip, not a test.   */
    /*                                                                              */
    /* THE VANE. A three-armed ice windmill on a 6.0 s period, so a blade every 2.0 s. */
    /* Hub at y 8.35 and arms 4.9 m long put the tips at 3.45, i.e. 0.20 m over a      */
    /* catwalk whose top is 3.25 — it sweeps your shins and a jump clears it. It is the */
    /* only lethal moving thing on the stage and it is bolted to the WIDEST walkway in  */
    /* the beat (4.4 m) on purpose. CP3 sits 25 m upwind of it with clockOffset 0: the  */
    /* walk down is a three-second look at the rhythm, so no respawn ever arrives blind. */
    /* ============================================================================ */

    { kind: 'beam', p: [177.5, 2.75, 0], s: [11, 0.6, 3.4], mat: 'metal' }, // flush with the deck, top 3.05
    { kind: 'wind', p: [177.5, 5.05, 0], s: [9, 6, 12], dir: [0, 0, 1], power: 13, color: 0xd8f2ff },

    { kind: 'platform', p: [187.0, 2.75, 2.4], s: [4, 1, 4.4], mat: 'stone', glow: ICE, stripe: true }, // gap 2.0, top 3.25, stepped downwind
    { kind: 'wind', p: [187.2, 5.25, 2.0], s: [7, 6, 12], dir: [0, 0, -1], power: 13, color: 0xd8f2ff },

    { kind: 'beam', p: [195.2, 2.95, -1.0], s: [9, 0.6, 4.4], mat: 'metal' }, // gap 1.7, top 3.25
    { kind: 'wind', p: [195.2, 5.25, -1.0], s: [9, 6, 12], dir: [0, 0, 1], power: 10, color: 0xd8f2ff },
    { kind: 'rotor', p: [195.2, 8.35, -1.0], style: 'windmill', arms: 3, len: 4.9, thick: 0.4, period: 6.0, phase: 0, axis: [0, 0, 1] },

    { kind: 'platform', p: [204.6, 2.95, 0], s: [6, 1, 9], mat: 'stone', glow: HAZE, stripe: true }, // gap 1.9, top 3.45

    { kind: 'text', p: [172.4, 5.2, -2.8], rot: [0, -Math.PI / 2, 0], text: 'NO DECK', size: 0.44, color: 0xb03020 },
    { kind: 'text', p: [190.6, 6.4, 3.6], rot: [0, -Math.PI / 2, 0], text: 'DUCK UNDER IT IS NOT AN OPTION', size: 0.22, color: 0x4a7290 },
    { kind: 'deco', kindOf: 'buttress', p: [195.2, 10.4, 4.6], s: [1.6, 2.8, 1.6], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'buttress', p: [195.2, 10.4, -6.6], s: [1.6, 2.8, 1.6], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'post', p: [181.0, 4.4, 3.2], s: [0.16, 2.6, 0.16], count: 5, spread: [14, 0.4, 0.4], seed: 1290, tint: COLD },
    { kind: 'deco', kindOf: 'cloud', p: [186, -18, 0], s: [18, 3, 18], count: 10, spread: [70, 8, 60], seed: 1355, scale: 1.7, tint: 0xeaf6ff },
    { kind: 'light', p: [187.0, 6.0, 0], color: ICE, intensity: 10, distance: 24 },
    { kind: 'light', p: [204.6, 5.6, 0], color: SUN, intensity: 9, distance: 20 },

    /* ============================================================================ */
    /* BEAT 8 — ICE AND WIND                                                        */
    /* The launch. A pad on the lip throws you 4.6 m up and 6.9 m out onto the first   */
    /* crosswind slab — the gap is 5.4 m of open air, which a sprint clears with 0.9 m */
    /* to spare after 15 m of straight run-up, so both answers are correct and the     */
    /* pad is the one that is never wrong.                                             */
    /*                                                                              */
    /* Then the actual lesson, twice: a 9 m-wide ice slab under a 9 m/s^2 crosswind,   */
    /* then a second one with the wind reversed. Nine metres wide and only 2.0 / 2.4 m */
    /* of gap, because a stage that combines two mechanics should not also be asking   */
    /* for distance. Wind power drops from 13 to 9 here for exactly the same reason.   */
    /*                                                                              */
    /* COIN 3 is the reward for reading the crosswind rather than surviving it: a 3 m  */
    /* ice pad 3.4 m off the DOWNWIND edge of slab 2, with its own outward gust.       */
    /* ============================================================================ */

    { kind: 'jumppad', p: [203.8, 3.52, 0], s: [3, 0.14, 3], power: 4.6, dir: [0, 1, 0] },
    { kind: 'text', p: [202.4, 5.0, 0], rot: [0, -Math.PI / 2, 0], text: 'STAND ON IT', size: 0.34, color: ICE },

    { kind: 'ice', p: [217.2, 2.95, 0], s: [8.4, 0.7, 9], color: ICE }, // top 3.3; 7.7 m of pad throw, or 5.4 m of sprint from the lip
    { kind: 'wind', p: [217.2, 5.3, 0], s: [8, 6, 12], dir: [0, 0, 1], power: 9, color: 0xd8f2ff },

    { kind: 'ice', p: [227.8, 2.95, 0], s: [8, 0.7, 9], color: ICE }, // gap 2.4 flat, wind reverses
    { kind: 'wind', p: [227.8, 5.3, 0], s: [8, 6, 12], dir: [0, 0, -1], power: 9, color: 0xd8f2ff },

    // -- the optional line: out into the gust, on ice, with nothing under it -------
    { kind: 'ice', p: [224.0, 2.95, 9.4], s: [3, 0.7, 3], color: SUN }, // 3.4 m off slab 2, 3.57 m off slab 1, and no way on to the stair
    { kind: 'wind', p: [224.0, 5.3, 9.4], s: [6, 6, 6], dir: [0, 0, 1], power: 12, color: 0xd8f2ff },
    { kind: 'deco', kindOf: 'ring', p: [224.0, 5.1, 9.4], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: SUN },
    { kind: 'light', p: [224.0, 5.3, 9.4], color: SUN, intensity: 7, distance: 15 },

    { kind: 'platform', p: [239.25, 2.95, 0], s: [8.5, 1, 10], mat: 'stone', glow: HAZE, stripe: true }, // gap 3.2, top 3.45 — PLATE 0 of the stair

    { kind: 'text', p: [210.4, 6.0, 0], rot: [0, -Math.PI / 2, 0], text: 'BOTH AT ONCE', size: 0.5, color: 0x184a63 },
    { kind: 'deco', kindOf: 'monolith', p: [222, -16, -26], s: [10, 30, 10], count: 5, spread: [46, 12, 14], seed: 1466, tint: 0x8fb4cc },
    { kind: 'deco', kindOf: 'shard', p: [222, -5.0, -9.4], s: [1.5, 5.5, 1.5], count: 6, spread: [22, 7, 4], seed: 1523, tint: 0x7fc4e8 },
    { kind: 'light', p: [222.0, 6.4, 0], color: ICE, intensity: 10, distance: 26 },

    /* ============================================================================ */
    /* BEAT 9 — THE DOORSTEP                                                        */
    /* The stone plate above is the bottom TREAD of the stair, not a separate deck: it */
    /* is the same 8.5 m plate on the same 5 m rhythm as every ice plate after it, so  */
    /* the whole chain — stone, then six sheets of ice — carries one set of distances  */
    /* and there is no seam where the geometry changes its mind. Four metres of dry     */
    /* footing, a gate you can see the entire spiral through, and then nothing solid.   */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'arch', p: [237.6, 8.0, 0], s: [1.1, 1.0, 11.0], mat: 'obsidian', tint: ICE },
    { kind: 'deco', kindOf: 'pillar', p: [237.6, 5.6, 5.0], s: [1.3, 4.6, 1.3], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'pillar', p: [237.6, 5.6, -5.0], s: [1.3, 4.6, 1.3], mat: 'obsidian', tint: COLD },
    { kind: 'text', p: [234.0, 5.6, 0], rot: [0, -Math.PI / 2, 0], text: 'THE OUTSIDE STAIR', size: 0.44, color: 0x184a63 },
    { kind: 'text', p: [234.0, 5.05, 0], rot: [0, -Math.PI / 2, 0], text: 'there are no jumps left. that is not good news.', size: 0.22, color: 0x4a7290 },
    { kind: 'light', p: [237.6, 7.0, 0], color: ICE, intensity: 12, distance: 26 },

    /* ============================================================================ */
    /* BEAT 10 — SET-PIECE : THE SPIRAL                                             */
    /* Six sheets of ice wound round the outside of the spire, 8.5 m long and 8 m wide, */
    /* each riding 3.5 m ONTO the sheet below it and 0.5 m above it. TUNE.stepUp is     */
    /* 0.55, so every seam is a STEP: from the doorstep to the summit there is not one  */
    /* jump on this stair. You cannot mistime it and you cannot fall short of it. You   */
    /* can only be blown off the side of it.                                            */
    /*                                                                              */
    /* The overlap is what keeps the geometry honest, too. Plates that merely ABUT put  */
    /* every skip-one pair at exactly one plate length, and at 0.5 m of rise per plate  */
    /* that distance lands in the band where a run jump is *just barely* possible.      */
    /* Riding them 3.5 m over each other drops every skip-one to 1.5 m (a plain hop)    */
    /* and every skip-two to 6.5 m (a comfortable sprint), so there is no full-stretch  */
    /* jump anywhere on the stair, forwards or backwards.                               */
    /*                                                                              */
    /* The path swings z 0 -> +3 -> +5.5 -> +4 -> 0 -> -3 -> -4 as it wraps the tower,  */
    /* and the wind reverses every thirteen metres: +Z over the first three plates, -Z  */
    /* over the middle three, +Z again over the last two. Every reversal arrives where  */
    /* the ICE is also turning, so the shove and the corner alternately fight and agree */
    /* — and it is the plate where they AGREE that throws people off the mountain.       */
    /* Eight metres of width the whole way, on purpose.                                 */
    /* ============================================================================ */

    { kind: 'ice', p: [244.25, 3.60, 3.0], s: [8.5, 0.7, 8], color: ICE },   // x 240.0..248.5, top 3.95 — a 0.50 step off the stone
    { kind: 'ice', p: [249.25, 4.10, 5.5], s: [8.5, 0.7, 8], color: ICE },   // x 245.0..253.5, top 4.45 — the wrap begins
    { kind: 'ice', p: [254.25, 4.60, 4.0], s: [8.5, 0.7, 8], color: ICE },   // x 250.0..258.5, top 4.95 — the apex of the curve
    { kind: 'ice', p: [259.25, 5.10, 0.0], s: [8.5, 0.7, 8], color: ICE },   // x 255.0..263.5, top 5.45 — coming back across
    { kind: 'ice', p: [264.25, 5.60, -3.0], s: [8.5, 0.7, 8], color: ICE },  // x 260.0..268.5, top 5.95
    { kind: 'ice', p: [269.25, 6.10, -4.0], s: [8.5, 0.7, 8], color: ICE },  // x 265.0..273.5, top 6.45 — the last plate

    { kind: 'wind', p: [241.5, 6.45, 1.5], s: [13, 8, 18], dir: [0, 0, 1], power: 9, color: 0xd8f2ff },
    { kind: 'wind', p: [254.5, 7.45, 4.0], s: [13, 8, 16], dir: [0, 0, -1], power: 10, color: 0xd8f2ff },
    { kind: 'wind', p: [267.5, 8.45, -3.5], s: [13, 8, 18], dir: [0, 0, 1], power: 10, color: 0xd8f2ff },

    // The spire wall the stair is cut into: a solid mass on the inside of the curve so
    // the spiral reads as carved OUT of something, and so the horizon is never a void
    // on both sides at once.
    { kind: 'deco', kindOf: 'monolith', p: [256, -6.0, -14.0], s: [16, 28, 14], mat: 'obsidian', tint: 0x9dbdd6 },
    { kind: 'deco', kindOf: 'buttress', p: [247.0, 1.2, -6.6], s: [4.0, 6.0, 3.0], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'buttress', p: [262.0, 2.4, -9.6], s: [4.0, 6.0, 3.0], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'crystal', p: [251, 4.4, -6.4], s: [0.9, 2.4, 0.9], count: 8, spread: [18, 1.4, 3], seed: 1611, tint: 0x9fe8ff },
    { kind: 'deco', kindOf: 'banner', p: [245.0, 7.2, 9.4], s: [0.1, 3.0, 1.8], mat: 'panel', tint: SUN },
    { kind: 'deco', kindOf: 'banner', p: [259.0, 7.8, 8.4], s: [0.1, 3.0, 1.8], mat: 'panel', tint: SUN },
    { kind: 'light', p: [249.0, 7.4, 4.0], color: ICE, intensity: 9, distance: 22 },
    { kind: 'light', p: [264.0, 9.0, -2.0], color: SUN, intensity: 9, distance: 22 },

    /* ============================================================================ */
    /* THE SUMMIT                                                                   */
    /* One last 2.5 m hop at +0.5, off the ice and onto stone, framed by the gate so   */
    /* the run ends on something that holds still.                                    */
    /* ============================================================================ */

    { kind: 'platform', p: [282.5, 6.45, -4.0], s: [11, 1, 12], mat: 'obsidian', glow: SUN, stripe: true }, // gap 3.5, +0.5, top 6.95

    { kind: 'deco', kindOf: 'arch', p: [282.5, 12.0, -4.0], s: [1.3, 1.0, 10.0], mat: 'obsidian', tint: SUN },
    { kind: 'deco', kindOf: 'pillar', p: [282.5, 9.6, 0.6], s: [1.3, 5.4, 1.3], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'pillar', p: [282.5, 9.6, -8.6], s: [1.3, 5.4, 1.3], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'beacon', p: [286.4, 9.0, -4.0], s: [0.7, 3.0, 0.7], mat: 'emissive', tint: SUN },
    { kind: 'deco', kindOf: 'brazier', p: [279.2, 7.8, -8.4], s: [1.0, 1.4, 1.0], mat: 'metal', tint: SUN },
    { kind: 'text', p: [279.6, 9.0, -4.0], rot: [0, -Math.PI / 2, 0], text: 'FIRST FROST', size: 0.42, color: SUN },
    { kind: 'light', p: [282.5, 10.4, -4.0], color: SUN, intensity: 20, distance: 34 },
    { kind: 'light', p: [279.2, 8.8, -8.4], color: SUN, intensity: 7, distance: 14, flicker: 0.3 },

    /* ============================================================================ */
    /* THE MOUNTAIN — everything below and beside the course.                       */
    /* All of it lives at |z| >= 16 or below y = -8, i.e. outside every play corridor */
    /* on the stage, and all of it is ROCK, SNOW or CLOUD — no flat pale slabs at     */
    /* walk height anywhere, because in this palette a flat pale slab means "land     */
    /* here". The peaks get taller as the stage climbs so the horizon keeps pace.     */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'monolith', p: [40, -26, 34], s: [12, 44, 12], count: 6, spread: [110, 22, 26], seed: 2101, tint: 0x9dbdd6 },
    { kind: 'deco', kindOf: 'monolith', p: [40, -28, -36], s: [12, 44, 12], count: 6, spread: [110, 22, 26], seed: 2202, tint: 0x9dbdd6 },
    { kind: 'deco', kindOf: 'monolith', p: [190, -22, 40], s: [14, 52, 14], count: 6, spread: [130, 26, 28], seed: 2303, tint: 0xa8c8de },
    { kind: 'deco', kindOf: 'monolith', p: [190, -24, -42], s: [14, 52, 14], count: 6, spread: [130, 26, 28], seed: 2404, tint: 0xa8c8de },
    { kind: 'deco', kindOf: 'shard', p: [110, -12, 20], s: [2.0, 8.0, 2.0], count: 10, spread: [180, 10, 8], seed: 2505, tint: 0x7fc4e8 },
    { kind: 'deco', kindOf: 'shard', p: [110, -13, -21], s: [2.0, 8.0, 2.0], count: 10, spread: [180, 10, 8], seed: 2606, tint: 0x7fc4e8 },
    { kind: 'deco', kindOf: 'cloud', p: [140, -30, 0], s: [24, 3, 24], count: 16, spread: [300, 14, 120], seed: 2707, scale: 2.1, tint: 0xf2fbff },
    { kind: 'deco', kindOf: 'cloud', p: [230, -20, 26], s: [20, 3, 20], count: 10, spread: [140, 10, 60], seed: 2808, scale: 1.8, tint: 0xf2fbff },

    // Sun lamps down the length of the course. Warm, low and on the SOUTH side only,
    // so every ice lip in the stage carries the same orange rim and "edge" always
    // reads the same way no matter which beat you are in.
    { kind: 'light', p: [30, 4.0, -8.0], color: SUN, intensity: 7, distance: 26 },
    { kind: 'light', p: [66, 4.2, -8.0], color: SUN, intensity: 7, distance: 26 },
    { kind: 'light', p: [100, 5.0, -8.0], color: SUN, intensity: 7, distance: 26 },
    { kind: 'light', p: [140, 5.6, -8.0], color: SUN, intensity: 7, distance: 26 },
    { kind: 'light', p: [180, 6.2, -8.0], color: SUN, intensity: 7, distance: 26 },
    { kind: 'light', p: [220, 6.6, -8.0], color: SUN, intensity: 7, distance: 26 },
    { kind: 'light', p: [258, 8.0, -8.0], color: SUN, intensity: 7, distance: 26 },
  ],
};
