/**
 * ASCENDANT — NEON DOJO 2 : "CIRCUIT BREAK"
 * runtime/data/stages/neon-2.js
 *
 * A substation strung between rooftops. Everything here is powered, and most of it
 * is on a timer. The stage is a lesson in reading a rhythm rather than a distance.
 *
 * SHAPE      ~291 m of travel, 51 gameplay objects, 25 dynamic hazards from four
 *            families, 6 checkpoints (never more than 52 m apart), 4 coins.
 *
 * ESCALATES what neon-1 taught in isolation:
 *   MOVERS   BEAT 3 recaps the shuttle and makes it CLIMB, then BEAT 4 turns one
 *            90 degrees so it crosses your path, then hands you an orbit that never
 *            stops at all.
 *   VANISH   BEAT 5 tightens neon-1's generous panels into a five-tile run on a
 *            5.6 s cycle with a staggered phase ladder — and drops it into a pit,
 *            so the run descends 1.2 m and climbs 2.1 m back out while it cycles.
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
 * 7. THE STAGE MUST GO UP AND DOWN. A route that holds one height for 87 m is a
 *    corridor, not a stage, however busy the hazards on it are. See the HEIGHT
 *    LADDER below: no stretch of this stage now runs further than 28 m without a
 *    height change of more than 0.75 m, and most of them change every 6.
 *
 * ── A BLADE THAT SKIMS IS THE POINT; A BLADE THAT IS BURIED IS A BUG ─────────
 * Every rotor here is placed so its lowest sweep sits 0.35-0.40 m ABOVE the deck it
 * crosses. That gap is the obstacle: it is the reason the answer is "jump" and never
 * "guess". Getting it right means reading runtime/hazards/rotors.js rather than
 * trusting the geometry check's model, because the two do not agree:
 *
 *   BAR (axis 'y'). The arm collider's half-extent along the spin axis is
 *   `height * 0.5`, and `height` DEFAULTS TO thick * 1.5 (rotors.js:301) — so a bar
 *   with thick 0.42 really hangs 0.315 m below its hub while geomcheck models 0.21.
 *   Both bars below therefore set `height` EXPLICITLY equal to `thick`, which makes
 *   the runtime and the checker agree on one number instead of quietly differing by
 *   10 cm.  underside = p.y - height/2.
 *
 *   HAMMER (axis 'y'). The lethal head is a box whose half-height is
 *   max(0.7, height * 2.4) / 2 + 0.06 (rotors.js:502, 568) — with the default
 *   `height` that is 0.66 m below the hub, not the 0.25 the checker assumes. BEAT 10
 *   sets height 0.30 so the head half-extent is 0.41, and hangs the hub 0.79 m over
 *   the deck: 0.38 m of real clearance under the head.
 *
 *   WINDMILL (axis 'z'). The kill capsule runs from radius innerR to innerR + len
 *   and is itself `max(thick, rootC*0.30)` thick, where innerR = max(0.2, thick*0.9)
 *   (rotors.js:311, 620). For BEAT 9 that is 0.36 + 4.9 + 0.4 = 5.66 m below the hub,
 *   where geomcheck models only 5.10. The old hub height of 7.9 therefore put the
 *   blade 0.56 m INSIDE a 2.8 m deck while the checker reported it clear. The hub is
 *   now at 8.95 over a 2.9 m deck: 0.39 m of real clearance, 0.95 m of modelled.
 *
 * ── THE PERCHES ARE ABOVE THE BLADE, NOT BESIDE IT ──────────────────────────
 * Each rotor disc carries a watching platform. A bar with len 4.6 and innerR 0.378
 * sweeps out to radius 5.06 — nearly the whole 10 m disc — so a perch standing ON
 * that disc at radius 5.1 is a slab the bar passes through. Both perches are now
 * thin plates slung from the mast ABOVE the sweep (undersides 0.19 m clear of the
 * bar's top face), 1.5 m over their deck: a standing hop up, a step back off, and
 * nothing shares a plane with a moving part.
 *
 * CONVENTIONS (full list in runtime/data/index.js):
 *   p = CENTRE, s = FULL size, top surface = p[1] + s[1]/2. Gaps in the comments are
 *   EDGE TO EDGE. rot/yaw in radians, yaw 0 faces +X. `stripe: true` = must jump here.
 *   A mover's `p` is its HOME pose and `motion.to` is its far pose; the validator
 *   treats BOTH poses as landable surfaces, so both are quoted where it matters.
 *
 * REACH BUDGET USED (safe limits: 4.35 flat / 3.86 at +0.9 m / 3.33 at +1.6 m):
 *   longest flat gap on the main line   3.7 m   (BEAT 4, boarding the crossing shuttle)
 *   longest rise                        1.6 m over 2.4 m   (BEAT 6, the tile step-up)
 *   longest drop-jump                   1.5 m over 2.4 m   (BEAT 10, off the high tile)
 *   riskiest optional line              4.0 m flat         (BEAT 5, the coin tile)
 *   No jump on this stage requires a sprint. Sprinting still saves about 25 s.
 *
 * HEIGHT LADDER (top surfaces, and the reason this stage is not a corridor):
 *   0.5 yard -> -0.6 cable trench -> 1.0 shuttle run -> 2.4 transformer bank ->
 *   1.0 ring court -> -0.2 the vanish pit -> 1.9 back out -> 2.8 the combined beat ->
 *   3.8 rotor plaza -> 2.9 the low disc and the windmill bridge -> 6.9 the breaker
 *   gallery (launch pad) -> 7.5 the finish gate.
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
    // Out of the trench, looking straight at the first moving platform.
    { p: [25.6, 1.1, 0], yaw: 0, clockOffset: 0 },
    // Off the orbit, before the vanish school.
    { p: [77.7, 1.1, 0], yaw: 0, clockOffset: 0 },
    // Out of the vanish pit, before movers and tiles get combined.
    { p: [113.9, 2.0, 0], yaw: 0, clockOffset: 0 },
    // On the stone deck where BEAT 6 lands — caps the replay cost of the
    // mover/tile/tile/mover gauntlet (and of the BEAT 7 side-coin attempts) at
    // ~21 m instead of the 60 m this leg used to be. Nothing timed starts for
    // another 30 m, so clockOffset 0 is safe.
    { p: [153.6, 2.8, 0], yaw: 0, clockOffset: 0 },
    // On the plaza, before the first rotor. clockOffset 1.25 rather than 0: with r1
    // on a 5.0 s period and two arms, a bar crosses the entry every 2.5 s, and at
    // t = 1.25 one has just gone past. You respawn into the safe half of the cycle
    // instead of sprinting into a bar you could not have seen.
    { p: [174.2, 3.9, 0], yaw: 0, clockOffset: 1.25 },
    // The launch court, before the finale. The longest leg on the stage at roughly
    // 30 s, and the only one with a genuine set-piece in it.
    { p: [226.2, 3.0, 0], yaw: 0, clockOffset: 0 },
  ],

  finish: { p: [291.2, 7.6, 0], yaw: 0 },

  coins: [
    { p: [68.0, 2.2, -3.0] }, // BEAT 4 — the far side of the orbit, one extra half-turn
    { p: [96.6, 0.9, 5.8] }, // BEAT 5 — a tile of its own, 4.0 m out over the pit
    { p: [176.2, 4.1, -8.4] }, // BEAT 7 — a side ledge, 3.7 m out and 0.6 m down
    { p: [201.2, 5.1, -2.6] }, // BEAT 8 — the perch above the second rotor
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
    /* BEAT 2 — THE CABLE TRENCH                                                    */
    /* neon-1's opening three hops, except they go DOWN before they go up: -0.4,     */
    /* then -0.7 into the trench, then a 1.6 m climb out over 2.3 m. Three static    */
    /* hops that recap the tutorial in ten seconds AND put the first 1.6 m of        */
    /* vertical on the board before the stage has shown a single moving part.        */
    /*                                                                              */
    /* The trench floor sits at x 19.9, not 19.4. At 19.4 its near edge was 7.8 m    */
    /* and 1.1 m down from the yard's lip — a sprint-tight dive straight past the    */
    /* first hop that nobody drew. At 19.9 it is 8.3 m out, past the 8.24 m sprint   */
    /* drop-jump reach, and the only way in is the hop the stage designed.           */
    /* ============================================================================ */

    { kind: 'platform', p: [13.9, -0.4, 0], s: [3.0, 1, 4.2], mat: 'panel', glow: NEON, stripe: true }, // gap 2.4, -0.4, top 0.1
    { kind: 'platform', p: [19.9, -1.1, -1.0], s: [3.2, 1, 3.6], mat: 'panel', glow: NEON, stripe: true }, // gap 2.9, -0.7, top -0.6
    { kind: 'platform', p: [25.6, 0.5, 0], s: [3.6, 1, 4.6], mat: 'stone', glow: DIM, stripe: true }, // gap 2.3, +1.6, top 1.0

    { kind: 'deco', kindOf: 'grate', p: [19.9, -1.62, -1.0], s: [3.4, 0.12, 3.8], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'cable', p: [19.6, 1.9, 2.6], s: [16, 0.09, 0.09], mat: 'metal', tint: 0x12263d },
    { kind: 'deco', kindOf: 'cable', p: [19.6, 2.3, -3.4], s: [16, 0.09, 0.09], mat: 'metal', tint: 0x12263d },
    { kind: 'deco', kindOf: 'vent', p: [16.4, 1.4, -4.6], s: [1.6, 1.2, 0.4], mat: 'emissive', tint: 0x2f6ea8 },
    { kind: 'light', p: [19.9, 1.6, 0], color: 0x8fd0ff, intensity: 7, distance: 16 },

    /* ============================================================================ */
    /* BEAT 3 — THE FIRST MOVING PLATFORM, AND IT CLIMBS                            */
    /* Deliberately the easiest mover on the stage: straight down the stage axis, a  */
    /* 7 s round trip, 0.8 s of dwell at each end, and it comes back if you miss it. */
    /* Board at 2.3 m from the ledge and ride 7 m — but the far pose is 1.4 m HIGHER */
    /* than the home pose, so the ride is the stage's first lift as well as its      */
    /* first shuttle, and it hands you onto the transformer bank at 2.4 m.           */
    /* The pier at z = -5.6 is a place to stand while it comes back, and it is 1.7 m */
    /* from the landing, so nobody who uses it is stuck there.                       */
    /* ============================================================================ */

    {
      kind: 'mover',
      p: [31.6, 0.5, 0],
      s: [3.8, 1, 4.4],
      mat: 'metal',
      motion: { type: 'linear', to: [38.6, 1.9, 0], period: 7.0, phase: 0, ease: 'sine', dwell: 0.8 },
    }, // home top 1.0 (gap 2.3 to board), far top 2.4

    { kind: 'platform', p: [43.0, 1.7, -5.6], s: [2.6, 1, 2.6], mat: 'panel', glow: AMBER, stripe: true }, // the pier, top 2.2, 2.42 m off the far pose
    { kind: 'platform', p: [46.4, 1.9, 0], s: [4.6, 1, 5.2], mat: 'stone', glow: DIM, stripe: true }, // top 2.4, 3.6 m off the far pose

    { kind: 'text', p: [28.2, 2.6, 0], rot: [0, -Math.PI / 2, 0], text: 'RIDE IT UP', size: 0.5, color: NEON },
    { kind: 'text', p: [28.2, 2.05, 0], rot: [0, -Math.PI / 2, 0], text: 'it will come back', size: 0.24, color: 0x6f8dac },
    { kind: 'deco', kindOf: 'rail', p: [36.0, 3.4, 6.2], s: [26, 0.08, 0.08], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'pillar', p: [40.6, 1.2, 6.6], s: [1.0, 6.4, 1.0], mat: 'obsidian', tint: DIM },
    { kind: 'light', p: [36.0, 4.0, 0], color: NEON, intensity: 7, distance: 22 },

    /* ============================================================================ */
    /* BEAT 4 — MOVERS, TWISTED, AND THE WAY BACK DOWN                              */
    /* Same idea, wrong axis: a shuttle that crosses your path instead of following  */
    /* it, so now you leave when it is somewhere specific rather than when it has    */
    /* finished. Its two poses are 7.2 m apart along Z and both are a 3.7 m hop from */
    /* the bank, so a player who lets it go past can still cross under their own     */
    /* power on the next swing.                                                     */
    /*                                                                              */
    /* Then the stage steps back DOWN — 2.4 to 1.9 to the orbit at 1.0 — because the */
    /* vanish school that follows wants to be a pit, and a pit needs a rim.          */
    /*                                                                              */
    /* The orbit never stops. Board at the west point (2.7 m), leave at the east     */
    /* point after a half turn (2.9 m). COIN 1 sits over the SOUTH point — the one   */
    /* point a half-turn does not pass. Taking it costs a full extra revolution,     */
    /* about four seconds, or a board timed the other way round.                     */
    /* ============================================================================ */

    {
      kind: 'mover',
      p: [54.0, 1.9, -3.6],
      s: [3.2, 1, 3.2],
      mat: 'metal',
      motion: { type: 'oscillate', to: [54.0, 1.9, 3.6], period: 5.2, phase: 0, ease: 'sine' },
    }, // top 2.4, board at 3.7 m from the bank at either pose

    { kind: 'platform', p: [59.4, 1.4, 0], s: [2.8, 1, 2.8], mat: 'panel', glow: NEON, stripe: true }, // top 1.9, gap 2.47 off the shuttle

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
    }, // top 1.0; ring spans x 63.5 .. 72.5 at its edges; board west at 2.7 m and 0.9 m down

    { kind: 'deco', kindOf: 'pillar', p: [68.0, 2.4, 0], s: [1.4, 4.8, 1.4], mat: 'obsidian', tint: DIM },
    { kind: 'deco', kindOf: 'ring', p: [68.0, 3.9, 0], s: [6.4, 0.1, 6.4], mat: 'emissive', tint: HOT },
    { kind: 'light', p: [68.0, 3.4, 0], color: HOT, intensity: 9, distance: 16 },

    { kind: 'platform', p: [77.7, 0.5, 0], s: [4.6, 1, 5.2], mat: 'stone', glow: DIM, stripe: true }, // top 1.0, 2.9 m off the ring's east point

    { kind: 'deco', kindOf: 'antenna', p: [60.0, 6.5, -8.8], s: [0.5, 13, 0.5], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'screen', p: [56.0, 5.0, 8.6], s: [0.35, 4.0, 6.4], mat: 'emissive', tint: 0x2f6ea8 },
    { kind: 'deco', kindOf: 'cable', p: [64.0, 7.4, 0], s: [34, 0.07, 0.07], mat: 'metal', tint: 0x12263d },

    /* ============================================================================ */
    /* BEAT 5 — VANISH SCHOOL, DOWN A PIT AND BACK OUT                              */
    /* Five tiles, nothing else moving, a 3.2 s solid / 0.8 s warning / 1.6 s gone   */
    /* cycle. That is a 5.6 s period, and each tile's phase is 0.23 of a cycle behind */
    /* the one before it — 1.29 s, which is what one 2.6 m hop costs at a jog. Tile n */
    /* turns solid as you land on tile n-1, so a steady pace clears the run without   */
    /* ever waiting, and a panicked sprint arrives before the tile does.              */
    /* (phase is a FRACTION, never seconds — HOUSE RULE 4.)                           */
    /*                                                                              */
    /* The run DESCENDS 1.2 m over three tiles and then climbs 2.1 m over two, and    */
    /* every tile is a different size: 3.2x3.6, 2.8x3.2, 3.0x3.4, 2.6x3.0, 3.4x3.4.   */
    /* Five identical tiles on one plane teach the rhythm and nothing else — and read */
    /* to the geometry check as five identical obstacles in a row, which is exactly   */
    /* what that check is for.                                                        */
    /*                                                                              */
    /* COIN 2 hangs on one tile of its own, 4.0 m off the side of tile 3 and level    */
    /* with it at the bottom of the pit, on a shorter cycle than the run it hangs off */
    /* — 92% of the flat run budget onto something that is only solid for 2.4 s at a  */
    /* time. The optional line is where a stage may spend the top of its envelope.    */
    /* The main line never is.                                                        */
    /* ============================================================================ */

    { kind: 'vanish', p: [84.0, 0.5, 0], s: [3.2, 1, 3.6], mat: 'panel', cycle: { on: 3.2, off: 1.6, warn: 0.8, phase: 0.00 } }, // gap 2.4, top 1.0
    { kind: 'vanish', p: [89.6, -0.1, 1.6], s: [2.8, 1, 3.2], mat: 'panel', cycle: { on: 3.2, off: 1.6, warn: 0.8, phase: 0.77 } }, // gap 2.6, -0.6, top 0.4
    { kind: 'vanish', p: [95.2, -0.7, -1.2], s: [3.0, 1, 3.4], mat: 'panel', cycle: { on: 3.2, off: 1.6, warn: 0.8, phase: 0.54 } }, // gap 2.7, -0.6, top -0.2
    { kind: 'vanish', p: [100.8, 0.1, 2.2], s: [2.6, 1, 3.0], mat: 'panel', cycle: { on: 3.2, off: 1.6, warn: 0.8, phase: 0.31 } }, // diagonal 2.81, +0.8, top 0.6
    { kind: 'vanish', p: [106.4, 1.4, 0], s: [3.4, 1, 3.4], mat: 'panel', cycle: { on: 3.2, off: 1.6, warn: 0.8, phase: 0.08 } }, // gap 2.6, +1.3, top 1.9

    // -- the optional line: one tile hung out over the pit, on its own faster cycle
    { kind: 'vanish', p: [96.6, -0.7, 5.8], s: [2.6, 1, 2.6], mat: 'panel', cycle: { on: 2.4, off: 2.0, warn: 0.6, phase: 0.44 } }, // 4.0 m off tile 3, level with it
    { kind: 'deco', kindOf: 'ring', p: [96.6, 1.3, 5.8], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: HOT },
    { kind: 'light', p: [96.6, 2.1, 4.6], color: HOT, intensity: 7, distance: 15 },

    { kind: 'platform', p: [113.9, 1.4, 0], s: [4.6, 1, 5.4], mat: 'stone', glow: DIM, stripe: true }, // gap 3.5, top 1.9

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
    /*                                                                              */
    /* The two tiles are a DROP then a CLIMB — 1.9 down to 1.2, then 1.2 up to 2.8 —  */
    /* and they are different shapes (3.0x3.4 then 3.4x3.0). A vanishing tile you    */
    /* have to jump UP onto is a different problem from one you step across to: you   */
    /* commit earlier and you can see less of it while you do.                        */
    /* ============================================================================ */

    {
      kind: 'mover',
      p: [120.2, 1.4, -3.6],
      s: [3.2, 1, 3.2],
      mat: 'metal',
      motion: { type: 'oscillate', to: [120.2, 1.4, 3.6], period: 4.6, phase: 0, ease: 'sine' },
    }, // top 1.9, gap 2.4 to board at either pose

    { kind: 'vanish', p: [127.0, 0.7, 0], s: [3.0, 1, 3.4], mat: 'panel', cycle: { on: 2.6, off: 1.4, warn: 0.7, phase: 0.50 } }, // gap 3.7, -0.7, top 1.2
    { kind: 'vanish', p: [132.6, 2.3, 0], s: [3.4, 1, 3.0], mat: 'panel', cycle: { on: 2.6, off: 1.4, warn: 0.7, phase: 0.28 } }, // gap 2.4, +1.6, top 2.8

    {
      kind: 'mover',
      p: [139.0, 1.6, 0],
      s: [3.6, 1, 3.8],
      mat: 'metal',
      motion: { type: 'linear', to: [146.0, 1.6, 0], period: 6.4, phase: 0, ease: 'sine', dwell: 0.6 },
    }, // top 2.1, gap 2.9 and 0.7 down to board while it is home

    { kind: 'platform', p: [153.6, 2.2, 0], s: [5.4, 1, 6.0], mat: 'stone', glow: DIM, stripe: true }, // gap 3.1, +0.6, top 2.7

    { kind: 'deco', kindOf: 'monolith', p: [130, 6.0, 11.0], s: [5, 12, 5], mat: 'obsidian', tint: 0x16304e },
    { kind: 'deco', kindOf: 'screen', p: [130, 6.4, 8.4], s: [0.35, 4.4, 6.0], mat: 'emissive', tint: 0x8a3fa8 },
    { kind: 'light', p: [132, 4.4, 0], color: NEON, intensity: 8, distance: 24 },

    /* ============================================================================ */
    /* BEAT 7 — BREATHER, AND THE LAST OF THE CLIMB                                 */
    /* Two steps and a plaza. Nothing moves for twenty metres, on purpose: BEAT 6    */
    /* was dense and BEAT 8 introduces a new mechanic, and those two should not touch. */
    /* The steps are +0.8 then +0.3 — the stage arrives at its highest ground-level   */
    /* deck, 3.8 m, right where the rotors start.                                     */
    /* COIN 3 is a 3.7 m side hop and 0.6 m down over the drop, then the same hop     */
    /* back up. The easy coin on this stage, and it is still a full-budget jump.      */
    /* ============================================================================ */

    { kind: 'platform', p: [161.0, 3.0, 0], s: [3.0, 1, 4.4], mat: 'panel', glow: NEON, stripe: true }, // gap 3.2, +0.8, top 3.5
    { kind: 'platform', p: [167.2, 3.3, 0], s: [3.2, 1, 4.4], mat: 'panel', glow: NEON, stripe: true }, // gap 3.1, +0.3, top 3.8
    { kind: 'platform', p: [174.2, 3.3, 0], s: [5.0, 1, 7.0], mat: 'stone', glow: DIM, stripe: true }, // gap 2.9, top 3.8

    { kind: 'platform', p: [176.2, 2.7, -8.4], s: [2.6, 1, 2.4], mat: 'panel', glow: HOT, stripe: true }, // 3.7 m side hop, -0.6, top 3.2
    { kind: 'deco', kindOf: 'ring', p: [176.2, 4.1, -8.4], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: HOT },
    { kind: 'light', p: [176.2, 4.6, -8.4], color: HOT, intensity: 7, distance: 14 },

    { kind: 'deco', kindOf: 'brazier', p: [172.0, 4.1, 3.0], s: [0.9, 1.2, 0.9], mat: 'metal', tint: AMBER },
    { kind: 'light', p: [172.0, 5.1, 3.0], color: AMBER, intensity: 6, distance: 14, flicker: 0.3 },

    /* ============================================================================ */
    /* BEAT 8 — ROTOR SCHOOL                                                        */
    /* Two open discs, one bar each, hung so the underside of the bar clears the deck */
    /* by 0.39 m — close enough that the answer is always "jump" and never "guess",   */
    /* far enough that the bar is a hazard and not part of the floor.                 */
    /*                                                                              */
    /* Both bars set `height` equal to `thick` on purpose. Left at its default the    */
    /* bar collider is thick*1.5 tall, i.e. 0.105 m lower than the geometry check     */
    /* models, and every clearance in this comment would be a number nobody could     */
    /* verify in game. See the note at the top of this file.                          */
    /*                                                                              */
    /* The two discs are NOT the same obstacle twice. Disc 1: 10x10, deck at 3.8,     */
    /* two arms on a 5.0 s period — a bar every 2.5 s, slow enough to walk into and   */
    /* read, and the perch is on the +Z side. Disc 2: 8.6x7.4 and 0.9 m LOWER, three  */
    /* arms on a 4.0 s period — one every 1.33 s, on a smaller floor with less room   */
    /* to wait, entered on a drop, phase 0.25 so it never presents disc 1's face, and */
    /* the perch on the -Z side so you turn the other way to take it.                 */
    /*                                                                              */
    /* THE PERCHES ARE OVERHEAD. A bar of len 4.6 with innerR 0.378 sweeps to radius  */
    /* 5.06 — a slab standing on the disc at radius 5.1 is a slab the bar goes        */
    /* through. Both perches are thin plates slung from the mast 1.5 m above their    */
    /* deck, undersides 0.19 m clear of the top of the bar's sweep: a standing hop    */
    /* up, a step back down, and somewhere to watch a full revolution from that no    */
    /* moving part shares a plane with. The one on disc 2 carries COIN 4.             */
    /*                                                                              */
    /* Both perches sit in the FAR half of their disc, 10 m from the previous deck.   */
    /* A perch in the middle of a 10 m disc would offer a 7.6 m full-stretch dive     */
    /* back the way you came, which is exactly the surface HOUSE RULE 2 exists to     */
    /* catch: nobody drew that jump, but the geometry did.                            */
    /* ============================================================================ */

    { kind: 'platform', p: [185.2, 3.3, 0], s: [10, 1, 10], mat: 'stone', glow: DIM, stripe: true }, // gap 3.5, top 3.8
    { kind: 'rotor', p: [185.2, 4.4, 0], style: 'bar', arms: 2, len: 4.6, thick: 0.42, height: 0.42, period: 5.0, phase: 0, axis: 'y' }, // sweeps 4.19..4.61 — 0.39 over the deck
    { kind: 'platform', p: [189.0, 5.05, 3.4], s: [1.8, 0.5, 1.8], mat: 'obsidian', glow: NEON, stripe: true }, // slung perch, underside 4.80, top 5.30

    { kind: 'platform', p: [198.2, 2.4, 0], s: [8.6, 1, 7.4], mat: 'stone', glow: DIM, stripe: true }, // gap 3.7, -0.9, top 2.9
    { kind: 'rotor', p: [198.2, 3.45, 0], style: 'bar', arms: 3, len: 3.9, thick: 0.40, height: 0.40, period: 4.0, phase: 0.25, axis: 'y' }, // sweeps 3.25..3.65 — 0.35 over the deck
    { kind: 'platform', p: [201.2, 4.15, -2.6], s: [1.8, 0.5, 1.8], mat: 'obsidian', glow: HOT, stripe: true }, // COIN 4 perch, underside 3.90, top 4.40
    { kind: 'deco', kindOf: 'ring', p: [201.2, 5.1, -2.6], s: [0.1, 1.9, 1.9], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: HOT },

    // The masts the perches hang from. Decor never blocks and is never landable, but
    // a plate floating on nothing reads as a bug, so each one gets a hanger and a
    // gantry ring overhead to hang it from.
    { kind: 'deco', kindOf: 'pillar', p: [185.2, 7.6, 0], s: [1.2, 6.6, 1.2], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [198.2, 7.2, 0], s: [1.2, 6.6, 1.2], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'ring', p: [185.2, 6.6, 0], s: [9.0, 0.12, 9.0], mat: 'emissive', tint: DIM },
    { kind: 'deco', kindOf: 'ring', p: [198.2, 6.0, 0], s: [7.6, 0.12, 7.6], mat: 'emissive', tint: DIM },
    { kind: 'deco', kindOf: 'post', p: [189.0, 5.95, 3.4], s: [0.26, 1.3, 0.26], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'post', p: [201.2, 5.3, -2.6], s: [0.26, 1.3, 0.26], mat: 'metal', tint: DIM },

    { kind: 'text', p: [179.2, 5.9, 0], rot: [0, -Math.PI / 2, 0], text: 'JUMP THE BAR', size: 0.5, color: AMBER },
    { kind: 'light', p: [185.2, 8.6, 0], color: AMBER, intensity: 10, distance: 20 },
    { kind: 'light', p: [198.2, 8.2, 0], color: AMBER, intensity: 10, distance: 20 },

    /* ============================================================================ */
    /* BEAT 9 — THE WINDMILL BRIDGE                                                 */
    /* The same rotor, turned on its side. axis 'z' swings the arms through the XY   */
    /* plane, so the blades come DOWN across the walkway instead of round it.        */
    /* The bridge is 3.8 m wide: there is no way round, only through.                */
    /*                                                                              */
    /* HUB HEIGHT IS 8.95, NOT 7.9. A windmill's kill capsule runs from radius       */
    /* innerR (max(0.2, thick*0.9) = 0.36) out to innerR + len = 5.26 and is itself  */
    /* 0.4 m thick, so the lowest lethal point is 5.66 m below the hub — not the     */
    /* 5.10 m the geometry check models. At the old hub height of 7.9 the blade tip  */
    /* passed 0.56 m BELOW the deck surface: a blade buried in the floor that the    */
    /* checker reported as 0.2 m of clearance. At 8.95 over a 2.9 m deck the tip     */
    /* sweeps to 3.29 — 0.39 m of real clearance, which is the skim this obstacle    */
    /* is supposed to be.                                                            */
    /*                                                                              */
    /* Three arms on 6.0 s = a blade every 2.0 s. Two arms on 5.0 s = every 2.5 s,   */
    /* offset by 0.32 of a cycle. The two never sync, so you cross one at a time.    */
    /* ============================================================================ */

    { kind: 'platform', p: [212.6, 2.4, 0], s: [14, 1, 3.8], mat: 'metal', glow: NEON, stripe: true }, // gap 3.1, top 2.9
    { kind: 'rotor', p: [209.6, 8.95, 0], style: 'windmill', arms: 3, len: 4.9, thick: 0.4, period: 6.0, phase: 0, axis: 'z' },
    { kind: 'rotor', p: [215.6, 8.95, 0], style: 'windmill', arms: 2, len: 4.9, thick: 0.4, period: 5.0, phase: 0.32, axis: 'z' },

    { kind: 'deco', kindOf: 'buttress', p: [209.6, 10.2, 3.6], s: [1.4, 2.4, 1.4], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'buttress', p: [215.6, 10.2, 3.6], s: [1.4, 2.4, 1.4], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'rail', p: [212.6, 3.5, 2.1], s: [14, 0.09, 0.09], mat: 'metal', tint: AMBER },
    { kind: 'deco', kindOf: 'rail', p: [212.6, 3.5, -2.1], s: [14, 0.09, 0.09], mat: 'metal', tint: AMBER },
    { kind: 'text', p: [206.6, 5.4, -2.6], rot: [0, -Math.PI / 2, 0], text: 'TIME IT', size: 0.42, color: HOT },
    { kind: 'light', p: [212.6, 6.6, 0], color: HOT, intensity: 11, distance: 22, flicker: 0.08 },

    /* ============================================================================ */
    /* BEAT 10 — SET-PIECE : THE BREAKER                                            */
    /* Everything the stage taught, stacked, four metres higher up.                  */
    /*                                                                              */
    /* Two ways onto the gallery, and this is the point of the whole beat:           */
    /*   THE PAD  — a 6.2 m discharge at the FAR lip of the court. A pad throws a    */
    /*              FIXED arc: both halves integrate at gravFall, the pad adds        */
    /*              nothing horizontal, so where you land is decided entirely by the  */
    /*              speed you carried on. From the launch point (the pad's near edge  */
    /*              less one player radius, x 226.45) a WALKED entry at 6.0 m/s lands */
    /*              4.64 m out and a held sprint lands 11.17 m out. The gallery deck  */
    /*              is 8 m deep and starts 4.05 m out, so it swallows BOTH: nobody    */
    /*              who strolls onto it drops short, and nobody who sprints goes past.*/
    /*              The pad used to sit mid-court at x 225.0, which put the walk-speed*/
    /*              landing 3.71 m short of the deck — a hidden death for anyone who  */
    /*              did not run at it, and players stroll onto pads constantly.       */
    /*   THE LIFT — a 4 m elevator standing off the court's north-east corner, 2.8 m */
    /*              from the court and 2.3 m from the same deck at the top. Slow,    */
    /*              safe, entirely optional.                                          */
    /* A lift cannot be the only way up (HOUSE RULE 3): the reach graph has no       */
    /* concept of standing still and being carried, and neither does a player who    */
    /* watched it leave without them. Give the machine a jumpable twin and both the  */
    /* validator and the player have a way through.                                  */
    /*                                                                              */
    /* Then a four-tile vanish bridge that zig-zags AND climbs and drops — 6.9, 6.5, */
    /* 7.8, 6.3, in four different sizes — a hammer rotor on an open disc 1.1 m up,  */
    /* and a shuttle out to the finish gate at 7.5.                                  */
    /* ============================================================================ */

    { kind: 'platform', p: [226.2, 2.4, 0], s: [6.4, 1, 7.0], mat: 'stone', glow: DIM, stripe: true }, // gap 3.4, top 2.9
    { kind: 'text', p: [222.8, 5.2, 0], rot: [0, -Math.PI / 2, 0], text: 'THE BREAKER', size: 0.6, color: NEON },
    { kind: 'text', p: [222.8, 4.6, 0], rot: [0, -Math.PI / 2, 0], text: 'pad or lift  ·  both go up', size: 0.24, color: 0x6f8dac },

    { kind: 'jumppad', p: [228.0, 2.97, 0], s: [2.4, 0.14, 2.4], power: 6.2, dir: [0, 1, 0] }, // top 3.04, launch point x 226.45

    {
      kind: 'mover',
      p: [231.0, 2.4, 8.4],
      s: [3.8, 1, 4.2],
      mat: 'metal',
      // An elevator is trigger-based: it arms when you step on it (dwell), rises at
      // `speed`, waits `hold` at the top and comes back. `to` is the top pose, which
      // is also what tells the validator where this surface can end up — and that
      // pose is a 2.3 m hop from the gallery deck, so it is real geometry rather
      // than an island only a ride can reach.
      //
      // The shaft stands off the court's north-east corner rather than between the
      // pad and the gallery. Sat on the line, its top pose was 8.6 m and 4 m above
      // the windmill bridge — a backwards full-stretch dive nobody drew but the
      // geometry offered anyway. Off the line it is 9.5 m from the bridge: out of
      // reach, which is the only safe distance for a jump you never intended.
      motion: { type: 'elevator', to: [231.0, 6.4, 8.4], period: 8.0, speed: 2.6, dwell: 1.0, hold: 2.6, ease: 'sine' },
    }, // board at 2.8 m off the court's north edge; tops 2.9 -> 6.9

    { kind: 'deco', kindOf: 'pillar', p: [231.0, 5.1, 11.0], s: [0.9, 9.0, 0.9], mat: 'obsidian', tint: DIM },
    { kind: 'light', p: [231.0, 8.5, 8.4], color: AMBER, intensity: 8, distance: 18 },

    // The gallery deck is 8 m deep and its near edge is 4.05 m from the pad's launch
    // point, because the pad's fixed arc lands between 4.64 m (walk) and 11.17 m
    // (held sprint) out: a deck any shallower, or any further forward, and one of
    // those two landings misses it.
    { kind: 'platform', p: [234.5, 6.4, 0], s: [8, 1, 8], mat: 'stone', glow: DIM, stripe: true }, // the gallery deck, top 6.9

    // The gallery: four tiles, alternating on Z, each 0.23 of a cycle behind the last.
    // Tighter than BEAT 5 (2.4 s solid, 0.6 s warning) because by now you can read a
    // warning band without stopping to think about it — and no two of them are the
    // same size or the same height, so the run is a rhythm rather than a metronome.
    // The first tile sits 3.3 m out rather than 3.0: at 3.0 it was 9.4 m and 4 m above
    // the parked lift, which is a backwards sprint dive the geometry offered for free.
    { kind: 'vanish', p: [243.5, 6.4, 0], s: [3.4, 1, 3.4], mat: 'panel', cycle: { on: 2.4, off: 1.3, warn: 0.6, phase: 0.00 } }, // gap 3.3, top 6.9
    { kind: 'vanish', p: [249.0, 6.0, 2.6], s: [2.6, 1, 3.0], mat: 'panel', cycle: { on: 2.4, off: 1.3, warn: 0.6, phase: 0.77 } }, // gap 2.5, -0.4, top 6.5
    { kind: 'vanish', p: [254.4, 7.3, -2.0], s: [3.2, 1, 2.8], mat: 'panel', cycle: { on: 2.4, off: 1.3, warn: 0.6, phase: 0.54 } }, // diagonal 3.02, +1.3, top 7.8
    { kind: 'vanish', p: [259.8, 5.8, 0], s: [2.8, 1, 3.6], mat: 'panel', cycle: { on: 2.4, off: 1.3, warn: 0.6, phase: 0.31 } }, // gap 2.4, -1.5, top 6.3

    { kind: 'platform', p: [268.5, 6.9, 0], s: [9, 1, 9], mat: 'stone', glow: DIM, stripe: true }, // gap 2.8, +1.1, top 7.4
    // height 0.30 pins the lethal head's half-extent at 0.36 (rotors.js:502) instead of
    // the 0.60 the default would give, so the hub at 8.2 leaves 0.38 m under the head —
    // the same skim as the bars in BEAT 8, on the one rotor here that actually kills.
    { kind: 'rotor', p: [268.5, 8.2, 0], style: 'hammer', arms: 2, len: 4.4, thick: 0.5, height: 0.30, period: 3.6, phase: 0, axis: 'y' },

    {
      kind: 'mover',
      p: [276.8, 6.3, 0],
      s: [3.6, 1, 4.0],
      mat: 'metal',
      motion: { type: 'linear', to: [282.8, 6.3, 0], period: 6.0, phase: 0, ease: 'sine', dwell: 0.8 },
    }, // top 6.8, gap 2.0 and 0.6 down to board; 3.1 m and 0.7 up off the far pose

    { kind: 'platform', p: [291.2, 7.0, 0], s: [7, 1, 8], mat: 'obsidian', glow: NEON, stripe: true }, // top 7.5

    // Finish architecture, sized so the last shuttle ride frames it.
    { kind: 'deco', kindOf: 'arch', p: [291.2, 12.2, 0], s: [1.3, 1.0, 9.2], mat: 'obsidian', tint: NEON },
    { kind: 'deco', kindOf: 'pillar', p: [291.2, 9.9, 4.4], s: [1.2, 5.6, 1.2], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [291.2, 9.9, -4.4], s: [1.2, 5.6, 1.2], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'beacon', p: [294.4, 9.2, 0], s: [0.6, 2.8, 0.6], mat: 'emissive', tint: NEON },
    { kind: 'text', p: [288.6, 9.2, 0], rot: [0, -Math.PI / 2, 0], text: 'CIRCUIT BREAK', size: 0.42, color: NEON },
    { kind: 'light', p: [291.2, 10.6, 0], color: NEON, intensity: 20, distance: 32 },

    /* ============================================================================ */
    /* THE SUBSTATION — dressing. All of it at |z| >= 7 or above y = 9, i.e. outside */
    /* every play corridor on the stage. None of it is a landable kind and none of   */
    /* it looks like it should be.                                                   */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'monolith', p: [74, -10, 30], s: [10, 30, 10], count: 8, spread: [200, 20, 26], seed: 5150, tint: 0x142a44 },
    { kind: 'deco', kindOf: 'monolith', p: [210, -12, -32], s: [12, 36, 12], count: 8, spread: [190, 24, 28], seed: 6060, tint: 0x16304e },
    { kind: 'deco', kindOf: 'pipe', p: [156, 11.2, 9.4], s: [190, 0.7, 0.7], mat: 'metal', tint: 0x1c3550 },
    { kind: 'deco', kindOf: 'pipe', p: [156, 12.1, -9.4], s: [190, 0.7, 0.7], mat: 'metal', tint: 0x1c3550 },
    { kind: 'deco', kindOf: 'cable', p: [156, 14.4, 0], s: [210, 0.09, 0.09], mat: 'metal', tint: 0x0e1e33 },
    { kind: 'deco', kindOf: 'antenna', p: [156, 4, 26], s: [0.6, 20, 0.6], count: 6, spread: [230, 8, 14], seed: 7070, tint: DIM },
    { kind: 'deco', kindOf: 'screen', p: [246, 12.4, 10.0], s: [0.4, 7, 11], mat: 'emissive', tint: 0x8a3fa8 },
    { kind: 'deco', kindOf: 'cloud', p: [156, -24, 0], s: [22, 3, 22], count: 14, spread: [320, 12, 100], seed: 8080, scale: 1.9, tint: 0x1b3c5e },

    // Path lights, one per beat, so the route reads as a line from a distance.
    { kind: 'light', p: [46, 3.4, 0], color: NEON, intensity: 6, distance: 22 },
    { kind: 'light', p: [114, 4.2, 0], color: NEON, intensity: 7, distance: 22 },
    { kind: 'light', p: [154, 4.4, 0], color: NEON, intensity: 7, distance: 22 },
    { kind: 'light', p: [226, 5.6, 0], color: NEON, intensity: 8, distance: 24 },
    { kind: 'light', p: [255, 9.8, 0], color: AMBER, intensity: 9, distance: 26 },
    { kind: 'light', p: [277, 9.8, 0], color: NEON, intensity: 8, distance: 24 },
  ],
};
