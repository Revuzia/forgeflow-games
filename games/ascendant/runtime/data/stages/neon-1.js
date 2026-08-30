/**
 * ASCENDANT — NEON DOJO 1 : "FIRST LIGHT"
 * runtime/data/stages/neon-1.js
 *
 * The tutorial. A rooftop dojo in the rain, high over a city that is only ever a
 * silhouette. Nothing here is trying to kill you except the drop, and the drop is
 * always somewhere you chose to be.
 *
 * SHAPE      ~252 m of travel, 48 gameplay objects, 12 dynamic hazards,
 *            6 checkpoints (never more than 49 m apart), 3 coins.
 *            It runs long on purpose: every mechanic is taught in isolation before
 *            it is ever asked for, and that costs metres. Later stages are denser.
 *
 * TEACHES    walk -> a gap -> gaps that grow -> aim sideways -> step up -> a belt
 *            that carries you -> a beam you have to walk -> a ferry that comes back
 *            -> the jump pad -> sprint -> panels that vanish -> spikes -> a floor
 *            that sinks -> and a launch into a three-tier ascent for the finish.
 *
 * ── HOUSE RULES THIS FILE EXISTS TO DEMONSTRATE ──────────────────────────────
 * Ten more stages will be written against this one. The rules below are not style
 * preferences; the first four are enforced by `_harness/reachcheck.mjs`.
 *
 * 1. THE ENVELOPE IS LAW.  CONTRACT §0: at run speed (8.6 m/s) a flat gap of
 *    4.4 m is the authoring limit and 5.24 m is the theoretical maximum. This
 *    stage's longest flat run-speed gap is 3.8 m. The one gap that needs a sprint
 *    is 5.6 m, and it is signposted, speed-padded and given 12 m of straight runway.
 *
 * 2. MIND THE SURFACE YOU DID NOT MEAN TO OFFER.  The validator graphs EVERY pair
 *    of landable surfaces, not just the ones on your intended line, in BOTH
 *    directions, and it routes through the fewest hops it can find. So platform N to
 *    platform N+2 matters as much as N to N+1, and so does the jump back down off a
 *    ledge you only ever meant people to climb. Two distance bands are forbidden,
 *    because a jump inside them is one a player can *just barely* make and will
 *    therefore fail half the time:
 *        4.36 m .. 5.24 m  (a run jump at full stretch, level ground)
 *        6.18 m .. 7.44 m  (a sprint jump at full stretch, level ground)
 *    Both bands stretch as the landing drops — at -4 m they sit at 5.8-6.9 m and
 *    8.2-9.8 m — which is why a high ledge over a low deck is the single most
 *    common way a stage grows a jump nobody designed. Every pair in this file is
 *    under the safe line, inside the comfortable sprint band, or past the point
 *    where nothing can reach. There are no full-stretch jumps here at all.
 *    Concretely: chain platforms >= 3.0 m wide with >= 2.4 m gaps and the skip-one
 *    lands past 7.8 m on its own.
 *
 * 3. EVERY LINK MUST BE JUMPABLE.  A mover, lift or belt is a RIDE, never the only
 *    connection between two halves of a stage. If the only way across is to stand
 *    on something, a player who mistimes it is stranded and the validator calls the
 *    stage unreachable — correctly. Build the spine out of jumps; let the machines
 *    make the spine faster, prettier or scarier.
 *
 * 4. HAZARDS ARE PURE FUNCTIONS OF THE STAGE CLOCK (CONTRACT §16). `vanish.cycle.phase`
 *    is a FRACTION OF ONE CYCLE (0..1), not seconds — a phase of 0.5 means "half a
 *    period further along". Staggering panels by a constant fraction is what makes a
 *    gauntlet learnable instead of lucky.
 *
 * 5. VARY EVERYTHING, ALWAYS.  Gap length, height delta and platform width change on
 *    almost every object here. Where they do not — BEAT 2 holds height and width
 *    steady so that distance is the only variable — that is stated in the comment,
 *    because an unexplained repeat reads as laziness and five identical hops teach
 *    nothing after the second.
 *
 * 6. EVERY LANDING IS VISIBLE FROM ITS TAKE-OFF. No blind drops, no jumps into
 *    fog, no landing that only exists once you are already committed.
 *
 * CONVENTIONS (full list in runtime/data/index.js):
 *   p = CENTRE, s = FULL size. A top surface is p[1] + s[1]/2 and a platform spans
 *   x from p[0] - s[0]/2 to p[0] + s[0]/2. Every gap quoted below is measured
 *   EDGE TO EDGE and every one of them has been checked by the harness.
 *   rot/yaw are radians; yaw 0 faces +X. Stages run along +X and climb with +Y.
 *   `stripe: true` = "you had to jump to get here". Walk-on floors do not get one.
 *
 * REACH BUDGET USED (safe limits: 4.4 flat / 3.8 at +1.0 m / 5.2 at -2.0 m):
 *   longest flat run-speed gap    3.8 m   (BEAT 5, off the second beam onto the ferry)
 *   longest rise                  0.9 m over 3.1 m   (BEAT 4, the climb)
 *   longest diagonal              3.68 m  (BEAT 3, the zig-zag)
 *   the one sprint gap            5.6 m   (BEAT 7, after 12 m of runway + a speed pad)
 *   riskiest optional line        3.77 m flat        (BEAT 3, the coin shortcut)
 *
 * HEIGHT LADDER: 0.5 (dojo floor) -> 0.9 -> 1.0 -> 1.9 -> 2.8 -> 3.7 (deck & beams)
 *                -> 7.7 (upper roof, by pad) -> 12.5 -> 13.8 -> 15.1 (the ascent).
 */

