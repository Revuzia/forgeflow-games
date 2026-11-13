/**
 * ASCENDANT — PRISM CROWN 2 : "THE SPLIT"
 * runtime/data/stages/rainbow-2.js
 *
 * White light enters a prism and the stage is the split: seven band terraces,
 * red to violet, each pairing ONE new light trap with ONE legacy family —
 * "your old alphabet, spoken in colour" (brief §7 rainbow-2, verbatim). Every
 * terrace entry is a staging deck with a GOLD sign naming the pairing.
 *
 * SHAPE      Measured by `node _harness/reachcheck.mjs rainbow-2`, not estimated
 *            (re-measured after the 2026-09-15 difficulty pass, below):
 *            347.9 m of travel, 80 gameplay objects, 60 landable surfaces
 *            (mover poses included), 3 orphans (the three crusher caps — a
 *            ceiling press's cap is unreachable BECAUSE it is a ceiling press;
 *            temple-3 precedent), 10 checkpoints (cp0..cp9), 3 coins, 41
 *            authored dynamic hazards across 11 families (the harness counts
 *            39 — its HAZARD_KINDS set does not know `sticky`, same class of
 *            under-read temple-3 documented for lasergrid):
 *
 *              bloom 11 · prismgate 5 · pendulum 3 · crusher 3 · conveyor 3 ·
 *              ice 5 · wind 3 · vanish 3 · sticky 2 · speedpad 2 · mover 1
 *
 *            DIFFICULTY PASS 2026-09-15 (owner: "TOO many platforms... TOO easy
 *            to get from one place to another"): six stepping stones DELETED
 *            (ORANGE entry apron, one vanish twin, the INDIGO rest deck, the
 *            Moire entry step, the bridge mid step, riser B), every oversized
 *            deck shrunk, the route pulled apart into 2.5-6.3 m jumps.
 *            Measured against temple-3's bar (gapstats oracle): gap p50 3.20 /
 *            p75 4.00 (temple-3: 2.90/3.31), trivial<2.5 17% (bar <=40%),
 *            >=4.4 share 19% (bar 12-22%), deckArea p50 15.6 / p75 34.7
 *            (bar <=16/<=35), 14.3 surfaces/100m (bar <=15). No prismgate,
 *            bloom, or hazard param was touched; no checkpoint or coin moved.
 *
 *            MIX-TABLE vs MOVEMENT-TEXT CALLS (rainbow-1 set the precedent: the
 *            movements win, the header documents the call):
 *            - prismgate 5, not 7: the movement text mandates exactly ORANGE's
 *              belt gate, YELLOW's tightening pair, BLUE's slots:'y' gate and
 *              the Double Rainbow apex gate. No other movement names a gate.
 *            - "a 7-stop gate with dwell tightening 2.0 -> 1.6 s" cannot be ONE
 *              def: the validator pins period == seq.length*(dwell+travel), one
 *              dwell per gate. It ships as TWO 7-stop gates in consecutive
 *              courts, dwell 2.0 then 1.6 — the tightening is real and legible.
 *            - Both 7-stop gates run the PALINDROMIC seq 0..6..1 (aperture
 *              speed law: a straight 0..6 wrap is a 10.4 m hop; palindromic
 *              stops keep every slide to one slot pitch, 3.67 / 3.47 m/s).
 *            - pendulum 3, not 4: "three cross-route pendulums" (INDIGO text).
 *            - bloom 11 (9 low / 2 high), not 8 (5/3): RED 2 + GREEN 3 +
 *              INDIGO 2 + Moire 2 + Double Rainbow 2. The third table HIGH has
 *              no movement-text home; GREEN + INDIGO each carry one.
 *            - 347.8 m vs "340 m": VIOLET's brief span (285-340) ends at the
 *              apex gate plane, x 337.4 — brief-true; the east bridge deck and
 *              finish court overrun the way rainbow-1's finish overran 300.
 *
 *            Seven terraces (brief §7):
 *
 *   RED     x   0 -  45   fast LOW blooms (6.0 m/s) + crushers, ONE 4.8 s clock
 *   ORANGE  x  45 -  95   foundry quote — belt power 4.5 INTO a gate's dwell
 *   YELLOW  x  95 - 140   speedpads + the 7-stop pair, dwell 2.0 -> 1.6
 *   GREEN   x 140 - 185   blooms with authored gap sectors + tar; first LOW+HIGH
 *   BLUE    x 185 - 235   spire quote — ice arc in crosswind; slots:'y' updraft
 *   INDIGO  x 235 - 285   one LOW + one HIGH bloom bracketing three pendulums
 *   VIOLET  x 285 - 340   THE MOIRE POCKET, then THE DOUBLE RAINBOW set piece
 *
 * CHECKPOINT CLOCKS: brief table verbatim — x 0/32/62/95/126/158/190/224/256/288,
 *   clockOffset 0/8/17/27/38/50/63/77/92/108, strictly rising (law 4): every
 *   respawn is a rerun of the same light show. Every checkpoint is PRE-spike,
 *   >= 1.7 m outside every bloom's rmax circle and >= 5 m from every gate plane
 *   (rainbow-1's hand-check standard; the tight ones are quoted at the cp).
 *
 * PRISM GATE LAW (§4, quoted so the numbers read as decisions): period ==
 *   seq.length*(dwell+travel) to 1e-6; window >= 1.6 x 2.2; worst cyclic slot
 *   pitch / travel <= 6.4 m/s; s[0] <= 0.5. Sill = deck top (p.y = top + s[1]/2).
 *   Every gate has an all-phase-safe staging deck before its plane. (The flank
 *   walk-around ledges that shipped with the first cut were REMOVED on the
 *   owner's call 2026-09-16 — the gates are mandatory; staging stays.) Old text:
 *   ...plus a flank
 *   ledge OUTSIDE its lattice span.
 *
 * COLOUR BLOOM LAW (§5): band = hue = speed (SPEED_BY_BAND: red/orange 6.0,
 *   yellow/green 4.2, blue+ 3.0 m/s). This stage introduces the 6.0 m/s class
 *   (RED, sign-named) and the first LOW+HIGH mixes (GREEN, INDIGO). Band-0
 *   emitters carry rmax >= 4.44 so ring life stays >= 0.74 s (the jump law).
 *   Emitter decks >= 2.4 m wide. Garden-style courts contain their rmax circle
 *   to ~0.3 m (RED/GREEN/INDIGO); the Moire corridor and Double Rainbow are
 *   set-piece exceptions BY DESIGN — their circles overhang void gaps (never a
 *   jump landing at ring height), and the corridor's rear reach is cleared
 *   against cp9 by distance, quoted below.
 *
 * SHARED CLOCKS (§6), per court — all superperiods <= 16 s:
 *   RED crusher-bloom clock 4.8 s flat (2 blooms + 3 crushers, one metronome);
 *   ORANGE gate court 12 s; YELLOW-A 30 s alone / YELLOW-B 25.2 s alone
 *   (consecutive but SEPARATE courts, each with its own staging deck — tagging
 *   them one court would be a 126 s compound rhythm, which is the thing §6-1
 *   exists to forbid); GREEN 6 s both courts; BLUE arc vanish 3.1 s, updraft
 *   gate 9 s; INDIGO 6 s (blooms 6, pendulums 3); Moire 9 s; Double Rainbow
 *   12 s (blooms 6 + gate 12 — brief-exact superperiod). No relay groups here:
 *   relays are rainbow-1 V and rainbow-3 V; the YELLOW pair is a tightening
 *   LESSON, not a handoff, so it carries no relay tag on purpose.
 *
 * VALIDATOR PROOF (run this session, not assumed): all 16 prismgate/bloom defs
 *   pass hazards/index.js REQUIRED + SEMANTIC; validateSharedClockLaws returns
 *   ok:true for every court above (proof script mirrors rainbow-1's lane).
 *   axecheck: all three INDIGO blades PASSABLE, alwaysLethal 0/140 cells, on
 *   the 13.0 m gallery deck — the staging map is the deck itself (all-phase-
 *   safe entry court B24 west of the first blade) plus the north bailout rail.
 *
 * RHYTHM — measured, not intended (`node _harness/geomcheck.mjs rainbow-2`,
 *   re-run this session): 49 distinct platform footprints, gap coefficient of
 *   variation 0.67, never two identical obstacles in a row (maxRepeat 1),
 *   longest run without a height change over 0.75 m = 29.9 m. The sunken RED
 *   disc, the raised ORANGE gate landing (+0.8) and the SUNKEN GREEN exit
 *   step are the authored resets that keep it under the 40 m warning line.
 *   One warning, intended and quoted with total fidelity: the cp1->cp2
 *   sight-line arc grazes crusher C3 for 12% (a timed gate — that is what a
 *   crusher is). The old roof-deleted catwalk warning is gone: the riser
 *   route was rebuilt as two committed jumps (see COIN 3).
 *
 * REACH BUDGET (CONTRACT §0 safe limits; retuned 2026-09-15): route jumps sit
 *   2.5-6.3 m. The marquee asks: 6.3 m pad-carried (YELLOW dip — a bare
 *   sprint at 7.44 m still clears it, nothing is walled), 6.1 m onto the
 *   ORANGE hop-lane vanish tile (optional line), 5.6 m off the last glaze
 *   into N1's court, 5.28 m spur -> corridor (the Moire entry), and 5.1 m at
 *   +1.7 D1 -> apex — reachcheck calls it sprint-tight, the ONE deliberate
 *   sprint ask in the stage; every other required line stays run-reachable.
 *   The corridor exit's -2.5 drop is now a 2.7 m jump-drop (temple-3 spends
 *   the same -2.5). The BLUE middle-window crossing keeps the house 3.4 m at
 *   +0.9 verbatim.
 *
 * HEIGHT LADDER: 1.0 (threshold) -> 0.2 (bloom disc, sunken) -> 1.2 (crusher
 *   bed) -> 1.9 (R2 court) -> 2.4 (belts) -> 3.2 (gate landing) -> 2.2 (pad
 *   dip) -> 3.4 (gate-A court) -> 4.2 (gate-B court) -> 2.6 (GREEN field) ->
 *   2.55 (sunken exit) -> 3.4..5.6 (ice arc) -> 8.8 (gallery) -> 9.7 (window
 *   landing) -> 9.2..9.6 (INDIGO) -> 9.4 (corridor) -> 6.9 (bridge west) ->
 *   8.6 (apex, one 5.1 m leap) -> 7.8 (out).
 *
 * GLARE (law 5, §3 budget): walking surfaces OPAL-class stone with DARK
 *   structural glows; band hue ONLY on hazard-module filaments/rings and deco
 *   strips <= 0.3 m (metronome notches 0.14 m). HOT reserved for lethal reads.
 *   Three metronome towers (ORANGE, YELLOW, DOUBLE RAINBOW courts) are static
 *   notched spectrum ladders + pip legends — court furniture per §4 channel 6.
 *
 * MOIRE POCKET GEOMETRY (why these numbers): corridor deck x 294..318 (24 m,
 *   brief-exact), emitters MA x 298 / MB x 316, rmax 9.5, period 9 s, ONE
 *   clock, half a phase apart. Coverage 288.5..307.5 U 306.5..325.5 — the
 *   corridor has no dead lane. A-rings chase the player (+x at 3.0 m/s),
 *   B-rings meet them head-on; the safe pocket between an A-ring that passed
 *   and the next B-ring drifts down-corridor — walk with it, jump what catches
 *   you. cp9 sits on a side spur at z -6.0: 11.66 m from MA vs the 11.2 m
 *   hand-check bound (9.5 + 1.7). MB's rear reach (to x 325.5, spheres at ring
 *   height ~9.9) clears the bridge approach: its deck top is 6.9, a standing
 *   head 8.7, 0.7 m under the sphere band — quoted, not assumed.
 *
 * DETERMINISM: every timed object is a pure function of the stage clock; no
 *   seeds except the far cloud decks, which carry explicit ones.
 */

