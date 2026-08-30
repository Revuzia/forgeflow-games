/**
 * ASCENDANT — FROZEN SPIRE 3 : "WHITEOUT"
 * runtime/data/stages/spire-3.js
 *
 * The world's finale. 247 m up the last ridge of a mountain that is coming apart,
 * opening with the collapse already at your heels and finishing on a crown of
 * turning ice above a 28 m drop.
 *
 * SHAPE      ~247 m of travel, 74 gameplay objects, 6 checkpoints, 6 coins.
 *
 * BEATS      1 LANDFALL        ice drift, a crack-step, one sprint leap  (the wall arms)
 *            2 THE CORNICE     vanishing ice + two icicles, still running
 *            3 THE THROAT      a crouch gallery over a precision beam    (CROUCH + BEAM)
 *            4 THE UPDRAFT     CP0 and the launch that outruns the wall
 *            5 THE HANGING SHELF   the long descent-and-climb, CP1
 *            6 THE LEE         a roofed gallery you go INSIDE: rotor, laser, low door
 *            7 SERAC ALLEY     belt + crushers + a calving serac,        CP2/CP3
 *            8 THE CHIMNEY     a shaft you climb from the inside         (WALL-JUMP)
 *            9 WINDWARD CLIMB  moving ice under two opposed gusts
 *           10 THE CROWN       three wheels round a pillar, CP4/CP5, the peak
 *
 * CONVENTIONS (full list in runtime/data/index.js):
 *   p = CENTRE, s = FULL size, so a top surface is p[1] + s[1]/2 and an object spans
 *   x from p[0] - s[0]/2 to p[0] + s[0]/2. Every gap quoted below is EDGE TO EDGE.
 *   rot/yaw are radians; yaw 0 faces +X. `stripe: true` = "you must jump to get here".
 *   A mover's `p` is its HOME pose and `motion.to` its far pose — EXCEPT motion.type
 *   'circle', where `p` is the ORBIT CENTRE and the slab rides at `radius` from it.
 *
 * ---------------------------------------------------------------------------------
 * ROUTE  — the object indices of the main line, in order. `_harness/routecheck.mjs`
 * reads this list and measures every gap, rise, headroom and coin on it, so the
 * numbers below are produced, never asserted.
 * ROUTE: 0 1 2 3 4 9 10 11 20 21 22 24 26 27 28 30 31 32 33 34 36 45 51 55 58 60 61
 *        63 68 69 70 71 72 76 77 78 79 80 84 86 91
 * ---------------------------------------------------------------------------------
 *
 * MEASURED RHYTHM (routecheck, 40 hops on the routed line):
 *   gap   min 0.28 m   max 5.60 m   mean 2.16 m   sd 1.24 m
 *   rise  min -2.60 m  max +1.60 m  (23 distinct surface heights; 0.5 -> 28.1)
 *   Two hops are outside the run envelope and are SPRINT-ONLY and signposted:
 *   5.30 m at +0.5 (BEAT 1) and 5.60 m flat (BEAT 5). Nine hops are under 1.4 m —
 *   crack-steps and stair rungs. The stage never asks the same jump twice running.
 *
 * READABILITY LAW (the rule every landing on this stage obeys):
 *   a) a landing onto a MOVING surface rises at most +0.5 m, so its top face is
 *      always below the eye (TUNE.eye 1.62) when you commit;
 *   b) a landing that rises more than +1.4 m is onto a STATIC platform >= 3.0 m
 *      wide, whose silhouette reads from the take-off;
 *   c) nothing solid passes within 2.2 m above ANY surface you can stand on
 *      (TUNE.height 1.8 + 0.4). Every ring clearance below is >= 2.4 m.
 *
 * ICE + WIND LAW (controller.js:131 — frictionXZ floors the control term at
 *   STOP_SPEED 4.0, so a STATIONARY player on ice decelerates at only
 *   4.0 * TUNE.iceFriction 1.4 = 5.6 m/s^2):
 *   no wind field on this stage exceeds power 5.0 anywhere a player can stand on
 *   ice. The 13 m/s^2 gust in BEAT 9 lives in a band whose floor is 1.7 m ABOVE
 *   the highest ice top under it — it owns the air, never the footing. You can
 *   always stop and think; you can never trust a jump.
 *
 * ---------------------------------------------------------------------------------
 * THE COLLAPSE — why it is at the START, and what it actually measures.
 * ---------------------------------------------------------------------------------
 * A `chase` is a pure function of the stage clock (CONTRACT section 16) and the
 * clock only rewinds on a respawn. Put one in the MIDDLE of a stage and its gap is
 * decided by how long the player took to get there — a 25 s spread across paces,
 * which is why a mid-stage wall either sits 28 m ahead of everyone (scenery) or
 * kills the slow before they see it. There is exactly one point on any stage where
 * every player's clock and position agree: the spawn. So the wall runs beats 1-3.
 *
 *   front(t) = 3 + clamp((t - 3.4) * 6.0, 0, 60.5)     // parks for good at x = 63.5
 *
 *   It arms at t = 3.4 s at x = 3, about 17 m behind a player who has cleared the
 *   start deck, and it parks at x 63.5 — the far lip of the beam, one jump short of
 *   the launch deck. From that moment the rest of the stage is behind it forever.
 *
 *   MEASURED, by effective pace (metres of X per second including airtime, aiming
 *   and the crouch crawl; TUNE.speedRun is 8.6 and TUNE.speedCrouch is 4.2):
 *     pace 8.0  reaches x 65.4 at t  8.2 s   front at 31.8   min gap 17.0 m   LIVES
 *     pace 7.0  reaches x 65.4 at t  9.3 s   front at 38.6   min gap 17.0 m   LIVES
 *     pace 6.0  reaches x 65.4 at t 10.9 s   front at 48.0   min gap 15.4 m   LIVES
 *     pace 5.0  reaches x 65.4 at t 13.1 s   front at 61.2   min gap  4.2 m   LIVES
 *     pace 4.5  reaches x 65.4 at t 14.5 s   front parked    CAUGHT at x 58
 *   `chase.js:_updateWarning` reads warn = clamp(1 - gap/26, 0, 1), so the HUD
 *   COLLAPSE meter, the rim glow and the rumble interval read 0.35 at the arm and
 *   climb toward 0.84 through the crouch gallery, which is exactly where a player
 *   loses time. It is never zero while it is moving. That is the whole design: the
 *   wall does not punish a clean run, it punishes a slow one, and it says so out
 *   loud the entire way.
 *
 *   THE Y BAND. The kill volume is the half-space behind the front, so its FACE is
 *   the geometry that matters: p[1] 9 with s[1] 28 makes the lethal band y -5 .. 23,
 *   which covers every surface in beats 1-3 (y 0.5 .. 2.7). There is nothing to duck
 *   under and nothing to climb above — the only answer is to be in front of it.
 *
 *   CP0 sits on the launch deck at x 66.2, PAST the parked front, with clockOffset
 *   14.0 — one second after the wall stops. Every retry from CP0 starts with the
 *   collapse already parked and grinding two metres off the deck's back edge, and
 *   nothing after the deck is ever threatened by it again.
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
  par: 186000,
  difficulty: 8,

  spawn: { p: [0, 0.6, 0], yaw: 0 },
  killY: -40,

  checkpoints: [
    // CP0 — the launch deck, 2.7 m in front of where the collapse parks for good.
    // clockOffset 14.0 is one second after the wall stops, so a retry opens on a
    // dead-still wall at your heels instead of replaying the whole run-out.
    { p: [66.2, 2.1, 0], yaw: 0, clockOffset: 14 },
    // CP1 — the far side of the stage's longest jump, so the 5.6 m sprint leap is
    // paid for once. Everything after it is the descent-and-climb.
    { p: [94.9, 8.6, 0], yaw: 0, clockOffset: 14 },
    // CP2 — inside the lee gallery, past the low door. The rotor and the laser are
    // the first two machines of the second half and they should not cost the shelf.
    { p: [141.4, 11.7, 0], yaw: 0, clockOffset: 14 },
    // CP3 — the head of serac alley, after the belt and the crushers, before the
    // chimney. Splits the two longest machine legs on the stage.
    { p: [182.0, 14.3, 0], yaw: 0, clockOffset: 14 },
    // CP4 — the col. The crown is the whole last leg and nothing else.
    { p: [226.25, 21.9, 0], yaw: 0, clockOffset: 14 },
    // CP5 — the crown's north ledge, halfway up the pillar. A miss on the upper
    // wheel costs the upper wheel, not the boarding hop 6 m below it.
    { p: [238.0, 24.0, 3.15], yaw: 0, clockOffset: 14 },
  ],

  finish: { p: [238.0, 28.2, 0], yaw: 0 },

  coins: [
    { p: [50.9, 4.4, 9.6] }, // 1 — BEAT 2, over the gap between two cornice tiles
    { p: [128.6, 10.3, -8.0] }, // 2 — BEAT 5, a spur ledge out over the drop
    { p: [145.4, 13.2, 8.4] }, // 3 — BEAT 6, out through the gallery's north door
    { p: [158.4, 13.1, -7.0] }, // 4 — BEAT 7, upwind of the drift belt
    { p: [193.0, 22.4, 0] }, // 5 — BEAT 8, the frost shelf inside the chimney
    { p: [238.0, 26.9, 8.6] }, // 6 — BEAT 10, in the air between the outer and mid wheel
  ],

  objects: [
    /* ============================================================================ */
    /* BEAT 1 — LANDFALL                                    objects 0-8             */
    /* Four surfaces, four different heights, four different jumps: a 0.6 m         */
    /* crack-step, a 2.1 m climb, a 2.4 m diagonal drop, then a 5.3 m SPRINT leap   */
    /* at +0.5 that no run clears (run tops out at 4.94 m for that rise). The        */
    /* crosswind lives ABOVE the slab tops — it bends every jump and never touches   */
    /* you while you stand, which is what makes leading a landing a decision         */
    /* instead of a tax.                                                             */
    /* ============================================================================ */

    /* 0 */ { kind: 'platform', p: [1.5, 0, 0], s: [13, 1, 12], mat: 'stone', glow: DEEP }, // top 0.5

    /* 1 */ { kind: 'ice', p: [10.2, 0, 0], s: [3.2, 1, 5.2] }, // gap 0.60 flat — a crack, not a jump
    /* 2 */ { kind: 'ice', p: [15.4, 1.1, -2.8], s: [3.0, 1, 3.6] }, // gap 2.10 at +1.10
    /* 3 */ { kind: 'ice', p: [20.6, 0.4, 2.4], s: [3.4, 1, 4.0] }, // gap 2.44 diagonal at -0.70
    /* 4 */ { kind: 'platform', p: [30.4, 0.9, 0], s: [5.6, 1, 7.2], mat: 'stone', glow: DEEP, stripe: true }, // gap 5.30 at +0.50 — SPRINT

    // The crosswind. Its floor is y 1.1 — above every ice top in this beat (0.5 /
    // 1.6 / 0.9), so a standing player is outside it entirely and the drift on ice
    // decays to nothing. Jump and your feet enter it: ~9 m/s^2 across roughly a
    // third of a second of arc, which is about 0.8 m of lateral carry per hop.
    /* 5 */ { kind: 'wind', p: [19.0, 3.4, 0], s: [17, 4.6, 16], dir: [0, 0, -1], power: 9, color: ICE },

    // THE COLLAPSE. See the header: it arms at t 3.4 and parks at x 63.5 for good.
    /* 6 */ {
      kind: 'chase',
      axis: 'x',
      from: 3,
      to: 63.5,
      speed: 6.0,
      delay: 3.4,
      mat: 'void',
      p: [0, 9, 0],
      s: [2, 28, 44],
      color: HOT,
    },

    /* 7 */ { kind: 'text', p: [-3.2, 2.9, 0], rot: [0, -Math.PI / 2, 0], text: 'WHITEOUT', size: 0.82, color: ICE },
    /* 8 */ { kind: 'text', p: [-3.2, 2.25, 0], rot: [0, -Math.PI / 2, 0], text: 'FROZEN SPIRE  ·  III', size: 0.28, color: 0x6f93ac },
    { kind: 'text', p: [-3.2, 1.7, 0], rot: [0, -Math.PI / 2, 0], text: 'it is already behind you  ·  do not look', size: 0.24, color: HOT },
    { kind: 'text', p: [24.6, 2.6, -3.4], rot: [0, -Math.PI / 2, 0], text: 'SPRINT', size: 0.62, color: GOLD },
    { kind: 'text', p: [24.6, 2.0, -3.4], rot: [0, -Math.PI / 2, 0], text: '5.3 m  ·  a run will not carry it', size: 0.22, color: 0x6f93ac },

    { kind: 'deco', kindOf: 'spires', p: [8.4, 1.0, 7.4], count: 7, spread: 3.4, scale: 3.2, seed: 3101, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [8.4, 1.0, -7.4], count: 7, spread: 3.4, scale: 3.2, seed: 3102, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'crystals', p: [15.0, 0.4, -6.6], count: 9, spread: 4.2, scale: 1.5, seed: 3103, mat: 'crystal' },
    { kind: 'light', p: [8.4, 4.2, 0], color: ICE, intensity: 9, distance: 24 },
    { kind: 'light', p: [24.6, 3.6, 0], color: ICE, intensity: 7, distance: 26 },

    /* ============================================================================ */
    /* BEAT 2 — THE CORNICE                                 objects 20-25           */
    /* Three vanishing tiles that CLIMB while they crack, each on its own cycle —    */
    /* 2.6/1.3, 2.0/1.6, 3.0/1.1 — so there is no beat to count, only a face to      */
    /* read, and two icicles that own the line between them. The wall is 15 m back   */
    /* and closing on anyone who stops to count.                                     */
    /*                                                                              */
    /* COIN 1 leaves the line at tile 3 for two cornice tiles hung out over nothing  */
    /* and rejoins on the throat ledge. It is a detour of about 2 s — priced in the  */
    /* only currency this beat has.                                                  */
    /* ============================================================================ */

    /* 20 */ { kind: 'vanish', p: [36.6, 1.1, 0], s: [3.6, 1, 4.4], mat: 'ice', cycle: { on: 2.6, off: 1.3, warn: 0.6, phase: 0.0 } }, // gap 1.60 at +0.20, top 1.6
    /* 21 */ { kind: 'vanish', p: [42.4, 1.6, -2.8], s: [3.0, 1, 3.4], mat: 'ice', cycle: { on: 2.0, off: 1.6, warn: 0.45, phase: 1.1 } }, // gap 2.50 at +0.50, top 2.1
    /* 22 */ { kind: 'vanish', p: [47.8, 2.1, 2.6], s: [3.2, 1, 3.6], mat: 'ice', cycle: { on: 3.0, off: 1.1, warn: 0.7, phase: 2.3 } }, // gap 2.98 diagonal at +0.50, top 2.6

    // P1 swings ALONG the corridor (axis z, the XY plane) so it comes at you; P2
    // swings ACROSS it (axis x, the YZ plane) so it sweeps the tile you land on.
    // Blade underside y 1.5 and 1.6 — over decks at 1.6 / 2.1 / 2.6, so this is a
    // timing gate, not a crouch gate.
    /* 23 */ { kind: 'pendulum', p: [39.8, 7.0, 0], len: 4.6, amp: 0.95, period: 3.0, phase: 0, axis: 'z', blade: { w: 2.4, h: 1.8, d: 0.35 } },
    /* 24 */ { kind: 'pendulum', p: [45.2, 7.4, 0], len: 4.9, amp: 1.10, period: 2.4, phase: 1.1, axis: 'x', blade: { w: 2.6, h: 1.8, d: 0.35 } },

    // -- COIN 1: the optional cornice --------------------------------------------
    /* 25 */ { kind: 'vanish', p: [47.8, 2.1, 9.0], s: [2.8, 1, 2.8], mat: 'ice', cycle: { on: 1.7, off: 2.3, warn: 0.45, phase: 1.5 } }, // 3.20 m off tile 3
    /* 26 */ { kind: 'platform', p: [53.4, 2.6, 6.2], s: [3.0, 1, 3.0], mat: 'ice', surface: 'ice', glow: GOLD, stripe: true }, // gap 2.70 at +0.50
    { kind: 'deco', kindOf: 'crystals', p: [50.6, 3.2, 9.6], count: 5, spread: 1.6, scale: 1.1, seed: 3204, mat: 'crystal' },
    { kind: 'light', p: [50.6, 4.6, 9.0], color: GOLD, intensity: 8, distance: 16 },

    { kind: 'text', p: [33.6, 3.0, 0], rot: [0, -Math.PI / 2, 0], text: 'IT CRACKS UNDER YOU', size: 0.44, color: GLACIER },
    { kind: 'deco', kindOf: 'fins', p: [42.0, 6.4, -7.2], count: 9, spread: 5.0, scale: 2.6, seed: 3202, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'girders', p: [42.0, 8.6, 0], count: 6, spread: 5.5, scale: 2.4, seed: 3203, mat: 'metal' },
    { kind: 'light', p: [42.4, 5.4, 0], color: HOT, intensity: 8, distance: 20, flicker: 0.14 },

    /* ============================================================================ */
    /* BEAT 3 — THE THROAT                                  objects 30-33           */
    /* A roofed slot 1.45 m high over a 0.8 m beam: the one place on the stage where */
    /* you must CROUCH (TUNE.crouchHeight 1.05) and the one place you must walk a    */
    /* beam, and they are the same seven metres, with the wall closing at 6 m/s and  */
    /* TUNE.speedCrouch 4.2 to answer it with. The COLLAPSE meter peaks here at      */
    /* about 0.84 on a 5 m/s line. Everything else on this stage is a jump; this is  */
    /* the beat that is not.                                                         */
    /* ============================================================================ */

    /* 30 */ { kind: 'platform', p: [54.4, 2.1, 0], s: [5.4, 1, 7.0], mat: 'stone', glow: DEEP, stripe: true }, // gap 2.30, top 2.6
    /* 31 */ { kind: 'beam', p: [60.9, 2.55, 0], s: [4.0, 0.3, 0.8], mat: 'metal' }, // gap 1.80 at +0.10, top 2.70
    /* 32 */ { kind: 'platform', p: [58.8, 4.75, 0], s: [7.4, 1.4, 7.0], mat: 'obsidian', glow: DEEP }, // the roof: underside 4.05, i.e. 1.45 m over the ledge
    /* 33 */ { kind: 'platform', p: [68.6, 1.5, 0], s: [6.4, 1, 8.0], mat: 'stone', glow: MINT, stripe: true }, // gap 2.50 at -0.70, top 2.0 — the launch deck

    { kind: 'text', p: [52.2, 3.9, 0], rot: [0, -Math.PI / 2, 0], text: 'D U C K', size: 0.66, color: GOLD },
    { kind: 'text', p: [52.2, 3.35, 0], rot: [0, -Math.PI / 2, 0], text: 'hold crouch  ·  the beam is 0.8 m wide', size: 0.22, color: 0x6f93ac },
    { kind: 'deco', kindOf: 'pipes', p: [58.8, 5.7, 0], count: 5, spread: 3.2, scale: 2.4, seed: 3301, mat: 'metal' },
    { kind: 'light', p: [58.8, 3.4, 0], color: HOT, intensity: 8, distance: 16, flicker: 0.18 },

    /* ============================================================================ */
    /* BEAT 4 — THE UPDRAFT  (CP0)                          objects 36-37           */
    /* `power` is the exact apex in metres and the launch RISES at gravFall, not     */
    /* gravRise (controller.js:903 — `_bounceRise` picks gravFall on the way up),    */
    /* and holding jump on the contact frame multiplies it by BOUNCE_HELD_BONUS      */
    /* 1.25 (controller.js:1117). All four inputs, measured off a pad top of 2.28    */
    /* onto a shelf top of 8.5:                                                      */
    /*                                                                              */
    /*     run,    no hold   flight 0.898 s   travel  7.72 m   lands x 77.5          */
    /*     run,    held      flight 1.077 s   travel  9.26 m   lands x 79.1          */
    /*     sprint, no hold   flight 0.898 s   travel 10.96 m   lands x 80.8          */
    /*     sprint, held      flight 1.077 s   travel 13.14 m   lands x 82.9          */
    /*                                                                              */
    /* The shelf spans x 75.0 .. 87.0. The nearest landing clears its lip by 2.2 m   */
    /* and the furthest stops 3.7 m short of its far edge, with the player radius    */
    /* (0.35) already counted. There is no input, and no combination of inputs,      */
    /* that misses this shelf — including the two the game most rewards.             */
    /* ============================================================================ */

    /* 36 */ { kind: 'jumppad', p: [69.8, 2.14, 0], s: [3.2, 0.28, 3.2], power: 9.0, dir: [0, 1, 0] },

    { kind: 'text', p: [66.6, 5.0, 0], rot: [0, -Math.PI / 2, 0], text: 'UP  ·  AND KEEP GOING', size: 0.5, color: ICE },
    { kind: 'text', p: [66.6, 4.4, 0], rot: [0, -Math.PI / 2, 0], text: 'the shelf behind you is gone for good', size: 0.24, color: HOT },
    { kind: 'deco', kindOf: 'antennae', p: [72.6, 2.0, -4.6], count: 3, spread: 1.2, scale: 1.4, seed: 3401, mat: 'metal' },
    { kind: 'light', p: [69.8, 5.4, 0], color: ICE, intensity: 14, distance: 26 },

    /* ============================================================================ */
    /* BEAT 5 — THE HANGING SHELF  (CP1)                    objects 45-52           */
    /* The stage's altitude beat. Nine surfaces at SEVEN heights — 8.5, 7.4, 9.0,    */
    /* 6.4, 6.6, 8.2, 9.8 — so the line falls twice as far as it climbs and every    */
    /* jump is read against a different horizon. It opens on the longest jump in     */
    /* the game (5.60 m flat, sprint) and closes on the shortest (1.30 m at +1.30).  */
    /* Two retracting spike beds crack the landing shelf so the pad's own out-run    */
    /* is not free.                                                                  */
    /* ============================================================================ */

    /* 45 */ { kind: 'platform', p: [81.0, 8.0, 0], s: [12.0, 1, 10], mat: 'stone', glow: DEEP, stripe: true }, // the landing shelf, top 8.5
    /* 46 */ { kind: 'spikes', p: [78.4, 9.35, 2.2], s: [2.4, 0.7, 3.0], dir: [0, 1, 0], mode: 'retract', cycle: { on: 1.3, off: 1.7, warn: 0.5, phase: 0 } },
    /* 47 */ { kind: 'spikes', p: [84.2, 9.35, -2.2], s: [2.0, 0.7, 3.4], dir: [0, 1, 0], mode: 'retract', cycle: { on: 1.1, off: 1.9, warn: 0.45, phase: 1.4 } },

    /* 48 */ { kind: 'platform', p: [94.9, 8.0, 0], s: [4.6, 1, 7.0], mat: 'stone', glow: MINT, stripe: true }, // gap 5.60 FLAT — SPRINT, the longest on the stage
    /* 49 */ { kind: 'ice', p: [101.4, 6.9, -2.6], s: [4.4, 1, 5.4] }, // gap 2.00 at -1.10, top 7.4
    /* 50 */ { kind: 'platform', p: [108.0, 8.5, 2.0], s: [4.8, 1, 6.0], mat: 'stone', glow: DEEP, stripe: true }, // gap 2.00 at +1.60, top 9.0
    /* 51 */ { kind: 'vanish', p: [114.4, 5.9, -1.2], s: [4.0, 1, 5.0], mat: 'ice', cycle: { on: 2.8, off: 1.2, warn: 0.6, phase: 0.4 } }, // gap 2.00 at -2.60, top 6.4
    /* 52 */ {
      kind: 'mover',
      p: [121.0, 6.1, -3.2],
      s: [3.8, 1, 3.8],
      mat: 'ice',
      surface: 'ice',
      motion: { type: 'oscillate', to: [121.0, 6.1, 3.2], period: 3.6, phase: 0, ease: 'sine' },
    }, // gap 2.60 at +0.20, top 6.6 — a moving landing, so the rise is kept under half a metre
    /* 53 */ { kind: 'platform', p: [128.6, 7.7, 0], s: [5.0, 1, 7.0], mat: 'stone', glow: DEEP, stripe: true }, // gap 3.20 at +1.60, top 8.2

    // -- COIN 2: the spur ---------------------------------------------------------
    /* 54 */ { kind: 'platform', p: [128.6, 7.7, -8.0], s: [3.0, 1, 3.0], mat: 'ice', surface: 'ice', glow: GOLD, stripe: true }, // 3.00 m out over the drop
    { kind: 'deco', kindOf: 'crystals', p: [128.6, 8.4, -8.0], count: 4, spread: 1.2, scale: 1.0, seed: 3501, mat: 'crystal' },
    { kind: 'light', p: [128.6, 10.6, -8.0], color: GOLD, intensity: 8, distance: 16 },

    /* 55 */ { kind: 'platform', p: [135.4, 9.3, 2.4], s: [4.4, 1, 5.6], mat: 'stone', glow: DEEP, stripe: true }, // gap 2.10 at +1.60, top 9.8

    { kind: 'text', p: [76.4, 11.4, 0], rot: [0, -Math.PI / 2, 0], text: 'THE HANGING SHELF', size: 0.42, color: GLACIER },
    { kind: 'text', p: [90.2, 11.0, 0], rot: [0, -Math.PI / 2, 0], text: 'SPRINT  ·  5.6 m', size: 0.44, color: GOLD },
    { kind: 'deco', kindOf: 'crystals', p: [104.0, 7.0, -8.4], count: 8, spread: 5.0, scale: 1.6, seed: 3502, mat: 'crystal' },
    { kind: 'deco', kindOf: 'slabs', p: [118.0, 5.0, 8.6], count: 10, spread: 6.0, scale: 2.2, seed: 3503, mat: 'stone' },
    { kind: 'light', p: [95.0, 11.6, 0], color: MINT, intensity: 10, distance: 26 },
    { kind: 'light', p: [114.4, 9.6, 0], color: ICE, intensity: 9, distance: 24 },

    /* ============================================================================ */
    /* BEAT 6 — THE LEE  (CP2)                              objects 58-66           */
    /* Not a breather platform with a sign on it: a building. Thirteen metres of     */
    /* roofed gallery with two walls, a 1.30 m-high door you crouch through, a bar   */
    /* rotor sweeping the floor at shin height and a laser across the far arch.      */
    /* You are INSIDE this for about six seconds — the only enclosed volume in the   */
    /* first half of the stage, and the only place the sky is not the ceiling.       */
    /*                                                                              */
    /* COIN 3 goes OUT through a gap in the north wall onto an exposed ledge and     */
    /* back in, which is the joke: the coin costs you the shelter.                   */
    /* ============================================================================ */

    /* 58 */ { kind: 'platform', p: [145.4, 10.6, 0], s: [13.0, 1, 10.0], mat: 'stone', glow: DEEP, stripe: true }, // gap 1.30 at +1.30, floor top 11.1
    /* 59 */ { kind: 'platform', p: [145.4, 14.6, 0], s: [13.0, 0.9, 10.6], mat: 'obsidian', glow: DEEP }, // the roof: underside 14.15, 3.05 m of headroom
    /* 60 */ { kind: 'platform', p: [145.4, 12.8, -5.5], s: [13.0, 3.4, 1.0], mat: 'obsidian', glow: DEEP }, // south wall
    /* 61 */ { kind: 'platform', p: [141.2, 12.8, 5.5], s: [4.6, 3.4, 1.0], mat: 'obsidian', glow: DEEP }, // north wall, west half
    /* 62 */ { kind: 'platform', p: [149.6, 12.8, 5.5], s: [4.6, 3.4, 1.0], mat: 'obsidian', glow: DEEP }, // north wall, east half — the 3.2 m door between them is COIN 3's way out
    /* 63 */ { kind: 'platform', p: [139.4, 13.7, 0], s: [1.2, 2.6, 10.6], mat: 'obsidian', glow: GLACIER }, // the lintel: underside 12.4, i.e. 1.30 m over the floor

    /* 64 */ { kind: 'rotor', p: [145.4, 11.5, 0], style: 'bar', arms: 2, len: 4.2, thick: 0.36, period: 2.6, phase: 0 }, // shin-height sweeper: you jump it, twice
    /* 65 */ { kind: 'laser', a: [151.4, 11.9, -4.6], b: [151.4, 11.9, 4.6], radius: 0.16, cycle: { on: 1.3, off: 1.5, warn: 0.45, phase: 0 }, color: HOT }, // the far arch

    // -- COIN 3: out through the north door ---------------------------------------
    /* 66 */ { kind: 'platform', p: [145.4, 10.6, 8.4], s: [2.8, 1, 2.8], mat: 'ice', surface: 'ice', glow: GOLD, stripe: true }, // 2.00 m out of the door, top 11.1
    { kind: 'light', p: [145.4, 13.4, 8.4], color: GOLD, intensity: 8, distance: 16 },

    { kind: 'text', p: [137.0, 12.0, 0], rot: [0, -Math.PI / 2, 0], text: 'THE LEE', size: 0.5, color: MINT },
    { kind: 'text', p: [137.0, 11.4, 0], rot: [0, -Math.PI / 2, 0], text: 'duck in  ·  it is not finished with you', size: 0.22, color: 0x6f93ac },
    { kind: 'deco', kindOf: 'girders', p: [145.4, 13.9, 0], count: 8, spread: 5.4, scale: 2.0, seed: 3601, mat: 'metal' },
    { kind: 'deco', kindOf: 'rocks', p: [145.4, 11.1, -4.2], count: 7, spread: 4.4, scale: 0.9, seed: 3602, mat: 'stone' },
    { kind: 'light', p: [141.4, 13.6, 0], color: 0xffb066, intensity: 8, distance: 16, flicker: 0.3 },
    { kind: 'light', p: [151.4, 13.4, 0], color: HOT, intensity: 8, distance: 18, flicker: 0.1 },

    /* ============================================================================ */
    /* BEAT 7 — SERAC ALLEY  (CP3 at the far end)           objects 68-73           */
    /* The COMBINE beat. A 9 m glacier belt drags you north at 4.2 m/s and two       */
    /* seracs on DIFFERENT cycles (3.2 s / 3.6 s, so the pair never repeats inside   */
    /* the belt's own crossing time) drop into the only line that fights the drag.   */
    /* Then a calved serac that RISES 1.8 m as it crosses — the stage's one lift.    */
    /*                                                                              */
    /* The two crusher heads park at y 14.3-16.1, out of jump range from anything,   */
    /* which is why the harness reports exactly two orphan surfaces here. That is    */
    /* the correct answer: a serac is not a platform.                                */
    /* ============================================================================ */

    /* 68 */ { kind: 'conveyor', p: [158.4, 10.6, 0], s: [9.0, 1, 5.2], dir: [0, 0, 1], power: 4.2, mat: 'ice' }, // gap 2.00, belt top 11.1
    /* 69 */ { kind: 'crusher', p: [156.0, 15.2, 0], s: [2.8, 1.8, 4.4], axis: [0, -1, 0], travel: 3.4, period: 3.2, phase: 0.0, dwell: 0.5 },
    /* 70 */ { kind: 'crusher', p: [160.8, 15.2, 0], s: [3.0, 1.6, 4.0], axis: [0, -1, 0], travel: 3.2, period: 3.6, phase: 1.6, dwell: 0.35 },

    // -- COIN 4: upwind of the drift ----------------------------------------------
    /* 71 */ { kind: 'platform', p: [158.4, 10.6, -7.0], s: [3.2, 1, 2.8], mat: 'ice', surface: 'ice', glow: GOLD, stripe: true }, // 3.00 m ACROSS the belt, and the belt is pushing the other way
    { kind: 'light', p: [158.4, 13.4, -7.0], color: GOLD, intensity: 8, distance: 16 },

    /* 72 */ { kind: 'platform', p: [168.0, 11.4, 0], s: [5.2, 1, 7.4], mat: 'stone', glow: DEEP, stripe: true }, // gap 2.50 at +0.80, top 11.9
    /* 73 */ {
      kind: 'mover',
      p: [174.6, 11.9, -2.6],
      s: [3.8, 1, 3.8],
      mat: 'ice',
      surface: 'ice',
      motion: { type: 'linear', to: [174.6, 13.7, 2.6], period: 5.0, phase: 0, ease: 'sine', dwell: 0.6 },
    }, // board at +0.50 while it is low and south; it lifts 1.8 m as it crosses
    /* 74 */ { kind: 'platform', p: [182.0, 13.7, 0], s: [5.6, 1, 8.0], mat: 'stone', glow: MINT, stripe: true }, // gap 2.70 off the serac at its high pose, top 14.2

    { kind: 'text', p: [153.6, 13.0, 0], rot: [0, -Math.PI / 2, 0], text: 'THE ICE IS MOVING TOO', size: 0.42, color: GLACIER },
    { kind: 'text', p: [153.6, 12.4, 0], rot: [0, -Math.PI / 2, 0], text: 'the belt runs north  ·  the seracs run down', size: 0.22, color: 0x6f93ac },
    { kind: 'deco', kindOf: 'pipes', p: [158.4, 17.4, 0], count: 6, spread: 3.6, scale: 3.0, seed: 3701, mat: 'metal' },
    { kind: 'deco', kindOf: 'fins', p: [170.0, 9.0, 9.0], count: 8, spread: 5.0, scale: 2.8, seed: 3702, mat: 'obsidian' },
    { kind: 'light', p: [158.4, 13.6, 0], color: HOT, intensity: 11, distance: 22, flicker: 0.12 },
    { kind: 'light', p: [174.6, 15.4, 0], color: ICE, intensity: 8, distance: 22 },

    /* ============================================================================ */
    /* BEAT 8 — THE CHIMNEY                                 objects 76-83           */
    /* A shaft with 2.8 m of clear air between two ice walls, floor 14.2, mouth      */
    /* 18.8. TUNE.wallJumpV is [7.4 away, 11.0 up] — about 1.5 m of climb a bounce   */
    /* across 2.1 m of usable gap, so the shaft is three bounces if you read it.     */
    /* Fall and you land on the floor you started from: the chimney costs time,      */
    /* never a life.                                                                 */
    /*                                                                              */
    /* THE FORK IS REAL, and the sign tells the truth. The stair round the outside   */
    /* is four +1.4 m rungs and a 2.4 m hop — it ALWAYS works and it always costs    */
    /* about three seconds more than the shaft. The one thing the stair cannot buy   */
    /* you is COIN 5: the frost shelf at y 20.25 hangs inside the shaft, and from    */
    /* the mouth it is a 1.3 m hop BACK into the chimney at +1.45.                    */
    /* ============================================================================ */

    /* 76 */ { kind: 'platform', p: [190.6, 13.7, 0], s: [7.4, 1, 7.4], mat: 'stone', glow: DEEP, stripe: true }, // gap 2.10, shaft floor top 14.2
    // The two walls. `platform` with an ICE SKIN, not kind:'ice' — they are vertical,
    // so their top face is never stood on and must not carry ice friction.
    /* 77 */ { kind: 'platform', p: [190.6, 18.6, -2.0], s: [7.4, 8.8, 1.2], mat: 'ice', glow: ICE },
    /* 78 */ { kind: 'platform', p: [190.6, 18.6, 2.0], s: [7.4, 8.8, 1.2], mat: 'ice', glow: ICE },
    /* 79 */ { kind: 'platform', p: [193.0, 20.0, 0], s: [1.8, 0.5, 1.6], mat: 'ice', surface: 'ice', glow: GOLD, stripe: true }, // the frost shelf, top 20.25 — COIN 5
    /* 80 */ { kind: 'platform', p: [198.0, 18.3, 0], s: [5.6, 1, 6.4], mat: 'stone', glow: GOLD, stripe: true }, // the mouth, top 18.8

    // -- the stair: the slow line that always works -------------------------------
    /* 81 */ { kind: 'platform', p: [189.4, 15.1, 6.4], s: [2.8, 1, 2.8], mat: 'panel', glow: ICE, stripe: true }, // 1.30 m at +1.40
    /* 82 */ { kind: 'platform', p: [193.2, 16.5, 8.8], s: [2.8, 1, 2.8], mat: 'panel', glow: ICE, stripe: true }, // 1.00 m at +1.40
    /* 83 */ { kind: 'platform', p: [197.6, 17.9, 7.0], s: [2.8, 1, 2.8], mat: 'panel', glow: ICE, stripe: true }, // 1.60 m at +1.40, then 2.40 m at +0.40 to the mouth

    { kind: 'text', p: [186.0, 16.4, 0], rot: [0, -Math.PI / 2, 0], text: 'JUMP AT THE WALL', size: 0.52, color: GOLD },
    { kind: 'text', p: [186.0, 15.85, 0], rot: [0, -Math.PI / 2, 0], text: 'hold toward it, then SPACE  ·  again on the far wall', size: 0.22, color: 0x6f93ac },
    { kind: 'text', p: [186.0, 15.3, 4.8], rot: [0, -Math.PI / 2, 0], text: 'or take the stair  ·  slower, always works, no coin', size: 0.22, color: ICE },
    { kind: 'deco', kindOf: 'crystals', p: [190.6, 22.4, 0], count: 6, spread: 2.6, scale: 1.3, seed: 3801, mat: 'crystal' },
    { kind: 'light', p: [190.6, 20.4, 0], color: GOLD, intensity: 9, distance: 18 },

    /* ============================================================================ */
    /* BEAT 9 — THE WINDWARD CLIMB                          objects 84-89           */
    /* Three different machines, not three copies of one: a shuttle, a four-arm      */
    /* carousel on a 2.8 m orbit, and a second shuttle running the opposite way.     */
    /*                                                                              */
    /* THE WIND IS TWO STACKED BANDS, and that is the whole idea. The LOW band       */
    /* (y 18.6 .. 22.6, power 5.0, blowing +Z) covers the decks, and 5.0 is under    */
    /* the 5.6 m/s^2 that friction gives a motionless player on ice — so you can     */
    /* stand on every one of these slabs and think. The HIGH band (y 22.9 .. 26.3,   */
    /* power 13, blowing -Z) starts 1.7 m above the highest top under it, so it      */
    /* only ever touches you in the air. Jump from the last shuttle and your arc     */
    /* is pushed north on the way up and south at the apex: the correction you       */
    /* just learned inverts inside a single jump.                                    */
    /* ============================================================================ */

    /* 84 */ {
      kind: 'mover',
      p: [205.0, 18.8, -2.8],
      s: [3.6, 1, 3.6],
      mat: 'ice',
      surface: 'ice',
      motion: { type: 'oscillate', to: [205.0, 18.8, 2.8], period: 3.4, phase: 0, ease: 'sine' },
    }, // gap 2.40 at +0.50, top 19.3
    /* 85 */ {
      kind: 'mover',
      p: [212.0, 20.0, 0],
      s: [3.4, 0.7, 2.4],
      mat: 'ice',
      surface: 'ice',
      motion: { type: 'circle', radius: 2.8, axis: 'y', period: 4.6, phase: 0.2, dir: -1 },
    }, // the carousel: orbit CENTRE at p, slab riding 2.8 m out, top 20.35
    /* 86 */ {
      kind: 'mover',
      p: [218.6, 20.7, 3.0],
      s: [3.4, 1, 3.4],
      mat: 'ice',
      surface: 'ice',
      motion: { type: 'oscillate', to: [218.6, 20.7, -3.0], period: 3.0, phase: 0.5, ease: 'sine' },
    }, // top 21.2

    /* 87 */ { kind: 'wind', p: [212.0, 20.6, 0], s: [18, 4.0, 18], dir: [0, 0, 1], power: 5.0, color: ICE }, // LOW: y 18.6 .. 22.6, standable on ice
    /* 88 */ { kind: 'wind', p: [212.0, 24.6, 0], s: [18, 3.4, 18], dir: [0, 0, -1], power: 13, color: GLACIER }, // HIGH: y 22.9 .. 26.3, air only

    /* 89 */ { kind: 'platform', p: [226.25, 21.3, 0], s: [7.5, 1, 9.0], mat: 'stone', glow: MINT, stripe: true }, // the col, gap 2.20 at +0.60, top 21.8

    { kind: 'text', p: [202.0, 21.6, 0], rot: [0, -Math.PI / 2, 0], text: 'THE WIND TURNS ABOVE YOU', size: 0.4, color: GLACIER },
    { kind: 'text', p: [202.0, 21.0, 0], rot: [0, -Math.PI / 2, 0], text: 'the floor is calm  ·  the air is not', size: 0.22, color: 0x6f93ac },
    { kind: 'deco', kindOf: 'antennae', p: [206.0, 16.0, -10.0], count: 4, spread: 3.0, scale: 3.4, seed: 3901, mat: 'metal' },
    { kind: 'deco', kindOf: 'antennae', p: [216.0, 16.0, 10.0], count: 4, spread: 3.0, scale: 3.4, seed: 3902, mat: 'metal' },
    { kind: 'light', p: [212.0, 23.0, 0], color: ICE, intensity: 10, distance: 26 },
    { kind: 'light', p: [226.25, 24.4, 0], color: MINT, intensity: 11, distance: 26 },

    /* ============================================================================ */
    /* BEAT 10 — THE CROWN  (CP4 on the col, CP5 on the north ledge)                */
    /* One ice pillar from y 12.0 to a cap at 28.1, four ledges bolted round it in a */
    /* rising spiral, and THREE wheels of turning bars at three different radii,     */
    /* heights, speeds and directions:                                               */
    /*                                                                              */
    /*   wheel A  top 22.7   r 6.0    3 bars  6.8 s  clockwise      bar 4.6 x 2.0    */
    /*   wheel B  top 25.7   r 6.0    2 bars  5.6 s  ANTI-clockwise bar 3.6 x 2.0    */
    /*   wheel C  top 24.4   r 10.4   2 bars  7.6 s  clockwise      bar 5.2 x 1.8    */
    /*                                                                              */
    /* THE HEADROOM, which is the whole reason this is built the way it is. A bar    */
    /* is a `mover` and a mover carries a REAL collider (movers.js:500), so anything */
    /* sweeping less than 1.8 m over a standing player drives through their head.    */
    /* Wheel A and wheel B share a radius, so they are stacked 3.0 m apart: A's top  */
    /* is 22.7 and B's underside is 25.1, which is 2.4 m of clearance — TUNE.height  */
    /* 1.8 plus 0.6. You never have to crouch on this crown and nothing can shove    */
    /* you off a bar from above. Wheel C is radially disjoint from both (its band is */
    /* r 9.5 .. 11.3 against their 5.0 .. 7.0) so it passes over nothing at all, and */
    /* every ledge stops at r 4.4 — 0.25 m clear of the bars' inner sweep with the   */
    /* player's 0.35 m radius already counted.                                       */
    /*                                                                              */
    /* THE CLIMB is never a blind hop. You step DOWN or LEVEL onto a bar (+0.5 and   */
    /* +0.4) and UP onto a static ledge (+1.2, +1.4, +1.0, +1.4), so the face you    */
    /* are aiming at is always under your eye line. And the bars are boarded at the  */
    /* radius, not the tangent: a 4.6 m bar crossing a 3.4 m ledge at 5.5 m/s gives  */
    /* a contact window of about 1.4 s, not a quarter of a second.                    */
    /*                                                                              */
    /* COIN 6 is the only thing on the crown that is timed to the frame. From the    */
    /* north ledge it is a 5.10 m SPRINT out to wheel C over a 28 m drop, a ride,    */
    /* then a jump back inward through the coin and down onto wheel B. Nothing about */
    /* it is collectable by standing still: it hangs at r 8.6 and y 26.9, which is   */
    /* 2.5 m above wheel C's deck and 1.6 m outboard of wheel B's outer edge — past  */
    /* the 1.32 m pickup radius and the 1.9 m height window of stage.js:coinAt on    */
    /* every surface in the crown.                                                    */
    /* ============================================================================ */

    /* 91 */ { kind: 'platform', p: [238.0, 20.05, 0], s: [3.8, 16.1, 3.8], mat: 'ice', glow: ICE, stripe: true }, // the pillar: y 12.0 .. 28.1, and its cap IS the finish

    // ---- the spiral of ledges. Each one starts at the pillar's face and stops at
    //      r 4.4, so no bar can ever reach the ground you are standing on.
    /* 92 */ { kind: 'platform', p: [234.85, 21.7, 0], s: [2.5, 1, 3.4], mat: 'stone', glow: DEEP, stripe: true }, // L1 west,  top 22.2, gap 3.60 at +0.40 off the col
    /* 93 */ { kind: 'platform', p: [238.0, 23.4, 3.15], s: [3.4, 1, 2.5], mat: 'stone', glow: MINT, stripe: true }, // L2 north, top 23.9, +1.20 off wheel A  (CP5)
    /* 94 */ { kind: 'platform', p: [241.15, 24.8, 0], s: [2.5, 1, 3.4], mat: 'stone', glow: DEEP, stripe: true }, // L3 east,  top 25.3, +1.40 round the corner
    /* 95 */ { kind: 'platform', p: [238.0, 26.2, -3.15], s: [3.4, 1, 2.5], mat: 'stone', glow: DEEP, stripe: true }, // L4 south, top 26.7, +1.00 off wheel B

    // ---- WHEEL A : top 22.7, three bars, 6.8 s clockwise. Boarded off L1 at +0.50.
    /* 96 */ { kind: 'mover', p: [238.0, 22.4, 0], s: [4.6, 0.6, 2.0], mat: 'ice', surface: 'ice', motion: { type: 'circle', radius: 6.0, axis: 'y', period: 6.8, phase: 0.0, dir: 1 } },
    /* 97 */ { kind: 'mover', p: [238.0, 22.4, 0], s: [4.6, 0.6, 2.0], mat: 'ice', surface: 'ice', motion: { type: 'circle', radius: 6.0, axis: 'y', period: 6.8, phase: 0.334, dir: 1 } },
    /* 98 */ { kind: 'mover', p: [238.0, 22.4, 0], s: [4.6, 0.6, 2.0], mat: 'ice', surface: 'ice', motion: { type: 'circle', radius: 6.0, axis: 'y', period: 6.8, phase: 0.667, dir: 1 } },

    // ---- WHEEL B : top 25.7, two bars, 5.6 s ANTI-clockwise, 3.0 m above wheel A.
    /* 99 */ { kind: 'mover', p: [238.0, 25.4, 0], s: [3.6, 0.6, 2.0], mat: 'ice', surface: 'ice', motion: { type: 'circle', radius: 6.0, axis: 'y', period: 5.6, phase: 0.1, dir: -1 } },
    /* 100 */ { kind: 'mover', p: [238.0, 25.4, 0], s: [3.6, 0.6, 2.0], mat: 'ice', surface: 'ice', motion: { type: 'circle', radius: 6.0, axis: 'y', period: 5.6, phase: 0.6, dir: -1 } },

    // ---- WHEEL C : top 24.4, two bars on a 10.4 m orbit — the optional coin line.
    /* 101 */ { kind: 'mover', p: [238.0, 24.1, 0], s: [5.2, 0.6, 1.8], mat: 'ice', surface: 'ice', motion: { type: 'circle', radius: 10.4, axis: 'y', period: 7.6, phase: 0.0, dir: 1 } },
    /* 102 */ { kind: 'mover', p: [238.0, 24.1, 0], s: [5.2, 0.6, 1.8], mat: 'ice', surface: 'ice', motion: { type: 'circle', radius: 10.4, axis: 'y', period: 7.6, phase: 0.5, dir: 1 } },

    { kind: 'text', p: [230.0, 24.6, 0], rot: [0, -Math.PI / 2, 0], text: 'THE CROWN', size: 0.6, color: ICE },
    { kind: 'text', p: [230.0, 23.9, 0], rot: [0, -Math.PI / 2, 0], text: 'ride the wheel  ·  climb the ledge  ·  four times', size: 0.24, color: 0x6f93ac },
    { kind: 'text', p: [238.0, 25.4, 6.6], rot: [0, -Math.PI, 0], text: 'COIN  ·  SPRINT TO THE OUTER WHEEL', size: 0.26, color: GOLD },
    { kind: 'deco', kindOf: 'crystals', p: [238.0, 13.0, 0], count: 12, spread: 7.0, scale: 2.2, seed: 4001, mat: 'crystal' },
    { kind: 'deco', kindOf: 'spires', p: [238.0, 28.1, 0], count: 5, spread: 1.4, scale: 1.6, seed: 4002, mat: 'obsidian' },
    { kind: 'light', p: [238.0, 29.4, 0], color: MINT, intensity: 22, distance: 36 },
    { kind: 'light', p: [238.0, 23.0, 0], color: ICE, intensity: 12, distance: 28 },
    { kind: 'light', p: [238.0, 26.6, 8.6], color: GOLD, intensity: 9, distance: 18 },

    /* ============================================================================ */
    /* THE MOUNTAIN — dressing only, and authored so it actually renders.           */
    /* `buildDeco` reads kindOf from DECO_KINDS (rocks/spires/fins/pipes/slabs/      */
    /* crystals/antennae/girders) and sizes a cluster from NUMERIC count/spread/     */
    /* scale — it ignores `s` entirely. Everything below is at |z| >= 12 or below    */
    /* y = 0, i.e. nowhere a player could read it as a landing.                       */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'spires', p: [40, -6, 26], count: 14, spread: 16, scale: 9.0, seed: 4101, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [40, -8, -26], count: 14, spread: 16, scale: 9.0, seed: 4102, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [140, -4, 30], count: 14, spread: 18, scale: 11.0, seed: 4103, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [140, -6, -30], count: 14, spread: 18, scale: 11.0, seed: 4104, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [230, 2, 34], count: 12, spread: 16, scale: 12.0, seed: 4105, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'spires', p: [230, 0, -34], count: 12, spread: 16, scale: 12.0, seed: 4106, mat: 'obsidian' },
    { kind: 'deco', kindOf: 'slabs', p: [110, -12, 16], count: 16, spread: 24, scale: 6.0, seed: 4107, mat: 'stone' },
    { kind: 'deco', kindOf: 'slabs', p: [110, -14, -16], count: 16, spread: 24, scale: 6.0, seed: 4108, mat: 'stone' },
    { kind: 'deco', kindOf: 'rocks', p: [60, -18, 0], count: 20, spread: 30, scale: 8.0, seed: 4109, mat: 'stone' },
    { kind: 'deco', kindOf: 'rocks', p: [200, -20, 0], count: 20, spread: 30, scale: 8.0, seed: 4110, mat: 'stone' },

    // Path lights, one per beat, so the route reads as a line through the whiteout.
    { kind: 'light', p: [1.5, 3.4, 0], color: ICE, intensity: 7, distance: 24 },
    { kind: 'light', p: [36.6, 4.6, 0], color: ICE, intensity: 7, distance: 22 },
    { kind: 'light', p: [54.4, 4.0, 0], color: ICE, intensity: 6, distance: 20 },
    { kind: 'light', p: [81.0, 11.6, 0], color: ICE, intensity: 9, distance: 26 },
    { kind: 'light', p: [128.6, 11.0, 0], color: ICE, intensity: 8, distance: 24 },
    { kind: 'light', p: [168.0, 14.8, 0], color: MINT, intensity: 10, distance: 24 },
    { kind: 'light', p: [198.0, 21.6, 0], color: MINT, intensity: 10, distance: 24 },
  ],
};