const NEON = 0x7ef0ff;
const HOT = 0xff4f7a;
const AMBER = 0xffb347;
const DIM = 0x2b6f9e;

export default {
  id: 'neon-1',
  world: 'neon',
  name: 'FIRST LIGHT',
  subtitle: 'Learn to move before the city notices you',
  par: 85000,
  difficulty: 1,

  spawn: { p: [0, 0.6, 0], yaw: 0 },
  killY: -30,

  checkpoints: [
    // On the wide relief pad at the end of the growing gaps, looking at the zig-zag:
    // the first time you have to commit sideways over nothing.
    { p: [36.4, 0.6, 0], yaw: 0, clockOffset: 0 },
    // The dojo deck at the top of the climb, before the belt and the beams.
    { p: [85.0, 3.8, 0], yaw: 0, clockOffset: 0 },
    // The small pad between the two beams. You earned this one by walking.
    { p: [107.2, 3.8, 0], yaw: 0, clockOffset: 0 },
    // Off the ferry, in front of the jump pad.
    { p: [136.0, 3.8, 0], yaw: 0, clockOffset: 0 },
    // The sprint landing. Everything from here on is the stage asking for it back.
    { p: [182.3, 7.8, 0], yaw: 0, clockOffset: 0 },
    // The near edge of the spike garden, clear of every bed by a metre.
    { p: [202.6, 7.8, 0], yaw: 0, clockOffset: 0 },
  ],

  finish: { p: [250.4, 15.2, 0.4], yaw: 0 },

  coins: [
    { p: [54.0, 2.0, 8.4] }, // BEAT 3 — the zig-zag shortcut, out over the void
    { p: [114.8, 4.7, 5.4] }, // BEAT 5 — a side ledge off the second beam
    { p: [144.0, 10.1, 3.0] }, // BEAT 6 — on top of the roof mast
  ],

  objects: [
    /* ============================================================================ */
    /* BEAT 1 — THE DOJO FLOOR                                                      */
    /* A wide deck you cannot fall off, three warm-up blocks, and the signs. You are */
    /* meant to stand here for twenty seconds and work out which way is forward.     */
    /* ============================================================================ */

    { kind: 'platform', p: [2, 0, 0], s: [12, 1, 13], mat: 'stone', glow: DIM },

    // 0.4 m risers. Above stepUp (0.55) by design — the first thing you press SPACE
    // for should cost nothing at all if you get it wrong.
    //
    // They climb BACKWARDS, away from the first gap. Facing forward, the tallest
    // block would sit 1.5 m up and about 5 m short of platform one: a full-stretch
    // run jump that the stage never drew, offered for free to anyone who wandered up
    // there. Turned around, that same accident is a 6.4 m drop — out of run range
    // entirely and a comfortable sprint hop in either direction (HOUSE RULE 2).
    { kind: 'platform', p: [-2.0, 0.85, 4.9], s: [2.4, 0.7, 2.4], mat: 'panel', glow: NEON, stripe: true },
    { kind: 'platform', p: [0.6, 1.05, 4.9], s: [2.2, 1.1, 2.2], mat: 'panel', glow: NEON, stripe: true },
    { kind: 'platform', p: [3.0, 1.25, 4.9], s: [2.0, 1.5, 2.0], mat: 'panel', glow: NEON, stripe: true },

    { kind: 'text', p: [-2.6, 2.6, 0], rot: [0, -Math.PI / 2, 0], text: 'FIRST LIGHT', size: 0.8, color: NEON },
    { kind: 'text', p: [-2.6, 1.95, 0], rot: [0, -Math.PI / 2, 0], text: 'NEON DOJO  ·  I', size: 0.28, color: 0x6f8dac },
    { kind: 'text', p: [3.2, 1.5, -4.4], rot: [0, -Math.PI / 2, 0], text: 'W A S D   to move', size: 0.34, color: 0xcfe6ff },
    { kind: 'text', p: [3.2, 1.0, -4.4], rot: [0, -Math.PI / 2, 0], text: 'SPACE   to jump  ·  hold it for height', size: 0.24, color: 0x6f8dac },
    { kind: 'text', p: [3.0, 3.0, 4.9], rot: [0, -Math.PI / 2, 0], text: 'try these', size: 0.24, color: NEON },

    // A gate over the start line, so the stage has a threshold.
    { kind: 'deco', kindOf: 'arch', p: [8.0, 4.6, 0], s: [1.0, 0.9, 15.0], mat: 'obsidian', tint: NEON },
    { kind: 'deco', kindOf: 'pillar', p: [8.0, 2.6, 6.6], s: [1.1, 5.2, 1.1], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [8.0, 2.6, -6.6], s: [1.1, 5.2, 1.1], mat: 'obsidian' },
    { kind: 'light', p: [8.0, 4.0, 0], color: NEON, intensity: 9, distance: 22 },
    { kind: 'light', p: [1.0, 3.4, 0], color: 0xbcd8f5, intensity: 7, distance: 18 },

    /* ============================================================================ */
    /* BEAT 2 — GAPS THAT GROW                                                      */
    /* 2.2 -> 2.6 -> 2.9 -> 3.2 m, then a wide 2.7 m relief hop down onto the        */
    /* checkpoint. Height and width barely move (see HOUSE RULE 5): distance is the  */
    /* only variable, because the only question this beat asks is "how far does one  */
    /* jump go". The hardest hop spends 73% of the 4.4 m safe budget.                */
    /* Widths stay >= 3.0 m so that platform N to platform N+2 is always past 7.8 m  */
    /* — out of reach, rather than a barely-possible skip (HOUSE RULE 2).            */
    /* ============================================================================ */

    { kind: 'platform', p: [11.7, 0, 0], s: [3.0, 1, 4.6], mat: 'panel', glow: NEON, stripe: true }, // gap 2.2
    { kind: 'platform', p: [17.4, 0, 0.7], s: [3.2, 1, 4.4], mat: 'panel', glow: NEON, stripe: true }, // gap 2.6
    { kind: 'platform', p: [23.6, 0.4, 0], s: [3.4, 1, 4.2], mat: 'panel', glow: NEON, stripe: true }, // gap 2.9, +0.4
    { kind: 'platform', p: [30.0, 0.4, -0.9], s: [3.0, 1, 4.0], mat: 'panel', glow: NEON, stripe: true }, // gap 3.2
    { kind: 'platform', p: [36.4, 0, 0], s: [4.4, 1, 5.2], mat: 'panel', glow: NEON, stripe: true }, // gap 2.7, -0.4

    { kind: 'text', p: [9.8, 2.3, 3.4], rot: [0, -Math.PI / 2, 0], text: 'they get further apart', size: 0.26, color: 0x6f8dac },
    { kind: 'deco', kindOf: 'lantern', p: [14.0, 3.6, 5.4], s: [0.7, 1.0, 0.7], mat: 'emissive', tint: HOT },
    { kind: 'deco', kindOf: 'lantern', p: [26.0, 3.9, -5.6], s: [0.7, 1.0, 0.7], mat: 'emissive', tint: HOT },
    { kind: 'deco', kindOf: 'cable', p: [23.0, 4.6, 0], s: [28.0, 0.06, 0.06], mat: 'metal', tint: 0x1c3550 },
    { kind: 'light', p: [23.0, 3.2, 0], color: NEON, intensity: 6, distance: 26 },

    /* ============================================================================ */
    /* BEAT 3 — SIDEWAYS                                                            */
    /* Four pads alternating +/-2.8 m on Z, 5.6 m apart in X. Straight-line jumping  */
    /* stops working; you have to aim. Each diagonal is 3.68 m edge to edge (85% of  */
    /* the flat budget) and the last two climb half a metre, so the beat is not four */
    /* copies of one jump. Same-side pads sit 8.2 m apart: out of reach in both      */
    /* directions, deliberately — at 7.8 m the jump back would have been possible.   */
    /*                                                                              */
    /* THE FIRST COIN is a real shortcut and a real risk: leave the zig-zag at pad 3,*/
    /* take two 3.0 / 3.77 m hops out over the void, and rejoin at the foot of the   */
    /* climb. Play it safe and you lose nothing but the coin.                       */
    /* ============================================================================ */

    { kind: 'platform', p: [42.4, 0, 2.8], s: [3, 1, 3], mat: 'panel', glow: NEON, stripe: true }, // gap 2.3
    { kind: 'platform', p: [48.0, 0, -2.8], s: [3, 1, 3], mat: 'panel', glow: NEON, stripe: true }, // diagonal 3.68
    { kind: 'platform', p: [53.6, 0.5, 2.8], s: [3, 1, 3], mat: 'panel', glow: NEON, stripe: true }, // diagonal 3.68, +0.5
    { kind: 'platform', p: [59.2, 0.5, -2.8], s: [3, 1, 3], mat: 'panel', glow: NEON, stripe: true }, // diagonal 3.68

    // -- the optional line -------------------------------------------------------
    { kind: 'platform', p: [54.0, 0.5, 8.4], s: [2.2, 1, 2.2], mat: 'panel', glow: HOT, stripe: true }, // 3.0 m lateral off pad 3
    { kind: 'platform', p: [60.0, 0.5, 5.4], s: [2.4, 1, 2.4], mat: 'panel', glow: HOT, stripe: true }, // 3.77 m, then 3.22 back in
    { kind: 'deco', kindOf: 'ring', p: [54.0, 2.0, 8.4], s: [0.12, 2.4, 2.4], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: HOT },
    { kind: 'light', p: [57.0, 2.4, 7.0], color: HOT, intensity: 7, distance: 14 },

    { kind: 'deco', kindOf: 'antenna', p: [46.0, 6.0, -9.4], s: [0.5, 12.0, 0.5], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'screen', p: [42.0, 5.4, -8.6], s: [0.3, 4.4, 7.0], mat: 'emissive', tint: 0x2f6ea8 },

    /* ============================================================================ */
    /* BEAT 4 — UP                                                                  */
    /* Three +0.9 m step-ups over 3.1 / 2.9 / 3.1 m gaps. The safe budget for a      */
    /* +1.0 m rise is 3.8 m, so this is 82% of it — enough that you feel the climb,  */
    /* not enough that a mistimed jump is the stage's fault. Ends on the dojo deck,  */
    /* which is 7 m of nothing to worry about: a breather before three new verbs.    */
    /*                                                                              */
    /* The spacing here is also set by the way back down. From the top of the climb  */
    /* the previous step is nearly two metres below, and a 1.8 m drop stretches the  */
    /* sprint envelope to 8.7 m — so the steps are spaced past 9 m apart end to end, */
    /* not the 8 m that a level chain would need.                                    */
    /* ============================================================================ */

    { kind: 'platform', p: [65.4, 1.4, 0], s: [3.2, 1, 4.6], mat: 'panel', glow: NEON, stripe: true }, // gap 3.1, top 1.9
    { kind: 'platform', p: [71.4, 2.3, 0], s: [3.0, 1, 4.4], mat: 'panel', glow: NEON, stripe: true }, // gap 2.9, top 2.8
    { kind: 'platform', p: [77.7, 3.2, 0], s: [3.4, 1, 4.4], mat: 'panel', glow: NEON, stripe: true }, // gap 3.1, top 3.7
    { kind: 'platform', p: [85.0, 3.2, 0], s: [7.0, 1, 6.4], mat: 'stone', glow: DIM, stripe: true }, // gap 2.1, the deck

    { kind: 'deco', kindOf: 'pillar', p: [85.0, 6.1, 4.4], s: [0.9, 4.8, 0.9], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [85.0, 6.1, -4.4], s: [0.9, 4.8, 0.9], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'banner', p: [85.0, 6.9, 4.4], s: [0.1, 2.6, 1.6], mat: 'panel', tint: NEON },
    { kind: 'deco', kindOf: 'banner', p: [85.0, 6.9, -4.4], s: [0.1, 2.6, 1.6], mat: 'panel', tint: NEON },
    { kind: 'light', p: [85.0, 6.6, 0], color: NEON, intensity: 10, distance: 20 },

    /* ============================================================================ */
    /* BEAT 5 — THE BELT AND THE BEAMS                                              */
    /* HAZARD 1 (teaching): a conveyor, flush with the deck, running at 4 m/s — less */
    /* than half of TUNE.conveyorMax and slower than a sprint, so it nudges rather   */
    /* than shoves. It is a floor that moves, introduced while there is nothing else */
    /* to think about, and it feeds you into the beam at the right speed.            */
    /*                                                                              */
    /* Then no gap at all for seven metres — just 1.0 m of width. A different kind   */
    /* of problem, solved by walking, and the first time the stage asks you to slow  */
    /* down. A 2.6 m hop to a small pad (the checkpoint), then a second beam.        */
    /*                                                                              */
    /* COIN 2 hangs off the second beam: a 3.7 m lateral jump from a surface you are */
    /* already balancing on, and the same jump back.                                */
    /* ============================================================================ */

    { kind: 'conveyor', p: [91.5, 3.2, 0], s: [6.0, 1, 4.2], dir: [1, 0, 0], power: 4, mat: 'conveyor' },
    { kind: 'text', p: [88.2, 5.4, 0], rot: [0, -Math.PI / 2, 0], text: 'the floor helps', size: 0.28, color: AMBER },

    { kind: 'beam', p: [99.8, 3.4, 0], s: [7.0, 0.6, 1.0], mat: 'metal' }, // 1.8 m off the belt
    { kind: 'platform', p: [107.2, 3.2, 0], s: [2.6, 1, 3.0], mat: 'panel', glow: NEON, stripe: true }, // gap 2.6
    { kind: 'beam', p: [114.2, 3.4, 0], s: [6.0, 0.6, 1.0], mat: 'metal' }, // gap 2.7

    { kind: 'platform', p: [114.8, 3.2, 5.4], s: [2.4, 1, 2.4], mat: 'panel', glow: HOT, stripe: true }, // 3.7 m off the beam
    { kind: 'deco', kindOf: 'ring', p: [114.8, 4.7, 5.4], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: HOT },
    { kind: 'light', p: [114.8, 4.9, 5.4], color: HOT, intensity: 6, distance: 13 },

    { kind: 'text', p: [97.6, 4.9, 0], rot: [0, -Math.PI / 2, 0], text: 'narrow  ·  walk it', size: 0.28, color: 0x6f8dac },
    { kind: 'deco', kindOf: 'rail', p: [102.0, 5.4, 3.2], s: [22.0, 0.07, 0.07], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'rail', p: [102.0, 5.4, -3.2], s: [22.0, 0.07, 0.07], mat: 'metal', tint: DIM },
    { kind: 'deco', kindOf: 'lantern', p: [97.0, 4.9, -3.2], s: [0.6, 0.9, 0.6], mat: 'emissive', tint: HOT },
    { kind: 'deco', kindOf: 'lantern', p: [112.0, 4.9, -3.2], s: [0.6, 0.9, 0.6], mat: 'emissive', tint: HOT },

    /* ============================================================================ */
    /* BEAT 5b — THE FERRY                                                          */
    /* HAZARD 2 (teaching): the gentlest mover in the game. Straight down the stage  */
    /* axis, a 9 s round trip, 1.4 s of dwell at each end, and it comes back if you  */
    /* miss it. Board at 3.8 m from the beam, ride 7 m, step off at 1.5 m.           */
    /*                                                                              */
    /* The pier at z = -6.4 is not a shortcut — it is somewhere to STAND while the   */
    /* ferry comes back for you, which is the whole lesson. Both ends of the ferry's */
    /* travel are within a jump of it, and the far landing is a jump from the ferry, */
    /* so no player is ever stranded (HOUSE RULE 3).                                */
    /* ============================================================================ */

    {
      kind: 'mover',
      p: [123.0, 3.2, 0],
      s: [4.0, 1, 4.4],
      mat: 'metal',
      motion: { type: 'linear', to: [130.0, 3.2, 0], period: 9.0, phase: 0, ease: 'sine', dwell: 1.4 },
    },
    { kind: 'platform', p: [126.6, 3.2, -6.4], s: [2.8, 1, 2.8], mat: 'panel', glow: AMBER, stripe: true }, // the pier
    { kind: 'platform', p: [136.0, 3.2, 0], s: [5.0, 1, 6.0], mat: 'stone', glow: DIM, stripe: true }, // 1.5 m off the ferry

    { kind: 'text', p: [119.0, 5.6, 0], rot: [0, -Math.PI / 2, 0], text: 'RIDE IT', size: 0.5, color: NEON },
    { kind: 'text', p: [119.0, 5.05, 0], rot: [0, -Math.PI / 2, 0], text: 'it comes back  ·  wait on the pier', size: 0.24, color: 0x6f8dac },
    { kind: 'deco', kindOf: 'rail', p: [125.6, 5.6, 6.4], s: [24, 0.08, 0.08], mat: 'metal', tint: DIM },
    { kind: 'light', p: [125.6, 5.8, 0], color: NEON, intensity: 7, distance: 22 },

    /* ============================================================================ */
    /* BEAT 6 — THE JUMP PAD  (the stage's first "whoa")                            */
    /* power = APEX METRES above the pad, so 5.4 puts your head at y 9.2 from a pad  */
    /* at 3.84. With gravRise 38 / gravFall 54 that is 0.533 s up and 0.239 s down   */
    /* to the roof at 7.7 — 0.772 s of flight and up to 9.4 m of travel at sprint.   */
    /* The roof's lip is 4.0 m away and the roof is 9 m deep: you cannot really miss.*/
    /* There is no jump from the ferry landing to the roof. The pad IS the route,    */
    /* which is exactly why the pad is a platform-sized slab you cannot walk past.   */
    /*                                                                              */
    /* COIN 3 sits on the mast: a 1.2 m hop up from the roof, or a direct pad launch */
    /* if you aim. The mast stands INSIDE the roof's footprint rather than out over  */
    /* the drop, which is not a decorative choice — a 1.2 m ledge hung off the roof's */
    /* north edge is 4 m above the ferry landing and 5-9 m away from it, and every    */
    /* placement out there lands one of those distances in a forbidden band.          */
    /* ============================================================================ */

    { kind: 'jumppad', p: [137.0, 3.77, 0], s: [2.8, 0.14, 2.8], power: 5.4, dir: [0, 1, 0] },
    { kind: 'text', p: [134.6, 5.4, 0], rot: [0, -Math.PI / 2, 0], text: 'STAND ON IT', size: 0.32, color: NEON },

    { kind: 'platform', p: [146.9, 7.2, 0], s: [9, 1, 10], mat: 'stone', glow: DIM, stripe: true }, // the upper roof, top 7.7
    { kind: 'platform', p: [144.0, 8.4, 3.0], s: [2.0, 1, 2.0], mat: 'obsidian', glow: HOT, stripe: true }, // the mast base, top 8.9

    { kind: 'deco', kindOf: 'antenna', p: [144.0, 12.4, 3.0], s: [0.4, 7.0, 0.4], mat: 'metal', tint: NEON },
    { kind: 'deco', kindOf: 'ring', p: [144.0, 10.1, 3.0], s: [0.12, 2.2, 2.2], rot: [0, Math.PI / 2, 0], mat: 'emissive', tint: HOT },
    { kind: 'light', p: [144.0, 10.6, 3.0], color: HOT, intensity: 7, distance: 15 },

    { kind: 'deco', kindOf: 'vent', p: [148.0, 8.4, -3.6], s: [1.8, 1.4, 1.8], mat: 'metal' },
    { kind: 'deco', kindOf: 'vent', p: [151.0, 8.2, -4.0], s: [1.4, 1.0, 1.4], mat: 'metal' },
    { kind: 'light', p: [146.9, 10.7, 0], color: NEON, intensity: 11, distance: 24 },

    /* ============================================================================ */
    /* BEAT 7 — SPRINT SCHOOL                                                       */
    /* One hurdle to prove sprinting and jumping combine, then 12.1 m of clear,      */
    /* straight, flat runway, a speed pad at the lip for anyone who refuses to read  */
    /* the sign, and a 5.6 m gap onto a 7.4 m landing.                               */
    /*                                                                              */
    /* This is the only jump on the stage outside the run-speed budget, and it is    */
    /* deliberately well outside it rather than just barely outside it: 5.6 m is 75% */
    /* of the sprint envelope but 107% of what a run-speed jump can reach, so there  */
    /* is no version of this where a walking player *nearly* makes it. A gap you can */
    /* fluke at full stretch teaches nothing; a gap that simply requires the button  */
    /* teaches sprinting in one attempt. (HOUSE RULE 2, the forbidden bands.)        */
    /*                                                                              */
    /* The hurdle sits 6 m into the runway, not at its mouth: a 0.7 m obstacle is a  */
    /* raised surface like any other, and up against the roof it would have offered  */
    /* a 7.9 m sprint-and-pray back the way you came.                                */
    /* ============================================================================ */

    { kind: 'platform', p: [164.0, 7.2, 0], s: [18, 1, 6], mat: 'stone', glow: DIM, stripe: true }, // gap 3.6, the runway
    { kind: 'beam', p: [160.4, 8.05, 0], s: [0.9, 0.7, 4.6], mat: 'metal' }, // the hurdle, 0.7 up

    { kind: 'text', p: [156.0, 10.0, 0], rot: [0, -Math.PI / 2, 0], text: 'HOLD  SHIFT', size: 0.56, color: NEON },
    { kind: 'text', p: [156.0, 9.3, 0], rot: [0, -Math.PI / 2, 0], text: 'you will not make the next one walking', size: 0.24, color: 0x6f8dac },

    { kind: 'speedpad', p: [171.4, 7.77, 0], s: [3.2, 0.14, 4.4], dir: [1, 0, 0], power: 13 },

    { kind: 'deco', kindOf: 'rail', p: [164.0, 10.1, 3.4], s: [18.0, 0.07, 0.07], mat: 'metal', tint: NEON },
    { kind: 'deco', kindOf: 'rail', p: [164.0, 10.1, -3.4], s: [18.0, 0.07, 0.07], mat: 'metal', tint: NEON },
    { kind: 'deco', kindOf: 'sign', p: [174.0, 10.1, -4.6], s: [0.25, 2.0, 4.0], mat: 'emissive', tint: HOT },

    { kind: 'platform', p: [182.3, 7.2, 0], s: [7.4, 1, 7.4], mat: 'stone', glow: DIM, stripe: true }, // gap 5.6, top 7.7
    { kind: 'light', p: [182.3, 10.1, 0], color: NEON, intensity: 9, distance: 20 },

    /* ============================================================================ */
    /* BEAT 8 — THE PANELS AND THE SPIKE GARDEN                                     */
    /* HAZARDS 3 & 4 (teaching): two vanish panels, both 4+ m across, on a 4.2 s     */
    /* solid / 1.4 s warning / 1.2 s gone cycle. Nearly six seconds of standing room */
    /* per cycle and a warning window longer than the jump itself. `phase` is a      */
    /* FRACTION of the 6.8 s cycle (HOUSE RULE 4): the second panel sits at 0.78,    */
    /* i.e. 5.3 s in, so it turns solid again at t = 1.5 s — right as you land on    */
    /* the first one.                                                                */
    /*                                                                              */
    /* And the panels cannot really kill you here: a catch ledge sits 1.3 m below    */
    /* and to the south, within a jump of the first panel and of the sprint landing, */
    /* so the punishment for reading the warning wrong is climbing back out.         */
    /*                                                                              */
    /* Then the stage's only sharp edges, and they are stationary. Four beds         */
    /* alternating +/-2.0 m on Z leave a 2 m corridor past each one — walkable at a  */
    /* jog, no jump required in the whole beat. This is where hot-and-saturated gets */
    /* taught as "do not touch".                                                     */
    /* ============================================================================ */

    { kind: 'vanish', p: [190.7, 7.2, 0], s: [4.4, 1, 5.0], mat: 'panel', cycle: { on: 4.2, off: 1.2, warn: 1.4, phase: 0.0 } }, // gap 2.5
    { kind: 'vanish', p: [197.9, 7.2, 0.8], s: [4.0, 1, 4.6], mat: 'panel', cycle: { on: 4.2, off: 1.2, warn: 1.4, phase: 0.78 } }, // gap 3.0
    { kind: 'platform', p: [188.0, 5.9, -6.0], s: [3.2, 1, 3.2], mat: 'panel', glow: AMBER, stripe: true }, // the catch ledge, 1.3 m down

    { kind: 'text', p: [185.6, 9.4, 0], rot: [0, -Math.PI / 2, 0], text: 'THEY COME BACK', size: 0.44, color: AMBER },
    { kind: 'text', p: [185.6, 8.9, 0], rot: [0, -Math.PI / 2, 0], text: 'watch one cycle before you step', size: 0.22, color: 0x6f8dac },

    { kind: 'platform', p: [206.2, 7.2, 0], s: [9, 1, 7], mat: 'stone', glow: DIM, stripe: true }, // gap 1.8, the garden

    { kind: 'spikes', p: [203.2, 8.0, -2.0], s: [1.8, 0.6, 2.0], dir: [0, 1, 0] },
    { kind: 'spikes', p: [205.2, 8.0, 2.0], s: [1.8, 0.6, 2.0], dir: [0, 1, 0] },
    { kind: 'spikes', p: [207.2, 8.0, -2.0], s: [1.8, 0.6, 2.0], dir: [0, 1, 0] },
    { kind: 'spikes', p: [209.0, 8.0, 2.0], s: [1.8, 0.6, 2.0], dir: [0, 1, 0] },

    { kind: 'text', p: [201.2, 9.7, 0], rot: [0, -Math.PI / 2, 0], text: 'WEAVE', size: 0.44, color: HOT },
    { kind: 'light', p: [206.2, 8.9, 0], color: HOT, intensity: 8, distance: 16, flicker: 0.12 },
    { kind: 'deco', kindOf: 'lantern', p: [194.0, 9.4, -6.2], s: [0.7, 1.0, 0.7], mat: 'emissive', tint: AMBER },

    /* ============================================================================ */
    /* BEAT 9 — SET-PIECE : THE ASCENT                                              */
    /* HAZARD 5 (teaching): a 6 m wide floor that sinks. sinkDepth is the engine     */
    /* minimum of 1.5 m and it takes 0.9 s to decide plus 1.25 s to fall, so dawdling*/
    /* costs you a climb rather than a life: from the sunken pose both the garden    */
    /* behind (3.0 m at +1.5) and the launch deck ahead (3.0 m at +1.5) are still    */
    /* inside the envelope. A tutorial teaches "keep moving" by making it cost time. */
    /*                                                                              */
    /* Then a 6.0 m pad throws you 4.66 m up and 4.5 m out onto the first of three  */
    /* tiers that spiral up and away from the city. Each tier is +1.3 m over a 2.7 / */
    /* 2.25 m gap — well inside the 3.59 m budget for that rise, and small enough    */
    /* that you have to aim while looking up. Everything the stage taught, in twenty */
    /* seconds, ending above the skyline.                                            */
    /*                                                                              */
    /* Tier one sits 11.5 m past the sinking floor rather than the 10.6 m the layout */
    /* wanted: from 4.8 m up, the sprint envelope reaches 10.85 m, and a tier at     */
    /* 10.6 m would have quietly offered a suicide dive back onto the sinker.        */
    /* ============================================================================ */

    {
      kind: 'mover',
      p: [216.7, 7.2, 0],
      s: [6.0, 1, 5.6],
      mat: 'metal',
      // `to` is the sunken pose. The runtime drives a sink from sinkDepth; `to` is
      // what tells the reach validator where this surface can end up, so the two
      // must agree — 7.2 - 1.5 = 5.7.
      motion: { type: 'sink', to: [216.7, 5.7, 0], period: 6.0, sinkDepth: 1.5, sinkDelay: 0.9, sinkSpeed: 1.2, respawnAfter: 2.8 },
    },
    { kind: 'text', p: [213.0, 9.4, 0], rot: [0, -Math.PI / 2, 0], text: 'DO NOT LINGER', size: 0.38, color: AMBER },

    { kind: 'platform', p: [225.2, 7.2, 0], s: [5.0, 1, 6.4], mat: 'stone', glow: DIM, stripe: true }, // gap 3.0
    { kind: 'jumppad', p: [225.2, 7.77, 0], s: [3.0, 0.14, 3.0], power: 6.0, dir: [0, 1, 0] },
    { kind: 'text', p: [223.0, 10.1, 0], rot: [0, -Math.PI / 2, 0], text: 'UP', size: 0.7, color: NEON },

    { kind: 'platform', p: [234.2, 12.0, 0], s: [6, 1, 7], mat: 'panel', glow: NEON, stripe: true }, // top 12.5
    { kind: 'platform', p: [242.4, 13.3, 3.4], s: [5, 1, 5], mat: 'panel', glow: NEON, stripe: true }, // gap 2.7, top 13.8
    { kind: 'platform', p: [250.4, 14.6, 0.4], s: [6.5, 1, 7], mat: 'obsidian', glow: NEON, stripe: true }, // gap 2.25, top 15.1

    // The finish gate, built so it frames the last jump.
    { kind: 'deco', kindOf: 'arch', p: [250.4, 19.7, 0.4], s: [1.2, 1.0, 8.4], mat: 'obsidian', tint: NEON },
    { kind: 'deco', kindOf: 'pillar', p: [250.4, 17.4, 4.0], s: [1.1, 5.6, 1.1], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [250.4, 17.4, -3.2], s: [1.1, 5.6, 1.1], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'beacon', p: [253.7, 16.7, 0.4], s: [0.6, 2.6, 0.6], mat: 'emissive', tint: NEON },
    { kind: 'light', p: [250.4, 18.1, 0.4], color: NEON, intensity: 18, distance: 30 },
    { kind: 'light', p: [234.2, 14.9, 0], color: NEON, intensity: 8, distance: 20 },
    { kind: 'text', p: [247.8, 16.5, 0.4], rot: [0, -Math.PI / 2, 0], text: 'FIRST LIGHT', size: 0.4, color: NEON },

    /* ============================================================================ */
    /* THE CITY — everything below and beside the course.                           */
    /* All of it is at |z| >= 12 or below y = -4, i.e. nowhere a player could ever   */
    /* read it as a landing, and none of it is a landable kind. Towers climb as the  */
    /* stage climbs so the horizon keeps pace with you.                             */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'monolith', p: [34, -12, 27], s: [9, 34, 9], count: 7, spread: [110, 26, 22], seed: 118, tint: 0x142a44 },
    { kind: 'deco', kindOf: 'monolith', p: [34, -14, -27], s: [9, 34, 9], count: 7, spread: [110, 26, 22], seed: 227, tint: 0x142a44 },
    { kind: 'deco', kindOf: 'monolith', p: [186, -6, 31], s: [11, 42, 11], count: 6, spread: [120, 30, 24], seed: 331, tint: 0x16304e },
    { kind: 'deco', kindOf: 'monolith', p: [186, -8, -31], s: [11, 42, 11], count: 6, spread: [120, 30, 24], seed: 404, tint: 0x16304e },
    { kind: 'deco', kindOf: 'screen', p: [68, 9, 18], s: [0.4, 8, 12], mat: 'emissive', tint: 0x2f6ea8 },
    { kind: 'deco', kindOf: 'screen', p: [172, 13, -19], s: [0.4, 9, 14], mat: 'emissive', tint: 0x8a3fa8 },
    { kind: 'deco', kindOf: 'cable', p: [124, 16, 13], s: [170, 0.08, 0.08], mat: 'metal', tint: 0x0e1e33 },
    { kind: 'deco', kindOf: 'cable', p: [124, 19, -14], s: [170, 0.08, 0.08], mat: 'metal', tint: 0x0e1e33 },
    { kind: 'deco', kindOf: 'cloud', p: [126, -22, 0], s: [20, 3, 20], count: 12, spread: [290, 10, 90], seed: 909, scale: 1.8, tint: 0x1b3c5e },

    // Rim lights strung down the length of the course so the path reads from far away.
    { kind: 'light', p: [48, 5.0, 0], color: NEON, intensity: 6, distance: 24 },
    { kind: 'light', p: [71, 6.9, 0], color: NEON, intensity: 6, distance: 22 },
    { kind: 'light', p: [107, 7.1, 0], color: NEON, intensity: 7, distance: 20 },
    { kind: 'light', p: [198, 10.4, 0], color: AMBER, intensity: 7, distance: 22 },
    { kind: 'light', p: [225, 10.9, 0], color: NEON, intensity: 8, distance: 22 },
  ],
};
