/**
 * ASCENDANT — FROZEN SPIRE 1 : "FIRST FROST"
 * runtime/data/stages/spire-1.js
 *
 * The opener of the ice world. A glacial tower with terraces cut into its outside
 * face, a low orange sun grazing every ice edge, and snow going sideways past you.
 * The whole stage exists to rewrite one number you have already learned: friction.
 *
 * SHAPE      324.3 m of travel, 61 gameplay objects on 52 landable surfaces,
 *            7 checkpoints (longest leg 54.8 m), 3 coins, y -0.65 .. 9.80.
 *
 * WHAT IS ACTUALLY TIMED, counted honestly. `reachcheck` totals 42 "hazards", but 28 of
 * those are the 21 ice slabs and 7 wind volumes — surface state, not moving parts, and
 * quoting them as one number is how a stage pretends to have content it does not have.
 * The things that MOVE or DISAPPEAR are: 2 ice shuttles, 6 vanish tiles, 2 windmill
 * vanes, 1 pendulum icicle, 2 jump pads = 13 objects, plus 1 spike bed. Eight families
 * in all (ice, wind, vanish, mover, rotor, pendulum, spikes, jumppad).
 *
 * THE WORLD MECHANIC IS ICE (TUNE.iceFriction 1.4 against 13, iceAccel 26 against 95).
 * Every jump the DOJO taught still works — you just cannot start one, stop one or
 * cancel one the way you used to. So ice is taught by adding ONE consequence at a
 * time, in this order, and never two of them on the same slab:
 *
 *   BEAT 2   ice, walled in       — you slide, and it costs you nothing
 *   BEAT 3   ice with a drop      — the slab ends over the void; brake or wear it
 *   BEAT 4   ice with a gap       — take off FROM ice and land ON ice
 *   BEAT 5   ice that vanishes    — a crossing shuttle, then a five-tile wave
 *   BEAT 6   ice in wind          — the deck is wide, the raft is not
 *   BEAT 7   the fall             — the route goes DOWN 3.85 m into the cellar
 *   BEAT 8   ice under blades     — a 3.6 m ice catwalk under two vanes
 *   BEAT 9   ice in a crosswind   — a launch, then two slabs with the gust reversed
 *   BEAT 11  the outside stair, where you climb 6.35 m round the spire in seven jumps
 *
 * ── WIND IS A REAL FORCE ONLY ON ICE. READ THIS BEFORE MOVING A `wind` VOLUME ──
 * controller.js:131-134 gives friction a STOP-SPEED FLOOR: `control = max(sp, 4.0)`,
 * so a nearly stationary player is decelerated at 4.0 x surfaceFriction, not at
 * v x friction. On stone (friction 13) that floor is **52 m/s^2** and NO wind volume
 * in this game can move a standing player. On ice (friction 1.4) the floor is
 * **5.6 m/s^2**, and the steady-state drift is power / 1.4 — 6.4 m/s at power 9.
 * Therefore: **every wind volume in this stage stands over ICE**, and there is not
 * one wind volume over stone anywhere in the file. A gust over a stone deck is
 * decoration that lies about being a hazard, and this stage used to ship seven of them.
 *
 * WIDTH IS THE DIFFICULTY DIAL. Narrow ice is not hard, it is arbitrary: the player
 * loses to a surface they cannot read instead of to a decision they made. So the ice
 * the stage TEACHES on is 8-15 m across, and width is spent deliberately and rarely —
 * five landings on the route are under 5 m across (x 73 is 3.2 m deep, the tongue at
 * x 187 is 4.0 m, the vane catwalk is 3.6 m, and stair plates 3 and 4 are 4.6 and
 * 4.8 m) and each one is announced by the beat before it.
 *
 * —— THE HOUSE RULES (stated in full at the top of neon-1.js) ————————————
 * 1. The reach envelope is law (CONTRACT section 0). Two bands are forbidden because a
 *    jump inside them is one a player can *just barely* make: 4.36-5.24 m flat and
 *    6.18-7.44 m flat (both widen as the landing drops). `_harness/reachcheck.mjs`
 *    graphs EVERY pair of landable surfaces, so N to N+2 matters as much as N to N+1,
 *    and it reports tightEdges 0 for this file.
 * 2. There is exactly ONE sprint jump on the main line: 5.70 m at +0.10 out of BEAT 9,
 *    which is 0.51 m past the run-jump maximum at that rise (5.19) and 0.41 m inside
 *    the sprint-safe limit (6.11). It is not the only way — the launch pad on the same
 *    deck lifts you onto the cornice instead — and it is the only gap in the file that
 *    carries a consequence. (It used to be 5.40 m, which cleared the run maximum by
 *    7 cm: a boundary that close is inside the error of "did I let go of shift".)
 * 3. Every link must be jumpable. Both shuttles are boarded and left over gaps under
 *    3.3 m at the pose you actually meet them, and the jump pad out of the cellar has a
 *    three-rung ice stair beside it that arrives at the SAME end of the vane catwalk.
 * 4. Timed hazards are pure functions of the stage clock (CONTRACT section 16).
 *    `vanish.cycle.phase` and `rotor.phase` are FRACTIONS OF ONE CYCLE (0..1), never
 *    seconds; `pendulum.ampDeg` is the degrees convenience for `amp`, which is RADIANS.
 * 5. Vary gap, height and width constantly. Main-line gaps run 1.37 m to 5.70 m and no
 *    two consecutive gaps are equal, SEVEN transitions descend — one of them 3.85 m into a lower
 *    tier you have to climb back out of — and five landings on the route are under
 *    5 m across. No two consecutive landings share a footprint.
 * 6. Every landing is visible from its take-off.
 * 7. **A PAD IS A LIFT, NOT A CATAPULT.** reachcheck.mjs:47-101 runs both halves of a
 *    bounce at gravFall and adds no horizontal speed, so the arc is fixed and the
 *    LANDING has to swallow the whole entry-speed band — walk-on (6.0 m/s) to
 *    sprint-on-with-jump-held (12.2 m/s at 1.25x apex). Both pads here were placed
 *    from that band, not from a guess: the cellar pad (apex 5.6, rise 3.76) lands
 *    between 4.30 m and 10.44 m from its launch point onto a catwalk that runs
 *    3.95..16.95 m, and the launch pad (apex 7.2, rise 4.91) lands between 4.85 m and
 *    11.79 m onto a cornice that runs 4.35..12.35 m. A pad aimed at a slab 14 m away
 *    throws a hesitant player into the void; neither of these can.
 *
 * ── THE VANES, MEASURED AGAINST rotors.js (do not "tidy" these numbers) ──────
 * A windmill blade and its kill capsule both start at `innerR = max(0.20, thick*0.9)`
 * and run to `innerR + len` (rotors.js:316, :838-841), and the capsule radius is
 * `max(thick, rootC*0.30)` where `rootC = max(0.45, height*2.6)` and `height`
 * defaults to `thick` (rotors.js:302, :578, :621). For thick 0.4 / len 3.6 that is
 * innerR 0.36, tip at 3.96 m from the hub, capsule radius 0.40. Hub at y 8.20 puts
 * the painted tip at y 4.24 and the LETHAL edge at y 3.84 — 0.59 m over a catwalk
 * whose top is 3.25. You cannot crouch under it (1.05 m) and you cannot jump it (the
 * capsule is the whole radius, not just the tip): you time it, or you die.
 * The capsule is thin along the spin axis — 0.40 + player radius 0.35 = 0.75 m of
 * lateral reach — so ONE vane on a wide walkway is walked past by strafing. That is
 * why there are two, 1.50 m apart in z on a 3.6 m catwalk: every stance whose whole
 * footprint is on the deck (z -1.45 .. +1.45) is inside one blade's plane or the other.
 *
 * CONVENTIONS (full list in runtime/data/index.js):
 *   p = CENTRE, s = FULL size, top surface = p[1] + s[1]/2. Gaps in the comments are
 *   EDGE TO EDGE and every one of them is measured. rot/yaw in radians, yaw 0 faces +X.
 *   `stripe: true` = must jump here. A mover's `p` is its HOME pose, `motion.to` its far
 *   pose; the validator treats BOTH as landable, and boarding gaps below are quoted at
 *   the pose you actually board. A `wind` volume is not solid and never becomes an
 *   accidental wall. Its box is centred about 2.3 m ABOVE the walk line and stands 6-8 m
 *   tall, because WindHazard tapers its force to zero at the box faces (surfaces.js:1014):
 *   centre it ON the deck and the player's feet sit in the dead zone and feel nothing.
 *
 * REACH BUDGET USED (safe limits: run 4.35 flat / 3.90 at +0.85 / 3.83 at +0.95 /
 *                    4.58 at -0.95 / 5.72 at -3.85; sprint 6.11 at +0.10):
 *   longest main-line run jump           3.62 m at +0.95   (BEAT 11, plate 3 to plate 4)
 *   the one sprint                       5.70 m at +0.10   (BEAT 9, and the pad avoids it)
 *   longest rise                         1.55 m over 1.40 m (BEAT 7, the cellar stair)
 *   longest drop                         3.85 m over 4.60 m (BEAT 7, into the cellar)
 *   shortest gap                         1.37 m at +0.85   (BEAT 11, plate 5 to plate 6)
 *   riskiest optional line               3.40 m onto a vanish tile hung over the drop
 *                                        (COIN 1) — the tile is only there 63% of the time
 *
 * CHECKPOINTS. Seven, at 30.7 / 80.5 / 112.0 / 155.9 / 197.3 / 227.0 / 269.1, each on
 * the last solid thing before a new consequence appears. Spacings 29.2 / 49.8 / 31.5 /
 * 43.9 / 41.4 / 29.7 / 42.1, and the run from the last one to the finish is 54.8 m —
 * seven jumps and a 6.35 m climb, with no walking in it. That last checkpoint is on the
 * doorstep of the set-piece on purpose: the previous version skipped it and made the
 * finale a 78 m leg of which 33 m was a staircase you walked up.
 * **CP5 sits at x 227.0, which is 2.40 m short of the jump pad's west edge (229.4):
 * Stage.spawnFor() (stage.js:2925) returns the checkpoint position verbatim with no
 * clearance lift, and controller.js:1073 fires _applyBounce the instant a grounded
 * player has preVy <= 0.01 on a `bounce` surface — so a checkpoint placed inside a pad
 * collider launches EVERY respawn 4.6 m into the air at zero horizontal speed. The
 * previous version had cp4 at [204.6, 3.55, 0] inside a pad whose box was
 * x 202.3..205.3 / y 3.45..3.59 / z +-1.5. Never put one there.**
 *
 * HEIGHT LADDER: 0.5 (the ledge and the walled ice) -> 1.00/1.50/0.55/1.45/1.70 (the
 *                overrun) -> 2.25 -> 2.10/3.05 (the ice gaps) -> 2.95 -> 3.25 .. 4.45
 *                (the wave) -> 2.90/3.35/3.20 (the wind deck and the raft)
 *                -> **-0.65 (the cellar)** -> 0.90/2.20/3.25 (the way back up)
 *                -> 3.45 -> **8.50 (the cornice, pad-only)** -> 3.55/3.25 (the
 *                crosswind) -> 3.45 (the doorstep) -> 4.40/5.30/6.15/7.10/8.00/8.85
 *                (the stair) -> 9.80 (the summit).
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
  par: 186000,
  difficulty: 4,

  spawn: { p: [0, 0.6, 0], yaw: 0 },
  killY: -40,

  checkpoints: [
    // The terrace at the end of the walled ice. Everything before this is un-loseable.
    { p: [30.7, 0.6, 0], yaw: 0, clockOffset: 0 },
    // Above the overrun, before ice has to be jumped OFF as well as landed ON.
    { p: [80.5, 2.35, 0], yaw: 0, clockOffset: 0 },
    // The apron, before the ice starts moving and disappearing underneath you.
    { p: [112.0, 3.05, 0], yaw: 0, clockOffset: 0 },
    // The ledge off the last vanish tile, before the wind deck. clockOffset stays 0
    // like every other checkpoint here: nothing lethal is timed between this pad and
    // the next one, and rewinding the clock would cost the phase-lock with the wave.
    { p: [155.9, 4.55, 7.6], yaw: 0, clockOffset: 0 },
    // The cellar floor, on the near side of the pit. The icicle is 5 m away and swings
    // on a 3.4 s period, so a respawn always sees a full pass before it commits.
    { p: [197.3, -0.55, 0], yaw: 0, clockOffset: 0 },
    // The launch deck — 2.10 m WEST of the jump pad's edge, never on it (see the note
    // in the header). The last flat, still, un-slippery thing on the stage.
    { p: [227.0, 4.05, 0], yaw: 0, clockOffset: 0 },
    // The doorstep of the outside stair. Four metres of dry footing and a gate you can
    // see the whole spiral through — the finale is 54.8 m of jumping, and it gets a
    // checkpoint of its own so a fall on plate 5 does not re-run the crosswind.
    { p: [269.1, 3.55, 0], yaw: 0, clockOffset: 0 },
  ],

  finish: { p: [323.9, 10.40, -1.0], yaw: 0 },

  coins: [
    { p: [99.5, 3.25, 10.8] },   // BEAT 4 — on a vanish tile: a coin you have to TIME
    { p: [202.4, 0.55, 0] },     // BEAT 7 — mid-air over the spike pit, under the icicle
    { p: [237.4, 9.40, 0] },     // BEAT 9 — on the cornice: 5.05 m above the deck, and only
                                 //          the jump pad can put you up there
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
    /* Eleven metres of ice, ten wide, walled both sides and terminating in stone.   */
    /* No gap, no hazard, no drop: the ONLY new information is that you keep          */
    /* travelling after you let go of W. Eleven metres is the honest length for that  */
    /* sentence — you stop from speedRun in 4.7 m on this surface, so the beat gives   */
    /* you two full stopping distances and then ends. (It used to be nineteen.)        */
    /* ============================================================================ */

    { kind: 'ice', p: [22.5, 0.15, 0], s: [11, 0.7, 10], color: ICE }, // top 0.5, flush with the landing

    // The kerbs. 1.8 m of stone balustrade, deliberately readable as ARCHITECTURE and
    // not as a route: 0.7 m thick and 1.45 m above the ice, i.e. climbable if you
    // insist, and pointless if you do.
    { kind: 'platform', p: [21.75, 1.05, 5.35], s: [9.5, 1.8, 0.7], mat: 'stone', glow: HAZE },
    { kind: 'platform', p: [21.75, 1.05, -5.35], s: [9.5, 1.8, 0.7], mat: 'stone', glow: HAZE },

    { kind: 'platform', p: [30.7, 0, 0], s: [5.4, 1, 9], mat: 'stone', glow: HAZE }, // top 0.5, flush again

    { kind: 'text', p: [18.4, 2.9, 0], rot: [0, -Math.PI / 2, 0], text: 'I C E', size: 0.72, color: 0x184a63 },
    { kind: 'text', p: [18.4, 2.25, 0], rot: [0, -Math.PI / 2, 0], text: 'you arrive some time after you stop', size: 0.26, color: 0x4a7290 },
    { kind: 'text', p: [29.2, 2.6, -4.2], rot: [0, -Math.PI / 2, 0], text: 'the walls end here', size: 0.26, color: SUN },

    { kind: 'deco', kindOf: 'crystal', p: [24, 0.4, 9.6], s: [0.8, 1.6, 0.8], count: 8, spread: [16, 1, 4], seed: 411, tint: 0x9fe8ff },
    { kind: 'deco', kindOf: 'crystal', p: [24, 0.4, -9.6], s: [0.8, 1.6, 0.8], count: 8, spread: [16, 1, 4], seed: 512, tint: 0x9fe8ff },
    { kind: 'deco', kindOf: 'banner', p: [20.0, 3.4, 6.2], s: [0.1, 2.4, 1.4], mat: 'panel', tint: SUN },
    { kind: 'deco', kindOf: 'banner', p: [26.0, 3.4, -6.2], s: [0.1, 2.4, 1.4], mat: 'panel', tint: SUN },
    { kind: 'light', p: [23, 3.6, 0], color: ICE, intensity: 8, distance: 26 },

    /* ============================================================================ */
    /* BEAT 3 — THE OVERRUN : ICE WITH A DROP                                       */
    /* Same surface, walls removed, and the punishment is the one this stage promises */
    /* everywhere else: a FALL you can see from the slab you are standing on. There   */
    /* are no spike beds on these shelves. (There used to be two, on the one surface   */
    /* where you cannot brake, which made the header's own thesis a lie.) Instead the  */
    /* shelves step sideways as well as forward, so the drift you build is never       */
    /* pointing at the next lip, and shelf 2 DROPS 0.95 m — you arrive faster than you */
    /* left, on ice, with 9 m of runway and a 4 m stone island to hit.                 */
    /* ============================================================================ */

    { kind: 'ice', p: [39.9, 0.65, 0], s: [8, 0.7, 8], color: ICE }, // gap 2.5 at +0.50, x 35.9..43.9, top 1.00
    { kind: 'platform', p: [48.6, 1.00, 1.6], s: [3.6, 1, 7], mat: 'stone', glow: ICE, stripe: true }, // gap 2.9 at +0.50, top 1.50
    { kind: 'ice', p: [57.0, 0.20, -1.4], s: [9, 0.7, 9], color: ICE }, // gap 2.1 at -0.95, top 0.55
    { kind: 'platform', p: [66.0, 0.95, 1.0], s: [4.0, 1, 8], mat: 'stone', glow: ICE, stripe: true }, // gap 2.5 at +0.90, top 1.45
    { kind: 'ice', p: [73.4, 1.35, -1.8], s: [5.0, 0.7, 3.2], color: ICE }, // gap 2.9 at +0.25 — 3.2 m DEEP, the first narrow landing
    { kind: 'platform', p: [80.5, 1.75, 0], s: [6, 1, 9], mat: 'stone', glow: HAZE, stripe: true }, // gap 1.6 at +0.55, top 2.25

    { kind: 'text', p: [35.2, 2.9, 0], rot: [0, -Math.PI / 2, 0], text: 'IT ENDS', size: 0.56, color: 0xb03020 },
    { kind: 'text', p: [35.2, 2.35, 0], rot: [0, -Math.PI / 2, 0], text: 'let go early. much earlier than that.', size: 0.24, color: 0x4a7290 },
    { kind: 'text', p: [71.0, 3.1, 2.6], rot: [0, -Math.PI / 2, 0], text: 'three metres of it', size: 0.22, color: SUN },
    { kind: 'deco', kindOf: 'fence', p: [39.9, 1.70, 4.3], s: [7.4, 1.3, 0.12], mat: 'metal', tint: COLD },
    { kind: 'deco', kindOf: 'fence', p: [57.0, 1.25, -6.1], s: [8.4, 1.3, 0.12], mat: 'metal', tint: COLD },
    { kind: 'deco', kindOf: 'shard', p: [62, -3.0, 8.6], s: [1.4, 5.0, 1.4], count: 7, spread: [26, 6, 5], seed: 733, tint: 0x7fc4e8 },
    { kind: 'deco', kindOf: 'shard', p: [62, -4.0, -9.4], s: [1.4, 5.0, 1.4], count: 7, spread: [26, 6, 5], seed: 818, tint: 0x7fc4e8 },
    { kind: 'deco', kindOf: 'buttress', p: [57.0, -2.6, -1.4], s: [7.0, 6.0, 9.0], mat: 'obsidian', tint: COLD },
    { kind: 'light', p: [48.6, 3.0, 1.6], color: SUN, intensity: 8, distance: 18 },
    { kind: 'light', p: [76.4, 4.0, 0], color: ICE, intensity: 9, distance: 20 },

    /* ============================================================================ */
    /* BEAT 4 — ICE WITH A GAP                                                      */
    /* The twist that actually changes your hands: until now every takeoff was from   */
    /* stone. Three ice pads, none of them adjacent, offset +2.8 / -2.8 on Z so the    */
    /* drift you build up is never pointing at the next one. Gaps 1.8 / 3.0 / 2.7,     */
    /* the middle one flat and the last one climbing 0.95 m.                           */
    /*                                                                              */
    /* COIN 1 is a TIMED coin, not a distance one: a vanish tile hung 3.4 m off the   */
    /* north lip of slab 2, standable 3.3 s out of every 5.2 (63%), with nothing under */
    /* it. Getting there is a plain 3.4 m hop. Getting there while it exists is not.   */
    /* ============================================================================ */

    { kind: 'ice', p: [88.0, 1.75, 0], s: [5.4, 0.7, 8], color: ICE },   // gap 1.8 at -0.15, top 2.10
    { kind: 'ice', p: [96.0, 1.75, 2.8], s: [4.6, 0.7, 6], color: ICE }, // gap 3.0 flat, shifted +2.8 z
    { kind: 'ice', p: [104.0, 2.70, -2.8], s: [6, 0.7, 7], color: ICE }, // gap 2.7 at +0.95, back across, top 3.05

    // -- the optional line ---------------------------------------------------------
    { kind: 'vanish', p: [99.5, 1.75, 10.8], s: [3.2, 1, 3.2], mat: 'ice', surface: 'ice', cycle: { on: 2.6, off: 1.9, warn: 0.7, phase: 0.35 } }, // 3.4 m off slab 2, top 2.25
    { kind: 'deco', kindOf: 'ring', p: [99.5, 4.2, 10.8], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: SUN },
    { kind: 'light', p: [99.5, 4.4, 10.8], color: SUN, intensity: 7, distance: 15 },

    { kind: 'platform', p: [112.0, 2.45, 0], s: [6, 1, 9], mat: 'stone', glow: HAZE, stripe: true }, // gap 2.0 at -0.10, top 2.95

    { kind: 'text', p: [84.4, 3.4, 0], rot: [0, -Math.PI / 2, 0], text: 'NOW JUMP OFF IT', size: 0.46, color: 0x184a63 },
    { kind: 'text', p: [99.5, 5.2, 10.8], rot: [0, -Math.PI / 2, 0], text: 'while it lasts', size: 0.22, color: SUN },
    { kind: 'deco', kindOf: 'monolith', p: [96, -14, 24], s: [8, 26, 8], count: 5, spread: [40, 10, 12], seed: 921, tint: 0x8fb4cc },
    { kind: 'deco', kindOf: 'crystal', p: [106, 2.2, -8.6], s: [0.9, 2.2, 0.9], count: 6, spread: [10, 1, 3], seed: 1044, tint: 0x9fe8ff },
    { kind: 'light', p: [96.0, 4.2, 0], color: ICE, intensity: 7, distance: 24 },

    /* ============================================================================ */
    /* BEAT 5 — ICE THAT MOVES, THEN ICE THAT LEAVES                                */
    /* The shuttle carries `surface: 'ice'` and crosses your path at right angles     */
    /* with NO dwell, so your drift and its travel are perpendicular and you have to   */
    /* leave it while pointing somewhere it is not going. It is not a free ride: the   */
    /* first vanish tile is 10.7 m from the shuttle's home pose and 3.0 m from its far */
    /* pose, so the crossing is the route and the exit is a jump off a moving deck.    */
    /*                                                                              */
    /* Then THE WAVE. Five tiles on a 2.2 s solid / 0.6 s warning / 1.8 s gone cycle — */
    /* standable 61% of the time, not 70% — stepping 0.22 of a turn each, which on a   */
    /* 4.6 s period is 1.01 s, about one tile-hop. Ride the wave and every tile is     */
    /* under you when you land; stand still on one and the next two are already gone.  */
    /* Gaps 3.00 / 2.12 / 2.40 / 2.83 / 2.20, climbing 0.30 m a tile, swinging +-3.6 z. */
    /* ============================================================================ */

    {
      kind: 'mover',
      p: [120.5, 2.45, -5.6],
      s: [4.4, 1, 4.4],
      mat: 'ice',
      surface: 'ice',
      motion: { type: 'linear', to: [120.5, 2.45, 6.4], period: 4.8, phase: 0, ease: 'sine' },
    }, // board over 3.3 m at either pose; tops 2.95; only the FAR pose reaches tile 1

    { kind: 'vanish', p: [127.4, 2.75, 8.6], s: [3.4, 1, 3.4], mat: 'ice', surface: 'ice', cycle: { on: 2.2, off: 1.8, warn: 0.6, phase: 0.00 } }, // gap 3.0 at +0.30, top 3.25
    { kind: 'vanish', p: [132.8, 3.05, 5.0], s: [3.2, 1, 3.2], mat: 'ice', surface: 'ice', cycle: { on: 2.2, off: 1.8, warn: 0.6, phase: 0.78 } }, // gap 2.1 at +0.30, top 3.55
    { kind: 'vanish', p: [138.6, 3.35, 8.2], s: [3.0, 1, 3.0], mat: 'ice', surface: 'ice', cycle: { on: 2.2, off: 1.8, warn: 0.6, phase: 0.56 } }, // gap 2.7 at +0.30, top 3.85
    { kind: 'vanish', p: [144.0, 3.65, 4.6], s: [3.2, 1, 2.8], mat: 'ice', surface: 'ice', cycle: { on: 2.2, off: 1.8, warn: 0.6, phase: 0.34 } }, // gap 2.40 at +0.30, top 4.15
    { kind: 'vanish', p: [149.8, 3.95, 8.0], s: [2.8, 1, 3.2], mat: 'ice', surface: 'ice', cycle: { on: 2.2, off: 1.8, warn: 0.6, phase: 0.12 } }, // gap 2.83 at +0.30, top 4.45

    { kind: 'platform', p: [155.9, 3.95, 7.6], s: [5, 1, 7], mat: 'stone', glow: HAZE, stripe: true }, // gap 2.2 flat, x 153.4..158.4, top 4.45

    { kind: 'text', p: [116.0, 4.4, -2.0], rot: [0, -Math.PI / 2, 0], text: 'IT MOVES. SO DO YOU.', size: 0.42, color: 0x184a63 },
    { kind: 'text', p: [124.0, 5.4, 8.6], rot: [0, -Math.PI / 2, 0], text: 'THIN ICE', size: 0.46, color: 0xb03020 },
    { kind: 'text', p: [124.0, 4.9, 8.6], rot: [0, -Math.PI / 2, 0], text: 'keep moving. the wave does.', size: 0.22, color: 0x4a7290 },
    { kind: 'deco', kindOf: 'rail', p: [136, 6.4, 12.6], s: [32, 0.09, 0.09], mat: 'metal', tint: COLD },
    { kind: 'deco', kindOf: 'antenna', p: [124, 8.0, -9.2], s: [0.5, 12.0, 0.5], mat: 'metal', tint: COLD },
    { kind: 'deco', kindOf: 'shard', p: [138, -6.0, 1.0], s: [1.6, 6.0, 1.6], count: 6, spread: [26, 8, 6], seed: 1188, tint: 0x7fc4e8 },
    { kind: 'light', p: [132.8, 6.0, 6.8], color: ICE, intensity: 9, distance: 24 },
    { kind: 'light', p: [155.9, 6.0, 7.6], color: SUN, intensity: 8, distance: 20 },

    /* ============================================================================ */
    /* BEAT 6 — WIND, AND IT IS REAL BECAUSE THE DECK IS ICE                        */
    /* A 15 x 15 m ice deck with two opposed gusts at 9 m/s^2. On ice the friction    */
    /* floor is 5.6, so 9 wins: stand still and you accelerate to 6.4 m/s of pure      */
    /* sideways, and crossing the deck in a straight line means leaning into a shove,  */
    /* feeling it stop, and being thrown the other way. iceAccel is 26 against that 9, */
    /* so you always have authority — you just have to spend it. The deck is 15 m      */
    /* across on purpose: this is where the force is free to learn.                    */
    /*                                                                              */
    /* Then it stops being free. The raft is 4.4 m of ice crossing 10 m of open air    */
    /* INSIDE the second gust, and the tongue it delivers you to is 4 m deep. The deck */
    /* to the tongue is 9.2 m of nothing — the raft is the only way, and it is         */
    /* boardable at either end of its travel (2.6 m) and left at either end (2.34 m). */
    /* ============================================================================ */

    { kind: 'ice', p: [168.1, 2.55, 0], s: [15, 0.7, 15], color: ICE }, // gap 2.5 at -1.55, top 2.90

    { kind: 'wind', p: [164.0, 4.90, 0], s: [8, 6, 15], dir: [0, 0, 1], power: 9, color: 0xd8f2ff },
    { kind: 'wind', p: [176.0, 4.90, 0], s: [13, 6, 16], dir: [0, 0, -1], power: 9, color: 0xd8f2ff },

    {
      kind: 'mover',
      p: [180.4, 2.85, -5.0],
      s: [4.4, 1, 4.4],
      mat: 'ice',
      surface: 'ice',
      motion: { type: 'linear', to: [180.4, 2.85, 5.0], period: 4.4, phase: 0.5, ease: 'sine' },
    }, // ice, moving, inside the -Z gust. board over 2.6 m at +0.45, leave over 2.3 m at -0.15

    { kind: 'ice', p: [187.0, 2.85, 0], s: [4.4, 0.7, 4.0], color: ICE }, // 4 m deep, top 3.20 — the narrow tongue

    { kind: 'text', p: [160.0, 6.0, 0], rot: [0, -Math.PI / 2, 0], text: 'W I N D', size: 0.66, color: 0x184a63 },
    { kind: 'text', p: [160.0, 5.35, 0], rot: [0, -Math.PI / 2, 0], text: 'it changes its mind halfway across', size: 0.24, color: 0x4a7290 },
    { kind: 'deco', kindOf: 'fence', p: [168.1, 3.85, -8.0], s: [14.0, 1.6, 0.14], mat: 'metal', tint: COLD },
    { kind: 'deco', kindOf: 'banner', p: [161.5, 5.9, -8.0], s: [0.1, 2.6, 1.8], mat: 'panel', tint: SUN },
    { kind: 'deco', kindOf: 'banner', p: [174.5, 5.9, -8.0], s: [0.1, 2.6, 1.8], mat: 'panel', tint: SUN },
    { kind: 'deco', kindOf: 'brazier', p: [171.0, 3.9, -6.6], s: [0.9, 1.3, 0.9], mat: 'metal', tint: SUN },
    { kind: 'light', p: [171.0, 4.9, -6.6], color: SUN, intensity: 8, distance: 15, flicker: 0.3 },
    { kind: 'light', p: [180.4, 6.4, 0], color: ICE, intensity: 9, distance: 22 },

    /* ============================================================================ */
    /* BEAT 7 — THE FALL, AND THE CELLAR                                            */
    /* The route goes DOWN. The tongue ends 4.6 m short of a stone shelf 3.85 m below  */
    /* it, and you walk off the end of the ice into the only descent on the stage —    */
    /* out of the wind, out of the sun, under the catwalks, on a floor that holds       */
    /* still. Every metre of the climb back out is one you can see from the tongue.     */
    /*                                                                              */
    /* THE PIT. 3.2 m of stone gap over a spike bed, with an icicle the size of a mast  */
    /* swinging ALONG the jump on a 3.4 s period. Here a spike bed is honest: it is on  */
    /* the floor of a lit pit you are standing over, on STONE, where you have 95 m/s^2  */
    /* of braking authority and can simply choose not to jump yet.                      */
    /*                                                                              */
    /* COIN 2 hangs 1.2 m over the middle of the pit, inside the jump arc — the only    */
    /* way to it is to commit to the jump and be at the top of it when you pass.        */
    /*                                                                              */
    /* THE WAY OUT is a 5.6 m jump pad, and beside it a three-rung ice stair for anyone */
    /* who would rather climb. Both arrive at the WEST end of the vane catwalk: the     */
    /* stair is slower and it skips nothing.                                            */
    /* ============================================================================ */

    { kind: 'platform', p: [197.3, -1.15, 0], s: [7, 1, 9], mat: 'stone', glow: HAZE, stripe: true }, // gap 4.6 at -3.85, x 193.8..200.8, top -0.65

    { kind: 'spikes', p: [202.4, -1.45, 0], s: [3.0, 0.8, 9], dir: [0, 1, 0] }, // the pit floor, top -1.05
    {
      kind: 'pendulum',
      p: [202.4, 4.20, 0],
      len: 3.4,
      ampDeg: 42,
      period: 3.4,
      phase: 0,
      blade: { w: 1.6, h: 1.2, d: 0.28 },
      axis: [0, 0, 1],
    }, // swings along +-X across the pit mouth; lowest paint y 0.20, i.e. 0.85 m over the shelves

    { kind: 'platform', p: [207.5, -1.15, 0], s: [7, 1, 9], mat: 'stone', glow: ICE, stripe: true }, // gap 3.2 flat over the pit, x 204.0..211.0, top -0.65

    { kind: 'jumppad', p: [206.5, -0.58, 0], s: [3, 0.14, 3], power: 5.6, dir: [0, 1, 0] }, // x 205.0..208.0, launches at 204.65, 3.76 m of rise

    // -- the walker's line out of the cellar: three ice rungs up the north wall ------
    { kind: 'ice', p: [204.2, 0.55, 7.6], s: [3.4, 0.7, 3.4], color: ICE }, // gap 2.2 at +1.55, x 202.5..205.9, top 0.90
    { kind: 'ice', p: [209.2, 1.85, 8.2], s: [3.2, 0.7, 3.2], color: ICE }, // gap 1.7 at +1.30, x 207.6..210.8, top 2.20
    { kind: 'ice', p: [214.2, 2.90, 4.8], s: [3.0, 0.7, 3.0], color: ICE }, // gap 1.9 at +1.05, x 212.7..215.7, top 3.25

    { kind: 'text', p: [191.6, 2.4, 0], rot: [0, -Math.PI / 2, 0], text: 'DOWN', size: 0.56, color: 0xb03020 },
    { kind: 'text', p: [191.6, 1.85, 0], rot: [0, -Math.PI / 2, 0], text: 'the only way on is the way under', size: 0.22, color: 0x4a7290 },
    { kind: 'text', p: [207.5, 1.4, -4.2], rot: [0, -Math.PI / 2, 0], text: 'STAND ON IT  ·  or take the stair', size: 0.26, color: ICE },
    { kind: 'deco', kindOf: 'buttress', p: [197.3, -5.0, 0], s: [6.0, 8.0, 9.0], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'buttress', p: [207.5, -5.0, 0], s: [6.0, 8.0, 9.0], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'crystal', p: [202.4, -0.4, 6.0], s: [0.9, 2.0, 0.9], count: 7, spread: [12, 1.2, 3], seed: 1250, tint: 0x9fe8ff },
    { kind: 'deco', kindOf: 'brazier', p: [199.0, -0.1, -3.4], s: [0.9, 1.3, 0.9], mat: 'metal', tint: SUN },
    { kind: 'light', p: [199.0, 0.9, -3.4], color: SUN, intensity: 9, distance: 16, flicker: 0.3 },
    { kind: 'light', p: [202.4, 1.6, 0], color: 0xff6a3c, intensity: 9, distance: 18 },
    { kind: 'light', p: [209.2, 3.4, 8.2], color: ICE, intensity: 7, distance: 16 },

    /* ============================================================================ */
    /* BEAT 8 — THE VANES                                                           */
    /* A 13 m ice catwalk, 3.6 m wide, 3.9 m above the cellar floor, with two ice      */
    /* windmills turning across it 6 m apart. See the header for the geometry: the     */
    /* lethal edge is 0.59 m over the deck, which is under the crouch height and above */
    /* nothing you can jump, so each vane is a timing gate and not a hurdle. Three arms */
    /* on 6.0 s and two arms on 4.4 s means a blade every 2.00 s and every 2.20 s, out  */
    /* of step, so the two gates never open on the same beat twice running.             */
    /*                                                                              */
    /* The two hubs are 1.50 m apart in z. Each blade's kill capsule reaches 0.75 m to  */
    /* either side of its own plane, so between them they cover z -1.50 .. +1.50 and    */
    /* the catwalk's usable stance band is z -1.45 .. +1.45. There is no lane.          */
    /*                                                                              */
    /* And the deck is ICE, so "wait for the gap" is a real request: you cannot stop on */
    /* a mark, you have to arrive at one.                                               */
    /* ============================================================================ */

    { kind: 'beam', p: [215.1, 2.95, 0], s: [13, 0.6, 3.6], mat: 'metal', surface: 'ice' }, // x 208.6..221.6, top 3.25

    { kind: 'rotor', p: [213.0, 8.20, -0.75], style: 'windmill', arms: 3, len: 3.6, thick: 0.4, period: 6.0, phase: 0, axis: [0, 0, 1], mount: 0 },
    { kind: 'rotor', p: [219.0, 8.20, 0.75], style: 'windmill', arms: 2, len: 3.6, thick: 0.4, period: 4.4, phase: 0.37, axis: [0, 0, 1], mount: 0 },

    { kind: 'platform', p: [231.7, 2.95, 0], s: [12.6, 1, 9], mat: 'stone', glow: HAZE, stripe: true }, // gap 3.8 at +0.20, x 225.4..238.0, top 3.45

    { kind: 'text', p: [211.0, 6.6, 3.2], rot: [0, -Math.PI / 2, 0], text: 'NO LANE', size: 0.44, color: 0xb03020 },
    { kind: 'text', p: [211.0, 6.1, 3.2], rot: [0, -Math.PI / 2, 0], text: 'you cannot walk round these', size: 0.22, color: 0x4a7290 },
    { kind: 'deco', kindOf: 'pillar', p: [213.0, 12.0, -0.75], s: [1.0, 7.0, 1.0], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'pillar', p: [219.0, 12.0, 0.75], s: [1.0, 7.0, 1.0], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'post', p: [211.0, 4.4, 2.6], s: [0.16, 2.6, 0.16], count: 5, spread: [12, 0.4, 0.4], seed: 1290, tint: COLD },
    { kind: 'deco', kindOf: 'cloud', p: [212, -18, 0], s: [18, 3, 18], count: 10, spread: [70, 8, 60], seed: 1355, scale: 1.7, tint: 0xeaf6ff },
    { kind: 'light', p: [216.0, 6.2, 0], color: ICE, intensity: 10, distance: 24 },
    { kind: 'light', p: [231.7, 5.6, 0], color: SUN, intensity: 9, distance: 20 },

    /* ============================================================================ */
    /* BEAT 9 — ICE AND WIND                                                        */
    /* TWO WAYS OFF THIS LIP, and they are different jobs.                            */
    /*                                                                              */
    /* THE SPRINT. Deck lip to crosswind slab 1 is 5.70 m of open air at +0.10 m. A   */
    /* run jump maxes at 5.19 m there and the sprint-SAFE limit is 6.11 m, so it is    */
    /* 0.51 m past what a walker can do and 0.41 m inside what a sprinter can, and it  */
    /* is the only gap on the whole stage that carries a consequence. (It used to be   */
    /* 5.40 m, which cleared the run-jump maximum by 7 cm — inside the error of "did I */
    /* let go of shift".) You sprint it UNDER the cornice, with 0.46 m over your head. */
    /*                                                                              */
    /* THE PAD. Apex 7.2 m, and it does not throw you at the slab — it LIFTS you 4.91 m*/
    /* onto the cornice, an 8 x 6 m ice shelf at y 8.50 that no jump reaches (5.05 m of */
    /* rise against a 2.09 m apex) and that only the pad can put you on. A pad arc is   */
    /* FIXED (reachcheck.mjs:47-66: both halves run at gravFall, and the pad adds no    */
    /* horizontal speed), so the landing has to swallow the whole entry-speed band —    */
    /* 4.85 m at a walk-on to 11.79 m at a sprint-on with jump held. The cornice runs   */
    /* 4.35 m to 12.35 m from the launch point, so every entry speed lands on it, and    */
    /* slab 1 starts 14.65 m out, which is past even the fastest arc: the pad CANNOT     */
    /* short-change you onto the crosswind, it can only put you on the cornice.          */
    /* From the cornice you walk off the far lip and drop 4.95 m onto slab 1.           */
    /*                                                                              */
    /* COIN 3 sits on the cornice: pad-only, 5.05 m above the deck, and the only coin   */
    /* on the stage you collect by standing still somewhere you cannot jump to.         */
    /*                                                                              */
    /* Then the lesson, twice: a 9 m-wide ice slab under a 9 m/s^2 crosswind, then a    */
    /* second one 0.30 m lower with the wind reversed. Both slabs are ICE, so both      */
    /* gusts are worth 6.4 m/s of drift and neither of them is scenery.                 */
    /* ============================================================================ */

    { kind: 'jumppad', p: [230.9, 3.52, 0], s: [3, 0.14, 3], power: 7.2, dir: [0, 1, 0] }, // x 229.4..232.4, launches at 229.05
    { kind: 'text', p: [227.0, 5.2, 0], rot: [0, -Math.PI / 2, 0], text: 'STAND ON IT', size: 0.34, color: ICE },
    { kind: 'text', p: [227.0, 4.7, 0], rot: [0, -Math.PI / 2, 0], text: 'or run past it and sprint. 5.70 m.', size: 0.22, color: SUN },

    { kind: 'ice', p: [237.4, 8.15, 0], s: [8, 0.7, 6], color: SUN }, // THE CORNICE — pad-only, x 233.4..241.4, top 8.50
    { kind: 'deco', kindOf: 'ring', p: [237.4, 10.5, 0], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: SUN },
    { kind: 'light', p: [237.4, 10.7, 0], color: SUN, intensity: 7, distance: 15 },

    { kind: 'ice', p: [247.9, 3.20, 0], s: [8.4, 0.7, 9], color: ICE }, // gap 5.70 at +0.10 from the lip, or a 2.3 m walk-off the cornice; x 243.7..252.1, top 3.55
    { kind: 'wind', p: [247.9, 5.55, 0], s: [8, 6, 12], dir: [0, 0, 1], power: 9, color: 0xd8f2ff },

    { kind: 'ice', p: [258.7, 2.90, 0], s: [8, 0.7, 9], color: ICE }, // gap 2.6 at -0.30, wind reverses; x 254.7..262.7, top 3.25
    { kind: 'wind', p: [258.7, 5.25, 0], s: [8, 6, 12], dir: [0, 0, -1], power: 9, color: 0xd8f2ff },

    { kind: 'text', p: [244.0, 6.6, -5.0], rot: [0, -Math.PI / 2, 0], text: 'BOTH AT ONCE', size: 0.5, color: 0x184a63 },
    // The cornice is corbelled off the mountain on two brackets, clear of the sprint
    // lane at z 0 so nothing decorative ever sits in a line the player has to run.
    { kind: 'deco', kindOf: 'buttress', p: [237.4, 6.2, 4.6], s: [5.0, 4.0, 2.2], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'buttress', p: [237.4, 6.2, -4.6], s: [5.0, 4.0, 2.2], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'monolith', p: [250, -16, -30], s: [10, 30, 10], count: 5, spread: [46, 12, 14], seed: 1466, tint: 0x8fb4cc },
    { kind: 'deco', kindOf: 'shard', p: [252, -5.0, -9.8], s: [1.5, 5.5, 1.5], count: 6, spread: [22, 7, 4], seed: 1523, tint: 0x7fc4e8 },
    { kind: 'light', p: [253.6, 6.4, 0], color: ICE, intensity: 10, distance: 26 },

    /* ============================================================================ */
    /* BEAT 10 — THE DOORSTEP                                                       */
    /* Seven metres of dry stone and a gate you can see the entire spiral through.    */
    /* The last checkpoint on the stage sits here, because the stair behind it is 55 m */
    /* of jumping and a fall on the fifth plate should not re-run the crosswind.       */
    /* ============================================================================ */

    { kind: 'platform', p: [269.1, 2.95, 0], s: [7, 1, 8], mat: 'stone', glow: HAZE, stripe: true }, // gap 2.9 at +0.20, x 265.6..272.6, top 3.45

    { kind: 'deco', kindOf: 'arch', p: [271.6, 8.0, 0], s: [1.1, 1.0, 10.0], mat: 'obsidian', tint: ICE },
    { kind: 'deco', kindOf: 'pillar', p: [271.6, 5.6, 4.6], s: [1.3, 4.6, 1.3], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'pillar', p: [271.6, 5.6, -4.6], s: [1.3, 4.6, 1.3], mat: 'obsidian', tint: COLD },
    { kind: 'text', p: [266.2, 5.6, 0], rot: [0, -Math.PI / 2, 0], text: 'THE OUTSIDE STAIR', size: 0.44, color: 0x184a63 },
    { kind: 'text', p: [266.2, 5.05, 0], rot: [0, -Math.PI / 2, 0], text: 'seven jumps, and the mountain turns under you', size: 0.22, color: 0x4a7290 },
    { kind: 'light', p: [271.6, 7.0, 0], color: ICE, intensity: 12, distance: 26 },

    /* ============================================================================ */
    /* BEAT 11 — SET-PIECE : THE OUTSIDE STAIR                                      */
    /* Six sheets of ice cut into the north face of the spire, on an 18 m radius arc   */
    /* centred on the tower at x 295.9. The plate centres sit at 172 / 135 / 105 / 75 / */
    /* 45 / 18 degrees round that circle, so the path leaves the doorstep heading +Z,   */
    /* runs +X across the top of the arc, and leaves the last plate heading -Z: about   */
    /* 150 degrees of turn in 55 m. The tower it wraps is a 17 x 17 m monolith that     */
    /* stands from y -14 to y 32 — 22 m ABOVE the summit — and the stair passes outside  */
    /* it the whole way. You can see the spire from every plate, which is the point.     */
    /*                                                                              */
    /* THERE ARE NO STEPS ON THIS STAIR. Every riser is 0.85-0.95 m against a stepUp    */
    /* of 0.55, so all seven seams are JUMPS, and four of them are open gaps of 2.57 to */
    /* 3.62 m onto plates 4.8 and 4.6 m across. Plate lengths run 7.5 / 4.2 / 6.6 /     */
    /* 4.8 / 6.2 / 5.6, so no two seams measure the same and the rhythm never settles.  */
    /*                                                                              */
    /* AND YOU CANNOT SKIP ONE. Every N to N+2 pair was measured: the shortest is       */
    /* 9.31 m at +1.75 m of rise, against a sprint maximum of 5.41 m at that rise.      */
    /* (The old stair overlapped its plates 3.5 m and handed out a 1.5 m skip-one hop,  */
    /* so six plates played as three.) reachcheck reports tightEdges 0.                 */
    /*                                                                              */
    /* THE WIND TURNS WITH YOU, and that is the whole set-piece. There are three gusts, */
    /* +Z / -Z / +Z, and because the path bends 150 degrees under them the SAME gust     */
    /* is a tailwind on plate 1 (you are running +Z into it), a true crosswind at the   */
    /* apex (you are running +X), and a headwind on the last plate (you are running -Z).*/
    /* Every plate is ice, so every gust is worth 6.4 m/s of drift, and the plate where */
    /* the shove and the bend AGREE is the one that throws people off the mountain.     */
    /* ============================================================================ */

    { kind: 'ice', p: [278.08, 4.05, 2.51], s: [7.5, 0.7, 8.4], color: ICE },  // gap 1.73 at +0.95, top 4.40 — theta 172, the first tread
    { kind: 'ice', p: [283.17, 4.95, 12.73], s: [4.2, 0.7, 5.6], color: ICE }, // gap 3.22 at +0.90, top 5.30 — theta 135, the bend begins
    { kind: 'ice', p: [291.24, 5.80, 17.39], s: [6.6, 0.7, 4.6], color: ICE }, // gap 2.67 at +0.85, top 6.15 — theta 105, 4.6 m deep
    { kind: 'ice', p: [300.56, 6.75, 17.39], s: [4.8, 0.7, 5.4], color: ICE }, // gap 3.62 at +0.95, top 7.10 — theta 75, the apex and the narrow one
    { kind: 'ice', p: [308.63, 7.65, 12.73], s: [6.2, 0.7, 5.0], color: ICE }, // gap 2.57 at +0.90, top 8.00 — theta 45, coming back down the face
    { kind: 'ice', p: [313.02, 8.50, 5.56], s: [5.6, 0.7, 6.6], color: ICE },  // gap 1.37 at +0.85, top 8.85 — theta 18, now heading -Z

    { kind: 'wind', p: [280.0, 7.0, 6.0], s: [14, 8, 16], dir: [0, 0, 1], power: 8, color: 0xd8f2ff }, // x 273..287: clear of the stone doorstep (ends 272.6)
    { kind: 'wind', p: [294.2, 9.5, 17.0], s: [18, 8, 14], dir: [0, 0, -1], power: 9, color: 0xd8f2ff },
    { kind: 'wind', p: [310.2, 11.0, 8.0], s: [16, 8, 16], dir: [0, 0, 1], power: 8, color: 0xd8f2ff },

    // THE SPIRE. The thing the stair is cut into, and the reason the world is called
    // the Frozen Spire: 17 m square, 46 m tall, standing inside the arc from y -14 to
    // y 32 — 22 m above the summit. Every plate above passes outside its footprint
    // (x 287.4..304.4, z +-8.5), and you can see it from all six of them.
    { kind: 'deco', kindOf: 'monolith', p: [295.9, 9.0, 0], s: [17, 46, 17], mat: 'obsidian', tint: 0x9dbdd6 },
    { kind: 'deco', kindOf: 'buttress', p: [288.2, 2.0, 6.0], s: [4.0, 10.0, 3.0], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'buttress', p: [302.2, 3.6, 7.0], s: [4.0, 10.0, 3.0], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'crystal', p: [291.2, 6.4, 20.4], s: [0.9, 2.4, 0.9], count: 8, spread: [16, 1.4, 3], seed: 1611, tint: 0x9fe8ff },
    { kind: 'deco', kindOf: 'banner', p: [282.2, 8.2, 16.4], s: [0.1, 3.0, 1.8], mat: 'panel', tint: SUN },
    { kind: 'deco', kindOf: 'banner', p: [305.2, 11.4, 16.0], s: [0.1, 3.0, 1.8], mat: 'panel', tint: SUN },
    { kind: 'text', p: [295.9, 21.0, 0], rot: [0, -Math.PI / 2, 0], text: 'S P I R E', size: 0.9, color: 0x1d4257 },
    { kind: 'light', p: [284.2, 8.4, 10.0], color: ICE, intensity: 9, distance: 24 },
    { kind: 'light', p: [297.2, 11.0, 18.0], color: SUN, intensity: 9, distance: 24 },
    { kind: 'light', p: [311.2, 12.0, 8.0], color: ICE, intensity: 9, distance: 24 },

    /* ============================================================================ */
    /* THE SUMMIT                                                                   */
    /* One last 3.58 m jump at +0.95, off the ice and onto obsidian, framed by the    */
    /* gate so the run ends on something that holds still.                            */
    /* ============================================================================ */

    { kind: 'platform', p: [323.9, 9.30, -1.0], s: [9, 1, 10], mat: 'obsidian', glow: SUN, stripe: true }, // gap 3.58 at +0.95, top 9.80

    { kind: 'deco', kindOf: 'arch', p: [323.9, 14.8, -1.0], s: [1.3, 1.0, 10.0], mat: 'obsidian', tint: SUN },
    { kind: 'deco', kindOf: 'pillar', p: [323.9, 12.4, 3.6], s: [1.3, 5.4, 1.3], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'pillar', p: [323.9, 12.4, -5.6], s: [1.3, 5.4, 1.3], mat: 'obsidian', tint: COLD },
    { kind: 'deco', kindOf: 'beacon', p: [327.8, 11.8, -1.0], s: [0.7, 3.0, 0.7], mat: 'emissive', tint: SUN },
    { kind: 'deco', kindOf: 'brazier', p: [320.6, 10.6, -5.4], s: [1.0, 1.4, 1.0], mat: 'metal', tint: SUN },
    { kind: 'text', p: [321.0, 11.8, -1.0], rot: [0, -Math.PI / 2, 0], text: 'FIRST FROST', size: 0.42, color: SUN },
    { kind: 'light', p: [323.9, 13.2, -1.0], color: SUN, intensity: 20, distance: 34 },
    { kind: 'light', p: [320.6, 11.6, -5.4], color: SUN, intensity: 7, distance: 14, flicker: 0.3 },

    /* ============================================================================ */
    /* THE MOUNTAIN — everything below and beside the course.                       */
    /* All of it lives outside every play corridor on the stage, and all of it is     */
    /* ROCK, SNOW or CLOUD — no flat pale slabs at walk height anywhere, because in    */
    /* this palette a flat pale slab means "land here". The peaks get taller as the    */
    /* stage climbs so the horizon keeps pace.                                        */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'monolith', p: [40, -26, 34], s: [12, 44, 12], count: 6, spread: [110, 22, 26], seed: 2101, tint: 0x9dbdd6 },
    { kind: 'deco', kindOf: 'monolith', p: [40, -28, -36], s: [12, 44, 12], count: 6, spread: [110, 22, 26], seed: 2202, tint: 0x9dbdd6 },
    { kind: 'deco', kindOf: 'monolith', p: [190, -22, -42], s: [14, 52, 14], count: 6, spread: [130, 26, 28], seed: 2303, tint: 0xa8c8de },
    { kind: 'deco', kindOf: 'monolith', p: [258, -24, -46], s: [14, 52, 14], count: 6, spread: [140, 26, 28], seed: 2404, tint: 0xa8c8de },
    { kind: 'deco', kindOf: 'shard', p: [110, -12, 22], s: [2.0, 8.0, 2.0], count: 10, spread: [180, 10, 8], seed: 2505, tint: 0x7fc4e8 },
    { kind: 'deco', kindOf: 'shard', p: [110, -13, -23], s: [2.0, 8.0, 2.0], count: 10, spread: [180, 10, 8], seed: 2606, tint: 0x7fc4e8 },
    { kind: 'deco', kindOf: 'cloud', p: [150, -30, 0], s: [24, 3, 24], count: 16, spread: [300, 14, 120], seed: 2707, scale: 2.1, tint: 0xf2fbff },
    { kind: 'deco', kindOf: 'cloud', p: [296, -20, 32], s: [20, 3, 20], count: 10, spread: [150, 10, 60], seed: 2808, scale: 1.8, tint: 0xf2fbff },

    // Sun lamps down the length of the course. Warm, low and on the SOUTH side only,
    // so every ice lip in the stage carries the same orange rim and "edge" always
    // reads the same way no matter which beat you are in.
    { kind: 'light', p: [30, 4.0, -8.0], color: SUN, intensity: 7, distance: 26 },
    { kind: 'light', p: [66, 4.2, -8.0], color: SUN, intensity: 7, distance: 26 },
    { kind: 'light', p: [104, 5.0, -8.0], color: SUN, intensity: 7, distance: 26 },
    { kind: 'light', p: [144, 5.6, -4.0], color: SUN, intensity: 7, distance: 26 },
    { kind: 'light', p: [188, 6.2, -8.0], color: SUN, intensity: 7, distance: 26 },
    { kind: 'light', p: [240, 6.6, -8.0], color: SUN, intensity: 7, distance: 26 },
    { kind: 'light', p: [276, 8.0, -6.0], color: SUN, intensity: 7, distance: 26 },
    { kind: 'light', p: [314, 10.0, -6.0], color: SUN, intensity: 7, distance: 26 },
  ],
};
