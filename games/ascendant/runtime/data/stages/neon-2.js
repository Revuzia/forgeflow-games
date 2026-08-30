/**
 * ASCENDANT — NEON DOJO 2 : "CIRCUIT BREAK"
 * runtime/data/stages/neon-2.js
 *
 * A substation strung between rooftops. Everything here is powered, and most of it
 * is on a timer. The stage is a lesson in reading a rhythm rather than a distance.
 *
 * SHAPE      ~291 m of travel, 51 gameplay objects, 25 dynamic hazards,
 *            5 checkpoints (never more than 61 m apart), 4 coins.
 *
 * ESCALATES what neon-1 taught in isolation:
 *   MOVERS   BEAT 3 recaps the straight shuttle, then BEAT 4 turns it 90 degrees so
 *            it crosses your path, then hands you an orbit that never stops at all.
 *   VANISH   BEAT 5 tightens neon-1's generous panels into a five-tile run on a
 *            5.6 s cycle with a staggered phase ladder.
 * INTRODUCES rotors, and only rotors:
 *   BEAT 8   two open discs with one sweeping bar each, nothing else moving.
 *   BEAT 9   the same rotor turned on its side over a narrow bridge.
 * then combines all three: BEAT 6 mover -> tiles -> mover, and BEAT 10 stacks the
 * lot four metres higher up.
 *
 * ── THE HOUSE RULES (stated in full at the top of neon-1.js) ─────────────────
 * 1. The reach envelope is law (CONTRACT §0). Nothing on the main line of this
 *    stage needs a sprint; the longest flat gap is 3.7 m against a 4.4 m budget.
 * 2. Mind the surface you did not mean to offer. The validator graphs EVERY pair of
 *    landable surfaces and routes through the fewest hops, so platform N to N+2
 *    matters as much as N to N+1. Two bands are forbidden because a jump inside
 *    them is one a player can *just barely* make: 4.36-5.24 m and 6.18-7.44 m.
 *    Every distance in this file sits under 4.35, inside the comfortable sprint
 *    band 5.25-6.17, or past 7.45 where nothing can reach.
 * 3. EVERY LINK MUST BE JUMPABLE. This is the rule this stage exists to demonstrate.
 *    BEAT 10 has a launch pad AND a lift up to the breaker gallery: the pad is the
 *    route, the lift is the ride. An earlier draft of this file had only the lift,
 *    and the whole finale — four vanish tiles, a rotor disc, the shuttle and the
 *    finish — was unreachable geometry that no player could legally enter and no
 *    validator could vouch for. A moving platform is never the only way across.
 * 4. Timed hazards are pure functions of the stage clock (CONTRACT §16), and
 *    `phase` is a FRACTION OF ONE CYCLE (0..1) for both vanish tiles and rotors —
 *    never seconds. Every tile ladder below steps by a constant fraction, which is
 *    what makes a gauntlet learnable instead of lucky.
 * 5. Vary gap, height and width constantly. No two consecutive obstacles here share
 *    all three, and no mechanic appears more than twice in a row without a beat of
 *    quiet in between.
 * 6. Every landing is visible from its take-off.
 *
 * CONVENTIONS (full list in runtime/data/index.js):
 *   p = CENTRE, s = FULL size, top surface = p[1] + s[1]/2. Gaps in the comments are
 *   EDGE TO EDGE. rot/yaw in radians, yaw 0 faces +X. `stripe: true` = must jump here.
 *   A mover's `p` is its HOME pose and `motion.to` is its far pose; the validator
 *   treats BOTH poses as landable surfaces, so both are quoted where it matters.
 *
 * REACH BUDGET USED (safe limits: 4.4 flat / 3.8 at +1.0 m / 3.4 at +1.5 m):
 *   longest flat gap on the main line   3.7 m   (BEAT 6, off the crossing shuttle)
 *   longest diagonal                    3.05 m  (BEAT 10, the gallery zig-zag)
 *   longest rise                        0.9 m over 3.1 m   (BEAT 7, the steps)
 *   riskiest optional line              4.0 m flat, twice   (BEAT 5, the coin tile)
 *   No jump on this stage requires a sprint. Sprinting still saves about 25 s.
 *
 * HEIGHT LADDER: 0.5 (yard) -> 1.0 (the shuttle run) -> 1.9 (vanish school and the
 *                combined beat) -> 2.8 (rotor plaza and bridge) -> 6.8 (the breaker
 *                gallery, reached by the launch pad in BEAT 10).
 */

const NEON = 0x7ef0ff;
const HOT = 0xff4f7a;
const AMBER = 0xffb347;
const DIM = 0x2b6f9e;