const GOLD = 0xffc35c; // teaching signs + embossed pips (§3)
const IVORY = 0xfff8e6; // safe edges — the brightest thing on a landing
const HOT = 0xff1044; // reserved for things that end the run
const MINT = 0x18d69a; // checkpoint colour (untouched, unique form)
const FINISH = 0xd9b6ff; // palette.finish — used for nothing else
const SMOKE = 0x241f2e; // dark cloudglass structure — the scene stays dark
const DUSK = 0x6f6584; // receding secondary text
const SLATE = 0x3a3452; // structural glow for OPAL walking slabs (dark, law 5)
const FROST = 0xdff0ff; // wind read

// Band 0..6 — hue = slot = speed class (§3 collision ledger lives in themes.js)
const B_RED = 0xff5a4d;
const B_ORANGE = 0xffa03c;
const B_YELLOW = 0xf5e63d;
const B_GREEN = 0x3ddc84;
const B_BLUE = 0x38b6ff;
const B_INDIGO = 0x4f6bff;
const B_VIOLET = 0x9a5cff;

export default {
  id: 'rainbow-2',
  world: 'rainbow',
  name: 'THE SPLIT',
  subtitle: 'Your old alphabet, spoken in colour',
  par: 178000,
  difficulty: 10,

  spawn: { p: [-1.0, 1.6, 0], yaw: 0 },
  killY: -60,

  /* Ten checkpoints, brief table verbatim (x / clockOffset), each pre-spike;
     distance to the nearest bloom rmax circle / gate plane quoted where it is
     not obviously huge. */
  checkpoints: [
    { p: [1.0, 1.1, 0], yaw: 0, clockOffset: 0 }, // 0 spawn / RED deck (R1 emitter 14.0 m)
    { p: [32.0, 1.7, 0], yaw: 0, clockOffset: 8 }, // 1 RED crusher-bloom clock (R2: 9.0 m > 4.5+1.7)
    { p: [62.0, 2.5, 0.6], yaw: 0, clockOffset: 17 }, // 2 ORANGE belt-into-gate (plane 75.5: 13.5 m)
    { p: [95.0, 3.0, 0.8], yaw: 0, clockOffset: 27 }, // 3 YELLOW entry (gate-A plane 119: 24 m)
    { p: [126.0, 3.5, 0], yaw: 0, clockOffset: 38 }, // 4 between the 7-stop pair (planes 119 / 133.5: 7.0 / 7.5 m)
    { p: [158.0, 2.7, -5.6], yaw: 0, clockOffset: 50 }, // 5 GREEN gap-sector field (G1: 7.27 m > 5.2+1.7)
    { p: [190.0, 3.5, 0], yaw: 0, clockOffset: 63 }, // 6 BLUE ice arc (G3: 16 m)
    { p: [224.0, 8.9, 1.6], yaw: 0, clockOffset: 77 }, // 7 slots:'y' updraft gate (plane 231.5: 7.5 m)
    { p: [256.0, 10.0, -4.0], yaw: 0, clockOffset: 92 }, // 8 INDIGO pendulum bracket (N1: 5.31 m > 3.2+1.7)
    { p: [288.0, 9.7, -6.0], yaw: 0, clockOffset: 108 }, // 9 Moire corridor + Double Rainbow (MA: 11.66 m > 9.5+1.7)
  ],

  finish: { p: [350.4, 8.4, 0], yaw: 0 },

  /* Three coins, each an alternate line with a cost: the perch past the fast
     ring, the shadow sector behind cover, and the catwalk slung UNDER the
     Double Rainbow — below both rings, above nothing at all (brief §7). */
  coins: [
    { p: [41.0, 2.8, 7.3] }, // RED — side perch beyond R2's circle
    { p: [157.0, 3.4, -3.0] }, // GREEN — inside G1's reach, in P2's shadow sector
    { p: [334.5, 6.0, 0] }, // VIOLET — the under-arch catwalk
  ],

  objects: [
    /* ============================================================================ */
    /* RED TERRACE (x 0-45) — FAST LIGHT, SLOW IRON                                 */
    /* The 6.0 m/s ring class, named on the entry sign, paired with crushers on     */
    /* the SAME 4.8 s clock: blooms phase 0 / 0.5, rams phase 0 / 0.5 / 0.5 — one   */
    /* metronome, five instruments.                                                 */
    /* ============================================================================ */

    /* THE THRESHOLD — solid ground, the name, the terrace sign. */
    { kind: 'platform', p: [2.25, 0.5, 0], s: [7.5, 1, 4.6], mat: 'stone', glow: SLATE }, // top 1.0 — CP0; trimmed court, the first gap is a real 3.9 m jump

    { kind: 'text', p: [-3.4, 3.6, 0], rot: [0, -Math.PI / 2, 0], text: 'THE SPLIT', size: 0.86, color: GOLD },
    { kind: 'text', p: [-3.4, 2.9, 0], rot: [0, -Math.PI / 2, 0], text: 'PRISM CROWN  ·  II', size: 0.28, color: DUSK },
    { kind: 'text', p: [-3.4, 2.35, 0], rot: [0, -Math.PI / 2, 0], text: 'seven colours · seven lessons', size: 0.24, color: HOT },
    { kind: 'deco', kindOf: 'arch', p: [6.8, 5.6, 0], s: [1.4, 1.1, 12.0], mat: 'obsidian', tint: 0xff7ad9 },
    { kind: 'deco', kindOf: 'pillar', p: [6.8, 3.3, 5.2], s: [1.2, 5.8, 1.2], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [6.8, 3.3, -5.2], s: [1.2, 5.8, 1.2], mat: 'obsidian' },
    { kind: 'light', p: [2.0, 5.0, 0], color: 0xfff0d0, intensity: 10, distance: 24 },
    { kind: 'text', p: [7.6, 4.0, -4.0], rot: [0, -Math.PI / 2, 0], text: 'RED — FAST LIGHT, SLOW IRON', size: 0.40, color: GOLD },
    { kind: 'text', p: [7.6, 3.45, -4.0], rot: [0, -Math.PI / 2, 0], text: 'this ring outruns you  ·  jump EARLY', size: 0.22, color: DUSK },

    /* R1 — THE FAST RING, sunken disc. Band 0 (6.0 m/s — first of its class in
       the game): rmax 4.8 = ring life 0.8 s, period 4.8 on the terrace clock.
       Circle x 10.2..19.8 in deck 9.9..19.8 — flush east lip: the ring's edge
       IS the deck edge (R2 precedent). The disc sits 0.8 m BELOW the threshold
       so the first read happens looking DOWN at the whole circle. */
    { kind: 'platform', p: [14.85, -0.3, 0], s: [9.9, 1, 10.2], mat: 'stone', glow: SLATE, stripe: true }, // top 0.2, gap 3.90, -0.8
    { kind: 'bloom', p: [15, 0.2, 0], rmax: 4.8, band: 0, period: 4.8, phase: 0 },

    /* THE CRUSHER BED — two half-lane rams, alternating halves, same clock.
       Ram caps park 2.8 m proud (travel = the read); heads close flush with
       the bed top 1.2. Slalom: lane -z at ram 1, lane +z at ram 2. */
    { kind: 'platform', p: [25.85, 0.7, 0], s: [6.7, 1, 9.6], mat: 'stone', glow: SLATE, stripe: true }, // top 1.2, gap 2.70, +1.0 — bed trimmed to the rams' footprint
    { kind: 'crusher', p: [24.0, 5.1, 2.6], s: [3.0, 2.2, 4.0], axis: [0, -1, 0], travel: 2.8, period: 4.8, phase: 0, dwell: 1.4, mat: 'metal' }, // +z half; lane z -2.4..0.6
    { kind: 'crusher', p: [27.5, 5.1, -2.6], s: [3.0, 2.2, 4.0], axis: [0, -1, 0], travel: 2.8, period: 4.8, phase: 0.5, dwell: 1.4, mat: 'metal' }, // -z half; lane z 0.6..2.4

    /* CP1 REST — then R2 + THE GATE RAM: ring and ram share phase 0.5, so the
       ring's edge and the ram's slam arrive as ONE beat; the dodge lane is the
       -z half the ram never covers. */
    { kind: 'platform', p: [31.95, 1.1, 0], s: [2.5, 1, 4.4], mat: 'panel', glow: SLATE, stripe: true }, // top 1.6, gap 1.50, +0.4 — CP1 perch (1.2 m margins); R2's court is a 3.3 m jump out
    { kind: 'platform', p: [41, 1.4, 0], s: [9, 1, 9.2], mat: 'stone', glow: SLATE, stripe: true }, // top 1.9, gap 3.30, +0.3 — R2 court
    { kind: 'bloom', p: [41, 1.9, 0], rmax: 4.5, band: 0, period: 4.8, phase: 0.5 }, // life 0.75 s >= 0.74 law; circle 36.5..45.5 = the court
    { kind: 'crusher', p: [43.5, 5.8, 2.4], s: [2.8, 2.2, 3.6], axis: [0, -1, 0], travel: 2.8, period: 4.8, phase: 0.5, dwell: 1.4, mat: 'metal' }, // closes flush with the court top 1.9
    { kind: 'text', p: [30.2, 3.9, -3.4], rot: [0, -Math.PI / 2, 0], text: 'ONE CLOCK  ·  LIGHT AND IRON', size: 0.30, color: GOLD },

    /* COIN 1 — the side perch: flat 1.5 m hop out past R2's trimmed court rail (circle z 6.1 untouched). */
    { kind: 'platform', p: [41, 1.35, 7.3], s: [2.6, 0.7, 2.4], mat: 'panel', glow: SLATE, stripe: true }, // top 1.7

    /* ============================================================================ */
    /* ORANGE TERRACE (x 45-95) — RIDE THE IRON INTO THE LIGHT                      */
    /* Foundry quote: a 4.5-power belt (half authority — refusing the ride is       */
    /* always possible) feeds prismgate G1's window on its dwell. The entry apron   */
    /* is GONE: a 5.0 m jump off R2's court lands the sideways belt directly. A     */
    /* backward belt out, a lone vanish tile as the hop lane for the stubborn.      */
    /* ============================================================================ */

    { kind: 'conveyor', p: [54, 1.9, 0], s: [7, 1, 4.6], dir: [0, 0, 1], power: 3.0, mat: 'conveyor' }, // top 2.4 — shoves SIDEWAYS (foundry-1 quote); entered by the 5.0 m jump
    { kind: 'platform', p: [62, 1.9, 0.6], s: [4, 1, 6], mat: 'stone', glow: SLATE }, // top 2.4, gap 2.50 in — CP2, the gate's staging deck (trimmed)
    { kind: 'text', p: [59.0, 4.9, -2.8], rot: [0, -Math.PI / 2, 0], text: 'ORANGE — RIDE THE IRON INTO THE LIGHT', size: 0.34, color: GOLD },
    { kind: 'text', p: [59.0, 4.35, -2.8], rot: [0, -Math.PI / 2, 0], text: 'THE BELT IS A CHOICE  ·  the rail waits', size: 0.24, color: DUSK },
    { kind: 'light', p: [61, 4.6, 0.6], color: MINT, intensity: 9, distance: 16 },

    /* THE METRONOME TOWER (court furniture, §4 channel 6): notched spectrum
       ladder, red lowest — slot order IS spectral order. Notches 0.14 m. */
    { kind: 'deco', kindOf: 'post', p: [59.5, 4.1, 5.6], s: [0.5, 3.4, 0.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'rail', p: [59.5, 2.85, 5.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_RED },
    { kind: 'deco', kindOf: 'rail', p: [59.5, 3.30, 5.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_ORANGE },
    { kind: 'deco', kindOf: 'rail', p: [59.5, 3.75, 5.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_YELLOW },
    { kind: 'deco', kindOf: 'rail', p: [59.5, 4.20, 5.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_GREEN },
    { kind: 'deco', kindOf: 'rail', p: [59.5, 4.65, 5.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_BLUE },
    { kind: 'deco', kindOf: 'rail', p: [59.5, 5.10, 5.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_INDIGO },
    { kind: 'deco', kindOf: 'rail', p: [59.5, 5.55, 5.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_VIOLET },
    { kind: 'text', p: [59.5, 6.3, 5.6], rot: [0, -Math.PI / 2, 0], text: 'COUNT THE PIPS', size: 0.26, color: GOLD },

    /* THE BELT INTO THE WINDOW. Belt top 2.4 = gate sill; power 4.5 carries you
       at the window at walking-read speed; the 3.6 m leap off the belt's end
       goes THROUGH the dwell (window 1.6 x 3.0 — the low arc fits; a full
       hold clips the upper lattice, and the sign at rainbow-1's pause island
       already taught the low hop). Landing raised +0.8 so the exit reads —
       and so the belt court is not one flat 41 m corridor (monotony line). */
    { kind: 'conveyor', p: [69.5, 1.9, 0.6], s: [9, 1, 4.4], dir: [1, 0, 0], power: 4.5, mat: 'conveyor' }, // top 2.4, gap 3.60 THROUGH the window
    { kind: 'prismgate', p: [75.5, 4.4, 0.6], s: [0.4, 4.0, 10.0], seq: [1, 2, 3, 2], dwell: 2.0, travel: 1.0, period: 12, window: { w: 1.6, h: 3.0 } },
    { kind: 'deco', kindOf: 'rail', p: [77.6, 2.66, 0.6], s: [0.1, 0.06, 8.6], mat: 'emissive', tint: IVORY }, // exit edge strip — the side you aim for
    { kind: 'platform', p: [79.8, 2.7, 0.6], s: [4.4, 1, 6], mat: 'stone', glow: SLATE, stripe: true }, // top 3.2, landed THROUGH the window, +0.8

    /* OUT — the backward belt (foundry-2 quote, power 3.6 against you) or the
       lone vanish tile beside it: a committed 5.2 m hop onto a 1.9 s-on read
       of the 3.1 s cycle (its twin was deleted — the hop lane is a SPEND now). */
    { kind: 'conveyor', p: [86.5, 1.6, -1.0], s: [6, 1, 4.2], dir: [-1, 0, 0], power: 3.6, mat: 'conveyor' }, // top 2.1, gap 3.10 out, -0.9 — runs AGAINST you
    { kind: 'vanish', p: [88.5, 1.9, 4.2], s: [2.6, 1, 2.8], mat: 'panel', cycle: { on: 1.9, off: 0.8, warn: 0.4, phase: 0.5 } }, // top 2.4 — the hop lane, 5.2 m off the landing
    { kind: 'platform', p: [94.6, 2.4, 0.8], s: [3.2, 1, 4.8], mat: 'stone', glow: SLATE, stripe: true }, // top 2.9, gap 3.10 — CP3
    { kind: 'text', p: [92.0, 5.3, -1.6], rot: [0, -Math.PI / 2, 0], text: 'YELLOW — SEVEN STOPS, TWO SPEEDS', size: 0.36, color: GOLD },
    { kind: 'text', p: [92.0, 4.75, -1.6], rot: [0, -Math.PI / 2, 0], text: 'the ladder walks its whole spectrum · then it tightens', size: 0.22, color: DUSK },

    /* ============================================================================ */
    /* YELLOW TERRACE (x 95-140) — SPEEDPADS + THE 7-STOP PAIR                      */
    /* Two speedpads make the approach a spend — and the dip gap is now 6.3 m:      */
    /* the pad is the line (a bare sprint still clears it, 6.3 < sprint max 7.5,    */
    /* so nothing is walled). Then the pair: two palindromic 0..6..1 gates in       */
    /* consecutive courts, dwell 2.0 then 1.6 — "the ladder tightens" as data,      */
    /* one dwell per gate, aperture 3.67 / 3.47 m/s.                                */
    /* ============================================================================ */

    { kind: 'platform', p: [100.0, 2.9, 0], s: [5.4, 1, 5], mat: 'stone', glow: SLATE, stripe: true }, // top 3.4, gap 1.10, +0.5
    { kind: 'speedpad', p: [99.5, 3.55, 0], s: [3.0, 0.3, 4.0], dir: [1, 0, 0], power: 12.2 }, // flush pad — a step, never a jump
    { kind: 'platform', p: [110.9, 1.7, 0.5], s: [3.8, 1, 4.6], mat: 'panel', glow: SLATE, stripe: true }, // top 2.2, gap 6.30 at -1.2 — the pad dip (pad-carried; sprint-clearable)
    { kind: 'speedpad', p: [111.5, 2.35, 1.0], s: [2.6, 0.3, 3.4], dir: [1, 0, 0], power: 12.2 },

    /* GATE A — THE FULL SPECTRUM, dwell 2.0. Palindromic seq: every one of the
       seven stops, no slide over one slot pitch (the 0..6 wrap would be a
       10.4 m / 1.63 s hop — forbidden shape). Period 30 s; the staging deck is
       the court's west 3.8 m, and one full read is one period, which is why
       the dwell tier is still the teaching 2.0 here. */
    { kind: 'platform', p: [122.1, 2.9, 0], s: [10.6, 1, 12], mat: 'stone', glow: SLATE, stripe: true }, // top 3.4, gap 4.20 in, +1.2 — gate-A court (west staging 2.0 m), CP4 east of the plane
    { kind: 'prismgate', p: [119, 5.4, 0], s: [0.4, 4.0, 12.6], seq: [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1], dwell: 2.0, travel: 0.5, period: 30 },
    { kind: 'text', p: [116.2, 5.6, -4.6], rot: [0, -Math.PI / 2, 0], text: 'ALL SEVEN STOPS', size: 0.38, color: GOLD },
    { kind: 'text', p: [116.2, 5.05, -4.6], rot: [0, -Math.PI / 2, 0], text: 'red far left · violet far right · it never skips', size: 0.22, color: DUSK },

    /* THE SECOND METRONOME — at CP4, where both gates are audible. */
    { kind: 'deco', kindOf: 'post', p: [125.5, 5.1, -5.2], s: [0.5, 3.4, 0.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'rail', p: [125.5, 3.85, -5.2], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_RED },
    { kind: 'deco', kindOf: 'rail', p: [125.5, 4.30, -5.2], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_ORANGE },
    { kind: 'deco', kindOf: 'rail', p: [125.5, 4.75, -5.2], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_YELLOW },
    { kind: 'deco', kindOf: 'rail', p: [125.5, 5.20, -5.2], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_GREEN },
    { kind: 'deco', kindOf: 'rail', p: [125.5, 5.65, -5.2], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_BLUE },
    { kind: 'deco', kindOf: 'rail', p: [125.5, 6.10, -5.2], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_INDIGO },
    { kind: 'deco', kindOf: 'rail', p: [125.5, 6.55, -5.2], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_VIOLET },

    /* GATE B — SAME LADDER, TIGHTER: dwell 1.6 (mid tier), period 25.2. A
       separate court with its own staging west strip — NOT a relay: the lesson
       is the tightening, not a handoff. */
    { kind: 'platform', p: [134.9, 3.7, 0], s: [7.2, 1, 11], mat: 'stone', glow: SLATE, stripe: true }, // top 4.2, gap 3.90 in, +0.8 — gate-B court (west staging 2.0 m)
    { kind: 'prismgate', p: [133.5, 6.2, 0], s: [0.4, 4.0, 12.0], seq: [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1], dwell: 1.6, travel: 0.5, period: 25.2 },
    { kind: 'text', p: [130.5, 6.4, 4.6], rot: [0, -Math.PI / 2, 0], text: 'THE LADDER TIGHTENS', size: 0.34, color: GOLD },
    { kind: 'light', p: [126, 6.0, 0], color: 0xfff0d0, intensity: 8, distance: 22 },
    { kind: 'platform', p: [143.2, 3.7, -1.2], s: [2.8, 1, 3.6], mat: 'panel', glow: SLATE, stripe: true }, // top 4.2, gap 3.30 — the terrace lip

    /* ============================================================================ */
    /* GREEN TERRACE (x 140-185) — SHADOW IS SHELTER                                */
    /* Blooms with authored gap sectors: cover pillars cast visible shadows the     */
    /* ring breaks around (gaps spawn NO kill spheres — bloom.js atan2 frame,       */
    /* 0 deg = +X). Tar between covers makes position a spend. Then the first       */
    /* LOW + HIGH mix. All four emitters on ONE 6 s clock.                          */
    /* ============================================================================ */

    { kind: 'platform', p: [148.3, 2.1, 0], s: [2.4, 1, 3.2], mat: 'stone', glow: SLATE, stripe: true }, // top 2.6, gap 2.50, -1.6 — a lone step down into the field
    { kind: 'text', p: [145.6, 5.0, 2.8], rot: [0, -Math.PI / 2, 0], text: 'GREEN — SHADOW IS SHELTER', size: 0.36, color: GOLD },
    { kind: 'text', p: [145.6, 4.45, 2.8], rot: [0, -Math.PI / 2, 0], text: 'the light breaks around stone · tar makes standing a spend', size: 0.22, color: DUSK },

    /* THE GAP-SECTOR FIELD. G1 (green, 4.2 m/s) with two shadow sectors: P1
       east (deg ~0) and P2 south (deg 270). The coin sits IN the reach, in
       P2's shadow — proof the shadow is real. Tar slab between the covers. */
    { kind: 'platform', p: [158, 2.1, -0.15], s: [12, 1, 13.3], mat: 'stone', glow: SLATE }, // top 2.6, gap 2.50 in — the field (trimmed to the circle), CP5 south rail keeps 1.2 m margins
    { kind: 'bloom', p: [157, 2.6, 1.6], rmax: 5.2, band: 3, period: 6.0, phase: 0, gaps: [{ fromDeg: 0, toDeg: 18 }, { fromDeg: 342, toDeg: 360 }, { fromDeg: 252, toDeg: 288 }] },
    { kind: 'platform', p: [160.5, 3.55, 1.6], s: [1.2, 1.9, 1.6], mat: 'obsidian', glow: SLATE }, // cover P1 — east of G1, top 4.5
    { kind: 'platform', p: [157, 3.55, -2.6], s: [1.4, 1.9, 1.2], mat: 'obsidian', glow: SLATE }, // cover P2 — south of G1
    { kind: 'sticky', p: [159, 2.65, -0.6], s: [3.2, 0.1, 3.0], mat: 'sand' }, // tar between the covers, top 2.7
    { kind: 'light', p: [158, 4.6, -3.6], color: MINT, intensity: 9, distance: 16 },

    /* THE MIX COURT — G2 LOW (green) in P3's shadow game + G3 HIGH (yellow,
       same 4.2 class, and it HANGS: crouch, do not jump). Half a phase apart
       on the shared clock, so the court alternates jump-beat / duck-beat. */
    { kind: 'platform', p: [172.9, 2.5, -0.4], s: [11.4, 1, 9.2], mat: 'stone', glow: SLATE, stripe: true }, // top 3.0, gap 3.20 in, +0.4
    { kind: 'bloom', p: [170.5, 3.0, -1.0], rmax: 3.4, band: 3, period: 6.0, phase: 0.5, gaps: [{ fromDeg: 336, toDeg: 360 }, { fromDeg: 0, toDeg: 8 }] },
    { kind: 'platform', p: [173.5, 3.95, -1.4], s: [1.2, 1.9, 1.4], mat: 'obsidian', glow: SLATE }, // cover P3 — east of G2
    { kind: 'bloom', p: [174, 3.0, 0.4], rmax: 3.8, band: 2, period: 6.0, phase: 0, ring: 'high' },
    { kind: 'sticky', p: [171, 3.05, 3.0], s: [2.8, 0.1, 2.4], mat: 'sand' }, // second tar slab
    { kind: 'text', p: [168.4, 5.6, 3.8], rot: [0, -Math.PI / 2, 0], text: 'LOW ROLLS — JUMP  ·  HIGH HANGS — DUCK', size: 0.30, color: GOLD },
    { kind: 'text', p: [168.4, 5.1, 3.8], rot: [0, -Math.PI / 2, 0], text: 'together now  ·  half a beat apart', size: 0.22, color: DUSK },

    { kind: 'platform', p: [183.0, 2.05, 1.2], s: [2.8, 1, 3.6], mat: 'panel', glow: SLATE, stripe: true }, // top 2.55, gap 3.00, -0.45 — SUNKEN step out of the field (the authored height reset that keeps the terrace under the 40 m monotony line)

    /* ============================================================================ */
    /* BLUE TERRACE (x 185-235) — OLD ICE, NEW WIND                                 */
    /* Spire quote: an ice arc in a +z crosswind (glazed lane drifts with the       */
    /* shove, vanish lane fights it), then the shaft — lift or hop to the           */
    /* gallery, and a slots:'y' gate climbing its ladder over an updraft.           */
    /* ============================================================================ */

    { kind: 'platform', p: [189.5, 2.9, 0], s: [3.8, 1, 4.2], mat: 'stone', glow: SLATE, stripe: true }, // top 3.4, gap 3.20 in — CP6 (1.2 m margins)
    { kind: 'text', p: [186.6, 5.9, -2.6], rot: [0, -Math.PI / 2, 0], text: 'BLUE — OLD ICE, NEW WIND', size: 0.36, color: GOLD },
    { kind: 'text', p: [186.6, 5.35, -2.6], rot: [0, -Math.PI / 2, 0], text: 'the shove is constant · the glaze keeps it', size: 0.22, color: DUSK },

    /* THE ICE ARC. Crosswind shoves +z across x 195..207; the glazed tiles
       drift WITH it (+z offsets each 2.9 m hop), then I4 cuts back against it.
       The vanish tiles are the against-wind line, pushed to the DEEP -z rail —
       same 3.1 s cycle both tiles, entered by a committed 6.4 m leap off I1. */
    { kind: 'ice', p: [196, 3.3, -0.8], s: [3.6, 1, 4] }, // top 3.8, gap 2.80, +0.4
    { kind: 'wind', p: [201, 6.5, 0], s: [12, 6, 12], dir: [0, 0, 1], power: 10, color: FROST }, // x 195..207 — the crosswind
    { kind: 'ice', p: [202.4, 3.9, 1.4], s: [3.4, 1, 3.8] }, // top 4.4, gap 2.90, +0.6, drifting +z
    { kind: 'ice', p: [208.6, 4.5, 3.2], s: [3.2, 1, 3.6] }, // top 5.0, gap 2.75, +0.6
    { kind: 'vanish', p: [205.5, 4.1, -4.8], s: [2.6, 1, 2.8], mat: 'panel', cycle: { on: 1.9, off: 0.8, warn: 0.4, phase: 0 } }, // top 4.6 — the against-wind line, deep rail
    { kind: 'vanish', p: [212.4, 4.7, -2.6], s: [2.6, 1, 2.8], mat: 'panel', cycle: { on: 1.9, off: 0.8, warn: 0.4, phase: 0.5 } }, // top 5.2 — 4.3 m on the diagonal from its twin
    { kind: 'ice', p: [214.9, 5.1, 1.2], s: [3.6, 1, 3.8] }, // top 5.6, gap 3.10, +0.6, cutting BACK
    { kind: 'text', p: [206.4, 7.2, 5.6], rot: [0, -Math.PI / 2, 0], text: 'GLAZED', size: 0.36, color: FROST },

    /* THE SHAFT. Lift is the patient line; the updraft fills the climb. CP7 on
       the gallery, 7.5 m before the gate plane. */
    { kind: 'platform', p: [221.7, 5.3, -0.6], s: [3.8, 1, 4.2], mat: 'stone', glow: SLATE, stripe: true }, // top 5.8, gap 0.50 onto the lift, +0.2 — shaft base
    {
      kind: 'mover',
      p: [225.5, 5.3, -3.6],
      s: [2.8, 1, 2.8],
      mat: 'metal',
      motion: { type: 'elevator', to: [225.5, 8.3, -3.6], speed: 2.0, dwell: 0.4, hold: 2.0 },
    }, // board at top 5.8, ride to 8.8
    { kind: 'wind', p: [227, 9.0, 0], s: [7, 8, 7], dir: [0, 1, 0], power: 9, color: FROST }, // the updraft
    { kind: 'platform', p: [225.9, 8.3, 1.6], s: [6.2, 1, 5.6], mat: 'stone', glow: SLATE, stripe: true }, // THE GALLERY, top 8.8 — CP7 (1.2 m margins held)

    /* THE CLIMBING DOOR (slots:'y'). seq [1,3,5], one lit stop at a time; the
       crossing is the house 3.4 m at +0.9 through the MIDDLE window (y
       9.1..12.7 swallows the whole arc: full-hold head peaks 12.69 at the
       plane). Aperture 1.8 m/s vertical — slower than the lift. */
    { kind: 'prismgate', p: [231.5, 10.9, 1.6], s: [0.4, 7.0, 6.0], slots: 'y', seq: [1, 3, 5], dwell: 2.0, travel: 1.0, period: 9, window: { w: 1.6, h: 3.6 } },
    { kind: 'platform', p: [234.1, 9.2, 1.6], s: [3.4, 1, 3.4], mat: 'panel', glow: SLATE, stripe: true }, // top 9.7, gap 3.40 at +0.9 THROUGH the middle window — the house number, kept
    { kind: 'text', p: [228.4, 12.4, -1.6], rot: [0, -Math.PI / 2, 0], text: 'THE DOOR CLIMBS — MEET IT MID-LADDER', size: 0.30, color: GOLD },
    { kind: 'light', p: [226, 10.4, 1.6], color: FROST, intensity: 8, distance: 22 },

    /* ============================================================================ */
    /* INDIGO TERRACE (x 235-285) — BLADES BETWEEN BLOOMS                           */
    /* One LOW and one HIGH bloom bracket three cross-route pendulums (axis        */
    /* [1,0,0]: the swing exits over the gallery's sides — law 2's default-safe    */
    /* shape). Everything on the 6 s clock: blooms 6 s, blades 3 s.                */
    /* ============================================================================ */

    { kind: 'ice', p: [241.2, 9.0, 0], s: [3.4, 1, 3.8] }, // top 9.5, gap 3.70 in, -0.2 — one last glaze; the rest deck that followed it is DELETED: N1's court is a 5.6 m leap off the glaze
    { kind: 'wind', p: [241, 12.0, 0], s: [8, 5, 10], dir: [0, 0, -1], power: 8, color: FROST }, // counter-shear over the lip
    { kind: 'text', p: [243.6, 12.0, 2.4], rot: [0, -Math.PI / 2, 0], text: 'INDIGO — BLADES BETWEEN BLOOMS', size: 0.34, color: GOLD },
    { kind: 'text', p: [243.6, 11.45, 2.4], rot: [0, -Math.PI / 2, 0], text: 'the ring sets the beat · the blades keep it', size: 0.22, color: DUSK },

    /* N1 LOW (indigo band, 3.0 m/s) on the entry court; CP8 at the court's
       south rail, 5.31 m from the emitter (bound 3.2 + 1.7 = 4.9). */
    { kind: 'platform', p: [252.5, 8.9, 0], s: [8, 1, 9], mat: 'stone', glow: SLATE, stripe: true }, // top 9.4, gap 0.50, -0.1 — CP8
    { kind: 'bloom', p: [252.5, 9.4, 0], rmax: 3.2, band: 5, period: 6.0, phase: 0 },

    /* THE BLADE GALLERY — narrow on purpose (z +-2.6): each arc exits past the
       rails. Three blades, one 3 s period, phases a third apart: a rolling
       wave you cross blade by blade. Bailout ledge rides the north rail. */
    { kind: 'platform', p: [264, 8.7, 0], s: [13, 1, 5.2], mat: 'stone', glow: SLATE }, // top 9.2, gap 1.00, -0.2
    { kind: 'pendulum', p: [260.5, 14.15, 0], len: 3.6, amp: 0.54, period: 3.0, phase: 0, axis: [1, 0, 0], blade: { w: 2.8, h: 2.6, d: 0.26 } },
    { kind: 'pendulum', p: [264.5, 14.15, 0], len: 3.6, amp: 0.54, period: 3.0, phase: (Math.PI * 2) / 3, axis: [1, 0, 0], blade: { w: 2.8, h: 2.6, d: 0.26 } },
    { kind: 'pendulum', p: [268.5, 14.15, 0], len: 3.6, amp: 0.54, period: 3.0, phase: (Math.PI * 4) / 3, axis: [1, 0, 0], blade: { w: 2.8, h: 2.6, d: 0.26 } },
    { kind: 'deco', kindOf: 'post', p: [257.8, 11.4, -2.2], s: [0.4, 4.4, 0.4], mat: 'obsidian' }, // gallery frame
    { kind: 'deco', kindOf: 'post', p: [270.2, 11.4, -2.2], s: [0.4, 4.4, 0.4], mat: 'obsidian' },

    /* N2 HIGH closes the bracket, half a phase off N1: duck-beat answers
       jump-beat across the whole terrace. The court is trimmed INSIDE the
       circle: N2's head-height rings overhang both lips, so the hop in and
       the 3.7 m jump out both pass through the duck-beat's reach. */
    { kind: 'platform', p: [274.5, 10.1, 0.4], s: [5.8, 1, 6.0], mat: 'stone', glow: SLATE }, // +0.9 raised 2026-09-16: with the blade-court side rail deleted (owner: remove the thin platform right of the three axes) this deck is the corridor's height break. Top 10.60: geomcheck's flat-run walk anchors at the LAST >0.75 m step (x 234.1, y 9.70), so the break must clear THAT anchor, not the neighbour — 10.30 read as flat, 10.60 splits the 72 m window at both its edges
    { kind: 'bloom', p: [274.5, 9.4, 0.4], rmax: 3.4, band: 5, period: 6.0, phase: 0.5, ring: 'high' },
    { kind: 'platform', p: [282.4, 9.1, -0.8], s: [2.6, 1, 3.4], mat: 'panel', glow: SLATE, stripe: true }, // top 9.6, gap 3.70, +0.2 — terrace lip

    /* ============================================================================ */
    /* VIOLET TERRACE (x 285-340) — THE MOIRE POCKET, THEN THE DOUBLE RAINBOW       */
    /* The corridor: 24 m, counter-phased blue emitters at BOTH ends, one 9 s      */
    /* clock, half a phase apart (geometry proof in the header). Then the set      */
    /* piece: twin arched bridge, LOW rings from both ends, a prismgate at the     */
    /* apex — two ring-jumps and the window's dwell arrives as you land the        */
    /* second (shared 12 s superperiod, brief-exact).                              */
    /* ============================================================================ */

    /* CP9 SPUR — the observation perch, off-axis at z -6: outside MA's reach
       (11.66 m > 9.5 + 1.7) with the whole corridor in view. The old entry
       step is DELETED: the crossing starts with a committed 5.3 m jump off
       this perch INTO the field. */
    { kind: 'platform', p: [288, 9.1, -6.0], s: [2.4, 1, 3.0], mat: 'stone', glow: SLATE, stripe: true }, // top 9.6 — CP9 perch (1.2 m margins; MA distance unchanged)
    { kind: 'text', p: [285.2, 12.2, -8.0], rot: [0, -Math.PI / 2, 0], text: 'VIOLET — THE POCKET WALKS', size: 0.36, color: GOLD },
    { kind: 'text', p: [285.2, 11.65, -8.0], rot: [0, -Math.PI / 2, 0], text: 'WALK WITH IT · jump what catches you', size: 0.24, color: DUSK },
    { kind: 'light', p: [287.5, 11.6, -5.8], color: MINT, intensity: 9, distance: 16 },

    /* THE MOIRE CORRIDOR. A-rings chase (+x), B-rings meet you (-x). Emitters
       2 m in from each lip; standing on either at pulse birth is lethal —
       cross each right behind its ring. */
    { kind: 'platform', p: [306, 8.9, 0], s: [24, 1, 4.6], mat: 'stone', glow: SLATE }, // top 9.4, x 294..318 — the corridor
    { kind: 'bloom', p: [298, 9.4, 0], rmax: 9.5, band: 4, period: 9.0, phase: 0 }, // MA — west
    { kind: 'bloom', p: [316, 9.4, 0], rmax: 9.5, band: 4, period: 9.0, phase: 0.5 }, // MB — east
    { kind: 'deco', kindOf: 'rail', p: [306, 9.55, 2.45], s: [23.6, 0.1, 0.12], mat: 'emissive', tint: B_VIOLET }, // corridor edge strip, 0.12 m (glare budget)
    { kind: 'deco', kindOf: 'rail', p: [306, 9.55, -2.45], s: [23.6, 0.1, 0.12], mat: 'emissive', tint: B_VIOLET },

    /* THE DOUBLE RAINBOW. A 2.7 m jump-drop of -2.5 off the corridor lip
       (temple-3 spends the same -2.5), then the twin arch: D1 west, D2 east,
       counter-phased on the 6 s clock; the apex gate holds the 12 s
       superperiod. The old mid step between D1's deck and the apex is
       DELETED: D1's ring-jump must carry 5.1 m and +1.7 straight to the apex
       — the set piece's two beats are now two REAL jumps. MB's rear reach
       passes 2.5 m OVERHEAD here — quoted clear in the header. */
    { kind: 'platform', p: [322.4, 6.4, 0], s: [3.4, 1, 4.6], mat: 'stone', glow: SLATE, stripe: true }, // top 6.9, gap 2.70, -2.5 jump-drop
    { kind: 'text', p: [319.8, 9.4, 3.4], rot: [0, -Math.PI / 2, 0], text: 'THE DOUBLE RAINBOW', size: 0.44, color: GOLD },
    { kind: 'text', p: [319.8, 8.85, 3.4], rot: [0, -Math.PI / 2, 0], text: 'two rings · one window · land the second, walk the light', size: 0.22, color: DUSK },

    /* THE THIRD METRONOME — at the bridge approach, where the whole set piece
       is readable before the first jump. */
    { kind: 'deco', kindOf: 'post', p: [321.0, 8.6, -4.6], s: [0.5, 3.4, 0.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'rail', p: [321.0, 7.35, -4.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_RED },
    { kind: 'deco', kindOf: 'rail', p: [321.0, 7.80, -4.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_ORANGE },
    { kind: 'deco', kindOf: 'rail', p: [321.0, 8.25, -4.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_YELLOW },
    { kind: 'deco', kindOf: 'rail', p: [321.0, 8.70, -4.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_GREEN },
    { kind: 'deco', kindOf: 'rail', p: [321.0, 9.15, -4.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_BLUE },
    { kind: 'deco', kindOf: 'rail', p: [321.0, 9.60, -4.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_INDIGO },
    { kind: 'deco', kindOf: 'rail', p: [321.0, 10.05, -4.6], s: [0.14, 0.08, 0.44], mat: 'emissive', tint: B_VIOLET },
    { kind: 'text', p: [321.0, 10.8, -4.6], rot: [0, -Math.PI / 2, 0], text: 'RED LOW · VIOLET HIGH', size: 0.26, color: GOLD },

    /* The bridge west deck + D1; the arch climbs 6.9 -> 8.6 (apex) in ONE leap. */
    { kind: 'platform', p: [327.6, 6.4, 0], s: [3.0, 1, 5], mat: 'stone', glow: SLATE }, // top 6.9 — D1's deck; 2.8 down to the catwalk, 5.1 at +1.7 up to the apex
    { kind: 'bloom', p: [327.4, 6.9, 0], rmax: 3.4, band: 4, period: 6.0, phase: 0 }, // D1 — first ring-jump
    { kind: 'platform', p: [336.3, 8.1, 0], s: [4.2, 1, 4.6], mat: 'stone', glow: SLATE, stripe: true }, // THE APEX, top 8.6, gap 5.10 at +1.7 in (staging 3.0 m before the plane)
    { kind: 'prismgate', p: [337.4, 10.6, 0], s: [0.4, 4.0, 9.0], seq: [2, 3, 4, 3], dwell: 2.0, travel: 1.0, period: 12 },
    { kind: 'platform', p: [343.0, 7.3, 0], s: [3.4, 1, 5.4], mat: 'stone', glow: SLATE, stripe: true }, // east deck, top 7.8, gap 2.90 THROUGH the window, -0.8
    { kind: 'bloom', p: [342.2, 7.8, 0], rmax: 3.0, band: 4, period: 6.0, phase: 0.5 }, // D2 — the second ring-jump, and the window opens as you land

    /* COIN 3 — the catwalk slung UNDER the arch: a 2.8 m jump-drop off D1's
       deck lip (-1.75), out past the apex's shadow, then ONE deep riser (its
       twin is DELETED): 5.8 m off the catwalk's end onto the riser, 4.1 m
       from the riser up to the finish court — the coin's cost is two
       committed jumps, not a staircase. */
    { kind: 'platform', p: [335.4, 4.9, 0], s: [7, 0.5, 1.6], mat: 'metal', glow: SLATE }, // the catwalk, top 5.15
    { kind: 'platform', p: [343.2, 5.65, -6.8], s: [2.0, 1, 2.4], mat: 'panel', glow: SLATE, stripe: true }, // the lone riser, top 6.15

    /* THE FINISH COURT — violet is the finish's colour and nothing else's. */
    { kind: 'platform', p: [350.1, 7.3, 0], s: [4.6, 1, 7.4], mat: 'obsidian', glow: FINISH, stripe: true }, // top 7.8, gap 3.10 flat
    { kind: 'deco', kindOf: 'arch', p: [349.8, 13.2, 0], s: [1.8, 1.4, 10.0], mat: 'obsidian', tint: FINISH },
    { kind: 'deco', kindOf: 'pillar', p: [349.8, 10.4, 4.6], s: [1.5, 6.4, 1.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'pillar', p: [349.8, 10.4, -4.6], s: [1.5, 6.4, 1.5], mat: 'obsidian' },
    { kind: 'deco', kindOf: 'beacon', p: [353.2, 10.0, 0], s: [0.7, 3.2, 0.7], mat: 'emissive', tint: FINISH },
    { kind: 'text', p: [346.6, 10.2, 0], rot: [0, -Math.PI / 2, 0], text: 'THE SPLIT', size: 0.5, color: FINISH },
    { kind: 'light', p: [349.8, 11.0, 0], color: FINISH, intensity: 20, distance: 36 },

    /* ============================================================================ */
    /* DRESSING — all at |z| >= 12, above y 16 or below y -8: out of every play     */
    /* corridor, no flat lit top edges, distant-scenery luminance (the dark-        */
    /* adapted scene stays dark, law 5).                                            */
    /* ============================================================================ */

    { kind: 'deco', kindOf: 'monolith', p: [80, -18, 28], s: [8, 32, 8], count: 7, spread: [220, 20, 22], seed: 6101, tint: 0x8f86a8 },
    { kind: 'deco', kindOf: 'monolith', p: [250, -20, -32], s: [10, 36, 10], count: 7, spread: [200, 24, 24], seed: 6211, tint: 0x7d739c },
    { kind: 'deco', kindOf: 'shard', p: [170, 6, 22], s: [2.6, 8.0, 2.6], count: 6, spread: [240, 16, 14], seed: 6329, tint: 0xbfb3e0 },
    { kind: 'deco', kindOf: 'pillar', p: [120, -10, -20], s: [1.8, 22.0, 1.8], count: 8, spread: [280, 12, 10], seed: 6449, tint: 0x6c6288 },
    { kind: 'deco', kindOf: 'cloud', p: [170, -28, 0], s: [24, 3.2, 24], count: 14, spread: [360, 10, 120], seed: 6521, scale: 2.2, tint: 0xffffff },
    { kind: 'deco', kindOf: 'cloud', p: [180, -46, 0], s: [32, 4.0, 32], count: 10, spread: [360, 12, 150], seed: 6661, scale: 2.8, tint: 0xe6ecf8 },

    /* Path lights, one per terrace pair — cool and dim, the hazards carry hue. */
    { kind: 'light', p: [25, 4.8, 0], color: 0xfff0d0, intensity: 7, distance: 24 },
    { kind: 'light', p: [75, 5.6, 0.6], color: 0xfff0d0, intensity: 7, distance: 24 },
    { kind: 'light', p: [158, 5.4, 0], color: 0xfff0d0, intensity: 7, distance: 24 },
    { kind: 'light', p: [205, 7.2, 0.6], color: FROST, intensity: 8, distance: 24 },
    { kind: 'light', p: [264, 12.0, 0], color: 0xfff0d0, intensity: 7, distance: 24 },
    { kind: 'light', p: [306, 11.6, 0], color: 0xfff0d0, intensity: 8, distance: 26 },
  ],
};