export default {
  id: 'neon-2',
  world: 'neon',
  name: 'CIRCUIT BREAK',
  subtitle: 'Everything here is on a timer, including you',
  par: 146000,
  difficulty: 3,

  spawn: { p: [0, 0.6, 0], yaw: 0 },
  killY: -35,

  checkpoints: [
    // On the last static hop, looking straight at the first moving platform.
    { p: [25.6, 1.1, 0], yaw: 0, clockOffset: 0 },
    // Off the orbit, before the vanish school.
    { p: [77.7, 1.1, 0], yaw: 0, clockOffset: 0 },
    // Off the vanish school, before movers and tiles get combined.
    { p: [113.9, 2.0, 0], yaw: 0, clockOffset: 0 },
    // On the plaza, before the first rotor. clockOffset 1.25 rather than 0: with r1
    // on a 5.0 s period and two arms, a bar crosses the entry every 2.5 s, and at
    // t = 1.25 one has just gone past. You respawn into the safe half of the cycle
    // instead of sprinting into a bar you could not have seen.
    { p: [174.2, 2.9, 0], yaw: 0, clockOffset: 1.25 },
    // The launch court, before the finale. The longest leg on the stage at roughly
    // 30 s, and the only one with a genuine set-piece in it.
    { p: [226.2, 2.9, 0], yaw: 0, clockOffset: 0 },
  ],

  finish: { p: [291.2, 6.9, 0], yaw: 0 },

  coins: [
    { p: [68.0, 2.2, -3.0] }, // BEAT 4 — the far side of the orbit, one extra half-turn
    { p: [97.0, 2.0, 9.4] }, // BEAT 5 — a tile of its own, 4.0 m out over the drop
    { p: [176.2, 4.0, -8.4] }, // BEAT 7 — a side ledge on the breather
    { p: [201.6, 5.0, -3.4] }, // BEAT 8 — the perch above the second rotor
  ],

  objects: [
    /* ============================================================================ */
    /* BEAT 1 — THE YARD                                                            */
    /* Static ground, a name plate, and the hum of something about to start moving.  */
    /* The crates sit deep inside the yard: from the tallest, the first gap is a     */
    /* 6.53 m drop-jump, which is a comfortable sprint hop rather than a full-stretch */
    /* one. Slide them 2 m forward and that same accident lands in the forbidden      */
    /* band, and the stage has quietly offered a jump it never designed.              */
    /* ============================================================================ */

    { kind: 'platform', p: [2, 0, 0], s: [16, 1, 12], mat: 'stone', glow: DIM },
    { kind: 'platform', p: [0.0, 0.85, 4.4], s: [2.4, 0.7, 2.4], mat: 'panel', glow: NEON, stripe: true },
    { kind: 'platform', p: [2.6, 1.05, 4.4], s: [2.2, 1.1, 2.2], mat: 'panel', glow: NEON, stripe: true },
    { kind: 'platform', p: [5.0, 1.25, 4.4], s: [2.0, 1.5, 2.0], mat: 'panel', glow: NEON, stripe: true },

    { kind: 'text', p: [-4.6, 2.7, 0], rot: [0, -Math.PI / 2, 0], text: 'CIRCUIT BREAK', size: 0.78, color: NEON },
    { kind: 'text', p: [-4.6, 2.05, 0], rot: [0, -Math.PI / 2, 0], text: 'NEON DOJO  ·  II', size: 0.28, color: 0x6f8dac },
    { kind: 'text', p: [-4.6, 1.5, 0], rot: [0, -Math.PI / 2, 0], text: 'nothing here waits for you twice', size: 0.24, color: HOT },

    { kind: 'deco', kindOf: 'pipe', p: [2, 3.9, 5.6], s: [22, 0.5, 0.5], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'pipe', p: [2, 4.3, -5.6], s: [22, 0.5, 0.5], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'panel', p: [4, 3.0, -6.4], s: [3.0, 2.4, 0.4], mat: 'emissive', tint: 0x2f6ea8 },
    { kind: 'light', p: [2, 4.2, 0], color: 0xbcd8f5, intensity: 8, distance: 22 },

    /* ============================================================================ */
    /* BEAT 2 — REMINDER                                                            */
    /* Three static hops: 2.4 / 2.4 / 2.8 m, the last one half a metre up. neon-1's  */
    /* first act in ten seconds, so this stage can assume it and move on.            */
    /* ============================================================================ */

    { kind: 'platform', p: [13.9, 0, 0], s: [3.0, 1, 4.2], mat: 'panel', glow: NEON, stripe: true }, // gap 2.4
    { kind: 'platform', p: [19.4, 0, -0.8], s: [3.2, 1, 4.2], mat: 'panel', glow: NEON, stripe: true }, // gap 2.4
    { kind: 'platform', p: [25.6, 0.5, 0], s: [3.6, 1, 4.6], mat: 'panel', glow: NEON, stripe: true }, // gap 2.8, +0.5

    /* ============================================================================ */
    /* BEAT 3 — THE FIRST MOVING PLATFORM                                           */
    /* Deliberately the easiest mover on the stage: straight down the stage axis, a  */
    /* 7 s round trip, 0.8 s of dwell at each end, and it comes back if you miss it. */
    /* Board at 2.3 m from the ledge, ride 7 m, step off at 3.6 m.                   */
    /* The pier at z = -5.6 is a place to stand while it comes back, and it is 1.7 m */
    /* from the landing, so nobody who uses it is stuck there.                       */
    /* ============================================================================ */

    {
      kind: 'mover',
      p: [31.6, 0.5, 0],
      s: [3.8, 1, 4.4],
      mat: 'metal',
      motion: { type: 'linear', to: [38.6, 0.5, 0], period: 7.0, phase: 0, ease: 'sine', dwell: 0.8 },
    },
    { kind: 'platform', p: [43.0, 0.5, -5.6], s: [2.6, 1, 2.6], mat: 'panel', glow: AMBER, stripe: true }, // the pier
    { kind: 'platform', p: [46.4, 0.5, 0], s: [4.6, 1, 5.2], mat: 'stone', glow: DIM, stripe: true }, // 3.6 m off the mover

    { kind: 'text', p: [28.2, 2.6, 0], rot: [0, -Math.PI / 2, 0], text: 'RIDE IT', size: 0.5, color: NEON },
    { kind: 'text', p: [28.2, 2.05, 0], rot: [0, -Math.PI / 2, 0], text: 'it will come back', size: 0.24, color: 0x6f8dac },
    { kind: 'deco', kindOf: 'rail', p: [36.0, 2.6, 6.2], s: [26, 0.08, 0.08], mat: 'metal', tint: DIM },
    { kind: 'light', p: [36.0, 3.0, 0], color: NEON, intensity: 7, distance: 22 },

    /* ============================================================================ */
    /* BEAT 4 — MOVERS, TWISTED                                                     */
    /* Same idea, wrong axis: a shuttle that crosses your path instead of following  */
    /* it, so now you leave when it is somewhere specific rather than when it has    */
    /* finished. Its two poses are 4.0 m apart — inside a single jump, deliberately, */
    /* so a player who lets it go past can still cross under their own power.        */
    /*                                                                              */
    /* Then an orbit, which never stops. Board at the west point (2.7 m), leave at   */
    /* the east point after a half turn (2.9 m).                                     */
    /*                                                                              */
    /* COIN 1 sits over the SOUTH point of the ring — the one point a half-turn does */
    /* not pass. Taking it costs a full extra revolution, about four seconds, or a   */
    /* board timed the other way round.                                             */
    /* ============================================================================ */

    {
      kind: 'mover',
      p: [54.0, 0.5, -3.6],
      s: [3.2, 1, 3.2],
      mat: 'metal',
      motion: { type: 'oscillate', to: [54.0, 0.5, 3.6], period: 5.2, phase: 0, ease: 'sine' },
    }, // board at 3.7 m as it crosses z = 0
    { kind: 'platform', p: [59.4, 0.5, 0], s: [2.8, 1, 2.8], mat: 'panel', glow: NEON, stripe: true }, // gap 2.4 off the shuttle

    {
      kind: 'mover',
      p: [68.0, 0.5, 0],
      s: [3.0, 1, 3.0],
      mat: 'metal',
      // axis is the STRING 'y' (movers.js readVec accepts 'x'|'y'|'z'). Writing it as
      // a vector works in the runtime but reads as a non-'y' axis to the reach
      // validator, which then models the ring as two poses stacked vertically 3 m
      // apart instead of four poses around a circle — i.e. as geometry no jump can
      // reach. Same word, two consumers: use the string.
      motion: { type: 'circle', radius: 3.0, axis: 'y', period: 8.0, phase: 0 },
    }, // ring spans x 63.5 .. 72.5 at its edges; board west at 2.7 m
    { kind: 'deco', kindOf: 'pillar', p: [68.0, 2.4, 0], s: [1.4, 4.8, 1.4], mat: 'obsidian', tint: DIM },
    { kind: 'deco', kindOf: 'ring', p: [68.0, 3.9, 0], s: [6.4, 0.1, 6.4], mat: 'emissive', tint: HOT },
    { kind: 'light', p: [68.0, 3.4, 0], color: HOT, intensity: 9, distance: 16 },

    { kind: 'platform', p: [77.7, 0.5, 0], s: [4.6, 1, 5.2], mat: 'stone', glow: DIM, stripe: true }, // 2.9 m off the ring's east point

    { kind: 'deco', kindOf: 'antenna', p: [60.0, 6.5, -8.8], s: [0.5, 13, 0.5], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'screen', p: [56.0, 5.0, 8.6], s: [0.35, 4.0, 6.4], mat: 'emissive', tint: 0x2f6ea8 },
    { kind: 'deco', kindOf: 'cable', p: [64.0, 7.4, 0], s: [34, 0.07, 0.07], mat: 'metal', tint: 0x12263d },

    /* ============================================================================ */
    /* BEAT 5 — VANISH SCHOOL                                                       */
    /* Five tiles, nothing else moving, a 3.2 s solid / 0.8 s warning / 1.6 s gone   */
    /* cycle. That is a 5.6 s period, and each tile's phase is 0.23 of a cycle behind */
    /* the one before it — 1.29 s, which is what one 2.6 m hop costs at a jog. Tile n */
    /* turns solid as you land on tile n-1, so a steady pace clears the run without   */
    /* ever waiting, and a panicked sprint arrives before the tile does.              */
    /* (phase is a FRACTION, never seconds — HOUSE RULE 4.)                           */
    /*                                                                              */
    /* Tiles 3 and 4 step off-axis and tile 5 steps up 0.9 m, because five identical  */
    /* tiles would teach the rhythm and nothing else.                                 */
    /*                                                                              */
    /* COIN 2 hangs on one tile of its own, 4.0 m off the side of tile 3 and 4.0 m    */
    /* back, on a shorter cycle than the run it hangs off — 92% of the flat run       */
    /* budget, twice, onto something that is only solid for 2.4 s at a time. The      */
    /* optional line is where a stage may spend the top of its envelope. The main     */
    /* line never is.                                                                 */
    /* ============================================================================ */

    { kind: 'vanish', p: [84.1, 0.5, 0], s: [3.0, 1, 3.4], mat: 'panel', cycle: { on: 3.2, off: 1.6, warn: 0.8, phase: 0.00 } }, // gap 2.6
    { kind: 'vanish', p: [89.7, 0.5, 0], s: [3.0, 1, 3.4], mat: 'panel', cycle: { on: 3.2, off: 1.6, warn: 0.8, phase: 0.77 } }, // gap 2.6
    { kind: 'vanish', p: [95.3, 0.5, 2.4], s: [3.0, 1, 3.4], mat: 'panel', cycle: { on: 3.2, off: 1.6, warn: 0.8, phase: 0.54 } }, // gap 2.6, +2.4 z
    { kind: 'vanish', p: [100.9, 0.5, -2.4], s: [3.0, 1, 3.4], mat: 'panel', cycle: { on: 3.2, off: 1.6, warn: 0.8, phase: 0.31 } }, // diagonal 2.95
    { kind: 'vanish', p: [106.5, 1.4, 0], s: [3.0, 1, 3.4], mat: 'panel', cycle: { on: 3.2, off: 1.6, warn: 0.8, phase: 0.08 } }, // diagonal 2.95, +0.9

    // -- the optional line: one tile hung out over the drop, on its own faster cycle
    { kind: 'vanish', p: [97.0, 0.5, 9.4], s: [2.6, 1, 2.6], mat: 'panel', cycle: { on: 2.4, off: 2.0, warn: 0.6, phase: 0.44 } }, // 4.0 m off tile 3, and 4.0 m back
    { kind: 'deco', kindOf: 'ring', p: [97.0, 2.0, 9.4], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: HOT },
    { kind: 'light', p: [97.0, 2.8, 8.0], color: HOT, intensity: 7, distance: 15 },

    { kind: 'platform', p: [113.9, 1.4, 0], s: [4.6, 1, 5.4], mat: 'stone', glow: DIM, stripe: true }, // gap 3.6, top 1.9

    { kind: 'text', p: [81.2, 2.6, 0], rot: [0, -Math.PI / 2, 0], text: 'THEY GO AWAY', size: 0.5, color: AMBER },
    { kind: 'text', p: [81.2, 2.05, 0], rot: [0, -Math.PI / 2, 0], text: 'watch one full cycle before you step', size: 0.24, color: 0x6f8dac },
    { kind: 'deco', kindOf: 'pipe', p: [96, 5.4, -7.4], s: [34, 0.6, 0.6], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'lantern', p: [90, 4.2, -6.2], s: [0.6, 0.9, 0.6], mat: 'emissive', tint: AMBER },
    { kind: 'light', p: [96, 3.6, 0], color: AMBER, intensity: 7, distance: 26, flicker: 0.1 },

    /* ============================================================================ */
    /* BEAT 6 — COMBINED : MOVER, TILE, TILE, MOVER                                 */
    /* The first passage where being on the right platform and being there at the    */
    /* right time are two different problems. The crossing shuttle runs a 4.6 s      */
    /* period against the tiles' 4.7 s, so the pattern drifts and you cannot memorise */
    /* a count — you have to look. Both shuttle poses are a jump from the plaza and a */
    /* jump from the first tile, so the shuttle changes the timing, never the route.  */
    /* ============================================================================ */

    {
      kind: 'mover',
      p: [120.2, 1.4, -3.6],
      s: [3.2, 1, 3.2],
      mat: 'metal',
      motion: { type: 'oscillate', to: [120.2, 1.4, 3.6], period: 4.6, phase: 0, ease: 'sine' },
    }, // gap 2.4 to board at either pose, top 1.9

    { kind: 'vanish', p: [127.0, 1.4, 0], s: [3.0, 1, 3.4], mat: 'panel', cycle: { on: 2.6, off: 1.4, warn: 0.7, phase: 0.50 } }, // gap 3.7
    { kind: 'vanish', p: [132.6, 1.4, 0], s: [3.0, 1, 3.4], mat: 'panel', cycle: { on: 2.6, off: 1.4, warn: 0.7, phase: 0.28 } }, // gap 2.6

    {
      kind: 'mover',
      p: [139.0, 1.4, 0],
      s: [3.6, 1, 3.8],
      mat: 'metal',
      motion: { type: 'linear', to: [146.0, 1.4, 0], period: 6.4, phase: 0, ease: 'sine', dwell: 0.6 },
    }, // gap 3.1 to board while it is home

    { kind: 'platform', p: [153.6, 1.4, 0], s: [5.4, 1, 6.0], mat: 'stone', glow: DIM, stripe: true }, // gap 3.1, top 1.9

    { kind: 'deco', kindOf: 'monolith', p: [130, 6.0, 11.0], s: [5, 12, 5], mat: 'obsidian', tint: 0x16304e },
    { kind: 'deco', kindOf: 'screen', p: [130, 6.4, 8.4], s: [0.35, 4.4, 6.0], mat: 'emissive', tint: 0x8a3fa8 },
    { kind: 'light', p: [132, 4.4, 0], color: NEON, intensity: 8, distance: 24 },

    /* ============================================================================ */
    /* BEAT 7 — BREATHER                                                            */
    /* Two steps and a plaza. Nothing moves for fifteen metres, on purpose: BEAT 6   */
    /* was dense and BEAT 8 introduces a new mechanic, and those two should not touch. */
    /* COIN 3 is a plain 3.7 m side hop over the drop — the easy coin on this stage.  */
    /* ============================================================================ */

    { kind: 'platform', p: [161.0, 1.4, 0], s: [3.0, 1, 4.4], mat: 'panel', glow: NEON, stripe: true }, // gap 3.2, top 1.9
    { kind: 'platform', p: [167.2, 2.3, 0], s: [3.2, 1, 4.4], mat: 'panel', glow: NEON, stripe: true }, // gap 3.1, +0.9
    { kind: 'platform', p: [174.2, 2.3, 0], s: [5.0, 1, 7.0], mat: 'stone', glow: DIM, stripe: true }, // gap 2.9, top 2.8

    { kind: 'platform', p: [176.2, 2.3, -8.4], s: [2.6, 1, 2.4], mat: 'panel', glow: HOT, stripe: true }, // 3.7 m side hop
    { kind: 'deco', kindOf: 'ring', p: [176.2, 4.0, -8.4], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: HOT },
    { kind: 'light', p: [176.2, 4.3, -8.4], color: HOT, intensity: 7, distance: 14 },

    { kind: 'deco', kindOf: 'brazier', p: [172.0, 3.5, 3.0], s: [0.9, 1.2, 0.9], mat: 'metal', tint: AMBER },
    { kind: 'light', p: [172.0, 4.5, 3.0], color: AMBER, intensity: 6, distance: 14, flicker: 0.3 },

    /* ============================================================================ */
    /* BEAT 8 — ROTOR SCHOOL                                                        */
    /* Two 10 m discs, one bar each, mounted 0.6 m above the deck so the answer is   */
    /* always "jump" and never "guess". Disc 1: two arms on a 5.0 s period, i.e. a   */
    /* bar every 2.5 s, slow enough to walk into and read. Disc 2: three arms on a   */
    /* 4.0 s period, i.e. one every 1.33 s — the same skill at twice the tempo, and  */
    /* phase 0.25 so it does not present the same face as disc 1.                    */
    /*                                                                              */
    /* Each disc carries a perch 1.0 m up at radius 4.8, clear of the bars (which    */
    /* sweep to radius 2.38) and clear of the deck edges: somewhere to stand and     */
    /* watch a full revolution before committing. The one on disc 2 carries COIN 4 — */
    /* a standing hop up out of the bar's path and a drop back into it.              */
    /*                                                                              */
    /* Both perches sit in the FAR half of their disc, 3.3 m from the next deck and  */
    /* 10 m from the previous one. A perch in the middle of a 10 m disc would offer  */
    /* a 7.6 m full-stretch dive back the way you came, which is exactly the surface */
    /* HOUSE RULE 2 exists to catch: nobody drew that jump, but the geometry did.    */
    /* ============================================================================ */

    { kind: 'platform', p: [185.2, 2.3, 0], s: [10, 1, 10], mat: 'stone', glow: DIM, stripe: true }, // gap 3.5, top 2.8
    { kind: 'rotor', p: [185.2, 3.4, 0], style: 'bar', arms: 2, len: 4.6, thick: 0.42, period: 5.0, phase: 0, axis: 'y' },
    { kind: 'platform', p: [189.0, 3.3, 3.4], s: [1.8, 1, 1.8], mat: 'obsidian', glow: NEON, stripe: true }, // perch, top 3.8

    { kind: 'platform', p: [198.2, 2.3, 0], s: [10, 1, 10], mat: 'stone', glow: DIM, stripe: true }, // gap 3.0, top 2.8
    { kind: 'rotor', p: [198.2, 3.4, 0], style: 'bar', arms: 3, len: 4.4, thick: 0.42, period: 4.0, phase: 0.25, axis: 'y' },
    { kind: 'platform', p: [201.6, 3.3, -3.4], s: [1.8, 1, 1.8], mat: 'obsidian', glow: HOT, stripe: true }, // COIN 4 perch, top 3.8
    { kind: 'deco', kindOf: 'ring', p: [201.6, 5.0, -3.4], s: [0.1, 1.9, 1.9], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: HOT },

    { kind: 'text', p: [179.2, 4.9, 0], rot: [0, -Math.PI / 2, 0], text: 'JUMP THE BAR', size: 0.5, color: AMBER },
    { kind: 'deco', kindOf: 'pillar', p: [185.2, 7.1, 0], s: [1.2, 6.6, 1.2], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [198.2, 7.1, 0], s: [1.2, 6.6, 1.2], mat: 'obsidian' },
    { kind: 'light', p: [185.2, 8.1, 0], color: AMBER, intensity: 10, distance: 20 },
    { kind: 'light', p: [198.2, 8.1, 0], color: AMBER, intensity: 10, distance: 20 },

    /* ============================================================================ */
    /* BEAT 9 — THE WINDMILL BRIDGE                                                 */
    /* The same rotor, turned on its side. axis 'z' swings the arms through the XY   */
    /* plane, so the blades come DOWN across the walkway instead of round it. Hub    */
    /* height 7.9 minus arm reach 4.9 puts the lowest tip at y 3.0 — 0.2 m over a    */
    /* deck at 2.8, so a blade sweeps your shins and a jump clears it.               */
    /* The bridge is 3.8 m wide: there is no way round, only through.                */
    /*                                                                              */
    /* Three arms on 6.0 s = a blade every 2.0 s. Two arms on 5.0 s = every 2.5 s,   */
    /* offset by 0.32 of a cycle. The two never sync, so you cross one at a time.    */
    /* ============================================================================ */

    { kind: 'platform', p: [212.6, 2.3, 0], s: [14, 1, 3.8], mat: 'metal', glow: NEON, stripe: true }, // gap 2.4, top 2.8
    { kind: 'rotor', p: [209.6, 7.9, 0], style: 'windmill', arms: 3, len: 4.9, thick: 0.4, period: 6.0, phase: 0, axis: 'z' },
    { kind: 'rotor', p: [215.6, 7.9, 0], style: 'windmill', arms: 2, len: 4.9, thick: 0.4, period: 5.0, phase: 0.32, axis: 'z' },

    { kind: 'deco', kindOf: 'buttress', p: [209.6, 9.1, 3.6], s: [1.4, 2.4, 1.4], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [215.6, 9.1, 3.6], s: [1.4, 2.4, 1.4], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'rail', p: [212.6, 3.4, 2.1], s: [14, 0.09, 0.09], mat: 'metal', tint: AMBER },
    { kind: 'deco', kindOf: 'rail', p: [212.6, 3.4, -2.1], s: [14, 0.09, 0.09], mat: 'metal', tint: AMBER },
    { kind: 'text', p: [206.6, 5.3, -2.6], rot: [0, -Math.PI / 2, 0], text: 'TIME IT', size: 0.42, color: HOT },
    { kind: 'light', p: [212.6, 6.5, 0], color: HOT, intensity: 11, distance: 22, flicker: 0.08 },

    /* ============================================================================ */
    /* BEAT 10 — SET-PIECE : THE BREAKER                                            */
    /* Everything the stage taught, stacked, four metres higher up.                  */
    /*                                                                              */
    /* Two ways onto the gallery, and this is the point of the whole beat:           */
    /*   THE PAD  — a 6.2 m discharge in the middle of the court. It throws you      */
    /*              0.837 s through the air, which is 7.2 m of travel at run speed   */
    /*              and 10.2 m at sprint; the gallery deck starts 5.0 m out and is   */
    /*              6 m deep, so BOTH approaches land on it and neither overshoots.  */
    /*              That is how a pad should be sized: solve the arc for the slowest */
    /*              and the fastest approach and make the deck cover both landings.  */
    /*   THE LIFT — a 4 m elevator standing off the court's north-east corner, 2.8 m */
    /*              from the court and 2.8 m from the same deck at the top. Slow,    */
    /*              safe, entirely optional.                                          */
    /* A lift cannot be the only way up (HOUSE RULE 3): the reach graph has no       */
    /* concept of standing still and being carried, and neither does a player who    */
    /* watched it leave without them. Give the machine a jumpable twin and both the  */
    /* validator and the player have a way through.                                  */
    /*                                                                              */
    /* Then a four-tile vanish bridge that zig-zags, a hammer rotor on an open disc, */
    /* and a shuttle out to the finish gate.                                         */
    /* ============================================================================ */

    { kind: 'platform', p: [226.2, 2.3, 0], s: [6.4, 1, 7.0], mat: 'stone', glow: DIM, stripe: true }, // gap 3.4, top 2.8
    { kind: 'text', p: [222.8, 5.1, 0], rot: [0, -Math.PI / 2, 0], text: 'THE BREAKER', size: 0.6, color: NEON },
    { kind: 'text', p: [222.8, 4.5, 0], rot: [0, -Math.PI / 2, 0], text: 'pad or lift  ·  both go up', size: 0.24, color: 0x6f8dac },

    { kind: 'jumppad', p: [225.0, 2.87, 0], s: [3.0, 0.14, 3.0], power: 6.2, dir: [0, 1, 0] },

    {
      kind: 'mover',
      p: [231.0, 2.3, 8.4],
      s: [3.8, 1, 4.2],
      mat: 'metal',
      // An elevator is trigger-based: it arms when you step on it (dwell), rises at
      // `speed`, waits `hold` at the top and comes back. `to` is the top pose, which
      // is also what tells the validator where this surface can end up — and that
      // pose is a 2.8 m hop from the gallery deck, so it is real geometry rather
      // than an island only a ride can reach.
      //
      // The shaft stands off the court's north-east corner rather than between the
      // pad and the gallery. Sat on the line, its top pose was 8.6 m and 4 m above
      // the windmill bridge — a backwards full-stretch dive nobody drew but the
      // geometry offered anyway. Off the line it is 10.5 m from the bridge: out of
      // reach, which is the only safe distance for a jump you never intended.
      motion: { type: 'elevator', to: [231.0, 6.3, 8.4], period: 8.0, speed: 2.6, dwell: 1.0, hold: 2.6, ease: 'sine' },
    }, // board at 2.8 m off the court's north edge; tops 2.8 -> 6.8

    { kind: 'deco', kindOf: 'pillar', p: [231.0, 5.0, 11.0], s: [0.9, 9.0, 0.9], mat: 'obsidian', tint: DIM },
    { kind: 'light', p: [231.0, 8.4, 8.4], color: AMBER, intensity: 8, distance: 18 },

    // The gallery deck is 7 m deep because the pad's arc is 7.2 m at run speed and
    // 10.2 m at sprint, measured from the pad's leading edge 5.0 m back: a deck any
    // shallower and one of those two landings goes over the far side.
    { kind: 'platform', p: [235.0, 6.3, 0], s: [7.0, 1, 7.0], mat: 'stone', glow: DIM, stripe: true }, // the gallery deck, top 6.8

    // The gallery: four tiles, alternating +/-2.4 m on Z, each 0.23 of a cycle behind
    // the last. Tighter than BEAT 5 (2.4 s solid, 0.6 s warning) because by now you
    // can read a warning band without stopping to think about it.
    // The first tile sits 3.7 m out rather than 3.0: at 3.0 it was 9.4 m and 4 m above
    // the parked lift, which is a backwards sprint dive the geometry offered for free.
    { kind: 'vanish', p: [243.7, 6.3, 0], s: [3.0, 1, 3.2], mat: 'panel', cycle: { on: 2.4, off: 1.3, warn: 0.6, phase: 0.00 } }, // gap 3.7
    { kind: 'vanish', p: [249.3, 6.3, 2.4], s: [3.0, 1, 3.2], mat: 'panel', cycle: { on: 2.4, off: 1.3, warn: 0.6, phase: 0.77 } }, // gap 2.6
    { kind: 'vanish', p: [254.9, 6.3, -2.4], s: [3.0, 1, 3.2], mat: 'panel', cycle: { on: 2.4, off: 1.3, warn: 0.6, phase: 0.54 } }, // diagonal 3.05
    { kind: 'vanish', p: [260.5, 6.3, 0], s: [3.0, 1, 3.2], mat: 'panel', cycle: { on: 2.4, off: 1.3, warn: 0.6, phase: 0.31 } }, // diagonal 2.72

    { kind: 'platform', p: [268.7, 6.3, 0], s: [9, 1, 9], mat: 'stone', glow: DIM, stripe: true }, // gap 2.2, top 6.8
    { kind: 'rotor', p: [268.7, 7.4, 0], style: 'hammer', arms: 2, len: 4.4, thick: 0.5, period: 3.6, phase: 0, axis: 'y' },

    {
      kind: 'mover',
      p: [277.1, 6.3, 0],
      s: [3.6, 1, 4.0],
      mat: 'metal',
      motion: { type: 'linear', to: [283.1, 6.3, 0], period: 6.0, phase: 0, ease: 'sine', dwell: 0.8 },
    }, // gap 2.1 to board, 2.8 m off the far pose onto the finish

    { kind: 'platform', p: [291.2, 6.3, 0], s: [7, 1, 8], mat: 'obsidian', glow: NEON, stripe: true }, // top 6.8

    // Finish architecture, sized so the last shuttle ride frames it.
    { kind: 'deco', kindOf: 'arch', p: [291.2, 11.6, 0], s: [1.3, 1.0, 9.2], mat: 'obsidian', tint: NEON },
    { kind: 'deco', kindOf: 'pillar', p: [291.2, 9.3, 4.4], s: [1.2, 5.6, 1.2], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [291.2, 9.3, -4.4], s: [1.2, 5.6, 1.2], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'beacon', p: [294.4, 8.6, 0], s: [0.6, 2.8, 0.6], mat: 'emissive', tint: NEON },
    { kind: 'text', p: [288.6, 8.6, 0], rot: [0, -Math.PI / 2, 0], text: 'CIRCUIT BREAK', size: 0.42, color: NEON },
    { kind: 'light', p: [291.2, 10.0, 0], color: NEON, intensity: 20, distance: 32 },

    /* ============================================================================ */
    /* THE SUBSTATION — dressing. All of it at |z| >= 7 or above y = 9, i.e. outside */
    /* every play corridor on the stage. None of it is a landable kind and none of   */
    /* it looks like it should be.                                                   */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'monolith', p: [74, -10, 30], s: [10, 30, 10], count: 8, spread: [200, 20, 26], seed: 5150, tint: 0x142a44 },
    { kind: 'deco', kindOf: 'monolith', p: [210, -12, -32], s: [12, 36, 12], count: 8, spread: [190, 24, 28], seed: 6060, tint: 0x16304e },
    { kind: 'deco', kindOf: 'pipe', p: [156, 10.5, 9.4], s: [190, 0.7, 0.7], mat: 'metal', tint: 0x1c3550 },
    { kind: 'deco', kindOf: 'pipe', p: [156, 11.4, -9.4], s: [190, 0.7, 0.7], mat: 'metal', tint: 0x1c3550 },
    { kind: 'deco', kindOf: 'cable', p: [156, 13.6, 0], s: [210, 0.09, 0.09], mat: 'metal', tint: 0x0e1e33 },
    { kind: 'deco', kindOf: 'antenna', p: [156, 4, 26], s: [0.6, 20, 0.6], count: 6, spread: [230, 8, 14], seed: 7070, tint: DIM },
    { kind: 'deco', kindOf: 'screen', p: [246, 12.0, 10.0], s: [0.4, 7, 11], mat: 'emissive', tint: 0x8a3fa8 },
    { kind: 'deco', kindOf: 'cloud', p: [156, -24, 0], s: [22, 3, 22], count: 14, spread: [320, 12, 100], seed: 8080, scale: 1.9, tint: 0x1b3c5e },

    // Path lights, one per beat, so the route reads as a line from a distance.
    { kind: 'light', p: [46, 3.4, 0], color: NEON, intensity: 6, distance: 22 },
    { kind: 'light', p: [114, 4.2, 0], color: NEON, intensity: 7, distance: 22 },
    { kind: 'light', p: [154, 4.4, 0], color: NEON, intensity: 7, distance: 22 },
    { kind: 'light', p: [226, 5.5, 0], color: NEON, intensity: 8, distance: 24 },
    { kind: 'light', p: [255, 9.4, 0], color: AMBER, intensity: 9, distance: 26 },
    { kind: 'light', p: [277, 9.4, 0], color: NEON, intensity: 8, distance: 24 },
  ],
};
